import { Link } from 'react-router-dom'
import { Activity, ArrowRight, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { SourceHealthItem } from '@shared/types'
import { useSourceHealth } from '../lib/api'
import { Badge } from './Badge'
import { cn, formatDateTime, formatRelative } from '../lib/format'

const STATE: Record<SourceHealthItem['status'], { label: string; dot: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  ok: { label: '正常', dot: 'bg-emerald-500', tone: 'green' },
  warning: { label: '注意', dot: 'bg-amber-500', tone: 'amber' },
  error: { label: '异常', dot: 'bg-red-500', tone: 'red' },
  idle: { label: '待运行', dot: 'bg-slate-400', tone: 'slate' },
  disabled: { label: '未启用', dot: 'bg-slate-400', tone: 'slate' }
}

export function SourceHealthPanel() {
  const health = useSourceHealth()
  const items = health.data?.items ?? []

  return (
    <section className="panel flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Activity size={15} className="text-teal-700 dark:text-teal-300" /> 数据源健康度
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">官方源 + 第三方实时源</div>
        </div>
        <button className="btn-ghost !h-7 !px-2 !text-[10px]" onClick={() => void health.refetch()} disabled={health.isFetching}>
          <RefreshCw size={12} className={health.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-[11px] text-slate-500 dark:text-slate-400">暂无数据源状态</div>
        ) : (
          items.map((item) => {
            const state = STATE[item.status]
            return (
              <div key={item.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', state.dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {item.demo ? <Badge tone="amber">演示</Badge> : null}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">{item.message ?? '—'}</div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[9px] text-slate-400">
                    {item.lastSuccessAt ? <span>最近成功 {formatRelative(item.lastSuccessAt)}</span> : null}
                    {item.validRecords !== undefined ? <span>有效 {item.validRecords}</span> : null}
                    {item.quarantinedRecords ? <span className="text-amber-600">隔离 {item.quarantinedRecords}</span> : null}
                    {item.delayMs !== undefined ? <span>延迟 {item.delayMs} ms</span> : null}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400 dark:border-slate-800">
        <span className="inline-flex items-center gap-1">
          {items.some((item) => item.status === 'error') ? <ShieldAlert size={12} className="text-red-500" /> : <ShieldCheck size={12} className="text-emerald-500" />}
          {health.data?.generatedAt ? formatDateTime(health.data.generatedAt) : '等待检查'}
        </span>
        <Link className="inline-flex items-center gap-1 hover:text-teal-700 dark:hover:text-teal-300" to="/audit">
          审计 <ArrowRight size={11} />
        </Link>
      </div>
    </section>
  )
}
