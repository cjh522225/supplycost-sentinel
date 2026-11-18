const fs = require('node:fs')
const path = require('node:path')

const configDir = path.join(process.cwd(), 'config')
const monitorsPath = path.join(configDir, 'monitors.json')
const order = ['fx-eur', 'fx-usd', 'smm-adc12', 'smm-az91d', 'am-adc12', 'am-az91d']

if (fs.existsSync(monitorsPath)) {
  const monitors = JSON.parse(fs.readFileSync(monitorsPath, 'utf8'))
  monitors.sort((a, b) => {
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  fs.writeFileSync(monitorsPath, JSON.stringify(monitors, null, 2), 'utf8')
  console.log(`monitors normalized: ${monitors.map((m) => m.id).join(', ')}`)
}

const schedulerPath = path.join(configDir, 'scheduler.json')
if (fs.existsSync(schedulerPath)) {
  fs.unlinkSync(schedulerPath)
  console.log('scheduler state removed')
}
