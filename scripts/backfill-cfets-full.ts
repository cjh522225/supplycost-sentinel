import { join } from 'node:path'
import type { AppSettings, MonitorConfig } from '../src/shared/types'
import { DEFAULT_MONITORS, DEFAULT_SETTINGS } from '../src/shared/constants'
import { readJsonFile } from '../src/core/storage/fileStore'
import { resolveDataDir } from '../src/core/storage/paths'
import { FileRepository } from '../src/core/storage/repository'
import { IngestService } from '../src/core/services/ingest'
import { cfetsAdapter } from '../src/core/adapters'

function mergeSettings(saved: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(saved.schedule ?? {}) },
    precision: { ...DEFAULT_SETTINGS.precision, ...(saved.precision ?? {}) },
    validation: { ...DEFAULT_SETTINGS.validation, ...(saved.validation ?? {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(saved.llm ?? {}) },
    backfill: { ...DEFAULT_SETTINGS.backfill, ...(saved.backfill ?? {}) }
  }
}

async function main(): Promise<void> {
  const root = process.cwd()
  const configDir = join(root, 'config')
  const settings = mergeSettings(readJsonFile<Partial<AppSettings>>(join(configDir, 'settings.json'), {}))
  const monitors = readJsonFile<MonitorConfig[]>(join(configDir, 'monitors.json'), DEFAULT_MONITORS)
  const repository = new FileRepository(resolveDataDir(settings.dataDir, root), configDir)
  const ingest = new IngestService(repository, settings)
  const ctx = { settings }

  console.log('[cfets-full] fetching 2015-01-01 ~ 2022-12-31 ...')
  const records = await cfetsAdapter.fetchRange('2015-01-01', '2022-12-31', monitors, ctx)
  console.log(`[cfets-full] fetched ${records.length}`)
  if (records.length === 0) throw new Error('CFETS 2015-2022 抓取为 0，停止回填')
  await repository.appendRaw(records)

  const fxMonitors = monitors.filter((monitor) => monitor.source === 'pboc' && monitor.type === 'fx')
  let valid = 0
  let invalid = 0
  for (const monitor of fxMonitors) {
    for (const year of ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']) {
      const raw = await repository.readRawRange('pboc', monitor.productId, `${year}-01-01`, `${year}-12-31`)
      if (raw.records.length === 0) continue
      const result = await ingest.ingestRecords(raw.records, monitors, {
        onProgress: (event) => {
          if (event.current % 500 === 0) console.log(`[cfets-full] ${monitor.productId} ${year}: ${event.message}`)
        }
      })
      valid += result.valid.length
      invalid += result.invalid.length
      console.log(`[cfets-full] revalidate ${monitor.productId} ${year}: valid=${result.valid.length} invalid=${result.invalid.length}`)
    }
  }
  console.log(`[cfets-full] revalidated valid=${valid} invalid=${invalid}`)
  console.log('[cfets-full] recomputing aggregates ...')
  await ingest.recomputeAggregates(monitors)
  const aggregates = await repository.readAggregates()
  console.log(`[cfets-full] done, aggregates=${aggregates.length}`)
}

main().catch((error) => {
  console.error('[cfets-full] failed:', error)
  process.exitCode = 1
})
