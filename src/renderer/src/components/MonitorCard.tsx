import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, ShieldCheck } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import type { AggregateRecord, MonitorView } from '@shared/types'
import { Badge } from './Badge'
import { Chart } from './Chart'
import { cn, formatNumber, formatPct, sourceLabel, statusLabel } from '../lib/format'

function Sparkline({ view }: { view: MonitorView }) {
  const color = view.monitor.color ?? '#0f766e'
  const option: EChartsOption = {
    animation: false,
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: view.sparkline.map((point) => point.date) },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { trigger: 'axis', formatter: (params: unknown) => {
      const list = params as { axisValue: string; data: number }[]
      const item = list[0]
      return item ? `${item.axisValue}<br/>${formatNumber(item.data, view.monitor.precision)} ${view.monitor.unit}` : ''
    } },
    series: [
      {
        type: 'line',
        data: view.sparkline.map((point) => Number(point.value)),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.6, color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${color}33` },
              { offset: 1, color: `${color}00` }
            ]
          }
        }
      }
    ]
  }
  return <Chart option={option} height={54} className="mt-2 opacity-90" />
}

export function MonitorCard({ view }: { view: MonitorView }) {
  const { monitor, latest, changePct, means, validation } = view
  const change = changePct ? Number(changePct) : undefined
  const isUp = change !== undefined && change > 0
  const isDown = change !== undefined && change < 0
  const noData = !latest
  return (
    <Link
      to={`/history?monitor=${encodeURIComponent(monitor.id)}`}
      className="panel group relative block overflow-hidden p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: monitor.color ?? '#0f766e' }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{monitor.displayName}</h3>
            <Badge tone={monitor.source === 'smm' ? 'amber' : monitor.source === 'asianmetal' ? 'violet' : 'teal'}>{sourceLabel(monitor.source)}</Badge>
            {monitor.manual ? <Badge tone="slate">手动</Badge> : null}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {latest
              ? `${latest.date} · ${monitor.type === 'fx' ? `1 ${monitor.productId} = ${monitor.unit}` : `单位 ${monitor.unit}`}`
              : '等待数据'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {validation.status === 'warning' ? (
            <span title={validation.warnings.join('；')} className="text-amber-600">
              <AlertTriangle size={15} />
            </span>
          ) : validation.status === 'valid' ? (
            <span title="校验通过" className="text-emerald-600">
              <ShieldCheck size={15} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className={cn('font-mono text-[26px] font-semibold leading-none tracking-tight tabular', noData ? 'text-slate-400' : 'text-slate-900 dark:text-white')}>
            {latest ? formatNumber(latest.value, monitor.precision) : '—'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {monitor.type === 'fx' ? `1 ${monitor.productId} = ${monitor.unit}` : monitor.unit}
          </div>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium tabular',
            isUp && 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
            isDown && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
            !isUp && !isDown && 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          )}
        >
          {isUp ? <ArrowUpRight size={13} /> : isDown ? <ArrowDownRight size={13} /> : <Minus size={13} />}
          {formatPct(changePct)}
        </div>
      </div>

      <Sparkline view={view} />

      <div className="mt-2 grid grid-cols-4 gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        {([
          ['月', means.month],
          ['季', means.quarter],
          ['半年', means.half],
          ['年', means.year]
        ] as [string, AggregateRecord | undefined][]).map(([label, aggregate]) => (
          <div key={label}>
            <div className="text-[10px] text-slate-400">{label}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] font-medium text-slate-700 tabular dark:text-slate-200">
              {aggregate ? formatNumber(aggregate.mean, monitor.precision) : '—'}
            </div>
          </div>
        ))}
      </div>
      {view.availableFrom ? <div className="mt-1 text-[10px] text-slate-400">数据起点 {view.availableFrom}</div> : null}
      {validation.status === 'warning' ? (
        <div className="mt-2 truncate text-[10px] text-amber-700 dark:text-amber-300">{validation.warnings[0] ?? statusLabel('warning')}</div>
      ) : null}
    </Link>
  )
}
