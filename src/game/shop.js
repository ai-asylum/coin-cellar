// The shop: a cosy room with display tables, a vitrine window on the
// shopfront, a counter, a bed, and a trapdoor to the dungeon below. During
// the day, procedurally generated customers arrive in waves, wander the
// floor browsing a few items, and — if something catches their eye — haggle.
// The Recettear loop: buy low in the dungeon, pin the price just under each
// customer's hidden tolerance, chain PERFECT deals.
import * as THREE from "three";
import { makeToonMaterial, feedOccluder } from "../core/toon.js";
import { variantForSeed } from "../chargen/blocky.js";
import { ITEMS, itemSprite } from "./items.js";
import { rng, pick } from "../core/engine.js";
import { buildMethods } from "./shop-build.js";
import { pathMethods } from "./shop-pathfinding.js";
import { customerMethods } from "./shop-customers.js";

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
      ex.pivot.rotation.y = -1.7;
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
  // Reflect a table's built/locked state: a built table shows its real fixture
  // (correct materials) and usable slots; a locked one hides the fixture and
  // shows only its glowing floor outline, marking where it'll go, slots off.
  _applyTableState(table) {
    const broken = !table.repaired;
    table.meshes.forEach((m, k) => { m.material = table.origMats[k]; m.visible = !broken; });
    if (table.outline) {
      table.outline.visible = broken;
      table.outline.material.color.setHex(table.outline.userData.baseColor);
      table.outline.material.opacity = 0.42;
    }
    for (const s of table.slots) s.disabled = broken;
  }

  // Flag one locked table as the interact target (the affordance in place of a
  // ground ring), or pass null/undefined to clear. Its floor outline pops to
  // white and pulses (see update()); the previously lit table's outline is
  // reset by _applyTableState to its resting amber.
  highlightTable(table) {
    const next = table || null;
    if (this._glowTable === next) return;
    if (this._glowTable) this._applyTableState(this._glowTable);
    this._glowTable = next;
    if (next && next.outline) next.outline.material.color.setHex(0xffffff);
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
    for (const s of this.shafts) s.userData.update(dt, elapsed);
    this._updateLighting(dt);

    // throb the floor outline on whichever locked table is the current target
    if (this._glowTable && this._glowTable.outline)
      this._glowTable.outline.material.opacity = 0.55 + Math.sin(elapsed * 6) * 0.35;

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
        ex.pivot.rotation.y = -ex._doorA * 1.7; // swing into the back room
      }
    }

    // the roof lifts away while the player is anywhere inside the building
    // (shop + its back rooms), so the interior stays readable
    if (this.roof) {
      const br = this.buildingRect;
      const inBuilding = !!pp && this.game.playerArea === "shop" &&
        pp.x > br.minX - 0.3 && pp.x < br.maxX + 0.3 &&
        pp.z > br.minZ - 0.3 && pp.z < br.maxZ + 0.3;
      const roofTgt = inBuilding ? 0 : 1;
      this._roofA += (roofTgt - this._roofA) * Math.min(1, dt * 9);
      this.roof.visible = this._roofA > 0.02;
      if (this.roof.visible) for (const m of this._roofMats) m.opacity = this._roofA;
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

    // resolve the target palette for the current place (the FTUE cave shares
    // the dungeon's moody underground look)
    const p = game.playerArea === "dungeon" || game.playerArea === "cave" ? DUNGEON_PAL : SHOP_PAL;
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

// Mix the split-out clusters back onto the prototype so `this.method()` calls
// across all four modules keep working unchanged.
Object.assign(Shop.prototype, buildMethods, pathMethods, customerMethods);

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
// pitch-black backdrop underground so anything outside the dungeon itself
// (the void past the walls, the pit under the descent stairs) reads as solid dark
const DUNGEON_PAL = { sky: _col(0xb7a1ff), ground: _col(0x160e28), hemiI: 0.6, sun: _col(0xffdca0), sunI: 1.9,  bg: _col(0x000000), shaft: _col(0xffd08a) };
const _tSky = new THREE.Color();
const _tGround = new THREE.Color();
const _tSun = new THREE.Color();
const _tBg = new THREE.Color();
const _tShaft = new THREE.Color();

// Re-export the shared data so existing import sites (game.js imports SHOP +
// ARCHETYPES, admin.js imports ARCHETYPES) keep working unchanged.
export { SHOP, ARCHETYPES } from "./shop-data.js";
