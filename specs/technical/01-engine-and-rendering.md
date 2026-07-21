# 01 — Engine & Rendering

The engine layer (`src/core/`) is a thin, game-agnostic wrapper around
Three.js: renderer, render loop, camera, math/RNG utilities, and the "juice"
primitives. Visual style specifics live in
[Audio & Visual Style](../game-design/07-audio-visual.md).

## Renderer (`core/engine.js`)

- **`WebGLRenderer`**, antialias only below DPR 2, `high-performance` power
  preference, **pixel ratio capped at 2**.
- sRGB output, **ACES Filmic** tone mapping, exposure 1.05.
- Scene base: purple twilight `0x1a1030` + linear fog (20–52 units) — both
  retinted every frame above ground by the day clock (below).
- **Lighting:** hemisphere ambient + warm directional sun + a
  hero-following torch `PointLight` on layer 1 (only environment/creatures
  opt in). **No shadow maps** — blob-shadow sprites instead.

## The real-time day clock

Time-of-day lives in **`Shop._updateLighting`** (`src/game/shop.js`), not the
engine: real wall-clock hours (or the cheat panel's `debugHour` override)
sample a 10-stop, 24-hour keyframe palette (`DAY_CLOCK`) via
`sampleDayClock(hour)` — sky/ground/sun/background/shaft colors plus
intensities and a `night` factor that kindles interior and street lamps and
tints decor billboards. Midday holds a bright plateau ~10:00–16:30.
Underground uses a fixed torchlit palette (`DUNGEON_PAL`) with sine-flicker
torches.

## Camera

One perspective camera (46° FOV, 0.1–200):

| Context | Framing |
| --- | --- |
| Shop interior | `fitShopCamera(aspect)` — fits the room, portrait-aware |
| Street / town | offset `(0, 12.6, 9.4)`, bounded by `layout.json` camera block |
| Dungeon & cave | follows the player at `(0, 11.25, 10.98)` |
| Dialogue | eases toward the speakers; face-close for bubbles |

Area switches snap/reframe (`_snapCamera()`); no scene reloads.

## One scene, three areas

The shop/town is built around the **world origin**; the dungeon inside a
group at **`DUNGEON_ORIGIN = (200, 0, 0)`**; the permanent cave hub at
**`CAVE_ORIGIN = (−200, 0, 200)`**. The `playerArea` flag
(`"shop" | "dungeon" | "cave"`) drives camera framing and which interactions
are live; fog + distance hide the other areas. This avoids scene-swap hitches
and lets all areas animate simultaneously (essential in co-op).

**Coordinate note:** dungeon geometry is group-local, but **enemies and
colliders live in world space** — dungeon code adds `DUNGEON_ORIGIN` when
converting. Keep this in mind when editing dungeon spatial math.

## Render loop & time scaling

The loop advances a scaled delta so juice systems can bend time:

- **`timeScale`** — hit-stop dips it briefly on impactful hits.
- **Camera shake** — decaying additive noise.
- **Directional punch** — a one-shot camera shove along a hit.

The director ticks player, shop, dungeon, cave, particles, and net each frame
with this dt.

## Utilities

`core/engine.js` exports the shared helpers: **`rng(seed)`** (mulberry32 —
the backbone of reproducible dungeons/creatures across co-op), `pick`,
`lerp`, `clamp`, and **`Spring`** (squash, head-lag, lid-ease…).

## Performance posture

No shadow maps · capped DPR · instanced dungeon walls · canvas-procedural
textures · pooled projectiles/particles · billboard decor · a cap of 6 lit
god-ray shafts per floor · frustum-gated enemy attacks (off-screen foes hold
their windups).

See [Character Generation](02-character-generation.md) for mesh building and
[Networking](03-networking.md) for the multiplayer tick.
