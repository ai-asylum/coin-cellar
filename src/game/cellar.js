// The cellar under the trapdoor: the tutorial cellar itself, kept on as the
// shared lobby every online player walks through on their way down. Same snug
// 5×5-cell room, same stone kit, same palette — the only additions are the
// four grated trapdoor mouths tucked into the corners, each a shortcut to the
// head of a stacked dungeon (floors 1, 4, 7, 10). The first mouth is always
// open; the deeper three unseal for a few hours once you descend past the boss
// that guards the dungeon above them. The stairs back up to the shop stand
// where the tutorial's home stairs were. Static geometry, built once.
import * as THREE from "three";
import { makeToonMaterial, feedOccluder } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { rng } from "../core/engine.js";
import { FLOORS_PER_DUNGEON } from "./dungeon.js";
import { DEFAULT_THEME } from "./dungeon-data.js";
import { CELL, makeStairs, makeDescent, makeFloorGeometry, buildAssetFloor, buildAssetWalls, scatterAssetProps } from "./dungeon-geometry.js";
import { scatterDungeonDecor } from "./decor.js";
import { dungeonAssetsReady, dungeonPalette } from "./dungeon-assets.js";

export const CELLAR_ORIGIN = new THREE.Vector3(-200, 0, 0);

// The lobby's footprint: a 9×5-cell hall (grown from the tutorial's snug 5×5
// so the four mouths get room to breathe). The grid keeps a one-cell solid rim
// around it so the wall builders see the same open→closed boundaries the
// dungeon generator produces.
const GW = 11, GH = 7;
const ROOM = { x: 1, y: 1, w: 9, h: 5, cx: 5, cy: 3 };
const cellPos = (x, y) => new THREE.Vector3((x - GW / 2 + 0.5) * CELL, 0, (y - GH / 2 + 0.5) * CELL);

// All four mouths lined up in a row across the top of the room, distributed
// space-evenly — one clear floor cell around every mouth (reading order =
// dungeon index). They sit one cell in from the north wall (gy 2, not 1) so
// neither the mouth nor the trapdoor lid — which hinges and swings back toward
// the wall — clips through the wall geometry. Each mouth is a real cut-out
// floor cell with a sunk stair flight (same descent assembly as the dungeons'
// down-stairs), so they sit on whole grid cells.
export const HOLE_DEFS = [
  { name: "Rat Warren", gx: 2, gy: 2, color: 0x9a6dff },
  { name: "Flooded Deep", gx: 4, gy: 2, color: 0x5dd0ff },
  { name: "Bone Hollow", gx: 6, gy: 2, color: 0xff9a5d },
  { name: "Gloom Drain", gx: 8, gy: 2, color: 0x6fd6c8 },
];

// The home stairs hug the west wall, a row toward the camera; you arrive at
// their foot (a step clear eastward, so the "go up" prompt isn't primed) as if
// you'd just walked down them.
const STAIRS_CELL = { x: ROOM.x, y: ROOM.cy + 1 };
const ENTRANCE_CELL = { x: ROOM.x + 1, y: ROOM.cy + 1 }; // the arrival spot's skip-list footprint

export class Cellar {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(CELLAR_ORIGIN);
    game.engine.scene.add(this.group);
    this.shafts = [];
    this.colliders = [];

    // holes and the exit stairs, in world coords for the context-action checks.
    // Each mouth is a shortcut to the head of its stacked dungeon (floors 1, 4,
    // 7, 10); the first is always open, the rest are earned by clearing bosses.
    this.holes = HOLE_DEFS.map((h, i) => ({
      id: i, name: h.name, color: h.color,
      floor: i * FLOORS_PER_DUNGEON + 1,
      pos: cellPos(h.gx, h.gy).add(CELLAR_ORIGIN),
    }));
    // arrive at the foot of the home stairs: 1.8 east of the flight, just past
    // the "go up" prompt radius (1.7) so it isn't primed the moment you land
    this.entrancePos = cellPos(STAIRS_CELL.x, STAIRS_CELL.y).add(CELLAR_ORIGIN).add(new THREE.Vector3(1.8, 0, 0));
    this.exitPos = cellPos(STAIRS_CELL.x, STAIRS_CELL.y).add(CELLAR_ORIGIN);

    this._build();
  }

  _build() {
    const r = rng(4242);
    const O = CELLAR_ORIGIN;

    // the open grid: just the room, ringed by solid cells
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    for (let y = ROOM.y; y < ROOM.y + ROOM.h; y++)
      for (let x = ROOM.x; x < ROOM.x + ROOM.w; x++) open[y][x] = true;

    // --- floor + walls: the exact tutorial-cellar recipe from Dungeon.generate
    // (DEFAULT_THEME, first palette — the tutorial is floor 1 of the classic look)
    const palette = DEFAULT_THEME.palettes[0];
    const _WHITE = new THREE.Color(0xffffff);
    const floorTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.5);
    const wallTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.32);
    if (dungeonAssetsReady()) {
      // the four mouths are real holes: their cells are cut out of the floor
      // and each gets the pit-shaft + sunk-flight descent assembly below
      const floorHoles = new Set(HOLE_DEFS.map((h) => `${h.gx},${h.gy}`));
      this.group.add(buildAssetFloor(open, GW, GH, cellPos, floorTint, floorHoles));
    } else {
      this.group.add(new THREE.Mesh(
        makeFloorGeometry(open, GW, GH, cellPos),
        new THREE.MeshToonMaterial({ color: new THREE.Color(palette[1]) })
      ));
    }
    const wallCells = [];
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (open[y][x]) continue;
        let touches = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
          if (open[y + dy]?.[x + dx]) touches = true;
        if (!touches) continue;
        wallCells.push([x, y]);
        const p = cellPos(x, y);
        this.colliders.push({ x: p.x + O.x, z: p.z + O.z, hw: CELL / 2, hd: CELL / 2 });
      }
    if (dungeonAssetsReady()) {
      // own occluder material: the dungeon re-tints the shared one every floor,
      // and the lobby lives alongside those floors
      this._wallMat = makeToonMaterial({ map: dungeonPalette(), rim: 0, occlude: true });
      const walls = buildAssetWalls(open, GW, GH, cellPos, wallTint, this._wallMat);
      this.group.add(walls.mesh);
    } else {
      const wallGeo = new THREE.BoxGeometry(CELL, 1.7, CELL);
      this._wallMat = makeToonMaterial({ color: new THREE.Color(palette[1]).multiplyScalar(0.55).getHex(), rim: 0, occlude: true });
      const walls = new THREE.InstancedMesh(wallGeo, this._wallMat, wallCells.length);
      const m = new THREE.Matrix4();
      wallCells.forEach(([x, y], i) => {
        const p = cellPos(x, y);
        const jitter = 0.92 + rng(4242 + x * 31 + y * 57)() * 0.18;
        m.makeScale(1, jitter, 1);
        m.setPosition(p.x, 0.85 * jitter, p.z);
        walls.setMatrixAt(i, m);
      });
      this.group.add(walls);
    }

    // --- the stairs home: rising into the west wall under the warm "way home"
    // beam, nudged flush so the top step touches the wall face. (The old
    // separate arcane arrival beam is gone — you now arrive at this flight's
    // foot, and one beam marks the spot.)
    const exitLocal = cellPos(STAIRS_CELL.x, STAIRS_CELL.y);
    const stairs = makeStairs("up");
    stairs.rotation.y = Math.PI / 2; // rise toward the west wall
    stairs.position.copy(exitLocal);
    stairs.updateMatrixWorld(true);
    const sb = new THREE.Box3().setFromObject(stairs);
    stairs.position.x += exitLocal.x - CELL / 2 - sb.min.x; // top step meets the wall
    this.group.add(stairs);
    const homeShaft = makeLightShaft({ color: 0xffd9a0, length: 4.6, topWidth: 0.55, bottomWidth: 2.4, opacity: 0.34, tilt: 0.24, spin: 1.2, motes: 12 });
    homeShaft.position.set(exitLocal.x, 3.4, exitLocal.z);
    this.group.add(homeShaft);
    this.shafts.push(homeShaft);

    // --- the dungeon mouths: a dark maw, a glowing rim, a rising light shaft,
    // one per corner. Scaled down from the old sewer sizing to sit in a cell.
    const lidMat = makeToonMaterial({ color: 0x53433a, rim: 0 });
    const lidTrim = makeToonMaterial({ color: 0x2f2621, rim: 0, polygonOffset: true });
    for (const hole of this.holes) {
      const local = new THREE.Vector3().copy(hole.pos).sub(O);
      if (dungeonAssetsReady()) {
        // the same pit + sunk stair flight the dungeons' descent cells use —
        // flush (no lift) so the closed grate lid swings clear of the steps
        const descent = makeDescent(0.02);
        descent.position.copy(local);
        this.group.add(descent);
      } else {
        // no kit → no cut-out cell; keep the old flat dark mouth
        const mouth = new THREE.Mesh(
          new THREE.CircleGeometry(0.85, 28).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x05060a })
        );
        mouth.position.copy(local).setY(0.02);
        this.group.add(mouth);
      }
      const shaft = makeLightShaft({ color: hole.color, length: 4.2, topWidth: 0.45, bottomWidth: 1.6, opacity: 0.22, tilt: 0.16, spin: r() * Math.PI, motes: 8 });
      shaft.position.set(local.x, 3.2, local.z);
      this.group.add(shaft);
      this.shafts.push(shaft);

      // a heavy grated trapdoor barring the mouth — it hinges on its back edge
      // and swings up once the player's earned the way into this hole. Sized
      // to the full cell so the closed grate seals the cut-out flush.
      const lidR = CELL / 2;
      const lidPivot = new THREE.Group();
      lidPivot.position.set(local.x, 0.06, local.z - lidR); // hinge on the far edge
      const lid = new THREE.Mesh(new THREE.BoxGeometry(lidR * 2, 0.12, lidR * 2), lidMat);
      lid.position.set(0, 0, lidR);
      lidPivot.add(lid);
      for (const bx of [-0.55, 0, 0.55]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, lidR * 2 - 0.16), lidTrim);
        bar.position.set(bx, 0.06, lidR);
        lidPivot.add(bar);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 14), lidTrim);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.12, lidR * 1.7);
      lidPivot.add(ring);
      this.group.add(lidPivot);
      hole.lid = lidPivot;
      // the first mouth is always open; the rest start barred until earned
      hole.open = hole.id === 0;
      hole._lidAngle = hole.open ? 1 : 0; // 0 = shut over the mouth, 1 = flung open
    }

    // --- set dressing, same scatter the tutorial floor gets: billboard cave
    // props plus the kit's barrels and crates, kept clear of every walk target
    const skip = [ENTRANCE_CELL, STAIRS_CELL, ...HOLE_DEFS.map((h) => ({ x: h.gx, y: h.gy }))];
    scatterDungeonDecor(this.group, r, [ROOM], cellPos, { skip, theme: DEFAULT_THEME.decor });
    // the lobby is a safe hub with no combat, so its props stay static — only
    // their solid footprints matter here
    for (const pr of scatterAssetProps(this.group, r, [ROOM], cellPos, { skip, origin: CELLAR_ORIGIN }))
      this.colliders.push(pr.collider);
  }

  update(dt, elapsed) {
    if (this.game.playerArea !== "cellar") return;
    // walls between the camera and the player dither away (see-through cutout)
    feedOccluder(this._wallMat, this.game.player, this.game.engine.camera);
    for (const s of this.shafts) s.userData.update(dt, elapsed);
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
