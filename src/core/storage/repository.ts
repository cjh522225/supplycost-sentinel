import { existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type {
  AggregateRecord,
  AlertRecord,
  AlertStatus,
  DataFileInfo,
  FetchLog,
  QuarantinedRecord,
  RawRecord,
  RotationLog,
  SourceId,
  ValidatedRecord,
  ValidationLog
} from '../../shared/types'
import { ensureDir, aggregatesCsvPath, aggregatesPath, alertsPath, auditPath, configPath, quarantinePath, rawPath, relPath, validatedPath } from './paths'
import {
  appendToArrayFile,
  ensureStorageDirs,
  fileInfo,
  listFilesRecursive,
  readJsonFile,
  removeFromArrayFile,
  withFileLock,
  writeCsvAtomic,
  writeJsonAtomic
} from './fileStore'
import { emptyAudit, type AuditFile } from './auditTypes'

const RAW_COLUMNS = [
  'date',
  'source',
  'productId',
  'productName',
  'value',
  'low',
  'high',
  'unit',
  'currency',
  'fetchedAt',
  'sourceUrl',
  'contentHash'
]

const VALIDATED_COLUMNS = [...RAW_COLUMNS, 'validationStatus', 'warnings']

const AGGREGATE_COLUMNS = [
  'monitorId',
  'monitorName',
  'source',
  'productId',
  'unit',
  'periodType',
  'periodKey',
  'startDate',
  'endDate',
  'mean',
  'sum',
  'count',
  'min',
  'max',
  'firstDate',
  'lastDate',
  'coverage',
  'meanBasis',
  'coverageBasis',
  'availableDays',
  'expectedWeekdays',
  'partial',
  'computedAt',
  'formulaVersion'
]

export interface AppendResult {
  added: number
  files: string[]
  created: string[]
}

export interface RangeResult<T> {
  records: T[]
  files: string[]
}

function rawKey(record: RawRecord): string {
  return `${record.source}:${record.productId}:${record.date}`
}

function yearFromPath(path: string): string {
  const match = path.match(/(\d{4})[\\/][^\\/]+\.json$/)
  return match?.[1] ?? ''
}

export class FileRepository {
  readonly dataDir: string
  readonly configDir: string

  constructor(dataDir: string, configDir: string) {
    this.dataDir = dataDir
    this.configDir = configDir
    ensureStorageDirs(dataDir)
    ensureDir(configDir)
  }

  private async appendRotation(log: RotationLog): Promise<void> {
    const path = auditPath(this.dataDir, log.timestamp.slice(0, 10))
    await withFileLock(path, () => {
      const audit = readJsonFile<AuditFile>(path, emptyAudit())
      audit.rotationLogs.unshift(log)
      audit.rotationLogs = audit.rotationLogs.slice(0, 2000)
      writeJsonAtomic(path, audit)
    })
  }

  async appendFetchLog(log: FetchLog): Promise<void> {
    const path = auditPath(this.dataDir, log.startedAt.slice(0, 10))
    await withFileLock(path, () => {
      const audit = readJsonFile<AuditFile>(path, emptyAudit())
      audit.fetchLogs.unshift(log)
      audit.fetchLogs = audit.fetchLogs.slice(0, 1000)
      writeJsonAtomic(path, audit)
    })
  }

  async appendValidationLog(log: ValidationLog): Promise<void> {
    const path = auditPath(this.dataDir, log.timestamp.slice(0, 10))
    await withFileLock(path, () => {
      const audit = readJsonFile<AuditFile>(path, emptyAudit())
      audit.validationLogs.unshift(log)
      audit.validationLogs = audit.validationLogs.slice(0, 3000)
      writeJsonAtomic(path, audit)
    })
  }

  async appendRaw(records: RawRecord[]): Promise<AppendResult> {
    const groups = new Map<string, RawRecord[]>()
    for (const record of records) {
      const path = rawPath(this.dataDir, record.source, record.date)
      const list = groups.get(path) ?? []
      list.push(record)
      groups.set(path, list)
    }
    const result: AppendResult = { added: 0, files: [], created: [] }
    for (const [path, items] of groups) {
      const appended = await appendToArrayFile(path, items, rawKey)
      writeCsvAtomic(path.replace(/\.json$/, '.csv'), appended.records as unknown as Record<string, unknown>[], RAW_COLUMNS)
      result.added += appended.added
      result.files.push(path)
      if (appended.created) {
        result.created.push(path)
        await this.appendRotation({
          id: `rot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          scope: 'raw',
          periodKey: items[0]?.date.slice(0, 7) ?? '',
          path: relPath(this.dataDir, path),
          reason: 'first-write'
        })
      }
    }
    return result
  }

  async appendValidated(records: ValidatedRecord[]): Promise<AppendResult> {
    const groups = new Map<string, ValidatedRecord[]>()
    for (const record of records) {
      const path = validatedPath(this.dataDir, record.date)
      const list = groups.get(path) ?? []
      list.push(record)
      groups.set(path, list)
    }
    const result: AppendResult = { added: 0, files: [], created: [] }
    for (const [path, items] of groups) {
      const appended = await appendToArrayFile(path, items, rawKey)
      const rows = appended.records.map((r) => ({
        ...r,
        validationStatus: r.validation.status,
        warnings: r.validation.warnings.join(' | ')
      }))
      writeCsvAtomic(path.replace(/\.json$/, '.csv'), rows as unknown as Record<string, unknown>[], VALIDATED_COLUMNS)
      result.added += appended.added
      result.files.push(path)
      if (appended.created) {
        result.created.push(path)
        await this.appendRotation({
          id: `rot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          scope: 'validated',
          periodKey: items[0]?.date.slice(0, 7) ?? '',
          path: relPath(this.dataDir, path),
          reason: 'first-write'
        })
      }
    }
    return result
  }

  async appendQuarantine(records: QuarantinedRecord[]): Promise<AppendResult> {
    const groups = new Map<string, QuarantinedRecord[]>()
    for (const record of records) {
      const path = quarantinePath(this.dataDir, record.date)
      const list = groups.get(path) ?? []
      list.push(record)
      groups.set(path, list)
    }
    const result: AppendResult = { added: 0, files: [], created: [] }
    for (const [path, items] of groups) {
      const appended = await appendToArrayFile(path, items, rawKey)
      const rows = appended.records.map((r) => ({
        ...r,
        validationStatus: r.validation.status,
        warnings: r.validation.errors.join(' | ') || r.validation.warnings.join(' | ')
      }))
      writeCsvAtomic(path.replace(/\.json$/, '.csv'), rows as unknown as Record<string, unknown>[], VALIDATED_COLUMNS)
      result.added += appended.added
      result.files.push(path)
    }
    return result
  }

  async writeAggregates(records: AggregateRecord[]): Promise<AppendResult> {
    const groups = new Map<string, AggregateRecord[]>()
    for (const record of records) {
      const path = aggregatesPath(this.dataDir, record.periodKey.slice(0, 4))
      const list = groups.get(path) ?? []
      list.push(record)
      groups.set(path, list)
    }
    const result: AppendResult = { added: 0, files: [], created: [] }
    for (const [path, items] of groups) {
      const merged = await withFileLock(path, () => {
        const created = !existsSync(path)
        const existing = readJsonFile<AggregateRecord[]>(path, [])
        const keyOf = (r: AggregateRecord) =>
          `${r.monitorId}:${r.productId}:${r.periodType}:${r.periodKey}`
        const map = new Map(existing.map((r) => [keyOf(r), r]))
        for (const item of items) map.set(keyOf(item), item)
        const records = [...map.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
        writeJsonAtomic(path, records)
        return { created, records }
      })
      writeCsvAtomic(aggregatesCsvPath(this.dataDir, items[0].periodKey.slice(0, 4)), merged.records as unknown as Record<string, unknown>[], AGGREGATE_COLUMNS)
      result.added += items.length
      result.files.push(path)
      if (merged.created) {
        result.created.push(path)
        await this.appendRotation({
          id: `rot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          scope: 'aggregates',
          periodKey: items[0].periodKey.slice(0, 4),
          path: relPath(this.dataDir, path),
          reason: 'first-write'
        })
      }
    }
    return result
  }

  async appendAlerts(alerts: AlertRecord[]): Promise<AppendResult> {
    const groups = new Map<string, AlertRecord[]>()
    for (const alert of alerts) {
      const path = alertsPath(this.dataDir, alert.date.slice(0, 4))
      const list = groups.get(path) ?? []
      list.push(alert)
      groups.set(path, list)
    }
    const result: AppendResult = { added: 0, files: [], created: [] }
    for (const [path, items] of groups) {
      const merged = await withFileLock(path, () => {
        const created = !existsSync(path)
        const existing = readJsonFile<AlertRecord[]>(path, [])
        const map = new Map(existing.map((a) => [a.id, a]))
        for (const item of items) if (!map.has(item.id)) map.set(item.id, item)
        const alerts = [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        writeJsonAtomic(path, alerts)
        return { created, records: alerts, added: alerts.length - existing.length }
      })
      result.added += merged.added
      result.files.push(path)
      if (merged.created) {
        result.created.push(path)
        await this.appendRotation({
          id: `rot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          scope: 'alerts',
          periodKey: items[0].date.slice(0, 4),
          path: relPath(this.dataDir, path),
          reason: 'first-write'
        })
      }
    }
    return result
  }


  async ensurePeriod(date: string): Promise<string[]> {
    const year = date.slice(0, 4)
    const month = date.slice(0, 7)
    const targets: { path: string; scope: RotationLog["scope"]; initial: unknown; periodKey: string }[] = [
      { path: rawPath(this.dataDir, 'pboc', date), scope: 'raw', initial: [], periodKey: month },
      { path: rawPath(this.dataDir, 'cfets', date), scope: 'raw', initial: [], periodKey: month },
      { path: rawPath(this.dataDir, 'smm', date), scope: 'raw', initial: [], periodKey: month },
      { path: rawPath(this.dataDir, 'asianmetal', date), scope: 'raw', initial: [], periodKey: month },
      { path: validatedPath(this.dataDir, date), scope: 'validated', initial: [], periodKey: month },
      { path: quarantinePath(this.dataDir, date), scope: 'quarantine', initial: [], periodKey: month },
      { path: aggregatesPath(this.dataDir, year), scope: 'aggregates', initial: [], periodKey: year },
      { path: alertsPath(this.dataDir, year), scope: 'alerts', initial: [], periodKey: year },
      { path: auditPath(this.dataDir, date), scope: 'audit', initial: emptyAudit(), periodKey: month }
    ]
    const created: string[] = []
    for (const target of targets) {
      if (existsSync(target.path)) continue
      writeJsonAtomic(target.path, target.initial)
      created.push(target.path)
      await this.appendRotation({
        id: `rot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        scope: target.scope,
        periodKey: target.periodKey,
        path: relPath(this.dataDir, target.path),
        reason: 'period-change'
      })
    }
    return created
  }
  async readAlerts(): Promise<AlertRecord[]> {
    return listFilesRecursive(join(this.dataDir, 'alerts'))
      .filter((p) => p.endsWith('.json'))
      .flatMap((p) => readJsonFile<AlertRecord[]>(p, []))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async updateAlert(id: string, status: AlertStatus): Promise<AlertRecord[]> {
    for (const path of listFilesRecursive(join(this.dataDir, 'alerts')).filter((p) => p.endsWith('.json'))) {
      const alerts = readJsonFile<AlertRecord[]>(path, [])
      const index = alerts.findIndex((a) => a.id === id)
      if (index >= 0) {
        const now = new Date().toISOString()
        alerts[index] = {
          ...alerts[index],
          status,
          acknowledgedAt: status === 'acknowledged' ? now : alerts[index].acknowledgedAt,
          resolvedAt: status === 'resolved' ? now : alerts[index].resolvedAt
        }
        writeJsonAtomic(path, alerts)
        return this.readAlerts()
      }
    }
    return this.readAlerts()
  }

  async readAggregates(filter?: {
    monitorId?: string
    productId?: string
    periodType?: string
    start?: string
    end?: string
  }): Promise<AggregateRecord[]> {
    const all = listFilesRecursive(join(this.dataDir, 'aggregates'))
      .filter((p) => p.endsWith('.json'))
      .flatMap((p) => readJsonFile<AggregateRecord[]>(p, []))
    return all.filter((r) => {
      if (filter?.monitorId && r.monitorId !== filter.monitorId) return false
      if (filter?.productId && r.productId !== filter.productId) return false
      if (filter?.periodType && r.periodType !== filter.periodType) return false
      if (filter?.start && r.endDate < filter.start) return false
      if (filter?.end && r.startDate > filter.end) return false
      return true
    })
  }

  private async readMonthly<T extends { date: string; source?: SourceId; productId?: string }>(
    root: string,
    start: string,
    end: string,
    filter?: (record: T) => boolean
  ): Promise<RangeResult<T>> {
    const files = listFilesRecursive(root).filter((p) => p.endsWith('.json'))
    const records: T[] = []
    const used: string[] = []
    for (const file of files) {
      const month = basename(file).replace(/\.json$/, '')
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      if (month < start.slice(0, 7) || month > end.slice(0, 7)) continue
      const rows = readJsonFile<T[]>(file, []).filter((r) => r.date >= start && r.date <= end)
      if (rows.length) {
        records.push(...rows)
        used.push(file)
      }
    }
    const map = new Map<string, T>()
    for (const record of records) {
      if (filter && !filter(record)) continue
      map.set(`${record.source ?? ''}:${record.productId ?? ''}:${record.date}`, record)
    }
    return { records: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)), files: used }
  }

  readRawRange(source: SourceId, productId: string, start: string, end: string): Promise<RangeResult<RawRecord>> {
    return this.readMonthly<RawRecord>(join(this.dataDir, 'raw', source), start, end, (r) => r.productId === productId)
  }

  readValidatedRange(source: SourceId, productId: string, start: string, end: string): Promise<RangeResult<ValidatedRecord>> {
    return this.readMonthly<ValidatedRecord>(join(this.dataDir, 'validated'), start, end, (r) => r.source === source && r.productId === productId)
  }

  readAllValidated(): Promise<RangeResult<ValidatedRecord>> {
    return this.readMonthly<ValidatedRecord>(join(this.dataDir, 'validated'), '0000-01-01', '9999-12-31')
  }

  async readQuarantine(): Promise<QuarantinedRecord[]> {
    return listFilesRecursive(join(this.dataDir, 'quarantine'))
      .filter((p) => p.endsWith('.json'))
      .flatMap((p) => readJsonFile<QuarantinedRecord[]>(p, []))
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  async removeQuarantine(id: string): Promise<QuarantinedRecord | undefined> {
    let found: QuarantinedRecord | undefined
    for (const path of listFilesRecursive(join(this.dataDir, 'quarantine')).filter((p) => p.endsWith('.json'))) {
      const records = readJsonFile<QuarantinedRecord[]>(path, [])
      const match = records.find((r) => r.id === id)
      if (!match) continue
      found = match
      await removeFromArrayFile<QuarantinedRecord>(path, (r) => r.id === id)
      break
    }
    return found
  }

  async readAudit(): Promise<AuditFile> {
    const result: AuditFile = { fetchLogs: [], rotationLogs: [], validationLogs: [] }
    for (const path of listFilesRecursive(join(this.dataDir, 'audit')).filter((p) => p.endsWith('.json'))) {
      const audit = readJsonFile<AuditFile>(path, emptyAudit())
      result.fetchLogs.push(...audit.fetchLogs)
      result.rotationLogs.push(...audit.rotationLogs)
      result.validationLogs.push(...audit.validationLogs)
    }
    result.fetchLogs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    result.rotationLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    result.validationLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return result
  }

  async listFiles(): Promise<DataFileInfo[]> {
    const files = listFilesRecursive(this.dataDir).filter((p) => p.endsWith('.json') || p.endsWith('.csv'))
    return files.map((path) => {
      const relativePath = relative(this.dataDir, path).replace(/\\/g, '/')
      const kind = relativePath.split('/')[0] || 'other'
      const info = fileInfo(path)
      let records: number | undefined
      let periodKey: string | undefined
      if (path.endsWith('.json')) {
        const parsed = readJsonFile<unknown>(path, undefined)
        if (Array.isArray(parsed)) records = parsed.length
        else if (parsed && typeof parsed === 'object') {
          const audit = parsed as AuditFile
          if (Array.isArray(audit.fetchLogs)) records = audit.fetchLogs.length + audit.rotationLogs.length + audit.validationLogs.length
        }
      }
      const match = relativePath.match(/(\d{4}(?:-\d{2})?)/)
      periodKey = match?.[1]
      return { path, relativePath, kind, size: info.size, modifiedAt: info.modifiedAt, records, periodKey }
    })
  }

  readConfig<T>(name: string, fallback: T): T {
    return readJsonFile<T>(configPath(this.configDir, name), fallback)
  }

  writeConfig<T>(name: string, value: T): void {
    writeJsonAtomic(configPath(this.configDir, name), value)
  }

  async countValidated(): Promise<number> {
    return (await this.readAllValidated()).records.length
  }

  async countQuarantined(): Promise<number> {
    return (await this.readQuarantine()).length
  }

  ensureDataDir(): string {
    ensureDir(this.dataDir)
    return this.dataDir
  }

  dataRelative(path: string): string {
    return relPath(this.dataDir, path)
  }
}


