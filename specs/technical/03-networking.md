# 03 — Networking

Two independent wires:

1. **Co-op** — 2-player, peer-to-peer WebRTC via PeerJS (public broker for
   signaling only), **host-authoritative**. `src/net/coop.js` + the
   `onNetMessage()` switch in `src/game/game-net.js`.
2. **Shared-world lobby** — Supabase Realtime presence + broadcast.
   `src/net/lobby.js`. Social only; no gameplay state crosses it.

The player-facing design is in [Co-op](../game-design/05-coop.md).

## Co-op connection model

- **Signaling:** PeerJS public broker; transport is one reliable
  `DataConnection`.
- **Named presence:** each player registers a persistent peer under their
  display name, slugged and prefixed `coincellar-friend-`. Duplicate slugs
  collide on the broker — names should be unique.
- **Teleport invites:** host `connect()`s a friend's peer and sends
  `tpInvite`; the friend answers `tpAccept` (blocked while diving) or
  `tpDecline`. After the handshake the same connection carries game traffic.
- **Capacity:** exactly one guest; invites mid-session are auto-declined.

## Roles & authority

The **host** simulates the authoritative world — wallet, customers, enemies,
bosses, dungeon `(floor, seed)`, shortcut timers, town restores — and alone
persists the save. The **guest** sends intents and renders snapshots. IDs are
prefixed `h`/`g` so they never collide.

## Tick & bandwidth

- Positions broadcast on a `0.09s` throttle (~**11 Hz**), floats rounded to
  2 decimals; guests interpolate between snapshots (`sampleSnaps`).
- Enemy (`eSnap`) and customer (`cSnap`) snapshots only cover **dirty**
  entities marked since the last flush.

## Message catalogue

Every message is `{ t, ... }`. Representative, not exhaustive — the canonical
list is the `switch (msg.t)` in `game-net.js`:

**Handshake:** `tpInvite` / `tpAccept` / `tpDecline` / `welcome`.

**Both directions:** `p` (per-tick transform + flags), `atk` (a discrete
swing with heading + finisher flag), `chat`.

**Host → guest:** `state` (gold, hp, day…) · `inv` (bag **and stash**) ·
`stock`/`stockAll` · `tables` (repairs) · `floor` (authoritative
`n`+`seed`+`hole`) · `dungeonReset` · `shortcut` (mouth expiry) · `gateOpen` ·
`eSnap`/`eHurt`/`eDie`/`eDel` · `bossTel` (boss telegraph replay: countdown +
ground marks) · `cSnap`/`custAdd`/`custWant`/`custState`/`custDel` ·
`drop`/`dropTake` · `proj` · `chest` · `useFx`.

**Guest → host (intents):** `pHurt` · `hit` · `take` · `chestReq` ·
`gateReq` · `dSmash` (prop smash; host rolls the forage) · `delveReq` ·
`stairsReq` · `stockReq`/`unstockReq`/`swapReq` · `useReq`/`dropReq` ·
`equipReq`/`unequipReq` (gear from the shared pool) · `pack` (storeroom→bag) ·
`depositReq` (bag→storeroom) · `storeReq`/`takeReq` (single-item moves) ·
`sale` / `buy` (completed haggles).

## Determinism is the glue

Dungeons are reproducible from `(floor, seed)` — and the seed is `daySeed()`,
shared by construction — while creatures and customers are reproducible from
their own seeds. The wire ships **small facts** (seeds, IDs, positions,
outcomes), never geometry. See
[Character Generation](02-character-generation.md#determinism--caching).

## The shared-world lobby (`net/lobby.js`)

- Hardcoded Supabase project (`irhxoslymcxbeendjcuj.supabase.co`, publishable
  key in source); Realtime channel per zone: `coincellar:cave` or
  `coincellar:hole:<day>:<k>`.
- **8 Hz** broadcast of `p` positions (id, x, z, heading, floor, atk, dead)
  plus `chat` (140-char cap); presence tracks `{name}`.
- Rendered as ghost avatars with name tags (`_updateLobbyPlayers` in
  `game-net.js`). Chat sends to **both** wires — co-op partner and lobby.
- Because layouts are day-seeded, lobby ghosts in a dungeon zone stand in the
  same rooms you see.

## Lifecycle & failure

- On close/leave both sides reset flags but keep their named presence peer
  online — you stay reachable for future invites.
- Host disconnect ends the authoritative session; guest disconnect leaves the
  host solo. Message decode errors are logged, never fatal.
