import { join } from 'node:path'
import type { AppSettings, MonitorConfig } from '../src/shared/types'
import { DEFAULT_MONITORS, DEFAULT_SETTINGS } from '../src/shared/constants'
import { readJsonFile } from '../src/core/storage/fileStore'
import { resolveDataDir } from '../src/core/storage/paths'
import { FileRepository } from '../src/core/storage/repository'
import { IngestService } from '../src/core/services/ingest'

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
  const appRoot = process.cwd()
  const configDir = join(appRoot, 'config')
  const settings = mergeSettings(readJsonFile<Partial<AppSettings>>(join(configDir, 'settings.json'), {}))
  const monitors = readJsonFile<MonitorConfig[]>(join(configDir, 'monitors.json'), DEFAULT_MONITORS)
  const repository = new FileRepository(resolveDataDir(settings.dataDir, appRoot), configDir)
  const ingest = new IngestService(repository, settings)
  console.log(`[recompute] ${monitors.length} monitors, data=${repository.dataDir}`)
  await ingest.recomputeAggregates(monitors)
  const aggregates = await repository.readAggregates()
  console.log(`[recompute] done, ${aggregates.length} aggregate records`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
