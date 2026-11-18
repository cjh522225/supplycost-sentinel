import { useQuery } from '@tanstack/react-query'
import type { Api } from '@shared/ipc'
import { DEFAULT_ASIAN_METAL_CATALOG, DEFAULT_FX_CATALOG, DEFAULT_MONITORS, DEFAULT_SETTINGS, DEFAULT_SMM_CATALOG } from '@shared/constants'
import type { AppSettings, Conversation, ConversationMessage, ConversationSummary, DailyReport, DashboardData, FetchLog, MonitorConfig, RealtimeSeries, RealtimeSnapshot, SourceHealthData } from '@shared/types'

const emptyFetchLog: FetchLog = {
  id: 'mock',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  source: 'all',
  monitorIds: [],
  dates: [],
  status: 'skipped',
  recordsFetched: 0,
  recordsValid: 0,
  recordsQuarantined: 0,
  message: '当前为浏览器预览模式，未连接 Electron 主进程'
}

const mockApi = {
  bootstrap: async () => ({
    monitors: DEFAULT_MONITORS,
    settings: DEFAULT_SETTINGS,
    latest: {},
    aggregates: [],
    alerts: [],
    status: {
      running: false,
      lastRun: emptyFetchLog,
      dataDir: 'data',
      currentPeriod: new Date().toISOString().slice(0, 7),
      validRecords: 0,
      quarantinedRecords: 0,
      monitorCount: DEFAULT_MONITORS.length
    },
    dataDir: 'data',
    version: '1.0.0'
  }),
  dashboard: async (): Promise<DashboardData> => ({
    generatedAt: new Date().toISOString(),
    monitors: DEFAULT_MONITORS.map((monitor) => ({
      monitor,
      means: {},
      sparkline: [],
      validation: { status: 'no-data', warnings: ['浏览器预览模式'] }
    })),
    alerts: [],
    quality: { valid: 0, quarantined: 0, lastFetch: emptyFetchLog }
  }),
  history: async (req: { monitorId: string }) => ({
    monitor: DEFAULT_MONITORS.find((m) => m.id === req.monitorId) ?? DEFAULT_MONITORS[0],
    rows: [],
    series: []
  }),
  trace: async () => {
    throw new Error('浏览器预览模式下无计算追溯数据')
  },
  listMonitors: async () => DEFAULT_MONITORS,
  saveMonitor: async (monitor: MonitorConfig) => [monitor],
  deleteMonitor: async () => DEFAULT_MONITORS,
  toggleMonitor: async () => DEFAULT_MONITORS,
  runFetch: async () => ({ log: emptyFetchLog, fetched: 0, valid: 0, quarantined: 0 }),
  runBackfill: async () => ({ logs: [emptyFetchLog], totalFetched: 0, totalValid: 0, totalQuarantined: 0 }),
  fetchStatus: async () => ({
    running: false,
    lastRun: emptyFetchLog,
    dataDir: 'data',
    currentPeriod: new Date().toISOString().slice(0, 7),
    validRecords: 0,
    quarantinedRecords: 0,
    monitorCount: DEFAULT_MONITORS.length
  }),
  manualAdd: async () => {
    throw new Error('浏览器预览模式下不能写入手动数据')
  },
  manualImportCsv: async () => ({ total: 0, imported: 0, valid: 0, quarantined: 0, errors: [] }),
  listAlerts: async () => [],
  updateAlert: async () => [],
  audit: async () => ({
    fetchLogs: [],
    rotationLogs: [],
    validationLogs: [],
    files: [],
    quarantine: [],
    counts: { rawFiles: 0, validatedFiles: 0, aggregateFiles: 0, quarantined: 0, fetchRuns: 0 }
  }),
  files: async () => [],
  quarantine: async () => [],
  approveQuarantine: async () => undefined,
  rejectQuarantine: async () => undefined,
  getSettings: async () => DEFAULT_SETTINGS,
  saveSettings: async (patch: Partial<AppSettings>) => ({ ...DEFAULT_SETTINGS, ...patch }),
  llmTest: async () => ({ ok: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash', message: '浏览器预览模式未连接主进程' }),
  llmChat: async () => ({
    ok: false,
    content: '当前为浏览器预览模式，请通过 Electron 启动应用后使用 AI 助手。',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    fallback: true,
    citations: []
  }),
  llmChatStream: async () => ({
    ok: false,
    content: '当前为浏览器预览模式，请通过 Electron 启动应用后使用流式 AI。',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    fallback: true,
    citations: []
  }),
  cancelLlmChat: async () => undefined,
  listConversations: async (): Promise<ConversationSummary[]> => [],
  loadConversation: async (): Promise<Conversation | undefined> => undefined,
  createConversation: async (): Promise<Conversation> => ({
    id: 'mock-conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  }),
  saveConversation: async (_id: string, messages: ConversationMessage[]): Promise<Conversation> => ({
    id: 'mock-conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages
  }),
  deleteConversation: async (): Promise<ConversationSummary[]> => [],
  realtimeSnapshot: async (): Promise<RealtimeSnapshot> => ({
    status: {
      enabled: false,
      provider: 'mock',
      state: 'disabled',
      pollSeconds: 60,
      quoteCount: 0,
      capabilities: [],
      demo: false
    },
    quotes: [],
    depth: [],
    trades: []
  }),
  realtimeTest: async () => ({
    ok: false,
    provider: 'mock',
    message: '浏览器预览模式未连接实时行情。'
  }),
  realtimePollNow: async (): Promise<RealtimeSnapshot> => ({
    status: {
      enabled: false,
      provider: 'mock',
      state: 'disabled',
      pollSeconds: 60,
      quoteCount: 0,
      capabilities: [],
      demo: false
    },
    quotes: [],
    depth: [],
    trades: []
  }),
  realtimeSeries: async (productId: string): Promise<RealtimeSeries> => ({
    provider: 'mock',
    symbol: `${productId}/CNY`,
    productId,
    interval: '1min',
    points: [],
    fetchedAt: new Date().toISOString(),
    demo: true
  }),
  sourceHealth: async (): Promise<SourceHealthData> => ({
    generatedAt: new Date().toISOString(),
    items: []
  }),
  generateDailyReport: async (): Promise<DailyReport> => ({
    id: 'report-preview',
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    fallback: true,
    content: '浏览器预览模式无法生成日报。',
    citations: []
  }),
  latestDailyReport: async (): Promise<DailyReport | undefined> => undefined,
  listDailyReports: async (): Promise<DailyReport[]> => [],
  acceptanceRun: async (id: string) => ({ id, title: id, passed: false, details: ['浏览器预览模式'], evidence: {}, checkedAt: new Date().toISOString() }),
  openDataFolder: async () => undefined,
  exportData: async () => 'data/exports',
  catalog: async () => ({ fx: DEFAULT_FX_CATALOG, smm: DEFAULT_SMM_CATALOG, asianmetal: DEFAULT_ASIAN_METAL_CATALOG }),
  onProgress: () => () => undefined,
  onDataChanged: () => () => undefined,
  onRealtimeUpdated: () => () => undefined,
  onLlmChunk: () => () => undefined
} as unknown as Api

export const api: Api = (window as unknown as { api?: Api }).api ?? mockApi

export function useBootstrap() {
  return useQuery({ queryKey: ['bootstrap'], queryFn: () => api.bootstrap() })
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() })
}

export function useMonitors() {
  return useQuery({ queryKey: ['monitors'], queryFn: () => api.listMonitors() })
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
}

export function useRealtime() {
  return useQuery({
    queryKey: ['realtime'],
    queryFn: () => api.realtimeSnapshot(),
    refetchInterval: 15_000
  })
}

export function useRealtimeSeries(productId?: string, enabled = false) {
  return useQuery({
    queryKey: ['realtime-series', productId],
    queryFn: () => api.realtimeSeries(productId!),
    enabled: Boolean(productId && enabled),
    staleTime: 30_000
  })
}

export function useSourceHealth() {
  return useQuery({
    queryKey: ['source-health'],
    queryFn: () => api.sourceHealth(),
    refetchInterval: 30_000
  })
}
