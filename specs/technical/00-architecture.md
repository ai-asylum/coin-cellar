# 00 — Architecture

Coin Cellar is a client-only ES-module web app. No backend, no bundled game
server — co-op is direct peer-to-peer. This document maps the modules and the boot
flow.

## Tech stack

| Concern | Choice | Version |
| --- | --- | --- |
| 3D | Three.js | `^0.169.0` |
| Networking | PeerJS (WebRTC) | `^1.5.5` |
| Build/dev | Vite | `^5.4.0` |
| UI | DOM + CSS | (no framework) |
| Audio | WebAudio (procedural) | — |
| Persistence | `localStorage` | — |

`package.json` is intentionally tiny: two runtime deps (`three`, `peerjs`) and one
dev dep (`vite`).

## Three entry points

The app is a Vite **multi-page** build with three independent HTML pages that
share the same source modules (so tools can't drift from the game):

| Page | Entry HTML | Entry JS | Purpose |
| --- | --- | --- | --- |
| **Game** | `index.html` | `src/main.js` | The actual game |
| **Lab** | `lab.html` | `src/lab.js` | SDF creature style zoo |
| **Admin** | `admin/index.html` | `src/admin/admin.js` | Read-only data catalogue |

See [Tooling: Lab & Admin](06-tooling-lab-and-admin.md) for the latter two.

## Module map

```
src/
├── main.js              # Game boot entry
├── lab.js               # Creature lab entry
├── style.css            # Global + HUD styles
│
├── core/                # Engine-level, game-agnostic systems
│   ├── engine.js        # Renderer, render loop, camera, rng, Spring, math utils
│   ├── input.js         # Keyboard + virtual joystick + mouse aim
│   ├── audio.js         # Procedural WebAudio synth + generative music
│   ├── toon.js          # Toon material, fresnel rim, outline shell, blob shadow
│   ├── godrays.js       # Fake volumetric light-shaft VFX
│   └── icons.js         # UI icon registry (mask PNG + SVG)
│
├── chargen/             # Character generation
│   ├── assets.js        # Kenney GLB loader + variant cache
│   ├── blocky.js        # BlockyCreature (player, partner, customers)
│   ├── creature.js      # SDF Creature wrapper (mesh+skeleton+face+shadow)
│   ├── species.js       # SDF creature recipes (humanoid, skitter, slime, wisp…)
│   ├── bake.js          # Marching-cubes polygonization → SkinnedMesh
│   ├── sdf.js           # SDF primitives + polynomial smooth-min
│   ├── animator.js      # Procedural gait/hop/float/ragdoll brains
│   └── portrait.js      # Offscreen PNG snapshots of characters for the UI
│
├── game/                # Gameplay
│   ├── game.js          # Director: loop, economy, combat glue, co-op handling
│   ├── shop.js          # Shop room, customers, haggling, A* nav
│   ├── dungeon.js       # Procedural floors, enemies, chests, combat AI
│   ├── items.js         # ITEMS registry, LOOT_BY_TIER, procedural prop meshes
│   ├── hud.js           # DOM HUD, haggle UI, day clock, floaties
│   ├── particles.js     # Particle burst system
│   ├── projectile.js    # Pooled enemy projectiles
│   └── slash.js         # Melee swoosh VFX
│
├── net/
│   └── coop.js          # PeerJS host-authoritative sync
│
└── admin/
    ├── admin.js         # Standalone catalogue browser
    └── admin.css        # Admin page styles
```

## Layering & dependencies

The rough dependency direction is:

```
main.js
  └─ Game (game/game.js)              ← the director owns everything
       ├─ Engine   (core/engine.js)   ← renderer + loop + camera
       ├─ Input    (core/input.js)
       ├─ AudioBus (core/audio.js)
       ├─ HUD      (game/hud.js)
       ├─ Shop     (game/shop.js)  ─┐
       ├─ Dungeon  (game/dungeon.js)├─ use chargen/*, items.js, particles, slash
       ├─ Coop     (net/coop.js)   ─┘
       └─ chargen/* (BlockyCreature for the player)
```

`core/*` modules are game-agnostic (an engine could exist without the shop). The
`game/*` modules encode Coin Cellar's rules. `chargen/*` is a self-contained
character factory used by both the game and the tools.

## Boot sequence (`src/main.js`)

1. Show a **loading screen** while Kenney GLB characters preload
   (`loadCharacters()` in `chargen/assets.js`).
2. Construct the core services: `Engine`, `HUD`, `Input`, `AudioBus`.
3. Construct the `Game` director, wiring the services together.
4. Start the render loop.
5. Expose `window.__game` for debugging.

## State ownership

- **Game state** (day, gold, hp, inventory, debt index, phase, area) lives on the
  `Game` instance.
- **Persistence:** serialized to `localStorage` under `coincellar_save_v1`
  (host-only in co-op). See [Data Reference](04-data-reference.md#save-format).
- **Authoritative in co-op:** the host's `Game` is the source of truth; guests
  mirror it. See [Networking](03-networking.md).

## Rendering model in one line

One scene, two areas: the **shop** is at the world origin and the **dungeon** is
built at an offset (`DUNGEON_ORIGIN = (200, 0, 0)`); switching areas reframes the
camera rather than swapping scenes. See
[Engine & Rendering](01-engine-and-rendering.md).
