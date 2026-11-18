export type SourceId = 'pboc' | 'cfets' | 'smm' | 'asianmetal'

export type MonitorType = 'fx' | 'metal'

export type PeriodType = 'day' | 'month' | 'quarter' | 'half' | 'year'

export type AlertStatus = 'open' | 'acknowledged' | 'resolved'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type LlmProvider = 'opencode-go' | 'openai' | 'deepseek' | 'glm' | 'anthropic' | 'custom'

export type RealtimeProviderId = 'mock' | 'twelvedata' | 'finnhub' | 'oanda' | 'alltick' | 'custom'
export type RealtimeCapability = 'quotes' | 'topOfBook' | 'depth' | 'trades' | 'streaming'

export interface MonitorThresholds {
  high?: number
  low?: number
  changePct?: number
}

export interface MonitorConfig {
  id: string
  type: MonitorType
  source: SourceId
  productId: string
  displayName: string
  unit: string
  precision: number
  enabled: boolean
  color?: string
  thresholds?: MonitorThresholds
  manual?: boolean
  note?: string
}

export interface RawRecord {
  id: string
  source: SourceId
  productId: string
  productName: string
  date: string
  value: string
  low?: string
  high?: string
  unit: string
  currency?: string
  fetchedAt: string
  sourceUrl: string
  contentHash: string
  parserVersion: string
  meta?: Record<string, unknown>
}

export interface ValidationCheck {
  rule: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

export interface ValidationInfo {
  status: 'valid' | 'invalid'
  checkedAt: string
  checks: ValidationCheck[]
  warnings: string[]
  errors: string[]
  crossSource?: {
    source: SourceId
    date: string
    value: string
    diff: string
    tolerance: string
    passed: boolean
  }
}

export interface ValidatedRecord extends RawRecord {
  validation: ValidationInfo
}

export interface QuarantinedRecord extends RawRecord {
  validation: ValidationInfo
}

export interface AggregateRecord {
  monitorId: string
  monitorName: string
  source: SourceId
  productId: string
  unit: string
  periodType: PeriodType
  periodKey: string
  startDate: string
  endDate: string
  mean: string
  sum: string
  count: number
  min?: string
  max?: string
  firstDate?: string
  lastDate?: string
  coverage?: string
  meanBasis: 'available-days'
  coverageBasis: 'weekdays'
  availableDays: number
  expectedWeekdays: number
  partial: boolean
  precision: number
  computedAt: string
  formulaVersion: string
  sourceFiles: string[]
}

export interface AlertRecord {
  id: string
  monitorId: string
  monitorName: string
  type: string
  severity: AlertSeverity
  title: string
  message: string
  date: string
  value?: string
  threshold?: string
  status: AlertStatus
  createdAt: string
  updatedAt?: string
  acknowledgedAt?: string
  resolvedAt?: string
  origin?: 'official' | 'realtime'
  providerId?: RealtimeProviderId
  symbol?: string
  quoteAt?: string
  evidence?: Record<string, unknown>
}

export interface FetchLog {
  id: string
  startedAt: string
  finishedAt: string
  source: SourceId | 'all'
  monitorIds: string[]
  dates: string[]
  status: 'success' | 'partial' | 'failed' | 'skipped'
  recordsFetched: number
  recordsValid: number
  recordsQuarantined: number
  message: string
}

export interface RotationLog {
  id: string
  timestamp: string
  scope: 'raw' | 'validated' | 'quarantine' | 'aggregates' | 'alerts' | 'audit'
  periodKey: string
  path: string
  reason: 'period-change' | 'first-write' | 'manual'
}

export interface ValidationLog {
  id: string
  timestamp: string
  source: SourceId
  productId: string
  date: string
  status: 'valid' | 'invalid'
  rules: string[]
  message: string
}

export interface DataFileInfo {
  path: string
  relativePath: string
  kind: string
  size: number
  modifiedAt: string
  periodKey?: string
  records?: number
}

export interface LlmSettingsPublic {
  enabled: boolean
  provider: LlmProvider
  baseUrl: string
  model: string
  hasApiKey: boolean
  temperature: number
  maxTokens: number
}

export interface LlmSettingsInput extends LlmSettingsPublic {
  apiKey?: string
}

export interface LlmTestInput {
  enabled: boolean
  provider: LlmProvider
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  apiKey?: string
}

export interface RealtimeQuote {
  provider: RealtimeProviderId
  symbol: string
  productId: string
  bid?: string
  ask?: string
  mid: string
  previousMid?: string
  changePct?: string
  marketOpen?: boolean
  quoteAt: string
  receivedAt: string
  delayMs?: number
  sourceUrl?: string
  demo?: boolean
}

export interface RealtimeDepthLevel {
  price: string
  size: string
}

export interface RealtimeDepthSnapshot {
  provider: RealtimeProviderId
  symbol: string
  productId: string
  bids: RealtimeDepthLevel[]
  asks: RealtimeDepthLevel[]
  quoteAt: string
  receivedAt: string
  demo?: boolean
}

export interface RealtimeTradePrint {
  provider: RealtimeProviderId
  symbol: string
  productId: string
  price: string
  size: string
  side?: 'buy' | 'sell'
  quoteAt: string
  receivedAt: string
  demo?: boolean
}

export interface RealtimeSeriesPoint {
  time: string
  close: string
  open?: string
  high?: string
  low?: string
}

export interface RealtimeSeries {
  provider: RealtimeProviderId
  symbol: string
  productId: string
  interval: string
  points: RealtimeSeriesPoint[]
  fetchedAt: string
  demo: boolean
}

export interface RealtimeUsage {
  planCategory?: string
  currentUsage?: number
  planLimit?: number
  dailyUsage?: number
  planDailyLimit?: number
  updatedAt: string
}

export interface RealtimeStatus {
  enabled: boolean
  provider: RealtimeProviderId
  state: 'disabled' | 'demo' | 'live' | 'delayed' | 'stale' | 'error'
  lastQuoteAt?: string
  lastReceivedAt?: string
  lastSuccessAt?: string
  lastError?: string
  nextPollAt?: string
  pollSeconds: number
  quoteCount: number
  capabilities: RealtimeCapability[]
  demo: boolean
  usage?: RealtimeUsage
  quotaMessage?: string
}

export interface RealtimeSnapshot {
  status: RealtimeStatus
  quotes: RealtimeQuote[]
  depth: RealtimeDepthSnapshot[]
  trades: RealtimeTradePrint[]
}

export interface RealtimeSettingsPublic {
  enabled: boolean
  provider: RealtimeProviderId
  baseUrl: string
  hasApiKey: boolean
  pollSeconds: number
  staleSeconds: number
  changePct: number
  windowMinutes: number
  cooldownMinutes: number
  depthEnabled: boolean
  tradesEnabled: boolean
  notify: boolean
}

export interface RealtimeSettingsInput extends RealtimeSettingsPublic {
  apiKey?: string
}

export interface RealtimeTestResult {
  ok: boolean
  provider: RealtimeProviderId
  message: string
  latencyMs?: number
  capabilities?: RealtimeCapability[]
}

export interface ReportSettings {
  enabled: boolean
  autoAfterFetch: boolean
}

export interface AppSettings {
  dataDir: string
  theme: 'light' | 'dark' | 'system'
  schedule: {
    enabled: boolean
    times: string[]
    catchUp: boolean
  }
  precision: {
    fx: number
    metal: number
  }
  validation: {
    fxChangePct: number
    metalChangePct: number
    fxCrossTolerance: number
    metalCrossTolerance: number
    minMetal: number
    maxMetal: number
    minFx: number
    maxFx: number
    strictFxCrossSource: boolean
    strictMetalCrossSource: boolean
  }
  llm: LlmSettingsPublic & {
    apiKeyEncrypted?: string
  }
  realtime: RealtimeSettingsPublic & {
    apiKeyEncrypted?: string
  }
  reports: ReportSettings
  backfill: {
    startDate: string
    concurrency: number
  }
  asianMetalMode: 'manual' | 'csv'
}

export interface LatestValue {
  date: string
  value: string
  unit: string
  source: SourceId
  fetchedAt?: string
  validationStatus?: 'valid' | 'warning'
}

export interface MonitorMeans {
  month?: AggregateRecord
  quarter?: AggregateRecord
  half?: AggregateRecord
  year?: AggregateRecord
}

export interface SparkPoint {
  date: string
  value: string
}

export interface MonitorView {
  monitor: MonitorConfig
  latest?: LatestValue
  previous?: LatestValue
  changePct?: string
  means: MonitorMeans
  sparkline: SparkPoint[]
  availableFrom?: string
  validation: {
    status: 'valid' | 'warning' | 'no-data'
    warnings: string[]
  }
}

export interface BootstrapData {
  monitors: MonitorConfig[]
  settings: AppSettings
  latest: Record<string, LatestValue>
  aggregates: AggregateRecord[]
  alerts: AlertRecord[]
  status: FetchStatus
  dataDir: string
  version: string
}

export interface DashboardData {
  generatedAt: string
  monitors: MonitorView[]
  alerts: AlertRecord[]
  quality: {
    valid: number
    quarantined: number
    lastFetch?: FetchLog
    lastValidation?: ValidationLog
  }
  cashCostIndex?: {
    value: string
    changePct: string
    note: string
  }
}

export interface HistoryRequest {
  monitorId: string
  periodType: PeriodType
  start?: string
  end?: string
  limit?: number
}

export interface HistoryResponse {
  monitor: MonitorConfig
  rows: AggregateRecord[]
  series: SparkPoint[]
}

export interface TraceRequest {
  monitorId: string
  periodType: PeriodType
  periodKey: string
}

export interface TraceResponse {
  monitor: MonitorConfig
  aggregate: AggregateRecord
  daily: ValidatedRecord[]
  formula: string
  files: string[]
}

export interface FetchRunRequest {
  monitorIds?: string[]
  date?: string
}

export interface FetchRunResult {
  log: FetchLog
  fetched: number
  valid: number
  quarantined: number
}

export interface BackfillOptions {
  startDate?: string
  endDate?: string
  sources?: SourceId[]
  monitorIds?: string[]
}

export interface BackfillRunResult {
  logs: FetchLog[]
  totalFetched: number
  totalValid: number
  totalQuarantined: number
}

export interface FetchStatus {
  running: boolean
  task?: string
  lastRun?: FetchLog
  nextRun?: string
  dataDir: string
  currentPeriod: string
  validRecords: number
  quarantinedRecords: number
  monitorCount: number
}

export interface SourceHealthItem {
  id: 'pboc' | 'cfets' | 'smm' | 'asianmetal' | 'twelvedata'
  label: string
  status: 'ok' | 'warning' | 'error' | 'idle' | 'disabled'
  lastSuccessAt?: string
  lastAttemptAt?: string
  validRecords?: number
  quarantinedRecords?: number
  latencyMs?: number
  delayMs?: number
  message?: string
  demo?: boolean
}

export interface SourceHealthData {
  generatedAt: string
  items: SourceHealthItem[]
}

export interface ManualRecordInput {
  date: string
  productId: string
  productName: string
  low?: string
  high?: string
  average?: string
  unit: string
  sourceUrl?: string
  note?: string
}

export interface ManualAddResult {
  record: ValidatedRecord | QuarantinedRecord
  valid: boolean
  message: string
}

export interface CsvImportResult {
  total: number
  imported: number
  valid: number
  quarantined: number
  errors: { row: number; message: string }[]
}

export interface AlertFilter {
  status?: AlertStatus
  severity?: AlertSeverity
  monitorId?: string
  origin?: 'official' | 'realtime'
  limit?: number
}

export interface AuditData {
  dataDir: string
  fetchLogs: FetchLog[]
  rotationLogs: RotationLog[]
  validationLogs: ValidationLog[]
  files: DataFileInfo[]
  quarantine: QuarantinedRecord[]
  counts: {
    rawFiles: number
    validatedFiles: number
    aggregateFiles: number
    quarantined: number
    fetchRuns: number
  }
}

export interface LlmTestResult {
  ok: boolean
  provider: LlmProvider
  model: string
  message: string
  latencyMs?: number
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmChatRequest {
  messages: LlmChatMessage[]
  context?: Record<string, unknown>
  mode?: 'chat' | 'daily-report' | 'alert-explain'
}

export interface LlmCitation {
  label: string
  file?: string
  recordId?: string
  date?: string
}

export interface LlmChatResponse {
  ok: boolean
  content: string
  provider: LlmProvider
  model: string
  fallback: boolean
  citations: LlmCitation[]
  error?: string
}

export interface DailyReport {
  id: string
  date: string
  generatedAt: string
  provider: LlmProvider
  model: string
  fallback: boolean
  content: string
  citations: LlmCitation[]
  error?: string
}

export interface LlmStreamChunk {
  requestId: string
  chunk: string
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: string
  fallback?: boolean
  citations?: LlmCitation[]
  error?: string
}

export interface Conversation {
  id: string
  createdAt: string
  updatedAt: string
  messages: ConversationMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type AcceptanceId =
  | 'history-means'
  | 'local-files'
  | 'rotation'
  | 'cross-year'
  | 'dynamic-config'
  | 'data-accuracy'

export interface AcceptanceCheckResult {
  id: AcceptanceId
  title: string
  passed: boolean
  details: string[]
  evidence: Record<string, unknown>
  checkedAt: string
}

export interface ProgressEvent {
  task: 'fetch' | 'backfill' | 'aggregate' | 'export' | 'acceptance'
  phase: string
  current: number
  total: number
  message: string
}

export interface CatalogItem {
  id: string
  name: string
  source: SourceId
  type: MonitorType
  unit: string
  precision: number
  description?: string
}
