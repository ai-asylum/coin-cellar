# 01 — Core Loop

The game director (`src/game/game.js`) drives a repeating **day → night → dive →
sleep** cycle, gated by the Guild's debt calendar.

## The phases

The game tracks a `phase` of either `"day"` or `"night"`, plus a `playerArea` of
either `"shop"` or `"dungeon"`. These are independent: you can be in the dungeon
during the day phase, though the intended rhythm is dive at night.

```
┌──────────── MORNING ────────────┐
│ full heal → reset day timer      │
│ collect debt if a due day        │
│ fresh dungeon seed for the day   │
└──────────────┬───────────────────┘
               ▼
┌──────────────── DAY (phase="day") ──────────────┐
│ shop is open · customers arrive in waves         │
│ stock tables, haggle sells, buy from sellers     │
│ day timer counts down from 160s                  │
└──────────────┬───────────────────────────────────┘
               ▼ (timer hits 0 → nightfall)
┌──────────── NIGHT (phase="night") ──────────────┐
│ customers leave · shop closes                    │
│ choose: dive the cellar, or sleep               │
└──────────────┬───────────────────────────────────┘
               ▼
┌──────────────── DUNGEON (optional) ─────────────┐
│ procedural floors · combat · loot · descend      │
│ return home via the entrance portal any time     │
└──────────────┬───────────────────────────────────┘
               ▼ (walk to the bed)
┌──────────────── SLEEP ──────────────────────────┐
│ "good night" recap sheet (day's stats)           │
│ dungeon disposed · day++ · back to MORNING        │
└──────────────────────────────────────────────────┘
```

## Timing

- **Day length:** `DAY_LEN = 160` seconds (the shop phase timer). In co-op the
  host owns this clock; guests display the host's value.
- **Nightfall:** when the day timer reaches 0, the phase flips to `"night"`,
  customers are dismissed, and the trapdoor/bed become the meaningful actions.
- **New day:** advancing happens on **sleep** (walk to the bed), not automatically
  at midnight. This lets a player keep diving into the night before turning in.

## The calendar & debt

The day counter (`day`, starting at 1) is the campaign clock. Payments are due on
fixed days:

| Due on day | Amount |
| --- | --- |
| 3 | 180g |
| 6 | 450g |
| 9 | 1,100g |
| 12 | 2,400g |
| 15 | 5,200g |

On the morning of a due day the Guild collects. If you can't pay, it's **game
over**. Clearing all five is **victory** (with an optional endless continue).
Details in [Economy & Progression](04-economy-and-progression.md).

## Start of run

New game state (from `game.js`):

- **Day** 1, **phase** `"day"`
- **Gold** 100
- **HP** 6 / 6
- **Inventory** `caveshroom, caveshroom, herb, potion, wsword` (bag cap 10)
- **Debt index** 0 (next due: day 3)

## Morning housekeeping

Each morning the director:

1. Restores HP to full.
2. Resets the day timer to `DAY_LEN`.
3. Runs debt collection if the day matches the next installment.
4. Resets the **daily recap tally** (`today`) — gold earned, deals made, deepest
   floor reached, etc.
5. Ensures a **fresh dungeon seed** so the first dive of the day is a new layout.
   (The previous day's dungeon is disposed on sleep.)

## The dungeon is per-day

The cellar is regenerated each day. When you sleep, `dungeon.dispose()` runs and
the next dive rolls a fresh seed. You can descend multiple floors within one
night, but you can't "save your spot" across days — each new day is a fresh
crawl from floor 1.

## Death mid-loop

Dying in the dungeon doesn't end the run. You're carried home, lose **half your
gold**, HP is restored, and you respawn in the shop. See
[Dungeon & Combat](03-dungeon-and-combat.md).

## Single-player vs co-op pacing

- **Single-player:** the shop **auto-haggles** — when a customer settles at a
  spot, the haggle sheet pops open on its own with a short breather between deals,
  so you never have to walk over. This keeps a solo player from having to be in
  two places at once.
- **Co-op:** the manual walk-up flow is used instead (to avoid both clients
  auto-opening the same customer). One player typically stays up top to work
  customers while the other dives. See [Co-op](05-coop.md).
