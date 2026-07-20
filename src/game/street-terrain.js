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
// `road` is the pre-rotation road rect from Shop._build (x = on-screen vertical,
// z = on-screen horizontal); `cave` is the mouth's pre-rotation centre. All
// coords here are pre-rotation — _rotateTown quarter-turns the whole group.
export function buildStreetTerrain(group, { road, cave, bounds, hills: hillOverride, buildings = [], editable = false }) {
  const g = new THREE.Group();
  const r = rng(0x7E44A1);
  // road corridor (pre): x_pre ∈ [rx0, rx1] is the on-screen thickness; z_pre ∈
  // [rz0, rz1] is the on-screen length. The pavement strip sits just above it.
  const rx0 = road.roadNearX, rx1 = road.roadFarX;
  const rz0 = road.streetRightZ, rz1 = road.streetLeftZ; // rz0 < rz1
  const paveX0 = rx0 - 3.0, paveX1 = rx0; // light pavement band above the road
  const townCX = (rx0 + rx1) / 2;
  const townCZ = (rz0 + rz1) / 2;

  // -- meadow: one big grass plane under the whole town, sunk a hair below the
  // road planes so they read as built on top of it. Sized to run well past the
  // walkable bounds so it always underlies the horizon hill belt.
  const meadowY = -0.05;
  const meadow = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 150).rotateX(-Math.PI / 2),
    makeToonMaterial({ color: GRASS, rim: 0 })
  );
  meadow.position.set(townCX, meadowY, townCZ);
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
  // is (x,z) on the built-up strip (road + pavement) — kept clear of grass
  const onStreet = (x, z) => x > paveX0 - 0.5 && x < rx1 + 0.5 && z > rz0 - 0.5 && z < rz1 + 0.5;
  // is (x,z) inside any building/lot footprint (pre-rotation)? Kept clear so
  // path slabs, cobbles, dirt blotches and boulders never surface through a
  // floor. `buildings` carries each footprint's pre-rotation centre + half
  // extents (shop, cave, dojo, lots); a small margin swallows the eaves.
  const onBuilding = (x, z, m = 0.6) =>
    buildings.some((b) => Math.abs(x - b.x) < b.hw + m && Math.abs(z - b.z) < b.hd + m);

  // -- turf patches freckling the meadow (skipping the built-up strip)
  for (let i = 0; i < 90; i++) {
    const x = townCX + (r() - 0.5) * 130;
    const z = townCZ + (r() - 0.5) * 120;
    if (onStreet(x, z) || onBuilding(x, z)) continue;
    patch(x, z, 0.6 + r() * 1.3, r() < 0.5 ? GRASS_LIGHT : GRASS_DARK, meadowY);
  }

  // -- flagstones paving the pavement strip along the buildings' side
  for (let z = rz0 + 1; z < rz1 - 0.6; z += 0.95 + r() * 0.5) {
    const x = (paveX0 + paveX1) / 2 + (r() - 0.5) * 1.1;
    if (onBuilding(x, z)) continue;
    cover.push({
      geo: bake(slab(0.5 + r() * 0.3, 0.055, 0.12, r() * 10, 0.72), x, 0.028, z, r() * Math.PI),
      color: r() < 0.5 ? PAVE_LIGHT : PAVE_DARK,
    });
  }

  // -- cobbles strewn down the dirt road, thinning toward the edges; the patch
  // where the road meets the cave's dirt apron stays bare
  const roadMid = (rx0 + rx1) / 2;
  const roadHalf = (rx1 - rx0) / 2 - 0.5;
  const inApron = (x, z) => z > cave.z - 2 && z < cave.z + 5.2 && Math.abs(x - cave.x) < 3.6;
  for (let z = rz0 + 0.8; z < rz1 - 0.8; z += 0.62) {
    const n = r() < 0.6 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const x = roadMid + (r() - 0.5) * 2 * roadHalf * (0.4 + r() * 0.6);
      if (inApron(x, z) || onBuilding(x, z)) continue;
      cover.push({
        geo: bake(slab(0.32 + r() * 0.22, 0.05, 0.2, r() * 10, 0.8), x, 0.025, z + (r() - 0.5) * 0.4, r() * Math.PI),
        color: r() < 0.5 ? COBBLE_LIGHT : COBBLE_DARK,
      });
    }
    // the odd dirt blotch breaking up the cobbles
    const bx = roadMid + (r() - 0.5) * roadHalf;
    if (r() < 0.08 && !inApron(bx, z) && !onBuilding(bx, z)) patch(bx, z, 0.5 + r() * 0.5, r() < 0.5 ? DIRT : DIRT_DARK);
  }

  // -- turf breaking through along both road shoulders
  for (let z = rz0 + 1.2; z < rz1 - 1.2; z += 2.2 + r() * 1.6) {
    if (!inApron(rx1 - 0.6, z) && !onBuilding(rx1 - 0.6, z)) {
      patch(rx1 - 0.3 - r() * 0.9, z + (r() - 0.5), 0.4 + r() * 0.55, r() < 0.5 ? GRASS_LIGHT : GRASS_DARK, 0.012);
    }
    if (r() < 0.55 && !inApron(paveX0, z) && !onBuilding(paveX0, z)) {
      patch(paveX0 + (r() - 0.5) * 0.8, z + (r() - 0.5), 0.35 + r() * 0.4, r() < 0.5 ? GRASS_LIGHT : GRASS_DARK, 0.012);
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
  // along the road's far shoulder
  for (let z = rz0 + 2; z < rz1 - 2; z += 1.6 + r() * 1.8) {
    if (r() < 0.75 && !onBuilding(rx1 - 0.4, z)) tuft(rx1 - 0.4 - r() * 0.5, z);
  }
  // around the cave mouth's dirt apron
  for (let i = 0; i < 7; i++) {
    tuft(cave.x + (r() < 0.5 ? -1 : 1) * (3.4 + r() * 1.2), cave.z + 1 + r() * 3.5);
  }
  // freckled across the meadow flanks
  for (let i = 0; i < 16; i++) {
    tuft(townCX + (r() - 0.5) * 60, townCZ + (r() < 0.5 ? -1 : 1) * (10 + r() * 16), meadowY);
  }

  // -- boulders: flattened dodecahedra, singly and in small piles
  const rock = (x, z, s, color, baseY = 0) => {
    const geo = new THREE.DodecahedronGeometry(s, 0);
    geo.scale(1, 0.55 + r() * 0.2, 0.8 + r() * 0.35);
    bake(geo, x, baseY + s * 0.34, z, r() * Math.PI);
    rocks.push({ geo, color });
  };
  // spill of rock shed by the cave mound
  for (let i = 0; i < 6; i++) {
    rock(cave.x + (r() < 0.5 ? -1 : 1) * (2.9 + r() * 1.6), cave.z + r() * 4, 0.22 + r() * 0.3, r() < 0.5 ? ROCK : ROCK_DARK);
  }
  // strays out on the meadow — skipping the road/pavement and building
  // footprints so boulders never surface on the path or under the buildings
  for (let i = 0; i < 10; i++) {
    const x = townCX + (r() - 0.5) * 70;
    const z = townCZ + (r() < 0.5 ? -1 : 1) * (12 + r() * 18);
    if (onStreet(x, z) || onBuilding(x, z)) continue;
    rock(x, z, 0.24 + r() * 0.34, r() < 0.5 ? ROCK : ROCK_DARK, meadowY);
  }

  // -- hills: big low-poly spheres buried past their equator, ringing the town.
  // `footprints` records each hill's ground-level silhouette radius so the town
  // can drop a matching collider under it and fence the walkable meadow.
  //
  // The near "wall" hills — the wooded ridge behind the buildings and the cave
  // hillside — are editable: when layout.json carries a `hills` array they come
  // straight from it (authored / pre-rotation coords), otherwise they're spread
  // procedurally. The procedural spread is ALWAYS run so the shared RNG stream
  // (and thus the horizon ring below) stays identical whether or not the near
  // hills are overridden. In the editor (`editable`) each near hill is built as
  // its own pickable mesh placed by transform; in game they're merged into the
  // backdrop mesh like the ring, for the usual handful-of-draw-calls spread.
  const footprints = [];
  const toHex = (c) => (typeof c === "number" ? c : parseInt(String(c).replace("#", ""), 16));

  // procedural near hills (also consumed to keep the RNG stream stable)
  const proceduralNear = [];
  // wooded ridge behind the buildings row (pre −X = on-screen top / far side)
  for (let z = rz0; z < rz1; z += 6 + r() * 4) {
    proceduralNear.push({ x: rx0 - 11 - r() * 4, z: z + (r() - 0.5) * 3, radius: 5.5 + r() * 5, sink: 0.55 + r() * 0.15, color: r() < 0.5 ? HILL_A : HILL_B });
  }
  // the hillside the cave tunnels into: earthier, rising BEHIND the mound
  // (pre −X = on-screen top), clear of the road in front of the maw
  proceduralNear.push({ x: cave.x - 8, z: cave.z, radius: 8, sink: 0.62, color: HILL_DIRT });
  proceduralNear.push({ x: cave.x - 6, z: cave.z + 3, radius: 5, sink: 0.6, color: HILL_B });

  const nearHills = Array.isArray(hillOverride) && hillOverride.length
    ? hillOverride.map((h) => ({
        x: h.x, z: h.z,
        radius: h.radius ?? 6, sink: h.sink ?? 0.58, color: toHex(h.color ?? HILL_A),
      }))
    : proceduralNear;

  // -- horizon belt: a continuous wrap of hills ringing the whole walkable
  // meadow (the `bounds` rectangle the player can roam). Whichever way the
  // player faces, rolling ground closes off the view, so the flat meadow rim
  // and the void beyond the play area are never seen. The toe of each hill
  // sits just past the bounds edge, layering behind the closer detail hills
  // above. (Their colliders, added town-side, turn the belt into the solid
  // fence at the field's edge.) Cosmetic backdrop — not editable.
  const ringHills = [];
  if (bounds) {
    const { minX, maxX, minZ, maxZ } = bounds;
    const OUT = 4; // push each hill's toe this far past the walkable edge
    const ringHill = (x, z) => {
      const radius = 5.5 + r() * 3.5;
      ringHills.push({ x: x + (r() - 0.5) * 1.6, z: z + (r() - 0.5) * 1.6, radius, sink: 0.56 + r() * 0.12, color: r() < 0.5 ? HILL_A : HILL_B });
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

  // footprint colliders for every hill (near + ring) fence the walkable meadow
  const pushFootprint = (h) => {
    const cy = meadowY - h.radius * h.sink; // buried centre height
    const rGround = Math.sqrt(Math.max(0, h.radius * h.radius - cy * cy));
    if (rGround > 0.6) footprints.push({ x: h.x, z: h.z, r: rGround });
  };
  for (const h of nearHills) pushFootprint(h);
  for (const h of ringHills) pushFootprint(h);

  // merge into the shared hills backdrop mesh: always the ring, plus the near
  // hills too unless the editor asked for them split into pickable meshes
  const bakeHill = (h) => hills.push({ geo: bake(new THREE.SphereGeometry(h.radius, 12, 9), h.x, meadowY - h.radius * h.sink, h.z), color: h.color });
  for (const h of ringHills) bakeHill(h);
  if (!editable) for (const h of nearHills) bakeHill(h);

  g.add(meshFor(cover));
  g.add(meshFor(tufts));
  g.add(meshFor(rocks, { outline: 0.014 }));
  if (hills.length) g.add(meshFor(hills));

  // editor only: each near hill as its own centred, pickable mesh placed by
  // transform (so it can be grabbed and moved); the game keeps them merged above
  const hillMeshes = [];
  if (editable) {
    for (const h of nearHills) {
      const m = meshFor([{ geo: new THREE.SphereGeometry(h.radius, 12, 9), color: h.color }]);
      m.position.set(h.x, meadowY - h.radius * h.sink, h.z);
      g.add(m);
      hillMeshes.push(m);
    }
  }

  group.add(g);
  return { group: g, hills: footprints, hillMeshes, hillDescs: nearHills };
}
