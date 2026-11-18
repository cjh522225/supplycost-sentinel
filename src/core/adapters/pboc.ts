import Decimal from 'decimal.js'
import { load } from 'cheerio'
import type { CatalogItem, MonitorConfig, RawRecord } from '../../shared/types'
import { CURRENCY_NAME_TO_CODE, DEFAULT_FX_CATALOG } from '../../shared/constants'
import { hashText } from '../storage/fileStore'
import { absoluteUrl, fetchText, mapLimit, sleep } from './http'
import type { AdapterContext, DataSourceAdapter } from './types'

const BASE = 'https://www.pbc.gov.cn'
const LIST_BASE = `${BASE}/zhengcehuobisi/125207/125217/125925`
const MAX_PAGES = 160

interface DailyLink {
  date: string
  url: string
  title: string
}

export class PbocAdapter implements DataSourceAdapter {
  readonly source = 'pboc' as const

  async catalog(): Promise<CatalogItem[]> {
    return DEFAULT_FX_CATALOG
  }

  private listUrl(page: number): string {
    return page === 1 ? `${LIST_BASE}/index.html` : `${LIST_BASE}/17105-${page}.html`
  }

  private parseList(html: string): DailyLink[] {
    const $ = load(html)
    const links: DailyLink[] = []
    $('a').each((_, element) => {
      const href = $(element).attr('href') ?? ''
      const title = ($(element).attr('title') ?? $(element).text() ?? '').trim()
      if (!href.includes('/125925/') || !title.includes('人民币汇率中间价公告')) return
      const match = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
      if (!match) return
      const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
      links.push({ date, url: absoluteUrl(href, BASE), title })
    })
    const map = new Map<string, DailyLink>()
    for (const link of links) map.set(link.url, link)
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date))
  }

  private parseArticle(html: string, url: string, fallbackDate: string): RawRecord[] {
    const $ = load(html)
    const title = $('title').text().trim()
    const body = $('body').text().replace(/\s+/g, ' ')
    const dateMatch = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) ?? body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
      : fallbackDate
    const fetchedAt = new Date().toISOString()
    const contentHash = hashText(`${title}\n${body}`)
    const records: RawRecord[] = []
    const seen = new Set<string>()

    const forward = /(\d+)([\u4e00-\u9fa5]+)对人民币([\d.]+)元/g
    for (const match of body.matchAll(forward)) {
      const quoteUnit = Number(match[1])
      const name = match[2]
      const rawRate = match[3]
      const meta = CURRENCY_NAME_TO_CODE[name]
      if (!meta || !Number.isFinite(quoteUnit) || quoteUnit <= 0) continue
      const value = new Decimal(rawRate).div(quoteUnit).toFixed(10)
      const code = meta.code
      if (seen.has(code)) continue
      seen.add(code)
      records.push({
        id: `pboc:${code}:${date}`,
        source: 'pboc',
        productId: code,
        productName: name,
        date,
        value,
        unit: 'CNY',
        currency: code,
        fetchedAt,
        sourceUrl: url,
        contentHash,
        parserVersion: 'pboc-v1',
        meta: { quoteUnit, rawRate, articleTitle: title }
      })
    }

    const reverse = /人民币1元对([\d.]+)([\u4e00-\u9fa5]+)/g
    for (const match of body.matchAll(reverse)) {
      const rawRate = match[1]
      const name = match[2]
      const meta = CURRENCY_NAME_TO_CODE[name]
      if (!meta || meta.code === 'CNY') continue
      const code = meta.code
      if (seen.has(code)) continue
      seen.add(code)
      const value = new Decimal(1).div(rawRate).toFixed(10)
      records.push({
        id: `pboc:${code}:${date}`,
        source: 'pboc',
        productId: code,
        productName: name,
        date,
        value,
        unit: 'CNY',
        currency: code,
        fetchedAt,
        sourceUrl: url,
        contentHash,
        parserVersion: 'pboc-v1',
        meta: { quoteUnit: 1, rawRate, reverse: true, articleTitle: title }
      })
    }

    return records
  }

  async fetchDaily(date: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]> {
    return this.fetchRange(date, date, monitors, ctx)
  }

  async fetchRange(startDate: string, endDate: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]> {
    const wanted = new Set(monitors.filter((m) => m.source === 'pboc' && m.type === 'fx').map((m) => m.productId))
    if (wanted.size === 0) return []
    const links: DailyLink[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (ctx.signal?.aborted) break
      const html = await fetchText(this.listUrl(page), {
        timeoutMs: 30000,
        retries: 2,
        signal: ctx.signal,
        headers: { Referer: LIST_BASE }
      })
      const pageLinks = this.parseList(html)
      if (pageLinks.length === 0) break
      const matching = pageLinks.filter((link) => link.date >= startDate && link.date <= endDate)
      links.push(...matching)
      const oldest = pageLinks[pageLinks.length - 1]?.date ?? ''
      if (oldest && oldest < startDate) break
      if (page === 1) await sleep(120)
    }
    const unique = [...new Map(links.map((link) => [link.url, link])).values()].sort((a, b) => a.date.localeCompare(b.date))
    const concurrency = Math.min(8, Math.max(1, ctx.settings.backfill.concurrency))
    const results = await mapLimit(unique, concurrency, async (link) => {
      if (ctx.signal?.aborted) return []
      const html = await fetchText(link.url, {
        timeoutMs: 30000,
        retries: 2,
        signal: ctx.signal,
        headers: { Referer: LIST_BASE }
      })
      await sleep(80)
      return this.parseArticle(html, link.url, link.date)
    })
    return results.flat().sort((a, b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId))
  }
}
