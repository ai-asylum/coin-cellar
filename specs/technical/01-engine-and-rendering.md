# 01 — Engine & Rendering

The engine layer (`src/core/`) is a thin, game-agnostic wrapper around Three.js:
renderer, render loop, camera control, math/RNG utilities, and the "juice"
primitives (hit-stop, shake, springs). This document covers rendering and the
core loop; visual style specifics are in the design doc
[Audio & Visual Style](../game-design/07-audio-visual.md).

## Renderer (`core/engine.js`)

- **`WebGLRenderer`** with **ACES Filmic** tone mapping, exposure ~1.05.
- **Pixel ratio capped at 2** — retina-crisp without murdering fill rate on high-DPI
  phones.
- **Scene** background is a purple twilight (`#1a1030`) with linear **fog**
  (~20–52 units) for depth and to hide the dungeon that lives far off in the same
  scene.
- **Lighting:** a hemisphere light (cool ambient sky/ground) + a warm directional
  "sun." **No shadow maps** — grounding is done with blob-shadow sprites
  (`core/toon.js`).

## Camera

A single perspective camera (~46° FOV) framed differently per area:

| Area | Behavior | Offset (approx) |
| --- | --- | --- |
| Shop | Fixed framing over the shop room | `(0, 10.2, 8.6)` looking at origin |
| Dungeon | Follows the player | `(0, 8.4, 8.2)` trailing the player |

Switching areas snaps/reframes the camera (`_snapCamera()`); it doesn't reload a
scene.

## Single scene, two areas

The most important structural trick: **the shop and the dungeon coexist in one
`THREE.Scene`.**

- The shop is built around the **world origin**.
- The dungeon is built inside a group offset to **`DUNGEON_ORIGIN = (200, 0, 0)`**.
- The player's `playerArea` flag (`"shop"` | `"dungeon"`) drives camera framing and
  which interactions are live.
- Fog + distance mean you never see the "other" area.

This avoids scene-swap hitches and lets both areas animate simultaneously (useful
in co-op when one player shops while the other delves).

**Coordinate note:** dungeon geometry is placed group-local, but **enemies and
colliders live in world space** — so a lot of dungeon code adds `DUNGEON_ORIGIN`
when converting between the two. Chests and fixtures are group-local; enemy AABB
colliders are stored pre-offset into world coordinates. Keep this in mind when
editing dungeon spatial math.

## Render loop & time scaling

The loop advances a scaled delta time so the "juice" systems can bend time:

- **`timeScale`** — hit-stop briefly drops the global time scale on impactful hits,
  then eases back, for a punchy freeze-frame feel.
- **Camera shake** — additive positional/rotational noise that decays.
- **Directional punch** — a one-shot camera shove in a hit's direction.

Gameplay updates (player, shop, dungeon, particles, net) are ticked from the
director each frame with this dt; the dungeon and shop also animate their god-ray
shafts every frame.

## Utilities

`core/engine.js` also exports small shared helpers used across the codebase:

- **`rng(seed)`** — a `mulberry32` seeded PRNG factory (deterministic; the backbone
  of reproducible dungeons and creatures shared across co-op).
- **`pick(rng, arr)`** — seeded random element.
- **`lerp`, `clamp`** — math.
- **`Spring`** — a critically-dampable spring used for squash, head-lag, and other
  springy motion.

## Performance posture

Everything about the renderer is chosen for mobile:

- No shadow maps; blob-shadow sprites instead.
- Capped DPR.
- Instanced dungeon walls.
- Procedural textures (canvas) rather than large image downloads.
- Pooled projectiles/particles to avoid GC churn.

See [Character Generation](02-character-generation.md) for how meshes get built and
[Networking](03-networking.md) for the multiplayer tick.
