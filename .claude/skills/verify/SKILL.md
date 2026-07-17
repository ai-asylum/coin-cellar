---
name: verify
description: Build, launch, and drive Coin Cellar end-to-end to verify a change works at runtime.
---

# Verifying Coin Cellar

Vite + three.js browser game, no test suite — verification is driving the game.

## Build & launch

```bash
npx vite build            # fast syntax/import gate (~1s)
npx vite --port 5199 --strictPort   # dev server (run in background)
```

## Drive it (Playwright + system Chrome)

Install `playwright` in a scratch dir (no browser download needed):
`chromium.launch({ channel: "chrome", headless: true })`.

Boot sequence per page:
1. `goto http://localhost:5199`
2. `click("#start-play")` (title screen gates on a user gesture)
3. `waitForFunction(() => !!window.__game)` — `window.__game` is the debug handle

Useful handles on `__game`:
- `tutorial = null; _hadSave = true; _cine = null; _ftueFreeze = false` — skip
  the first-run tutorial. Nulling `_cine` matters: the FTUE's opening cutscene
  short-circuits the whole player update (timers freeze, the script walks the
  hero around) even after you teleport elsewhere.
- `playerName = "..."` — identity for lobby presence (skips name UI)
- `_delve(0)` → the entrance dungeon (`_delve(k)` for a deeper open mouth);
  wait for `!_holeDive` after — the dive cutscene also freezes combat timers
- `player.position.set(...)` to walk; `playerArea`, `dungeon.floor/seed` to assert
- Multiplayer lobby (Supabase Realtime): `lobby.zone`, `lobby.count`,
  `_lobbyAvatars` — open two browser contexts and assert each sees the other
  move (allow ~3-4s for presence sync; broadcasts are 8 Hz)
- PeerJS co-op: `net` (Coop) — needs two pages + friend invite flow

Sheets/prompts are DOM: click their button ids (`#hole-yes`, `#descend-yes`, …).
Screenshot the page for visual evidence; HUD + canvas both render.

## Gotchas

- `hud.toast` is a no-op — don't assert on toasts.
- Areas are spatially disjoint: shop at origin, dungeon at x+200, sewer at x-200.
- Dungeon layouts are seeded — compare `dungeon.colliders` samples across
  clients to prove two peers generated the same floor.
