import { join } from 'node:path'
import { format, parseISO, subDays } from 'date-fns'
import type { AppSettings, MonitorConfig, RawRecord, SourceId } from '../src/shared/types'
import { DEFAULT_MONITORS, DEFAULT_SETTINGS } from '../src/shared/constants'
import { readJsonFile } from '../src/core/storage/fileStore'
import { resolveDataDir } from '../src/core/storage/paths'
import { FileRepository } from '../src/core/storage/repository'
import { adapters } from '../src/core/adapters'
import { IngestService } from '../src/core/services/ingest'

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function mergeSettings(saved: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(saved.schedule ?? {}) },
    precision: { ...DEFAULT_SETTINGS.precision, ...(saved.precision ?? {}) },
    validation: { ...DEFAULT_SETTINGS.validation, ...(saved.validation ?? {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(saved.llm ?? {}) },
    realtime: { ...DEFAULT_SETTINGS.realtime, ...(saved.realtime ?? {}) },
    backfill: { ...DEFAULT_SETTINGS.backfill, ...(saved.backfill ?? {}) }
  }
}

async function main(): Promise<void> {
  const appRoot = process.cwd()
  const configDir = join(appRoot, 'config')
  const settings = mergeSettings(readJsonFile<Partial<AppSettings>>(join(configDir, 'settings.json'), {}))
  const monitors = readJsonFile<MonitorConfig[]>(join(configDir, 'monitors.json'), DEFAULT_MONITORS)
  const dataDir = resolveDataDir(settings.dataDir, appRoot)
  const repository = new FileRepository(dataDir, configDir)
  repository.writeConfig('settings.json', settings)
  repository.writeConfig('monitors.json', monitors)
  const ingest = new IngestService(repository, settings)

  const end = argValue('end', format(new Date(), 'yyyy-MM-dd'))!
  const start = argValue('start', settings.backfill.startDate)!
  const sourcesArg = argValue('sources', 'pboc,smm,cfets')!
  const sources = sourcesArg.split(/[,\s]+/).map((source) => source.trim()).filter(Boolean) as SourceId[]
  const ctx = { settings }

  console.log(`[backfill] ${start} ~ ${end} sources=${sources.join(',')} data=${dataDir}`)
  const allRaw: RawRecord[] = []
  const started = Date.now()

  if (sources.includes('pboc')) {
    console.log('[backfill] PBOC 汇率公告…')
    const records = await adapters.pboc.fetchRange(start, end, monitors, ctx)
    console.log(`[backfill] PBOC 抓取 ${records.length} 条`)
    allRaw.push(...records)
    await repository.appendRaw(records)
  }
  if (sources.includes('smm')) {
    console.log('[backfill] SMM ADC12/AZ91D…')
    const records = await adapters.smm.fetchRange(start, end, monitors, ctx)
    console.log(`[backfill] SMM 抓取 ${records.length} 条`)
    allRaw.push(...records)
    await repository.appendRaw(records)
  }
  if (sources.includes('cfets')) {
    const cfetsStart = start < format(subDays(parseISO(end), 730), 'yyyy-MM-dd') ? format(subDays(parseISO(end), 730), 'yyyy-MM-dd') : start
    console.log(`[backfill] CFETS 校验数据 ${cfetsStart} ~ ${end}…`)
    const records = await adapters.cfets.fetchRange(cfetsStart, end, monitors, ctx)
    console.log(`[backfill] CFETS 抓取 ${records.length} 条`)
    allRaw.push(...records)
    await repository.appendRaw(records)
  }

  console.log('[backfill] 校验 PBOC + SMM 记录…')
  const result = await ingest.ingestRecords(
    allRaw.filter((record) => record.source === 'pboc' || record.source === 'smm'),
    monitors,
    { onProgress: (event) => {
      if (event.current % 500 === 0 || event.phase === 'validate') console.log(`[backfill] ${event.message}`)
    } }
  )
  console.log(`[backfill] 有效 ${result.valid.length}，隔离 ${result.invalid.length}，跳过 ${result.skipped}`)
  console.log('[backfill] 重算多级均值…')
  await ingest.recomputeAggregates(monitors)
  const aggregates = await repository.readAggregates()
  console.log(`[backfill] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s，均值记录 ${aggregates.length} 条`)
}

main().catch((error) => {
  console.error('[backfill] 失败:', error)
  process.exitCode = 1
})
