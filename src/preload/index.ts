import { contextBridge, ipcRenderer } from 'electron'

// The single, audited surface the renderer can touch.
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getSettings: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:get'),
  setSettings: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:set', data)
}

export type DejarikApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('dejarik', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore — define on window when context isolation is off
  window.dejarik = api
}
