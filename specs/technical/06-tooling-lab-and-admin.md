# 06 — Tooling: Editor, Lab, Admin & Cheats

Coin Cellar ships three standalone dev tools plus an in-game cheat panel. All
of them **import the same source modules the game uses**, so they can't drift
from real game data.

## World Editor (`editor.html` + `src/editor/`)

The design-data workbench — three tabs:

- **Overworld** — free-fly camera over the real town build, fed a live copy
  of `layout.json`: move/repair-cost display tables and the vitrine, place
  street decor billboards, edit the 8 restoration lots (before/after
  geometry, cost, resident). **Ctrl+S** POSTs to the dev endpoint
  `/api/layout`, which pretty-prints back into `src/game/layout.json`.
- **Cave** — the hub layout: mouth cells, exit, spawn (`cave-preview.js`).
- **Dungeon** — drives the *real* dungeon generator against a stub game and
  exposes the live tuning tables (`GEN`, `GEN_BY_FLOOR`, `HOLE_THEMES`,
  `DUNGEON_MIX`, `ENEMY_KINDS`, `BOSSES`). Regenerate with new seeds, then
  **Ctrl+S** ("Save tuning") → `/api/dungeon-tuning` →
  `src/game/dungeon-tuning.json`, or **Copy tuning JSON** to the clipboard.
  The game overlays that JSON onto its tables at load.

The game imports `layout.json` statically; the editor fetches through the dev
endpoint and injects via `layout-store.js` — that indirection is what keeps
Vite from hot-reload-looping the whole game while you drag furniture.

## Creature Lab (`lab.html` + `src/lab.js`)

A style zoo / regression harness for the **SDF monster pipeline**: a parade
of every species marching in a circle, with **Reroll** (new seeds),
**Ragdoll** (verlet death sim on everything), and **March** toggles.
`?solo=<species>` isolates one creature. Use it to eyeball baking, skinning,
gaits, and ragdolls without launching the game.

## Admin Catalogue (`admin/index.html` + `src/admin/admin.js`)

A **read-only data browser** with live 3D previews (one shared WebGL renderer
scissor-drawing every card, to dodge the per-page context limit). Eleven
tabs: **Merchandise**, **Loot**, **Monsters** (incl. bosses), **Shoppers**,
**Townsfolk** (with sub-tabs for small talk / intros / tastes / reflections /
occasions / deeds), **Cast**, **Farm** (the voxel farm-animal viewer),
**Dungeon**, **Town**, **Primitives**, **Combat**.

## In-game cheat panel

Backquote (`` ` ``) toggles a live dev overlay while the game runs
(`game-ui.js` `_adminAction`):

| Action | Effect |
| --- | --- |
| `g100` / `g1k` | +100 / +1,000 gold |
| `heal` / `maxhp` / `god` | Full heal / +1 max heart / god mode |
| `fillbag` / `stockshelves` / `clearbag` | Inventory setups |
| `delve` / `floor` / `tpexit` / `key` / `kill` | Dungeon: enter / next floor / to exit / Brass Key / clear floor |
| `tut:<step>` | Jump the FTUE (cave/road/stock/sell/delve) |
| `cmode:<id>` | Switch the combat input mode |
| `godrays` / `npcdbg` / `clocklive` | Toggles |
| `reset` | Wipe the save |

Plus a **time-of-day slider** (sets `debugHour` — overrides the real-clock
lighting), an **occasion** dropdown (force holiday dialogue), and the
**combat sliders** persisted through `/api/combat-settings`.

These ship in the build behind the backquote key; they're developer
conveniences, not player surface.
