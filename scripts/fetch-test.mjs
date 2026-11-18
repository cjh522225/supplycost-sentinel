import { _electron as electron } from 'playwright'

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, SUPPLYCOST_DISABLE_SCHEDULER: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
const page = await app.firstWindow()
await page.waitForTimeout(5000)
const result = await page.evaluate(async () => {
  const fetchResult = await window.api.runFetch({ date: '2026-10-27' })
  const chat = await window.api.llmChat({
    messages: [{ role: 'user', content: '请总结当前监测数据，并说明有哪些预警。' }],
    mode: 'chat'
  })
  const dashboard = await window.api.dashboard()
  return {
    fetch: fetchResult,
    chat: { ok: chat.ok, fallback: chat.fallback, provider: chat.provider, content: chat.content.slice(0, 300), citations: chat.citations.slice(0, 3) },
    monitors: dashboard.monitors.map((view) => ({ id: view.monitor.id, latest: view.latest?.value, date: view.latest?.date })),
    quality: dashboard.quality
  }
})
console.log(JSON.stringify(result, null, 2))
await app.close()
