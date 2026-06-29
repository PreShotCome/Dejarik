// Auto-update via electron-updater. The feed URL is baked into app-update.yml
// at build time from the `publish` block in electron-builder.yml — the
// dejarik-releases repo is public, so the installed app needs no token.
//
// Only runs in a packaged build; in dev there is no app-update.yml.
import { app } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const SIX_HOURS = 6 * 60 * 60 * 1000

export function initAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    console.log(`[update] available: ${info.version}`)
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[update] up to date')
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[update] downloaded ${info.version} — will install on quit`)
  })
  autoUpdater.on('error', (err) => {
    console.error('[update] error:', err == null ? 'unknown' : (err.stack || err).toString())
  })

  void autoUpdater.checkForUpdatesAndNotify()
  setInterval(() => {
    void autoUpdater.checkForUpdatesAndNotify()
  }, SIX_HOURS)
}
