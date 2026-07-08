// Shop world construction: the room, shopfront, counter, tables, the street
// outside, the flanking rooms, and the restoration lots. Split out of shop.js
// as prototype methods (mixed onto Shop via Object.assign) so they keep using
// `this` unchanged.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { populateStreet } from "./decor.js";
import { rng } from "../core/engine.js";
import { SHOP, MAX_CUSTOMERS } from "./shop-data.js";

export const buildMethods = {
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
    // an un-built table is no longer shown as a greyed-out ghost mesh: its real
    // fixture stays hidden and a glowing outline on the floor marks the footprint
    // where it'll go once the player pays to build it (see _applyTableState).
    this._glowTable = null; // which locked table's floor outline is currently lit
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
    // buildable fixture: all but the first start un-built (their real mesh hidden,
    // slots unusable, a glowing floor outline marking the footprint) until the
    // player pays to build them — see repairTable / _applyTableState.
    // `this.tables` groups every table's meshes + slots + build cost so the
    // game glue can offer the "Repair" prompt and persist what's been built.
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
      // footprint outline flagging where this table gets built (shown while it's
      // locked, in place of the old greyed-out ghost mesh)
      const outline = makeFloorOutline(2.4, 1.3);
      t.add(outline);
      t.position.set(tx, 0, tz);
      g.add(t);
      this.colliders.push({ x: tx, z: tz, hw: 1.15, hd: 0.6 });
      const table = {
        group: t,
        meshes: [top, legs],
        origMats: [woodMat, wood2],
        outline,
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
    const fancyOutline = makeFloorOutline(3.7, 1.5);
    fancy.add(fancyOutline);
    fancy.position.set(fancyCx, 0, fancyZ);
    g.add(fancy);
    this.colliders.push({ x: fancyCx, z: fancyZ, hw: 1.75, hd: 0.66 });
    // the prized vitrine is the priciest fixture to restore (1000g) and, like
    // the plain shelves, starts broken until the player pays to bring it back.
    const fancyTable = {
      group: fancy,
      meshes: [fLegs, fTrim, fTop],
      origMats: [wood2, goldMat, velvetMat],
      outline: fancyOutline,
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
    // hide every locked fixture (leaving its floor outline) now the set is built
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
  },

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
        cost: side < 0 ? 5000 : 10000,
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
  },

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
  },
};

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

// A flat rectangular frame that lies on the floor to mark where a locked table
// will be built — a glowing footprint outline in place of the old greyed-out
// ghost mesh. Base colour is a warm amber; highlightTable() pops it white and
// pulses its opacity while it's the active interact target. Sized to the table's
// footprint (w x d, in world units).
function makeFloorOutline(w, d, color = 0xffcf86) {
  const hw = w / 2, hd = d / 2, t = 0.13; // band thickness
  const outer = new THREE.Shape();
  outer.moveTo(-hw, -hd);
  outer.lineTo(hw, -hd);
  outer.lineTo(hw, hd);
  outer.lineTo(-hw, hd);
  outer.lineTo(-hw, -hd);
  const hole = new THREE.Path();
  hole.moveTo(-hw + t, -hd + t);
  hole.lineTo(hw - t, -hd + t);
  hole.lineTo(hw - t, hd - t);
  hole.lineTo(-hw + t, hd - t);
  hole.lineTo(-hw + t, -hd + t);
  outer.holes.push(hole);
  const geo = new THREE.ShapeGeometry(outer).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })
  );
  mesh.position.y = 0.02; // hover just above the planks to avoid z-fighting
  mesh.userData.baseColor = color;
  return mesh;
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
