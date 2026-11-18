import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, RefreshCw, Radio, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import type { MonitorView, RealtimeStatus } from '@shared/types'
import { api, useRealtime } from '../lib/api'
import { Badge } from './Badge'
import { useToast } from './Toast'
import { cn, formatDateTime, formatNumber, formatRelative } from '../lib/format'

const STATE_LABEL: Record<RealtimeStatus['state'], string> = {
  disabled: '未启用',
  demo: '演示行情',
  live: '实时',
  delayed: '延迟',
  stale: '已过期',
  error: '异常'
}

function stateTone(state: RealtimeStatus['state']): 'green' | 'amber' | 'red' | 'slate' | 'blue' {
  if (state === 'live') return 'green'
  if (state === 'demo') return 'blue'
  if (state === 'delayed' || state === 'stale') return 'amber'
  if (state === 'error') return 'red'
  return 'slate'
}

export function RealtimePanel({ monitors }: { monitors: MonitorView[] }) {
  const realtime = useRealtime()
  const queryClient = useQueryClient()
  const { push } = useToast()
  const snapshot = realtime.data
  const status = snapshot?.status
  const quotes = snapshot?.quotes ?? []
  const depth = snapshot?.depth ?? []
  const trades = snapshot?.trades ?? []
  const hasTopOfBook = Boolean(status?.capabilities.includes('topOfBook'))

  const refresh = async () => {
    try {
      await api.realtimePollNow()
      await queryClient.invalidateQueries({ queryKey: ['realtime'] })
      push('实时行情已刷新', 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <section className="panel w-full overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <Radio size={15} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">实时行情参考</span>
              <Badge tone={status ? stateTone(status.state) : 'slate'}>
                {status ? STATE_LABEL[status.state] : '加载中'}
              </Badge>
              {status?.demo ? <Badge tone="amber">演示数据</Badge> : null}
              {status?.provider === 'mock' ? <Badge tone="slate">无需 Key</Badge> : null}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              第三方参考价，不是 PBOC/CFETS 官方中间价；成本与均值以官方值为准，实时值仅作盘中参考。
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status?.usage ? (
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              {status.usage.planCategory ?? 'plan'} · 今日 {status.usage.dailyUsage ?? 0}/{status.usage.planDailyLimit ?? '—'} · {status.usage.planLimit ?? '—'}/min
            </span>
          ) : null}
          {status?.lastReceivedAt ? (
            <span className="text-[10px] text-slate-400">
              最后更新 {formatRelative(status.lastReceivedAt)}
              {status.nextPollAt ? ` · 下次 ${formatDateTime(status.nextPollAt)}` : ''}
            </span>
          ) : null}
          <Link className="btn-secondary !h-7 !px-2 !text-[10px]" to="/settings">
            <SlidersHorizontal size={12} /> 配置
          </Link>
          <button className="btn-secondary !h-7 !px-2 !text-[10px]" onClick={() => void refresh()} disabled={!status?.enabled}>
            <RefreshCw size={12} /> 刷新
          </button>
        </div>
      </div>

      {status?.state === 'disabled' ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-5 text-[11px] text-slate-500 dark:text-slate-400">
          <ShieldAlert size={16} className="text-slate-400" />
          实时行情未启用。当前继续使用官方 PBOC/CFETS 日频数据；可在设置中启用演示行情查看界面。
        </div>
      ) : null}

      {status?.state === 'error' ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[11px] text-red-700 dark:text-red-300">
          <ShieldAlert size={14} />
          {status.lastError ?? '实时行情异常'}
        </div>
      ) : null}

      {status?.quotaMessage ? (
        <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/70 px-4 py-2 text-[10px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <ShieldAlert size={12} /> {status.quotaMessage}
        </div>
      ) : null}

      {quotes.length > 0 ? (
        <div className="overflow-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>标的</th>
                {hasTopOfBook ? (
                  <>
                    <th className="text-right">Bid</th>
                    <th className="text-right">Ask</th>
                    <th className="text-right">Mid</th>
                  </>
                ) : (
                  <>
                    <th className="text-right">最新价</th>
                    <th className="text-right">涨跌</th>
                  </>
                )}
                <th className="text-right">行情时间</th>
                <th className="text-right">延迟</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => {
                const monitor = monitors.find((view) => view.monitor.productId === quote.productId)
                return (
                  <tr key={`${quote.provider}:${quote.symbol}:${quote.quoteAt}`}>
                    <td>
                      <div className="font-medium text-slate-800 dark:text-slate-100">
                        {monitor?.monitor.displayName ?? quote.symbol}
                      </div>
                      <div className="text-[10px] text-slate-400">{quote.symbol}</div>
                    </td>
                    {hasTopOfBook ? (
                      <>
                        <td className="text-right font-mono tabular">{formatNumber(quote.bid, monitor?.monitor.precision ?? 4)}</td>
                        <td className="text-right font-mono tabular">{formatNumber(quote.ask, monitor?.monitor.precision ?? 4)}</td>
                        <td className="text-right font-mono font-semibold tabular">{formatNumber(quote.mid, monitor?.monitor.precision ?? 4)}</td>
                      </>
                    ) : (
                      <>
                        <td className="text-right font-mono font-semibold tabular">{formatNumber(quote.mid, monitor?.monitor.precision ?? 4)}</td>
                        <td className="text-right font-mono tabular">{quote.changePct ? `${Number(quote.changePct) > 0 ? '+' : ''}${Number(quote.changePct).toFixed(2)}%` : '—'}</td>
                      </>
                    )}
                    <td className="text-right text-[10px] text-slate-400">{formatDateTime(quote.quoteAt)}</td>
                    <td className="text-right text-[10px] text-slate-400">{quote.delayMs ?? 0} ms</td>
                    <td>
                      {(() => {
                        const delayed = (quote.delayMs ?? 0) > 15_000
                        return (
                          <Badge tone={quote.demo || delayed ? 'amber' : 'green'}>
                            {quote.demo ? '演示' : delayed ? '延迟' : '实时'}
                          </Badge>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {status?.enabled && !hasTopOfBook ? (
        <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          该行情源仅提供最新价，不提供 Bid/Ask、深度或成交明细；这些能力需要支持 depth/trades 的 Provider。
        </div>
      ) : null}

      {depth.length > 0 || trades.length > 0 ? (
        <div className="grid gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800 lg:grid-cols-2">
          {depth.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                <Activity size={13} /> Order Book · 单一 Provider 深度
              </div>
              <div className="grid grid-cols-2 gap-3 text-[10px]">
                <div>
                  <div className="mb-1 text-emerald-600 dark:text-emerald-400">Bid</div>
                  {[...depth[0].bids].reverse().map((level) => (
                    <div key={`bid-${level.price}`} className="flex justify-between py-0.5 font-mono tabular">
                      <span>{level.price}</span>
                      <span className="text-slate-400">{level.size}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 text-red-600 dark:text-red-400">Ask</div>
                  {depth[0].asks.map((level) => (
                    <div key={`ask-${level.price}`} className="flex justify-between py-0.5 font-mono tabular">
                      <span>{level.price}</span>
                      <span className="text-slate-400">{level.size}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {trades.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                <Activity size={13} /> Time &amp; Sales · Provider 成交
              </div>
              <div className="max-h-36 overflow-auto">
                {trades.slice(-12).reverse().map((trade, index) => (
                  <div key={`${trade.quoteAt}-${index}`} className="flex items-center justify-between border-b border-slate-100/60 py-0.5 font-mono text-[10px] last:border-0 dark:border-slate-800">
                    <span className={cn(trade.side === 'sell' ? 'text-emerald-600' : 'text-red-600')}>{trade.price}</span>
                    <span className="text-slate-400">{trade.size}</span>
                    <span className="text-slate-400">{formatDateTime(trade.quoteAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
