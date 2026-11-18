import Decimal from 'decimal.js'
import type {
  AlertRecord,
  MonitorConfig,
  RealtimeProviderId,
  RealtimeQuote,
  RealtimeSettingsPublic
} from '../../shared/types'

export interface RealtimeChangeInput {
  monitor: MonitorConfig
  quote: RealtimeQuote
  reference?: { mid: string; quoteAt: string }
  settings: RealtimeSettingsPublic
  now?: Date
}

export function buildRealtimeChangeAlert(input: RealtimeChangeInput): AlertRecord | undefined {
  const { monitor, quote, reference, settings } = input
  if (!reference) return undefined
  const current = new Decimal(quote.mid)
  const previous = new Decimal(reference.mid)
  if (previous.lte(0)) return undefined
  const pct = current.minus(previous).div(previous).mul(100)
  if (pct.abs().lt(settings.changePct)) return undefined

  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const date = quote.quoteAt.slice(0, 10)
  return {
    id: `rt:${monitor.id}:change:${now.getTime()}`,
    monitorId: monitor.id,
    monitorName: monitor.displayName,
    type: 'realtime-change-pct',
    severity: 'warning',
    title: `${monitor.displayName} 实时波动 ${pct.toFixed(2)}%`,
    message: `第三方实时参考价在 ${settings.windowMinutes} 分钟内变动 ${pct.toFixed(2)}%，超过阈值 ${settings.changePct}%。`,
    date,
    value: pct.toFixed(4),
    threshold: String(settings.changePct),
    status: 'open',
    createdAt,
    updatedAt: createdAt,
    origin: 'realtime',
    providerId: quote.provider,
    symbol: quote.symbol,
    quoteAt: quote.quoteAt,
    evidence: {
      provider: quote.provider,
      symbol: quote.symbol,
      mid: quote.mid,
      referenceMid: reference.mid,
      referenceAt: reference.quoteAt,
      quoteAt: quote.quoteAt,
      windowMinutes: settings.windowMinutes,
      demo: Boolean(quote.demo)
    }
  }
}

export function buildRealtimeFeedAlert(input: {
  type: 'realtime-feed-stale' | 'realtime-feed-error'
  provider: RealtimeProviderId
  message: string
  monitor?: MonitorConfig
  now?: Date
}): AlertRecord {
  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const date = createdAt.slice(0, 10)
  return {
    id: `rt:${input.monitor?.id ?? 'system'}:${input.type}:${now.getTime()}`,
    monitorId: input.monitor?.id ?? 'system',
    monitorName: input.monitor?.displayName ?? '实时行情',
    type: input.type,
    severity: input.type === 'realtime-feed-error' ? 'critical' : 'warning',
    title: input.type === 'realtime-feed-stale' ? '实时行情已过期' : '实时行情请求失败',
    message: input.message,
    date,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
    origin: 'realtime',
    providerId: input.provider,
    evidence: { provider: input.provider, message: input.message }
  }
}
