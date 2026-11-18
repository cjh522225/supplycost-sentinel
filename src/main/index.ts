import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { IPC } from '../shared/ipc'
import type {
  AcceptanceId,
  AlertFilter,
  AlertStatus,
  AppSettings,
  BackfillOptions,
  FetchRunRequest,
  HistoryRequest,
  LlmChatRequest,
  LlmTestInput,
  ManualRecordInput,
  MonitorConfig,
  ConversationMessage,
  RealtimeSettingsInput,
  TraceRequest
} from '../shared/types'
import { DataService } from './services/dataService'
import { Scheduler } from './services/scheduler'

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

let mainWindow: BrowserWindow | undefined
let dataService: DataService | undefined
let scheduler: Scheduler | undefined

function appRoot(): string {
  return app.isPackaged ? join(app.getPath('exe'), '..') : process.cwd()
}

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function registerIpc(service: DataService): void {
  const handle = <T>(channel: string, fn: (...args: never[]) => Promise<T>) => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...(args as never[])))
  }
  handle(IPC.bootstrap, () => service.bootstrap())
  handle(IPC.dashboard, () => service.dashboard())
  handle(IPC.history, (req: HistoryRequest) => service.history(req))
  handle(IPC.trace, (req: TraceRequest) => service.trace(req))
  handle(IPC.listMonitors, async () => service.getMonitors())
  handle(IPC.saveMonitor, (monitor: MonitorConfig) => service.saveMonitor(monitor))
  handle(IPC.deleteMonitor, (id: string) => service.deleteMonitor(id))
  handle(IPC.toggleMonitor, (id: string, enabled: boolean) => service.toggleMonitor(id, enabled))
  handle(IPC.runFetch, (req?: FetchRunRequest) => service.runFetch(req))
  handle(IPC.runBackfill, (opts: BackfillOptions) => service.runBackfill(opts))
  handle(IPC.fetchStatus, () => service.fetchStatus())
  handle(IPC.manualAdd, (input: ManualRecordInput) => service.manualAdd(input))
  handle(IPC.manualImportCsv, (csv: string) => service.manualImportCsv(csv))
  handle(IPC.listAlerts, (filter?: AlertFilter) => service.listAlerts(filter))
  handle(IPC.updateAlert, (id: string, status: AlertStatus) => service.updateAlert(id, status))
  handle(IPC.audit, () => service.audit())
  handle(IPC.files, () => service.files())
  handle(IPC.quarantine, () => service.quarantine())
  handle(IPC.approveQuarantine, (id: string, reason: string) => service.approveQuarantine(id, reason))
  handle(IPC.rejectQuarantine, (id: string, reason: string) => service.rejectQuarantine(id, reason))
  handle(IPC.getSettings, async () => service.getSettingsPublic())
  handle(IPC.saveSettings, (settings: Partial<AppSettings> & { llm?: Partial<AppSettings['llm']> & { apiKey?: string } }) =>
    service.saveSettings(settings)
  )
  handle(IPC.llmTest, (input?: LlmTestInput) => service.llmTest(input))
  handle(IPC.llmChat, (req: LlmChatRequest) => service.llmChat(req))
  handle(IPC.llmChatStream, (requestId: string, req: LlmChatRequest) =>
    service.llmChatStream(requestId, req)
  )
  handle(IPC.cancelLlmChat, async (requestId: string) => service.cancelLlmChat(requestId))
  handle(IPC.listConversations, async () => service.listConversations())
  handle(IPC.loadConversation, async (id?: string) => service.loadConversation(id))
  handle(IPC.createConversation, async () => service.createConversation())
  handle(IPC.saveConversation, async (id: string, messages: ConversationMessage[]) =>
    service.saveConversation(id, messages)
  )
  handle(IPC.deleteConversation, async (id: string) => service.deleteConversation(id))
  handle(IPC.realtimeSnapshot, async () => service.getRealtimeSnapshot())
  handle(IPC.realtimeTest, (input?: RealtimeSettingsInput) => service.realtimeTest(input))
  handle(IPC.realtimePollNow, () => service.realtimePollNow())
  handle(IPC.realtimeSeries, (productId: string) => service.realtimeSeries(productId))
  handle(IPC.sourceHealth, () => service.sourceHealth())
  handle(IPC.generateDailyReport, (force?: boolean) => service.generateDailyReport(force))
  handle(IPC.latestDailyReport, async () => service.latestDailyReport())
  handle(IPC.listDailyReports, async (limit?: number) => service.listDailyReports(limit))
  handle(IPC.acceptanceRun, (id: AcceptanceId) => service.acceptanceRun(id))
  handle(IPC.openDataFolder, async () => service.openDataFolder())
  handle(IPC.exportData, (kind: string) => service.exportData(kind))
  handle(IPC.catalog, () => service.catalog())
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#f4f6f3',
    title: '链价智控',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  const root = appRoot()
  const configDir = join(root, 'config')
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
  dataService = await DataService.create({
    appRoot: root,
    configDir,
    version: app.getVersion(),
    onProgress: (event) => send(IPC.progress, event),
    onDataChanged: () => send(IPC.dataChanged),
    onRealtime: (snapshot) => send(IPC.realtimeUpdated, snapshot),
    onLlmChunk: (requestId, chunk) => send(IPC.llmChunk, { requestId, chunk })
  })
  registerIpc(dataService)
  if (process.env.SUPPLYCOST_DISABLE_SCHEDULER !== '1') {
    scheduler = new Scheduler(dataService, configDir)
    scheduler.start()
  }
  await createWindow()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.supplycost.sentinel')
    try {
      await bootstrap()
    } catch (error) {
      dialog.showErrorBox('链价智控启动失败', error instanceof Error ? error.message : String(error))
      app.quit()
    }
  })
  app.on('window-all-closed', () => {
    scheduler?.stop()
    dataService?.stopRealtime()
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    scheduler?.stop()
    dataService?.stopRealtime()
  })
}
