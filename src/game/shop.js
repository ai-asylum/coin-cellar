// The shop: a cosy room with display tables, a vitrine window on the
// shopfront, a counter, a bed, and a trapdoor to the dungeon below. During
// the day, procedurally generated customers arrive in waves, wander the
// floor browsing a few items, and — if something catches their eye — haggle.
// The Recettear loop: buy low in the dungeon, pin the price just under each
// customer's hidden tolerance, chain PERFECT deals.
import * as THREE from "three";
import { makeToonMaterial, makeBlobShadow, feedOccluder } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { BlockyCreature, variantForSeed, HARD_SEED } from "../chargen/blocky.js";
import { ITEMS, itemSprite, LOOT_BY_TIER } from "./items.js";
import { populateStreet } from "./decor.js";
import { rng, pick, clamp } from "../core/engine.js";

export const ARCHETYPES = [
  // `buy` = chance they actually make an offer once they've browsed
  { name: "Cheapskate", moods: "faceRoll", lo: 1.02, hi: 1.18, w: 3, buy: 0.5 },
  { name: "Regular", moods: "faceHappy", lo: 1.1, hi: 1.4, w: 5, buy: 0.62 },
  { name: "Wealthy", moods: "faceMonocle", lo: 1.3, hi: 1.75, w: 2, buy: 0.74 },
  { name: "Collector", moods: "faceStar", lo: 1.5, hi: 2.2, w: 1, buy: 0.88 },
];

const MAX_CUSTOMERS = 6;
const SELLER_CHANCE = 0.3; // fraction of shoppers who come to sell, not buy

export const SHOP = {
  W: 13,
  D: 11,
};

export class Shop {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
    this.slots = []; // display slots: {pos, tableMesh, item, mesh}
    this.customers = [];
    this.passersby = []; // ambient pedestrians strolling the street outside
    this.shafts = []; // god-ray light shafts (animated each frame)
    this.lampLights = []; // interior lamp point-lights, lit after dusk
    this._shaftCol = new THREE.Color(0xffe0a2); // eased tint shared by the shafts
    this._litInit = false; // snap the daylight to the current hour on first tick
    this.colliders = []; // {x, z, hw, hd} AABBs (walls & furniture)
    this._custSeedPool = Array.from({ length: 10 }, (_, i) => 1000 + i);
    // the shop trades all day now: shoppers trickle in on a steady timer for as
    // long as anything's on the shelves — no manual "open up", no rush/close.
    // The pace quickens as the town fills out (each restored house = a resident).
    this._spawnT = 3; // countdown to the next arrival
    this._passerT = 2; // countdown to the next passer-by
    this._queueSeq = 0; // monotonic ticket number for the counter queue order
    this._build();
  }

  _build() {
    const g = this.group;
    // the enclosing walls use the same see-through cutout as the dungeon, so a
    // wall between the camera and the player dithers away instead of hiding them
    // (fed live camera + torso positions each frame in update()).
    const wallMat = makeToonMaterial({ color: 0x8a6f9e, rim: 0, occlude: true });
    const wallMat2 = makeToonMaterial({ color: 0x77608c, rim: 0, occlude: true });
    this._occludeMats = [wallMat, wallMat2];
    const woodMat = makeToonMaterial({ color: 0x8a5a33, rim: 0 });
    const wood2 = makeToonMaterial({ color: 0x6e4526, rim: 0 });
    // a drab, dusty grey shared by every un-repaired table — swapped back to the
    // table's real materials once the player pays to restore it (see repairTable).
    this._brokenMat = makeToonMaterial({ color: 0x5b554e, rim: 0 });
    // a bright emissive white the whole table wears while it's the interact
    // target, replacing the ground ring (pulsed in update(); see highlightTable).
    this._glowMat = makeToonMaterial({ color: 0xffffff, rim: 0 });
    this._glowMat.emissive = new THREE.Color(0xffffff);
    this._glowMat.emissiveIntensity = 0.8;
    this._glowTable = null; // which broken table is currently lit up
    const { W, D } = SHOP;

    // floor: warm planks (canvas texture keeps it cheap + stylised)
    const floorTex = makeFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({ map: floorTex, gradientMap: null })
    );
    g.add(floor);

    const wallH = 3;
    const mkWall = (w, h, d, x, y, z, mat = wallMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    // side walls — each carries a doorway through to an adjoining empty room
    // (one to the left, one to the right of the shop), so the player can stroll
    // between them and the camera re-frames on whichever room they stand in.
    const sideDoorZ = -3.5, sideDoorHW = 1.1; // doorway centre + half-width (z)
    this.sideDoorZ = sideDoorZ;
    this.sideDoorHW = sideDoorHW;
    const gapBack = sideDoorZ - sideDoorHW, gapFront = sideDoorZ + sideDoorHW;
    for (const sx of [-W / 2, W / 2]) {
      // wall split into a back piece and a front piece, leaving the door gap
      mkWall(0.4, wallH, gapBack - -D / 2, sx, wallH / 2, (-D / 2 + gapBack) / 2, wallMat2);
      mkWall(0.4, wallH, D / 2 - gapFront, sx, wallH / 2, (gapFront + D / 2) / 2, wallMat2);
      // lintel across the top of the opening
      mkWall(0.4, wallH - 2.2, sideDoorHW * 2, sx, (2.2 + wallH) / 2, sideDoorZ, wallMat2);
      this.colliders.push(
        { x: sx, z: (-D / 2 + gapBack) / 2, hw: 0.35, hd: (gapBack + D / 2) / 2 },
        { x: sx, z: (gapFront + D / 2) / 2, hw: 0.35, hd: (D / 2 - gapFront) / 2 }
      );
    }
    // front wall (nearest the camera): one low wall so the view stays open
    mkWall(W, 1.1, 0.35, 0, 0.55, D / 2, wallMat2);
    this.colliders.push({ x: 0, z: D / 2, hw: W / 2, hd: 0.3 });

    // back wall = the shopfront: a door on the left, a display window
    // ("vitrine") on the right. Customers stream in through the door; goods on
    // the sill face the camera so the player sees what's on show.
    const backZ = -D / 2;
    const doorW = 2.4, doorCx = -3.0;
    const winW = 3.6, winCx = 2.6, sillH = 0.95, headY = 2.5;
    const doorL = doorCx - doorW / 2, doorR = doorCx + doorW / 2;
    const winL = winCx - winW / 2, winR = winCx + winW / 2;
    const seg = (x0, x1) => mkWall(x1 - x0, wallH, 0.4, (x0 + x1) / 2, wallH / 2, backZ);
    seg(-W / 2, doorL); // left of door
    seg(doorR, winL); // between door and window
    seg(winR, W / 2); // right of window
    mkWall(winW, sillH, 0.42, winCx, sillH / 2, backZ, woodMat); // sill under window
    mkWall(winW, wallH - headY, 0.4, winCx, (headY + wallH) / 2, backZ); // header above window
    mkWall(doorW, wallH - 2.3, 0.4, doorCx, (2.3 + wallH) / 2, backZ); // lintel over doorway
    this.colliders.push(
      { x: (-W / 2 + doorL) / 2, z: backZ, hw: (doorL + W / 2) / 2, hd: 0.35 },
      { x: (doorR + winL) / 2, z: backZ, hw: (winL - doorR) / 2, hd: 0.35 },
      { x: (winR + W / 2) / 2, z: backZ, hw: (W / 2 - winR) / 2, hd: 0.35 },
      { x: winCx, z: backZ, hw: winW / 2, hd: 0.35 } // sill blocks the window
    );
    // glass pane + mullions in the opening
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(winW, headY - sillH),
      new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    glass.position.set(winCx, (sillH + headY) / 2, backZ + 0.12);
    g.add(glass);
    for (const mx of [winL, winCx, winR]) {
      mkWall(0.09, headY - sillH, 0.16, mx, (sillH + headY) / 2, backZ + 0.06, wood2);
    }

    // welcome mat just inside the door
    const doorMat = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0xb08968, rim: 0 })
    );
    doorMat.position.set(doorCx, 0.01, backZ + 0.9);
    g.add(doorMat);

    // hinged double doors filling the shopfront doorway. They swing open to let
    // customers wander in, and shut once the rush is over. Each leaf pivots
    // on its outer jamb and swings outward into the street.
    const doorPanelMat = makeToonMaterial({ color: 0x7a4a28, rim: 0 });
    const doorTrimMat = makeToonMaterial({ color: 0x5c3720, rim: 0, polygonOffset: true });
    const handleMat = makeToonMaterial({ color: 0xe6c26a, rim: 0 });
    this.doorLeaves = [];
    const mkLeaf = (hingeX, dir) => {
      const pivot = new THREE.Group();
      pivot.position.set(hingeX, 0, backZ);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.18, 0.12), doorPanelMat);
      panel.position.set(dir * 0.6, 1.12, 0);
      pivot.add(panel);
      for (const py of [1.68, 0.58]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.16), doorTrimMat);
        plank.position.set(dir * 0.6, py, 0.02);
        pivot.add(plank);
      }
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), handleMat);
      handle.position.set(dir * 1.05, 1.12, 0.11);
      pivot.add(handle);
      g.add(pivot);
      this.doorLeaves.push(pivot);
    };
    mkLeaf(doorL, 1); // left leaf, hinged on the left jamb
    mkLeaf(doorR, -1); // right leaf, hinged on the right jamb
    this.doorsOpen = true; // the shop trades all day; the shopfront swings with foot traffic
    this.doorHeld = false; // scene override: a scripted scene is holding the doors open
    this.doorLocked = false; // FTUE: fence the player inside until the Mayor's intro is done
    this._doorAngle = 0; // 0 = shut, 1 = fully swung open (eased each frame)
    // toggled in/out of `colliders` so a shut door blocks the player (kept out
    // of the baked nav grid, so open doors let customers path straight through)
    this._doorCollider = { x: doorCx, z: backZ, hw: doorW / 2, hd: 0.35 };

    // counter: a service bar in the lower-right corner, run down along Z until
    // its front end butts against the low front (downmost) wall. Kept a stride
    // off the right wall so the shopkeeper still has room to slip in behind it.
    const counterX = W / 2 - 1.9; // 4.6 — inset from the right wall
    const counterD = 3.4; // runs along Z
    const counterZ = D / 2 - counterD / 2 - 0.2; // front end touches the wall
    const counterSink = 0.4; // sunk into the floor so the bar sits low
    const counterTopY = 1.0 - counterSink;
    const regZ = counterZ + counterD / 2 - 0.7; // register near the front end
    mkWall(0.8, 1.0, counterD, counterX, 0.5 - counterSink, counterZ, woodMat);
    // a paler benchtop cap so the surface reads under the props on top
    const counterTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.1, counterD + 0.12),
      makeToonMaterial({ color: 0xa5703f, rim: 0 })
    );
    counterTop.position.set(counterX, counterTopY, counterZ);
    g.add(counterTop);
    this.colliders.push({ x: counterX, z: counterZ, hw: 0.4, hd: counterD / 2 });
    // where the shopkeeper stands to serve — behind the bar, by the register
    this.counterPos = new THREE.Vector3(counterX + 0.95, 0, regZ);

    // a brass cash register at the front end of the bar
    const register = new THREE.Group();
    const regBodyMat = makeToonMaterial({ color: 0x3c4a52, rim: 0 });
    const regTrimMat = makeToonMaterial({ color: 0xe6c26a, rim: 0 });
    const regBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.4), regBodyMat);
    regBody.position.y = 0.17;
    const regDrawer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.44), regTrimMat);
    regDrawer.position.y = 0.06;
    const regHead = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.12), regBodyMat);
    regHead.position.set(0, 0.43, -0.12);
    const regKeys = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.22), regTrimMat);
    regKeys.position.set(0, 0.3, 0.07);
    const regBell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
    regBell.position.set(0.14, 0.5, -0.12);
    register.add(regBody, regDrawer, regHead, regKeys, regBell);
    register.position.set(counterX, counterTopY, regZ);
    register.rotation.y = Math.PI / 2;
    g.add(register);

    // a small brass desk lamp toward the back of the bar — dark by day, kindled
    // warm once night falls (pushed into lampLights alongside the floor lamps)
    const cLamp = new THREE.Group();
    const cBase = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 12), regTrimMat);
    cBase.position.y = 0.02;
    const cPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5), regTrimMat);
    cPole.position.y = 0.27;
    const cShade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 12), makeToonMaterial({ color: 0x2e6b52, rim: 0 }));
    cShade.position.y = 0.58;
    const cBulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
    cBulb.position.y = 0.5;
    const cGlow = new THREE.PointLight(0xffca7a, 0, 5, 1.8);
    cGlow.position.y = 0.52;
    cLamp.add(cBase, cPole, cShade, cBulb, cGlow);
    cLamp.position.set(counterX, counterTopY, counterZ - counterD / 2 + 0.5);
    g.add(cLamp);
    this.lampLights.push(cGlow);

    // haggling customers queue in single file along the front (downmost) wall:
    // the head of the line waits in front of the register and the rest trail
    // off to the left. Once served they peel away and head up toward the door.
    this.queueSpots = [];
    const qHeadX = counterX - 1.0, qZ = D / 2 - 1.0; // hug the downmost wall
    for (let i = 0; i < MAX_CUSTOMERS; i++) {
      this.queueSpots.push(new THREE.Vector3(qHeadX - i * 0.95, 0, qZ));
    }

    // trapdoor to the dungeon (mid left)
    const trap = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 24).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0x241735, rim: 0, polygonOffset: true })
    );
    trap.position.set(-W / 2 + 1.9, 0.02, 1.2);
    g.add(trap);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.09, 8, 24).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0x8a5a33, rim: 0 })
    );
    ring.position.copy(trap.position);
    g.add(ring);
    this.trapdoorPos = trap.position.clone();
    this.portalGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7a4dff, transparent: true, opacity: 0.5, depthWrite: false })
    );
    this.portalGlow.position.copy(trap.position).setY(0.04);
    g.add(this.portalGlow);
    // pulsing "you can act here" ring, matching the delve interact colour —
    // pulses in update() and only shows while the cellar's actually open
    this.trapHint = makeFloorHint();
    this.trapHint.position.copy(trap.position).setY(0.06);
    g.add(this.trapHint);

    // hinged trapdoor lid: a heavy wooden flap that lies shut over the hole
    // while the shopfront is open for trade, and creaks open once the doors are
    // closed so the shopkeeper can drop down into the cellar. It
    // hinges on its far (back) edge and swings up toward the wall.
    const lidMat = makeToonMaterial({ color: 0x6e4526, rim: 0 });
    const lidTrim = makeToonMaterial({ color: 0x4a2c17, rim: 0, polygonOffset: true });
    const lidPivot = new THREE.Group();
    const lidR = 1.05; // covers the 0.95 hole with a little overhang
    lidPivot.position.set(trap.position.x - lidR, 0.05, trap.position.z); // hinge at the wall-side (left) edge
    const lid = new THREE.Mesh(new THREE.BoxGeometry(lidR * 2, 0.1, lidR * 2), lidMat);
    lid.position.set(lidR, 0, 0); // extend inward from the hinge over the hole
    lidPivot.add(lid);
    for (const pz of [-0.62, 0, 0.62]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(lidR * 2 - 0.14, 0.14, 0.1), lidTrim);
      plank.position.set(lidR, 0.02, pz);
      lidPivot.add(plank);
    }
    const pull = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 14), lidTrim);
    pull.rotation.x = Math.PI / 2;
    pull.position.set(lidR * 1.55, 0.11, 0);
    lidPivot.add(pull);
    g.add(lidPivot);
    this.trapLid = lidPivot;
    // 0 = shut (flat over the hole), 1 = flung fully open. Doors start closed,
    // so the cellar starts open; snap the lid + glow to match on the first tick.
    this._trapAngle = 1;
    this.trapdoorOpen = true;

    // display tables (2x2 grid, 2 slots each = 8 slots). Each table is a
    // repairable fixture: all but the first start dusty and broken (greyed out,
    // slots unusable) until the player pays to restore them — see repairTable.
    // `this.tables` groups every table's meshes + slots + repair cost so the
    // game glue can offer the "Repair" prompt and persist what's been fixed.
    this.tables = [];
    const tablePts = [
      [-1.6, 0.6], [1.6, 0.6],
      [-1.6, 3.2], [1.6, 3.2],
    ];
    tablePts.forEach(([tx, tz], ti) => {
      const t = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 1.1), woodMat);
      top.position.y = 0.78;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 0.8), wood2);
      legs.position.y = 0.36;
      t.add(top, legs);
      t.position.set(tx, 0, tz);
      g.add(t);
      this.colliders.push({ x: tx, z: tz, hw: 1.15, hd: 0.6 });
      const table = {
        group: t,
        meshes: [top, legs],
        origMats: [woodMat, wood2],
        cost: 200,
        fancy: false,
        repaired: ti === 0, // only the first shelf comes ready to stock
        slots: [],
        interactPos: new THREE.Vector3(tx, 0, tz + 1.05),
      };
      for (const dx of [-0.55, 0.55]) {
        const slot = {
          pos: new THREE.Vector3(tx + dx, 0.86, tz),
          browsePos: new THREE.Vector3(tx + dx, 0, tz + 1.05),
          // standing spots on every side of the table, so a shopper can view
          // the item from whichever side is nearest / reachable rather than
          // always squeezing to the front (see _browseSpotFor)
          browseSpots: [
            new THREE.Vector3(tx + dx, 0, tz + 1.05), // front
            new THREE.Vector3(tx + dx, 0, tz - 1.05), // back
            new THREE.Vector3(tx + 1.6, 0, tz),       // right
            new THREE.Vector3(tx - 1.6, 0, tz),       // left
          ],
          item: null,
          mesh: null,
          table,
        };
        table.slots.push(slot);
        this.slots.push(slot);
      }
      this.tables.push(table);
    });

    // the fancy vitrine table: a velvet-topped, gold-trimmed display set in
    // front of the window. Prized goods go here for a proper haggle (the plain
    // tables ring up automatically at full price). Three slots, and whatever's
    // placed on it glows (see stockItem). Replaces the old window-sill slots.
    const velvetMat = makeToonMaterial({ color: 0x6a1f2e, rim: 0 });
    const goldMat = makeToonMaterial({ color: 0xe6c26a, rim: 0 });
    const fancyCx = winCx, fancyZ = backZ + 1.7;
    const fancy = new THREE.Group();
    const fLegs = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.74, 0.9), wood2);
    fLegs.position.y = 0.37;
    const fTrim = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.12, 1.32), goldMat);
    fTrim.position.y = 0.76;
    const fTop = new THREE.Mesh(new THREE.BoxGeometry(3.34, 0.14, 1.16), velvetMat);
    fTop.position.y = 0.84;
    fancy.add(fLegs, fTrim, fTop);
    fancy.position.set(fancyCx, 0, fancyZ);
    g.add(fancy);
    this.colliders.push({ x: fancyCx, z: fancyZ, hw: 1.75, hd: 0.66 });
    // the prized vitrine is the priciest fixture to restore (1000g) and, like
    // the plain shelves, starts broken until the player pays to bring it back.
    const fancyTable = {
      group: fancy,
      meshes: [fLegs, fTrim, fTop],
      origMats: [wood2, goldMat, velvetMat],
      cost: 1000,
      fancy: true,
      repaired: false,
      slots: [],
      interactPos: new THREE.Vector3(fancyCx, 0, fancyZ + 1.15),
    };
    for (const dx of [-1.05, 0, 1.05]) {
      const slot = {
        pos: new THREE.Vector3(fancyCx + dx, 0.92, fancyZ),
        browsePos: new THREE.Vector3(fancyCx + dx, 0, fancyZ + 1.15),
        // the vitrine hugs the back wall, so its back side is walled off — the
        // reachable spots are the front and the two flanks (blocked ones are
        // filtered out in _browseSpotFor)
        browseSpots: [
          new THREE.Vector3(fancyCx + dx, 0, fancyZ + 1.15), // front
          new THREE.Vector3(fancyCx + 2.25, 0, fancyZ),      // right
          new THREE.Vector3(fancyCx - 2.25, 0, fancyZ),      // left
        ],
        item: null,
        mesh: null,
        fancy: true,
        table: fancyTable,
      };
      fancyTable.slots.push(slot);
      this.slots.push(slot);
    }
    this.tables.push(fancyTable);
    // grey out every broken fixture now the whole set is built
    for (const table of this.tables) this._applyTableState(table);

    // lamps for cosiness
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.1), wood2);
      pole.position.y = 1.05;
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 10), makeToonMaterial({ color: 0xffd98a, rim: 0 }));
      shade.position.y = 2.2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
      bulb.position.y = 2.0;
      // a real warm point light in the bulb — kept dark now the shop holds a
      // fixed bright-midday palette (see _updateLighting)
      const glow = new THREE.PointLight(0xffca7a, 0, 9, 1.6);
      glow.position.y = 2.0;
      lamp.add(pole, shade, bulb, glow);
      // tucked into the corners against the street-facing shopfront wall,
      // clear of the door (left) and display window (right)
      lamp.position.set(sx * (W / 2 - 1), 0, backZ + 0.9);
      g.add(lamp);
      this.lampLights.push(glow);
    }

    // warm afternoon sun pouring in through the doorway + a high window,
    // slanting into the room to match the low, warm key light.
    const shaftDefs = [
      { pos: [0.4, 3.4, D / 2 - 1.2], color: 0xffe0a2, length: 4.6, topWidth: 0.7, bottomWidth: 3.0, opacity: 0.42, tilt: 0.5, spin: 0.2, motes: 16 },
      { pos: [-2.4, 3.3, 1.0], color: 0xffd691, length: 4.2, topWidth: 0.5, bottomWidth: 2.3, opacity: 0.32, tilt: 0.38, spin: 0.9, motes: 12 },
      { pos: [3.6, 3.4, -D / 2 + 2.4], color: 0xffcf86, length: 4.4, topWidth: 0.5, bottomWidth: 2.2, opacity: 0.3, tilt: 0.3, spin: 0.5, motes: 10 },
    ];
    for (const d of shaftDefs) {
      const shaft = makeLightShaft(d);
      shaft.position.set(...d.pos);
      g.add(shaft);
      this.shafts.push(shaft);
    }

    // ---- the street outside the shopfront (glimpsed through door + window) --
    // Shoppers stroll along the pavement here before turning in at the door,
    // and ambient passers-by drift across without ever coming inside.
    const mkGround = (w, d, x, z, color) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        makeToonMaterial({ color, rim: 0 })
      );
      m.position.set(x, 0, z);
      g.add(m);
      return m;
    };
    const streetW = 44;
    const paveFar = backZ - 2.6; // pavement runs from the wall out to here
    const roadFar = backZ - 9.5;
    // a medieval dirt street: earthy packed-stone pavement by the shopfront and
    // a muted cobble-toned road out to the far buildings — no kerb, no lane paint.
    this.roadColor = 0x6f6558;
    mkGround(streetW, backZ - paveFar, 0, (backZ + paveFar) / 2, 0x8a7c66); // pavement
    mkGround(streetW, paveFar - roadFar, 0, (paveFar + roadFar) / 2, this.roadColor); // road
    // a shallow gutter running down the middle of the road (drainage channel)
    mkGround(streetW, 0.8, 0, (paveFar + roadFar) / 2, 0x565049).position.y = 0.004;

    // the far flanks that frame the street; the middle is taken up by the two
    // walk-in buildings built in _buildTown().
    const facadeZ = roadFar - 0.3;
    // the far flanks used to be flat painted facades; they're now the town's
    // restoration lots — run-down ruins and boarded-up empty plots the player
    // pays the Mayor's fund to rebuild into houses (see _buildLots / restoreLot).
    this._buildLots(mkWall, mkGround, facadeZ);

    // street lamps flanking the doorway
    for (const sx of [-6.5, 6.5]) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2), wood2);
      pole.position.y = 1.6;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), makeToonMaterial({ color: 0x2c2438, rim: 0 }));
      head.position.y = 3.3;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
      glow.position.y = 3.25;
      lamp.add(pole, head, glow);
      lamp.position.set(sx, 0, backZ - 1.4);
      g.add(lamp);
    }

    // lanes the pedestrians use, and the ends they enter / leave from
    this.streetHalfX = 7.5; // spawn / exit x on either side
    this.streetWalkZ = backZ - 1.3; // stroll lane (level with the doorstep)
    // the open ground ambient pedestrians are free to roam: the full width of
    // the road out front, clamped shy of the shopfront (so nobody strolls into
    // the shop) and kept in front of the far buildings (so nobody clips a wall).
    this.streetRegion = {
      xMax: 19,
      nearZ: backZ - 1.0, // nearest the shop they'll drift
      farZ: roadFar + 0.6, // out to just in front of the far buildings
    };

    this.doorPos = new THREE.Vector3(doorCx, 0, backZ - 1.3); // outside: door step
    this.doorInside = new THREE.Vector3(doorCx, 0, backZ + 1.2); // threshold just inside

    // billboard scenery lining the street outside (seeded so co-op peers match)
    populateStreet(g, rng(0xC0FFEE), { W, backZ, streetHalfX: this.streetHalfX });

    // the rest of the town: two empty rooms flanking the shop, two walk-in
    // buildings across the road, and the plaza floor beneath them all.
    this._buildTown(mkWall, mkGround, wallMat2, wood2, roadFar, streetW, wallH, backZ);

    // bake a coarse navigation grid of the shop floor so customers can route
    // around the tables & furniture instead of shoving straight through them.
    this._buildNav();
    // doors start shut: block the opening (added after nav bake so the grid
    // still treats the doorway as walkable for when they're opened)
    this.colliders.push(this._doorCollider);
  }

  // Build the rest of the town around the shop: two empty rooms flanking it
  // (entered through the doorways cut into the side walls), two walk-in
  // buildings across the road, the plaza floor, and the camera zones that lock
  // the view onto whichever room the player is standing in.
  _buildTown(mkWall, mkGround, wallMat, trimMat, roadFar, streetW, wallH, backZ) {
    const { W, D } = SHOP;

    // --- flanking rooms: two sealed spaces the player can buy their way into
    // to extend the shop. Until bought, each is a pitch-black void behind a
    // locked door set in the shared side wall; paying the fee (see game.js)
    // swings the door open and lights the room up as an extension. ---
    const roomHalfW = 4;
    const black = () => new THREE.MeshBasicMaterial({ color: 0x000000 });
    const doorPanelMat = makeToonMaterial({ color: 0x7a4a28, rim: 0 });
    const doorTrimMat = makeToonMaterial({ color: 0x5c3720, rim: 0, polygonOffset: true });
    const handleMat = makeToonMaterial({ color: 0xe6c26a, rim: 0 });
    this.expansions = [];
    this._townWallMat = wallMat; // restored onto a room's walls when it's bought
    for (const side of [-1, 1]) {
      const cx = side * (W / 2 + roomHalfW); // room centre x
      // floor + the three enclosing walls, all blacked out until the room's bought
      const floor = mkGround(roomHalfW * 2, D, cx, 0, 0);
      floor.material = black();
      const outerWall = mkWall(0.4, wallH, D, cx + side * roomHalfW, wallH / 2, 0, wallMat);
      const backWall = mkWall(roomHalfW * 2, wallH, 0.4, cx, wallH / 2, -D / 2, wallMat);
      const frontWall = mkWall(roomHalfW * 2, 1.1, 0.35, cx, 0.55, D / 2, wallMat);
      const litColor = side < 0 ? 0x8a7a5f : 0x86748f; // floor colour once bought
      const dark = [outerWall, backWall, frontWall];
      for (const m of dark) m.material = black();
      // the rug, hidden until the room is opened up
      const rugMesh = mkGround(2.6, 1.7, cx, 1.4, side < 0 ? 0x6a4f6a : 0x4f5f6a);
      rugMesh.position.y = 0.02;
      rugMesh.visible = false;
      this.colliders.push(
        { x: cx + side * roomHalfW, z: 0, hw: 0.35, hd: D / 2 },
        { x: cx, z: -D / 2, hw: roomHalfW, hd: 0.35 },
        { x: cx, z: D / 2, hw: roomHalfW, hd: 0.3 }
      );

      // a hinged door filling the shared-wall opening. Hinges on the back jamb
      // and swings into the room. A collider bars the doorway while it's locked.
      const hingeZ = this.sideDoorZ - this.sideDoorHW;
      const pivot = new THREE.Group();
      pivot.position.set(side * W / 2, 0, hingeZ);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.18, this.sideDoorHW * 2), doorPanelMat);
      panel.position.set(0, 1.09, this.sideDoorHW);
      pivot.add(panel);
      for (const pz of [this.sideDoorHW * 0.55, this.sideDoorHW * 1.45]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, this.sideDoorHW * 1.4), doorTrimMat);
        plank.position.set(side * 0.02, 1.55, pz);
        pivot.add(plank);
      }
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), handleMat);
      handle.position.set(side * 0.1, 1.09, this.sideDoorHW * 1.8);
      pivot.add(handle);
      this.group.add(pivot);
      const doorCollider = { x: side * W / 2, z: this.sideDoorZ, hw: 0.35, hd: this.sideDoorHW };
      this.colliders.push(doorCollider);

      this.expansions.push({
        side,
        cost: 2000,
        unlocked: false,
        floor, litColor,
        walls: dark,
        rug: rugMesh,
        pivot,
        doorCollider,
        _doorA: 0, // eased 0 = shut, 1 = swung open
        interactPos: new THREE.Vector3(side * (W / 2 - 1.0), 0, this.sideDoorZ),
      });
    }

    // --- the far side of the street is now an unbroken row of restoration lots
    // (built in _buildLots): no more walk-in buildings hogging the middle. Just
    // an open plaza rolling back to the line of houses the player rebuilds. ---
    const backLimit = roadFar - 3.0; // ground stops just behind the row of houses

    // plaza floor so the whole town has ground underfoot past the road (sunk a
    // hair so it never z-fights the road / lot footprints sitting on top)
    const plaza = mkGround(streetW, roadFar - backLimit, 0, (roadFar + backLimit) / 2, this.roadColor);
    plaza.position.y = -0.03;

    // camera zones: standing inside one locks the camera to its centre (like
    // the shop); out on the open street/plaza the camera follows the player.
    this.zones = [
      { minX: -W / 2, maxX: W / 2, minZ: -D / 2 - 0.4, maxZ: 9, cx: 0, cz: 0 }, // shop
      { minX: -W / 2 - roomHalfW * 2, maxX: -W / 2, minZ: -D / 2 - 0.4, maxZ: 9, cx: -(W / 2 + roomHalfW), cz: 0 }, // left room
      { minX: W / 2, maxX: W / 2 + roomHalfW * 2, minZ: -D / 2 - 0.4, maxZ: 9, cx: W / 2 + roomHalfW, cz: 0 }, // right room
    ];
    // walkable fence for the whole town: the road out front is free to roam
    // corner to corner (colliders do the fine work — walls and the lot
    // footprints). Beside the rooms there's no ground north of the shopfront
    // line, so seal those two flanks with an invisible wall along it.
    const roomOuter = W / 2 + roomHalfW * 2; // outer edge of the flanking rooms
    const edgeX = streetW / 2 - 1.0; // road's walkable half-width
    for (const s of [-1, 1]) {
      this.colliders.push({ x: s * (roomOuter + edgeX) / 2, z: backZ, hw: (edgeX - roomOuter) / 2, hd: 0.35 });
    }
    this.bounds = {
      minX: -edgeX,
      maxX: edgeX,
      minZ: backLimit + 0.5,
      maxZ: D / 2 + 2.5,
    };
  }

  // Buy your way into a flanking room: swing its door open for good, lift the
  // doorway collider so the player can stroll through, and light the room up
  // (floor, walls and rug) so it reads as an extension of the shop. `instant`
  // skips the swing (used when restoring a saved purchase on load).
  unlockExpansion(i, instant = false) {
    const ex = this.expansions && this.expansions[i];
    if (!ex || ex.unlocked) return;
    ex.unlocked = true;
    ex.floor.material = makeToonMaterial({ color: ex.litColor, rim: 0 });
    for (const w of ex.walls) w.material = this._townWallMat;
    ex.rug.visible = true;
    this.colliders = this.colliders.filter((c) => c !== ex.doorCollider);
    if (instant) {
      ex._doorA = 1;
      ex.pivot.rotation.y = ex.side * 1.7;
    }
  }

  // ---- town restoration lots -----------------------------------------------
  // The run-down flanks of the street: four sites the player rebuilds with the
  // Mayor's fund. Two start as boarded-up empty plots (fenced dirt), two as
  // stone ruins. Each holds a hidden finished-house model that's revealed when
  // restored; a new resident then moves in (a distinct customer archetype who
  // shops here, quickening and enriching the foot traffic — see _spawnCustomer).
  _buildLots(mkWall, mkGround, facadeZ) {
    this.lots = [];
    const toon = (color) => makeToonMaterial({ color, rim: 0 });
    const litWin = () => new THREE.MeshBasicMaterial({ color: 0xffdf9c });
    // cx, kind, cost, resident archetype index (into ARCHETYPES). An unbroken
    // row of houses across the street now that the walk-in buildings are gone —
    // cheapest plots near the middle, pricier ruins out on the flanks.
    const defs = [
      { cx: -4.8, kind: "plot", cost: 100, resident: 1 }, // Regular — the Mayor's first ask, one good sale covers it
      { cx: 4.8, kind: "plot", cost: 700, resident: 1 }, // Regular
      { cx: -9.6, kind: "plot", cost: 1200, resident: 2 }, // Wealthy
      { cx: 9.6, kind: "plot", cost: 1800, resident: 2 }, // Wealthy
      { cx: -14.4, kind: "ruin", cost: 3000, resident: 2 }, // Wealthy
      { cx: 14.4, kind: "ruin", cost: 4500, resident: 3 }, // Collector
      { cx: -19.2, kind: "ruin", cost: 7000, resident: 3 }, // Collector
      { cx: 19.2, kind: "ruin", cost: 9500, resident: 3 }, // Collector
    ];
    const z0 = facadeZ - 0.6; // footprint sits just behind the old facade line
    for (const def of defs) {
      const { cx } = def;
      const before = new THREE.Group();
      const after = new THREE.Group();
      after.visible = false;
      this.group.add(before, after);

      // --- finished house (revealed on restore) -----------------------------
      const bodyCol = def.resident >= 3 ? 0xa87ab0 : def.resident >= 2 ? 0x7d9bd0 : 0xcbb489;
      const roofCol = def.resident >= 3 ? 0x6a3b6f : def.resident >= 2 ? 0x39557f : 0x9a4a3a;
      after.add(mkWall(3.6, 2.6, 2.6, cx, 1.3, z0, toon(bodyCol)));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.5, 4), toon(roofCol));
      roof.rotation.y = Math.PI / 4;
      roof.position.set(cx, 3.35, z0);
      after.add(roof);
      after.add(mkWall(0.9, 1.6, 0.12, cx, 0.8, z0 + 1.34, toon(0x5c3720))); // door
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.12), litWin());
      win.position.set(cx + 1.05, 1.5, z0 + 1.34);
      after.add(win);
      const chimney = mkWall(0.5, 1.0, 0.5, cx + 1.0, 3.4, z0 - 0.3, toon(0x6e4526));
      after.add(chimney);

      // --- ruined / empty-plot "before" state -------------------------------
      const dirt = mkGround(3.8, 2.8, cx, z0, def.kind === "ruin" ? 0x4a4038 : 0x6b5a45);
      dirt.position.y = 0.02;
      before.add(dirt);
      if (def.kind === "ruin") {
        // a few broken stone wall stubs + scattered rubble
        for (const [dx, h] of [[-1.3, 1.5], [1.2, 1.0], [0.1, 0.6]]) {
          before.add(mkWall(0.6, h, 0.6, cx + dx, h / 2, z0 - 0.4, toon(0x6a6258)));
        }
        for (let k = 0; k < 5; k++) {
          const s = 0.25 + Math.random() * 0.3;
          before.add(mkWall(s, s, s, cx + (Math.random() - 0.5) * 3, s / 2, z0 + (Math.random() - 0.5) * 2, toon(0x585048)));
        }
      } else {
        // boarded-up empty plot: a low picket fence around the dirt + a sign post
        const fenceMat = toon(0x8a6a44);
        for (let fx = cx - 1.7; fx <= cx + 1.7; fx += 0.85) {
          before.add(mkWall(0.12, 0.9, 0.12, fx, 0.45, z0 + 1.3, fenceMat)); // front posts
        }
        before.add(mkWall(3.6, 0.12, 0.12, cx, 0.7, z0 + 1.3, fenceMat)); // front rail
        before.add(mkWall(0.16, 1.4, 0.16, cx, 0.7, z0 + 1.3, toon(0x5c4a30))); // sign post
        const board = mkWall(1.2, 0.7, 0.1, cx, 1.3, z0 + 1.3, litWin());
        before.add(board);
      }

      // seal the flank (as the old facade did) and never let anyone walk the lot
      const collider = { x: cx, z: z0, hw: 2.0, hd: 1.5 };
      this.colliders.push(collider);

      this.lots.push({
        ...def,
        before, after, collider,
        restored: false,
        interactPos: new THREE.Vector3(cx, 0, facadeZ + 1.7), // stand on the road side
      });
    }
  }

  // Rebuild lot `i`: hide the ruin/plot, reveal the finished house. `instant`
  // skips the little poof (used when replaying saved restorations on load).
  restoreLot(i, instant = false) {
    const lot = this.lots && this.lots[i];
    if (!lot || lot.restored) return;
    lot.restored = true;
    lot.before.visible = false;
    lot.after.visible = true;
    if (!instant) {
      this.game.audio.chest();
      this.game.engine.shake(0.15);
    }
  }

  // Which camera zone the player is standing in (locks the view onto its
  // centre), or null when out on the street/plaza (the camera follows instead).
  zoneCenter(pos) {
    for (const z of this.zones) {
      if (pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ) return z;
    }
    return null;
  }

  // Vestigial now that the shop trades all day — the shopfront simply swings
  // with foot traffic (see update()). Kept as a no-op so the co-op state sync
  // has something to call.
  setDoorsOpen(open) {
    this.doorsOpen = !!open;
  }

  // Colliders the *player* is fenced by: the shared walls/furniture, plus the
  // shopfront doorway while it's FTUE-locked — even when the leaves are swung
  // open for a scripted customer. Customers and the Mayor keep reading the base
  // `colliders`, so they still path through the doorway freely.
  get playerColliders() {
    if (this.doorLocked && !this.colliders.includes(this._doorCollider))
      return [...this.colliders, this._doorCollider];
    return this.colliders;
  }

  // ------------------------------------------------------------ tables
  // Reflect a table's repaired/broken state onto its meshes (real materials vs
  // the drab grey) and its slots (a broken table's slots can't be stocked).
  _applyTableState(table) {
    const broken = !table.repaired;
    table.meshes.forEach((m, k) => { m.material = broken ? this._brokenMat : table.origMats[k]; });
    for (const s of table.slots) s.disabled = broken;
  }

  // Light one broken table up white (the interact affordance, in place of the
  // ground ring), or pass null/undefined to clear. Its meshes swap to the
  // pulsing emissive-white material; the previously lit table is restored to
  // whatever its state calls for (grey if still broken, real wood once fixed).
  highlightTable(table) {
    const next = table || null;
    if (this._glowTable === next) return;
    if (this._glowTable) this._applyTableState(this._glowTable);
    this._glowTable = next;
    if (next) for (const m of next.meshes) m.material = this._glowMat;
  }

  // Pay to restore table `i`: swap its dusty grey for the real wood/velvet and
  // free its slots for stock. `instant` skips the poof (used when replaying a
  // saved purchase on load).
  repairTable(i, instant = false) {
    const table = this.tables && this.tables[i];
    if (!table || table.repaired) return;
    if (this._glowTable === table) this._glowTable = null; // stop lighting it
    table.repaired = true;
    this._applyTableState(table);
    if (!instant) {
      this.game.audio.chest();
      this.game.engine.shake(0.14);
    }
  }

  // ------------------------------------------------------------ stocking
  // The first empty, usable slot — skips slots on tables still awaiting repair.
  freeSlot() {
    return this.slots.find((s) => !s.item && !s.disabled);
  }

  stockItem(itemId, slot = this.freeSlot()) {
    if (!slot || slot.item || slot.disabled) return false;
    slot.item = itemId;
    slot.mesh = itemSprite(itemId);
    slot.mesh.position.copy(slot.pos);
    slot.mesh.scale.setScalar(1.4);
    this.group.add(slot.mesh);
    // the velvet table makes its wares shimmer with a shader glow
    if (slot.fancy) {
      slot.glow = makeGlow();
      slot.glow.position.copy(slot.pos).setY(slot.pos.y + 0.3);
      this.group.add(slot.glow);
    }
    return true;
  }

  unstockSlot(slot) {
    if (slot.mesh) slot.mesh.removeFromParent();
    if (slot.glow) { slot.glow.removeFromParent(); slot.glow = null; }
    const id = slot.item;
    slot.item = null;
    slot.mesh = null;
    return id;
  }

  stockedCount() {
    return this.slots.filter((s) => s.item).length;
  }

  // ------------------------------------------------------------ customers
  update(dt, elapsed) {
    // idle slot sparkle
    this.portalGlow.material.opacity = 0.35 + Math.sin(elapsed * 2.5) * 0.15;
    for (const s of this.shafts) s.userData.update(dt, elapsed);
    this._updateLighting(dt);

    // throb the white glow on whichever broken table is the current target
    if (this._glowTable) this._glowMat.emissiveIntensity = 0.55 + Math.sin(elapsed * 6) * 0.45;

    // feed the see-through wall cutout so walls never hide the player
    const player = this.game.player;
    if (player) for (const m of this._occludeMats) feedOccluder(m, player, this.game.engine.camera);

    // shimmer the fancy-table glows: advance their shader clock and keep each
    // billboarded at the camera so the halo always faces the player
    const cam = this.game.engine.camera;
    for (const slot of this.slots) {
      if (!slot.glow) continue;
      slot.glow.userData.mat.uniforms.uTime.value = elapsed;
      if (cam) slot.glow.quaternion.copy(cam.quaternion);
    }

    // Hold the doorway open while anyone's still inside so closing up lets
    // every customer run out before the leaves swing shut behind them. Once a
    // shopper has crossed the threshold onto the street they no longer hold it —
    // the doors shut right behind the last one instead of waiting for the whole
    // crowd to stroll off down the block.
    // the player can walk out onto the street: the shopfront swings open (and
    // its collider lifts, below) whenever they step up to it, day or night.
    const pp = this.game.player && this.game.player.position;
    const playerNear = !!pp && (pp.distanceTo(this.doorInside) < 2.0 || pp.distanceTo(this.doorPos) < 2.6);
    // while the shopfront's locked for the FTUE the player can't nudge it open by
    // walking up — only a scripted customer streaming in (or a held-open scene)
    // still swings it, so it reads as firmly shut until the Mayor's intro ends.
    const wantOpen = this.customers.some((c) => !c._outside) || this.doorHeld || (playerNear && !this.doorLocked);

    // ease the shopfront doors toward their open/shut pose
    const doorTgt = wantOpen ? 1 : 0;
    this._doorAngle += (doorTgt - this._doorAngle) * Math.min(1, dt * 7);
    if (this.doorLeaves) {
      const a = this._doorAngle * 2.1; // ~120° when fully open
      this.doorLeaves[0].rotation.y = a;
      this.doorLeaves[1].rotation.y = -a;
    }

    // ease each bought expansion door open (they swing into their room and stay)
    if (this.expansions) {
      for (const ex of this.expansions) {
        const tgt = ex.unlocked ? 1 : 0;
        if (Math.abs(ex._doorA - tgt) < 0.001) continue;
        ex._doorA += (tgt - ex._doorA) * Math.min(1, dt * 6);
        ex.pivot.rotation.y = ex.side * ex._doorA * 1.7; // swing into the room
      }
    }

    // The cellar trapdoor stands open all day (decoupled from the shopfront,
    // which trades continuously) so you can drop down whenever you like.
    this._trapAngle += (1 - this._trapAngle) * Math.min(1, dt * 5);
    if (this.trapLid) this.trapLid.rotation.z = this._trapAngle * 1.9; // swings up to lean on the left wall
    this.trapdoorOpen = this._trapAngle > 0.5;
    // the glowing shaft below only shows once the lid's cracked open
    this.portalGlow.visible = this._trapAngle > 0.06;

    // pulse the interact-affordance rings and gate them on whether that spot is
    // actually usable right now: the trapdoor while the cellar's open, the doors
    // while they're shut (an open, customer-filled doorway needs no prompt).
    const pulse = Math.sin(elapsed * 3);
    // once the player's close enough to trigger the interact ring on this spot,
    // hide our faint hint donut so the two rings don't stack.
    const hl = this.game.highlight;
    const hlOn = (p) => hl && hl.visible && hl.position.distanceTo(p) < 1.2;
    if (this.trapHint) {
      this.trapHint.visible = this.trapdoorOpen && !hlOn(this.trapdoorPos);
      this.trapHint.material.opacity = 0.16 + pulse * 0.08;
      const s = 1 + pulse * 0.08;
      this.trapHint.scale.set(s, 1, s);
    }
    // the doorway only blocks the player once it's actually shut (no customers
    // left to path out through it)
    const hasDoorCollider = this.colliders.includes(this._doorCollider);
    if (!wantOpen && !hasDoorCollider) this.colliders.push(this._doorCollider);
    else if (wantOpen && hasDoorCollider) this.colliders = this.colliders.filter((c) => c !== this._doorCollider);

    // ambient street life runs on every client (purely cosmetic, unsynced)
    this._updatePassersby(dt, elapsed);

    const game = this.game;
    if (game.net.isGuest) {
      for (const c of this.customers) c.creature.update(dt, elapsed);
      return;
    }

    // customers trickle in all day for as long as there's stock on the shelves
    if (!game.gameOver) this._pumpFlow(dt);

    for (const cust of [...this.customers]) {
      this._updateCustomer(cust, dt, elapsed);
    }
  }

  // Light the shop in a fixed bright-midday palette (no more day/night cycle),
  // and hold a fixed moody palette down in the dungeon so descending never
  // looks like broad daylight.
  _updateLighting(dt) {
    const game = this.game;
    const eng = game.engine;

    // resolve the target palette for the current place
    const p = game.playerArea === "dungeon" ? DUNGEON_PAL : SHOP_PAL;
    _tSky.copy(p.sky); _tGround.copy(p.ground); _tSun.copy(p.sun); _tBg.copy(p.bg); _tShaft.copy(p.shaft);
    const hemiI = p.hemiI, sunI = p.sunI;

    // ease toward it (snap on the very first tick to avoid a startup sweep)
    const k = this._litInit ? 1 - Math.pow(0.0016, dt) : 1;
    this._litInit = true;
    eng.hemi.color.lerp(_tSky, k);
    eng.hemi.groundColor.lerp(_tGround, k);
    eng.hemi.intensity += (hemiI - eng.hemi.intensity) * k;
    eng.sun.color.lerp(_tSun, k);
    eng.sun.intensity += (sunI - eng.sun.intensity) * k;
    if (eng.scene.background?.isColor) {
      eng.scene.background.lerp(_tBg, k);
      if (eng.scene.fog) eng.scene.fog.color.copy(eng.scene.background);
    }
    this._shaftCol.lerp(_tShaft, k);
    for (const s of this.shafts) s.userData.setColor(this._shaftCol);

    // interior lamps stay dark — the fixed midday sun does all the work
    for (const l of this.lampLights) l.intensity += (0 - l.intensity) * k;
  }

  // Trickle shoppers in all day: as long as something's on the shelves and we
  // haven't hit the concurrent cap, a fresh customer arrives every few seconds.
  // The pace quickens as the town fills out (each restored house adds a resident
  // who shops here). Runs on the host regardless of where the player is, so
  // trade — and passive plain-table income — keeps ticking over while you delve.
  _pumpFlow(dt) {
    // During the first-run tutorial the crowd is hand-scripted: the one and only
    // customer is the Mayor (see spawnMayorCustomer), so hold the auto-flow.
    if (this.game.tutorial) return;
    if (this.stockedCount() === 0 || this.customers.length >= MAX_CUSTOMERS) return;
    this._spawnT -= dt;
    if (this._spawnT > 0) return;
    this._spawnCustomer();
    // more residents → livelier street: base ~5.5s, easing down toward ~1.8s
    const pop = this.game.townPop ? this.game.townPop() : 0;
    const interval = Math.max(1.8, 5.5 - pop * 0.5);
    this._spawnT = interval * (0.7 + Math.random() * 0.6);
  }

  // Nudge the next arrival to come almost immediately (used by the FTUE so a
  // customer shows up the moment the player stocks their first table).
  hurryNextCustomer(delay = 0.6) {
    this._spawnT = Math.min(this._spawnT, delay);
  }

  // The FTUE's scripted first shopper: the Mayor himself, in disguise as an
  // ordinary customer. He walks in, buys the player's first item, and — once
  // the sale lands — drops the act and reveals who he is (see _mayorFromCustomer).
  // Built with the Mayor's fixed variant so his body matches the dialogue bust,
  // forced to buy, and given endless patience so onboarding can't stall out.
  spawnMayorCustomer(variant) {
    const game = this.game;
    const creature = new BlockyCreature(variant, { height: 1.5 });
    creature.position.set(-this.streetHalfX, 0, this.streetWalkZ);
    creature.heading = Math.PI / 2;
    this.group.add(creature);
    const cust = {
      id: game.net.newId(),
      seed: 4242,
      creature,
      arch: ARCHETYPES[1] || ARCHETYPES[0],
      mode: "buy",
      isMayor: true,
      sellItem: null,
      minSell: 0,
      sellSpot: new THREE.Vector3(0, 0, 1.2),
      slot: null,
      ready: false,
      favorite: null,
      favScore: -1,
      target: null,
      seen: new Set(),
      toVisit: 1, // makes a beeline for the one stocked table
      visited: 0,
      lookT: 0,
      maxPay: 0,
      strikes: 0,
      state: "street",
      t: 0,
      patience: 1e9, // he won't leave until the deal is done
      exitPoint: new THREE.Vector3(-this.streetHalfX, 0, this.streetWalkZ),
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    return cust;
  }

  // Hand a customer's body over to a scripted scene (the Mayor cutscene): clear
  // their emote and pull them out of the shopper sim, but leave the creature in
  // the world for the caller to drive. Unlike _removeCustomer it never disposes.
  detachCustomer(cust) {
    this._clearEmote(cust);
    this.customers = this.customers.filter((x) => x !== cust);
    return cust.creature;
  }

  // Cosmetic pedestrians that mill about the whole street — not just a single
  // sidewalk lane. Each strolls between random waypoints spread across the road
  // (and now and then down the alley to the plaza), pausing here and there,
  // then wanders off after a while. They never enter the shop and never touch
  // game state; run on every client independently.
  _updatePassersby(dt, elapsed) {
    const game = this.game;
    if (!game.gameOver) {
      this._passerT -= dt;
      if (this._passerT <= 0 && this.passersby.length < 5) {
        this._passerT = 1.6 + Math.random() * 3;
        this._spawnPasserby();
      }
    }
    for (const p of [...this.passersby]) {
      const c = p.creature;
      p.life -= dt;
      if (p.pause > 0) {
        p.pause -= dt; // loitering — stand still but keep the idle anim ticking
      } else {
        const dx = p.tx - c.position.x, dz = p.tz - c.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.35) {
          // reached the waypoint: dawdle, then pick the next spot (or head off
          // the edge once this stroller's time is up)
          if (p.life <= 0) { p.tx = p.exitX; p.tz = p.exitZ; p.life = -1e9; p.pause = 0; }
          else { this._pickPasserTarget(p); p.pause = Math.random() < 0.4 ? 0.6 + Math.random() * 1.4 : 0; }
        } else {
          c.position.x += (dx / d) * p.speed * dt;
          c.position.z += (dz / d) * p.speed * dt;
          c.heading = Math.atan2(dx, dz);
        }
      }
      c.update(dt, elapsed);
      // retire once they've reached the exit point beyond the street edge
      if (p.life <= -1e8 && Math.abs(c.position.x) > this.streetRegion.xMax + 2.5) {
        c.dispose();
        this.passersby = this.passersby.filter((x) => x !== p);
      }
    }
  }

  // Roll a fresh waypoint out on the open road for a stroller: anywhere across
  // the full width and depth of the road/pavement (which sits in front of the
  // buildings, so a straight stroll between waypoints never clips a wall).
  _pickPasserTarget(p) {
    const R = this.streetRegion;
    p.tx = (Math.random() - 0.5) * 2 * R.xMax;
    p.tz = R.farZ + Math.random() * (R.nearZ - R.farZ);
  }

  _spawnPasserby() {
    const R = this.streetRegion;
    const dir = Math.random() < 0.5 ? 1 : -1; // which edge they walk in from
    const creature = makeCustomerBody(Math.floor(Math.random() * 1e6));
    const span = R.xMax + 2.5;
    creature.position.set(-dir * span, 0, R.farZ + Math.random() * (R.nearZ - R.farZ));
    creature.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.group.add(creature);
    const p = {
      creature,
      speed: 1.0 + Math.random() * 0.9,
      life: 10 + Math.random() * 14, // seconds of milling before they head off
      pause: 0,
      exitX: dir * span, // where they leave once done
      exitZ: R.farZ + Math.random() * (R.nearZ - R.farZ),
      tx: 0, tz: 0,
    };
    this._pickPasserTarget(p);
    this.passersby.push(p);
  }

  _spawnCustomer() {
    const game = this.game;
    const seed = pick(rng(Math.random() * 1e9), this._custSeedPool) + Math.floor(Math.random() * 4) * 100;
    const creature = makeCustomerBody(seed);
    // arrive from one end of the street and stroll toward the door
    const side = Math.random() < 0.5 ? -1 : 1;
    creature.position.set(side * this.streetHalfX, 0, this.streetWalkZ + (Math.random() - 0.5) * 0.5);
    creature.heading = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.group.add(creature);

    // weighted archetype. Restored houses add residents who shop here: each
    // bumps their archetype's odds, so a livelier town draws wealthier, rarer
    // clientele into rotation on top of the passing baseline crowd.
    const bag = [];
    for (const a of ARCHETYPES) for (let i = 0; i < a.w; i++) bag.push(a);
    for (const idx of this.game.townResidents || []) {
      const a = ARCHETYPES[idx];
      if (a) for (let i = 0; i < 3; i++) bag.push(a);
    }
    const arch = bag[Math.floor(Math.random() * bag.length)];

    // Some shoppers arrive as sellers: they carry an item to offload onto the
    // player (the reverse haggle). They'll accept anything at or above a hidden
    // floor well under base value, so buying low here and re-shelving it is
    // where a lot of the profit lives. During the first-run tutorial, though,
    // hold everyone to buyers so a brand-new player learns to *sell* before
    // they're ever offered something to buy.
    const mode = !game.tutorial && Math.random() < SELLER_CHANCE ? "sell" : "buy";
    let sellItem = null, minSell = 0;
    if (mode === "sell") {
      // Sellers bring better goods as the shop grows: the *lowest* tier they'll
      // try to offload climbs with the day, so the early tier-1 trash (shrooms,
      // jelly, bread) stops clogging the counter once you're past the first days.
      const loTier = clamp(1 + Math.floor(game.day / 3), 1, 4);
      const hiTier = clamp(loTier + 1, 1, 4);
      const tier = loTier + Math.floor(Math.random() * (hiTier - loTier + 1));
      sellItem = pick(rng(seed + 7), LOOT_BY_TIER[tier]);
      minSell = Math.round(ITEMS[sellItem].base * (0.45 + Math.random() * 0.3)); // 45–75% of base
    }

    const cust = {
      id: game.net.newId(),
      seed,
      creature,
      arch,
      mode,
      sellItem, // item id they're offloading (sellers only)
      minSell, // hidden floor they'll accept (sellers only)
      sellSpot: new THREE.Vector3((Math.random() - 0.5) * 4, 0, 0.6 + Math.random() * 1.8),
      slot: null, // chosen once they've made up their mind
      ready: false, // arrived at their waiting spot — auto-haggle can fire
      favorite: null, // best item seen while browsing
      favScore: -1,
      target: null, // slot currently being inspected
      seen: new Set(), // slot indices already looked at
      toVisit: 1 + Math.floor(Math.random() * 3), // browse 1–3 items
      visited: 0,
      lookT: 0,
      maxPay: 0,
      strikes: 0,
      state: "street", // street -> enter -> (roam.../offer) -> leave
      t: 0,
      patience: 18 + Math.random() * 10,
      exitPoint: new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * this.streetHalfX, 0, this.streetWalkZ),
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    game.net.send({
      t: "custAdd",
      id: cust.id, seed,
      x: creature.position.x, z: creature.position.z,
      archIdx: ARCHETYPES.indexOf(arch),
      mode, sellItem, minSell,
    });
  }

  // Someone else is already at (or heading for) this slot — browsing or
  // waiting to haggle. Shoppers skip busy slots so they don't pile up.
  _slotBusy(slot, cust) {
    return this.customers.some((o) => o !== cust && (
      ((o.state === "goto" || o.state === "look") && o.target === slot) ||
      (o.state === "want" && o.slot === slot)
    ));
  }

  // Is a world point on (or too near) a blocked nav cell? Used to weed out
  // browse spots that back into a wall or another table.
  _spotBlocked(p) {
    const nav = this._nav;
    if (!nav) return false;
    const c = Math.floor((p.x - nav.minX) / nav.cell);
    const r = Math.floor((p.z - nav.minZ) / nav.cell);
    if (c < 0 || c >= nav.cols || r < 0 || r >= nav.rows) return true;
    return !!nav.blocked[r * nav.cols + c];
  }

  // Choose which side of an item's table a shopper should stand at. Rather than
  // always crowding the front (which can wall a customer off behind a table),
  // pick the reachable spot closest to where they're standing now — so someone
  // coming from the door views it from the near side instead of squeezing past.
  _browseSpotFor(cust, slot) {
    const spots = slot.browseSpots || [slot.browsePos];
    const from = cust.creature?.position || cust.creature?.group?.position;
    let best = null, bestD = Infinity;
    for (const s of spots) {
      if (this._spotBlocked(s)) continue;
      const d = from ? from.distanceToSquared(s) : 0;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best || slot.browsePos;
  }

  // Position in the counter queue (0 = at the head, being served). Everyone
  // who's committed to a haggle — buyers wanting an item, sellers with an
  // offer, and whoever's mid-deal — shares one line, ordered by ticket number
  // so nobody jumps the queue and the rest shuffle up as the head is served.
  _queueIndexOf(cust) {
    const q = this.customers
      .filter((o) => o.queueOrder != null &&
        (o.state === "want" || o.state === "offer" || o.state === "haggling"))
      .sort((a, b) => a.queueOrder - b.queueOrder);
    return q.indexOf(cust);
  }

  // Pick a stocked slot this shopper hasn't inspected yet.
  // null = nothing left to see (decide); undefined = all taken (mill around).
  _pickBrowseSlot(cust) {
    const unseen = this.slots.filter((s) => s.item && !cust.seen.has(this.slots.indexOf(s)));
    if (!unseen.length) return null;
    const free = unseen.filter((s) => !this._slotBusy(s, cust));
    return free.length ? pick(rng(Math.random() * 1e9), free) : undefined;
  }

  // How much this shopper fancies a given item — pricier goods tug harder at
  // wealthier archetypes, with a dose of personal-taste noise.
  _appeal(cust, slot) {
    const base = ITEMS[slot.item].base;
    return base * (0.5 + cust.arch.hi * 0.3) * (0.6 + Math.random() * 0.8);
  }

  // Done browsing: maybe make an offer on their favourite, maybe just wander off.
  _decide(cust) {
    const fav = cust.favorite;
    // FTUE: on the tutorial's sell step every shopper must actually commit, so a
    // brand-new player is always handed a haggle to win instead of watching the
    // rush browse and wander off — skip the usual "maybe they just leave" roll.
    const mustBuy = this.game.tutorial === "sell";
    if (fav && fav.item && (mustBuy || Math.random() < cust.arch.buy)) {
      cust.slot = fav;
      const base = ITEMS[fav.item].base;
      cust.maxPay = Math.round(base * (cust.arch.lo + Math.random() * (cust.arch.hi - cust.arch.lo)));
      cust.t = 0;
      this.game.net.send({ t: "custWant", id: cust.id, slotIdx: this.slots.indexOf(fav), maxPay: cust.maxPay });
      if (fav.fancy) {
        // the velvet table: a proper haggle for the best price. They grab a
        // ticket and join the counter queue — the deal opens once they reach
        // the head of the line, not the instant they decide.
        cust.state = "want";
        cust.ready = false;
        cust.queueOrder = ++this._queueSeq;
        cust.emote = this.game.hud.emote(cust.creature, "alert", 999);
        this.game.audio.haggle();
      } else {
        // a plain table: they'll amble over and pay full sticker price, no haggle
        cust.state = "autobuy";
        cust.ready = false;
        cust.buySpot = this._browseSpotFor(cust, fav);
        cust._payT = 0.5;
        cust.emote = this.game.hud.emote(cust.creature, "moneyfly", 999);
      }
    } else {
      // browsed but not sold on anything — shrug and head out
      if (fav) this.game.hud.emote(cust.creature, pick(rng(cust.seed + cust.visited), ["faceThink", "faceNeutral", "faceRoll", "thought"]), 1.4);
      cust.state = "leave";
      cust._atDoor = false;
      cust.t = 0;
    }
  }

  // ---------------------------------------------------- guest-side mirrors
  mirrorCustomerAdd(m) {
    const creature = makeCustomerBody(m.seed);
    creature.position.set(m.x, 0, m.z);
    this.group.add(creature);
    this.customers.push({
      id: m.id,
      seed: m.seed,
      creature,
      slot: null, // set when the host says they want something (custWant)
      arch: ARCHETYPES[m.archIdx] ?? ARCHETYPES[1],
      mode: m.mode ?? "buy",
      sellItem: m.sellItem ?? null,
      minSell: m.minSell ?? 0,
      maxPay: 0,
      strikes: 0,
      state: "enter",
      t: 0,
      emote: null,
      _target: { x: m.x, z: m.z, h: 0 },
    });
  }

  // Host told us which item this shopper settled on — needed so the guest can
  // run the haggle sheet locally.
  mirrorCustomerWant(m) {
    const cust = this.customers.find((c) => c.id === m.id);
    if (!cust) return;
    cust.slot = this.slots[m.slotIdx] ?? null;
    cust.maxPay = m.maxPay;
  }

  mirrorCustomerSnap(list) {
    for (const [id, seed, x, z, h, state] of list) {
      const cust = this.customers.find((c) => c.id === id);
      if (!cust) continue;
      cust._target = { x, z, h };
      if (state !== cust.state && cust.state !== "haggling") {
        cust.state = state;
        if (state === "want" && !cust.emote) cust.emote = this.game.hud.emote(cust.creature, "alert", 999);
        if (state === "offer" && !cust.emote) cust.emote = this.game.hud.emote(cust.creature, "moneyfly", 999);
        if (state !== "want" && state !== "offer") this._clearEmote(cust);
        if (state === "happy") cust.creature.animator.squash.kick(6);
      }
    }
    for (const cust of this.customers) {
      if (!cust._target) continue;
      const c = cust.creature;
      c.position.x += (cust._target.x - c.position.x) * 0.2;
      c.position.z += (cust._target.z - c.position.z) * 0.2;
      c.heading = cust._target.h;
    }
  }

  mirrorCustomerDel(id) {
    const cust = this.customers.find((c) => c.id === id);
    if (cust) this._removeCustomer(cust);
  }

  mirrorCustomerState(m) {
    const cust = this.customers.find((c) => c.id === m.id);
    if (cust) {
      cust.state = m.state;
      cust.t = 0;
      this._clearEmote(cust);
    }
  }

  _updateCustomer(cust, dt, elapsed) {
    const c = cust.creature;
    const game = this.game;
    cust.t += dt;

    // Path-following walk: route around obstacles via the nav grid, stepping
    // from waypoint to waypoint. Falls back to a straight line (+collision
    // slide) when no grid path applies — e.g. out on the open street.
    const walkTo = (target, speed = 1.9) => {
      const key = target.x.toFixed(2) + "," + target.z.toFixed(2);
      if (cust._navKey !== key) {
        cust._navKey = key;
        cust._path = this._findPath(c.position, target);
        cust._navI = 0;
      }
      const path = cust._path;
      let wp = target;
      if (path && path.length) {
        while (
          cust._navI < path.length - 1 &&
          _d.set(path[cust._navI].x - c.position.x, 0, path[cust._navI].z - c.position.z).length() < 0.3
        ) {
          cust._navI++;
        }
        wp = path[Math.min(cust._navI, path.length - 1)];
      }
      const toFinal = Math.hypot(target.x - c.position.x, target.z - c.position.z);
      if (toFinal <= 0.12) return true;
      _d.set(wp.x - c.position.x, 0, wp.z - c.position.z);
      const step = _d.length();
      if (step > 1e-4) {
        _d.normalize();
        c.position.addScaledVector(_d, Math.min(speed * dt, step));
        c.heading = Math.atan2(_d.x, _d.z);
      }
      return false;
    };

    const faceSlot = (slot) =>
      (c.heading = Math.atan2(slot.pos.x - c.position.x, slot.pos.z - c.position.z));

    switch (cust.state) {
      case "street": {
        // hustle along the pavement to the doorstep, in full view outside
        if (walkTo(this.doorPos, 2.7)) {
          cust.state = "enter";
          cust.t = 0;
        }
        break;
      }
      case "enter": {
        // step in over the threshold, then either browse (buyers) or wander to
        // an open spot and flag down the shopkeeper to sell (sellers)
        if (walkTo(this.doorInside, 2.4)) {
          cust.state = cust.mode === "sell" ? "offer" : "roam";
          cust.t = 0;
          if (cust.mode === "sell") {
            cust.ready = false; // must reach the head of the counter queue first
            cust.queueOrder = ++this._queueSeq;
            if (!cust.emote) cust.emote = game.hud.emote(c, "moneyfly", 999);
          }
        }
        break;
      }
      case "roam": {
        // choose the next item to go inspect (or decide if there's nothing new)
        const slot = this._pickBrowseSlot(cust);
        if (slot === null) {
          this._decide(cust);
        } else if (slot === undefined) {
          // every unseen table has a shopper at it — drift to an open spot,
          // idle a beat, then look again once a table frees up
          cust.millSpot = { x: (Math.random() - 0.5) * 4, z: 0.6 + Math.random() * 2.4 };
          cust.state = "mill";
          cust.t = 0;
        } else {
          cust.target = slot;
          cust.browseSpot = this._browseSpotFor(cust, slot);
          cust.seen.add(this.slots.indexOf(slot));
          cust.state = "goto";
        }
        break;
      }
      case "mill": {
        walkTo(cust.millSpot, 1.7);
        if (cust.t > 0.7) {
          cust.state = "roam";
          cust.t = 0;
        }
        break;
      }
      case "goto": {
        const tgt = cust.target;
        if (!tgt || !tgt.item) {
          cust.state = "roam"; // item vanished — look for another
        } else if (walkTo(cust.browseSpot || tgt.browsePos, 2.7)) {
          cust.state = "look";
          cust.t = 0;
          cust.lookT = 0.7 + Math.random() * 1.2; // linger a beat
        }
        break;
      }
      case "look": {
        const tgt = cust.target;
        if (!tgt || !tgt.item) {
          cust.state = "roam";
          break;
        }
        faceSlot(tgt);
        if (cust.t > cust.lookT) {
          cust.visited++;
          const score = this._appeal(cust, tgt);
          if (score > cust.favScore) {
            cust.favScore = score;
            cust.favorite = tgt;
          }
          if (cust.visited >= cust.toVisit) this._decide(cust);
          else {
            cust.state = "roam";
            cust.t = 0;
          }
        }
        break;
      }
      case "want": {
        // queue up at the counter and shuffle forward as it clears; the one at
        // the head is ready to haggle. Lose patience if the wait drags on.
        const slot = cust.slot;
        if (!slot || !slot.item) {
          this._clearEmote(cust);
          cust.state = "leave";
          cust._atDoor = false;
        } else {
          if (cust.queueOrder == null) cust.queueOrder = ++this._queueSeq;
          const idx = this._queueIndexOf(cust);
          const spot = this.queueSpots[Math.min(idx, this.queueSpots.length - 1)];
          const arrived = walkTo(spot, 2.4);
          if (arrived) c.heading = Math.PI / 2; // face the counter
          cust.ready = arrived && idx === 0; // only the head can be served
          if (cust.t > cust.patience) {
            this._clearEmote(cust);
            game.hud.emote(c, "anger", 1.5);
            cust.state = "leave";
            cust._atDoor = false;
          }
        }
        break;
      }
      case "autobuy": {
        // a plain-table buyer: stroll to their pick, then it rings up on its
        // own at full sticker price (100%) — no haggling, no player input.
        const slot = cust.slot;
        if (!slot || !slot.item) {
          this._clearEmote(cust);
          cust.state = "leave";
          cust._atDoor = false;
          break;
        }
        if (walkTo(cust.buySpot || (cust.buySpot = this._browseSpotFor(cust, slot)), 2.6)) {
          faceSlot(slot);
          cust._payT -= dt;
          if (cust._payT <= 0) {
            this._clearEmote(cust);
            this.game._autoSell(cust, slot);
          }
        }
        break;
      }
      case "offer": {
        // a seller: queue at the counter like the buyers do and wait their turn
        // to be haggled with; if the wait drags on, they take their goods and go.
        if (cust.queueOrder == null) cust.queueOrder = ++this._queueSeq;
        const idx = this._queueIndexOf(cust);
        const spot = this.queueSpots[Math.min(idx, this.queueSpots.length - 1)];
        const arrived = walkTo(spot);
        if (arrived) c.heading = Math.PI / 2; // face the counter
        cust.ready = arrived && idx === 0; // only the head can be served
        if (cust.t > cust.patience) {
          this._clearEmote(cust);
          game.hud.emote(c, "anger", 1.5);
          cust.state = "leave";
          cust._atDoor = false;
        }
        break;
      }
      case "haggling":
        break; // frozen while the sheet is open
      case "happy": {
        // little joy hop then leave
        if (cust.t > 1.1) {
          cust.state = "leave";
          cust._atDoor = false;
        }
        break;
      }
      case "leave": {
        // out through the door, then off down the street before despawning
        if (!cust._atDoor) {
          if (walkTo(this.doorInside, 2.2)) cust._atDoor = true;
        } else if (!cust._outside) {
          if (walkTo(this.doorPos, 2.4)) cust._outside = true;
        } else if (walkTo(cust.exitPoint, 1.8)) {
          this._removeCustomer(cust);
          return;
        }
        break;
      }
    }
    // slide around tables & furniture instead of walking through them
    game.collide(c.position, c.radius * 0.8, this.colliders);
    c.update(dt, elapsed);
    game.net.trackCustomer(cust);
  }

  _clearEmote(cust) {
    if (cust.emote) {
      this.game.hud.removeEmote(cust.emote);
      cust.emote = null;
    }
  }

  _removeCustomer(cust) {
    this._clearEmote(cust);
    cust.creature.dispose();
    this.customers = this.customers.filter((x) => x !== cust);
    this.game.net.send({ t: "custDel", id: cust.id });
  }

  // ------------------------------------------------------------ pathfinding
  // Bake a coarse occupancy grid over the interior floor. A cell is blocked if
  // it lands inside any collider inflated by a customer's half-width, so paths
  // keep a body's clearance from tables and walls.
  _buildNav() {
    const { W, D } = SHOP;
    const cell = 0.34;
    const pad = 0.32; // customer clearance
    const minX = -W / 2 + 0.3, minZ = -D / 2 + 0.3;
    const cols = Math.ceil((W - 0.6) / cell);
    const rows = Math.ceil((D - 0.6) / cell);
    const blocked = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = minX + (cc + 0.5) * cell;
        const z = minZ + (r + 0.5) * cell;
        let hit = false;
        for (const o of this.colliders) {
          if (Math.abs(x - o.x) < o.hw + pad && Math.abs(z - o.z) < o.hd + pad) {
            hit = true;
            break;
          }
        }
        blocked[r * cols + cc] = hit ? 1 : 0;
      }
    }
    this._nav = { cell, minX, minZ, cols, rows, blocked };
  }

  // A* over the nav grid, returning a string-pulled list of world waypoints
  // (Vector3). Returns null when either endpoint sits outside the grid (e.g.
  // the street) so the caller can fall back to a straight line.
  _findPath(from, to) {
    const nav = this._nav;
    if (!nav) return null;
    const { cell, minX, minZ, cols, rows, blocked } = nav;
    const idx = (c, r) => r * cols + c;
    const colOf = (x) => Math.floor((x - minX) / cell);
    const rowOf = (z) => Math.floor((z - minZ) / cell);
    let sc = colOf(from.x), sr = rowOf(from.z);
    let gc = colOf(to.x), gr = rowOf(to.z);
    const inGrid = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
    if (!inGrid(sc, sr) || !inGrid(gc, gr)) return null;

    // slide endpoints off blocked cells onto the nearest free one
    const freeNear = (c, r) => {
      if (!blocked[idx(c, r)]) return [c, r];
      for (let rad = 1; rad < 6; rad++) {
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            const nc = c + dc, nr = r + dr;
            if (inGrid(nc, nr) && !blocked[idx(nc, nr)]) return [nc, nr];
          }
        }
      }
      return null;
    };
    const start = freeNear(sc, sr), goal = freeNear(gc, gr);
    if (!start || !goal) return null;
    [sc, sr] = start;
    [gc, gr] = goal;
    const startI = idx(sc, sr), goalI = idx(gc, gr);

    const n = cols * rows;
    const came = new Int32Array(n).fill(-1);
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const inOpen = new Uint8Array(n);
    const h = (c, r) => Math.hypot(c - gc, r - gr);
    gScore[startI] = 0;
    fScore[startI] = h(sc, sr);
    const open = [startI];
    inOpen[startI] = 1;

    let found = startI === goalI;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fScore[open[k]] < fScore[open[bi]]) bi = k;
      const cur = open[bi];
      if (cur === goalI) {
        found = true;
        break;
      }
      open.splice(bi, 1);
      inOpen[cur] = 0;
      const cr = Math.floor(cur / cols), cc = cur % cols;
      for (const [dc, dr] of DIRS) {
        const nc = cc + dc, nr = cr + dr;
        if (!inGrid(nc, nr) || blocked[idx(nc, nr)]) continue;
        if (dc !== 0 && dr !== 0 && (blocked[idx(cc + dc, cr)] || blocked[idx(cc, cr + dr)])) continue; // no corner cutting
        const ni = idx(nc, nr);
        const tentative = gScore[cur] + (dc !== 0 && dr !== 0 ? 1.4142 : 1);
        if (tentative < gScore[ni]) {
          came[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + h(nc, nr);
          if (!inOpen[ni]) {
            open.push(ni);
            inOpen[ni] = 1;
          }
        }
      }
    }
    if (!found) return null;

    const cells = [];
    let cur = goalI;
    while (cur !== -1) {
      cells.push({ x: minX + ((cur % cols) + 0.5) * cell, z: minZ + (Math.floor(cur / cols) + 0.5) * cell });
      if (cur === startI) break;
      cur = came[cur];
    }
    cells.reverse();

    // string-pull: keep only waypoints that need a turn (line-of-sight skips)
    const pts = [{ x: from.x, z: from.z }, ...cells, { x: to.x, z: to.z }];
    const out = [new THREE.Vector3(pts[0].x, 0, pts[0].z)];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this._lineOfSight(pts[i], pts[j])) break;
      out.push(new THREE.Vector3(pts[j].x, 0, pts[j].z));
      i = j;
    }
    return out;
  }

  // Is the straight segment a→b clear of blocked cells? (grid ray-march)
  _lineOfSight(a, b) {
    const nav = this._nav;
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / (nav.cell * 0.5));
    for (let k = 0; k <= steps; k++) {
      const t = steps ? k / steps : 0;
      const c = Math.floor((a.x + dx * t - nav.minX) / nav.cell);
      const r = Math.floor((a.z + dz * t - nav.minZ) / nav.cell);
      if (c < 0 || c >= nav.cols || r < 0 || r >= nav.rows) return false;
      if (nav.blocked[r * nav.cols + c]) return false;
    }
    return true;
  }

  /** The customer at the head of the counter queue, waiting to be served — a
   *  buyer wanting an item or a seller with an offer. Only the one at the head
   *  of the line (and settled at the front spot) is flagged `ready`, so this
   *  hands back whoever the shopkeeper should deal with next, or null. */
  counterCustomer() {
    for (const cust of this.customers) {
      if (!cust.ready) continue;
      if (cust.state === "want" && cust.slot?.item) return cust;
      if (cust.state === "offer" && cust.sellItem) return cust;
    }
    return null;
  }

  // ------------------------------------------------------------ haggling
  startHaggle(cust, hud, audio, done) {
    cust.state = "haggling";
    this._clearEmote(cust);
    const item = ITEMS[cust.slot.item];
    const game = this.game;
    let ui;
    const finish = (sold, price, grade) => {
      ui.close();
      if (sold) {
        const slot = cust.slot;
        this.unstockSlot(slot);
        cust.state = "happy";
        cust.t = 0;
        cust.creature.animator.squash.kick(6);
        hud.emote(cust.creature, grade === "perfect" ? "faceStar" : "faceSmile", 1.6);
      } else {
        cust.state = "leave";
        hud.emote(cust.creature, "faceHuff", 1.6);
      }
      done(sold, price, grade, item);
    };

    ui = hud.haggle(
      {
        itemName: item.name, icon: item.icon, base: item.base, tier: item.tier, mood0: cust.arch.moods,
        custVariant: cust.creature?.variant ?? variantForSeed(cust.seed),
        playerVariant: game.player?.variant ?? "a",
      },
      {
        onDeal: (price) => {
          if (price <= cust.maxPay) {
            const grade = price >= cust.maxPay * 0.92 ? "perfect" : price >= cust.maxPay * 0.75 ? "good" : "cheap";
            finish(true, price, grade);
          } else {
            cust.strikes++;
            audio.deny();
            if (cust.strikes >= 3) {
              ui.say(`"Forget it!"`);
              setTimeout(() => finish(false, 0, null), 700);
            } else {
              const counter = Math.round(cust.maxPay * (0.86 + Math.random() * 0.08));
              ui.setMood(cust.strikes === 1 ? "faceConfused" : "faceAngry");
              ui.say(`"${price}g?! How about ${counter}g..."`);
              ui.setPrice(counter);
            }
          }
        },
        onLeave: () => finish(false, 0, null),
      }
    );
    ui.setMood(cust.arch.moods);
    ui.say(pick(rng(cust.seed), [
      `"How much for the ${item.name}?"`,
      `"Ohh, a ${item.name}! Name your price."`,
      `"I've been looking for one of these!"`,
      `"Is that a real ${item.name}?"`,
    ]));
    return ui;
  }

  // Reverse haggle: a customer is offloading an item onto the player. The
  // player lowballs; the seller accepts any offer at or above their hidden
  // floor (`minSell`) and counters upward otherwise. `done(bought, price,
  // grade, item)` mirrors startHaggle so the game glue stays symmetrical.
  startBuyHaggle(cust, hud, audio, done) {
    cust.state = "haggling";
    this._clearEmote(cust);
    const item = ITEMS[cust.sellItem];
    const game = this.game;
    let ui;
    const finish = (bought, price, grade) => {
      ui.close();
      if (bought) {
        cust.state = "happy";
        cust.t = 0;
        cust.creature.animator.squash.kick(6);
        hud.emote(cust.creature, grade === "perfect" ? "faceStar" : "faceSmile", 1.6);
      } else {
        cust.state = "leave";
        cust._atDoor = false;
        hud.emote(cust.creature, "faceHuff", 1.6);
      }
      done(bought, price, grade, item);
    };

    ui = hud.haggle(
      {
        itemName: item.name, icon: item.icon, base: item.base, tier: item.tier, mood0: cust.arch.moods, buying: true,
        custVariant: cust.creature?.variant ?? variantForSeed(cust.seed),
        playerVariant: game.player?.variant ?? "a",
      },
      {
        onDeal: (price) => {
          if (price > game.gold) {
            audio.deny();
            ui.setMood("faceConfused");
            ui.say(`"You don't have ${price}g!"`);
            return;
          }
          if (price >= cust.minSell) {
            const grade = price <= cust.minSell * 1.1 ? "perfect" : price <= cust.minSell * 1.35 ? "good" : "fair";
            finish(true, price, grade);
          } else {
            cust.strikes++;
            audio.deny();
            if (cust.strikes >= 3) {
              ui.say(`"Forget it, I'll keep it!"`);
              setTimeout(() => finish(false, 0, null), 700);
            } else {
              const counter = Math.round(cust.minSell * (1.04 + Math.random() * 0.1));
              ui.setMood(cust.strikes === 1 ? "faceConfused" : "faceAngry");
              ui.say(`"Only ${price}g? I won't take less than ${counter}g."`);
              ui.setPrice(counter);
            }
          }
        },
        onLeave: () => finish(false, 0, null),
      }
    );
    ui.setMood(cust.arch.moods);
    ui.say(pick(rng(cust.seed + 3), [
      `"Wanna buy this ${item.name}?"`,
      `"I'll let this ${item.name} go — cheap."`,
      `"Interested in a fine ${item.name}?"`,
      `"Got a ${item.name} here. Make me an offer."`,
    ]));
    return ui;
  }
}

const _d = new THREE.Vector3();

// A slim white donut that lies on the floor to flag an interaction spot —
// same footprint and additive glow as the interact highlight ring, just a thin
// band instead of a filled disc. The caller pulses its opacity/scale each frame.
function makeFloorHint() {
  return new THREE.Mesh(
    new THREE.RingGeometry(0.44, 0.5, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })
  );
}

// A soft, pulsing radial halo behind a prized item — a billboarded quad driven
// by a tiny shader so the fancy-table wares shimmer. The caller advances uTime
// and keeps it turned to face the camera each frame (see update()).
function makeGlow(color = 0xffd67a) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      void main() {
        float d = distance(vUv, vec2(0.5));
        float glow = smoothstep(0.5, 0.0, d);        // soft falloff to the edge
        glow = pow(glow, 1.7);
        float pulse = 0.6 + 0.4 * sin(uTime * 3.0);  // gentle throb
        // a brighter core so the item reads as lit from behind
        float core = smoothstep(0.22, 0.0, d) * 0.5;
        gl_FragColor = vec4(uColor, (glow * pulse) + core * pulse);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat);
  mesh.userData.mat = mat;
  return mesh;
}

// ---- light palettes ---------------------------------------------------------
// `sky`/`ground` tint the hemisphere (ambient) fill, `sun` the warm key light
// and the god-ray shafts, `bg` the backdrop + fog. The shop holds a fixed
// bright-midday look; the dungeon a moodier one.
const _col = (hex) => new THREE.Color(hex);
const SHOP_PAL    = { sky: _col(0xc3c2e6), ground: _col(0x1c1630), hemiI: 0.95, sun: _col(0xffe7b4), sunI: 2.1, bg: _col(0x2b2848), shaft: _col(0xffe6ad) };
const DUNGEON_PAL = { sky: _col(0xb7a1ff), ground: _col(0x160e28), hemiI: 0.6, sun: _col(0xffdca0), sunI: 1.9,  bg: _col(0x1a1030), shaft: _col(0xffd08a) };
const _tSky = new THREE.Color();
const _tGround = new THREE.Color();
const _tSun = new THREE.Color();
const _tBg = new THREE.Color();
const _tShaft = new THREE.Color();

// 8-way neighbour offsets for the grid A* (orthogonal + diagonal)
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// A Kenney blocky customer, deterministically varied by seed so host + guest
// (and repeat visits) render the same person.
function makeCustomerBody(seed) {
  if (HARD_SEED != null) seed = HARD_SEED;
  const r = rng(seed * 104729 + 11);
  return new BlockyCreature(variantForSeed(seed), { height: 1.05 + r() * 0.35 });
}

function makeFloorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#9a6a3e";
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const off = (y % 2) * 32;
      g.fillStyle = `hsl(${26 + Math.random() * 6}, ${38 + Math.random() * 10}%, ${38 + Math.random() * 9}%)`;
      g.fillRect(x * 64 + off - 32, y * 32, 62, 30);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}
