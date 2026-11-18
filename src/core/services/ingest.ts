import type {
  AppSettings,
  ManualRecordInput,
  MonitorConfig,
  ProgressEvent,
  QuarantinedRecord,
  RawRecord,
  SourceId,
  ValidatedRecord
} from '../../shared/types'
import { aggregateMonitor } from '../aggregation/aggregator'
import { createManualRecord } from '../adapters/manual'
import { FileRepository } from '../storage/repository'
import { relPath, validatedPath } from '../storage/paths'
import { validateRecord, type ValidationContext } from '../validation/pipeline'
import { smmIdForGroup, manualIdForGroup, groupForMonitor } from './productGroups'

export interface IngestOptions {
  signal?: AbortSignal
  onProgress?: (event: ProgressEvent) => void
}

export interface IngestResult {
  valid: ValidatedRecord[]
  invalid: QuarantinedRecord[]
  skipped: number
}

export class IngestService {
  constructor(
    private readonly repository: FileRepository,
    private readonly settings: AppSettings
  ) {}

  private findMonitor(record: RawRecord, monitors: MonitorConfig[]): MonitorConfig | undefined {
    return monitors.find((m) => m.enabled && m.source === record.source && m.productId === record.productId)
  }

  private async crossSourceRecords(monitor: MonitorConfig): Promise<RawRecord[]> {
    const group = groupForMonitor(monitor)
    if (monitor.source === 'pboc' || monitor.source === 'cfets') {
      return (await this.repository.readRawRange('cfets', monitor.productId, '2000-01-01', '9999-12-31')).records
    }
    if (monitor.source === 'smm') {
      const manualId = manualIdForGroup(group)
      return (await this.repository.readRawRange('asianmetal', manualId, '2000-01-01', '9999-12-31')).records
    }
    if (monitor.source === 'asianmetal') {
      const smmId = smmIdForGroup(group)
      return (await this.repository.readRawRange('smm', smmId, '2000-01-01', '9999-12-31')).records
    }
    return []
  }

  async ingestRecords(records: RawRecord[], monitors: MonitorConfig[], options: IngestOptions = {}): Promise<IngestResult> {
    const valid: ValidatedRecord[] = []
    const invalid: QuarantinedRecord[] = []
    let skipped = 0
    const byMonitor = new Map<string, RawRecord[]>()
    for (const record of records) {
      const monitor = this.findMonitor(record, monitors)
      if (!monitor) {
        skipped += 1
        continue
      }
      const list = byMonitor.get(monitor.id) ?? []
      list.push(record)
      byMonitor.set(monitor.id, list)
    }

    let processed = 0
    const total = [...byMonitor.values()].reduce((sum, list) => sum + list.length, 0)
    for (const [monitorId, monitorRecords] of byMonitor) {
      const monitor = monitors.find((m) => m.id === monitorId)
      if (!monitor) continue
      const existingRange = await this.repository.readValidatedRange(monitor.source, monitor.productId, '2000-01-01', '9999-12-31')
      const existing = [...existingRange.records]
      const crossSource = await this.crossSourceRecords(monitor)
      const sorted = [...monitorRecords].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      for (const record of sorted) {
        if (options.signal?.aborted) break
        const previous = [...existing].reverse().find((item) => item.date < record.date)
        const sameDate = existing.filter((item) => item.date === record.date && item.id !== record.id)
        const context: ValidationContext = {
          monitor,
          settings: this.settings,
          previous,
          crossSource,
          existing: sameDate
        }
        const info = validateRecord(record, context)
        if (info.status === 'valid') {
          const validated: ValidatedRecord = { ...record, validation: info }
          valid.push(validated)
          existing.push(validated)
        } else {
          const quarantined: QuarantinedRecord = { ...record, validation: info }
          invalid.push(quarantined)
          await this.repository.appendValidationLog({
            id: `val-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            source: record.source,
            productId: record.productId,
            date: record.date,
            status: 'invalid',
            rules: info.errors,
            message: info.errors.join('；') || '校验失败'
          })
        }
        processed += 1
        if (processed % 50 === 0) {
          options.onProgress?.({
            task: 'fetch',
            phase: 'validate',
            current: processed,
            total,
            message: `校验 ${processed}/${total}`
          })
        }
      }
    }

    if (valid.length) await this.repository.appendValidated(valid)
    if (invalid.length) await this.repository.appendQuarantine(invalid)
    options.onProgress?.({
      task: 'fetch',
      phase: 'validate',
      current: processed,
      total,
      message: `校验完成：有效 ${valid.length}，隔离 ${invalid.length}`
    })
    return { valid, invalid, skipped }
  }

  async recomputeAggregates(monitors: MonitorConfig[], options: IngestOptions = {}): Promise<void> {
    for (const monitor of monitors) {
      if (options.signal?.aborted) break
      const range = await this.repository.readValidatedRange(monitor.source, monitor.productId, '2000-01-01', '9999-12-31')
      const aggregates = aggregateMonitor(monitor, range.records, {
        sourceFileForDate: (date) => relPath(this.repository.dataDir, validatedPath(this.repository.dataDir, date))
      })
      if (aggregates.length) await this.repository.writeAggregates(aggregates)
      options.onProgress?.({
        task: 'aggregate',
        phase: 'aggregate',
        current: 1,
        total: 1,
        message: `${monitor.displayName} 已重算 ${aggregates.length} 条周期均值`
      })
    }
  }

  async rebuildMonitor(monitor: MonitorConfig, options: IngestOptions = {}): Promise<IngestResult> {
    const range = await this.repository.readRawRange(monitor.source, monitor.productId, '2000-01-01', '9999-12-31')
    const result = await this.ingestRecords(range.records, [monitor], options)
    await this.recomputeAggregates([monitor], options)
    return result
  }

  async addManual(input: ManualRecordInput, monitor?: MonitorConfig, options: IngestOptions = {}): Promise<IngestResult> {
    const record = createManualRecord(input)
    const target =
      monitor ??
      ({
        id: record.productId,
        type: 'metal',
        source: 'asianmetal',
        productId: record.productId,
        displayName: record.productName,
        unit: record.unit,
        precision: 2,
        enabled: true,
        manual: true
      } satisfies MonitorConfig)
    await this.repository.appendRaw([record])
    const result = await this.ingestRecords([record], [target], options)
    await this.recomputeAggregates([target], options)
    return result
  }

  async rebuildByGroup(group: string, options: IngestOptions = {}): Promise<void> {
    const smmId = smmIdForGroup(group)
    const manualId = manualIdForGroup(group)
    const monitors: MonitorConfig[] = [
      {
        id: `smm-${group}`,
        type: 'metal',
        source: 'smm' as SourceId,
        productId: smmId,
        displayName: `SMM ${group.toUpperCase()}`,
        unit: '元/吨',
        precision: 2,
        enabled: true
      },
      {
        id: manualId,
        type: 'metal',
        source: 'asianmetal',
        productId: manualId,
        displayName: `Asian Metal ${group.toUpperCase()}`,
        unit: '元/吨',
        precision: 2,
        enabled: true,
        manual: true
      }
    ]
    await this.recomputeAggregates(monitors, options)
  }
}
