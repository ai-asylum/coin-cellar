// The cave at the end of the road — the dungeon's front door. A narrow burrow
// off the east end of the village street: walk in through the daylight mouth,
// and at its deepest point a sunk stair flight (the old owner's "cellar")
// drops into the shared cellar lobby where the real dungeons begin. Built once
// and permanent. Rat Warren dressing (warm browns) and a couple of harmless
// ambient rats; the FTUE additionally spawns the opener's slime here (see
// spawnSlime / game-narrative's _updateCaveIntro).
import * as THREE from "three";
import { makeToonMaterial, feedOccluder } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { rng } from "../core/engine.js";
import { Creature } from "../chargen/creature.js";
import { ratSpec, slimeSpec } from "../chargen/species.js";
import { HOLE_THEMES } from "./dungeon-data.js";
import { CELL, makeDescent, modelCollider, makeFloorGeometry, buildAssetFloor, buildAssetWalls, scatterAssetProps } from "./dungeon-geometry.js";
import { scatterDungeonDecor } from "./decor.js";
import { dungeonAssetsReady, dungeonPalette } from "./dungeon-assets.js";

export const CAVE_ORIGIN = new THREE.Vector3(-200, 0, 200);

// A long 4×7-cell tunnel with a one-cell mouth carved out of the SOUTH rim —
// the cave hangs off the top of the village road, so walking up-screen on the
// road continues up-screen inside: in through the light at the bottom, deeper
// toward the cellar descent in the deepest (northmost) row. The FTUE hero
// wakes right beside the pit, as if they'd just climbed out. A few corner
// cells stay solid so it reads dug-out.
const GW = 6, GH = 9;
const ROOM = { x: 1, y: 1, w: 4, h: 7, cx: 2, cy: 4 };
const EXIT_CELL = { x: 2, y: 8 }; // the daylight gap in the south rim
const SPAWN_CELL = { x: 2, y: 2 }; // the FTUE wake-up spot, facing the light
const DESCENT_CELL = { x: 2, y: 1 }; // the sunk stairs down to the cellar lobby
const SOLID_NOOKS = [[1, 7], [4, 7], [4, 3], [1, 4]]; // corners left un-dug
const cellPos = (x, y) => new THREE.Vector3((x - GW / 2 + 0.5) * CELL, 0, (y - GH / 2 + 0.5) * CELL);

export class Cave {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(CAVE_ORIGIN);
    game.engine.scene.add(this.group);
    this.shafts = [];
    this.colliders = [];
    this.rats = [];
    this.slime = null; // the FTUE opener's mark — spawned on demand

    // world-coord anchors for the game glue: the FTUE wake-up spot, the
    // daylight mouth (walk-through to the road), the cellar descent, and where
    // the opener's slime waits between spawn and mouth.
    this.entrancePos = cellPos(SPAWN_CELL.x, SPAWN_CELL.y).add(CAVE_ORIGIN);
    this.exitPos = cellPos(EXIT_CELL.x, EXIT_CELL.y).add(CAVE_ORIGIN);
    this.descentPos = cellPos(DESCENT_CELL.x, DESCENT_CELL.y).add(CAVE_ORIGIN);
    this.slimePos = this.entrancePos.clone().add(new THREE.Vector3(0, 0, 4.6));

    this._build();
    this._spawnRats();
  }

  _build() {
    const r = rng(1337);
    const O = CAVE_ORIGIN;

    // the open grid: the tunnel minus its un-dug nooks, plus the mouth cut into
    // the rim so the wall builders leave the daylight gap open
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    for (let y = ROOM.y; y < ROOM.y + ROOM.h; y++)
      for (let x = ROOM.x; x < ROOM.x + ROOM.w; x++) open[y][x] = true;
    for (const [x, y] of SOLID_NOOKS) open[y][x] = false;
    open[EXIT_CELL.y][EXIT_CELL.x] = true;

    // --- floor + walls: the dungeon-kit recipe with the Rat Warren's burrowed
    // browns, so the cave already speaks the dungeon's visual language
    const palette = HOLE_THEMES[0].palettes[0];
    const _WHITE = new THREE.Color(0xffffff);
    const floorTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.5);
    const wallTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.32);
    if (dungeonAssetsReady()) {
      // the descent is a real hole: its cell is cut out of the floor and gets
      // the pit-shaft + sunk-flight assembly below
      const floorHoles = new Set([`${DESCENT_CELL.x},${DESCENT_CELL.y}`]);
      this.group.add(buildAssetFloor(open, GW, GH, cellPos, floorTint, floorHoles));
      // own occluder material (the dungeon re-tints the shared one every floor)
      this._wallMat = makeToonMaterial({ map: dungeonPalette(), rim: 0, occlude: true });
      const walls = buildAssetWalls(open, GW, GH, cellPos, wallTint, this._wallMat);
      this.group.add(walls.mesh);
    } else {
      this.group.add(new THREE.Mesh(
        makeFloorGeometry(open, GW, GH, cellPos),
        new THREE.MeshToonMaterial({ color: new THREE.Color(palette[1]) })
      ));
      this._wallMat = makeToonMaterial({ color: new THREE.Color(palette[1]).multiplyScalar(0.55).getHex(), rim: 0, occlude: true });
      const wallCellsFallback = [];
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++) {
          if (open[y][x]) continue;
          let touches = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
            if (open[y + dy]?.[x + dx]) touches = true;
          if (touches) wallCellsFallback.push([x, y]);
        }
      const wallGeo = new THREE.BoxGeometry(CELL, 1.7, CELL);
      const walls = new THREE.InstancedMesh(wallGeo, this._wallMat, wallCellsFallback.length);
      const m = new THREE.Matrix4();
      wallCellsFallback.forEach(([x, y], i) => {
        const p = cellPos(x, y);
        const jitter = 0.92 + rng(1337 + x * 31 + y * 57)() * 0.18;
        m.makeScale(1, jitter, 1);
        m.setPosition(p.x, 0.85 * jitter, p.z);
        walls.setMatrixAt(i, m);
      });
      this.group.add(walls);
    }
    // solid cells fence the player (and the void past the mouth gets a backstop)
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (open[y][x]) continue;
        const p = cellPos(x, y);
        this.colliders.push({ x: p.x + O.x, z: p.z + O.z, hw: CELL / 2, hd: CELL / 2 });
      }
    const exitLocal = cellPos(EXIT_CELL.x, EXIT_CELL.y);
    this.colliders.push({ x: exitLocal.x + O.x, z: exitLocal.z + CELL + O.z, hw: CELL / 2, hd: CELL / 2 });

    // --- the cellar descent: the same pit + sunk stair flight the dungeons'
    // descent cells use, under a violet shaft — the way down to the lobby
    const descentLocal = cellPos(DESCENT_CELL.x, DESCENT_CELL.y);
    if (dungeonAssetsReady()) {
      const descent = makeDescent(0.02);
      descent.position.copy(descentLocal);
      this.colliders.push(modelCollider(descent, CAVE_ORIGIN));
      this.group.add(descent);
    } else {
      const mouth = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x05060a })
      );
      mouth.position.copy(descentLocal).setY(0.02);
      this.group.add(mouth);
    }
    const downShaft = makeLightShaft({ color: 0x9a6dff, length: 4.2, topWidth: 0.45, bottomWidth: 1.6, opacity: 0.24, tilt: 0.16, spin: 0.7, motes: 8 });
    downShaft.position.set(descentLocal.x, 3.2, descentLocal.z);
    this.group.add(downShaft);
    this.shafts.push(downShaft);

    // --- the daylight mouth: a warm shaft pouring in, a glare quad filling the
    // gap (facing the camera) and a pool of light spilling onto the floor
    const shaft = makeLightShaft({ color: 0xfff0c0, length: 5.2, topWidth: 0.7, bottomWidth: 2.8, opacity: 0.5, tilt: 0.3, spin: 0.4, motes: 16 });
    shaft.position.set(exitLocal.x, 3.6, exitLocal.z);
    this.group.add(shaft);
    this.shafts.push(shaft);
    this.glare = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL - 0.2, 2.4),
      new THREE.MeshBasicMaterial({
        color: 0xfff6dd, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    this.glare.position.set(exitLocal.x, 1.2, exitLocal.z + CELL / 2 - 0.1);
    this.group.add(this.glare);
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 26).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xfff0c0, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    pool.position.set(exitLocal.x, 0.02, exitLocal.z - CELL * 0.4);
    this.group.add(pool);

    // --- set dressing: the warren's billboard mix plus the kit's props, kept
    // clear of the walk between the mouth and the descent
    const skip = [SPAWN_CELL, EXIT_CELL, DESCENT_CELL,
      ...[3, 4, 5, 6, 7].map((y) => ({ x: EXIT_CELL.x, y }))];
    scatterDungeonDecor(this.group, r, [ROOM], cellPos, { skip, theme: HOLE_THEMES[0].decor });
    for (const pr of scatterAssetProps(this.group, r, [ROOM], cellPos, { skip, origin: CAVE_ORIGIN }))
      this.colliders.push(pr.collider);
  }

  _spawnRats() {
    // a couple of harmless rats pottering about — pure ambience, they only
    // scurry off when the player barrels near (one dash fells them: dashHit)
    for (const [gx, gy, seed] of [[3, 5, 11], [4, 4, 23]]) {
      const c = new Creature(ratSpec({ key: `cave_rat_${seed}`, seed, scale: 0.55 }));
      c.position.copy(cellPos(gx, gy)).add(CAVE_ORIGIN);
      c.heading = Math.random() * Math.PI * 2;
      this.game.engine.scene.add(c);
      this.rats.push({ creature: c, tx: c.position.x, tz: c.position.z, pause: 1 + Math.random() * 2 });
    }
  }

  // The FTUE opener's slime, parked between the wake-up spot and the light,
  // facing the player. Only the first-run cinematic asks for it.
  spawnSlime() {
    if (this.slime) return this.slime;
    this.slime = new Creature(slimeSpec({ key: "cave_slime", scale: 0.66, hue: 0.42 }));
    this.slime.position.copy(this.slimePos);
    this.slime.heading = Math.PI; // face north, toward the waking player
    this.game.engine.scene.add(this.slime);
    return this.slime;
  }

  // The player's dash swept through here: fell any rat it caught — they're
  // prey, not foes, so one hit does it. The game hook handles the loot juice
  // (and the hero's sheepish first-kill line).
  dashHit(attacker) {
    const pos = attacker.position;
    const reach = attacker.radius + 0.5;
    let hitAny = false;
    for (const rat of this.rats) {
      const c = rat.creature;
      if (c.dead) continue;
      const dx = c.position.x - pos.x;
      const dz = c.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + c.radius) continue;
      hitAny = true;
      const l = dist || 1e-4;
      c.die(new THREE.Vector3((dx / l) * 7, -2, (dz / l) * 7));
      this.game._onCaveRatKilled(c.position);
    }
    return hitAny;
  }

  // Fresh wander target inside the room, a comfortable step from where the rat
  // stands now (world coords).
  _ratTarget(rat) {
    const gx = ROOM.x + 0.5 + Math.random() * (ROOM.w - 1);
    const gy = ROOM.y + 0.5 + Math.random() * (ROOM.h - 1);
    const p = cellPos(gx, gy).add(CAVE_ORIGIN);
    rat.tx = p.x;
    rat.tz = p.z;
  }

  update(dt, elapsed) {
    if (this.game.playerArea !== "cave") return;
    feedOccluder(this._wallMat, this.game.player, this.game.engine.camera);
    for (const s of this.shafts) s.userData.update(dt, elapsed);
    this.glare.material.opacity = 0.75 + Math.sin(elapsed * 1.7) * 0.12;

    // the slime idles (and, once the cinematic fells it, chars + dissolves)
    if (this.slime) {
      this.slime.update(dt, elapsed);
      if (this.slime.dead && (this._slimeGoneT = (this._slimeGoneT ?? 0) + dt) > 2.2) {
        this.slime.dispose();
        this.slime = null;
      }
    }

    // rats: potter between random spots, freeze to sniff, bolt from the player
    const pp = this.game.player.position;
    for (const rat of [...this.rats]) {
      const c = rat.creature;
      if (c.dead) {
        // felled by the dash: let the char-and-dissolve play out, then free it
        c.update(dt, elapsed);
        rat.goneT = (rat.goneT ?? 0) + dt;
        if (rat.goneT > 2.2) {
          c.dispose();
          this.rats.splice(this.rats.indexOf(rat), 1);
        }
        continue;
      }
      const dxp = c.position.x - pp.x, dzp = c.position.z - pp.z;
      const dp = Math.hypot(dxp, dzp);
      let speed = 1.1;
      if (dp < 1.8) {
        // spooked: dart straight away from the hero, no dawdling
        const l = dp || 1e-4;
        rat.tx = c.position.x + (dxp / l) * 2.6;
        rat.tz = c.position.z + (dzp / l) * 2.6;
        rat.pause = 0;
        speed = 3.2;
      }
      if (rat.pause > 0) {
        rat.pause -= dt;
      } else {
        const dx = rat.tx - c.position.x, dz = rat.tz - c.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25) {
          this._ratTarget(rat);
          rat.pause = 0.6 + Math.random() * 2.2;
        } else {
          c.position.x += (dx / d) * speed * dt;
          c.position.z += (dz / d) * speed * dt;
          c.heading = Math.atan2(dx, dz);
          this.game.collide(c.position, c.radius, this.colliders);
        }
      }
      c.update(dt, elapsed);
    }
  }
}
