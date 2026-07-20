/**
 * Piglet — copy of the original pig anatomy at its original scale. Same body
 * plan and voxel grid as the sheep, but the silhouette differences carry the
 * read:
 *
 *   - Big forward-poking snout (the box we deliberately KEPT off the sheep).
 *   - Monochrome pink — body, head, ears all the same color (the sheep's
 *     body/face contrast is the other half of "this is a sheep").
 *   - No wool tuft. Pigs are smooth.
 *   - Two small black nostril decals on the snout's front face.
 *
 * Same voxel rules as sheep.js: body dimensions in {1, 2, 4, 8, 16} units,
 * sub-voxel exception for face dots (eyes, nostrils) at 0.5 units.
 */
export const PIGLET = {
  id: 'piglet',
  label: 'Piglet',
  bodyPlan: 'quadruped',
  palette: {
    pink:  0xe8a8a0, // body, head, ears, legs, tail (piglet is monochrome)
    snout: 0xd28880, // snout (slightly darker pink for contrast)
    eye:   0x111111
  },
  parts: [
    // Body — 4 × 4 × 8. Long, slim barrel — half the width/height of the
    // sheep, twice as long as it is wide. Reads as a stockier-than-sheep
    // proportioned pig with the head fully integrated into the silhouette.
    // Body bottom at y=0.2 to sit on the short 2-unit legs.
    { slot: 'body', kind: 'box', size: [0.4, 0.4, 0.8], offset: [0, 0.4, 0], color: 'pink' },

    // Head — 4 × 4 × 4, same color as body. Touches the body front face
    // (body front at z=+0.4 → head back at z=+0.4 → head center z=+0.6).
    // Y-aligned with body so they form one continuous silhouette.
    // Children are positioned RELATIVE to the head's center.
    {
      slot: 'head',
      kind: 'box',
      size: [0.4, 0.4, 0.4],
      offset: [0, 0.4, 0.6],
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

    // Legs — 2 × 2 × 2. Stubby half-length legs (vs sheep's 2x4x2). Pigs
    // sit closer to the ground. Foot at y=0, top at y=0.2 = body bottom.
    { slot: 'leg-fl', kind: 'box', size: [0.2, 0.2, 0.2], offset: [-0.1, 0.1,  0.3], color: 'pink' },
    { slot: 'leg-fr', kind: 'box', size: [0.2, 0.2, 0.2], offset: [ 0.1, 0.1,  0.3], color: 'pink' },
    { slot: 'leg-bl', kind: 'box', size: [0.2, 0.2, 0.2], offset: [-0.1, 0.1, -0.3], color: 'pink' },
    { slot: 'leg-br', kind: 'box', size: [0.2, 0.2, 0.2], offset: [ 0.1, 0.1, -0.3], color: 'pink' },

    // Tail — 1 × 1 × 1 nub. Half-size of the previous 2×2×2 tail; pigs read
    // better with a tiny stubby tail than a chunky one. Sits on the upper-
    // back corner of the body, front face touching the body back (body back
    // z=-0.4 → tail front z=-0.4 → tail center z=-0.45; tail top y=0.6 =
    // body top → tail center y=0.55).
    { slot: 'tail', kind: 'box', size: [0.1, 0.1, 0.1], offset: [0, 0.55, -0.45], color: 'pink' }
  ],
  collision: { kind: 'cylinder', radius: 0.5, height: 1.2, body: 'solid' },
  concepts: ['alive', 'flesh', 'beast']
}
