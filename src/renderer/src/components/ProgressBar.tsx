import type { ProgressEvent } from '@shared/types'

export function ProgressBar({ event }: { event: ProgressEvent }) {
  const pct = event.total > 0 ? Math.min(100, Math.round((event.current / event.total) * 100)) : 0
  return (
    <div className="panel-muted px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-700 dark:text-slate-200">{event.message}</span>
        <span className="font-mono text-slate-500 dark:text-slate-400">
          {event.current}/{event.total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full rounded-full bg-teal-600 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
