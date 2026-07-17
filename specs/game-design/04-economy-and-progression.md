# 04 — Economy & Progression

The whole game is a funnel: **dive → loot → shelve → haggle → gold → pay debt**.
This document covers the numbers that make that funnel tense.

## Gold

- **Starting gold:** 100.
- Gold is **shared** in co-op (one host-authoritative wallet).
- **Kills don't fund you meaningfully** — gold comes from *selling* looted
  merchandise in the shop. A dive is only worth what you can shelve and sell.
- **Death penalty:** dying in the dungeon costs **50% of your current gold**.

## The debt schedule (the campaign spine)

The Guild collects on fixed days. Payments escalate hard, so early comfortable
days give way to a scramble.

| Payment # | Due day | Amount | Running total |
| --- | --- | --- | --- |
| 1 | 3 | 180 | 180 |
| 2 | 6 | 450 | 630 |
| 3 | 9 | 1,100 | 1,730 |
| 4 | 12 | 2,400 | 4,130 |
| 5 | 15 | 5,200 | 9,330 |

- **Miss a payment → game over.** If you can't cover the installment on its due
  morning, you lose the shop.
- **Clear all five → victory.** The deed is yours. An **endless mode** lets you
  keep playing afterward.

### Pacing implication

Each payment window is 3 days of shop revenue plus whatever you dive. The jump
from 1,100 → 2,400 → 5,200 means you must be reaching deeper dungeon tiers (for
higher-base loot) and landing more **Perfect** deals as the campaign progresses —
casual selling of tier-1 goods won't keep up.

## Merchandise & value tiers

25 items across 4 tiers. **`base`** is the value haggling revolves around; items
with a `heal` value are consumables that restore that many hearts when used.

### Tier 1 — common (base 8–28)

| Item | Base | Heal |
| --- | --- | --- |
| Cave Mushroom | 8 | 1 |
| Wild Mushroom | 10 | 1 |
| Slime Jelly | 12 | — |
| Honey Bread | 14 | 2 |
| Moon Herb | 16 | 1 |
| Roast Meat | 18 | 2 |
| Pine Sword | 28 | — |

### Tier 2 — uncommon (base 34–75)

| Item | Base | Heal |
| --- | --- | --- |
| Red Potion | 34 | 4 |
| Griffon Egg | 40 | — |
| Blast Bomb | 44 | — |
| Copper Ring | 48 | — |
| Brass Key | 52 | — |
| Fang Dagger | 60 | — |
| Wisp Lantern | 75 | — |

### Tier 3 — rare (base 105–170)

| Item | Base |
| --- | --- |
| Silver Amulet | 105 |
| Kite Shield | 120 |
| Steel Sword | 140 |
| Gold Bell | 150 |
| Phoenix Feather | 160 |
| Spell Tome | 170 |

### Tier 4 — precious (base 260–450)

| Item | Base |
| --- | --- |
| Dawn Gem | 260 |
| Chrono Hourglass | 300 |
| Dragon Fang | 340 |
| Star Shard | 380 |
| Lost Crown | 450 |

Full mesh/icon details in [Data Reference](../technical/04-data-reference.md).

## Loot tiers (what drops where)

Loot is gated by dungeon tier (`LOOT_BY_TIER`). Deeper floors unlock higher-value
drops, and tiers overlap so lower-tier items keep appearing:

- **Tier 1:** caveshroom, jelly, herb, bread, wsword, mushroom, meat
- **Tier 2:** jelly, herb, potion, ring, dagger, lantern, egg, key, bomb
- **Tier 3:** potion, ring, amulet, ssword, tome, lantern, shield, bell, feather
- **Tier 4:** amulet, tome, gem, fang, crown, ssword, hourglass, star

The lesson: a Lost Crown or Star Shard (the big debt-payers) only shows up if you
push to tier-4 depth — which is where the brutes are.

## Consumables

Items with a `heal` value can be used from the bag to restore hearts:

| Item | Hearts |
| --- | --- |
| Cave Mushroom / Wild Mushroom / Moon Herb | 1 |
| Honey Bread / Roast Meat | 2 |
| Red Potion | 4 |

There's a constant tension: eat the potion to survive a deeper floor, or shelve it
(base 34) for the sale.

## Progression summary

There are no explicit stat upgrades or skill trees; progression is **economic and
positional**:

- **Wealth** vs. the debt curve.
- **Depth reached** (deeper = higher loot tiers = bigger sales).
- **Haggle skill** (Perfect-deal rate compounds via combos).
- **Inventory management** (10-slot bag + 11 shelf slots force choices).

Win state and loss state both resolve on a debt-due morning — see
[Core Loop](01-core-loop.md).
