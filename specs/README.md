# Coin Cellar — Specs

> *Delve by night, deal by day.*

This folder is the design and technical reference for **Coin Cellar**, a mobile-first
co-op dungeon-crawling shopkeeper game (a [Recettear](https://en.wikipedia.org/wiki/Recettear:_An_Item_Shop%27s_Tale)-like)
built with Three.js. You crawl a monster cellar for loot at night, sell it across
your display tables by day by **haggling** customers as close to their hidden pay
limit as you dare, and pay off the Guild's escalating debt before it repossesses
your shop.

These documents describe the game **as it is currently built**. Where the
implementation differs from earlier design intent (e.g. the character pipeline),
the docs call it out explicitly.

---

## How to read this

| If you want to… | Start here |
| --- | --- |
| Understand the game as a player/designer | [Game Design](#game-design-documents) |
| Understand the code and systems | [Technical](#technical-documents) |
| Look up an exact number (item price, enemy HP, constant) | [Data Reference](technical/04-data-reference.md) |
| Get the game running | [Build & Deploy](technical/05-build-and-deploy.md) |

---

## Game Design Documents

| # | Document | Covers |
| --- | --- | --- |
| 00 | [Overview & Vision](game-design/00-overview.md) | Pillars, target platform, fantasy, references |
| 01 | [Core Loop](game-design/01-core-loop.md) | Day → night → dungeon → sleep cycle, phases, calendar |
| 02 | [Shop & Haggling](game-design/02-shop-and-haggling.md) | Display slots, customers, buy/sell haggle minigame |
| 03 | [Dungeon & Combat](game-design/03-dungeon-and-combat.md) | Floors, enemies, telegraphs, melee combo, dodge |
| 04 | [Economy & Progression](game-design/04-economy-and-progression.md) | Gold, debt schedule, items, loot tiers, win/lose |
| 05 | [Co-op](game-design/05-coop.md) | Two-player split roles, shared state, room codes |
| 06 | [Controls & UX](game-design/06-controls-and-ux.md) | Input model, context button, HUD, mobile-first design |
| 07 | [Audio & Visual Style](game-design/07-audio-visual.md) | Toon look, procedural audio, VFX, juice |

## Technical Documents

| # | Document | Covers |
| --- | --- | --- |
| 00 | [Architecture](technical/00-architecture.md) | Module map, boot sequence, the three entry points |
| 01 | [Engine & Rendering](technical/01-engine-and-rendering.md) | Renderer, camera, single-scene two-area trick, juice |
| 02 | [Character Generation](technical/02-character-generation.md) | Kenney GLB humans + SDF blob-baked monsters |
| 03 | [Networking](technical/03-networking.md) | PeerJS host-authoritative model, message protocol |
| 04 | [Data Reference](technical/04-data-reference.md) | Items, enemies, archetypes, constants, save format |
| 05 | [Build & Deploy](technical/05-build-and-deploy.md) | Vite setup, scripts, static hosting |
| 06 | [Tooling: Lab & Admin](technical/06-tooling-lab-and-admin.md) | Creature lab, admin catalogue, in-game cheat panel |

---

## At a glance

- **Genre:** Shop-sim + action roguelite-lite (Recettear-like)
- **Platform:** Web (mobile-first, touch + desktop), static build
- **Engine:** Three.js `0.169`, Vite `5.4`, PeerJS `1.5.5`
- **Players:** 1 (auto-haggle) or 2 (peer-to-peer WebRTC, host-authoritative)
- **Session shape:** 15-day debt campaign, ~160s of shop per day
- **No backend:** all state is local; co-op is direct P2P
- **Persistence:** `localStorage` key `coincellar_save_v1`

## Status & known drift

- **Character pipeline is hybrid.** The README describes an all-SDF creature
  pipeline. In the current build, **humans** (player, partner, customers, street
  passersby) are Kenney "Blocky Characters" GLB models, while **dungeon monsters**
  are the SDF blob-bake pipeline. See [Character Generation](technical/02-character-generation.md).
