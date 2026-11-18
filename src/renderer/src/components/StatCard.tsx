import type { ReactNode } from 'react'
import { cn } from '../lib/format'

export function StatCard({ label, value, sub, icon, tone = 'teal' }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'teal' | 'blue' | 'amber' | 'red' }) {
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label">{label}</div>
          <div className="mt-1.5 font-mono text-[22px] font-semibold leading-none tracking-tight text-slate-900 tabular dark:text-white">{value}</div>
          {sub ? <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{sub}</div> : null}
        </div>
        {icon ? (
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl',
              tone === 'teal' && 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
              tone === 'blue' && 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
              tone === 'amber' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
              tone === 'red' && 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  )
}
