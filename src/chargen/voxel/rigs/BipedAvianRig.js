import * as THREE from 'three'

/**
 * Biped-avian rig — animates a horizontal-spine two-legged creature
 * (chicken, raptor, archeopteryx, road-runner). Sister to QuadrupedRig
 * / HumanoidRig: same _wrapInPivot / _anchorOffset machinery, different
 * (intentionally minimal) motion set.
 *
 * Slot vocabulary:
 *   body (required, horizontal spine)
 *   head (required)
 *   neck, beak, comb, eye-L, eye-R   (decorative — children of body or
 *                                     head, ride parent transforms)
 *   leg-L, leg-R
 *   tail (optional, single segment, anchored at front face)
 *
 * Wings, if any, are NOT a rig responsibility — author them with
 * `wobble: { preset: 'flap', mirror: true }` (left wing) and
 * `wobble: 'flap'` (right wing). MotionRunner handles them.
 *
 * Authoring topology: legs are CHILDREN of body so they ride body's
 * subtle bob and forward tilt — when the body leans into a sprint,
 * the legs lean with it (their hips track the body). A real chicken
 * does the same: its legs aren't pinned to the world, they hinge
 * from the pelvis which moves with the body.
 *
 * Anchors / pivots:
 *   - body  no pivot. Position.y carries the (small) bob; rotation.x
 *           carries the forward lean while running.
 *   - head  no pivot. Position.z carries the SIGNATURE chicken head-bob
 *           (head-thrust forward then back, locked to gait phase). Head
 *           still inherits body's tilt through the scenegraph parent
 *           chain — the head-thrust runs IN body-local Z.
 *   - leg   top-anchored pivot at the hip. Rotation.x = sin(gaitPhase)
 *           * AMP for L, +π phase for R (alternating).
 *   - tail  front-face anchored pivot ('tail-link' style). Rotation.x
 *           counter-tilts against the body lean for "balance" feel.
 *
 * Animation behaviors:
 *   - Always-on: legs swing slowly even at idle (small amp). Head
 *                still bobs faintly. Body bob is silent at rest.
 *   - Walking:   legs alternate, body bobs subtly with gait, head
 *                thrusts forward/back along Z, body tilts forward
 *                proportional to speed, tail counter-tilts opposite
 *                to the body's lean.
 *   - Airborne:  both legs tuck up (knees forward), body lifts and
 *                pitches forward more strongly than at run speed
 *                (tail counter-tilt follows automatically through
 *                _bodyTilt). The wing flap (MotionRunner-driven) ramps
 *                up independently when entity._grounded === false.
 *
 * Rig contract (matches QuadrupedRig / HumanoidRig):
 *   update(dt), setColors({...}), triggerCast(), syncCastOrigin(), setTipColor()
 */

const SPEED_DEADZONE = 0.05

// Two-legged gait — fewer cycles per metre than the insect's 4 (longer
// stride per step) but more than the quadruped (no four-leg overlap).
const GAIT_FREQ_PER_SPEED = 3
const IDLE_GAIT_FREQ = 0.6
const IDLE_AMP_SCALE = 0.25

// Big leg swing — chickens visibly lift each foot. ~29° per side.
const LEG_SWING_AMP = 0.5

// Body bob is tiny — a hint of weight, not a vertical pump. Scales with
// abs(sin(gaitPhase)) so it pulses once per step.
const BODY_BOB_AMP = 0.012

// SIGNATURE head-thrust — head moves forward and back along Z relative
// to body once per gait cycle. ~6 cm peak excursion reads cleanly at
// the chicken's body scale.
const HEAD_Z_BOB_AMP = 0.06

// Forward body lean while running. Smoothed so it eases into the lean
// rather than snapping. Capped at BODY_TILT_MAX so a sprint doesn't
// flop the bird onto its beak.
const BODY_TILT_PER_SPEED = 0.05
const BODY_TILT_MAX = 0.25
const TILT_SMOOTH = 6

// Tail counter-balance gain — body tilts forward by θ, tail's local
// rotation tilts BACKWARD by TAIL_COUNTER_GAIN * θ (in body-local).
// Gain > 1 means the tail's WORLD rotation actually points up (the
// counter-tilt overshoots the body tilt) — reads as "tail kicks up
// for balance during a sprint", which is the chicken-running pose.
const TAIL_COUNTER_GAIN = 1.5

// Airborne / jump pose. Both legs tuck forward at the hip (knees come
// up under the body), body lifts a touch and pitches forward beyond
// the normal run-tilt cap. Tail follows automatically via the existing
// _bodyTilt → tail counter-tilt path. LERP_RATE matches the other rigs
// (~100 ms transition).
const AIRBORNE_LIFT = 0.06
const AIRBORNE_LEG_TUCK = 0.75
const AIRBORNE_BODY_TILT = 0.45
const AIRBORNE_LERP_RATE = 10

export class BipedAvianRig {
  constructor({ entity, entityRenderer }) {
    this.entity = entity
    this.entityRenderer = entityRenderer

    this.attached = false
    this.slots = {}

    this.t = 0
    this.gaitPhase = Math.random() * Math.PI * 2

    this._bodyRestY = null
    this._headRestZ = null
    this._bodyTilt = 0

    // Smoothed airborne factor (0 = grounded, 1 = fully airborne).
    this._airborneFactor = 0
  }

  attach() {
    if (this.attached) return
    const root = this.entityRenderer?.getMesh?.(this.entity.id)
    if (!root) return

    const body = root.getObjectByName('body')
    if (!body) return
    this.slots.body = { mesh: body }
    this._bodyRestY = body.position.y

    const head = root.getObjectByName('head')
    if (head) {
      this.slots.head = { mesh: head }
      this._headRestZ = head.position.z
    }

    const tail = root.getObjectByName('tail')
    if (tail) {
      this.slots.tail = { mesh: tail, pivot: null }
      // tail-link anchor (front face center) matches the QuadrupedRig
      // multi-link tail convention. Rotation around the joint axis tips
      // the tail's free end up/down.
      this._wrapInPivot(this.slots.tail, 'tail-link')
    }

    const legL = root.getObjectByName('leg-L')
    if (legL) {
      this.slots.legL = { mesh: legL, pivot: null }
      this._wrapInPivot(this.slots.legL, 'top')
    }
    const legR = root.getObjectByName('leg-R')
    if (legR) {
      this.slots.legR = { mesh: legR, pivot: null }
      this._wrapInPivot(this.slots.legR, 'top')
    }

    this.attached = true
  }

  // Re-parent `mesh` under a pivot Group anchored at `anchorName`. Mirrors
  // QuadrupedRig._wrapInPivot — same _renderBase patch caveat applies.
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
    const h = params.height ?? 0
    const d = params.depth ?? 0
    switch (name) {
      case 'top':       return new THREE.Vector3(0,  h / 2, 0)
      case 'bottom':    return new THREE.Vector3(0, -h / 2, 0)
      case 'tail-link': return new THREE.Vector3(0, 0,  d / 2)
      default:          return new THREE.Vector3(0, 0, 0)
    }
  }

  update(dt) {
    this.attach()
    if (!this.attached) return

    this.t += dt

    const vx = this.entity.vel?.x ?? 0
    const vz = this.entity.vel?.z ?? 0
    const speed = Math.hypot(vx, vz)
    const moving = speed > SPEED_DEADZONE

    const freq = moving ? speed * GAIT_FREQ_PER_SPEED : IDLE_GAIT_FREQ
    this.gaitPhase += freq * dt
    const ampScale = moving ? 1 : IDLE_AMP_SCALE

    // Smoothed airborne factor — read entity._grounded each frame and
    // exponentially lerp. Leg swing scales by `grounded` and a tucked
    // pose scales by `airborne`; body bob fades when airborne, body
    // tilt picks up the larger AIRBORNE_BODY_TILT target, lift kicks
    // in. Tail's counter-tilt follows through _bodyTilt automatically.
    const airborneTarget = this.entity?._grounded === false ? 1 : 0
    const airborneK = 1 - Math.exp(-AIRBORNE_LERP_RATE * dt)
    this._airborneFactor += (airborneTarget - this._airborneFactor) * airborneK
    const airborne = this._airborneFactor
    const grounded = 1 - airborne

    // Legs alternating — sin(phase) for L, sin(phase + π) = -sin(phase)
    // for R. At any moment one leg is swinging forward, the other back.
    // Blended with AIRBORNE_LEG_TUCK so both legs come up together when
    // the bird is in the air.
    const gaitL = Math.sin(this.gaitPhase) * LEG_SWING_AMP * ampScale
    const gaitR = Math.sin(this.gaitPhase + Math.PI) * LEG_SWING_AMP * ampScale
    if (this.slots.legL?.pivot) {
      this.slots.legL.pivot.rotation.x = grounded * gaitL + airborne * AIRBORNE_LEG_TUCK
    }
    if (this.slots.legR?.pivot) {
      this.slots.legR.pivot.rotation.x = grounded * gaitR + airborne * AIRBORNE_LEG_TUCK
    }

    // Body bob + forward tilt. Bob is silent at rest; tilt is silent at
    // rest (target = 0, smoothed back to 0 when stopping). When airborne,
    // bob fades, lift takes over, and the tilt target jumps to the
    // larger AIRBORNE_BODY_TILT — bird leans forward dramatically in
    // midair. Tail follows _bodyTilt via the existing counter-tilt path.
    const body = this.slots.body?.mesh
    if (body && this._bodyRestY != null) {
      const bob = Math.abs(Math.sin(this.gaitPhase)) * BODY_BOB_AMP * ampScale * grounded
      body.position.y = this._bodyRestY + bob + AIRBORNE_LIFT * airborne

      const groundTilt = moving ? Math.min(speed * BODY_TILT_PER_SPEED, BODY_TILT_MAX) : 0
      const targetTilt = grounded * groundTilt + airborne * AIRBORNE_BODY_TILT
      const k = 1 - Math.exp(-TILT_SMOOTH * dt)
      this._bodyTilt += (targetTilt - this._bodyTilt) * k
      body.rotation.x = this._bodyTilt
    }

    // Head Z-bob — the signature chicken head-thrust. Runs in body-local
    // Z; with body's tilt applied through the parent chain, the thrust
    // is along the chicken's tilted spine, exactly the real-world look.
    // Fades when airborne (the head-thrust is a walking-only beat).
    const head = this.slots.head?.mesh
    if (head && this._headRestZ != null) {
      head.position.z =
        this._headRestZ + Math.sin(this.gaitPhase) * HEAD_Z_BOB_AMP * ampScale * grounded
    }

    // Tail counter-tilt. Body's local rotation.x is forward (positive),
    // so tail's local rotation.x is the OPPOSITE sign with overshoot —
    // tail kicks up in world frame for balance. Reads larger when
    // airborne because _bodyTilt itself is larger up there.
    if (this.slots.tail?.pivot) {
      this.slots.tail.pivot.rotation.x = -this._bodyTilt * TAIL_COUNTER_GAIN
    }
  }

  setColors() {}
  triggerCast() {}
  syncCastOrigin() {}
  setTipColor() {}
}
