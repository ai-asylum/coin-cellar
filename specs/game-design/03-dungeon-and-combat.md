# 03 — Dungeon & Combat

The cellar is the merchandise pipeline: four stacked, themed dungeons you crawl
for the loot you'll sell up top. Data lives in `src/game/dungeon-data.js`;
generation in `src/game/dungeon.js` + `dungeon-geometry.js`; enemy brains in
`dungeon-ai.js`; combat resolution in `dungeon-combat.js` + `game-combat.js`;
the descent flow in `game-dungeon-flow.js`.

## The cave hub

The way down is no longer a shop trapdoor — it's the **cave at the end of the
road** (`src/game/cave.js`), the same tunnel the hero woke up in. It's a
permanent hub built once at `CAVE_ORIGIN = (−200, 0, 200)`:

- **Four dungeon mouths** line the chamber wall, one per dungeon, each a sunken
  stair flight under its own colored light shaft: **Rat Warren** (purple),
  **Flooded Deep** (blue), **Bone Hollow** (orange), **Gloom Drain** (teal).
- Mouth 0 (the Warren) is always open — it's the FTUE trapdoor. Mouths 1–3
  wear **iron grates** and are **shortcuts**, not locks: each unseals for
  **3 real hours** (`SHORTCUT_TTL_MS`) whenever you descend past the boss of
  the dungeon above it. Let it lapse and you re-earn it by diving through
  again.
- The cave also holds the daylight exit to town, some harmless ambient rats,
  and the FTUE's scripted slime.

## Dungeon structure

- **4 dungeons × 3 floors = 12 floors** (`N_DUNGEONS`, `FLOORS_PER_DUNGEON`,
  `MAX_DEPTH` in `dungeon-data.js`).
- **Every 3rd floor is a boss floor** (3, 6, 9, 12). Beating a boss opens the
  stairs into the next dungeon — and unlocks that dungeon's cave mouth for 3
  hours. The final boss (floor 12) conjures the way home instead.
- Mouths drop you at floors **1 / 4 / 7 / 10**.
- **Seeding:** each fresh delve uses `daySeed()` — a UTC-day seed, so everyone
  delving on the same day walks the same layouts, and co-op peers agree by
  construction. The `day` counter is just a run counter that feeds variety.

## Floor generation

Each floor is deterministic from `(floor, seed)`. Knobs live in the `GEN`
table (`dungeon-data.js`), overridable per floor via `GEN_BY_FLOOR` and tuned
live in the [editor](../technical/06-tooling-lab-and-admin.md).

- **Grid:** 18 × 32 cells (portrait-tall; boss floors stretch to 18 × 40),
  `CELL = 2.4` world units.
- **Orientation:** the entrance room is forced to the **bottom** of the grid,
  the down-stairs to the **top** — every floor reads bottom-to-top, matching
  the portrait screen ("deeper" is always up-screen).
- **Rooms:** `8 + min(4, ⌊floor/2⌋) + rand(0..2)`, rejection-sampled with a
  one-cell gap, leaning tall.
- **Corridors:** 2-cell-wide L-shapes connecting rooms via **Prim's MST**,
  plus 1–2 extra loop links.
- **Fixtures:** up-stairs at the entrance (back to the previous floor or the
  cave), a sunken descent in the top room, **1–2 chests** (kept clear of both
  stairs), crystal torches, and up to 6 lit god-ray shafts.
- **Boss-key chest:** guaranteed on boss floors, 40% chance elsewhere — the
  **Brass Key** it holds is what opens the boss gate.
- **Theming:** each dungeon has its own palette (per-floor), torch/shaft
  colors, and decor mix (`HOLE_THEMES`) — warm browns in the Warren, cold
  blues in the Deep, pale ash in the Hollow, mossy greens in the Drain.
- **Destructible decor:** mushrooms, dead trees, and stones smash for drops
  (`DECOR_LOOT`): mushrooms → shrooms/herb (60%), dead trees → herbs (50%),
  stones → **crystal** (55%). Bones burst for show only.

## Enemies

Eighteen kinds (`ENEMY_KINDS`), each with a distinct behavior and a
**telegraphed** attack — a readable windup crouch + body glow before anything
can hurt you. Each dungeon fields its own roster (`DUNGEON_MIX`); the harmless
**rat** potters through nearly every floor as free hide.

| Kind | HP | DMG | Speed | Behavior | Windup | Home |
| --- | --- | --- | --- | --- | --- | --- |
| **rat** | 2 | 0 | 3.4 | flee (harmless) | — | everywhere |
| **skitter** | 2 | 1 | 2.9 | swarm | 0.28s | Warren |
| **slime** | 4 | 1 | 1.9 | lunge | 0.50s | Warren |
| **goblin** | 5 | 1 | 3.0 | strafe | 0.34s | Warren |
| **wisp** | 3 | 1 | 3.2 | caster (band 4.5–7.5) | 0.55s | Warren |
| **archer** | 4 | 1 | 2.7 | archer (band 5–9) | 0.42s | Warren |
| **brute** | 12 | 2 | 1.6 | slam | 0.72s | (base kind) |
| **puddle** | 6 | 1 | 1.7 | lunge; splits into puddlings | 0.55s | Flooded Deep |
| **puddling** | 1 | 1 | 3.4 | swarm | 0.24s | Flooded Deep |
| **snapper** | 5 | 1 | 3.1 | strafe | 0.30s | Flooded Deep |
| **angler** | 4 | 1 | 2.6 | geyser (band 4–7) | 0.85s | Flooded Deep |
| **rattler** | 3 | 1 | 3.6 | swarm | 0.24s | Bone Hollow |
| **gravewisp** | 5 | 1 | 3.0 | caster (band 4.5–8) | 0.50s | Bone Hollow |
| **boneguard** | 9 | 2 | 2.0 | charger | 0.70s | Bone Hollow |
| **sporeling** | 2 | 2 | 3.3 | bomber (dies on blast) | 0.60s | Gloom Drain |
| **gloomcaster** | 5 | 1 | 3.0 | blinker (band 4–8) | 0.60s | Gloom Drain |
| **mossbrute** | 14 | 2 | 1.6 | slam | 0.75s | Gloom Drain |
| **boss** | 70 | 2 | 1.7 | boss | 0.78s | boss floors |

- Live max HP scales with depth: `hp + ⌊tier × 0.7⌋`.
- **Rats-only first floor:** the Warren's floor 1 spawns nothing but rats — a
  safe warm-up.
- **Spawn pacing:** floors start with `4 + floor + rand(0..2)` enemies, then a
  rolling spawner tops up toward a cap of `6 + 2×floor`, never closer than 9
  units to a player, never while off-screen mid-windup.
- **Contact stings:** touching any non-harmless enemy body deals damage (0.6s
  per-enemy cooldown), gated by your i-frames.
- Ranged foes fire pooled projectiles; deeper casters throw 3-orb fans.

## Bosses (one per dungeon)

Each boss floor is a sealed arena; the portcullis opens with a **Brass Key**.
The boss waits dormant until the gate is breached. All four share the boss
machine — a wide **slam** when hugged, an **enrage at half HP** (summoned
minion pack, 1.35× speed, tighter windups) — but each runs its own ranged
rotation, and three carry a **signature marked attack** that locks a glowing
ground mark at windup start (standing off the mark is the dodge):

- **Pounce** *(Broodmother)* — marks a ring at your feet, leaps exactly onto
  it; step off and she sails past.
- **Deluge** *(Drowned Maw)* — marks five splash zones (one under you) that
  erupt at once; one hit max per player.
- **Blink** *(Sovereign)* — marks a ripple at your side, teleports onto it,
  spits a 6-orb ring on arrival.

| Floor | Boss | HP* | Speed | Rotation | Enrage pack |
| --- | --- | --- | --- | --- | --- |
| 3 | **Broodmother of the Warren** | 58 | 2.25 | pounce, charge, pounce, burst | skitters |
| 6 | **The Drowned Maw** | ~138 | 1.25 | deluge, burst, deluge, charge (10-orb bursts) | puddlings + snapper |
| 9 | **Ogre King of the Hollow** | ~140 | 1.7 | charge, burst | rattlers + boneguard |
| 12 | **Sovereign of the Gloom** | ~155 | 2.0 | blink, burst, blink, charge | gloomcaster + sporelings |

\* After `bossDefFor(hole)` depth scaling: `hp × (1 + hole × 0.5)`, +1 DMG from
hole 2, faster and shorter-winded per hole, enrage pack of `3 + hole`.

**Death is a sequence, not a pop:** the body chars black while the arena fog
streams into the corpse, each mesh bursts in staggered pops, then a white
concussive flash — and only then the loot and the "…falls!" banner.

**Boss loot** is the only source of **gear**: two equipment pieces + a crown +
a potion + `3 + hole` picks from the dungeon's rare table, arcing out of the
corpse.

## Loot

Loot is per-dungeon (`DUNGEON_LOOT`), split into **common** and **rare**
pools:

| Dungeon | Common | Rare |
| --- | --- | --- |
| Rat Warren | meat, bread, caveshroom, crystal, jelly, egg | wsword, ring, fang |
| Flooded Deep | jelly, crystal, egg, potion | lantern, feather, gem |
| Bone Hollow | fang, bomb, key, ring, crystal | bell, ssword, crown |
| Gloom Drain | potion, crystal, gem, feather | star, hourglass, crown |

- **Enemy drops:** 60% base drop rate; 65% of drops are the kind's signature
  item, the rest roll the dungeon table. Rares never drop on a dungeon's entry
  floor; the chance climbs `0.12 + 0.06 × localFloor` below it.
- **Chests:** rare chance `0.22 + 0.18 × localFloor` — the reliable rare
  source.
- **Enemies drop no meaningful gold** — income comes from *selling*.
- Everything lands in the shared bag, to be shelved and sold up top.

## Player combat

Combat is **one strike — there is no combo system**. The current design
question is *how the strike is triggered*, so the input mode is selectable
(`combat-settings.js`, tuned live from the cheat panel, persisted to
`combat-settings.json`):

| Mode | Trigger |
| --- | --- |
| **Auto strike** (`strikeInPlace`, default) | A foe steps into range (2.2) → the hero plants and swings in place, on a 0.7s cooldown with a 0.5s windup telegraph |
| **Auto lunge** (`autodash`) | The hero auto-lunges at any foe inside range (2.4), cooldown-gated |
| **Tap to strike** (`joystickButton`) | While a foe is in range, a second-finger tap on the joystick centre strikes in place |
| *(swipe — in code, not in the picker)* | A quick joystick flick fires one dash in the flicked direction |

Shared tuning (`game.js`, `game-combat.js`):

- **Strike damage:** `4 × dmgMul` from gear, doubled on crit.
- **Dodge dash:** `0.24s` at speed 13 with i-frames (~0.36s); manual triggers
  (`Shift`, right-click, the on-screen button) work in every mode. A locked
  dash onto a target plants, coils, then whips through — chests are dash
  targets too.
- **Auto-aim** assists within 3.2 units and a ~80° facing cone.
- Crits and finishers cancel a non-boss mid-windup; bosses can't be
  stun-locked.
- **Feel:** hit-stop, camera shake, slash arcs, particle bursts — see
  [Audio & Visual](07-audio-visual.md).

## Healing

There is **no passive regen and no auto-heal**. HP comes back three ways:

- **Consumables** from the bag (mushrooms/herb/forage +1, bread/meat +2,
  potion +4) — each player heals their own hearts in co-op.
- **Returning home** fully heals.
- Base is **6 hearts**; gear can raise the cap.

## Death & recovery

At 0 HP you don't wipe the run — but the penalty depends on depth
(`SAFE_ZONE_FLOOR = 3` in `game-combat.js`):

- **Floors 1–3 (the Warren):** the clerk carries you home with your **bag
  intact** — a true beginner safe zone.
- **Deeper:** you're carried home but the **carried bag is lost**. Gold is
  never taxed — dying costs the haul, not the wallet.
- Either way: ~2.4s knockout, respawn in the shop at full HP.

## Co-op below

Host-authoritative PeerJS (see [Networking](../technical/03-networking.md)):
the host simulates enemies, bosses, and spawns; the guest sends intents
(`hit`, `take`, `chestReq`, `gateReq`, `stairsReq`, `dSmash`…) and mirrors
~11 Hz snapshots. Boss telegraphs are replayed to guests (`bossTel`) so the
ground marks read identically on both screens. One shared dungeon: the host
generates, the guest rides along (or gets a solo floor if the host is busy).
A partner on another floor doesn't count toward the fight.
