/**
 * Global wind state — single source of truth for environmental wind that any
 * prop rig, particle system, grass shader, or future physics layer can
 * consume. Wind has a horizontal direction (XZ plane), a strength, and a
 * procedural gust envelope that pulses everything in lockstep so a forest of
 * trees, a windmill, and the grass under them all surge at the same moments.
 *
 * Direction convention: (dirX, dirZ) is the unit vector wind blows TOWARD.
 *   dirX = 1, dirZ = 0    →  wind from -X side, blowing toward +X
 *   dirX = 0, dirZ = 1    →  wind from -Z side, blowing toward +Z
 *
 * No altitude variation, no per-position sampling for the MVP — one wind,
 * everywhere. A future per-position sampler can replace the accessors
 * without changing rig contracts: rigs query getWind() each frame and don't
 * cache, so swapping the implementation is invisible to them.
 *
 * The clock is real-time (performance.now() since module load) and isn't
 * paused with the game loop. That's a deliberate trade for the MVP: visual
 * wind animations don't need to honor pause, and not requiring an outside
 * tick keeps the prop viewer and headless rig tests trivially correct.
 */

let _state = {
  // Default: a light breeze blowing roughly toward +X with a Z lean. Values
  // are stored unnormalized so callers can poke (1, 1) without first having
  // to compute lengths; getWind() returns it normalized.
  dirX: 0.85,
  dirZ: 0.3,
  strength: 1.0
}

const _epoch = (typeof performance !== 'undefined') ? performance.now() : Date.now()

function nowSeconds() {
  const t = (typeof performance !== 'undefined') ? performance.now() : Date.now()
  return (t - _epoch) / 1000
}

/**
 * Current wind state. Direction is unit-length; strength is non-negative.
 * Returns a fresh object — consumers may stash it for the duration of one
 * frame's update.
 */
export function getWind() {
  const len = Math.hypot(_state.dirX, _state.dirZ) || 1
  return {
    dirX: _state.dirX / len,
    dirZ: _state.dirZ / len,
    strength: Math.max(0, _state.strength)
  }
}

/**
 * Patch the global wind state. Any field omitted is left unchanged. Direction
 * is stored as-given (the normalization happens on read), so callers can
 * poke a heading without worrying about magnitude.
 *
 *   setWind({ strength: 0 })           // calm
 *   setWind({ dirX: 0, dirZ: -1 })     // wind blowing toward -Z
 *   setWind({ strength: 2.4 })         // double-strength gusts
 */
export function setWind(patch = {}) {
  if (typeof patch.dirX === 'number' && Number.isFinite(patch.dirX)) {
    _state.dirX = patch.dirX
  }
  if (typeof patch.dirZ === 'number' && Number.isFinite(patch.dirZ)) {
    _state.dirZ = patch.dirZ
  }
  if (typeof patch.strength === 'number' && Number.isFinite(patch.strength)) {
    _state.strength = Math.max(0, patch.strength)
  }
}

/**
 * Procedural gust envelope at the current real-time clock. Returns a value
 * around 1.0 with roughly [0.45, 1.45] excursions, modeling natural wind
 * pulsing through a landscape. Pass `phase` (e.g. a hashed entity id) to
 * scramble per-entity so two adjacent windmills don't lock to identical
 * pulses, while still tracking the same overall global cycle.
 *
 * Two incommensurate sines (0.7 and 1.9 rad/s) prevent the envelope from
 * ever stalling at exactly the resting value, so wind never visibly goes
 * "off"; consumers that want a true zero ride the strength field to 0
 * instead.
 */
export function windGust(phase = 0) {
  const t = nowSeconds()
  return 0.95 + 0.35 * Math.sin(t * 0.7 + phase) + 0.15 * Math.sin(t * 1.9 + phase * 0.6 + 0.4)
}

/**
 * Real-time clock in seconds since module load. Exposed so consumers (rigs,
 * shaders, gusty audio) can drive their own oscillators on the same wall
 * clock the gust envelope uses, keeping everything phase-locked to one
 * global wind cycle.
 */
export function windTime() {
  return nowSeconds()
}

/**
 * Hash a stable entity id (string or number) into a phase in [0, 2π). Used
 * by wind-driven rigs so two trees / two windmills with the same natural
 * frequency drift visibly out of step rather than animating in lockstep.
 *
 * FNV-1a 32-bit, then folded to a unit float and scaled. Stable across
 * sessions for a given id, which matters for multiplayer parity once wind
 * propagates to the server.
 */
export function windPhaseFromId(id) {
  const s = String(id ?? '')
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h / 0xffffffff) * Math.PI * 2
}
