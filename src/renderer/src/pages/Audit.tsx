import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Database, FileDown, FileJson, FolderOpen, RefreshCw, Upload, X } from 'lucide-react'
import type { QuarantinedRecord } from '@shared/types'
import { api } from '../lib/api'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { cn, formatDateTime, statusLabel } from '../lib/format'

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'fetch', label: '抓取日志' },
  { key: 'rotation', label: '轮转日志' },
  { key: 'quarantine', label: '隔离区' },
  { key: 'files', label: '数据文件' },
  { key: 'manual', label: '手动录入' }
] as const

type TabKey = (typeof TABS)[number]['key']

const CSV_TEMPLATE = `date,productName,low,high,average,unit,sourceUrl,note
2026-10-27,ADC12,24300,24500,24400,元/吨,https://www.asianmetal.cn/,示例
2026-10-27,AZ91D,17000,17400,,元/吨,,未填均价时取高低价中点`

export default function Audit() {
  const queryClient = useQueryClient()
  const { push } = useToast()
  const [tab, setTab] = useState<TabKey>('overview')
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const [quarantineDetail, setQuarantineDetail] = useState<QuarantinedRecord | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [manual, setManual] = useState({
    date: new Date().toISOString().slice(0, 10),
    productId: 'am-adc12',
    productName: 'Asian Metal ADC12 中国交到',
    low: '',
    high: '',
    average: '',
    unit: '元/吨',
    sourceUrl: '',
    note: ''
  })

  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api.audit() })

  const submitManual = async () => {
    try {
      const result = await api.manualAdd({
        date: manual.date,
        productId: manual.productId,
        productName: manual.productName || (manual.productId === 'am-az91d' ? 'Asian Metal AZ91D 中国出厂' : 'Asian Metal ADC12 中国交到'),
        low: manual.low || undefined,
        high: manual.high || undefined,
        average: manual.average || undefined,
        unit: manual.unit,
        sourceUrl: manual.sourceUrl || undefined,
        note: manual.note || undefined
      })
      push(result.message, result.valid ? 'success' : 'error')
      await queryClient.invalidateQueries()
      setManual((prev) => ({ ...prev, low: '', high: '', average: '', note: '' }))
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const importCsv = async (text: string) => {
    if (!text.trim()) {
      push('请先粘贴或选择 CSV 文件', 'error')
      return
    }
    setImporting(true)
    try {
      const result = await api.manualImportCsv(text)
      push(`CSV 导入完成：导入 ${result.imported}，有效 ${result.valid}，隔离 ${result.quarantined}，错误 ${result.errors.length}`, result.errors.length ? 'info' : 'success')
      if (result.errors.length) {
        push(result.errors.slice(0, 3).map((error) => `第 ${error.row} 行：${error.message}`).join('；'), 'error')
      }
      await queryClient.invalidateQueries()
      setCsvText('')
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setImporting(false)
    }
  }

  const onFile = async (file?: File) => {
    if (!file) return
    const text = await file.text()
    setCsvText(text)
    await importCsv(text)
  }

  const approve = async (record: QuarantinedRecord) => {
    const reason = window.prompt('请输入人工复核通过原因（会写入审计日志）：', '已核对来源与价格')
    if (!reason) return
    try {
      await api.approveQuarantine(record.id, reason)
      push('已人工复核通过并重新计算', 'success')
      await queryClient.invalidateQueries()
      setQuarantineDetail(null)
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const reject = async (record: QuarantinedRecord) => {
    const reason = window.prompt('请输入拒绝原因（会写入审计日志）：', '来源/价格无法确认')
    if (!reason) return
    try {
      await api.rejectQuarantine(record.id, reason)
      push('已拒绝该隔离记录', 'success')
      await queryClient.invalidateQueries()
      setQuarantineDetail(null)
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const data = audit.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                tab === item.key ? 'bg-teal-700 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              )}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => void api.openDataFolder()}>
            <FolderOpen size={14} /> 打开数据目录
          </button>
          <button className="btn-secondary" onClick={() => void audit.refetch()}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['原始文件', data?.counts.rawFiles ?? 0],
              ['有效文件', data?.counts.validatedFiles ?? 0],
              ['均值文件', data?.counts.aggregateFiles ?? 0],
              ['隔离记录', data?.counts.quarantined ?? 0],
              ['抓取次数', data?.counts.fetchRuns ?? 0]
            ].map(([label, value]) => (
              <div key={label} className="panel px-4 py-3">
                <div className="label">{label}</div>
                <div className="mt-1.5 font-mono text-2xl font-semibold tabular text-slate-900 dark:text-white">{value}</div>
              </div>
            ))}
          </div>
          <div className="panel px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Database size={16} className="text-teal-700 dark:text-teal-300" /> 本地文件存储
            </div>
            <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
              数据目录：<span className="font-mono">{data?.dataDir ?? 'data'}</span>
              。原始、有效、隔离、均值、预警、审计均以 JSON 保存，并生成同名 CSV 镜像；不使用 SQLite/数据库进程。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="green"><Check size={12} /> JSON</Badge>
              <Badge tone="green"><Check size={12} /> CSV</Badge>
              <Badge tone="green"><Check size={12} /> 无数据库</Badge>
              <Badge tone="teal">按月/年轮转</Badge>
              <Badge tone="teal">跨卷读取</Badge>
            </div>
          </div>
          <div className="panel-muted flex items-start gap-2 px-4 py-3 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
            Asian Metal 受会员/公司注册限制，按赛题说明保留手动录入与 CSV 导入；导入数据同样经过校验、写入本地文件并可追溯。
          </div>
        </div>
      ) : null}

      {tab === 'fetch' ? (
        <div className="panel overflow-hidden">
          <div className="table-wrap border-0">
            <table className="table">
              <thead>
                <tr>
                  <th>开始时间</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th className="text-right">抓取</th>
                  <th className="text-right">有效</th>
                  <th className="text-right">隔离</th>
                  <th>消息</th>
                </tr>
              </thead>
              <tbody>
                {(data?.fetchLogs ?? []).map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap font-mono text-[11px]">{formatDateTime(log.startedAt)}</td>
                    <td>{log.source}</td>
                    <td><Badge tone={log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'amber'}>{statusLabel(log.status)}</Badge></td>
                    <td className="text-right font-mono tabular">{log.recordsFetched}</td>
                    <td className="text-right font-mono tabular text-emerald-700 dark:text-emerald-300">{log.recordsValid}</td>
                    <td className="text-right font-mono tabular text-amber-700 dark:text-amber-300">{log.recordsQuarantined}</td>
                    <td className="max-w-[360px] truncate text-[11px] text-slate-500">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data?.fetchLogs.length ?? 0) === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-500">暂无抓取日志</div> : null}
        </div>
      ) : null}

      {tab === 'rotation' ? (
        <div className="panel overflow-hidden">
          <div className="table-wrap border-0">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>范围</th>
                  <th>周期</th>
                  <th>原因</th>
                  <th>文件</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rotationLogs ?? []).map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap font-mono text-[11px]">{formatDateTime(log.timestamp)}</td>
                    <td>{log.scope}</td>
                    <td className="font-mono text-[11px]">{log.periodKey}</td>
                    <td><Badge tone={log.reason === 'period-change' ? 'teal' : 'slate'}>{log.reason === 'period-change' ? '跨期自动创建' : '首次写入'}</Badge></td>
                    <td className="font-mono text-[11px] text-slate-500">{log.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data?.rotationLogs.length ?? 0) === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              暂无轮转日志。修改系统时间进入新的月份/年份后，应用会自动创建新文件并写入日志。
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'quarantine' ? (
        <div className="panel overflow-hidden">
          <div className="table-wrap border-0">
            <table className="table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>来源</th>
                  <th>产品</th>
                  <th className="text-right">值</th>
                  <th>原因</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {(data?.quarantine ?? []).map((record) => (
                  <tr key={record.id}>
                    <td className="font-mono text-[11px]">{record.date}</td>
                    <td>{record.source}</td>
                    <td>{record.productName}</td>
                    <td className="text-right font-mono tabular">{record.value}</td>
                    <td className="max-w-[300px] truncate text-[11px] text-red-600 dark:text-red-300">{record.validation.errors.join('；')}</td>
                    <td className="text-right">
                      <button className="btn-ghost !h-7 !px-2 !text-[11px]" onClick={() => setQuarantineDetail(record)}>复核</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data?.quarantine.length ?? 0) === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-500">隔离区为空，全部数据通过校验</div> : null}
        </div>
      ) : null}

      {tab === 'files' ? (
        <div className="panel overflow-hidden">
          <div className="table-wrap border-0">
            <table className="table">
              <thead>
                <tr>
                  <th>相对路径</th>
                  <th>类型</th>
                  <th className="text-right">记录数</th>
                  <th className="text-right">大小</th>
                  <th>修改时间</th>
                </tr>
              </thead>
              <tbody>
                {(data?.files ?? []).slice(0, 200).map((file) => (
                  <tr key={file.path}>
                    <td className="font-mono text-[11px]">{file.relativePath}</td>
                    <td><Badge tone={file.kind === 'validated' ? 'green' : file.kind === 'raw' ? 'blue' : 'slate'}>{file.kind}</Badge></td>
                    <td className="text-right font-mono tabular">{file.records ?? '—'}</td>
                    <td className="text-right font-mono text-[11px] tabular">{(file.size / 1024).toFixed(1)} KB</td>
                    <td className="whitespace-nowrap text-[11px]">{formatDateTime(file.modifiedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            显示前 200 个文件；完整目录请点击“打开数据目录”。
          </div>
        </div>
      ) : null}

      {tab === 'manual' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="panel px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <FileJson size={16} className="text-teal-700 dark:text-teal-300" /> Asian Metal 手动录入
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              填写最低价/最高价，或直接填写均价。提交后进入同一套校验、均值、轮转与审计链路。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">日期</span>
                <input className="input" type="date" value={manual.date} onChange={(event) => setManual({ ...manual, date: event.target.value })} />
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">产品</span>
                <select
                  className="input"
                  value={manual.productId}
                  onChange={(event) => {
                    const productId = event.target.value
                    setManual({ ...manual, productId, productName: productId === 'am-az91d' ? 'Asian Metal AZ91D 中国出厂' : 'Asian Metal ADC12 中国交到' })
                  }}
                >
                  <option value="am-adc12">ADC12 中国交到</option>
                  <option value="am-az91d">AZ91D 中国出厂</option>
                </select>
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">最低价</span>
                <input className="input" value={manual.low} onChange={(event) => setManual({ ...manual, low: event.target.value })} placeholder="可选" />
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">最高价</span>
                <input className="input" value={manual.high} onChange={(event) => setManual({ ...manual, high: event.target.value })} placeholder="可选" />
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">均价</span>
                <input className="input" value={manual.average} onChange={(event) => setManual({ ...manual, average: event.target.value })} placeholder="不填则取高低价中点" />
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">单位</span>
                <input className="input" value={manual.unit} onChange={(event) => setManual({ ...manual, unit: event.target.value })} />
              </label>
              <label className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">来源链接（可选）</span>
                <input className="input" value={manual.sourceUrl} onChange={(event) => setManual({ ...manual, sourceUrl: event.target.value })} placeholder="https://www.asianmetal.cn/..." />
              </label>
              <label className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">备注（可选）</span>
                <input className="input" value={manual.note} onChange={(event) => setManual({ ...manual, note: event.target.value })} />
              </label>
            </div>
            <button className="btn-primary mt-4 w-full" onClick={submitManual}>
              <Upload size={14} /> 提交并校验
            </button>
          </section>

          <section className="panel px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <FileDown size={16} className="text-teal-700 dark:text-teal-300" /> CSV 批量导入
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              支持中文/英文表头：日期、产品、最低价、最高价、均价、单位、来源、备注。UTF-8 CSV。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void onFile(event.target.files?.[0])} />
              <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
                <Upload size={14} /> 选择 CSV
              </button>
              <button
                className="btn-ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(CSV_TEMPLATE)
                  push('CSV 模板已复制', 'success')
                }}
              >
                复制模板
              </button>
            </div>
            <textarea
              className="input mt-3 h-28 resize-none font-mono !text-[11px]"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder="粘贴 CSV 内容，或点击选择文件"
            />
            <button className="btn-primary mt-2 w-full" onClick={() => void importCsv(csvText)} disabled={importing}>
              {importing ? '导入中…' : '导入 CSV'}
            </button>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-[10px] leading-5 text-slate-300">{CSV_TEMPLATE}</pre>
          </section>
        </div>
      ) : null}

      <Modal
        open={Boolean(quarantineDetail)}
        onClose={() => setQuarantineDetail(null)}
        title="隔离数据复核"
        footer={
          quarantineDetail ? (
            <>
              <button className="btn-secondary" onClick={() => setQuarantineDetail(null)}>关闭</button>
              <button className="btn-danger" onClick={() => reject(quarantineDetail)}>
                <X size={14} /> 拒绝
              </button>
              <button className="btn-primary" onClick={() => approve(quarantineDetail)}>
                <Check size={14} /> 通过并重算
              </button>
            </>
          ) : null
        }
      >
        {quarantineDetail ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['日期', quarantineDetail.date],
                ['来源', quarantineDetail.source],
                ['产品', quarantineDetail.productName],
                ['数值', quarantineDetail.value],
                ['单位', quarantineDetail.unit],
                ['来源链接', quarantineDetail.sourceUrl]
              ].map(([label, value]) => (
                <div key={label} className="panel-muted px-3 py-2">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div className="mt-1 break-all font-mono text-[11px]">{value}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">校验明细</div>
              <div className="space-y-1">
                {quarantineDetail.validation.checks.map((check, index) => (
                  <div key={`${check.rule}-${index}`} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60">
                    <Badge tone={check.status === 'pass' ? 'green' : check.status === 'warn' ? 'amber' : 'red'}>{check.status}</Badge>
                    <span className="text-slate-600 dark:text-slate-300">{check.rule}：{check.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
