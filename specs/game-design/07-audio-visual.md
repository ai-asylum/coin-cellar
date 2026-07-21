# 07 — Audio & Visual Style

Coin Cellar aims for a **charming, readable toon look**, tuned to run cheaply
on phones. The art direction leans on color, rim light, and juice rather than
expensive rendering.

## Visual style

### Toon shading (`src/core/toon.js`)

- **4-step gradient `MeshToonMaterial`** — flat, banded shading with a
  hand-drawn feel. (Always create these via `makeToonMaterial` — three r169's
  program cache keys omit `gradientMap`, so ad-hoc ramp-less toon materials
  can compile against the wrong shader and go near-black.)
- **Fresnel rim light** injected into the shader — a bright edge glow.
- **Inverted-hull outline** — a back-faced shell that works on skinned,
  deforming meshes.
- **Blob shadows** — radial-gradient sprites under characters instead of
  shadow maps.

### Palette & atmosphere

- Base background is a **purple twilight** (`#1a1030`) with distance fog —
  but above ground the sky, fog, lamps, and shafts now **follow the real
  clock**: a 24-hour keyframe palette (`DAY_CLOCK` in `shop.js`) interpolated
  from the system time. Morning is golden, midday holds a bright plateau
  (~10:00–16:30), night kindles the street lamps. Underground keeps a fixed
  torchlit palette.
- **ACES tone mapping**, exposure 1.05, pixel ratio capped at 2.
- Lighting is a hemisphere ambient + a warm directional sun + a subtle
  hero-following torch point light. No shadow maps anywhere.

### Light shafts (`src/core/godrays.js`)

Fake volumetric **god rays** — crossed additive trapezoid quads with drifting
dust motes and per-shaft flicker. Afternoon sun in the shop, colored dungeon
mouths in the cave, light cracks in dungeon ceilings. Near-zero cost,
toggleable from the cheat panel.

### Item, decor & UI art

- **Item props** are tiny procedural toon meshes (`items.js` makers) shown on
  tables and as drops.
- **Dungeon dressing** mixes procedural geometry with a small GLTF kit
  (barrels, crates, pillars) and billboard decor sprites (trees, mushrooms,
  bones) tinted per dungeon theme.
- **UI icons**: CSS-mask-tinted PNG glyphs for chrome, full-color PNGs for
  merchandise.

## Juice & game feel

- **Hit-stop** — a brief global time-scale dip on impactful hits.
- **Camera shake & directional punch.**
- **Slash arcs** (`slash.js`) and **particles** (`particles.js`) on hits,
  smashes, loot pickups, sale flourishes, and house builds.
- **Squash & spring** — characters squash/stretch via springs; heads lag
  turns.
- **Combo escalation** — chained Perfect deals ramp the payoff.
- **The boss death sequence** — charring, fog ingest, staggered mesh pops,
  white flash — is the juice showcase (see
  [Dungeon & Combat](03-dungeon-and-combat.md#bosses-one-per-dungeon)).

## Audio (`src/core/audio.js`)

Audio is a **hybrid**: authored music, procedural everything else.

- **Music is real MP3s** (`public/music/`, 11 tracks) decoded to buffers for
  gapless loops with crossfades. Five moods — `menu`, `shop`, `town`,
  `dungeon`, `boss` — and the above-ground moods carry **morning / day /
  night variants** chosen by the real clock.
- **SFX are 100% procedural WebAudio synth** — ~30 named sounds built from
  oscillators and filtered noise: coin, sale, perfect, swing, hit, crit,
  finisher, dodge, telegraph, shoot, hammer, chest, heal, stairs, victory…
- **Lazy init** on first user interaction (autoplay policy).
- **Mute** toggles with `M` and persists (`localStorage["ss_mute"]`).

## Why procedural (mostly) everywhere

Procedural dungeons, item meshes, SFX, SDF monsters, and blob shadows keep the
download small and the device happy while staying cohesive. The authored
assets are deliberate exceptions: the CC0 Kenney character pack (humans read
better authored), the music (mood beats synthesis), the decor billboards, and
the dungeon prop kit. See
[Character Generation](../technical/02-character-generation.md) and the
[Data Reference](../technical/04-data-reference.md).
