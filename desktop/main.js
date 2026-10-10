// Agent Standup desktop app: the same local server as the extension, in its own window, with an indicator in the menu bar (macOS) or tray (Windows, Linux)
// that shows what your agents are doing and notifies you when one may need you. Nothing leaves your machine.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const path = require('path'), fs = require('fs');
const core = require('./core/server.js');
const SELFTEST = process.argv.includes('--selftest') ? process.argv[process.argv.indexOf('--selftest') + 1] : null;   // renders the window to a PNG and quits: used to check a build
let win = null, tray = null, port = 0, quitting = false, lastNeeds = 0;

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => showWindow());

function showWindow() { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 420, minHeight: 360, backgroundColor: '#12131a', title: 'Agent Standup', show: !SELFTEST,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'document-user-activation-required' } });
  win.loadURL(`http://localhost:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch {} return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://localhost:${port}/`)) { e.preventDefault(); try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch {} } });
  win.on('close', (e) => { if (!quitting && !SELFTEST) { e.preventDefault(); win.hide(); } });   // closing the window keeps the indicator running
  win.on('closed', () => { win = null; });
}

function counts() {
  const now = Date.now(), act = core.boardRows().filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), n = (s) => act.filter((r) => r.state === s).length;
  return { needs: n('blocked'), working: n('working') + n('waiting'), turn: n('turn') };
}
function refreshTray() {
  if (!tray) return; let c; try { c = counts(); } catch { return; }
  const text = [c.needs ? `✋${c.needs}` : '', c.working ? `⚙${c.working}` : '', !c.needs && !c.working && c.turn ? '✓' : ''].filter(Boolean).join(' ');
  if (process.platform === 'darwin') tray.setTitle(text ? ' ' + text : '');
  tray.setToolTip('Agent Standup' + (text ? ' — ' + [c.needs && `${c.needs} may need you`, c.working && `${c.working} working`, !c.needs && !c.working && c.turn && 'your turn'].filter(Boolean).join(', ') : ''));
  if (c.needs > lastNeeds && !(win && win.isFocused()) && Notification.isSupported()) new Notification({ title: 'Agent Standup', body: 'An agent may be waiting for you ✋' }).show();
  lastNeeds = c.needs;
}
function createTray() {
  const base = nativeImage.createFromPath(path.join(__dirname, 'core/media/icon.png')), img = base.resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Agent Standup', click: showWindow }, { label: 'Open in browser', click: () => shell.openExternal(`http://localhost:${port}/`) },
    { label: 'Open characters folder', click: () => { const d = core.charactersDir(); try { fs.mkdirSync(d, { recursive: true }); } catch {} shell.openPath(d); } },
    { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow); refreshTray(); setInterval(refreshTray, 4000);
}

app.whenReady().then(async () => {
  const srv = core.start(0); await new Promise((r) => srv.once('listening', r)); port = srv.address().port;
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'core/media/icon.png')));
  createWindow(); createTray();
  if (SELFTEST) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage(); fs.writeFileSync(SELFTEST, img.toPNG());
      console.log(JSON.stringify({ ok: true, port, title: win.getTitle(), size: img.getSize(), trayTitle: tray ? 'created' : 'none' })); quitting = true; app.quit();
    }, 3000));
  }
});
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; try { core.shutdown(); } catch {} });
app.on('window-all-closed', () => { /* stay in the tray */ });
