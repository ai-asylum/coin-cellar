# 04 — Data Reference

Source-of-truth tables, transcribed from the code. When a number here
disagrees with the code, **the code wins** — cross-check the cited files.
Note that `GEN`, `GEN_BY_FLOOR`, `HOLE_THEMES`, `DUNGEON_MIX`, `ENEMY_KINDS`,
and `BOSSES` can be overlaid at load by `dungeon-tuning.json` (tuned in the
editor), and combat by `combat-settings.json`.

## Game constants (`src/game/game.js` & friends)

| Constant | Value | Meaning |
| --- | --- | --- |
| `START_INV` | `caveshroom, meat` | Starting bag |
| start gold | 100 | |
| `BASE_MAXHP` | 6 | Hearts (gear can raise) |
| `invCap` | 10 | Bag cap (storeroom `stash` is uncapped) |
| `_critChance` | 0.18 | + `critBonus` from gear |
| `_dashDur` / `_dashSpeed` | 0.24s / 13 | Dodge dash |
| strike damage | `4 × dmgMul` (unarmed ×0.5) | Doubled on crit |
| `SHORTCUT_TTL_MS` | 3h | Cave-mouth unseal window |
| `SAFE_ZONE_FLOOR` | 3 | KO on floors 1–3 keeps the bag |
| `LEVEL_INVULN` | 1.8s | Arrival grace per floor |
| `SAVE_KEY` | `"coincellar_save_v1"` | |
| `MAX_CUSTOMERS` | 6 | Concurrent shoppers |
| `SELLER_CHANCE` | 0.3 | *(disabled — buyers only for now)* |

## Items (`src/game/items.js` → `ITEMS`, 36 entries)

`base` = haggle value · `heal` = hearts · `equip` = gear stats · `quest` =
FTUE prop (no price, stripped from resumed saves).

| id | Name | base | tier | heal | notes |
| --- | --- | --- | --- | --- | --- |
| `caveshroom` | Cave Mushroom | 8 | 1 | 1 | |
| `crystal` | Crystal | 6 | 1 | — | smashed stones |
| `jelly` | Slime Jelly | 12 | 1 | — | |
| `herb` | Moon Herb | 16 | 1 | 1 | |
| `bread` | Honey Bread | 14 | 1 | 2 | |
| `wsword` | Pine Sword | 28 | 1 | — | sword, dmg ×1.0 |
| `mushroom` | Wild Mushroom | 10 | 1 | 1 | |
| `meat` | Roast Meat | 18 | 1 | 2 | |
| `rathide` | Rat Hide | 6 | 1 | — | cave rats |
| `flower` | Flower | 6 | 1 | 1 | forage |
| `berries` | Berries | 7 | 1 | 1 | forage |
| `nuts` | Nuts | 9 | 1 | 1 | forage |
| `potion` | Red Potion | 34 | 2 | 4 | |
| `ring` | Copper Ring | 48 | 2 | — | crit +0.12 |
| `dagger` | Fang Dagger | 60 | 2 | — | sword, dmg ×0.85 |
| `lantern` | Wisp Lantern | 75 | 2 | — | |
| `egg` | Griffon Egg | 40 | 2 | — | |
| `key` | Brass Key | 52 | 2 | — | opens boss gates |
| `shopkey` | Shop Key | 0 | 2 | — | quest |
| `unclenote` | Uncle's Note | 0 | 2 | — | quest |
| `bomb` | Blast Bomb | 44 | 2 | — | |
| `bow` | Hunter's Bow | 95 | 2 | — | bow: projDmg 3, cd 0.34, spd 15 |
| `boots` | Swift Boots | 110 | 2 | — | speed +0.2, dodgeCd −0.25 |
| `amulet` | Silver Amulet | 105 | 3 | — | crit +0.08, gold +0.2 |
| `ssword` | Steel Sword | 140 | 3 | — | sword, dmg ×1.7 |
| `tome` | Spell Tome | 170 | 3 | — | staff: projDmg 9, cd 0.55, pierce, splash |
| `shield` | Kite Shield | 120 | 3 | — | block 0.35 |
| `bell` | Gold Bell | 150 | 3 | — | |
| `feather` | Phoenix Feather | 160 | 3 | — | |
| `staff` | Oak Staff | 165 | 3 | — | staff: projDmg 6, cd 0.6, pierce |
| `armor` | Steel Chestplate | 185 | 3 | — | maxHp +4 |
| `gem` | Dawn Gem | 260 | 4 | — | |
| `hourglass` | Chrono Hourglass | 300 | 4 | — | |
| `fang` | Dragon Fang | 340 | 4 | — | |
| `star` | Star Shard | 380 | 4 | — | |
| `crown` | Lost Crown | 450 | 4 | — | |

- `EQUIP_DROPS` (boss-only): bow, staff, armor, boots, ssword, tome, shield,
  amulet.
- **Equipment slots** (`gear.js`): weapon, chest, shield, ring, boots.
  `canEquip` currently accepts `type === "sword"` only; unarmed → `dmgMul ×0.5`.

### Loot pools (`DUNGEON_LOOT`, indexed by dungeon)

| Dungeon | Common | Rare |
| --- | --- | --- |
| 0 Rat Warren | meat, bread, caveshroom, crystal, jelly, egg | wsword, ring, fang |
| 1 Flooded Deep | jelly, crystal, egg, potion | lantern, feather, gem |
| 2 Bone Hollow | fang, bomb, key, ring, crystal | bell, ssword, crown |
| 3 Gloom Drain | potion, crystal, gem, feather | star, hourglass, crown |

Rare chance: kills `0.12 + 0.06 × localFloor` (0 on entry floors); chests
`0.22 + 0.18 × localFloor`. Kill drop rate 0.6; 65% of drops are the kind's
signature `loot`.

### Forage & smash (`decor.js`)

| Source | Chance | Drops |
| --- | --- | --- |
| Dungeon mushrooms | 0.6 | mushroom, caveshroom, herb |
| Dungeon dead trees | 0.5 | herb, mushroom |
| Dungeon stones | 0.55 | crystal |
| Meadow flowers/bushes/trees/mushrooms | per `FIELD_FORAGE` | flower, berries, nuts, mushroom, herb |

## Dungeon structure (`src/game/dungeon-data.js`)

| Constant | Value |
| --- | --- |
| `N_DUNGEONS` / `FLOORS_PER_DUNGEON` / `MAX_DEPTH` | 4 / 3 / 12 |
| Boss floors | 3, 6, 9, 12 (`isBossFloor: f % 3 === 0`) |
| Mouth entry floors | 1 / 4 / 7 / 10 |
| `DUNGEON_ORIGIN` / `CAVE_ORIGIN` | (200,0,0) / (−200,0,200) |
| `CELL` | 2.4 |
| Grid | 18 × 32 (boss floors 18 × 40), portrait-tall, entrance bottom → exit top |
| Rooms | `8 + min(4, ⌊f/2⌋) + rand(0..2)` |
| Corridors | 2-wide L-shapes, Prim's MST + 1–2 loops |
| Enemies/floor | `4 + f + rand(0..2)`, rolling cap `6 + 2f` |
| Chests/floor | 1–2; boss-key chest guaranteed on boss floors, else 40% |
| Enemy HP scale | `+⌊tier × 0.7⌋`, tier = `min(floor, 5) − 1` |

### Enemies (`ENEMY_KINDS`, 18 + boss)

See [Dungeon & Combat](../game-design/03-dungeon-and-combat.md#enemies) for
the full bestiary table (hp/dmg/speed/behavior/windup per kind) and
`DUNGEON_MIX` rosters. Projectile kinds: wisp 3.8 `0xb98cff`, archer 6.5
`0x8fe0ff`, gravewisp 5.2 `0xffe9a8`, gloomcaster 5.5 `0xd48cff`, boss 3.6
`0xff7a4d`.

### Bosses (`BOSSES` + `bossDefFor` scaling)

Base defs: Broodmother 58hp/2.25spd (pounce), Drowned Maw 92/1.25 (deluge,
10-orb bursts), Ogre King 70/1.7 (base kind), Sovereign 62/2.0 (blink).
Scaling by hole `h`: hp ×(1+0.5h), +1 dmg from h≥2, speed ×(1+0.07h), windup
×(1−0.07h), pace ×(1−0.09h), enrage pack 3+h, burst 8+h. Enrage at half HP.

## Customers (`shop-data.js` / `shop.js`)

| Archetype | moods | lo | hi | w | buy |
| --- | --- | --- | --- | --- | --- |
| Cheapskate | faceRoll | 1.02 | 1.18 | 3 | 0.50 |
| Regular | faceHappy | 1.10 | 1.40 | 5 | 0.62 |
| Wealthy | faceMonocle | 1.30 | 1.75 | 2 | 0.74 |
| Collector | faceStar | 1.50 | 2.20 | 1 | 0.88 |

- Spawn interval `max(1.8, 5.5 − 0.5 × townPop)`s (± 30% jitter); NPC
  archetype fixed by personality (`archetypeForNpc`).
- Buyer rolls `maxPay = base × random(lo..hi)`.
- Grades — sell: Perfect ≥ 0.92·maxPay, Good ≥ 0.75, else Cheap; overshoot =
  strike, 3 strikes ends the deal. Buy (disabled): Perfect ≤ 1.10·minSell,
  Good ≤ 1.35, else Fair.
- Display slots: 5 tables × 2 + vitrine × 3 = **13** (table 0 free; repairs
  200g, vitrine 1,000g).

## Town (`layout.json`, `npc-data.js`)

- 8 lots: 100 / 700 / 1,200 / 1,800 / 3,000 / 4,500 / 7,000 / 9,500 g;
  resident archetype indices 1,1,2,2,2,3,3,3 (Regular → Collector).
- 17 NPCs (variants b–r), 17 personalities; `reserved`: nib, mayor.
- `TIMES_OF_DAY`: morning 5–11 / afternoon 11–17 / evening 17–21 / night.
- `OCCASIONS`: newyear, valentines, easter (computed), halloween, christmas,
  weekend, monday, friday.

## Save format

`localStorage["coincellar_save_v1"]` (host-only in co-op):

| Key | Meaning |
| --- | --- |
| `day` | Run counter |
| `gold` | Wallet |
| `inv` / `stash` | Bag / storeroom item ids |
| `stock` | Shelf contents by slot (null = empty) |
| `shortcutUntil` | Epoch-ms relock time per cave mouth |
| `bossBeaten` / `deepestEver` | Deed records |
| `equipment` | `{weapon, chest, shield, ring, boots}` |
| `town` | bool[] — lots rebuilt |
| `tables` | bool[] — tables repaired |
| `npcMet` | NPC ids already introduced |

On load: bag merges into stash (runs resume in the shop), quest items and
unknown ids are dropped, invalid weapons re-arm `wsword`. Also:
`coincellar_name` (display name), `coincellar_friends` (friends list),
`ss_mute` (audio), `coin-cellar-cooking-v1` (the cooking prototype's own
save).

## Assets (`public/`)

| Category | Count | Path |
| --- | --- | --- |
| UI mask icons | 47 | `icons/` |
| Item color art | 34 | `items/` |
| Character GLBs + textures | 18 + 18 (+ uncle portrait) | `characters/` |
| Music | 11 MP3s | `music/` |
| Decor billboards | 43 | `decor/` |
| Dungeon kit | 19 GLTFs | `dungeon/` |
