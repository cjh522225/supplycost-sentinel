import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, MonitorConfig } from '../src/shared/types'
import { DEFAULT_MONITORS, DEFAULT_SETTINGS } from '../src/shared/constants'
import { FileRepository } from '../src/core/storage/repository'
import { IngestService } from '../src/core/services/ingest'

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'supplycost-manual-'))
  try {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, dataDir: 'data' }
    const repository = new FileRepository(join(root, 'data'), join(root, 'config'))
    const ingest = new IngestService(repository, settings)
    const monitor = DEFAULT_MONITORS.find((item) => item.id === 'am-adc12') as MonitorConfig
    const result = await ingest.addManual(
      {
        date: '2026-10-27',
        productId: 'am-adc12',
        productName: 'Asian Metal ADC12 中国交到',
        low: '24300',
        high: '24500',
        unit: '元/吨',
        sourceUrl: 'https://www.asianmetal.cn/',
        note: '测试录入'
      },
      monitor
    )
    console.log(JSON.stringify({
      valid: result.valid.length,
      invalid: result.invalid.length,
      value: result.valid[0]?.value,
      warnings: result.valid[0]?.validation.warnings,
      aggregates: (await repository.readAggregates()).filter((record) => record.monitorId === 'am-adc12').length,
      files: (await repository.listFiles()).length
    }, null, 2))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
