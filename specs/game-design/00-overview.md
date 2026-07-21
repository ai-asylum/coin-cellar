# 00 — Overview & Vision

## Elevator pitch

**Coin Cellar** is a mobile-first, co-op **dungeon-crawling shopkeeper** game.
You inherit a shut shop, a dying town, and a cave with four monster-filled
dungeons under it. Dive the cellar for loot, shelve it, sell it — plain goods
sell themselves off the tables, prized goods get **haggled** at the counter as
close to the customer's hidden pay limit as you dare — then pour the gold back
into the town: repair tables, rebuild ruined houses, and watch the townsfolk
(your customers) move back in.

There is **no debt, no timer, and no game over**. The world runs on the
player's real clock — morning light at breakfast, lamplight at night, holiday
greetings on actual holidays. The pressure is appetite, not a deadline.

The co-op twist: one player minds the shop while the other dives. Gold and
stock are shared.

> **Roots:** *Recettear: An Item Shop's Tale* ("Capitalism, ho!") and
> *Moonlighter* for the dive/deal spine — drifted toward *Animal Crossing* in
> temperament: a cozy, no-fail town you keep coming back to.

## Design pillars

1. **Three verbs, one wallet.** *Dive* (get merchandise), *Deal* (turn it into
   gold), *Build* (turn gold into a livelier town — which means more and
   richer customers). Each loop feeds the next; none works alone.
2. **Haggle as a minigame, not a menu.** Vitrine sales are a nerve game
   against a hidden number — push for a *Perfect Deal* or play safe. Plain
   tables sell at sticker so the shop runs itself when you'd rather be
   diving.
3. **Readable risk.** Every enemy attack **telegraphs** before it can hurt
   you. Death costs the bag you were carrying, never your gold — and the
   first dungeon is a true safe zone where the clerk carries you home, haul
   intact.
4. **The world keeps your hours.** Lighting, NPC small talk, and seasonal
   occasions key off the real system clock; dungeon shortcuts stay open for
   three real hours. The game meets the player's day instead of imposing one.
5. **Cheap on the device, rich on screen.** No shadow maps, capped pixel
   ratio, blob-shadow sprites, instanced walls — smooth on phones, with a
   toon+rim+outline look that keeps it charming.
6. **Procedural where it counts.** Dungeon floors, item props, monsters, and
   textures are generated at runtime; humans use a CC0 art pack. (See
   [Character Generation](../technical/02-character-generation.md).)

## Target platform & audience

- **Platform:** Web browser, **mobile-first portrait** (touch), also playable
  on desktop; packaged for **Android via Capacitor**.
- **Delivery:** Static Vite build, deployed on Vercel.
- **Session shape:** open-ended drop-in sessions — a dive, a few sales, a
  rebuild, done. The 3-hour shortcut window gives return visits a natural
  rhythm.
- **Audience:** fans of cozy shop sims and light action roguelites;
  couch/remote co-op pairs.

## The player fantasy

You are the **heir**. An uncle you never met left you a shop at the end of the
road, and the FTUE's bookends frame everything after: *"Let's go see what you
left me"* → *"So that's what you really left me."* The fantasy blends three
power trips: the **merchant** who reads a Collector perfectly, the **diver**
who steps off the Broodmother's pounce ring and walks out with a Dawn Gem, and
the **founder** who watches a family move into a house they paid for. See
[FTUE: What He Left](08-ftue-script-inheritance.md).

## Scope snapshot (current build)

- **4 themed dungeons × 3 floors**, a boss crowning each; 18 enemy kinds.
- **36 items** across 4 value tiers, including gear (swords equippable today;
  bows/staves/armor held back for balance).
- **17 named townsfolk** with personalities, first-meeting intros, time-of-day
  small talk, purchase reflections, and real-calendar holiday greetings.
- **13 display slots** (5 tables + a haggle vitrine), unlocked by repair.
- **8 rebuildable house lots** (100g → 9,500g) that repopulate the town.
- **1–2 players** (PeerJS co-op) plus a Supabase-backed shared-world lobby
  (presence, friends, chat).
- Entry points beyond the game: a **creature lab**, an **admin catalogue**,
  a **world editor**, and a standalone **cooking prototype**.

See the [Core Loop](01-core-loop.md) next.
