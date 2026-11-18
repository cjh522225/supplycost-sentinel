import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, CheckCheck, CircleAlert, Eye, ShieldCheck } from 'lucide-react'
import type { AlertRecord, AlertStatus, AlertSeverity } from '@shared/types'
import { api } from '../lib/api'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { cn, formatDateTime, severityColor, statusLabel } from '../lib/format'

export default function Alerts() {
  const queryClient = useQueryClient()
  const { push } = useToast()
  const [status, setStatus] = useState<'' | AlertStatus>('') 
  const [severity, setSeverity] = useState<'' | AlertSeverity>('')
  const [origin, setOrigin] = useState<'' | 'official' | 'realtime'>('')
  const [selected, setSelected] = useState<AlertRecord | null>(null)
  const alerts = useQuery({
    queryKey: ['alerts', status, severity, origin],
    queryFn: () =>
      api.listAlerts({
        status: status || undefined,
        severity: severity || undefined,
        origin: origin || undefined,
        limit: 300
      })
  })

  const update = async (alert: AlertRecord, next: AlertStatus) => {
    try {
      await api.updateAlert(alert.id, next)
      await queryClient.invalidateQueries()
      push(`预警已更新为${statusLabel(next)}`, 'success')
      setSelected((current) => (current?.id === alert.id ? { ...current, status: next } : current))
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const rows = alerts.data ?? []
  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-end justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">预警中心</div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">阈值、日波动、月均偏离、多源偏差、数据缺失与隔离数据</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !h-8 !w-auto !text-xs" value={status} onChange={(event) => setStatus(event.target.value as '' | AlertStatus)}>
            <option value="">全部状态</option>
            <option value="open">未处理</option>
            <option value="acknowledged">已确认</option>
            <option value="resolved">已解决</option>
          </select>
          <select className="input !h-8 !w-auto !text-xs" value={severity} onChange={(event) => setSeverity(event.target.value as '' | AlertSeverity)}>
            <option value="">全部级别</option>
            <option value="critical">严重</option>
            <option value="warning">警告</option>
            <option value="info">提示</option>
          </select>
          <select className="input !h-8 !w-auto !text-xs" value={origin} onChange={(event) => setOrigin(event.target.value as '' | 'official' | 'realtime')}>
            <option value="">官方 + 实时</option>
            <option value="official">官方日频</option>
            <option value="realtime">第三方实时</option>
          </select>
          <Badge tone="slate">{rows.length} 条</Badge>
        </div>
      </div>

      <div className="grid gap-3">
        {alerts.isLoading ? (
          <div className="panel px-4 py-10 text-center text-sm text-slate-500">加载预警…</div>
        ) : rows.length === 0 ? (
          <div className="panel flex items-center gap-3 px-4 py-10 text-sm text-slate-500 dark:text-slate-400">
            <ShieldCheck size={20} className="text-emerald-600" />
            当前筛选条件下没有预警。系统会持续监测阈值、波动和数据质量。
          </div>
        ) : (
          rows.map((alert) => (
            <div key={alert.id} className="panel flex flex-wrap items-start gap-3 px-4 py-3.5">
              <span className={cn('mt-0.5 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold', severityColor(alert.severity))}>
                {alert.severity === 'critical' ? <CircleAlert size={12} /> : <BellRing size={12} />}
                {alert.severity === 'critical' ? '严重' : alert.severity === 'warning' ? '警告' : '提示'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{alert.title}</h3>
                  <Badge tone={alert.status === 'open' ? 'amber' : alert.status === 'resolved' ? 'green' : 'blue'}>{statusLabel(alert.status)}</Badge>
                  {alert.origin === 'realtime' ? <Badge tone="blue">第三方实时</Badge> : null}
                  <span className="text-[10px] text-slate-400">{alert.monitorName}</span>
                </div>
                <p className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400">{alert.message}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                  <span>日期 {alert.date}</span>
                  <span>触发 {formatDateTime(alert.createdAt)}</span>
                  {alert.value ? <span>观测值 {alert.value}</span> : null}
                  {alert.threshold ? <span>阈值 {alert.threshold}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button className="btn-ghost !h-7 !px-2 !text-[11px]" onClick={() => setSelected(alert)}>
                  <Eye size={12} /> 详情
                </button>
                {alert.status === 'open' ? (
                  <button className="btn-secondary !h-7 !px-2 !text-[11px]" onClick={() => update(alert, 'acknowledged')}>
                    <CheckCheck size={12} /> 确认
                  </button>
                ) : null}
                {alert.status !== 'resolved' ? (
                  <button className="btn-primary !h-7 !px-2 !text-[11px]" onClick={() => update(alert, 'resolved')}>
                    解决
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title ?? '预警详情'}
        footer={
          selected ? (
            <>
              <button className="btn-secondary" onClick={() => setSelected(null)}>关闭</button>
              {selected.status !== 'resolved' ? (
                <button className="btn-primary" onClick={() => update(selected, 'resolved')}>
                  标记为已解决
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded-md border px-2 py-1 text-[10px] font-semibold', severityColor(selected.severity))}>
                {selected.severity}
              </span>
              <Badge tone={selected.status === 'open' ? 'amber' : selected.status === 'resolved' ? 'green' : 'blue'}>{statusLabel(selected.status)}</Badge>
              <span className="text-xs text-slate-500 dark:text-slate-400">{selected.monitorName}</span>
            </div>
            <p className="leading-6 text-slate-700 dark:text-slate-200">{selected.message}</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['日期', selected.date],
                ['触发时间', formatDateTime(selected.createdAt)],
                ['观测值', selected.value ?? '—'],
                ['阈值', selected.threshold ?? '—'],
                ['类型', selected.type],
                ['状态', statusLabel(selected.status)]
              ].map(([label, value]) => (
                <div key={label} className="panel-muted px-3 py-2">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
                  <div className="mt-1 font-mono text-xs text-slate-800 dark:text-slate-100">{value}</div>
                </div>
              ))}
            </div>
            {selected.evidence ? (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">证据</div>
                <pre className="max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-200">
                  {JSON.stringify(selected.evidence, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
