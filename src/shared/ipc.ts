import type {
  AcceptanceCheckResult,
  AcceptanceId,
  AlertFilter,
  AlertRecord,
  AlertStatus,
  AppSettings,
  AuditData,
  BackfillOptions,
  BackfillRunResult,
  BootstrapData,
  CatalogItem,
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CsvImportResult,
  DailyReport,
  DashboardData,
  DataFileInfo,
  FetchRunRequest,
  FetchRunResult,
  FetchStatus,
  HistoryRequest,
  HistoryResponse,
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamChunk,
  LlmTestInput,
  LlmTestResult,
  ManualAddResult,
  ManualRecordInput,
  MonitorConfig,
  ProgressEvent,
  QuarantinedRecord,
  RealtimeSeries,
  RealtimeSettingsInput,
  RealtimeSnapshot,
  RealtimeTestResult,
  SourceHealthData,
  TraceRequest,
  TraceResponse
} from './types'

export const IPC = {
  bootstrap: 'api:bootstrap',
  dashboard: 'api:dashboard',
  history: 'api:history',
  trace: 'api:trace',
  listMonitors: 'api:list-monitors',
  saveMonitor: 'api:save-monitor',
  deleteMonitor: 'api:delete-monitor',
  toggleMonitor: 'api:toggle-monitor',
  runFetch: 'api:run-fetch',
  runBackfill: 'api:run-backfill',
  fetchStatus: 'api:fetch-status',
  manualAdd: 'api:manual-add',
  manualImportCsv: 'api:manual-import-csv',
  listAlerts: 'api:list-alerts',
  updateAlert: 'api:update-alert',
  audit: 'api:audit',
  files: 'api:files',
  quarantine: 'api:quarantine',
  approveQuarantine: 'api:approve-quarantine',
  rejectQuarantine: 'api:reject-quarantine',
  getSettings: 'api:get-settings',
  saveSettings: 'api:save-settings',
  llmTest: 'api:llm-test',
  llmChat: 'api:llm-chat',
  llmChatStream: 'api:llm-chat-stream',
  cancelLlmChat: 'api:cancel-llm-chat',
  llmChunk: 'event:llm-chunk',
  listConversations: 'api:list-conversations',
  loadConversation: 'api:load-conversation',
  createConversation: 'api:create-conversation',
  saveConversation: 'api:save-conversation',
  deleteConversation: 'api:delete-conversation',
  realtimeSnapshot: 'api:realtime-snapshot',
  realtimeTest: 'api:realtime-test',
  realtimePollNow: 'api:realtime-poll-now',
  realtimeSeries: 'api:realtime-series',
  realtimeUpdated: 'event:realtime-updated',
  sourceHealth: 'api:source-health',
  generateDailyReport: 'api:generate-daily-report',
  latestDailyReport: 'api:latest-daily-report',
  listDailyReports: 'api:list-daily-reports',
  acceptanceRun: 'api:acceptance-run',
  openDataFolder: 'api:open-data-folder',
  exportData: 'api:export-data',
  catalog: 'api:catalog',
  progress: 'event:progress',
  dataChanged: 'event:data-changed'
} as const

export interface Api {
  bootstrap(): Promise<BootstrapData>
  dashboard(): Promise<DashboardData>
  history(req: HistoryRequest): Promise<HistoryResponse>
  trace(req: TraceRequest): Promise<TraceResponse>
  listMonitors(): Promise<MonitorConfig[]>
  saveMonitor(monitor: MonitorConfig): Promise<MonitorConfig[]>
  deleteMonitor(id: string): Promise<MonitorConfig[]>
  toggleMonitor(id: string, enabled: boolean): Promise<MonitorConfig[]>
  runFetch(req?: FetchRunRequest): Promise<FetchRunResult>
  runBackfill(opts: BackfillOptions): Promise<BackfillRunResult>
  fetchStatus(): Promise<FetchStatus>
  manualAdd(input: ManualRecordInput): Promise<ManualAddResult>
  manualImportCsv(csv: string): Promise<CsvImportResult>
  listAlerts(filter?: AlertFilter): Promise<AlertRecord[]>
  updateAlert(id: string, status: AlertStatus): Promise<AlertRecord[]>
  audit(): Promise<AuditData>
  files(): Promise<DataFileInfo[]>
  quarantine(): Promise<QuarantinedRecord[]>
  approveQuarantine(id: string, reason: string): Promise<void>
  rejectQuarantine(id: string, reason: string): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  llmTest(input?: LlmTestInput): Promise<LlmTestResult>
  llmChat(req: LlmChatRequest): Promise<LlmChatResponse>
  llmChatStream(requestId: string, req: LlmChatRequest): Promise<LlmChatResponse>
  cancelLlmChat(requestId: string): Promise<void>
  listConversations(): Promise<ConversationSummary[]>
  loadConversation(id?: string): Promise<Conversation | undefined>
  createConversation(): Promise<Conversation>
  saveConversation(id: string, messages: ConversationMessage[]): Promise<Conversation>
  deleteConversation(id: string): Promise<ConversationSummary[]>
  realtimeSnapshot(): Promise<RealtimeSnapshot>
  realtimeTest(input?: RealtimeSettingsInput): Promise<RealtimeTestResult>
  realtimePollNow(): Promise<RealtimeSnapshot>
  realtimeSeries(productId: string): Promise<RealtimeSeries>
  sourceHealth(): Promise<SourceHealthData>
  generateDailyReport(force?: boolean): Promise<DailyReport>
  latestDailyReport(): Promise<DailyReport | undefined>
  listDailyReports(limit?: number): Promise<DailyReport[]>
  acceptanceRun(id: AcceptanceId): Promise<AcceptanceCheckResult>
  openDataFolder(): Promise<void>
  exportData(kind: string): Promise<string>
  catalog(): Promise<{ fx: CatalogItem[]; smm: CatalogItem[]; asianmetal: CatalogItem[] }>
  onProgress(cb: (event: ProgressEvent) => void): () => void
  onDataChanged(cb: () => void): () => void
  onRealtimeUpdated(cb: (snapshot: RealtimeSnapshot) => void): () => void
  onLlmChunk(cb: (event: LlmStreamChunk) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
