// The shop: a cosy room with display tables, a vitrine window on the
// shopfront, a counter, a bed, and a trapdoor to the dungeon below. During
// the day, procedurally generated customers arrive in waves, wander the
// floor browsing a few items, and — if something catches their eye — haggle.
// The Recettear loop: buy low in the dungeon, pin the price just under each
// customer's hidden tolerance, chain PERFECT deals.
import * as THREE from "three";
import { makeToonMaterial, makeBlobShadow } from "../core/toon.js";
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
    // customers arrive as one big rush the moment the doors open; when the
    // last one leaves, the doors swing shut until the player opens up again.
    this._waveLeft = 0; // shoppers still to rush in from the street
    this._waveActive = false; // a rush is underway — auto-close when it empties
    this._spawnT = 0; // spacing between arrivals inside the rush
    this._passerT = 2; // countdown to the next passer-by
    this._build();
  }

  _build() {
    const g = this.group;
    const wallMat = makeToonMaterial({ color: 0x8a6f9e, rim: 0 });
    const wallMat2 = makeToonMaterial({ color: 0x77608c, rim: 0 });
    const woodMat = makeToonMaterial({ color: 0x8a5a33, rim: 0 });
    const wood2 = makeToonMaterial({ color: 0x6e4526, rim: 0 });
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

    // side walls
    mkWall(0.4, wallH, D, -W / 2, wallH / 2, 0, wallMat2); // left
    mkWall(0.4, wallH, D, W / 2, wallH / 2, 0, wallMat2); // right
    // front wall (nearest the camera): one low wall so the view stays open
    mkWall(W, 1.1, 0.35, 0, 0.55, D / 2, wallMat2);
    this.colliders.push(
      { x: -W / 2, z: 0, hw: 0.35, hd: D / 2 },
      { x: W / 2, z: 0, hw: 0.35, hd: D / 2 },
      { x: 0, z: D / 2, hw: W / 2, hd: 0.3 }
    );

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

    // hinged double doors filling the shopfront doorway. They swing open during
    // the day so customers can wander in, and shut at night. Each leaf pivots
    // on its outer jamb and swings outward into the street.
    const doorPanelMat = makeToonMaterial({ color: 0x7a4a28, rim: 0 });
    const doorTrimMat = makeToonMaterial({ color: 0x5c3720, rim: 0 });
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
    this.doorsOpen = false;
    this.doorHeld = false; // scene override: someone (the landlord) is holding the doors open
    this._doorAngle = 0; // 0 = shut, 1 = fully swung open (eased each frame)
    // toggled in/out of `colliders` so a shut door blocks the player (kept out
    // of the baked nav grid, so open doors let customers path straight through)
    this._doorCollider = { x: doorCx, z: backZ, hw: doorW / 2, hd: 0.35 };

    // counter (along the right wall, clear of the window)
    const counter = mkWall(0.9, 1.0, 3, W / 2 - 0.7, 0.5, -1.2, woodMat);
    this.colliders.push({ x: W / 2 - 0.7, z: -1.2, hw: 0.45, hd: 1.5 });
    this.counterPos = new THREE.Vector3(W / 2 - 1.4, 0, -1.2);

    // trapdoor to the dungeon (mid left)
    const trap = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 24).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0x241735, rim: 0 })
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
      new THREE.MeshBasicMaterial({ color: 0x7a4dff, transparent: true, opacity: 0.5 })
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
    // closed for the night so the shopkeeper can drop down into the cellar. It
    // hinges on its far (back) edge and swings up toward the wall.
    const lidMat = makeToonMaterial({ color: 0x6e4526, rim: 0 });
    const lidTrim = makeToonMaterial({ color: 0x4a2c17, rim: 0 });
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

    // display tables (2x2 grid, 2 slots each = 8 slots)
    const tablePts = [
      [-1.6, 0.6], [1.6, 0.6],
      [-1.6, 3.2], [1.6, 3.2],
    ];
    for (const [tx, tz] of tablePts) {
      const t = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 1.1), woodMat);
      top.position.y = 0.78;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 0.8), wood2);
      legs.position.y = 0.36;
      t.add(top, legs);
      t.position.set(tx, 0, tz);
      g.add(t);
      this.colliders.push({ x: tx, z: tz, hw: 1.15, hd: 0.6 });
      for (const dx of [-0.55, 0.55]) {
        this.slots.push({
          pos: new THREE.Vector3(tx + dx, 0.86, tz),
          browsePos: new THREE.Vector3(tx + dx, 0, tz + 1.05),
          item: null,
          mesh: null,
        });
      }
    }

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
    for (const dx of [-1.05, 0, 1.05]) {
      this.slots.push({
        pos: new THREE.Vector3(fancyCx + dx, 0.92, fancyZ),
        browsePos: new THREE.Vector3(fancyCx + dx, 0, fancyZ + 1.15),
        item: null,
        mesh: null,
        fancy: true,
      });
    }

    // lamps for cosiness
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.1), wood2);
      pole.position.y = 1.05;
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 10), makeToonMaterial({ color: 0xffd98a, rim: 0 }));
      shade.position.y = 2.2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
      bulb.position.y = 2.0;
      // a real warm point light in the bulb — off by day, kindled at night by
      // _updateLighting so the shop actually glows once the sun's gone down
      const glow = new THREE.PointLight(0xffca7a, 0, 9, 1.6);
      glow.position.y = 2.0;
      lamp.add(pole, shade, bulb, glow);
      lamp.position.set(sx * (W / 2 - 1), 0, 2.8);
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
    const streetW = 24;
    const paveFar = backZ - 2.6; // pavement runs from the wall out to here
    const roadFar = backZ - 9.5;
    mkGround(streetW, backZ - paveFar, 0, (backZ + paveFar) / 2, 0x9a94a6); // pavement
    mkGround(streetW, paveFar - roadFar, 0, (paveFar + roadFar) / 2, 0x4b4557); // road
    mkGround(streetW, 0.18, 0, paveFar + 0.09, 0xc7c1d2); // curb line
    // dashed centre line down the road
    for (let lx = -streetW / 2 + 1.5; lx < streetW / 2; lx += 2.4) {
      mkGround(1.1, 0.18, lx, (paveFar + roadFar) / 2, 0xd9d3a0);
    }

    // a building facade across the street for depth (seen through the window)
    const facadeZ = roadFar - 0.3;
    mkWall(streetW, 5.2, 0.5, 0, 2.6, facadeZ, makeToonMaterial({ color: 0x6a5a7d, rim: 0 }));
    mkWall(streetW, 0.7, 0.7, 0, 5.35, facadeZ, wood2); // cornice
    const winLit = new THREE.MeshBasicMaterial({ color: 0xffdf9c });
    const winDark = makeToonMaterial({ color: 0x2c2438, rim: 0 });
    for (let wx = -streetW / 2 + 1.6; wx < streetW / 2 - 1; wx += 2.6) {
      for (const wy of [1.7, 3.4]) {
        const pane = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, 1.2, 0.1),
          Math.random() < 0.5 ? winLit : winDark
        );
        pane.position.set(wx, wy, facadeZ + 0.3);
        g.add(pane);
      }
    }

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

    this.doorPos = new THREE.Vector3(doorCx, 0, backZ - 1.3); // outside: door step
    this.doorInside = new THREE.Vector3(doorCx, 0, backZ + 1.2); // threshold just inside
    // pulsing affordance ring on the threshold so the doors read as interactive
    this.doorHint = makeFloorHint();
    this.doorHint.position.copy(this.doorInside).setY(0.03);
    g.add(this.doorHint);

    // billboard scenery lining the street outside (seeded so co-op peers match)
    populateStreet(g, rng(0xC0FFEE), { W, backZ, streetHalfX: this.streetHalfX });

    // bake a coarse navigation grid of the shop floor so customers can route
    // around the tables & furniture instead of shoving straight through them.
    this._buildNav();
    // doors start shut: block the opening (added after nav bake so the grid
    // still treats the doorway as walkable for when they're opened)
    this.colliders.push(this._doorCollider);
  }

  // Open or shut the shopfront. When open, customers can arrive. The doorway
  // collider and the physical swing are driven in update() so that closing up
  // keeps the door held open until every customer has run out.
  setDoorsOpen(open) {
    open = !!open;
    if (this.doorsOpen === open) return;
    this.doorsOpen = open;
    if (!open) {
      // closing kills any rush in progress so a stale flag can't slam the
      // doors shut the instant they're next opened
      this._waveActive = false;
      this._waveLeft = 0;
    }
    if (open) this.game.audio.doorbell();
    else this.game.audio.stairs();
  }

  // ------------------------------------------------------------ stocking
  freeSlot() {
    return this.slots.find((s) => !s.item);
  }

  stockItem(itemId, slot = this.freeSlot()) {
    if (!slot || slot.item) return false;
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
    const wantOpen = this.doorsOpen || this.customers.some((c) => !c._outside) || this.doorHeld;

    // ease the shopfront doors toward their open/shut pose
    const doorTgt = wantOpen ? 1 : 0;
    this._doorAngle += (doorTgt - this._doorAngle) * Math.min(1, dt * 7);
    if (this.doorLeaves) {
      const a = this._doorAngle * 2.1; // ~120° when fully open
      this.doorLeaves[0].rotation.y = a;
      this.doorLeaves[1].rotation.y = -a;
    }

    // The cellar trapdoor is the shopfront's opposite: it stays shut while the
    // shop is open for business and swings open the moment the doors close (and
    // the last customer's gone). Ease it inversely to the shopfront doors.
    // one cellar run a day (solo): once delved, hold the lid shut till morning
    const sealed = this.game.delvedToday && !this.game.net.connected;
    const trapTgt = wantOpen || sealed ? 0 : 1;
    this._trapAngle += (trapTgt - this._trapAngle) * Math.min(1, dt * 5);
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
    if (this.doorHint) {
      this.doorHint.visible = this._doorAngle < 0.5 && !hlOn(this.doorInside);
      this.doorHint.material.opacity = 0.16 + pulse * 0.08;
      const s = 1 + pulse * 0.08;
      this.doorHint.scale.set(s, 1, s);
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

    // customers only stream in while it's day *and* the doors are open
    if (game.phase === "day" && !game.gameOver && this.doorsOpen) this._pumpWaves(dt);

    for (const cust of [...this.customers]) {
      this._updateCustomer(cust, dt, elapsed);
    }
  }

  // Shift the shop's key + fill light (and the god-ray shafts) across the
  // trading day so the hour reads at a glance: a cool fresh morning warms up
  // to a bright midday, mellows into a golden afternoon, then bleeds into an
  // amber dusk and finally the cool blue of night. Down in the dungeon we hold
  // a fixed moody palette so descending never looks like broad daylight.
  _updateLighting(dt) {
    const game = this.game;
    const eng = game.engine;

    // resolve the target palette for the current place + time of day
    let hemiI, sunI;
    if (game.playerArea === "dungeon") {
      const p = DUNGEON_PAL;
      _tSky.copy(p.sky); _tGround.copy(p.ground); _tSun.copy(p.sun); _tBg.copy(p.bg); _tShaft.copy(p.shaft);
      hemiI = p.hemiI; sunI = p.sunI;
    } else if (game.phase === "night") {
      const p = NIGHT_PAL;
      _tSky.copy(p.sky); _tGround.copy(p.ground); _tSun.copy(p.sun); _tBg.copy(p.bg); _tShaft.copy(p.shaft);
      hemiI = p.hemiI; sunI = p.sunI;
    } else {
      const prog = game.dayProgress;
      let a = DAY_KEYS[0], b = DAY_KEYS[DAY_KEYS.length - 1];
      for (let i = 0; i < DAY_KEYS.length - 1; i++) {
        if (prog >= DAY_KEYS[i].p && prog <= DAY_KEYS[i + 1].p) { a = DAY_KEYS[i]; b = DAY_KEYS[i + 1]; break; }
      }
      const t = a.p === b.p ? 0 : (prog - a.p) / (b.p - a.p);
      _tSky.copy(a.sky).lerp(b.sky, t);
      _tGround.copy(a.ground).lerp(b.ground, t);
      _tSun.copy(a.sun).lerp(b.sun, t);
      _tBg.copy(a.bg).lerp(b.bg, t);
      _tShaft.copy(a.shaft).lerp(b.shaft, t);
      hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
      sunI = a.sunI + (b.sunI - a.sunI) * t;
    }

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

    // interior lamps: dark by day (the sun does the work), kindled once night
    // falls so the shop stays warm and readable after dusk
    const lampTgt = game.phase === "night" ? 2.4 : 0;
    for (const l of this.lampLights) l.intensity += (lampTgt - l.intensity) * k;
  }

  // Kick off the day's rush: the whole crowd piles in the moment the doors
  // open. Called by the host when the shopfront opens. Even bare tables draw a
  // lone browser who peeks in, finds nothing to buy, and files straight back
  // out — so the doors always close behind the wave (an empty opening must
  // never leave them stuck open now that there's no manual "close up").
  beginWave() {
    this._waveLeft = this.stockedCount() === 0
      ? 1
      : Math.min(MAX_CUSTOMERS, this.stockedCount() + 2);
    this._waveActive = true;
    this._spawnT = 0;
  }

  // Rush in the crowd, then bar the door behind them: shoppers pour in on the
  // player's heels (a heartbeat apart so they don't spawn stacked), and once
  // the last one has been served and left, the doors swing shut on their own.
  _pumpWaves(dt) {
    if (this._waveLeft > 0) {
      this._spawnT -= dt;
      if (this._spawnT <= 0 && this.customers.length < MAX_CUSTOMERS) {
        this._spawnCustomer();
        this._spawnT = 0.35;
        this._waveLeft--;
      }
      // shelves went bare mid-rush — stop filing more shoppers in
      if (this.stockedCount() === 0) this._waveLeft = 0;
    } else if (this._waveActive && this.customers.every((c) => c.state === "leave" && c._outside)) {
      // everyone's out the door (they finish strolling off down the street
      // after it shuts) — no need to wait for them to despawn at the corner
      this._waveActive = false;
      this.setDoorsOpen(false);
      this.game.hud.toast("The rush is over — the doors swing shut");
      this.game._syncState();
    }
  }

  // Cosmetic pedestrians that wander across the street and off the far side —
  // they never enter, they just make the world outside feel alive. Run on
  // every client independently; nothing here touches game state.
  _updatePassersby(dt, elapsed) {
    const game = this.game;
    if (game.phase === "day" && !game.gameOver) {
      this._passerT -= dt;
      if (this._passerT <= 0 && this.passersby.length < 3) {
        this._passerT = 2.5 + Math.random() * 4;
        this._spawnPasserby();
      }
    }
    for (const p of [...this.passersby]) {
      const c = p.creature;
      c.position.x += p.dir * p.speed * dt;
      c.heading = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      c.update(dt, elapsed);
      if ((p.dir > 0 && c.position.x > p.endX) || (p.dir < 0 && c.position.x < p.endX)) {
        c.dispose();
        this.passersby = this.passersby.filter((x) => x !== p);
      }
    }
  }

  _spawnPasserby() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const span = this.streetHalfX + 3.5;
    const creature = makeCustomerBody(Math.floor(Math.random() * 1e6));
    creature.position.set(-dir * span, 0, this.streetWalkZ - 0.6 - Math.random() * 0.7);
    creature.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.group.add(creature);
    this.passersby.push({ creature, dir, speed: 1.0 + Math.random() * 0.8, endX: dir * span });
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

    // weighted archetype
    const bag = [];
    for (const a of ARCHETYPES) for (let i = 0; i < a.w; i++) bag.push(a);
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
      const tier = clamp(1 + Math.floor(Math.random() * (1 + Math.floor(game.day / 3))), 1, 4);
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
        // the velvet table: a proper haggle for the best price
        cust.state = "want";
        cust.ready = true; // decided — haggle can pop immediately, no walk-up wait
        cust.emote = this.game.hud.emote(cust.creature, "alert", 999);
        this.game.audio.haggle();
      } else {
        // a plain table: they'll amble over and pay full sticker price, no haggle
        cust.state = "autobuy";
        cust.ready = false;
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
            cust.ready = true; // ready to be haggled with the moment they step in
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
        } else if (walkTo(tgt.browsePos, 2.7)) {
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
        // amble back to their pick and wait for the shopkeeper; lose patience.
        const slot = cust.slot;
        if (!slot || !slot.item) {
          this._clearEmote(cust);
          cust.state = "leave";
          cust._atDoor = false;
        } else {
          if (!walkTo(slot.browsePos, 2.4)) {
            /* still walking over */
          } else {
            faceSlot(slot);
            cust.ready = true; // arrived at their pick — ready to haggle
          }
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
        if (walkTo(slot.browsePos, 2.6)) {
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
        // a seller: stand at their spot and wait to be haggled with; if the
        // shopkeeper ignores them long enough, they take their goods and go.
        if (walkTo(cust.sellSpot)) {
          c.heading = Math.atan2(-c.position.x, 2 - c.position.z);
          cust.ready = true; // settled at their spot — ready to be haggled with
        }
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

  /** Nearest customer in "want" state within reach of pos. */
  wantingCustomerNear(pos, r = 2.2) {
    let best = null,
      bd = r;
    for (const cust of this.customers) {
      if (cust.state !== "want" || !cust.slot || !cust.slot.item) continue;
      const d = cust.creature.position.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = cust;
      }
    }
    return best;
  }

  /** Nearest seller (customer in "offer" state) within reach of pos. */
  sellingCustomerNear(pos, r = 2.2) {
    let best = null,
      bd = r;
    for (const cust of this.customers) {
      if (cust.state !== "offer" || !cust.sellItem) continue;
      const d = cust.creature.position.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = cust;
      }
    }
    return best;
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
        itemName: item.name, icon: item.icon, base: item.base, mood0: cust.arch.moods,
        custVariant: variantForSeed(cust.seed),
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
        itemName: item.name, icon: item.icon, base: item.base, mood0: cust.arch.moods, buying: true,
        custVariant: variantForSeed(cust.seed),
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

// ---- time-of-day light palettes --------------------------------------------
// `sky`/`ground` tint the hemisphere (ambient) fill, `sun` the warm key light
// and the god-ray shafts, `bg` the backdrop + fog. The day keys are sampled by
// `dayProgress` (0 = doors just opened, 1 = dusk) and interpolated between.
const _col = (hex) => new THREE.Color(hex);
const DAY_KEYS = [
  { p: 0.0,  sky: _col(0x9db6ff), ground: _col(0x24203a), hemiI: 0.9,  sun: _col(0xfff0d2), sunI: 1.7,  bg: _col(0x24325c), shaft: _col(0xfff2d0) }, // fresh morning
  { p: 0.45, sky: _col(0xc3c2e6), ground: _col(0x1c1630), hemiI: 0.95, sun: _col(0xffe7b4), sunI: 2.1,  bg: _col(0x2b2848), shaft: _col(0xffe6ad) }, // bright midday
  { p: 0.8,  sky: _col(0xd8aec0), ground: _col(0x241733), hemiI: 0.72, sun: _col(0xffc079), sunI: 1.85, bg: _col(0x361f3d), shaft: _col(0xffc074) }, // golden afternoon
  { p: 1.0,  sky: _col(0xdd8f6f), ground: _col(0x2a1230), hemiI: 0.6,  sun: _col(0xff8a48), sunI: 1.5,  bg: _col(0x3d1830), shaft: _col(0xff8f4a) }, // amber dusk
];
const NIGHT_PAL   = { sky: _col(0x6a79cc), ground: _col(0x0d0a1e), hemiI: 0.5, sun: _col(0x9fb2ff), sunI: 0.75, bg: _col(0x120a26), shaft: _col(0xaebdff) };
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
