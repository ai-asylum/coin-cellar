import * as THREE from 'three'
import { getWind, windGust, windPhaseFromId } from './Wind.js'

/**
 * MotionRunner — generic data-driven motion for any part of any character.
 *
 * Sister system to the body-plan rigs (e.g. QuadrupedRig). The rig owns
 * coordinated, gait-coupled motion (legs, body sway, tail wag); the runner
 * owns *generic* motion declared per-part in data:
 *
 *   - `follow: 'parent'` — mass-spring-damper. The pivot tracks the parent's
 *     world rotation; when the parent moves, the spring lags, overshoots,
 *     and settles back to rest. This is "secondary motion" — the bell on a
 *     collar, the floppy ear, the wobbly snout, the tuft on a tail.
 *
 *   - `follow: 'time'` — sin oscillator. Continuous wobble independent of
 *     the parent. The flag flap, the idle bobble.
 *
 * Each motion writes to specific rotation axes of a per-part pivot; multiple
 * motions on the same part sum onto the same axes each frame.
 *
 * Data path:
 *   1. Character data declares `pivot` and `wobble` on a part.
 *   2. `buildCharacterEntity` passes them through onto the render node.
 *   3. `Renderer.meshFromRender` copies them to `userData._pivot` / `_wobble`.
 *   4. `MotionRunner.attach(rootMesh)` traverses the entity, finds wobbly
 *      meshes, wraps each in a pivot Group at its anchor, registers state.
 *   5. `MotionRunner.update(dt)` runs each frame *after* the rig — that way
 *      it sees the rig's parent-slot transforms when measuring deltas.
 *
 * The runner doesn't know about the rig and vice versa. Both are optional;
 * either can be used alone.
 */

// Preset wobble configs keyed by short string. Authoring `wobble: 'jiggly'`
// expands to the matching entry. Stiffness/damping are in classical 1/s²
// and 1/s units (so they're frame-rate independent and can be reasoned
// about as a mass-spring-damper); presets correspond to:
//   floppy — omega ≈ 5.5 rad/s, zeta ≈ 0.36 (highly underdamped, lots of overshoot)
//   jiggly — omega ≈ 9 rad/s,   zeta ≈ 0.56 (medium overshoot, fast settle)
//   stiff  — omega ≈ 14 rad/s,  zeta ≈ 0.79 (near critical, minimal overshoot)
//   wave   — time-driven gentle continuous oscillation
//   flap   — wing flap with three locomotion states:
//               GROUNDED  → static fold pose (no animation), magnitude
//                           = `foldAmount`. Entity is grounded when
//                           `entity._grounded !== false` (missing flag
//                           defaults to grounded for previews).
//               HOVER     → airborne, low motion. Small fast beats.
//               FLY       → airborne, fast motion. Large slower beats.
//             Hover/fly are interpolated by `factor = max(|vel.y| / velYRef,
//             |vel.horiz| / velHorizRef)` clamped 0..1. Transitions
//             between states are exponentially lerped so wings visibly
//             unfold on takeoff and refold on landing instead of snapping.
//             Pair `wing-L` (default) with `wing-R` (`mirror: true`)
//             so both wings flap in sync — the mirror flag negates the
//             rotation output, so a +Z tip-up on wing-L matches a -Z
//             tip-up on wing-R, and both tips rise together. The mirror
//             also applies to `foldAmount`, so a single positive value
//             (= "fold up") works for both wings unchanged.
//
// follow modes:
//   'parent'   — lag the parent's rotation deltas through a spring (the
//                wobble. Reads parent.getWorldQuaternion each frame).
//   'time'     — sin oscillator (continuous). Speed-independent.
//   'velocity' — read `entity.vel` and bend a chosen axis by
//                clamp(speed * factor, 0, max). Smoothed by a low-pass
//                so the cape (or any other speed-responsive part)
//                eases into the flap pose instead of snapping when
//                the entity changes gait. Requires an entity reference;
//                pass it in via attach(rootMesh, entity).
//   'flap'     — wing flap. See 'flap' preset above. Reads `entity.vel.y`
//                or `entity.airborne` to ramp; otherwise self-driven sin.
//   'wind'     — direction-aware rustle that reads the global Wind module.
//                Amplitude scales with wind.strength * windGust(phase);
//                the part tips TOWARD the wind direction (in entity-local
//                frame, so a yawed entity still rustles toward world wind).
//                Per-part phase auto-derives from `${entity.id}:${meshName}`
//                so two trees' foliage-cores rustle out of phase, and
//                within one tree foliage-l and foliage-r also stay
//                de-synced. Use this for leaves, banners, sails, anything
//                that should respond to ambient wind without authoring
//                phase by hand. Axes are implicit (X+Z, the horizontal-
//                plane rotation pair) — the `axes` field is ignored.
const PRESETS = {
  floppy: { follow: 'parent', stiffness: 30,  damping: 4,  sensitivity: 1.4, axes: ['x', 'z'] },
  jiggly: { follow: 'parent', stiffness: 80,  damping: 10, sensitivity: 1.0, axes: ['x', 'z'] },
  stiff:  { follow: 'parent', stiffness: 200, damping: 22, sensitivity: 0.6, axes: ['x', 'z'] },
  wave:   { follow: 'time',   amp: 0.1, freq: 1.5, phase: 0, axes: ['x'] },
  flap:   { follow: 'flap',   foldAmount: 0, hoverAmp: 0.30, hoverFreq: 4.0, flyAmp: 1.0, flyFreq: 2.5, velYRef: 3, velHorizRef: 5, lerpRate: 6, axes: ['z'] },
  wind:   { follow: 'wind',   amp: 0.10, freq: 1.2, sizeScale: 1, freqScale: 0.6, maxAngle: 0.13, axes: ['x', 'z'] }
}

// Hard cap on dt. Tab-away or breakpoint-pause can blow up a spring system
// by handing it a 5-second dt; clamping keeps the integrator stable at the
// cost of "skipping" the missed time (which is the right trade for visual
// wobble — nobody cares that the bell didn't ring while the tab was hidden).
const MAX_DT = 0.05

const AXES = ['x', 'y', 'z']

export class MotionRunner {
  constructor() {
    this.attached = false
    this.rootMesh = null
    // Optional entity reference set by attach(). Velocity-follow motions
    // read entity.vel; other follow modes ignore it. Stored loosely so
    // the runner stays useful for entity-less previews — those simply
    // see velocity contributions resolve to zero.
    this.entity = null
    this.attachments = []

    // Reusable scratch — avoid allocating quaternions/eulers per attachment per frame.
    this._tmpQuat = new THREE.Quaternion()
    this._tmpInvQuat = new THREE.Quaternion()
    this._tmpDeltaQuat = new THREE.Quaternion()
    this._tmpEuler = new THREE.Euler()
  }

  /**
   * Walk the entity's mesh tree and register every part that declares a
   * `wobble` in `userData`. Each registered part is wrapped in a pivot
   * Group anchored at the part's chosen anchor (default 'center').
   *
   * Re-callable safely: if already attached, this is a no-op. To reset
   * (e.g. on character swap), call `detach()` first.
   */
  attach(rootMesh, entity = null) {
    if (this.attached || !rootMesh) return
    this.rootMesh = rootMesh
    this.entity = entity

    // Two passes: first collect every wobble candidate, then wrap them.
    // Collecting up front avoids the trap of mutating the scene graph
    // during traverse() — re-parenting a node mid-iteration can shift
    // the parent's children array and cause traverse to skip siblings.
    const candidates = []
    rootMesh.traverse((node) => {
      if (node.userData?._wobble) candidates.push(node)
    })

    for (const node of candidates) {
      const motions = this._resolveMotions(node.userData._wobble)
      if (!motions.length) continue

      const pivot = this._wrapInPivot(node, node.userData?._pivot ?? 'center')
      if (!pivot) continue

      this.attachments.push({
        mesh: node,
        pivot,
        // Cache parent so we don't re-traverse on every frame.
        parent: pivot.parent,
        // Pivot starts at zero rotation (fresh Group); rest pose IS that.
        // Captured for symmetry with the rig — if someone later sets a
        // base rotation on the pivot, the spring still settles to it.
        restRot: { x: pivot.rotation.x, y: pivot.rotation.y, z: pivot.rotation.z },
        // Per-axis spring state. disp = current displacement from rest;
        // vel = angular velocity. Only the axes listed in motion.axes
        // get integrated, but we keep all three slots for simplicity.
        disp: { x: 0, y: 0, z: 0 },
        vel:  { x: 0, y: 0, z: 0 },
        // Time-driven phase (separate from spring state so a part can
        // stack a 'parent' motion AND a 'time' motion without phase coupling).
        timePhase: 0,
        // Flap phase — owned per-attachment so two wings on the same
        // creature stay in sync (both initialized to 0, both advanced
        // by the same frequency each frame) without coupling to other
        // wing-bearing entities or other 'time' motions on the same part.
        flapPhase: 0,
        // Smoothed flap output. The driver computes a target each frame
        // (fold value when grounded, sin oscillation when airborne) and
        // exponentially lerps `flapValue` toward it. `null` means the
        // first update() should snap to target (no lerp from 0 → fold
        // pose at startup) so previewed characters open in their rest
        // pose, not mid-transition.
        flapValue: null,
        // Last-frame parent quaternion, for delta computation. Initialized
        // lazily on first update() so we don't fire a phantom impulse from
        // (identity → actual parent rotation) on the first frame.
        lastParentQuat: new THREE.Quaternion(),
        first: true,
        motions
      })
    }

    this.attached = true
  }

  /**
   * Drive every registered attachment one frame's worth. Call AFTER the
   * rig's update so the parent-follow springs see the latest parent
   * transforms (rig writes parent slots; runner reads them).
   */
  update(dt) {
    if (!this.attached || this.attachments.length === 0) return
    dt = Math.max(0, Math.min(dt, MAX_DT))
    if (dt <= 0) return

    // Refresh world matrices so getWorldQuaternion() returns post-rig values.
    // The renderer's render() also does this, but it runs AFTER this method,
    // so we need our own pass first.
    this.rootMesh.updateMatrixWorld(true)

    for (const a of this.attachments) {
      // Per-frame accumulator for axis sums across all motion entries.
      const ax = { x: 0, y: 0, z: 0 }

      for (const m of a.motions) {
        if (m.follow === 'parent') {
          this._driveParent(a, m, dt, ax)
        } else if (m.follow === 'time') {
          this._driveTime(a, m, dt, ax)
        } else if (m.follow === 'velocity') {
          this._driveVelocity(a, m, dt, ax)
        } else if (m.follow === 'flap') {
          this._driveFlap(a, m, dt, ax)
        } else if (m.follow === 'wind') {
          this._driveWind(a, m, dt, ax)
        }
      }

      // Write resolved rotations onto the pivot. Untouched axes get just
      // restRot (no contribution accumulated → no change from rest).
      a.pivot.rotation.x = a.restRot.x + ax.x
      a.pivot.rotation.y = a.restRot.y + ax.y
      a.pivot.rotation.z = a.restRot.z + ax.z
    }
  }

  /**
   * Discard registered state. Mesh re-parenting is left in place — the
   * scene's normal tear-down (entity invalidation, dispose) will clean
   * the actual nodes. Call before re-attaching to a different entity.
   */
  detach() {
    this.attachments.length = 0
    this.attached = false
    this.rootMesh = null
  }

  // ---- Drivers ----

  // Parent-follow spring. Reads the parent's world quaternion, computes the
  // local rotation delta since last frame, and injects -delta*sensitivity
  // into the velocity (negative because the lag is OPPOSITE to the parent's
  // motion in the parent's frame). Then runs a standard mass-spring-damper
  // toward rest:  v' = v + (-k*x - c*v) * dt;  x' = x + v' * dt  (semi-implicit Euler).
  _driveParent(a, m, dt, ax) {
    a.parent.getWorldQuaternion(this._tmpQuat)
    if (a.first) {
      a.lastParentQuat.copy(this._tmpQuat)
      a.first = false
    }

    // Local rotation delta (last-frame frame): q_lastInv * q_now.
    this._tmpInvQuat.copy(a.lastParentQuat).invert()
    this._tmpDeltaQuat.copy(this._tmpInvQuat).multiply(this._tmpQuat)
    this._tmpEuler.setFromQuaternion(this._tmpDeltaQuat, 'XYZ')

    const sensitivity = m.sensitivity ?? 1
    const stiffness = m.stiffness ?? 80
    const damping = m.damping ?? 10

    for (const axis of m.axes) {
      // Impulse: parent moved by `delta`; child wants to stay put, which in
      // parent-local frame means moving -delta. Inject as velocity kick.
      const impulse = -this._tmpEuler[axis] * sensitivity
      a.vel[axis] += impulse

      // Mass-spring-damper toward rest (rest displacement = 0).
      const force = -stiffness * a.disp[axis] - damping * a.vel[axis]
      a.vel[axis] += force * dt
      a.disp[axis] += a.vel[axis] * dt

      ax[axis] += a.disp[axis]
    }

    a.lastParentQuat.copy(this._tmpQuat)
  }

  // Time-driven sin oscillator. Has its own per-attachment phase so two
  // different parts using { follow: 'time' } don't lock to the same wave.
  _driveTime(a, m, dt, ax) {
    a.timePhase += dt
    const freq = m.freq ?? 1.5
    const amp = m.amp ?? 0.1
    const phase = m.phase ?? 0
    const value = Math.sin(a.timePhase * freq * Math.PI * 2 + phase) * amp
    for (const axis of m.axes) {
      ax[axis] += value
    }
  }

  // Velocity-driven static bend. Reads entity.vel (set by attach()),
  // computes horizontal speed = hypot(vx, vz), and bends the listed
  // axes by clamp(speed * factor, 0, max). A simple per-motion
  // low-pass filter (smooth ≈ 1/s response time) eases the angle in
  // when speed changes — without it the cape would snap from rest to
  // flap when the viewer toggles between idle / walk / run because
  // those animations step entity.vel discretely. The wobble lag (a
  // separate parent-follow motion stacked on the same attachment)
  // rides on top of this resolved bend.
  //
  // Motion config:
  //   factor     rad / (m·s⁻¹). Tuned per part. Default 0.4.
  //   max        clamp ceiling in rad. Default π/2.5 ≈ 72°.
  //   smooth     low-pass response in 1/s. Default 5 (settle ≈ 0.2 s).
  _driveVelocity(a, m, dt, ax) {
    const vel = this.entity?.vel
    const factor = m.factor ?? 0.4
    const max = m.max ?? Math.PI / 2.5
    const smooth = m.smooth ?? 5
    const speed = vel ? Math.hypot(vel.x ?? 0, vel.z ?? 0) : 0
    const target = Math.min(speed * factor, max)
    if (m._flapAngle == null) m._flapAngle = 0
    const k = Math.min(1, dt * smooth)
    m._flapAngle += (target - m._flapAngle) * k
    for (const axis of m.axes) {
      ax[axis] += m._flapAngle
    }
  }

  // Wing flap with three locomotion states:
  //   GROUNDED  → static fold pose (no animation), magnitude = foldAmount.
  //   HOVER     → airborne, low velocity. Small fast beats.
  //   FLY       → airborne, high velocity. Large slower beats.
  //
  // Grounded vs airborne is read from `entity._grounded`. Missing flag
  // (or no entity, e.g. previews) defaults to grounded — the rest pose
  // is "wings folded, not flapping", matching the user-facing intuition
  // that idle = perched / at rest.
  //
  // Hover/fly are interpolated by `factor = max(|vel.y| / velYRef,
  // |vel.horiz| / velHorizRef)` clamped 0..1. A pure vertical climber
  // (taking off) reaches factor 1 quickly; a horizontal cruiser (level
  // flight) does too. Both produce the larger flyAmp/flyFreq beats.
  // A motionless hovering creature (everything ~0) stays at hoverAmp.
  //
  // Phase advances every frame once airborne (so two wings on the same
  // entity stay in lockstep regardless of when they crossed the
  // grounded → airborne boundary). When grounded, phase doesn't reset
  // — that way a quick takeoff-then-landing doesn't leave the wings
  // mid-stroke; they smoothly lerp back to fold from wherever the sin
  // happened to be.
  //
  // The smoothed output `a.flapValue` exponentially tracks the per-frame
  // target. lerpRate = 6/s gives ~167 ms transitions: visible unfold on
  // takeoff, visible refold on landing, no instant snap.
  //
  // Mirror handling: a single 'flap' preset writes the SAME signed
  // angle to its axes. To keep paired wings synchronized (both tips
  // up on the upstroke, both down on the downstroke), wing-L should
  // be authored with `mirror: true` so its rotation output is negated.
  // This pairs with the natural geometry mirroring (wing-L pivots on
  // its right edge, wing-R on its left) so a -Z rotation lifts wing-L's
  // tip and a +Z rotation lifts wing-R's tip — both wings rise together.
  // The mirror is ALSO applied to `foldAmount`, so a single positive
  // value (= "fold up") produces a synchronized fold across both wings
  // without authors having to hand-flip the sign per side.
  _driveFlap(a, m, dt, ax) {
    const sign = m.mirror === true ? -1 : 1
    // _grounded is the engine-stamped flag (runtime/movement.js,
    // server snapshot, character defaults). Missing → grounded.
    const grounded = this.entity?._grounded !== false

    let target = 0
    if (grounded) {
      target = (m.foldAmount ?? 0) * sign
    } else {
      const velYRef = m.velYRef ?? 3
      const velHorizRef = m.velHorizRef ?? 5
      const vy = Math.abs(this.entity?.vel?.y ?? 0)
      const vx = this.entity?.vel?.x ?? 0
      const vz = this.entity?.vel?.z ?? 0
      const vh = Math.hypot(vx, vz)
      const factor = Math.min(1, Math.max(vy / velYRef, vh / velHorizRef))

      const hoverAmp = m.hoverAmp ?? 0.30
      const hoverFreq = m.hoverFreq ?? 4.0
      const flyAmp = m.flyAmp ?? 1.0
      const flyFreq = m.flyFreq ?? 2.5
      const amp = hoverAmp + (flyAmp - hoverAmp) * factor
      const freq = hoverFreq + (flyFreq - hoverFreq) * factor

      a.flapPhase += freq * dt * Math.PI * 2
      target = Math.sin(a.flapPhase) * amp * sign
    }

    // Snap on first frame so newly-attached entities open in their
    // current state's pose, not lerping from 0. After that, smooth.
    if (a.flapValue == null) {
      a.flapValue = target
    } else {
      const lerpRate = m.lerpRate ?? 6
      const k = 1 - Math.exp(-lerpRate * dt)
      a.flapValue += (target - a.flapValue) * k
    }

    for (const axis of m.axes) {
      ax[axis] += a.flapValue
    }
  }

  // Wind-driven rustle. Reads the global Wind module each frame and tilts
  // the part toward the wind direction with a sin oscillator whose
  // amplitude AND frequency both scale with wind strength. Per-attachment
  // phase is hashed from `${entity.id}:${meshName}` and cached so two
  // foliage parts on the same tree don't rustle in lockstep, and two
  // different trees' foliage-cores stay desynced too.
  //
  // Amplitude is scaled by the part's geometric size so smaller parts
  // shake more vigorously than larger ones at the same wind strength —
  // physical intuition: less mass moves more easily under the same force.
  // The `sizeScale` field controls the exponent (default 1, full inverse-
  // linear scaling). Set sizeScale: 0 to opt out and have all parts
  // rotate by the raw `amp`.
  //
  // Frequency is scaled by `1 + freqScale * (wind.strength - 1)` so the
  // leaves don't just rotate FARTHER in stronger wind, they also flutter
  // FASTER — what real foliage does. Phase is integrated per-frame
  // (a._windAccum) instead of being sampled as `t * freq`, because
  // direct-sample formulations jerk every time freq changes (a smooth
  // strength ramp produces a non-smooth phase argument). freqScale=0
  // pins frequency to the authored base.
  //
  // Final value is soft-clamped through tanh: at low wind tanh(x) ≈ x
  // and motion is unaffected, but as raw amp grows past `maxAngle` the
  // result asymptotes to ±maxAngle — leaves saturate at their max swing
  // instead of folding through themselves under storm-state-storm-strength
  // conditions. Combined with the freq scaling, high wind reads as
  // vigorous fluttering rather than slow huge swings.
  //
  // Wind direction is rotated into the entity's local frame (R_y(-yaw))
  // before being applied to local rotation.x / rotation.z, so a tree
  // facing any direction still rustles toward the same WORLD wind.
  // The motion's `axes` field is intentionally ignored — this driver
  // always writes both X and Z, since the rustle direction is a 2D
  // vector rather than a single axis.
  _driveWind(a, m, dt, ax) {
    if (a._windPhase == null) {
      const eid = this.entity?.id ?? ''
      const name = a.mesh?.name ?? ''
      a._windPhase = windPhaseFromId(`${eid}:${name}`)
    }

    // Lazy size init: mean of bounding-box dimensions. Falls back to 1.0
    // (the no-scaling identity) when the mesh isn't a BoxGeometry, since
    // params.{width,height,depth} only exist for boxes. Floor at 0.1 m so
    // a vanishingly-small part doesn't blow amp to infinity.
    if (a._windSize == null) {
      const params = a.mesh?.geometry?.parameters ?? {}
      const w = params.width ?? 1
      const h = params.height ?? 1
      const d = params.depth ?? 1
      a._windSize = Math.max(0.1, (w + h + d) / 3)
    }

    // Phase accumulator — see comment above. Seed with the per-attach
    // offset so the desync is preserved on frame 1.
    if (a._windAccum == null) a._windAccum = a._windPhase

    const wind = getWind()
    const gust = windGust(a._windPhase)

    const baseFreq = m.freq ?? 1.2
    const freqScale = m.freqScale ?? 0.6
    // Floor at 0.1 so a near-zero strength doesn't stop the integrator
    // entirely — there's still a faint stir even in dead-calm air.
    const freqMul = Math.max(0.1, 1 + freqScale * (wind.strength - 1))
    const freq = baseFreq * freqMul
    a._windAccum += freq * Math.PI * 2 * Math.max(0, dt)

    const amp = m.amp ?? 0.10
    const sizeScale = m.sizeScale ?? 1
    // sizeFactor = 1 / size^sizeScale. At sizeScale=0, factor=1 (no
    // scaling). At sizeScale=1, factor=1/size (a 0.5m cube shakes 2× as
    // much as a 1.0m cube, a 2.0m cube shakes half as much). At
    // sizeScale=0.5, the relationship softens to inverse-sqrt.
    const sizeFactor = 1 / Math.pow(a._windSize, sizeScale)
    // entity.prop.windAmpMul is published by wind-aware rigs (currently
    // SwayingRig) so flipping a tree to 'still' state also calms its
    // leaves, not just its trunk. Defaults to 1 for entities whose rig
    // doesn't speak this protocol.
    const stateMul = this.entity?.prop?.windAmpMul ?? 1
    const rawValue = Math.sin(a._windAccum) * amp * sizeFactor * wind.strength * gust * stateMul

    // Soft tanh saturation: linear at small inputs, asymptotes to ±maxAngle
    // at large inputs. Smoother than hard clipping (no "hits a wall" jerk
    // at the cap), so the leaf approaches its max swing organically and
    // sits there while wind keeps gusting.
    const maxAngle = m.maxAngle ?? 0.13
    const value = maxAngle * Math.tanh(rawValue / maxAngle)

    const yaw = this.entity?.yaw ?? 0
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const localDirX = wind.dirX * cy - wind.dirZ * sy
    const localDirZ = wind.dirX * sy + wind.dirZ * cy

    // Tip the part's +Y axis toward (localDirX, localDirZ): rotation around
    // local X by +α tips +Y → +Z, rotation around local Z by +α tips +Y → -X.
    ax.x += value * localDirZ
    ax.z += -value * localDirX
  }

  // ---- Authoring helpers ----

  // Normalize a wobble declaration into a list of motion configs. Accepts:
  //   - a preset string ('jiggly')
  //   - a config object ({ follow: 'parent', stiffness: ..., axes: [...] })
  //   - an array mixing both (['floppy', { follow: 'time', amp: 0.05 }])
  _resolveMotions(decl) {
    const items = Array.isArray(decl) ? decl : [decl]
    const out = []
    for (const item of items) {
      let cfg = item
      if (typeof item === 'string') {
        const preset = PRESETS[item]
        if (!preset) {
          console.warn(`[MotionRunner] unknown wobble preset: "${item}"`)
          continue
        }
        cfg = preset
      } else if (item && typeof item === 'object' && typeof item.preset === 'string') {
        // Object with a `preset` key references a preset and overrides
        // specific fields. Lets a caller author e.g.
        //   wobble: { preset: 'flap', mirror: true }
        // without having to spell out the full preset inline. Only the
        // fields the override sets win; everything else inherits from
        // the preset, including `follow` and `axes`.
        const preset = PRESETS[item.preset]
        if (!preset) {
          console.warn(`[MotionRunner] unknown wobble preset: "${item.preset}"`)
          continue
        }
        const { preset: _, ...overrides } = item
        cfg = { ...preset, ...overrides }
      }
      if (!cfg || typeof cfg !== 'object') continue

      // Normalize axes. Strings are converted to a one-element array; missing
      // axes default to ['x', 'z'] (the most common rotation pair for swing/twist).
      let axes
      if (typeof cfg.axes === 'string') axes = [cfg.axes]
      else if (Array.isArray(cfg.axes) && cfg.axes.length) axes = cfg.axes
      else axes = ['x', 'z']
      const validAxes = axes.filter((a) => AXES.includes(a))
      if (!validAxes.length) continue

      out.push({
        ...cfg,
        follow: cfg.follow ?? 'parent',
        axes: validAxes
      })
    }
    return out
  }

  // Wrap `mesh` in a fresh THREE.Group at the chosen anchor. The mesh keeps
  // its visible position; only its parent chain gains a pivot in the middle.
  // Same pattern as QuadrupedRig._wrapInPivot — including the _renderBase
  // patch, without which the renderer's per-frame reset would snap the mesh
  // back to its pre-wrap offset and you'd see it ricochet every frame.
  _wrapInPivot(mesh, anchor) {
    const parent = mesh.parent
    if (!parent) return null

    const anchorLocal = this._anchorOffset(anchor, mesh)
    const pivotPos = mesh.position.clone().add(anchorLocal)

    const pivot = new THREE.Group()
    pivot.position.copy(pivotPos)
    pivot.name = `${mesh.name || 'wobble'}-wobble-pivot`

    parent.remove(mesh)
    parent.add(pivot)
    mesh.position.set(-anchorLocal.x, -anchorLocal.y, -anchorLocal.z)
    pivot.add(mesh)

    const base = mesh.userData._renderBase
    if (base) {
      base.position = [mesh.position.x, mesh.position.y, mesh.position.z]
      base.rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]
    }

    return pivot
  }

  // Resolve an anchor name OR explicit [x, y, z] offset into a Vector3 in
  // mesh-local space. Box-derived anchors use the mesh's geometry parameters;
  // non-box meshes fall back to dimensions of 0 and end up with a
  // center-equivalent offset (still safe — they just won't have a meaningful
  // pivot point unless the author passes an explicit array).
  //
  // Anchor naming:
  //   - Single axis ('top', 'right', etc.) → face center (one axis at ±extent/2,
  //     the other two at 0).
  //   - Two-axis hyphenated ('top-left', 'right-back', etc.) → edge midpoint
  //     (two axes at ±extent/2, the third at 0). Order doesn't matter:
  //     'top-left' === 'left-top'. Used for hinging an articulated child
  //     part at one edge of a parent box — e.g. wing-fore at the top-outer
  //     edge of wing-arm.
  //   - Domain-specific ('neck', 'tail-base', 'tail-link') → carry over from
  //     the rigs' anchor vocabulary so authors can use the same names in
  //     wobble pivots as in rig pivots.
  _anchorOffset(anchor, mesh) {
    if (Array.isArray(anchor) && anchor.length === 3) {
      return new THREE.Vector3(anchor[0] ?? 0, anchor[1] ?? 0, anchor[2] ?? 0)
    }
    const params = mesh.geometry?.parameters ?? {}
    const w = params.width ?? 0
    const h = params.height ?? 0
    const d = params.depth ?? 0
    switch (anchor) {
      case 'top':          return new THREE.Vector3(0,  h / 2, 0)
      case 'bottom':       return new THREE.Vector3(0, -h / 2, 0)
      case 'front':        return new THREE.Vector3(0, 0,  d / 2)
      case 'back':         return new THREE.Vector3(0, 0, -d / 2)
      case 'left':         return new THREE.Vector3(-w / 2, 0, 0)
      case 'right':        return new THREE.Vector3( w / 2, 0, 0)
      // Edge midpoints — combine two face-center anchors. Useful for
      // hinging an articulated child at one edge of a parent box (e.g.
      // a wing-fore that hinges at the top-outer edge of a wing-arm so
      // it folds back along the arm's top surface).
      case 'top-left':     case 'left-top':     return new THREE.Vector3(-w / 2,  h / 2, 0)
      case 'top-right':    case 'right-top':    return new THREE.Vector3( w / 2,  h / 2, 0)
      case 'top-front':    case 'front-top':    return new THREE.Vector3(0,       h / 2,  d / 2)
      case 'top-back':     case 'back-top':     return new THREE.Vector3(0,       h / 2, -d / 2)
      case 'bottom-left':  case 'left-bottom':  return new THREE.Vector3(-w / 2, -h / 2, 0)
      case 'bottom-right': case 'right-bottom': return new THREE.Vector3( w / 2, -h / 2, 0)
      case 'bottom-front': case 'front-bottom': return new THREE.Vector3(0,      -h / 2,  d / 2)
      case 'bottom-back':  case 'back-bottom':  return new THREE.Vector3(0,      -h / 2, -d / 2)
      case 'left-front':   case 'front-left':   return new THREE.Vector3(-w / 2, 0,  d / 2)
      case 'left-back':    case 'back-left':    return new THREE.Vector3(-w / 2, 0, -d / 2)
      case 'right-front':  case 'front-right':  return new THREE.Vector3( w / 2, 0,  d / 2)
      case 'right-back':   case 'back-right':   return new THREE.Vector3( w / 2, 0, -d / 2)
      case 'neck':         return new THREE.Vector3(0, -h / 2, -d / 2)
      case 'tail-base':    return new THREE.Vector3(0, -h / 2,  d / 2)
      case 'tail-link':    return new THREE.Vector3(0, 0,       d / 2)
      case 'center':
      default:             return new THREE.Vector3(0, 0, 0)
    }
  }
}
