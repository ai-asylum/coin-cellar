/**
 * Wool — first attachment authored against the new outfit system. An outfit
 * is data: a list of "attach these parts as children of this slot in the
 * base character". buildCharacterEntity merges the attachments at build time.
 *
 * The sheep wears this by default (declared in sheep.js as `defaultOutfits`).
 * Other characters could wear it too — same data, no character-specific code.
 *
 * Each wool block carries `category: 'wool'` so a future shear spell can
 * find them by attribute, not by hardcoded slot/part name (keeps invariant
 * #2: only reference concept tags, never specific kinds).
 */
export const WOOL = {
  id: 'wool',
  label: 'Wool',
  // Concepts merged into the wearer's entity.concepts.
  concepts: ['wool'],
  // Palette additions — the base character doesn't need to know about wool
  // colors, but if it already has 'wool' in its palette (sheep does, for
  // exactly this reason) the existing entry wins. Outfit palette only
  // overrides when the base hasn't reserved a key.
  palette: { wool: 0xf2eede },
  attachments: [
    {
      slot: 'body',
      parts: [
        // Big puff over the back. 9 × 9 × 10 — wider than the body each
        // side, longer past the rump, and tall enough to dominate the
        // silhouette. Front edge pulled back 1 unit (center z = -0.05,
        // back held in place) so the mane covers the chest/neck transition
        // instead of the body wool clipping into it.
        //
        // Wobble: top-anchored 'jiggly' spring. The puff hangs from above
        // the body and lags behind body sway/bob with light overshoot —
        // reads as a heavy wool mass settling each footfall.
        { kind: 'box', size: [0.9, 0.9, 1.0], offset: [0, 0.2, -0.05], color: 'wool', category: 'wool',
          pivot: 'top', wobble: 'jiggly' }
      ]
    },
    {
      slot: 'head',
      parts: [
        // Mane — 7 × 6 × 3. Cropped wool around the head; nudged forward
        // 1 unit and dropped a half-unit so the bottom of the mane reaches
        // further down past the jaw instead of poofing above the skull.
        { kind: 'box', size: [0.7, 0.6, 0.3], offset: [0, 0, -0.1], color: 'wool', category: 'wool' }
      ]
    },
    {
      slot: 'tail',
      parts: [
        // Tail puff — 2 × 2 × 2 cube around the tail stub. Pulled down
        // 1/2-unit (y = 0) so the puff hangs lower over the rump rather
        // than perching on top. Inherits the tail wag transform automatically.
        //
        // Wobble: top-anchored 'jiggly' spring. The tail wag swings the
        // tail; the puff lags and continues swinging slightly past the
        // tail's stop — visible secondary motion on the rump silhouette.
        { kind: 'box', size: [0.2, 0.2, 0.2], offset: [0, 0, -0.05], color: 'wool', category: 'wool',
          pivot: 'top', wobble: 'jiggly' }
      ]
    }
  ]
}
