import Decimal from 'decimal.js'
import type { AppSettings, MonitorConfig, RawRecord, SourceId, ValidatedRecord, ValidationCheck, ValidationInfo } from '../../shared/types'
import { isValidDateKey, todayKey } from '../../shared/periods'

export interface ValidationContext {
  monitor: MonitorConfig
  settings: AppSettings
  previous?: ValidatedRecord
  crossSource?: RawRecord[]
  existing?: ValidatedRecord[]
}

const DOMAIN_BY_SOURCE: Record<SourceId, string[]> = {
  pboc: ['pbc.gov.cn'],
  cfets: ['chinamoney.com.cn'],
  smm: ['smm.cn'],
  asianmetal: ['asianmetal.cn']
}

function add(check: ValidationCheck[], rule: string, status: 'pass' | 'warn' | 'fail', message: string): void {
  check.push({ rule, status, message })
}

function isManualUrl(url: string): boolean {
  return url.startsWith('manual://') || url.startsWith('csv://')
}

function productGroup(monitor: MonitorConfig): string {
  return `${monitor.displayName} ${monitor.productId}`.toUpperCase().includes('AZ91D') ? 'az91d' : 'adc12'
}

export function validateRecord(record: RawRecord, ctx: ValidationContext): ValidationInfo {
  const checks: ValidationCheck[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const { monitor, settings } = ctx
  const validation = settings.validation

  add(checks, 'schema', 'pass', '必填字段完整')
  if (!record.id || !record.productId || !record.date || !record.value) {
    add(checks, 'schema', 'fail', '缺少必填字段')
    errors.push('缺少必填字段')
  }

  const dateOk = isValidDateKey(record.date) && record.date <= todayKey() && record.date >= '2000-01-01'
  add(checks, 'date', dateOk ? 'pass' : 'fail', dateOk ? `日期有效：${record.date}` : `日期无效或为未来日期：${record.date}`)
  if (!dateOk) errors.push('日期无效或为未来日期')

  let value: Decimal | undefined
  try {
    value = new Decimal(record.value)
  } catch {
    value = undefined
  }
  const numeric = value !== undefined && value.isFinite() && value.gt(0)
  add(checks, 'numeric', numeric ? 'pass' : 'fail', numeric ? `数值有效：${record.value}` : `数值无效：${record.value}`)
  if (!numeric) errors.push('数值无效')

  const expectedUnit = monitor.type === 'fx' ? 'CNY' : '元/吨'
  const unitOk = record.unit === expectedUnit || (monitor.type === 'metal' && record.unit.includes('元'))
  add(checks, 'unit', unitOk ? 'pass' : 'fail', unitOk ? `单位正确：${record.unit}` : `单位不符：${record.unit}，期望 ${expectedUnit}`)
  if (!unitOk) errors.push('单位不符')

  if (!isManualUrl(record.sourceUrl)) {
    const domains = DOMAIN_BY_SOURCE[record.source] ?? []
    let hostname = ''
    try {
      hostname = new URL(record.sourceUrl).hostname.toLowerCase()
    } catch {
      hostname = ''
    }
    const domainOk = domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    add(checks, 'source-domain', domainOk ? 'pass' : 'fail', domainOk ? '来源域名可信' : `来源域名不在白名单：${record.sourceUrl}`)
    if (!domainOk) errors.push('来源域名不在白名单')
  } else {
    add(checks, 'source-domain', 'pass', '手动录入来源，使用本地凭证')
  }

  if (value && numeric) {
    const min = monitor.type === 'fx' ? validation.minFx : validation.minMetal
    const max = monitor.type === 'fx' ? validation.maxFx : validation.maxMetal
    const rangeOk = value.gte(min) && value.lte(max)
    add(checks, 'range', rangeOk ? 'pass' : 'fail', rangeOk ? `在合理区间 ${min}~${max}` : `超出合理区间 ${min}~${max}`)
    if (!rangeOk) errors.push('超出合理数值区间')
  }

  if (value && numeric && ctx.previous) {
    try {
      const previous = new Decimal(ctx.previous.value)
      if (previous.gt(0)) {
        const pct = value.minus(previous).div(previous).mul(100).abs()
        const threshold = monitor.type === 'fx' ? validation.fxChangePct : validation.metalChangePct
        const changeOk = pct.lte(threshold)
        add(
          checks,
          'change',
          changeOk ? 'pass' : 'warn',
          changeOk
            ? `较上一有效值波动 ${pct.toFixed(2)}%，在阈值 ${threshold}% 内`
            : `较上一有效值波动 ${pct.toFixed(2)}%，超过阈值 ${threshold}%`
        )
        if (!changeOk) warnings.push(`日波动 ${pct.toFixed(2)}% 超过阈值 ${threshold}%`)
      }
    } catch {
      warnings.push('上一有效值无法解析，跳过波动校验')
    }
  }

  let crossSourceInfo: ValidationInfo['crossSource'] | undefined
  if (value && numeric && ctx.crossSource?.length) {
    const sameDate = ctx.crossSource.filter((r) => r.date === record.date)
    if (sameDate.length) {
      const other = sameDate[0]
      try {
        const otherValue = new Decimal(other.value)
        const tolerance =
          monitor.type === 'fx' ? new Decimal(validation.fxCrossTolerance) : new Decimal(validation.metalCrossTolerance)
        let diff: Decimal
        let passed: boolean
        let diffText: string
        let toleranceText: string
        if (monitor.type === 'fx') {
          diff = value.minus(otherValue).abs()
          passed = diff.lte(tolerance)
          diffText = diff.toFixed(6)
          toleranceText = tolerance.toString()
        } else {
          diff = value.minus(otherValue).abs().div(otherValue).mul(100)
          passed = diff.lte(tolerance)
          diffText = `${diff.toFixed(2)}%`
          toleranceText = `${tolerance.toString()}%`
        }
        add(
          checks,
          'cross-source',
          passed ? 'pass' : 'warn',
          passed
            ? `与 ${other.source} 偏差 ${diffText}，在容差 ${toleranceText} 内`
            : `与 ${other.source} 偏差 ${diffText}，超过容差 ${toleranceText}`
        )
        if (!passed) {
          warnings.push(`多源偏差 ${diffText} 超过容差 ${toleranceText}`)
          const strict = monitor.type === 'fx' ? validation.strictFxCrossSource : validation.strictMetalCrossSource
          if (strict) errors.push('多源偏差超过容差（严格模式）')
        }
        crossSourceInfo = {
          source: other.source,
          date: record.date,
          value: other.value,
          diff: diffText,
          tolerance: toleranceText,
          passed
        }
      } catch {
        warnings.push('多源比对值无法解析')
      }
    }
  }

  if (monitor.type === 'fx' && value && numeric && !ctx.crossSource?.some((r) => r.date === record.date)) {
    add(checks, 'cross-source', 'warn', '当日缺少 CFETS 第二信源')
    warnings.push('当日缺少 CFETS 第二信源')
  }

  if (ctx.existing?.some((r) => r.date === record.date && r.value !== record.value)) {
    add(checks, 'duplicate', 'warn', '同日存在不同历史值，已保留最新记录')
    warnings.push('同日存在不同历史值')
  } else {
    add(checks, 'duplicate', 'pass', '无重复冲突')
  }

  if (errors.length === 0) add(checks, 'overall', 'pass', '校验通过')
  else add(checks, 'overall', 'fail', errors.join('；'))

  return {
    status: errors.length ? 'invalid' : 'valid',
    checkedAt: new Date().toISOString(),
    checks,
    warnings,
    errors,
    crossSource: crossSourceInfo
  }
}

export function toValidated(record: RawRecord, validation: ValidationInfo): ValidatedRecord {
  return { ...record, validation }
}

export function groupKey(record: RawRecord): string {
  return `${record.source}:${record.productId}:${record.date}`
}

export function metalGroup(monitor: MonitorConfig): string {
  return productGroup(monitor)
}
