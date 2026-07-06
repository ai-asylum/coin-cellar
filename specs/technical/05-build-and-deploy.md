# 05 — Build & Deploy

Coin Cellar builds with **Vite** into a fully static bundle. No server-side runtime
is required to play (co-op uses PeerJS's public broker only for the WebRTC
handshake).

## Prerequisites

- **Node.js** (with npm).

## Install

```bash
npm install
```

Installs the three dependencies: `three`, `peerjs`, `vite`.

## Scripts (`package.json`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at `http://localhost:5173` |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built `dist/` locally to sanity-check |

### During development

- Game: `http://localhost:5173/`
- Creature lab: `http://localhost:5173/lab.html`
- Admin catalogue: `http://localhost:5173/admin/`

## Vite configuration (`vite.config.js`)

Key settings:

- **`base: "./"`** — emits **relative** asset paths so the build runs from any
  subdirectory or a static file host without rewriting URLs.
- **Multi-page `build.rollupOptions.input`** — three entry HTML files:
  - `index.html` (game)
  - `lab.html` (creature lab)
  - `admin/index.html` (admin catalogue)
- **`build.target: "es2020"`**.
- Dev server: `host: true` (LAN-accessible, useful for testing on a real phone),
  HMR disabled.

Because it's multi-page, `npm run build` produces `dist/index.html`,
`dist/lab.html`, and `dist/admin/index.html`, all sharing chunked JS.

## Static assets (`public/`)

Everything in `public/` is copied verbatim into the build root:

- `public/characters/` — 18 Kenney GLB models + textures (+ CC0 license file).
- `public/icons/` — 47 UI mask icons.
- `public/items/` — 25 merchandise color icons.

These are referenced at runtime by relative URL; with `base: "./"` they resolve
correctly wherever the build is hosted.

## Deploying

The `dist/` folder is a plain static site. Host it on anything:

- GitHub Pages, Netlify, Vercel (static), Cloudflare Pages, S3+CloudFront, or any
  static file server.
- No environment variables, no secrets, no build-time backend.

### Testing on a phone locally

Since the game is mobile-first, test touch controls on a real device:

```bash
npm run dev   # host:true exposes it on your LAN
```

Then open `http://<your-machine-lan-ip>:5173/` on the phone (same Wi-Fi). For co-op
across the internet you don't need anything extra — PeerJS handles NAT traversal
via its public broker/STUN.

## Notes & caveats

- **PeerJS public broker dependency:** co-op signaling relies on PeerJS's public
  server being reachable. For a hardened deployment you'd point PeerJS at your own
  broker; the game logic itself stays serverless.
- **No analytics/telemetry** are wired into the build by default.
