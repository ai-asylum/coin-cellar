# 04 — Economy & Progression

The funnel is: **dive → loot → shelve → sell → gold → build the town** (which
sends more customers back through the funnel). There is no debt and no win or
lose state — progression is the town waking up around you. Money logic lives
in `src/game/game-economy.js`; item data in `items.js`.

## Gold

- **Starting gold:** 100. Shared in co-op (one host-authoritative wallet).
- **Sources:** selling — instant sticker-price sales off plain tables, and
  haggled sales at the vitrine. A gold-bonus ring/amulet (`goldMul`) sweetens
  every gain. Kills pay nothing meaningful; enemies drop *merchandise*.
- **Death never taxes gold.** Dying deep loses the carried bag instead (see
  [Dungeon & Combat](03-dungeon-and-combat.md)).

## The sinks (what gold is for)

| Sink | Cost | What it buys |
| --- | --- | --- |
| Display table repair ×4 | 200g each | +2 shelf slots each |
| Fancy vitrine | 1,000g | +3 slots — and the haggle game itself |
| House lots ×8 | 100 / 700 / 1,200 / 1,800 / 3,000 / 4,500 / 7,000 / 9,500 | A resident moves in: faster customer traffic, richer archetype mix |

Full build-out is **~29,600g** of town investment. Lot residents step up in
wealth — the early lots house Regulars, the ruins at the end house
Collectors — so the expensive houses are also the best customers.

Hiring the **builder** charges the lot cost up front, then the foreman walks
over and hammers the house up (see [Town, NPCs & Building](09-town-npcs-and-building.md)).

## Merchandise & value tiers

**36 items** (`ITEMS`). `base` is the value haggling revolves around; `heal`
items are consumables restoring that many hearts. Quest props (Shop Key,
Uncle's Note) have no price and never survive past the FTUE.

### Tier 1 — common (base 6–28)

| Item | Base | Heal | | Item | Base | Heal |
| --- | --- | --- | --- | --- | --- | --- |
| Crystal | 6 | — | | Honey Bread | 14 | 2 |
| Rat Hide | 6 | — | | Moon Herb | 16 | 1 |
| Flower | 6 | 1 | | Roast Meat | 18 | 2 |
| Berries | 7 | 1 | | Slime Jelly | 12 | — |
| Cave Mushroom | 8 | 1 | | Pine Sword | 28 | — |
| Nuts | 9 | 1 | | Wild Mushroom | 10 | 1 |

### Tier 2 — uncommon (base 34–110)

Red Potion 34 (heal 4) · Griffon Egg 40 · Blast Bomb 44 · Copper Ring 48 ·
Brass Key 52 · Fang Dagger 60 · Wisp Lantern 75 · Hunter's Bow 95 ·
Swift Boots 110

### Tier 3 — rare (base 105–185)

Silver Amulet 105 · Kite Shield 120 · Steel Sword 140 · Gold Bell 150 ·
Phoenix Feather 160 · Oak Staff 165 · Spell Tome 170 · Steel Chestplate 185

### Tier 4 — precious (base 260–450)

Dawn Gem 260 · Chrono Hourglass 300 · Dragon Fang 340 · Star Shard 380 ·
Lost Crown 450

## What drops where

Loot is **per-dungeon** (`DUNGEON_LOOT`), not a global tier ladder — each
dungeon has a common and a rare pool, and rares only appear below a dungeon's
entry floor (details in [Dungeon & Combat](03-dungeon-and-combat.md)). The
big-ticket items (Star Shard, Lost Crown) live in the Bone Hollow and Gloom
Drain rare pools — behind three bosses.

**Forage** rounds out tier 1: smashing town/meadow decor and dungeon
mushrooms/stones yields flowers, berries, nuts, herbs, and crystals — small
money, but free hearts for the bag.

## Gear (the other reward track)

Bosses are the **only** source of equipment (`EQUIP_DROPS`): bow, staff,
armor, boots, steel sword, tome, shield, amulet. Five slots exist — weapon,
chest, shield, ring, boots — with real stats wired up:

| Piece | Stats |
| --- | --- |
| Pine / Steel Sword | dmg ×1.0 / ×1.7 |
| Fang Dagger | dmg ×0.85 |
| Copper Ring / Silver Amulet | +12% crit / +8% crit & +20% gold |
| Kite Shield | 35% block |
| Steel Chestplate | +4 hearts |
| Swift Boots | +20% speed, −25% dodge cooldown |
| Hunter's Bow / Oak Staff / Spell Tome | ranged projectile kits |

> **Current gate:** `canEquip` accepts **swords only** — "bows, staves and the
> armour/ring/shield/boots slots are held back until they're properly
> balanced" (`gear.js`). Everything else is sellable merchandise for now.
> Unarmed halves damage, so a sword is the first real upgrade.

## Consumables

Heal items restore hearts from the bag (each player their own, in co-op):
mushrooms/herb/forage +1 · bread/meat +2 · potion +4. The old tension stands:
eat the potion to push deeper, or shelve it (base 34) for the sale.

## Progression summary

No stat trees; progression is **economic, spatial, and social**:

- **Depth** — four dungeons gated by bosses; deeper pools carry the treasure.
- **Gear** — boss drops (swords today) raise dive power.
- **Shelves** — repairs grow selling throughput.
- **Town** — every rebuilt house compounds shop income and adds a character
  (with intros, tastes, and gossip) to the world.
- **Haggle skill** — the Perfect-deal rate is the player's own stat.

**Endgame today is soft:** all four bosses felled, the town fully rebuilt,
best sword equipped — then the loop is endless, paced by the real-time clock
and the 3-hour shortcut windows. There is no terminal screen; the town *being
alive* is the trophy.
