# 05 — Co-op

Coin Cellar supports **2-player co-op** over peer-to-peer WebRTC — no server. The
design goal is a natural division of labor: one player runs the shop while the
other delves the cellar, both feeding one shared economy.

For the wire protocol and sync internals, see
[Networking](../technical/03-networking.md). This document is the design
view.

## The fantasy: split roles

- **The Shopkeeper** stays up top: stocks tables, works customers, haggles, buys
  from sellers.
- **The Delver** goes below: fights through floors, opens chests, hauls loot back
  up.

Because gold, stock, and debt are all shared, the two roles are genuinely
interdependent — the delver's loot is the shopkeeper's inventory, and the
shopkeeper's gold is what keeps the whole operation solvent against the debt clock.
Players can also both delve, or both shop; the split is encouraged, not enforced.

## What's shared

- **Gold** — one wallet.
- **Inventory / stock** — one bag and one set of shop shelves.
- **Debt** — one schedule, one game-over/victory condition.
- **Time & world** — the day timer, customer waves, enemy spawns, and dungeon
  layout are all synchronized.

## Host & guest

Co-op is **host-authoritative**. One player hosts (owns the "truth"); the other
joins.

- The **host** simulates: day timer, wallet, customers, enemies, and the dungeon
  seed. Only the host writes the save.
- The **guest** sends intents (e.g. "I hit this enemy," "I took this drop," "I
  made this sale," "I want to delve") and renders snapshots the host broadcasts.

This keeps the two clients consistent without a referee server, at the cost of the
guest depending on the host being present.

## Joining a game

- The host creates a room and gets a **4-letter room code**.
- The guest enters that code to connect (WebRTC peer-to-peer under the hood).
- Access via the co-op button in the HUD (or the `C` key).

## Design differences vs. single-player

- **Haggling:** single-player **auto-opens** haggle sheets so a solo player isn't
  torn between shop and dungeon. Co-op uses the **manual walk-up** flow instead —
  a player must approach a flagged customer to haggle — so the two clients don't
  both auto-open the same customer.
- **Presence:** both players are visible in the shared world (shop and dungeon),
  each with their own character model and blob shadow.

## Failure modes to be aware of

- Co-op depends on the **host** staying connected; if the host drops, the
  authoritative state is gone.
- Because only the host persists the save, a run's canonical progress lives on the
  host's machine.
