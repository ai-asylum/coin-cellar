# FTUE Script — "The End of the Road" (SUPERSEDED)

> **Superseded 2026-07-14** by `08-ftue-script-inheritance.md` ("What He
> Left"), now implemented in `src/game/game-narrative.js`. Kept for its
> graveyard and history.

> The first ten minutes: a cave, a closed door, a mad idea, and a trapdoor.

This was the implemented first-run script. It exists
as a doc because dialogue is a design surface: every line here survived a budget,
and every cut is recorded so it can be spent again later.

---

## The story in one paragraph

A drifter spelunks roadside caves for a living — dig by day, sell the bag, sleep,
repeat. The nearest village has been dying since its shopkeeper walked into the
cave at the end of the road a year ago and never walked out: no shop, no trade,
no reason to stay. The Mayor — the last person who refuses to leave — spots a
stranger with a full pack standing outside the dead shopfront and makes the
fastest decision of his career: *give the stranger the shop.* The stranger sells
one trinket, learns the pit at the back of their cave is the way down to the old
owner's "cellar," and — for the first time in a long while — wants more than
*enough*.

**The world's shape:** the cave where the road runs out is the dungeon's front
door, permanently. Its deepest point holds the descent into the cellar lobby
(the four dungeon mouths); the shop has no trapdoor. The game is played
portrait, so the whole town is turned to match: the rocky cave mouth caps the
TOP of the road (its maw facing the camera), the shop sits just below it with
its door on the up-street side and a roof that fades away while you're
inside, and the village runs down the screen with the ruined row along the
far side. Pit → till is a few steps, and every trip passes the
ruins. Dungeons generate on a tall grid too (18×32 cells, taller rooms), so
floors sprawl along the screen's long axis — and "deeper" is always
up-screen: road → cave → pit all continue the same walking direction.

**Theme: "enough."** The hero opens the game deciding they have enough
(*"That should be enough for today"*) and closes the FTUE deciding they don't
(*"…not anymore"*). Everything the game does afterward — deeper floors, more
shelves, more roofs — is that appetite growing. The two lines are the bookends;
nothing between them is allowed to say the theme out loud.

## The cast

| Who | What they are | How they talk |
| --- | --- | --- |
| **The Hero** ("Me") | A freelance spelunker at the bottom of the trade. | Dry, tired self-talk. Complains about their body, never about the world. Short. |
| **The Mayor** | The last optimist of a dying town. Desperation dressed as cheer. | Clipped sentences. Deals, not speeches. Opens with *"Ha!"* when pleased. Never explains what you can already see. |
| **The Old Shopkeeper** | Never seen. The sign, the shop and the cellar are all him. | Doesn't. That's the point — he's the hero's shadow and a future content hook. |

## Writing rules (why the Mayor got quiet)

1. **Budget taps like gold.** Every bubble is a tap the player didn't ask for.
   The whole core FTUE spends **14 bubbles** (was 21). No scene gives any speaker
   more than **3 in a row**.
2. **One idea per bubble, ≤ ~70 characters.** Mobile reading width; a bubble you
   can read in one glance is a bubble nobody resents.
3. **Show, don't say.** The ruins say the town died. The sign says the shopkeeper
   left. The guide arrow says what to do next. Dialogue only carries what the
   world can't.
4. **Actions replace lines.** "Follow me" is a walk, not a sentence. Unlocking
   the door *is* the signature on the deal.
5. **Mystery beats exposition.** *"He didn't dig that cellar for potatoes"* does
   more than three lines about dungeon economics ever could.
6. **Nothing is wasted.** Cut lines go to the graveyard (below) and come back as
   later-game dialogue, not FTUE padding.

## Tap budget

| Scene | Speakers | Bubbles |
| --- | --- | --- |
| 1 · The cave | Hero | 2 |
| 2 · The road | Hero | 1 |
| 3 · The shopfront | Sign + Hero + Mayor | 1 + 1 + 3 |
| 4 · The first sale (+ send-off) | Mayor + Hero | 3 + 1 |
| **Core total** | | **12** |
| (optional) rat kill | Hero | +1, once |
| (post-FTUE) first rebuilt home | Mayor | +2 |

---

## The script

### Scene 1 — The Cave

*Fade in on a long, narrow burrow, daylight at the far end. The hero wakes at
its deepest point, right beside the pit they've clearly just climbed out of. A
slime hops toward them; the hero walks up to meet it, then cuts it down in one
dash — its jelly pops into the pack. Two rats potter about, ignoring
everything. Control unlocks.*

> **ME** — Whew. That should be enough for today.
>
> **ME** — Now — where was that exit…

**→ GUIDE:** `Head for the daylight`

*(If the player dashes a rat, its hide pops into the pack — no line.)*

- **Trigger:** fresh solo save. The kill cinematic is scripted; input is locked
  until the first line.
- **Teaches:** the dash is the attack; loot goes in the bag; the light is the
  way. The pit gets no mention — it's Chekhov's hole, planted for Scene 4.

### Scene 2 — The Road

*The hero steps out of the rocky cave mouth that caps the top of the road.
The village opens up below; half the houses are dark. Banner: `The end of
the road`.*

> **ME** — Finally — a village. My back is killing me.

**→ GUIDE:** `Sell your haul here` *(arrow on the shop door)*

- **Trigger:** walking into the cave's daylight gap — the same walk-through
  that works both ways forever after (the cave is a permanent place, not a set).
- **Note:** the old second line ("someone will pay good coin…") is gone — the
  arrow says it better.

### Scene 3 — The Shopfront

*The hero reaches the door. It doesn't open.*

> **A DUSTY SIGN** — "CLOSED — gone diving. Don't wait up. — the management"
>
> **ME** — Closed?! You have GOT to be kidding me.

*The Mayor hurries over from up the street.*

> **THE MAYOR** — Don't bother, friend — he's been gone a year.
>
> **THE MAYOR** — You, though… full pack, strong back. I have a mad idea.
>
> **THE MAYOR** — The shop's yours. Rent-free. Help me wake this town up.

*No "follow me." He unlocks the door and walks in without waiting — the open
door is the invitation. He posts up just inside and watches.*

**→ GUIDE:** `Step inside`, then `Stock this table`

- **Trigger:** proximity to the door while the shop step is active.
- **Staging beats text:** the sign already told the shopkeeper's story, so the
  Mayor doesn't repeat it; the walk-in replaces the instruction.
- Crossing the threshold stows the pack into the storeroom automatically.

### Scene 4 — The First Sale & the Send-off

*The player lays one item on the first table. A villager walks in, beelines to
it, and pays sticker price — no haggle, the sale simply happens. The watching
Mayor lights up.*

> **THE MAYOR** — Ha! Sold already. You're made for this.
>
> **THE MAYOR** — Purse ever heavy? Spare a ruin a thought — I'll do the hammering.
>
> **THE MAYOR** — That pit in the cave? The old owner didn't dig it for potatoes. Go see.

*He tips his hat and sees himself out, off up the street. The hero, alone in
their shop for the first time:*

> **ME** — "Enough for today," huh… not anymore.

**→ GUIDE:** `To the cave — dive for stock` *(arrow down the road, then onto
the pit once inside)*

- **Trigger:** the scripted shopper's purchase lands (`_autoSell`).
- **Teaches:** stock → customer → coin, with zero mechanical burden. Haggling is
  deliberately *not* taught here — it arrives with the vitrine.
- **The rebuild ask is soft:** one line, no quest arrow, ever. The ruins
  themselves (and their `Restore` prompts after the FTUE) are the reminder —
  and every walk to the cave passes them.
- **The reveal is a dare, not a lecture:** "Go see." pays off the pit the
  player woke up next to; the arrow finishes the sentence. The FTUE completes
  on the first descent into the cellar lobby.

### Epilogue (post-FTUE, optional) — The First Roof

*The player has funded their first ruin — their own decision, no prompt. The
Mayor strolls up the road for a word.*

> **THE MAYOR** — Ha! A family already — would you look at that.
>
> **THE MAYOR** — Every roof you raise brings more custom through your door.

---

## The graveyard (cuts, and where they should come back)

| Cut line | Why it died | Where it can live again |
| --- | --- | --- |
| "Someone here will pay good coin for all this." | The guide arrow says it. | — |
| "Our shopkeeper ran off to the dungeon months ago and never came back." | The sign already said it. | Clerk or customer chatter. |
| "…you clearly know one end of a sword from the other." | Compressed into "full pack, strong back." | — |
| "Let's see what you can do. Follow me." | Became staging (he just walks in). | — |
| "When the shop closed, the town went with it — no trade, no work, no reason to stay." | Two lines of history for something the ruins show. | — |
| "Families packed up one by one; those houses have been empty since." | Same — folded into the ruins themselves. | — |
| "But a town is like a shop, friend — restock it, and the customers come back." | Lovely, but redundant next to the ask. | The Mayor's toast when the **last** lot is rebuilt. |
| "There's a whole dungeon under your floor." / "Keep the shelves full. I'll handle the rest." | Replaced by the potatoes line + "Go see." | — |
| "Every dark window here is a family that left." | Died with the overlook scene — a whole walk-outside beat for one (good) line. | The Mayor's praise visit, or ambient villager chatter. |
| The overlook scene itself (follow the Mayor to the ruins) | An extra escort beat between the sale and the dive; the road now passes the ruins anyway. | — |

## Future threads (planted, never resolved here)

- **The old shopkeeper.** Three breadcrumbs point down: the sign, "gone a year,"
  and the potatoes line. Long-term hook: traces of him deeper in the dungeon —
  his ledger as a rare drop, a second sign on a boss floor, or the man himself
  at the bottom. The FTUE must never explain him.
- **The "enough" echo.** Reusable at milestones — e.g. the first 1,000g:
  *"Is this enough? …No."*
- **Teaching the haggle.** First candidate: repairing the vitrine ("prized goods
  deserve a proper price — argue for it"). Second: a customer walks in *selling*.
- **The Mayor's desperation.** He never says the town is his life's failure;
  later dialogue (post-rebuild toasts) can let it slip.
