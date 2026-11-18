import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { CatalogItem, MonitorConfig, MonitorType, SourceId } from '@shared/types'
import { api, useMonitors } from '../lib/api'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { cn, sourceLabel } from '../lib/format'

function newMonitor(catalog: { fx: CatalogItem[]; smm: CatalogItem[]; asianmetal: CatalogItem[] }): MonitorConfig {
  const item = catalog.fx[0]
  return {
    id: `fx-${item.id.toLowerCase()}-${Date.now().toString(36)}`,
    type: 'fx',
    source: 'pboc',
    productId: item.id,
    displayName: item.name,
    unit: item.unit,
    precision: item.precision,
    enabled: true,
    color: '#0f766e',
    thresholds: { changePct: 1.5 }
  }
}

export default function Monitors() {
  const { data: monitors = [] } = useMonitors()
  const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: () => api.catalog() })
  const queryClient = useQueryClient()
  const { push } = useToast()
  const [editing, setEditing] = useState<MonitorConfig | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing && monitors.length && !catalogQuery.data) {
      // No-op: the modal initializes with default catalogs once available.
    }
  }, [editing, monitors.length, catalogQuery.data])

  const openNew = () => {
    if (!catalogQuery.data) return
    setEditing(newMonitor(catalogQuery.data))
  }

  const openEdit = (monitor: MonitorConfig) => setEditing({ ...monitor, thresholds: { ...(monitor.thresholds ?? {}) } })

  const changeSource = (source: SourceId) => {
    if (!editing || !catalogQuery.data) return
    const list = source === 'pboc' ? catalogQuery.data.fx : source === 'smm' ? catalogQuery.data.smm : catalogQuery.data.asianmetal
    const item = list[0]
    setEditing({
      ...editing,
      source,
      type: source === 'pboc' ? 'fx' : 'metal',
      productId: item?.id ?? '',
      displayName: item?.name ?? editing.displayName,
      unit: item?.unit ?? editing.unit,
      precision: item?.precision ?? editing.precision,
      manual: source === 'asianmetal',
      id: editing.id.startsWith('custom-') ? editing.id : editing.id
    })
  }

  const changeProduct = (productId: string) => {
    if (!editing || !catalogQuery.data) return
    const list = editing.source === 'pboc' ? catalogQuery.data.fx : editing.source === 'smm' ? catalogQuery.data.smm : catalogQuery.data.asianmetal
    const item = list.find((entry) => entry.id === productId)
    if (!item) return
    setEditing({ ...editing, productId, displayName: item.name, unit: item.unit, precision: item.precision })
  }

  const save = async () => {
    if (!editing || saving) return
    setSaving(true)
    try {
      await api.saveMonitor(editing)
      await queryClient.invalidateQueries()
      push(`已保存 ${editing.displayName}；新增标的会自动准备历史数据`, 'success')
      setEditing(null)
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (monitor: MonitorConfig) => {
    if (!window.confirm(`确定删除「${monitor.displayName}」吗？本地历史不会删除，只从面板隐藏。`)) return
    try {
      await api.deleteMonitor(monitor.id)
      await queryClient.invalidateQueries()
      push(`已删除 ${monitor.displayName}`, 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const toggle = async (monitor: MonitorConfig) => {
    try {
      await api.toggleMonitor(monitor.id, !monitor.enabled)
      await queryClient.invalidateQueries()
      push(`${monitor.displayName} 已${monitor.enabled ? '停用' : '启用'}`, 'success')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">监测标的</div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            增删改会驱动面板实时重构；删除仅隐藏，本地历史保留。新增 SMM 标的会自动拉取历史并重算均值。
          </div>
        </div>
        <button className="btn-primary" onClick={openNew} disabled={!catalogQuery.data}>
          <Plus size={15} /> 新增监测标的
        </button>
      </div>

      <div className="panel-muted flex items-start gap-2 px-4 py-3 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
        <SlidersHorizontal size={15} className="mt-0.5 shrink-0 text-teal-700 dark:text-teal-300" />
        配置变更预检：保存前会检查产品/币种是否存在；SMM 新标的会抓取历史；PBOC 新币种优先复用已回填的原始汇率数据；Asian Metal 采用手动录入/CSV。
      </div>

      <div className="panel overflow-hidden">
        <div className="table-wrap border-0">
          <table className="table">
            <thead>
              <tr>
                <th>监测标的</th>
                <th>来源</th>
                <th>产品 ID</th>
                <th>单位 / 精度</th>
                <th>阈值</th>
                <th>状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => (
                <tr key={monitor.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: monitor.color ?? '#0f766e' }} />
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-100">{monitor.displayName}</div>
                        <div className="text-[10px] text-slate-400">{monitor.id}</div>
                      </div>
                      {monitor.manual ? <Badge tone="violet">手动</Badge> : null}
                    </div>
                  </td>
                  <td>
                    <Badge tone={monitor.source === 'smm' ? 'amber' : monitor.source === 'asianmetal' ? 'violet' : 'teal'}>{sourceLabel(monitor.source)}</Badge>
                    <div className="mt-1 text-[10px] uppercase text-slate-400">{monitor.type}</div>
                  </td>
                  <td className="font-mono text-[11px]">{monitor.productId}</td>
                  <td className="text-[11px]">
                    {monitor.unit} / {monitor.precision} 位
                  </td>
                  <td className="text-[11px] text-slate-500">
                    {monitor.thresholds?.high !== undefined ? `高 ${monitor.thresholds.high} ` : ''}
                    {monitor.thresholds?.low !== undefined ? `低 ${monitor.thresholds.low} ` : ''}
                    {monitor.thresholds?.changePct !== undefined ? `波动 ${monitor.thresholds.changePct}%` : '—'}
                  </td>
                  <td>
                    <button
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium',
                        monitor.enabled
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                      )}
                      onClick={() => toggle(monitor)}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', monitor.enabled ? 'bg-emerald-500' : 'bg-slate-400')} />
                      {monitor.enabled ? '监测中' : '已停用'}
                    </button>
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost !h-7 !px-2 !text-[11px]" onClick={() => openEdit(monitor)}>
                        编辑
                      </button>
                      <button className="btn-ghost !h-7 !px-2 !text-[11px] text-red-600 hover:bg-red-50" onClick={() => remove(monitor)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing && monitors.some((m) => m.id === editing.id) ? '编辑监测标的' : '新增监测标的'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>取消</button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              <Save size={14} /> {saving ? '保存中…' : '保存并重构面板'}
            </button>
          </>
        }
      >
        {editing ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">显示名称</span>
              <input className="input" value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">来源</span>
              <select className="input" value={editing.source} onChange={(event) => changeSource(event.target.value as SourceId)}>
                <option value="pboc">PBOC 中国人民银行</option>
                <option value="smm">SMM 上海有色网</option>
                <option value="asianmetal">Asian Metal（手动/CSV）</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">产品 / 币种</span>
              <select className="input" value={editing.productId} onChange={(event) => changeProduct(event.target.value)}>
                {(() => {
                  const list = editing.source === 'pboc' ? catalogQuery.data?.fx : editing.source === 'smm' ? catalogQuery.data?.smm : catalogQuery.data?.asianmetal
                  return (list ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}（{item.id}）
                    </option>
                  ))
                })()}
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">产品 ID（高级）</span>
              <input className="input font-mono" value={editing.productId} onChange={(event) => setEditing({ ...editing, productId: event.target.value })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">单位</span>
              <input className="input" value={editing.unit} onChange={(event) => setEditing({ ...editing, unit: event.target.value })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">展示精度</span>
              <input
                className="input"
                type="number"
                min={0}
                max={8}
                value={editing.precision}
                onChange={(event) => setEditing({ ...editing, precision: Number(event.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">上限阈值（可选）</span>
              <input
                className="input"
                type="number"
                value={editing.thresholds?.high ?? ''}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    thresholds: { ...editing.thresholds, high: event.target.value ? Number(event.target.value) : undefined }
                  })
                }
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">下限阈值（可选）</span>
              <input
                className="input"
                type="number"
                value={editing.thresholds?.low ?? ''}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    thresholds: { ...editing.thresholds, low: event.target.value ? Number(event.target.value) : undefined }
                  })
                }
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">日波动阈值 %</span>
              <input
                className="input"
                type="number"
                value={editing.thresholds?.changePct ?? ''}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    thresholds: { ...editing.thresholds, changePct: event.target.value ? Number(event.target.value) : undefined }
                  })
                }
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block">图表颜色</span>
              <input className="input" value={editing.color ?? ''} onChange={(event) => setEditing({ ...editing, color: event.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-teal-700"
                checked={editing.enabled}
                onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })}
              />
              启用该监测标的
            </label>
            {editing.source === 'asianmetal' ? (
              <div className="md:col-span-2 flex items-start gap-2 rounded-xl bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                Asian Metal 价格/历史需要会员权限。按赛题描述，本系统保留手动录入与 CSV 导入接口；请到“数据审计”页面录入数据。
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
