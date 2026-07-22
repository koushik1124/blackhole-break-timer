// ─────────────────────────────────────────────────────────────
// Black Hole Break Timer — Electron Main Process (FIXED)
// ─────────────────────────────────────────────────────────────
const { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, Tray, Menu, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');

// ── Single Instance Lock (Prevents duplicate processes & hotkey freezes) ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[MAIN] Another instance is already running. Quitting duplicate.');
  app.quit();
  process.exit(0);
}

// ── Permanently suppress Chromium GPU-cache errors on Windows ──
app.setPath('userData', path.join(os.tmpdir(), 'blackhole-timer-dev'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');

// ── Configuration ────────────────────────────────────────────
const MAX_WORK_SECONDS = 2400;          // 40 min of active work → full scale
const MAX_SCALE = 1.5;           // scale ceiling
const BLOCK_THRESHOLD = 0.8 * MAX_SCALE; // 1.2 — blocks mouse at 80%
const IDLE_BREAK_SEC = 180;           // 3 minutes idle = break taken
const POLL_MS = 2000;          // check every 2 s

// ── State ────────────────────────────────────────────────────
let mainWindow = null;
let activeWorkSeconds = 0;
let isBlocking = false;
let debugForcedScale = null;   // non-null when a debug hotkey overrides scale
let tray = null;
let gracePeriodActive = false; // 💡 Prevents idle monitor from immediately re-blocking after escape!
let pendingSupernova = false;  // 💡 set true once a full break completes; consumed the next tick the user is active again

// ── Window Creation ──────────────────────────────────────────
function createWindow() {
  // Calculate full bounds across ALL connected displays
  const allDisplays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const display of allDisplays) {
    const { x, y, width: dw, height: dh } = display.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + dw);
    maxY = Math.max(maxY, y + dh);
  }

  const totalWidth  = maxX - minX;
  const totalHeight = maxY - minY;

  mainWindow = new BrowserWindow({
    x: minX,
    y: minY,
    width: totalWidth,
    height: totalHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: false,  // disabled for multi-monitor; manual sizing covers all screens
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setMenu(null);

  mainWindow.loadFile('index.html');
  mainWindow.setIgnoreMouseEvents(true);

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(captureDesktop, 150);
  });

  startIdleMonitor();
}

// ── Idle Monitor ─────────────────────────────────────────────
function startIdleMonitor() {
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // 💡 Skip auto-scaling ticks while a grace period is active
    if (gracePeriodActive) return;

    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds < 5) {
      activeWorkSeconds += POLL_MS / 1000;
    }

    if (idleSeconds >= IDLE_BREAK_SEC) {
      activeWorkSeconds = 0;
      pendingSupernova = true; // 💡 a full break just completed — fire on the next return-to-activity tick
    }

    const naturalScale = Math.min(
      (activeWorkSeconds / MAX_WORK_SECONDS) * MAX_SCALE,
      MAX_SCALE
    );
    const targetScale = debugForcedScale !== null ? debugForcedScale : naturalScale;

    // 💡 Consume the pending flag exactly once, on the first tick where the
    // user is measurably active again (idleSeconds < 5) after a completed break.
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

    // ── Block / unblock mouse ──
    if (targetScale >= BLOCK_THRESHOLD && !isBlocking) {
      mainWindow.setIgnoreMouseEvents(false, { forward: true });
      isBlocking = true;
    } else if (targetScale < BLOCK_THRESHOLD && isBlocking) {
      mainWindow.setIgnoreMouseEvents(true);
      isBlocking = false;
    }
  }, POLL_MS);
}

// ── Desktop Screenshot Capture ─────────────────────────────────
async function captureDesktop() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    mainWindow.setOpacity(0);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.min(width, 1920), height: Math.min(height, 1080) },
    });

    mainWindow.setOpacity(1);

    if (sources && sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL();
      mainWindow.webContents.send('screen-captured', dataUrl);
    }
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(1);
    console.error('[MAIN] Desktop capture error:', err);
  }
}

// ── Helper: push a forced scale value ──────────────────────
function applyDebugScale(scale) {
  debugForcedScale = scale;
  gracePeriodActive = false; // Override grace period if manual hotkey is pressed
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update-scale', { scale, idleSec: 0, workSec: 0, debug: true, triggerSupernova: false });

  if (scale >= BLOCK_THRESHOLD && !isBlocking) {
    mainWindow.setIgnoreMouseEvents(false, { forward: true });
    isBlocking = true;
  } else if (scale < BLOCK_THRESHOLD && isBlocking) {
    mainWindow.setIgnoreMouseEvents(true);
    isBlocking = false;
  }
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  // ── Desktop Capture IPC ──
  ipcMain.on('request-screen-capture', () => captureDesktop());

  // ── Hawking Radiation Escape — Grace Period (INSIDE app.whenReady) ──
  ipcMain.on('trigger-grace-period', () => {
    console.log('[MAIN] ⚡ Hawking Radiation Blast! Resetting scale for grace period.');

    // 💡 1. Lock grace period state & clear debug override
    gracePeriodActive = true;
    debugForcedScale = null;

    // 💡 2. Reset work seconds to 20% scale
    activeWorkSeconds = Math.round(MAX_WORK_SECONDS * 0.20);

    if (mainWindow && !mainWindow.isDestroyed()) {
      // 💡 3. UNBLOCK MOUSE IMMEDIATELY
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

    // 💡 4. Unlock natural idle monitor after 60 seconds
    setTimeout(() => {
      gracePeriodActive = false;
    }, 60000);
  });

  // ── System Tray ─────────────────────────────────────────────
  const iconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAA0VXRoAAAAi0lEQVQ4Eb3SMQoCIRhF4f/aQjDIIYxla+xSWY1WYzNYGcwihkUwiBgQfIMXXTz48XyMkI0xxhyXZRmUUkrrvpRSyBjjHGOsqyT1WmtYa0MIIWzLgN/3vV/Xta+1hohzsNb6uW3b8J+TJMmXZRnMzH1mRkSUrLWOiMg8z8M8z8N/ToiIknmehzRNw7U2y26H4E5/73gAAAAASUVORK5CYII=';
  tray = new Tray(nativeImage.createFromDataURL(iconBase64));
  tray.setToolTip('Black Hole Break Timer');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Set Scale: 0%', click: () => applyDebugScale(0) },
    { label: 'Set Scale: 25%', click: () => applyDebugScale(MAX_SCALE * 0.25) },
    { label: 'Set Scale: 50%', click: () => applyDebugScale(MAX_SCALE * 0.5) },
    { label: 'Set Scale: 80% (Block Mouse)', click: () => applyDebugScale(MAX_SCALE * 0.8) },
    { label: 'Set Scale: 100% (Full)', click: () => applyDebugScale(MAX_SCALE) },
    { type: 'separator' },
    { label: 'Resume Natural Growth', click: () => { debugForcedScale = null; gracePeriodActive = false; } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);

  // ── Register Hotkeys Safely ────────────────────────────────
  globalShortcut.unregisterAll();

  // Emergency quit: Ctrl+Shift+B
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

  // Manual debug hotkeys (Ctrl+Shift+0 to 4)
  globalShortcut.register('Ctrl+Shift+0', () => applyDebugScale(0));
  globalShortcut.register('Ctrl+Shift+1', () => applyDebugScale(MAX_SCALE * 0.25));
  globalShortcut.register('Ctrl+Shift+2', () => applyDebugScale(MAX_SCALE * 0.50));
  globalShortcut.register('Ctrl+Shift+3', () => applyDebugScale(MAX_SCALE * 0.80));
  globalShortcut.register('Ctrl+Shift+4', () => applyDebugScale(MAX_SCALE));
  globalShortcut.register('Ctrl+Shift+R', () => { debugForcedScale = null; gracePeriodActive = false; });
});

app.on('before-quit', () => {
  // Safety: always restore mouse click-through so the desktop isn't stuck blocked
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(true);
    isBlocking = false;
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});