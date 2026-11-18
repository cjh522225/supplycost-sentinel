import type { MonitorView } from '@shared/types'
import { useRealtime } from '../lib/api'
import { cn, formatNumber, formatPct, sourceLabel } from '../lib/format'
import { Badge } from './Badge'

function direction(value: number | undefined): 'up' | 'down' | 'flat' {
  if (value === undefined || value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

export function Watchlist({
  monitors,
  selectedId,
  onSelect
}: {
  monitors: MonitorView[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const realtime = useRealtime()
  const quotes = new Map((realtime.data?.quotes ?? []).map((quote) => [quote.productId, quote]))

  return (
    <section className="panel hidden w-full overflow-hidden xl:block">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Market Watch</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">官方中间价为主口径 · 实时行情为第三方参考</div>
        </div>
        <div className="text-[10px] text-slate-400">点击行切换焦点图表</div>
      </div>
      <div className="overflow-auto">
        <table className="table min-w-[900px]">
          <thead>
            <tr>
              <th>标的</th>
              <th>来源</th>
              <th className="text-right">最新有效值</th>
              <th className="text-right">日涨跌</th>
              <th className="text-right">月均</th>
              <th className="text-right">季均</th>
              <th className="text-right">数据日期</th>
              <th className="text-right">第三方参考</th>
            </tr>
          </thead>
          <tbody>
            {monitors.map((view) => {
              const change = view.changePct === undefined ? undefined : Number(view.changePct)
              const dir = direction(change)
              const quote = quotes.get(view.monitor.productId)
              return (
                <tr
                  key={view.monitor.id}
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40',
                    selectedId === view.monitor.id && 'bg-teal-50/70 dark:bg-teal-950/20'
                  )}
                  onClick={() => onSelect(view.monitor.id)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: view.monitor.color ?? '#0f766e' }} />
                      <span className="font-medium text-slate-800 dark:text-slate-100">{view.monitor.displayName}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={view.monitor.source === 'smm' ? 'amber' : view.monitor.source === 'asianmetal' ? 'violet' : 'teal'}>
                      {sourceLabel(view.monitor.source)}
                    </Badge>
                  </td>
                  <td className="text-right font-mono font-semibold tabular">
                    {view.latest ? formatNumber(view.latest.value, view.monitor.precision) : '—'}
                  </td>
                  <td className={cn('text-right font-mono tabular', dir === 'up' ? 'text-red-600' : dir === 'down' ? 'text-emerald-600' : 'text-slate-400')}>
                    {formatPct(view.changePct)}
                  </td>
                  <td className="text-right font-mono tabular">
                    {view.means.month ? formatNumber(view.means.month.mean, view.monitor.precision) : '—'}
                  </td>
                  <td className="text-right font-mono tabular">
                    {view.means.quarter ? formatNumber(view.means.quarter.mean, view.monitor.precision) : '—'}
                  </td>
                  <td className="text-right text-[10px] text-slate-400">{view.latest?.date ?? '—'}</td>
                  <td className="text-right">
                    {quote ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-mono tabular">{formatNumber(quote.mid, view.monitor.precision)}</span>
                        <Badge tone={quote.demo ? 'amber' : 'green'}>{quote.demo ? '演示' : '实时'}</Badge>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400">未启用</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
