// Static geometry builders for the dungeon: the grid cell size, treasure
// chests, the boss portcullis gate, the merged floor mesh and the tiled floor
// texture. Pure mesh/texture factories, split out of dungeon.js.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { rng } from "../core/engine.js";
import { dungeonAssetsReady, cloneModel, bakedGeometry } from "./dungeon-assets.js";

export const CELL = 2.4;

// A short flight of stairs. "down" sinks shrinking steps into the floor (the
// way deeper); "up" rises a straight flight of lengthening steps (the way out).
// Every travel point uses one of these two now — portals are gone.
export function makeStairs(dir = "down", color = 0x2a2038) {
  // Prefer the kit's stone flight when the pack is loaded. The model is a ramp
  // rising along +Z; the "up" flight (way home) stays on the floor rising away,
  // while the "down" flight (the exit deeper) is sunk so its TOP step sits flush
  // at floor level and the rest drops into the pit cut beneath it (the descent
  // cell is left as a hole in buildAssetFloor) — so it reads as going down.
  if (dungeonAssetsReady()) {
    const g = new THREE.Group();
    const stair = cloneModel("stair");
    if (dir === "down") {
      stair.rotation.y = Math.PI;
      // the pit under the descent is a whole floor tile (CELL × CELL), but at
      // the default prop scale the flight only covered ~1.5×1.2 of it, leaving
      // a black gap ringing the steps. Stretch its footprint to span the full
      // cell (raw kit model is 5 wide × 4 deep) so flight and hole meet flush.
      stair.scale.set(CELL / 5, stair.scale.y, CELL / 4);
    }
    const box = new THREE.Box3().setFromObject(stair);
    // "down": top step drops to y=0 and the flight sinks into the pit below.
    // "up": seat the base on the floor, then lift it clear of the floor plane —
    // at floor level the surrounding tiles (which top out at ~0.03, and up to
    // ~0.32 for the rocky variant) render over and cover the low steps.
    stair.position.y = dir === "down" ? -box.max.y : -box.min.y + 0.35;
    g.add(stair);
    return g;
  }
  const g = new THREE.Group();
  const mat = makeToonMaterial({ color, rim: 0 });
  if (dir === "down") {
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.5 - i * 0.28, 0.42, 1.5 - i * 0.28), mat);
      // lift slightly so the top step's face doesn't sit coplanar with the
      // floor slab (y=0), which caused z-fighting on the descent
      step.position.y = -0.19 - i * 0.16;
      g.add(step);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const h = 0.24 + i * 0.24;
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.3, h, 0.44), mat);
      step.position.set(0, h / 2, -0.2 - i * 0.42);
      g.add(step);
    }
  }
  return g;
}

// The mouth the descent flight drops into. A whole floor tile is cut out under
// it (buildAssetFloor leaves the cell empty), which on its own reads as a black
// hole out to the scene void; this fills that cut-out with a dark shaft box
// viewed from the inside (BackSide), so from above we look down its walls to a
// dark floor. It spans the full cell so it meets the surrounding floor tiles
// edge-to-edge — no rim/collar outline.
const _PIT_DEPTH = 1.5;
export function makeDescentPit() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(CELL, _PIT_DEPTH, CELL),
    new THREE.MeshBasicMaterial({ color: 0x0d0a07, side: THREE.BackSide })
  );
  shaft.position.y = -_PIT_DEPTH / 2 + 0.01; // rim flush with the floor
  g.add(shaft);
  return g;
}

// kind: "wood" (default) or "iron". `userData.cover` is the hinged lid so
// openChest can flip it open regardless of how the mesh is authored.
export function makeChest(kind = "wood") {
  if (dungeonAssetsReady()) {
    const g = cloneModel(kind === "iron" ? "chestIron" : "chestWood");
    g.traverse((o) => { if (o.isMesh && /lid|cover/i.test(o.name)) g.userData.cover = o; });
    g.userData.coverAxis = "x"; // KayKit lid is hinged along the chest's width (X)
    return g;
  }
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), makeToonMaterial({ color: 0x8a5a33, rim: 0.2 }));
  base.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.3, 0.64), makeToonMaterial({ color: 0x9c6a3e, rim: 0.2 }));
  lid.geometry.translate(0, 0.15, 0.32); // hinge at back edge
  lid.position.set(0, 0.5, -0.32);
  const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.05), makeToonMaterial({ color: 0xf0c04a, rim: 0.3 }));
  clasp.position.set(0, 0.45, 0.31);
  g.add(base, lid, clasp);
  g.userData.cover = lid;
  return g;
}

// A portcullis sealing the boss doorway: a stone frame + a grid of iron bars,
// spanning the 2-cell opening. Sits on the floor until the key raises it.
export function makeGate() {
  const g = new THREE.Group();
  const barMat = makeToonMaterial({ color: 0x4a4150, rim: 0.2 });
  const stoneMat = makeToonMaterial({ color: 0x241c2e, rim: 0.1 });
  const W = CELL * 2 - 0.15, H = 1.7;
  // side posts + top lintel frame the opening
  const post = () => new THREE.Mesh(new THREE.BoxGeometry(0.22, H, 0.5), stoneMat);
  const pl = post(); pl.position.set(-W / 2, H / 2, 0); g.add(pl);
  const pr = post(); pr.position.set(W / 2, H / 2, 0); g.add(pr);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.3, 0.55), stoneMat);
  lintel.position.set(0, H - 0.05, 0); g.add(lintel);
  // vertical iron bars
  const bars = 7;
  for (let i = 0; i < bars; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, H - 0.1, 6), barMat);
    b.position.set(-W / 2 + (i + 0.5) * (W / bars), (H - 0.1) / 2, 0);
    g.add(b);
  }
  // a couple of horizontal rails tie the bars together
  for (const y of [H * 0.28, H * 0.72]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.09, 0.09), barMat);
    rail.position.set(0, y, 0);
    g.add(rail);
  }
  return g;
}

// Build a single merged floor mesh covering only the open cells of the grid.
// Each open cell becomes one upward-facing quad; UVs are mapped to the cell's
// grid position so the tiled texture stays continuous across the whole floor.
export function makeFloorGeometry(open, GW, GH, cellPos) {
  const hw = CELL / 2;
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  let v = 0;
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (!open[y][x]) continue;
      const p = cellPos(x, y);
      // four corners (A,B,C,D) counter-clockwise from viewed above
      const A = [p.x - hw, 0, p.z - hw];
      const B = [p.x + hw, 0, p.z - hw];
      const C = [p.x + hw, 0, p.z + hw];
      const D = [p.x - hw, 0, p.z + hw];
      positions.push(...A, ...B, ...C, ...D);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      // continuous UVs as a fraction of the grid, matching the old single-plane
      // mapping (the texture's own repeat wrap handles the tiling density)
      const u0 = x / GW, u1 = (x + 1) / GW, v0 = y / GH, v1 = (y + 1) / GH;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
      v += 4;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function makeTilesTexture(palette, seed) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const r = rng(seed);
  const c0 = new THREE.Color(palette[0]);
  const c1 = new THREE.Color(palette[1]);
  g.fillStyle = "#" + c1.clone().multiplyScalar(0.72).getHexString();
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const t = r() * 0.5 + ((x + y) % 2) * 0.5;
      const col = c0.clone().lerp(c1, t);
      g.fillStyle = "#" + col.getHexString();
      g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

// ---------------------------------------------------------------- asset kit
// One stone floor tile per open cell, drawn as two InstancedMeshes (the pack's
// two floor variants, split by a cheap position hash for a little variety) so a
// whole floor costs just two draw calls. `tint` lightly recolours the shared
// palette material to keep each dungeon's theme identity. Returns a Group.
export function buildAssetFloor(open, GW, GH, cellPos, tint = null, holes = null) {
  const a = bakedGeometry("floorA");
  const b = bakedGeometry("floorB");
  const cellsA = [], cellsB = [];
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (!open[y][x]) continue;
      if (holes && holes.has(x + "," + y)) continue; // leave a pit (descent stairs)
      ((x * 7 + y * 13) % 5 === 0 ? cellsB : cellsA).push([x, y]);
    }
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  for (const [geoInfo, cells] of [[a, cellsA], [b, cellsB]]) {
    if (!geoInfo || !cells.length) continue;
    const mat = geoInfo.mat.clone();
    if (tint) mat.color.copy(tint);
    const inst = new THREE.InstancedMesh(geoInfo.geo, mat, cells.length);
    cells.forEach(([x, y], i) => {
      const p = cellPos(x, y);
      m.makeTranslation(p.x, 0, p.z);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }
  return group;
}

// Line the boundary between walkable and solid ground with the kit's wall panels:
// for every open cell, drop a panel on each of its four edges that faces a closed
// cell (or the grid rim). One InstancedMesh over the shared occluder material, so
// walls between the camera and the hero still dither away. Colliders are handled
// separately (cell-based, in dungeon.js) — this is purely the visible shell.
const _WALL_DIRS = [
  [1, 0, 0],                 // east edge  → panel runs N–S
  [-1, 0, Math.PI],          // west edge
  [0, 1, Math.PI / 2],       // south edge → panel runs E–W
  [0, -1, -Math.PI / 2],     // north edge
];
export function buildAssetWalls(open, GW, GH, cellPos, tint = null, mat = null) {
  const info = bakedGeometry("wallFull");
  if (!info) return null;
  const placements = [];
  const H = CELL / 2;
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (!open[y][x]) continue;
      const p = cellPos(x, y);
      for (const [dx, dy, rotY] of _WALL_DIRS) {
        if (open[y + dy]?.[x + dx]) continue; // neighbour walkable → no wall
        placements.push([p.x + dx * H, p.z + dy * H, rotY]);
      }
    }
  // reuse the shared occluder material by default (cloning it would drop the
  // compiled shader ref feedOccluder drives); only one floor is live at a time,
  // so a per-floor colour tint on the shared material is safe. The cellar lobby
  // is live *alongside* dungeon floors, so it passes its own material instead —
  // otherwise each new floor would re-tint the lobby's walls too.
  mat = mat ?? info.mat;
  if (tint) mat.color.copy(tint); else mat.color.setRGB(1, 1, 1);
  const inst = new THREE.InstancedMesh(info.geo, mat, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  placements.forEach(([wx, wz, rotY], i) => {
    q.setFromAxisAngle(_UP, rotY);
    pos.set(wx, 0, wz);
    m.compose(pos, q, s);
    inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  return { mesh: inst, mat };
}

const _UP = new THREE.Vector3(0, 1, 0);

// Freestanding 3D set dressing from the kit — barrels, crates and the odd
// brazier — tucked against room walls so they never block the walkway. Purely
// cosmetic (no colliders, like the billboard decor). Seeded off the floor rng so
// co-op peers place them identically. No-op until the pack is loaded.
const _ORIGIN0 = { x: 0, z: 0 };
// A world-space AABB collider fitted to a placed model's footprint. Compute it
// while the mesh is still unparented (so its bounds land in group-local space),
// then offset by the area origin. `shrink` trims the box a hair so you can brush
// past edges. Used for every solid kit model (props + chests).
const _COLLIDER_MAX = CELL * 0.5; // never wall off more than a single cell
export function modelCollider(mesh, origin = _ORIGIN0, shrink = 0.85) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const clamp = (v) => Math.min(_COLLIDER_MAX, Math.max(0.2, v * shrink));
  return {
    x: (box.min.x + box.max.x) / 2 + origin.x,
    z: (box.min.z + box.max.z) / 2 + origin.z,
    hw: clamp((box.max.x - box.min.x) / 2),
    hd: clamp((box.max.z - box.min.z) / 2),
    h: box.max.y - box.min.y, // model height (smash-burst sizing; ignored by physics)
  };
}

// floor clutter that hugs a room's inner corners (never blocks the walkway).
// Returns a record per placed prop — its mesh, world-space collider, smash-burst
// colour and whether it's structural — so the caller can fold the colliders into
// the floor's list and wire the smashable ones into the decor pipeline.
const _CLUTTER = ["barrel", "barrelSmall", "box", "boxSmall", "crates", "table", "rubble", "coins", "pillar", "floorTorch"];
// structural pieces hold the ceiling up: struck, they spark and clank but never
// break. Everything else in the clutter list smashes like the billboard decor.
const _STRUCTURAL = new Set(["pillar", "floorTorch"]);
// smash-burst colour per prop (wood browns, gold for the coin stack, stone grey)
const _KIT_BURST = {
  barrel: 0x8a5a33, barrelSmall: 0x8a5a33, table: 0x8a5a33,
  box: 0xa8794a, boxSmall: 0xa8794a, crates: 0xa8794a,
  rubble: 0xa9a2b4, coins: 0xf0c04a,
};
export function scatterAssetProps(group, r, rooms, cellPos, opts = {}) {
  if (!dungeonAssetsReady()) return [];
  const { skip = [], open = null, origin = _ORIGIN0 } = opts;
  const props = [];
  const blocked = (cx, cy) => skip.some((s) => Math.abs(s.x - cx) < 1.5 && Math.abs(s.y - cy) < 1.5);
  // a prop's footprint mustn't land on a walk target (stairs/entrance/mouths)
  const nearSkip = (gx, gy) => skip.some((s) => Math.abs(s.x - gx) < 1.2 && Math.abs(s.y - gy) < 1.2);
  const place = (name, gx, gy, rot) => {
    const m = cloneModel(name);
    if (!m) return;
    const p = cellPos(gx, gy);
    m.position.set(p.x, 0, p.z);
    m.rotation.y = rot;
    const collider = modelCollider(m, origin); // fit before parenting (group-local)
    props.push({ name, mesh: m, collider, structural: _STRUCTURAL.has(name), color: _KIT_BURST[name] ?? 0xa8794a });
    group.add(m);
  };
  for (const room of rooms) {
    if (blocked(room.cx, room.cy) || room.w < 3 || room.h < 3) continue;
    // the room's four inner corners — one prop per corner at most, so two props
    // can never stack on the same spot. Seeded shuffle keeps co-op peers matched.
    const corners = [
      [room.x + 0.6, room.y + 0.6],
      [room.x + room.w - 1.6, room.y + 0.6],
      [room.x + 0.6, room.y + room.h - 1.6],
      [room.x + room.w - 1.6, room.y + room.h - 1.6],
    ].filter(([gx, gy]) => !nearSkip(gx, gy));
    for (let k = corners.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [corners[k], corners[j]] = [corners[j], corners[k]];
    }
    const n = r() < 0.65 ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < n && i < corners.length; i++) {
      const [gx, gy] = corners[i];
      place(_CLUTTER[Math.floor(r() * _CLUTTER.length)], gx, gy, r() * Math.PI * 2);
    }
    // wall-mounted ambiance: a torch or hanging banner on a perimeter wall
    // (mounted on already-solid wall cells, so no extra collider needed)
    if (open && r() < 0.7) mountWallDecor(group, r, room, cellPos, open, nearSkip);
  }
  return props;
}

// Hang a torch/banner on one of a room's solid perimeter walls, facing inward.
// Both kit models stick out along +Z from the wall they mount on, so we rotate
// +Z to point at the room interior. Torches sit at head height; banners hang
// from the top of the wall.
function mountWallDecor(group, r, room, cellPos, open, nearSkip = () => false) {
  const H = CELL / 2;
  const edges = [];
  const push = (cx, cy, dx, dy) => {
    if (open[cy + dy]?.[cx + dx]) return;   // neighbour is walkable → not a wall
    if (nearSkip(cx, cy)) return;           // keep mouths/stairs walls clear
    edges.push([cx, cy, dx, dy]);
  };
  for (let x = room.x; x < room.x + room.w; x++) {
    push(x, room.y, 0, -1);               // north wall
    push(x, room.y + room.h - 1, 0, 1);   // south wall
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    push(room.x, y, -1, 0);               // west wall
    push(room.x + room.w - 1, y, 1, 0);   // east wall
  }
  if (!edges.length) return;
  const count = Math.min(edges.length, 1 + (r() < 0.4 ? 1 : 0));
  for (let i = 0; i < count; i++) {
    // pull the chosen wall cell out of the pool so two mounts never stack
    const [cx, cy, dx, dy] = edges.splice(Math.floor(r() * edges.length), 1)[0];
    const isBanner = r() < 0.4;
    const m = cloneModel(isBanner ? "banner" : "wallTorch");
    if (!m) continue;
    const p = cellPos(cx, cy);
    m.position.set(p.x + dx * (H - 0.05), isBanner ? 0 : 1.4, p.z + dy * (H - 0.05));
    m.rotation.y = Math.atan2(-dx, -dy); // face the room interior
    group.add(m);
  }
}
