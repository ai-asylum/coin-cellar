# MARKETING.md

How this game's marketing assets are graded. The team-dashboard Marketing cockpit
reads this repo live (`lib/marketing.ts`) and checks two things:

- **Fake door** — `store/index.html`: app-icon image, ≥2 `.shot` screenshots, an
  "About this game" description, a studio name that isn't "Ai-Asylum",
  `store/privacy.html` + `store/terms.html`, and a `.survey` block after the
  email capture.
- **Playables** — each `ads/playable/*.html`: one self-contained file ≤5 MB,
  MRAID present, a CTA to the store, and no external requests.

The fake door is **generated** from `store/fakedoor.config.json` (+ `icon.webp` /
`shots/*.webp`) — you edit the config, and team-dashboard's `gen-fake-doors`
GitHub Action renders the `store/*` pages and commits them back to this repo.
Don't hand-edit the generated HTML.

Playables are built with **`ai-asylum/playable-kit`** (vendored as
`vendor/playable-kit-*.tgz`): the game keeps only its asset manifest in
`scripts/build-playable.mjs` (+ a small `vite.playable.config`), and
`npm run build:playable` assembles the committed `ads/playable/*.html`.
**Don't hand-edit a kit-built playable** — edit the source and rebuild. CI
(`.github/workflows/playable.yml`) rebuilds it on every main push (recommitting
if stale) and behaviorally smoke-tests it: it must boot, render a canvas, and
make no requests beyond `mraid.js` + Google Fonts. Repos with hand-authored
single-file playables run the smoke test only (`build:playable` is a no-op).

Build or validate them with the **`fake-door-readiness`** skill (`edi` plugin,
`ai-asylum/plugins`). Canonical rules + detail:
`ai-asylum/team-dashboard` `docs/marketing-readiness.md`.

> Managed by team-dashboard's `seed-marketing-md` workflow — kept in sync with the
> org template. Delete this line to stop auto-updates and customize freely.
