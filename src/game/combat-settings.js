// Combat input tuning — the "how does attacking work" knobs. Combat is always a
// single action (there's no combo system): every mode boils down to ONE strike.
// What differs is how that strike is triggered. The admin panel (` key) writes
// these live and POSTs them to /api/combat-settings, which the dev server folds
// back into src/game/combat-settings.json (see vite.config.js) — same shape as
// layout.json / dungeon-tuning.json, statically imported so a save is picked up
// on the next reload. `combat` is the single live, mutable source of truth: the
// game (game.js / game-combat.js) and the joystick (core/input.js) both read it.
import saved from "./combat-settings.json";

// The pickable attack schemes. `id` is what lands in combat.attackMode; the
// label/desc feed the admin panel's mode picker. Order = display order.
export const ATTACK_MODES = [
  {
    id: "autodash",
    label: "Auto lunge",
    desc: "No button. The hero auto-lunges at any foe that steps inside range (cooldown-gated).",
  },
  {
    id: "joystickButton",
    label: "Tap to strike",
    desc: "While a foe is in range, the middle of the move joystick becomes a tap-to-strike button (2nd finger) — the hero plants and strikes in place, no lunge.",
  },
  {
    id: "strikeInPlace",
    label: "Auto strike",
    desc: "No button, no lunge — when a foe steps into range the hero plants and swings in place (same strike as Tap to strike).",
  },
];

// Which sliders an editor (the in-game ` panel and the /admin Combat tab) shows
// for each attack mode; the "dash" default has no knobs. `key` indexes into
// combat[mode]; the rest bound the range input.
export const COMBAT_SLIDERS = {
  autodash: [
    { key: "range", label: "Trigger range", min: 1, max: 5, step: 0.1 },
    { key: "cooldown", label: "Cooldown (s)", min: 0.2, max: 1.5, step: 0.05 },
    { key: "lungeTime", label: "Lunge time (s)", min: 0.1, max: 0.4, step: 0.01 },
    { key: "lungeDist", label: "Lunge travel", min: 0.5, max: 2.5, step: 0.05 },
    { key: "knockback", label: "Knockback (units)", min: 0, max: 4, step: 0.1 },
  ],
  // joystickButton has no knobs of its own: it fires the strike-in-place attack,
  // and both the button-appears reach and the swing reach are governed by the
  // strikeInPlace.range slider below (kept in one place so they never diverge).
  strikeInPlace: [
    { key: "range", label: "Strike reach", min: 1, max: 4, step: 0.1 },
    { key: "cooldown", label: "Cooldown (s)", min: 0.15, max: 2, step: 0.05 },
    { key: "windup", label: "Wind-up (s)", min: 0, max: 1.5, step: 0.05 },
  ],
  swipe: [
    { key: "flick", label: "Flick speed", min: 0.4, max: 2.5, step: 0.05 },
    { key: "range", label: "Aim range", min: 1, max: 5, step: 0.1 },
  ],
};

// Code-defined baseline — the saved JSON is folded over this at load, so a
// partial/older file still boots with every knob present.
const DEFAULTS = {
  attackMode: "autodash",
  distanceMultiplier: 1,
  // lungeTime/lungeDist shape the auto-lunge's burst; knockback is the DISTANCE
  // (world units) a struck foe travels, converted to an impulse where applied.
  // The cooldown counts from the end of the swing, not the trigger.
  autodash: { range: 3.0, cooldown: 0.8, lungeTime: 0.16, lungeDist: 0.9, knockback: 3 },
  joystickButton: { range: 3.2 },
  strikeInPlace: { range: 2.2, cooldown: 0.7, windup: 0.5 },
  swipe: { flick: 1.1, range: 3.2 },
};

function fold(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      out[k] = fold(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

// The live settings object every consumer reads. Mutated in place by the admin
// panel (so a mode switch takes effect the same frame) and reset via
// setCombatSettings; never reassigned, so imported references stay valid.
export const combat = fold(DEFAULTS, saved);

export function attackMode() {
  return combat.attackMode;
}

// Overwrite the live settings in place from a (partial) patch — used by the
// admin panel as sliders/toggles change so the game reacts immediately.
export function setCombatSettings(patch) {
  const merged = fold(combat, patch);
  for (const k of Object.keys(combat)) delete combat[k];
  Object.assign(combat, merged);
  return combat;
}

// Persist the current settings to disk via the dev server. No-op-friendly:
// resolves false if the endpoint isn't there (production build), so callers can
// still toggle modes for the session without a backend.
export async function saveCombatSettings() {
  try {
    const res = await fetch("/api/combat-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(combat, null, 2),
    });
    return res.ok;
  } catch {
    return false;
  }
}
