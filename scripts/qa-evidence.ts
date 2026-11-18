import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, MonitorConfig, RawRecord, ValidatedRecord } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/constants'
import { hashObject } from '../src/core/storage/fileStore'
import { FileRepository } from '../src/core/storage/repository'
import { validateRecord } from '../src/core/validation/pipeline'
import { generateAlerts, latestFromRecord } from '../src/core/alerts/engine'

function rawRecord(overrides: Partial<RawRecord>): RawRecord {
  return {
    id: 'smm:201102250397:2026-10-27:qa',
    source: 'smm',
    productId: '201102250397',
    productName: 'SMM铝合金ADC12',
    date: '2026-10-27',
    value: '25000',
    unit: '元/吨',
    fetchedAt: new Date().toISOString(),
    sourceUrl: 'https://platform.smm.cn/qa-fixture',
    contentHash: hashObject(overrides),
    parserVersion: 'qa-v1',
    meta: { qa: true },
    ...overrides
  }
}

async function main(): Promise<void> {
  const root = mkdtempSync('D:\\QA\\evidence-')
  const settings: AppSettings = { ...DEFAULT_SETTINGS, dataDir: 'data' }
  const repository = new FileRepository(join(root, 'data'), join(root, 'config'))
  const monitor: MonitorConfig = {
    id: 'smm-adc12',
    type: 'metal',
    source: 'smm',
    productId: '201102250397',
    displayName: 'SMM ADC12 QA',
    unit: '元/吨',
    precision: 2,
    enabled: true,
    thresholds: { high: 24000, changePct: 2 }
  }

  const validRaw = rawRecord({ id: 'smm:201102250397:2026-10-27:valid' })
  const validInfo = validateRecord(validRaw, { monitor, settings, crossSource: [] })
  const valid: ValidatedRecord = { ...validRaw, validation: validInfo }
  await repository.appendValidated([valid])
  const alerts = generateAlerts({
    monitor,
    latest: latestFromRecord(valid),
    settings,
    lastDate: valid.date
  })
  await repository.appendAlerts(alerts)

  const invalidRaw = rawRecord({
    id: 'smm:201102250397:2026-10-28:invalid',
    date: '2026-10-28',
    value: '0',
    unit: 'invalid-unit'
  })
  const invalidInfo = validateRecord(invalidRaw, { monitor, settings, crossSource: [] })
  await repository.appendQuarantine([{ ...invalidRaw, validation: invalidInfo }])

  const storedAlerts = await repository.readAlerts()
  const storedQuarantine = await repository.readQuarantine()
  console.log(JSON.stringify({
    root,
    validStatus: validInfo.status,
    invalidStatus: invalidInfo.status,
    invalidErrors: invalidInfo.errors,
    alerts: storedAlerts.map((alert) => ({ id: alert.id, type: alert.type, severity: alert.severity, status: alert.status })),
    quarantine: storedQuarantine.map((record) => ({ id: record.id, errors: record.validation.errors })),
    files: (await repository.listFiles()).map((file) => file.relativePath)
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
