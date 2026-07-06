# 04 — Data Reference

The authoritative source-of-truth tables, transcribed from the code. When a number
here disagrees with the code, **the code wins** — cross-check against the cited
files.

## Game constants (`src/game/game.js`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `DAY_LEN` | `160` | Seconds in the shop (day) phase |
| `START_INV` | `caveshroom, caveshroom, herb, potion, wsword` | Starting bag |
| `SAVE_KEY` | `"coincellar_save_v1"` | `localStorage` key |
| `LEVEL_INVULN` | `1.8` | Damage-immunity seconds on entering a floor |
| — start gold | `100` | |
| — start HP | `6 / 6` | |
| — inventory cap | `10` | `invCap` |
| — crit chance | `0.18` | `_critChance` |
| — dodge dash speed | `13` | `_dashSpeed` |

### Debt schedule (`DEBT`)

| Due day | Amount |
| --- | --- |
| 3 | 180 |
| 6 | 450 |
| 9 | 1,100 |
| 12 | 2,400 |
| 15 | 5,200 |

## Items (`src/game/items.js` → `ITEMS`)

25 items. `base` = value haggling revolves around. `heal` = hearts restored when
used as a consumable (blank = not consumable). `icon` = key into
`src/core/icons.js` / `public/items/`. Each also gets its `id` set to its key.

| id | Name | icon | base | tier | heal |
| --- | --- | --- | --- | --- | --- |
| `caveshroom` | Cave Mushroom | caveshroom | 8 | 1 | 1 |
| `jelly` | Slime Jelly | jelly | 12 | 1 | — |
| `herb` | Moon Herb | herb | 16 | 1 | 1 |
| `bread` | Honey Bread | bread | 14 | 1 | 2 |
| `wsword` | Pine Sword | sword | 28 | 1 | — |
| `potion` | Red Potion | potion | 34 | 2 | 4 |
| `ring` | Copper Ring | ring | 48 | 2 | — |
| `dagger` | Fang Dagger | dagger | 60 | 2 | — |
| `lantern` | Wisp Lantern | lantern | 75 | 2 | — |
| `amulet` | Silver Amulet | amulet | 105 | 3 | — |
| `ssword` | Steel Sword | swords | 140 | 3 | — |
| `tome` | Spell Tome | tome | 170 | 3 | — |
| `gem` | Dawn Gem | gem | 260 | 4 | — |
| `fang` | Dragon Fang | fang | 340 | 4 | — |
| `crown` | Lost Crown | crown | 450 | 4 | — |
| `mushroom` | Wild Mushroom | mushroom | 10 | 1 | 1 |
| `meat` | Roast Meat | meat | 18 | 1 | 2 |
| `egg` | Griffon Egg | egg | 40 | 2 | — |
| `key` | Brass Key | key | 52 | 2 | — |
| `bomb` | Blast Bomb | bomb | 44 | 2 | — |
| `shield` | Kite Shield | shield | 120 | 3 | — |
| `bell` | Gold Bell | bell | 150 | 3 | — |
| `feather` | Phoenix Feather | feather | 160 | 3 | — |
| `hourglass` | Chrono Hourglass | hourglass | 300 | 4 | — |
| `star` | Star Shard | star | 380 | 4 | — |

> Note: `wsword` and `ssword` reuse the `sword` / `swords` icon keys. All items
> also have a tiny procedural toon **prop mesh** (built from Three.js primitives in
> `items.js` `makers`), cloned on demand via `itemMesh(id)`.

### Loot by tier (`LOOT_BY_TIER`)

Index = dungeon tier (index 0 is empty). Tiers overlap so lower items keep dropping.

| Tier | Items |
| --- | --- |
| 1 | caveshroom, jelly, herb, bread, wsword, mushroom, meat |
| 2 | jelly, herb, potion, ring, dagger, lantern, egg, key, bomb |
| 3 | potion, ring, amulet, ssword, tome, lantern, shield, bell, feather |
| 4 | amulet, tome, gem, fang, crown, ssword, hourglass, star |

## Enemies (`src/game/dungeon.js` → `ENEMY_KINDS`)

| kind | hp | dmg | speed | aggro | gold | behavior | windup | reach / band |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `skitter` | 2 | 1 | 2.9 | 7 | 3–8 | swarm | 0.28 | reach 1.05 |
| `slime` | 4 | 1 | 1.9 | 6 | 4–10 | lunge | 0.50 | reach 1.5 |
| `goblin` | 5 | 1 | 3.0 | 8 | 8–16 | strafe | 0.34 | reach 1.35 |
| `wisp` | 3 | 1 | 3.2 | 9 | 6–12 | caster | 0.55 | band 4.5–7.5 |
| `archer` | 4 | 1 | 2.7 | 10 | 10–20 | archer | 0.42 | band 5–9 |
| `brute` | 12 | 2 | 1.6 | 7 | 25–45 | slam | 0.72 | reach 2.4 |

Projectile foes: `wisp` (projSpeed 6.0, color `0xb98cff`), `archer` (projSpeed
10.5, color `0x8fe0ff`). Each kind's `make(seed, tier)` builds its SDF creature via
a `species.js` factory (see [Character Generation](02-character-generation.md)).

> `gold` ranges are defined per kind, but design intent is that income comes from
> **selling looted merchandise**, not kills. See
> [Economy & Progression](../game-design/04-economy-and-progression.md).

### Floor mixes (`FLOOR_MIX`)

Selected by `min(tier, FLOOR_MIX.length - 1)`. Enemy count per floor =
`4 + floorN + random(0..2)`.

| Tier index (1-based depth) | Enemy pool |
| --- | --- |
| 1 | skitter, slime |
| 2 | skitter, slime, goblin |
| 3 | slime, goblin, wisp, archer |
| 4 | goblin, wisp, archer, brute |
| 5+ | goblin, archer, wisp, brute, brute |

## Dungeon generation constants (`src/game/dungeon.js`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `DUNGEON_ORIGIN` | `(200, 0, 0)` | World offset for the dungeon group |
| `CELL` | `2.4` | Cell size (m) |
| grid | 17 × 15 | Cells per floor |
| rooms | 5–8 | Non-overlapping rooms |
| chests | 1–2 | Per floor |
| `IMP_DECAY` | `0.0012` | Per-second knockback/impulse decay base |

## Customers (`src/game/shop.js`)

### Archetypes (`ARCHETYPES`)

`lo`/`hi` = pay tolerance multiplier on base; `w` = spawn weight; `buy` = chance to
make an offer after browsing. `moods` = the mood face used in the haggle UI.

| Name | moods | lo | hi | w | buy |
| --- | --- | --- | --- | --- | --- |
| Cheapskate | faceRoll | 1.02 | 1.18 | 3 | 0.50 |
| Regular | faceHappy | 1.10 | 1.40 | 5 | 0.62 |
| Wealthy | faceMonocle | 1.30 | 1.75 | 2 | 0.74 |
| Collector | faceStar | 1.50 | 2.20 | 1 | 0.88 |

### Shop constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `SHOP.W` × `SHOP.D` | 13 × 11 | Shop room size (world units) |
| `MAX_CUSTOMERS` | 4 | Concurrent shoppers |
| `SELLER_CHANCE` | 0.3 | Fraction who arrive to **sell** to you |
| display slots | 11 | 4 tables × 2 + 3 vitrine |

- **Buyer** rolls hidden `maxPay = base × random(lo..hi)`.
- **Seller** rolls hidden `minSell = round(base × random(0.45..0.75))` (45–75% of
  base), item drawn from a tier scaled by `game.day`.

### Haggle grades

Selling to a buyer (target: land just under `maxPay`):

| Grade | Condition |
| --- | --- |
| Perfect | price ≥ 92% of `maxPay` |
| Good | price ≥ 75% of `maxPay` |
| Cheap | accepted, below Good |
| Strike | price > `maxPay` (3 strikes → leaves) |

Buying from a seller (target: land just over `minSell`):

| Grade | Condition |
| --- | --- |
| Perfect | price ≤ 110% of `minSell` |
| Good | price ≤ 135% of `minSell` |
| Fair | above that, still accepted |

## Characters (`src/chargen/assets.js`)

- 18 Kenney variants: `character-a` … `character-r` (+ matching
  `Textures/texture-{a-r}.png`).
- `variantForSeed(seed)` = `CHAR_VARIANTS[seed % 18]`.
- `HARD_SEED` (debug) pins all customers to one variant when non-zero.

## Save format

`localStorage["coincellar_save_v1"]` holds a JSON object:

```json
{
  "day": 1,
  "gold": 100,
  "inv": ["caveshroom", "caveshroom", "herb", "potion", "wsword"],
  "debtIdx": 0
}
```

In co-op only the **host** writes the save.

## Audio persistence

`localStorage["ss_mute"]` — mute toggle (`src/core/audio.js`).

## Asset counts (`public/`)

| Category | Count | Path |
| --- | --- | --- |
| UI mask icons | 47 | `public/icons/*.png` |
| Item color art | 25 | `public/items/*.png` |
| Character GLBs | 18 | `public/characters/character-{a-r}.glb` |
| Character textures | 18 | `public/characters/Textures/texture-{a-r}.png` |
