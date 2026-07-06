// The shop: a cosy room with display tables, a counter, a bed, and a
// trapdoor to the dungeon below. During the day, procedurally generated
// customers wander in, pick an item off a table, and haggle — the
// Recettear loop: buy low in the dungeon, pin the price just under each
// customer's hidden tolerance, chain PERFECT deals.
import * as THREE from "three";
import { makeToonMaterial, makeBlobShadow } from "../core/toon.js";
import { Creature } from "../chargen/creature.js";
import { customerSpec } from "../chargen/species.js";
import { ITEMS, itemMesh } from "./items.js";
import { rng, pick, clamp } from "../core/engine.js";

const ARCHETYPES = [
  { name: "Cheapskate", moods: "🙄", lo: 1.02, hi: 1.18, w: 3 },
  { name: "Regular", moods: "🙂", lo: 1.1, hi: 1.4, w: 5 },
  { name: "Wealthy", moods: "🧐", lo: 1.3, hi: 1.75, w: 2 },
  { name: "Collector", moods: "🤩", lo: 1.5, hi: 2.2, w: 1 },
];

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
    this.colliders = []; // {x, z, hw, hd} AABBs (walls & furniture)
    this._custSeedPool = Array.from({ length: 10 }, (_, i) => 1000 + i);
    this._spawnT = 4;
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

    // walls (open front so the camera sees in; door gap in front wall)
    const wallH = 3;
    const mkWall = (w, h, d, x, y, z, mat = wallMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    mkWall(W, wallH, 0.4, 0, wallH / 2, -D / 2); // back
    mkWall(0.4, wallH, D, -W / 2, wallH / 2, 0, wallMat2); // left
    mkWall(0.4, wallH, D, W / 2, wallH / 2, 0, wallMat2); // right
    // front wall pieces with a door gap, kept low so the view stays open
    const doorW = 2.2;
    mkWall((W - doorW) / 2, 1.1, 0.35, -(doorW + (W - doorW) / 2) / 2, 0.55, D / 2, wallMat2);
    mkWall((W - doorW) / 2, 1.1, 0.35, (doorW + (W - doorW) / 2) / 2, 0.55, D / 2, wallMat2);
    this.colliders.push(
      { x: 0, z: -D / 2, hw: W / 2, hd: 0.35 },
      { x: -W / 2, z: 0, hw: 0.35, hd: D / 2 },
      { x: W / 2, z: 0, hw: 0.35, hd: D / 2 },
      { x: -(doorW + (W - doorW) / 2) / 2, z: D / 2, hw: (W - doorW) / 4, hd: 0.3 },
      { x: (doorW + (W - doorW) / 2) / 2, z: D / 2, hw: (W - doorW) / 4, hd: 0.3 }
    );

    // door mat + sign
    const mat2 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0xb08968, rim: 0 })
    );
    mat2.position.set(0, 0.01, D / 2 - 0.7);
    g.add(mat2);

    // counter (back right)
    const counter = mkWall(3, 1.0, 0.9, 3.2, 0.5, -D / 2 + 1.6, woodMat);
    this.colliders.push({ x: 3.2, z: -D / 2 + 1.6, hw: 1.5, hd: 0.45 });
    this.counterPos = new THREE.Vector3(3.2, 0, -D / 2 + 2.6);

    // bed (back left) — sleep to skip to next morning
    const bed = new THREE.Group();
    const bedBase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 2.2), wood2);
    bedBase.position.y = 0.2;
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 1.5), makeToonMaterial({ color: 0xc65a6e, rim: 0 }));
    blanket.position.set(0, 0.42, 0.25);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.5), makeToonMaterial({ color: 0xf2e9d8, rim: 0 }));
    pillow.position.set(0, 0.42, -0.7);
    bed.add(bedBase, blanket, pillow);
    bed.position.set(-W / 2 + 1.2, 0, -D / 2 + 1.6);
    g.add(bed);
    this.colliders.push({ x: -W / 2 + 1.2, z: -D / 2 + 1.6, hw: 0.75, hd: 1.15 });
    this.bedPos = new THREE.Vector3(-W / 2 + 2.2, 0, -D / 2 + 2.2);

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

    // rug + lamps for cosiness
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 24).rotateX(-Math.PI / 2),
      makeToonMaterial({ color: 0xa8563f, rim: 0 })
    );
    rug.position.set(0, 0.012, 1.9);
    g.add(rug);
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.1), wood2);
      pole.position.y = 1.05;
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 10), makeToonMaterial({ color: 0xffd98a, rim: 0 }));
      shade.position.y = 2.2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
      bulb.position.y = 2.0;
      lamp.add(pole, shade, bulb);
      lamp.position.set(sx * (W / 2 - 1), 0, 2.8);
      g.add(lamp);
    }

    this.doorPos = new THREE.Vector3(0, 0, D / 2 + 1.2);
  }

  // ------------------------------------------------------------ stocking
  freeSlot() {
    return this.slots.find((s) => !s.item);
  }

  stockItem(itemId) {
    const slot = this.freeSlot();
    if (!slot) return false;
    slot.item = itemId;
    slot.mesh = itemMesh(itemId);
    slot.mesh.position.copy(slot.pos);
    slot.mesh.scale.setScalar(1.4);
    this.group.add(slot.mesh);
    return true;
  }

  unstockSlot(slot) {
    if (slot.mesh) slot.mesh.removeFromParent();
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

    const game = this.game;
    if (game.net.isGuest) {
      for (const c of this.customers) c.creature.update(dt, elapsed);
      return;
    }

    if (game.phase === "day" && !game.gameOver) {
      this._spawnT -= dt;
      const maxC = 3;
      if (this._spawnT <= 0 && this.customers.length < maxC && this.stockedCount() > 0) {
        this._spawnT = 7 + Math.random() * 8;
        this._spawnCustomer();
      }
    }

    for (const cust of [...this.customers]) {
      this._updateCustomer(cust, dt, elapsed);
    }
  }

  _spawnCustomer() {
    const game = this.game;
    const seed = pick(rng(Math.random() * 1e9), this._custSeedPool) + Math.floor(Math.random() * 4) * 100;
    const spec = customerSpec(seed);
    const creature = new Creature(spec);
    creature.position.copy(this.doorPos).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, 1));
    creature.heading = Math.PI;
    this.group.add(creature);

    // pick a stocked slot to covet
    const stocked = this.slots.filter((s) => s.item);
    const slot = pick(rng(Math.random() * 1e9), stocked);
    // weighted archetype
    const bag = [];
    for (const a of ARCHETYPES) for (let i = 0; i < a.w; i++) bag.push(a);
    const arch = bag[Math.floor(Math.random() * bag.length)];
    const base = ITEMS[slot.item].base;
    const cust = {
      id: game.net.newId(),
      seed,
      creature,
      slot,
      arch,
      maxPay: Math.round(base * (arch.lo + Math.random() * (arch.hi - arch.lo))),
      strikes: 0,
      state: "enter", // enter -> browse -> want -> (haggling) -> leave
      t: 0,
      patience: 26,
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    game.net.send({
      t: "custAdd",
      id: cust.id, seed,
      x: creature.position.x, z: creature.position.z,
      slotIdx: this.slots.indexOf(slot),
      maxPay: cust.maxPay,
      archIdx: ARCHETYPES.indexOf(arch),
    });
  }

  // ---------------------------------------------------- guest-side mirrors
  mirrorCustomerAdd(m) {
    const creature = new Creature(customerSpec(m.seed));
    creature.position.set(m.x, 0, m.z);
    this.group.add(creature);
    this.customers.push({
      id: m.id,
      seed: m.seed,
      creature,
      slot: this.slots[m.slotIdx],
      arch: ARCHETYPES[m.archIdx] ?? ARCHETYPES[1],
      maxPay: m.maxPay,
      strikes: 0,
      state: "enter",
      t: 0,
      emote: null,
      _target: { x: m.x, z: m.z, h: 0 },
    });
  }

  mirrorCustomerSnap(list) {
    for (const [id, seed, x, z, h, state] of list) {
      const cust = this.customers.find((c) => c.id === id);
      if (!cust) continue;
      cust._target = { x, z, h };
      if (state !== cust.state && cust.state !== "haggling") {
        cust.state = state;
        if (state === "want" && !cust.emote) cust.emote = this.game.hud.emote(cust.creature, "❗", 999);
        if (state !== "want") this._clearEmote(cust);
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

    const walkTo = (target, speed = 1.9) => {
      _d.set(target.x - c.position.x, 0, target.z - c.position.z);
      const dist = _d.length();
      if (dist > 0.12) {
        _d.normalize();
        c.position.addScaledVector(_d, Math.min(speed * dt, dist));
        c.heading = Math.atan2(_d.x, _d.z);
        return false;
      }
      return true;
    };

    switch (cust.state) {
      case "enter": {
        if (!cust.slot.item) cust.state = "wander"; // item sold before arrival
        else if (walkTo(cust.slot.browsePos)) {
          cust.state = "browse";
          cust.t = 0;
        }
        break;
      }
      case "browse": {
        c.heading = Math.atan2(cust.slot.pos.x - c.position.x, cust.slot.pos.z - c.position.z);
        if (!cust.slot.item) {
          cust.state = "wander";
        } else if (cust.t > 1.4) {
          cust.state = "want";
          cust.t = 0;
          cust.emote = game.hud.emote(c, "❗", 999);
          game.audio.haggle();
        }
        break;
      }
      case "want": {
        // waits for the shopkeeper; handled by Game interaction. Loses patience.
        if (!cust.slot.item) {
          this._clearEmote(cust);
          cust.state = "wander";
        } else if (cust.t > cust.patience) {
          this._clearEmote(cust);
          game.hud.emote(c, "💢", 1.5);
          cust.state = "leave";
        }
        break;
      }
      case "haggling":
        break; // frozen while the sheet is open
      case "happy": {
        // little joy hop then leave
        if (cust.t > 1.1) cust.state = "leave";
        break;
      }
      case "wander": {
        // nothing to buy: shuffle around then leave
        if (cust.t > 3) cust.state = "leave";
        break;
      }
      case "leave": {
        if (walkTo(this.doorPos.clone().add(_d2.set(0, 0, 1.5)), 2.2)) {
          this._removeCustomer(cust);
          return;
        }
        break;
      }
    }
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

  /** Nearest customer in "want" state within reach of pos. */
  wantingCustomerNear(pos, r = 2.2) {
    let best = null,
      bd = r;
    for (const cust of this.customers) {
      if (cust.state !== "want") continue;
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
        hud.emote(cust.creature, grade === "perfect" ? "🤩" : "😊", 1.6);
      } else {
        cust.state = "leave";
        hud.emote(cust.creature, "😤", 1.6);
      }
      done(sold, price, grade, item);
    };

    ui = hud.haggle(
      { itemName: item.name, emoji: item.emoji, base: item.base, mood0: cust.arch.moods },
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
              ui.setMood(cust.strikes === 1 ? "😕" : "😠");
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
}

const _d = new THREE.Vector3();
const _d2 = new THREE.Vector3();

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
