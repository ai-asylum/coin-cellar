// One instanced pool for all the juice: coin bursts, hit sparks, dust
// puffs, sale confetti. CPU-simulated, GPU-instanced, mobile-cheap.
import * as THREE from "three";

const MAX = 400;

export class Particles {
  constructor(scene) {
    const geo = new THREE.TetrahedronGeometry(0.06);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.mesh);
    this.pool = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  burst(pos, { color = 0xffcc44, n = 10, speed = 3, up = 2.5, gravity = 9, life = 0.6, size = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      if (this.pool.length >= MAX) break;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pool.push({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * s,
        vy: up * (0.5 + Math.random()),
        vz: Math.sin(a) * s,
        g: gravity,
        life: life * (0.6 + Math.random() * 0.8),
        t: 0,
        size: size * (0.7 + Math.random() * 0.6),
        color,
        spin: Math.random() * 9,
      });
    }
  }

  // sparks placed on a circle's edge (attack-range telegraphs): they hover in
  // place with a slight rise instead of scattering like burst() shrapnel
  ring(pos, radius, { color = 0xff5a3a, n = 14, life = 0.35, size = 0.8, up = 0.5 } = {}) {
    for (let i = 0; i < n; i++) {
      if (this.pool.length >= MAX) break;
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      this.pool.push({
        x: pos.x + Math.cos(a) * radius, y: pos.y, z: pos.z + Math.sin(a) * radius,
        vx: 0,
        vy: up * (0.5 + Math.random()),
        vz: 0,
        g: 0,
        life: life * (0.7 + Math.random() * 0.6),
        t: 0,
        size: size * (0.6 + Math.random() * 0.5),
        color,
        spin: Math.random() * 9,
      });
    }
  }

  update(dt) {
    const alive = [];
    for (const p of this.pool) {
      p.t += dt;
      if (p.t < p.life) {
        p.vy -= p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.03) {
          p.y = 0.03;
          p.vy *= -0.4;
          p.vx *= 0.7;
          p.vz *= 0.7;
        }
        alive.push(p);
      }
    }
    this.pool = alive;
    this.mesh.count = alive.length;
    for (let i = 0; i < alive.length; i++) {
      const p = alive[i];
      const k = 1 - p.t / p.life;
      this._q.setFromEuler(new THREE.Euler(p.spin * p.t, p.spin * p.t * 1.3, 0));
      this._s.setScalar(p.size * (0.5 + k * 0.5));
      this._m.compose(new THREE.Vector3(p.x, p.y, p.z), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c.set(p.color));
    }
    if (alive.length) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
