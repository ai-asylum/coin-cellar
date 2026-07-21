# 01 — Core Loop

There is no day timer, no debt calendar, and no fail state. The shop is always
open, the world's light follows the player's **real clock**, and the loop is
paced by appetite and the 3-hour dungeon-shortcut window rather than a
schedule. The director is `src/game/game.js`, split across `game-*.js` mixins.

## The loop

```
┌────────────── TOWN (always open) ─────────────────┐
│ stock tables from the storeroom                    │
│ plain tables sell at sticker · vitrine haggles     │
│ talk to townsfolk · hire the builder · repair      │
└──────────────┬─────────────────────────────────────┘
               ▼ (walk to the cave, pick a mouth)
┌────────────── DIVE ───────────────────────────────┐
│ seeded floors, bottom → top · fight · loot · chest │
│ every 3rd floor: boss arena (Brass Key gate)       │
│ boss kill → next dungeon + 3h cave shortcut        │
└──────────────┬─────────────────────────────────────┘
               ▼ (up-stairs → confirm)
┌────────────── RETURN ─────────────────────────────┐
│ bag whooshes into the storeroom · full heal        │
│ back to the street — sell, build, dive again       │
└────────────────────────────────────────────────────┘
```

Three sub-loops feed one wallet:

- **Deal:** merchandise → gold (see [Shop & Haggling](02-shop-and-haggling.md)).
- **Dive:** gold's raw material (see [Dungeon & Combat](03-dungeon-and-combat.md)).
- **Build:** gold → more shelf slots and more townsfolk, i.e. more customers
  (see [Town, NPCs & Building](09-town-npcs-and-building.md)).

## Real time, not game time

- **Lighting is the clock.** Sky, fog, lamps, and god-ray tints interpolate a
  24-hour palette off the system clock (`sampleDayClock` in `shop.js`) —
  morning looks like morning. Underground is always torchlit.
- **NPCs keep your hours.** Small talk keys off morning / afternoon / evening
  / night buckets, and holiday **occasions** (New Year, Valentine's, Easter,
  Halloween, Christmas, weekends…) fire on the real calendar
  (`npc-data.js`).
- **Music follows.** Town/shop/menu themes have morning/day/night variants.
- **Shortcuts are wall-clock.** A cave mouth unsealed by beating the boss
  above it stays open for **3 real hours** (`SHORTCUT_TTL_MS`), then relocks.
  This is the only timer in the game, and it's an *invitation* to return, not
  a punishment.

## What `day` means now

`this.day` is a **run counter** — it bumps on each fresh solo delve and feeds
dungeon variety. It is not displayed and gates nothing. Dungeon layouts are
seeded by `daySeed()` (a UTC-day seed), so everyone diving on the same
calendar day sees the same floors — and co-op peers agree for free.

## Start of run

New game state (`game.js`):

- **Gold** 100 · **HP** 6/6 hearts · bag `caveshroom, meat` (cap 10)
- **Storeroom** (stash) empty, uncapped — only the carried bag is limited
- **Equipment** empty (unarmed halves damage until a sword is equipped)
- One free display table; everything else awaits repair
- Shortcut mouths: only the Rat Warren open
- A fresh save starts the ["What He Left" FTUE](08-ftue-script-inheritance.md)

## Death mid-loop

Dying never ends anything (see [Dungeon & Combat](03-dungeon-and-combat.md)):
floors 1–3 are a safe zone (the clerk carries you home, bag intact); deeper,
the carried bag is lost. Gold is never taxed. You respawn in the shop at full
HP.

## Single-player vs co-op pacing

- **Single-player:** plain tables auto-sell at sticker price, so the shop
  earns while you dive; only vitrine sales (the haggles) want you behind the
  counter.
- **Co-op:** one shared wallet, bag, and storeroom. The natural split — one
  keeps shop, one dives — is encouraged, not enforced. See [Co-op](05-coop.md).
