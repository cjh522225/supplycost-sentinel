import { CfetsAdapter } from './cfets'
import { PbocAdapter } from './pboc'
import { SmmAdapter } from './smm'
import type { DataSourceAdapter } from './types'

export const pbocAdapter = new PbocAdapter()
export const cfetsAdapter = new CfetsAdapter()
export const smmAdapter = new SmmAdapter()

export const adapters: Record<'pboc' | 'cfets' | 'smm', DataSourceAdapter> = {
  pboc: pbocAdapter,
  cfets: cfetsAdapter,
  smm: smmAdapter
}

export * from './types'
export * from './manual'
