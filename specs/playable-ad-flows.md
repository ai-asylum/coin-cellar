# Playable Ad — 10 Flow Ideas

> **Note (2026-07):** written before the no-debt pivot. Flow #3 ("Rent is
> due") and the debt framing below no longer match the shipped game — there
> is no debt, landlord, or 3-hit combo any more. The haggle-, loot-, and
> narrative-led flows (#1, #2, #4, #6, #7, #9, #10) remain valid; an ad can
> still *invent* urgency the game doesn't have, but that's a marketing choice
> to make knowingly.

Short report on candidate flows for a Coin Cellar playable ad. Goal: show the
base mechanics (dive for loot, haggle it into gold) in ~30–45 seconds without
losing the user.

## Ground rules (apply to every flow)

- **First tap within 3 seconds.** No logo screens, no dialogue before input.
- **One verb per flow.** The game has two loops (dive + deal); an ad that
  teaches both fully will lose people. Pick one as the star, cameo the other.
- **Portrait, one thumb.** The game is already built this way — joystick +
  one context button maps cleanly to ad constraints.
- **End on a win + cliffhanger.** Payout moment → "there's more" → CTA.
- **Size note:** the zero-asset/procedural approach is a real advantage here
  (most ad networks cap playables at 2–5 MB), but Three.js + character models
  still need a trimmed build. Flows below are ranked partly by how little of
  the engine they need.

---

## The 10 flows

### 1. Perfect Deal ladder *(haggle-first)*
Three customers, escalating wallets: Cheapskate → Regular → Collector. Player
sets the price with a slider or +/– taps; each sale grades Cheap / Good /
**Perfect** with the combo flourish. Finale: Collector pays triple for the Lost
Crown, gold rains.
**Teaches:** the hidden-maxPay nerve game — the actual core of the shop.
**Risk:** no action; may underperform with players who want combat.

### 2. Dive & Deal one-two punch *(both verbs, compressed)*
15s dungeon: dash-kill two skitters, open a chest, grab a Dawn Gem, portal
home. 15s shop: a Wealthy buyer wants the gem — one haggle, big payout.
**Teaches:** the full loop — loot is worthless until sold.
**Risk:** two control schemes in 30s; needs a very firm guide arrow.

### 3. Rent is due *(debt pressure as timer)*
Banner: "Rent due: 180g. The collector is coming." A visible gold meter and a
60s clock. Rapid-fire haggles fill the meter; the landlord bursts in at zero.
Pay → keep the shop → CTA. (Fail state also ends on CTA: "Save your shop.")
**Teaches:** debt as the metronome; urgency does the retention work.
**Risk:** timer stress can feel punishing — tune so ~everyone barely makes it.

### 4. "How much will they pay?" *(quiz-style, minimal input)*
Static-ish scene: customer portrait + item. Three price buttons — Safe / Bold /
Greedy. Grade reveal, next customer. Three rounds, score at the end.
**Teaches:** reading the customer archetype.
**Why:** lowest complexity of all ten; tap-only, works even as an interactive
end card. Cheapest to build (could be DOM-only, no WebGL).

### 5. Boss trophy *(combat-first)*
Spawn straight into the Broodmother arena. Teach one dodge (step off the
glowing pounce ring), one 3-hit combo. Kill → loot shower → cut to shop:
"Someone will pay a fortune for this." CTA on the haggle sheet opening.
**Teaches:** telegraph → dodge → punish, plus the sell hook.
**Risk:** heaviest build slice (boss machine, particles, arena).

### 6. Buy low, sell high *(the arbitrage fantasy)*
A seller offers a sword: "50g?" Player haggles them down to 28g. Same sword,
next scene: a Collector wants it — sell at 95g. Profit counter tallies the flip.
**Teaches:** reverse haggle + markup — the "Capitalism, ho!" power trip.
**Why:** the doubled haggle means one mechanic taught twice, not two mechanics.

### 7. What He Left *(narrative hook, mirrors real FTUE)*
Find the note + key. Unlock the dusty shop. One quick sale to the first
customer. Then the trapdoor rattles and glows. "What did he leave down there?"
→ CTA before the answer.
**Teaches:** the premise more than a mechanic.
**Why:** cheap emotional hook; converts story-curious users. Reuses the shipped
FTUE beats, so design is already done.

### 8. The bad shopkeeper *(fail-bait)*
Open on an AI shopkeeper blowing a deal — greedy price, three strikes, customer
storms out, gold lost. "You can do better." Same customer walks back in; player
takes over. Classic ad pattern: watching failure compels correction.
**Teaches:** strikes and the push-your-luck tension.
**Risk:** fail-bait is well-worn; execution (comedy in the failure) decides it.

### 9. Stock the shelves *(tactile opener)*
Bag holds three shiny items; player drags them onto display tables (fat snap
targets, satisfying pop). Customers flock to the priciest one immediately —
crowd forms, `❗` appears — one haggle to finish.
**Teaches:** stocking → demand → sale causality.
**Why:** drag-to-place is the most universally understood ad gesture; good for
broad UA audiences who won't touch a joystick.

### 10. Go deeper or cash out? *(greed test)*
Clear a tiny floor (3 enemies), loot drops, banked-gold counter ticks up.
Prompt: **"Go deeper — better loot"** vs **"Head home — keep it."** Each floor
gets richer and meaner; dying costs half. Two or three decisions max, then CTA
on whichever ending.
**Teaches:** readable risk / depth-vs-danger — the dive's real hook.
**Why:** the choice moment itself is the ad; slot-machine tension, and both
outcomes end well for the CTA.

---

## Recommendation

Prototype order:

1. **#4 (quiz haggle)** — days not weeks, DOM-only, validates whether the
   haggle fantasy converts at all before spending on a WebGL playable.
2. **#2 (dive & deal)** — the most honest ad; matches what retained players
   actually get, so installs should be high-quality.
3. **#3 (rent is due)** — same build as #1/#6 plus a timer; strongest urgency
   hook if haggle-only flows test well.

Avoid starting with #5 — best spectacle, biggest build cost; save it for a
second wave once a trimmed ad build of the engine exists.

---

## PlaytestCloud → PostHog telemetry

Appending `?playtest` to the game URL enables playtest telemetry and displays
`playtest #00000000` in the top-left corner of a dedicated black instruction
screen before the main menu. A large white arrow asks the tester to read the
code aloud; a simple `DONE` button underneath advances to the normal menu. The
same hash is sent to PostHog as `tester_id`, allowing a PlaytestCloud video to
be matched to its analytics. The ID is an eight-character hash derived from the
session-start timestamp in milliseconds and remains stable for that browser
session.

When the code appears, `playtest_id_shown` records `tester_id` and
`shown_timestamp_ms`. The replay reviewer uses the video time at which OCR sees
the code and this event as the clock anchor between video-relative time and
PostHog's absolute timestamps.

Player position is sampled once per second. Five samples are sent together
every five seconds as one `player_position_batch` event to reduce PostHog event
volume. Each batch stores five parallel arrays:

- `player_x` — horizontal world coordinate.
- `player_z` — the other ground-plane coordinate. Three.js uses X/Z for the
  floor; Y is vertical and is not required to locate the player.
- `area` — `shop`, `cave`, or `dungeon`.
- `dungeon_floor` — the active floor, or `null` outside the dungeon. This is
  required because dungeon floors can reuse coordinates.
- `dungeon_seed` — deterministic generation seed for exact future floor
  reconstruction; older recordings without it use a best-effort floor.
- `tutorial_step` — preserves whether the recorded floor used FTUE generation.
- `sample_timestamp_ms` — timestamp for each one-second sample. PostHog also
  supplies the batch event timestamp automatically, but one timestamp is not
  enough to distinguish all five samples.

Every batch also stores the scalar `tester_id` and `sample_count`. Array indexes
belong together: index 0 across every property describes the same position
sample, through index 4.

## Local replay reviewer

Open `http://localhost:5173/?replay` while the Vite development server is
running. The reviewer accepts either one playtest's video + VTT/TXT files or a
root folder whose subfolders are separate PlaytestCloud sessions. It:

1. OCRs the upper portion of frames from the first 30 seconds for
   `playtest #XXXXXXXX`, with a manual ID field if OCR fails.
2. Loads matching PostHog events through the local authenticated proxy.
3. Shows a frozen, invincible game world on the left and the video plus a
   scrollable timecode/transcript table on the right.
4. Synchronizes video scrubbing, transcript selection, the player position,
   floating transcript bubbles, and optional translucent 30-second footsteps.

The backquote admin panel remains available. Replay mode does not connect to
co-op, save progress, advance simulation time, or capture new analytics.
