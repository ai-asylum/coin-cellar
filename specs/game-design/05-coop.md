# 05 — Co-op

Coin Cellar supports **2-player co-op** over peer-to-peer WebRTC — no server. The
design goal is a natural division of labor: one player runs the shop while the
other dives the cellar, both feeding one shared economy.

For the wire protocol and sync internals, see
[Networking](../technical/03-networking.md). This document is the design
view.

## The fantasy: split roles

- **The Shopkeeper** stays up top: stocks tables, works customers, haggles, buys
  from sellers.
- **The Diver** goes below: fights through floors, opens chests, hauls loot back
  up.

Because gold, stock, and debt are all shared, the two roles are genuinely
interdependent — the diver's loot is the shopkeeper's inventory, and the
shopkeeper's gold is what keeps the whole operation solvent against the debt clock.
Players can also both dive, or both shop; the split is encouraged, not enforced.

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
  made this sale," "I want to dive") and renders snapshots the host broadcasts.

This keeps the two clients consistent without a referee server, at the cost of the
guest depending on the host being present.

## Friends & teleport invites

Co-op is organized around a **friends list** rather than one-off room codes.

- Each player picks a **display name**; the game registers them on the broker
  under it so friends can reach them directly (WebRTC peer-to-peer under the
  hood).
- You **add friends by name** in the friends menu, and the list is saved
  locally between runs.
- From the **shop**, you can **invite** a friend. That sends them a teleport
  invite; if they accept they drop straight into your world as the guest (you're
  the host).
- A player can **only accept a teleport invite while above ground** — you can't
  be yanked out of a live cellar dive. Surface first, then accept.
- Access via the friends button in the HUD (or the `C` key).

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
