// The sewers under the trapdoor: a single shared chamber every online player
// walks through on their way down. Four holes gape along the north walkway,
// each the mouth of its own dungeon (seeded per hole per day, so everyone who
// jumps into the same hole delves the same layout). A murky canal runs the
// width of the room; the ladder home is set into the south wall.
// Static geometry, built once — nothing here regenerates.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { rng } from "../core/engine.js";

export const SEWER_ORIGIN = new THREE.Vector3(-200, 0, 0);

// half-extents of the walkable chamber (local coords, origin at the centre)
const HW = 16, HD = 10;

const HOLE_DEFS = [
  { name: "Rat Warren", x: -12, z: -6, color: 0x9a6dff },
  { name: "Flooded Deep", x: -4, z: -6, color: 0x5dd0ff },
  { name: "Bone Hollow", x: 4, z: -6, color: 0xff9a5d },
  { name: "Gloom Drain", x: 12, z: -6, color: 0x6fd6c8 },
];

export class Sewer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(SEWER_ORIGIN);
    game.engine.scene.add(this.group);
    this.shafts = [];
    this.colliders = [];
    this._waterMat = null;

    // holes and the exit ladder, in world coords for the context-action checks
    this.holes = HOLE_DEFS.map((h, i) => ({
      id: i, name: h.name, color: h.color,
      pos: new THREE.Vector3(h.x, 0, h.z).add(SEWER_ORIGIN),
    }));
    this.entrancePos = new THREE.Vector3(0, 0, HD - 1.2).add(SEWER_ORIGIN);
    this.exitPos = this.entrancePos.clone();

    this._build();
  }

  _build() {
    const r = rng(4242);

    // --- floor: two stone walkways with a sunken canal strip between them
    const floorMat = makeToonMaterial({ color: 0x4a5548, rim: 0 });
    const north = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 4, 0.5, HD - 2), floorMat);
    north.position.set(0, -0.25, -(HD + 2) / 2); // walkway spans z in [-HD, -2]
    const south = north.clone();
    south.position.z = (HD + 2) / 2; // walkway spans z in [2, HD]
    this.group.add(north, south);

    // canal bed + water plane (z in [-2, 2], walkable — it's only shin-deep)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 4, 0.5, 4), makeToonMaterial({ color: 0x2c3430, rim: 0 }));
    bed.position.set(0, -0.6, 0);
    this.group.add(bed);
    this._waterMat = new THREE.MeshBasicMaterial({ color: 0x2f6b4f, transparent: true, opacity: 0.55 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 4, 4).rotateX(-Math.PI / 2), this._waterMat);
    water.position.y = -0.18;
    this.group.add(water);

    // --- brick walls: jittered instanced blocks around the perimeter
    const cells = [];
    for (let x = -HW - 1; x <= HW + 1; x += 2) {
      cells.push([x, -HD - 1], [x, HD + 1]);
    }
    for (let z = -HD + 1; z <= HD - 1; z += 2) {
      cells.push([-HW - 1, z], [HW + 1, z]);
    }
    const wallGeo = new THREE.BoxGeometry(2, 2.4, 2);
    const wallMat = makeToonMaterial({ color: 0x3a4640, rim: 0, occlude: true });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([x, z], i) => {
      const jitter = 0.9 + r() * 0.2;
      m.makeScale(1, jitter, 1);
      m.setPosition(x, 1.2 * jitter, z);
      walls.setMatrixAt(i, m);
    });
    this.group.add(walls);

    // one collider slab per wall (world coords, same AABB shape as the dungeon's)
    const O = SEWER_ORIGIN;
    this.colliders.push(
      { x: O.x, z: O.z - HD - 1, hw: HW + 2, hd: 1 },
      { x: O.x, z: O.z + HD + 1, hw: HW + 2, hd: 1 },
      { x: O.x - HW - 1, z: O.z, hw: 1, hd: HD + 2 },
      { x: O.x + HW + 1, z: O.z, hw: 1, hd: HD + 2 },
    );

    // --- the dungeon holes: a dark mouth, a glowing rim, a rising light shaft
    for (const hole of this.holes) {
      const local = new THREE.Vector3().copy(hole.pos).sub(O);
      const mouth = new THREE.Mesh(
        new THREE.CircleGeometry(1.15, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x05060a })
      );
      mouth.position.copy(local).setY(0.02);
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(1.15, 1.42, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: hole.color, transparent: true, opacity: 0.5 })
      );
      rim.position.copy(local).setY(0.03);
      this.group.add(mouth, rim);
      const shaft = makeLightShaft({ color: hole.color, length: 4.2, topWidth: 0.5, bottomWidth: 2.0, opacity: 0.22, tilt: 0.16, spin: r() * Math.PI, motes: 8 });
      shaft.position.set(local.x, 3.2, local.z);
      this.group.add(shaft);
      this.shafts.push(shaft);
    }

    // --- the ladder home: rungs against the south wall under a warm shaft
    const ladder = new THREE.Group();
    const woodMat = makeToonMaterial({ color: 0x6e4526, rim: 0 });
    for (const sx of [-0.4, 0.4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 0.12), woodMat);
      rail.position.set(sx, 1.7, 0);
      ladder.add(rail);
    }
    for (let i = 0; i < 5; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.1), woodMat);
      rung.position.set(0, 0.5 + i * 0.6, 0);
      ladder.add(rung);
    }
    const exitLocal = new THREE.Vector3().copy(this.exitPos).sub(O);
    ladder.position.set(exitLocal.x, 0, exitLocal.z + 1.0);
    this.group.add(ladder);
    const homeShaft = makeLightShaft({ color: 0xffd9a0, length: 4.6, topWidth: 0.6, bottomWidth: 2.4, opacity: 0.32, tilt: 0.2, spin: 0.6, motes: 12 });
    homeShaft.position.set(exitLocal.x, 3.4, exitLocal.z);
    this.group.add(homeShaft);
    this.shafts.push(homeShaft);

    // --- set dressing: emissive crystals tucked along the walls
    for (let i = 0; i < 8; i++) {
      const crystal = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.55, 5),
        new THREE.MeshBasicMaterial({ color: [0x9a6dff, 0x5dd0ff, 0x6fd6c8][i % 3] })
      );
      crystal.position.set(-HW + 1 + r() * (HW * 2 - 2), 0.3, (r() < 0.5 ? -1 : 1) * (HD - 0.8));
      crystal.rotation.z = 0.3;
      this.group.add(crystal);
    }
  }

  update(dt, elapsed) {
    if (this.game.playerArea !== "sewer") return;
    for (const s of this.shafts) s.userData.update(dt, elapsed);
    // lazy water shimmer
    this._waterMat.opacity = 0.5 + Math.sin(elapsed * 0.9) * 0.06;
  }
}
