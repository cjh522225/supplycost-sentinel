import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDataDir } from '../src/core/storage/paths'
import { FileRepository } from '../src/core/storage/repository'
import { DEFAULT_SETTINGS } from '../src/shared/constants'

async function main(): Promise<void> {
  const root = process.cwd()
  const repository = new FileRepository(resolveDataDir(DEFAULT_SETTINGS.dataDir, root), join(root, 'config'))
  const aggregates = await repository.readAggregates()
  const selects = [
    ['fx-eur', '2022-06', 'month'],
    ['fx-eur', '2024-08', 'month'],
    ['smm-adc12', '2022-06', 'month'],
    ['smm-adc12', '2024-08', 'month'],
    ['fx-eur', '2023', 'year'],
    ['fx-eur', '2024', 'year']
  ] as const
  const result = selects.map(([monitorId, periodKey, periodType]) => {
    const record = aggregates.find((item) => item.monitorId === monitorId && item.periodKey === periodKey && item.periodType === periodType)
    return record
      ? {
          monitorId,
          periodType,
          periodKey,
          mean: record.mean,
          sum: record.sum,
          count: record.count,
          coverage: record.coverage,
          meanBasis: record.meanBasis,
          coverageBasis: record.coverageBasis,
          availableDays: record.availableDays,
          expectedWeekdays: record.expectedWeekdays,
          firstDate: record.firstDate,
          lastDate: record.lastDate
        }
      : { monitorId, periodType, periodKey, missing: true }
  })
  const out = join('D:\\QA', 'qa-samples.json')
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), result }, null, 2), 'utf8')
  console.log(JSON.stringify({ out, result }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
