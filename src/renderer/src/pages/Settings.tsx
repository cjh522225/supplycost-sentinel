import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, CheckCircle2, FolderOpen, KeyRound, Save, ShieldCheck, Sparkles, TestTube2 } from 'lucide-react'
import type { AppSettings, LlmProvider, RealtimeProviderId } from '@shared/types'
import { LLM_PROVIDER_PRESETS, REALTIME_PROVIDER_PRESETS } from '@shared/constants'
import { api, useSettings } from '../lib/api'
import { Badge } from '../components/Badge'
import { useToast } from '../components/Toast'
import { cn } from '../lib/format'

const PROVIDERS = Object.entries(LLM_PROVIDER_PRESETS) as [LlmProvider, (typeof LLM_PROVIDER_PRESETS)[LlmProvider]][]

export default function Settings() {
  const settingsQuery = useSettings()
  const queryClient = useQueryClient()
  const { push } = useToast()
  const [form, setForm] = useState<AppSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [realtimeApiKey, setRealtimeApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingRealtime, setTestingRealtime] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [realtimeTestResult, setRealtimeTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (settingsQuery.data && !initialized.current) {
      setForm(settingsQuery.data)
      initialized.current = true
    }
  }, [settingsQuery.data])

  if (!form) {
    return <div className="panel px-4 py-10 text-center text-sm text-slate-500">加载设置…</div>
  }

  const patch = (next: Partial<AppSettings>) => setForm((current) => (current ? { ...current, ...next } : current))
  const patchSchedule = (next: Partial<AppSettings['schedule']>) => setForm((current) => (current ? { ...current, schedule: { ...current.schedule, ...next } } : current))
  const patchValidation = (next: Partial<AppSettings['validation']>) =>
    setForm((current) => (current ? { ...current, validation: { ...current.validation, ...next } } : current))
  const patchPrecision = (next: Partial<AppSettings['precision']>) =>
    setForm((current) => (current ? { ...current, precision: { ...current.precision, ...next } } : current))
  const patchLlm = (next: Partial<AppSettings['llm']>) => setForm((current) => (current ? { ...current, llm: { ...current.llm, ...next } } : current))
  const patchRealtime = (next: Partial<AppSettings['realtime']>) =>
    setForm((current) => (current ? { ...current, realtime: { ...current.realtime, ...next } } : current))
  const patchReports = (next: Partial<AppSettings['reports']>) =>
    setForm((current) => (current ? { ...current, reports: { ...current.reports, ...next } } : current))

  const changeProvider = (provider: LlmProvider) => {
    const preset = LLM_PROVIDER_PRESETS[provider]
    patchLlm({ provider, baseUrl: preset.baseUrl, model: preset.model })
  }

  const save = async () => {
    if (!form || saving) return
    setSaving(true)
    try {
      const payload: AppSettings & {
        llm: AppSettings['llm'] & { apiKey?: string }
        realtime: AppSettings['realtime'] & { apiKey?: string }
      } = {
        ...form,
        llm: {
          ...form.llm,
          apiKey: apiKey.trim() || undefined
        },
        realtime: {
          ...form.realtime,
          apiKey: realtimeApiKey.trim() || undefined
        }
      }
      const saved = await api.saveSettings(payload)
      setForm(saved)
      setApiKey('')
      setRealtimeApiKey('')
      localStorage.setItem('theme', saved.theme === 'dark' ? 'dark' : 'light')
      document.documentElement.classList.toggle('dark', saved.theme === 'dark')
      await queryClient.invalidateQueries()
      push('设置已保存', 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.llmTest({
        enabled: form.llm.enabled,
        provider: form.llm.provider,
        baseUrl: form.llm.baseUrl,
        model: form.llm.model,
        temperature: form.llm.temperature,
        maxTokens: form.llm.maxTokens,
        apiKey: apiKey.trim() || undefined
      })
      setTestResult({
        ok: result.ok,
        message: `${result.message}${result.latencyMs ? `（${result.latencyMs}ms）` : ''}`
      })
      push(
        result.ok
          ? '当前表单连接成功；如已修改配置，请点击“保存设置”后再对话'
          : result.message,
        result.ok ? 'success' : 'error'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTestResult({ ok: false, message })
      push(message, 'error')
    } finally {
      setTesting(false)
    }
  }

  const testRealtime = async () => {
    if (testingRealtime) return
    setTestingRealtime(true)
    setRealtimeTestResult(null)
    try {
      const result = await api.realtimeTest({
        ...form.realtime,
        apiKey: realtimeApiKey.trim() || undefined
      })
      setRealtimeTestResult({
        ok: result.ok,
        message: `${result.message}${result.latencyMs ? `（${result.latencyMs}ms）` : ''}`
      })
      push(result.ok ? '实时行情连接成功' : result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRealtimeTestResult({ ok: false, message })
      push(message, 'error')
    } finally {
      setTestingRealtime(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="page-title">设置</div>
          <div className="page-subtitle">调度、校验、精度、数据目录与智能分析配置</div>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save size={15} /> {saving ? '保存中…' : '保存设置'}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel px-4 py-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">采集与调度</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">启用定时抓取</span>
              <select className="input" value={String(form.schedule.enabled)} onChange={(event) => patchSchedule({ enabled: event.target.value === 'true' })}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">抓取时间（逗号分隔）</span>
              <input
                className="input"
                value={form.schedule.times.join(', ')}
                onChange={(event) =>
                  patchSchedule({
                    times: event.target.value
                      .split(',')
                      .map((time) => time.trim())
                      .filter(Boolean)
                  })
                }
                placeholder="10:00, 17:00"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">启动后补抓</span>
              <select className="input" value={String(form.schedule.catchUp)} onChange={(event) => patchSchedule({ catchUp: event.target.value === 'true' })}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">回填起始日期</span>
              <input className="input" type="date" value={form.backfill.startDate} onChange={(event) => patch({ backfill: { ...form.backfill, startDate: event.target.value } })} />
            </label>
            <label className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">数据目录</span>
              <div className="flex gap-2">
                <input className="input font-mono" value={form.dataDir} onChange={(event) => patch({ dataDir: event.target.value })} />
                <button className="btn-secondary shrink-0" onClick={() => void api.openDataFolder()} title="打开当前数据目录">
                  <FolderOpen size={14} />
                </button>
              </div>
              <span className="mt-1 block text-[10px] text-slate-400">相对路径基于程序目录；修改后会自动切换并创建目录结构。</span>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">Asian Metal 模式</span>
              <select className="input" value={form.asianMetalMode} onChange={(event) => patch({ asianMetalMode: event.target.value as 'manual' | 'csv' })}>
                <option value="manual">手动录入 + CSV</option>
                <option value="csv">CSV 导入优先</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">主题</span>
              <select className="input" value={form.theme} onChange={(event) => patch({ theme: event.target.value as AppSettings['theme'] })}>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="system">跟随系统</option>
              </select>
            </label>
          </div>
        </section>

        <section className="panel px-4 py-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">校验与精度</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {([
              { label: '汇率日波动阈值 %', value: form.validation.fxChangePct, onChange: (value: number) => patchValidation({ fxChangePct: value }) },
              { label: '金属日波动阈值 %', value: form.validation.metalChangePct, onChange: (value: number) => patchValidation({ metalChangePct: value }) },
              { label: '汇率多源容差', value: form.validation.fxCrossTolerance, onChange: (value: number) => patchValidation({ fxCrossTolerance: value }) },
              { label: '金属多源容差 %', value: form.validation.metalCrossTolerance, onChange: (value: number) => patchValidation({ metalCrossTolerance: value }) },
              { label: '金属最小合理值', value: form.validation.minMetal, onChange: (value: number) => patchValidation({ minMetal: value }) },
              { label: '金属最大合理值', value: form.validation.maxMetal, onChange: (value: number) => patchValidation({ maxMetal: value }) },
              { label: '汇率最小合理值', value: form.validation.minFx, onChange: (value: number) => patchValidation({ minFx: value }) },
              { label: '汇率最大合理值', value: form.validation.maxFx, onChange: (value: number) => patchValidation({ maxFx: value }) }
            ] as { label: string; value: number; onChange: (value: number) => void }[]).map((field) => (
              <label key={field.label} className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">{field.label}</span>
                <input
                  className="input"
                  type="number"
                  step="any"
                  value={field.value}
                  onChange={(event) => field.onChange(Number(event.target.value))}
                />
              </label>
            ))}
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">FX 跨源严格模式</span>
              <select className="input" value={String(form.validation.strictFxCrossSource)} onChange={(event) => patchValidation({ strictFxCrossSource: event.target.value === 'true' })}>
                <option value="true">PBOC↔CFETS 超差即隔离</option>
                <option value="false">偏差仅警告</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">金属跨源严格模式</span>
              <select className="input" value={String(form.validation.strictMetalCrossSource)} onChange={(event) => patchValidation({ strictMetalCrossSource: event.target.value === 'true' })}>
                <option value="false">偏差仅警告</option>
                <option value="true">SMM↔AM 超差即隔离</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">汇率展示精度</span>
              <input className="input" type="number" min={0} max={8} value={form.precision.fx} onChange={(event) => patchPrecision({ fx: Number(event.target.value) })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">金属展示精度</span>
              <input className="input" type="number" min={0} max={8} value={form.precision.metal} onChange={(event) => patchPrecision({ metal: Number(event.target.value) })} />
            </label>
          </div>
        </section>
      </div>

      <section className="panel px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Sparkles size={16} className="text-teal-700 dark:text-teal-300" /> 智能分析
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              支持 opencode-go、OpenAI、DeepSeek、智谱 GLM、Anthropic Claude 与自定义 OpenAI 兼容接口；Key 使用 safeStorage 加密。
            </div>
          </div>
          <button className="btn-secondary" onClick={test} disabled={testing || !form.llm.enabled}>
            <TestTube2 size={14} /> {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">启用 LLM</span>
            <select className="input" value={String(form.llm.enabled)} onChange={(event) => patchLlm({ enabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用（模板回答）</option>
            </select>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">Provider</span>
            <select className="input" value={form.llm.provider} onChange={(event) => changeProvider(event.target.value as LlmProvider)}>
              {PROVIDERS.map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">Base URL</span>
            <input className="input font-mono !text-[11px]" value={form.llm.baseUrl} onChange={(event) => patchLlm({ baseUrl: event.target.value })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">模型</span>
            <input className="input font-mono !text-[11px]" list="model-options" value={form.llm.model} onChange={(event) => patchLlm({ model: event.target.value })} />
            <datalist id="model-options">
              {(LLM_PROVIDER_PRESETS[form.llm.provider]?.models ?? []).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400 md:col-span-2">
            <span className="mb-1 block">API Key {form.llm.hasApiKey ? '（已保存，留空则不修改）' : ''}</span>
            <div className="flex items-center gap-2">
              <KeyRound size={15} className="shrink-0 text-slate-400" />
              <input
                className="input font-mono"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={form.llm.hasApiKey ? '••••••••（已加密保存）' : '粘贴 API Key'}
                autoComplete="off"
              />
            </div>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">Temperature</span>
            <input className="input" type="number" step="0.1" min={0} max={2} value={form.llm.temperature} onChange={(event) => patchLlm({ temperature: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">Max Tokens</span>
            <input className="input" type="number" min={64} max={4096} value={form.llm.maxTokens} onChange={(event) => patchLlm({ maxTokens: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">启用 AI 日报</span>
            <select className="input" value={String(form.reports.enabled)} onChange={(event) => patchReports({ enabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">抓取后自动生成</span>
            <select className="input" value={String(form.reports.autoAfterFetch)} onChange={(event) => patchReports({ autoAfterFetch: event.target.value === 'true' })}>
              <option value="true">自动</option>
              <option value="false">仅手动</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <Badge tone={form.llm.hasApiKey ? 'green' : 'amber'}>
            <ShieldCheck size={12} /> {form.llm.hasApiKey ? 'Key 已加密保存' : '尚未保存 Key'}
          </Badge>
          <span>opencode-go 预设：base URL 已填入，模型默认 deepseek-v4.1-flash；也可切换其他模型。</span>
        </div>
        {testResult ? (
          <div
            className={cn(
              'mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-5',
              testResult.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200'
            )}
          >
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <div>
              <div>{testResult.message}</div>
              {testResult.ok ? (
                <div className="mt-1 text-[10px] opacity-80">
                  本次测试使用当前表单；如已修改配置，请点击“保存设置”后再发起对话。
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Activity size={16} className="text-sky-700 dark:text-sky-300" /> 实时行情参考（第三方）
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              第三方参考价，不进入 PBOC/CFETS 官方均值和验收口径；无 Key 时可先用演示行情检查界面。
            </div>
          </div>
          <button
            className="btn-secondary"
            onClick={testRealtime}
            disabled={testingRealtime || !form.realtime.enabled}
          >
            <TestTube2 size={14} /> {testingRealtime ? '测试中…' : '测试实时行情'}
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">启用实时行情</span>
            <select className="input" value={String(form.realtime.enabled)} onChange={(event) => patchRealtime({ enabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">Provider</span>
            <select
              className="input"
              value={form.realtime.provider}
              onChange={(event) => {
                const provider = event.target.value as RealtimeProviderId
                patchRealtime({ provider, baseUrl: REALTIME_PROVIDER_PRESETS[provider].baseUrl })
              }}
            >
              {Object.entries(REALTIME_PROVIDER_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">轮询间隔（秒）</span>
            <input className="input" type="number" min={15} max={3600} value={form.realtime.pollSeconds} onChange={(event) => patchRealtime({ pollSeconds: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">过期阈值（秒）</span>
            <input className="input" type="number" min={30} max={86400} value={form.realtime.staleSeconds} onChange={(event) => patchRealtime({ staleSeconds: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400 md:col-span-2">
            <span className="mb-1 block">Base URL</span>
            <input className="input font-mono !text-[11px]" value={form.realtime.baseUrl} onChange={(event) => patchRealtime({ baseUrl: event.target.value })} placeholder={REALTIME_PROVIDER_PRESETS[form.realtime.provider].baseUrl} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400 md:col-span-2">
            <span className="mb-1 block">API Key {form.realtime.hasApiKey ? '（已保存，留空则不修改）' : ''}</span>
            <div className="flex items-center gap-2">
              <KeyRound size={15} className="shrink-0 text-slate-400" />
              <input className="input font-mono" type="password" value={realtimeApiKey} onChange={(event) => setRealtimeApiKey(event.target.value)} placeholder={form.realtime.provider === 'mock' ? '演示行情无需 Key' : '粘贴第三方行情 API Key'} autoComplete="off" />
            </div>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">窗口（分钟）</span>
            <input className="input" type="number" min={1} max={1440} value={form.realtime.windowMinutes} onChange={(event) => patchRealtime({ windowMinutes: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">实时波动阈值 %</span>
            <input className="input" type="number" step="0.05" min={0.01} value={form.realtime.changePct} onChange={(event) => patchRealtime({ changePct: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">预警冷却（分钟）</span>
            <input className="input" type="number" min={1} max={1440} value={form.realtime.cooldownMinutes} onChange={(event) => patchRealtime({ cooldownMinutes: Number(event.target.value) })} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">深度 / 成交</span>
            <div className="flex gap-3 pt-2 text-[11px]">
              <label className="flex items-center gap-1"><input type="checkbox" checked={form.realtime.depthEnabled} onChange={(event) => patchRealtime({ depthEnabled: event.target.checked })} /> 深度</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={form.realtime.tradesEnabled} onChange={(event) => patchRealtime({ tradesEnabled: event.target.checked })} /> 成交</label>
            </div>
          </label>
        </div>
        <div className="mt-2 text-[10px] text-slate-400">{REALTIME_PROVIDER_PRESETS[form.realtime.provider].note}</div>
        {form.realtime.provider === 'twelvedata' ? (
          <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">
            Basic 套餐实测 8 credits/分钟、800 credits/天；2 个币种 60 秒轮询约 6.7 小时会耗尽每日额度，长时间运行建议提高到 180 秒以上或升级套餐。
          </div>
        ) : null}
        {realtimeTestResult ? (
          <div className={cn('mt-3 rounded-xl px-3 py-2 text-[11px] leading-5', realtimeTestResult.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200')}>
            {realtimeTestResult.message}
          </div>
        ) : null}
      </section>

      <div className="panel-muted px-4 py-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        说明：Asian Metal 价格/历史需要会员权限，系统按赛题描述保留手动录入与 CSV 导入；PBOC / SMM / CFETS 为自动抓取与校验源。修改系统时间进入新月份/年份时，应用会自动创建新的轮转文件。
      </div>
    </div>
  )
}
