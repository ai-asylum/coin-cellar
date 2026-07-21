# 05 — Co-op & the Shared World

Coin Cellar has two social layers:

1. **True co-op** — 2-player, peer-to-peer over WebRTC (PeerJS), no server.
   One shared economy, host-authoritative.
2. **The shared-world lobby** — a lightweight Supabase Realtime presence
   layer: other players appear as avatars in the cave and dungeons of your
   zone, with chat, but **no shared gameplay state**.

Wire protocol and sync internals: [Networking](../technical/03-networking.md).
This is the design view.

## Co-op: split roles

- **The Shopkeeper** stays up top: stocks tables, works the vitrine counter,
  hires the builder.
- **The Diver** goes below: fights through floors, opens chests, hauls loot
  back up.

Gold, bag, storeroom, shelf stock, shortcuts, and town progress are all
shared, so the roles are genuinely interdependent — the diver's loot is the
shopkeeper's inventory. Players can also both dive or both shop; the split is
encouraged, not enforced.

## What's shared (co-op)

- **Gold** — one wallet.
- **Inventory** — one bag, one storeroom, one set of shelves. Equipment is
  drawn from the shared pool (`equipReq`/`unequipReq`).
- **World** — customers, enemies, dungeon layout, boss state, shortcut
  timers, and town restores are all synchronized. Hearts are per-player.

## Host & guest

Co-op is **host-authoritative**. The host simulates customers, enemies, the
wallet, and the dungeon seed, and is the only one who writes the save. The
guest sends intents ("I hit this enemy", "stock this", "open the gate") and
renders the host's snapshots. Consistent without a referee server, at the
cost of the guest depending on the host being present.

## Friends & teleport invites

Co-op is organized around a **friends list**, not room codes:

- Each player picks a **display name**; the game registers a PeerJS presence
  under it so friends can reach them directly. The list persists locally.
- From above ground, **invite** a friend; if they accept they drop into your
  world as the guest. Accepting is blocked while diving — surface first.
- One guest max; invites during a session are auto-declined.

## The shared-world lobby

Independent of co-op, every player above ground joins a Supabase Realtime
channel for their zone (the cave, or a specific dungeon+day). You see other
players' avatars glide around, with name tags and **chat** (chat bridges to
the co-op partner too). Nothing else crosses: their enemies, loot, and gold
are their own. It makes the world feel inhabited at zero gameplay-sync cost —
and since dungeon layouts are day-seeded, everyone in a zone stands in the
*same* rooms.

## Design differences vs. single-player

- **Haggling** is manual walk-up in co-op (single-player auto-opens the sheet
  when a vitrine customer reaches the counter), so both clients don't grab
  the same customer.
- **Presence:** both players render in shop and dungeon with their own
  models; a partner on a different floor doesn't count toward your fight.

## Failure modes

- The host dropping ends the authoritative session (the guest can continue
  solo on their own save).
- Canonical progress lives on the host's machine — only the host persists.
