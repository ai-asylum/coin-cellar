// The dungeon under the shop. Seeded procedural floors (rooms + L-shaped
// corridors on a grid), instanced walls, chests, a stairway down and a
// stairway back up. Enemies come out of the same blob-bake pipeline as the
// customers upstairs — skitters, slimes, goblins, wisps, brutes.
import * as THREE from "three";
import { makeToonMaterial, feedOccluder } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { Creature } from "../chargen/creature.js";
import { scatterDungeonDecor, disposeDecor } from "./decor.js";
import { Projectiles } from "./projectile.js";
import { rng, pick } from "../core/engine.js";
import { DUNGEON_ORIGIN, isBossFloor, dungeonIndexFor, bossDefFor, ENEMY_KINDS, HOLE_THEMES, DEFAULT_THEME, FLOORS_PER_DUNGEON, floorMixFor, genFor } from "./dungeon-data.js";
import { CELL, makeChest, makeGate, makeFloorGeometry, makeStairs, makeDescent, buildAssetFloor, buildAssetWalls, scatterAssetProps, modelCollider } from "./dungeon-geometry.js";
import { dungeonAssetsReady, dungeonWallMaterial } from "./dungeon-assets.js";
import { aiMethods } from "./dungeon-ai.js";
import { combatMethods } from "./dungeon-combat.js";

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
    this.decor = []; // destructible props — billboards + smashable kit models
    this.structural = []; // unbreakable kit props (pillars); spark when struck
    this.shafts = []; // god-ray light shafts (animated each frame)
    this.colliders = [];
    this.projectiles = new Projectiles(game.engine.scene);
    this._wallMesh = null;
    this._floorMesh = null;
    // boss floor: sealed arena, its portcullis gate, and which chest holds the key
    this.gate = null;
    this.gateOpen = false;
    this.gatePos = null; // group-local doorway centre (game offsets by DUNGEON_ORIGIN)
    this.bossCenter = null;
    this.boss = null;
    this.keyChestId = -1;
    // stairs conjured where the boss falls: down to the next stacked dungeon,
    // or (final boss) straight home (world-space anchor)
    this.bossStairs = null;
  }

  /** Build floor n from a seed (deterministic — co-op peers share the seed).
   * `tutorial` swaps the maze for a single tiny room: no monsters, one chest —
   * a gentle first delve that teaches loot → stairs without any combat. */
  generate(floorN, seed, tutorial = false) {
    this.dispose();
    this.floor = floorN;
    this.seed = seed;
    this.active = true;
    this.tutorial = tutorial;
    this.group.visible = true;
    const r = rng(seed + floorN * 7717);

    // The final floor is the boss floor: a big sealed arena is reserved along
    // the top of a taller grid, and the normal rooms are packed in below it.
    // (Never on the tutorial floor — it's a single peaceful room.)
    const isBoss = !tutorial && isBossFloor(floorN);
    this.isBoss = isBoss;

    // generator knobs for this floor (base GEN + any per-floor overrides)
    const gen = genFor(floorN);

    // --- grid: non-overlapping rooms linked by wide L-shaped corridors.
    // The grid runs tall on purpose: the game is played portrait on mobile, so
    // floors sprawl along the screen's long (y) axis rather than across it.
    const GW = gen.gw, GH = isBoss ? gen.ghBoss : gen.gh;
    // boss cell + its 2-wide doorway (only meaningful on the boss floor). The
    // cell is just big enough to hold the keeper — it waits in here from the
    // moment the floor loads, plainly visible through the bars.
    const BW = 4, BH = 4, BX = Math.floor((GW - BW) / 2), BY = 1;
    const gateX = BX + Math.floor(BW / 2) - 1, gateY = BY + BH;
    const yMin = isBoss ? BY + BH + 2 : 1; // keep normal rooms clear of the arena
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    const rooms = [];
    if (tutorial) {
      // One snug room in the middle of the grid — nothing to fight, just a chest
      // to crack and the stairs home on the far wall. Kept deliberately tiny so a
      // new player's whole first delve fits in a couple of steps.
      const w = 5, h = 5;
      const x = Math.floor((GW - w) / 2), y = Math.floor((GH - h) / 2);
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) open[yy][xx] = true;
    } else {
    const nRooms = gen.roomsBase + Math.min(gen.roomsCap, Math.floor(floorN / 2)) + Math.floor(r() * gen.roomsRand);
    // rejection-sample room rects that keep a 1-cell gap from their neighbours
    for (let tries = 0; rooms.length < nRooms && tries < nRooms * 14; tries++) {
      // rooms lean taller than wide to match the portrait grid
      const w = gen.roomMin + Math.floor(r() * gen.roomWRand);
      const h = gen.roomMin + Math.floor(r() * gen.roomHRand);
      const x = 1 + Math.floor(r() * (GW - w - 2));
      const y = yMin + Math.floor(r() * (GH - h - yMin - 1));
      const overlaps = rooms.some((o) =>
        x - 1 < o.x + o.w && x + w + 1 > o.x && y - 1 < o.y + o.h && y + h + 1 > o.y
      );
      if (overlaps) continue;
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) open[yy][xx] = true;
    }
    }

    // The arrival spot is room 0, and every floor reads bottom-to-top: the
    // entrance sits toward the BOTTOM of the grid (high y — nearest the
    // camera) and the way onward toward the top, so make room 0 the
    // bottom-most room. On boss floors this doubles as spawn safety — the
    // sealed door is up top past the arena, so the player can't drop in
    // beside the gate and stumble into the boss fight unintentionally.
    if (!tutorial && rooms.length > 1) {
      let bi = 0, by = -Infinity;
      for (let i = 0; i < rooms.length; i++)
        if (rooms[i].cy > by) { by = rooms[i].cy; bi = i; }
      if (bi !== 0) { const t = rooms[0]; rooms[0] = rooms[bi]; rooms[bi] = t; }
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
    for (let k = 0, extra = gen.loopBase + Math.floor(r() * gen.loopRand); k < extra && rooms.length > 2; k++) {
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

    // Pick the descent (down-stairs) room now — the TOP-most room, opposite
    // end of the grid from the bottom entrance, so every delve runs entrance
    // (bottom) to exit (top) — and so the floor can leave a pit under it that
    // the sunk stair flight drops into. (Boss/tutorial floors have no
    // down-stairs, so no pit.)
    let _farRoom = rooms[0], _farY = Infinity;
    for (const room of rooms) {
      if (room === rooms[0]) continue;
      if (room.cy < _farY) { _farY = room.cy; _farRoom = room; }
    }
    const hasDown = !tutorial && !isBoss;
    const floorHoles = hasDown ? new Set([`${_farRoom.cx},${_farRoom.cy}`]) : null;

    // --- floor slab (colors come from the hole's theme; tutorial gets the default)
    const theme = tutorial ? DEFAULT_THEME : (HOLE_THEMES[dungeonIndexFor(floorN)] ?? DEFAULT_THEME);
    this.theme = theme;
    // palette deepens with the floor within its own dungeon (1st/2nd/3rd floor)
    const localFloor = (floorN - 1) % FLOORS_PER_DUNGEON;
    const palette = theme.palettes[Math.min(localFloor, theme.palettes.length - 1)];
    // the floor only exists under open (walkable) cells. With the kit loaded it's
    // one stone tile per cell (instanced); otherwise a merged quad per cell. A
    // light tint off the theme palette keeps each dungeon's identity on the
    // shared stone texture. (wallTint runs a touch darker for depth.)
    const _WHITE = new THREE.Color(0xffffff);
    const floorTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.5);
    const wallTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.32);
    if (dungeonAssetsReady()) {
      this._floorMesh = buildAssetFloor(open, GW, GH, cellPos, floorTint, floorHoles);
    } else {
      this._floorMesh = new THREE.Mesh(
        makeFloorGeometry(open, GW, GH, cellPos),
        new THREE.MeshToonMaterial({ color: new THREE.Color(palette[1]) })
      );
    }
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
    // With the kit loaded, line each open→closed boundary with stone panels;
    // otherwise fall back to the jittered instanced boxes. Either way the
    // colliders above (cell-based) do the actual blocking.
    if (dungeonAssetsReady()) {
      const walls = buildAssetWalls(open, GW, GH, cellPos, wallTint);
      this._wallMesh = walls.mesh;
      this._wallMat = walls.mat;
      this.group.add(this._wallMesh);
    } else {
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
    }

    // --- two flights of stairs now, one up and one down. The up-stairs stand
    // at the arrival spot (room 0) and lead back out of the cellar; the
    // down-stairs go in the top-most room, opposite the bottom entrance (never
    // on boss floors — the way deeper there opens past the boss). On the
    // tutorial floor the lone room holds the arrival spot against the bottom
    // wall and the up-stairs against the top, same bottom-to-top read as every
    // other floor.
    const rm0 = rooms[0];
    const entranceCell = tutorial ? { x: rm0.cx, y: rm0.y + rm0.h - 2 } : { x: rm0.cx, y: rm0.cy };
    this.entrancePos = cellPos(entranceCell.x, entranceCell.y);
    this.entranceCell = entranceCell;
    // start with the entrance room revealed
    this.reveal(this.entrancePos.x + DUNGEON_ORIGIN.x, this.entrancePos.z + DUNGEON_ORIGIN.z);

    // down-stairs go in the top-most room, the far end of the climb
    // (_farRoom was chosen above so the floor pit lines up under the flight)
    const stairsCell = tutorial ? { x: rm0.cx, y: rm0.y + 1 } : { x: _farRoom.cx, y: _farRoom.cy };
    this.stairsPos = cellPos(stairsCell.x, stairsCell.y);
    this.stairsCell = stairsCell;
    this.hasDownStairs = hasDown;
    if (this.hasDownStairs) {
      // pit shaft + seated flight over the cut-out cell (shared with the cellar
      // lobby's trapdoor mouths — see makeDescent)
      const descent = makeDescent();
      descent.position.copy(this.stairsPos);
      this.colliders.push(modelCollider(descent, DUNGEON_ORIGIN));
      this.group.add(descent);
    }

    // up-stairs: the way back out. On normal floors they rise at the arrival
    // spot; on the tutorial floor they take the top wall instead and stay
    // hidden until the chest is cracked, so the first objective is unmistakably
    // "smash the chest" — revealStairs() (called from openChest) brings the
    // stairs + their light shaft back in. (The default flight already rises
    // toward -z, into the top wall, so no turn is needed.)
    this.upStairsPos = tutorial ? this.stairsPos.clone() : this.entrancePos.clone();
    this.upStairsCell = tutorial ? stairsCell : entranceCell;
    const upStairs = makeStairs("up");
    upStairs.position.copy(this.upStairsPos);
    const upStairsCollider = modelCollider(upStairs, DUNGEON_ORIGIN);
    // the tutorial flight is inert & invisible until the chest is cracked, so
    // its collider stays out of play until revealStairs() lands it
    if (tutorial) this._hiddenStairsCollider = upStairsCollider;
    else this.colliders.push(upStairsCollider);
    this.group.add(upStairs);
    const upGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.4 })
    );
    upGlow.position.copy(this.upStairsPos).setY(0.05);
    this.group.add(upGlow);
    this._stairsMeshes = [upStairs, upGlow];
    this.stairsHidden = tutorial;
    if (this.stairsHidden) for (const mesh of this._stairsMeshes) mesh.visible = false;

    // --- billboard set dressing: mushrooms, stones, dead trees & bones tucked
    // into the rooms (seeded off the same rng so co-op peers match). Skips the
    // entrance and stairs cells so nothing clutters the arrival/exit spots.
    // group-local props; store their world position so combat can smash them
    // stable `id` (seeded layout ⇒ same index on every peer) lets a guest tell
    // the host which prop it smashed so loot is rolled once, host-side
    this.decor = scatterDungeonDecor(this.group, r, rooms, cellPos, {
      skip: [this.entranceCell, this.stairsCell],
      theme: theme.decor,
    }).map((d, i) => ({ ...d, id: i, wx: d.x + DUNGEON_ORIGIN.x, wz: d.z + DUNGEON_ORIGIN.z }));

    // freestanding kit props (barrels/crates/braziers) tucked against the walls,
    // plus torches/banners mounted on the rooms' perimeter walls. Their solid
    // footprints join the floor's colliders so nothing walks through them.
    // Smashables join the decor pipeline (ids continue past the billboards, and
    // both are seeded, so co-op peers agree); structural pieces (pillars,
    // standing torches) go on `structural` and only spark when struck.
    const props = scatterAssetProps(this.group, r, rooms, cellPos, { skip: [this.entranceCell, this.stairsCell], open, GW, GH, origin: DUNGEON_ORIGIN });
    this.structural = [];
    for (const pr of props) {
      this.colliders.push(pr.collider);
      const wx = pr.collider.x, wz = pr.collider.z;
      const radius = Math.max(pr.collider.hw, pr.collider.hd);
      if (pr.structural) {
        this.structural.push({ wx, wz, radius });
      } else {
        this.decor.push({
          group: pr.mesh, cat: "kit", id: this.decor.length,
          x: wx - DUNGEON_ORIGIN.x, z: wz - DUNGEON_ORIGIN.z, wx, wz,
          height: Math.min(1.6, pr.collider.h ?? 1), color: pr.color, radius,
          collider: pr.collider, // freed on smash so the spot stops blocking
        });
      }
    }

    // --- god-ray shafts: light leaking through cracks in the ceiling above.
    // Cool arcane glow over the up-stairs at the entrance, warm dusk over the
    // down-stairs, and a couple of pale beams scattered through deeper rooms.
    const addShaft = (pos, opts) => {
      const shaft = makeLightShaft(opts);
      shaft.position.set(pos.x, 3.4, pos.z);
      this.group.add(shaft);
      this.shafts.push(shaft);
      return shaft;
    };
    addShaft(this.entrancePos, { color: 0x9a6dff, length: 4.6, topWidth: 0.6, bottomWidth: 2.6, opacity: 0.4, tilt: 0.28, spin: 0.4, motes: 14, always: true });
    if (this.hasDownStairs)
      addShaft(this.stairsPos, { color: 0xff9a4d, length: 4.6, topWidth: 0.55, bottomWidth: 2.4, opacity: 0.34, tilt: 0.24, spin: 1.2, motes: 12, always: true });
    // the tutorial's up-stairs get a warm "way home" beam that's part of the
    // chest-crack reveal
    if (tutorial) {
      const homeShaft = addShaft(this.upStairsPos, { color: 0xffd9a0, length: 4.6, topWidth: 0.55, bottomWidth: 2.4, opacity: 0.34, tilt: 0.24, spin: 1.2, motes: 12, always: true });
      homeShaft.visible = false;
      this._stairsMeshes.push(homeShaft);
    }
    for (const room of rooms.slice(1, -1)) {
      if (r() < 0.5) {
        const p = cellPos(room.cx, room.cy);
        addShaft(p, { color: pick(r, theme.shafts), length: 4.4, topWidth: 0.5, bottomWidth: 2.1, opacity: 0.24 + r() * 0.1, tilt: 0.18 + r() * 0.3, spin: r() * Math.PI, motes: 10 });
      }
    }

    // --- enemies (host decides; guests get them mirrored via net). The
    // tutorial floor is deliberately monster-free.
    if (!this.game.net.isGuest && !tutorial) {
      const tier = Math.min(floorN, 5) - 1;
      const mix = floorMixFor(floorN);
      const n = gen.enemyBase + floorN + Math.floor(r() * gen.enemyRand);
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

    // --- rolling spawns (Minecraft-style): the floor keeps repopulating on a
    // timer, but only away from every player, and never past a per-depth cap.
    // Disabled on the peaceful tutorial and inside the sealed boss arena so the
    // arena stays a controlled fight. Host-only (guests mirror via eSnap).
    this._spawnTier = Math.min(floorN, 5) - 1;
    this._spawnMix = floorMixFor(floorN);
    this.spawnCap = isBoss || tutorial ? 0 : gen.spawnCapBase + floorN * gen.spawnCapPer;
    this._spawnT = 4 + r() * 4; // first top-up a few seconds in

    // --- chests. The tutorial floor gets exactly one, dead centre between the
    // arrival spot and the stairs, so a new player can't miss it.
    if (tutorial) {
      const chest = makeChest();
      chest.position.copy(cellPos(rooms[0].cx, rooms[0].cy));
      // front (clasp) faces +z, toward the player walking up from the entrance
      this.colliders.push(modelCollider(chest, DUNGEON_ORIGIN));
      this.group.add(chest);
      this.chests.push({ mesh: chest, opened: false, id: 0 });
    } else {
    const nChests = gen.chestBase + Math.floor(r() * gen.chestRand);
    for (let i = 0; i < nChests; i++) {
      const room = rooms[Math.floor(r() * rooms.length)];
        const p = cellPos(room.x + Math.floor(r() * room.w), room.y + Math.floor(r() * room.h));
        if (p.distanceTo(this.entrancePos) < 2.5) continue;
        // keep the way up and the way down clear so a chest never blocks stairs
        if (p.distanceTo(this.upStairsPos) < 2.5) continue;
        if (this.hasDownStairs && p.distanceTo(this.stairsPos) < 2.5) continue;
        const chest = makeChest();
      chest.position.copy(p);
      chest.rotation.y = r() * Math.PI * 2;
      this.colliders.push(modelCollider(chest, DUNGEON_ORIGIN));
      this.group.add(chest);
      this.chests.push({ mesh: chest, opened: false, id: i });
    }
    }

    // --- the boss door key. It's hidden in one chest during the run: the boss
    // floor always guarantees one (so the arena is never un-openable), and
    // earlier floors give it a chance so it can turn up on the way down. The
    // choice is derived from the seed alone, so co-op peers agree on it.
    this.keyChestId = -1;
    const keyHere = !tutorial && (isBoss || rng(seed + 900 + floorN * 17)() < gen.keyChance);
    if (keyHere) {
      if (isBoss && this.chests.length === 0) {
        // extremely unlucky roll left the arena floor chest-less — force one
        const room = rooms[rooms.length - 1];
        const p = cellPos(room.cx, room.cy);
        const chest = makeChest();
        chest.position.copy(p);
        this.colliders.push(modelCollider(chest, DUNGEON_ORIGIN));
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

    this.bossCenter = new THREE.Vector3(center.x + DUNGEON_ORIGIN.x, 0, center.z + DUNGEON_ORIGIN.z);
    // the keeper is placed the instant the floor loads, pacing its little cell
    // in plain view through the bars. It stays dormant (never aggros, never
    // attacks) until the gate is breached. Host spawns it; guests mirror it
    // via eSnap, so this is host-authoritative only.
    if (!this.game.net.isGuest) {
      const boss = this.spawnEnemy("boss", (this.seed % 100000) + 54321 + this.floor * 991, dungeonIndexFor(this.floor) + 2, this.bossCenter.x, this.bossCenter.z);
      boss.dormant = true;
    }
  }

  /** Unlock the boss door: drop its colliders, start the gate rising, and wake
   * the boss (host authoritative; guests receive it mirrored via net). */
  openGate() {
    if (!this.gate || this.gate.open) return;
    this.gate.open = true;
    this.gateOpen = true;
    this.colliders = this.colliders.filter((c) => !this.gate.colliders.includes(c));
    this.gate.raiseT = 0;
    // the keeper has been waiting in its cell — the breached gate wakes it and
    // it storms out after whoever opened the door (host drives the AI; guests
    // mirror the chase via eSnap).
    if (this.isBoss && this.boss) { this.boss.dormant = false; this.boss.woke = true; }
  }

  /** x/z are WORLD coordinates. */
  spawnEnemy(kind, seed, tier, x, z, id = null, hpOverride = null) {
    // the boss def is themed per dungeon, derived from the current floor (same
    // on host + guest, since the floor is synced)
    const def = kind === "boss" ? bossDefFor(dungeonIndexFor(this.floor)) : ENEMY_KINDS[kind];
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

  /** A player bow/staff bolt — collides with enemies rather than players.
   *  Local-only visually (kept off the wire to spare the co-op switch); damage
   *  routes through the usual host/guest split when it lands. */
  spawnPlayerProjectile(x, z, vx, vz, opts = {}) {
    const p = this.projectiles.spawn(x, z, vx, vz, opts);
    p.friendly = true;
    p.crit = !!opts.crit;
    p.pierce = !!opts.pierce;
    p.splash = opts.splash || 0;
    p.hitIds = new Set();
    return p;
  }

  /** Fractional grid cell → group-local position (inverse of worldToCell). */
  cellCenter(x, y) {
    return new THREE.Vector3((x - this.GW / 2 + 0.5) * CELL, 0, (y - this.GH / 2 + 0.5) * CELL);
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

    // keep the wall-occlusion shader fed with the camera, player torso and any
    // live enemies so walls between the camera and the hero (or the foes
    // closing on them) dither away instead of hiding them
    feedOccluder(
      this._wallMat, this.game.player, this.game.engine.camera, 0.6,
      this.enemies.filter((e) => e.deadT < 0).map((e) => e.creature)
    );

    for (const s of this.shafts) s.userData.update(dt, elapsed);

    // the boss stairs' floor glow pulses once they've been conjured
    if (this.bossStairs) {
      const bs = this.bossStairs;
      bs.disc.material.opacity = 0.45 + Math.sin(elapsed * 3) * 0.15;
      bs.ring.material.opacity = 0.6 + Math.sin(elapsed * 3 + 1) * 0.15;
    }

    // the boss gate slides up out of sight once it's been unlocked
    if (this.gate && this.gate.raiseT >= 0) {
      this.gate.raiseT += dt;
      const k = Math.min(1, this.gate.raiseT / 0.8);
      this.gate.mesh.position.y = k * 2.0;
      if (k >= 1) { this.gate.mesh.visible = false; this.gate.raiseT = -1; }
    }

    for (const drop of this.drops) {
      if (drop.fly) {
        const f = drop.fly;
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        const e = 1 - (1 - k) * (1 - k); // ease-out toward the resting spot
        drop.mesh.position.x = f.fromX + (drop.restX - f.fromX) * e;
        drop.mesh.position.z = f.fromZ + (drop.restZ - f.fromZ) * e;
        drop.mesh.position.y = 0.35 + Math.sin(k * Math.PI) * f.arc; // popped arc
        if (k >= 1) drop.fly = null;
      } else {
        drop.mesh.position.y = 0.35 + Math.sin(elapsed * 3 + drop.phase) * 0.09;
      }
    }

    const players = this.game.playersInDungeon();
    // host tops the floor back up on a timer (guests receive the spawns via net)
    if (!this.game.net.isGuest && this.spawnCap > 0) this._tickSpawner(dt, players);
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

    // projectiles: move everywhere (visuals); the host resolves enemy→player
    // hits, while friendly bolts→enemy hits resolve for everyone (guests relay
    // the hit to the host, same as a melee swing)
    this.projectiles.update(dt, elapsed);
    this._resolveFriendlyProjectiles();
    if (!this.game.net.isGuest) this._resolveProjectiles(players);
  }

  // Rolling repopulation: every few seconds, if the floor is under its cap,
  // slip one fresh wanderer into a random room that no player can see (well
  // outside every hero's bubble) — so the cellar stays alive as you clear it
  // without monsters ever popping in on top of you. Guests get it via eSnap.
  _tickSpawner(dt, players) {
    this._spawnT -= dt;
    if (this._spawnT > 0) return;
    this._spawnT = 4 + Math.random() * 3; // next attempt in ~4–7s
    // count only living rank-and-file against the cap (the boss doesn't count)
    let live = 0;
    for (const e of this.enemies) if (e.deadT < 0 && !e.isBoss) live++;
    if (live >= this.spawnCap) return;
    if (this.rooms.length < 2) return;

    const MIN_DIST = 9; // world units the spawn must clear every player by
    for (let tries = 0; tries < 12; tries++) {
      const room = this.rooms[1 + Math.floor(Math.random() * (this.rooms.length - 1))];
      const p = this.cellCenter(room.x + Math.random() * room.w - 0.5, room.y + Math.random() * room.h - 0.5);
      if (p.distanceTo(this.entrancePos) < 4) continue; // never at the arrival spot
      const wx = p.x + DUNGEON_ORIGIN.x, wz = p.z + DUNGEON_ORIGIN.z;
      let clear = true;
      for (const pl of players) {
        const dx = pl.creature.position.x - wx, dz = pl.creature.position.z - wz;
        if (dx * dx + dz * dz < MIN_DIST * MIN_DIST) { clear = false; break; }
      }
      if (!clear) continue;
      const kind = this._spawnMix[Math.floor(Math.random() * this._spawnMix.length)];
      this.spawnEnemy(kind, Math.floor(Math.random() * 1e6), this._spawnTier, wx, wz);
      return;
    }
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
    this.decor = [];
    this.structural = [];
    for (const s of this.shafts) s.userData.dispose();
    this.shafts = [];
    this.colliders = [];
    disposeDecor(this.group); // free the billboard scenery's sprite materials
    // free this floor's baked instanced geometry (walls + floor tiles) so a long
    // descent doesn't pile up GPU buffers; the shared wall material is reused
    const sharedWall = dungeonWallMaterial();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) {
        o.geometry.dispose();
        if (o.material && o.material !== sharedWall) o.material.dispose();
      }
    });
    this.group.clear();
    this.active = false;
    this.group.visible = false;
    // boss/arena state is torn down with the floor
    this.gate = null;
    this.gateOpen = false;
    this.gatePos = null;
    this.bossCenter = null;
    this.boss = null;
    this.keyChestId = -1;
    this.isBoss = false;
    this.bossStairs = null;
  }
}

// AI (enemy update loop, telegraphs, attack state machine) and combat
// (projectiles, damage, loot, chests, boss stairs) live in sibling modules and
// are mixed onto the prototype so every `this._method()` call keeps working.
Object.assign(Dungeon.prototype, aiMethods, combatMethods);

const _v = new THREE.Vector3();

// Re-export the public data API so existing import sites (game.js, admin.js,
// cave.js) keep working unchanged after the split.
export {
  DUNGEON_ORIGIN, MAX_DEPTH, FLOORS_PER_DUNGEON, N_DUNGEONS, isBossFloor,
  dungeonIndexFor, bossDefFor, BOSS_ATK_GLOW, ENEMY_KINDS, DUNGEON_MIX,
  HOLE_THEMES, DUNGEON_LOOT, BOSSES, floorMixFor,
} from "./dungeon-data.js";
