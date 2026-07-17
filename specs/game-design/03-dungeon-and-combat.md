# 03 — Dungeon & Combat

The cellar is the merchandise pipeline: a seeded, procedurally generated dungeon
you crawl for loot to sell tomorrow. Logic lives in `src/game/dungeon.js`; player
combat glue lives in `src/game/game.js`.

## Where the dungeon lives

The dungeon and shop coexist in **one Three.js scene**. The dungeon is built at a
world offset (`DUNGEON_ORIGIN = (200, 0, 0)`), far from the shop at the origin.
Moving between them is a camera reframe + an area flag flip (`playerArea`), not a
scene swap. See [Engine & Rendering](../technical/01-engine-and-rendering.md).

## Floor generation

Each floor is built deterministically from a `(floor, seed)` pair — the same pair
produces the same layout, which is how co-op peers stay in sync by sharing only
those two numbers.

- **Grid:** 17 × 15 cells, 2.4m per cell (`CELL = 2.4`).
- **Rooms:** 5–8 non-overlapping rooms.
- **Corridors:** 2-cell-wide, L-shaped, connecting rooms via a minimum spanning
  tree (Prim's) plus a few extra links for loops.
- **Walls:** instanced boxes with slight per-cell height jitter.
- **Floor:** a procedurally generated canvas tile texture.
- **Fixtures:** an **entrance portal** (room 0, returns you home), a **stairs
  down** (last room, descends a floor), **1–2 chests**, god-ray light shafts, and
  crystal torches.

## Descending

Deeper floors are riskier and richer. The **tier** scales with depth, gating both
which enemies appear and which loot can drop. Stairs go down; there's no going
back up except home via the entrance portal.

- **Enemy count per floor:** `4 + floorN + random(0..2)`.
- **Arrival grace:** on entering a new floor you get `LEVEL_INVULN = 1.8s` of
  damage immunity so you don't spawn into a hit.

## Enemies

Six kinds, each with a distinct **behavior** pattern and a **telegraphed** attack.
Every attack has a windup (the readable tell) before it can hurt you — that
window is what you dodge into.

| Kind | HP | DMG | Speed | Behavior | Windup | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **skitter** | 2 | 1 | 2.9 | swarm | 0.28s | Fast erratic; darts in, quick bite, backs off. 4 or 6 legs |
| **slime** | 4 | 1 | 1.9 | lunge | 0.50s | Slow, but telegraphs a leaping lunge that closes distance |
| **goblin** | 5 | 1 | 3.0 | strafe | 0.34s | Circles the player, darts in with a quick slash |
| **wisp** | 3 | 1 | 3.2 | caster | 0.55s | Keeps distance (band 4.5–7.5), hurls a homing-ish orb |
| **archer** | 4 | 1 | 2.7 | archer | 0.42s | Kites at range (band 5–9), fires a fast straight bolt |
| **brute** | 12 | 2 | 1.6 | slam | 0.72s | Slow; winds up a wide overhead slam that hits everything near |

Ranged foes (wisp, archer) fire pooled projectiles; contact/overlap with any
enemy body can also deal damage.

### Floor enemy mixes

Which kinds can spawn is set by the floor's tier (`FLOOR_MIX`):

| Tier / depth | Possible enemies |
| --- | --- |
| 1 | skitter, slime |
| 2 | skitter, slime, goblin |
| 3 | slime, goblin, wisp, archer |
| 4 | goblin, wisp, archer, brute |
| 5+ | goblin, archer, wisp, brute, brute (brute weighted) |

## Bosses (one per sewer hole)

The final floor of every run is a sealed arena whose gate opens with a Brass
Key. Each sewer hole crowns its dungeon with its **own boss** (`BOSSES` in
`dungeon.js`, indexed by hole). All four share the boss behavior machine — a
wide **slam** when you hug them, plus an **enrage** at half HP (faster
patterns + a summoned minion pack) — but each fights its own ranged rotation,
and three have a **signature attack** that locks a glowing ground mark at
windup start (standing off the mark is the dodge):

- **Pounce** *(Broodmother)* — marks a ring at your feet, then leaps exactly
  onto it; contact during the flight hurts, stepping off makes her sail past.
- **Deluge** *(Drowned Maw)* — marks five splash zones (one under you) that
  all erupt at once; one hit max per player.
- **Blink** *(Sovereign)* — marks a ripple at your side, teleports onto it and
  spits a tight 6-orb ring on arrival; roll through the gaps.

| Hole | Boss | HP | Speed | Ranged rotation | Enrage pack | Look |
| --- | --- | --- | --- | --- | --- | --- |
| Rat Warren | **Broodmother of the Warren** | 58 | 2.25 | pounce, charge, pounce, burst | skitters | giant rust skitter |
| Flooded Deep | **The Drowned Maw** | 92 | 1.25 | deluge, burst, deluge, charge (10-orb bursts) | slimes | mountain of blue ooze |
| Bone Hollow | **Ogre King of the Hollow** | 70 | 1.7 | charge, burst | skitters + slime | the classic ashen ogre |
| Gloom Drain | **Sovereign of the Gloom** | 62 | 2.0 | blink, burst, blink, charge (fast orbs) | wisp, skitter, slime | swollen marsh-light |

(+1 HP from the boss-floor tier bonus in play.) Per-attack windups scale off
each boss's base windup, so the quick bosses telegraph quicker. Boss name
drives the HP bar, the "seal breaks" awakening banner, the enrage banner and
the defeat fanfare. The tutorial's private cellar has no boss floor; its
fallback def is the Ogre King of the Cellar. Beating a boss spawns the return
portal home.

## Loot

- **Enemy drops:** killing an enemy can drop **merchandise** appropriate to the
  floor's tier (drawn from `LOOT_BY_TIER`). Enemy definitions also carry a `gold`
  range, but the design intent is that real income comes from *selling* loot in
  the shop, not from kills.
- **Chests:** each opened chest drops 1–2 tier-appropriate items (with a chance of
  a second, slightly lower-tier drop).
- Everything you pick up goes into the shared bag (cap 10), to be shelved and sold
  the next day.

See [Data Reference](../technical/04-data-reference.md) for exact enemy
and loot tables.

## Player combat

Tuning from `game.js`:

- **3-hit melee combo:** light (2 dmg) → light (2 dmg) → finisher (4 dmg, wider
  arc). Combo resets if you wait too long between swings.
- **Crits:** 18% chance (`_critChance = 0.18`) to double a hit's damage.
- **Dodge roll:** a dash burst (`_dashSpeed = 13`, duration `_dashDur`) with
  i-frames, on a short cooldown. Roll through telegraphs to punish the recovery.
- **Aim:** on desktop the swing aims toward the mouse; on touch it aims in the
  movement direction.
- **Feel:** hits land with hit-stop (brief time-scale dip), camera shake, a slash
  arc VFX, and particle bursts. See [Audio & Visual](07-audio-visual.md).

## Death & recovery

At 0 HP you don't wipe the run:

- You're carried home and respawn in the shop.
- You **lose 50% of your gold**.
- HP is restored to full.

This keeps a bad dive costly but recoverable — the pressure is the debt clock,
not permadeath.
