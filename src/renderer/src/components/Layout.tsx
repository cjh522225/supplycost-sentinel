import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bell,
  Database,
  LayoutDashboard,
  LineChart,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Wifi,
  WifiOff
} from 'lucide-react'
import type { ProgressEvent } from '@shared/types'
import { api, useBootstrap } from '../lib/api'
import { cn, formatDateTime, formatRelative } from '../lib/format'
import { CommandPalette } from './CommandPalette'
import { ProgressBar } from './ProgressBar'
import { useToast } from './Toast'

const NAV = [
  { to: '/', label: '总览', icon: LayoutDashboard, end: true },
  { to: '/history', label: '历史与均值', icon: LineChart },
  { to: '/monitors', label: '监测配置', icon: SlidersHorizontal },
  { to: '/alerts', label: '预警中心', icon: Bell },
  { to: '/audit', label: '数据审计', icon: Database },
  { to: '/assistant', label: '智能分析', icon: Sparkles },
  { to: '/acceptance', label: '验收模式', icon: ShieldCheck },
  { to: '/settings', label: '设置', icon: SettingsIcon }
]

const TITLES: Record<string, string> = {
  '/': '总览',
  '/history': '历史与均值',
  '/monitors': '监测配置',
  '/alerts': '预警中心',
  '/audit': '数据审计',
  '/assistant': '智能分析',
  '/acceptance': '验收模式',
  '/settings': '设置'
}

export function Layout({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useBootstrap()
  const queryClient = useQueryClient()
  const { push } = useToast()
  const location = useLocation()
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [fetching, setFetching] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const off = api.onProgress((event) => {
      setProgress(event)
      if (event.phase === 'done') {
        window.setTimeout(() => setProgress(null), 2600)
      }
    })
    return off
  }, [])

  const runFetch = async () => {
    if (fetching) return
    setFetching(true)
    try {
      const result = await api.runFetch()
      push(`${result.log.message}（有效 ${result.valid}，隔离 ${result.quarantined}）`, result.log.status === 'failed' ? 'error' : 'success')
      await queryClient.invalidateQueries()
    } catch (error) {
      push(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setFetching(false)
    }
  }

  const refresh = async () => {
    await queryClient.invalidateQueries()
    push('界面数据已刷新', 'info')
  }

  const title = TITLES[location.pathname] ?? '链价智控'
  const status = data?.status
  const feedState = isError
    ? { label: '主进程未连接', dot: 'bg-red-500' }
    : status?.running
      ? { label: '任务执行中', dot: 'animate-pulse bg-amber-500' }
      : status?.lastRun?.status === 'failed'
        ? { label: '抓取失败', dot: 'bg-red-500' }
        : status?.lastRun?.status === 'partial'
          ? { label: '部分成功', dot: 'bg-amber-500' }
          : { label: '监测服务正常', dot: 'bg-emerald-500' }

  return (
    <div className="flex min-h-screen bg-[#f4f6f3] text-slate-900 dark:bg-[#0b1220] dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[236px] flex-col bg-[#0b1f1c] text-teal-50">
        <div className="flex h-[72px] items-center gap-3 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-400/15 ring-1 ring-teal-300/30">
            <Activity size={19} className="text-teal-300" strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold tracking-wide">链价智控</div>
            <div className="truncate text-[10px] text-teal-100/60">SupplyCost Sentinel</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-teal-300/15 text-white ring-1 ring-teal-300/20' : 'text-teal-100/65 hover:bg-white/5 hover:text-white'
                  )
                }
              >
                <Icon size={17} strokeWidth={1.9} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[10px] leading-5 text-teal-100/45">
          <div>v{data?.version ?? '1.0.0'} · 本地 JSON/CSV</div>
          <div>广东科技学院 · 坏了坏了这下好了</div>
        </div>
      </aside>

      <div className="ml-[236px] flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#f4f6f3]/85 backdrop-blur-xl dark:border-slate-800 dark:bg-[#0b1220]/85">
          <div className="flex min-h-[72px] items-center justify-between gap-4 px-6">
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className={cn('inline-flex h-1.5 w-1.5 rounded-full', feedState.dot)} />
                {feedState.label}
                <span className="text-slate-300 dark:text-slate-700">/</span>
                {status?.lastRun ? `上次抓取 ${formatRelative(status.lastRun.finishedAt)}` : '尚未抓取'}
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <span className="tabular">有效 {status?.validRecords ?? 0} · 隔离 {status?.quarantinedRecords ?? 0}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isError ? (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <WifiOff size={14} /> 主进程未连接
                </span>
              ) : (
                <span className="hidden items-center gap-1 text-xs text-slate-500 lg:flex dark:text-slate-400">
                  <Wifi size={14} /> {status?.nextRun ? `下次 ${formatDateTime(status.nextRun)}` : '调度未启用'}
                </span>
              )}
              <CommandPalette />
              <button className="btn-secondary" onClick={refresh} title="刷新界面数据">
                <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
                刷新
              </button>
              <button className="btn-primary" onClick={runFetch} disabled={fetching || status?.running}>
                <RefreshCw size={15} className={fetching || status?.running ? 'animate-spin' : ''} />
                {fetching || status?.running ? '抓取中' : '立即抓取'}
              </button>
              <button className="btn-secondary !px-2.5" onClick={() => setDark((value) => !value)} title={dark ? '切换浅色' : '切换深色'}>
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
          {progress ? (
            <div className="px-6 pb-3">
              <ProgressBar event={progress} />
            </div>
          ) : null}
        </header>

        <main className="flex-1 px-6 py-5">{children}</main>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200/70 px-6 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', feedState.dot)} />
            {feedState.label}
          </span>
          <span className="truncate font-mono">{status?.dataDir ?? data?.dataDir ?? 'data'}</span>
          <span>有效 {status?.validRecords ?? 0}</span>
          <span>隔离 {status?.quarantinedRecords ?? 0}</span>
          <span>时区 Asia/Shanghai</span>
          <span className="ml-auto font-mono">v{data?.version ?? '1.0.0'} · 本地 JSON/CSV</span>
        </footer>
      </div>
    </div>
  )
}
