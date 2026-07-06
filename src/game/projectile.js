// Enemy projectiles — glowing arcane orbs and archer bolts. A tiny pooled
// system: each shot is an emissive core wrapped in an additive glow shell so
// it reads clearly against the dusky dungeon. The dungeon owns collision
// (against players); this class only spawns, moves and disposes the meshes.
import * as THREE from "three";

const _coreGeo = new THREE.SphereGeometry(1, 10, 8);
const _glowGeo = new THREE.SphereGeometry(1, 10, 8);

export class Projectiles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  /**
   * Fire a projectile from (x,z) toward a heading with a velocity.
   * opts: { color, dmg, speed, radius, life, y, kind, id }
   */
  spawn(x, z, vx, vz, opts = {}) {
    const {
      color = 0xb98cff,
      dmg = 1,
      radius = 0.26,
      life = 3.2,
      y = 0.7,
      kind = "orb",
      id = null,
    } = opts;

    const group = new THREE.Group();
    const c = new THREE.Color(color);
    const core = new THREE.Mesh(_coreGeo, new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.4), toneMapped: false }));
    core.scale.setScalar(radius * 0.6);
    const glow = new THREE.Mesh(_glowGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
    glow.scale.setScalar(radius * 1.5);
    group.add(core, glow);
    group.position.set(x, y, z);
    this.scene.add(group);

    const p = {
      id, kind, mesh: group, core, glow, color,
      x, z, y, vx, vz, dmg, radius,
      t: 0, life, dead: false, spin: Math.random() * 6,
    };
    this.list.push(p);
    return p;
  }

  update(dt, elapsed) {
    for (const p of this.list) {
      if (p.dead) continue;
      p.t += dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y + Math.sin(elapsed * 8 + p.spin) * 0.04, p.z);
      p.mesh.rotation.y += dt * 6;
      // pulse the glow
      const pulse = 1 + Math.sin(elapsed * 16 + p.spin) * 0.18;
      p.glow.scale.setScalar(p.radius * 1.5 * pulse);
      // fade in the last third of life
      const fade = Math.min(1, (p.life - p.t) / 0.5);
      p.glow.material.opacity = 0.5 * Math.max(0, fade);
      if (p.t >= p.life) p.dead = true;
    }
    if (this.list.some((p) => p.dead)) {
      for (const p of this.list) if (p.dead) this._free(p);
      this.list = this.list.filter((p) => !p.dead);
    }
  }

  _free(p) {
    p.core.material.dispose();
    p.glow.material.dispose();
    p.mesh.removeFromParent();
  }

  remove(p) {
    p.dead = true;
  }

  clear() {
    for (const p of this.list) this._free(p);
    this.list = [];
  }
}
