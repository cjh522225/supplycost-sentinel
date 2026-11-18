import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'screenshots')
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: {
    ...process.env,
    SUPPLYCOST_DISABLE_SCHEDULER: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
})

const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})
await page.waitForTimeout(6000)
await page.screenshot({ path: join(outDir, 'dashboard.png') })

const routes = [
  ['history', 'history'],
  ['monitors', 'monitors'],
  ['alerts', 'alerts'],
  ['audit', 'audit'],
  ['assistant', 'assistant'],
  ['settings', 'settings'],
  ['acceptance', 'acceptance']
]
for (const [route, name] of routes) {
  await page.evaluate((hash) => {
    window.location.hash = `#/${hash}`
  }, route)
  await page.waitForTimeout(1500)
  if (name === 'acceptance') {
    const runAll = page.getByRole('button', { name: /运行全部检查/ })
    if (await runAll.count()) {
      await runAll.click()
      await page.waitForTimeout(9000)
    }
  }
  await page.screenshot({ path: join(outDir, `${name}.png`) })
}

console.log(JSON.stringify({ ok: true, errors }, null, 2))
await app.close()
