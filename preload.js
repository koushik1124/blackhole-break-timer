// ─────────────────────────────────────────────────────────────
// Preload — exposes a safe IPC bridge to the renderer
// ─────────────────────────────────────────────────────────────
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bhApi', {
  /** Register a callback for black-hole scale updates from the main process. */
  onScaleUpdate: (callback) => {
    // 💡 Prevent listener accumulation on reloads
    ipcRenderer.removeAllListeners('update-scale');

    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update-scale', listener);

    // Return a cleanup method so the renderer can unsubscribe if needed
    return () => {
      ipcRenderer.removeListener('update-scale', listener);
    };
  },

  /** Register a callback when desktop screenshot is captured. */
  onScreenCaptured: (callback) => {
    ipcRenderer.removeAllListeners('screen-captured');
    const listener = (_event, dataUrl) => callback(dataUrl);
    ipcRenderer.on('screen-captured', listener);
    return () => {
      ipcRenderer.removeListener('screen-captured', listener);
    };
  },

  /** Request a fresh desktop capture from the main process. */
  requestScreenCapture: () => {
    ipcRenderer.send('request-screen-capture');
  },

  /** Force a specific scale immediately (debug only). */
  forceScale: (scale) => {
    ipcRenderer.send('force-scale', scale);
  },

  /** Request a grace period — triggered by Hawking Radiation escape. */
  requestGracePeriod: () => {
    ipcRenderer.send('trigger-grace-period');
  },
});