// The cave at the end of the road — the dungeon's front door AND its lobby. A
// burrow off the east end of the village street: walk in through the daylight
// mouth, up the tunnel, and the old owner's dug-out chamber at its deepest
// point holds the four trapdoor mouths, each a shortcut to the head of a
// stacked dungeon (floors 1, 4, 7, 10). The first mouth is always open — it
// wears the wooden trapdoor the FTUE hero shut behind them on the climb out —
// and the deeper three unseal for a few hours once you descend past the boss
// that guards the dungeon above them. Built once and permanent. Rat Warren
// dressing (warm browns) and a couple of harmless ambient rats; the FTUE
// additionally spawns the opener's slime here (see spawnSlime /
// game-narrative's _updateCaveIntro).
import * as THREE from "three";
import { makeToonMaterial, feedOccluder, fogPuffTexture } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { rng } from "../core/engine.js";
import { Creature } from "../chargen/creature.js";
import { ratSpec, slimeSpec } from "../chargen/species.js";
import { HOLE_THEMES } from "./dungeon-data.js";
import { FLOORS_PER_DUNGEON } from "./dungeon.js";
import { CELL, makeDescent, modelCollider, makeFloorGeometry, buildAssetFloor, buildAssetWalls, scatterAssetProps } from "./dungeon-geometry.js";
import { scatterDungeonDecor } from "./decor.js";
import { dungeonAssetsReady, dungeonPalette, cloneModel } from "./dungeon-assets.js";
import { getLayout } from "./layout-store.js";

export const CAVE_ORIGIN = new THREE.Vector3(-200, 0, 200);

// The footprint: the old cellar lobby's 9×5 hall, dug out at the deep (north)
// end, with a narrow tunnel running down to a one-cell mouth carved out of the
// SOUTH rim. The cave hangs off the top of the village road, so walking
// up-screen on the road continues up-screen inside: in through the light at
// the bottom, up the tunnel, into the chamber where the mouths wait. The FTUE
// hero wakes right beside the first mouth, as if they'd just climbed out. A
// few corner cells stay solid so it reads dug-out.
const GW = 11, GH = 11;
const CHAMBER = { x: 1, y: 1, w: 9, h: 5, cx: 5, cy: 3 };
const TUNNEL = { x: 4, y: 6, w: 3, h: 4, cx: 5, cy: 7 };
const EXIT_CELL = { x: 5, y: 10 }; // the daylight gap in the south rim
const SPAWN_CELL = { x: 2, y: 3 }; // the FTUE wake-up spot, beside the first mouth
// FTUE only: the hero wakes centred in the passage, just clear of the fog and
// facing the daylight, so the whole chamber — the four mouths included — sits
// behind him. VEIL_EDGE_Z anchors the fog bank's south face (well behind him,
// hiding the mouths); VEIL_WALL_Z is the invisible fence at the fog's visible
// lip that keeps him from wandering back into the dark. (local z coords)
const FTUE_SPAWN = new THREE.Vector3(0, 0, 2.4);
const VEIL_EDGE_Z = 0.8;
const VEIL_WALL_Z = 1.4;
const SOLID_NOOKS = [[1, 5], [9, 1]]; // chamber bulges left un-dug (the tunnel runs straight)
const cellPos = (x, y) => new THREE.Vector3((x - GW / 2 + 0.5) * CELL, 0, (y - GH / 2 + 0.5) * CELL);

// Editor helper: the reverse of cellPos — snap a group-local (x, z) back to the
// nearest whole grid cell, clamped in-bounds. The cave's mouths and daylight
// exit are cell-locked (their floor cut-outs and colliders are cell-based), so
// dragging one snaps it here before it's persisted to layout.json.
export function localToCaveCell(x, z) {
  const gx = Math.max(0, Math.min(GW - 1, Math.round(x / CELL + GW / 2 - 0.5)));
  const gy = Math.max(0, Math.min(GH - 1, Math.round(z / CELL + GH / 2 - 0.5)));
  return { gx, gy };
}

// All four mouths lined up in a row across the top of the chamber, distributed
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

export class Cave {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(CAVE_ORIGIN);
    game.engine.scene.add(this.group);
    this.shafts = []; // god-ray beams; the mouths + daylight ones also cast real light
    this.colliders = [];
    this.rats = [];
    this.slime = null; // the FTUE opener's mark — spawned on demand
    this.veil = null; // the FTUE fog bank + invisible fence — raised on demand
    this.rockObjs = []; // the two flanking boulders (editor grab handles)
    this.exitObj = null; // the daylight mouth's glare quad (editor grab handle)

    // editor-authored layout overrides (see layout.json's `cave` block and the
    // editor's Cave tab): the daylight mouth cell, the four dungeon-mouth cells,
    // and the two flanking rocks. Absent fields fall back to the built-in
    // defaults, so a fresh layout still builds the hand-placed cave.
    const co = getLayout().cave || {};
    this.exitCell = co.exit ? { x: co.exit.gx, y: co.exit.gy } : { x: EXIT_CELL.x, y: EXIT_CELL.y };
    this.holeCells = HOLE_DEFS.map((h, i) => {
      const o = co.holes?.[i];
      return { gx: o ? o.gx : h.gx, gy: o ? o.gy : h.gy };
    });
    const rd = cellPos(EXIT_CELL.x, EXIT_CELL.y); // rock defaults frame the default mouth
    this.rockDefs = (co.rocks && co.rocks.length) ? co.rocks.map((r) => ({ ...r })) : [
      { x: rd.x - 2.9, z: rd.z - CELL * 0.5, yaw: -0.8 },
      { x: rd.x + 2.9, z: rd.z - CELL * 0.5, yaw: 0.8 },
    ];

    // the mouths, in world coords for the context-action checks. Each is a
    // shortcut to the head of its stacked dungeon (floors 1, 4, 7, 10); the
    // first is always open (behind the FTUE's trapdoor), the rest are earned
    // by clearing bosses.
    this.holes = HOLE_DEFS.map((h, i) => ({
      id: i, name: h.name, color: h.color,
      floor: i * FLOORS_PER_DUNGEON + 1,
      pos: cellPos(this.holeCells[i].gx, this.holeCells[i].gy).add(CAVE_ORIGIN),
    }));
    // world-coord anchors for the game glue: the FTUE wake-up spot, the
    // daylight mouth (walk-through to the road), the first dungeon mouth (the
    // FTUE's "descent"), and where the opener's slime waits between spawn and
    // the light.
    this.entrancePos = FTUE_SPAWN.clone().add(CAVE_ORIGIN);
    this.exitPos = cellPos(this.exitCell.x, this.exitCell.y).add(CAVE_ORIGIN);
    this.descentPos = this.holes[0].pos;
    // the slime waits out in the light down the passage, ahead of the hero
    this.slimePos = this.entrancePos.clone().add(new THREE.Vector3(0, 0, 3.8));

    this._build();
    this._spawnRats();
  }

  _build() {
    const r = rng(1337);
    const O = CAVE_ORIGIN;

    // the open grid: chamber + tunnel minus the un-dug nooks, plus the mouth
    // cut into the rim so the wall builders leave the daylight gap open
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    for (const room of [CHAMBER, TUNNEL])
      for (let y = room.y; y < room.y + room.h; y++)
        for (let x = room.x; x < room.x + room.w; x++) open[y][x] = true;
    for (const [x, y] of SOLID_NOOKS) open[y][x] = false;
    open[this.exitCell.y][this.exitCell.x] = true;
    // the south rim (the daylight side) would stand between the camera and the
    // tunnel, so its wall MESHES are skipped entirely — the fence stays (the
    // colliders below still read the real `open` grid), but nothing ever
    // blocks the view in. The wall builders get their own taller grid where
    // the tunnel's width runs open through the rim and a few phantom rows
    // beyond it: the side walls continue south framing the daylight, and the
    // grid-edge closing strip lands far below the camera frame.
    const wallGH = GH + 3;
    const wallOpen = Array.from({ length: wallGH }, (_, y) =>
      y < GH ? [...open[y]] : new Array(GW).fill(false));
    for (let y = GH - 1; y < wallGH; y++)
      for (let x = TUNNEL.x; x < TUNNEL.x + TUNNEL.w; x++) wallOpen[y][x] = true;

    // --- floor + walls: the dungeon-kit recipe with the Rat Warren's burrowed
    // browns, so the cave already speaks the dungeon's visual language
    const palette = HOLE_THEMES[0].palettes[0];
    const _WHITE = new THREE.Color(0xffffff);
    const floorTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.5);
    const wallTint = new THREE.Color(palette[1]).lerp(_WHITE, 0.32);
    if (dungeonAssetsReady()) {
      // the four mouths are real holes: their cells are cut out of the floor
      // and each gets the pit-shaft + sunk-flight assembly below
      const floorHoles = new Set(this.holeCells.map((h) => `${h.gx},${h.gy}`));
      this.group.add(buildAssetFloor(open, GW, GH, cellPos, floorTint, floorHoles));
      // own occluder material (the dungeon re-tints the shared one every floor)
      this._wallMat = makeToonMaterial({ map: dungeonPalette(), rim: 0, occlude: true });
      const walls = buildAssetWalls(wallOpen, GW, wallGH, cellPos, wallTint, this._wallMat);
      this.group.add(walls.mesh);
    } else {
      this.group.add(new THREE.Mesh(
        makeFloorGeometry(open, GW, GH, cellPos),
        new THREE.MeshToonMaterial({ color: new THREE.Color(palette[1]) })
      ));
      this._wallMat = makeToonMaterial({ color: new THREE.Color(palette[1]).multiplyScalar(0.55).getHex(), rim: 0, occlude: true });
      const wallCellsFallback = [];
      for (let y = 0; y < wallGH; y++)
        for (let x = 0; x < GW; x++) {
          if (wallOpen[y][x]) continue;
          let touches = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
            if (wallOpen[y + dy]?.[x + dx]) touches = true;
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
    const exitLocal = cellPos(this.exitCell.x, this.exitCell.y);
    this.colliders.push({ x: exitLocal.x + O.x, z: exitLocal.z + CELL + O.z, hw: CELL / 2, hd: CELL / 2 });

    // --- the dungeon mouths: a dark maw with a sunk stair flight under a
    // rising light shaft, one per chamber slot. Each is barred by a lid that
    // hinges on its back edge and swings up and back toward the wall — wooden
    // planks + pull ring on the first (the trapdoor the FTUE hero shut behind
    // them, see setTrapdoorOpen), iron bars + heavy ring on the earned three.
    const grateMat = makeToonMaterial({ color: 0x53433a, rim: 0 });
    const grateTrim = makeToonMaterial({ color: 0x2f2621, rim: 0, polygonOffset: true });
    const lidMat = makeToonMaterial({ color: 0x6e4526, rim: 0 });
    const lidTrim = makeToonMaterial({ color: 0x4a2c17, rim: 0, polygonOffset: true });
    for (const hole of this.holes) {
      const local = new THREE.Vector3().copy(hole.pos).sub(O);
      if (dungeonAssetsReady()) {
        // the same pit + sunk stair flight the dungeons' descent cells use —
        // flush (no lift) so the closed lid swings clear of the steps
        const descent = makeDescent(0.02);
        descent.position.copy(local);
        descent.userData.caveEdit = { type: "hole", index: hole.id };
        this.colliders.push(modelCollider(descent, CAVE_ORIGIN));
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
      // the beam doubles as a soft coloured light, so each trapdoor reads as a
      // lit landmark carved out of the cave's gloom rather than a flat patch
      const shaft = makeLightShaft({ color: hole.color, length: 4.2, topWidth: 0.45, bottomWidth: 1.6, opacity: 0.22, tilt: 0.16, spin: r() * Math.PI, motes: 8, always: true, light: { intensity: 1.5, range: 6.5 } });
      shaft.position.set(local.x, 3.2, local.z);
      this.group.add(shaft);
      this.shafts.push(shaft);

      // the lid, sized to the full cell so it seals the cut-out flush
      const first = hole.id === 0;
      const mat = first ? lidMat : grateMat;
      const trim = first ? lidTrim : grateTrim;
      const lidR = CELL / 2;
      const lidPivot = new THREE.Group();
      lidPivot.position.set(local.x, 0.06, local.z - lidR); // hinge on the deep edge
      const lid = new THREE.Mesh(new THREE.BoxGeometry(lidR * 2, 0.12, lidR * 2), mat);
      lid.position.set(0, 0, lidR);
      lidPivot.add(lid);
      for (const px of first ? [-0.62, 0, 0.62] : [-0.55, 0, 0.55]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(first ? 0.14 : 0.12, 0.15, lidR * 2 - 0.16), trim);
        bar.position.set(px, 0.06, lidR);
        lidPivot.add(bar);
      }
      const pull = new THREE.Mesh(new THREE.TorusGeometry(first ? 0.13 : 0.14, first ? 0.03 : 0.035, 6, 14), trim);
      pull.rotation.x = Math.PI / 2;
      pull.position.set(0, 0.12, lidR * 1.7);
      lidPivot.add(pull);
      lidPivot.userData.caveEdit = { type: "hole", index: hole.id };
      this.group.add(lidPivot);
      hole.lid = lidPivot;
      hole.open = false; // eased in update (first: FTUE trapdoor; rest: earned)
      hole._lidAngle = 0; // 0 = shut over the mouth, 1 = flung up and back
    }
    this.trapdoorOpen = false; // the first mouth: shut until claimed (or instantly for old saves)

    // --- the daylight mouth: a warm shaft pouring in, a glare quad filling the
    // gap (facing the camera) and a pool of light spilling onto the floor
    // warm daylight spilling in from the mouth — the beam casts a bright pool
    // (the brightest light in the cave) that pulls the eye toward the way out
    const shaft = makeLightShaft({ color: 0xfff0c0, length: 5.2, topWidth: 0.7, bottomWidth: 2.8, opacity: 0.5, tilt: 0.3, spin: 0.4, motes: 16, always: true, light: { intensity: 3.4, range: 12, decay: 1.5, y: -3.0 } });
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
    this.glare.userData.caveEdit = { type: "exit", index: 0 };
    this.exitObj = this.glare;
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

    // two big rocks flanking the daylight mouth, framing the way in/out —
    // free-placed props (editor grab handles), positions authored in layout.json
    if (dungeonAssetsReady()) {
      this.rockDefs.forEach((def, i) => {
        const rock = cloneModel("rubble");
        if (!rock) return;
        rock.scale.multiplyScalar(2.1 * (def.s ?? 1)); // 0.18 → ~0.38 base, a chunky boulder pile
        rock.position.set(def.x, 0, def.z);
        rock.rotation.y = def.yaw ?? 0;
        rock.userData.caveEdit = { type: "rock", index: i };
        this.colliders.push(modelCollider(rock, CAVE_ORIGIN));
        this.group.add(rock);
        this.rockObjs.push(rock);
      });
    }

    // --- set dressing: the warren's billboard mix plus the kit's props, kept
    // clear of the mouths (and the row before them), the wake-up spot and the
    // walk down the tunnel to the light
    const skip = [SPAWN_CELL, { x: this.exitCell.x, y: this.exitCell.y },
      ...this.holeCells.map((h) => ({ x: h.gx, y: h.gy })),
      ...this.holeCells.map((h) => ({ x: h.gx, y: h.gy + 1 })),
      ...[4, 5].map((y) => ({ x: SPAWN_CELL.x, y })), // the FTUE slime-kill runway
      ...[5, 6, 7, 8, 9].map((y) => ({ x: this.exitCell.x, y }))];
    scatterDungeonDecor(this.group, r, [CHAMBER, TUNNEL], cellPos, { skip, theme: HOLE_THEMES[0].decor });
    for (const pr of scatterAssetProps(this.group, r, [CHAMBER, TUNNEL], cellPos, { skip, origin: CAVE_ORIGIN }))
      this.colliders.push(pr.collider);

    // opt the cave geometry into the hero's carried torch (light layer 1) so the
    // lantern pool lands on the walls, floor and props (critters opt in on
    // spawn; the local player stays out — see engine.torch)
    this.group.traverse((o) => o.layers.enable(1));
  }

  _spawnRats() {
    // a couple of harmless rats pottering about — pure ambience, they only
    // scurry off when the player barrels near (one dash fells them: dashHit)
    for (const [gx, gy, seed] of [[6, 4, 11], [4, 4, 23]]) {
      const c = new Creature(ratSpec({ key: `cave_rat_${seed}`, seed, scale: 0.55 }));
      c.position.copy(cellPos(gx, gy)).add(CAVE_ORIGIN);
      c.heading = Math.random() * Math.PI * 2;
      this.game.engine.scene.add(c);
      this.rats.push({ creature: c, tx: c.position.x, tz: c.position.z, pause: 1 + Math.random() * 2 });
    }
  }

  // Swing the first mouth's trapdoor. `instant` snaps the pose — returning
  // players boot with it already open; the FTUE opens it with a creak and a
  // puff of dust the moment the player walks back in to delve.
  setTrapdoorOpen(open, instant = false) {
    if (this.trapdoorOpen === open) return;
    this.trapdoorOpen = open;
    if (instant) {
      const first = this.holes[0];
      first.open = open;
      first._lidAngle = open ? 1 : 0;
      first.lid.rotation.x = -first._lidAngle * 1.9;
    } else if (open) {
      this.game.particles.burst(
        this.descentPos.clone().setY(0.3),
        { color: 0x8a6a4a, n: 12, speed: 2.2, up: 1.6, gravity: 4, life: 0.5, size: 0.9 }
      );
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

  // A lone rat out in the light with the hero and the slime — potters along the
  // sliver of floor south of the fog (so it never wanders into the dark or the
  // fence), right on the path out, ready for the FTUE's throwaway dash-kill.
  spawnFtueRat() {
    if (this._ftueRat) return this._ftueRat;
    const zone = { x: 4, y: 8, w: 3, h: 2 }; // the lit tunnel by the daylight mouth
    const c = new Creature(ratSpec({ key: "cave_ftue_rat", seed: 77, scale: 0.55 }));
    c.position.copy(cellPos(5, 9)).add(CAVE_ORIGIN); // out in the light, right by the entrance
    c.heading = Math.random() * Math.PI * 2;
    this.game.engine.scene.add(c);
    const rat = { creature: c, tx: c.position.x, tz: c.position.z, pause: 0.6, zone };
    this.rats.push(rat);
    this._ftueRat = rat;
    return rat;
  }

  // Raise (or drop) the FTUE fog: a thick black bank drifting across the whole
  // chamber behind the hero, sealing the four mouths out of sight, plus an
  // invisible fence at the fog's lip so once control unlocks he can't stroll
  // back into the dark. Only the first-run opener asks for it; it's cleared the
  // moment the hero steps out into the daylight.
  setFtueVeil(on) {
    if (on) { if (!this.veil) this._buildVeil(); return; }
    if (!this.veil) return;
    this.group.remove(this.veil.group);
    this.veil.group.traverse((o) => { o.material?.dispose?.(); o.geometry?.dispose?.(); });
    const i = this.colliders.indexOf(this.veil.wall);
    if (i >= 0) this.colliders.splice(i, 1);
    this.veil = null;
  }

  _buildVeil() {
    const group = new THREE.Group();
    const tex = fogPuffTexture();
    const r = rng(4242);
    const puffs = [];
    // one dark puff — stacked, they read as one rolling black mass. depthTest
    // stays ON so the fog is correctly occluded by anything nearer the camera
    // (namely the hero, who wakes just south of the lip): with it off, the bank
    // painted straight over his head. The bank sits at the chamber's south lip,
    // frontmost of the mouths/shafts/walls it hides, so depth-testing still
    // covers them cleanly. depthWrite stays off so overlapping puffs blend.
    const addPuff = (x, y, z, sc, op) => {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0x04040a, transparent: true,
        opacity: op, depthWrite: false, depthTest: true, fog: false,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(x, y, z);
      s.scale.set(sc, sc, 1);
      s.renderOrder = 20; // over the mouth shafts and walls in the same band
      s.raycast = () => {};
      s.userData = { bx: x, by: y, bz: z };
      group.add(s);
      puffs.push(s);
    };
    // the boundary the player actually sees: a row of puffs standing along the
    // fog lip. With depth-testing on, only this front row survives (the loose
    // scatter behind gets clipped by the cave geometry), so the ragged crown
    // has to live here — each column's top puff juts up by a jittered amount,
    // with a little scale/x wobble, so the silhouette reads as a rolling,
    // uneven bank rather than a ruler-straight wall. (the wave in update()
    // keeps it alive)
    const HALF = 12, COLS = 13, ROWS = 4;
    for (let c = 0; c <= COLS; c++) {
      const x = -HALF + (2 * HALF) * (c / COLS);
      const lift = r() * 1.6; // how high this column's crown juts above the rest
      for (let row = 0; row < ROWS; row++) {
        const top = row === ROWS - 1;
        const y = 0.5 + row * 1.5 + (top ? lift : 0);
        const sc = 4.0 + (top ? r() * 1.8 : 0) + (r() - 0.5) * 0.7;
        addPuff(x + (r() - 0.5) * 1.3, y, VEIL_EDGE_Z + (r() - 0.5) * 0.6, sc, 0.82);
      }
    }
    // fill packed in behind it (north, out of sight) — this is the part that
    // guarantees the mouths and walls never poke through, so it can stay loose
    for (let i = 0; i < 55; i++)
      addPuff((r() - 0.5) * 26, 0.2 + r() * 5.2, VEIL_EDGE_Z - 1.2 - r() * 8, 4 + r() * 1.6, 0.7);
    // a matching bank framing the daylight — thick black on the walls flanking
    // and behind the way out, the bright gap itself left clear so it still reads
    // as the exit
    const exitZ = this.exitPos.z - CAVE_ORIGIN.z; // local
    for (let i = 0; i < 46; i++) {
      const side = r() < 0.5 ? -1 : 1;
      addPuff(side * (3.4 + r() * 9), 0.2 + r() * 5.0, exitZ - 2 + r() * 6, 4 + r() * 1.5, 0.62);
    }
    this.group.add(group);
    // the invisible fence: a wide, thin box across the chamber at the fog's lip
    const wall = { x: CAVE_ORIGIN.x, z: VEIL_WALL_Z + CAVE_ORIGIN.z, hw: 12, hd: 0.5 };
    this.colliders.push(wall);
    this.veil = { group, puffs, wall };
  }

  // The player's dash swept through here: fell any rat it caught — they're
  // prey, not foes, so one hit does it. The game hook handles the loot juice
  // (and the hero's sheepish first-kill line).
  dashHit(attacker, reachOverride) {
    const pos = attacker.position;
    const reach = reachOverride ?? attacker.radius + 0.5;
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

  // Fresh wander target inside the rat's home zone (the chamber by default; the
  // FTUE's lit-strip rat keeps to the sliver of floor south of the fog so it
  // doesn't shove against the invisible fence), a comfortable step from where
  // the rat stands now (world coords).
  _ratTarget(rat) {
    const zone = rat.zone || CHAMBER;
    const gx = zone.x + 0.5 + Math.random() * Math.max(0, zone.w - 1);
    const gy = zone.y + 0.5 + Math.random() * Math.max(0, zone.h - 1);
    const p = cellPos(gx, gy).add(CAVE_ORIGIN);
    rat.tx = p.x;
    rat.tz = p.z;
  }

  update(dt, elapsed) {
    // the cave group lives in the scene permanently, so its shaft lights would
    // otherwise be counted (and cost shader cycles) everywhere, including the
    // shop far away — only let them contribute while the player's actually here
    const inCave = this.game.playerArea === "cave";
    if (this._litArea !== inCave) {
      for (const s of this.shafts) { const l = s.userData.light; if (l) l.visible = inCave; }
      this._litArea = inCave;
    }
    if (!inCave) return;
    // walls dither away between the camera and the hero, plus the creatures in
    // here (the FTUE slime and any live rats), so none get tucked behind a wall
    const occluders = this.rats.filter((r) => !r.creature.dead).map((r) => r.creature);
    if (this.slime && !this.slime.dead) occluders.push(this.slime);
    feedOccluder(this._wallMat, this.game.player, this.game.engine.camera, 0.6, occluders);
    for (const s of this.shafts) s.userData.update(dt, elapsed);

    // ease every lid toward its pose (swings up and back): the first follows
    // the FTUE trapdoor flag, the deeper three are open while their shortcut
    // is unsealed (the game tracks the wall-clock expiry)
    for (const hole of this.holes) {
      hole.open = hole.id === 0 ? this.trapdoorOpen : this.game._shortcutOpen(hole.id);
      const tgt = hole.open ? 1 : 0;
      hole._lidAngle += (tgt - hole._lidAngle) * Math.min(1, dt * 5);
      hole.lid.rotation.x = -hole._lidAngle * 1.9;
    }
    // with the south wall gone the glare shows face-on — keep it soft enough
    // that the floor still reads through the daylight
    this.glare.material.opacity = 0.5 + Math.sin(elapsed * 1.7) * 0.1;

    // the FTUE fog bank breathes as one: a single wave travelling along its
    // length (phase tied to x) so the whole wall rolls coherently in place
    if (this.veil) {
      for (const s of this.veil.puffs) {
        const u = s.userData;
        const w = elapsed * 0.7 + u.bx * 0.4;
        s.position.x = u.bx + Math.sin(w) * 0.45;
        s.position.y = u.by + Math.cos(w * 0.9) * 0.3;
        s.position.z = u.bz + Math.sin(w * 0.6) * 0.22;
      }
    }

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

  // Tear the whole cave back down — the game never does this (it's built once
  // and permanent), but the level editor's cave preview rebuilds on demand.
  dispose() {
    if (this.slime) { this.slime.dispose(); this.slime = null; }
    for (const rat of this.rats) rat.creature.dispose();
    this.rats.length = 0;
    this._ftueRat = null;
    this.setFtueVeil(false);
    for (const s of this.shafts) s.userData.dispose?.();
    this.shafts.length = 0;
    this.game.engine.scene.remove(this.group);
    this.group.traverse((o) => { o.material?.dispose?.(); o.geometry?.dispose?.(); });
  }
}
