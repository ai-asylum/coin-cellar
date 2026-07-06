// The dungeon under the shop. Seeded procedural floors (rooms + L-shaped
// corridors on a grid), instanced walls, chests, a stairway down and a
// portal home. Enemies come out of the same blob-bake pipeline as the
// customers upstairs — skitters, slimes, goblins, wisps, brutes.
import * as THREE from "three";
import { makeToonMaterial, makeBlobShadow } from "../core/toon.js";
import { Creature } from "../chargen/creature.js";
import { goblinSpec, bruteSpec, skitterSpec, slimeSpec, wispSpec } from "../chargen/species.js";
import { ITEMS, LOOT_BY_TIER, itemMesh } from "./items.js";
import { rng, pick, clamp, lerp } from "../core/engine.js";

export const DUNGEON_ORIGIN = new THREE.Vector3(200, 0, 0);
const CELL = 2.4;

const ENEMY_KINDS = {
  skitter: {
    make: (seed, tier) => {
      const legsN = pick(rng(seed), [4, 6]);
      // legsN MUST be part of the cache key — bone counts differ
      return skitterSpec({ key: `e_sk${tier}_${legsN}_${seed % 5}`, seed, legsN, scale: 0.62 + tier * 0.05, hue: 0.78 - tier * 0.13 });
    },
    hp: 2, dmg: 1, speed: 2.6, aggro: 6, gold: [3, 8],
  },
  slime: {
    make: (seed, tier) => slimeSpec({ key: `e_sl${tier}_${seed % 5}`, scale: 0.6 + tier * 0.07, hue: (0.36 + (seed % 5) * 0.13) % 1 }),
    hp: 3, dmg: 1, speed: 2.1, aggro: 5.5, gold: [4, 10],
  },
  goblin: {
    make: (seed, tier) => goblinSpec(seed % 7, Math.min(tier, 2)),
    hp: 4, dmg: 1, speed: 2.9, aggro: 7, gold: [8, 16],
  },
  wisp: {
    make: (seed, tier) => wispSpec({ key: `e_wi${tier}_${seed % 4}`, scale: 0.6, hue: (0.55 + (seed % 4) * 0.11) % 1 }),
    hp: 2, dmg: 1, speed: 3.3, aggro: 8, gold: [6, 12],
  },
  brute: {
    make: (seed, tier) => bruteSpec(seed % 5, Math.min(tier, 2)),
    hp: 9, dmg: 2, speed: 1.7, aggro: 6.5, gold: [25, 45],
  },
};
const FLOOR_MIX = [
  ["skitter", "slime"],
  ["skitter", "slime", "goblin"],
  ["slime", "goblin", "wisp"],
  ["goblin", "wisp", "brute"],
  ["goblin", "wisp", "brute"],
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
    this.colliders = [];
    this._wallMesh = null;
    this._floorMesh = null;
  }

  /** Build floor n from a seed (deterministic — co-op peers share the seed). */
  generate(floorN, seed) {
    this.dispose();
    this.floor = floorN;
    this.seed = seed;
    this.active = true;
    this.group.visible = true;
    const r = rng(seed + floorN * 7717);

    // --- grid: rooms + corridors
    const GW = 15, GH = 13;
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    const rooms = [];
    const nRooms = 4 + Math.min(3, Math.floor(floorN / 2)) + Math.floor(r() * 2);
    for (let i = 0; i < nRooms; i++) {
      const w = 3 + Math.floor(r() * 3);
      const h = 2 + Math.floor(r() * 3);
      const x = 1 + Math.floor(r() * (GW - w - 2));
      const y = 1 + Math.floor(r() * (GH - h - 2));
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) open[yy][xx] = true;
    }
    for (let i = 1; i < rooms.length; i++) {
      // L corridor from previous room
      const a = rooms[i - 1], b = rooms[i];
      const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx);
      for (let x = x0; x <= x1; x++) open[a.cy][x] = true;
      const y0 = Math.min(a.cy, b.cy), y1 = Math.max(a.cy, b.cy);
      for (let y = y0; y <= y1; y++) open[y][b.cx] = true;
    }
    this.open = open;
    this.GW = GW;
    this.GH = GH;

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
    this._floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(GW * CELL, GH * CELL).rotateX(-Math.PI / 2),
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
    const wallMat = makeToonMaterial({ color: new THREE.Color(palette[1]).multiplyScalar(0.55).getHex(), rim: 0 });
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

    // --- entrance portal (room 0) & stairs down (last room)
    this.entrancePos = cellPos(rooms[0].cx, rooms[0].cy);
    const portal = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7a4dff, transparent: true, opacity: 0.55 })
    );
    portal.position.copy(this.entrancePos).setY(0.03);
    this.group.add(portal);
    this.portal = portal;

    const last = rooms[rooms.length - 1];
    this.stairsPos = cellPos(last.cx, last.cy);
    const stairs = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.5 - i * 0.28, 0.42, 1.5 - i * 0.28),
        makeToonMaterial({ color: 0x2a2038, rim: 0 })
      );
      step.position.y = -0.21 - i * 0.16;
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
  }

  /** x/z are WORLD coordinates. */
  spawnEnemy(kind, seed, tier, x, z, id = null, hpOverride = null) {
    const def = ENEMY_KINDS[kind];
    const creature = new Creature(def.make(seed, tier));
    creature.position.set(x, 0, z);
    creature.heading = Math.random() * Math.PI * 2;
    this.game.engine.scene.add(creature);
    const e = {
      id: id ?? this.game.net.newId(),
      kind, seed, tier,
      creature,
      hp: hpOverride ?? def.hp + Math.floor(tier * 0.7),
      maxHp: def.hp + Math.floor(tier * 0.7),
      def,
      state: "idle",
      t: Math.random() * 2,
      home: new THREE.Vector3(x, 0, z),
      attackCd: 0,
      hitCd: 0,
      deadT: -1,
    };
    this.enemies.push(e);
    return e;
  }

  // ---------------------------------------------------------------- update
  update(dt, elapsed) {
    if (!this.active) return;
    this.portal.material.opacity = 0.4 + Math.sin(elapsed * 3) * 0.15;

    for (const drop of this.drops) {
      drop.mesh.rotation.y += dt * 2.5;
      drop.mesh.position.y = 0.35 + Math.sin(elapsed * 3 + drop.phase) * 0.09;
    }

    const players = this.game.playersInDungeon();
    for (const e of [...this.enemies]) {
      if (this.game.net.isGuest) {
        e.creature.update(dt, elapsed); // guest: positions come from the host
        continue;
      }
      this._updateEnemy(e, dt, elapsed, players);
    }
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

    // nearest player
    let target = null, bd = 1e9;
    for (const p of players) {
      const d = c.position.distanceTo(p.creature.position);
      if (d < bd) {
        bd = d;
        target = p;
      }
    }

    const speed = e.def.speed * (1 + e.tier * 0.08);
    if (target && bd < e.def.aggro) e.state = "chase";
    else if (e.state === "chase") e.state = "idle";

    if (e.state === "chase" && target) {
      const tp = target.creature.position;
      _d.set(tp.x - c.position.x, 0, tp.z - c.position.z);
      const dist = _d.length();
      _d.normalize();
      c.heading = Math.atan2(_d.x, _d.z);
      const reach = c.radius + target.creature.radius + 0.25;
      if (dist > reach) {
        c.position.addScaledVector(_d, speed * dt);
      } else if (e.attackCd <= 0) {
        e.attackCd = 1.1 + Math.random() * 0.5;
        c.attack();
        c.animator.squash.kick(3);
        this.game.enemyHitsPlayer(e, target);
      }
    } else {
      // lazy wander around home
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

    // wall collision (world coords)
    this.game.collide(c.position, c.radius, this.colliders);
    c.update(dt, elapsed);
    this.game.net.trackEnemy(e);
  }

  /** Player attack hits: arc in front of attacker. Returns kills. */
  meleeHit(attacker, dmg, game) {
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
      if (dist > 1.75 + c.radius) continue;
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < 0.35 && dist > 0.7) continue;
      hitAny = true;
      if (game.net.isGuest) {
        // local juice now; the host applies damage and echoes eHurt/eDie
        e.creature.hurt();
        game.audio.hit();
        game.engine.hitStop(0.05);
        game.net.send({ t: "hit", id: e.id, dmg, kx: fwdX, kz: fwdZ });
      } else {
        this.damageEnemy(e, dmg, fwdX, fwdZ);
      }
    }
    return hitAny;
  }

  damageEnemy(e, dmg, kx = 0, kz = 0) {
    if (e.deadT >= 0) return;
    const game = this.game;
    e.hp -= dmg;
    e.hitCd = 0.12;
    setTimeout(() => (e.hitCd = 0), 130);
    const c = e.creature;
    c.hurt();
    c.position.x += kx * 0.35;
    c.position.z += kz * 0.35;
    game.hud.float(_v.copy(c.position).setY(c.height + 0.3), `${dmg}`, "dmg");
    game.particles.burst(_v.copy(c.position).setY(c.height * 0.6), { color: 0xffe08a, n: 6, speed: 2.5, life: 0.4 });
    game.audio.hit();
    game.engine.hitStop(0.05);
    game.engine.shake(0.12);
    if (e.hp <= 0) this.killEnemy(e, kx, kz);
    else game.net.send({ t: "eHurt", id: e.id, hp: e.hp });
  }

  killEnemy(e, kx, kz) {
    const game = this.game;
    e.deadT = 0;
    e.creature.die(_v.set(kx * 8, -3, kz * 8));
    game.audio.kill();
    game.engine.shake(0.25);
    game.net.send({ t: "eDie", id: e.id, kx, kz });
    if (game.net.isGuest) return;
    // loot: gold + maybe an item
    const r = rng(e.seed + 99);
    const gold = Math.round(lerp(e.def.gold[0], e.def.gold[1], r()) * (1 + e.tier * 0.35));
    game.gainGold(gold, e.creature.position);
    if (r() < 0.38) {
      const tier = clamp(e.tier + 1 + (r() < 0.2 ? 1 : 0), 1, 4);
      this.spawnDrop(pick(r, LOOT_BY_TIER[tier]), e.creature.position.x, e.creature.position.z);
    }
  }

  /** x/z are WORLD coordinates. */
  spawnDrop(itemId, x, z, id = null) {
    const mesh = itemMesh(itemId);
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
    for (const e of this.enemies) e.creature.dispose();
    this.enemies = [];
    for (const d of this.drops) d.mesh.removeFromParent();
    this.drops = [];
    this.chests = [];
    this.colliders = [];
    this.group.clear();
    this.active = false;
    this.group.visible = false;
  }
}

const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

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
