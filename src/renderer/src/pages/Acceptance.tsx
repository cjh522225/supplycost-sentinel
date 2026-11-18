import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, Clock3, Database, History, Play, RefreshCw, ShieldCheck, SlidersHorizontal, XCircle } from 'lucide-react'
import type { AcceptanceCheckResult, AcceptanceId } from '@shared/types'
import { api } from '../lib/api'
import { Badge } from '../components/Badge'
import { useToast } from '../components/Toast'
import { cn } from '../lib/format'

const CHECKS: { id: AcceptanceId; title: string; desc: string; icon: typeof ShieldCheck }[] = [
  { id: 'history-means', title: '历史均值复算', desc: '抽取完整历史自然月，独立复算日/月均值，校验无精度流失。', icon: History },
  { id: 'local-files', title: '本地文件存储', desc: '检查 data 目录 JSON/CSV 文件，确认无 .db/.sqlite 数据库文件。', icon: Database },
  { id: 'rotation', title: '时间轮转', desc: '检查跨期轮转日志；修改系统时间进入新月份后会自动创建新文件。', icon: Clock3 },
  { id: 'cross-year', title: '跨年读取', desc: '确认 aggregates/validated 覆盖多个年份，跨卷查询可自动拼接。', icon: RefreshCw },
  { id: 'dynamic-config', title: '动态配置', desc: '检查 FX/金属标的并存，PBOC 原始数据可用于新增 GBP 复用历史。', icon: SlidersHorizontal },
  { id: 'data-accuracy', title: '数据准确性', desc: '从 validated JSON 独立重算月均值，与 aggregates JSON 对比。', icon: ShieldCheck }
]

export default function Acceptance() {
  const [results, setResults] = useState<Record<string, AcceptanceCheckResult>>({})
  const [running, setRunning] = useState<string | null>(null)
  const { push } = useToast()
  const queryClient = useQueryClient()

  const run = async (id: AcceptanceId) => {
    setRunning(id)
    try {
      const result = await api.acceptanceRun(id)
      setResults((prev) => ({ ...prev, [id]: result }))
      push(`${result.title}：${result.passed ? '通过' : '未通过'}`, result.passed ? 'success' : 'error')
      await queryClient.invalidateQueries()
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    for (const check of CHECKS) await run(check.id)
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">验收模式</div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            对应赛题验收项：历史均值、本地文件、时间轮转、跨年读取、动态配置、数据准确性。每项均可生成证据。
          </div>
        </div>
        <button className="btn-primary" onClick={runAll} disabled={Boolean(running)}>
          <ClipboardCheck size={15} /> 运行全部检查
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {CHECKS.map((check) => {
          const Icon = check.icon
          const result = results[check.id]
          return (
            <section key={check.id} className="panel flex flex-col px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                    <Icon size={17} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{check.title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{check.desc}</div>
                  </div>
                </div>
                {result ? (
                  <Badge tone={result.passed ? 'green' : 'red'}>
                    {result.passed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {result.passed ? '通过' : '未通过'}
                  </Badge>
                ) : (
                  <Badge tone="slate">待检查</Badge>
                )}
              </div>
              <button className="btn-secondary mt-3 w-full" onClick={() => void run(check.id)} disabled={Boolean(running)}>
                {running === check.id ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                {running === check.id ? '检查中…' : '运行检查'}
              </button>
              {result ? (
                <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {result.details.map((detail, index) => (
                    <div key={index} className={cn('break-words', index === 0 && 'font-medium text-slate-800 dark:text-slate-100')}>
                      {detail}
                    </div>
                  ))}
                  <details className="pt-1">
                    <summary className="cursor-pointer text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">查看证据 JSON</summary>
                    <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] leading-4 text-slate-300">{JSON.stringify(result.evidence, null, 2)}</pre>
                  </details>
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      <div className="panel-muted flex items-start gap-2 px-4 py-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        <Clock3 size={15} className="mt-0.5 shrink-0 text-teal-700 dark:text-teal-300" />
        现场演示“时间轮转”时，可在 Windows 设置中把系统时间改到下一个月/年，等待 30 秒；应用会检测跨期并创建新文件、写入轮转日志。演示结束请改回正确时间。
      </div>
    </div>
  )
}
