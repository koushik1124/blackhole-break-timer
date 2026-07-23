<p align="center">
  <img src="https://img.shields.io/badge/🕳️-BLACK_HOLE_BREAK_TIMER-blueviolet?style=for-the-badge&labelColor=0d1117" alt="Black Hole Break Timer" />
</p>

<h1 align="center">🕳️ Black Hole Break Timer</h1>

<p align="center">
  <strong>A real-time 3D Schwarzschild Raymarched break enforcer for Windows.</strong><br/>
  <em>Your desktop gets consumed by a physically-simulated black hole if you don't take breaks.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-a78bfa?style=for-the-badge&logo=github&logoColor=white" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows_10%2F11_x64-0078d4?style=for-the-badge&logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-30+-47848f?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Three.js-r160+-000000?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/GLSL-Custom_Shaders-f97316?style=for-the-badge" alt="GLSL" />
  <img src="https://img.shields.io/badge/license-MIT-34d399?style=for-the-badge" alt="License" />
</p>

---

## 🌌 Overview & Philosophy

Standard break reminder apps show a notification you dismiss in 0.3 seconds. **Black Hole Break Timer** makes ignoring it physically impossible.

A transparent, always-on-top overlay renders a **real-time raymarched black hole** directly on your desktop. It starts invisible. As you work continuously for 40 minutes, the black hole **grows from nothing** — gravitationally lensing your actual screen content, warping pixels through Schwarzschild geodesic bending, spinning a relativistic accretion disk with Doppler beaming, and eventually **blocking your mouse entirely** at 80% capacity.

The only ways out:

- **Take a 3-minute break** → the hole resets to zero (Supernova celebration 💥)
- **Shake your mouse violently** → fill the Hawking Radiation gauge to 100% for a 60-second grace period
- **`Ctrl+Shift+B`** → emergency kill (for when you're in a meeting and your screen is being eaten)

This is not a notification. This is a **consequence**.

---

## ✨ Core Features

### 🔭 Real-Time Schwarzschild Raymarching

The black hole is not a sprite, video, or pre-rendered animation. Every pixel is computed per-frame using a **custom GLSL fragment shader** that:

- **Raymarches through curved spacetime** using a Schwarzschild geodesic approximation with 45-step ray integration
- **Gravitationally lenses your actual desktop** — captured via Electron's `desktopCapturer` and distorted in real-time
- **Renders a 3D tilted accretion disk** with orbital velocity gradients, turbulence via fBm noise, and spiral arm structures
- **Simulates relativistic Doppler beaming** — the approaching side of the disk is blue-shifted and intensified (~D³·⁵), the receding side is red-shifted and dimmed
- **Draws a razor-thin photon ring** at r = 1.5 × r_eh (the photon sphere) with 3.5× intensity bloom
- **Projects an outer relativistic aura** with animated interference patterns

All of this runs on the GPU at 60 FPS through a single fullscreen quad.

### 🛡️ Enforced Wellbeing Lockdown

At **80% scale** (32 minutes of continuous work), the overlay stops being passive:

- `setIgnoreMouseEvents(false, { forward: true })` blocks all mouse clicks through the overlay while still forwarding mouse **movement** events to the renderer
- Your cursor is trapped — you cannot click on anything beneath the black hole
- The HUD displays **🚫 MOUSE BLOCKED** status
- The only escape is the Hawking Radiation mechanic or taking a real break

### ⚛️ Hawking Radiation Escape Hatch

When the mouse is blocked, a **Hawking Radiation energy gauge** appears at the bottom of the screen:

- **Shake your mouse rapidly** — velocity is tracked via `mousemove` with exponential smoothing and converted to charge rate
- **Tap `Space` or `Shift`** — keyboard backup that injects velocity directly into the shake detector
- Energy decays at **8%/sec** if you stop, so you must sustain the effort
- At **100%**, a dramatic **⚡ HAWKING RADIATION BLAST ⚡** banner fires with pulsing animations
- The main process receives `trigger-grace-period` via IPC, immediately unblocks the mouse, resets scale to 20%, and grants a **60-second grace period** where the idle monitor is frozen

### 💥 Supernova Reset Reward

When you actually take a **3-minute break** (system idle ≥ 180 seconds):

- Work seconds reset to zero, the black hole collapses
- On your first mouse/keyboard input after returning, a **💥 Supernova Recovery Complete 💥** banner fires
- The accretion disk receives a **shockwave speed boost** (6× drift velocity, decaying over 2 seconds) that reads as an outward particle explosion
- This is the reward loop — rest is visually celebrated, not just silently acknowledged

### 🖥️ Desktop Gravitational Lensing

On launch, the app captures a screenshot of your actual desktop via `desktopCapturer` and feeds it to the shader as a `sampler2D` texture. As the black hole grows:

- Pixels near the event horizon are **spaghettified** — stretched along radial lines and swirled by a time-varying twist function
- The distortion field scales quadratically with event horizon radius
- Your desktop content visibly bends, warps, and falls into the singularity

### 🎯 Ambient Drift & Centering

- At low scales, the black hole **floats lazily** across the screen on a Lissajous path
- As it grows past 80%, the drift radius shrinks to zero and it **locks to screen center** — becoming inescapable
- Drift velocity is fed to the shader as `uDriftSpeed`, modulating accretion disk orbital animation speed

---

## 🏗️ Architecture & Technical Design

```
┌─────────────────────────────────────────────────────────────────┐
│                      ELECTRON MAIN PROCESS                      │
│                         (main.js)                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ PowerMonitor │  │   Screen /   │  │   Global Shortcuts    │  │
│  │  Idle Track  │  │DesktopCapture│  │  Ctrl+Shift+0–4,B,R  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              IPC Message Bus (ipcMain)                  │    │
│  │  • update-scale    • screen-captured                    │    │
│  │  • trigger-grace-period  • request-screen-capture       │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                     │
│  ┌────────────────────────┼────────────────────────────────┐    │
│  │  setIgnoreMouseEvents  │  setAlwaysOnTop('screen-saver')│    │
│  │  setOpacity            │  Single Instance Lock          │    │
│  └────────────────────────┼────────────────────────────────┘    │
│                           │                                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              │      PRELOAD BRIDGE        │
              │       (preload.js)         │
              │  contextBridge → bhApi     │
              │  • onScaleUpdate()         │
              │  • onScreenCaptured()      │
              │  • requestGracePeriod()    │
              │  • requestScreenCapture()  │
              └─────────────┬──────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                    RENDERER PROCESS                              │
│                     (renderer.js)                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              THREE.js WebGL Scene                       │    │
│  │                                                         │    │
│  │  ┌─────────────────┐    ┌──────────────────────────┐    │    │
│  │  │ Fullscreen Quad │    │  Particle Points (4000)  │    │    │
│  │  │ Raymarched GLSL │    │  Accretion Disk Sparkle  │    │    │
│  │  │  • Schwarzschild│    │  • Orbital velocity      │    │    │
│  │  │  • Doppler beam │    │  • Additive blending     │    │    │
│  │  │  • Lensing      │    │  • Per-particle rand     │    │    │
│  │  │  • Photon ring  │    └──────────────────────────┘    │    │
│  │  │  • Desktop tex  │                                    │    │
│  │  └─────────────────┘                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Hawking Escape  │  │  Supernova Reset │  │   Debug HUD  │  │
│  │  Mouse shake +   │  │  Shockwave anim  │  │  Scale, Pos  │  │
│  │  keyboard backup │  │  Banner reward   │  │  Idle, Work  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Stack Breakdown

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Electron 30+ | Transparent overlay, system tray, hotkeys, IPC |
| **3D Engine** | Three.js r160+ | WebGL scene graph, shader materials, particle system |
| **GPU Shaders** | Custom GLSL | Schwarzschild raymarching, Doppler beaming, lensing |
| **Idle Detection** | Electron PowerMonitor | System-level input idle tracking (no polling hacks) |
| **Screen Capture** | Electron desktopCapturer | Real desktop texture for gravitational lensing |
| **IPC Security** | contextBridge + contextIsolation | Zero `nodeIntegration` — all IPC goes through typed bridge |
| **Installer** | electron-builder (NSIS) | One-click `.exe` installer for Windows x64 |

---

## 🎮 Controls & Hotkeys

### Global Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+B` | **Emergency Exit** — resets scale to 0%, unblocks mouse, quits app |
| `Ctrl+Shift+0` | Set scale to **0%** (invisible) |
| `Ctrl+Shift+1` | Set scale to **25%** |
| `Ctrl+Shift+2` | Set scale to **50%** |
| `Ctrl+Shift+3` | Set scale to **80%** (triggers mouse block) |
| `Ctrl+Shift+4` | Set scale to **100%** (full black hole) |
| `Ctrl+Shift+R` | **Resume Natural Growth** — clears debug override |

### In-App Escape (When Mouse Is Blocked)

| Input | Effect |
|-------|--------|
| **Shake mouse rapidly** | Charges Hawking Radiation gauge (velocity-based) |
| **Tap `Space`** | Injects +2.5 velocity into shake detector |
| **Tap `Left Shift`** | Injects +2.5 velocity into shake detector |
| **Reach 100% energy** | Fires Hawking Blast → 60-second grace period |

### System Tray (Right-Click Icon)

| Menu Item | Action |
|-----------|--------|
| Set Scale: 0% – 100% | Override scale for testing |
| Resume Natural Growth | Clear debug override, resume idle tracking |
| Quit | Clean shutdown with mouse-unblock safety |

---

## 📦 Installation & Quick Start

### For End Users — Download the Installer

1. Go to the **[Releases](../../releases)** page
2. Download the latest `Black-Hole-Break-Timer-Setup-x.x.x.exe`
3. Run the installer — choose your install directory
4. Launch **Black Hole Timer** from your Start Menu or Desktop shortcut
5. The app starts silently in the system tray. Work naturally — the black hole will find you.

### For Developers — Build from Source

```bash
# Clone the repository
git clone https://github.com/your-username/blackhole-break-timer.git
cd blackhole-break-timer

# Install dependencies
npm install

# Run in development mode
npm start

# Build the Windows installer (.exe)
npm run dist
```

### Project Structure

```
blackhole-break-timer/
├── main.js          # Electron main process — idle tracking, IPC, window management
├── preload.js       # Context-isolated IPC bridge (bhApi)
├── renderer.js      # Three.js scene, GLSL shaders, Hawking escape, Supernova reward
├── index.html       # Transparent fullscreen shell with import map
├── lib/
│   └── three.module.js   # Vendored Three.js (no node_modules dependency at runtime)
├── package.json     # Electron + electron-builder configuration
└── .gitignore
```

---

## 🖥️ Multi-Monitor & Compatibility

### Multi-Monitor Support

The overlay calculates a **bounding rectangle across all connected displays** using `screen.getAllDisplays()`. On a dual-monitor setup (e.g., 1920×1080 + 2560×1440 side-by-side), the window spans the full combined area from `(minX, minY)` to `(maxX, maxY)`. The black hole renders centered on the primary display viewport.

### DPI & Display Scaling

- The renderer caps `devicePixelRatio` at **2×** to prevent GPU overload on 4K/HiDPI screens
- Physical resolution is computed as `window.innerWidth × pixelRatio` and passed to the GLSL shader as `uResolution`
- All UV calculations use resolution-corrected coordinates with aspect ratio normalization

### Window Behavior

| Property | Value |
|----------|-------|
| `alwaysOnTop` | `'screen-saver'` level (above taskbar and Start Menu) |
| `transparent` | `true` — only rendered pixels are visible |
| `frame` | `false` — no title bar or window chrome |
| `skipTaskbar` | `true` — invisible in Alt+Tab |
| Mouse forwarding | `{ forward: true }` when blocking — movement events still reach renderer |

### Safety Guarantees

- **`before-quit` handler** always restores `setIgnoreMouseEvents(true)` — your desktop is never permanently locked
- **Single instance lock** prevents duplicate processes and hotkey conflicts
- **GPU cache disabled** — suppresses Chromium shader cache errors on Windows

---

## ⚙️ Configuration

All tuning constants are at the top of `main.js`:

```javascript
const MAX_WORK_SECONDS = 2400;   // 40 minutes → full black hole
const MAX_SCALE        = 1.5;    // Maximum scale factor
const BLOCK_THRESHOLD  = 1.2;    // 80% of max → mouse block activates
const IDLE_BREAK_SEC   = 180;    // 3 minutes idle = break completed
const POLL_MS          = 2000;   // Idle check interval
```

Modify these values and restart the app. No rebuild required for development mode.

---

## 📄 License & Free Access

This project is **100% Free & Open Source** licensed under the **[MIT License](LICENSE)**.

- 🟢 **Free for Everyone**: Completely free to download, use, share, and distribute.
- 🟢 **No Hidden Fees or Subscriptions**: Forever free with zero restrictions.
- 🟢 **Open Source**: Free to inspect, modify, and build upon.

See the full [LICENSE](LICENSE) file for details.

---

<p align="center">
  <br/>
  <strong>🕳️ You can't close a black hole. You can only take a break.</strong>
  <br/><br/>
  <sub>Built with Electron · Three.js · Custom GLSL · Stubbornness</sub>
</p>
