import clsx from 'clsx'
import { periodLabel as sharedPeriodLabel } from '@shared/periods'

export const cn = clsx

export function formatNumber(value?: string | number | null, precision = 2): string {
  if (value === undefined || value === null || value === '') return '—'
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  }).format(numeric)
}

export function formatCompact(value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return '—'
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  if (Math.abs(numeric) >= 10000) return `${(numeric / 10000).toFixed(2)} 万`
  return formatNumber(numeric, 0)
}

export function formatPct(value?: string | number | null, digits = 2): string {
  if (value === undefined || value === null || value === '') return '—'
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(digits)}%`
}

export function formatDate(value?: string | null): string {
  if (!value) return '—'
  return value.slice(0, 10)
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatRelative(value?: string | null): string {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function periodLabel(periodType: string, key: string): string {
  return sharedPeriodLabel(periodType as never, key)
}

export function sourceLabel(source?: string): string {
  const map: Record<string, string> = {
    pboc: 'PBOC',
    cfets: 'CFETS',
    smm: 'SMM',
    asianmetal: 'Asian Metal'
  }
  return source ? map[source] ?? source : '—'
}

export function severityColor(severity: string): string {
  if (severity === 'critical') return 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
  if (severity === 'warning') return 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
  return 'text-slate-600 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: '未处理',
    acknowledged: '已确认',
    resolved: '已解决',
    success: '成功',
    partial: '部分成功',
    failed: '失败',
    skipped: '跳过',
    valid: '有效',
    warning: '警告',
    'no-data': '无数据',
    invalid: '无效'
  }
  return map[status] ?? status
}

export function guessPrecision(unit: string): number {
  return unit === 'CNY' ? 4 : 2
}
