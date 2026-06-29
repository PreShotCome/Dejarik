import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { initAutoUpdate } from './updater'

// Keep dev's userData isolated from the installed build's, so both can run
// simultaneously without fighting over Chromium's cache lock.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'dejarik-dev'))
}

// ---------------------------------------------------------------------------
// Settings — single JSON file under userData. Survives reinstalls.
// ---------------------------------------------------------------------------

type Settings = Record<string, unknown>

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    return JSON.parse(raw) as Settings
  } catch {
    return {}
  }
}

async function writeSettings(data: Settings): Promise<Settings> {
  await fs.writeFile(settingsPath(), JSON.stringify(data, null, 2), 'utf-8')
  return data
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'Dejarik',
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_event, data: Settings) => writeSettings(data))

  createWindow()
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
