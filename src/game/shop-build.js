// Shop world construction: the room, shopfront, counter, tables, the street
// outside, and the restoration lots. Split out of shop.js as prototype methods
// (mixed onto Shop via Object.assign) so they keep using `this` unchanged.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { placeStreetDecor, decorSprite, DECOR, DECOR_BURST, FIELD_FORAGE } from "./decor.js";
import { buildStreetTerrain } from "./street-terrain.js";
import { buildDojo } from "./dojo.js";
import { SHOP, MAX_CUSTOMERS, BUILDING_LIFT } from "./shop-data.js";
import { getLayout } from "./layout-store.js";
import { rng, pick } from "../core/engine.js";

export const buildMethods = {
  _build() {
    const g = this.group;
    // the whole shop building + its interior fixtures live in one sub-group so
    // the overworld editor can grab and move the shop as a unit. It's built at
    // the origin (pre-rotation) like before; _rotateTown turns it with the town
    // and _applyShopOffset then slides it (and every shop anchor) to the
    // position authored in layout.json's `buildings.shop`.
    const sg = new THREE.Group();
    sg.position.y = BUILDING_LIFT; // sit just above the road to avoid z-fighting
    g.add(sg);
    this.shopGroup = sg;
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

    // floor: warm planks (canvas texture keeps it cheap + stylised). Must use
    // the shared toon ramp: three r169 omits gradientMap from the program cache
    // key, so a ramp-less toon material can inherit a USE_GRADIENTMAP program
    // from whichever area compiled first (the FTUE cave) and go near-black
    // sampling the unbound ramp slot.
    const floorTex = makeFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
      makeToonMaterial({ map: floorTex, rim: 0 })
    );
    sg.add(floor);

    const wallH = 3;
    const mkWall = (w, h, d, x, y, z, mat = wallMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      sg.add(m);
      return m;
    };

    // side walls: solid — the buyable extensions hang off the building's back
    // (the post-rotation WEST side, away from the street), not the flanks.
    // After the town's quarter-turn, +X becomes the wall nearest the camera;
    // retain it so update() can hide it while the player is indoors.
    this.nearCameraWalls = [];
    for (const sx of [-W / 2, W / 2]) {
      const wall = mkWall(0.4, wallH, D, sx, wallH / 2, 0, wallMat2);
      if (sx > 0) this.nearCameraWalls.push(wall);
      this.colliders.push({ x: sx, z: 0, hw: 0.35, hd: D / 2 });
    }
    // front wall (pre-rotation): a full-height solid wall closing off the back
    // of the shop (post-rotation this is the far wall, away from the camera)
    mkWall(W, wallH, 0.35, 0, wallH / 2, D / 2, wallMat2);
    this.colliders.push({ x: 0, z: D / 2, hw: W / 2, hd: 0.3 });

    // back wall = the shopfront: a door on the left, a display window
    // ("vitrine") on the right. Post-rotation the door sits on the up-street
    // half of the road-facing wall, nearest the cave mouth at the top, so the
    // pit→till commute is as short as it looks. Customers stream in through
    // the door; goods on the sill face the road.
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
    sg.add(glass);
    for (const mx of [winL, winCx, winR]) {
      mkWall(0.09, headY - sillH, 0.16, mx, (sillH + headY) / 2, backZ + 0.06, wood2);
    }

    // welcome mat just inside the door
    const doorMat = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0xb08968, rim: 0 })
    );
    doorMat.position.set(doorCx, 0.01, backZ + 0.9);
    sg.add(doorMat);

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
      sg.add(pivot);
      this.doorLeaves.push(pivot);
    };
    mkLeaf(doorL, 1); // left leaf, hinged on the left jamb
    mkLeaf(doorR, -1); // right leaf, hinged on the right jamb

    // --- the roof: a stepped hip stack over the shop box, with a chimney. It
    // fades away whenever the player is inside the building (see update()) so
    // the room stays readable; from the street it sells "a house you enter".
    const roofMat = makeToonMaterial({ color: 0x9a4a3a, rim: 0 });
    const roofTrimMat = makeToonMaterial({ color: 0x7a382c, rim: 0 });
    for (const m of [roofMat, roofTrimMat]) m.transparent = true;
    const roof = new THREE.Group();
    // flush with the walls' outer faces — no eaves hanging past the footprint
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.4, D + 0.3), roofMat);
    r1.position.y = wallH + 0.18;
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(W - 2.4, 0.5, D - 2.6), roofMat);
    r2.position.y = wallH + 0.58;
    const r3 = new THREE.Mesh(new THREE.BoxGeometry(W - 5.4, 0.5, D - 5.8), roofTrimMat);
    r3.position.y = wallH + 1.0;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.7), roofTrimMat);
    chimney.position.set(-W / 2 + 2.4, wallH + 1.1, -1.2);
    roof.add(r1, r2, r3, chimney);
    sg.add(roof);
    this.roof = roof;
    this._roofMats = [roofMat, roofTrimMat];
    this._roofA = 1; // eased: 1 = shown (outside), 0 = hidden (inside)

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
    sg.add(counterTop);
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
    sg.add(register);

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
    sg.add(cLamp);
    this.lampLights.push(cGlow);

    // haggling customers queue in single file along the front (downmost) wall:
    // the head of the line waits in front of the register and the rest trail
    // off to the left. Once served they peel away and head up toward the door.
    this.queueSpots = [];
    const qHeadX = counterX - 1.0, qZ = D / 2 - 1.0; // hug the downmost wall
    for (let i = 0; i < MAX_CUSTOMERS; i++) {
      this.queueSpots.push(new THREE.Vector3(qHeadX - i * 0.95, 0, qZ));
    }

    // display tables (2 slots each). Placement — position and yaw per table —
    // comes from layout.json (authored in the overworld editor); the long axis
    // reads HORIZONTAL on screen at yaw 0. Each table is a buildable fixture:
    // all but the first start un-built (their real mesh hidden, slots unusable,
    // a glowing floor outline marking the footprint) until the player pays to
    // build them — see repairTable / _applyTableState. `this.tables` groups
    // every table's meshes + slots + build cost so the game glue can offer
    // the "Repair" prompt and persist what's been built.
    // The first table in layout order — the free starter shelf — is the one
    // that comes ready to stock, so keep it nearest the door in the editor.
    this.tables = [];
    const layout = getLayout();
    layout.tables.forEach((def, ti) => {
      const tx = def.x, tz = def.z, yaw = def.yaw || 0;
      const t = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 2.2), woodMat);
      top.position.y = 0.78;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.72, 1.9), wood2);
      legs.position.y = 0.36;
      t.add(top, legs);
      // footprint outline flagging where this table gets built (shown while it's
      // locked, in place of the old greyed-out ghost mesh)
      const outline = makeFloorOutline(1.3, 2.4);
      t.add(outline);
      t.position.set(tx, 0, tz);
      t.rotation.y = yaw;
      sg.add(t);
      // colliders stay axis-aligned: take the AABB of the yawed footprint.
      // Kept on the table so _applyTableState can disable it while the shelf is
      // locked — a bare floor outline shouldn't block the player.
      const cb = rotAABB(0.6, 1.15, yaw);
      const collider = { x: tx, z: tz, hw: cb.hw, hd: cb.hd };
      this.colliders.push(collider);
      const table = {
        group: t,
        meshes: [top, legs],
        origMats: [woodMat, wood2],
        outline,
        collider,
        cost: def.cost ?? 200,
        fancy: false,
        repaired: ti === 0, // only the first shelf comes ready to stock
        slots: [],
        interactPos: offV(tx, tz, 1.05, 0, yaw),
      };
      for (const dz of [-0.55, 0.55]) {
        const slot = {
          pos: offV(tx, tz, 0, dz, yaw, 0.86),
          browsePos: offV(tx, tz, 1.05, dz, yaw),
          // standing spots on every side of the table, so a shopper can view
          // the item from whichever side is nearest / reachable rather than
          // always squeezing to one face (see _browseSpotFor)
          browseSpots: [
            offV(tx, tz, 1.05, dz, yaw),  // one long face
            offV(tx, tz, -1.05, dz, yaw), // the other
            offV(tx, tz, 0, 1.6, yaw),    // near end
            offV(tx, tz, 0, -1.6, yaw),   // far end
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
    const fDef = layout.fancy;
    const fancyCx = fDef.x, fancyZ = fDef.z, fYaw = fDef.yaw || 0;
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
    fancy.rotation.y = fYaw;
    sg.add(fancy);
    const fcb = rotAABB(1.75, 0.66, fYaw);
    const fancyCollider = { x: fancyCx, z: fancyZ, hw: fcb.hw, hd: fcb.hd };
    this.colliders.push(fancyCollider);
    // the prized vitrine is the priciest fixture to restore (1000g) and, like
    // the plain shelves, starts broken until the player pays to bring it back.
    const fancyTable = {
      group: fancy,
      meshes: [fLegs, fTrim, fTop],
      origMats: [wood2, goldMat, velvetMat],
      outline: fancyOutline,
      collider: fancyCollider,
      cost: fDef.cost ?? 1000,
      fancy: true,
      repaired: false,
      slots: [],
      interactPos: offV(fancyCx, fancyZ, 0, 1.15, fYaw),
    };
    for (const dx of [-1.05, 0, 1.05]) {
      const slot = {
        pos: offV(fancyCx, fancyZ, dx, 0, fYaw, 0.92),
        browsePos: offV(fancyCx, fancyZ, dx, 1.15, fYaw),
        // the vitrine hugs the back wall, so its back side is walled off — the
        // reachable spots are the front and the two flanks (blocked ones are
        // filtered out in _browseSpotFor)
        browseSpots: [
          offV(fancyCx, fancyZ, dx, 1.15, fYaw),  // front
          offV(fancyCx, fancyZ, 2.25, 0, fYaw),   // right
          offV(fancyCx, fancyZ, -2.25, 0, fYaw),  // left
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
      sg.add(lamp);
      this.lampLights.push(glow);
    }

    // a warm wall lantern on the low back wall. Like the corner lamps it's dark
    // under the bright midday palette and kindles at night (pushed into lampLights).
    {
      const sconce = new THREE.Group();
      const midX = -0.8;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.12), wood2);
      plate.position.set(0, 1.45, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), wood2);
      arm.position.set(0, 1.66, -0.22);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 10), makeToonMaterial({ color: 0xffd98a, rim: 0 }));
      shade.position.set(0, 1.86, -0.42);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
      bulb.position.set(0, 1.72, -0.42);
      const glow = new THREE.PointLight(0xffca7a, 0, 8, 1.6);
      glow.position.set(0, 1.72, -0.55);
      sconce.add(plate, arm, shade, bulb, glow);
      sconce.position.set(midX, 0, D / 2 - 0.18); // interior face of the back wall
      sg.add(sconce);
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
      sg.add(shaft);
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
    // ---- the horizontal high street ----------------------------------------
    // Built pre-rotation like the rest of the town; _rotateTown then gives it a
    // quarter-turn so it reads LEFT→RIGHT across the screen. In pre-rotation
    // space +X maps to the on-screen VERTICAL (post +Z, toward the camera) and
    // −z_pre maps to the on-screen HORIZONTAL (post +X). So a plane that's long
    // along Z here becomes a long horizontal road; its small X extent is the
    // road's on-screen thickness. The row of buildings (shop / cave / dojo)
    // sits just above it; the restored houses line the near (camera) side.
    this.roadColor = 0x6f6558;
    const roadHalf = 5.5;            // on-screen half-thickness of the road (post Z) — ~half the old street
    const roadNearX = 8;            // top edge of the road (post Z), a stride below the buildings row
    const roadCenterX = roadNearX + roadHalf;
    const roadFarX = roadNearX + roadHalf * 2;
    const streetLeftZ = 7;         // left end of the road (post X = −7)
    const streetRightZ = -47;      // right end of the road (post X = 47)
    const streetLen = streetLeftZ - streetRightZ;
    const streetMidZ = (streetLeftZ + streetRightZ) / 2;
    const paveW = 3.0;             // light pavement strip along the buildings' side
    // pavement (light) hugging the buildings, then the dirt road, then a gutter
    mkGround(paveW, streetLen, roadNearX - paveW / 2, streetMidZ, 0x8a7c66);
    mkGround(roadHalf * 2, streetLen, roadCenterX, streetMidZ, this.roadColor);
    mkGround(0.8, streetLen, roadCenterX, streetMidZ, 0x565049).position.y = 0.004;
    // stash the road layout so _rotateTown / terrain / forage can derive the
    // post-rotation street rect and spawn anchors from a single source
    this._road = { roadNearX, roadCenterX, roadFarX, streetLeftZ, streetRightZ, streetMidZ, streetLen };

    // every collider pushed so far belongs to the shop building (walls, counter,
    // tables, vitrine) — snapshot them so _applyShopOffset can slide just these
    // (and the door collider) when the shop is moved. Outdoor colliders (lots,
    // cave, hills, dojo) are pushed after this point and stay put.
    this._shopColliders = this.colliders.slice();

    // the far flanks used to be flat painted facades; they're now the town's
    // restoration lots — run-down ruins and boarded-up empty plots the player
    // pays the Mayor's fund to rebuild into houses (see _buildLots / restoreLot).
    this._buildLots();

    // street lamps line the pavement — each carries a real warm point light
    // that kindles at dusk and a glowing head that dims by day (both driven by
    // the wall-clock day/night cycle in Shop._updateLighting).
    const mkStreetLamp = (x, z) => {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2), wood2);
      pole.position.y = 1.6;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), makeToonMaterial({ color: 0x2c2438, rim: 0 }));
      head.position.y = 3.3;
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glowMat);
      glow.position.y = 3.25;
      const light = new THREE.PointLight(0xffca7a, 0, 13, 1.5);
      light.position.y = 3.1;
      lamp.add(pole, head, glow, light);
      lamp.position.set(x, 0, z);
      g.add(lamp);
      this.streetLampLights.push(light);
      this.streetLampGlows.push(glowMat);
    };
    // lamps spaced down the pavement edge so the whole road stays lit after dark
    for (const lz of [streetLeftZ - 3, (streetLeftZ + streetMidZ) / 2, streetMidZ, (streetMidZ + streetRightZ) / 2, streetRightZ + 5]) {
      mkStreetLamp(roadNearX - 0.4, lz);
    }

    // the ambient pedestrians roam the road: kept pre-rotation here, mapped to
    // an explicit post-rotation rect in _rotateTown (along = screen X, across =
    // screen Z), so strollers amble the length of the street and never clip the
    // buildings row behind it or the houses in front.

    this.doorPos = new THREE.Vector3(doorCx, 0, backZ - 1.3); // outside: door step
    this.doorInside = new THREE.Vector3(doorCx, 0, backZ + 1.2); // threshold just inside

    // billboard scenery lining the street outside, placed from layout.json
    // (explicit data, so co-op peers match by construction). The sprite list
    // is kept in layout order so the overworld editor can map sprites back
    // to their entries.
    this.decorSprites = placeStreetDecor(g, layout.decor);

    // the cave at the end of the road: a rocky mouth closing off the street's
    // east end — the dungeon's front door. Walking up to it steps inside (the
    // walk-through trigger lives in Game._updateCaveTravel).
    this._buildCaveMouth(mkGround);

    // the rest of the town: the plaza floor, the building footprint and the
    // camera zones (restoration lots are the row of houses below the road).
    this._buildTown(mkGround);

    // primitive-built terrain under and around it all: the meadow, cobbles,
    // turf patches, boulders and horizon hills. Fed the pre-rotation road rect
    // so cobbles/flagstones lay along the new horizontal high street.
    // every building/lot footprint in the terrain's PRE-rotation frame, so the
    // terrain can keep path slabs, cobbles and boulders from surfacing through a
    // floor. Authored coords (shop/cave/dojo/lots) already use the pre-rotation
    // convention, so they map straight in — the shop's authored spot in
    // particular sits over the cobbled road band once _applyShopOffset moves it.
    const sb = getLayout().buildings?.shop ?? { x: 0, z: 0 };
    const dd = getLayout().buildings?.dojo ?? { x: 2, z: -33 };
    const buildingFootprints = [
      { x: sb.x, z: sb.z, hw: SHOP.W / 2, hd: SHOP.D / 2 },       // shop
      { x: this._cavePre.x, z: this._cavePre.z, hw: 2.2, hd: 3.8 }, // cave mound + apron
      { x: dd.x, z: dd.z, hw: 4.0, hd: 5.0 },                      // dojo hall
      ...this.lots.map((l) => ({ x: l.collider.x, z: l.collider.z, hw: l.collider.hw, hd: l.collider.hd })),
    ];
    const terrain = buildStreetTerrain(g, {
      road: this._road,
      cave: this._cavePre, // {x, z} pre-rotation centre, set by _buildCaveMouth
      bounds: this.bounds, // set by _buildTown above; rings the walkable meadow with hills
      hills: getLayout().hills, // optional authored near "wall" hills (else procedural)
      buildings: buildingFootprints, // pre-rotation footprints kept clear of terrain slabs
      editable: !!this.game?.editor, // editor: split the near hills into pickable meshes
    });
    // editor only: the near "wall" hills as individually-pickable meshes, plus
    // their descriptors so the editor can seed layout.hills on first edit
    this._hillMeshes = terrain.hillMeshes || [];
    this._hillDescs = terrain.hillDescs || [];
    // make the ring of horizon hills solid so the widened meadow reads as a
    // field fenced by rolling ground — the player is stopped at the foot of
    // each slope instead of clipping up into it. Pushed as pre-rotation AABBs
    // (footprint of the hill's ground silhouette) so _rotateTown turns them
    // with the town, like every other collider.
    for (const h of terrain.hills) {
      this.colliders.push({ x: h.x, z: h.z, hw: h.r * 0.82, hd: h.r * 0.82 });
    }

    // quarter-turn the whole town so the road runs down the screen (portrait
    // play): the cave mouth lands at the bottom, the ruined row along the far
    // side. Must run before the nav bake so the grid sees rotated colliders.
    this._rotateTown();

    // slide the shop building + all its anchors to the authored position (world
    // space, post-rotation). Runs before the nav bake so the grid sees the shop
    // in its final spot, and before the camera layout so explicit camera
    // overrides still win.
    this._applyShopOffset();

    // fold any saved camera-limit / framing overrides (from the overworld
    // editor's Camera panel) over the code defaults, in post-rotation space
    this._applyCameraLayout();

    // bake a coarse navigation grid of the shop floor so customers can route
    // around the tables & furniture instead of shoving straight through them.
    this._buildNav();
    // doors start shut: block the opening (added after nav bake so the grid
    // still treats the doorway as walkable for when they're opened)
    this.colliders.push(this._doorCollider);

    // the training dojo tucked under the shop: an always-present master and a
    // row of straw dummies to whack. Built in post-rotation world space (its
    // colliders join the list here, before forage rejects against them).
    this.dojo = buildDojo(this);

    // scatter destructible forage (blossoms, berry bushes, nut saplings,
    // mushrooms) across the walkable meadow — smashable for edible loot, just
    // like the cellar's decor. Runs last so it can reject against every finished
    // collider (walls, lots, cave, hills, dojo) and the settled walkable bounds.
    this._buildForage();
  },

  // Fold layout.json's optional `camera` block over the code-defined camera
  // limits & framing. Everything here is in post-rotation WORLD space (the same
  // space the runtime camera logic and the editor's guides use), so it's applied
  // right after _rotateTown. Absent block → keep the constructor defaults.
  _applyCameraLayout() {
    const cam = getLayout().camera;
    if (!cam) return;
    if (typeof cam.zonePad === "number") this.cameraZonePad = cam.zonePad;
    if (typeof cam.edgePad === "number") this.cameraEdgePad = cam.edgePad;
    if (Array.isArray(cam.zones)) {
      // saved zones are authored in the DEFAULT-shop world space; the shop's own
      // indoor zone (index 0) is slid by the shop offset so the camera lock
      // still tracks the shop wherever it's been moved to.
      const o = this.shopOrigin;
      cam.zones.forEach((z, i) => {
        if (!this.zones[i]) return;
        Object.assign(this.zones[i], z);
        if (i === 0 && o && (o.x || o.z)) {
          const zz = this.zones[0];
          zz.minX += o.x; zz.maxX += o.x; zz.minZ += o.z; zz.maxZ += o.z;
          zz.cx += o.x; zz.cz += o.z;
        }
      });
    }
    if (cam.bounds) Object.assign(this.bounds, cam.bounds);
    if (Array.isArray(cam.shopOffset)) this.camShopOffset.fromArray(cam.shopOffset);
    if (Array.isArray(cam.streetOffset)) this.camStreetOffset.fromArray(cam.streetOffset);
    if (typeof cam.shopFitAspect === "number") this.camShopFitAspect = cam.shopFitAspect;
  },

  // Slide the whole shop — building group + every stored anchor, collider, camera
  // zone and footprint — to the position authored in layout.json's
  // `buildings.shop`. Authored coords use the same pre-rotation convention as
  // lots/cave/dojo (world = (−z, x)); the default {x:0,z:0} lands at the world
  // origin so an un-edited shop is untouched. Runs after _rotateTown, so the
  // offset is applied straight in post-rotation WORLD space.
  _applyShopOffset() {
    const sb = getLayout().buildings?.shop;
    const ox = sb ? -sb.z : 0;
    const oz = sb ? sb.x : 0;
    this.shopOrigin = new THREE.Vector3(ox, 0, oz); // exposed for the editor
    // where the hero spawns / respawns inside the shop — follows the shop so the
    // player always lands on the sales floor (see Game.startPlay / _respawn)
    this.playerSpawn = new THREE.Vector3(0 + ox, 0, 2.5 + oz);
    if (!ox && !oz) return;
    this.shopGroup.position.x += ox;
    this.shopGroup.position.z += oz;
    const shiftV = (v) => { v.x += ox; v.z += oz; };
    const shiftC = (c) => { c.x += ox; c.z += oz; };
    for (const c of this._shopColliders) shiftC(c);
    shiftC(this._doorCollider);
    shiftV(this.counterPos);
    shiftV(this.doorPos);
    shiftV(this.doorInside);
    for (const q of this.queueSpots) shiftV(q);
    for (const slot of this.slots) {
      shiftV(slot.pos);
      shiftV(slot.browsePos);
      for (const b of slot.browseSpots) shiftV(b);
    }
    for (const t of this.tables) shiftV(t.interactPos);
    const z0 = this.zones[0]; // the shop's indoor camera zone
    z0.minX += ox; z0.maxX += ox; z0.minZ += oz; z0.maxZ += oz;
    z0.cx += ox; z0.cz += oz;
    const br = this.buildingRect;
    br.minX += ox; br.maxX += ox; br.minZ += oz; br.maxZ += oz;
  },

  // Rotate the town 90° — (x, z) → (−z, x) — so the street runs along the
  // screen's long axis with the cave mouth at the TOP. The rotation is
  // baked into each existing top-level child's transform (not the group), so
  // group space stays identical to world space for everything spawned later
  // (customers, the Mayor, stocked item sprites). Every stored logic anchor —
  // colliders, spots, zones, bounds — is mapped through the same transform.
  _rotateTown() {
    const qR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    for (const child of this.group.children) {
      const p = child.position;
      p.set(-p.z, p.y, p.x);
      child.quaternion.premultiply(qR);
    }
    // the door leaves live inside shopGroup, which carries the town's baked
    // quarter-turn on its own quaternion — so the leaves swing about a zero
    // local base (see update()); the group supplies the world orientation.
    this._doorBaseY = 0;
    const rotV = (v) => { const x = v.x; v.x = -v.z; v.z = x; return v; };
    const rotC = (c) => {
      const nx = -c.z, nz = c.x, hw = c.hd, hd = c.hw;
      c.x = nx; c.z = nz; c.hw = hw; c.hd = hd;
    };
    // lot colliders live inside this array too (shared object refs), so one
    // pass covers them all
    for (const c of this.colliders) rotC(c);
    rotC(this._doorCollider); // joins the list after the nav bake
    rotV(this.counterPos);
    for (const q of this.queueSpots) rotV(q);
    rotV(this.doorPos);
    rotV(this.doorInside);
    rotV(this.caveMouthPos);
    for (const slot of this.slots) {
      rotV(slot.pos);
      rotV(slot.browsePos);
      for (const b of slot.browseSpots) rotV(b);
    }
    for (const t of this.tables) rotV(t.interactPos);
    for (const lot of this.lots) rotV(lot.interactPos);
    for (const z of this.zones) {
      Object.assign(z, {
        minX: -z.maxZ, maxX: -z.minZ, minZ: z.minX, maxZ: z.maxX,
        cx: -z.cz, cz: z.cx,
      });
    }
    const b = this.bounds;
    Object.assign(b, { minX: -b.maxZ, maxX: -b.minZ, minZ: b.minX, maxZ: b.maxX });
    const br = this.buildingRect;
    Object.assign(br, { minX: -br.maxZ, maxX: -br.minZ, minZ: br.minX, maxZ: br.maxX });
    // the street now runs LEFT→RIGHT (along post +X): derive its post-rotation
    // extents and anchors from the pre-rotation road rect (post X = −z_pre,
    // post Z = x_pre). The two ends are the spawn / exit points for customers,
    // the Mayor and the clerk; passers-by roam the rect between them.
    const rd = this._road;
    const alongLo = -rd.streetLeftZ;   // left end (post X)
    const alongHi = -rd.streetRightZ;  // right end (post X)
    const crossMid = rd.roadCenterX;   // road centre (post Z)
    this.streetEndN = new THREE.Vector3(alongLo + 2, 0, crossMid); // left end
    this.streetEndS = new THREE.Vector3(alongHi - 4, 0, crossMid); // right (village) end
    // passers-by roam the road: `along` spans its length (post X), `cross` its
    // on-screen thickness (post Z, between the buildings row and the houses)
    this.streetRegion = {
      minAlong: alongLo + 1,
      maxAlong: alongHi - 1,
      minCross: rd.roadNearX + 0.5,
      maxCross: rd.roadFarX - 0.5,
    };
  },

  // The cave mouth: a mound of stacked rock with a dark opening facing down
  // the street, and a dirt apron where the road peters out. It sits at the
  // pre-rotation WEST end of the street — the post-rotation TOP of the road,
  // its maw facing south toward the camera and the shop just below it, so the
  // walk from the pit to the till is a few steps. `caveMouthPos` is the
  // walk-in spot the travel trigger watches.
  _buildCaveMouth(mkGround) {
    // Middle of the road's top (far) row, its maw facing +Z (down toward the
    // camera and the road). Pre-rotation: x → on-screen vertical, −z → on-screen
    // horizontal, so (cx, cz) below lands the mound at post ≈ (−cz, cx).
    // Position is authored in layout.json's `buildings.cave` (editable in the
    // overworld editor); falls back to the code default.
    const cd = getLayout().buildings?.cave;
    const cx = cd?.x ?? 3, cz = cd?.z ?? -18; // post ≈ (18, 3) — centred over the street
    // the rocky mound + dark maw is a self-contained assembly (also shown in
    // the admin catalogue) — build it at the origin and drop it into place
    const mouth = makeCaveMouth();
    mouth.position.set(cx, BUILDING_LIFT, cz); // lift off the road to avoid z-fighting
    this.group.add(mouth);
    this._caveMouthGroup = mouth; // exposed so the editor can select / grab it
    // dirt apron spilling from the mouth down onto the road
    const apron = mkGround(4.5, 6.5, cx + 2.6, cz, 0x6b5a45);
    apron.position.y = 0.015;
    // solid: the mound can't be walked through (the trigger fires first)
    this.colliders.push({ x: cx, z: cz, hw: 1.8, hd: 3.4 });
    this.caveMouthPos = new THREE.Vector3(cx + 1.4, 0, cz);
    this._cavePre = { x: cx, z: cz };
  },

  // Build the rest of the town around the shop: the restoration lots across the
  // road, the plaza floor, the building footprint and the camera zone that locks
  // the view onto the shop while the player is standing inside it.
  _buildTown(mkGround) {
    const { W, D } = SHOP;

    // the shop's footprint — the roof reads it to duck out of the way while the
    // player is inside
    this.buildingRect = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };

    // camera zone: standing inside the shop locks the camera to its centre;
    // out on the open street the camera follows the player.
    this.zones = [
      { minX: -W / 2, maxX: W / 2, minZ: -D / 2 - 0.4, maxZ: D / 2 + 0.4, cx: 0, cz: 0 }, // shop
    ];
    // Soft outer fence at the meadow's edge (the solid containment is the
    // buildings / lots / cave / hill colliders). Pre-rotation coords — after the
    // quarter-turn these become the post bounds ≈ { x[−12,54], z[−14,32] } that
    // frame the horizontal high street, the buildings row and the houses.
    this.bounds = {
      minX: -14,
      maxX: 32,
      minZ: -54,
      maxZ: 12,
    };
  },

  // ---- town restoration lots -----------------------------------------------
  // The run-down flanks of the street: the sites the player rebuilds with the
  // Mayor's fund. Every lot comes from layout.json — position, yaw, cost, the
  // resident archetype it brings, and the two primitive-part models it swaps
  // between: `before` (boarded-up plot / stone ruin) and `after` (the finished
  // house revealed by restoreLot; a new resident then moves in — a distinct
  // customer archetype who shops here, quickening and enriching the foot
  // traffic — see _spawnCustomer). Both states are hand-editable per lot in
  // the overworld editor.
  _buildLots() {
    this.lots = [];
    for (const def of getLayout().lots) {
      const yaw = def.yaw || 0;
      const lotGroup = new THREE.Group();
      lotGroup.position.set(def.x, BUILDING_LIFT, def.z); // lift off the road to avoid z-fighting
      lotGroup.rotation.y = yaw;
      this.group.add(lotGroup);
      const before = buildLotParts(def.before);
      const after = buildLotParts(def.after);
      after.visible = false;
      lotGroup.add(before, after);

      // seal the flank (as the old facade did) and never let anyone walk the
      // lot; colliders stay axis-aligned, so take the yawed footprint's AABB
      const cb = rotAABB(2.0, 1.5, yaw);
      const collider = { x: def.x, z: def.z, hw: cb.hw, hd: cb.hd };
      this.colliders.push(collider);

      this.lots.push({
        kind: def.kind, cost: def.cost, resident: def.resident,
        group: lotGroup, before, after, collider,
        restored: false,
        interactPos: offV(def.x, def.z, 0, 2.3, yaw), // stand on the road side
      });
    }
  },

  // ---- meadow forage ---------------------------------------------------------
  // Freckle the walkable fields around town with destructible scenery — flower
  // clumps, berry bushes, nut saplings and mushrooms — each smashable with a
  // dash for edible loot (see Shop.smashForage / decor.FIELD_FORAGE). Runs in
  // post-rotation WORLD space (after _rotateTown), rejecting any spot on the
  // paved street, inside the shop footprint, over a collider (walls, lots, cave,
  // hills) or crowding another prop, so props only ever land out on open grass.
  _buildForage() {
    this.forageProps = [];
    this.drops = []; // ground loot dropped by smashed forage (see Shop.update)
    const r = rng(0x5A1AD5);
    const cats = Object.keys(FIELD_FORAGE);
    const totalW = cats.reduce((s, c) => s + FIELD_FORAGE[c].weight, 0);
    const rollCat = () => {
      let roll = r() * totalW;
      for (const c of cats) { roll -= FIELD_FORAGE[c].weight; if (roll <= 0) return c; }
      return cats[cats.length - 1];
    };
    const b = this.bounds;
    const br = this.buildingRect;
    // the paved street corridor (pavement + road + plaza), post-rotation — kept
    // clear so forage reads as growing off the road, not on it. Mirrors the
    // pre-rotation street bands laid out in _build / _buildTown.
    const street = { minX: -8, maxX: 48, minZ: 7, maxZ: 20 };
    const inRect = (x, z, rect, m = 0) =>
      x > rect.minX - m && x < rect.maxX + m && z > rect.minZ - m && z < rect.maxZ + m;
    const hitsCollider = (x, z, pad) =>
      this.colliders.some((c) => !c.disabled &&
        Math.abs(x - c.x) < c.hw + pad && Math.abs(z - c.z) < c.hd + pad);

    const target = 52; // how many props to try to plant
    let tries = 0;
    while (this.forageProps.length < target && tries < target * 60) {
      tries++;
      const x = b.minX + 1 + r() * (b.maxX - b.minX - 2);
      const z = b.minZ + 1 + r() * (b.maxZ - b.minZ - 2);
      if (inRect(x, z, street)) continue; // off the road
      if (inRect(x, z, br, 1.2)) continue; // clear of the building
      if (this.dojo && inRect(x, z, this.dojo.rect, 0.6)) continue; // clear of the dojo
      if (hitsCollider(x, z, 0.9)) continue; // not inside a wall / lot / hill / cave
      if (this.forageProps.some((p) => Math.abs(p.x - x) < 1.6 && Math.abs(p.z - z) < 1.6)) continue;
      const cat = rollCat();
      const [h0, h1] = FIELD_FORAGE[cat].height;
      const height = h0 + r() * (h1 - h0);
      const s = decorSprite(pick(r, DECOR[cat]), { height });
      s.position.set(x, 0, z);
      this.group.add(s);
      this.forageProps.push({
        group: s, cat, x, z, height,
        color: DECOR_BURST[cat],
        radius: Math.max(0.55, Math.min(1.1, height * 0.45)),
        id: this.forageProps.length,
      });
    }
  },
};

// The cave mouth's rocky mound + dark maw, built at the local origin with its
// opening facing +Z (before the town's quarter-turn). A standalone assembly so
// both the street (_buildCaveMouth) and the admin catalogue draw the same rig.
export function makeCaveMouth() {
  const group = new THREE.Group();
  const rock = makeToonMaterial({ color: 0x5c5248, rim: 0 });
  const rock2 = makeToonMaterial({ color: 0x6a5f52, rim: 0 });
  const mkRock = (w, h, d, x, y, z, mat = rock, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  };
  const rock3 = makeToonMaterial({ color: 0x4e463d, rim: 0 });
  const moss = makeToonMaterial({ color: 0x55703e, rim: 0 });
  // the hill itself: a broad back mass stepping up and inward, so the mound
  // reads as a rocky rise rather than two lone pillars
  mkRock(2.8, 2.2, 6.8, -1.0, 1.1, 0, rock3, 0.05);
  mkRock(2.4, 3.6, 5.6, -0.7, 1.8, 0.3, rock, -0.04);
  mkRock(2.0, 4.6, 3.6, -0.9, 2.3, -0.5, rock2, 0.1);
  // two rough pillars + a lintel frame the opening on the street side
  mkRock(2.0, 3.4, 1.7, 0.2, 1.7, -1.9, rock, -0.18);
  mkRock(2.0, 3.4, 1.7, 0.2, 1.7, 1.9, rock2, 0.14);
  mkRock(2.4, 1.5, 5.2, -0.2, 3.55, 0, rock, -0.06);
  mkRock(1.6, 1.0, 3.0, 0.1, 4.35, 0.2, rock2, 0.12); // capstone atop the lintel
  // boulders piled around the base, big to small toward the road
  mkRock(1.6, 2.0, 1.5, 1.1, 1.0, -2.7, rock2, -0.5);
  mkRock(1.4, 1.5, 1.4, 1.0, 0.75, 2.8, rock, 0.4);
  mkRock(1.0, 0.9, 1.0, 1.9, 0.45, 1.6, rock3, -0.3);
  mkRock(0.8, 0.6, 0.8, 2.1, 0.3, -1.7, rock2, 0.55);
  mkRock(0.55, 0.45, 0.55, 2.4, 0.22, 0.9, rock, -0.7);
  // cracked slabs half-sunk beside the threshold
  mkRock(1.1, 0.18, 0.9, 2.2, 0.09, -0.6, rock3, 0.25);
  mkRock(0.9, 0.14, 0.7, 2.6, 0.07, 0.2, rock2, -0.35);
  // moss clinging to the mound's shoulders and a few tufts at the base
  const mkMoss = (r, h, x, y, z) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), moss);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  mkMoss(0.55, 0.5, -0.4, 4.5, -1.4);
  mkMoss(0.45, 0.42, -0.8, 4.4, 1.5);
  mkMoss(0.4, 0.5, 1.4, 2.1, -2.6);
  mkMoss(0.35, 0.45, 1.6, 1.6, 2.7);
  mkMoss(0.3, 0.4, 2.3, 0.2, -1.2);
  mkMoss(0.28, 0.38, 2.5, 0.19, 1.5);
  // the dark maw itself, facing down the street toward the approach
  const maw = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ color: 0x05060a })
  );
  maw.rotation.y = Math.PI / 2;
  maw.position.set(0.8, 1.3, 0); // recessed behind the pillar faces so the opening reads as depth
  group.add(maw);
  // a shadowed threshold spilling out of the opening — the top-down read of
  // "this is a hole in the hill" survives whatever way the camera faces
  const thresh = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 22).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x0a0806 })
  );
  thresh.position.set(1.6, 0.02, 0);
  group.add(thresh);
  return group;
}

// ---- layout helpers ---------------------------------------------------------
// Rotate a local (dx, dz) offset by yaw around Y (three.js convention:
// (x, z) → (x·cosθ + z·sinθ, −x·sinθ + z·cosθ)).
function rotXZ(dx, dz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

// A world anchor at centre (cx, cz) plus a yaw-rotated local offset — used for
// slot positions, browse spots and interact spots on yawed fixtures.
function offV(cx, cz, dx, dz, yaw, y = 0) {
  const o = rotXZ(dx, dz, yaw);
  return new THREE.Vector3(cx + o.x, y, cz + o.z);
}

// The axis-aligned bounding half-extents of a yawed (hw, hd) footprint — the
// collision system only speaks AABBs, so yawed fixtures block their AABB.
function rotAABB(hw, hd, yaw) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  return { hw: hw * c + hd * s, hd: hw * s + hd * c };
}

// Build one lot state (before/after) from its layout part specs: primitive
// meshes in lot-local coordinates. Each mesh remembers its part index so the
// overworld editor can map a click back to the layout entry.
//   { shape: "box"|"cone"|"ground", size, pos: [x,y,z], yaw?, color, mat? }
//   box: size [w,h,d] · cone: size [radius,height,segments] · ground: size [w,d]
export function buildLotParts(parts) {
  const group = new THREE.Group();
  parts.forEach((p, k) => {
    let geo;
    if (p.shape === "cone") geo = new THREE.ConeGeometry(p.size[0], p.size[1], p.size[2] ?? 8);
    else if (p.shape === "ground") geo = new THREE.PlaneGeometry(p.size[0], p.size[1]).rotateX(-Math.PI / 2);
    else geo = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
    const mat = p.mat === "basic"
      ? new THREE.MeshBasicMaterial({ color: p.color })
      : makeToonMaterial({ color: p.color, rim: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.rotation.y = p.yaw || 0;
    mesh.userData.partIndex = k;
    group.add(mesh);
  });
  return group;
}

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
