import type {
  AlertRecord,
  AppSettings,
  MonitorConfig,
  RealtimeCapability,
  RealtimeQuote,
  RealtimeSeries,
  RealtimeSettingsPublic,
  RealtimeSnapshot,
  RealtimeStatus,
  RealtimeTestResult,
  RealtimeUsage
} from '../../shared/types'
import { buildRealtimeChangeAlert, buildRealtimeFeedAlert } from './alerts'
import { MockRealtimeProvider } from './mock'
import { realtimeSymbols } from './provider'
import { TwelveDataProvider } from './twelvedata'
import type { RealtimeFetchResult, RealtimeProvider } from './provider'
import { RealtimeStore } from './store'

export interface RealtimeServiceOptions {
  dataDir: string
  getSettings: () => AppSettings
  getMonitors: () => MonitorConfig[]
  decryptApiKey?: () => string | undefined
  onUpdate?: (snapshot: RealtimeSnapshot) => void
  onAlerts?: (alerts: AlertRecord[]) => void
}

interface QuoteHistoryEntry {
  mid: string
  quoteAt: string
}

class UnavailableProvider implements RealtimeProvider {
  readonly capabilities: RealtimeCapability[] = ['quotes']
  readonly requiresKey = true
  readonly demo = false
  readonly label: string

  constructor(private readonly providerId: RealtimeProvider['id']) {
    this.label = providerId
  }

  get id(): RealtimeProvider['id'] {
    return this.providerId
  }

  async fetch(): Promise<RealtimeFetchResult> {
    throw new Error(`实时行情 Provider 适配器尚未配置：${this.providerId}。请切换到演示行情或等待 Key 接入。`)
  }

  async test(): Promise<RealtimeTestResult> {
    return {
      ok: false,
      provider: this.providerId,
      message: `实时行情 Provider 适配器尚未配置：${this.providerId}。`
    }
  }
}

export class RealtimeService {
  private store: RealtimeStore
  private status: RealtimeStatus
  private snapshot: RealtimeSnapshot
  private latestQuotes = new Map<string, RealtimeQuote>()
  private history = new Map<string, QuoteHistoryEntry[]>()
  private alertCooldowns = new Map<string, number>()
  private seriesCache = new Map<string, { at: number; series: RealtimeSeries }>()
  private usage?: RealtimeUsage
  private usageFetchedAt = 0
  private timer?: NodeJS.Timeout
  private abortController?: AbortController
  private running = false
  private stopped = true

  constructor(private readonly options: RealtimeServiceOptions) {
    this.store = new RealtimeStore(options.dataDir)
    const existing = this.store.readLatest()
    if (existing) {
      this.snapshot = existing
      for (const quote of existing.quotes) {
        this.latestQuotes.set(quote.productId, quote)
        this.history.set(quote.productId, [{ mid: quote.mid, quoteAt: quote.quoteAt }])
      }
    } else {
      this.snapshot = {
        status: this.baseStatus(),
        quotes: [],
        depth: [],
        trades: []
      }
    }
    this.status = this.store.readStatus(this.snapshot.status)
    this.snapshot = { ...this.snapshot, status: this.status }
  }

  private settings(): RealtimeSettingsPublic {
    return this.options.getSettings().realtime
  }

  private provider(): RealtimeProvider {
    const settings = this.settings()
    if (settings.provider === 'mock') return new MockRealtimeProvider()
    if (settings.provider === 'twelvedata') {
      return new TwelveDataProvider(
        this.options.decryptApiKey?.() ?? '',
        settings.baseUrl || 'https://api.twelvedata.com'
      )
    }
    return new UnavailableProvider(settings.provider)
  }

  private baseStatus(): RealtimeStatus {
    const settings = this.settings()
    const provider = this.provider()
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      state: settings.enabled ? 'demo' : 'disabled',
      pollSeconds: settings.pollSeconds,
      quoteCount: 0,
      capabilities: [...provider.capabilities],
      demo: provider.demo,
      usage: this.usage
    }
  }

  getStatus(): RealtimeStatus {
    return this.status
  }

  getSnapshot(): RealtimeSnapshot {
    return {
      ...this.snapshot,
      status: this.status,
      quotes: [...this.latestQuotes.values()],
      depth: this.snapshot.depth,
      trades: this.snapshot.trades
    }
  }

  getAlerts(): AlertRecord[] {
    return this.store.readAlerts()
  }

  updateAlert(id: string, status: 'open' | 'acknowledged' | 'resolved'): AlertRecord[] {
    return this.store.updateAlert(id, status)
  }

  async getSeries(productId: string): Promise<RealtimeSeries> {
    if (!this.settings().enabled) throw new Error('实时行情未启用。')
    const cached = this.seriesCache.get(productId)
    if (cached && Date.now() - cached.at < 60_000) return cached.series
    const symbol = realtimeSymbols(this.options.getMonitors()).find((item) => item.productId === productId)
    if (!symbol) throw new Error(`未找到 ${productId} 的实时行情映射。`)
    const provider = this.provider()
    if (!provider.fetchSeries) throw new Error('当前行情源不提供分时数据。')
    const series = await provider.fetchSeries(symbol, this.settings())
    this.seriesCache.set(productId, { at: Date.now(), series })
    return series
  }

  async test(input?: RealtimeSettingsPublic & { apiKey?: string }): Promise<RealtimeTestResult> {
    const settings = input ?? this.settings()
    if (settings.provider === 'mock') return new MockRealtimeProvider().test(settings)
    if (settings.provider === 'twelvedata') {
      const key = input?.apiKey?.trim() || this.options.decryptApiKey?.() || ''
      return new TwelveDataProvider(key, settings.baseUrl || 'https://api.twelvedata.com').test(settings)
    }
    return new UnavailableProvider(settings.provider).test()
  }

  start(): void {
    this.stopped = false
    this.status = this.baseStatus()
    this.store.saveStatus(this.status)
    if (!this.settings().enabled) {
      this.status = { ...this.status, state: 'disabled', nextPollAt: undefined }
      this.store.saveStatus(this.status)
      this.emit()
      return
    }
    if (this.settings().provider !== 'mock' && !this.options.decryptApiKey?.()) {
      this.status = {
        ...this.status,
        state: 'error',
        lastError: '未配置实时行情 API Key；请在设置页保存 Key 后重试。'
      }
      this.store.saveStatus(this.status)
      this.emit()
      return
    }
    void this.startPolling()
  }

  private async startPolling(): Promise<void> {
    await this.refreshUsage()
    await this.pollNow()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.abortController?.abort()
    this.abortController = undefined
    this.running = false
    this.status = { ...this.status, nextPollAt: undefined }
    this.store.saveStatus(this.status)
  }

  restart(): void {
    this.stop()
    this.store = new RealtimeStore(this.options.dataDir)
    this.latestQuotes.clear()
    this.history.clear()
    this.alertCooldowns.clear()
    this.seriesCache.clear()
    this.usage = undefined
    this.usageFetchedAt = 0
    const existing = this.store.readLatest()
    if (existing) {
      for (const quote of existing.quotes) {
        this.latestQuotes.set(quote.productId, quote)
        this.history.set(quote.productId, [{ mid: quote.mid, quoteAt: quote.quoteAt }])
      }
    }
    this.snapshot = existing ?? { status: this.baseStatus(), quotes: [], depth: [], trades: [] }
    this.start()
  }

  private async refreshUsage(force = false): Promise<void> {
    if (!force && Date.now() - this.usageFetchedAt < 600_000) return
    const provider = this.provider()
    if (!provider.getUsage) return
    try {
      this.usage = await provider.getUsage()
      this.usageFetchedAt = Date.now()
      this.status = { ...this.status, usage: this.usage }
      this.store.saveStatus(this.status)
      this.emit()
    } catch {
      // Usage is advisory; a failed usage lookup must not stop quotes.
    }
  }

  private effectivePollSeconds(symbolCount: number): number {
    const limit = this.usage?.planLimit
    const rateFloor = limit && limit > 0 ? Math.ceil((symbolCount / limit) * 60) : 0
    const dailyLimit = this.usage?.planDailyLimit
    const dailyUsage = this.usage?.dailyUsage
    const pressure =
      dailyLimit && dailyUsage !== undefined
        ? dailyUsage / dailyLimit >= 0.85
          ? 4
          : dailyUsage / dailyLimit >= 0.65
            ? 2
            : 1
        : 1
    return Math.max(this.settings().pollSeconds, rateFloor) * pressure
  }

  private quotaRemaining(symbolCount: number): number | undefined {
    if (
      this.usage?.planDailyLimit === undefined ||
      this.usage.dailyUsage === undefined
    ) {
      return undefined
    }
    return this.usage.planDailyLimit - this.usage.dailyUsage - symbolCount
  }

  async pollNow(): Promise<RealtimeSnapshot> {
    if (this.running || this.stopped || !this.settings().enabled) return this.getSnapshot()
    const settings = this.settings()
    const provider = this.provider()
    const symbols = realtimeSymbols(this.options.getMonitors())
    await this.refreshUsage()
    const remaining = this.quotaRemaining(symbols.length)
    if (remaining !== undefined && remaining < 0) {
      this.status = {
        ...this.status,
        state: 'error',
        lastError: 'Twelve Data 每日额度不足，已暂停实时轮询；请降低频率、减少币种或升级套餐。',
        quotaMessage: '每日额度不足',
        nextPollAt: undefined
      }
      this.store.saveStatus(this.status)
      this.emit()
      this.scheduleNext(1800)
      return this.getSnapshot()
    }
    this.running = true
    this.abortController = new AbortController()
    try {
      const result = await provider.fetch(symbols, settings, { signal: this.abortController.signal })
      const now = new Date()
      const quotes = result.quotes
      const alerts: AlertRecord[] = []
      const openAlerts = this.store.readAlerts().filter((alert) => alert.status !== 'resolved')
      const windowStart = now.getTime() - settings.windowMinutes * 60_000

      this.store.resolveAlerts((alert) => alert.type === 'realtime-feed-error')
      this.alertCooldowns.delete('system:feed-error')

      for (const quote of quotes) {
        this.latestQuotes.set(quote.productId, quote)
        const entries = this.history.get(quote.productId) ?? []
        const reference = [...entries].reverse().find((entry) => new Date(entry.quoteAt).getTime() >= windowStart)
        const monitor = this.options.getMonitors().find((item) => item.productId === quote.productId && item.enabled)
        if (reference && monitor) {
          const key = `${monitor.id}:change`
          const lastAlertAt = this.alertCooldowns.get(key) ?? 0
          if (now.getTime() - lastAlertAt >= settings.cooldownMinutes * 60_000) {
            const alert = buildRealtimeChangeAlert({ monitor, quote, reference, settings, now })
            if (alert) {
              this.store.resolveAlerts(
                (item) => item.type === 'realtime-change-pct' && item.monitorId === monitor.id
              )
              alerts.push(alert)
              this.alertCooldowns.set(key, now.getTime())
            }
          }
        }
        if (monitor) {
          const staleKey = `${monitor.id}:stale`
          const stale = (quote.delayMs ?? 0) > settings.staleSeconds * 1000
          if (stale) {
            const hasOpenStale = openAlerts.some(
              (item) => item.type === 'realtime-feed-stale' && item.monitorId === monitor.id
            )
            const lastStaleAt = this.alertCooldowns.get(staleKey) ?? 0
            if (!hasOpenStale && now.getTime() - lastStaleAt >= settings.cooldownMinutes * 60_000) {
              alerts.push(
                buildRealtimeFeedAlert({
                  type: 'realtime-feed-stale',
                  provider: settings.provider,
                  message: `${monitor.displayName} 第三方实时报价延迟 ${Math.round((quote.delayMs ?? 0) / 1000)} 秒，超过 ${settings.staleSeconds} 秒阈值。`,
                  monitor,
                  now
                })
              )
              this.alertCooldowns.set(staleKey, now.getTime())
            }
          } else {
            this.store.resolveAlerts(
              (item) => item.type === 'realtime-feed-stale' && item.monitorId === monitor.id
            )
            this.alertCooldowns.delete(staleKey)
          }
        }
        this.history.set(
          quote.productId,
          [...entries, { mid: quote.mid, quoteAt: quote.quoteAt }].slice(-500)
        )
      }

      await this.store.appendQuotes(quotes)
      if (this.usage) {
        this.usage = {
          ...this.usage,
          dailyUsage: (this.usage.dailyUsage ?? 0) + quotes.length
        }
      }
      const remainingAfter = this.quotaRemaining(0)
      const maxDelayMs = Math.max(0, ...quotes.map((quote) => quote.delayMs ?? 0))
      const nextState = provider.demo
        ? 'demo'
        : maxDelayMs > settings.staleSeconds * 1000
          ? 'stale'
          : maxDelayMs > 15_000
            ? 'delayed'
            : 'live'
      this.status = {
        ...this.status,
        enabled: true,
        provider: settings.provider,
        state: nextState,
        lastQuoteAt: quotes.map((quote) => quote.quoteAt).sort().at(-1),
        lastReceivedAt: quotes.map((quote) => quote.receivedAt).sort().at(-1),
        lastSuccessAt: now.toISOString(),
        lastError: undefined,
        quoteCount: quotes.length,
        capabilities: [...provider.capabilities],
        demo: provider.demo,
        usage: this.usage,
        quotaMessage:
          remainingAfter !== undefined && remainingAfter <= 20
            ? `Twelve Data 今日额度剩余 ${Math.max(0, remainingAfter)}，即将自动降频/暂停。`
            : undefined
      }
      this.snapshot = {
        status: this.status,
        quotes,
        depth: result.depth,
        trades: result.trades
      }
      this.store.saveLatest(this.snapshot)
      this.store.saveStatus(this.status)
      if (alerts.length) {
        this.store.upsertAlerts(alerts)
        this.options.onAlerts?.(alerts)
      }
      this.emit()
      this.scheduleNext(this.effectivePollSeconds(symbols.length))
      return this.getSnapshot()
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message =
        settings.provider === 'twelvedata' && /HTTP 401|invalid credential|unauthorized/i.test(rawMessage)
          ? `${rawMessage}。请检查 Twelve Data API Key 是否有效或已被轮换，并在设置中重新保存。`
          : rawMessage
      this.status = {
        ...this.status,
        state: 'error',
        lastError: message,
        nextPollAt: undefined
      }
      this.store.saveStatus(this.status)
      const errorKey = 'system:feed-error'
      const lastErrorAt = this.alertCooldowns.get(errorKey) ?? 0
      if (Date.now() - lastErrorAt >= settings.cooldownMinutes * 60_000) {
        this.alertCooldowns.set(errorKey, Date.now())
        this.store.resolveAlerts((alert) => alert.type === 'realtime-feed-error')
        const alert = buildRealtimeFeedAlert({
          type: 'realtime-feed-error',
          provider: settings.provider,
          message
        })
        this.store.upsertAlerts([alert])
        this.options.onAlerts?.([alert])
      }
      this.emit()
      const quotaLimited = /429|rate limit|credits|额度|limit/i.test(message)
      if (quotaLimited) void this.refreshUsage(true)
      this.scheduleNext(
        quotaLimited ? 900 : Math.max(30, this.effectivePollSeconds(symbols.length) * 2)
      )
      return this.getSnapshot()
    } finally {
      this.running = false
      this.abortController = undefined
    }
  }

  private scheduleNext(delaySeconds: number): void {
    if (this.stopped || !this.settings().enabled) return
    if (this.timer) clearTimeout(this.timer)
    const next = new Date(Date.now() + delaySeconds * 1000).toISOString()
    this.status = { ...this.status, nextPollAt: next }
    this.store.saveStatus(this.status)
    this.timer = setTimeout(() => void this.pollNow(), delaySeconds * 1000)
  }

  private emit(): void {
    this.snapshot = { ...this.snapshot, status: this.status }
    this.options.onUpdate?.(this.getSnapshot())
  }
}
