import { _electron as electron } from 'playwright'

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, SUPPLYCOST_DISABLE_SCHEDULER: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
const page = await app.firstWindow()
await page.waitForTimeout(5000)
const results = await page.evaluate(async () => {
  const ids = ['history-means', 'local-files', 'rotation', 'cross-year', 'dynamic-config', 'data-accuracy']
  const out = {}
  for (const id of ids) {
    try {
      out[id] = await window.api.acceptanceRun(id)
    } catch (error) {
      out[id] = { error: error instanceof Error ? error.message : String(error) }
    }
  }
  return out
})
const summary = Object.fromEntries(
  Object.entries(results).map(([id, value]) => [
    id,
    {
      passed: value.passed,
      title: value.title,
      details: (value.details ?? []).slice(0, 4)
    }
  ])
)
console.log(JSON.stringify(summary, null, 2))
await app.close()
