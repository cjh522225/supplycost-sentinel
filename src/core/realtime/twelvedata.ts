import Decimal from 'decimal.js'
import type {
  RealtimeCapability,
  RealtimeQuote,
  RealtimeSeries,
  RealtimeSettingsPublic,
  RealtimeTestResult,
  RealtimeUsage
} from '../../shared/types'
import { fetchJson } from '../adapters/http'
import type {
  RealtimeFetchContext,
  RealtimeFetchResult,
  RealtimeProvider,
  RealtimeSymbol
} from './provider'

interface TwelveDataQuote {
  symbol?: string
  name?: string
  datetime?: string
  timestamp?: number
  last_quote_at?: number
  close?: string
  previous_close?: string
  percent_change?: string
  is_market_open?: boolean
  status?: string
  code?: number
  message?: string
}

interface TwelveDataQuoteMap {
  [key: string]: TwelveDataQuote
}

interface TwelveDataSeriesResponse {
  status?: string
  code?: number
  message?: string
  meta?: { symbol?: string; interval?: string }
  values?: {
    datetime?: string
    open?: string
    high?: string
    low?: string
    close?: string
  }[]
}

interface TwelveDataUsageResponse {
  status?: string
  code?: number
  message?: string
  current_usage?: number
  plan_limit?: number
  daily_usage?: number
  plan_daily_limit?: number
  plan_category?: string
}

function asQuoteList(payload: TwelveDataQuote | TwelveDataQuoteMap): TwelveDataQuote[] {
  if (typeof payload.symbol === 'string') return [payload]
  return Object.values(payload).filter((item) => typeof item === 'object' && item !== null)
}

function quoteTime(quote: TwelveDataQuote): string {
  const seconds = quote.last_quote_at ?? quote.timestamp
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toISOString()
  }
  if (quote.datetime) {
    const parsed = new Date(quote.datetime.replace(' ', 'T') + 'Z')
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

export class TwelveDataProvider implements RealtimeProvider {
  readonly id = 'twelvedata' as const
  readonly label = 'Twelve Data'
  readonly capabilities: RealtimeCapability[] = ['quotes']
  readonly requiresKey = true
  readonly demo = false

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.twelvedata.com'
  ) {}

  private endpoint(path: string): string {
    const base = (this.baseUrl || 'https://api.twelvedata.com').trim().replace(/\/+$/, '')
    return `${base}/${path.replace(/^\/+/, '')}`
  }

  private requireKey(): string {
    const key = this.apiKey.trim()
    if (!key) throw new Error('未配置 Twelve Data API Key。')
    return key
  }

  async fetch(
    symbols: RealtimeSymbol[],
    _settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeFetchResult> {
    if (!symbols.length) return { quotes: [], depth: [], trades: [] }
    const key = this.requireKey()
    const bySymbol = new Map(symbols.map((item) => [item.symbol, item]))
    const query = symbols.map((item) => item.symbol).join(',')
    const url = `${this.endpoint('quote')}?symbol=${encodeURIComponent(query)}&apikey=${encodeURIComponent(key)}`
    const payload = await fetchJson<TwelveDataQuote | TwelveDataQuoteMap>(url, {
      timeoutMs: 20_000,
      retries: 0,
      signal: context?.signal
    })

    const quotes: RealtimeQuote[] = []
    for (const raw of asQuoteList(payload)) {
      if (raw.status === 'error' || raw.code) {
        throw new Error(`Twelve Data：${raw.message ?? `错误码 ${raw.code ?? 'unknown'}`}`)
      }
      if (!raw.symbol || !raw.close) continue
      const symbol = bySymbol.get(raw.symbol)
      if (!symbol) continue
      const mid = new Decimal(raw.close)
      if (!mid.isFinite() || mid.lte(0)) continue
      const receivedAt = new Date()
      const quoteAt = quoteTime(raw)
      const delayMs = Math.max(0, receivedAt.getTime() - new Date(quoteAt).getTime())
      quotes.push({
        provider: 'twelvedata',
        symbol: raw.symbol,
        productId: symbol.productId,
        mid: mid.toFixed(6),
        previousMid: raw.previous_close
          ? new Decimal(raw.previous_close).toFixed(6)
          : undefined,
        changePct: raw.percent_change,
        marketOpen: raw.is_market_open,
        quoteAt,
        receivedAt: receivedAt.toISOString(),
        delayMs,
        sourceUrl: `${this.endpoint('quote')}?symbol=${encodeURIComponent(raw.symbol)}`,
        demo: false
      })
    }
    if (!quotes.length) throw new Error('Twelve Data 返回了空报价。')
    return { quotes, depth: [], trades: [] }
  }

  async fetchSeries(
    symbol: RealtimeSymbol,
    _settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeSeries> {
    const key = this.requireKey()
    const url = `${this.endpoint('time_series')}?symbol=${encodeURIComponent(symbol.symbol)}&interval=1min&outputsize=120&apikey=${encodeURIComponent(key)}`
    const payload = await fetchJson<TwelveDataSeriesResponse>(url, {
      timeoutMs: 20_000,
      retries: 0,
      signal: context?.signal
    })
    if (payload.status === 'error' || payload.code) {
      throw new Error(`Twelve Data：${payload.message ?? `错误码 ${payload.code ?? 'unknown'}`}`)
    }
    const points = (payload.values ?? [])
      .filter((value) => value.datetime && value.close)
      .map((value) => ({
        time: new Date(value.datetime!.replace(' ', 'T') + 'Z').toISOString(),
        open: value.open,
        high: value.high,
        low: value.low,
        close: new Decimal(value.close!).toFixed(6)
      }))
      .reverse()
    if (!points.length) throw new Error('Twelve Data 返回空的分时数据。')
    return {
      provider: 'twelvedata',
      symbol: symbol.symbol,
      productId: symbol.productId,
      interval: '1min',
      points,
      fetchedAt: new Date().toISOString(),
      demo: false
    }
  }

  async getUsage(context?: RealtimeFetchContext): Promise<RealtimeUsage> {
    const key = this.requireKey()
    const payload = await fetchJson<TwelveDataUsageResponse>(
      `${this.endpoint('api_usage')}?apikey=${encodeURIComponent(key)}`,
      { timeoutMs: 15_000, retries: 0, signal: context?.signal }
    )
    if (payload.status === 'error' || payload.code) {
      throw new Error(`Twelve Data：${payload.message ?? `错误码 ${payload.code ?? 'unknown'}`}`)
    }
    return {
      planCategory: payload.plan_category,
      currentUsage: payload.current_usage,
      planLimit: payload.plan_limit,
      dailyUsage: payload.daily_usage,
      planDailyLimit: payload.plan_daily_limit,
      updatedAt: new Date().toISOString()
    }
  }

  async test(
    settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeTestResult> {
    const startedAt = Date.now()
    try {
      const result = await this.fetch(
        [{ productId: 'USD', symbol: 'USD/CNY', displayName: '美元/人民币', precision: 4, unit: 'CNY' }],
        settings,
        context
      )
      const quote = result.quotes[0]
      return {
        ok: true,
        provider: 'twelvedata',
        message: `连接成功：USD/CNY ${quote.mid}；该套餐仅提供 quotes，不提供 bid/ask/depth/trades。`,
        latencyMs: Date.now() - startedAt,
        capabilities: [...this.capabilities]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        provider: 'twelvedata',
        message: /HTTP 401|invalid credential|unauthorized/i.test(message)
          ? `${message}。请检查 Twelve Data API Key 是否有效或已被轮换，并在设置中重新保存。`
          : message,
        latencyMs: Date.now() - startedAt,
        capabilities: [...this.capabilities]
      }
    }
  }
}
