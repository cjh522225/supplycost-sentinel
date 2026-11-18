import type { CatalogItem, MonitorConfig, RawRecord } from '../../shared/types'
import { DEFAULT_SMM_CATALOG } from '../../shared/constants'
import { hashObject } from '../storage/fileStore'
import { addDays, format, parseISO, subDays } from 'date-fns'
import { fetchJson, mapLimit, sleep } from './http'
import type { AdapterContext, DataSourceAdapter } from './types'

const ENDPOINT = 'https://platform.smm.cn/aggdatacenter/user/v1/agg_data/history_price'

interface SmmResponse {
  code: number
  msg?: string
  data?: {
    product_id: string
    product_name: string
    unit: string
    price_type?: number
    price_detail?: {
      product_id: string
      average: number
      renew_date: string
      renew_time?: string
      price_declaration?: string
    }[]
  }[]
}

export class SmmAdapter implements DataSourceAdapter {
  readonly source = 'smm' as const

  async catalog(): Promise<CatalogItem[]> {
    return DEFAULT_SMM_CATALOG
  }

  private async fetchOne(productId: string, start: string, end: string, ctx: AdapterContext): Promise<RawRecord[]> {
    const url = `${ENDPOINT}?product_ids=${encodeURIComponent(productId)}&begin_date=${start}&end_date=${end}`
    const json = await fetchJson<SmmResponse>(url, {
      timeoutMs: 30000,
      retries: 2,
      signal: ctx.signal,
      headers: { Referer: 'https://hq.smm.cn/' }
    })
    if (json.code !== 0 || !json.data?.length) return []
    const products = json.data
    const fetchedAt = new Date().toISOString()
    const contentHash = hashObject(json)
    const records: RawRecord[] = []
    for (const product of products) {
      for (const detail of product.price_detail ?? []) {
        if (!detail.renew_date || detail.average === null || detail.average === undefined) continue
        records.push({
          id: `smm:${productId}:${detail.renew_date}`,
          source: 'smm',
          productId,
          productName: product.product_name || productId,
          date: detail.renew_date,
          value: String(detail.average),
          unit: product.unit || '元/吨',
          fetchedAt,
          sourceUrl: url,
          contentHash,
          parserVersion: 'smm-v1',
          meta: {
            priceDeclaration: detail.price_declaration ?? '',
            priceType: product.price_type ?? 0
          }
        })
      }
    }
    return records
  }

  async fetchDaily(date: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]> {
    const start = format(subDays(parseISO(date), 7), 'yyyy-MM-dd')
    return this.fetchRange(start, date, monitors, ctx)
  }

  async fetchRange(startDate: string, endDate: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]> {
    const products = [...new Set(monitors.filter((m) => m.source === 'smm' && m.type === 'metal').map((m) => m.productId))]
    if (products.length === 0) return []
    const tasks: { productId: string; start: string; end: string }[] = []
    for (const productId of products) {
      let cursor = parseISO(startDate)
      const last = parseISO(endDate)
      while (cursor <= last) {
        const yearEnd = new Date(cursor.getFullYear(), 11, 31)
        const chunkEnd = yearEnd < last ? yearEnd : last
        tasks.push({
          productId,
          start: format(cursor, 'yyyy-MM-dd'),
          end: format(chunkEnd, 'yyyy-MM-dd')
        })
        cursor = addDays(chunkEnd, 1)
      }
    }
    const concurrency = Math.min(4, Math.max(1, ctx.settings.backfill.concurrency))
    const results = await mapLimit(tasks, concurrency, async (task) => {
      try {
        const records = await this.fetchOne(task.productId, task.start, task.end, ctx)
        await sleep(100)
        return records
      } catch (error) {
        console.warn(`SMM ${task.productId} ${task.start}~${task.end} 获取失败:`, error)
        return []
      }
    })
    const map = new Map<string, RawRecord>()
    for (const record of results.flat()) map.set(record.id, record)
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId))
  }
}
