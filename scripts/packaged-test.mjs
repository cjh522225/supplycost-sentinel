import { _electron as electron } from 'playwright'
import { join } from 'node:path'

const executablePath = join(process.cwd(), 'dist', 'win-unpacked', '链价智控.exe')
const app = await electron.launch({
  executablePath,
  args: [],
  env: { ...process.env, SUPPLYCOST_DISABLE_SCHEDULER: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
await page.waitForTimeout(6000)
const info = await page.evaluate(async () => {
  const dashboard = await window.api.dashboard()
  return {
    title: document.title,
    monitors: dashboard.monitors.map((view) => ({ id: view.monitor.id, latest: view.latest?.value, date: view.latest?.date })),
    valid: dashboard.quality.valid,
    dataDir: (await window.api.fetchStatus()).dataDir,
    path: location.hash
  }
})
await page.screenshot({ path: join(process.cwd(), 'screenshots', 'packaged-dashboard.png') })
console.log(JSON.stringify({ info, errors }, null, 2))
await app.close()
