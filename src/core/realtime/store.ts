import { join } from 'node:path'
import type {
  AlertRecord,
  AlertStatus,
  RealtimeQuote,
  RealtimeSnapshot,
  RealtimeStatus
} from '../../shared/types'
import {
  appendToArrayFile,
  listFilesRecursive,
  readJsonFile,
  writeCsvAtomic,
  writeJsonAtomic
} from '../storage/fileStore'
import { ensureDir } from '../storage/paths'

const QUOTE_COLUMNS = [
  'provider',
  'symbol',
  'productId',
  'bid',
  'ask',
  'mid',
  'quoteAt',
  'receivedAt',
  'delayMs',
  'demo'
]

export class RealtimeStore {
  readonly root: string

  constructor(dataDir: string) {
    this.root = join(dataDir, 'realtime')
    ensureDir(this.root)
  }

  private statusPath(): string {
    return join(this.root, 'status.json')
  }

  private latestPath(): string {
    return join(this.root, 'latest.json')
  }

  private quotePath(quoteAt: string): string {
    const date = quoteAt.slice(0, 10)
    return join(this.root, 'quotes', date.slice(0, 4), `${date}.json`)
  }

  private alertPath(date: string): string {
    const month = date.slice(0, 7)
    return join(this.root, 'alerts', month.slice(0, 4), `${month}.json`)
  }

  readStatus(fallback: RealtimeStatus): RealtimeStatus {
    return readJsonFile<RealtimeStatus>(this.statusPath(), fallback)
  }

  saveStatus(status: RealtimeStatus): void {
    writeJsonAtomic(this.statusPath(), status)
  }

  readLatest(): RealtimeSnapshot | undefined {
    return readJsonFile<RealtimeSnapshot | undefined>(this.latestPath(), undefined)
  }

  saveLatest(snapshot: RealtimeSnapshot): void {
    writeJsonAtomic(this.latestPath(), snapshot)
  }

  async appendQuotes(quotes: RealtimeQuote[]): Promise<void> {
    if (!quotes.length) return
    const groups = new Map<string, RealtimeQuote[]>()
    for (const quote of quotes) {
      const path = this.quotePath(quote.quoteAt)
      const list = groups.get(path) ?? []
      list.push(quote)
      groups.set(path, list)
    }
    for (const [path, items] of groups) {
      const result = await appendToArrayFile<RealtimeQuote>(
        path,
        items,
        (quote) => `${quote.provider}:${quote.symbol}:${quote.quoteAt}`
      )
      writeCsvAtomic(path.replace(/\.json$/, '.csv'), result.records as unknown as Record<string, unknown>[], QUOTE_COLUMNS)
    }
  }

  readAlerts(): AlertRecord[] {
    return listFilesRecursive(join(this.root, 'alerts'))
      .filter((path) => path.endsWith('.json'))
      .flatMap((path) => readJsonFile<AlertRecord[]>(path, []))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  upsertAlerts(alerts: AlertRecord[]): void {
    if (!alerts.length) return
    const groups = new Map<string, AlertRecord[]>()
    for (const alert of alerts) {
      const path = this.alertPath(alert.quoteAt ?? alert.date)
      const list = groups.get(path) ?? []
      list.push(alert)
      groups.set(path, list)
    }
    for (const [path, items] of groups) {
      const existing = readJsonFile<AlertRecord[]>(path, [])
      const map = new Map(existing.map((alert) => [alert.id, alert]))
      for (const item of items) {
        const previous = map.get(item.id)
        map.set(
          item.id,
          previous
            ? {
                ...previous,
                ...item,
                status: previous.status,
                createdAt: previous.createdAt,
                acknowledgedAt: previous.acknowledgedAt,
                resolvedAt: previous.resolvedAt
              }
            : item
        )
      }
      const records = [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      writeJsonAtomic(path, records)
    }
  }

  resolveAlerts(predicate: (alert: AlertRecord) => boolean): AlertRecord[] {
    const resolved: AlertRecord[] = []
    for (const path of listFilesRecursive(join(this.root, 'alerts')).filter((item) => item.endsWith('.json'))) {
      const records = readJsonFile<AlertRecord[]>(path, [])
      let changed = false
      const now = new Date().toISOString()
      const next = records.map((alert) => {
        if (alert.status === 'resolved' || !predicate(alert)) return alert
        changed = true
        const updated = { ...alert, status: 'resolved' as const, updatedAt: now, resolvedAt: now }
        resolved.push(updated)
        return updated
      })
      if (changed) writeJsonAtomic(path, next)
    }
    return resolved
  }

  updateAlert(id: string, status: AlertStatus): AlertRecord[] {
    for (const path of listFilesRecursive(join(this.root, 'alerts')).filter((item) => item.endsWith('.json'))) {
      const records = readJsonFile<AlertRecord[]>(path, [])
      const index = records.findIndex((alert) => alert.id === id)
      if (index < 0) continue
      const now = new Date().toISOString()
      records[index] = {
        ...records[index],
        status,
        updatedAt: now,
        acknowledgedAt: status === 'acknowledged' ? now : records[index].acknowledgedAt,
        resolvedAt: status === 'resolved' ? now : records[index].resolvedAt
      }
      writeJsonAtomic(path, records)
      return this.readAlerts()
    }
    return this.readAlerts()
  }
}
