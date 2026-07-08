// Customer navigation: bakes a coarse occupancy grid over the shop floor and
// runs A* over it so shoppers route around the tables and furniture. Split out
// of shop.js as prototype methods (mixed onto Shop via Object.assign).
import * as THREE from "three";
import { SHOP } from "./shop-data.js";

// 8-way neighbour offsets for the grid A* (orthogonal + diagonal)
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export const pathMethods = {
  // Bake a coarse occupancy grid over the interior floor. A cell is blocked if
  // it lands inside any collider inflated by a customer's half-width, so paths
  // keep a body's clearance from tables and walls.
  _buildNav() {
    const { W, D } = SHOP;
    const cell = 0.34;
    const pad = 0.32; // customer clearance
    const minX = -W / 2 + 0.3, minZ = -D / 2 + 0.3;
    const cols = Math.ceil((W - 0.6) / cell);
    const rows = Math.ceil((D - 0.6) / cell);
    const blocked = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = minX + (cc + 0.5) * cell;
        const z = minZ + (r + 0.5) * cell;
        let hit = false;
        for (const o of this.colliders) {
          if (Math.abs(x - o.x) < o.hw + pad && Math.abs(z - o.z) < o.hd + pad) {
            hit = true;
            break;
          }
        }
        blocked[r * cols + cc] = hit ? 1 : 0;
      }
    }
    this._nav = { cell, minX, minZ, cols, rows, blocked };
  },

  // A* over the nav grid, returning a string-pulled list of world waypoints
  // (Vector3). Returns null when either endpoint sits outside the grid (e.g.
  // the street) so the caller can fall back to a straight line.
  _findPath(from, to) {
    const nav = this._nav;
    if (!nav) return null;
    const { cell, minX, minZ, cols, rows, blocked } = nav;
    const idx = (c, r) => r * cols + c;
    const colOf = (x) => Math.floor((x - minX) / cell);
    const rowOf = (z) => Math.floor((z - minZ) / cell);
    let sc = colOf(from.x), sr = rowOf(from.z);
    let gc = colOf(to.x), gr = rowOf(to.z);
    const inGrid = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
    if (!inGrid(sc, sr) || !inGrid(gc, gr)) return null;

    // slide endpoints off blocked cells onto the nearest free one
    const freeNear = (c, r) => {
      if (!blocked[idx(c, r)]) return [c, r];
      for (let rad = 1; rad < 6; rad++) {
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            const nc = c + dc, nr = r + dr;
            if (inGrid(nc, nr) && !blocked[idx(nc, nr)]) return [nc, nr];
          }
        }
      }
      return null;
    };
    const start = freeNear(sc, sr), goal = freeNear(gc, gr);
    if (!start || !goal) return null;
    [sc, sr] = start;
    [gc, gr] = goal;
    const startI = idx(sc, sr), goalI = idx(gc, gr);

    const n = cols * rows;
    const came = new Int32Array(n).fill(-1);
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const inOpen = new Uint8Array(n);
    const h = (c, r) => Math.hypot(c - gc, r - gr);
    gScore[startI] = 0;
    fScore[startI] = h(sc, sr);
    const open = [startI];
    inOpen[startI] = 1;

    let found = startI === goalI;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fScore[open[k]] < fScore[open[bi]]) bi = k;
      const cur = open[bi];
      if (cur === goalI) {
        found = true;
        break;
      }
      open.splice(bi, 1);
      inOpen[cur] = 0;
      const cr = Math.floor(cur / cols), cc = cur % cols;
      for (const [dc, dr] of DIRS) {
        const nc = cc + dc, nr = cr + dr;
        if (!inGrid(nc, nr) || blocked[idx(nc, nr)]) continue;
        if (dc !== 0 && dr !== 0 && (blocked[idx(cc + dc, cr)] || blocked[idx(cc, cr + dr)])) continue; // no corner cutting
        const ni = idx(nc, nr);
        const tentative = gScore[cur] + (dc !== 0 && dr !== 0 ? 1.4142 : 1);
        if (tentative < gScore[ni]) {
          came[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + h(nc, nr);
          if (!inOpen[ni]) {
            open.push(ni);
            inOpen[ni] = 1;
          }
        }
      }
    }
    if (!found) return null;

    const cells = [];
    let cur = goalI;
    while (cur !== -1) {
      cells.push({ x: minX + ((cur % cols) + 0.5) * cell, z: minZ + (Math.floor(cur / cols) + 0.5) * cell });
      if (cur === startI) break;
      cur = came[cur];
    }
    cells.reverse();

    // string-pull: keep only waypoints that need a turn (line-of-sight skips)
    const pts = [{ x: from.x, z: from.z }, ...cells, { x: to.x, z: to.z }];
    const out = [new THREE.Vector3(pts[0].x, 0, pts[0].z)];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this._lineOfSight(pts[i], pts[j])) break;
      out.push(new THREE.Vector3(pts[j].x, 0, pts[j].z));
      i = j;
    }
    return out;
  },

  // Is the straight segment a→b clear of blocked cells? (grid ray-march)
  _lineOfSight(a, b) {
    const nav = this._nav;
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / (nav.cell * 0.5));
    for (let k = 0; k <= steps; k++) {
      const t = steps ? k / steps : 0;
      const c = Math.floor((a.x + dx * t - nav.minX) / nav.cell);
      const r = Math.floor((a.z + dz * t - nav.minZ) / nav.cell);
      if (c < 0 || c >= nav.cols || r < 0 || r >= nav.rows) return false;
      if (nav.blocked[r * nav.cols + c]) return false;
    }
    return true;
  },
};
