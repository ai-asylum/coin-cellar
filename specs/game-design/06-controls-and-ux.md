# 06 — Controls & UX

Coin Cellar is **mobile-first portrait**: the whole control scheme collapses
to a one-thumb-drag joystick plus one big context button, and scales up to
keyboard+mouse on desktop. Input lives in `src/core/input.js`; the HUD in
`src/game/hud.js` + `game-ui.js`.

## Control model

| Intent | Touch | Desktop |
| --- | --- | --- |
| Move | Left-drag anywhere (virtual joystick appears where you press) | `WASD` / arrow keys |
| Context action | Big round button | `E` / `F` / `Space` / `J` / left-click |
| Dodge dash / strike | Dodge button (also mode-dependent — see below) | `Shift` / `K` / `L` / right-click |
| Bag | Bag button | `B` / `I` |
| Friends | Friends button | `C` |
| Menu / dialog | Tap a button | `J` / `K` move focus · `Enter` confirm · `Esc` back |
| Mute | — | `M` |
| Pause / menu | — | `Escape` |
| Admin / cheat panel | — | `` ` `` (backquote) |

**Combat input is a live design question**, so the strike trigger is a
selectable mode (default: **auto strike** — a foe stepping into range makes
the hero plant and swing). Manual dash triggers work in every mode. See
[Dungeon & Combat](03-dungeon-and-combat.md#player-combat).

The virtual joystick is dynamic — it materializes wherever the player first
touches the left ~60% of the screen, so there's no fixed thumb position.

## Menus & dialogs on the keyboard

Every modal sheet — dive / descend / return-home prompts, the store panel,
the pause menu — is fully keyboard drivable: `J`/`K` (or arrows) move a gold
highlight (starting on the primary action, so a single `Enter` confirms the
common case), `Enter` fires, `Esc` backs out via the sheet's cancel.

The **haggle sheet** remaps the same keys to the deal itself: `J` nudges the
price down, `K` up, `Enter` makes the offer, `Esc` walks away.

## The context button (one button, many verbs)

A single **context action** button changes icon and behavior based on what's
near the player:

| Situation | Action |
| --- | --- |
| Near a townsperson | Talk |
| Vitrine customer waiting at the counter | Haggle |
| Near a display table (with stock to place) | Stock |
| Near a ruined lot / broken table | Hire the builder / Repair |
| At a cave mouth | Dive |
| At a chest (dungeon) | Open |
| On the down-stairs (dungeon) | Descend |
| At the up-stairs (dungeon) | Head home |
| Boss gate (with the Brass Key) | Unlock |
| Otherwise, enemy nearby | Attack |

The button **pulses** when an actionable context is available.

## HUD

A DOM overlay (`#hud`) on the WebGL canvas (`#app`), styled in
`src/style.css`:

- **Gold counter** and **hearts**. (No day counter and no timer — the old
  160s day clock is gone; time of day is told by the *light*.)
- **Bag** panel — openable anywhere (town, cave, diving): what you carry and
  wear; tap consumables to use. Dropping items is dive-only (tossing loot in
  town would just lose it).
- **Store panel** — move items bag ↔ storeroom, stock the shelves.
- **Minimap** (dungeon) — fog-of-war cells revealed as you explore.
- **Boss bar** + telegraph countdown during arena fights.
- **Haggle sheet** — Recettear-style, flanking portraits and mood faces.
- **Banners & floaties** — floor announcements, boss banners, floating gold.
- **Friends sheet** — set your name, add friends, invite, chat.
- **Dialogue bar** — NPC speech bubbles with portrait busts.

## Accessibility & platform notes

- No shadow maps, capped pixel ratio (≤2), blob-shadow sprites: smooth on
  phones.
- Music is streamed MP3s; SFX are procedural. Fully playable **muted**
  (persisted).
- All core interactions are reachable by touch alone; desktop keys are
  additive.
- On phones, tapping Play requests fullscreen; a service worker caches the
  build for repeat visits (PROD only).

## Onboarding

First run plays **"What He Left"** — the five-beat scripted FTUE
(`exit → shop → stock → sell → delve`) built on guide arrows, two quest props
(the Shop Key and the uncle's note), and exactly one on-screen human. Full
script + staging rules: [08 — FTUE Script](08-ftue-script-inheritance.md).

Two UX rules from it apply game-wide:

- **One pointer at a time** — the world guide arrow hides whenever a dialogue
  or bag cue is live; competing pointers queue.
- **A ten-year-old reads every line** — see the
  [town writing rules](09-town-npcs-and-building.md#writing-rule).
