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

Build or validate them with the **`fake-door-readiness`** skill (`edi` plugin,
`ai-asylum/plugins`). Canonical rules + detail:
`ai-asylum/team-dashboard` `docs/marketing-readiness.md`.

> Managed by team-dashboard's `seed-marketing-md` workflow — kept in sync with the
> org template. Delete this line to stop auto-updates and customize freely.
