// ─────────────────────────────────────────────────────────────
// Black Hole Break Timer — Main Process (Clean & Working)
// ─────────────────────────────────────────────────────────────
const { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, Tray, Menu, nativeImage, desktopCapturer } = require('electron');
const path = require('path');

let mainWindow = null;
let activeWorkSeconds = 0;
let isBlocking = false;
let debugForcedScale = null;
let tray = null;
let gracePeriodActive = false;
let pendingSupernova = false;

const MAX_WORK_SECONDS = 2400;
const MAX_SCALE = 1.5;
const BLOCK_THRESHOLD = 0.8 * MAX_SCALE;
const IDLE_BREAK_SEC = 180;
const POLL_MS = 2000;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;

  mainWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: false,
    show: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    type: 'screen-saver',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile('index.html');
  mainWindow.setIgnoreMouseEvents(true);
  mainWindow.showInactive();
  mainWindow.setBounds(primaryDisplay.bounds);
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setContentProtection(true);

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
    setTimeout(captureDesktop, 200);
  });

  startIdleMonitor();
  startCaptureInterval();
}

function startCaptureInterval() {
  // 💡 Periodically recapture the desktop every 5 seconds seamlessly
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    captureDesktop();
  }, 5000);
}

function startIdleMonitor() {
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (gracePeriodActive) return;

    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds < 5) {
      activeWorkSeconds += POLL_MS / 1000;
    }

    if (idleSeconds >= IDLE_BREAK_SEC) {
      activeWorkSeconds = 0;
      pendingSupernova = true;
    }

    const naturalScale = Math.min((activeWorkSeconds / MAX_WORK_SECONDS) * MAX_SCALE, MAX_SCALE);
    const targetScale = debugForcedScale !== null ? debugForcedScale : naturalScale;

    let triggerSupernova = false;
    if (pendingSupernova && idleSeconds < 5) {
      triggerSupernova = true;
      pendingSupernova = false;
    }

    mainWindow.webContents.send('update-scale', {
      scale: targetScale,
      idleSec: idleSeconds,
      workSec: Math.round(activeWorkSeconds),
      debug: debugForcedScale !== null,
      triggerSupernova,
    });

    if (targetScale >= BLOCK_THRESHOLD && !isBlocking) {
      mainWindow.setIgnoreMouseEvents(false);
      isBlocking = true;
    } else if (targetScale < BLOCK_THRESHOLD && isBlocking) {
      mainWindow.setIgnoreMouseEvents(true);
      isBlocking = false;
    }
  }, POLL_MS);
}

let isCapturing = false;

async function captureDesktop() {
  if (!mainWindow || mainWindow.isDestroyed() || isCapturing) return;
  isCapturing = true;

  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.min(width, 1920), height: Math.min(height, 1080) }
    });

    if (sources && sources.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      const dataUrl = sources[0].thumbnail.toDataURL();
      mainWindow.webContents.send('screen-captured', dataUrl);
    }
  } catch (err) {
    console.error('[MAIN] Capture error:', err);
  } finally {
    isCapturing = false;
  }
}

function applyDebugScale(scale) {
  debugForcedScale = scale;
  gracePeriodActive = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send('update-scale', { scale, idleSec: 0, workSec: 0, debug: true, triggerSupernova: false });

  if (scale >= BLOCK_THRESHOLD && !isBlocking) {
    mainWindow.setIgnoreMouseEvents(false);
    isBlocking = true;
  } else if (scale < BLOCK_THRESHOLD && isBlocking) {
    mainWindow.setIgnoreMouseEvents(true);
    isBlocking = false;
  }
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.on('request-screen-capture', () => captureDesktop());
  ipcMain.on('force-scale', (_event, scale) => applyDebugScale(scale));

  ipcMain.on('trigger-grace-period', () => {
    gracePeriodActive = true;
    debugForcedScale = null;
    activeWorkSeconds = Math.round(MAX_WORK_SECONDS * 0.20);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true);
      isBlocking = false;

      const gracedScale = (activeWorkSeconds / MAX_WORK_SECONDS) * MAX_SCALE;
      mainWindow.webContents.send('update-scale', {
        scale: gracedScale,
        idleSec: 0,
        workSec: Math.round(activeWorkSeconds),
        debug: false,
        triggerSupernova: false,
      });
    }

    setTimeout(() => { gracePeriodActive = false; }, 60000);
  });

  // System Tray Setup
  const iconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAA0VXRoAAAAi0lEQVQ4Eb3SMQoCIRhF4f/aQjDIIYxla+xSWY1WYzNYGcwihkUwiBgQfIMXXTz48XyMkI0xxhyXZRmUUkrrvpRSyBjjHGOsqyT1WmtYa0MIIWzLgN/3vV/Xta+1hohzsNb6uW3b8J+TJMmXZRnMzH1mRkSUrLWOiMg8z8M8z8N/ToiIknmehzRNw7U2y26H4E5/73gAAAAASUVORK5CYII=';
  tray = new Tray(nativeImage.createFromDataURL(iconBase64));
  tray.setToolTip('Black Hole Break Timer');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Set Scale: 0%', click: () => applyDebugScale(0) },
    { label: 'Set Scale: 25%', click: () => applyDebugScale(MAX_SCALE * 0.25) },
    { label: 'Set Scale: 50%', click: () => applyDebugScale(MAX_SCALE * 0.5) },
    { label: 'Set Scale: 80% (Lockout)', click: () => applyDebugScale(MAX_SCALE * 0.8) },
    { label: 'Set Scale: 100% (Full)', click: () => applyDebugScale(MAX_SCALE) },
    { type: 'separator' },
    { label: 'Resume Auto Growth', click: () => { debugForcedScale = null; gracePeriodActive = false; } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);

  globalShortcut.unregisterAll();
  globalShortcut.register('Ctrl+Shift+B', () => {
    activeWorkSeconds = 0;
    debugForcedScale = null;
    gracePeriodActive = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-scale', { scale: 0, triggerSupernova: false });
      mainWindow.setIgnoreMouseEvents(true);
      isBlocking = false;
    }
    setTimeout(() => app.quit(), 300);
  });

  globalShortcut.register('Ctrl+Shift+0', () => applyDebugScale(0));
  globalShortcut.register('Ctrl+Shift+1', () => applyDebugScale(MAX_SCALE * 0.25));
  globalShortcut.register('Ctrl+Shift+2', () => applyDebugScale(MAX_SCALE * 0.50));
  globalShortcut.register('Ctrl+Shift+3', () => applyDebugScale(MAX_SCALE * 0.80));
  globalShortcut.register('Ctrl+Shift+4', () => applyDebugScale(MAX_SCALE));
  globalShortcut.register('Ctrl+Shift+R', () => { debugForcedScale = null; gracePeriodActive = false; });
});

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(true);
    isBlocking = false;
  }
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { app.quit(); });