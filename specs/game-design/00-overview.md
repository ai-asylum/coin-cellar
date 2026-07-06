# 00 — Overview & Vision

## Elevator pitch

**Coin Cellar** is a mobile-first, co-op **dungeon-crawling shopkeeper** game.
Run a little item shop that happens to sit on top of a monster-filled cellar.
By day you stock display tables and **haggle** customers as close to their hidden
pay limit as you dare. By night you delve seeded procedural floors for the loot
you'll sell tomorrow. Every third day the merchant Guild collects on an
escalating debt — pay all five installments and the deed is yours; miss one and
you lose the shop.

The co-op twist: one player minds the shop while the other delves. Gold, stock,
and debt are all shared.

> **North star:** *Recettear: An Item Shop's Tale.* "Capitalism, ho!"

## Design pillars

1. **Two verbs, one economy.** *Delve* (get merchandise) and *Deal* (turn it into
   gold) are separate skill loops that feed the same wallet. Neither works alone:
   loot is worthless unstocked, and an empty dungeon starves the shop.
2. **Haggle as a minigame, not a menu.** Selling is a nerve game against a hidden
   number — push for a *Perfect Deal*, or play safe. The tension is reading the
   customer, not clicking "sell."
3. **Readable risk.** Every enemy attack **telegraphs** before it can hurt you.
   Death is a setback (lose half your gold), not a wipe. Dungeon depth trades
   danger for shinier loot tiers.
4. **Debt as a metronome.** The Guild's every-third-day collection paces the
   whole campaign, converting "I made some gold" into "am I on track?"
5. **Cheap on the device, rich on screen.** No shadow maps, capped pixel ratio,
   procedural audio, and blob-shadow sprites keep it smooth on phones while a
   toon+rim+outline look keeps it charming.
6. **Zero-asset where possible.** Dungeon layouts, item props, floor textures,
   monsters, and all sound are generated at runtime. (Human characters use a CC0
   art pack — see [Character Generation](../technical/02-character-generation.md).)

## Target platform & audience

- **Platform:** Web browser, **mobile-first** (touch), also playable on desktop.
- **Delivery:** Fully static build (`vite build` → `dist/`), hostable anywhere.
- **Session length:** A day's shop phase runs ~160 seconds; a full 15-day
  campaign is a short sitting. Pick-up-and-play friendly.
- **Audience:** Fans of cozy-but-tense shop sims and light action roguelites;
  couch/remote co-op pairs.

## The player fantasy

You are a scrappy shopkeeper-adventurer in debt. The fantasy blends two power
trips: the **merchant** who fleeces a collector for triple base value with a
perfect pitch, and the **delver** who dodges a brute's overhead slam and walks
out with a Dawn Gem. The game is at its best when the same run swings between
both — a great haggle funds a deeper delve, which funds the next debt payment.

## References & inspiration

- **Recettear: An Item Shop's Tale** — the core loop, haggle grades, debt pressure.
- **Moonlighter** — dungeon-by-night / shop-by-day structure.
- Classic top-down action-RPG combat (telegraph → dodge → punish) for the delve.

## Scope snapshot (current build)

- 15-day debt campaign with 5 escalating payments; optional endless mode after.
- 25 merchandise items across 4 value tiers.
- 6 enemy kinds with distinct behaviors across 5+ floor mixes.
- 4 customer archetypes, buy **and** sell (reverse-haggle) customers.
- 1–2 players (single-player auto-haggles; co-op is manual, host-authoritative).
- Three entry points: the game, a **creature lab**, and an **admin catalogue**.

See the [Core Loop](01-core-loop.md) next.
