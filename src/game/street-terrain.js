// Primitive-built overworld terrain for the street outside the shop: a wide
// grass meadow under the whole town, flagstones on the pavement, cobbles
// strewn down the dirt road, jitter-rimmed grass/dirt patches, faceted
// boulders, cone grass tufts, and low-poly hills (buried spheres) ringing the
// horizon. Everything is composed from Three.js primitives with per-vertex
// colours baked in and merged by class, so the whole spread costs a handful
// of draw calls. Built in PRE-rotation street coords (the same frame as
// Shop._build) and added as one group, so _rotateTown() quarter-turns it with
// the rest of the town.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeToonMaterial } from "../core/toon.js";
import { rng } from "../core/engine.js";

// ---- palette (kept muted so it sits under the dusk sky + warm sun) --------
const GRASS = 0x4f7743;
const GRASS_LIGHT = 0x5f8a4e;
const GRASS_DARK = 0x446a3a;
const TUFT = 0x7d9a54;
const TUFT_DARK = 0x5e7a42;
const PAVE_LIGHT = 0x968873;
const PAVE_DARK = 0x7d7059;
const COBBLE_LIGHT = 0x8b857a;
const COBBLE_DARK = 0x6f6a60;
const DIRT = 0x6b5a45;
const DIRT_DARK = 0x5d4e3c;
const ROCK = 0x6a5f52;
const ROCK_DARK = 0x554c42;
const HILL_A = 0x40613a;
const HILL_B = 0x37542f;
const HILL_DIRT = 0x5d4f3e;

// ---- tiny geometry kit -----------------------------------------------------
// Each helper returns a geometry with its placement baked into the vertices,
// so dozens of parts can be merged into one buffer.

// bake scale → y-rotation → translation into the vertices
function bake(geo, x, y, z, ry = 0, s = 1) {
  if (s !== 1) geo.scale(s, s, s);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

// push the rim vertices of a disc/cylinder in and out radially (two summed
// sines of the polar angle) so lathed shapes read as hand-cut stone/turf
function jitterRim(geo, amount, seed) {
  const pos = geo.attributes.position;
  // rim = anything past half the widest radius (verts near the axis stay put)
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  const rim = maxR * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.hypot(x, z) < rim) continue;
    const a = Math.atan2(z, x);
    const n = 1 + Math.sin(a * 3 + seed) * amount * 0.5 + Math.sin(a * 7 + seed * 2) * amount;
    pos.setX(i, x * n);
    pos.setZ(i, z * n);
  }
  geo.computeVertexNormals();
  return geo;
}

// a squat 7-sided jittered cylinder: the all-purpose stone slab / turf patch.
// `squash` scales z so slabs read as irregular flags rather than coins.
function slab(r, h, jitter, seed, squash = 1) {
  const geo = new THREE.CylinderGeometry(r, r * 1.12, h, 7);
  jitterRim(geo, jitter, seed);
  if (squash !== 1) geo.scale(1, 1, squash);
  return geo;
}

// write a flat colour onto every vertex of each part, then merge the lot
// into a single geometry drawn with one vertexColors toon material
function mergeColored(parts) {
  const c = new THREE.Color();
  for (const p of parts) {
    c.setHex(p.color);
    const count = p.geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    p.geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  return mergeGeometries(parts.map((p) => p.geo));
}

function meshFor(parts, { outline = 0 } = {}) {
  const mesh = new THREE.Mesh(
    mergeColored(parts),
    makeToonMaterial({ vertexColors: true, rim: 0 })
  );
  if (outline) {
    // ink outline as a pre-baked inverted hull: vertices pushed out along
    // their normals, drawn backface. (makeOutlineMaterial's shader injection
    // needs a skinned/env-mapped shader for objectNormal, so it can't dress a
    // plain static mesh like this one.)
    const geo = mesh.geometry.clone();
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) + nor.getX(i) * outline,
        pos.getY(i) + nor.getY(i) * outline,
        pos.getZ(i) + nor.getZ(i) * outline
      );
    }
    const shell = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x1a0e24, side: THREE.BackSide, fog: true })
    );
    shell.raycast = () => {};
    mesh.add(shell);
  }
  return mesh;
}

// ---- the terrain -----------------------------------------------------------
// `backZ/paveFar/roadFar/backLimit` mirror the street bands laid out in
// Shop._build; `cave` is the mouth's centre from _buildCaveMouth. All
// pre-rotation coords.
export function buildStreetTerrain(group, { streetW, backZ, paveFar, roadFar, backLimit, cave, bounds }) {
  const g = new THREE.Group();
  const r = rng(0x7E44A1);
  const halfW = streetW / 2;

  // -- meadow: one big grass plane under the whole town, sunk a hair below
  // the road/pavement/plaza planes so they read as built on top of it. Sized
  // to run well past the walkable bounds so it always underlies the horizon
  // hill belt (no grass edge / void ever peeks out from behind the hills).
  const meadowY = -0.05;
  const meadow = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 110).rotateX(-Math.PI / 2),
    makeToonMaterial({ color: GRASS, rim: 0 })
  );
  meadow.position.set(0, meadowY, -5);
  g.add(meadow);

  const cover = []; // flat ground cover: turf patches, flagstones, cobbles, dirt
  const tufts = []; // cone grass blades (kept separate: brighter, no stone tones)
  const rocks = []; // faceted boulders (these get an ink outline)
  const hills = []; // buried spheres on the horizon

  // a flat patch lying on a surface at `baseY`
  const patch = (x, z, radius, color, baseY = 0) => {
    cover.push({
      geo: bake(slab(radius, 0.05, 0.16, r() * 10), x, baseY + 0.03, z, r() * Math.PI),
      color,
    });
  };

  // -- turf patches freckling the meadow (skipping the built-up strip: the
  // shop footprint and the road corridor get no grass)
  for (let i = 0; i < 70; i++) {
    const x = (r() - 0.5) * 110;
    const z = -36 + r() * 62;
    if (x > -8.5 && x < 8.5 && z > backZ - 0.5) continue; // building + side seals
    if (z < backZ + 0.5 && z > backLimit - 0.5 && Math.abs(x) < halfW + 1) continue; // street bands
    patch(x, z, 0.6 + r() * 1.3, r() < 0.5 ? GRASS_LIGHT : GRASS_DARK, meadowY);
  }

  // -- flagstones paving the strip by the shopfront: dense, big, squashed
  for (let x = -halfW + 1; x < halfW - 0.6; x += 0.95 + r() * 0.5) {
    const z = (backZ + paveFar) / 2 + (r() - 0.5) * 1.1;
    cover.push({
      geo: bake(slab(0.5 + r() * 0.3, 0.055, 0.12, r() * 10, 0.72), x, 0.028, z, r() * Math.PI),
      color: r() < 0.5 ? PAVE_LIGHT : PAVE_DARK,
    });
  }

  // -- cobbles strewn down the dirt road, thinning toward the edges; the
  // patch where the road peters out onto the cave's dirt apron stays bare
  const roadMid = (paveFar + roadFar) / 2;
  const roadHalf = (paveFar - roadFar) / 2 - 0.5;
  const inApron = (x, z) => x > cave.x - 2 && x < cave.x + 5.2 && Math.abs(z - cave.z) < 3.6;
  for (let x = -halfW + 0.8; x < halfW - 0.8; x += 0.62) {
    const n = r() < 0.6 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const z = roadMid + (r() - 0.5) * 2 * roadHalf * (0.4 + r() * 0.6);
      if (inApron(x, z)) continue;
      cover.push({
        geo: bake(slab(0.32 + r() * 0.22, 0.05, 0.2, r() * 10, 0.8), x + (r() - 0.5) * 0.4, 0.025, z, r() * Math.PI),
        color: r() < 0.5 ? COBBLE_LIGHT : COBBLE_DARK,
      });
    }
    // the odd dirt blotch breaking up the cobbles
    const bz = roadMid + (r() - 0.5) * roadHalf;
    if (r() < 0.08 && !inApron(x, bz)) patch(x, bz, 0.5 + r() * 0.5, r() < 0.5 ? DIRT : DIRT_DARK);
  }

  // -- turf breaking through along both road shoulders, so the green reads
  // inside the portrait frame instead of living only out on the meadow
  for (let x = -halfW + 1.2; x < halfW - 1.2; x += 2.2 + r() * 1.6) {
    if (!inApron(x, roadFar + 0.6)) {
      patch(x + (r() - 0.5), roadFar + 0.3 + r() * 0.9, 0.4 + r() * 0.55, r() < 0.5 ? GRASS_LIGHT : GRASS_DARK, 0.012);
    }
    if (r() < 0.55 && !inApron(x, paveFar)) {
      patch(x + (r() - 0.5), paveFar + (r() - 0.5) * 0.8, 0.35 + r() * 0.4, r() < 0.5 ? GRASS_LIGHT : GRASS_DARK, 0.012);
    }
  }

  // -- dirt feathering where the road peters out at both ends of the street
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const x = side * (halfW - 1.5 + r() * 5);
      const z = backZ - 1 - r() * (backZ - roadFar - 1);
      patch(x, z, 0.7 + r() * 0.9, r() < 0.5 ? DIRT : DIRT_DARK, 0.01);
    }
  }

  // -- grass tufts: 3–4 lean cones per clump, hugging the street's seams
  const tuft = (x, z, baseY = 0) => {
    const n = 3 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const geo = new THREE.ConeGeometry(0.035, 0.18 + r() * 0.14, 4);
      geo.rotateX((r() - 0.5) * 0.55);
      geo.rotateZ((r() - 0.5) * 0.55);
      bake(geo, x + (r() - 0.5) * 0.16, baseY + 0.08, z + (r() - 0.5) * 0.16, r() * Math.PI);
      tufts.push({ geo, color: k % 2 ? TUFT_DARK : TUFT });
    }
  };
  // along the road's far shoulder, in front of the lot row
  for (let x = -halfW + 2; x < halfW - 2; x += 1.6 + r() * 1.8) {
    if (r() < 0.75) tuft(x, roadFar + 0.4 + r() * 0.5);
  }
  // around the cave mouth's dirt apron
  for (let i = 0; i < 7; i++) {
    tuft(cave.x + 1 + r() * 3.5, cave.z + (r() < 0.5 ? -1 : 1) * (3.4 + r() * 1.2));
  }
  // freckled across the meadow flanks beside the shop
  for (let i = 0; i < 14; i++) {
    const side = r() < 0.5 ? -1 : 1;
    tuft(side * (8.5 + r() * 11), backZ + 1.5 + r() * 10, meadowY);
  }

  // -- boulders: flattened dodecahedra, singly and in small piles, kept to
  // the street's fringes (beyond the walkable fence or against the lot line)
  const rock = (x, z, s, color, baseY = 0) => {
    const geo = new THREE.DodecahedronGeometry(s, 0);
    geo.scale(1, 0.55 + r() * 0.2, 0.8 + r() * 0.35);
    bake(geo, x, baseY + s * 0.34, z, r() * Math.PI);
    rocks.push({ geo, color });
  };
  // spill of rock shed by the cave mound, framing the road's top end
  for (let i = 0; i < 6; i++) {
    rock(cave.x + r() * 4, cave.z + (r() < 0.5 ? -1 : 1) * (2.9 + r() * 1.6), 0.22 + r() * 0.3, r() < 0.5 ? ROCK : ROCK_DARK);
  }
  // strays at the village end and out on the meadow
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      rock(side * (halfW + 0.8 + r() * 4), backZ - 2 - r() * 9, 0.26 + r() * 0.34, r() < 0.5 ? ROCK : ROCK_DARK, meadowY);
    }
  }
  for (let i = 0; i < 6; i++) {
    const side = r() < 0.5 ? -1 : 1;
    rock(side * (9 + r() * 12), backZ + 2 + r() * 9, 0.2 + r() * 0.3, r() < 0.5 ? ROCK : ROCK_DARK, meadowY);
  }

  // -- hills: big low-poly spheres buried past their equator, ringing the
  // town — a wooded ridge behind the lot row, a hillside the cave mouth digs
  // into, and rolling ground closing off both street ends and the shop's back.
  // `footprints` records each hill's ground-level silhouette radius so the town
  // can drop a matching collider under it and fence the walkable meadow at the
  // foot of the slopes (see Shop._build), rather than let the player clip in.
  const footprints = [];
  const hill = (x, z, radius, color, sink = 0.5) => {
    hills.push({ geo: bake(new THREE.SphereGeometry(radius, 12, 9), x, meadowY - radius * sink, z), color });
    // the sphere's cross-section where it breaks the ground plane (y = 0)
    const cy = meadowY - radius * sink; // buried centre height
    const rGround = Math.sqrt(Math.max(0, radius * radius - cy * cy));
    if (rGround > 0.6) footprints.push({ x, z, r: rGround });
  };
  // ridge behind the restoration lots (behind the sprite treeline; the spread
  // keeps every slope's toe just shy of the houses' rear walls)
  let hx = -20;
  let i = 0;
  while (hx < 22) {
    hill(hx, backLimit - 8.5 - r() * 4, 5.5 + r() * 5, i % 2 ? HILL_A : HILL_B, 0.55 + r() * 0.15);
    hx += 6 + r() * 4;
    i++;
  }
  // the hillside the cave tunnels into: earthier, rising behind the mound but
  // held clear of both the dark maw and the top-of-street restoration lot
  hill(cave.x - 8.4, cave.z + 1.5, 8, HILL_DIRT, 0.62);
  hill(cave.x - 4, cave.z + 5.5, 5, HILL_B, 0.6);
  // the village end of the street, and the ground behind the shop
  hill(halfW + 6, roadMid, 7, HILL_A, 0.6);
  hill(halfW + 4, backZ + 4, 5, HILL_B, 0.62);
  hill(-6, 19, 7, HILL_B, 0.6);
  hill(6, 20, 6, HILL_A, 0.62);
  hill(-14, 17, 5, HILL_A, 0.62);

  // -- horizon belt: a continuous wrap of hills ringing the whole walkable
  // meadow (the `bounds` rectangle the player can roam). Whichever way the
  // player faces, rolling ground closes off the view, so the flat meadow rim
  // and the void beyond the play area are never seen. The toe of each hill
  // sits just past the bounds edge, layering behind the closer detail hills
  // above. (Their colliders, added town-side, turn the belt into the solid
  // fence at the field's edge.)
  if (bounds) {
    const { minX, maxX, minZ, maxZ } = bounds;
    const OUT = 4; // push each hill's toe this far past the walkable edge
    const ringHill = (x, z) => {
      const radius = 5.5 + r() * 3.5;
      hill(x + (r() - 0.5) * 1.6, z + (r() - 0.5) * 1.6, radius, r() < 0.5 ? HILL_A : HILL_B, 0.56 + r() * 0.12);
    };
    for (let x = minX - OUT; x <= maxX + OUT; x += 4.5 + r() * 3) {
      ringHill(x, minZ - OUT - r() * 3); // far edge (up-street)
      ringHill(x, maxZ + OUT + r() * 3); // near edge (behind the shop)
    }
    for (let z = minZ - OUT; z <= maxZ + OUT; z += 4.5 + r() * 3) {
      ringHill(minX - OUT - r() * 3, z); // west flank
      ringHill(maxX + OUT + r() * 3, z); // east flank (village end)
    }
  }

  g.add(meshFor(cover));
  g.add(meshFor(tufts));
  g.add(meshFor(rocks, { outline: 0.014 }));
  g.add(meshFor(hills));
  group.add(g);
  return { group: g, hills: footprints };
}
