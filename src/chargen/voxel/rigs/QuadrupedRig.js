import * as THREE from 'three'

/**
 * Quadruped rig — animates a four-leg body authored as a flat list of named
 * primitive parts. Looks for the slot names below; missing slots are no-ops
 * (e.g. an ear-less quadruped just won't get ear twitches once those land).
 *
 * Slot vocabulary:
 *   body, head, tail (+ optional tail-mid, tail-tip for multi-link tails)
 *   neck-1, neck-2, neck-3 (optional multi-segment neck chain — dragons,
 *                           giraffe-likes, anything with a long forward
 *                           neck. Each segment is authored as a CHILD
 *                           of the previous, mirroring the tail-link
 *                           pattern but extending forward (+Z) from the
 *                           body. The head sits at the end of the chain
 *                           as a child of the topmost neck segment.)
 *   leg-fl, leg-fr, leg-bl, leg-br
 *   ear-L, ear-R
 *
 * Decorative children of these slots (snout, eyes, horns, nostrils, tuft,
 * outfits like wool) ride along through the scene-graph parent transform
 * automatically — the rig never needs to know about them.
 *
 * Anchors / pivots:
 *   - legs    pivot at the top edge of the part (so they swing from the hip).
 *   - head    pivots at its back-bottom corner (the "neck"). The head's
 *             scenegraph parent is whichever segment it's authored under
 *             (body for short-necked characters, neck-N for long-necked).
 *   - tail    pivots at its front-bottom corner (the base where it meets body).
 *   - neck-N  pivots at its BACK face center — where it meets the segment
 *             behind it (body or neck-(N-1)). Mirror of the tail-link
 *             pattern but for a forward chain.
 *   - ears    pivot at the top edge (where the ear meets the head — flop from
 *             there like a real ear, not from the bottom of the panel).
 *   - body    no pivot — translated for breath bob and footfall.
 *
 * Animation behaviors:
 *   - Idle      breath bob on body, lazy tail wag, slow head nod, ear idle.
 *               If a multi-segment neck is present, the chain adds a slow
 *               nod down the chain (each segment lags the one before it).
 *   - Walking   diagonal-pair leg gait (front-left + back-right swing together;
 *               front-right + back-left swing together) when entity.vel speed
 *               clears the deadzone. Frequency scales with speed. Multi-
 *               segment neck adds a phase-lagged Y sway from base to head,
 *               so a long neck reads as flexible rather than rigid.
 *
 * Wings, if any, are NOT a rig responsibility — author wing-L / wing-R
 * with `wobble: 'flap'` and the MotionRunner handles them. (Dragons
 * combine the multi-segment neck above with flap wings.)
 *
 * Rig contract (matches WizardRig, even though sheep can't cast):
 *   update(dt), setColors({...}), triggerCast(), syncCastOrigin(), setTipColor()
 */

const LEG_SLOTS = ['leg-fl', 'leg-fr', 'leg-bl', 'leg-br']
// Optional extra tail links beyond the base 'tail' segment. Characters opt
// in by nesting a 'tail-mid' (and optionally 'tail-tip') as children of
// 'tail'. Single-segment tail characters (sheep/pig/cow) are unaffected —
// missing slots are no-ops.
const TAIL_LINK_SLOTS = ['tail-mid', 'tail-tip']
// Optional multi-segment neck chain. Mirror of TAIL_LINK_SLOTS but the
// chain extends FORWARD (+Z) from the body instead of backward.
// Characters opt in by nesting neck-1 as a top-level part with the head
// nested under whichever neck segment is the topmost. Single-headed
// characters (sheep/pig/cow/dog) ignore these slots entirely (no-op).
const NECK_LINK_SLOTS = ['neck-1', 'neck-2', 'neck-3']
const ALL_SLOTS = ['body', 'head', 'tail', 'ear-L', 'ear-R', ...LEG_SLOTS, ...TAIL_LINK_SLOTS, ...NECK_LINK_SLOTS]

const BREATH_AMP = 0.012
const BREATH_FREQ = 1.6

const TAIL_WAG_AMP = 0.45
const TAIL_WAG_FREQ = 2.4

const HEAD_BOB_AMP = 0.07
const HEAD_BOB_FREQ = 0.7

const EAR_TWITCH_AMP = 0.12
const EAR_TWITCH_FREQ = 0.9

const SPEED_DEADZONE = 0.05
const GAIT_LEG_AMP = 0.7
const GAIT_FREQ_PER_SPEED = 4

// Body roll in time with the back feet. Same gait phase as the legs, so
// when leg-br swings forward the torso leans right; when leg-bl swings
// forward it leans left. Reads as the spine flexing toward the planted
// back leg without any extra motion source.
const BODY_SWAY_AMP = 0.12

// Vertical body bob during the gait. Driven by cos(2·gaitPhase): peaks
// (body up) when the legs pass through neutral, troughs (body down) at
// the leg extremes. Two bobs per full gait cycle — the body dips once
// per leg-pair stretch, exactly the user spec "legs apart = down, legs
// together = up". Idle falls back to the small BREATH bob.
const BODY_BOB_AMP = 0.04

// Head bob lags the body bob by this many radians of gaitPhase. Bob
// frequency is 2x gait frequency, so π/6 here = π/3 of the bob cycle
// = 1/6 of a bob period behind the body. Classic follow-through: the
// head settles a beat after the body lands.
const HEAD_BOB_DELAY = Math.PI / 6

// Gait-driven ear flop, layered on top of the idle twitch. Both ears get
// the same Z rotation value in head-local space; geometry then makes the
// leaning-side ear read as "out" and the opposite ear as "tucked in".
// EAR_FLOP_DELAY is additional lag past HEAD_BOB_DELAY — the ear hangs
// from the head, so it should trail the head's tilt, not lead it.
const EAR_FLOP_AMP = 0.25
const EAR_FLOP_DELAY = Math.PI / 8

// Tail Y-wag is the dominant visible tail motion. During walking it's
// driven by the back-leg gait, but counter-phased and lagged: the tail
// swings opposite the leading back leg (counter-balance) and trails it
// for follow-through, like a flag dragging behind a flagpole.
const TAIL_WAG_DELAY = Math.PI / 24

// Multi-link tail curl. Each segment (base + every link) gets the same
// per-segment X rotation, so a 3-segment chain ends up with 3× the
// per-segment angle from base to tip — a smooth arc, not a kinked stick.
// Curl decays toward the run value as speed climbs: perky upright at
// rest (positive curl, ~28° per joint = ~84° at the tip), nearly flat
// at sprint speed (tail streams behind the dog instead of flagging up).
// Only activates when the character has a multi-segment tail (presence
// of 'tail-mid').
//
// Sign convention: positive curl rotates each segment's BACK end UP
// (perky / dog tail). Negative curl rotates it DOWN (dragging / dragon
// tail). Characters override per side via `rigConfig.tailCurl: { idle,
// run }` on the character def — the rig falls back to the perky defaults
// below when no override is present.
const TAIL_CURL_IDLE = 0.5
const TAIL_CURL_RUN = 0.1
const TAIL_CURL_SPEED_REF = 4

// Vertical-tail backward bounce (cow). Layered on top of the side-to-side
// wag (independent X axis vs. Z wag axis). One-sided — the tail kicks
// BACKWARD on each footfall and settles back to vertical, never swinging
// forward. Frequency locks to the gait (twice per gait cycle, one per
// back-leg footfall). Amplitude scales linearly with speed up to
// TAIL_BOUNCE_SPEED_REF, so walk gets a subtle kick and run gets a
// pronounced one. No bounce at idle.
const TAIL_BOUNCE_AMP = 0.5
const TAIL_BOUNCE_SPEED_REF = 4

// Multi-segment neck (dragons, giraffes). Each neck segment gets a small
// per-segment Y sway during walking and a small per-segment X nod at idle.
// Phase lag accumulates down the chain so the wave reads as flowing from
// body to head, not bending in lockstep. Per-segment amplitudes are
// MODEST — they compound through the chain (head inherits all upstream
// neck rotations through the scenegraph), so even small per-segment
// values produce dramatic head excursion on a 3-segment neck.
const NECK_SWAY_AMP = 0.10
const NECK_SWAY_PHASE_LAG = 0.55
const NECK_NOD_AMP = 0.06
const NECK_NOD_FREQ = 0.5
const NECK_NOD_PHASE_LAG = 0.7

// Airborne / jump pose. When entity._grounded === false the rig blends
// from gait toward a tucked pose: body lifts a touch and all four legs
// gather toward the body center. Front legs rotate BACKWARD at the hip
// (negative X) so their feet swing under the chest; back legs rotate
// FORWARD (positive X) so their feet swing under the belly. Together
// the four feet meet near body center — the universal "feet tucked"
// silhouette of a jumping animal (cats, dogs, sheep, dragons all do
// this in midair).
//
// LIFT is modest — the entity itself is moving in world space (engine
// drives entity.pos.y when actually airborne); the rig's lift is the
// secondary "tucked up" silhouette ON TOP of that bulk motion.
// LERP_RATE = 10 → ~100 ms transition, snappy enough for takeoff to
// feel responsive without snapping. Body bob fades to 0 when fully
// airborne (no ground reference to bob over).
const AIRBORNE_LIFT = 0.10
const AIRBORNE_LEG_TUCK = 0.70
const AIRBORNE_LERP_RATE = 10

export class QuadrupedRig {
  constructor({ entity, entityRenderer }) {
    this.entity = entity
    this.entityRenderer = entityRenderer

    this.attached = false
    this.slots = {}

    this.t = 0
    this.tailPhase = Math.random() * Math.PI * 2
    this.headPhase = Math.random() * Math.PI * 2
    this.earPhase = Math.random() * Math.PI * 2
    this.gaitPhase = 0

    this._bodyRestY = null
    this._headRestY = null
    this._tailRestY = null
    // Tail orientation. A "vertical" tail (e.g. cow) hangs down from the
    // body — pivots from the top, wags around Z. A "horizontal" tail
    // (e.g. sheep, pig) extends out the back — pivots from the front-
    // bottom corner, wags around Y. Detected by geometry shape in attach().
    this._tailIsVertical = false
    // Ordered list of neck segments (neck-1 → neck-N). Cached in attach()
    // so the per-frame loops don't have to traverse the slot map. Empty
    // for single-headed characters (sheep/pig/cow/dog).
    this._neckChain = []

    // Smoothed airborne factor (0 = grounded, 1 = fully airborne). Read
    // from entity._grounded each frame and exponentially lerped so the
    // tuck pose doesn't snap on the takeoff frame.
    this._airborneFactor = 0
  }

  attach() {
    if (this.attached) return
    const root = this.entityRenderer?.getMesh?.(this.entity.id)
    if (!root) return

    for (const slot of ALL_SLOTS) {
      const mesh = root.getObjectByName(slot)
      if (!mesh) continue
      this.slots[slot] = { mesh, pivot: null }
    }

    for (const slot of LEG_SLOTS) {
      const entry = this.slots[slot]
      if (!entry) continue
      this._wrapInPivot(entry, 'top')
    }
    if (this.slots.head) this._wrapInPivot(this.slots.head, 'neck')
    if (this.slots.tail) {
      // Vertical tail = taller than it is deep. Hangs from the top.
      const params = this.slots.tail.mesh.geometry?.parameters ?? {}
      this._tailIsVertical = (params.height ?? 0) > (params.depth ?? 0)
      this._wrapInPivot(this.slots.tail, this._tailIsVertical ? 'top' : 'tail-base')
    }
    // Optional multi-link tail segments. Pivot anchored at the joint
    // (front-center face) so X-curl pitches each link's back end up
    // around the joint with the previous link.
    for (const slot of TAIL_LINK_SLOTS) {
      const entry = this.slots[slot]
      if (!entry) continue
      this._wrapInPivot(entry, 'tail-link')
    }
    // Optional multi-segment neck chain. Mirror of the tail-link case
    // above but the joint is the segment's BACK face (where it meets
    // the segment behind it = body or neck-(N-1)). Cached order matches
    // NECK_LINK_SLOTS so the per-frame phase math reads base→head.
    for (const slot of NECK_LINK_SLOTS) {
      const entry = this.slots[slot]
      if (!entry) continue
      this._wrapInPivot(entry, 'neck-link')
      this._neckChain.push(entry)
    }
    // Ears are top-anchored on every body plan. The animation axis differs
    // by ear shape though: a tall vertical panel (sheep/pig) rolls around
    // Z so its tip swings sideways like a real hanging ear; a wide
    // horizontal panel (cow) swung on Z would just bob up-down (panel rolls
    // around its own long axis), so we tag those ears here and swing them
    // around Y instead in update() — outer tip flops front-back like a
    // real cow ear flick.
    for (const slot of ['ear-L', 'ear-R']) {
      const entry = this.slots[slot]
      if (!entry) continue
      this._wrapInPivot(entry, 'top')
      const params = entry.mesh.geometry?.parameters ?? {}
      const w = params.width ?? 0
      const h = params.height ?? 0
      entry.horizontal = w >= h
    }

    if (this.slots.body) this._bodyRestY = this.slots.body.mesh.position.y
    if (this.slots.head?.pivot) this._headRestY = this.slots.head.pivot.position.y
    if (this.slots.tail?.pivot) this._tailRestY = this.slots.tail.pivot.position.y

    this.attached = true
  }

  // Re-parent `mesh` under a new pivot Group anchored at `anchorName` so
  // rotations swing from the joint, not the part's centroid. The mesh keeps its
  // visible world position; only its parent chain changes.
  //
  // Renderer caveat: the engine's `applyDeclarativeAnimations` calls
  // `resetRenderBase` on every spec-tracked child each frame, snapping its
  // `position/rotation/scale` back to the values baked at build time. After
  // re-parenting we have to update that bake or the mesh ricochets back to
  // its pre-wrap offset and ends up double-offset (pivot + original).
  _wrapInPivot(entry, anchorName) {
    const { mesh } = entry
    const parent = mesh.parent
    if (!parent) return

    const anchorLocal = this._anchorOffset(anchorName, mesh)
    const pivotPos = mesh.position.clone().add(anchorLocal)

    const pivot = new THREE.Group()
    pivot.position.copy(pivotPos)
    pivot.name = `${mesh.name}-pivot`

    parent.remove(mesh)
    parent.add(pivot)
    mesh.position.set(-anchorLocal.x, -anchorLocal.y, -anchorLocal.z)
    pivot.add(mesh)

    const base = mesh.userData._renderBase
    if (base) {
      base.position = [mesh.position.x, mesh.position.y, mesh.position.z]
      base.rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]
    }

    entry.pivot = pivot
  }

  _anchorOffset(name, mesh) {
    const params = mesh.geometry?.parameters ?? {}
    const w = params.width ?? 0
    const h = params.height ?? 0
    const d = params.depth ?? 0
    switch (name) {
      case 'top':
        return new THREE.Vector3(0, h / 2, 0)
      case 'bottom':
        return new THREE.Vector3(0, -h / 2, 0)
      case 'neck':
        return new THREE.Vector3(0, -h / 2, -d / 2)
      case 'tail-base':
        return new THREE.Vector3(0, -h / 2, d / 2)
      case 'tail-link':
        return new THREE.Vector3(0, 0, d / 2)
      case 'neck-link':
        // Mirror of tail-link. Neck chains extend FORWARD (+Z) from the
        // body, so each segment's joint with the previous segment is at
        // the BACK face (-d/2). Rotating around this anchor swings the
        // segment (and everything in front of it, including the head)
        // around that joint.
        return new THREE.Vector3(0, 0, -d / 2)
      default:
        return new THREE.Vector3(0, 0, 0)
    }
  }

  update(dt) {
    this.attach()
    if (!this.attached) return

    this.t += dt

    const vx = this.entity.vel?.x ?? 0
    const vz = this.entity.vel?.z ?? 0
    const speed = Math.hypot(vx, vz)
    const walking = speed > SPEED_DEADZONE
    const gaitFreq = walking ? speed * GAIT_FREQ_PER_SPEED : 0
    if (walking) this.gaitPhase += gaitFreq * dt

    // Smooth airborne factor. Computed early so leg + body math below can
    // scale by `groundedFactor = 1 - airborne` (gait/bob fade out) and
    // blend toward the airborne tuck pose by `airborne`.
    const airborneTarget = this.entity?._grounded === false ? 1 : 0
    const airborneK = 1 - Math.exp(-AIRBORNE_LERP_RATE * dt)
    this._airborneFactor += (airborneTarget - this._airborneFactor) * airborneK
    const airborne = this._airborneFactor
    const grounded = 1 - airborne

    // Tail wag — the dominant visible left/right tail motion. While walking,
    // it counter-phases the back-leg gait and lags by TAIL_WAG_DELAY: leg-bl
    // forward (bodyT > 0, slightly earlier in time) → tail swings RIGHT.
    // At idle, falls back to a slow independent oscillator so the tail still
    // has life.
    //
    // Wag axis depends on tail orientation:
    //   - Horizontal (sheep/pig): wag around Y, negate so +bodyT → −Y rot
    //     → tip toward +X (right).
    //   - Vertical (cow): wag around Z, do NOT negate so +bodyT → +Z rot
    //     → hanging tip swings to +X (right). Wag on Y for a vertical tail
    //     would just twist it around its own axis with no visible motion.
    if (this.slots.tail?.pivot) {
      const axis = this._tailIsVertical ? 'z' : 'y'
      const sign = this._tailIsVertical ? 1 : -1
      let wagAngle
      if (walking) {
        wagAngle = sign * Math.sin(this.gaitPhase - TAIL_WAG_DELAY) * TAIL_WAG_AMP
      } else {
        this.tailPhase += TAIL_WAG_FREQ * dt
        wagAngle = Math.sin(this.tailPhase) * TAIL_WAG_AMP
      }
      this.slots.tail.pivot.rotation[axis] = wagAngle
    }

    // Multi-link tail curl. Only activates when the character has a
    // segmented tail (presence of 'tail-mid'); single-segment tails are
    // unaffected. Each segment gets the same per-segment X rotation so
    // they compound into an arc — base tilts, mid tilts again on top of
    // base, tip tilts again on top of mid.
    //
    // Per-character override: `rigConfig.tailCurl: { idle, run }`. Lets
    // a dragon (negative values → tail droops down behind it) share the
    // same rig as the dog (positive default → perky upright tail) by
    // config alone. Missing fields fall back to the module defaults.
    if (this.slots['tail-mid']) {
      const tailCfg = this.entity?.character?.rigConfig?.tailCurl
      const curlIdle = tailCfg?.idle ?? TAIL_CURL_IDLE
      const curlRun = tailCfg?.run ?? TAIL_CURL_RUN
      const t = Math.min(1, speed / TAIL_CURL_SPEED_REF)
      const curl = curlIdle + (curlRun - curlIdle) * t
      if (this.slots.tail?.pivot) this.slots.tail.pivot.rotation.x = curl
      for (const slot of TAIL_LINK_SLOTS) {
        const entry = this.slots[slot]
        if (entry?.pivot) entry.pivot.rotation.x = curl
      }
    } else if (this._tailIsVertical && this.slots.tail?.pivot) {
      // Vertical-tail backward bounce. (1 - cos)/2 → 0..1 oscillator that
      // peaks twice per gait cycle (one peak per back-leg footfall), so
      // the kick locks to the same rhythm as the body bob. Multiplied by
      // amp×speedFactor → silent at idle, subtle at walk, pronounced at
      // run. Always positive → tail never swings forward of vertical.
      const speedFactor = Math.min(1, speed / TAIL_BOUNCE_SPEED_REF)
      const bounce = (1 - Math.cos(this.gaitPhase * 2)) * 0.5
      this.slots.tail.pivot.rotation.x = bounce * TAIL_BOUNCE_AMP * speedFactor
    }

    if (this.slots.head?.pivot) {
      this.headPhase += HEAD_BOB_FREQ * dt
      this.slots.head.pivot.rotation.x = Math.sin(this.headPhase) * HEAD_BOB_AMP
    }

    // Multi-segment neck. Walking → phase-lagged Y sway from base to head;
    // idle → slow phase-lagged X nod down the chain. Each frame writes
    // BOTH axes (one to its sway/nod value, the other to 0) so a swap
    // between walking and idle doesn't leave a stale rotation on the
    // axis that's no longer being driven. Per-segment amps are small,
    // but they compound through the scenegraph chain — head sees the
    // sum of every neck segment above it plus its own .neck pivot
    // animation.
    if (this._neckChain.length) {
      if (walking) {
        for (let i = 0; i < this._neckChain.length; i++) {
          const segment = this._neckChain[i]
          const phase = this.gaitPhase - (i + 1) * NECK_SWAY_PHASE_LAG
          segment.pivot.rotation.y = Math.sin(phase) * NECK_SWAY_AMP
          segment.pivot.rotation.x = 0
        }
      } else {
        for (let i = 0; i < this._neckChain.length; i++) {
          const segment = this._neckChain[i]
          const phase = this.t * NECK_NOD_FREQ - i * NECK_NOD_PHASE_LAG
          segment.pivot.rotation.x = Math.sin(phase) * NECK_NOD_AMP
          segment.pivot.rotation.y = 0
        }
      }
    }

    // Ears are silent at idle (no twitch) and only animate while walking:
    // the head-driven gait flop, layered with a small mirrored wobble so
    // they don't read as a single rigid unit during the flop. Both phases
    // advance only when walking so the wobble doesn't drift through idle
    // time and snap when motion starts.
    //
    // Per-ear axis routing: vertical ears (sheep/pig) rotate around Z; horizontal
    // ears (cow) rotate around Y. See attach() for the geometry-based detection.
    if (this.slots['ear-L']?.pivot || this.slots['ear-R']?.pivot) {
      let wob = 0
      let flop = 0
      if (walking) {
        this.earPhase += EAR_TWITCH_FREQ * dt
        wob = Math.sin(this.earPhase) * EAR_TWITCH_AMP
        // Lagged by EAR_FLOP_DELAY past HEAD_BOB_DELAY for follow-through —
        // the ears trail the head's tilt rather than leading it.
        flop = Math.sin(this.gaitPhase - HEAD_BOB_DELAY - EAR_FLOP_DELAY) * EAR_FLOP_AMP
      }
      for (const slot of ['ear-L', 'ear-R']) {
        const entry = this.slots[slot]
        if (!entry?.pivot) continue
        const isLeft = slot === 'ear-L'
        if (entry.horizontal) {
          // Cow-style: front-back swing around Y. The right ear's Y rotation
          // is sign-flipped so both ears' OUTER tips swing the same way (the
          // ears mirror geometrically, so identical rotation.y would split
          // them — left fwd, right back). Wobble is dropped: a Y-axis wobble
          // on a horizontal panel just twists it around its own long axis,
          // which doesn't read as ear motion.
          entry.pivot.rotation.y = (isLeft ? 1 : -1) * flop
          entry.pivot.rotation.z = 0
        } else {
          // Sheep/pig-style: sideways tilt around Z. wob is mirrored between
          // ears (asymmetric jitter); flop is same-sign so both ears tilt
          // the same direction during the gait flop.
          entry.pivot.rotation.z = (isLeft ? wob : -wob) + flop
          entry.pivot.rotation.y = 0
        }
      }
    }

    // Vertical bob. Walking takes over from breath because the gait amp is
    // an order of magnitude larger and the rhythm has to lock to the legs.
    // Head and tail are both spine-tip parts and trail the body bob by
    // HEAD_BOB_DELAY for follow-through (the body lands first, the
    // extremities settle after). Legs are intentionally left alone —
    // they're the planted ground contact the body bobs over.
    //
    // Bob is scaled by `grounded`: when airborne, bob fades to 0 and the
    // body's static AIRBORNE_LIFT takes over instead. Otherwise the body
    // would bob in midair which reads as bouncing on an invisible floor.
    if (this.slots.body && this._bodyRestY != null) {
      let bodyBob, extremityBob
      if (walking) {
        bodyBob = Math.cos(this.gaitPhase * 2) * BODY_BOB_AMP
        extremityBob = Math.cos((this.gaitPhase - HEAD_BOB_DELAY) * 2) * BODY_BOB_AMP
      } else {
        const breath = Math.sin(this.t * BREATH_FREQ) * BREATH_AMP
        bodyBob = breath
        extremityBob = breath
      }
      bodyBob *= grounded
      extremityBob *= grounded
      this.slots.body.mesh.position.y = this._bodyRestY + bodyBob + AIRBORNE_LIFT * airborne
      if (this.slots.head?.pivot && this._headRestY != null) {
        this.slots.head.pivot.position.y = this._headRestY + extremityBob
      }
      if (this.slots.tail?.pivot && this._tailRestY != null) {
        this.slots.tail.pivot.position.y = this._tailRestY + extremityBob
      }
    }

    // Compute the gait-pose targets first; the airborne blend below mixes
    // them with the tuck pose by `airborne` so the legs move smoothly
    // between gait and tuck without snapping. Body sway also scales by
    // `grounded` — a tucked body in midair has no ground reference to
    // lean against.
    let legA, legB, swayBodyT, swayExtT
    if (walking) {
      legA = Math.sin(this.gaitPhase) * GAIT_LEG_AMP
      legB = Math.sin(this.gaitPhase + Math.PI) * GAIT_LEG_AMP
      // Body sway tracks the back-right leg directly; head and tail use the
      // same gait phase shifted by HEAD_BOB_DELAY for follow-through (matches
      // the vertical bob's delay so the whole spine flexes consistently).
      // a / GAIT_LEG_AMP = sin(gaitPhase); a < 0 → leg-br forward → lean right.
      swayBodyT = legA / GAIT_LEG_AMP
      swayExtT = Math.sin(this.gaitPhase - HEAD_BOB_DELAY)
    } else {
      legA = 0
      legB = 0
      swayBodyT = 0
      swayExtT = 0
    }

    // Blend gait pose with airborne tuck pose. Diagonal-pair gait drives
    // legs in two phases (a/b); each leg's tuck direction depends on
    // whether it's a front or back leg (front feet swing back, back feet
    // swing forward — the four feet meet near body center).
    this._setLeg('leg-fl', grounded * legA + airborne * (-AIRBORNE_LEG_TUCK))
    this._setLeg('leg-fr', grounded * legB + airborne * (-AIRBORNE_LEG_TUCK))
    this._setLeg('leg-bl', grounded * legB + airborne * (+AIRBORNE_LEG_TUCK))
    this._setLeg('leg-br', grounded * legA + airborne * (+AIRBORNE_LEG_TUCK))
    this._applyBodySway(swayBodyT * grounded, swayExtT * grounded)
  }

  _setLeg(slot, swing) {
    const entry = this.slots[slot]
    if (!entry?.pivot) return
    entry.pivot.rotation.x = swing
  }

  // Roll the body, head, and tail around the Z axis. Body and tail both
  // use bodyT — the tail is anchored to the spine right above the back legs,
  // so its left/right swing has to lock to the back-leg gait, not lag it.
  // Head uses extremityT (same shape, lagged by HEAD_BOB_DELAY in gaitPhase)
  // and counter-rotates so it stabilizes against the body roll — a "Disney
  // walk" head bob that also makes the torso lean read more clearly. Each
  // part rotates around its own anchor (body = mesh center, head = neck,
  // tail = tail base); legs are intentionally skipped — they're the ground
  // contact.
  //
  // Z component is independent of the existing pivot rotations (head uses
  // .x for nod, tail uses .y for wag), so assignment doesn't stomp them.
  _applyBodySway(bodyT, extremityT) {
    const bodySway = bodyT * BODY_SWAY_AMP
    const extremitySway = extremityT * BODY_SWAY_AMP
    if (this.slots.body) this.slots.body.mesh.rotation.z = bodySway
    // Skip tail Z sway on vertical tails — the wag already owns the Z axis
    // and they'd just stomp each other every frame.
    if (this.slots.tail?.pivot && !this._tailIsVertical) {
      this.slots.tail.pivot.rotation.z = bodySway
    }
    if (this.slots.head?.pivot) this.slots.head.pivot.rotation.z = -extremitySway
  }

  setColors() {
    // Palette swaps will rebuild the entity render rather than mutate live
    // material colors. Stub kept so the rig contract stays uniform.
  }
  triggerCast() {}
  syncCastOrigin() {}
  setTipColor() {}
}
