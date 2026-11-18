import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { format, parseISO } from 'date-fns'
import type { SourceId } from '../../shared/types'

export function resolveDataDir(dataDir: string, baseDir: string): string {
  if (isAbsolute(dataDir)) return dataDir
  return resolve(baseDir, dataDir)
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function ensureFileDir(path: string): void {
  ensureDir(dirname(path))
}

export function yearOf(date: string): string {
  return date.slice(0, 4)
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function rawPath(dataDir: string, source: SourceId, date: string): string {
  const year = yearOf(date)
  const month = monthOf(date)
  return join(dataDir, 'raw', source, year, `${month}.json`)
}

export function validatedPath(dataDir: string, date: string): string {
  return join(dataDir, 'validated', yearOf(date), `${monthOf(date)}.json`)
}

export function quarantinePath(dataDir: string, date: string): string {
  return join(dataDir, 'quarantine', yearOf(date), `${monthOf(date)}.json`)
}

export function aggregatesPath(dataDir: string, year: string): string {
  return join(dataDir, 'aggregates', year, `${year}.json`)
}

export function aggregatesCsvPath(dataDir: string, year: string): string {
  return join(dataDir, 'aggregates', year, `${year}.csv`)
}

export function alertsPath(dataDir: string, year: string): string {
  return join(dataDir, 'alerts', year, `${year}.json`)
}

export function auditPath(dataDir: string, date: string): string {
  return join(dataDir, 'audit', yearOf(date), `${monthOf(date)}.json`)
}

export function exportsPath(dataDir: string, name: string): string {
  return join(dataDir, 'exports', name)
}

export function configPath(baseDir: string, name: string): string {
  return join(baseDir, name)
}

export function relPath(dataDir: string, path: string): string {
  return path.startsWith(dataDir) ? path.slice(dataDir.length).replace(/^[\\/]/, '') : path
}

export function monthLabel(date: string): string {
  return format(parseISO(date), 'yyyy-MM')
}
