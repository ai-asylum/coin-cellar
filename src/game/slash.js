// The swoosh: a bright crescent that sweeps in front of the blade on every
// swing. Built once, replayed on demand. Uses additive blending + a per-vertex
// brightness gradient so the trailing edge fades into a comet-like streak
// without needing a custom shader or transparency sorting.
import * as THREE from "three";
import { clamp, lerp } from "../core/engine.js";

const ARC_HALF = THREE.MathUtils.degToRad(72); // matches the melee hit cone
const INNER = 0.55;
const OUTER = 1.8;
const SEG = 28;
const LIFE = 0.26;
const SWEEP = 1.15; // radians the crescent travels during the swing

export class SlashArc {
  constructor(scene) {
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG; // 0 (trailing) .. 1 (leading edge)
      const a = lerp(-ARC_HALF, ARC_HALF, f);
      const taper = Math.sin(f * Math.PI); // 0 at both tips, 1 in the belly
      const mid = (INNER + OUTER) / 2;
      const half = ((OUTER - INNER) / 2) * taper;
      const ri = mid - half;
      const ro = mid + half;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      pos.push(sa * ri, 0, ca * ri, sa * ro, 0, ca * ro);
      // brightness rides toward the leading edge -> trailing edge fades out
      const b = f * f;
      col.push(b, b, b, b, b, b);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);

    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xcfe0ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.pivot = new THREE.Group();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -0.35; // cant the plane up toward the 3/4 camera
    this.pivot.add(this.mesh);
    this.pivot.visible = false;
    scene.add(this.pivot);

    this.t = -1;
    this.heading = 0;
    this.scale = 1;
  }

  /** Fire a swoosh from `pos` (world) facing `heading`, sized to the swinger. */
  play(pos, heading, scale = 1) {
    this.pivot.position.set(pos.x, pos.y, pos.z);
    this.heading = heading;
    this.scale = scale;
    this.t = 0;
    this.pivot.visible = true;
  }

  /** Keep the live swoosh pinned to a moving swinger (e.g. the dashing hero) so
   * the effect travels with them instead of hanging where the swing began. */
  follow(x, y, z) {
    if (this.t >= 0) this.pivot.position.set(x, y, z);
  }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const u = this.t / LIFE;
    if (u >= 1) {
      this.t = -1;
      this.pivot.visible = false;
      return;
    }
    const ease = u * u * (3 - 2 * u);
    // the whole crescent rakes across the front as the blade travels
    this.pivot.rotation.y = this.heading + lerp(-SWEEP * 0.5, SWEEP * 0.5, ease);
    const grow = lerp(0.82, 1.12, ease) * this.scale;
    this.pivot.scale.setScalar(grow);
    // snap in, then fade the streak out
    this.mat.opacity = clamp(u / 0.12, 0, 1) * (1 - ease) * 0.9;
  }
}
