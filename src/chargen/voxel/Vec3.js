// 3D vector class for spell-facing API surfaces.
//
// Why this exists: generated spell code calls Vector3 methods (.add,
// .clone, .multiplyScalar, .normalize, etc.) on values returned by
// world.api.vec / world.api.dir / world.queryNear and on entity.pos /
// entity.vel. Today those values are THREE.Vector3 instances, which
// pulls three.js into anything that touches them — including the
// future server-side spell sandbox (Worker / isolated-vm), where
// shipping THREE is wasteful and DOM-coupled.
//
// Vec3 mirrors the subset of Vector3's surface that audit shows
// generated spells actually use. Same method names, same shape, same
// chaining semantics. Cached spells continue to work without rewriting.
// Renderer + physics-internal code converts Vec3 → THREE.Vector3 only
// at the seam where THREE features (matrices, quaternions, mesh
// transforms) are genuinely needed.
//
// Reference: docs/specs/multiplayer.md MP0.2.

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = +x
    this.y = +y
    this.z = +z
  }

  // ---- Mutators (return `this` for chaining) ----

  set(x, y, z) {
    this.x = +x
    this.y = +y
    this.z = +z
    return this
  }

  // Accepts any object with numeric x/y/z — Vec3, THREE.Vector3, or
  // a plain {x, y, z} record. Lets engine internals interop with
  // three.js types at boundaries without explicit conversion.
  copy(v) {
    this.x = +v.x
    this.y = +v.y
    this.z = +v.z
    return this
  }

  add(v) {
    this.x += +v.x
    this.y += +v.y
    this.z += +v.z
    return this
  }

  sub(v) {
    this.x -= +v.x
    this.y -= +v.y
    this.z -= +v.z
    return this
  }

  multiplyScalar(s) {
    const n = +s
    this.x *= n
    this.y *= n
    this.z *= n
    return this
  }

  divideScalar(s) {
    const n = +s
    if (n === 0) {
      this.x = 0
      this.y = 0
      this.z = 0
      return this
    }
    this.x /= n
    this.y /= n
    this.z /= n
    return this
  }

  // a += other * s — common in spell physics for additive nudge per tick.
  addScaledVector(v, s) {
    const n = +s
    this.x += +v.x * n
    this.y += +v.y * n
    this.z += +v.z * n
    return this
  }

  // Set self = a + b without mutating either input. Same shape as
  // THREE.Vector3.addVectors so generated code targeting Vector3 idioms
  // works unchanged.
  addVectors(a, b) {
    this.x = +a.x + +b.x
    this.y = +a.y + +b.y
    this.z = +a.z + +b.z
    return this
  }

  // Set self = a - b without mutating either input.
  subVectors(a, b) {
    this.x = +a.x - +b.x
    this.y = +a.y - +b.y
    this.z = +a.z - +b.z
    return this
  }

  negate() {
    this.x = -this.x
    this.y = -this.y
    this.z = -this.z
    return this
  }

  // Linear interpolation toward v by factor t in [0, 1]. Mutates self.
  // Out-of-range t still applied verbatim (matches THREE's permissive
  // behavior — useful for over/undershoot).
  lerp(v, t) {
    const a = +t
    this.x += (+v.x - this.x) * a
    this.y += (+v.y - this.y) * a
    this.z += (+v.z - this.z) * a
    return this
  }

  // Cross product: self = self × v. Mutates self.
  cross(v) {
    const ax = this.x, ay = this.y, az = this.z
    const bx = +v.x, by = +v.y, bz = +v.z
    this.x = ay * bz - az * by
    this.y = az * bx - ax * bz
    this.z = ax * by - ay * bx
    return this
  }

  // Cross product: self = a × b without mutating either input.
  crossVectors(a, b) {
    const ax = +a.x, ay = +a.y, az = +a.z
    const bx = +b.x, by = +b.y, bz = +b.z
    this.x = ay * bz - az * by
    this.y = az * bx - ax * bz
    this.z = ax * by - ay * bx
    return this
  }

  // Normalize then scale to the given magnitude. Zero-length stays zero
  // (no NaN). Common spell idiom: dir.setLength(speed).
  setLength(s) {
    return this.normalize().multiplyScalar(+s)
  }

  // Rotate self by a quaternion {x, y, z, w}. Mutates self. Generated
  // spell code rarely needs this directly because THREE.Quaternion is
  // not in the sandbox scope, but it's exposed for completeness — the
  // LLM may have it in priors and downstream engine code that holds
  // entity.pos as Vec3 may want to rotate without converting back to
  // THREE.Vector3.
  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z
    const qx = +q.x, qy = +q.y, qz = +q.z, qw = +q.w

    // qVector = quat * vector (in pure-quaternion form)
    const ix = qw * x + qy * z - qz * y
    const iy = qw * y + qz * x - qx * z
    const iz = qw * z + qx * y - qy * x
    const iw = -qx * x - qy * y - qz * z

    // result = qVector * conjugate(quat) — the rotated vector
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx
    return this
  }

  // Mutate to unit length. Zero-length vectors stay zero (matches
  // THREE.Vector3 behavior — no NaN, no exception).
  normalize() {
    const lenSq = this.x * this.x + this.y * this.y + this.z * this.z
    if (lenSq === 0) return this
    const inv = 1 / Math.sqrt(lenSq)
    this.x *= inv
    this.y *= inv
    this.z *= inv
    return this
  }

  // ---- Pure reads (no mutation, return number / new Vec3 / boolean) ----

  clone() {
    return new Vec3(this.x, this.y, this.z)
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z
  }

  distanceTo(v) {
    const dx = this.x - +v.x
    const dy = this.y - +v.y
    const dz = this.z - +v.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  distanceToSquared(v) {
    const dx = this.x - +v.x
    const dy = this.y - +v.y
    const dz = this.z - +v.z
    return dx * dx + dy * dy + dz * dz
  }

  dot(v) {
    return this.x * +v.x + this.y * +v.y + this.z * +v.z
  }

  equals(v) {
    return this.x === +v.x && this.y === +v.y && this.z === +v.z
  }

  // ---- Interop helpers (used at engine seams) ----

  // Plain object form — useful when crossing a Worker / wire boundary.
  // Keep separate from clone() because clone() returns a Vec3 instance
  // (preserves method surface), toPlain returns a structural-clone-safe
  // record (no methods).
  toPlain() {
    return { x: this.x, y: this.y, z: this.z }
  }
}

/** Construct a Vec3 from any {x, y, z}-like input. Returns the same
 *  instance if it's already a Vec3 — cheap shortcut for engine code
 *  that may receive either. */
export function asVec3(v) {
  if (v instanceof Vec3) return v
  return new Vec3(v?.x ?? 0, v?.y ?? 0, v?.z ?? 0)
}
