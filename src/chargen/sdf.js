// Signed-distance primitives + smooth-min blending. Characters are described
// as a list of "parts" (each an SDF primitive bound to a bone + a color).
// The polynomial smooth-min is what melts separate primitives into one
// seamless noodly body — the seams simply don't exist in the baked field.

export function sdSphere(px, py, pz, cx, cy, cz, r) {
  const dx = px - cx,
    dy = py - cy,
    dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

// Capsule between (ax,ay,az) and (bx,by,bz), radius lerps ra -> rb (tapered).
export function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const bax = bx - ax,
    bay = by - ay,
    baz = bz - az;
  const pax = px - ax,
    pay = py - ay,
    paz = pz - az;
  const dot = pax * bax + pay * bay + paz * baz;
  const len2 = bax * bax + bay * bay + baz * baz || 1e-9;
  let h = dot / len2;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h,
    dy = pay - bay * h,
    dz = paz - baz * h;
  const r = ra + (rb - ra) * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

// Ellipsoid (scaled-sphere approximation — not exact, but monotonic and
// well-behaved everywhere, which is what the field bake needs).
export function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const dx = (px - cx) / rx,
    dy = (py - cy) / ry,
    dz = (pz - cz) / rz;
  const k = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return (k - 1.0) * Math.min(rx, Math.min(ry, rz));
}

// Round cone: sphere radius r1 at a, r2 at b (great for snouts/ears/horns).
export function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  // cheap version: capsule with taper — visually identical after smin blending
  return sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, r1, r2);
}

// Polynomial smooth min (k = blend radius).
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * A part of a creature body.
 * kind: "sphere" | "capsule" | "ellipsoid"
 * bone: index into the creature's bone list that this part follows
 * color: THREE.Color-compatible [r,g,b] in 0..1
 * blend: optional per-part smooth-min radius override
 */
export function evalPart(part, x, y, z) {
  switch (part.kind) {
    case "sphere":
      return sdSphere(x, y, z, part.a[0], part.a[1], part.a[2], part.r);
    case "capsule":
      return sdCapsule(
        x, y, z,
        part.a[0], part.a[1], part.a[2],
        part.b[0], part.b[1], part.b[2],
        part.r, part.r2 ?? part.r
      );
    case "ellipsoid":
      return sdEllipsoid(
        x, y, z,
        part.a[0], part.a[1], part.a[2],
        part.rx, part.ry, part.rz
      );
    default:
      return 1e9;
  }
}

/** Smooth-min over all parts -> the creature's combined SDF. */
export function evalBody(parts, x, y, z, k) {
  let d = 1e9;
  for (let i = 0; i < parts.length; i++) {
    d = smin(d, evalPart(parts[i], x, y, z), parts[i].blend ?? k);
  }
  return d;
}
