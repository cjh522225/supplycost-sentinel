import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bot, FileText, MessageSquare, Send, Sparkles, Square, Trash2, User, Wand2 } from 'lucide-react'
import type { ConversationMessage, ConversationSummary, LlmChatMessage, LlmChatResponse, LlmCitation } from '@shared/types'
import { api, useSettings } from '../lib/api'
import { Badge } from '../components/Badge'
import { MarkdownMessage } from '../components/MarkdownMessage'
import { useToast } from '../components/Toast'
import { cn, formatDateTime } from '../lib/format'

interface ChatMessage extends LlmChatMessage {
  timestamp: string
  fallback?: boolean
  citations?: LlmCitation[]
  error?: string
  streaming?: boolean
  requestId?: string
}

const INITIAL_GREETING =
  '你好，我是链价智控的供应链成本分析助手。我只会使用本地已校验的数据回答，不会编造数字。你可以让我生成日报、解释预警，或查询某个标的的月/季/半年/年均值。'

function greeting(): ChatMessage {
  return { role: 'assistant', content: INITIAL_GREETING, timestamp: new Date().toISOString() }
}

const QUICK_PROMPTS = [
  { label: '生成今日成本日报', prompt: '请基于本地数据生成今日供应链成本日报。', mode: 'daily-report' as const },
  { label: '解释最新预警', prompt: '请解释当前最新预警，并给出数据证据。', mode: 'alert-explain' as const },
  { label: 'ADC12 月均走势', prompt: 'ADC12 最近几个月的月均走势如何？与上季度相比有什么变化？', mode: 'chat' as const },
  { label: '汇率风险提示', prompt: '美元和欧元汇率最近的变化对进口成本有什么影响？请只依据本地数据回答。', mode: 'chat' as const }
]

function thinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle" aria-label="思考中">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600 [animation-delay:-0.24s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600 [animation-delay:-0.12s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600" />
    </span>
  )
}

function toStoredMessages(messages: ChatMessage[]): ConversationMessage[] {
  return messages
    .filter((message) => !message.streaming && message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      fallback: message.fallback,
      citations: message.citations,
      error: message.error
    }))
}

export default function Assistant() {
  const settings = useSettings()
  const { push } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([greeting()])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'chat' | 'daily-report' | 'alert-explain'>('chat')
  const [loading, setLoading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [conversationLoaded, setConversationLoaded] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const activeRequestRef = useRef<string | null>(null)
  const llm = settings.data?.llm
  const reportQuery = useQuery({
    queryKey: ['latest-daily-report'],
    queryFn: () => api.latestDailyReport(),
    refetchInterval: 60_000
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await api.listConversations()
        if (cancelled) return
        setConversations(list)
        if (list.length > 0) {
          const conversation = await api.loadConversation(list[0].id)
          if (cancelled) return
          if (conversation) {
            setConversationId(conversation.id)
            setMessages(
              conversation.messages.length
                ? conversation.messages.map((message) => ({
                    ...message,
                    timestamp: message.timestamp ?? new Date().toISOString()
                  }))
                : [greeting()]
            )
          }
        } else {
          const created = await api.createConversation()
          if (cancelled) return
          setConversationId(created.id)
          setConversations(await api.listConversations())
          setMessages([greeting()])
        }
      } catch {
        if (!cancelled) {
          const created = await api.createConversation().catch(() => undefined)
          if (created) {
            setConversationId(created.id)
            setMessages([greeting()])
          }
        }
      } finally {
        if (!cancelled) setConversationLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const off = api.onLlmChunk(({ requestId, chunk }) => {
      if (requestId !== activeRequestRef.current) return
      setThinking(false)
      setStreaming(true)
      setMessages((current) =>
        current.map((message) =>
          message.requestId === requestId
            ? { ...message, content: `${message.content}${chunk}`, streaming: true }
            : message
        )
      )
    })
    return off
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, thinking, streaming])

  useEffect(() => {
    if (!conversationLoaded || !conversationId || loading || messages.some((message) => message.streaming)) return
    const timer = window.setTimeout(() => {
      void api
        .saveConversation(conversationId, toStoredMessages(messages))
        .then(() => api.listConversations())
        .then((list) => setConversations(list))
        .catch(() => undefined)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [conversationId, conversationLoaded, loading, messages])

  const send = async (text: string, sendMode: 'chat' | 'daily-report' | 'alert-explain' = mode) => {
    const content = text.trim()
    if (!content || loading) return
    const requestId = crypto.randomUUID()
    activeRequestRef.current = requestId
    const next: ChatMessage[] = [
      ...messages,
      { role: 'user', content, timestamp: new Date().toISOString() },
      { role: 'assistant', content: '', timestamp: new Date().toISOString(), streaming: true, requestId }
    ]
    setMessages(next)
    setInput('')
    setLoading(true)
    setThinking(true)
    setStreaming(false)
    try {
      const history = next
        .filter((message) => message.content.trim())
        .slice(-12)
        .map(({ role, content: messageContent }) => ({ role, content: messageContent }))
      const response: LlmChatResponse = await api.llmChatStream(requestId, {
        messages: history,
        mode: sendMode
      })
      setMessages((current) =>
        current.map((message) =>
          message.requestId === requestId
            ? {
                ...message,
                content:
                  response.content.length >= message.content.length
                    ? response.content
                    : message.content,
                fallback: response.fallback,
                citations: response.citations,
                error: response.error,
                streaming: false
              }
            : message
        )
      )
      if (!response.ok && response.error && response.error !== '已停止生成') push(response.error, 'error')
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      setMessages((current) =>
        current.map((message) =>
          message.requestId === requestId
            ? {
                ...message,
                content: `请求失败：${messageText}。已保留本地模板能力，请稍后重试。`,
                fallback: true,
                streaming: false,
                error: messageText
              }
            : message
        )
      )
      push(messageText, 'error')
    } finally {
      activeRequestRef.current = null
      setLoading(false)
      setThinking(false)
      setStreaming(false)
    }
  }

  const stopGeneration = async () => {
    const requestId = activeRequestRef.current
    if (!requestId) return
    await api.cancelLlmChat(requestId)
    setThinking(false)
  }

  const generateReport = async () => {
    if (reporting) return
    setReporting(true)
    try {
      const report = await api.generateDailyReport(true)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: report.content,
          timestamp: new Date().toISOString(),
          fallback: report.fallback,
          citations: report.citations,
          error: report.error
        }
      ])
      await reportQuery.refetch()
      push(report.fallback ? '日报已生成（本地模板）' : '日报已生成并保存', report.fallback ? 'info' : 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setReporting(false)
    }
  }

  const newConversation = async () => {
    if (loading) return
    const created = await api.createConversation()
    activeRequestRef.current = null
    setConversationId(created.id)
    setMessages([greeting()])
    setThinking(false)
    setStreaming(false)
    setConversations(await api.listConversations())
    push('已开始新对话', 'info')
  }

  const switchConversation = async (id: string) => {
    if (loading || id === conversationId) return
    const conversation = await api.loadConversation(id)
    if (!conversation) return
    activeRequestRef.current = null
    setConversationId(conversation.id)
    setMessages(
      conversation.messages.length
        ? conversation.messages.map((message) => ({
            ...message,
            timestamp: message.timestamp ?? new Date().toISOString()
          }))
        : [greeting()]
    )
    setThinking(false)
    setStreaming(false)
  }

  const deleteConversation = async (id: string) => {
    if (loading) return
    if (!window.confirm('删除这条对话历史？')) return
    const remaining = await api.deleteConversation(id)
    setConversations(remaining)
    if (id !== conversationId) return
    const latest = remaining[0]
    if (latest) {
      const conversation = await api.loadConversation(latest.id)
      if (conversation) {
        setConversationId(conversation.id)
        setMessages(
          conversation.messages.length
            ? conversation.messages.map((message) => ({
                ...message,
                timestamp: message.timestamp ?? new Date().toISOString()
              }))
            : [greeting()]
        )
      }
    } else {
      const created = await api.createConversation()
      setConversationId(created.id)
      setMessages([greeting()])
      setConversations(await api.listConversations())
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="panel flex min-h-[640px] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">智能分析助手</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {llm?.enabled && llm.hasApiKey ? `${llm.provider} · ${llm.model}` : '未配置 API Key，使用本地模板回答'}
                {' · '}对话自动保存在本地
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone={llm?.enabled && llm.hasApiKey ? 'green' : 'amber'}>{llm?.enabled && llm.hasApiKey ? 'LLM 已启用' : '模板模式'}</Badge>
            <button className="btn-secondary !h-8 !px-2.5 !text-[11px]" onClick={() => void generateReport()} disabled={reporting}>
              <FileText size={12} /> {reporting ? '生成中…' : '生成日报'}
            </button>
            <button className="btn-secondary !h-8 !px-2.5 !text-[11px]" onClick={() => void newConversation()} disabled={loading}>
              <Trash2 size={12} /> 新对话
            </button>
            <Link className="btn-secondary !h-8 !px-2.5 !text-[11px]" to="/settings">
              配置
            </Link>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((message, index) => (
            <div key={`${message.timestamp}-${index}`} className={cn('flex gap-2.5', message.role === 'user' ? 'justify-end' : 'justify-start')}>
              {message.role !== 'user' ? (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                  <Bot size={15} />
                </div>
              ) : null}
              <div
                className={cn(
                  'max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-6',
                  message.role === 'user'
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200'
                )}
              >
                {message.role === 'assistant' ? (
                  message.content ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {thinkingDots()}
                      <span>正在检索本地数据并思考…</span>
                    </div>
                  )
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
                {message.streaming && message.content ? <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-teal-600 align-middle" /> : null}
                {message.fallback ? (
                  <div className="mt-2 space-y-1.5">
                    <Badge tone="amber">本地模板</Badge>
                    {message.error ? (
                      <div className="rounded-lg bg-amber-50/80 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        原因：{message.error}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {message.citations?.length ? (
                  <div className="mt-2 space-y-1 border-t border-slate-200/60 pt-2 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <div className="font-medium">数据来源</div>
                    {message.citations.slice(0, 5).map((citation, citationIndex) => (
                      <div key={citationIndex} className="font-mono">
                        {citation.label}
                        {citation.file ? ` · ${citation.file}` : ''}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {message.role === 'user' ? (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <User size={15} />
                </div>
              ) : null}
            </div>
          ))}
          {streaming && !messages.some((message) => message.streaming && message.content) ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {thinkingDots()}
              <span>正在生成回答…</span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt.label}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                onClick={() => void send(prompt.prompt, prompt.mode)}
                disabled={loading}
              >
                <Wand2 size={11} className="mr-1 inline" />
                {prompt.label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              className="input min-h-[44px] flex-1 resize-none py-2.5"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(input)
                }
              }}
              placeholder="询问均值、走势、预警或成本影响；Enter 发送，Shift+Enter 换行"
              rows={1}
            />
            {loading ? (
              <button className="btn-secondary h-[44px]" onClick={() => void stopGeneration()}>
                <Square size={13} /> 停止
              </button>
            ) : (
              <button className="btn-primary h-[44px]" onClick={() => void send(input)} disabled={!input.trim()}>
                <Send size={15} /> 发送
              </button>
            )}
          </div>
          <div className="mt-1.5 text-[10px] text-slate-400">
            所有数字来自本地 validated JSON；AI 只负责组织语言，不参与计算。对话历史保存在 data/conversations。
          </div>
        </div>
      </section>

      <aside className="space-y-3">
        <div className="panel px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <FileText size={15} className="text-teal-700 dark:text-teal-300" /> 使用说明
          </div>
          <ul className="mt-2 space-y-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            <li>· 助手只读取本地已校验数据，不访问外部行情。</li>
            <li>· 支持日报、预警解释、均值查询和趋势总结。</li>
            <li>· 无 API Key 时自动使用本地模板，功能不中断。</li>
            <li>· 支持流式输出，对话会自动保存。</li>
            <li>· 支持 opencode-go、OpenAI、DeepSeek、GLM、Claude 与自定义兼容接口。</li>
          </ul>
        </div>
        <div className="panel px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <MessageSquare size={15} className="text-teal-700 dark:text-teal-300" /> 历史对话
            </div>
            <Badge tone="slate">{conversations.length}</Badge>
          </div>
          <div className="mt-2 max-h-56 space-y-1 overflow-auto">
            {conversations.length === 0 ? (
              <div className="py-3 text-[11px] text-slate-400">暂无历史对话</div>
            ) : (
              conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px]',
                    conversation.id === conversationId
                      ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-200'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  )}
                >
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => void switchConversation(conversation.id)} title={conversation.title}>
                    <span className="block truncate">{conversation.title}</span>
                    <span className="block text-[9px] text-slate-400">{conversation.messageCount} 条 · {formatDateTime(conversation.updatedAt)}</span>
                  </button>
                  <button
                    className="shrink-0 rounded p-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40"
                    onClick={(event) => {
                      event.stopPropagation()
                      void deleteConversation(conversation.id)
                    }}
                    title="删除对话"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="panel px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">最近 AI 日报</div>
            {reportQuery.data ? <Badge tone={reportQuery.data.fallback ? 'amber' : 'green'}>{reportQuery.data.fallback ? '模板' : 'AI'}</Badge> : null}
          </div>
          {reportQuery.data ? (
            <div className="mt-2">
              <div className="text-[10px] text-slate-400">{reportQuery.data.date} · {formatDateTime(reportQuery.data.generatedAt)}</div>
              <div className="mt-1 line-clamp-5 whitespace-pre-wrap text-[11px] leading-5 text-slate-600 dark:text-slate-300">{reportQuery.data.content}</div>
              <button
                className="btn-secondary mt-2 !h-7 !px-2 !text-[10px]"
                onClick={() => {
                  if (!reportQuery.data) return
                  setMessages((current) => [...current, { role: 'assistant', content: reportQuery.data!.content, timestamp: new Date().toISOString(), fallback: reportQuery.data!.fallback, citations: reportQuery.data!.citations, error: reportQuery.data!.error }])
                }}
              >
                <FileText size={11} /> 载入到对话
              </button>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-slate-400">尚无日报；抓取后会自动生成，或点击顶部“生成日报”。</div>
          )}
        </div>
        <div className="panel px-4 py-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">推荐提问</div>
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <div>“2025 年 3 月 ADC12 月均是多少？”</div>
            <div>“最近一个月哪些标的触发预警？”</div>
            <div>“美元汇率变化对成本的影响？”</div>
            <div>“生成本周供应链成本摘要。”</div>
          </div>
        </div>
        <div className="panel-muted px-4 py-3 text-[10px] leading-5 text-slate-500 dark:text-slate-400">
          配置路径：设置 → 智能分析。Key 使用 Electron safeStorage 加密保存，不写入源码或日志。
        </div>
      </aside>
    </div>
  )
}
