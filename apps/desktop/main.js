// Lumen desktop main process (plain CommonJS — no build step).
// Security posture: contextIsolation on, nodeIntegration off, sandboxed
// renderer, custom lumen:// protocol for the packaged web build, strict
// navigation/permission guards, and a supervised loopback API child process
// that owns its own random data directory under the OS app-data path.
'use strict';

const { app, BrowserWindow, protocol, shell, net } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const PACKAGED = app.isPackaged;
const DEV_URL = process.env.LUMEN_DEV_URL; // dev mode: reuse the running dev web server
const PORT = 8757;

let apiChild = null;
let mainWindow = null;
let quitting = false;

// ---------- single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---------- data directory ----------
function dataDir() {
  const base = path.join(app.getPath('userData'), 'lumen-data');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

// ---------- API child ----------
function startApiChild() {
  const serverEntry = PACKAGED
    ? path.join(process.resourcesPath, 'server', 'src', 'main.ts')
    : path.join(__dirname, '..', 'server', 'src', 'main.ts');
  const child = spawn(process.execPath, ['--experimental-transform-types', serverEntry], {
    cwd: path.dirname(serverEntry),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LUMEN_DATA_DIR: dataDir(),
      LUMEN_PORT: String(PORT),
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  child.on('exit', () => {
    apiChild = null;
    if (!quitting) {
      // Supervised: if the API dies while the window lives, take the window down.
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      app.quit();
    }
  });
  apiChild = child;
}

function waitForApi(timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const ping = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 1200 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolvePromise();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) rejectPromise(new Error('API did not become ready'));
      else setTimeout(ping, 350);
    };
    ping();
  });
}

// ---------- protocol ----------
function registerProtocol() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'lumen', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function handleLumenProtocol() {
  protocol.handle('lumen', (request) => {
    const url = new URL(request.url);
    let filePath = url.pathname === '/' || url.pathname === '' ? '/index.html' : url.pathname;
    const base = PACKAGED ? path.join(process.resourcesPath, 'web-dist') : path.join(__dirname, '..', 'web', 'dist');
    const resolved = path.normalize(path.join(base, filePath));
    if (!resolved.startsWith(path.normalize(base))) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch('file://' + resolved);
  });
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#faf9f6',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const allowNavigation = (url) => {
    const parsed = new URL(url);
    return parsed.protocol === 'lumen:' || (DEV_URL && url.startsWith(DEV_URL)) || parsed.origin === `http://localhost:${PORT}`;
  };
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowNavigation(url)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadURL('lumen://local/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  registerProtocol();
  handleLumenProtocol();

  try {
    startApiChild();
    await waitForApi();
  } catch (err) {
    const { dialog } = require('electron');
    void dialog.showErrorBox('Lumen API failed to start', String(err));
    app.quit();
    return;
  }

  // The renderer reaches the API through the same origin (lumen://) using the
  // session token injected by the preload bridge — no direct origins needed.
  createWindow();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  quitting = true;
  if (apiChild) apiChild.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (apiChild) apiChild.kill();
});
