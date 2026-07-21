# 00 — Architecture

Coin Cellar is a client-only ES-module web app. The game itself needs no
backend — saves are local, co-op is peer-to-peer; two optional services hang
off the side (Supabase Realtime for the shared-world lobby, PostHog for
analytics). This document maps the modules and the boot flow.

## Tech stack

| Concern | Choice | Version |
| --- | --- | --- |
| 3D | Three.js | `^0.169.0` |
| Co-op networking | PeerJS (WebRTC) | `^1.5.5` |
| Shared-world lobby | @supabase/supabase-js (Realtime) | `^2.110` |
| Analytics | posthog-js | `^1.399` |
| Android shell | Capacitor | `^8.4` |
| Build/dev | Vite | `^5.4.0` |
| UI | DOM + CSS | (no framework) |
| Audio | WebAudio (MP3 music + procedural SFX) | — |
| Persistence | `localStorage` | — |

## Five entry points

A Vite **multi-page** build; the tools import the same source modules as the
game, so they can't drift from real data:

| Page | Entry | Purpose |
| --- | --- | --- |
| **Game** | `index.html` → `src/main.js` | The actual game |
| **Lab** | `lab.html` → `src/lab.js` | SDF creature style zoo |
| **Admin** | `admin/index.html` → `src/admin/admin.js` | Read-only data catalogue |
| **Editor** | `editor.html` → `src/editor/editor.js` | Overworld / cave / dungeon world editor |
| **Cooking** | `cooking.html` → `src/cooking/main.js` | Standalone kitchen prototype (own save + own Supabase project) |

(`minigame/*.html` are unwired haggle-mechanic prototypes, outside the build.)

## Module map

```
src/
├── main.js                  # Game boot + start menu + New Game flow
├── lab.js / style.css
│
├── core/                    # Engine-level, game-agnostic
│   ├── engine.js            # Renderer, loop, camera, rng, Spring, math
│   ├── input.js             # Keyboard + virtual joystick + mouse aim
│   ├── audio.js             # MP3 music moods + procedural SFX synth
│   ├── toon.js              # Toon material, rim, outline, blob shadow
│   ├── godrays.js           # Fake volumetric light shafts
│   ├── icons.js             # UI icon registry
│   └── analytics.js         # PostHog wrapper (track())
│
├── chargen/                 # Character factory
│   ├── assets.js/blocky.js/portrait.js   # Kenney GLB humans
│   ├── species.js/sdf.js/bake.js/creature.js/animator.js  # SDF monsters
│   └── voxel/               # Voxel farm-animal rigs (admin Farm tab only)
│
├── game/
│   ├── game.js              # Director (state + per-frame tick)
│   ├── game-combat.js       # Player strike/dash/damage/death
│   ├── game-dungeon-flow.js # Delve/descend/return/shortcuts/boss flow
│   ├── game-economy.js      # Sales, repairs, lot restores, builder hire
│   ├── game-narrative.js    # FTUE, NPC talk, cameos
│   ├── game-net.js          # onNetMessage + lobby glue
│   ├── game-persistence.js  # Save/load
│   ├── game-ui.js           # Sheets, store panel, cheat panel
│   ├── shop.js / shop-build.js / shop-customers.js / shop-data.js
│   │                        # Room+lighting / furniture / shopper AI / tuning
│   ├── shop-pathfinding.js  # A* nav grid
│   ├── dungeon.js / dungeon-geometry.js / dungeon-data.js
│   ├── dungeon-ai.js / dungeon-combat.js / dungeon-assets.js
│   ├── cave.js              # Permanent hub with the 4 dungeon mouths
│   ├── decor.js             # Billboard decor + forage/smash loot
│   ├── builder.js / dojo.js # Town characters with day jobs
│   ├── npc-data.js          # 17 NPCs, personalities, ~600 lines of dialogue
│   ├── items.js / gear.js   # ITEMS registry + equipment stats/gating
│   ├── layout.json          # Town layout (authored via /editor.html)
│   ├── dungeon-tuning.json / combat-settings.js|json
│   ├── hud.js / particles.js / projectile.js / slash.js
│   └── layout-store.js      # Layout injection point for the editor
│
├── net/
│   ├── coop.js              # PeerJS host-authoritative co-op
│   └── lobby.js             # Supabase Realtime shared-world presence
│
├── editor/                  # editor.js + cave-preview.js + dungeon-preview.js
├── admin/                   # admin.js catalogue
└── cooking/                 # Standalone kitchen (own save, own backend)
```

**The director pattern:** `game.js` holds state and the frame tick; the
behavior lives in the `game-*.js` mixins merged onto `Game.prototype` via
`Object.assign`. When hunting a feature, grep the mixin names first.

## Boot sequence (`src/main.js`)

1. `initAnalytics()` (module top).
2. Loading screen while **Kenney GLBs** and the **dungeon GLTF kit** preload.
3. Construct `Engine`, `HUD`, `Input`, `AudioBus`, then `Game` with
   `titleAttract: true` — the render loop starts **behind the menu**, hero
   wandering town in attract mode.
4. `startMenu()`: logo + Play (+ **New Game** with confirm, only when a save
   exists). Play on touch devices requests fullscreen.
5. `track("game_started")` → `game.startPlay()`. `window.__game` is exposed
   for debugging. A service worker caches the build (PROD only; dev
   unregisters it).

## State ownership

- **Game state** (gold, hp, bag, stash, stock, equipment, town, shortcuts)
  lives on the `Game` instance; persisted to
  `localStorage["coincellar_save_v1"]` (host-only in co-op) — see the
  [Data Reference](04-data-reference.md#save-format).
- **Authoritative in co-op:** the host's `Game`; guests mirror
  ([Networking](03-networking.md)).
- **Design data** is split between code tables (`items.js`,
  `dungeon-data.js`, `npc-data.js`) and JSON tuned by tools (`layout.json`,
  `dungeon-tuning.json`, `combat-settings.json` — written through dev-server
  endpoints, see [Build & Deploy](05-build-and-deploy.md)).

## Rendering model in one line

One scene, **three areas** by world offset: the shop/town at the origin, the
dungeon at `(200, 0, 0)`, the cave hub at `(−200, 0, 200)` — switching areas
reframes the camera, never swaps scenes. See
[Engine & Rendering](01-engine-and-rendering.md).
