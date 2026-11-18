import type {
  AppSettings,
  CatalogItem,
  LlmProvider,
  MonitorConfig,
  RealtimeCapability,
  RealtimeProviderId,
  RealtimeSettingsPublic
} from './types'

export const APP_NAME = '链价智控'
export const APP_SUBTITLE = '供应链成本监测与动态调价预警智能体'
export const APP_VERSION = '1.0.0'

export const SCHEMA_VERSION = '1.0.0'
export const FORMULA_VERSION = 'mean-v1'

export const DEFAULT_DATA_DIR = 'data'

export const SOURCE_LABELS: Record<string, string> = {
  pboc: '中国人民银行',
  cfets: '中国外汇交易中心',
  smm: '上海有色网 SMM',
  asianmetal: '亚洲金属网 Asian Metal'
}

export const SOURCE_SHORT: Record<string, string> = {
  pboc: 'PBOC',
  cfets: 'CFETS',
  smm: 'SMM',
  asianmetal: 'Asian Metal'
}

export const PERIOD_LABELS: Record<string, string> = {
  day: '每日',
  month: '月度',
  quarter: '季度',
  half: '半年度',
  year: '年度'
}

export const DEFAULT_FX_CATALOG: CatalogItem[] = [
  { id: 'EUR', name: '欧元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4, description: '1 欧元兑人民币中间价' },
  { id: 'USD', name: '美元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4, description: '1 美元兑人民币中间价' },
  { id: 'GBP', name: '英镑/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4, description: '1 英镑兑人民币中间价' },
  { id: 'JPY', name: '日元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 6, description: '1 日元兑人民币中间价（由 100 日元折算）' },
  { id: 'HKD', name: '港元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 5, description: '1 港元兑人民币中间价' },
  { id: 'AUD', name: '澳元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4 },
  { id: 'NZD', name: '新西兰元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4 },
  { id: 'SGD', name: '新加坡元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4 },
  { id: 'CHF', name: '瑞士法郎/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4 },
  { id: 'CAD', name: '加拿大元/人民币', source: 'pboc', type: 'fx', unit: 'CNY', precision: 4 }
]

export const DEFAULT_SMM_CATALOG: CatalogItem[] = [
  { id: '201102250397', name: 'SMM 铝合金 ADC12', source: 'smm', type: 'metal', unit: '元/吨', precision: 2, description: 'SMM 铝合金 ADC12 全国均价' },
  { id: '202004280003', name: 'SMM 镁合金 AZ91D 出厂价', source: 'smm', type: 'metal', unit: '元/吨', precision: 2, description: 'SMM 镁合金 AZ91D 出厂价' },
  { id: '202004280004', name: 'SMM 镁合金 AM50A 出厂价', source: 'smm', type: 'metal', unit: '元/吨', precision: 2 },
  { id: '202004280005', name: 'SMM 镁合金 AM60B 出厂价', source: 'smm', type: 'metal', unit: '元/吨', precision: 2 },
  { id: '201106140005', name: 'SMM 华东 ADC12', source: 'smm', type: 'metal', unit: '元/吨', precision: 2 },
  { id: '201106140006', name: 'SMM 华南 ADC12', source: 'smm', type: 'metal', unit: '元/吨', precision: 2 },
  { id: '201106140007', name: 'SMM 西南 ADC12', source: 'smm', type: 'metal', unit: '元/吨', precision: 2 },
  { id: '202112160001', name: 'SMM 东北 ADC12', source: 'smm', type: 'metal', unit: '元/吨', precision: 2 }
]

export const DEFAULT_ASIAN_METAL_CATALOG: CatalogItem[] = [
  { id: 'am-adc12', name: 'Asian Metal ADC12 中国交到', source: 'asianmetal', type: 'metal', unit: '元/吨', precision: 2, description: '手动录入/CSV 导入' },
  { id: 'am-az91d', name: 'Asian Metal AZ91D 中国出厂', source: 'asianmetal', type: 'metal', unit: '元/吨', precision: 2, description: '手动录入/CSV 导入' }
]

export const DEFAULT_MONITORS: MonitorConfig[] = [
  {
    id: 'fx-eur',
    type: 'fx',
    source: 'pboc',
    productId: 'EUR',
    displayName: '欧元/人民币',
    unit: 'CNY',
    precision: 4,
    enabled: true,
    color: '#0f766e',
    thresholds: { changePct: 1.5 }
  },
  {
    id: 'fx-usd',
    type: 'fx',
    source: 'pboc',
    productId: 'USD',
    displayName: '美元/人民币',
    unit: 'CNY',
    precision: 4,
    enabled: true,
    color: '#2563eb',
    thresholds: { changePct: 1.5 }
  },
  {
    id: 'smm-adc12',
    type: 'metal',
    source: 'smm',
    productId: '201102250397',
    displayName: 'SMM ADC12',
    unit: '元/吨',
    precision: 2,
    enabled: true,
    color: '#b45309',
    thresholds: { changePct: 2.5 }
  },
  {
    id: 'smm-az91d',
    type: 'metal',
    source: 'smm',
    productId: '202004280003',
    displayName: 'SMM AZ91D',
    unit: '元/吨',
    precision: 2,
    enabled: true,
    color: '#7c3aed',
    thresholds: { changePct: 2.5 }
  },
  {
    id: 'am-adc12',
    type: 'metal',
    source: 'asianmetal',
    productId: 'am-adc12',
    displayName: 'Asian Metal ADC12',
    unit: '元/吨',
    precision: 2,
    enabled: true,
    color: '#ea580c',
    manual: true,
    thresholds: { changePct: 2.5 }
  },
  {
    id: 'am-az91d',
    type: 'metal',
    source: 'asianmetal',
    productId: 'am-az91d',
    displayName: 'Asian Metal AZ91D',
    unit: '元/吨',
    precision: 2,
    enabled: true,
    color: '#9333ea',
    manual: true,
    thresholds: { changePct: 2.5 }
  }
]

export const LLM_PROVIDER_PRESETS: Record<
  LlmProvider,
  { label: string; baseUrl: string; model: string; kind: 'openai' | 'anthropic'; models: string[] }
> = {
  'opencode-go': {
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    model: 'deepseek-v4.1-flash',
    kind: 'openai',
    models: ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'glm-5.3-flash', 'kimi-k3', 'qwen3.8-flash']
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    kind: 'openai',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    kind: 'openai',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  glm: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    kind: 'openai',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5']
  },
  anthropic: {
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-sonnet-latest',
    kind: 'anthropic',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-sonnet-4-5']
  },
  custom: {
    label: '自定义 OpenAI 兼容',
    baseUrl: '',
    model: '',
    kind: 'openai',
    models: []
  }
}

export const REALTIME_PROVIDER_PRESETS: Record<
  RealtimeProviderId,
  {
    label: string
    capabilities: RealtimeCapability[]
    requiresKey: boolean
    baseUrl: string
    note: string
  }
> = {
  mock: {
    label: '演示行情（无 Key）',
    capabilities: ['quotes', 'topOfBook', 'depth', 'trades'],
    requiresKey: false,
    baseUrl: '',
    note: '本地演示/回放数据，界面会明确标注，不代表真实行情。'
  },
  twelvedata: {
    label: 'Twelve Data',
    capabilities: ['quotes'],
    requiresKey: true,
    baseUrl: 'https://api.twelvedata.com',
    note: 'Basic 计划实测支持 CNY 对和 1min 数据，但无 bid/ask/depth/trades；8 次/分钟、800 次/天。'
  },
  finnhub: {
    label: 'Finnhub',
    capabilities: ['quotes'],
    requiresKey: true,
    baseUrl: 'https://finnhub.io/api/v1',
    note: '需确认外汇实时权限和 CNY 对覆盖。'
  },
  oanda: {
    label: 'OANDA',
    capabilities: ['quotes', 'topOfBook', 'streaming'],
    requiresKey: true,
    baseUrl: 'https://api-fxpractice.oanda.com',
    note: '需开户/实践账户；是否支持 CNY 对需实测。'
  },
  alltick: {
    label: 'AllTick',
    capabilities: ['quotes', 'topOfBook'],
    requiresKey: true,
    baseUrl: 'https://quote.alltick.io',
    note: '需确认 CNY 对、实时权限和费用。'
  },
  custom: {
    label: '自定义行情',
    capabilities: ['quotes'],
    requiresKey: true,
    baseUrl: '',
    note: '预留 OpenAI 兼容之外的通用 REST 适配接口。'
  }
}

export const DEFAULT_REALTIME_SETTINGS: RealtimeSettingsPublic = {
  enabled: false,
  provider: 'mock',
  baseUrl: '',
  hasApiKey: false,
  pollSeconds: 60,
  staleSeconds: 180,
  changePct: 0.3,
  windowMinutes: 5,
  cooldownMinutes: 15,
  depthEnabled: false,
  tradesEnabled: false,
  notify: true
}

export const DEFAULT_SETTINGS: AppSettings = {
  dataDir: DEFAULT_DATA_DIR,
  theme: 'light',
  schedule: {
    enabled: true,
    times: ['10:00', '17:00'],
    catchUp: true
  },
  precision: {
    fx: 4,
    metal: 2
  },
  validation: {
    fxChangePct: 5,
    metalChangePct: 15,
    fxCrossTolerance: 0.0001,
    metalCrossTolerance: 10,
    minMetal: 1000,
    maxMetal: 200000,
    minFx: 0.1,
    maxFx: 30,
    strictFxCrossSource: true,
    strictMetalCrossSource: false
  },
  llm: {
    enabled: false,
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    model: 'deepseek-v4.1-flash',
    hasApiKey: false,
    temperature: 0.2,
    maxTokens: 900
  },
  realtime: { ...DEFAULT_REALTIME_SETTINGS },
  reports: {
    enabled: true,
    autoAfterFetch: true
  },
  backfill: {
    startDate: '2015-01-01',
    concurrency: 4
  },
  asianMetalMode: 'manual'
}

export const CURRENCY_NAME_TO_CODE: Record<string, { code: string; quoteUnit: number }> = {
  美元: { code: 'USD', quoteUnit: 1 },
  欧元: { code: 'EUR', quoteUnit: 1 },
  日元: { code: 'JPY', quoteUnit: 100 },
  港元: { code: 'HKD', quoteUnit: 1 },
  英镑: { code: 'GBP', quoteUnit: 1 },
  澳大利亚元: { code: 'AUD', quoteUnit: 1 },
  新西兰元: { code: 'NZD', quoteUnit: 1 },
  新加坡元: { code: 'SGD', quoteUnit: 1 },
  瑞士法郎: { code: 'CHF', quoteUnit: 1 },
  加拿大元: { code: 'CAD', quoteUnit: 1 },
  澳门元: { code: 'MOP', quoteUnit: 1 },
  林吉特: { code: 'MYR', quoteUnit: 1 },
  俄罗斯卢布: { code: 'RUB', quoteUnit: 1 },
  南非兰特: { code: 'ZAR', quoteUnit: 1 },
  韩元: { code: 'KRW', quoteUnit: 1 },
  阿联酋迪拉姆: { code: 'AED', quoteUnit: 1 },
  沙特里亚尔: { code: 'SAR', quoteUnit: 1 },
  匈牙利福林: { code: 'HUF', quoteUnit: 1 },
  波兰兹罗提: { code: 'PLN', quoteUnit: 1 },
  丹麦克朗: { code: 'DKK', quoteUnit: 1 },
  瑞典克朗: { code: 'SEK', quoteUnit: 1 },
  挪威克朗: { code: 'NOK', quoteUnit: 1 },
  土耳其里拉: { code: 'TRY', quoteUnit: 1 },
  墨西哥比索: { code: 'MXN', quoteUnit: 1 },
  泰铢: { code: 'THB', quoteUnit: 1 }
}

export const CURRENCY_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(CURRENCY_NAME_TO_CODE).map(([name, value]) => [value.code, name])
)
