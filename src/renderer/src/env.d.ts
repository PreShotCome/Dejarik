/// <reference types="vite/client" />

interface DejarikApi {
  getVersion: () => Promise<string>
  getSettings: () => Promise<Record<string, unknown>>
  setSettings: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
}

interface Window {
  dejarik: DejarikApi
}
