# 09 — Town, NPCs & Building

The town is the third loop: gold goes in, customers come out. It's a portrait
street running down-screen from the cave mouth — shop at the top, the dojo
below, and a row of ruined lots waiting for roofs. Layout is authored in
`src/game/layout.json` (edited visually via `/editor.html`); people live in
`npc-data.js`; the money side in `game-economy.js`; the foreman in
`builder.js`.

## The street

From `layout.json`:

- **The shop** — see [Shop & Haggling](02-shop-and-haggling.md).
- **The cave** — the dungeon front door ([Dungeon & Combat](03-dungeon-and-combat.md)).
- **The dojo** — an open-fronted training hall: tatami deck, torii gate, paper
  lanterns (lit at night), three straw dummies, and the master. Dash through
  and the dummies tip, wobble, and spring back — **pure combat practice**, no
  fees, no rewards (`dojo.js`).
- **8 rebuildable lots** — 4 empty plots and 4 ruins, costing 100g to 9,500g.
- Meadow decor (billboard trees, bushes, flowers) that can be **foraged** for
  tier-1 heal items, plus hills and street lamps.

## Rebuilding (the builder)

Hiring the builder on a lot (`_dispatchBuilder`):

1. The lot's cost is charged **up front** and the restore is committed to the
   save immediately — a mid-build reload replays the finished house.
2. The foreman (Bruno's skin, always loitering by the lot row) walks over
   (`idle → toLot → building → toHome`), hammers for a couple of seconds with
   tap SFX, and the house pops up in a particle burst.
3. Banner: *"A new home! — a {archetype} family moves in."* The resident joins
   `townResidents`, which **quickens customer traffic** and weights the crowd
   toward their archetype (see [Shop & Haggling](02-shop-and-haggling.md)).
4. The **first** rebuilt home triggers the Mayor's praise cameo — his first
   appearance in the game (the FTUE is deliberately Mayor-free).

Lot residents step up in wealth with price: the 100g plot houses a Regular;
the 9,500g ruin houses a Collector.

## The townsfolk

**17 named residents** (Kenney variants b–r; the player is "a"), each with a
personality that fixes their voice, tastes, and shopper archetype:

Pip (peppy) · Barrow (cranky) · Tansy (normal) · **Nib the Clerk** (bookish,
reserved) · Rocco (jock, doubles as the dojo master) · Marlowe (smug) ·
Clementine (snooty) · Sunny (dreamer) · Ozzie (lazy) · Delphine (sisterly) ·
Gus (zen) · Vera (gossip) · Bruno (boastful, doubles as the builder) · Hazel
(foodie) · Silas (inventor) · **The Mayor** (pompous, reserved) · Maple
(outdoorsy).

`reserved: true` (Nib, the Mayor) keeps those skins out of the ambient crowd
so their scripted cameos — the clerk's safe-zone rescue, the Mayor's praise
visit — always land with the right face.

### What they say (~600 authored lines)

Talking to an NPC picks the highest-priority live topic
(`_talkToNpc` in `game-narrative.js`):

1. **First meeting** — a one-off two-bubble intro per NPC (`INTROS`).
2. **Player deeds** — reactions to a felled boss or a new depth record
   (`DEED_LINES`, per personality).
3. **Purchase reflections** — after shopping: loved it, impulse bought it,
   passed because pricey, or just passed (`REFLECTION_BUCKETS`, with bespoke
   per-item reactions in `SPECIAL_REACTIONS`), plus a **wish** hinting at
   their tastes.
4. **Occasion greetings** — real-calendar holidays (`OCCASIONS`): New Year,
   Valentine's, Easter (computed, Meeus algorithm), Halloween, Christmas,
   weekends, Mondays, Fridays — one greeting per NPC per occasion.
5. **Small talk** — 5 lines × 4 time-of-day buckets (morning 5–11, afternoon
   11–17, evening 17–21, night) per NPC.

Personalities also carry a `taste` table (food / weapon / gear / treasure
leanings plus a tier lean) that steers what they browse and buy — Hazel the
foodie really does buy the roast meat.

### Writing rule

Every player-facing line reads for a ten-year-old; character voice comes from
rhythm and what people choose to say, not vocabulary. (Rule 7 of the
[FTUE script](08-ftue-script-inheritance.md); it applies town-wide.)

## Narrative around the town

- The FTUE plants the premise — the uncle's note: *"Fill the tables and
  townsfolk will come… The town just needs fixing up."* The lots are that
  promise made playable.
- Cameos: the **clerk** (Nib) rescues you from safe-zone knockouts; the
  **Mayor** appears after your first rebuild; the **builder** and **dojo
  master** are residents with day jobs.
- There is **no quest system** — no tracked objectives beyond the FTUE. Deeds,
  reflections, wishes, and occasions are ambient flavor, not goals. (This is
  the design's biggest open space.)

## Persistence

`town` (restored lots), `tables` (repairs), and `npcMet` (intros already
played) all live in the save — see the
[Data Reference](../technical/04-data-reference.md#save-format).
