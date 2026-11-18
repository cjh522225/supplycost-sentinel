import Decimal from 'decimal.js'
import type {
  RealtimeCapability,
  RealtimeDepthLevel,
  RealtimeDepthSnapshot,
  RealtimeQuote,
  RealtimeSeries,
  RealtimeSettingsPublic,
  RealtimeTestResult,
  RealtimeTradePrint
} from '../../shared/types'
import type {
  RealtimeFetchContext,
  RealtimeFetchResult,
  RealtimeProvider,
  RealtimeSymbol
} from './provider'

const BASE_RATES: Record<string, string> = {
  USD: '7.1200',
  EUR: '7.7500',
  GBP: '9.0500',
  JPY: '0.0470',
  HKD: '0.9100',
  AUD: '4.7000',
  NZD: '4.3000',
  SGD: '5.3000',
  CHF: '8.1000',
  CAD: '5.2000'
}

const DEPTH_LEVELS = 5
const TRADE_COUNT = 8

export class MockRealtimeProvider implements RealtimeProvider {
  readonly id = 'mock' as const
  readonly label = '演示行情'
  readonly capabilities: RealtimeCapability[] = ['quotes', 'topOfBook', 'depth', 'trades']
  readonly requiresKey = false
  readonly demo = true

  async fetch(
    symbols: RealtimeSymbol[],
    settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeFetchResult> {
    if (context?.signal?.aborted) throw new Error('请求已取消')
    const now = new Date()
    const quoteAt = now.toISOString()
    const quotes: RealtimeQuote[] = []
    const depth: RealtimeDepthSnapshot[] = []
    const trades: RealtimeTradePrint[] = []

    for (const [index, item] of symbols.entries()) {
      const base = BASE_RATES[item.productId]
      if (!base) continue
      const phase = Math.floor(now.getTime() / 60_000)
      const drift = new Decimal(Math.sin(phase / 7 + index).toFixed(8)).mul('0.0015')
      const mid = new Decimal(base).mul(new Decimal(1).plus(drift))
      const spread = mid.mul('0.00008')
      const bid = mid.minus(spread)
      const ask = mid.plus(spread)
      const quote: RealtimeQuote = {
        provider: 'mock',
        symbol: item.symbol,
        productId: item.productId,
        bid: bid.toFixed(6),
        ask: ask.toFixed(6),
        mid: mid.toFixed(6),
        quoteAt,
        receivedAt: now.toISOString(),
        delayMs: 0,
        demo: true
      }
      quotes.push(quote)

      if (settings.depthEnabled) {
        const bids: RealtimeDepthLevel[] = []
        const asks: RealtimeDepthLevel[] = []
        for (let level = 1; level <= DEPTH_LEVELS; level += 1) {
          const step = mid.mul(new Decimal(level).mul('0.00005'))
          bids.push({
            price: mid.minus(step).toFixed(6),
            size: new Decimal(80 + index * 7 + level * 13).toString()
          })
          asks.push({
            price: mid.plus(step).toFixed(6),
            size: new Decimal(75 + index * 5 + level * 11).toString()
          })
        }
        depth.push({
          provider: 'mock',
          symbol: item.symbol,
          productId: item.productId,
          bids,
          asks,
          quoteAt,
          receivedAt: now.toISOString(),
          demo: true
        })
      }

      if (settings.tradesEnabled) {
        for (let trade = 0; trade < TRADE_COUNT; trade += 1) {
          const offset = new Decimal((trade - TRADE_COUNT / 2) * 0.00002)
          trades.push({
            provider: 'mock',
            symbol: item.symbol,
            productId: item.productId,
            price: mid.plus(offset).toFixed(6),
            size: new Decimal(10 + ((index + trade) % 9) * 3).toString(),
            side: trade % 3 === 0 ? 'sell' : 'buy',
            quoteAt: new Date(now.getTime() - (TRADE_COUNT - trade) * 1000).toISOString(),
            receivedAt: now.toISOString(),
            demo: true
          })
        }
      }
    }

    return { quotes, depth, trades }
  }

  async fetchSeries(
    symbol: RealtimeSymbol,
    _settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeSeries> {
    if (context?.signal?.aborted) throw new Error('请求已取消')
    const base = new Decimal(BASE_RATES[symbol.productId] ?? '1')
    const now = Date.now()
    const points = Array.from({ length: 120 }, (_, index) => {
      const wave = new Decimal(Math.sin((now / 60000 + index) / 8).toFixed(8)).mul('0.0012')
      return {
        time: new Date(now - (119 - index) * 60_000).toISOString(),
        close: base.mul(new Decimal(1).plus(wave)).toFixed(6)
      }
    })
    return {
      provider: 'mock',
      symbol: symbol.symbol,
      productId: symbol.productId,
      interval: '1min',
      points,
      fetchedAt: new Date().toISOString(),
      demo: true
    }
  }

  async test(
    settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeTestResult> {
    const startedAt = Date.now()
    const symbols: RealtimeSymbol[] = [
      { productId: 'USD', symbol: 'USD/CNY', displayName: '美元/人民币', precision: 4, unit: 'CNY' }
    ]
    const result = await this.fetch(symbols, settings, context)
    return {
      ok: result.quotes.length > 0,
      provider: 'mock',
      message: result.quotes.length
        ? '演示行情正常；这是本地模拟数据，不代表真实行情。'
        : '演示行情未生成报价。',
      latencyMs: Date.now() - startedAt,
      capabilities: [...this.capabilities]
    }
  }
}
