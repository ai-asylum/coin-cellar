// The "blob bake": turn a list of SDF parts into ONE seamless skinned mesh.
//
//  1. Sample the smooth-min field of all parts into a marching-cubes grid
//     (we write straight into the three.js MarchingCubes addon's field
//     buffer and use isolation=0 with field = -signedDistance).
//  2. Polygonise once, weld the triangle soup into an indexed mesh.
//  3. For every vertex, evaluate each part's SDF again and convert the
//     distances into skin weights (top-2 bones, soft falloff) and into
//     blended vertex colors. Because weights come from the same field that
//     built the surface, deformation bends exactly where primitives melt
//     together — no visible joints, ever.
//
// Bakes run once per creature spec (cached by key), a few ms each.
import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { evalPart, smin } from "./sdf.js";

let _mc = null;
let _mcRes = 0;

function getMC(res) {
  if (!_mc || _mcRes !== res) {
    _mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 400000);
    _mc.isolation = 0;
    _mcRes = res;
  }
  return _mc;
}

const _cache = new Map();

/**
 * spec: {
 *   key: cache key string,
 *   parts: [ {kind, a, b?, r..., bone, color:[r,g,b], blend?} ],
 *   bones: [ {name, parent: index|-1, pos:[x,y,z]} ]  (rest pose, char space)
 *   blend: global smooth-min k,
 *   scale: world units per char unit,
 * }
 * Parts are authored in a roughly [-0.8, 0.8] design cube.
 * Returns { geometry, boneDefs, scale } — geometry has skinIndex/skinWeight/color.
 */
export function bakeBody(spec, res = 44) {
  if (spec.key && _cache.has(spec.key)) return _cache.get(spec.key);

  const mc = getMC(res);
  const size = mc.size;
  const half = mc.halfsize;
  const field = mc.field;
  const parts = spec.parts;
  const k = spec.blend ?? 0.14;

  // 1) fill the field: f = -sdf so "inside" is positive (addon convention)
  mc.reset();
  for (let zi = 0; zi < size; zi++) {
    const z = (zi - half) / half;
    for (let yi = 0; yi < size; yi++) {
      const y = (yi - half) / half;
      const row = size * size * zi + size * yi;
      for (let xi = 0; xi < size; xi++) {
        const x = (xi - half) / half;
        let d = 1e9;
        for (let p = 0; p < parts.length; p++) {
          d = smin(d, evalPart(parts[p], x, y, z), parts[p].blend ?? k);
        }
        field[row + xi] = -d;
      }
    }
  }

  // 2) polygonise + weld
  mc.update();
  const count = mc.count;
  const soup = new THREE.BufferGeometry();
  soup.setAttribute(
    "position",
    new THREE.BufferAttribute(mc.positionArray.slice(0, count * 3), 3)
  );
  let geo = BufferGeometryUtils.mergeVertices(soup, 1e-4);

  // Normals from the SDF gradient — smoother than triangle normals and never
  // degenerate on sub-cell features (thin horn tips etc.), which matters
  // because the outline shell displaces along the normal.
  {
    const pos2 = geo.getAttribute("position");
    const nrm = new Float32Array(pos2.count * 3);
    const eps = 0.75 / half;
    const f = (x, y, z) => {
      let d = 1e9;
      for (let p = 0; p < parts.length; p++)
        d = smin(d, evalPart(parts[p], x, y, z), parts[p].blend ?? k);
      return d;
    };
    for (let i = 0; i < pos2.count; i++) {
      const x = pos2.getX(i), y = pos2.getY(i), z = pos2.getZ(i);
      let nx = f(x + eps, y, z) - f(x - eps, y, z);
      let ny = f(x, y + eps, z) - f(x, y - eps, z);
      let nz = f(x, y, z + eps) - f(x, y, z - eps);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[i * 3] = nx / l;
      nrm[i * 3 + 1] = ny / l;
      nrm[i * 3 + 2] = nz / l;
    }
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  }

  // 3) skin weights + vertex colors from per-part field contribution
  const pos = geo.getAttribute("position");
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const colors = new Float32Array(n * 3);
  const falloff = Math.max(k * 2.2, 0.22); // how far a part's influence reaches
  // part colors are authored as sRGB; vertex colors must be linear
  const srgb2lin = (c) => (c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const linColors = parts.map((p) => p.color.map(srgb2lin));

  for (let i = 0; i < n; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    let w0 = 0, w1 = 0, b0 = 0, b1 = 0;
    let cr = 0, cg = 0, cb = 0, cw = 0;
    for (let p = 0; p < parts.length; p++) {
      const d = evalPart(parts[p], x, y, z);
      // vertices sit on the blended surface, so d >= ~0 for every part;
      // closer part => more influence.
      let w = 1 - d / falloff;
      if (w <= 0) continue;
      const cWeight = Math.pow(w, 6); // colors stay crisp near part borders...
      w = w * w; // ...while bone weights blend wide (that's the noodle)
      const col = linColors[p];
      cr += col[0] * cWeight;
      cg += col[1] * cWeight;
      cb += col[2] * cWeight;
      cw += cWeight;
      // accumulate per-bone (multiple parts can share a bone)
      const bone = parts[p].bone;
      if (bone === b0) w0 += w;
      else if (bone === b1) w1 += w;
      else if (w > w0) {
        b1 = b0; w1 = w0; b0 = bone; w0 = w;
      } else if (w > w1) {
        b1 = bone; w1 = w;
      }
    }
    const sum = (w0 + w1) || 1;
    skinIndex[i * 4] = b0;
    skinIndex[i * 4 + 1] = b1;
    skinWeight[i * 4] = w0 / sum;
    skinWeight[i * 4 + 1] = w1 / sum;
    if (cw > 0) {
      colors[i * 3] = cr / cw;
      colors[i * 3 + 1] = cg / cw;
      colors[i * 3 + 2] = cb / cw;
    }
  }

  geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const scale = spec.scale ?? 1;
  const groundY = spec.groundY ?? 0; // char-space y that should become world 0
  geo.scale(scale, scale, scale);
  geo.translate(0, -groundY * scale, 0);
  geo.computeBoundingSphere();

  const baked = { geometry: geo, boneDefs: spec.bones, scale, groundY };
  if (spec.key) _cache.set(spec.key, baked);
  return baked;
}

/** Build a THREE.Skeleton from boneDefs (positions given in char space). */
export function buildSkeleton(boneDefs, scale = 1, groundY = 0) {
  const bones = boneDefs.map((def) => {
    const b = new THREE.Bone();
    b.name = def.name;
    return b;
  });
  boneDefs.forEach((def, i) => {
    const b = bones[i];
    const p = def.pos;
    if (def.parent >= 0) {
      const pp = boneDefs[def.parent].pos;
      b.position.set(
        (p[0] - pp[0]) * scale,
        (p[1] - pp[1]) * scale,
        (p[2] - pp[2]) * scale
      );
      bones[def.parent].add(b);
    } else {
      b.position.set(p[0] * scale, (p[1] - groundY) * scale, p[2] * scale);
    }
  });
  return bones;
}
