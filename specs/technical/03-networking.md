# 03 — Networking (Co-op)

Co-op is **2-player, peer-to-peer over WebRTC** via PeerJS, with **no server of
our own** (PeerJS's public broker is used only for signaling/handshake). The model
is **host-authoritative**. Implementation: `src/net/coop.js` + the message handler
`onNetMessage()` in `src/game/game.js`.

The player-facing design is in [Co-op](../game-design/05-coop.md); this document is
the protocol/implementation view.

## Connection model

- **Signaling:** PeerJS public broker.
- **Transport:** a single reliable `DataConnection` (WebRTC data channel).
- **Named presence:** each player registers a persistent peer under their own
  display name, slugged to bare alphanumerics and namespaced with the peer-id
  prefix `coincellar-friend-`.
  - `goOnline(name)`: `new Peer("coincellar-friend-" + slugName(name))`, then
    listens for incoming connections.
  - Two players sharing a slug collide on the broker (names should be unique).
- **Teleport invites:** the **host invites** a friend from the shop; the friend
  accepts to become the guest.
  - Host: `peer.connect("coincellar-friend-" + slugName(friend))`, then sends
    `{ t: "tpInvite", from }`.
  - Guest replies `{ t: "tpAccept" }` (only allowed above ground) or
    `{ t: "tpDecline" }`.
  - After the handshake, the active connection carries the normal game traffic.
- **Capacity:** exactly one guest — an invite while already in a session is
  auto-declined.

```
Host (in shop)                    Friend (must be above ground to accept)
 │  invite(name) → connect        │
 │──────── tpInvite ─────────────▶│  onTpInvite() → prompt
 │◀──────── tpAccept ─────────────│  acceptInvite()
 │  onPeerJoined()  ──welcome──▶  │  onJoinedHost()
 │  ◀── intents ── / ── snapshots ─▶
```

## Roles & authority

- **Host** simulates the authoritative world: day timer, wallet (gold), customers,
  enemies, dungeon `(floor, seed)`. Only the host persists the save.
- **Guest** sends **intents** ("I want to hit / take / buy / sell / dive") and
  renders **snapshots** the host broadcasts. It never decides outcomes itself.

Node identity: `newId()` prefixes IDs with `h` (host) or `g` (guest) so IDs never
collide across the two clients.

## Tick & bandwidth

- Position/state is broadcast on a throttle: `_sendT = 0.09s` → **~11 Hz**.
- Floats are rounded to 2 decimals (`r2()`) before sending to shrink payloads.
- Host only sends enemy/customer snapshots for **dirty** entities — those marked
  via `trackEnemy()` / `trackCustomer()` since the last flush — not the whole world
  every tick.

## Message catalogue

Every message is a plain object with a `t` (type) tag. Roughly grouped:

### Both directions

| `t` | Payload | Meaning |
| --- | --- | --- |
| `p` | `x, z, h, area, atk, dead` | Per-tick player transform + flags |

### Host → guest (authoritative broadcasts)

| `t` | Meaning |
| --- | --- |
| `welcome` | Initial handshake / peer bootstrap |
| `state` | Shared game state (gold, day, phase, hp, debt…) |
| `inv` | Full inventory sync |
| `stockAll` / `stock` | Shop shelf contents |
| `eSnap` | Batched enemy snapshot: `[id, kind, seed, tier, x, z, h, hp]` |
| `eHurt` / `eDie` / `eDel` | Enemy damaged / died / removed |
| `cSnap` | Batched customer snapshot: `[id, seed, x, z, h, state]` |
| `custAdd` / `custWant` / `custState` / `custDel` | Customer lifecycle |
| `floor` | Authoritative floor to build: `n` (floor #) + `seed` |
| `dungeonReset` | Dispose the dungeon (e.g. on sleep) |
| `drop` / `dropTake` | Loot drop spawned / claimed |
| `proj` | Projectile spawned |
| `chest` | Chest opened (authoritative) |

### Guest → host (intents / requests)

| `t` | Meaning |
| --- | --- |
| `pHurt` | Guest took damage (host applies to shared HP) |
| `hit` | Guest hit an enemy |
| `take` / `dropTake` | Guest grabbed a drop |
| `chestReq` | Request to open a chest |
| `stockReq` / `unstockReq` / `swapReq` | Shelf manipulation requests |
| `useReq` / `dropReq` | Use / drop an inventory item |
| `sale` | Guest completed a sell haggle (`custId, sold, price, grade`) |
| `buy` | Guest completed a buy haggle (`custId, bought, price, grade`) |
| `delveReq` | Request to enter the dungeon |
| `stairsReq` | Request to descend |

> The catalogue above is representative, not exhaustive — the canonical list is the
> `switch (msg.t)` in `onNetMessage()` (`game.js`) and the `send({ t: … })` calls
> throughout `game.js`, `shop.js`, and `dungeon.js`.

## Determinism is the glue

The dungeon is fully reproducible from `(floor, seed)`, and creatures/customers are
reproducible from their seeds. That's why the network only ships **small facts**
(seeds, IDs, positions, outcomes) rather than geometry — both clients build the
same world locally from the same seeds. See
[Character Generation](02-character-generation.md#determinism--caching) and
[Engine & Rendering](01-engine-and-rendering.md#utilities).

## Lifecycle & failure

- On `conn.close` (or `leave()`), both sides reset (`_onClose()` →
  `onPeerLeft()`), clearing host/guest flags and the game connection — but the
  named presence peer stays online, so you remain reachable for future invites.
- Because authority and the save both live on the **host**, a host disconnect ends
  the authoritative session; a guest disconnect leaves the host able to continue
  solo.
- Errors decoding a message are caught and logged (`net msg failed`) without
  tearing down the connection.
