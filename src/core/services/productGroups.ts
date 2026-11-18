import type { MonitorConfig } from '../../shared/types'

const AZ91D_PRODUCT_IDS = new Set(['202004280003', '202004280005', 'am-az91d'])
const ADC12_PRODUCT_IDS = new Set(['201102250397', 'am-adc12'])

export function groupForMonitor(monitor: MonitorConfig): 'adc12' | 'az91d' {
  if (AZ91D_PRODUCT_IDS.has(monitor.productId)) return 'az91d'
  if (ADC12_PRODUCT_IDS.has(monitor.productId)) return 'adc12'
  return `${monitor.displayName} ${monitor.productId}`.toUpperCase().includes('AZ91D')
    ? 'az91d'
    : 'adc12'
}

export function smmIdForGroup(group: string): string {
  return group.toLowerCase().includes('az91d') ? '202004280003' : '201102250397'
}

export function manualIdForGroup(group: string): string {
  return group.toLowerCase().includes('az91d') ? 'am-az91d' : 'am-adc12'
}

export function productNameForGroup(group: string): string {
  return group.toLowerCase().includes('az91d') ? 'AZ91D' : 'ADC12'
}
