// ─────────────────────────────────────────────────────────────
// Black Hole Break Timer — Three.js Renderer (FIXED)
// Raymarched black hole + particle accretion disk overlay
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════
   1.  GLSL  —  Full-screen Black-Hole Shader
   ═══════════════════════════════════════════════════════════ */

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uScale;
uniform vec2  uResolution;
uniform vec2  uCenter;
uniform float uDriftSpeed;
uniform sampler2D uScreenTexture;
uniform float uHasScreenTexture;

#define PI 3.14159265359

// ── Noise Functions ─────────────────────────────────────────
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),        hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)),    hash(i + vec2(1,1)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// ── 3D Disk Density & Color Function ────────────────────────
vec4 sampleDisk(vec3 pos, float r_eh, float uTime, float uDriftSpeed) {
  float rIn  = r_eh * 1.8;
  float rOut = r_eh * 5.5;
  float r    = length(pos.xz);
  
  if (r < rIn || r > rOut) return vec4(0.0);

  float thickness = r_eh * 0.06 * (1.0 + (r - rIn) / (rOut - rIn) * 0.5);
  float vFade = exp(-pow(pos.y / thickness, 2.0));
  if (vFade < 0.01) return vec4(0.0);

  float dn = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float angle = atan(pos.z, pos.x);

  float orbital = 1.0 / pow(max(r / r_eh, 1.0), 0.75);
  float spin    = angle + uTime * orbital * 0.5 * (1.0 + uDriftSpeed * 5.0);

  vec2 dc = vec2(spin, r * 12.0);
  float turb = fbm(dc * 2.5 + uTime * 0.3) + fbm(dc * 5.0 - uTime * 0.5) * 0.5;
  float spiral = sin(spin * 4.0 - r * 15.0 + uTime * 0.8) * 0.5 + 0.5;
  float density = mix(spiral, turb, 0.45) * vFade;

  float edgeFade = smoothstep(rIn, rIn * 1.25, r) * smoothstep(rOut, rOut * 0.8, r);
  density *= edgeFade;

  if (density <= 0.001) return vec4(0.0);

  float velX = -sin(angle); 
  float beta = velX * clamp(0.7 * sqrt(r_eh / r), 0.0, 0.85);

  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  float doppler = 1.0 / (gamma * (1.0 - beta * 0.95));

  float t = 1.0 - dn;
  vec3 hotCol   = vec3(2.5, 2.3, 1.9);
  vec3 warmCol  = vec3(2.0, 1.1, 0.2);
  vec3 coolCol  = vec3(1.4, 0.35, 0.04);
  vec3 faintCol = vec3(0.6, 0.08, 0.01);

  vec3 baseCol = (t > 0.7) ? mix(warmCol, hotCol, (t - 0.7) / 0.3)
               : (t > 0.3) ? mix(coolCol, warmCol, (t - 0.3) / 0.4)
               :             mix(faintCol, coolCol, t / 0.3);

  vec3 blueShiftCol = mix(baseCol, vec3(0.8, 1.4, 2.5) * 1.5, clamp((doppler - 1.0) * 1.2, 0.0, 1.0));
  vec3 redShiftCol  = mix(baseCol, vec3(0.8, 0.1, 0.02), clamp((1.0 - doppler) * 1.5, 0.0, 1.0));
  
  vec3 finalColor = (doppler >= 1.0) ? blueShiftCol : redShiftCol;

  float beaming = pow(doppler, 3.2);
  finalColor *= beaming * density * 2.5;
  float alpha = clamp(density * vFade * beaming * 0.90, 0.0, 1.0);

  return vec4(finalColor, alpha);
}

void main() {
  if (uScale < 0.001) { gl_FragColor = vec4(0.0); return; }

  vec2 screenUV = gl_FragCoord.xy / uResolution;
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  uv -= uCenter;

  float rScreen = length(uv);

  float r_eh = uScale * 0.18;
  float r_ph = r_eh * 1.5;

  vec3 ro = vec3(uv.x, uv.y, -3.0);
  vec3 rd = normalize(vec3(0.0, 0.0, 1.0));

  float tiltAngle = 0.38;
  float cosT = cos(tiltAngle);
  float sinT = sin(tiltAngle);
  mat3 tiltMat = mat3(
    1.0,  0.0,   0.0,
    0.0,  cosT, -sinT,
    0.0,  sinT,  cosT
  );

  vec3 rayPos = ro;
  vec3 rayDir = rd;

  vec3 diskColorAccum = vec3(0.0);
  float diskAlphaAccum = 0.0;
  bool hitHorizon = false;
  float minDistToOrigin = 100.0;

  const int STEPS = 45;
  float stepSize = 0.12;

  for (int i = 0; i < STEPS; i++) {
    float r = length(rayPos);
    minDistToOrigin = min(minDistToOrigin, r);

    if (r <= r_eh) {
      hitHorizon = true;
      break;
    }

    vec3 gravityForce = -normalize(rayPos) * (2.2 * r_eh * r_eh / (r * r * r + 0.0001));
    rayDir = normalize(rayDir + gravityForce * stepSize);

    rayPos += rayDir * stepSize;

    vec3 diskPos = tiltMat * rayPos;

    if (diskAlphaAccum < 0.98) {
      vec4 dCol = sampleDisk(diskPos, r_eh, uTime, uDriftSpeed);
      if (dCol.a > 0.0) {
        diskColorAccum += (1.0 - diskAlphaAccum) * dCol.rgb;
        diskAlphaAccum += (1.0 - diskAlphaAccum) * dCol.a;
      }
    }

    if (r > 6.0 && dot(rayPos, rayDir) > 0.0) break;
  }

  vec2 lensingOffset = (rayDir.xy - rd.xy) * 1.5;
  float gravityLensStrength = (r_eh * r_eh * 0.85) / (rScreen * rScreen + r_eh * 0.01 + 0.0001);
  
  float swirlSpeed = 1.0 + uDriftSpeed * 4.0;
  float swirlTwist = (r_eh * 1.5) / (rScreen + r_eh * 0.1);
  float angleScreen = atan(uv.y, uv.x);
  float twistedAngle = angleScreen + swirlTwist * sin(uTime * 0.8 * swirlSpeed + rScreen * 6.0);
  vec2 distortedDir = vec2(cos(twistedAngle), sin(twistedAngle));

  float distortedR = max(0.0, rScreen - gravityLensStrength * 0.35);
  vec2 distortedUV = distortedDir * distortedR + uCenter;

  float minDim = min(uResolution.x, uResolution.y);
  vec2 distortedScreenUV = (distortedUV * minDim + 0.5 * uResolution) / uResolution;
  distortedScreenUV = clamp(distortedScreenUV + lensingOffset * 0.2, 0.0, 1.0);

  vec4 desktopTex = texture2D(uScreenTexture, distortedScreenUV);
  vec3 col = (uHasScreenTexture > 0.5) ? desktopTex.rgb : vec3(0.0);

  // Scope desktop lensing alpha strictly to the black hole influence radius
  float lensInfluenceRadius = r_eh * 6.0;
  float lensAlpha = (uHasScreenTexture > 0.5) ? smoothstep(lensInfluenceRadius, r_eh * 0.5, rScreen) : 0.0;
  float alpha = lensAlpha;

  if (uHasScreenTexture > 0.5) {
    col *= 1.0 + (gravityLensStrength * 0.45);
  }

  col = mix(col, col + diskColorAccum, clamp(diskAlphaAccum, 0.0, 1.0));
  alpha = max(alpha, diskAlphaAccum * 0.95);

  float photonDist = abs(minDistToOrigin - r_ph);
  float photonRingWidth = r_eh * 0.035;
  float photonRing = exp(-pow(photonDist / photonRingWidth, 2.0));
  
  vec3 photonRingColor = vec3(2.5, 2.0, 1.4) * 3.8 * photonRing;
  col += photonRingColor;
  alpha = max(alpha, photonRing * 0.95);

  if (hitHorizon) {
    col = vec3(0.0);
    alpha = 1.0;
  }

  float auraGlow = pow(r_eh * 1.5 / (rScreen + r_eh * 0.3), 2.5) * 0.15;
  auraGlow *= 0.85 + 0.15 * sin(uTime * 1.5 + rScreen * 10.0);

  vec3 auraColor = mix(
    vec3(0.35, 0.15, 0.85),
    vec3(0.15, 0.45, 1.0),
    sin(angleScreen * 2.0 + uTime * 0.3) * 0.5 + 0.5
  );
  if (!hitHorizon) {
    col += auraColor * auraGlow;
    alpha = max(alpha, auraGlow * 0.5);
  }

  float fade = smoothstep(0.0, 0.05, uScale);
  gl_FragColor = vec4(col * fade, clamp(alpha * fade, 0.0, 1.0));
}
`;

/* ═══════════════════════════════════════════════════════════
   2.  GLSL  —  Particle Accretion-Disk Sparkle
   ═══════════════════════════════════════════════════════════ */

const particleVert = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform vec2  uResolution;
uniform vec2  uCenter;
uniform float uDriftSpeed;

attribute float aRadius;
attribute float aInitAngle;
attribute float aHeight;
attribute vec3  aRand;

varying float vAlpha;
varying vec3  vColor;

void main() {
  float eh = uScale * 0.18;
  float scaledR = aRadius * eh * 5.5;

  float speed = 1.0 / pow(max(aRadius, 0.3), 0.75);
  float angle = aInitAngle + uTime * speed * 0.4 * (1.0 + uDriftSpeed * 5.0)
              + sin(uTime * aRand.x * 2.0 + aRand.y * 6.2832) * 0.08;

  float x = cos(angle) * scaledR;
  float y = sin(angle) * scaledR + aHeight * eh * 0.25 * sin(uTime * aRand.z);

  float minR = min(uResolution.x, uResolution.y);
  vec2 pos = (vec2(x, y) + uCenter) * 2.0 * minR / uResolution;

  gl_Position = vec4(pos, 0.0, 1.0);

  gl_PointSize = max(1.0, (1.5 + 2.5 * aRand.y) * uScale * (minR / 900.0));

  vAlpha = (1.0 - aRadius * 0.6)
         * smoothstep(0.0, 0.15, uScale)
         * (0.5 + 0.5 * aRand.x);

  float t = 1.0 - aRadius;
  vColor = mix(vec3(1.0, 0.30, 0.05),
               vec3(1.0, 0.90, 0.70),
               t * t);
}
`;

const particleFrag = /* glsl */ `
precision highp float;
varying float vAlpha;
varying vec3  vColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float s = pow(1.0 - d * 2.0, 2.0);
  gl_FragColor = vec4(vColor * s * 1.5, vAlpha * s);
}
`;

/* ═══════════════════════════════════════════════════════════
   3.  Three.js Scene
   ═══════════════════════════════════════════════════════════ */

const canvas = document.getElementById('bg');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  premultipliedAlpha: false,
});

const pr = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function physRes() {
  return new THREE.Vector2(
    window.innerWidth * renderer.getPixelRatio(),
    window.innerHeight * renderer.getPixelRatio(),
  );
}

const quadMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uScale: { value: 0 },
    uResolution: { value: physRes() },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uDriftSpeed: { value: 0 },
    uScreenTexture: { value: new THREE.Texture() },
    uHasScreenTexture: { value: 0.0 },
  },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

const textureLoader = new THREE.TextureLoader();

if (window.bhApi && window.bhApi.onScreenCaptured) {
  window.bhApi.onScreenCaptured((dataUrl) => {
    textureLoader.load(dataUrl, (texture) => {
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (quadMat.uniforms.uScreenTexture.value && quadMat.uniforms.uScreenTexture.value.dispose) {
        quadMat.uniforms.uScreenTexture.value.dispose();
      }
      quadMat.uniforms.uScreenTexture.value = texture;
      quadMat.uniforms.uHasScreenTexture.value = 1.0;
    });
  });

  window.bhApi.requestScreenCapture();
}

const N = 4000;
const aRadius = new Float32Array(N);
const aInitAngle = new Float32Array(N);
const aHeight = new Float32Array(N);
const aRand = new Float32Array(N * 3);
const dummy = new Float32Array(N * 3);

for (let i = 0; i < N; i++) {
  aRadius[i] = 0.30 + Math.pow(Math.random(), 0.7) * 0.70;
  aInitAngle[i] = Math.random() * Math.PI * 2;
  aHeight[i] = (Math.random() - 0.5) * 2.0;
  aRand[i * 3] = Math.random();
  aRand[i * 3 + 1] = Math.random();
  aRand[i * 3 + 2] = Math.random();
}

const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
pGeo.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
pGeo.setAttribute('aInitAngle', new THREE.BufferAttribute(aInitAngle, 1));
pGeo.setAttribute('aHeight', new THREE.BufferAttribute(aHeight, 1));
pGeo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 3));

const pMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uScale: { value: 0 },
    uResolution: { value: physRes() },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uDriftSpeed: { value: 0 },
  },
  vertexShader: particleVert,
  fragmentShader: particleFrag,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const pPoints = new THREE.Points(pGeo, pMat);
pPoints.frustumCulled = false;
scene.add(pPoints);

/* ═══════════════════════════════════════════════════════════
   4.  Scale Interpolation & IPC
   ═══════════════════════════════════════════════════════════ */

let currentScale = 0;
let targetScale = 0;
let lastPayload = { scale: 0, idleSec: 0, workSec: 0, debug: false };

const MAX_FLOAT_RADIUS = 0.25;
let currentCenter = new THREE.Vector2(0, 0);
let currentDriftSpeed = 0;

let hudMode = 'compact'; // Default to sleek compact pill mode

const hud = document.createElement('div');
hud.id = 'debug-hud';
Object.assign(hud.style, {
  position: 'fixed',
  top: '18px',
  left: '18px',
  padding: '6px 14px',
  background: 'rgba(0, 0, 0, 0.65)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(167, 139, 250, 0.3)',
  borderRadius: '20px',
  color: '#e0e0e0',
  fontFamily: 'monospace',
  fontSize: '12px',
  lineHeight: '1.5',
  pointerEvents: 'none',
  zIndex: '9999',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  userSelect: 'none',
});
hud.innerHTML = buildHudHTML({ scale: 0, idleSec: 0, workSec: 0, debug: false });
document.body.appendChild(hud);

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function scalePct(s) {
  const num = typeof s === 'number' && !isNaN(s) ? s : 0;
  return (num / 1.5 * 100).toFixed(1);
}

function buildHudHTML(d) {
  const safeData = d || { scale: 0, idleSec: 0, workSec: 0, debug: false };
  const pct = scalePct(safeData.scale);
  const mode = safeData.debug ? '🚧 DEBUG' : '🟢 LIVE';
  const block = safeData.scale >= 1.2 ? ' — <span style="color:#ff5555;font-weight:bold">🚫 BLOCKED</span>' : '';

  if (hudMode === 'compact') {
    return [
      `<span style="color:#6ee7b7;font-weight:700">● LIVE</span>`,
      `<span style="color:rgba(255,255,255,0.25)">│</span>`,
      `Scale: <b style="color:#fbbf24">${pct}%</b>`,
      `<span style="color:rgba(255,255,255,0.25)">│</span>`,
      `Work: <b>${fmtTime(safeData.workSec || 0)}</b>${block}`,
      `<span style="color:#6b7280;font-size:10px;margin-left:4px">(Ctrl+Shift+H)</span>`,
    ].join(' ');
  }

  const bar = buildBar(pct);
  const pos = `(${currentCenter.x.toFixed(3)}, ${currentCenter.y.toFixed(3)})`;
  const drift = (currentDriftSpeed * 100).toFixed(1);
  return [
    `<b style="color:#a78bfa">● Black Hole Break Timer</b>`,
    `<span style="color:#6ee7b7">${mode}</span>${block}`,
    `Scale: <b style="color:#fbbf24">${pct}%</b>  ${bar}`,
    `Pos  : <b style="color:#93c5fd">${pos}</b>  Drift: ${drift}`,
    `Idle : <b>${fmtTime(safeData.idleSec || 0)}</b> / 3m00s`,
    `Work : <b>${fmtTime(safeData.workSec || 0)}</b> / 40m00s`,
    `<span style="color:#6b7280;font-size:10px">Ctrl+Shift+H mode │ Ctrl+Shift+0–4 test</span>`,
  ].join('<br>');
}

function buildBar(pct) {
  const num = parseFloat(pct) || 0;
  const filled = Math.max(0, Math.min(20, Math.round(num / 5)));
  const empty = 20 - filled;
  const color = num >= 80 ? '#ff5555' : num >= 50 ? '#fbbf24' : '#34d399';
  return `<span style="color:${color}">${'█'.repeat(filled)}${'░'.repeat(empty)}</span>`;
}

function updateHudDisplay() {
  if (!lastPayload) return;

  if (hudMode === 'hidden') {
    hud.style.display = 'none';
    return;
  }

  hud.style.display = hudMode === 'compact' ? 'flex' : 'block';

  if (hudMode === 'compact') {
    Object.assign(hud.style, {
      padding: '6px 14px',
      borderRadius: '20px',
      minWidth: 'auto',
      border: '1px solid rgba(167, 139, 250, 0.3)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
    });
  } else {
    Object.assign(hud.style, {
      padding: '12px 16px',
      borderRadius: '10px',
      minWidth: '220px',
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: 'none',
    });
  }

  hud.innerHTML = buildHudHTML(lastPayload);
}

if (window.bhApi && window.bhApi.onToggleHudMode) {
  window.bhApi.onToggleHudMode((requestedMode) => {
    if (requestedMode) {
      hudMode = requestedMode;
    } else {
      hudMode = hudMode === 'compact' ? 'full' : hudMode === 'full' ? 'hidden' : 'compact';
    }
    updateHudDisplay();
  });
}

window.bhApi.onScaleUpdate((data) => {
  targetScale = data.scale;
  lastPayload = data;
  updateHudDisplay();

  if (data.triggerSupernova) {
    triggerSupernovaExplosion();
  }
});

/* ═══════════════════════════════════════════════════════════
   4b. Hawking Radiation Escape Mini-Game
   ═══════════════════════════════════════════════════════════ */

let escapeEnergy = 0;           // 0 → 100
let lastMouseX = 0;
let lastMouseY = 0;
let lastMouseTime = 0;
let shakeVelocity = 0;
let escapeTriggered = false;    // prevent repeated blasts

const energyContainer = document.createElement('div');
energyContainer.id = 'hawking-energy-container';
Object.assign(energyContainer.style, {
  position: 'fixed',
  bottom: '36px',
  left: '50%',
  transform: 'translateX(-50%)',
  width: '420px',
  padding: '0',
  zIndex: '10000',
  pointerEvents: 'none',
  opacity: '0',
  transition: 'opacity 0.4s ease',
  userSelect: 'none',
});

const energyLabel = document.createElement('div');
Object.assign(energyLabel.style, {
  textAlign: 'center',
  fontFamily: "'Inter', 'Segoe UI', monospace",
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  color: '#e2c4ff',
  marginBottom: '8px',
  textShadow: '0 0 12px rgba(167,139,250,0.8)',
});
energyLabel.textContent = '⚛ Hawking Radiation — Shake Mouse / Space to Escape ⚛';
energyContainer.appendChild(energyLabel);

const energyTrack = document.createElement('div');
Object.assign(energyTrack.style, {
  width: '100%',
  height: '18px',
  borderRadius: '9px',
  background: 'rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(167,139,250,0.3)',
  overflow: 'hidden',
  boxShadow: '0 0 20px rgba(167,139,250,0.15), inset 0 1px 3px rgba(0,0,0,0.5)',
});
energyContainer.appendChild(energyTrack);

const energyFill = document.createElement('div');
Object.assign(energyFill.style, {
  width: '0%',
  height: '100%',
  borderRadius: '9px',
  background: 'linear-gradient(90deg, #6d28d9, #a78bfa, #c084fc, #f0abfc)',
  backgroundSize: '300% 100%',
  transition: 'width 0.08s linear',
  boxShadow: '0 0 14px rgba(167,139,250,0.6)',
  position: 'relative',
});
energyTrack.appendChild(energyFill);

const energyPct = document.createElement('div');
Object.assign(energyPct.style, {
  textAlign: 'center',
  fontFamily: 'monospace',
  fontSize: '11px',
  fontWeight: '700',
  color: '#c4b5fd',
  marginTop: '5px',
  textShadow: '0 0 8px rgba(167,139,250,0.5)',
});
energyPct.textContent = '0%';
energyContainer.appendChild(energyPct);

document.body.appendChild(energyContainer);

const blastBanner = document.createElement('div');
blastBanner.id = 'hawking-blast-banner';
Object.assign(blastBanner.style, {
  position: 'fixed',
  top: '0',
  left: '0',
  width: '100vw',
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  zIndex: '10001',
  pointerEvents: 'none',
  opacity: '0',
  transition: 'opacity 0.3s ease',
  background: 'radial-gradient(circle at center, rgba(167,139,250,0.25) 0%, rgba(0,0,0,0) 70%)',
  userSelect: 'none',
});

const blastText = document.createElement('div');
Object.assign(blastText.style, {
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
  fontSize: '52px',
  fontWeight: '900',
  letterSpacing: '6px',
  color: '#ffffff',
  textShadow: `
    0 0 30px rgba(167,139,250,1),
    0 0 60px rgba(192,132,252,0.8),
    0 0 100px rgba(240,171,252,0.5)
  `,
  textTransform: 'uppercase',
  animation: 'none',
});
blastText.textContent = '⚡ Hawking Radiation Blast ⚡';
blastBanner.appendChild(blastText);

const blastSub = document.createElement('div');
Object.assign(blastSub.style, {
  fontFamily: 'monospace',
  fontSize: '16px',
  fontWeight: '600',
  color: '#c4b5fd',
  marginTop: '16px',
  letterSpacing: '3px',
  textShadow: '0 0 20px rgba(167,139,250,0.7)',
});
blastSub.textContent = 'Quantum Escape Successful — Mouse Restored (60s Grace)';
blastBanner.appendChild(blastSub);
document.body.appendChild(blastBanner);

const blastStyle = document.createElement('style');
blastStyle.textContent = `
  @keyframes hawking-pulse {
    0%   { transform: scale(0.85); opacity: 0; }
    30%  { transform: scale(1.08); opacity: 1; }
    70%  { transform: scale(1.0);  opacity: 1; }
    100% { transform: scale(1.1);  opacity: 0; }
  }
  @keyframes hawking-bar-shimmer {
    0%   { background-position: 0% 50%; }
    100% { background-position: 300% 50%; }
  }
`;
document.head.appendChild(blastStyle);

document.addEventListener('mousemove', (e) => {
  const now = performance.now();
  const dt = now - lastMouseTime;

  if (dt > 0 && lastMouseTime > 0) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const velocity = dist / dt;

    shakeVelocity = shakeVelocity * 0.7 + velocity * 0.3;
  }

  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  lastMouseTime = now;
});

window.addEventListener('keydown', (e) => {
  if (currentScale >= 0.8 && (e.code === 'Space' || e.code === 'ShiftLeft')) {
    shakeVelocity += 2.5;
  }
});

function updateEscapeEnergy(dtSec) {
  // 💡 Show Hawking Thrust UI when scale hits 0.8 (50%+ max size) for early feedback
  const isVisible = currentScale >= 0.8;
  energyContainer.style.opacity = isVisible ? '1' : '0';

  if (!isVisible) {
    escapeEnergy = 0;
    escapeTriggered = false;
    updateEnergyBar();
    return;
  }

  if (escapeTriggered) return;

  const chargeRate = Math.max(0, shakeVelocity - 0.2) * 22;
  escapeEnergy = Math.min(100, escapeEnergy + chargeRate * dtSec);

  // Smoothly decay shake velocity boost
  shakeVelocity *= 0.92;

  updateEnergyBar();

  // 🔧 FIX: check the threshold on the value that was just clamped up to 100,
  // BEFORE any decay is applied, and skip decay entirely on the trigger frame.
  // Previously decay ran unconditionally every frame before this check, so
  // escapeEnergy could never actually equal/exceed 100 when tested — it was
  // always dragged back down first, even though the rounded display showed "100%".
  if (escapeEnergy >= 100) {
    triggerHawkingBlast();
    return;
  }

  const decayRate = 8;
  escapeEnergy = Math.max(0, escapeEnergy - decayRate * dtSec);
  updateEnergyBar();
}

function updateEnergyBar() {
  const pct = Math.round(escapeEnergy);
  energyFill.style.width = `${pct}%`;
  energyPct.textContent = `${pct}%`;

  if (escapeEnergy > 5) {
    energyFill.style.animation = 'hawking-bar-shimmer 1.2s linear infinite';
  } else {
    energyFill.style.animation = 'none';
  }

  const glowIntensity = Math.min(escapeEnergy / 100, 1);
  energyFill.style.boxShadow = `0 0 ${14 + glowIntensity * 30}px rgba(167,139,250,${0.4 + glowIntensity * 0.6})`;
  energyTrack.style.borderColor = `rgba(167,139,250,${0.3 + glowIntensity * 0.5})`;
}

function triggerHawkingBlast() {
  if (escapeTriggered) return;
  escapeTriggered = true;

  console.log('[RENDERER] ⚡ Hawking Blast 100% reached! Executing IPC...');

  blastBanner.style.opacity = '1';
  blastText.style.animation = 'hawking-pulse 2.2s ease-out forwards';

  energyFill.style.background = 'linear-gradient(90deg, #f0abfc, #ffffff, #f0abfc)';
  energyFill.style.boxShadow = '0 0 50px rgba(255,255,255,0.9)';

  // Send IPC to main process
  if (window.bhApi && window.bhApi.requestGracePeriod) {
    window.bhApi.requestGracePeriod();
  }

  setTimeout(() => {
    blastBanner.style.opacity = '0';
    blastText.style.animation = 'none';

    escapeEnergy = 0;
    energyFill.style.width = '0%';
    energyFill.style.background = 'linear-gradient(90deg, #6d28d9, #a78bfa, #c084fc, #f0abfc)';
    energyFill.style.backgroundSize = '300% 100%';
    energyPct.textContent = '0%';
    escapeTriggered = false;
  }, 2800);
}

/* ═══════════════════════════════════════════════════════════
   4c. Supernova Reset Animation (fires after a completed break)
   ═══════════════════════════════════════════════════════════ */

let supernovaActive = false;
let supernovaStartMs = 0;
const SUPERNOVA_BANNER_SEC = 3.5;     // how long the reward banner stays visible
const SUPERNOVA_SHOCKWAVE_SEC = 2.0;  // how long the particle-speed boost decays over

const supernovaBanner = document.createElement('div');
supernovaBanner.id = 'supernova-banner';
Object.assign(supernovaBanner.style, {
  position: 'fixed',
  top: '0',
  left: '0',
  width: '100vw',
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  zIndex: '10001',
  pointerEvents: 'none',
  opacity: '0',
  transition: 'opacity 0.5s ease',
  background: 'radial-gradient(circle at center, rgba(255,183,77,0.35) 0%, rgba(0,0,0,0.85) 70%)',
  userSelect: 'none',
});

const supernovaText = document.createElement('div');
Object.assign(supernovaText.style, {
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
  fontSize: '48px',
  fontWeight: '900',
  letterSpacing: '4px',
  color: '#ffffff',
  textAlign: 'center',
  textShadow: `
    0 0 30px rgba(255,183,77,1),
    0 0 60px rgba(255,94,58,0.85),
    0 0 100px rgba(255,220,150,0.5)
  `,
  textTransform: 'uppercase',
  animation: 'none',
});
supernovaText.textContent = '💥 Supernova Recovery Complete 💥';
supernovaBanner.appendChild(supernovaText);

const supernovaSub = document.createElement('div');
Object.assign(supernovaSub.style, {
  fontFamily: 'monospace',
  fontSize: '15px',
  fontWeight: '600',
  color: '#ffd9a0',
  marginTop: '18px',
  letterSpacing: '2.5px',
  textShadow: '0 0 20px rgba(255,183,77,0.7)',
  textAlign: 'center',
});
supernovaSub.textContent = 'Rest Cycle Finished • Eye Strain Reduced • Focus Reset';
supernovaBanner.appendChild(supernovaSub);
document.body.appendChild(supernovaBanner);

const supernovaStyle = document.createElement('style');
supernovaStyle.textContent = `
  @keyframes supernova-pulse {
    0%   { transform: scale(0.7);  opacity: 0; }
    15%  { transform: scale(1.15); opacity: 1; }
    30%  { transform: scale(1.0);  opacity: 1; }
    85%  { transform: scale(1.0);  opacity: 1; }
    100% { transform: scale(1.05); opacity: 0; }
  }
`;
document.head.appendChild(supernovaStyle);

/**
 * Launches the Supernova Reset sequence: boosts particle/disk speed to read
 * as an outward shockwave (reuses the existing uDriftSpeed uniform, decaying
 * over SUPERNOVA_SHOCKWAVE_SEC), shows the reward banner for
 * SUPERNOVA_BANNER_SEC, then fades it out. The black hole itself collapses
 * to 0% via main.js already having zeroed activeWorkSeconds when the break
 * completed — this function only owns the visual celebration on top of that.
 */
function triggerSupernovaExplosion() {
  if (supernovaActive) return; // ignore re-entrant triggers while one is already playing

  console.log('[RENDERER] 💥 Supernova Reset triggered');

  supernovaActive = true;
  supernovaStartMs = performance.now();

  supernovaBanner.style.opacity = '1';
  supernovaText.style.animation = `supernova-pulse ${SUPERNOVA_BANNER_SEC}s ease-out forwards`;

  setTimeout(() => {
    supernovaBanner.style.opacity = '0';
    supernovaText.style.animation = 'none';
    supernovaActive = false;
  }, SUPERNOVA_BANNER_SEC * 1000);
}

/* ═══════════════════════════════════════════════════════════
   5.  Resize
   ═══════════════════════════════════════════════════════════ */

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const pr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  const w = window.innerWidth * pr;
  const h = window.innerHeight * pr;
  quadMat.uniforms.uResolution.value.set(w, h);
  pMat.uniforms.uResolution.value.set(w, h);
}
window.addEventListener('resize', onResize);

/* ═══════════════════════════════════════════════════════════
   6.  Render Loop (Fixed Delta Tracking)
   ═══════════════════════════════════════════════════════════ */

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const t = now * 0.001;

  currentScale += (targetScale - currentScale) * 0.02;
  if (currentScale < 0.0005 && targetScale === 0) currentScale = 0;

  const shrink = Math.max(0, 1.0 - Math.pow(currentScale / 1.2, 1.5));

  // 🌌 Majestic full-screen orbit: starts top-right (+0.55, +0.35), drifts downwards across middle and bottom
  const orbitX = 0.58 * shrink;
  const orbitY = 0.38 * shrink;

  const cx = Math.sin(t * 0.14 + 0.75) * orbitX + Math.cos(t * 0.05) * 0.12 * shrink;
  const cy = Math.cos(t * 0.09) * orbitY + Math.sin(t * 0.04) * 0.08 * shrink;
  currentCenter.set(cx, cy);

  const vx = Math.cos(t * 0.14 + 0.75) * 0.14 * orbitX;
  const vy = -Math.sin(t * 0.09) * 0.09 * orbitY;
  currentDriftSpeed = Math.sqrt(vx * vx + vy * vy);

  // ── Supernova shockwave: temporarily boost uDriftSpeed so the disk/particle
  //    orbital speed reads as an outward blast, decaying back to normal over
  //    SUPERNOVA_SHOCKWAVE_SEC. Reuses the existing uniform rather than adding
  //    new shader code.
  if (supernovaActive) {
    const elapsedSec = (now - supernovaStartMs) / 1000;
    const shockProgress = Math.min(elapsedSec / SUPERNOVA_SHOCKWAVE_SEC, 1);
    const shockBoost = (1 - shockProgress) * 6.0; // starts at +6.0, decays to 0
    currentDriftSpeed += shockBoost;
  }

  quadMat.uniforms.uTime.value = t;
  quadMat.uniforms.uScale.value = currentScale;
  quadMat.uniforms.uCenter.value.copy(currentCenter);
  quadMat.uniforms.uDriftSpeed.value = currentDriftSpeed;

  pMat.uniforms.uTime.value = t;
  pMat.uniforms.uScale.value = currentScale;
  pMat.uniforms.uCenter.value.copy(currentCenter);
  pMat.uniforms.uDriftSpeed.value = currentDriftSpeed;

  // ── Hawking Radiation escape energy tick ──
  updateEscapeEnergy(dt);

  renderer.render(scene, camera);
}

animate();