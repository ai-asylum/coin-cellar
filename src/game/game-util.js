// Pure helpers + tiny constants shared across the game director modules. Leaf
// module: imports nothing from the other game-* modules, so it can be pulled in
// anywhere without risking an ES-module cycle.

// Cross-browser fullscreen helpers (touch play runs fullscreen).
export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
export function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
  if (!fn) return;
  try {
    const r = fn.call(el);
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {}
}

// classic ease-out-back: overshoots past 1 then settles, giving the pop-in snap
export function _easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export const _snap = { x: 0, z: 0, h: 0 };
const SNAP_DELAY = 0.1; // s of interpolation buffer to absorb packet jitter

// Interpolate a snapshot buffer [{t,x,z,h}] into `_snap` at a render time
// slightly behind now, so remote/lobby avatars glide instead of teleporting
// between the ~8-11 Hz position packets. Returns false only when the buffer
// is empty; clamps to the newest sample (no extrapolation) when it runs dry.
export function sampleSnaps(buf) {
  const n = buf.length;
  if (!n) return false;
  const renderT = performance.now() / 1000 - SNAP_DELAY;
  const first = buf[0];
  const last = buf[n - 1];
  if (renderT <= first.t) {
    _snap.x = first.x; _snap.z = first.z; _snap.h = first.h;
    return true;
  }
  if (renderT >= last.t) {
    _snap.x = last.x; _snap.z = last.z; _snap.h = last.h;
    return true;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = buf[i], b = buf[i + 1];
    if (renderT <= b.t) {
      const span = b.t - a.t;
      const k = span > 1e-6 ? (renderT - a.t) / span : 0;
      _snap.x = a.x + (b.x - a.x) * k;
      _snap.z = a.z + (b.z - a.z) * k;
      _snap.h = lerpAngle(a.h, b.h, k);
      return true;
    }
  }
  _snap.x = last.x; _snap.z = last.z; _snap.h = last.h;
  return true;
}

// Friend names are player-supplied — escape them before dropping into markup.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// One shared layout per UTC day for the whole 1‑12 descent: every client that
// delves today generates the identical stack of floors from this base seed,
// without exchanging a single message.
export function utcDay() {
  return Math.floor(Date.now() / 86400000);
}
export function daySeed() {
  return utcDay() * 8191 + 5;
}

// small stable hash for picking a lobby avatar's look from its session id
export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
