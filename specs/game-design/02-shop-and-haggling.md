# 02 — Shop & Haggling

The shop is where merchandise becomes gold — and it mostly runs itself.
**Plain tables sell at sticker price automatically; the fancy vitrine is where
the haggle minigame lives.** Logic spans `src/game/shop.js` (room + lighting),
`shop-build.js` (furniture), `shop-customers.js` (shopper AI), `shop-data.js`
(tuning), and `game-economy.js` (the money).

## Stocking the shop

- **13 display slots** when fully built: 5 plain tables × 2 slots + the
  **fancy vitrine** × 3 slots.
- Only **table 0 is free** at the start. Each further table costs **200g** to
  repair; the vitrine costs **1,000g** — shelf capacity is a gold sink (see
  [Economy](04-economy-and-progression.md)).
- Stock flows: dungeon bag → storeroom (auto-deposited on returning home) →
  tables, via the store panel. The bag carries 10; the storeroom is uncapped.

## Customers are the townsfolk

There are no anonymous shoppers: every customer is a **named resident**
recruited off the street (`shop-customers.js`), haggling in character every
visit. Their archetype is fixed by their personality:

| Archetype | Pay tolerance (× base) | Offer chance | Vibe |
| --- | --- | --- | --- |
| Cheapskate | 1.02 – 1.18 | 50% | Wants a bargain |
| Regular | 1.10 – 1.40 | 62% | Bread-and-butter buyer |
| Wealthy | 1.30 – 1.75 | 74% | Pays up for nice things |
| Collector | 1.50 – 2.20 | 88% | Deep pockets |

- Customers arrive in a **steady trickle**, up to `MAX_CUSTOMERS = 6` at once,
  and only while something is stocked.
- **The town's population is the throttle:** the spawn interval is
  `max(1.8, 5.5 − 0.5 × townPop)` seconds — every rebuilt house literally
  quickens foot traffic. Rebuilding also weights the crowd toward the new
  resident's archetype (lots house Regulars up to Collectors).
- A browser eyes 1–3 stocked items with ~18–28s of patience, with
  personal-taste pull from their personality's `taste` table.

### Two kinds of sale

- **Plain table pick → instant sale** at 100% of base value. No interaction —
  the shop earns while you dive.
- **Vitrine pick → the counter queue.** The customer lines up at the counter
  and the **haggle** begins. Prized goods belong in the vitrine; commodity
  goods belong on tables.

### Sellers (reverse haggle) — currently disabled

The buy-from-a-customer flow (hidden `minSell` = 45–75% of base,
`SELLER_CHANCE = 0.3`) is fully implemented but **switched off** — every
shopper currently arrives as a buyer (`mode = "buy"` hardcoded in
`shop-customers.js`). The grades below are kept for when it returns.

## The haggle minigame

A nerve game against the customer's hidden `maxPay = base × random(lo..hi)`.
You name a price; they grade it. Overshoot and they counter-offer and you burn
a strike; **three strikes and they storm out**.

### Selling (vitrine)

| Grade | Condition | Result |
| --- | --- | --- |
| **Perfect** | price ≥ 92% of `maxPay` (and ≤ it) | Best payout, feeds the combo chain |
| **Good** | price ≥ 75% of `maxPay` | Solid sale |
| **Cheap** | accepted, below Good | You left money on the counter |
| **Strike** | price > `maxPay` | Counter-offer; 3 strikes → "Forget it!" |

Consecutive Perfects chain a **combo** with escalating audio/visual payoff.

### Buying (when sellers return)

| Grade | Condition |
| --- | --- |
| **Perfect** | price ≤ 110% of `minSell` |
| **Good** | price ≤ 135% of `minSell` |
| **Fair** | above that, still accepted |

## Customer AI

Customers path around furniture on a baked nav grid using A*
(`shop-pathfinding.js`). Behavior is a small state machine:

```
street stroll → enter → browse (1–3 items) → pick
      → plain table: auto-sell · vitrine: queue at counter → haggle
      → happy | leave (patience out, struck out, nothing appealed)
```

Around the sale, the NPC dialogue systems kick in: arrival lines on the way
over, and **purchase reflections** afterwards (loved it / impulse buy / too
pricey / passed) — see [Town, NPCs & Building](09-town-npcs-and-building.md).

## Presentation

The haggle UI is Recettear-styled: customer and shopkeeper **portraits** flank
the deal sheet (rendered from the Kenney models — see
[Character Generation](../technical/02-character-generation.md)), with mood
faces per archetype. Sales fire coin/ka-ching SFX and floating gold numbers;
Perfects get the flourish.

Item values and what drops where: [Economy & Progression](04-economy-and-progression.md).
