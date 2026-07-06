# 02 — Shop & Haggling

The shop is where merchandise becomes gold. It's a small room (`SHOP` = 13 × 11
world units) with display furniture, a street of ambient pedestrians outside, a
trapdoor down to the cellar, and a bed for sleeping. Logic lives in
`src/game/shop.js`.

## Stocking the shop

- **11 display slots:** 4 tables × 2 slots + 3 vitrine (window-sill) slots.
- Open the **bag** and tap an item to place it on an open slot; only stocked items
  are browsable by customers.
- Inventory is capped at **10** carried items, so shelf space and bag space both
  pressure what you keep vs. sell.

## Customers

Customers arrive in **waves** — a short burst of shoppers, then a lull —
up to `MAX_CUSTOMERS = 4` at once. Each is drawn from a weighted pool of four
**archetypes** that differ in how much markup they tolerate and how likely they
are to actually make an offer.

| Archetype | Weight | Pay tolerance (× base) | Offer chance | Vibe |
| --- | --- | --- | --- | --- |
| Cheapskate | 3 | 1.02 – 1.18 | 50% | Wants a bargain |
| Regular | 5 | 1.10 – 1.40 | 62% | The bread-and-butter buyer |
| Wealthy | 2 | 1.30 – 1.75 | 74% | Pays up for nice things |
| Collector | 1 | 1.50 – 2.20 | 88% | Rare, deep pockets |

When a buyer browses and settles on an item, they roll a hidden **`maxPay`** =
`base × random(lo..hi)` within their tolerance band. Pricier goods tug harder at
wealthier archetypes (plus personal-taste noise), so a Collector eyeing a Lost
Crown is where the big money lives.

### Sellers (reverse haggle)

**30%** of shoppers (`SELLER_CHANCE = 0.3`) arrive as **sellers**: they carry an
item to offload onto you. They'll accept anything at or above a hidden floor —
**`minSell` = 45–75% of the item's base value**. Buying low from a seller and
re-shelving it to sell high is a major profit lever. The item they bring is drawn
from a loot tier scaled to how deep into the campaign you are.

## The haggle minigame

Haggling is a nerve game against the customer's hidden number. You name a price;
they grade it. Push too hard and you burn a strike; three strikes and they storm
out.

### Selling to a buyer

You want to land as close **under** `maxPay` as possible.

| Grade | Condition | Result |
| --- | --- | --- |
| **Perfect** | price ≥ 92% of `maxPay` (and ≤ it) | Best payout, feeds the combo chain, extra juice |
| **Good** | price ≥ 75% of `maxPay` | Solid sale |
| **Cheap** | accepted, but below Good | Sale at a low grade |
| **Strike** | price **>** `maxPay` | Rejected; 3 strikes → customer leaves |

A **Perfect Deal** chains a **combo** — consecutive perfect sales build a streak
with escalating audio/visual payoff.

### Buying from a seller

You want to land as close **above** `minSell` as possible (pay as little as they'll
accept).

| Grade | Condition |
| --- | --- |
| **Perfect** | price ≤ 110% of `minSell` |
| **Good** | price ≤ 135% of `minSell` |
| **Fair** | above that but still accepted |

## Customer AI

Customers path around furniture on a baked nav grid using A*. Their behavior is a
small state machine:

```
street → enter → roam / goto / look → want (buyer) | offer (seller)
                                     → haggling → happy | leave
```

- **roam/goto/look:** wander the shop, inspect stocked slots they haven't seen.
- **want / offer:** a buyer commits to a favourite item; a seller presents theirs.
- **haggling:** the deal sheet is live (auto-opened in single-player; manual in
  co-op).
- **happy / leave:** a completed deal or a walk-off (out of patience, struck out,
  or nothing appealed).

## Presentation

The haggle UI is Recettear-styled: customer and shopkeeper **portraits** flank
the deal sheet (rendered from the Kenney character models — see
[Character Generation](../technical/02-character-generation.md)), with
mood faces reflecting the archetype and how the deal is going. Sales fire coin/
ka-ching SFX and floating gold numbers; perfects get a special flourish.

See [Economy & Progression](04-economy-and-progression.md) for item values and how
shop income maps onto the debt schedule.
