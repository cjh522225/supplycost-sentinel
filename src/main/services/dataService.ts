import { join } from 'node:path'
import { Notification, safeStorage, shell } from 'electron'
import Decimal from 'decimal.js'
import { addDays, format, parseISO, subDays } from 'date-fns'
import type {
  AcceptanceCheckResult,
  AcceptanceId,
  AggregateRecord,
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
  CsvImportResult,
  DailyReport,
  DashboardData,
  DataFileInfo,
  FetchLog,
  FetchRunRequest,
  FetchRunResult,
  FetchStatus,
  HistoryRequest,
  HistoryResponse,
  LatestValue,
  LlmChatRequest,
  LlmChatResponse,
  LlmTestInput,
  LlmTestResult,
  ManualAddResult,
  RealtimeSeries,
  RealtimeSettingsInput,
  RealtimeSnapshot,
  RealtimeTestResult,
  SourceHealthData,
  SourceHealthItem,
  ManualRecordInput,
  MonitorConfig,
  MonitorMeans,
  MonitorView,
  ProgressEvent,
  QuarantinedRecord,
  RawRecord,
  SourceId,
  TraceRequest,
  TraceResponse,
  ValidatedRecord
} from '../../shared/types'
import {
  APP_VERSION,
  DEFAULT_ASIAN_METAL_CATALOG,
  DEFAULT_FX_CATALOG,
  DEFAULT_MONITORS,
  DEFAULT_SETTINGS,
  DEFAULT_SMM_CATALOG
} from '../../shared/constants'
import { periodKey, todayKey } from '../../shared/periods'
import { monitorSchema, settingsSchema } from '../../shared/schema'
import { FileRepository } from '../../core/storage/repository'
import { exportsPath, resolveDataDir } from '../../core/storage/paths'
import { clearJsonCache, listFilesRecursive, readJsonFile, writeCsvAtomic } from '../../core/storage/fileStore'
import { adapters } from '../../core/adapters'
import { parseManualCsv } from '../../core/adapters/manual'
import { IngestService } from '../../core/services/ingest'
import { latestFromRecord, generateAlerts, qualityAlerts } from '../../core/alerts/engine'
import { LlmService } from './llm'
import { RealtimeService } from '../../core/realtime/service'
import { ReportStore } from '../../core/reports/store'
import { ConversationStore } from '../../core/conversations/store'

export interface DataServiceOptions {
  appRoot: string
  configDir: string
  version?: string
  onProgress?: (event: ProgressEvent) => void
  onDataChanged?: () => void
  onRealtime?: (snapshot: RealtimeSnapshot) => void
  onRealtimeAlerts?: (alerts: AlertRecord[]) => void
  onLlmChunk?: (requestId: string, chunk: string) => void
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(patch)) return (patch ?? base) as T
  if (base && patch && typeof base === 'object' && typeof patch === 'object') {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      const current = result[key]
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        current &&
        typeof current === 'object' &&
        !Array.isArray(current)
      ) {
        result[key] = deepMerge(current, value as Record<string, unknown>)
      } else if (value !== undefined) {
        result[key] = value
      }
    }
    return result as T
  }
  return (patch ?? base) as T
}

function publicSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    llm: {
      ...settings.llm,
      hasApiKey: Boolean(settings.llm.apiKeyEncrypted),
      apiKeyEncrypted: undefined
    },
    realtime: {
      ...settings.realtime,
      hasApiKey: Boolean(settings.realtime.apiKeyEncrypted),
      apiKeyEncrypted: undefined
    }
  }
}

function changePct(current: string, previous: string): string | undefined {
  try {
    const c = new Decimal(current)
    const p = new Decimal(previous)
    if (p.eq(0)) return undefined
    return c.minus(p).div(p).mul(100).toFixed(4)
  } catch {
    return undefined
  }
}

function latestAggregate(
  aggregates: AggregateRecord[],
  monitorId: string,
  productId: string,
  periodType: string
): AggregateRecord | undefined {
  return aggregates
    .filter(
      (a) =>
        a.monitorId === monitorId &&
        a.productId === productId &&
        a.periodType === periodType
    )
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .at(-1)
}

function nextScheduledTime(times: string[], now: Date): string | undefined {
  if (!times.length) return undefined
  const today = format(now, 'yyyy-MM-dd')
  const future = times
    .map((time) => `${today}T${time}:00`)
    .find((candidate) => new Date(candidate).getTime() > now.getTime())
  if (future) return future
  return `${format(addDays(now, 1), 'yyyy-MM-dd')}T${times[0]}:00`
}

export class DataService {
  private settings: AppSettings
  private monitors: MonitorConfig[]
  private repository: FileRepository
  private ingest: IngestService
  private llm: LlmService
  private realtime: RealtimeService
  private reports: ReportStore
  private conversations: ConversationStore
  private readonly appRoot: string
  private readonly configDir: string
  private readonly version: string
  private readonly onProgress?: (event: ProgressEvent) => void
  private readonly onDataChanged?: () => void
  private readonly onRealtime?: (snapshot: RealtimeSnapshot) => void
  private readonly onRealtimeAlerts?: (alerts: AlertRecord[]) => void
  private readonly onLlmChunk?: (requestId: string, chunk: string) => void
  private running = false
  private currentTask?: string
  private abortController?: AbortController
  private llmStreams = new Map<string, AbortController>()
  private ephemeralApiKey?: string
  private ephemeralRealtimeApiKey?: string

  private constructor(options: DataServiceOptions) {
    this.appRoot = options.appRoot
    this.configDir = options.configDir
    this.version = options.version ?? APP_VERSION
    this.onProgress = options.onProgress
    this.onDataChanged = options.onDataChanged
    this.onRealtime = options.onRealtime
    this.onRealtimeAlerts = options.onRealtimeAlerts
    this.onLlmChunk = options.onLlmChunk
    this.settings = this.loadSettings()
    this.monitors = this.loadMonitors()
    this.repository = new FileRepository(resolveDataDir(this.settings.dataDir, this.appRoot), this.configDir)
    this.ingest = new IngestService(this.repository, this.settings)
    this.llm = new LlmService({
      getSettings: () => this.settings,
      decryptApiKey: () => this.decryptApiKey()
    })
    this.realtime = this.createRealtime()
    this.reports = new ReportStore(this.repository.dataDir)
    this.conversations = new ConversationStore(this.repository.dataDir)
  }

  private createRealtime(): RealtimeService {
    return new RealtimeService({
      dataDir: this.repository.dataDir,
      getSettings: () => this.settings,
      getMonitors: () => this.monitors,
      decryptApiKey: () => this.decryptRealtimeApiKey(),
      onUpdate: (snapshot) => this.onRealtime?.(snapshot),
      onAlerts: (alerts) => {
        this.onRealtimeAlerts?.(alerts)
        this.emitChanged()
      }
    })
  }

  static async create(options: DataServiceOptions): Promise<DataService> {
    const service = new DataService(options)
    if (service.monitors.length === 0) {
      service.monitors = [...DEFAULT_MONITORS]
      service.repository.writeConfig('monitors.json', service.monitors)
    }
    await service.ensureCurrentPeriodFiles()
    await service.ensureInitialFetchLog()
    await service.refreshAlerts(service.monitors.filter((monitor) => monitor.enabled))
    service.realtime.start()
    return service
  }

  private loadSettings(): AppSettings {
    const saved = readJsonFile<Partial<AppSettings>>(join(this.configDir, 'settings.json'), {})
    const merged = deepMerge(DEFAULT_SETTINGS, saved)
    const parsed = settingsSchema.safeParse(merged)
    if (!parsed.success) return structuredClone(DEFAULT_SETTINGS)
    return parsed.data as AppSettings
  }

  private loadMonitors(): MonitorConfig[] {
    const saved = readJsonFile<MonitorConfig[]>(join(this.configDir, 'monitors.json'), [])
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.filter((m) => monitorSchema.safeParse(m).success)
    }
    return [...DEFAULT_MONITORS]
  }

  private envApiKey(): string | undefined {
    const envByProvider: Record<string, string> = {
      'opencode-go': 'OPENCODE_GO_API_KEY',
      openai: 'OPENAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      glm: 'GLM_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY'
    }
    const name = envByProvider[this.settings.llm.provider]
    return name ? process.env[name] : undefined
  }

  private decryptApiKey(): string | undefined {
    if (this.ephemeralApiKey) return this.ephemeralApiKey
    const envKey = this.envApiKey()
    if (envKey) return envKey
    const encrypted = this.settings.llm.apiKeyEncrypted
    if (!encrypted) return undefined
    try {
      if (!safeStorage.isEncryptionAvailable()) return undefined
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return undefined
    }
  }

  private decryptRealtimeApiKey(): string | undefined {
    if (this.ephemeralRealtimeApiKey) return this.ephemeralRealtimeApiKey
    const encrypted = this.settings.realtime.apiKeyEncrypted
    if (!encrypted) return undefined
    try {
      if (!safeStorage.isEncryptionAvailable()) return undefined
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return undefined
    }
  }

  private emitProgress(event: ProgressEvent): void {
    this.onProgress?.(event)
  }

  private emitChanged(): void {
    this.onDataChanged?.()
  }

  getDataDir(): string {
    return this.repository.dataDir
  }

  getSettingsPublic(): AppSettings {
    const result = publicSettings(this.settings)
    if (this.envApiKey()) result.llm.hasApiKey = true
    return result
  }

  getMonitors(): MonitorConfig[] {
    return [...this.monitors]
  }

  async ensureCurrentPeriodFiles(): Promise<string[]> {
    return this.repository.ensurePeriod(todayKey())
  }

  private async latestRecords(monitor: MonitorConfig): Promise<{
    latest?: ValidatedRecord
    previous?: ValidatedRecord
    records: ValidatedRecord[]
    files: string[]
  }> {
    const range = await this.repository.readValidatedRange(monitor.source, monitor.productId, '2000-01-01', '9999-12-31')
    const records = range.records.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    return { latest: records.at(-1), previous: records.at(-2), records, files: range.files }
  }

  private async ensureInitialFetchLog(): Promise<void> {
    const audit = await this.repository.readAudit()
    if (audit.fetchLogs.length) return
    const all = await this.repository.readAllValidated()
    if (!all.records.length) return
    const latest = all.records.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0]
    await this.repository.appendFetchLog({
      id: `fetch-initial-${Date.now()}`,
      startedAt: latest.fetchedAt,
      finishedAt: latest.fetchedAt,
      source: 'all',
      monitorIds: this.monitors.map((monitor) => monitor.id),
      dates: [latest.date],
      status: 'success',
      recordsFetched: all.records.length,
      recordsValid: all.records.length,
      recordsQuarantined: 0,
      message: '历史数据回填/导入（启动时补记）'
    })
  }

  async bootstrap(): Promise<BootstrapData> {
    const alerts = await this.listAlerts({ limit: 20 })
    return {
      monitors: this.monitors,
      settings: this.getSettingsPublic(),
      latest: {},
      aggregates: [],
      alerts: alerts.filter((a) => a.status !== 'resolved').slice(0, 20),
      status: await this.fetchStatus(),
      dataDir: this.repository.dataDir,
      version: this.version
    }
  }

  async dashboard(): Promise<DashboardData> {
    const aggregates = await this.repository.readAggregates()
    const monitors: MonitorView[] = []
    for (const monitor of this.monitors.filter((m) => m.enabled)) {
      const { latest, previous, records } = await this.latestRecords(monitor)
      const means: MonitorMeans = {
        month: latestAggregate(aggregates, monitor.id, monitor.productId, 'month'),
        quarter: latestAggregate(aggregates, monitor.id, monitor.productId, 'quarter'),
        half: latestAggregate(aggregates, monitor.id, monitor.productId, 'half'),
        year: latestAggregate(aggregates, monitor.id, monitor.productId, 'year')
      }
      monitors.push({
        monitor,
        latest: latestFromRecord(latest),
        previous: latestFromRecord(previous),
        changePct: latest && previous ? changePct(latest.value, previous.value) : undefined,
        means,
        sparkline: records.slice(-30).map((record) => ({ date: record.date, value: record.value })),
        availableFrom: records[0]?.date,
        validation: {
          status: !latest ? 'no-data' : latest.validation.warnings.length ? 'warning' : 'valid',
          warnings: latest?.validation.warnings ?? []
        }
      })
    }
    const audit = await this.repository.readAudit()
    const status = await this.fetchStatus()
    return {
      generatedAt: new Date().toISOString(),
      monitors,
      alerts: (await this.listAlerts({ limit: 20 }))
        .filter((a) => a.status !== 'resolved')
        .slice(0, 12),
      quality: {
        valid: await this.repository.countValidated(),
        quarantined: await this.repository.countQuarantined(),
        lastFetch: status.lastRun,
        lastValidation: audit.validationLogs[0]
      }
    }
  }

  async history(req: HistoryRequest): Promise<HistoryResponse> {
    const monitor = this.monitors.find((m) => m.id === req.monitorId)
    if (!monitor) throw new Error('监测标的不存在')
    const rows = (
      await this.repository.readAggregates({
        monitorId: monitor.id,
        productId: monitor.productId,
        periodType: req.periodType,
        start: req.start,
        end: req.end
      })
    )
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
      .slice(0, req.limit ?? 200)
    const range = await this.repository.readValidatedRange(
      monitor.source,
      monitor.productId,
      req.start ?? format(subDays(new Date(), 90), 'yyyy-MM-dd'),
      req.end ?? todayKey()
    )
    return {
      monitor,
      rows,
      series: range.records
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((record) => ({ date: record.date, value: record.value }))
    }
  }

  async trace(req: TraceRequest): Promise<TraceResponse> {
    const monitor = this.monitors.find((m) => m.id === req.monitorId)
    if (!monitor) throw new Error('监测标的不存在')
    const aggregates = await this.repository.readAggregates({
      monitorId: monitor.id,
      productId: monitor.productId,
      periodType: req.periodType
    })
    const aggregate = aggregates.find((a) => a.periodKey === req.periodKey)
    if (!aggregate) throw new Error('未找到该周期的均值记录')
    const range = await this.repository.readValidatedRange(monitor.source, monitor.productId, aggregate.startDate, aggregate.endDate)
    return {
      monitor,
      aggregate,
      daily: range.records.sort((a, b) => a.date.localeCompare(b.date)),
      formula:
        '每日加工均值 = 当日全部有效报价的算术平均；月/季/半年/年均值 = 期间每日加工均值的等权算术平均（不是均值的均值）；计算全程使用 Decimal，展示时才按精度四舍五入。',
      files: [...new Set([...aggregate.sourceFiles, ...range.files])]
    }
  }

  async saveMonitor(monitor: MonitorConfig): Promise<MonitorConfig[]> {
    const parsed = monitorSchema.safeParse(monitor)
    if (!parsed.success) throw new Error(`监测标的配置无效：${parsed.error.issues.map((i) => i.message).join('; ')}`)
    const next = parsed.data as MonitorConfig
    const index = this.monitors.findIndex((m) => m.id === next.id)
    const previous = index >= 0 ? this.monitors[index] : undefined
    if (index >= 0) this.monitors[index] = next
    else this.monitors.push(next)
    this.repository.writeConfig('monitors.json', this.monitors)
    if (next.enabled) {
      this.emitProgress({ task: 'fetch', phase: 'config', current: 0, total: 1, message: `正在为 ${next.displayName} 准备历史数据` })
      if (next.source === 'smm' && (!previous || previous.productId !== next.productId)) {
        const records = await adapters.smm.fetchRange(this.settings.backfill.startDate, todayKey(), [next], { settings: this.settings })
        await this.repository.appendRaw(records)
      }
      await this.ingest.rebuildMonitor(next, { onProgress: (event) => this.emitProgress(event) })
    }
    this.emitChanged()
    return this.getMonitors()
  }

  async deleteMonitor(id: string): Promise<MonitorConfig[]> {
    this.monitors = this.monitors.filter((m) => m.id !== id)
    this.repository.writeConfig('monitors.json', this.monitors)
    this.emitChanged()
    return this.getMonitors()
  }

  async toggleMonitor(id: string, enabled: boolean): Promise<MonitorConfig[]> {
    const monitor = this.monitors.find((m) => m.id === id)
    if (!monitor) throw new Error('监测标的不存在')
    monitor.enabled = enabled
    this.repository.writeConfig('monitors.json', this.monitors)
    this.emitChanged()
    return this.getMonitors()
  }

  private buildFetchLog(params: {
    startedAt: string
    source: SourceId | 'all'
    monitorIds: string[]
    dates: string[]
    status: FetchLog['status']
    fetched: number
    valid: number
    invalid: number
    message: string
  }): FetchLog {
    return {
      id: `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: params.startedAt,
      finishedAt: new Date().toISOString(),
      source: params.source,
      monitorIds: params.monitorIds,
      dates: params.dates,
      status: params.status,
      recordsFetched: params.fetched,
      recordsValid: params.valid,
      recordsQuarantined: params.invalid,
      message: params.message
    }
  }

  async runFetch(req: FetchRunRequest = {}): Promise<FetchRunResult> {
    if (this.running) throw new Error('已有任务正在执行，请稍后再试')
    this.running = true
    this.currentTask = 'daily-fetch'
    this.abortController = new AbortController()
    const startedAt = new Date().toISOString()
    const end = req.date ?? todayKey()
    const start = req.date ?? format(subDays(parseISO(end), 10), 'yyyy-MM-dd')
    const monitors = req.monitorIds?.length
      ? this.monitors.filter((m) => req.monitorIds!.includes(m.id) && m.enabled)
      : this.monitors.filter((m) => m.enabled)
    const ctx = { settings: this.settings, signal: this.abortController.signal }
    let fetched = 0
    let valid = 0
    let invalid = 0
    const errors: string[] = []
    try {
      this.emitProgress({ task: 'fetch', phase: 'fetch', current: 0, total: 3, message: '抓取 PBOC / SMM / CFETS' })
      const [pboc, smm, cfets] = await Promise.allSettled([
        adapters.pboc.fetchRange(start, end, monitors, ctx),
        adapters.smm.fetchRange(start, end, monitors, ctx),
        adapters.cfets.fetchRange(start, end, monitors, ctx)
      ])
      const pbocRecords = pboc.status === 'fulfilled' ? pboc.value : []
      const smmRecords = smm.status === 'fulfilled' ? smm.value : []
      const cfetsRecords = cfets.status === 'fulfilled' ? cfets.value : []
      if (pboc.status === 'rejected') errors.push(`PBOC: ${String(pboc.reason)}`)
      if (smm.status === 'rejected') errors.push(`SMM: ${String(smm.reason)}`)
      if (cfets.status === 'rejected') errors.push(`CFETS: ${String(cfets.reason)}`)
      const raw = [...pbocRecords, ...smmRecords, ...cfetsRecords]
      fetched = raw.length
      this.emitProgress({ task: 'fetch', phase: 'store', current: 1, total: 3, message: `写入原始数据 ${raw.length} 条` })
      await this.repository.appendRaw(raw)
      const result = await this.ingest.ingestRecords([...pbocRecords, ...smmRecords], monitors, {
        signal: this.abortController.signal,
        onProgress: (event) => this.emitProgress(event)
      })
      valid = result.valid.length
      invalid = result.invalid.length
      await this.ingest.recomputeAggregates(monitors, { signal: this.abortController.signal })
      await this.refreshAlerts(monitors)
      this.emitProgress({ task: 'fetch', phase: 'done', current: 3, total: 3, message: `完成：有效 ${valid}，隔离 ${invalid}` })
      const log = this.buildFetchLog({
        startedAt,
        source: 'all',
        monitorIds: monitors.map((m) => m.id),
        dates: [start, end],
        status: errors.length && !raw.length ? 'failed' : errors.length ? 'partial' : 'success',
        fetched,
        valid,
        invalid,
        message: errors.length ? errors.join(' | ') : '抓取、校验、聚合完成'
      })
      await this.repository.appendFetchLog(log)
      this.emitChanged()
      if (this.settings.reports.enabled && this.settings.reports.autoAfterFetch) {
        void this.generateDailyReport().catch((error) => {
          console.error('[reports] 自动生成日报失败', error)
        })
      }
      return { log, fetched, valid, quarantined: invalid }
    } catch (error) {
      const log = this.buildFetchLog({
        startedAt,
        source: 'all',
        monitorIds: monitors.map((m) => m.id),
        dates: [start, end],
        status: 'failed',
        fetched,
        valid,
        invalid,
        message: error instanceof Error ? error.message : String(error)
      })
      await this.repository.appendFetchLog(log)
      this.emitChanged()
      return { log, fetched, valid, quarantined: invalid }
    } finally {
      this.running = false
      this.currentTask = undefined
      this.abortController = undefined
    }
  }

  async runBackfill(opts: BackfillOptions = {}): Promise<BackfillRunResult> {
    if (this.running) throw new Error('已有任务正在执行，请稍后再试')
    this.running = true
    this.currentTask = 'backfill'
    this.abortController = new AbortController()
    const startedAt = new Date().toISOString()
    const start = opts.startDate ?? this.settings.backfill.startDate
    const end = opts.endDate ?? todayKey()
    const monitors = opts.monitorIds?.length
      ? this.monitors.filter((m) => opts.monitorIds!.includes(m.id) && m.enabled)
      : this.monitors.filter((m) => m.enabled)
    const sources = opts.sources ?? ['pboc', 'smm', 'cfets']
    const ctx = { settings: this.settings, signal: this.abortController.signal }
    const logs: FetchLog[] = []
    let totalFetched = 0
    let totalValid = 0
    let totalQuarantined = 0
    try {
      if (sources.includes('pboc')) {
        this.emitProgress({ task: 'backfill', phase: 'pboc', current: 0, total: 1, message: `PBOC 回填 ${start} ~ ${end}` })
        try {
          const records = await adapters.pboc.fetchRange(start, end, monitors, ctx)
          totalFetched += records.length
          await this.repository.appendRaw(records)
          const result = await this.ingest.ingestRecords(records, monitors, {
            signal: ctx.signal,
            onProgress: (event) => this.emitProgress(event)
          })
          totalValid += result.valid.length
          totalQuarantined += result.invalid.length
          const log = this.buildFetchLog({
            startedAt,
            source: 'pboc',
            monitorIds: monitors.map((m) => m.id),
            dates: [start, end],
            status: 'success',
            fetched: records.length,
            valid: result.valid.length,
            invalid: result.invalid.length,
            message: 'PBOC 历史回填完成'
          })
          logs.push(log)
          await this.repository.appendFetchLog(log)
        } catch (error) {
          const log = this.buildFetchLog({
            startedAt,
            source: 'pboc',
            monitorIds: monitors.map((m) => m.id),
            dates: [start, end],
            status: 'failed',
            fetched: 0,
            valid: 0,
            invalid: 0,
            message: String(error)
          })
          logs.push(log)
          await this.repository.appendFetchLog(log)
        }
      }
      if (sources.includes('smm')) {
        this.emitProgress({ task: 'backfill', phase: 'smm', current: 0, total: 1, message: `SMM 回填 ${start} ~ ${end}` })
        try {
          const records = await adapters.smm.fetchRange(start, end, monitors, ctx)
          totalFetched += records.length
          await this.repository.appendRaw(records)
          const result = await this.ingest.ingestRecords(records, monitors, {
            signal: ctx.signal,
            onProgress: (event) => this.emitProgress(event)
          })
          totalValid += result.valid.length
          totalQuarantined += result.invalid.length
          const log = this.buildFetchLog({
            startedAt,
            source: 'smm',
            monitorIds: monitors.map((m) => m.id),
            dates: [start, end],
            status: 'success',
            fetched: records.length,
            valid: result.valid.length,
            invalid: result.invalid.length,
            message: 'SMM 历史回填完成'
          })
          logs.push(log)
          await this.repository.appendFetchLog(log)
        } catch (error) {
          const log = this.buildFetchLog({
            startedAt,
            source: 'smm',
            monitorIds: monitors.map((m) => m.id),
            dates: [start, end],
            status: 'failed',
            fetched: 0,
            valid: 0,
            invalid: 0,
            message: String(error)
          })
          logs.push(log)
          await this.repository.appendFetchLog(log)
        }
      }
      if (sources.includes('cfets')) {
        const cfetsStart =
          start < format(subDays(parseISO(end), 730), 'yyyy-MM-dd') ? format(subDays(parseISO(end), 730), 'yyyy-MM-dd') : start
        this.emitProgress({ task: 'backfill', phase: 'cfets', current: 0, total: 1, message: `CFETS 校验数据回填 ${cfetsStart} ~ ${end}` })
        try {
          const records = await adapters.cfets.fetchRange(cfetsStart, end, monitors, ctx)
          totalFetched += records.length
          await this.repository.appendRaw(records)
          const log = this.buildFetchLog({
            startedAt,
            source: 'cfets',
            monitorIds: monitors.map((m) => m.id),
            dates: [cfetsStart, end],
            status: 'success',
            fetched: records.length,
            valid: 0,
            invalid: 0,
            message: 'CFETS 交叉校验数据回填完成'
          })
          logs.push(log)
          await this.repository.appendFetchLog(log)
        } catch (error) {
          const log = this.buildFetchLog({
            startedAt,
            source: 'cfets',
            monitorIds: monitors.map((m) => m.id),
            dates: [cfetsStart, end],
            status: 'failed',
            fetched: 0,
            valid: 0,
            invalid: 0,
            message: String(error)
          })
          logs.push(log)
          await this.repository.appendFetchLog(log)
        }
      }
      await this.ingest.recomputeAggregates(monitors, { signal: ctx.signal })
      await this.refreshAlerts(monitors)
      this.emitProgress({
        task: 'backfill',
        phase: 'done',
        current: 1,
        total: 1,
        message: `回填完成：抓取 ${totalFetched}，有效 ${totalValid}，隔离 ${totalQuarantined}`
      })
      this.emitChanged()
      return { logs, totalFetched, totalValid, totalQuarantined }
    } finally {
      this.running = false
      this.currentTask = undefined
      this.abortController = undefined
    }
  }

  private async refreshAlerts(monitors: MonitorConfig[]): Promise<void> {
    const aggregates = await this.repository.readAggregates()
    const alerts: AlertRecord[] = []
    for (const monitor of monitors) {
      const { latest, previous, records } = await this.latestRecords(monitor)
      const month = latestAggregate(aggregates, monitor.id, monitor.productId, 'month')
      const previousMonth = aggregates
        .filter(
          (a) =>
            a.monitorId === monitor.id &&
            a.productId === monitor.productId &&
            a.periodType === 'month' &&
            (!month || a.periodKey < month.periodKey)
        )
        .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
        .at(0)
      alerts.push(
        ...generateAlerts({
          monitor,
          latest: latestFromRecord(latest),
          previous: latestFromRecord(previous),
          month,
          previousMonth,
          lastDate: records.at(-1)?.date,
          settings: this.settings
        })
      )
    }
    const quarantined = await this.repository.countQuarantined()
    const audit = await this.repository.readAudit()
    const warnings = audit.validationLogs
      .filter((log) => log.status === 'invalid')
      .slice(0, 3)
      .map((log) => `${log.productId} ${log.date}: ${log.message}`)
    alerts.push(...qualityAlerts({ quarantined, crossSourceWarnings: warnings }))
    if (alerts.length) {
      await this.repository.appendAlerts(alerts)
      for (const alert of alerts.filter((a) => a.severity === 'critical' && a.status === 'open').slice(0, 2)) {
        try {
          new Notification({ title: alert.title, body: alert.message }).show()
        } catch {
          // Notification is unavailable in headless environments.
        }
      }
    }
  }

  async manualAdd(input: ManualRecordInput): Promise<ManualAddResult> {
    const monitor = this.monitors.find((m) => m.source === 'asianmetal' && m.enabled && m.productId === input.productId)
    const result = await this.ingest.addManual(input, monitor)
    await this.refreshAlerts(monitor ? [monitor] : [])
    this.emitChanged()
    const record = result.valid[0] ?? result.invalid[0]
    if (!record) throw new Error('手动数据写入失败')
    return {
      record,
      valid: result.valid.length > 0,
      message: result.valid.length ? '手动数据已通过校验并写入' : `数据未通过校验：${result.invalid[0]?.validation.errors.join('；')}`
    }
  }

  async manualImportCsv(csv: string): Promise<CsvImportResult> {
    const rows = parseManualCsv(csv)
    const errors: { row: number; message: string }[] = []
    const records: RawRecord[] = []
    for (const row of rows) {
      if (!row.record) errors.push({ row: row.row, message: row.error ?? '解析失败' })
      else records.push(row.record)
    }
    let valid = 0
    let quarantined = 0
    if (records.length) {
      await this.repository.appendRaw(records)
      const result = await this.ingest.ingestRecords(records, this.monitors)
      valid = result.valid.length
      quarantined = result.invalid.length
      await this.ingest.recomputeAggregates(this.monitors)
      await this.refreshAlerts(this.monitors)
    }
    this.emitChanged()
    return { total: rows.length, imported: records.length, valid, quarantined, errors }
  }

  async listAlerts(filter: AlertFilter = {}): Promise<AlertRecord[]> {
    const official = (await this.repository.readAlerts()).map((alert) => ({
      ...alert,
      origin: alert.origin ?? ('official' as const)
    }))
    const alerts = [...official, ...this.realtime.getAlerts()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )
    return alerts
      .filter((alert) => {
        if (filter.status && alert.status !== filter.status) return false
        if (filter.severity && alert.severity !== filter.severity) return false
        if (filter.monitorId && alert.monitorId !== filter.monitorId) return false
        if (filter.origin && (alert.origin ?? 'official') !== filter.origin) return false
        if (alert.monitorId !== 'system' && !this.monitors.some((m) => m.id === alert.monitorId)) return false
        return true
      })
      .slice(0, filter.limit ?? 200)
  }

  async updateAlert(id: string, status: AlertStatus): Promise<AlertRecord[]> {
    if (id.startsWith('rt:')) {
      this.realtime.updateAlert(id, status)
      return this.listAlerts({ limit: 300 })
    }
    return this.repository.updateAlert(id, status)
  }

  async audit(): Promise<AuditData> {
    const audit = await this.repository.readAudit()
    const files = await this.repository.listFiles()
    const quarantine = await this.repository.readQuarantine()
    return {
      dataDir: this.repository.dataDir,
      fetchLogs: audit.fetchLogs.slice(0, 100),
      rotationLogs: audit.rotationLogs.slice(0, 200),
      validationLogs: audit.validationLogs.slice(0, 200),
      files,
      quarantine,
      counts: {
        rawFiles: files.filter((f) => f.kind === 'raw').length,
        validatedFiles: files.filter((f) => f.kind === 'validated').length,
        aggregateFiles: files.filter((f) => f.kind === 'aggregates').length,
        quarantined: quarantine.length,
        fetchRuns: audit.fetchLogs.length
      }
    }
  }

  async files(): Promise<DataFileInfo[]> {
    return this.repository.listFiles()
  }

  async quarantine(): Promise<QuarantinedRecord[]> {
    return this.repository.readQuarantine()
  }

  async approveQuarantine(id: string, reason: string): Promise<void> {
    const record = await this.repository.removeQuarantine(id)
    if (!record) throw new Error('隔离记录不存在')
    const monitor = this.monitors.find((m) => m.source === record.source && m.productId === record.productId)
    const info = {
      ...record.validation,
      status: 'valid' as const,
      errors: [],
      warnings: [...record.validation.warnings, `人工复核通过：${reason}`],
      checks: [
        ...record.validation.checks,
        { rule: 'manual-review', status: 'pass' as const, message: `人工复核通过：${reason}` }
      ]
    }
    await this.repository.appendValidated([{ ...record, validation: info }])
    if (monitor) await this.ingest.rebuildMonitor(monitor)
    await this.repository.appendValidationLog({
      id: `val-${Date.now()}`,
      timestamp: new Date().toISOString(),
      source: record.source,
      productId: record.productId,
      date: record.date,
      status: 'valid',
      rules: ['manual-review'],
      message: `人工复核通过：${reason}`
    })
    this.emitChanged()
  }

  async rejectQuarantine(id: string, reason: string): Promise<void> {
    const record = await this.repository.removeQuarantine(id)
    if (!record) throw new Error('隔离记录不存在')
    await this.repository.appendValidationLog({
      id: `val-${Date.now()}`,
      timestamp: new Date().toISOString(),
      source: record.source,
      productId: record.productId,
      date: record.date,
      status: 'invalid',
      rules: ['manual-reject'],
      message: `人工复核拒绝：${reason}`
    })
    this.emitChanged()
  }

  async saveSettings(
    patch: Partial<AppSettings> & {
      llm?: Partial<AppSettings['llm']> & { apiKey?: string }
      realtime?: Partial<AppSettings['realtime']> & { apiKey?: string }
    }
  ): Promise<AppSettings> {
    const incoming = { ...patch }
    const apiKey = incoming.llm?.apiKey
    if (incoming.llm) delete (incoming.llm as unknown as Record<string, unknown>).apiKey
    const realtimeApiKey = incoming.realtime?.apiKey
    if (incoming.realtime) delete (incoming.realtime as unknown as Record<string, unknown>).apiKey
    const merged = deepMerge(this.settings, incoming as Partial<AppSettings>)
    if (apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        merged.llm.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64')
        this.ephemeralApiKey = undefined
      } else {
        this.ephemeralApiKey = apiKey
        merged.llm.apiKeyEncrypted = undefined
      }
      merged.llm.hasApiKey = true
    }
    if (realtimeApiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        merged.realtime.apiKeyEncrypted = safeStorage.encryptString(realtimeApiKey).toString('base64')
        this.ephemeralRealtimeApiKey = undefined
      } else {
        this.ephemeralRealtimeApiKey = realtimeApiKey
        merged.realtime.apiKeyEncrypted = undefined
      }
      merged.realtime.hasApiKey = true
    }
    const parsed = settingsSchema.safeParse(merged)
    if (!parsed.success) throw new Error(`设置校验失败：${parsed.error.issues.map((i) => i.message).join('; ')}`)
    const previousDataDir = this.settings.dataDir
    this.settings = parsed.data as AppSettings
    this.repository.writeConfig('settings.json', this.settings)
    if (previousDataDir !== this.settings.dataDir) {
      this.realtime.stop()
      clearJsonCache()
      this.repository = new FileRepository(resolveDataDir(this.settings.dataDir, this.appRoot), this.configDir)
      this.ingest = new IngestService(this.repository, this.settings)
      this.realtime = this.createRealtime()
      this.reports = new ReportStore(this.repository.dataDir)
      this.conversations = new ConversationStore(this.repository.dataDir)
      await this.ensureCurrentPeriodFiles()
      this.realtime.start()
    } else {
      this.realtime.restart()
    }
    this.emitChanged()
    return this.getSettingsPublic()
  }

  async fetchStatus(): Promise<FetchStatus> {
    const audit = await this.repository.readAudit()
    return {
      running: this.running,
      task: this.currentTask,
      lastRun: audit.fetchLogs[0],
      nextRun: nextScheduledTime(this.settings.schedule.times, new Date()),
      dataDir: this.repository.dataDir,
      currentPeriod: periodKey('month', new Date()),
      validRecords: await this.repository.countValidated(),
      quarantinedRecords: await this.repository.countQuarantined(),
      monitorCount: this.monitors.filter((m) => m.enabled).length
    }
  }

  async catalog(): Promise<{ fx: CatalogItem[]; smm: CatalogItem[]; asianmetal: CatalogItem[] }> {
    return { fx: DEFAULT_FX_CATALOG, smm: DEFAULT_SMM_CATALOG, asianmetal: DEFAULT_ASIAN_METAL_CATALOG }
  }

  async openDataFolder(): Promise<void> {
    await shell.openPath(this.repository.ensureDataDir())
  }

  async exportData(kind: string): Promise<string> {
    const timestamp = format(new Date(), 'yyyyMMdd-HHmmss')
    if (kind === 'aggregates') {
      const records = await this.repository.readAggregates()
      const rows = records as unknown as Record<string, unknown>[]
      const path = exportsPath(this.repository.dataDir, `aggregates-${timestamp}.csv`)
      writeCsvAtomic(path, rows, Object.keys(rows[0] ?? { monitorId: '' }))
      return path
    }
    const files = await this.repository.listFiles()
    const path = exportsPath(this.repository.dataDir, `files-${timestamp}.csv`)
    writeCsvAtomic(path, files as unknown as Record<string, unknown>[], ['relativePath', 'kind', 'size', 'modifiedAt', 'records'])
    return path
  }

  async llmTest(input?: LlmTestInput): Promise<LlmTestResult> {
    return this.llm.test(input)
  }

  async buildLlmContext(): Promise<Record<string, unknown>> {
    const dashboard = await this.dashboard()
    const aggregates = await this.repository.readAggregates()
    const citations = dashboard.monitors
      .filter((m) => m.latest)
      .map((m) => ({
        label: `${m.monitor.displayName} ${m.latest!.date}`,
        date: m.latest!.date,
        file: `validated/${m.latest!.date.slice(0, 4)}/${m.latest!.date.slice(0, 7)}.json`,
        recordId: `${m.monitor.source}:${m.monitor.productId}:${m.latest!.date}`
      }))
    const monthlyTrend = (monitorId: string, productId: string) =>
      aggregates
        .filter(
          (row) =>
            row.monitorId === monitorId &&
            row.productId === productId &&
            row.periodType === 'month'
        )
        .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
        .slice(-12)
        .map((row) => ({
          period: row.periodKey,
          mean: row.mean,
          count: row.count,
          coverage: row.coverage,
          partial: row.partial
        }))
    return {
      generatedAt: new Date().toISOString(),
      dataAsOf: dashboard.generatedAt,
      dataDir: this.repository.dataDir,
      monitors: dashboard.monitors.map((m) => ({
        id: m.monitor.id,
        name: m.monitor.displayName,
        source: m.monitor.source,
        unit: m.monitor.unit,
        latest: m.latest,
        changePct: m.changePct,
        recent: m.sparkline.slice(-30),
        monthlyTrend: monthlyTrend(m.monitor.id, m.monitor.productId),
        means: {
          month: m.means.month?.mean,
          quarter: m.means.quarter?.mean,
          half: m.means.half?.mean,
          year: m.means.year?.mean
        },
        validation: m.validation
      })),
      alerts: dashboard.alerts.slice(0, 10),
      validation: {
        valid: dashboard.quality.valid,
        quarantined: dashboard.quality.quarantined,
        lastFetch: dashboard.quality.lastFetch
      },
      realtime: this.realtime.getSnapshot().status.enabled
        ? {
            label: '第三方实时参考价，不是 PBOC 中间价',
            status: this.realtime.getSnapshot().status,
            quotes: this.realtime.getSnapshot().quotes,
            depth: this.realtime.getSnapshot().depth.slice(0, 2),
            trades: this.realtime.getSnapshot().trades.slice(0, 10)
          }
        : undefined,
      citations
    }
  }

  async llmChat(req: LlmChatRequest): Promise<LlmChatResponse> {
    return this.llm.chat(req, await this.buildLlmContext())
  }

  async llmChatStream(requestId: string, req: LlmChatRequest): Promise<LlmChatResponse> {
    const controller = new AbortController()
    this.llmStreams.set(requestId, controller)
    try {
      return await this.llm.chatStream(
        req,
        await this.buildLlmContext(),
        (chunk) => {
          this.onLlmChunk?.(requestId, chunk)
        },
        controller.signal
      )
    } finally {
      this.llmStreams.delete(requestId)
    }
  }

  cancelLlmChat(requestId: string): void {
    this.llmStreams.get(requestId)?.abort()
  }

  listConversations() {
    return this.conversations.list()
  }

  loadConversation(id?: string): Conversation | undefined {
    return id ? this.conversations.read(id) : this.conversations.latest()
  }

  createConversation(): Conversation {
    return this.conversations.create()
  }

  saveConversation(id: string, messages: ConversationMessage[]): Conversation {
    return this.conversations.save(id, messages)
  }

  deleteConversation(id: string) {
    return this.conversations.delete(id)
  }

  async generateDailyReport(force = false): Promise<DailyReport> {
    const date = todayKey()
    const existing = this.reports.read(date)
    if (existing && !force) return existing
    const response = await this.llm.chat(
      {
        messages: [{ role: 'user', content: '请基于本地数据生成今日供应链成本日报。' }],
        mode: 'daily-report'
      },
      await this.buildLlmContext()
    )
    const report: DailyReport = {
      id: `report-${date}`,
      date,
      generatedAt: new Date().toISOString(),
      provider: response.provider,
      model: response.model,
      fallback: response.fallback,
      content: response.content,
      citations: response.citations,
      error: response.error
    }
    this.reports.save(report)
    this.emitChanged()
    return report
  }

  latestDailyReport(): DailyReport | undefined {
    return this.reports.latest()
  }

  listDailyReports(limit = 30): DailyReport[] {
    return this.reports.list(limit)
  }

  getRealtimeSnapshot(): RealtimeSnapshot {
    return this.realtime.getSnapshot()
  }

  async realtimeTest(input?: RealtimeSettingsInput): Promise<RealtimeTestResult> {
    return this.realtime.test(input)
  }

  async realtimePollNow(): Promise<RealtimeSnapshot> {
    return this.realtime.pollNow()
  }

  async realtimeSeries(productId: string): Promise<RealtimeSeries> {
    return this.realtime.getSeries(productId)
  }

  async sourceHealth(): Promise<SourceHealthData> {
    const audit = await this.repository.readAudit()
    const dashboard = await this.dashboard()
    const latestBySource = new Map<string, string>()
    for (const view of dashboard.monitors) {
      if (view.latest) latestBySource.set(view.monitor.source, view.latest.date)
    }
    const labels: Record<string, string> = {
      pboc: 'PBOC',
      cfets: 'CFETS',
      smm: 'SMM',
      asianmetal: 'Asian Metal'
    }
    const items: SourceHealthItem[] = (['pboc', 'cfets', 'smm', 'asianmetal'] as const).map((source) => {
      const logs = audit.validationLogs.filter((log) => log.source === source)
      const last = logs[0]
      const latestValid = logs.find((log) => log.status === 'valid')
      const invalid = logs.filter((log) => log.status === 'invalid').length
      const latestDate = latestBySource.get(source)
      return {
        id: source,
        label: labels[source],
        status: !last ? (latestDate ? 'ok' : 'idle') : last.status === 'invalid' ? 'warning' : 'ok',
        lastAttemptAt: last?.timestamp,
        lastSuccessAt: latestValid?.timestamp ?? (latestDate ? `${latestDate}T00:00:00.000Z` : undefined),
        validRecords: logs.length ? logs.filter((log) => log.status === 'valid').length : undefined,
        quarantinedRecords: invalid,
        message: !last
          ? latestDate
            ? `本地已有历史数据，最新 ${latestDate}`
            : '暂无自动抓取记录'
          : last.status === 'invalid'
            ? `最近一次校验未通过：${last.message}`
            : `最近校验有效${invalid ? `，历史隔离 ${invalid} 条` : ''}`
      }
    })

    const realtime = this.realtime.getSnapshot()
    const quote = realtime.quotes[0]
    const realtimeState = realtime.status.state
    items.push({
      id: 'twelvedata',
      label: realtime.status.provider === 'twelvedata' ? 'Twelve Data' : '实时行情',
      status:
        realtimeState === 'error'
          ? 'error'
          : realtimeState === 'disabled'
            ? 'disabled'
            : realtimeState === 'demo'
              ? 'warning'
              : realtimeState === 'stale' || realtimeState === 'delayed'
                ? 'warning'
                : 'ok',
      lastSuccessAt: realtime.status.lastSuccessAt,
      lastAttemptAt: realtime.status.lastReceivedAt,
      validRecords: realtime.status.quoteCount,
      delayMs: quote?.delayMs,
      demo: realtime.status.demo,
      message:
        realtimeState === 'disabled'
          ? '未启用第三方实时行情'
          : realtimeState === 'error'
            ? realtime.status.lastError ?? '实时行情异常'
            : realtimeState === 'demo'
              ? '演示行情，非真实报价'
              : `第三方参考价，${realtime.status.capabilities.join('/') || 'quotes'}`
    })

    return { generatedAt: new Date().toISOString(), items }
  }

  startRealtime(): void {
    this.realtime.start()
  }

  stopRealtime(): void {
    this.realtime.stop()
  }

  async acceptanceRun(id: AcceptanceId): Promise<AcceptanceCheckResult> {
    const now = new Date().toISOString()
    if (id === 'local-files') {
      const files = listFilesRecursive(this.repository.dataDir)
      const relative = (path: string) => path.slice(this.repository.dataDir.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
      const forbidden = files.filter((path) => /\.(db|sqlite|sqlite3)$/i.test(path))
      const json = files.filter((path) => path.endsWith('.json')).length
      const csv = files.filter((path) => path.endsWith('.csv')).length
      return {
        id,
        title: '本地文件存储',
        passed: json + csv > 0 && forbidden.length === 0,
        details: [
          `数据目录：${this.repository.dataDir}`,
          `JSON 文件 ${json} 个，CSV 文件 ${csv} 个`,
          forbidden.length ? `发现数据库文件：${forbidden.map(relative).join(', ')}` : '未发现 .db/.sqlite 数据库文件'
        ],
        evidence: { dataDir: this.repository.dataDir, json, csv, forbidden: forbidden.map(relative) },
        checkedAt: now
      }
    }
    if (id === 'rotation') {
      let audit = await this.repository.readAudit()
      if (!audit.rotationLogs.length) {
        await this.ensureCurrentPeriodFiles()
        audit = await this.repository.readAudit()
      }
      return {
        id,
        title: '时间轮转',
        passed: audit.rotationLogs.length > 0,
        details: [
          `轮转日志 ${audit.rotationLogs.length} 条`,
          ...audit.rotationLogs.slice(0, 5).map((log) => `${log.timestamp} ${log.scope} ${log.periodKey} -> ${log.path}`)
        ],
        evidence: { rotationLogs: audit.rotationLogs.slice(0, 10) },
        checkedAt: now
      }
    }
    if (id === 'cross-year') {
      const aggregates = await this.repository.readAggregates()
      const byMonitor = new Map<string, Set<string>>()
      for (const aggregate of aggregates) {
        const years = byMonitor.get(aggregate.monitorId) ?? new Set<string>()
        years.add(aggregate.periodKey.slice(0, 4))
        byMonitor.set(aggregate.monitorId, years)
      }
      const found = [...byMonitor.entries()].find(([, years]) => years.size >= 2)
      const files = await this.repository.listFiles()
      const yearFiles = files.filter((file) => file.kind === 'validated' && /\/\d{4}\//.test(file.relativePath))
      const years = [...new Set(yearFiles.map((file) => file.relativePath.match(/\/(\d{4})\//)?.[1]).filter(Boolean))]
      return {
        id,
        title: '跨年读取',
        passed: Boolean(found) || years.length >= 2,
        details: found
          ? [`${found[0]} 覆盖年份：${[...found[1]].sort().join(', ')}`, '历史文件可被自动扫描并拼接']
          : [`已发现 ${years.length} 个年份的 validated 文件`, years.join(', ') || '暂不足两年数据'],
        evidence: { monitorYears: found ? [...found[1]] : years },
        checkedAt: now
      }
    }
    if (id === 'dynamic-config') {
      const enabled = this.monitors.filter((m) => m.enabled)
      const hasFx = enabled.some((m) => m.type === 'fx')
      const hasMetal = enabled.some((m) => m.type === 'metal')
      const gbpRaw = await this.repository.readRawRange('pboc', 'GBP', '2000-01-01', '9999-12-31')
      return {
        id,
        title: '动态配置',
        passed: hasFx && hasMetal,
        details: [
          `当前启用监测标的 ${enabled.length} 个（FX ${enabled.filter((m) => m.type === 'fx').length}，金属 ${enabled.filter((m) => m.type === 'metal').length}）`,
          `PBOC 原始数据中 GBP 记录 ${gbpRaw.records.length} 条，新增英镑可直接复用历史数据`,
          '删除标的只隐藏面板，不删除本地历史；新增 SMM 标的会自动抓取历史并重算'
        ],
        evidence: { monitors: this.monitors, enabledMonitors: enabled.length, gbpRaw: gbpRaw.records.length },
        checkedAt: now
      }
    }
    if (id === 'data-accuracy' || id === 'history-means') {
      const aggregates = await this.repository.readAggregates()
      const sample = aggregates
        .filter((aggregate) => aggregate.periodType === 'month' && !aggregate.partial)
        .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
      if (!sample) {
        return {
          id,
          title: id === 'data-accuracy' ? '数据准确性' : '历史均值',
          passed: false,
          details: ['暂无完整月度均值样本，请先回填数据'],
          evidence: {},
          checkedAt: now
        }
      }
      const range = await this.repository.readValidatedRange(sample.source, sample.productId, sample.startDate, sample.endDate)
      const daily = new Map<string, Decimal[]>()
      for (const record of range.records) {
        const values = daily.get(record.date) ?? []
        values.push(new Decimal(record.value))
        daily.set(record.date, values)
      }
      const dailyMeans = [...daily.values()].map((values) =>
        values.reduce((acc, value) => acc.add(value), new Decimal(0)).div(values.length)
      )
      const sum = dailyMeans.reduce((acc, value) => acc.add(value), new Decimal(0))
      const mean = sum.div(dailyMeans.length)
      const diff = new Decimal(sample.mean).minus(mean).abs()
      const passed = diff.lt('1e-8') && dailyMeans.length === sample.count
      return {
        id,
        title: id === 'data-accuracy' ? '数据准确性' : '历史均值',
        passed,
        details: [
          `样本：${sample.monitorName} ${sample.periodKey}`,
          `有效交易日 ${dailyMeans.length} 天，均值 ${mean.toString()}`,
          `系统记录均值 ${sample.mean}，差值 ${diff.toString()}`,
          passed ? '独立复算一致，未发现精度流失' : '复算不一致，请检查数据或算法'
        ],
        evidence: { sample, recomputed: mean.toString(), diff: diff.toString(), days: dailyMeans.length },
        checkedAt: now
      }
    }
    return { id, title: id, passed: false, details: ['未知检查项'], evidence: {}, checkedAt: now }
  }
}
