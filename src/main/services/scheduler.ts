import { join } from 'node:path'
import { addDays, format } from 'date-fns'
import type { AppSettings } from '../../shared/types'
import { readJsonFile, writeJsonAtomic } from '../../core/storage/fileStore'
import type { DataService } from './dataService'

interface SchedulerState {
  lastRunDate?: string
  lastRunSlot?: string
  lastPeriodKey?: string
}

export class Scheduler {
  private timer?: NodeJS.Timeout
  private ticking = false
  private state: SchedulerState

  constructor(
    private readonly dataService: DataService,
    private readonly configDir: string
  ) {
    this.state = readJsonFile<SchedulerState>(join(configDir, 'scheduler.json'), {})
  }

  start(): void {
    this.stop()
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 30_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private saveState(): void {
    writeJsonAtomic(join(this.configDir, 'scheduler.json'), this.state)
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = new Date()
      const today = format(now, 'yyyy-MM-dd')
      const period = format(now, 'yyyy-MM')
      if (this.state.lastPeriodKey !== period) {
        await this.dataService.ensureCurrentPeriodFiles()
        this.state.lastPeriodKey = period
        this.saveState()
      }
      const settings: AppSettings = this.dataService.getSettingsPublic()
      if (!settings.schedule.enabled || !settings.schedule.times.length) return
      if (this.state.lastRunDate && this.state.lastRunDate > today) {
        this.state.lastRunDate = undefined
        this.state.lastRunSlot = undefined
      }
      if (this.state.lastRunDate !== today) {
        this.state.lastRunDate = today
        this.state.lastRunSlot = undefined
        this.saveState()
      }
      const currentTime = format(now, 'HH:mm')
      const scheduled = [...settings.schedule.times].sort()
      const dueSlot = scheduled.filter((time) => currentTime >= time).at(-1)
      if (!dueSlot) return
      if (!settings.schedule.catchUp && currentTime !== dueSlot) return
      const runKey = `${today}T${dueSlot}`
      if (this.state.lastRunSlot === runKey) return
      const status = await this.dataService.fetchStatus()
      if (status.running) return
      this.state.lastRunSlot = runKey
      this.saveState()
      await this.dataService.runFetch()
    } catch (error) {
      console.error('[scheduler]', error)
    } finally {
      this.ticking = false
    }
  }

  nextRunLabel(times: string[]): string | undefined {
    if (!times.length) return undefined
    const now = new Date()
    const today = format(now, 'yyyy-MM-dd')
    const future = times
      .map((time) => `${today}T${time}:00`)
      .find((candidate) => new Date(candidate).getTime() > now.getTime())
    return future ?? `${format(addDays(now, 1), 'yyyy-MM-dd')}T${times[0]}:00`
  }
}
