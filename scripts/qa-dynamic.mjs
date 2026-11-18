import { _electron as electron } from 'playwright'
import { writeFileSync } from 'node:fs'

const executablePath = 'D:\\QA\\supplycost-sentinel-qa\\win-unpacked\\链价智控.exe'
const app = await electron.launch({
  executablePath,
  args: [],
  env: { ...process.env, SUPPLYCOST_DISABLE_SCHEDULER: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
const page = await app.firstWindow()
await page.waitForTimeout(5000)
const result = await page.evaluate(async () => {
  const original = await window.api.listMonitors()
  const originalEur = original.find((monitor) => monitor.id === 'fx-eur')
  const originalAz = original.find((monitor) => monitor.id === 'smm-az91d')
  const logs = []
  const gbp = {
    id: 'fx-gbp',
    type: 'fx',
    source: 'pboc',
    productId: 'GBP',
    displayName: '英镑/人民币',
    unit: 'CNY',
    precision: 4,
    enabled: true,
    color: '#0891b2',
    thresholds: { changePct: 1.5 }
  }
  try {
    await window.api.saveMonitor(gbp)
    let dashboard = await window.api.dashboard()
    logs.push({ step: 'add-gbp', found: dashboard.monitors.some((view) => view.monitor.id === 'fx-gbp') })
    await window.api.deleteMonitor('fx-eur')
    dashboard = await window.api.dashboard()
    logs.push({ step: 'remove-eur', hidden: !dashboard.monitors.some((view) => view.monitor.id === 'fx-eur') })
    if (originalEur) await window.api.saveMonitor(originalEur)
    const am60 = { ...originalAz, productId: '202004280005', displayName: 'SMM AM60B', thresholds: { changePct: 2.5 } }
    await window.api.saveMonitor(am60)
    dashboard = await window.api.dashboard()
    const am60View = dashboard.monitors.find((view) => view.monitor.id === 'smm-az91d')
    logs.push({
      step: 'replace-az91d',
      name: am60View?.monitor.displayName,
      latest: am60View?.latest?.value,
      monthMean: am60View?.means.month?.mean,
      availableFrom: am60View?.availableFrom,
      passed: am60View?.monitor.displayName === 'SMM AM60B' && Boolean(am60View?.latest)
    })
    if (originalAz) await window.api.saveMonitor(originalAz)
    await window.api.deleteMonitor('fx-gbp')
    dashboard = await window.api.dashboard()
    logs.push({
      step: 'restore',
      count: dashboard.monitors.length,
      names: dashboard.monitors.map((view) => view.monitor.displayName),
      passed: dashboard.monitors.length === 6 && dashboard.monitors.some((view) => view.monitor.id === 'fx-eur')
    })
    return { logs }
  } catch (error) {
    return { logs, error: error instanceof Error ? error.message : String(error) }
  }
})
writeFileSync('D:\\QA\\qa-dynamic.json', JSON.stringify(result, null, 2), 'utf8')
console.log(JSON.stringify(result, null, 2))
await app.close()
