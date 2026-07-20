/**
 * Cow — third character. Same voxel grid as sheep/pig; the cow read comes
 * from three signals layered together:
 *
 *   1. Tall legs. Cow stands twice as high as the sheep (legs 8 units instead
 *      of 4), so the silhouette is leggier and the body floats higher.
 *   2. Horns. Two stubby cream boxes on top of the head — the single visual
 *      element that decisively says "cow not sheep".
 *   3. Wide pink snout + horizontal ears. Cows have flat broad muzzles and
 *      ears that stick straight out the sides (vs pig/sheep vertical ears).
 *      Together with the horns, no other animal in the lineup reads as cow.
 *
 * Tail is a long thin stick out the back with a dark fluffy tuft at the tip
 * (a child mesh of the tail itself, so it follows the tail wag for free).
 *
 * Same voxel rules as sheep.js: body dimensions in {1, 2, 4, 8, 16} units,
 * sub-voxel exception for face dots (eyes, nostrils) at 0.5 units. All
 * offsets snap to half-unit increments so vertex positions land on the
 * 0.1m grid.
 */
export const COW = {
  id: 'cow',
  label: 'Cow',
  bodyPlan: 'quadruped',
  palette: {
    hide:  0xf2eede, // creamy off-white body (same hex as sheep wool — the
                     // horn + leggy stance carries the cow read on its own)
    snout: 0xe8a8a0, // pink muzzle (same hex as pig pink)
    horn:  0xc9b58a, // beige horn cream
    hoof:  0x2a2018, // dark legs / dark tail tuft
    eye:   0x111111
  },
  parts: [
    // Body — 8 × 8 × 16. Same barrel as the sheep, lifted onto tall legs so
    // the back sits at y=1.6 (vs sheep 1.2). y-extent: 0.8 → 1.6.
    { slot: 'body', kind: 'box', size: [0.8, 0.8, 1.6], offset: [0, 1.2, 0], color: 'hide' },

    // Head — 4 × 4 × 4 at the body's front-TOP corner (vs sheep, which
    // tucks the head down at body-bottom). Cows carry their head high on
    // a long neck, so the head sits with its top flush with the body top
    // (head y range 1.2 → 1.6 = body top); back face touches body front
    // at z=+0.8. The 4-unit gap between head bottom (1.2) and body
    // bottom (0.8) reads as the implied neck.
    // Children are positioned RELATIVE to the head's center (0, 1.4, 1.0).
    {
      slot: 'head',
      kind: 'box',
      size: [0.4, 0.4, 0.4],
      offset: [0, 1.4, 1.0],
      color: 'hide',
      children: [
        // Snout — 4 × 2 × 2. Full-width-of-head pink muzzle, sticks out 2
        // units past the head front (z=+0.2 head-local → snout z=+0.2 to
        // +0.4 head-local = +1.2 to +1.4 world). Sits in the lower half of
        // the face (y=-0.2 to 0.0 head-local). Two black nostril decals on
        // the front face.
        { slot: 'snout', kind: 'box', size: [0.4, 0.2, 0.2], offset: [0, -0.1, 0.3], color: 'snout',
          children: [
            // Nostril offsets are in SNOUT-local space (snout front face at z=+0.1).
            // Z=0 marks them as flat decals; the renderer applies polygon offset.
            { kind: 'box', size: [0.05, 0.05, 0], offset: [-0.10, 0.0, 0.10], color: 'eye' },
            { kind: 'box', size: [0.05, 0.05, 0], offset: [ 0.10, 0.0, 0.10], color: 'eye' }
          ]},

        // Horns — 1 × 2 × 1 stubby cream cubes on the top corners of the
        // head. Sit ON TOP (root y=+0.2 head-local = head top), inset 0.5
        // units from the head's left/right edge so the outer face is at
        // x=±0.2 (flush with head outer wall).
        //
        // Wobble: bottom-anchored 'stiff' spring. The horn is rooted to
        // the head bone; head bobs make the tip lag a hair, then snap
        // back. Near-critical damping → no comedy bobble, just life.
        { slot: 'horn-L', kind: 'box', size: [0.1, 0.2, 0.1], offset: [-0.15, 0.3, 0], color: 'horn',
          pivot: 'bottom', wobble: 'stiff' },
        { slot: 'horn-R', kind: 'box', size: [0.1, 0.2, 0.1], offset: [ 0.15, 0.3, 0], color: 'horn',
          pivot: 'bottom', wobble: 'stiff' },

        // Ears — 2 × 2 × 1. HORIZONTAL panels sticking out the sides of the
        // head (vs pig/sheep's vertical hanging ears). Inner face touches
        // the head's outer face at x=±0.2; ear extends outward 2 units to
        // x=±0.4. y-range 0.0 → 0.2 head-local = upper half of head.
        // Rig wraps these in a top-anchored pivot so they hinge from the
        // head edge — ear flop on a horizontal panel reads as a small twist
        // rather than a swing, which is anatomically correct for a cow.
        { slot: 'ear-L', kind: 'box', size: [0.2, 0.2, 0.1], offset: [-0.3, 0.1, 0], color: 'hide' },
        { slot: 'ear-R', kind: 'box', size: [0.2, 0.2, 0.1], offset: [ 0.3, 0.1, 0], color: 'hide' },

        // Eyes — flat 0.05 × 0.05 decals on the head front face above
        // the snout. Same pattern as pig/sheep: sub-voxel sized so the
        // dots read as eyes rather than billboards. Z=0 marks them as
        // decals; renderer applies polygon offset.
        { slot: 'eye-L', kind: 'box', size: [0.05, 0.05, 0], offset: [-0.10, 0.05, 0.20], color: 'eye' },
        { slot: 'eye-R', kind: 'box', size: [0.05, 0.05, 0], offset: [ 0.10, 0.05, 0.20], color: 'eye' }
      ]
    },

    // Legs — 2 × 8 × 2. Twice as tall as sheep legs (cows stand higher).
    // Hide-colored to match the body (cows aren't dark-legged like the
    // sheep — real cow legs match the body coat, with the ground gradient
    // doing the work of darkening them toward the foot). Mounted at the
    // body's bottom CORNERS — outer face at x=±0.4 (body left/right edge),
    // front/back face at z=±0.8 (body front/back edge). Reads as a longer-
    // bodied cow than the sheep's centrally-tucked legs.
    // y-extent: 0 → 0.8 (foot on the ground, top meets body bottom).
    { slot: 'leg-fl', kind: 'box', size: [0.2, 0.8, 0.2], offset: [-0.3, 0.4,  0.7], color: 'hide' },
    { slot: 'leg-fr', kind: 'box', size: [0.2, 0.8, 0.2], offset: [ 0.3, 0.4,  0.7], color: 'hide' },
    { slot: 'leg-bl', kind: 'box', size: [0.2, 0.8, 0.2], offset: [-0.3, 0.4, -0.7], color: 'hide' },
    { slot: 'leg-br', kind: 'box', size: [0.2, 0.8, 0.2], offset: [ 0.3, 0.4, -0.7], color: 'hide' },

    // Tail — 1 × 4 × 1 thin cream stick HANGING DOWN from the back of the
    // body. The rig detects vertical tail geometry (height > depth) and
    // pivots from the top edge instead of the front-bottom corner, then
    // wags around Z (tilting left/right) instead of Y (which would just
    // twist a vertical tail around its own axis).
    //
    // Pivot world position = offset + 'top' anchor [0, +h/2, 0]
    //                      = (0, 1.3, -0.85) + (0, 0.2, 0) = (0, 1.5, -0.85)
    // — 1 unit below the body's back top, hanging from the upper rump
    // rather than dead-flush with the back. Reads more anatomically right
    // (real cow tail roots are below the spine, not on top of it).
    //
    // Tuft is a child mesh of the tail (NOT a separate top-level part), so
    // it inherits the tail's wag transform for free — no extra rigging.
    { slot: 'tail', kind: 'box', size: [0.1, 0.4, 0.1], offset: [0, 1.3, -0.85], color: 'hide',
      children: [
        // Tuft — 2 × 2 × 2 dark puff at the tip of the tail. Tail bottom
        // is at y=-0.2 in tail-local; tuft center at y=-0.3 puts the tuft
        // top flush with the tail end, the rest hanging below.
        //
        // Wobble: top-anchored 'jiggly' spring. The cow's tail wags AND
        // bounces backward each footfall; the tuft hangs from the tip and
        // swings past the tail's stop point — the most visible piece of
        // secondary motion on the cow.
        { kind: 'box', size: [0.2, 0.2, 0.2], offset: [0, -0.3, 0], color: 'hoof',
          pivot: 'top', wobble: 'jiggly' }
      ]
    }
  ],
  collision: { kind: 'cylinder', radius: 0.6, height: 1.6, body: 'solid' },
  concepts: ['alive', 'flesh', 'beast']
}
