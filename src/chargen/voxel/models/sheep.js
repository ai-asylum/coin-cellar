import { WOOL } from '../outfits/wool.js'

/**
 * Sheep — bare/hairless base body. Wool is NOT part of the base anatomy;
 * it ships as a default outfit (see WOOL import) that the build pipeline
 * grafts onto body/head/tail at entity-construction time.
 *
 * Authoring this way keeps the cow, sheep, and any future wooly creature
 * sharing the same underlying skeleton + skin geometry. The wool is just
 * decorative blocks on top — shearing later is "remove the WOOL outfit",
 * dyeing is "swap WOOL's palette", trimming is "drop one attachment".
 *
 * Body plan: quadruped. Origin (0,0,0) is feet-on-ground.
 *
 * Voxel grid: every BODY dimension is a power-of-2 number of 0.1m units
 * ({1, 2, 4, 8, 16}). Offsets snap to half-unit increments so vertex
 * positions all land on the 0.1m grid (Minecraft-style). When adding parts:
 *   1. Pick a size from the pow2 set.
 *   2. Place its center so the part's bounds end on multiples of 0.1m.
 *      For an even-unit dimension that's an integer offset; for a 1-unit
 *      dimension that's an odd half-integer offset (e.g. 0.05, 0.15).
 *
 * Sub-voxel exception: face details (eyes, brow, nose dot) can use 1/2-unit
 * sizes (0.05m). At a 1-unit eye on a 4-unit face, the eye is 25% of the
 * face width — too big. 1/2-unit gives proportional pinprick dots. This is
 * the only place the rule bends; everything that defines the silhouette
 * stays on the full grid.
 *
 * Flat surface details (eyes) use thin 0.005 m boxes centered on the
 * parent's surface — half the box is buried inside the parent geometry
 * (occluded), the other half pokes out as a small flush stud. Reorient
 * with `rotation` for top/side/back faces just like a plane decal.
 *
 * Read priorities for the BARE sheep (silhouette without wool):
 *   - No snout. Sheep have flat faces — a forward-poking box would read pig.
 *   - Tucked head. Head sits low at the body front, not perched up like the
 *     cow. Sheep carry their heads at body height.
 *   - No horns. Hairless sheep should still read as "sheep-shaped", not goat.
 */
export const SHEEP = {
  id: 'sheep',
  label: 'Sheep',
  bodyPlan: 'quadruped',
  palette: {
    skin: 0xa67a68, // pink-brown bare skin (whole body, head, ears, tail)
    hoof: 0x2a2018, // dark legs
    eye: 0x111111
    // wool color comes from the WOOL outfit (palette merge fills it in)
  },
  parts: [
    // Body — 4 × 4 × 8 (0.4 × 0.4 × 0.8 m). Half the cow's body in every
    // dimension. Sheep are small; the wool overlay (when wired) is what
    // makes them read as chunky, not the underlying skeleton. Body sits
    // LOWER than the leg tops — legs poke up through the body silhouette
    // (the wool overlay will cover the gap when wired).
    // y-extent: 0.6 → 1.0
    { slot: 'body', kind: 'box', size: [0.4, 0.4, 0.8], offset: [0, 0.8, 0], color: 'skin' },

    // Head — 4 × 4 × 4 (0.4 m cube). Pokes out the front-TOP of the body
    // with the head's center aligned to body top (y=1.0). Head bottom at
    // y=0.8 (body middle), head top at y=1.2 (above body top) — implies a
    // short neck.
    // z-extent: 0.4 → 0.8 (head back face touches body front at z=0.4)
    //
    // Children are positioned RELATIVE to the head's center (0, 1.0, 0.6).
    // Subtract that from absolute placements when authoring new accessories.
    {
      slot: 'head',
      kind: 'box',
      size: [0.4, 0.4, 0.4],
      offset: [0, 1.0, 0.6],
      color: 'skin',
      children: [
        // Ears — 1 × 2 × 2. Small flat panels at the head's upper-side
        // corners. Inner face touches the head's outer face (x=±0.2);
        // top of ear flush with head top (y=+0.2). Rig wraps these in a
        // top-anchored pivot so they hinge from where they meet the head.
        { slot: 'ear-L', kind: 'box', size: [0.1, 0.2, 0.2], offset: [-0.25, 0.1, 0], color: 'skin' },
        { slot: 'ear-R', kind: 'box', size: [0.1, 0.2, 0.2], offset: [ 0.25, 0.1, 0], color: 'skin' },

        // Eyes — flat 0.05 × 0.05 decals on the head's front face (face
        // plane at z=+0.2). Z=0 marks them as decals; the renderer
        // applies polygon offset so they win the depth test against the
        // head surface they're stuck to.
        { slot: 'eye-L', kind: 'box', size: [0.05, 0.05, 0], offset: [-0.15, 0.05, 0.20], color: 'eye' },
        { slot: 'eye-R', kind: 'box', size: [0.05, 0.05, 0], offset: [ 0.15, 0.05, 0.20], color: 'eye' }
      ]
    },

    // Legs — 2 × 8 × 2. Doubled height vs the original sheep — leggier
    // silhouette before the wool puff goes on. Splayed 1 unit outward of
    // the body's left/right edges (leg center at x=±0.2, outer face at
    // x=±0.3, body edge at x=±0.2 — leg sticks out 1 unit past the body).
    // Reads as a wider stance than corner-mounted legs. Z stays at the
    // body's front/back edges (corner-aligned in the long axis).
    // Skin-colored to match the body; ground gradient handles foot darkening.
    // y-extent: 0 → 0.8 (foot on the ground, top meets body bottom)
    { slot: 'leg-fl', kind: 'box', size: [0.2, 0.8, 0.2], offset: [-0.2, 0.4,  0.2], color: 'skin' },
    { slot: 'leg-fr', kind: 'box', size: [0.2, 0.8, 0.2], offset: [ 0.2, 0.4,  0.2], color: 'skin' },
    { slot: 'leg-bl', kind: 'box', size: [0.2, 0.8, 0.2], offset: [-0.2, 0.4, -0.4], color: 'skin' },
    { slot: 'leg-br', kind: 'box', size: [0.2, 0.8, 0.2], offset: [ 0.2, 0.4, -0.4], color: 'skin' },

    // Tail — 1 × 1 × 2. Slim stub behind the body, lifted to body top so
    // the wag pivot (front-bottom corner) sits at body-back-TOP corner
    // [0, 0.9, -0.4]. Tail top flush with body top (y=1.0). The wool
    // overlay will eventually add a fluff puff over the top of it.
    { slot: 'tail', kind: 'box', size: [0.1, 0.1, 0.2], offset: [0, 0.95, -0.5], color: 'skin' }
  ],
  collision: { kind: 'cylinder', radius: 0.3, height: 1.2, body: 'solid' },
  concepts: ['alive', 'flesh', 'beast'],
  // Default outfits applied by buildCharacterEntity. Game/spawn code can
  // override with its own list (e.g. a sheared sheep would pass []).
  defaultOutfits: [WOOL]
}
