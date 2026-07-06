// The dungeon under the shop. Seeded procedural floors (rooms + L-shaped
// corridors on a grid), instanced walls, chests, a stairway down and a
// portal home. Enemies come out of the same blob-bake pipeline as the
// customers upstairs — skitters, slimes, goblins, wisps, brutes.
import * as THREE from "three";
import { makeToonMaterial, makeBlobShadow } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { Creature } from "../chargen/creature.js";
import { goblinSpec, bruteSpec, skitterSpec, slimeSpec, wispSpec, archerSpec, bossSpec } from "../chargen/species.js";
import { ITEMS, LOOT_BY_TIER, itemSprite } from "./items.js";
import { scatterDungeonDecor, disposeDecor } from "./decor.js";
import { Projectiles } from "./projectile.js";
import { rng, pick, clamp, lerp } from "../core/engine.js";

export const DUNGEON_ORIGIN = new THREE.Vector3(200, 0, 0);
const CELL = 2.4;
const IMP_DECAY = 0.0012; // per-second base for impulse/knockback friction
// an impulse of v decays to a total travel of v / -ln(IMP_DECAY); invert that so
// a lunge can be aimed to land a chosen distance away instead of a fixed speed
const LEAP_K = -Math.log(IMP_DECAY);

// Each kind now carries a `behavior` that drives a distinct combat pattern, a
// windup time (how long its telegraph reads before the blow lands — the
// reaction window the player dodges into) and, for ranged foes, a keep-away
// band. Every attack now telegraphs before it can hurt you.
export const ENEMY_KINDS = {
  // fast erratic swarmer: darts in, quick bite, backs off
  skitter: {
    make: (seed, tier) => {
      const legsN = pick(rng(seed), [4, 6]);
      // legsN MUST be part of the cache key — bone counts differ
      return skitterSpec({ key: `e_sk${tier}_${legsN}_${seed % 5}`, seed, legsN, scale: 0.62 + tier * 0.05, hue: 0.78 - tier * 0.13 });
    },
    hp: 2, dmg: 1, speed: 2.9, aggro: 7, gold: [3, 8],
    behavior: "swarm", windup: 0.28, reach: 1.05, glow: [0.6, 0.15, 0.15],
  },
  // slow but telegraphs a leaping lunge that closes distance fast
  slime: {
    make: (seed, tier) => slimeSpec({ key: `e_sl${tier}_${seed % 5}`, scale: 0.6 + tier * 0.07, hue: (0.36 + (seed % 5) * 0.13) % 1 }),
    hp: 4, dmg: 1, speed: 1.9, aggro: 6, gold: [4, 10],
    behavior: "lunge", windup: 0.5, reach: 1.5, glow: [0.15, 0.55, 0.2],
  },
  // circles the player and darts in with a quick slash
  goblin: {
    make: (seed, tier) => goblinSpec(seed % 7, Math.min(tier, 2)),
    hp: 5, dmg: 1, speed: 3.0, aggro: 8, gold: [8, 16],
    behavior: "strafe", windup: 0.34, reach: 1.35, glow: [0.6, 0.2, 0.1],
  },
  // arcane caster: keeps its distance, telegraphs, hurls a homing-ish orb
  wisp: {
    make: (seed, tier) => wispSpec({ key: `e_wi${tier}_${seed % 4}`, scale: 0.6, hue: (0.55 + (seed % 4) * 0.11) % 1 }),
    hp: 3, dmg: 1, speed: 3.2, aggro: 9, gold: [6, 12],
    behavior: "caster", windup: 0.55, band: [4.5, 7.5], projSpeed: 6.0, projColor: 0xb98cff, glow: [0.4, 0.25, 0.7],
  },
  // hooded archer: kites at range, telegraphs then flooses a fast straight bolt
  archer: {
    make: (seed, tier) => archerSpec(seed % 6, Math.min(tier, 2)),
    hp: 4, dmg: 1, speed: 2.7, aggro: 10, gold: [10, 20],
    behavior: "archer", windup: 0.42, band: [5, 9], projSpeed: 10.5, projColor: 0x8fe0ff, glow: [0.15, 0.5, 0.7],
  },
  // heavy: slow, but winds up a wide overhead slam that hits everything near it
  brute: {
    make: (seed, tier) => bruteSpec(seed % 5, Math.min(tier, 2)),
    hp: 12, dmg: 2, speed: 1.6, aggro: 7, gold: [25, 45],
    behavior: "slam", windup: 0.72, reach: 2.4, glow: [0.75, 0.1, 0.05],
  },
  // the floor boss: a giant that owns the sealed arena. Huge HP pool and a
  // rotation of telegraphed patterns — a wide ground-shaking slam up close, a
  // room-crossing charge, and a radial orb burst at range. Enrages at half HP.
  boss: {
    make: (seed) => bossSpec(seed),
    hp: 70, dmg: 2, speed: 1.7, aggro: 15, gold: [0, 0],
    behavior: "boss", windup: 0.78, reach: 3.4, glow: [0.95, 0.08, 0.05],
    projSpeed: 5.5, projColor: 0xff7a4d,
  },
};

// A dungeon run is now exactly three floors deep; the third holds the boss.
export const MAX_FLOORS = 3;
export const FLOOR_MIX = [
  ["skitter", "slime"],
  ["skitter", "slime", "goblin"],
  ["slime", "goblin", "wisp", "archer"],
  ["goblin", "wisp", "archer", "brute"],
  ["goblin", "archer", "wisp", "brute", "brute"],
];

export class Dungeon {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(DUNGEON_ORIGIN);
    game.engine.scene.add(this.group);
    this.group.visible = false;
    this.active = false;
    this.floor = 0;
    this.enemies = [];
    this.drops = [];
    this.chests = [];
    this.shafts = []; // god-ray light shafts (animated each frame)
    this.colliders = [];
    this.projectiles = new Projectiles(game.engine.scene);
    this._wallMesh = null;
    this._floorMesh = null;
    // boss floor: sealed arena, its portcullis gate, and which chest holds the key
    this.gate = null;
    this.gateOpen = false;
    this.gatePos = null; // group-local doorway centre (game offsets by DUNGEON_ORIGIN)
    this.bossRoom = null; // world-space AABB used to lock the camera on the arena
    this.bossCenter = null;
    this.boss = null;
    this.keyChestId = -1;
  }

  /** Build floor n from a seed (deterministic — co-op peers share the seed). */
  generate(floorN, seed) {
    this.dispose();
    this.floor = floorN;
    this.seed = seed;
    this.active = true;
    this.group.visible = true;
    const r = rng(seed + floorN * 7717);

    // The final floor is the boss floor: a big sealed arena is reserved along
    // the top of a taller grid, and the normal rooms are packed in below it.
    const isBoss = floorN >= MAX_FLOORS;
    this.isBoss = isBoss;

    // --- grid: non-overlapping rooms linked by wide L-shaped corridors
    const GW = 25, GH = isBoss ? 30 : 24;
    // boss arena rectangle + its 2-wide doorway (only meaningful on the boss floor)
    const BW = 9, BH = 6, BX = Math.floor((GW - BW) / 2), BY = 1;
    const gateX = BX + Math.floor(BW / 2) - 1, gateY = BY + BH;
    const yMin = isBoss ? BY + BH + 2 : 1; // keep normal rooms clear of the arena
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    const rooms = [];
    const nRooms = 8 + Math.min(4, Math.floor(floorN / 2)) + Math.floor(r() * 3);
    // rejection-sample room rects that keep a 1-cell gap from their neighbours
    for (let tries = 0; rooms.length < nRooms && tries < nRooms * 14; tries++) {
      const w = 3 + Math.floor(r() * 3);
      const h = 3 + Math.floor(r() * 3);
      const x = 1 + Math.floor(r() * (GW - w - 2));
      const y = yMin + Math.floor(r() * (GH - h - yMin - 1));
      const overlaps = rooms.some((o) =>
        x - 1 < o.x + o.w && x + w + 1 > o.x && y - 1 < o.y + o.h && y + h + 1 > o.y
      );
      if (overlaps) continue;
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) open[yy][xx] = true;
    }

    // carve a 2-cell-wide L corridor (horizontal leg then vertical leg)
    const carve = (a, b) => {
      for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) {
        open[a.cy][x] = true;
        if (open[a.cy + 1]) open[a.cy + 1][x] = true;
      }
      for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) {
        open[y][b.cx] = true;
        if (b.cx + 1 < GW) open[y][b.cx + 1] = true;
      }
    };

    // connect every room via a minimum spanning tree (Prim's) so corridors go
    // to the nearest room rather than following spawn order
    const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    const connected = new Set([0]);
    while (connected.size < rooms.length) {
      let from = 0, to = -1, best = Infinity;
      for (const i of connected)
        for (let j = 0; j < rooms.length; j++) {
          if (connected.has(j)) continue;
          const d = dist(rooms[i], rooms[j]);
          if (d < best) { best = d; from = i; to = j; }
        }
      if (to < 0) break;
      carve(rooms[from], rooms[to]);
      connected.add(to);
    }
    // a couple of extra links create loops so floors aren't strictly tree-shaped
    for (let k = 0, extra = 1 + Math.floor(r() * 2); k < extra && rooms.length > 2; k++) {
      const a = rooms[Math.floor(r() * rooms.length)];
      const b = rooms[Math.floor(r() * rooms.length)];
      if (a !== b) carve(a, b);
    }

    // --- boss arena: open its big rectangle + a 2-wide doorway, then run a
    // corridor from the nearest normal room up to the door (sealed by a gate).
    if (isBoss) {
      for (let yy = BY; yy < BY + BH; yy++)
        for (let xx = BX; xx < BX + BW; xx++) open[yy][xx] = true;
      for (let yy = BY + BH; yy <= BY + BH + 1; yy++)
        for (let xx = gateX; xx <= gateX + 1; xx++) open[yy][xx] = true;
      let near = rooms[0], nd = Infinity;
      for (const rm of rooms) {
        const dd = Math.abs(rm.cx - gateX) + Math.abs(rm.cy - (BY + BH + 2));
        if (dd < nd) { nd = dd; near = rm; }
      }
      if (near) carve(near, { cx: gateX, cy: BY + BH + 2 });
    }

    this.open = open;
    this.GW = GW;
    this.GH = GH;
    this.rooms = rooms;
    // fog-of-war: minimap cells start hidden and are revealed as players explore
    this.discovered = Array.from({ length: GH }, () => new Array(GW).fill(false));
    this.revealVersion = 0;

    const cellPos = (x, y) => new THREE.Vector3((x - GW / 2 + 0.5) * CELL, 0, (y - GH / 2 + 0.5) * CELL);

    // --- floor slab
    const palette = [
      [0x8a70b5, 0x715a99],
      [0x5f93a8, 0x4d7a8c],
      [0xa8756a, 0x8c5f55],
      [0x7a75ad, 0x635e94],
      [0x9c6693, 0x7f5178],
    ][Math.min(floorN - 1, 4) % 5];
    const floorTex = makeTilesTexture(palette, seed + floorN);
    // the floor only exists under open (walkable) cells — one merged quad per
    // cell rather than a single slab, so there's no floor hanging out beyond the
    // walls. UVs keep the tiled texture continuous across neighbouring cells.
    this._floorMesh = new THREE.Mesh(
      makeFloorGeometry(open, GW, GH, cellPos),
      new THREE.MeshToonMaterial({ map: floorTex })
    );
    this.group.add(this._floorMesh);

    // --- instanced walls on closed cells that touch open cells
    const wallCells = [];
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (open[y][x]) continue;
        let touches = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
          if (open[y + dy]?.[x + dx]) touches = true;
        if (touches) wallCells.push([x, y]);
        // colliders for every closed cell adjacent to open (cheap enough)
        if (touches) {
          const p = cellPos(x, y);
          this.colliders.push({ x: p.x + DUNGEON_ORIGIN.x, z: p.z + DUNGEON_ORIGIN.z, hw: CELL / 2, hd: CELL / 2 });
        }
      }
    const wallGeo = new THREE.BoxGeometry(CELL, 1.7, CELL);
    const wallMat = makeToonMaterial({ color: new THREE.Color(palette[1]).multiplyScalar(0.55).getHex(), rim: 0, occlude: true });
    this._wallMat = wallMat;
    this._wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    const m = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => {
      const p = cellPos(x, y);
      const jitter = 0.92 + rng(seed + x * 31 + y * 57)() * 0.18;
      m.makeScale(1, jitter, 1);
      m.setPosition(p.x, 0.85 * jitter, p.z);
      this._wallMesh.setMatrixAt(i, m);
    });
    this.group.add(this._wallMesh);

    // --- entrance (room 0) is just the arrival spot now (marked by its light
    // shaft below) — leaving the cellar happens at the stairs prompt instead of
    // a return circle. & stairs down (last room)
    this.entrancePos = cellPos(rooms[0].cx, rooms[0].cy);
    this.entranceCell = { x: rooms[0].cx, y: rooms[0].cy };
    // start with the entrance room revealed
    this.reveal(this.entrancePos.x + DUNGEON_ORIGIN.x, this.entrancePos.z + DUNGEON_ORIGIN.z);

    // stairs go in the room farthest from the entrance for a longer descent
    let last = rooms[0], far = -1;
    for (const room of rooms) {
      const d = Math.abs(room.cx - rooms[0].cx) + Math.abs(room.cy - rooms[0].cy);
      if (d > far) { far = d; last = room; }
    }
    this.stairsPos = cellPos(last.cx, last.cy);
    this.stairsCell = { x: last.cx, y: last.cy };
    const stairs = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.5 - i * 0.28, 0.42, 1.5 - i * 0.28),
        makeToonMaterial({ color: 0x2a2038, rim: 0 })
      );
      // lift slightly so the top step's face doesn't sit coplanar with the
      // floor slab (y=0), which caused z-fighting on the descent
      step.position.y = -0.19 - i * 0.16;
      stairs.add(step);
    }
    stairs.position.copy(this.stairsPos);
    this.group.add(stairs);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.4 })
    );
    glow.position.copy(this.stairsPos).setY(0.05);
    this.group.add(glow);

    // --- torches: emissive crystals along room walls (no dynamic lights)
    for (const room of rooms) {
      if (r() < 0.7) {
        const p = cellPos(room.x, room.y);
        const crystal = new THREE.Mesh(
          new THREE.ConeGeometry(0.16, 0.55, 5),
          new THREE.MeshBasicMaterial({ color: pick(r, [0x9a6dff, 0x5dd0ff, 0xff9a5d]) })
        );
        crystal.position.set(p.x + CELL * 0.3, 0.3, p.z + CELL * 0.3);
        crystal.rotation.z = 0.3;
        this.group.add(crystal);
      }
    }

    // --- billboard set dressing: mushrooms, stones, dead trees & bones tucked
    // into the rooms (seeded off the same rng so co-op peers match). Skips the
    // entrance and stairs cells so nothing clutters the arrival/exit spots.
    scatterDungeonDecor(this.group, r, rooms, cellPos, {
      skip: [this.entranceCell, this.stairsCell],
    });

    // --- god-ray shafts: light leaking through cracks in the ceiling above.
    // Cool arcane glow over the entrance portal, warm dusk over the stairs,
    // and a couple of pale beams scattered through the deeper rooms.
    const addShaft = (pos, opts) => {
      const shaft = makeLightShaft(opts);
      shaft.position.set(pos.x, 3.4, pos.z);
      this.group.add(shaft);
      this.shafts.push(shaft);
    };
    addShaft(this.entrancePos, { color: 0x9a6dff, length: 4.6, topWidth: 0.6, bottomWidth: 2.6, opacity: 0.4, tilt: 0.28, spin: 0.4, motes: 14 });
    addShaft(this.stairsPos, { color: 0xff9a4d, length: 4.6, topWidth: 0.55, bottomWidth: 2.4, opacity: 0.34, tilt: 0.24, spin: 1.2, motes: 12 });
    for (const room of rooms.slice(1, -1)) {
      if (r() < 0.5) {
        const p = cellPos(room.cx, room.cy);
        addShaft(p, { color: pick(r, [0x8fb6ff, 0xb98cff, 0x6fd6c8]), length: 4.4, topWidth: 0.5, bottomWidth: 2.1, opacity: 0.24 + r() * 0.1, tilt: 0.18 + r() * 0.3, spin: r() * Math.PI, motes: 10 });
      }
    }

    // --- enemies (host decides; guests get them mirrored via net)
    if (!this.game.net.isGuest) {
      const tier = Math.min(floorN, 5) - 1;
      const mix = FLOOR_MIX[Math.min(tier, FLOOR_MIX.length - 1)];
      const n = 4 + floorN + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const room = rooms[1 + Math.floor(r() * (rooms.length - 1))];
        const kind = mix[Math.floor(r() * mix.length)];
        const px = room.x + r() * room.w;
        const py = room.y + r() * room.h;
        const p = cellPos(px - 0.5, py - 0.5);
        if (p.distanceTo(this.entrancePos) < 3) continue;
        // enemies live in world space (the scene root), not the group
        this.spawnEnemy(kind, Math.floor(r() * 1e6), tier, p.x + DUNGEON_ORIGIN.x, p.z + DUNGEON_ORIGIN.z);
      }
    }

    // --- chests
    const nChests = 1 + Math.floor(r() * 2);
    for (let i = 0; i < nChests; i++) {
      const room = rooms[Math.floor(r() * rooms.length)];
      const p = cellPos(room.x + Math.floor(r() * room.w), room.y + Math.floor(r() * room.h));
      if (p.distanceTo(this.entrancePos) < 2.5) continue;
      const chest = makeChest();
      chest.position.copy(p);
      chest.rotation.y = r() * Math.PI * 2;
      this.group.add(chest);
      this.chests.push({ mesh: chest, opened: false, id: i });
    }

    // --- the boss door key. It's hidden in one chest during the run: the boss
    // floor always guarantees one (so the arena is never un-openable), and
    // earlier floors give it a chance so it can turn up on the way down. The
    // choice is derived from the seed alone, so co-op peers agree on it.
    this.keyChestId = -1;
    const keyHere = isBoss || rng(seed + 900 + floorN * 17)() < 0.4;
    if (keyHere) {
      if (isBoss && this.chests.length === 0) {
        // extremely unlucky roll left the arena floor chest-less — force one
        const room = rooms[rooms.length - 1];
        const p = cellPos(room.cx, room.cy);
        const chest = makeChest();
        chest.position.copy(p);
        this.group.add(chest);
        this.chests.push({ mesh: chest, opened: false, id: 0 });
      }
      if (this.chests.length)
        this.keyChestId = this.chests[Math.floor(rng(seed + 123 + floorN * 7)() * this.chests.length)].id;
    }

    // --- boss arena furniture, gate and the boss itself (final floor only)
    if (isBoss) this._buildBossArena(seed, cellPos, BX, BY, BW, BH, gateX, gateY);
  }

  // Build the sealed arena: a moody slab, a dramatic red light shaft, the
  // portcullis gate (blocking colliders + a mesh that rises when unlocked),
  // the world-space bounds the camera locks onto, and the boss (host only).
  _buildBossArena(seed, cellPos, BX, BY, BW, BH, gateX, gateY) {
    const center = cellPos(BX + BW / 2 - 0.5, BY + BH / 2 - 0.5);

    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(BW * CELL, BH * CELL).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({ color: 0x3a2030 })
    );
    slab.position.set(center.x, 0.02, center.z);
    this.group.add(slab);

    const shaft = makeLightShaft({ color: 0xff3b3b, length: 5.2, topWidth: 0.85, bottomWidth: 3.6, opacity: 0.3, tilt: 0.1, spin: 0.7, motes: 18 });
    shaft.position.set(center.x, 3.6, center.z);
    this.group.add(shaft);
    this.shafts.push(shaft);

    // portcullis across the 2-wide doorway
    const gcolliders = [];
    for (const gx of [gateX, gateX + 1]) {
      const gp = cellPos(gx, gateY);
      const col = { x: gp.x + DUNGEON_ORIGIN.x, z: gp.z + DUNGEON_ORIGIN.z, hw: CELL / 2, hd: CELL / 2 };
      this.colliders.push(col);
      gcolliders.push(col);
    }
    const gc = cellPos(gateX + 0.5, gateY);
    const gateMesh = makeGate();
    gateMesh.position.set(gc.x, 0, gc.z);
    this.group.add(gateMesh);
    this.gate = { colliders: gcolliders, mesh: gateMesh, open: false, raiseT: -1 };
    this.gateOpen = false;
    this.gatePos = gc.clone();

    // world-space arena bounds (for the fixed camera) + its centre
    const bMin = cellPos(BX, BY), bMax = cellPos(BX + BW - 1, BY + BH - 1);
    this.bossRoom = {
      minX: bMin.x - CELL / 2 + DUNGEON_ORIGIN.x, maxX: bMax.x + CELL / 2 + DUNGEON_ORIGIN.x,
      minZ: bMin.z - CELL / 2 + DUNGEON_ORIGIN.z, maxZ: bMax.z + CELL / 2 + DUNGEON_ORIGIN.z,
    };
    this.bossCenter = new THREE.Vector3(center.x + DUNGEON_ORIGIN.x, 0, center.z + DUNGEON_ORIGIN.z);
    // the boss itself stays out of the world until the gate is unlocked —
    // the arena reads as an ominous empty room through the bars until then
  }

  /** Unlock the boss door: drop its colliders, start the gate rising, and wake
   * the boss (host authoritative; guests receive it mirrored via net). */
  openGate() {
    if (!this.gate || this.gate.open) return;
    this.gate.open = true;
    this.gateOpen = true;
    this.colliders = this.colliders.filter((c) => !this.gate.colliders.includes(c));
    this.gate.raiseT = 0;
    if (this.isBoss && !this.boss && !this.game.net.isGuest) {
      const e = this.spawnEnemy("boss", (this.seed % 100000) + 54321, MAX_FLOORS - 1, this.bossCenter.x, this.bossCenter.z);
      // a ground-shaking entrance the moment the seal breaks
      e.creature.animator.squash.kick(6);
      this.game.particles.burst(_v.copy(this.bossCenter).setY(0.2), { color: 0xff5a3a, n: 24, speed: 5, up: 2.4, life: 0.8, size: 1.3 });
    }
  }

  /** True when a world position sits inside the boss arena (camera lock test). */
  inBossRoom(pos) {
    const b = this.bossRoom;
    return !!b && pos.x >= b.minX && pos.x <= b.maxX && pos.z >= b.minZ && pos.z <= b.maxZ;
  }

  /** x/z are WORLD coordinates. */
  spawnEnemy(kind, seed, tier, x, z, id = null, hpOverride = null) {
    const def = ENEMY_KINDS[kind];
    const creature = new Creature(def.make(seed, tier));
    creature.position.set(x, 0, z);
    creature.heading = Math.random() * Math.PI * 2;
    this.game.engine.scene.add(creature);
    const maxHp = hpOverride ?? def.hp + Math.floor(tier * 0.7);
    const e = {
      id: id ?? this.game.net.newId(),
      kind, seed, tier,
      creature,
      hp: maxHp,
      maxHp,
      def,
      behavior: def.behavior ?? "swarm",
      state: "idle",
      t: Math.random() * 2,
      home: new THREE.Vector3(x, 0, z),
      attackCd: 1 + Math.random(),
      hitCd: 0,
      deadT: -1,
      // combat state machine
      atkState: "none", // none | windup | recover
      atkT: 0,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
      vx: 0, vz: 0, // impulse velocity (knockback + lunges)
      ringRadius: 1,
      telT: -1, // guest-side boss telegraph clock (host drives atkT instead)
    };
    // the boss is flagged here so guests mirroring it via eSnap also get the
    // reference (HP bar) and the flag (loot/fanfare on death)
    if (kind === "boss") {
      e.isBoss = true;
      this.boss = e;
    }
    this.enemies.push(e);
    return e;
  }

  /** x/z world; velocity vx/vz. Fired by ranged foes; mirrored to guests. */
  spawnProjectile(x, z, vx, vz, opts) {
    this.projectiles.spawn(x, z, vx, vz, opts);
    this.game.net.send({ t: "proj", x, z, vx, vz, color: opts.color, dmg: opts.dmg, radius: opts.radius, life: opts.life });
  }

  /** World x/z → fractional grid cell coords (for the minimap). */
  worldToCell(worldX, worldZ) {
    return {
      x: (worldX - DUNGEON_ORIGIN.x) / CELL + this.GW / 2 - 0.5,
      y: (worldZ - DUNGEON_ORIGIN.z) / CELL + this.GH / 2 - 0.5,
    };
  }

  /** Reveal minimap cells around a world position: nearby corridor cells plus
   * any whole room the point sits inside. Bumps revealVersion when new ground
   * is uncovered so the minimap knows to rebuild its cached layer. */
  reveal(worldX, worldZ, radius = 2.2) {
    if (!this.discovered) return;
    const c = this.worldToCell(worldX, worldZ);
    let changed = false;
    const R = Math.ceil(radius);
    const cx = Math.round(c.x), cy = Math.round(c.y);
    for (let y = cy - R; y <= cy + R; y++)
      for (let x = cx - R; x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= this.GW || y >= this.GH) continue;
        if (!this.open[y][x] || this.discovered[y][x]) continue;
        const dx = x - c.x, dy = y - c.y;
        if (dx * dx + dy * dy <= radius * radius) { this.discovered[y][x] = true; changed = true; }
      }
    for (const rm of this.rooms) {
      if (c.x < rm.x - 0.5 || c.x >= rm.x + rm.w + 0.5 || c.y < rm.y - 0.5 || c.y >= rm.y + rm.h + 0.5) continue;
      for (let y = rm.y; y < rm.y + rm.h; y++)
        for (let x = rm.x; x < rm.x + rm.w; x++)
          if (this.open[y][x] && !this.discovered[y][x]) { this.discovered[y][x] = true; changed = true; }
    }
    if (changed) this.revealVersion++;
  }

  // ---------------------------------------------------------------- update
  update(dt, elapsed) {
    if (!this.active) return;

    // keep the wall-occlusion shader fed with the camera + player torso so
    // walls between them dither away instead of hiding the hero
    const shader = this._wallMat?.userData.shader;
    if (shader) {
      shader.uniforms.uPlayer.value.copy(this.game.player.position).setY(this.game.player.height * 0.6);
      shader.uniforms.uCamPos.value.copy(this.game.engine.camera.position);
    }

    for (const s of this.shafts) s.userData.update(dt, elapsed);

    // the boss gate slides up out of sight once it's been unlocked
    if (this.gate && this.gate.raiseT >= 0) {
      this.gate.raiseT += dt;
      const k = Math.min(1, this.gate.raiseT / 0.8);
      this.gate.mesh.position.y = k * 2.0;
      if (k >= 1) { this.gate.mesh.visible = false; this.gate.raiseT = -1; }
    }

    for (const drop of this.drops) {
      drop.mesh.position.y = 0.35 + Math.sin(elapsed * 3 + drop.phase) * 0.09;
    }

    const players = this.game.playersInDungeon();
    for (const e of [...this.enemies]) {
      if (this.game.net.isGuest) {
        e.creature.update(dt, elapsed); // guest: positions come from the host
        // replay the host's boss telegraph locally (ground FX + HUD countdown)
        if (e.telT >= 0) {
          e.telT += dt;
          if (e.telT >= e.telDur) { e.telT = -1; e.creature.setGlow(null); }
          else this._bossTelegraphFx(e, e.telT / e.telDur, dt);
        }
        continue;
      }
      this._updateEnemy(e, dt, elapsed, players);
      this._contactDamage(e, dt, players);
    }

    // projectiles: move everywhere (visuals); the host resolves player hits
    this.projectiles.update(dt, elapsed);
    if (!this.game.net.isGuest) this._resolveProjectiles(players);
  }

  // touching an enemy's body hurts, attacking or not — a slime that drifts
  // into you should still sting. The player's i-frames gate the actual damage;
  // a per-enemy cooldown keeps the net traffic (remote player) sane.
  _contactDamage(e, dt, players) {
    if (e.deadT >= 0) return;
    e.contactCd = (e.contactCd ?? 0) - dt;
    if (e.contactCd > 0) return;
    const c = e.creature;
    for (const p of players) {
      const pc = p.creature;
      const touch = c.radius + pc.radius + 0.05;
      const dx = pc.position.x - c.position.x;
      const dz = pc.position.z - c.position.z;
      if (dx * dx + dz * dz <= touch * touch) {
        this.game.enemyHitsPlayer(e, p);
        e.contactCd = 0.6;
        break;
      }
    }
  }

  _nearestPlayer(c, players) {
    let target = null, bd = 1e9;
    for (const p of players) {
      const d = c.position.distanceTo(p.creature.position);
      if (d < bd) { bd = d; target = p; }
    }
    return target;
  }

  _updateEnemy(e, dt, elapsed, players) {
    const c = e.creature;
    if (e.deadT >= 0) {
      e.deadT += dt;
      c.update(dt, elapsed);
      if (e.deadT > 1.4) {
        c.position.y -= dt * 1.2; // sink away
        if (e.deadT > 2.2) this._removeEnemy(e);
      }
      return;
    }
    e.t += dt;
    e.attackCd -= dt;

    // apply + decay impulse velocity (knockback + lunge dashes) every frame
    const fr = Math.pow(IMP_DECAY, dt);
    c.position.x += e.vx * dt;
    c.position.z += e.vz * dt;
    e.vx *= fr;
    e.vz *= fr;

    // a lunging foe (slime) only lands its blow once the leap actually reaches a
    // player — checked each frame during the dash rather than up front, so a
    // pounce that falls short or misses deals nothing.
    if (e.lungeHitT > 0) {
      e.lungeHitT -= dt;
      if (this._meleeStrikeHit(e, players, 0.3)) e.lungeHitT = 0;
    }

    const target = this._nearestPlayer(c, players);
    const bd = target ? c.position.distanceTo(target.creature.position) : 1e9;
    const def = e.def;
    const speed = def.speed * (1 + e.tier * 0.08) * (e.enraged ? 1.35 : 1);

    // -------- attack state machine (takes priority over locomotion) --------
    if (e.atkState === "windup") {
      e.atkT += dt;
      if (e.behavior === "boss") this._bossTelegraphFx(e, e.atkT / e.windupDur, dt);
      if (target) c.heading = Math.atan2(target.creature.position.x - c.position.x, target.creature.position.z - c.position.z);
      // melee foes lunge along their committed direction during the windup so
      // the blow lands on contact — they visibly charge in and collide instead
      // of swiping from a gap. Direction is locked at windup start so a dodge
      // still beats it (they charge past where you were).
      if (e.isCharge && target) {
        const contact = c.radius + target.creature.radius;
        const cd = c.position.distanceTo(target.creature.position);
        if (cd > contact) {
          const step = Math.min(speed * 1.9 * dt, cd - contact);
          c.position.x += e.chargeX * step;
          c.position.z += e.chargeZ * step;
        }
      }
      if (e.atkT >= e.windupDur) {
        this._enemyStrike(e, target, players);
        e.atkState = "recover";
        e.atkT = 0;
        c.setGlow(null);
      }
      this._finishFrame(e, dt, elapsed);
      return;
    }
    if (e.atkState === "recover") {
      e.atkT += dt;
      if (e.atkT >= e.recoverDur) e.atkState = "none";
      this._finishFrame(e, dt, elapsed);
      return;
    }

    // -------- aggro + locomotion --------
    if (target && bd < def.aggro) e.state = "chase";
    else if (e.state === "chase") e.state = "idle";

    if (e.state === "chase" && target) this._chase(e, target, bd, speed, dt);
    else this._wander(e, speed, dt);

    this._finishFrame(e, dt, elapsed);
  }

  // separation + wall collision + creature tick + net track, shared by every path
  _finishFrame(e, dt, elapsed) {
    this._separate(e);
    this.game.collide(e.creature.position, e.creature.radius, this.colliders);
    e.creature.update(dt, elapsed);
    this.game.net.trackEnemy(e);
  }

  _chase(e, target, dist, speed, dt) {
    const c = e.creature;
    const tp = target.creature.position;
    _d.set(tp.x - c.position.x, 0, tp.z - c.position.z);
    _d.y = 0;
    _d.normalize();
    const face = Math.atan2(_d.x, _d.z);
    const strike = c.radius + target.creature.radius + (e.def.reach ?? 1);
    const ready = e.attackCd <= 0;

    switch (e.behavior) {
      case "swarm": {
        // erratic weave so a swarm doesn't march in a straight line
        const weave = Math.sin(e.t * 7 + e.seed) * 0.55;
        _p.set(-_d.z, 0, _d.x).multiplyScalar(weave);
        _d.add(_p).normalize();
        c.heading = Math.atan2(_d.x, _d.z);
        if (dist > strike) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "strafe": {
        c.heading = face;
        const ring = strike + 0.7;
        if (dist > ring + 0.4) c.position.addScaledVector(_d, speed * dt);
        else if (dist < ring - 0.5) c.position.addScaledVector(_d, -speed * 0.7 * dt);
        else {
          _p.set(-_d.z, 0, _d.x).multiplyScalar(e.strafeDir);
          c.position.addScaledVector(_p, speed * 0.85 * dt);
          if (Math.random() < 0.012) e.strafeDir *= -1;
        }
        if (dist <= strike + 0.5 && ready) this._beginWindup(e, target);
        break;
      }
      case "lunge": {
        c.heading = face;
        const range = c.radius + target.creature.radius + 3.4;
        if (dist > range) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "slam": {
        c.heading = face;
        if (dist > strike - 0.4) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "boss": {
        // pattern rotation: slam when the player is in reach; at range, swap
        // between a room-crossing charge and a radial orb burst so kiting and
        // hugging the boss demand different dodges
        c.heading = face;
        if (ready) {
          if (dist <= strike + 0.5) e.bossAttack = "slam";
          else {
            e.bossAttack = e.bossPrev === "charge" ? "burst" : "charge";
            e.bossPrev = e.bossAttack;
          }
          this._beginWindup(e, target);
        } else if (dist > strike - 0.6) c.position.addScaledVector(_d, speed * dt);
        break;
      }
      case "caster":
      case "archer": {
        c.heading = face;
        const [near, far] = e.def.band;
        if (dist < near) c.position.addScaledVector(_d, -speed * dt);
        else if (dist > far) c.position.addScaledVector(_d, speed * dt);
        else {
          _p.set(-_d.z, 0, _d.x).multiplyScalar(e.strafeDir);
          c.position.addScaledVector(_p, speed * 0.5 * dt);
          if (Math.random() < 0.009) e.strafeDir *= -1;
          if (ready) this._beginWindup(e, target);
        }
        break;
      }
      default: {
        c.heading = face;
        if (dist > strike) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
      }
    }
  }

  _wander(e, speed, dt) {
    const c = e.creature;
    if (e.t > 2.5) {
      e.t = 0;
      e.wanderTarget = e.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
    }
    if (e.wanderTarget) {
      _d.set(e.wanderTarget.x - c.position.x, 0, e.wanderTarget.z - c.position.z);
      if (_d.length() > 0.3) {
        _d.normalize();
        c.heading = Math.atan2(_d.x, _d.z);
        c.position.addScaledVector(_d, speed * 0.35 * dt);
      }
    }
  }

  // push apart from other living enemies so a mob doesn't collapse into one blob
  _separate(e) {
    const c = e.creature;
    for (const o of this.enemies) {
      if (o === e || o.deadT >= 0) continue;
      const oc = o.creature;
      const dx = c.position.x - oc.position.x;
      const dz = c.position.z - oc.position.z;
      const min = c.radius + oc.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        c.position.x += (dx / d) * push;
        c.position.z += (dz / d) * push;
      }
    }
  }

  // Ground sparks that trace where the boss's next attack will land, emitted
  // every few frames through the windup: a red ring on the slam's full reach,
  // an orange lane down the charge path, and a purple ripple swelling out to
  // where the burst orbs will fly. frac is windup progress, 0 → 1.
  _bossTelegraphFx(e, frac, dt) {
    e.telFxT = (e.telFxT ?? 0) - dt;
    if (e.telFxT > 0) return;
    e.telFxT = 0.07;
    const c = e.creature;
    const P = this.game.particles;
    const atk = e.bossAttack ?? "slam";
    if (atk === "charge") {
      for (let i = 1; i <= 9; i++) {
        _v.set(c.position.x + e.chargeX * i * 1.1, 0.08, c.position.z + e.chargeZ * i * 1.1);
        P.burst(_v, { color: 0xffb25a, n: 1, speed: 0.3, up: 0.6, gravity: 0, life: 0.28, size: 0.8 });
      }
    } else if (atk === "burst") {
      P.ring(_v.copy(c.position).setY(0.08), c.radius + 0.4 + frac * 2.6, { color: 0xb06cff, n: 16, life: 0.3, size: 0.85 });
    } else {
      P.ring(_v.copy(c.position).setY(0.08), e.ringRadius + 0.25, { color: 0xff5a3a, n: 18, life: 0.3, size: 0.9 });
    }
  }

  // begin a telegraphed attack: crouch, glow, warn the ear
  _beginWindup(e, target) {
    const c = e.creature;
    const def = e.def;
    e.atkState = "windup";
    e.atkT = 0;
    e.windupDur = def.windup;
    e.recoverDur = 0.32 + def.windup * 0.35;
    e.attackCd = 1.3 + Math.random() * 0.7;
    c.animator.squash.kick(-2.5); // anticipation dip
    c.setGlow(def.glow ?? [0.6, 0.2, 0.1]);
    // ranged foes telegraph with the body glow only; melee reaches farther
    const ranged = e.behavior === "caster" || e.behavior === "archer";
    // lock a charge direction for melee foes (lunge has its own dash on strike)
    e.isCharge = !ranged && e.behavior !== "lunge";
    if (e.isCharge && target) {
      _p.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z).normalize();
      e.chargeX = _p.x;
      e.chargeZ = _p.z;
    }
    e.ringRadius = ranged ? 0 : e.behavior === "slam"
      ? def.reach + c.radius
      : (def.reach ?? 1) + c.radius + (target ? target.creature.radius : 0.34);
    // the boss telegraphs each pattern differently: its own windup length and
    // a distinct glow colour per attack, all faster once enraged
    if (e.behavior === "boss") {
      const atk = e.bossAttack ?? "slam";
      // longer windups + a fat gap between attacks so each pattern reads as
      // its own beat: telegraph, dodge, punish, breathe
      e.windupDur = (atk === "charge" ? 1.1 : atk === "burst" ? 0.85 : def.windup + 0.25) * (e.enraged ? 0.8 : 1);
      e.attackCd = 2.8 + Math.random() * 0.9;
      if (e.enraged) e.attackCd *= 0.75;
      e.recoverDur = 0.85;
      e.isCharge = false; // patterns move on strike, not during the windup
      e.ringRadius = atk === "slam" ? def.reach + c.radius : 0;
      c.setGlow(atk === "charge" ? [0.9, 0.45, 0.05] : atk === "burst" ? [0.55, 0.15, 0.8] : def.glow);
      // guests mirror the telegraph (HUD countdown + ground FX) from this
      this.game.net.send({ t: "bossTel", id: e.id, atk, dur: e.windupDur, r: e.ringRadius, dx: e.chargeX ?? 0, dz: e.chargeZ ?? 0 });
    }
    this.game.audio.telegraph();
  }

  // resolve a telegraphed attack the moment it lands — only hits players still
  // in range, so dodging or backing out beats it cleanly.
  _enemyStrike(e, target, players) {
    const c = e.creature;
    const def = e.def;
    const game = this.game;
    c.attack();
    c.animator.squash.kick(4);

    switch (e.behavior) {
      case "caster":
      case "archer": {
        if (!target) break;
        _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z);
        _d.y = 0;
        _d.normalize();
        const sp = def.projSpeed;
        const y = Math.max(0.5, c.height * 0.6);
        const ox = c.position.x + _d.x * (c.radius + 0.2);
        const oz = c.position.z + _d.z * (c.radius + 0.2);
        this.spawnProjectile(ox, oz, _d.x * sp, _d.z * sp, { color: def.projColor, dmg: def.dmg, radius: 0.28, life: 3.0, y });
        // deeper casters throw a 3-orb fan
        if (e.behavior === "caster" && e.tier >= 2) {
          for (const off of [-0.32, 0.32]) {
            const dx = _d.x * Math.cos(off) - _d.z * Math.sin(off);
            const dz = _d.x * Math.sin(off) + _d.z * Math.cos(off);
            this.spawnProjectile(c.position.x + dx * (c.radius + 0.2), c.position.z + dz * (c.radius + 0.2), dx * sp, dz * sp, { color: def.projColor, dmg: def.dmg, radius: 0.24, life: 3.0, y });
          }
        }
        game.audio.shoot();
        break;
      }
      case "lunge": {
        if (target) {
          _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z);
          _d.y = 0;
          const dist = _d.length();
          _d.normalize();
          // leap just past where the target stands so the pounce actually reaches
          // them; damage is dealt on contact during the dash (see _updateEnemy),
          // not instantly from a gap — dodging sideways makes it whiff.
          const leap = (dist + 0.3) * LEAP_K;
          e.vx = _d.x * leap;
          e.vz = _d.z * leap;
          c.animator.squash.kick(6);
          e.lungeHitT = 0.5; // window the dash can connect its blow
        }
        game.audio.hit();
        break;
      }
      case "slam": {
        const r = e.ringRadius + 0.25;
        for (const p of players) {
          if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
        }
        game.engine.shake(0.18);
        game.audio.kill();
        game.particles.burst(_v.copy(c.position).setY(0.1), { color: 0xff8a5a, n: 16, speed: 4.2, up: 1.6, life: 0.5, size: 1.1 });
        break;
      }
      case "boss": {
        const atk = e.bossAttack ?? "slam";
        if (atk === "burst") {
          // radial ring of slow orbs — weave between them or roll through
          const n = e.enraged ? 12 : 8;
          const y = Math.max(0.5, c.height * 0.45);
          const sp = def.projSpeed;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + c.heading;
            const dx = Math.sin(a), dz = Math.cos(a);
            this.spawnProjectile(c.position.x + dx * (c.radius + 0.3), c.position.z + dz * (c.radius + 0.3), dx * sp, dz * sp, { color: def.projColor, dmg: 1, radius: 0.3, life: 2.6, y });
          }
          game.audio.shoot();
          game.engine.shake(0.12);
        } else if (atk === "charge") {
          // hurl itself down the lane locked (and telegraphed) at windup start;
          // damage lands on contact during the dash (lungeHitT), so stepping
          // out of the marked lane makes it barrel past
          if (target) {
            const dist = c.position.distanceTo(target.creature.position);
            const leap = (dist + 1.6) * LEAP_K;
            e.vx = e.chargeX * leap;
            e.vz = e.chargeZ * leap;
            c.animator.squash.kick(6);
            e.lungeHitT = 0.6;
          }
          game.audio.hit();
          game.engine.shake(0.15);
        } else {
          // the wide arena-shaking slam (same shape as the brute's, but bigger)
          const r = e.ringRadius + 0.25;
          for (const p of players) {
            if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
          }
          game.engine.shake(0.24);
          game.audio.kill();
          game.particles.burst(_v.copy(c.position).setY(0.1), { color: 0xff5a3a, n: 22, speed: 5, up: 1.8, life: 0.55, size: 1.25 });
        }
        break;
      }
      default: { // swarm, strafe: a quick directional swipe
        this._meleeStrikeHit(e, players, (def.reach ?? 1) + 0.35);
        game.audio.swing();
      }
    }
  }

  // hit the first player inside the swing's reach + rough frontal arc
  _meleeStrikeHit(e, players, extra) {
    const c = e.creature;
    for (const p of players) {
      const pc = p.creature;
      const dx = pc.position.x - c.position.x;
      const dz = pc.position.z - c.position.z;
      const d = Math.hypot(dx, dz);
      const range = c.radius + pc.radius + extra;
      if (d > range) continue;
      const dot = (dx * Math.sin(c.heading) + dz * Math.cos(c.heading)) / (d || 1);
      if (dot > -0.15) {
        this.game.enemyHitsPlayer(e, p);
        return true;
      }
    }
    return false;
  }

  _resolveProjectiles(players) {
    for (const proj of this.projectiles.list) {
      if (proj.dead) continue;
      if (this._projHitsWall(proj)) { this._projBurst(proj); continue; }
      for (const p of players) {
        const pc = p.creature;
        const dx = proj.x - pc.position.x;
        const dz = proj.z - pc.position.z;
        const rr = proj.radius + pc.radius;
        if (dx * dx + dz * dz <= rr * rr) {
          this.game.enemyProjectileHitsPlayer(proj, p);
          this._projBurst(proj);
          break;
        }
      }
    }
  }

  _projHitsWall(proj) {
    for (const col of this.colliders) {
      if (Math.abs(proj.x - col.x) < col.hw && Math.abs(proj.z - col.z) < col.hd) return true;
    }
    return false;
  }

  _projBurst(proj) {
    this.game.particles.burst(_v.set(proj.x, proj.y, proj.z), { color: proj.color ?? 0xb98cff, n: 8, speed: 3, life: 0.4 });
    this.game.audio.projHit();
    this.projectiles.remove(proj);
  }

  /** Player attack hits: arc in front of attacker. Returns whether anything was hit. */
  meleeHit(attacker, dmg, game, opts = {}) {
    const { range = 1.75, arc = 0.35, crit = false, finisher = false, knock = 1 } = opts;
    const pos = attacker.position;
    const fwdX = Math.sin(attacker.heading);
    const fwdZ = Math.cos(attacker.heading);
    let hitAny = false;
    for (const e of this.enemies) {
      if (e.deadT >= 0 || e.hitCd > 0) continue;
      const c = e.creature;
      const dx = c.position.x - pos.x;
      const dz = c.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + c.radius) continue;
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < arc && dist > 0.7) continue;
      hitAny = true;
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      if (game.net.isGuest) {
        // local juice now; the host applies damage and echoes eHurt/eDie
        e.creature.hurt();
        game.audio.hit();
        game.engine.hitStop(0.05);
        game.net.send({ t: "hit", id: e.id, dmg, kx: nx, kz: nz });
      } else {
        this.damageEnemy(e, dmg, nx, nz, { crit, finisher, knock });
      }
    }
    return hitAny;
  }

  damageEnemy(e, dmg, kx = 0, kz = 0, opts = {}) {
    if (e.deadT >= 0) return;
    const game = this.game;
    const { crit = false, finisher = false, knock = 1 } = opts;
    e.hp -= dmg;
    e.hitCd = 0.12;
    setTimeout(() => (e.hitCd = 0), 130);
    const c = e.creature;
    c.hurt();
    // knockback as a decaying impulse — weightier than the old teleport nudge
    const kAmt = (finisher ? 9 : crit ? 6 : 4) * knock;
    e.vx += kx * kAmt;
    e.vz += kz * kAmt;
    // a crit or finisher staggers a winding-up enemy, cancelling its attack —
    // except the boss, which shrugs it off so it can't be stun-locked
    if ((crit || finisher) && e.atkState === "windup" && !e.isBoss) {
      e.atkState = "recover";
      e.atkT = 0;
      c.setGlow(null);
    }
    // half-health boss flips to its enraged phase: faster, harsher patterns,
    // and it calls a pack of minions into the arena
    if (e.isBoss && !e.enraged && e.hp > 0 && e.hp <= e.maxHp / 2) this._enrageBoss(e);
    game.hud.float(_v.copy(c.position).setY(c.height + 0.3), crit ? `${dmg}!` : `${dmg}`, crit ? "dmg crit" : "dmg");
    game.particles.burst(_v.copy(c.position).setY(c.height * 0.6), { color: crit ? 0xfff1a8 : 0xffe08a, n: crit ? 12 : 6, speed: crit ? 3.6 : 2.5, life: 0.4 });
    if (crit) game.audio.crit();
    else game.audio.hit();
    game.engine.hitStop(finisher ? 0.11 : crit ? 0.08 : 0.05);
    if (e.hp <= 0) this.killEnemy(e, kx, kz);
    else game.net.send({ t: "eHurt", id: e.id, hp: e.hp });
  }

  // Boss phase two (host only — runs inside damageEnemy): summon a minion pack
  // around the arena and let the enraged flags speed everything up.
  _enrageBoss(e) {
    e.enraged = true;
    const game = this.game;
    const bp = e.creature.position;
    const r = rng(e.seed + 606);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r();
      this.spawnEnemy(pick(r, ["skitter", "skitter", "slime"]), Math.floor(r() * 1e6), 1, bp.x + Math.sin(a) * 2.6, bp.z + Math.cos(a) * 2.6);
    }
    game.particles.burst(_v.copy(bp).setY(e.creature.height * 0.5), { color: 0xff3b3b, n: 26, speed: 5.5, up: 2, life: 0.8, size: 1.3 });
    game.engine.shake(0.3);
    game.audio.telegraph();
    game.onBossEnraged?.();
  }

  killEnemy(e, kx, kz) {
    const game = this.game;
    e.deadT = 0;
    e.creature.setGlow(null);
    e.creature.die(_v.set(kx * 8, -3, kz * 8));
    game.audio.kill();
    game.engine.shake(0.15);
    game.net.send({ t: "eDie", id: e.id, kx, kz });
    if (game.net.isGuest) return;
    if (game.today) game.today.slain++;
    // the boss goes out with a bang: a treasure spill and a victory flourish
    if (e.isBoss) {
      this.boss = null;
      game.onBossDefeated?.(e.creature.position);
      const bx = e.creature.position.x, bz = e.creature.position.z;
      const rl = rng(e.seed + 5);
      // a guaranteed crown, a healing potion, and a fistful of top-tier spoils
      const spoils = ["crown", "potion", pick(rl, LOOT_BY_TIER[4]), pick(rl, LOOT_BY_TIER[4]), pick(rl, LOOT_BY_TIER[4]), pick(rl, LOOT_BY_TIER[3])];
      spoils.forEach((id, i) => {
        const a = (i / spoils.length) * Math.PI * 2;
        this.spawnDrop(id, bx + Math.sin(a) * 1.2, bz + Math.cos(a) * 1.2);
      });
      return;
    }
    // loot: enemies only drop merchandise — gold comes solely from selling it
    const r = rng(e.seed + 99);
    if (r() < 0.6) {
      const tier = clamp(e.tier + 1 + (r() < 0.2 ? 1 : 0), 1, 4);
      this.spawnDrop(pick(r, LOOT_BY_TIER[tier]), e.creature.position.x, e.creature.position.z);
    }
  }

  /** x/z are WORLD coordinates. */
  spawnDrop(itemId, x, z, id = null) {
    const mesh = itemSprite(itemId);
    mesh.position.set(x + (Math.random() - 0.5) * 0.6, 0.35, z + (Math.random() - 0.5) * 0.6);
    mesh.scale.setScalar(1.35);
    const shadow = makeBlobShadow(0.3);
    shadow.position.set(0, -mesh.position.y + 0.02, 0);
    mesh.add(shadow);
    this.game.engine.scene.add(mesh);
    const drop = { id: id ?? this.game.net.newId(), item: itemId, mesh, phase: Math.random() * 9 };
    this.drops.push(drop);
    this.game.net.send({ t: "drop", id: drop.id, item: itemId, x, z });
    return drop;
  }

  takeDrop(drop) {
    drop.mesh.removeFromParent();
    this.drops = this.drops.filter((d) => d !== drop);
  }

  openChest(chest) {
    if (chest.opened) return null;
    chest.opened = true;
    chest.mesh.children[1].rotation.x = -1.9; // lid flips open
    const r = rng(this.seed + chest.id * 313);
    const tier = clamp(Math.min(this.floor, 4), 1, 4);
    const cx = chest.mesh.position.x + DUNGEON_ORIGIN.x; // chest is group-local
    const cz = chest.mesh.position.z + DUNGEON_ORIGIN.z;
    // the designated key chest guarantees a Brass Key drop — a normal bag item
    // that doubles as the boss door key (see game._openGate). Also pays out a
    // little ordinary loot alongside it, like any other chest.
    if (chest.id === this.keyChestId) {
      this.spawnDrop("key", cx, cz + 0.8);
      this.spawnDrop(pick(r, LOOT_BY_TIER[Math.max(tier - 1, 1)]), cx + 0.7, cz);
      return "key";
    }
    const item = pick(r, LOOT_BY_TIER[tier]);
    this.spawnDrop(item, cx, cz + 0.8);
    if (r() < 0.6) this.spawnDrop(pick(r, LOOT_BY_TIER[Math.max(tier - 1, 1)]), cx + 0.7, cz);
    return item;
  }

  _removeEnemy(e) {
    e.creature.dispose();
    this.enemies = this.enemies.filter((x) => x !== e);
    this.game.net.send({ t: "eDel", id: e.id });
  }

  dispose() {
    for (const e of this.enemies) {
      e.creature.dispose();
    }
    this.enemies = [];
    this.projectiles.clear();
    for (const d of this.drops) d.mesh.removeFromParent();
    this.drops = [];
    this.chests = [];
    for (const s of this.shafts) s.userData.dispose();
    this.shafts = [];
    this.colliders = [];
    disposeDecor(this.group); // free the billboard scenery's sprite materials
    this.group.clear();
    this.active = false;
    this.group.visible = false;
    // boss/arena state is torn down with the floor
    this.gate = null;
    this.gateOpen = false;
    this.gatePos = null;
    this.bossRoom = null;
    this.bossCenter = null;
    this.boss = null;
    this.keyChestId = -1;
    this.isBoss = false;
  }
}

const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

function makeChest() {
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
function makeGate() {
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
function makeFloorGeometry(open, GW, GH, cellPos) {
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

function makeTilesTexture(palette, seed) {
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
