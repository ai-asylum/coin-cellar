/**
 * Pig — second character. Same body plan and voxel grid as the sheep, but
 * the silhouette differences carry the read:
 *
 *   - Big forward-poking snout (the box we deliberately KEPT off the sheep).
 *   - Monochrome pink — body, head, ears all the same color (the sheep's
 *     body/face contrast is the other half of "this is a sheep").
 *   - No wool tuft. Pigs are smooth.
 *   - Two small black nostril decals on the snout's front face.
 *
 * Body cross-section (X, Y) is 2× the piglet baseline — broader, taller
 * body — but body length, legs, head, and tail all stay at piglet scale.
 * The pig reads as a piglet with a thicker barrel and the same ground
 * clearance, with the smaller head at the top-front corner so its back
 * face still meets the body's front face and its top edge still aligns
 * with the body's top edge.
 */
export const PIG = {
  id: 'pig',
  label: 'Pig',
  bodyPlan: 'quadruped',
  palette: {
    pink:  0xe8a8a0, // body, head, ears, legs, tail (pig is monochrome)
    snout: 0xd28880, // snout (slightly darker pink for contrast)
    eye:   0x111111
  },
  parts: [
    // Body — 8 × 8 × 8. Cubic barrel — same nose-to-rump length as the
    // piglet but twice as broad and twice as tall. Reads as a compact,
    // stocky pig. Body bottom at y=0.2 to sit on the 2-unit legs; body
    // Y bounds [0.2, 1.0], Z bounds [-0.4, +0.4].
    { slot: 'body', kind: 'box', size: [0.8, 0.8, 0.8], offset: [0, 0.6, 0], color: 'pink' },

    // Head — 4 × 4 × 4, half the body's cross-section. Sits at the body's
    // top-front corner: head back face at z=+0.4 meets body front face,
    // head top at y=1.0 aligns with body top. The whole head assembly
    // (snout, ears, eyes, nostrils) is at piglet scale; halving the head
    // box without halving its children would leave them floating off the
    // smaller head.
    {
      slot: 'head',
      kind: 'box',
      size: [0.4, 0.4, 0.4],
      offset: [0, 0.8, 0.6],
      color: 'pink',
      children: [
        // Snout — 2 × 2 × 1. Small centered protrusion on the lower half
        // of the face (half head width, sticks out 1 unit). Two nostril
        // decals on its front face.
        {
          slot: 'snout',
          kind: 'box',
          size: [0.2, 0.2, 0.1],
          offset: [0, -0.05, 0.25],
          color: 'snout',
          children: [
            // Nostril offsets are in SNOUT-local space (snout center at
            // [0, 0, 0] relative to itself; front face at z=+0.05).
            { kind: 'box', size: [0.05, 0.05, 0], offset: [-0.04, 0.0, 0.05], color: 'eye' },
            { kind: 'box', size: [0.05, 0.05, 0], offset: [ 0.04, 0.0, 0.05], color: 'eye' }
          ]
        },

        // Ears — 1 × 2 × 2. Small panels at the upper-side corners, top
        // flush with head top. Rig pivot-wraps them at the top edge.
        { slot: 'ear-L', kind: 'box', size: [0.1, 0.2, 0.2], offset: [-0.25, 0.1, 0], color: 'pink' },
        { slot: 'ear-R', kind: 'box', size: [0.1, 0.2, 0.2], offset: [ 0.25, 0.1, 0], color: 'pink' },

        // Eyes — flat 0.05 × 0.05 decals on the upper face (above the
        // snout). Z=0 means the renderer treats them as a polygon-offset
        // decal stuck to the head's front face — no z-fighting, no
        // protruding stud.
        { slot: 'eye-L', kind: 'box', size: [0.05, 0.05, 0], offset: [-0.15, 0.08, 0.20], color: 'eye' },
        { slot: 'eye-R', kind: 'box', size: [0.05, 0.05, 0], offset: [ 0.15, 0.08, 0.20], color: 'eye' }
      ]
    },

    // Legs — 2 × 2 × 2. Piglet-scale on every axis, just spread wider
    // (X=±0.3 vs piglet's ±0.1) so each leg's outer edge stays flush with
    // the wider body's outer edge. Foot at y=0, top at y=0.2 = body bottom;
    // front-leg front face flush with body front (z=+0.4), back-leg back
    // face flush with body back (z=-0.4).
    { slot: 'leg-fl', kind: 'box', size: [0.2, 0.2, 0.2], offset: [-0.3, 0.1,  0.3], color: 'pink' },
    { slot: 'leg-fr', kind: 'box', size: [0.2, 0.2, 0.2], offset: [ 0.3, 0.1,  0.3], color: 'pink' },
    { slot: 'leg-bl', kind: 'box', size: [0.2, 0.2, 0.2], offset: [-0.3, 0.1, -0.3], color: 'pink' },
    { slot: 'leg-br', kind: 'box', size: [0.2, 0.2, 0.2], offset: [ 0.3, 0.1, -0.3], color: 'pink' },

    // Tail — 1 × 1 × 2 nub. Half-thickness cross-section (X and Y) vs the
    // earlier 2×2×2 cube; tail length (Z) unchanged so it sticks out the
    // same amount. Centered on the spine, top edge still flush with body
    // top (body top y=1.0 → tail center y=0.95), front face still touching
    // body back (body back z=-0.4 → tail center z=-0.5).
    { slot: 'tail', kind: 'box', size: [0.1, 0.1, 0.2], offset: [0, 0.95, -0.5], color: 'pink' }
  ],
  collision: { kind: 'cylinder', radius: 1.0, height: 2.4, body: 'solid' },
  concepts: ['alive', 'flesh', 'beast']
}
