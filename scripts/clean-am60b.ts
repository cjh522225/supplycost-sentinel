import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listFilesRecursive } from '../src/core/storage/fileStore'
import { writeCsvAtomic } from '../src/core/storage/fileStore'

const dataDir = join(process.cwd(), 'data')
const targetProduct = '202004280005'
const rawColumns = ['date', 'source', 'productId', 'productName', 'value', 'low', 'high', 'unit', 'currency', 'fetchedAt', 'sourceUrl', 'contentHash']
const validatedColumns = [...rawColumns, 'validationStatus', 'warnings']

function cleanJsonFiles(root: string, columns: string[], label: string): void {
  let removed = 0
  let filesChanged = 0
  for (const file of listFilesRecursive(root)) {
    if (!file.endsWith('.json')) continue
    const records = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]
    if (!Array.isArray(records)) continue
    const kept = records.filter((record) => record.productId !== targetProduct)
    if (kept.length === records.length) continue
    removed += records.length - kept.length
    filesChanged += 1
    writeFileSync(file, JSON.stringify(kept, null, 2), 'utf8')
    const rows = kept.map((record) => ({
      ...record,
      validationStatus: (record.validation as { status?: string } | undefined)?.status ?? '',
      warnings: ((record.validation as { warnings?: string[] } | undefined)?.warnings ?? []).join(' | ')
    }))
    writeCsvAtomic(file.replace(/\.json$/, '.csv'), rows, columns)
    console.log(`[clean] ${label} ${file}: removed ${records.length - kept.length}`)
  }
  console.log(`[clean] ${label} removed=${removed} files=${filesChanged}`)
}

cleanJsonFiles(join(dataDir, 'raw', 'smm'), rawColumns, 'raw/smm')
cleanJsonFiles(join(dataDir, 'validated'), validatedColumns, 'validated')
cleanJsonFiles(join(dataDir, 'quarantine'), validatedColumns, 'quarantine')

const aggregateFiles = listFilesRecursive(join(dataDir, 'aggregates')).filter((file) => file.endsWith('.json'))
let aggregateRemoved = 0
for (const file of aggregateFiles) {
  const records = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]
  if (!Array.isArray(records)) continue
  const kept = records.filter((record) => record.productId !== targetProduct)
  if (kept.length === records.length) continue
  aggregateRemoved += records.length - kept.length
  writeFileSync(file, JSON.stringify(kept, null, 2), 'utf8')
  const columns = ['monitorId', 'monitorName', 'source', 'productId', 'unit', 'periodType', 'periodKey', 'startDate', 'endDate', 'mean', 'sum', 'count', 'min', 'max', 'firstDate', 'lastDate', 'coverage', 'partial', 'computedAt', 'formulaVersion']
  writeCsvAtomic(file.replace(/\.json$/, '.csv'), kept, columns)
  console.log(`[clean] aggregates ${file}: removed ${records.length - kept.length}`)
}
console.log(`[clean] aggregates removed=${aggregateRemoved}`)

const alertsDir = join(dataDir, 'alerts')
if (existsSync(alertsDir)) {
  rmSync(alertsDir, { recursive: true, force: true })
  console.log('[clean] alerts removed (will be regenerated)')
}
