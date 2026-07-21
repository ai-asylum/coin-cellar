# 05 — Build & Deploy

Coin Cellar builds with **Vite** into a fully static bundle. The game runs
without any server of its own (PeerJS's public broker handles co-op
signaling; Supabase Realtime and PostHog are optional side services; the
cooking prototype talks to its own Supabase project).

## Install & scripts

```bash
npm install
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at `http://localhost:5173` |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

Dependencies: `three`, `peerjs`, `@supabase/supabase-js`, `posthog-js`,
`@capacitor/core` + `@capacitor/android` (dev: `vite`, `@capacitor/cli`).

### During development

- Game: `/` · Creature lab: `/lab.html` · Admin: `/admin/` ·
  **Editor:** `/editor.html` · **Cooking:** `/cooking.html`

## Vite configuration (`vite.config.js`)

- **`base: "./"`** — relative asset paths, hostable from any subdirectory.
- **Multi-page build** — five rollup inputs: `index.html`, `lab.html`,
  `admin/index.html`, `editor.html`, `cooking.html`.
- `build.target: "es2020"`; dev server `host: true` (LAN-testable on a real
  phone), HMR disabled.
- **Three dev-only middleware endpoints** let the tools write design data
  back to disk (GET serves, POST validates + pretty-prints):
  - `/api/layout` → `src/game/layout.json` (editor Overworld/Cave tabs)
  - `/api/dungeon-tuning` → `src/game/dungeon-tuning.json` (editor Dungeon tab)
  - `/api/combat-settings` → `src/game/combat-settings.json` (cheat panel)

  These exist only in `npm run dev` — production builds ship the JSON as
  static data.

## Static assets (`public/`)

Copied verbatim into the build root: 18 Kenney character GLBs + textures
(CC0), 47 UI icons, 34 item icons, 43 decor billboards, 19 dungeon-kit
GLTFs, 11 music MP3s, and `sw.js` (a runtime-cache service worker,
registered in PROD only).

## Analytics

PostHog (`src/core/analytics.js`) initializes for the **game page only**
(lab/admin/editor/cooking never import it): EU cloud, public key in source,
autocapture + pageviews on. Custom events: `game_started`,
`dungeon_entered`, `returned_home`, `item_sold` (haggled or instant),
`ftue_step`, `ftue_completed`, `npc_talk`.

## Deploying — Vercel

- **Production:** <https://coin-cellar.vercel.app/> (project `coin-cellar`;
  the local checkout links via `.vercel/project.json`). The legacy
  `shop-slop.vercel.app` domain was removed and must **not** be re-added.
- Ship a release:

```bash
vercel --prod
```

Vercel runs `npm run build` and serves `dist/`, auto-aliasing to the
production domain. (No CI deploy workflow — Vercel's own Git integration.)

## Android — Capacitor

`capacitor.config.json`: appId `com.coincellar.app`, webDir `dist`. The web
build is wrapped as a WebView asset:

```bash
npm run build
npx cap sync android   # android/ is gitignored; recreate with `npx cap add android`
```

A prebuilt `coin-cellar-debug.apk` sits at the repo root for sideloading.

## GitHub Actions

One workflow, `store-assets.yml` (manual dispatch): generates store
creatives/icon via the shared `ai-asylum/game-kit` pipeline (Scenario). No
build/test CI.

## Testing on a phone locally

```bash
npm run dev   # host:true exposes it on your LAN
```

Open `http://<your-lan-ip>:5173/` on the phone. Co-op across the internet
needs nothing extra — PeerJS handles NAT traversal.
