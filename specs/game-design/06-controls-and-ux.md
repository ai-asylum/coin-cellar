# 06 — Controls & UX

Coin Cellar is **mobile-first**: the whole control scheme collapses to a
one-thumb-drag joystick plus one big context button, and scales up to
keyboard+mouse on desktop. Input lives in `src/core/input.js`; the HUD in
`src/game/hud.js`.

## Control model

| Intent | Touch | Desktop |
| --- | --- | --- |
| Move | Left-drag anywhere (virtual joystick appears where you press) | `WASD` / arrow keys |
| Context action | Big round button | `E` / `F` / `Space` / left-click |
| Dodge roll (dungeon) | Dodge button | `Shift` / `K` / `L` / right-click |
| Bag | Bag button | `B` / `I` |
| Co-op | Co-op button | `C` |
| Aim (attack) | Movement direction | Mouse position |
| Mute | — | `M` |
| Pause / menu | — | `Escape` |
| Admin / cheat panel | — | `` ` `` (backquote) |

The virtual joystick is dynamic — it materializes wherever the player first
touches the left ~60% of the screen, so there's no fixed thumb position to reach
for.

## The context button (one button, many verbs)

Rather than a cluttered action bar, a single **context action** button changes its
icon and behavior based on what's near the player:

| Situation | Action | Icon |
| --- | --- | --- |
| Near a customer with a `❗` | Haggle | 🗣️ speak |
| Near a display table (with bag stock) | Stock item | — |
| On the trapdoor | Delve | 🕳️ hole |
| At the bed | Sleep (end day) | 🛏️ bed |
| At a chest (dungeon) | Open | 🎁 chest |
| On stairs (dungeon) | Descend | ⬇️ arrow-down |
| At the entrance portal (dungeon) | Return home | 🏠 home |
| Otherwise (enemy nearby) | Attack | ⚔️ swords |

The button **pulses** when an actionable context is available, so the player
always knows when there's something to do.

## HUD

The HUD is a DOM overlay (`#hud`) on top of the WebGL canvas (`#app`), styled in
`src/style.css`. Key elements:

- **Gold counter** and **hearts** (current/max HP).
- **Day clock / phase indicator** (sun/moon, day number, time remaining).
- **Bag** panel — tap items to shelve or use consumables.
- **Haggle sheet** — Recettear-style deal UI with flanking character portraits and
  mood faces.
- **Banners & floaties** — floor announcements, floating gold numbers on sales,
  perfect-deal flourishes.
- **Co-op sheet** — host/join room code.
- **Pause / escape menu.**

## Accessibility & platform notes

- **No shadow maps**, capped pixel ratio (≤2), and blob-shadow sprites keep frame
  rate smooth on phones.
- Audio is procedural and **mutable** (persisted), so the game is fully playable
  silent.
- All core interactions are reachable by touch alone; desktop keys/mouse are
  additive conveniences.

## Onboarding

There's a lightweight loading screen while character models preload. The
first-time flow relies on the pulsing context button and readable icons rather
than a heavy tutorial. The recap sheet at sleep reinforces the day's outcomes
(gold earned, deals made, deepest floor).
