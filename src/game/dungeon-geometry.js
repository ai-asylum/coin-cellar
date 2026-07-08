// Static geometry builders for the dungeon: the grid cell size, treasure
// chests, the boss portcullis gate, the merged floor mesh and the tiled floor
// texture. Pure mesh/texture factories, split out of dungeon.js.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { rng } from "../core/engine.js";

export const CELL = 2.4;

export function makeChest() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), makeToonMaterial({ color: 0x8a5a33, rim: 0.2 }));
  base.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.3, 0.64), makeToonMaterial({ color: 0x9c6a3e, rim: 0.2 }));
  lid.geometry.translate(0, 0.15, 0.32); // hinge at back edge
  lid.position.set(0, 0.5, -0.32);
  const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.05), makeToonMaterial({ color: 0xf0c04a, rim: 0.3 }));
  clasp.position.set(0, 0.45, 0.31);
  g.add(base, lid, clasp);
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
