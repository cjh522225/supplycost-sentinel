import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { Calculator, Download, ExternalLink, FileJson, Search } from 'lucide-react'
import type { AggregateRecord, PeriodType, TraceResponse } from '@shared/types'
import { api, useMonitors } from '../lib/api'
import { Badge } from '../components/Badge'
import { Chart } from '../components/Chart'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { cn, formatNumber, periodLabel, sourceLabel, statusLabel } from '../lib/format'

const PERIODS: { key: PeriodType; label: string }[] = [
  { key: 'month', label: '月度' },
  { key: 'quarter', label: '季度' },
  { key: 'half', label: '半年度' },
  { key: 'year', label: '年度' },
  { key: 'day', label: '每日' }
]

export default function History() {
  const { data: monitors = [] } = useMonitors()
  const [searchParams] = useSearchParams()
  const initial = searchParams.get('monitor') ?? monitors[0]?.id ?? ''
  const [monitorId, setMonitorId] = useState(initial)
  const [periodType, setPeriodType] = useState<PeriodType>('month')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [trace, setTrace] = useState<TraceResponse | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [page, setPage] = useState(0)
  const pageSize = 24
  const { push } = useToast()
  const activeId = monitorId || monitors[0]?.id || ''
  const monitor = monitors.find((item) => item.id === activeId)

  const history = useQuery({
    queryKey: ['history', activeId, periodType, start, end],
    queryFn: () => api.history({ monitorId: activeId, periodType, start: start || undefined, end: end || undefined, limit: 500 }),
    enabled: Boolean(activeId)
  })

  useEffect(() => {
    setPage(0)
  }, [activeId, periodType, start, end])

  const allRows = history.data?.rows ?? []
  const pageRows = allRows.slice(page * pageSize, (page + 1) * pageSize)

  const chartOption = useMemo<EChartsOption>(() => {
    if (!monitor) return {}
    const isDaily = periodType === 'day'
    const rows = [...(history.data?.rows ?? [])].reverse()
    const series = history.data?.series ?? []
    const labels = isDaily ? series.map((point) => point.date) : rows.map((row) => row.periodKey)
    const values = isDaily ? series.map((point) => Number(point.value)) : rows.map((row) => Number(row.mean))
    const color = monitor.color ?? '#0f766e'
    return {
      animationDuration: 300,
      grid: { left: 56, right: 24, top: 28, bottom: 36 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,.94)',
        borderWidth: 0,
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (params: unknown) => {
          const item = (params as { axisValue: string; data: number }[])[0]
          return item ? `${item.axisValue}<br/>${formatNumber(item.data, monitor.precision)} ${monitor.unit}` : ''
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
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (value: number) => formatNumber(value, monitor.precision) },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,.16)' } }
      },
      series: [
        {
          type: isDaily ? 'line' : 'bar',
          data: values,
          smooth: true,
          symbol: 'none',
          barMaxWidth: 26,
          itemStyle: { color, borderRadius: [3, 3, 0, 0] },
          lineStyle: { width: 2 },
          areaStyle: isDaily
            ? {
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
            : undefined
        }
      ]
    }
  }, [history.data, monitor, periodType])

  const openTrace = async (row: AggregateRecord) => {
    setTraceLoading(true)
    try {
      setTrace(await api.trace({ monitorId: activeId, periodType: row.periodType, periodKey: row.periodKey }))
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTraceLoading(false)
    }
  }

  const exportCsv = async () => {
    try {
      const path = await api.exportData('aggregates')
      push(`已导出：${path}`, 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-end justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">监测标的</span>
            <select className="input min-w-[190px]" value={activeId} onChange={(event) => setMonitorId(event.target.value)}>
              {monitors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName} · {sourceLabel(item.source)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">开始日期</span>
            <input className="input !w-[150px]" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            <span className="mb-1 block">结束日期</span>
            <input className="input !w-[150px]" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <button className="btn-secondary" onClick={() => void history.refetch()}>
            <Search size={14} /> 查询
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {PERIODS.map((period) => (
              <button
                key={period.key}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                  periodType === period.key
                    ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-800 dark:text-teal-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                )}
                onClick={() => setPeriodType(period.key)}
              >
                {period.label}
              </button>
            ))}
          </div>
          <button className="btn-secondary" onClick={exportCsv}>
            <Download size={14} /> 导出 CSV
          </button>
        </div>
      </div>

      <div className="panel px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{monitor?.displayName ?? '未选择标的'}</span>
            {monitor ? <Badge tone={monitor.source === 'smm' ? 'amber' : monitor.source === 'asianmetal' ? 'violet' : 'teal'}>{sourceLabel(monitor.source)}</Badge> : null}
            {monitor?.manual ? <Badge tone="slate">手动录入</Badge> : null}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">单位：{monitor?.unit ?? '—'} · 展示精度 {monitor?.precision ?? 2} 位</span>
        </div>
        <Chart option={chartOption} height={310} />
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">周期均值明细</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              点击“追溯”查看每日数据、求和、样本数与公式；均值分母=有效日数，覆盖率分母=工作日数，均值全程 Decimal 计算
            </div>
          </div>
          <Badge tone="teal">
            <Calculator size={12} /> {allRows.length} 个周期
          </Badge>
        </div>
        <div className="table-wrap border-0">
          <table className="table">
            <thead>
              <tr>
                <th>周期</th>
                <th className="text-right">均值</th>
                <th className="text-right">样本天数</th>
                <th className="text-right">覆盖率</th>
                <th className="text-right">最小</th>
                <th className="text-right">最大</th>
                <th>首末日期</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {history.isLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">加载中…</td>
                </tr>
              ) : allRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    暂无数据。请先在总览执行历史回填，或在数据审计中导入 Asian Metal 数据。
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={`${row.periodType}:${row.periodKey}`}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{periodLabel(row.periodType, row.periodKey)}</span>
                        {row.partial ? <Badge tone="amber">进行中</Badge> : null}
                      </div>
                    </td>
                    <td className="text-right font-mono font-semibold tabular">{formatNumber(row.mean, monitor?.precision ?? row.precision)}</td>
                    <td className="text-right font-mono tabular">{row.count}</td>
                    <td className="text-right font-mono tabular">{row.coverage ?? '—'}%</td>
                    <td className="text-right font-mono tabular">{formatNumber(row.min, monitor?.precision ?? row.precision)}</td>
                    <td className="text-right font-mono tabular">{formatNumber(row.max, monitor?.precision ?? row.precision)}</td>
                    <td className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
                      {row.firstDate ?? '—'} ~ {row.lastDate ?? '—'}
                    </td>
                    <td className="text-right">
                      <button className="btn-ghost !h-7 !px-2 !text-[11px]" onClick={() => openTrace(row)}>
                        <ExternalLink size={12} /> 追溯
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {allRows.length > pageSize ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              第 {page + 1} / {Math.ceil(allRows.length / pageSize)} 页，共 {allRows.length} 个周期
            </span>
            <div className="flex gap-1">
              <button className="btn-secondary !h-7 !px-2.5 !text-[11px]" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
                上一页
              </button>
              <button
                className="btn-secondary !h-7 !px-2.5 !text-[11px]"
                onClick={() => setPage((value) => Math.min(Math.ceil(allRows.length / pageSize) - 1, value + 1))}
                disabled={page >= Math.ceil(allRows.length / pageSize) - 1}
              >
                下一页
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel-muted flex items-start gap-2 px-4 py-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        <FileJson size={15} className="mt-0.5 shrink-0 text-teal-700 dark:text-teal-300" />
        均值文件位于 data/aggregates/&lt;年份&gt;/&lt;年份&gt;.json 与同名 CSV；跨年查询会自动扫描所有年份文件并拼接。状态：{history.data ? statusLabel('valid') : '等待查询'}。
      </div>

      <Modal
        open={Boolean(trace)}
        onClose={() => setTrace(null)}
        title={trace ? `${trace.monitor.displayName} · ${periodLabel(trace.aggregate.periodType, trace.aggregate.periodKey)}` : '计算追溯'}
        width="max-w-4xl"
        footer={
          <button className="btn-secondary" onClick={() => setTrace(null)}>
            关闭
          </button>
        }
      >
        {traceLoading ? (
          <div className="py-10 text-center text-sm text-slate-500">加载计算明细…</div>
        ) : trace ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['周期均值', formatNumber(trace.aggregate.mean, trace.monitor.precision)],
                ['样本天数', String(trace.aggregate.count)],
                ['有效区间', `${trace.aggregate.startDate} ~ ${trace.aggregate.endDate}`],
                ['精度', `${trace.monitor.precision} 位展示 / 全精度存储`]
              ].map(([label, value]) => (
                <div key={label} className="panel-muted px-3 py-2">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
                  <div className="mt-1 font-mono text-sm font-semibold tabular text-slate-800 dark:text-slate-100">{value}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs leading-5 text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-100">
              {trace.formula}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 md:grid-cols-4">
              <div className="panel-muted px-3 py-2">均值分母：有效日数 {trace.aggregate.availableDays}</div>
              <div className="panel-muted px-3 py-2">覆盖率分母：工作日数 {trace.aggregate.expectedWeekdays}</div>
              <div className="panel-muted px-3 py-2">均值口径：{trace.aggregate.meanBasis}</div>
              <div className="panel-muted px-3 py-2">覆盖率口径：{trace.aggregate.coverageBasis}</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th className="text-right">每日加工均值</th>
                    <th>来源</th>
                    <th>校验</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.daily.map((record) => (
                    <tr key={record.id}>
                      <td className="font-mono text-[12px]">{record.date}</td>
                      <td className="text-right font-mono font-medium tabular">{formatNumber(record.value, trace.monitor.precision)}</td>
                      <td>{sourceLabel(record.source)}</td>
                      <td>
                        {record.validation.warnings.length ? (
                          <Badge tone="amber">{record.validation.warnings[0]}</Badge>
                        ) : (
                          <Badge tone="green">通过</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              数据文件：{trace.files.length ? trace.files.join('、') : '—'}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
