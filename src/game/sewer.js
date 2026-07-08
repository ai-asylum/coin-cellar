// The sewers under the trapdoor: a single shared chamber every online player
// walks through on their way down. Four holes gape along the north walkway,
// each a shortcut to the head of a stacked dungeon (floors 1, 4, 7, 10). The
// first mouth is always open; the deeper three unseal for a few hours once you
// descend past the boss that guards the dungeon above them. A murky canal runs
// the width of the room; the ladder home is set into the south wall.
// Static geometry, built once — nothing here regenerates.
import * as THREE from "three";
import { makeToonMaterial, feedOccluder } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { rng } from "../core/engine.js";
import { FLOORS_PER_DUNGEON } from "./dungeon.js";

export const SEWER_ORIGIN = new THREE.Vector3(-200, 0, 0);

// half-extents of the walkable chamber (local coords, origin at the centre)
const HW = 16, HD = 10;

export const HOLE_DEFS = [
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

    // holes and the exit ladder, in world coords for the context-action checks.
    // Each mouth is a shortcut to the head of its stacked dungeon (floors 1, 4,
    // 7, 10); the first is always open, the rest are earned by clearing bosses.
    this.holes = HOLE_DEFS.map((h, i) => ({
      id: i, name: h.name, color: h.color,
      floor: i * FLOORS_PER_DUNGEON + 1,
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
    this._wallMat = wallMat;
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
    const lidMat = makeToonMaterial({ color: 0x53433a, rim: 0 });
    const lidTrim = makeToonMaterial({ color: 0x2f2621, rim: 0, polygonOffset: true });
    for (const hole of this.holes) {
      const local = new THREE.Vector3().copy(hole.pos).sub(O);
      const mouth = new THREE.Mesh(
        new THREE.CircleGeometry(1.15, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x05060a })
      );
      mouth.position.copy(local).setY(0.02);
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(1.15, 1.42, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: hole.color, transparent: true, opacity: 0.5, depthWrite: false })
      );
      rim.position.copy(local).setY(0.03);
      this.group.add(mouth, rim);
      const shaft = makeLightShaft({ color: hole.color, length: 4.2, topWidth: 0.5, bottomWidth: 2.0, opacity: 0.22, tilt: 0.16, spin: r() * Math.PI, motes: 8 });
      shaft.position.set(local.x, 3.2, local.z);
      this.group.add(shaft);
      this.shafts.push(shaft);

      // a heavy grated trapdoor barring the mouth — it hinges on its back edge
      // and swings up once the player's paid to unseal this hole.
      const lidR = 1.4;
      const lidPivot = new THREE.Group();
      lidPivot.position.set(local.x, 0.06, local.z - lidR); // hinge on the far edge
      const lid = new THREE.Mesh(new THREE.BoxGeometry(lidR * 2, 0.12, lidR * 2), lidMat);
      lid.position.set(0, 0, lidR);
      lidPivot.add(lid);
      for (const bx of [-0.7, 0, 0.7]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, lidR * 2 - 0.2), lidTrim);
        bar.position.set(bx, 0.06, lidR);
        lidPivot.add(bar);
      }
      const rng2 = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 14), lidTrim);
      rng2.rotation.x = Math.PI / 2;
      rng2.position.set(0, 0.14, lidR * 1.7);
      lidPivot.add(rng2);
      this.group.add(lidPivot);
      hole.lid = lidPivot;
      // the first mouth is always open; the rest start barred until earned
      hole.open = hole.id === 0;
      hole._lidAngle = hole.open ? 1 : 0; // 0 = shut over the mouth, 1 = flung open
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
    // walls between the camera and the player dither away (see-through cutout)
    feedOccluder(this._wallMat, this.game.player, this.game.engine.camera);
    for (const s of this.shafts) s.userData.update(dt, elapsed);
    // lazy water shimmer
    this._waterMat.opacity = 0.5 + Math.sin(elapsed * 0.9) * 0.06;
    // ease each grated lid toward its open/shut pose — a mouth is open while its
    // shortcut is unsealed (the game tracks the wall-clock expiry)
    for (const hole of this.holes) {
      hole.open = this.game._shortcutOpen(hole.id);
      const tgt = hole.open ? 1 : 0;
      hole._lidAngle += (tgt - hole._lidAngle) * Math.min(1, dt * 6);
      if (hole.lid) hole.lid.rotation.x = -hole._lidAngle * 1.9; // swings up & back
    }
  }
}
