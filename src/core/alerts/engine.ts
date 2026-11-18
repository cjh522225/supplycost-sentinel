import Decimal from 'decimal.js'
import type { AggregateRecord, AlertRecord, AppSettings, LatestValue, MonitorConfig, ValidatedRecord } from '../../shared/types'
import { todayKey } from '../../shared/periods'

export interface AlertContext {
  monitor: MonitorConfig
  latest?: LatestValue
  previous?: LatestValue
  month?: AggregateRecord
  previousMonth?: AggregateRecord
  lastDate?: string
  settings: AppSettings
  now?: Date
}

function alertId(monitorId: string, type: string, date: string, suffix = ''): string {
  return `${monitorId}:${type}:${date}${suffix ? `:${suffix}` : ''}`
}

export function generateAlerts(ctx: AlertContext): AlertRecord[] {
  const { monitor, latest, previous, month, previousMonth, settings } = ctx
  const now = ctx.now ?? new Date()
  const createdAt = now.toISOString()
  const alerts: AlertRecord[] = []
  const date = latest?.date ?? todayKey()

  if (!latest) {
    if (!monitor.manual) {
      alerts.push({
        id: alertId(monitor.id, 'no-data', date),
        monitorId: monitor.id,
        monitorName: monitor.displayName,
        type: 'no-data',
        severity: 'warning',
        title: `${monitor.displayName} 暂无有效数据`,
        message: '当前监测标的没有通过校验的数据，请检查抓取任务或手动录入。',
        date,
        status: 'open',
        createdAt,
        evidence: { monitorId: monitor.id }
      })
    }
    return alerts
  }

  const value = new Decimal(latest.value)
  const thresholds = monitor.thresholds ?? {}
  if (thresholds.high !== undefined && value.gt(thresholds.high)) {
    alerts.push({
      id: alertId(monitor.id, 'threshold-high', date, String(thresholds.high)),
      monitorId: monitor.id,
      monitorName: monitor.displayName,
      type: 'threshold-high',
      severity: 'critical',
      title: `${monitor.displayName} 突破上限`,
      message: `最新值 ${value.toFixed(monitor.precision)} ${monitor.unit} 高于阈值 ${thresholds.high}。`,
      date,
      value: value.toString(),
      threshold: String(thresholds.high),
      status: 'open',
      createdAt,
      evidence: { latest, threshold: thresholds.high }
    })
  }
  if (thresholds.low !== undefined && value.lt(thresholds.low)) {
    alerts.push({
      id: alertId(monitor.id, 'threshold-low', date, String(thresholds.low)),
      monitorId: monitor.id,
      monitorName: monitor.displayName,
      type: 'threshold-low',
      severity: 'critical',
      title: `${monitor.displayName} 跌破下限`,
      message: `最新值 ${value.toFixed(monitor.precision)} ${monitor.unit} 低于阈值 ${thresholds.low}。`,
      date,
      value: value.toString(),
      threshold: String(thresholds.low),
      status: 'open',
      createdAt,
      evidence: { latest, threshold: thresholds.low }
    })
  }

  if (previous) {
    const previousValue = new Decimal(previous.value)
    if (previousValue.gt(0)) {
      const pct = value.minus(previousValue).div(previousValue).mul(100)
      const abs = pct.abs()
      const threshold = thresholds.changePct ?? (monitor.type === 'fx' ? settings.validation.fxChangePct : settings.validation.metalChangePct)
      if (abs.gte(threshold)) {
        alerts.push({
          id: alertId(monitor.id, 'change-pct', date, String(threshold)),
          monitorId: monitor.id,
          monitorName: monitor.displayName,
          type: 'change-pct',
          severity: 'warning',
          title: `${monitor.displayName} 日波动 ${pct.toFixed(2)}%`,
          message: `最新值较上一有效值变动 ${pct.toFixed(2)}%，超过阈值 ${threshold}%。`,
          date,
          value: pct.toFixed(4),
          threshold: String(threshold),
          status: 'open',
          createdAt,
          evidence: { latest, previous, threshold }
        })
      }
    }
  }

  if (month && previousMonth && new Decimal(month.count).gt(0) && new Decimal(previousMonth.count).gt(0)) {
    const current = new Decimal(month.mean)
    const previousMean = new Decimal(previousMonth.mean)
    if (previousMean.gt(0)) {
      const pct = current.minus(previousMean).div(previousMean).mul(100)
      if (pct.abs().gte(5)) {
        alerts.push({
          id: alertId(monitor.id, 'period-deviation', month.periodKey),
          monitorId: monitor.id,
          monitorName: monitor.displayName,
          type: 'period-deviation',
          severity: 'warning',
          title: `${monitor.displayName} 月均偏离 ${pct.toFixed(2)}%`,
          message: `${month.periodKey} 月均 ${current.toFixed(monitor.precision)} 较上月 ${previousMean.toFixed(monitor.precision)} 变动 ${pct.toFixed(2)}%。`,
          date,
          value: pct.toFixed(4),
          threshold: '5',
          status: 'open',
          createdAt,
          evidence: { month, previousMonth }
        })
      }
    }
  }

  if (ctx.lastDate) {
    const last = ctx.lastDate
    const staleDays = Math.floor((new Date(todayKey()).getTime() - new Date(last).getTime()) / 86400000)
    if (staleDays > 7) {
      alerts.push({
        id: alertId(monitor.id, 'stale-data', last),
        monitorId: monitor.id,
        monitorName: monitor.displayName,
        type: 'stale-data',
        severity: 'info',
        title: `${monitor.displayName} 数据已 ${staleDays} 天未更新`,
        message: `最后有效数据日期为 ${last}，请检查抓取任务或数据源状态。`,
        date: last,
        status: 'open',
        createdAt,
        evidence: { lastDate: last, staleDays }
      })
    }
  }

  return alerts
}

export function qualityAlerts(input: {
  quarantined: number
  failedFetch?: string
  crossSourceWarnings?: string[]
  now?: Date
}): AlertRecord[] {
  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const date = todayKey()
  const alerts: AlertRecord[] = []
  if (input.quarantined > 0) {
    alerts.push({
      id: `system:quarantine:${date}:${input.quarantined}`,
      monitorId: 'system',
      monitorName: '数据质量',
      type: 'quarantine',
      severity: 'warning',
      title: `存在 ${input.quarantined} 条未通过校验的数据`,
      message: '未通过校验的数据已进入隔离区，不会进入展示层。请在数据审计中复核。',
      date,
      status: 'open',
      createdAt,
      evidence: { quarantined: input.quarantined }
    })
  }
  if (input.failedFetch) {
    alerts.push({
      id: `system:fetch-failed:${date}`,
      monitorId: 'system',
      monitorName: '抓取任务',
      type: 'fetch-failed',
      severity: 'critical',
      title: '数据抓取失败',
      message: input.failedFetch,
      date,
      status: 'open',
      createdAt,
      evidence: { error: input.failedFetch }
    })
  }
  for (const warning of input.crossSourceWarnings ?? []) {
    alerts.push({
      id: `system:cross-source:${date}:${warning.slice(0, 40)}`,
      monitorId: 'system',
      monitorName: '多源校验',
      type: 'cross-source',
      severity: 'info',
      title: '多源偏差提示',
      message: warning,
      date,
      status: 'open',
      createdAt,
      evidence: { warning }
    })
  }
  return alerts
}

export function latestFromRecord(record?: ValidatedRecord): LatestValue | undefined {
  if (!record) return undefined
  return {
    date: record.date,
    value: record.value,
    unit: record.unit,
    source: record.source,
    fetchedAt: record.fetchedAt,
    validationStatus: record.validation.warnings.length ? 'warning' : 'valid'
  }
}
