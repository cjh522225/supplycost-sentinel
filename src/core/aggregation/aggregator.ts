import Decimal from 'decimal.js'
import type { AggregateRecord, MonitorConfig, PeriodType, ValidatedRecord } from '../../shared/types'
import { FORMULA_VERSION } from '../../shared/constants'
import { countWeekdays, periodKey, periodRange, toDateKey } from '../../shared/periods'

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP })

const PERIOD_TYPES: PeriodType[] = ['day', 'month', 'quarter', 'half', 'year']
const PERIOD_ORDER: Record<PeriodType, number> = { day: 0, month: 1, quarter: 2, half: 3, year: 4 }

export interface AggregateOptions {
  now?: Date
  sourceFiles?: string[]
  sourceFileForDate?: (date: string) => string
}

export function buildDailyValues(records: ValidatedRecord[]): Map<string, Decimal> {
  const grouped = new Map<string, Decimal[]>()
  for (const record of records) {
    const values = grouped.get(record.date) ?? []
    values.push(new Decimal(record.value))
    grouped.set(record.date, values)
  }
  const result = new Map<string, Decimal>()
  for (const [date, values] of grouped) {
    const sum = values.reduce((acc, value) => acc.add(value), new Decimal(0))
    result.set(date, sum.div(values.length))
  }
  return result
}

export function aggregateMonitor(
  monitor: MonitorConfig,
  records: ValidatedRecord[],
  options: AggregateOptions = {}
): AggregateRecord[] {
  const now = options.now ?? new Date()
  const today = toDateKey(now)
  const filtered = records
    .filter((record) => record.source === monitor.source && record.productId === monitor.productId)
    .sort((a, b) => a.date.localeCompare(b.date))
  const daily = buildDailyValues(filtered)
  if (daily.size === 0) return []

  const result: AggregateRecord[] = []
  for (const periodType of PERIOD_TYPES) {
    const buckets = new Map<string, { date: string; value: Decimal }[]>()
    for (const [date, value] of daily) {
      const key = periodKey(periodType, date)
      const bucket = buckets.get(key) ?? []
      bucket.push({ date, value })
      buckets.set(key, bucket)
    }
    for (const [key, entries] of buckets) {
      entries.sort((a, b) => a.date.localeCompare(b.date))
      const range = periodRange(periodType, key)
      const sum = entries.reduce((acc, entry) => acc.add(entry.value), new Decimal(0))
      const mean = sum.div(entries.length)
      const values = entries.map((entry) => entry.value)
      const partial = periodType === 'day' ? key === today : range.start <= today && today <= range.end
      const expectedEnd = partial && range.end > today ? today : range.end
      const expected = countWeekdays(range.start, expectedEnd)
      const coverage = expected > 0 ? new Decimal(entries.length).div(expected).mul(100) : new Decimal(100)
      const sourceFiles = options.sourceFileForDate
        ? [
            ...new Set(
              entries
                .map((entry) => options.sourceFileForDate?.(entry.date))
                .filter((file): file is string => Boolean(file))
            )
          ].sort()
        : [...new Set(options.sourceFiles ?? [])].sort()
      result.push({
        monitorId: monitor.id,
        monitorName: monitor.displayName,
        source: monitor.source,
        productId: monitor.productId,
        unit: monitor.unit,
        periodType,
        periodKey: key,
        startDate: range.start,
        endDate: range.end,
        mean: mean.toString(),
        sum: sum.toString(),
        count: entries.length,
        min: Decimal.min(...values).toString(),
        max: Decimal.max(...values).toString(),
        firstDate: entries[0].date,
        lastDate: entries[entries.length - 1].date,
        coverage: coverage.toFixed(1),
        meanBasis: 'available-days',
        coverageBasis: 'weekdays',
        availableDays: entries.length,
        expectedWeekdays: expected,
        partial,
        precision: monitor.precision,
        computedAt: now.toISOString(),
        formulaVersion: FORMULA_VERSION,
        sourceFiles
      })
    }
  }
  return result.sort(
    (a, b) =>
      PERIOD_ORDER[a.periodType] - PERIOD_ORDER[b.periodType] ||
      a.periodKey.localeCompare(b.periodKey)
  )
}

export function aggregateAll(
  monitors: MonitorConfig[],
  records: ValidatedRecord[],
  options: AggregateOptions = {}
): AggregateRecord[] {
  return monitors.flatMap((monitor) => aggregateMonitor(monitor, records, options))
}

export function displayMean(record: AggregateRecord): string {
  return new Decimal(record.mean).toFixed(record.precision)
}

export function displayValue(value: string | undefined, precision: number): string {
  if (value === undefined || value === '') return '—'
  return new Decimal(value).toFixed(precision)
}
