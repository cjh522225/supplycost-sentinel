import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { stringify } from 'csv-stringify/sync'
import { ensureDir, ensureFileDir } from './paths'

const locks = new Map<string, Promise<unknown>>()
const jsonCache = new Map<string, { mtimeMs: number; size: number; value: unknown }>()
const JSON_CACHE_LIMIT = 1000

function invalidateJsonCache(path: string): void {
  jsonCache.delete(path)
}

export function clearJsonCache(): void {
  jsonCache.clear()
}

export async function withFileLock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(
    path,
    previous.then(() => current)
  )
  await previous.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(path) === current) locks.delete(path)
  }
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function hashObject(value: unknown): string {
  return hashText(stableStringify(value))
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    const stat = statSync(path)
    const cached = jsonCache.get(path)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value as T
    }
    const value = JSON.parse(readFileSync(path, 'utf8')) as T
    if (jsonCache.size >= JSON_CACHE_LIMIT) {
      const oldest = jsonCache.keys().next().value
      if (oldest) jsonCache.delete(oldest)
    }
    jsonCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, value })
    return value
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(path: string, value: unknown): { created: boolean } {
  ensureFileDir(path)
  const created = !existsSync(path)
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, path)
  invalidateJsonCache(path)
  return { created }
}

export function writeCsvAtomic(path: string, rows: Record<string, unknown>[], columns: string[]): void {
  ensureFileDir(path)
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  const csv = stringify(rows, {
    header: true,
    columns,
    bom: true,
    cast: {
      boolean: (value) => (value ? 'true' : 'false')
    }
  })
  writeFileSync(temp, csv, 'utf8')
  renameSync(temp, path)
}

export async function appendToArrayFile<T>(
  path: string,
  items: T[],
  keyOf: (item: T) => string
): Promise<{ created: boolean; added: number; total: number; records: T[] }> {
  return withFileLock(path, () => {
    const created = !existsSync(path)
    const existing = readJsonFile<T[]>(path, [])
    const map = new Map<string, T>()
    for (const item of existing) map.set(keyOf(item), item)
    let added = 0
    for (const item of items) {
      const key = keyOf(item)
      if (!map.has(key)) added += 1
      map.set(key, item)
    }
    const records = [...map.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    writeJsonAtomic(path, records)
    return { created, added, total: records.length, records }
  })
}

export async function removeFromArrayFile<T>(path: string, predicate: (item: T) => boolean): Promise<{ removed: number; records: T[] }> {
  return withFileLock(path, () => {
    const existing = readJsonFile<T[]>(path, [])
    const records = existing.filter((item) => !predicate(item))
    writeJsonAtomic(path, records)
    return { removed: existing.length - records.length, records }
  })
}

export function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...listFilesRecursive(full))
    else result.push(full)
  }
  return result
}

export function fileInfo(path: string): { size: number; modifiedAt: string } {
  const stat = statSync(path)
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() }
}

export function deleteFile(path: string): void {
  if (existsSync(path)) unlinkSync(path)
  invalidateJsonCache(path)
}

export function ensureStorageDirs(dataDir: string): void {
  for (const dir of ['raw', 'validated', 'quarantine', 'aggregates', 'alerts', 'audit', 'exports', 'backups']) {
    ensureDir(join(dataDir, dir))
  }
}
