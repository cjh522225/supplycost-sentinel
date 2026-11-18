import type {
  MonitorConfig,
  RealtimeCapability,
  RealtimeDepthSnapshot,
  RealtimeProviderId,
  RealtimeQuote,
  RealtimeSeries,
  RealtimeSettingsPublic,
  RealtimeTestResult,
  RealtimeTradePrint,
  RealtimeUsage
} from '../../shared/types'

export interface RealtimeSymbol {
  productId: string
  symbol: string
  displayName: string
  precision: number
  unit: string
}

export interface RealtimeFetchContext {
  signal?: AbortSignal
}

export interface RealtimeFetchResult {
  quotes: RealtimeQuote[]
  depth: RealtimeDepthSnapshot[]
  trades: RealtimeTradePrint[]
}

export interface RealtimeProvider {
  readonly id: RealtimeProviderId
  readonly label: string
  readonly capabilities: RealtimeCapability[]
  readonly requiresKey: boolean
  readonly demo: boolean
  fetch(
    symbols: RealtimeSymbol[],
    settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeFetchResult>
  fetchSeries?(
    symbol: RealtimeSymbol,
    settings: RealtimeSettingsPublic,
    context?: RealtimeFetchContext
  ): Promise<RealtimeSeries>
  getUsage?(context?: RealtimeFetchContext): Promise<RealtimeUsage>
  test(settings: RealtimeSettingsPublic, context?: RealtimeFetchContext): Promise<RealtimeTestResult>
}

export function realtimeSymbols(monitors: MonitorConfig[]): RealtimeSymbol[] {
  return monitors
    .filter((monitor) => monitor.enabled && monitor.type === 'fx')
    .map((monitor) => ({
      productId: monitor.productId,
      symbol: `${monitor.productId}/CNY`,
      displayName: monitor.displayName,
      precision: monitor.precision,
      unit: monitor.unit
    }))
}
