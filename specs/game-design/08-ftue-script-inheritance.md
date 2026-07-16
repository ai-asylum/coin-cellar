# FTUE Script — "What He Left"

> The first ten minutes: a locked door, a key in the bag, and what he really
> left.

**Status: IMPLEMENTED** (2026-07-14; supersedes `08-ftue-script.md`.
**Revised 2026-07-15: the Mayor is out of the FTUE** — a key in the backpack
and a note on the table carry his beats; his first appearance is now the
post-FTUE rebuild visit). The editable script lives in `FTUE_SCRIPT.md` at
the repo root — keep it, this doc, and `src/game/game-narrative.js` in sync.
The five tutorial beats and all their triggers are shared with the old
script (`exit → shop → stock → sell → delve`); only the fiction, dialogue,
and guide texts changed.

---

## The story in one paragraph

The shopkeeper at the end of the road walked into his cave a year ago and
never walked out. Declared gone, his estate goes looking for kin and finds
exactly one: a working spelunker who now owns a shop they've never seen in a
town they've never heard of. The hero travels out and discovers the road to
their inheritance ends at a cave mouth — the only way into this town is
*through*. They camp at its deep end and wake beside a shut trapdoor they
don't give a second glance. They walk out, find the shop shut — and remember
the key that came with the will, riding in their bag the whole way. The gates
swing open on a note the uncle left on the first table: fill the tables,
wake the town. One trinket sells; the guide arrow points back at the cave
for more; and the trapdoor the hero slept beside swings open when they
return. Nobody ever says what's down there. The hero goes anyway. Nobody
else appears in the whole FTUE — the inheritance explains itself.

**The world's shape:** unchanged — the cave caps the top of the road, the
shop sits just below it, the ruins line the walk, the pit in the cave's
deepest point is the permanent way down.

**Theme: "what he left."** The hero opens the game thinking the bequest is a
shop (*"Let's go see what you left me"*) and closes the first sale suspecting
it's something more (*"So that's what you really left me"*). The trapdoor
answers the line wordlessly on the return trip. Everything the game does
afterward — deeper floors, more shelves, more roofs — is the hero measuring
the true size of the inheritance. The two lines are the bookends; nothing
between them says the theme out loud.

**The engine change from the old script:** the drifter was passive — handed a
shop, handed a sale, handed a dare. The heir *chose* to come, owns the shop
by right, and goes back down for a reason that is theirs.

**The 2026-07-15 change: nobody welcomes the heir.** The Mayor's FTUE beats
felt weird in play — a stranger materializing to hand over what's already
yours. So the welcome is now entirely *things the uncle left*: the key rides
in the backpack from the first frame (openable, visible, unthrowable) and is
consumed the moment it opens the gates; a note on the first table carries the
pitch. The FTUE has one on-screen human: the hero.

## The cast

| Who | What they are | How they talk |
| --- | --- | --- |
| **The Hero** ("Me") | A working spelunker; the shopkeeper's only kin. Never met him — a will changed their address. | Dry, tired grumbling — the road, the stone, the town, never a person. Talks *to* the absent uncle: two touches, opening and closing. |
| **The Note** | The uncle's handwriting on the first table, though nobody says so. Two lines: the whole pitch. Speaks with the uncle's sepia, burnt-edged bust beside the bubble. | Plain instructions. It's the closest the uncle comes to speaking — on paper, never in person. |
| **The Uncle** (the Old Shopkeeper) | Never met, never named on-screen — glimpsed once, as the paper-toned figure beside his note. The key, the shop, the note and the pit are all him. | In person: doesn't. That's the point — he's the hero's blood *and* the hero's shadow, and a future content hook. |
| **The Mayor** | Cut from the FTUE (2026-07-15). Still in the game: his first appearance is the praise visit after the player's first ruin rebuild. | Clipped sentences. Opens with *"Ha!"* when pleased. |

## Writing rules

Carried over: budget taps like gold (no speaker > 3 bubbles in a row), one
idea per bubble ≤ ~70 chars, show don't say, actions replace lines, mystery
beats exposition, nothing is wasted (cuts go to the graveyard).

**Rule 7 — a ten-year-old reads every line.** Plain words, no archaisms, no
literary phrasing ("kin," "stood dark," "in the blood," and eventually the
whole "gone delving" sign died to this rule). Character voice comes from
rhythm and what people choose to say, not from vocabulary.

**Rule 8 — one pointer at a time.** Arrows wait for the dialogue bar to
clear, and the bag arrow and the world arrow never share the screen. If two
things want the player's eye, the second one queues.

## Tap budget

| Scene | Speakers | Bubbles |
| --- | --- | --- |
| 1 · The cave | Hero | 2 |
| 2 · The road | Hero | 1 |
| 3 · The shopfront | Hero | 1 |
| 3½ · The note | The Note | 2 |
| 4 · The first sale (+ send-off) | Hero | 3 |
| **Core total** | | **9** |
| (optional) rat kill | Hero | +1, once |
| (post-FTUE) first rebuilt home | Mayor | +2 |

Three bubbles under the old script's 12, zero spoken by another person, and
Scene 4 sits right at the 3-in-a-row ceiling.

---

## The script

The dialogue below is the source of truth's mirror — edit `FTUE_SCRIPT.md`,
then sync here and in code.

### Scene 1 — The Cave

*Fade in on the long, narrow burrow, daylight at the far end. The road to the
inheritance ran out at a cave mouth on the far side, so the hero camped at the
tunnel's deep end — right beside the shut trapdoor. They wake; a slime hops
toward them; the hero walks up to meet it and cuts it down in one dash; its
jelly pops into the pack, already full from the digs along the road here. Two
rats potter about. Control unlocks.*

> **ME** — Is this cave REALLY the only way to this town?
>
> **ME** — Alright, uncle. Let's go see what you left me.

**→ GUIDE:** `Head for the daylight`

*(If the player dashes a rat, its hide pops into the pack — no line.)*

- **Trigger:** fresh solo save. The kill cinematic is scripted; input is
  locked until the first line.
- **Teaches:** the dash is the attack; loot goes in the bag; the light is the
  way.
- **Dramatic irony, planted:** the hero slept beside the very trapdoor their
  uncle went down. Neither the hero nor the player knows. The pit gets no
  mention — Chekhov's hole, paid off wordlessly when the trapdoor opens on
  the FTUE's return trip.
- **The grumble is load-bearing.** Yes, the cave really is the only way — the
  line states the world's shape (the cave is the town's front door, forever)
  as a complaint instead of a lecture, and it explains the dying town in the
  same breath: a place the world can only reach through a cave is a place the
  world forgot.

### Scene 2 — The Road

*The hero steps out of the rocky cave mouth that caps the top of the road.
The village opens up below; half the houses are dark. Banner: `The end of
the road`.*

> **ME** — So that's the town? Smaller than I thought.

**→ GUIDE:** `Inspect` *(arrow on the shop door)*

- **Trigger:** walking into the cave's daylight gap — unchanged.
- The ruins carry the town's history; the hero's one line only carries the
  disappointment. The guide arrow says "Inspect" rather than naming the shop
  as theirs — the player discovers what the building is by walking up to it.

### Scene 3 — The Shopfront

*The hero reaches the door. It doesn't open — and the hero already knows why
they came prepared.*

> **ME** — Time to use the key that uncle left me.

*The hero stays rooted on the step. Once the line clears, the backpack
pulses under a bouncing arrow — "Open the backpack" — and the player turns
the key themselves: open the bag, hit `Use` on the Shop Key. The gates
swing open and consume it. The turning key is the reading of the will:
nobody hands the shop over, because it was already theirs.*

**→ GUIDE:** the bag arrow (`Open the backpack`), then `Step inside`

- **Trigger:** proximity to the door while the shop step is active — radius
  tightened from 2.3 to 0.9, so the scene fires only when the player walks
  right up onto the door step, not from halfway across the street.
- One bubble, then the player's own hands. Movement freezes (the same gate a
  dialogue uses) until the key is used — the bag stays openable, because the
  bag *is* the step. Needing the bag is what teaches the bag button; the key
  has been visible in it since the first frame.
- The key is a quest prop: no price, no Drop — its bag row carries exactly
  one action, `Use`, and only at this beat. Using it unlocks the gates and
  consumes it. It can't be thrown away, sold, or carried past this scene.
- Crossing the threshold no longer stows the pack — the doors swing shut
  behind the heir, and the note comes first (Scene 3½).

### Scene 3½ — The Note

*First step inside: the doors shut behind the heir. On the first table lies
the note — a real prop, arrow on it (`Take the note`). Walking up picks it
up like any drop; the backpack pulses again — arrow only, no label, the
player knows this dance now — and the hero stays put until the note is
read from the bag (`Read`).*

> **THE NOTE** — Fill the tables and townsfolk will come to buy.
>
> **THE NOTE** — They're nice people. The town just needs fixing up.

**→ GUIDE:** `Take the note`, the bag arrow, then `Stock this table`

- **Trigger:** the prop spawns (and the doors close) on the first step
  inside; the pickup is plain proximity, like floor loot; the reading is
  the note row's `Read` action in the bag.
- The shut doors make the moment private — the town waits outside while the
  heir reads. Reading consumes the note, reopens the doors for business,
  and *only then* moves the haul to the storeroom: "fill the tables" lands
  first, then the goods to do it with appear.
- The key beat taught the bag with a label; the note beat repeats it without
  one — the second rep is the test.
- Line one is the loop; line two is the *want* — the uncle vouching for the
  townsfolk and pointing at the shabby roofs in the same breath. It plants
  the rebuild meta as a feeling ("someone should fix this up") long before
  the rebuild UI exists for the player. It replaces the Mayor's "I'll show
  you the ropes," and it's better: instructions from the uncle are
  *inheritance*, not charity.
- The bubble's bust is the uncle himself (`characters/uncle-portrait.png`):
  a sepia, paper-toned figure with burnt edges, like the note he wrote on.
  It's the game's only glimpse of him — never in the flesh, only as the
  note's voice. First and only speaker in the FTUE besides the hero.

### Scene 4 — The First Sale & the Send-off

*The player lays one item on the first table. A villager walks in, beelines to
it, and pays sticker price — no haggle. The hero, alone in their shop for the
first time:*

> **ME** — ...So that's what you really left me.
>
> **ME** — I'll need to get used to this new life...
>
> **ME** — But first, let's do some restocking!

**→ GUIDE:** `To the cave — delve for more loot` *(arrow down the road, then
`Delve here for more loot` on the pit once inside)*

- **Trigger:** the scripted shopper's purchase lands (`_autoSell`) — unchanged.
- **Teaches:** stock → customer → coin, zero mechanical burden. Haggling still
  arrives later, with the vitrine.
- No praise, no applause — the coin is the praise. The resolve line lands a
  beat after the sale, once the hero has the shop to themselves (they always
  did).
- Three bubbles, one arc: the theme (the bookend line), the settling
  ("this new life" quietly accepts the inheritance), and the turn back to
  work — "let's do some restocking!" is the hero giving *themselves* the
  delve order, so the guide arrow that follows is their own intent, not a
  tutorial's.
- **The pit is never mentioned by anyone.** The guide arrow leads the player
  back for loot, and the trapdoor swinging open on arrival is the reveal —
  show don't say, taken all the way. The resolve line lands on the shop and
  the first coin; the trapdoor retroactively answers it.
- The FTUE completes on the first descent into the cellar lobby — unchanged.

### Epilogue (post-FTUE, optional) — The First Roof

*Still in code (`MAYOR_PRAISE_LINES`), currently cut from `FTUE_SCRIPT.md` —
kept here until that's decided. Fires after the player funds their first
ruin rebuild:*

> **THE MAYOR** — Ha! A family already — would you look at that.
>
> **THE MAYOR** — Every roof you raise brings more custom through your door.

---

## The graveyard (cuts, and where they can live again)

The old script's graveyard (`08-ftue-script.md`) carries over untouched.
Cuts from the rewrite and its editing passes:

| Cut line | Why it died | Where it can live again |
| --- | --- | --- |
| "Whew. That should be enough for today." | The "enough" theme belonged to the drifter. | A late-game milestone echo, if "enough" ever earns its way back. |
| "Now — where was that exit…" | The guide arrow says it. | — |
| "Finally — a village. My back is killing me." | Scene 1's grumble carries the complaining now. | Post-delve self-talk. |
| "Closed?! You have GOT to be kidding me." | The heir isn't surprised, just tired. | A regular customer rattling the door if the shop's left unattended. |
| THE SIGN: "CLOSED — gone delving. Don't wait up. — the management" | One less tap; the uncle's story moved fully off-screen. | The best grave here: a *second* sign deep in the dungeon lands harder if the player never saw a first. |
| "'Gone delving.' A year, and that's all you wrote?" | Died with the sign. | Hero self-talk on finding the uncle's traces below. |
| "…the only way to this stupid TOWN?" | "Stupid" softened in the edit pass. | — |
| "Smaller than the paperwork made it sound." | Plainer is better; the will can stay a background fact. | — |
| "Don't bother, friend — he's been gone a year." / "…I have a mad idea." / "The shop's yours. Rent-free." | The whole Mayor-as-benefactor beat: the shop was never his to give. | — |
| "Open it up — this town needs a shop." | Became "I'll show you the ropes" — welcome beats ask. | The revival ask can move to the epilogue visit. |
| "Ha! Sold already. You're made for this." | "Made for this" became "it runs in the family." | — |
| "Purse ever heavy? Spare a ruin a thought — I'll do the hammering." | The ruin ask left the FTUE entirely. | Natural home: the Mayor's first post-FTUE visit (the epilogue), once the player has coin. |
| "That pit in your cave? He called it his 'cellar.' Go see." | The reveal moved from dialogue to staging — the trapdoor opens on the return. | Keep "cellar" in the town's mouth: Mayor or villager chatter later (it's the title). |
| "That pit in the cave? The old owner didn't dig it for potatoes. Go see." | Same beat, drifter flavor. | The potatoes joke still deserves a second life — villager chatter, deeper in. |
| "'Enough for today,' huh… not anymore." | The bookend swapped for "what you really left me." | — |
| "Ha! You look just like him! You must be his family." | The whole FTUE Mayor died 2026-07-15 — a stranger hurrying over to hand you what's already yours read weird in play. | The recognition beat is too good to lose: the Mayor's post-rebuild visit, or the first regular customer. |
| "The shop is yours now, I'll show you the ropes." | Same cut; the uncle's note shows the ropes now. | — |
| "Ha! Sold already! It runs in the family." | Same cut; the first coin is its own praise. | Villager chatter once regulars exist — it pays off "just like him" wherever that line lands. |
| "Ugh... looks like it's closed." | One less tap — the deny thunk and the shut doors already say it, and the heir brought the key. | A regular rattling the door if the shop's ever left unattended (shares the grave with "Closed?! You have GOT to be kidding me."). |
| "Wait — uncle left me a key. It's in my bag." | Folded into "Time to use the key that uncle left me." — acting beats remembering. | A hint toast if players stall at the door. |
| "The more you sell, the more this town wakes up." | The note's line two now plants the *want* (nice people, shabby town) instead of stating the reward. | The Mayor's post-rebuild visit — it's exactly his kind of line. |

## Future threads (planted, never resolved here)

- **The uncle.** The breadcrumbs are quieter than ever — the will, the key,
  and a trapdoor that was his. His ledger as a rare drop, his sign on a boss
  floor (stronger now that no sign was ever seen up top), the man himself at
  the bottom. He's *family*, so any payoff should complicate him, not resolve
  him.
- **"You're just like him."** No longer planted in the FTUE (the Mayor's
  recognition line died with his cameo) — which makes it a stronger thread:
  the *first* time anyone says it, post-FTUE, it lands as news. Villagers and
  customers keep it up — the hero stacks shelves, haggles, or sleeps in caves
  exactly like the uncle did. Free characterization of a man never seen, and
  every remark doubles as a clue.
- **The note.** The uncle now has a voice on paper. More notes below — on a
  boss floor, in a storeroom crate — can keep that channel open without ever
  putting him on screen.
- **The word "cellar."** Cut from the FTUE, but it's the game's title —
  return it as town vocabulary ("headed down to the cellar again?") so the
  player learns the uncle's name for the pit from the people who knew him.
- **The Mayor's year.** He watched a shopkeeper walk into a cave and watched
  the town follow him into the dark. How much did he know all along?
  Post-rebuild toasts can let it slip.
- **The will echo.** The hero rereading the will at milestones replaces the
  old "enough" echo — and the will's boilerplate is a planted bomb: *"…the
  premises, and all that lies beneath."* Standard legal language, read once
  as filler; at the first 1,000g the hero can reread it and laugh: *"'All
  that lies beneath.' He even put it in writing."*
- **The ruin ask + revival pitch.** Both cut from the FTUE; the epilogue
  visit is their natural home now.
- **Teaching the haggle.** Unchanged: first candidate the vitrine repair,
  second a customer who walks in *selling*.

## Implementation record (2026-07-14)

Text-only swap in `src/game/game-narrative.js`; no step, trigger, or
cinematic changes:

- Swapped `PLAYER_WAKE_LINES`, `PLAYER_ROAD_LINES`, `PLAYER_CLOSED_LINE`,
  `MAYOR_DOOR_LINES` (3 → 2 bubbles), `MAYOR_SALE_LINES` (3 → 1),
  `PLAYER_RESOLVE_LINE`; removed `SIGN_TEXT` and the sign bubble from
  `_shopDoorScene` (the hero's line now leads straight to the Mayor).
- Guide strings: `Sell your haul here` → `Inspect`; `…delve for stock` →
  `…delve for more loot` (both variants). Hint toasts aligned.
- `MAYOR_PRAISE_LINES` (epilogue) left in code, pending a decision.
- Runtime-verified with a Playwright drive of a fresh save: all 8 bubbles in
  order, no sign bubble, both new guide texts, steps advanced
  `exit → shop → stock → sell → delve`.

## Implementation record (2026-07-15) — the Mayor leaves the FTUE

The five steps and their triggers are still untouched; the door and sale
scenes were rebuilt around the key and the note:

- `game-narrative.js`: cut `MAYOR_DOOR_LINES`, `MAYOR_SALE_LINES`,
  `_mayorDoorScene`, `_mayorSaleScene`, `WATCH_SPOT`; added
  `PLAYER_DOOR_LINE` + `NOTE_LINES`, and `PLAYER_RESOLVE_LINE` grew into
  the three-bubble `PLAYER_RESOLVE_LINES` (same-day line pass: the door
  beat tightened to one bubble, the note's line two now sells the rebuild,
  and the send-off walks theme → settling → back-to-work).
  `_shopDoorScene` consumes the key and unlocks the gates itself;
  `_noteScene` fires with the bag-stow on first entry, speaking beside the
  uncle's bust (`public/characters/uncle-portrait.png` — background keyed
  out to a transparent burnt-paper rim). The three say-helpers collapsed
  into `_speakLines`.
  The Mayor machinery (`_ensureMayor`, `_updateMayor`,
  `MAYOR_PRAISE_LINES`, `_mayorAfterRestore`) survives for the post-FTUE
  rebuild visit.
- `items.js`: new `shopkey` quest prop — no price, no bag actions, filtered
  out of resumed saves (`game-persistence.js`), so it can't leak into the
  stash as sellable junk if a player quits mid-FTUE.
- Bag: `_tutStart` seeds the key at the top of the bag. The change grew into
  a general one: the backpack now opens anywhere, for everyone — it's the
  always-available view of what you carry and wear (`_openBagSheet`). Drop
  is delve-only (loot tossed in town would just be lost) *and* withheld
  during the FTUE, so a new player can't throw away the haul the tutorial
  is about to teach them to sell.
- Admin FTUE jumps no longer spawn a watching Mayor; the road jump re-seeds
  the key.
- Runtime-verified with a Playwright drive of a fresh save (32 checks): all
  8 bubbles in order, key visible in the cave/town bag with no actions, key
  consumed at the gates, note fires on entry, no Mayor object ever created,
  and all four admin jumps land Mayor-free.

## Implementation record (2026-07-15, second pass) — hands on the key and the note

Same dialogue; the two artifact beats became things the player *does*:

- **Freeze:** `game.js` gained `_ftueFreeze`, folded into the same
  `sheetBlocked` gate dialogues use — no walking, dashing, or interacts
  while a bag beat is live, but the bag stays openable (that's the point).
  Set at the door line and the note pickup; cleared by using/reading.
- **Bag attention cue:** `hud.bagAttention(label?)` pulses `#bag-btn` and
  hangs a bouncing arrow above it — labeled "Open the backpack" at the
  door, unlabeled at the note (the second rep is the test). Rule 8 landed
  with it: the world guide arrow hides whenever a dialogue or a freeze is
  live, so there's never more than one pointer on screen.
- **Quest actions in the bag:** quest rows render whatever story action
  `_questBagAction` wires up right now — `Use` on the key (unlocks the
  gates, consumes it), `Read` on the note (plays the pitch, consumes it).
  Both pulse. During the FTUE they're the *only* buttons in the whole bag:
  plain rows drop their Use/"not usable"/Drop actions until the tutorial's
  done, so the one pulsing button is always the way forward.
- **The note is a prop:** a plain white sheet (placeholder art — a flat,
  slightly skewed plane) lying on the first table, spawned as the doors
  swing shut behind the heir on first entry; picked up by proximity with
  the usual loot juice (float + fly-to-bag), landing at the top of the bag
  list like the key did.
- **Deposit deferral:** the pack no longer empties on crossing the
  threshold — the haul moves to the storeroom only after the note is read,
  and the doors reopen then too.
- Admin jumps reset/skip all the new state. Runtime-verified with a
  48-check Playwright drive: freeze on/off at both beats, attention cue
  with and without label, Use/Read rows, doors closing behind and
  reopening, deposit landing only after the read, and clean jump landings.
