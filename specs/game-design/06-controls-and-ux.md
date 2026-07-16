# 06 — Controls & UX

Coin Cellar is **mobile-first**: the whole control scheme collapses to a
one-thumb-drag joystick plus one big context button, and scales up to
keyboard+mouse on desktop. Input lives in `src/core/input.js`; the HUD in
`src/game/hud.js`.

## Control model

| Intent | Touch | Desktop |
| --- | --- | --- |
| Move | Left-drag anywhere (virtual joystick appears where you press) | `WASD` / arrow keys |
| Context action | Big round button | `E` / `F` / `Space` / `J` / left-click |
| Dodge roll (dungeon) | Dodge button | `Shift` / `K` / `L` / right-click |
| Bag | Bag button | `B` / `I` |
| Friends | Friends button | `C` |
| Aim (attack) | Movement direction | Mouse position |
| Menu / dialog | Tap a button | `J` / `K` move focus · `Enter` confirm · `Esc` back out |
| Mute | — | `M` |
| Pause / menu | — | `Escape` |
| Admin / cheat panel | — | `` ` `` (backquote) |

## Menus & dialogs on the keyboard

Every modal sheet — the door prompt, the delve / descend / "go deeper or head
home" prompts, the storeroom pack list, the pause menu — is fully keyboard
drivable so desktop players never reach for the mouse mid-flow:

- `J` / `K` (or the arrow keys) move a gold highlight across the sheet's
  buttons; it starts on the primary (green) action so a single `Enter` confirms
  the common case.
- `Enter` fires the focused button.
- `Esc` backs out via the sheet's cancel — its close (✕) button if it has one,
  otherwise the secondary "deny" choice, so paused prompts always un-pause.

The **haggle sheet** (selling *and* buying) remaps the same keys to the deal
itself: `J` nudges the price down, `K` nudges it up, `Enter` makes the
offer / seals the sale, and `Esc` walks away from the table.

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
- **Bag** panel — the always-available (any area: town, cave lobby, delving) view
  of what you carry and what you've got equipped; tap items to use consumables.
  Dropping loot is delve-only (tossing it in town or the cave would just lose it).
- **Haggle sheet** — Recettear-style deal UI with flanking character portraits and
  mood faces.
- **Banners & floaties** — floor announcements, floating gold numbers on sales,
  perfect-deal flourishes.
- **Friends sheet** — set your name, add friends, invite one to teleport in.
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
than a heavy tutorial: a guide arrow (`hud.guide`) walks the new player through
**delve → loot → return → stock → open → sell** on day one. The recap sheet at
sleep reinforces the day's outcomes (gold earned, deals made, deepest floor).

### FTUE: the landlord scene

The first day is scripted to end on a stakes-setting beat that introduces the
rent (debt) system diegetically instead of via a banner:

1. **Day one starts with 1 AP already spent.** The player wakes with the day
   already underway — the shorter first day funnels them straight through the
   guided tutorial loop without time to wander.
2. **First sale closes the day.** After the player seals their first sale and
   the shop doors close, night sets in immediately.
3. **The landlord barges in.** The **LANDLORD** character throws the doors open
   himself and marches in, demanding the rent.
4. **Scripted exchange:**
   - *Landlord:* demands the rent, now.
   - *Player:* can't pay right now — asks for until the end of the week.
   - *Landlord:* **"You have three days!"**
5. **Rent UI.** The Guild's rent ledger sheet then opens — the full payment
   schedule, with a "pay now" for settling the current installment early. It
   stays reachable all campaign by tapping the **debt chip** in the top bar
   (dawn auto-collection remains the enforcement backstop).

The landlord's "three days" is literal: it points at the first installment of
the [debt schedule](04-economy-and-progression.md#the-debt-schedule-the-campaign-spine),
due on day 3. The landlord is a **Guild collector** — the creditor is still the
Guild (as in existing HUD copy); he's the character face that comes to collect.
