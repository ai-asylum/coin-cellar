# 06 — Tooling: Lab, Admin & Cheats

Coin Cellar ships two standalone dev tools plus an in-game cheat panel. All three
**import the same source modules the game uses**, so they can't drift from real
game data.

## Creature Lab (`lab.html` + `src/lab.js`)

A visual style zoo / regression harness for the **SDF creature pipeline** (dungeon
monsters — not the Kenney human characters).

- A parade of every species marching in a circle.
- Controls:
  - **Reroll** — new random seeds for all creatures.
  - **Ragdoll** — trigger the verlet death simulation on everything.
  - **March** — toggle movement on/off.
- **Solo preview:** `?solo=<species>` isolates one creature. Valid values include
  `hero`, `customer`, `goblin`, `brute`, `skitter`, `slime`, `wisp`.

Use it to eyeball baking, skinning, gaits, and ragdolls without launching the whole
game. See [Character Generation](02-character-generation.md#part-b--sdf-blob-bake-pipeline-monsters).

Dev URL: `http://localhost:5173/lab.html`.

## Admin Catalogue (`admin/index.html` + `src/admin/admin.js`)

A **read-only data browser** that renders every game data table with live 3D
previews. Because it imports `ITEMS`, `ENEMY_KINDS`, `FLOOR_MIX`, `ARCHETYPES`,
`CHAR_VARIANTS`, etc. directly, it's always in sync with the game.

Tabs:

| Tab | Source | Shows |
| --- | --- | --- |
| Merchandise | `ITEMS` (`items.js`) | Every item + live procedural prop preview |
| Monsters | `ENEMY_KINDS` (`dungeon.js`) | Each enemy + live SDF creature preview |
| Shoppers | `ARCHETYPES` (`shop.js`) | Customer archetypes + blocky previews |
| Cast | `CHAR_VARIANTS` (`assets.js`) | All 18 Kenney variants + the hero |
| Dungeon | `FLOOR_MIX` (`dungeon.js`) | Floor enemy mixes + tile color swatches |

**Rendering trick:** a single shared WebGL renderer draws every card via
scissor-test rectangles, instead of one WebGL context per card — this avoids the
browser's per-page context limit.

Dev URL: `http://localhost:5173/admin/`.

### Known gap

`ENEMY_META` in `admin.js` documents **5** enemy kinds, but `ENEMY_KINDS` has **6**
(`archer` was added later). The archer still renders (it iterates `ENEMY_KINDS`),
but falls back to placeholder metadata (name/icon/description). Fixing means adding
an `archer` entry to `ENEMY_META`.

## In-game admin / cheat panel

Separate from the standalone catalogue: pressing the **backquote** key (`` ` ``)
toggles a live dev overlay **while the game keeps running**. Handy for testing
economy and combat states quickly.

Actions (from the `switch` in `game.js`):

| Action | Effect |
| --- | --- |
| `g100` / `g1k` | +100 / +1000 gold |
| `heal` | Full heal |
| `maxhp` | +1 max heart |
| `god` | Toggle god mode (invulnerable) |
| `fillbag` / `clearbag` | Fill / empty the inventory |
| `night` | Skip to nightfall |
| `nextday` | Advance the calendar |
| `delve` | Enter the dungeon |
| `floor` | Go to the next floor |
| `kill` | Kill all enemies on the floor |
| `debt` | Skip the current debt payment |
| `reset` | Wipe the save |

These are developer conveniences; they're not part of the intended player
experience but ship in the build behind the backquote key.
