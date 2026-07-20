/**
 * Chicken — first biped-avian. Compact body on tall thin legs, neck and
 * head out the front, fan tail out the back, articulated wings tucked
 * along the body sides. The signature chicken head-thrust is
 * BipedAvianRig's job; this file's job is just the silhouette.
 *
 * Body plan: bipedAvian. Origin (0,0,0) is feet-on-ground.
 *
 * Read priorities for the chicken silhouette:
 *   - Tall thin legs supporting a compact body. The legs are 0.40 m
 *     and the body sits at world Y = 0.55. That body-on-stilts profile
 *     is what reads as "bird" before any color tells you it's a chicken.
 *   - Pronounced beak + comb. Yellow cone beak protrudes from the head
 *     front; red comb sits on top. Together these are the unambiguous
 *     "chicken" signal vs other bipedal-avian future characters.
 *   - Articulated wings (humerus + forearm + feathers, see below) and
 *     a fan tail. Tail is a stubby triangular feather group angled up
 *     and back.
 *
 * Authoring topology: legs and tail are CHILDREN of body so they ride
 * BipedAvianRig's body bob and forward lean. Head is a child of body
 * via a short neck cylinder; the rig's head-thrust modifies head's
 * Z position in body-local space.
 *
 * Wing structure (per side) is a 2-joint arm with attached feathers:
 *
 *   body
 *   ├─ wing-base-L  (small static cube at the shoulder — visual joint
 *   │               marker; no motion. Kept as a sibling of wing-arm
 *   │               so it stays put while the arm flaps.)
 *   └─ wing-arm-L   (humerus — long thin bone hinged at the body-side
 *       │           edge, primary flap motion)
 *       ├─ feather-arm-L   (flat panel attached UNDER the upper arm,
 *       │                  jiggly so it lags+overshoots the arm's flap)
 *       └─ wing-fore-L     (forearm — 1.5× longer than the upper arm,
 *           │              hinges at the upper arm's TOP-OUTER corner.
 *           │              When grounded, folds back along the arm via
 *           │              a Y-axis fold so the chicken's wings tuck
 *           │              against its body. When airborne, unfolds and
 *           │              inherits the arm's flap through the
 *           │              scenegraph parent chain — no independent
 *           │              flap motion, just an articulated extension.)
 *           └─ feather-fore-L  (flat panel attached UNDER the forearm,
 *                              jiggly. Tracks the forearm through fold
 *                              + flap.)
 *
 * The chicken stays grounded (entity._grounded stays true) so the
 * forearms hold their folded pose. Setting _grounded false unfolds
 * the wings and the flap preset ramps to hover/fly beats automatically.
 */

const BODY_Y = 0.55

export const CHICKEN = {
  id: 'chicken',
  label: 'Chicken',
  bodyPlan: 'bipedAvian',
  palette: {
    feather:     0xc8b478, // warm cream — main feather color
    featherDark: 0x6e5634, // brown for the tail tip / wing edges (silhouette accent)
    beak:        0xe8b545, // yellow-orange beak
    comb:        0xc4302b, // red comb (the only saturated red on the chicken)
    leg:         0xe8a455, // pale yellow-orange leg
    eye:         0x111111  // dark dot eyes
  },
  parts: [
    // Body — compact roughly egg-shaped form, slightly elongated along
    // Z (length > width). Children are head/neck/wings/tail/legs;
    // they ride body's bob and forward tilt.
    {
      slot: 'body',
      kind: 'box',
      size: [0.20, 0.40, 0.40],
      offset: [0, BODY_Y, 0],
      color: 'feather',
      children: [
        // Neck — short box bridging body top to head. Tilted slightly
        // forward (rotation.x < 0 = top tips toward +Z = forward) so the
        // head sits in front of the body, not directly above it. Box's
        // long axis is Y (matching the original cylinder's long axis)
        // so the same X rotation tilts the same way. Decorative, no
        // rig handling.
        {
          slot: 'neck',
          kind: 'box',
          size: [0.10, 0.20, 0.10],
          offset: [0, 0.20, 0.10],
          rotation: [-0.4, 0, 0],
          color: 'feather'
        },

        // Head — sits at the top of the neck. Children: eyes, beak,
        // comb. The rig writes head.position.z each frame for the
        // signature head-thrust; head also inherits body's forward
        // tilt through the scenegraph parent chain.
        {
          slot: 'head',
          kind: 'box',
          size: [0.20, 0.20, 0.20],
          offset: [0, 0.32, 0.18],
          color: 'feather',
          children: [
            // Eyes — flat dark decals on the head's left/right faces
            // (chickens have side-mounted eyes, not forward-facing).
            // Local Z = 0 with rotation Y=±π/2 turns the zero-thickness
            // axis into world ±X so the decal sits flush on the head's
            // side face. Renderer applies polygon offset so the decal
            // wins the depth test against the head surface.
            { slot: 'eye-L', kind: 'box', size: [0.05, 0.05, 0], offset: [-0.10, 0.02, 0.02], rotation: [0, -Math.PI / 2, 0], color: 'eye' },
            { slot: 'eye-R', kind: 'box', size: [0.05, 0.05, 0], offset: [ 0.10, 0.02, 0.02], rotation: [0,  Math.PI / 2, 0], color: 'eye' },

            // Beak — slim 0.05×0.10×0.05 m box protruding forward from
            // the head's front face. Box's long axis is Y (matching the
            // original cone's long axis); rotation X = π/2 lays it along
            // world +Z so the long axis points forward. Cross-section
            // sits slightly under the cone's max radius (0.035) so the
            // beak still reads pointy-ish without the cone's actual
            // taper.
            {
              slot: 'beak',
              kind: 'box',
              size: [0.05, 0.10, 0.05],
              offset: [0, -0.02, 0.13],
              rotation: [Math.PI / 2, 0, 0],
              color: 'beak'
            },

            // Comb — bright red flat tab on top of the head. Single
            // box; could be an outfit later if other characters want
            // to share. Stands up clearly above the cream feather color.
            {
              slot: 'comb',
              kind: 'box',
              size: [0.05, 0.10, 0.10],
              offset: [0, 0.12, 0.02],
              color: 'comb'
            }
          ]
        },

        // Tail — single feather block, short and stubby, anchored at
        // the back of the body. Authored with depth > height so the
        // BipedAvianRig's 'tail-link' anchor (front face center) lands
        // at the body-tail joint. Rig counter-tilts this around X
        // when the body leans forward.
        //
        // Slight upward angle baked in via rotation.x < 0 — the rest
        // pose has the tail pointing up-and-back, the way a chicken's
        // tail naturally sits. The rig's counter-tilt adds to this
        // base, kicking the tail up further during a sprint.
        {
          slot: 'tail',
          kind: 'box',
          size: [0.20, 0.10, 0.20],
          offset: [0, 0.10, -0.28],
          rotation: [-0.4, 0, 0],
          color: 'featherDark'
        },

        // ---- Wings (articulated 2-joint arm + feathers, see header) ----
        //
        // Per side: a small static cube at the shoulder (wing-base) flanks
        // a long thin upper-arm bone (wing-arm). The arm hinges at body
        // and carries the primary flap motion. The forearm (wing-fore) is
        // 1.5× longer, hinged at the arm's top-outer corner, folds back
        // along the arm when grounded. Two feather panels — one under
        // each bone — are jiggly so they lag and overshoot the bones'
        // motion (parent-spring secondary motion).
        //
        // Sizing (matches old single-panel wing's 0.20 X extent):
        //   wing-arm: 0.08 m long, 0.04×0.04 m cross-section
        //   wing-fore: 0.12 m long (= 0.08 × 1.5), same cross-section
        //   wing-base: 0.06 m cube at the shoulder
        //   feathers: ~0.003 m thin slabs spanning the arm chord (Z=0.28
        //             on the arm panel, tapered to Z=0.22 on the fore
        //             panel for a slightly more pointed wingtip)
        //
        // Wing-base is a sibling of wing-arm (both children of body) so
        // it stays put visually while the arm flaps inside it — like a
        // ball sitting in a socket.

        { slot: 'wing-base-L', kind: 'box', size: [0.05, 0.05, 0.05], offset: [-0.14, 0.05, 0], color: 'feather' },
        { slot: 'wing-base-R', kind: 'box', size: [0.05, 0.05, 0.05], offset: [ 0.14, 0.05, 0], color: 'feather' },

        // Upper-arm bones. Pivot 'right' (wing-L) / 'left' (wing-R) =
        // body-side edge, so the arm hinges at the body's surface. The
        // flap preset on wing-L uses mirror:true so both wings beat UP
        // together despite the geometric mirror. foldAmount stays at 0
        // here — the chicken's signature folded-wing pose comes from the
        // FOREARM folding back, not the upper arm tilting.
        {
          slot: 'wing-arm-L',
          kind: 'box',
          size: [0.10, 0.05, 0.05],
          offset: [-0.18, 0.05, 0],
          color: 'feather',
          pivot: 'right',
          wobble: { preset: 'flap', mirror: true },
          children: [
            // Feathers under the upper arm. Pivot 'top' (= the panel's
            // top edge, just below the bone) so the panel hangs from
            // the bone like draped feathers; jiggly parent-spring lets
            // it lag/overshoot the bone's flap.
            {
              slot: 'feather-arm-L',
              kind: 'box',
              size: [0.10, 0.05, 0.20],
              offset: [0, -0.05, 0],
              color: 'feather',
              pivot: 'top',
              wobble: 'jiggly'
            },
            // Forearm. Pivot 'top-right' = top-OUTER corner of the upper
            // arm in mesh-local (since wing-L extends -X = "left" in
            // mesh-local terms; "right" of the FOREARM is its body-side
            // edge that meets the elbow joint). Fold rotates around Y
            // (1.6 rad ≈ 92° — folds the forearm perpendicular to the
            // arm, lying back along the body's side, the chicken
            // "tucked wing" pose). hoverAmp/flyAmp at 0 keep the elbow
            // joint silent in flight; the forearm just inherits the
            // arm's flap through the scenegraph.
            {
              slot: 'wing-fore-L',
              kind: 'box',
              size: [0.20, 0.05, 0.05],
              offset: [-0.15, 0, 0],
              color: 'feather',
              pivot: 'top-right',
              wobble: { preset: 'flap', mirror: true, foldAmount: -1.6, hoverAmp: 0, flyAmp: 0, axes: ['y'] },
              children: [
                {
                  slot: 'feather-fore-L',
                  kind: 'box',
                  size: [0.20, 0.05, 0.20],
                  offset: [0, -0.05, 0],
                  color: 'feather',
                  pivot: 'top',
                  wobble: 'jiggly'
                }
              ]
            }
          ]
        },
        {
          slot: 'wing-arm-R',
          kind: 'box',
          size: [0.10, 0.05, 0.05],
          offset: [ 0.18, 0.05, 0],
          color: 'feather',
          pivot: 'left',
          wobble: 'flap',
          children: [
            {
              slot: 'feather-arm-R',
              kind: 'box',
              size: [0.10, 0.05, 0.20],
              offset: [0, -0.05, 0],
              color: 'feather',
              pivot: 'top',
              wobble: 'jiggly'
            },
            {
              slot: 'wing-fore-R',
              kind: 'box',
              size: [0.20, 0.05, 0.05],
              offset: [ 0.15, 0, 0],
              color: 'feather',
              pivot: 'top-left',
              wobble: { preset: 'flap', foldAmount: -1.6, hoverAmp: 0, flyAmp: 0, axes: ['y'] },
              children: [
                {
                  slot: 'feather-fore-R',
                  kind: 'box',
                  size: [0.20, 0.05, 0.20],
                  offset: [0, -0.05, 0],
                  color: 'feather',
                  pivot: 'top',
                  wobble: 'jiggly'
                }
              ]
            }
          ]
        },

        // Legs — thin yellow-orange cylinders. Children of body so they
        // ride its bob and forward tilt. BipedAvianRig wraps each in
        // a top-anchored pivot (= the hip joint = the body's bottom
        // surface, by virtue of the leg being offset to put its top
        // there). Rotation.x swings the leg forward/back around the hip.
        //
        // Hip Y in body-local: -body_half_height = -0.16. Foot Y in
        // body-local at rest: -0.16 - 0.40 = -0.56. World Y at rest =
        // BODY_Y + body-local Y = 0.55 - 0.56 = -0.01. ~1 cm under
        // ground absorbs any tiny lift on the swing without the foot
        // visibly floating.
        {
          slot: 'leg-L',
          kind: 'box',
          size: [0.05, 0.40, 0.05],
          offset: [-0.07, -0.36, 0],
          color: 'leg'
        },
        {
          slot: 'leg-R',
          kind: 'box',
          size: [0.05, 0.40, 0.05],
          offset: [ 0.07, -0.36, 0],
          color: 'leg'
        }
      ]
    }
  ],
  collision: { kind: 'cylinder', radius: 0.30, height: 0.95, body: 'solid' },
  // 'avian' isn't curated in concepts.seed.js yet — same status as the
  // other body-plan-specific tags ('spirit', 'slime', 'serpent', etc.).
  concepts: ['alive', 'flesh', 'beast', 'avian']
}
