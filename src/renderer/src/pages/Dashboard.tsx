import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { AlertTriangle, ArrowRight, BellRing, Database, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react'
import type { PeriodType } from '@shared/types'
import { api, useDashboard, useRealtimeSeries } from '../lib/api'
import { Badge } from '../components/Badge'
import { Chart } from '../components/Chart'
import { MonitorCard } from '../components/MonitorCard'
import { RealtimePanel } from '../components/RealtimePanel'
import { SourceHealthPanel } from '../components/SourceHealthPanel'
import { StatCard } from '../components/StatCard'
import { Watchlist } from '../components/Watchlist'
import { useToast } from '../components/Toast'
import { cn, formatDateTime, formatNumber, formatRelative, periodLabel, severityColor, statusLabel } from '../lib/format'

const PERIODS: { key: PeriodType; label: string }[] = [
  { key: 'day', label: '每日' },
  { key: 'month', label: '月度' },
  { key: 'quarter', label: '季度' },
  { key: 'half', label: '半年度' },
  { key: 'year', label: '年度' }
]

export default function Dashboard() {
  const { data, isLoading } = useDashboard()
  const queryClient = useQueryClient()
  const { push } = useToast()
  const [selectedMonitor, setSelectedMonitor] = useState<string>('')
  const [periodType, setPeriodType] = useState<PeriodType>('day')
  const [chartMode, setChartMode] = useState<'official' | 'intraday'>('official')
  const [backfilling, setBackfilling] = useState(false)
  const [fetching, setFetching] = useState(false)

  const monitors = data?.monitors ?? []
  const activeMonitor = monitors.find((view) => view.monitor.id === selectedMonitor) ?? monitors[0]
  const intraday = useRealtimeSeries(activeMonitor?.monitor.productId, chartMode === 'intraday')
  const history = useQuery({
    queryKey: ['dashboard-history', activeMonitor?.monitor.id, periodType],
    queryFn: () => api.history({ monitorId: activeMonitor!.monitor.id, periodType, limit: 400 }),
    enabled: Boolean(activeMonitor?.monitor.id)
  })

  const chartOption = useMemo<EChartsOption>(() => {
    const view = activeMonitor
    if (!view) return {}
    const isDaily = periodType === 'day'
    const rows = history.data?.rows ?? []
    const series = history.data?.series ?? []
    const labels = isDaily ? series.map((point) => point.date) : [...rows].reverse().map((row) => row.periodKey)
    const values = isDaily ? series.map((point) => Number(point.value)) : [...rows].reverse().map((row) => Number(row.mean))
    const color = view.monitor.color ?? '#0f766e'
    return {
      animationDuration: 350,
      grid: { left: 54, right: 22, top: 24, bottom: 34 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,.94)',
        borderWidth: 0,
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (params: unknown) => {
          const list = params as { axisValue: string; data: number }[]
          const item = list[0]
          return item ? `${item.axisValue}<br/>${formatNumber(item.data, view.monitor.precision)} ${view.monitor.unit}` : ''
        }
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(148,163,184,.28)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, hideOverlap: true },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (value: number) => formatNumber(value, view.monitor.precision) },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,.16)' } }
      },
      series: [
        {
          type: 'line',
          data: values,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}30` },
                { offset: 1, color: `${color}00` }
              ]
            }
          }
        }
      ]
    }
  }, [activeMonitor, history.data, periodType])

  const intradayOption = useMemo<EChartsOption>(() => {
    const view = activeMonitor
    if (!view) return {}
    const points = intraday.data?.points ?? []
    const values = points.map((point) => Number(point.close))
    const color = '#0284c7'
    return {
      animation: false,
      grid: { left: 54, right: 22, top: 24, bottom: 34 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,.94)',
        borderWidth: 0,
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (params: unknown) => {
          const list = params as { axisValue: string; data: number }[]
          const item = list[0]
          return item ? `${item.axisValue}<br/>${formatNumber(item.data, view.monitor.precision)} ${view.monitor.unit}` : ''
        }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((point) => new Date(point.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
        axisLine: { lineStyle: { color: 'rgba(148,163,184,.28)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, hideOverlap: true },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        scale: true,
        position: 'right',
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (value: number) => formatNumber(value, view.monitor.precision) },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,.16)' } }
      },
      series: [
        {
          type: 'line',
          data: values,
          smooth: false,
          symbol: 'none',
          lineStyle: { width: 1.8, color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}30` },
                { offset: 1, color: `${color}00` }
              ]
            }
          }
        }
      ]
    }
  }, [activeMonitor, intraday.data])

  const runBackfill = async () => {
    if (backfilling) return
    setBackfilling(true)
    try {
      const result = await api.runBackfill({ startDate: '2015-01-01', sources: ['pboc', 'smm', 'cfets'] })
      push(`回填完成：抓取 ${result.totalFetched}，有效 ${result.totalValid}，隔离 ${result.totalQuarantined}`, 'success')
      await queryClient.invalidateQueries()
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBackfilling(false)
    }
  }

  const runFetch = async () => {
    if (fetching) return
    setFetching(true)
    try {
      const result = await api.runFetch()
      await queryClient.invalidateQueries()
      push(`抓取完成：有效 ${result.valid}，隔离 ${result.quarantined}`, result.log.status === 'failed' ? 'error' : 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (/^[1-9]$/.test(event.key)) {
        const next = monitors[Number(event.key) - 1]
        if (next) setSelectedMonitor(next.monitor.id)
        return
      }
      const periodMap: Record<string, PeriodType> = {
        d: 'day',
        m: 'month',
        q: 'quarter',
        h: 'half',
        y: 'year'
      }
      const nextPeriod = periodMap[event.key.toLowerCase()]
      if (nextPeriod) {
        setPeriodType(nextPeriod)
        return
      }
      if (event.key.toLowerCase() === 'r') {
        void queryClient.invalidateQueries()
        return
      }
      if (event.key.toLowerCase() === 'f') void runFetch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fetching, monitors, queryClient, runFetch])

  if (isLoading || !data) {
    return (
      <div className="grid gap-4">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/50" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/50" />
          ))}
        </div>
      </div>
    )
  }

  const alerts = data.alerts ?? []
  const hasData = data.quality.valid > 0
  return (
    <div className="space-y-4">
      {!hasData ? (
        <div className="panel flex flex-col gap-3 border-teal-200 bg-teal-50/60 px-5 py-4 dark:border-teal-900 dark:bg-teal-950/20 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
              <Database size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-teal-900 dark:text-teal-100">还没有有效历史数据</div>
              <div className="mt-0.5 text-xs text-teal-800/70 dark:text-teal-200/60">
                首次使用请回填 PBOC / SMM 历史数据；Asian Metal 因会员限制采用手动录入或 CSV 导入。
              </div>
            </div>
          </div>
          <button className="btn-primary shrink-0" onClick={runBackfill} disabled={backfilling}>
            <RefreshCw size={15} className={backfilling ? 'animate-spin' : ''} />
            {backfilling ? '回填中' : '开始历史回填'}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="有效数据" value={formatNumber(data.quality.valid, 0)} sub={`隔离 ${data.quality.quarantined} 条`} icon={<ShieldCheck size={18} />} />
        <StatCard label="监测标的" value={String(data.monitors.length)} sub="汇率 + 有色金属" icon={<TrendingUp size={18} />} tone="blue" />
        <StatCard
          label="上次抓取"
          value={data.quality.lastFetch ? formatRelative(data.quality.lastFetch.finishedAt) : '尚未抓取'}
          sub={data.quality.lastFetch ? statusLabel(data.quality.lastFetch.status) : '点击右上角立即抓取'}
          icon={<RefreshCw size={18} />}
          tone="teal"
        />
        <StatCard
          label="待处理预警"
          value={String(alerts.length)}
          sub={alerts[0]?.title ?? '暂无预警'}
          icon={<BellRing size={18} />}
          tone={alerts.some((alert) => alert.severity === 'critical') ? 'red' : 'amber'}
        />
      </div>

      <RealtimePanel monitors={monitors} />

      <Watchlist monitors={monitors} selectedId={activeMonitor?.monitor.id} onSelect={setSelectedMonitor} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="panel xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">价格走势</div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {activeMonitor ? `${activeMonitor.monitor.displayName} · ${activeMonitor.monitor.unit}` : '暂无监测标的'}
                {chartMode === 'intraday' ? ' · 第三方 1min 参考' : ''}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                className="input !h-8 !w-auto min-w-[138px] !text-xs"
                value={activeMonitor?.monitor.id ?? ''}
                onChange={(event) => setSelectedMonitor(event.target.value)}
              >
                {monitors.map((view) => (
                  <option key={view.monitor.id} value={view.monitor.id}>
                    {view.monitor.displayName}
                  </option>
                ))}
              </select>
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
                <button
                  className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', chartMode === 'official' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-800 dark:text-teal-300' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400')}
                  onClick={() => setChartMode('official')}
                >
                  官方
                </button>
                <button
                  className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', chartMode === 'intraday' ? 'bg-white text-sky-700 shadow-sm dark:bg-slate-800 dark:text-sky-300' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400')}
                  onClick={() => setChartMode('intraday')}
                >
                  1m 实时
                </button>
              </div>
              <div className={cn('flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900', chartMode === 'intraday' && 'opacity-40')}>
                {PERIODS.map((period) => (
                  <button
                    key={period.key}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                      periodType === period.key ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-800 dark:text-teal-300' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                    )}
                    onClick={() => setPeriodType(period.key)}
                    disabled={chartMode === 'intraday'}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="px-3 py-2">
            {chartMode === 'intraday' ? (
              intraday.isLoading ? (
                <div className="h-[300px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/50" />
              ) : intraday.error ? (
                <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {intraday.error instanceof Error ? intraday.error.message : '实时分时数据不可用'}
                </div>
              ) : intraday.data?.points.length ? (
                <Chart option={intradayOption} height={300} />
              ) : (
                <div className="flex h-[300px] items-center justify-center text-[11px] text-slate-400">暂无分时数据</div>
              )
            ) : history.isLoading ? (
              <div className="h-[300px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/50" />
            ) : (
              <Chart option={chartOption} height={300} />
            )}
          </div>
        </section>

        <div className="space-y-4">
          <SourceHealthPanel />
          <section className="panel flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">数据质量</div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">仅校验通过的数据进入展示</div>
            </div>
            <Link className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300" to="/audit">
              查看审计 <ArrowRight size={12} className="inline" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4">
            <div className="panel-muted px-3 py-2.5">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">有效</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular text-emerald-700 dark:text-emerald-300">{data.quality.valid}</div>
            </div>
            <div className="panel-muted px-3 py-2.5">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">隔离</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular text-amber-700 dark:text-amber-300">{data.quality.quarantined}</div>
            </div>
          </div>
          <div className="space-y-2 px-4 pb-4 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center justify-between">
              <span>上次抓取</span>
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200">{formatDateTime(data.quality.lastFetch?.finishedAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>最近校验</span>
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200">{data.quality.lastValidation ? formatDateTime(data.quality.lastValidation.timestamp) : '暂无'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>校验策略</span>
              <span>PBOC↔CFETS · SMM↔AM · 规则</span>
            </div>
          </div>
          <div className="mt-auto border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Asian Metal 受会员限制，按赛题说明使用手动录入/CSV 导入。
          </div>
          </section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:hidden">
        {monitors.map((view) => (
          <MonitorCard key={view.monitor.id} view={view} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">最新预警</div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">阈值、波动、数据质量与多源偏差</div>
            </div>
            <Link className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300" to="/alerts">
              全部预警 <ArrowRight size={12} className="inline" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                <ShieldCheck size={18} className="text-emerald-600" /> 当前没有待处理预警
              </div>
            ) : (
              alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn('mt-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', severityColor(alert.severity))}>
                    {alert.severity === 'critical' ? '严重' : alert.severity === 'warning' ? '警告' : '提示'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">{alert.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{alert.message}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-400">{alert.date.slice(5)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">数据说明</div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">均值口径与来源</div>
            </div>
            <Badge tone="teal">Decimal 精度</Badge>
          </div>
          <div className="space-y-3 px-4 py-4 text-xs leading-6 text-slate-600 dark:text-slate-300">
            <p>
              <span className="font-semibold text-slate-800 dark:text-slate-100">每日加工均值</span>：当日全部有效报价的算术平均；SMM 取当日均价，Asian Metal 取高低价中点或录入均价。
            </p>
            <p>
              <span className="font-semibold text-slate-800 dark:text-slate-100">月/季/半年/年均值</span>：期间每日加工均值的等权算术平均，不做“均值的均值”；计算全程使用 Decimal，展示时按精度四舍五入。
            </p>
            <p className="flex items-start gap-2 rounded-xl bg-amber-50/70 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              未通过校验的数据进入隔离区，不进入展示层；可在数据审计中人工复核。
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
