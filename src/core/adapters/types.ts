import type { AppSettings, CatalogItem, MonitorConfig, RawRecord, SourceId } from '../../shared/types'

export interface AdapterContext {
  settings: AppSettings
  userAgent?: string
  signal?: AbortSignal
}

export interface DataSourceAdapter {
  readonly source: SourceId
  fetchRange(startDate: string, endDate: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]>
  fetchDaily(date: string, monitors: MonitorConfig[], ctx: AdapterContext): Promise<RawRecord[]>
  catalog(): Promise<CatalogItem[]>
}

export interface ManualAdapterInput {
  date: string
  productId: string
  productName: string
  low?: string
  high?: string
  average?: string
  unit: string
  sourceUrl?: string
  note?: string
}

export interface AdapterLog {
  at: string
  source: SourceId
  level: 'info' | 'warn' | 'error'
  message: string
}
