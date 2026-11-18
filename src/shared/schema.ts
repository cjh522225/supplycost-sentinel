import { z } from 'zod'

export const sourceSchema = z.enum(['pboc', 'cfets', 'smm', 'asianmetal'])
export const monitorTypeSchema = z.enum(['fx', 'metal'])
export const periodTypeSchema = z.enum(['day', 'month', 'quarter', 'half', 'year'])
export const llmProviderSchema = z.enum(['opencode-go', 'openai', 'deepseek', 'glm', 'anthropic', 'custom'])
export const realtimeProviderSchema = z.enum(['mock', 'twelvedata', 'finnhub', 'oanda', 'alltick', 'custom'])

export const thresholdsSchema = z
  .object({
    high: z.number().finite().optional(),
    low: z.number().finite().optional(),
    changePct: z.number().finite().positive().optional()
  })
  .optional()

export const monitorSchema = z.object({
  id: z.string().min(1),
  type: monitorTypeSchema,
  source: sourceSchema,
  productId: z.string().min(1),
  displayName: z.string().min(1),
  unit: z.string().min(1),
  precision: z.number().int().min(0).max(8),
  enabled: z.boolean(),
  color: z.string().optional(),
  thresholds: thresholdsSchema,
  manual: z.boolean().optional(),
  note: z.string().optional()
})

export const rawRecordSchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  productId: z.string().min(1),
  productName: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.string().min(1),
  low: z.string().optional(),
  high: z.string().optional(),
  unit: z.string().min(1),
  currency: z.string().optional(),
  fetchedAt: z.string().min(1),
  sourceUrl: z.string().min(1),
  contentHash: z.string().min(1),
  parserVersion: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).optional()
})

export const validationCheckSchema = z.object({
  rule: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string()
})

export const validationInfoSchema = z.object({
  status: z.enum(['valid', 'invalid']),
  checkedAt: z.string(),
  checks: z.array(validationCheckSchema),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  crossSource: z
    .object({
      source: sourceSchema,
      date: z.string(),
      value: z.string(),
      diff: z.string(),
      tolerance: z.string(),
      passed: z.boolean()
    })
    .optional()
})

export const validatedRecordSchema = rawRecordSchema.extend({
  validation: validationInfoSchema
})

export const aggregateSchema = z.object({
  monitorId: z.string(),
  monitorName: z.string(),
  source: sourceSchema,
  productId: z.string(),
  unit: z.string(),
  periodType: periodTypeSchema,
  periodKey: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  mean: z.string(),
  sum: z.string(),
  count: z.number().int().nonnegative(),
  min: z.string().optional(),
  max: z.string().optional(),
  firstDate: z.string().optional(),
  lastDate: z.string().optional(),
  coverage: z.string().optional(),
  meanBasis: z.literal('available-days'),
  coverageBasis: z.literal('weekdays'),
  availableDays: z.number().int().nonnegative(),
  expectedWeekdays: z.number().int().nonnegative(),
  partial: z.boolean(),
  precision: z.number().int(),
  computedAt: z.string(),
  formulaVersion: z.string(),
  sourceFiles: z.array(z.string())
})

export const alertSchema = z.object({
  id: z.string(),
  monitorId: z.string(),
  monitorName: z.string(),
  type: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  message: z.string(),
  date: z.string(),
  value: z.string().optional(),
  threshold: z.string().optional(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  acknowledgedAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  origin: z.enum(['official', 'realtime']).optional(),
  providerId: realtimeProviderSchema.optional(),
  symbol: z.string().optional(),
  quoteAt: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional()
})

export const settingsSchema = z.object({
  dataDir: z.string().min(1),
  theme: z.enum(['light', 'dark', 'system']),
  schedule: z.object({
    enabled: z.boolean(),
    times: z.array(z.string().regex(/^\d{2}:\d{2}$/)),
    catchUp: z.boolean()
  }),
  precision: z.object({
    fx: z.number().int().min(0).max(8),
    metal: z.number().int().min(0).max(8)
  }),
  validation: z.object({
    fxChangePct: z.number().positive(),
    metalChangePct: z.number().positive(),
    fxCrossTolerance: z.number().nonnegative(),
    metalCrossTolerance: z.number().nonnegative(),
    minMetal: z.number(),
    maxMetal: z.number(),
    minFx: z.number(),
    maxFx: z.number(),
    strictFxCrossSource: z.boolean(),
    strictMetalCrossSource: z.boolean()
  }),
  llm: z.object({
    enabled: z.boolean(),
    provider: llmProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    apiKeyEncrypted: z.string().optional()
  }),
  realtime: z.object({
    enabled: z.boolean(),
    provider: realtimeProviderSchema,
    baseUrl: z.string(),
    hasApiKey: z.boolean(),
    pollSeconds: z.number().int().min(15).max(3600),
    staleSeconds: z.number().int().min(30).max(86400),
    changePct: z.number().positive(),
    windowMinutes: z.number().int().min(1).max(1440),
    cooldownMinutes: z.number().int().min(1).max(1440),
    depthEnabled: z.boolean(),
    tradesEnabled: z.boolean(),
    notify: z.boolean(),
    apiKeyEncrypted: z.string().optional()
  }),
  reports: z.object({
    enabled: z.boolean(),
    autoAfterFetch: z.boolean()
  }),
  backfill: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    concurrency: z.number().int().min(1).max(16)
  }),
  asianMetalMode: z.enum(['manual', 'csv'])
})

export const manualInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productId: z.string().min(1),
  productName: z.string().min(1),
  low: z.string().optional(),
  high: z.string().optional(),
  average: z.string().optional(),
  unit: z.string().min(1),
  sourceUrl: z.string().optional(),
  note: z.string().optional()
})

export const llmChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string()
    })
  ),
  context: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(['chat', 'daily-report', 'alert-explain']).optional()
})

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`${label} 校验失败：${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}
