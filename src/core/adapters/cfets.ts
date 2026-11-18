import Decimal from 'decimal.js'
import type { CatalogItem, MonitorConfig, RawRecord } from '../../shared/types'
import { DEFAULT_FX_CATALOG } from '../../shared/constants'
import { hashObject } from '../storage/fileStore'
import { addMonths, format, parseISO, startOfMonth, subDays } from 'date-fns'
import { fetchJson, mapLimit, sleep } from './http'
import type { AdapterContext, DataSourceAdapter } from './types'

const ENDPOINT = 'https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew'

interface CfetsResponse {
  head?: { rep_code?: string; rep_message?: string }
  data?: {
    pageTotal?: number
    pageNum?: number
    pageSize?: number
    total?: number
  }
  records?: { date: string; values: string[] }[]
}

function currencyParam(code: string): string {
  return code === 'JPY' ? '100JPY/CNY' : `${code}/CNY`
}

export class CfetsAdapter implements DataSourceAdapter {
  readonly source = 'cfets' as const

  async catalog(): Promise<CatalogItem[]> {
    return DEFAULT_FX_CATALOG
  }

  private async fetchMonth(code: string, start: string, end: string, ctx: AdapterContext): Promise<RawRecord[]> {
    const records: RawRecord[] = []
    const fetchedAt = new Date().toISOString()
    let page = 1
    let pageTotal = 1
    do {
      if (ctx.signal?.aborted) break
      const url = `${ENDPOINT}?startDate=${start}&endDate=${end}&currency=${encodeURIComponent(currencyParam(code))}&pageNum=${page}`
      const json = await fetchJson<CfetsResponse>(url, {
        timeoutMs: 25000,
        retries: 2,
        signal: ctx.signal,
        headers: { Referer: 'https://www.chinamoney.com.cn/chinese/bkccpr/' }
      })
      pageTotal = Number(json.data?.pageTotal ?? 1) || 1
      for (const row of json.records ?? []) {
        if (!row.date || !row.values?.[0]) continue
        const raw = row.values[0]
        const value = code === 'JPY' ? new Decimal(raw).div(100).toFixed(10) : new Decimal(raw).toFixed(10)
        records.push({
          id: `cfets:${code}:${row.date}`,
          source: 'cfets',
          productId: code,
          productName: `${code}/CNY`,
          date: row.date,
          value,
          unit: 'CNY',
          currency: code,
          fetchedAt,
          sourceUrl: url,
          contentHash: hashObject({ code, date: row.date, raw }),
          parserVersion: 'cfets-v1',
          meta: { raw, provider: 'CFETS' }
        })
      }
      page += 1
      await sleep(120)
    } while (page <= pageTotal)
    return records
  }

  async fetchDaily(date: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]> {
    const start = format(subDays(parseISO(date), 7), 'yyyy-MM-dd')
    return this.fetchRange(start, date, monitors, ctx)
  }

  async fetchRange(startDate: string, endDate: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]> {
    const codes = [...new Set(monitors.filter((m) => m.source === 'pboc' && m.type === 'fx').map((m) => m.productId))]
    if (codes.length === 0) return []
    const months: { start: string; end: string }[] = []
    let cursor = startOfMonth(parseISO(startDate))
    const last = parseISO(endDate)
    while (cursor <= last) {
      const next = addMonths(cursor, 1)
      const monthStart = format(cursor, 'yyyy-MM-dd')
      const monthEnd = format(subDays(next, 1), 'yyyy-MM-dd')
      months.push({
        start: monthStart < startDate ? startDate : monthStart,
        end: monthEnd > endDate ? endDate : monthEnd
      })
      cursor = next
    }
    const tasks = codes.flatMap((code) => months.map((m) => ({ code, ...m })))
    const results = await mapLimit(tasks, 2, async (task) => {
      try {
        return await this.fetchMonth(task.code, task.start, task.end, ctx)
      } catch (error) {
        console.warn(`CFETS ${task.code} ${task.start}~${task.end} 获取失败:`, error)
        return []
      }
    })
    const map = new Map<string, RawRecord>()
    for (const record of results.flat()) map.set(record.id, record)
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId))
  }
}
