import { _electron as electron } from 'playwright'
import { join } from 'node:path'

const root = process.cwd()
const out = join(root, 'docs', 'report-assets')
const app = await electron.launch({
  executablePath: join(root, 'dist', 'win-unpacked', '链价智控.exe'),
  args: [],
  env: { ...process.env, SUPPLYCOST_DISABLE_SCHEDULER: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
const page = await app.firstWindow()
await page.waitForTimeout(6000)
await page.screenshot({ path: join(out, 'dashboard.png') })

await page.evaluate(() => { window.location.hash = '#/history' })
await page.waitForTimeout(1800)
const selects = page.locator('select')
if (await selects.count()) {
  const options = await selects.first().locator('option').allTextContents()
  const target = options.find((text) => text.includes('SMM ADC12'))
  if (target) await selects.first().selectOption({ label: target })
}
await page.waitForTimeout(2200)
await page.screenshot({ path: join(out, 'history.png') })

await page.evaluate(() => { window.location.hash = '#/acceptance' })
await page.waitForTimeout(1600)
const runAll = page.getByRole('button', { name: /运行全部检查/ })
if (await runAll.count()) {
  await runAll.click()
  await page.waitForTimeout(10000)
}
await page.screenshot({ path: join(out, 'acceptance.png') })

await page.evaluate(() => { window.location.hash = '#/audit' })
await page.waitForTimeout(1800)
await page.screenshot({ path: join(out, 'audit.png') })

console.log('screenshots written')
await app.close()
