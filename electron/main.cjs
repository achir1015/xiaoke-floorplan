'use strict';
// 小柯機器人建築平面圖轉3D工具：桌面版主程式
// 網頁本體（dist/）由 xkfloor:// 載入；辨識與 3D 都在畫面裡執行，這裡只負責視窗、存檔與版本更新。
// 關閉視窗即結束程式。
const { app, BrowserWindow, ipcMain, protocol, shell, dialog, Menu, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { Updater } = require('./updater.cjs');

const SCHEME = 'xkfloor';
const DIST = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// 自動測試用：獨立的設定資料夾，不影響使用者自己的設定
if (process.env.XK_USER_DATA) app.setPath('userData', process.env.XK_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const updater = new Updater();
let win = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'xiaoke-settings.json');
}
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

// 介面設計寬 1360×780；螢幕縮放很大（例如 200%）時視窗太小，整頁等比例縮小才不會擠成手機版面
const DESIGN_W = 1360;
const DESIGN_H = 780;
function fitZoom() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const z = Math.max(0.55, Math.min(1, w / DESIGN_W, h / DESIGN_H));
  win.webContents.setZoomFactor(z);
}

function createWindow() {
  const s = readSettings();
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(s.bounds?.width || 1480, wa.width),
    height: Math.min(s.bounds?.height || 920, wa.height),
    x: s.bounds?.x,
    y: s.bounds?.y,
    minWidth: 760,
    minHeight: 520,
    title: '小柯機器人建築平面圖轉3D工具',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#eef3f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (s.maximized) win.maximize();
  win.loadURL(`${SCHEME}://app/index.html${process.env.XK_QUERY ? `?${process.env.XK_QUERY}` : ''}`);
  win.webContents.on('did-finish-load', fitZoom);
  win.on('resize', fitZoom);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  const remember = () => {
    if (!win || win.isDestroyed()) return;
    const cur = readSettings();
    cur.maximized = win.isMaximized();
    if (!cur.maximized && !win.isMinimized()) cur.bounds = win.getBounds();
    writeSettings(cur);
  };
  win.on('close', remember);
  win.on('closed', () => (win = null));
}

async function serveApp(req) {
  const url = new URL(req.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
  try {
    const data = await fs.promises.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

const SAVE_FILTERS = {
  glb: { name: 'GLB 3D 模型（VR）', extensions: ['glb'] },
  usdz: { name: 'USDZ（Apple Vision Pro／AR）', extensions: ['usdz'] },
  obj: { name: 'OBJ 3D 模型', extensions: ['obj'] },
  stl: { name: 'STL（3D 列印）', extensions: ['stl'] },
  png: { name: 'PNG 圖片', extensions: ['png'] },
  xkplan: { name: '小柯平面圖專案', extensions: ['xkplan'] },
};

app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  protocol.handle(SCHEME, serveApp);
  // 語音輸入要用麥克風
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'clipboard-read', 'clipboard-sanitized-write'].includes(perm)));

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }));
  ipcMain.handle('file:save', async (e, name, data) => {
    const ext = path.extname(name).slice(1).toLowerCase();
    const auto = process.env.XK_SAVE_DIR;
    let file;
    if (auto) {
      // 自動測試：不跳對話框，直接存到指定資料夾
      fs.mkdirSync(auto, { recursive: true });
      file = path.join(auto, name);
    } else {
      const dir = path.join(app.getPath('documents'), '小柯平面圖3D');
      fs.mkdirSync(dir, { recursive: true });
      const r = await dialog.showSaveDialog(win, {
        title: '儲存檔案',
        defaultPath: path.join(dir, name),
        filters: [SAVE_FILTERS[ext] || { name: '檔案', extensions: [ext || '*'] }, { name: '所有檔案', extensions: ['*'] }],
      });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    await fs.promises.writeFile(file, Buffer.from(data));
    if (!auto) shell.showItemInFolder(file);
    return file;
  });

  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', (e) => updater.download((got, total) => {
    if (!e.sender.isDestroyed()) e.sender.send('update:progress', { got, total });
  }));
  ipcMain.handle('update:install', (e, file) => updater.install(file));
  ipcMain.handle('update:openPage', () => shell.openExternal(updater.info?.page || 'https://github.com/achir1015/xiaoke-floorplan/releases/latest'));

  createWindow();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => app.quit());
