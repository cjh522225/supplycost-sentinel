import { addDays, differenceInCalendarDays, endOfMonth, format, isWeekend, parseISO, startOfMonth, startOfYear } from 'date-fns'
import type { PeriodType } from './types'

export const DATE_FORMAT = 'yyyy-MM-dd'

export function toDateKey(date: Date | string): string {
  if (typeof date === 'string') return date.slice(0, 10)
  return format(date, DATE_FORMAT)
}

export function todayKey(): string {
  return toDateKey(new Date())
}

export function monthKey(date: Date | string): string {
  return toDateKey(date).slice(0, 7)
}

export function quarterKey(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}

export function halfKey(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return `${d.getFullYear()}-H${d.getMonth() < 6 ? 1 : 2}`
}

export function yearKey(date: Date | string): string {
  return toDateKey(date).slice(0, 4)
}

export function periodKey(periodType: PeriodType, date: Date | string): string {
  switch (periodType) {
    case 'day':
      return toDateKey(date)
    case 'month':
      return monthKey(date)
    case 'quarter':
      return quarterKey(date)
    case 'half':
      return halfKey(date)
    case 'year':
      return yearKey(date)
  }
}

export interface DateRange {
  start: string
  end: string
}

export function periodRange(periodType: PeriodType, key: string): DateRange {
  if (periodType === 'day') return { start: key, end: key }
  if (periodType === 'month') {
    const d = parseISO(`${key}-01`)
    return { start: toDateKey(startOfMonth(d)), end: toDateKey(endOfMonth(d)) }
  }
  if (periodType === 'quarter') {
    const [year, q] = key.split('-Q')
    const month = (Number(q) - 1) * 3 + 1
    const start = new Date(Number(year), month - 1, 1)
    const end = new Date(Number(year), month + 2, 0)
    return { start: toDateKey(start), end: toDateKey(end) }
  }
  if (periodType === 'half') {
    const [year, h] = key.split('-H')
    const month = h === '1' ? 1 : 7
    const start = new Date(Number(year), month - 1, 1)
    const end = new Date(Number(year), month + 5, 0)
    return { start: toDateKey(start), end: toDateKey(end) }
  }
  const y = Number(key)
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

export function periodLabel(periodType: PeriodType, key: string): string {
  switch (periodType) {
    case 'day':
      return key
    case 'month':
      return `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`
    case 'quarter':
      return `${key.slice(0, 4)} 年第 ${key.slice(-1)} 季度`
    case 'half':
      return `${key.slice(0, 4)} 年${key.endsWith('1') ? '上' : '下'}半年`
    case 'year':
      return `${key} 年`
  }
}

export function previousPeriodKey(periodType: PeriodType, key: string): string {
  const range = periodRange(periodType, key)
  const start = parseISO(range.start)
  return periodKey(periodType, addDays(start, -1))
}

export function nextPeriodKey(periodType: PeriodType, key: string): string {
  const range = periodRange(periodType, key)
  const end = parseISO(range.end)
  return periodKey(periodType, addDays(end, 1))
}

export function isPartialPeriod(periodType: PeriodType, key: string, now = new Date()): boolean {
  const range = periodRange(periodType, key)
  const today = toDateKey(now)
  return range.start <= today && today <= range.end
}

export function countWeekdays(start: string, end: string): number {
  let cursor = parseISO(start)
  const last = parseISO(end)
  let count = 0
  while (differenceInCalendarDays(last, cursor) >= 0) {
    if (!isWeekend(cursor)) count += 1
    cursor = addDays(cursor, 1)
  }
  return count
}

export function enumerateDays(start: string, end: string): string[] {
  const days: string[] = []
  let cursor = parseISO(start)
  const last = parseISO(end)
  while (differenceInCalendarDays(last, cursor) >= 0) {
    days.push(toDateKey(cursor))
    cursor = addDays(cursor, 1)
  }
  return days
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = parseISO(value)
  if (Number.isNaN(parsed.getTime())) return false
  return format(parsed, DATE_FORMAT) === value
}

export function clampDateRange(start: string, end: string): DateRange {
  const s = start <= end ? start : end
  const e = start <= end ? end : start
  return { start: s, end: e }
}

export function quarterOfDate(date: Date | string): number {
  const d = typeof date === 'string' ? parseISO(date) : date
  return Math.floor(d.getMonth() / 3) + 1
}

export function halfOfDate(date: Date | string): number {
  const d = typeof date === 'string' ? parseISO(date) : date
  return d.getMonth() < 6 ? 1 : 2
}

export function startOfYearKey(key: string): string {
  return `${key.slice(0, 4)}-01-01`
}

export function endOfYearKey(key: string): string {
  return `${key}-12-31`
}

export function currentYear(): string {
  return String(new Date().getFullYear())
}

export { startOfYear }
