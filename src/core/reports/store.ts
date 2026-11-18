import { join } from 'node:path'
import type { DailyReport } from '../../shared/types'
import { listFilesRecursive, readJsonFile, writeJsonAtomic } from '../storage/fileStore'
import { ensureDir } from '../storage/paths'

export class ReportStore {
  readonly root: string

  constructor(dataDir: string) {
    this.root = join(dataDir, 'reports')
    ensureDir(this.root)
  }

  private path(date: string): string {
    return join(this.root, date.slice(0, 4), `${date}.json`)
  }

  read(date: string): DailyReport | undefined {
    return readJsonFile<DailyReport | undefined>(this.path(date), undefined)
  }

  save(report: DailyReport): void {
    writeJsonAtomic(this.path(report.date), report)
  }

  latest(): DailyReport | undefined {
    const files = listFilesRecursive(this.root).filter((path) => path.endsWith('.json'))
    return files
      .map((path) => readJsonFile<DailyReport | undefined>(path, undefined))
      .filter((report): report is DailyReport => Boolean(report))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]
  }

  list(limit = 30): DailyReport[] {
    return listFilesRecursive(this.root)
      .filter((path) => path.endsWith('.json'))
      .map((path) => readJsonFile<DailyReport | undefined>(path, undefined))
      .filter((report): report is DailyReport => Boolean(report))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit)
  }
}
