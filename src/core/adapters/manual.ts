import Decimal from 'decimal.js'
import { parse } from 'csv-parse/sync'
import type { MonitorConfig, RawRecord } from '../../shared/types'
import { hashObject } from '../storage/fileStore'
import type { ManualAdapterInput } from './types'

const HEADER_ALIASES: Record<string, string> = {
  date: 'date',
  日期: 'date',
  productId: 'productId',
  产品代码: 'productId',
  产品id: 'productId',
  productName: 'productName',
  产品: 'productName',
  产品名称: 'productName',
  low: 'low',
  最低价: 'low',
  低价: 'low',
  high: 'high',
  最高价: 'high',
  高价: 'high',
  average: 'average',
  均价: 'average',
  平均价: 'average',
  unit: 'unit',
  单位: 'unit',
  sourceUrl: 'sourceUrl',
  来源: 'sourceUrl',
  链接: 'sourceUrl',
  note: 'note',
  备注: 'note'
}

function normalizeRow(row: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) {
    const normalized = HEADER_ALIASES[key.trim()] ?? HEADER_ALIASES[key.trim().toLowerCase()] ?? key.trim()
    result[normalized] = String(value ?? '').trim()
  }
  return result
}

function productFromName(name: string): { id: string; name: string } {
  const normalized = name.toUpperCase()
  if (normalized.includes('ADC12')) return { id: 'am-adc12', name: name || 'Asian Metal ADC12 中国交到' }
  if (normalized.includes('AZ91D')) return { id: 'am-az91d', name: name || 'Asian Metal AZ91D 中国出厂' }
  return { id: '', name }
}

export function createManualRecord(input: ManualAdapterInput): RawRecord {
  const date = input.date
  let value = input.average?.trim()
  if (!value && input.low && input.high) {
    value = new Decimal(input.low).add(input.high).div(2).toFixed(6)
  }
  if (!value) throw new Error('必须填写平均价，或同时填写最低价和最高价')
  const product = productFromName(input.productName)
  const productId = input.productId || product.id
  if (!productId) throw new Error('无法识别产品，请选择 ADC12 或 AZ91D')
  const productName = input.productName || product.name
  const unit = input.unit || '元/吨'
  const sourceUrl = input.sourceUrl?.trim() || 'manual://asianmetal'
  const payload = { date, productId, productName, value, low: input.low, high: input.high, unit, sourceUrl, note: input.note }
  return {
    id: `asianmetal:${productId}:${date}`,
    source: 'asianmetal',
    productId,
    productName,
    date,
    value: new Decimal(value).toFixed(10),
    low: input.low ? new Decimal(input.low).toFixed(6) : undefined,
    high: input.high ? new Decimal(input.high).toFixed(6) : undefined,
    unit,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    contentHash: hashObject(payload),
    parserVersion: 'manual-v1',
    meta: {
      entry: 'manual',
      note: input.note ?? '',
      manualSource: 'Asian Metal'
    }
  }
}

export interface CsvRowResult {
  record?: RawRecord
  error?: string
  row: number
}

export function parseManualCsv(csv: string): CsvRowResult[] {
  const clean = csv.replace(/^\uFEFF/, '')
  let rows: Record<string, string>[]
  try {
    rows = parse(clean, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    }) as Record<string, string>[]
  } catch (error) {
    return [{ row: 0, error: `CSV 解析失败：${error instanceof Error ? error.message : String(error)}` }]
  }
  return rows.map((raw, index) => {
    const row = normalizeRow(raw)
    try {
      if (!row.date) throw new Error('缺少日期')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('日期格式应为 YYYY-MM-DD')
      const product = productFromName(row.productName || '')
      const productId = row.productId || product.id
      if (!productId) throw new Error('缺少产品，请填写 ADC12 或 AZ91D')
      const record = createManualRecord({
        date: row.date,
        productId,
        productName: row.productName || product.name,
        low: row.low || undefined,
        high: row.high || undefined,
        average: row.average || undefined,
        unit: row.unit || '元/吨',
        sourceUrl: row.sourceUrl || undefined,
        note: row.note || undefined
      })
      return { row: index + 2, record }
    } catch (error) {
      return { row: index + 2, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function manualProductGroup(monitor: MonitorConfig): string {
  return `${monitor.displayName} ${monitor.productId}`.toUpperCase().includes('AZ91D') ? 'az91d' : 'adc12'
}
