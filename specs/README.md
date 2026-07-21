# Coin Cellar — Specs

> *Dive by day or night, deal always.*

This folder is the design and technical reference for **Coin Cellar**, a
mobile-first co-op dungeon-crawling shopkeeper game built with Three.js. You
crawl four monster dungeons for loot, sell it across your display tables
(haggling the prized goods at the vitrine as close to each customer's hidden
pay limit as you dare), and pour the gold into rebuilding the dying town you
inherited.

These documents describe the game **as it is currently built** — the
Recettear-style debt campaign, the 160-second day timer, and the 3-hit combo
documented in earlier revisions are **gone**; the game is now a no-fail,
real-clock town-restoration loop. Where implementation still diverges from
older material, the docs call it out.

---

## How to read this

| If you want to… | Start here |
| --- | --- |
| Understand the game as a player/designer | [Game Design](#game-design-documents) |
| Understand the code and systems | [Technical](#technical-documents) |
| Look up an exact number (item price, enemy HP, constant) | [Data Reference](technical/04-data-reference.md) |
| Get the game running / shipped | [Build & Deploy](technical/05-build-and-deploy.md) |

## Game Design Documents

| # | Document | Covers |
| --- | --- | --- |
| 00 | [Overview & Vision](game-design/00-overview.md) | Pillars, platform, fantasy, the cozy pivot |
| 01 | [Core Loop](game-design/01-core-loop.md) | Dive → deal → build, real-clock world, what `day` means |
| 02 | [Shop & Haggling](game-design/02-shop-and-haggling.md) | Tables vs vitrine, resident customers, haggle grades |
| 03 | [Dungeon & Combat](game-design/03-dungeon-and-combat.md) | Cave hub, 4 dungeons, bestiary, bosses, one-strike combat |
| 04 | [Economy & Progression](game-design/04-economy-and-progression.md) | Gold sources/sinks, items, gear, the soft endgame |
| 05 | [Co-op & Shared World](game-design/05-coop.md) | Split roles, friends/invites, the Supabase lobby |
| 06 | [Controls & UX](game-design/06-controls-and-ux.md) | Input model, context button, HUD, onboarding |
| 07 | [Audio & Visual Style](game-design/07-audio-visual.md) | Toon look, day-clock lighting, MP3 music + synth SFX |
| 08 | [FTUE: "What He Left"](game-design/08-ftue-script-inheritance.md) | The implemented first-run script (+ the superseded [drifter draft](game-design/08-ftue-script.md), kept for its line graveyard) |
| 09 | [Town, NPCs & Building](game-design/09-town-npcs-and-building.md) | 17 townsfolk, dialogue systems, lots, the builder, the dojo |

## Technical Documents

| # | Document | Covers |
| --- | --- | --- |
| 00 | [Architecture](technical/00-architecture.md) | Module map, mixin pattern, boot, five entry points |
| 01 | [Engine & Rendering](technical/01-engine-and-rendering.md) | Renderer, one-scene-three-areas, real-time day clock |
| 02 | [Character Generation](technical/02-character-generation.md) | Kenney GLB humans + SDF monsters (+ parked voxel rigs) |
| 03 | [Networking](technical/03-networking.md) | PeerJS co-op protocol + Supabase Realtime lobby |
| 04 | [Data Reference](technical/04-data-reference.md) | Items, enemies, constants, save format |
| 05 | [Build & Deploy](technical/05-build-and-deploy.md) | Vite, dev endpoints, Vercel, Capacitor/Android, analytics |
| 06 | [Tooling](technical/06-tooling-lab-and-admin.md) | World editor, creature lab, admin catalogue, cheat panel |

Also here: [Playable Ad — 10 Flow Ideas](playable-ad-flows.md) (UA
brainstorm; partially predates the no-debt pivot).

---

## At a glance

- **Genre:** Cozy shop-sim + action roguelite-lite (Recettear roots, Animal
  Crossing temperament)
- **Platform:** Web (mobile-first portrait, touch + desktop) + Android via
  Capacitor; static Vite build on Vercel
- **Engine:** Three.js `0.169`, Vite `5.4`, PeerJS `1.5.5`, Supabase
  Realtime, PostHog
- **Players:** 1–2 (P2P WebRTC co-op, host-authoritative) + a social
  shared-world lobby
- **Session shape:** open-ended; real-clock lighting/dialogue, 3-hour
  dungeon-shortcut windows. **No debt, no timer, no game over.**
- **Persistence:** `localStorage` key `coincellar_save_v1` (host-only in
  co-op)

## Known drift & parked systems

- The repo-root `README.md` still describes the all-SDF character pipeline;
  in the build, humans are Kenney GLBs — see
  [Character Generation](technical/02-character-generation.md).
- **Sellers (reverse haggle)** are implemented but switched off — everyone
  currently buys ([Shop & Haggling](game-design/02-shop-and-haggling.md)).
- **Equipment** beyond swords is gated off pending balance
  ([Economy](game-design/04-economy-and-progression.md#gear-the-other-reward-track)).
- **Cooking** (`/cooking.html`) is a complete standalone prototype — own
  save, own Supabase backend — with no entry point from the main game.
- **Voxel farm animals** (`src/chargen/voxel/`) render only in the admin
  Farm tab; `minigame/*.html` are unwired haggle prototypes.
