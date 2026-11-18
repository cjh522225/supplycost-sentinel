import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api } from '../shared/ipc'
import type { LlmStreamChunk, ProgressEvent, RealtimeSnapshot } from '../shared/types'

const api: Api = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  dashboard: () => ipcRenderer.invoke(IPC.dashboard),
  history: (req) => ipcRenderer.invoke(IPC.history, req),
  trace: (req) => ipcRenderer.invoke(IPC.trace, req),
  listMonitors: () => ipcRenderer.invoke(IPC.listMonitors),
  saveMonitor: (monitor) => ipcRenderer.invoke(IPC.saveMonitor, monitor),
  deleteMonitor: (id) => ipcRenderer.invoke(IPC.deleteMonitor, id),
  toggleMonitor: (id, enabled) => ipcRenderer.invoke(IPC.toggleMonitor, id, enabled),
  runFetch: (req) => ipcRenderer.invoke(IPC.runFetch, req),
  runBackfill: (opts) => ipcRenderer.invoke(IPC.runBackfill, opts),
  fetchStatus: () => ipcRenderer.invoke(IPC.fetchStatus),
  manualAdd: (input) => ipcRenderer.invoke(IPC.manualAdd, input),
  manualImportCsv: (csv) => ipcRenderer.invoke(IPC.manualImportCsv, csv),
  listAlerts: (filter) => ipcRenderer.invoke(IPC.listAlerts, filter),
  updateAlert: (id, status) => ipcRenderer.invoke(IPC.updateAlert, id, status),
  audit: () => ipcRenderer.invoke(IPC.audit),
  files: () => ipcRenderer.invoke(IPC.files),
  quarantine: () => ipcRenderer.invoke(IPC.quarantine),
  approveQuarantine: (id, reason) => ipcRenderer.invoke(IPC.approveQuarantine, id, reason),
  rejectQuarantine: (id, reason) => ipcRenderer.invoke(IPC.rejectQuarantine, id, reason),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  llmTest: (input) => ipcRenderer.invoke(IPC.llmTest, input),
  llmChat: (req) => ipcRenderer.invoke(IPC.llmChat, req),
  llmChatStream: (requestId, req) => ipcRenderer.invoke(IPC.llmChatStream, requestId, req),
  cancelLlmChat: (requestId) => ipcRenderer.invoke(IPC.cancelLlmChat, requestId),
  listConversations: () => ipcRenderer.invoke(IPC.listConversations),
  loadConversation: (id) => ipcRenderer.invoke(IPC.loadConversation, id),
  createConversation: () => ipcRenderer.invoke(IPC.createConversation),
  saveConversation: (id, messages) => ipcRenderer.invoke(IPC.saveConversation, id, messages),
  deleteConversation: (id) => ipcRenderer.invoke(IPC.deleteConversation, id),
  realtimeSnapshot: () => ipcRenderer.invoke(IPC.realtimeSnapshot),
  realtimeTest: (input) => ipcRenderer.invoke(IPC.realtimeTest, input),
  realtimePollNow: () => ipcRenderer.invoke(IPC.realtimePollNow),
  realtimeSeries: (productId) => ipcRenderer.invoke(IPC.realtimeSeries, productId),
  sourceHealth: () => ipcRenderer.invoke(IPC.sourceHealth),
  generateDailyReport: (force) => ipcRenderer.invoke(IPC.generateDailyReport, force),
  latestDailyReport: () => ipcRenderer.invoke(IPC.latestDailyReport),
  listDailyReports: (limit) => ipcRenderer.invoke(IPC.listDailyReports, limit),
  acceptanceRun: (id) => ipcRenderer.invoke(IPC.acceptanceRun, id),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  exportData: (kind) => ipcRenderer.invoke(IPC.exportData, kind),
  catalog: () => ipcRenderer.invoke(IPC.catalog),
  onProgress: (cb) => {
    const listener = (_event: unknown, payload: ProgressEvent) => cb(payload)
    ipcRenderer.on(IPC.progress, listener)
    return () => ipcRenderer.removeListener(IPC.progress, listener)
  },
  onDataChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.dataChanged, listener)
    return () => ipcRenderer.removeListener(IPC.dataChanged, listener)
  },
  onRealtimeUpdated: (cb) => {
    const listener = (_event: unknown, payload: RealtimeSnapshot) => cb(payload)
    ipcRenderer.on(IPC.realtimeUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.realtimeUpdated, listener)
  },
  onLlmChunk: (cb) => {
    const listener = (_event: unknown, payload: LlmStreamChunk) => cb(payload)
    ipcRenderer.on(IPC.llmChunk, listener)
    return () => ipcRenderer.removeListener(IPC.llmChunk, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
