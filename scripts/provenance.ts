import { join } from 'node:path'
import { writeCsvAtomic } from '../src/core/storage/fileStore'
import { resolveDataDir } from '../src/core/storage/paths'
import { FileRepository } from '../src/core/storage/repository'
import { DEFAULT_SETTINGS } from '../src/shared/constants'
import type { AppSettings } from '../src/shared/types'

async function main(): Promise<void> {
  const root = process.cwd()
  const settings: AppSettings = { ...DEFAULT_SETTINGS, dataDir: 'data' }
  const repository = new FileRepository(resolveDataDir(settings.dataDir, root), join(root, 'config'))
  const dates = ['2015-06-15', '2018-06-15', '2020-06-15', '2022-06-15', '2024-08-15', '2026-09-15']
  const rows: Record<string, unknown>[] = []
  for (const date of dates) {
    for (const [source, productId] of [
      ['pboc', 'EUR'],
      ['smm', '201102250397'],
      ['smm', '202004280003']
    ] as const) {
      const range = await repository.readRawRange(source, productId, date, date)
      for (const record of range.records) {
        rows.push({
          sample_date: date,
          source: record.source,
          product_id: record.productId,
          product_name: record.productName,
          value: record.value,
          unit: record.unit,
          source_url: record.sourceUrl,
          fetched_at: record.fetchedAt,
          content_hash: record.contentHash,
          parser_version: record.parserVersion
        })
      }
    }
  }
  const path = join(repository.dataDir, 'provenance', 'source-attestation.csv')
  writeCsvAtomic(path, rows, [
    'sample_date',
    'source',
    'product_id',
    'product_name',
    'value',
    'unit',
    'source_url',
    'fetched_at',
    'content_hash',
    'parser_version'
  ])
  console.log(`provenance written: ${path} rows=${rows.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
