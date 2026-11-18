import { randomUUID } from 'node:crypto'
import { LLM_PROVIDER_PRESETS, SOURCE_LABELS } from '../../shared/constants'
import type {
  AppSettings,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
  LlmCitation,
  LlmProvider,
  LlmSettingsPublic,
  LlmTestInput,
  LlmTestResult
} from '../../shared/types'

const REQUEST_TIMEOUT_MS = 60_000
const RETRY_MAX_TOKENS = 512
const RETRY_CONTEXT_CHARS = 6_000
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_CONTEXT_CHARS = 16_000
const MAX_CONTEXT_DEPTH = 6
const MAX_CONTEXT_ARRAY_ITEMS = 50
const MAX_CONTEXT_STRING_CHARS = 2_000
const MAX_ERROR_CHARS = 500
const MAX_CITATIONS = 20

const SYSTEM_PROMPT =
  '你是链价智控的供应链成本分析助手。只能使用用户提供的本地数据上下文，不得编造任何数字、日期或来源。回答要简洁、结论先行；引用数据时写明日期、来源和数据文件。若数据不足，明确说明‘本地数据不足’。不得给出投资建议。'

type LlmMode = NonNullable<LlmChatRequest['mode']>
type ProviderKind = 'openai' | 'anthropic'

const MODE_INSTRUCTIONS: Record<LlmMode, string> = {
  chat: '回答模式：结合本地数据上下文回答用户问题，优先给出结论和依据。',
  'daily-report':
    '日报模式：请输出结构化供应链成本日报，依次包含「核心结论」「关键指标」「预警与异常」「数据质量」「关注事项」。每项指标注明最新值、单位、期间均值、日期、来源和数据文件；没有数据时写明本地数据不足。',
  'alert-explain':
    '预警解释模式：请解释当前预警，说明触发指标、阈值、证据（日期、来源、数据文件、记录 ID），并区分事实与推断；数据不足时明确说明。'
}

const DEFAULT_USER_PROMPTS: Record<LlmMode, string> = {
  chat: '请总结当前供应链成本数据的关键变化。',
  'daily-report': '请基于本地数据生成今日供应链成本日报。',
  'alert-explain': '请解释当前预警，并给出数据证据。'
}

const MEAN_PERIODS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'month', label: '月度' },
  { key: 'quarter', label: '季度' },
  { key: 'half', label: '半年度' },
  { key: 'year', label: '年度' }
]

const SEVERITY_LABELS: Record<string, string> = {
  info: '提示',
  warning: '警告',
  critical: '严重'
}

const ALERT_STATUS_LABELS: Record<string, string> = {
  open: '未处理',
  acknowledged: '已确认',
  resolved: '已解决'
}

const VALIDATION_STATUS_LABELS: Record<string, string> = {
  valid: '有效',
  invalid: '无效'
}

const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|apikey|token$|secret|password|passwd|authorization|credential)/i

export interface LlmServiceOptions {
  getSettings: () => AppSettings
  decryptApiKey: () => string | undefined
}

interface ApiKeyState {
  key?: string
  error?: string
}

interface MonitorDigest {
  name: string
  latest?: {
    value: string
    unit?: string
    date?: string
    source?: string
  }
  means: { label: string; value: string; period?: string }[]
}

export class LlmService {
  private readonly sessionId = randomUUID()

  constructor(private readonly options: LlmServiceOptions) {}

  isConfigured(): boolean {
    try {
      const llm = this.options.getSettings().llm
      if (!llm.enabled || !llm.model?.trim() || !llm.baseUrl?.trim()) return false
      return Boolean(this.readApiKey().key)
    } catch {
      return false
    }
  }

  async test(input?: LlmTestInput): Promise<LlmTestResult> {
    const saved = this.options.getSettings()
    const llm: LlmSettingsPublic = input
      ? {
          enabled: input.enabled,
          provider: input.provider,
          baseUrl: input.baseUrl,
          model: input.model,
          hasApiKey: Boolean(input.apiKey) || saved.llm.hasApiKey,
          temperature: input.temperature,
          maxTokens: input.maxTokens
        }
      : saved.llm
    const provider = llm.provider
    const model = llm.model?.trim() ?? ''

    const configError = validateLlmSettings(llm)
    if (configError) return { ok: false, provider, model, message: configError }

    const keyState = input?.apiKey?.trim()
      ? { key: input.apiKey.trim() }
      : this.readApiKey()
    if (!keyState.key) {
      return { ok: false, provider, model, message: keyState.error ?? '未配置 API Key。' }
    }

    const startedAt = Date.now()
    try {
      const messages = buildProviderMessages(
        {
          messages: [{ role: 'user', content: '请只回复“连接正常”。' }],
          mode: 'chat'
        },
        probeContext()
      )
      const content = await this.requestCompletion(
        llm,
        keyState.key,
        messages,
        resolveMaxTokens(llm),
        resolveTemperature(llm)
      )
      const latencyMs = Date.now() - startedAt
      const preview = content.length > 120 ? `${content.slice(0, 120)}…` : content
      return {
        ok: true,
        provider,
        model,
        message: `连接成功（${providerLabel(provider)} / ${model}）：${preview}`,
        latencyMs
      }
    } catch (error) {
      return {
        ok: false,
        provider,
        model,
        message: safeErrorMessage(error, keyState.key),
        latencyMs: Date.now() - startedAt
      }
    }
  }

  async chat(
    req: LlmChatRequest,
    context: Record<string, unknown> = {}
  ): Promise<LlmChatResponse> {
    const settings = this.options.getSettings()
    const llm = settings.llm
    const provider = llm.provider
    const model = llm.model?.trim() ?? ''

    const configError = validateLlmSettings(llm)
    const keyState: ApiKeyState = configError ? { error: configError } : this.readApiKey()
    const apiKey = keyState.key

    const effectiveContext: Record<string, unknown> = {
      ...(req.context ?? {}),
      ...(context ?? {})
    }
    const safeContext = sanitizeContext(effectiveContext, apiKey)
    const citations = extractCitations(safeContext)

    const fallback = (error: string): LlmChatResponse => ({
      ok: false,
      content: buildFallbackContent(safeContext),
      provider,
      model,
      fallback: true,
      citations,
      error
    })

    if (configError) return fallback(configError)
    if (!apiKey) return fallback(keyState.error ?? '未配置 API Key。')

    const messages = buildProviderMessages(req, safeContext)
    const attempts: Array<{
      messages: LlmChatMessage[]
      maxTokens: number
      temperature: number
    }> = [
      {
        messages,
        maxTokens: resolveMaxTokens(llm),
        temperature: resolveTemperature(llm)
      },
      {
        messages: compactMessages(messages),
        maxTokens: Math.min(resolveMaxTokens(llm), RETRY_MAX_TOKENS),
        temperature: 0
      }
    ]

    let lastError = '模型请求失败，请稍后重试。'
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]
      try {
        const content = await this.requestCompletion(
          llm,
          apiKey,
          attempt.messages,
          attempt.maxTokens,
          attempt.temperature
        )
        return {
          ok: true,
          content,
          provider,
          model,
          fallback: false,
          citations
        }
      } catch (error) {
        lastError = safeErrorMessage(error, apiKey)
        if (index >= attempts.length - 1 || !isRetryableError(lastError)) break
      }
    }
    return fallback(lastError)
  }

  async chatWithContext(
    req: LlmChatRequest,
    context: Record<string, unknown> = {}
  ): Promise<LlmChatResponse> {
    return this.chat(req, context)
  }

  async chatStream(
    req: LlmChatRequest,
    context: Record<string, unknown> = {},
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<LlmChatResponse> {
    const settings = this.options.getSettings()
    const llm = settings.llm
    const provider = llm.provider
    const model = llm.model?.trim() ?? ''
    const configError = validateLlmSettings(llm)
    const keyState: ApiKeyState = configError ? { error: configError } : this.readApiKey()
    const apiKey = keyState.key
    const effectiveContext: Record<string, unknown> = {
      ...(req.context ?? {}),
      ...(context ?? {})
    }
    const safeContext = sanitizeContext(effectiveContext, apiKey)
    const citations = extractCitations(safeContext)
    const fallback = (error: string): LlmChatResponse => ({
      ok: false,
      content: buildFallbackContent(safeContext),
      provider,
      model,
      fallback: true,
      citations,
      error
    })

    if (configError) {
      const response = fallback(configError)
      onChunk(response.content)
      return response
    }
    if (!apiKey) {
      const response = fallback(keyState.error ?? '未配置 API Key。')
      onChunk(response.content)
      return response
    }

    const messages = buildProviderMessages(req, safeContext)
    let received = ''
    try {
      const content = await this.requestStreamCompletion(
        llm,
        apiKey,
        messages,
        resolveMaxTokens(llm),
        resolveTemperature(llm),
        (chunk) => {
          received += chunk
          onChunk(chunk)
        },
        signal
      )
      return {
        ok: true,
        content,
        provider,
        model,
        fallback: false,
        citations
      }
    } catch (error) {
      if (signal?.aborted) {
        return {
          ok: false,
          content: received || '已停止生成。',
          provider,
          model,
          fallback: false,
          citations,
          error: '已停止生成'
        }
      }
      const message = safeErrorMessage(error, apiKey)
      if (!received) {
        const response = await this.chat(req, context)
        onChunk(response.content)
        return response
      }
      return {
        ok: false,
        content: `${received}\n\n[流式输出中断：${message}]`,
        provider,
        model,
        fallback: true,
        citations,
        error: message
      }
    }
  }

  private readApiKey(): ApiKeyState {
    try {
      const raw = this.options.decryptApiKey()
      const key = typeof raw === 'string' ? raw.trim() : ''
      if (!key) return { error: '未配置 API Key，请先在设置中保存密钥。' }
      return { key }
    } catch {
      return { error: 'API Key 解密失败，请重新保存密钥。' }
    }
  }

  private async requestCompletion(
    llm: LlmSettingsPublic,
    apiKey: string,
    messages: LlmChatMessage[],
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    const kind = providerKind(llm.provider)
    const endpoint =
      kind === 'anthropic' ? anthropicEndpoint(llm.baseUrl) : openAiEndpoint(llm.baseUrl)
    if (!endpoint) throw new Error('Base URL 为空，无法发起请求。')

    const headers: Record<string, string> =
      kind === 'anthropic'
        ? {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json'
          }
        : {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }

    if (llm.provider === 'opencode-go') {
      headers['User-Agent'] = 'SupplyCostSentinel/1.0'
      headers['x-opencode-session'] = this.sessionId
    }

    const body =
      kind === 'anthropic'
        ? buildAnthropicBody(llm, messages, maxTokens, temperature)
        : buildOpenAiBody(llm, messages, maxTokens, temperature)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!response.ok) throw new Error(await readHttpError(response))
      const payload: unknown = await response.json()
      const content =
        kind === 'anthropic' ? parseAnthropicContent(payload) : parseOpenAiContent(payload)
      if (!content) {
        const stopReason = completionStopReason(payload, kind)
        throw new Error(
          stopReason === 'length' || stopReason === 'max_tokens'
            ? '模型输出达到 Max Tokens 上限，未返回正文；请提高 Max Tokens 或更换模型。'
            : '模型返回内容为空。'
        )
      }
      return content
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）。`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async requestStreamCompletion(
    llm: LlmSettingsPublic,
    apiKey: string,
    messages: LlmChatMessage[],
    maxTokens: number,
    temperature: number,
    onChunk: (chunk: string) => void,
    externalSignal?: AbortSignal
  ): Promise<string> {
    const kind = providerKind(llm.provider)
    const endpoint =
      kind === 'anthropic' ? anthropicEndpoint(llm.baseUrl) : openAiEndpoint(llm.baseUrl)
    if (!endpoint) throw new Error('Base URL 为空，无法发起请求。')
    const headers: Record<string, string> =
      kind === 'anthropic'
        ? {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json'
          }
        : {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
    if (llm.provider === 'opencode-go') {
      headers['User-Agent'] = 'SupplyCostSentinel/1.0'
      headers['x-opencode-session'] = this.sessionId
    }
    const body =
      kind === 'anthropic'
        ? { ...buildAnthropicBody(llm, messages, maxTokens, temperature), stream: true }
        : { ...buildOpenAiBody(llm, messages, maxTokens, temperature), stream: true }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const onExternalAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!response.ok) throw new Error(await readHttpError(response))
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.body || !contentType.includes('text/event-stream')) {
        const payload: unknown = await response.json()
        const content =
          kind === 'anthropic' ? parseAnthropicContent(payload) : parseOpenAiContent(payload)
        if (!content) throw new Error('模型返回内容为空。')
        onChunk(content)
        return content
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      const consume = (block: string) => {
        const text = parseStreamBlock(block, kind)
        if (!text) return
        content += text
        onChunk(text)
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        let index = buffer.indexOf('\n\n')
        while (index >= 0) {
          consume(buffer.slice(0, index))
          buffer = buffer.slice(index + 2)
          index = buffer.indexOf('\n\n')
        }
      }
      buffer += decoder.decode()
      buffer = buffer.replace(/\r\n/g, '\n')
      if (buffer.trim()) consume(buffer)
      if (!content) throw new Error('模型返回内容为空。')
      return content
    } catch (error) {
      if (externalSignal?.aborted) throw new Error('已停止生成')
      if (controller.signal.aborted) {
        throw new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）。`)
      }
      throw error
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

function parseStreamBlock(block: string, kind: ProviderKind): string | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
    .trim()
  if (!data || data === '[DONE]') return undefined
  const payload = tryParseJson(data)
  if (!isRecord(payload)) return undefined
  if (isRecord(payload.error)) {
    throw new Error(String(payload.error.message ?? '流式请求失败'))
  }
  if (kind === 'anthropic') {
    if (payload.type === 'error') throw new Error('流式请求失败')
    if (payload.type !== 'content_block_delta' || !isRecord(payload.delta)) return undefined
    return typeof payload.delta.text === 'string' ? payload.delta.text : undefined
  }
  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const choice = choices[0]
  if (!isRecord(choice) || !isRecord(choice.delta)) return undefined
  return contentToText(choice.delta.content) || undefined
}

function validateLlmSettings(llm: LlmSettingsPublic): string | undefined {
  if (!llm.enabled) return 'LLM 功能未启用，请在设置中开启智能分析。'
  if (!isKnownProvider(llm.provider)) return `不支持的 LLM 提供商：${String(llm.provider)}。`
  if (!llm.baseUrl?.trim()) return 'Base URL 为空，请在设置中填写服务地址。'
  if (!llm.model?.trim()) return '模型名称为空，请在设置中选择或填写模型。'
  return undefined
}

function isKnownProvider(provider: LlmProvider): boolean {
  return Object.prototype.hasOwnProperty.call(LLM_PROVIDER_PRESETS, provider)
}

function providerKind(provider: LlmProvider): ProviderKind {
  return LLM_PROVIDER_PRESETS[provider]?.kind === 'anthropic' ? 'anthropic' : 'openai'
}

function providerLabel(provider: LlmProvider): string {
  return LLM_PROVIDER_PRESETS[provider]?.label ?? String(provider)
}

function openAiEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function anthropicEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  if (/\/v1\/messages$/i.test(base) || /\/messages$/i.test(base)) return base
  return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`
}

function resolveTemperature(llm: LlmSettingsPublic): number {
  return Number.isFinite(llm.temperature) ? Math.min(2, Math.max(0, llm.temperature)) : 0.2
}

function resolveMaxTokens(llm: LlmSettingsPublic): number {
  return Number.isInteger(llm.maxTokens) && llm.maxTokens > 0 ? llm.maxTokens : 900
}

function buildProviderMessages(
  req: LlmChatRequest,
  context: Record<string, unknown>
): LlmChatMessage[] {
  const requestedMode = req.mode ?? 'chat'
  const mode: LlmMode = requestedMode in MODE_INSTRUCTIONS ? requestedMode : 'chat'

  const systemParts = [SYSTEM_PROMPT, MODE_INSTRUCTIONS[mode]]
  const contextJson = serializeContext(context)
  if (contextJson) systemParts.push(`本地有效数据上下文（JSON）：${contextJson}`)
  const messages: LlmChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }]

  const conversation = req.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0)

  if (conversation.length === 0) {
    conversation.push({ role: 'user', content: DEFAULT_USER_PROMPTS[mode] })
  }

  messages.push(...conversation)
  return messages
}

function compactMessages(messages: LlmChatMessage[]): LlmChatMessage[] {
  return messages.map((message) =>
    message.role === 'system' && message.content.length > RETRY_CONTEXT_CHARS
      ? { role: 'system', content: `${message.content.slice(0, RETRY_CONTEXT_CHARS)}…` }
      : message
  )
}

function probeContext(): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    monitors: [
      {
        id: 'probe',
        name: '连接测试',
        latest: { value: '0', unit: 'CNY', date: new Date().toISOString().slice(0, 10) }
      }
    ],
    alerts: [],
    validation: { valid: 0, quarantined: 0 }
  }
}

function isRetryableError(error: string): boolean {
  if (/HTTP (401|403|404)\b/.test(error)) return false
  if (/未配置 API Key|解密失败|未启用|不支持/.test(error)) return false
  return true
}

function buildOpenAiBody(
  llm: LlmSettingsPublic,
  messages: LlmChatMessage[],
  maxTokens: number,
  temperature: number
): Record<string, unknown> {
  return {
    model: llm.model.trim(),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    temperature,
    max_tokens: maxTokens
  }
}

function buildAnthropicBody(
  llm: LlmSettingsPublic,
  messages: LlmChatMessage[],
  maxTokens: number,
  temperature: number
): Record<string, unknown> {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')

  const conversation = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }))

  const body: Record<string, unknown> = {
    model: llm.model.trim(),
    max_tokens: maxTokens,
    temperature,
    messages: conversation
  }
  if (system) body.system = system
  return body
}

async function readHttpError(response: Response): Promise<string> {
  const base = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  try {
    const text = (await response.text()).trim()
    if (!text) return base
    const parsed = tryParseJson(text)
    if (isRecord(parsed)) {
      const error = parsed.error
      if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) {
        return `${base}：${error.message.trim()}`
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return `${base}：${parsed.message.trim()}`
      }
    }
    return `${base}：${text.slice(0, 300)}`
  } catch {
    return base
  }
}

function completionStopReason(
  payload: unknown,
  kind: ProviderKind
): string | undefined {
  if (!isRecord(payload)) return undefined
  if (kind === 'anthropic') {
    return typeof payload.stop_reason === 'string' ? payload.stop_reason : undefined
  }
  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const choice = choices[0]
  if (!isRecord(choice)) return undefined
  return typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined
}

function parseOpenAiContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return ''
  }
  const choice = payload.choices[0]
  if (!isRecord(choice) || !isRecord(choice.message)) return ''
  return contentToText(choice.message.content)
}

function parseAnthropicContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return ''
  return payload.content
    .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .join('')
    .trim()
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      if (typeof part.text === 'string') return part.text
      if (isRecord(part.text) && typeof part.text.value === 'string') return part.text.value
      return ''
    })
    .join('')
    .trim()
}

function safeErrorMessage(error: unknown, apiKey?: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = redactSecrets(raw, apiKey)
  const hint =
    /HTTP 401|invalid credential|unauthorized/i.test(redacted)
      ? '。请检查 Provider、Base URL 与 API Key 是否匹配；必要时重新生成 Key。'
      : ''
  const message = `${redacted}${hint}`
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message
}

function redactSecrets(message: string, apiKey?: string): string {
  let result = message
  if (apiKey && apiKey.length >= 6) {
    result = result.split(apiKey).join('[已隐藏]')
  }
  return result
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-[已隐藏]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s,;}"']+/gi, '$1[已隐藏]')
    .replace(
      /("(?:api[-_]?key|token|secret|password)"\s*:\s*")[^"]*(")/gi,
      '$1[已隐藏]$2'
    )
}

function sanitizeContext(
  context: Record<string, unknown>,
  apiKey?: string
): Record<string, unknown> {
  const sanitized = sanitizeValue(context, 0, new Set<object>(), apiKey)
  return isRecord(sanitized) ? sanitized : {}
}

function sanitizeValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  apiKey?: string
): unknown {
  if (value === null) return null
  if (typeof value === 'string') {
    const redacted = redactSecrets(value, apiKey)
    return redacted.length > MAX_CONTEXT_STRING_CHARS
      ? `${redacted.slice(0, MAX_CONTEXT_STRING_CHARS)}…`
      : redacted
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'function' || typeof value === 'symbol') return '[不支持的值]'
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_CONTEXT_DEPTH) return '[层级过深已省略]'
  if (ancestors.has(value)) return '[循环引用]'

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_CONTEXT_ARRAY_ITEMS)
        .map((item) => sanitizeValue(item, depth + 1, ancestors, apiKey))
    }
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[已隐藏]'
        continue
      }
      result[key] = sanitizeValue(item, depth + 1, ancestors, apiKey)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function serializeContext(context: Record<string, unknown>): string {
  if (Object.keys(context).length === 0) return ''
  let json: string
  try {
    json = JSON.stringify(context)
  } catch {
    return ''
  }
  if (!json || json === '{}') return ''
  return json.length > MAX_CONTEXT_CHARS
    ? `${json.slice(0, MAX_CONTEXT_CHARS)}…（上下文过长，已截断）`
    : json
}

function extractCitations(context: Record<string, unknown>): LlmCitation[] {
  const raw = context.citations
  if (!Array.isArray(raw)) return []

  const citations: LlmCitation[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const label = fieldString(entry, 'label')
    if (!label) continue

    const citation: LlmCitation = { label }
    const file = fieldString(entry, 'file')
    const recordId = fieldString(entry, 'recordId')
    const date = fieldString(entry, 'date')
    if (file) citation.file = file
    if (recordId) citation.recordId = recordId
    if (date) citation.date = date

    citations.push(citation)
    if (citations.length >= MAX_CITATIONS) break
  }
  return citations
}

function buildFallbackContent(context: Record<string, unknown>): string {
  if (Object.keys(context).length === 0) {
    return '本地数据尚未就绪，暂时无法生成分析。请先运行一次数据抓取或回填，待校验通过后再试。'
  }

  const monitors = buildMonitorDigests(context.monitors)
  const alerts = summarizeAlerts(context.alerts)
  const validation = summarizeValidation(context.validation)

  const lines: string[] = [
    'AI 分析暂不可用，以下为本地数据摘要（未包含模型生成内容）：',
    '',
    '一、监测标的'
  ]

  if (monitors.length === 0) {
    lines.push('- 暂无监测数据。')
  } else {
    for (const monitor of monitors) lines.push(`- ${formatMonitor(monitor)}`)
  }

  lines.push('', '二、预警')
  for (const alert of alerts) lines.push(`- ${alert}`)

  lines.push('', '三、数据校验')
  for (const check of validation) lines.push(`- ${check}`)

  return lines.join('\n')
}

function buildMonitorDigests(value: unknown): MonitorDigest[] {
  const digests: MonitorDigest[] = []

  for (const [key, raw] of monitorEntries(value)) {
    if (!isRecord(raw)) continue
    const monitor = isRecord(raw.monitor) ? raw.monitor : raw
    const name =
      fieldString(monitor, 'displayName') ??
      fieldString(raw, 'displayName') ??
      fieldString(raw, 'monitorName') ??
      fieldString(raw, 'name') ??
      fieldString(raw, 'id') ??
      key

    const latestRaw = isRecord(raw.latest)
      ? raw.latest
      : raw.value !== undefined
        ? raw
        : undefined

    let latest: MonitorDigest['latest']
    if (latestRaw) {
      const latestValue = fieldString(latestRaw, 'value')
      if (latestValue) {
        latest = {
          value: latestValue,
          unit: fieldString(latestRaw, 'unit') ?? fieldString(monitor, 'unit'),
          date: fieldString(latestRaw, 'date'),
          source: fieldString(latestRaw, 'source')
        }
      }
    }

    digests.push({ name, latest, means: buildMeanSummaries(raw.means) })
  }

  return digests
}

function monitorEntries(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item])
  if (!isRecord(value)) return []
  if (looksLikeMonitor(value)) return [['monitor', value]]

  for (const key of ['items', 'monitors', 'data'] as const) {
    const nested = value[key]
    if (Array.isArray(nested)) return nested.map((item, index) => [String(index), item])
  }
  return Object.entries(value)
}

function looksLikeMonitor(value: Record<string, unknown>): boolean {
  return (
    isRecord(value.monitor) ||
    isRecord(value.latest) ||
    isRecord(value.means) ||
    'displayName' in value ||
    'monitorName' in value ||
    ('value' in value && 'unit' in value)
  )
}

function buildMeanSummaries(value: unknown): MonitorDigest['means'] {
  if (!isRecord(value)) return []

  const summaries: MonitorDigest['means'] = []
  for (const { key, label } of MEAN_PERIODS) {
    const aggregate = value[key]
    if (!isRecord(aggregate)) continue
    const mean = fieldString(aggregate, 'mean')
    if (!mean) continue
    summaries.push({
      label,
      value: mean,
      period:
        fieldString(aggregate, 'periodKey') ??
        fieldString(aggregate, 'endDate') ??
        fieldString(aggregate, 'startDate')
    })
  }
  return summaries
}

function formatMonitor(digest: MonitorDigest): string {
  const parts: string[] = []

  if (digest.latest) {
    const source = digest.latest.source
      ? SOURCE_LABELS[digest.latest.source] ?? digest.latest.source
      : undefined
    const meta = [digest.latest.date, source]
      .filter((item): item is string => Boolean(item))
      .join('，')
    const unit = digest.latest.unit ? ` ${digest.latest.unit}` : ''
    parts.push(`最新 ${digest.latest.value}${unit}${meta ? `（${meta}）` : ''}`)
  } else {
    parts.push('暂无有效最新值')
  }

  if (digest.means.length > 0) {
    parts.push(
      digest.means
        .map(
          (mean) =>
            `${mean.label}均值 ${mean.value}${mean.period ? `（${mean.period}）` : ''}`
        )
        .join('；')
    )
  }

  return `${digest.name}：${parts.join('；')}`
}

function summarizeAlerts(value: unknown): string[] {
  if (value === undefined || value === null) return ['未提供预警数据。']

  const entries = alertEntries(value)
  if (entries.length === 0) return ['当前无预警。']

  const lines = entries.slice(0, 5).map((entry) => {
    if (!isRecord(entry)) return String(entry)

    const severity = fieldString(entry, 'severity') ?? 'info'
    const title = fieldString(entry, 'title') ?? fieldString(entry, 'monitorName') ?? '预警'
    const date = fieldString(entry, 'date') ?? fieldString(entry, 'createdAt') ?? '日期未知'
    const status = fieldString(entry, 'status')
    const message = fieldString(entry, 'message')

    const severityLabel = SEVERITY_LABELS[severity] ?? severity
    const statusLabel = status ? ALERT_STATUS_LABELS[status] ?? status : undefined
    const meta = [date, statusLabel].filter(Boolean).join('，')
    const head = `[${severityLabel}] ${title}（${meta}）`
    return message ? `${head}：${message}` : head
  })

  if (entries.length > 5) lines.push(`…另有 ${entries.length - 5} 条预警未展示。`)
  return lines
}

function alertEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return []

  for (const key of ['items', 'alerts', 'data'] as const) {
    const nested = value[key]
    if (Array.isArray(nested)) return nested
  }
  return Object.keys(value).length > 0 ? [value] : []
}

function summarizeValidation(value: unknown): string[] {
  if (value === undefined || value === null) return ['未提供校验摘要。']

  if (Array.isArray(value)) {
    if (value.length === 0) return ['当前无校验记录。']

    let valid = 0
    let invalid = 0
    const problems: string[] = []

    for (const item of value) {
      if (!isRecord(item)) continue
      const status = fieldString(item, 'status')
      if (status === 'valid') valid += 1
      else if (status === 'invalid') invalid += 1
      problems.push(...stringArray(item.errors).slice(0, 2))
      problems.push(...stringArray(item.warnings).slice(0, 1))
    }

    const parts = [`记录 ${value.length} 条，有效 ${valid} 条，无效 ${invalid} 条`]
    if (problems.length > 0) parts.push(`问题：${problems.slice(0, 3).join('；')}`)
    return [parts.join('；')]
  }

  if (!isRecord(value)) return ['校验摘要格式无法识别。']

  const parts: string[] = []
  const status = fieldString(value, 'status')
  if (status) parts.push(`状态 ${VALIDATION_STATUS_LABELS[status] ?? status}`)

  const checkedAt = fieldString(value, 'checkedAt')
  if (checkedAt) parts.push(`检查时间 ${checkedAt}`)

  const validCount = countField(value, 'valid')
  const invalidCount = countField(value, 'invalid')
  const quarantinedCount = countField(value, 'quarantined')
  if (validCount !== undefined) parts.push(`有效 ${validCount} 条`)
  if (invalidCount !== undefined) parts.push(`无效 ${invalidCount} 条`)
  if (quarantinedCount !== undefined) parts.push(`隔离 ${quarantinedCount} 条`)

  const checks = value.checks
  if (Array.isArray(checks) && checks.length > 0) {
    let pass = 0
    let warn = 0
    let fail = 0
    for (const check of checks) {
      if (!isRecord(check)) continue
      const checkStatus = fieldString(check, 'status')
      if (checkStatus === 'pass') pass += 1
      else if (checkStatus === 'warn') warn += 1
      else if (checkStatus === 'fail') fail += 1
    }
    parts.push(`检查项 通过 ${pass} / 警告 ${warn} / 失败 ${fail}`)
  }

  const warnings = stringArray(value.warnings)
  const errors = stringArray(value.errors)
  if (warnings.length > 0) parts.push(`警告：${warnings.slice(0, 3).join('；')}`)
  if (errors.length > 0) parts.push(`错误：${errors.slice(0, 3).join('；')}`)

  const cross = isRecord(value.crossSource) ? value.crossSource : undefined
  if (cross) {
    const crossSource = fieldString(cross, 'source')
    const crossPassed =
      typeof cross.passed === 'boolean' ? (cross.passed ? '通过' : '未通过') : undefined
    const crossParts = [crossSource, crossPassed].filter(
      (item): item is string => Boolean(item)
    )
    if (crossParts.length > 0) parts.push(`交叉校验 ${crossParts.join(' ')}`)
  }

  return parts.length > 0 ? [parts.join('；')] : ['校验摘要为空。']
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
}

function countField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

function fieldString(
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  return value ? scalarToString(value[key]) : undefined
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return undefined
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
