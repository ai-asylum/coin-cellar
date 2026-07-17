# 07 — Audio & Visual Style

Coin Cellar aims for a **charming, readable toon look** and a **fully procedural
soundscape**, both tuned to run cheaply on phones. The art direction leans on
color, rim light, and juice rather than expensive rendering.

## Visual style

### Toon shading (`src/core/toon.js`)

- **4-step gradient `MeshToonMaterial`** — flat, banded shading with a hand-drawn
  feel.
- **Fresnel rim light** injected into the shader — a bright edge glow that pops
  characters off the dark background.
- **Inverted-hull outline** — a back-faced shell that draws a clean outline and
  works even on skinned/deforming meshes.
- **Blob shadows** — radial-gradient sprites under characters instead of shadow
  maps. Cheap, and enough grounding for the toon look.

### Palette & atmosphere (`src/core/engine.js`)

- Background is a **purple twilight** (`#1a1030`) with distance fog — cozy-but-
  moody, fitting "dive by night."
- **ACES tone mapping**, exposure ~1.05, pixel ratio capped at 2.
- Lighting is a hemisphere ambient (cool) + a warm directional "sun." No shadow
  maps anywhere.

### Light shafts (`src/core/godrays.js`)

Fake volumetric **god rays** — crossed additive trapezoid quads with drifting dust
motes and per-shaft flicker. Used for afternoon sun in the shop and light cracks
in the dungeon ceiling. Pure atmosphere, near-zero cost.

### Item & UI art

- **Item props** are tiny procedural toon meshes (built from Three.js primitives
  in `src/game/items.js`) shown on tables and as dungeon drops.
- **UI icons** come in two flavors (`src/core/icons.js`): CSS-mask-tinted PNG
  glyphs for chrome, and full-color PNGs for merchandise.

## Juice & game feel

Combat and commerce both lean hard on feedback:

- **Hit-stop** — a brief global time-scale dip on impactful hits.
- **Camera shake & directional punch** — weighty hits and finishers push the
  camera.
- **Slash arcs** (`src/game/slash.js`) — additive crescent VFX swept through the
  swing, scaling up on finishers.
- **Particles** (`src/game/particles.js`) — bursts on hits, footsteps, loot
  pickups, and sale flourishes.
- **Squash & spring** — characters squash/stretch via springs; heads lag turns.
- **Combo escalation** — chained Perfect deals ramp the audio/visual payoff.

## Audio (`src/core/audio.js`)

100% **procedural WebAudio synth** — no audio files ship with the game.

- **Two generative music moods:** a bright pentatonic **shop** theme and a minor
  drone **dungeon** theme, crossfading with the area.
- **Named SFX** synthesized on the fly: coin, sale, perfect, deny, haggle, swing,
  hit, crit, finisher, dodge, telegraph, shoot, chest, heal, stairs, gameover,
  victory, and more.
- **Lazy init** on first user interaction (browser autoplay policy).
- **Mute** is toggleable and persisted to `localStorage` (`ss_mute`).

## Why procedural everywhere

The recurring theme — procedural dungeons, procedural item meshes, procedural
audio, SDF monsters, blob shadows — keeps the download tiny, the memory footprint
low, and the device happy, while still delivering a distinctive, cohesive look and
sound. The main authored assets are the CC0 Kenney human character pack and the
UI/item icon PNGs (see [Character Generation](../technical/02-character-generation.md)
and [Data Reference](../technical/04-data-reference.md)).
