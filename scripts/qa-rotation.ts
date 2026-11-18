import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashText } from '../src/core/storage/fileStore'
import { FileRepository } from '../src/core/storage/repository'

async function main(): Promise<void> {
  const qaRoot = 'D:\\QA\\supplycost-sentinel-qa\\win-unpacked'
  const dataDir = join(qaRoot, 'data')
  const configDir = join(qaRoot, 'config')
  const repository = new FileRepository(dataDir, configDir)
  const oldSample = join(dataDir, 'validated', '2026', '2026-10.json')
  const before = hashText(readFileSync(oldSample, 'utf8'))
  const created = await repository.ensurePeriod('2026-11-01')
  const after = hashText(readFileSync(oldSample, 'utf8'))
  const audit = await repository.readAudit()
  const rotation = audit.rotationLogs.filter((log) => log.periodKey === '2026-11' || log.periodKey === '2027')
  const out = {
    qaRoot,
    oldFileUnchanged: before === after,
    created: created.map((path) => path.replace(dataDir, '')),
    rotationLogs: rotation.slice(0, 10)
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
