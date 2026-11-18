import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  FileText,
  LayoutDashboard,
  LineChart,
  ListChecks,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal
} from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from './Toast'
import { Modal } from './Modal'
import { cn } from '../lib/format'

interface Command {
  id: string
  label: string
  hint?: string
  icon: typeof Search
  run: () => void | Promise<void>
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { push } = useToast()

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path)
      setOpen(false)
    }
    return [
      { id: 'dashboard', label: '总览', hint: 'Dashboard', icon: LayoutDashboard, run: go('/') },
      { id: 'history', label: '历史与均值', hint: 'History', icon: LineChart, run: go('/history') },
      { id: 'alerts', label: '预警中心', hint: 'Alerts', icon: Activity, run: go('/alerts') },
      { id: 'audit', label: '数据审计', hint: 'Audit', icon: ShieldCheck, run: go('/audit') },
      { id: 'assistant', label: '智能分析', hint: 'AI', icon: Sparkles, run: go('/assistant') },
      { id: 'monitors', label: '监测配置', hint: 'Monitors', icon: SlidersHorizontal, run: go('/monitors') },
      { id: 'acceptance', label: '验收模式', hint: 'Acceptance', icon: ListChecks, run: go('/acceptance') },
      { id: 'settings', label: '设置', hint: 'Settings', icon: Settings, run: go('/settings') },
      {
        id: 'report',
        label: '生成今日 AI 日报',
        hint: 'Report',
        icon: FileText,
        run: async () => {
          setOpen(false)
          try {
            const report = await api.generateDailyReport(true)
            await queryClient.invalidateQueries({ queryKey: ['latest-daily-report'] })
            navigate('/assistant')
            push(report.fallback ? '日报已生成（本地模板）' : '日报已生成并保存', report.fallback ? 'info' : 'success')
          } catch (error) {
            push(error instanceof Error ? error.message : String(error), 'error')
          }
        }
      },
      {
        id: 'refresh',
        label: '刷新界面数据',
        hint: 'Refresh',
        icon: RefreshCw,
        run: async () => {
          await queryClient.invalidateQueries()
          setOpen(false)
          push('界面数据已刷新', 'info')
        }
      },
      {
        id: 'fetch',
        label: '立即抓取官方数据',
        hint: 'Fetch',
        icon: RefreshCw,
        run: async () => {
          setOpen(false)
          try {
            const result = await api.runFetch()
            await queryClient.invalidateQueries()
            push(`${result.log.message}（有效 ${result.valid}，隔离 ${result.quarantined}）`, result.log.status === 'failed' ? 'error' : 'success')
          } catch (error) {
            push(error instanceof Error ? error.message : String(error), 'error')
          }
        }
      }
    ]
  }, [navigate, push, queryClient])

  const filtered = commands.filter((command) => `${command.label} ${command.hint ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (!open) return
      if (event.key === 'Escape') setOpen(false)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((value) => Math.min(filtered.length - 1, value + 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((value) => Math.max(0, value - 1))
      }
      if (event.key === 'Enter' && filtered[active]) {
        event.preventDefault()
        void filtered[active].run()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, filtered, open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  return (
    <>
      <button className="btn-secondary !h-8 !px-2.5 !text-[11px]" onClick={() => setOpen(true)} title="命令面板 Ctrl+K">
        <Search size={14} /> <span className="hidden lg:inline">搜索</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="命令面板" footer={null}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-900">
            <Search size={15} className="text-slate-400" />
            <input
              autoFocus
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              placeholder="输入页面、动作，例如：预警 / 刷新"
            />
            <span className="text-[10px] text-slate-400">Ctrl K</span>
          </div>
          <div className="max-h-80 space-y-1 overflow-auto">
            {filtered.length === 0 ? <div className="px-2 py-6 text-center text-xs text-slate-400">没有匹配命令</div> : null}
            {filtered.map((command, index) => {
              const Icon = command.icon
              return (
                <button
                  key={command.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                    index === active ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-200' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void command.run()}
                >
                  <Icon size={14} />
                  <span className="flex-1">{command.label}</span>
                  {command.hint ? <span className="font-mono text-[10px] text-slate-400">{command.hint}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    </>
  )
}
