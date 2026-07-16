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

// Keep the indoor camera focus away from walls while still allowing it to
// travel with the player through rooms that do not fit on a phone screen.
const CAMERA_ZONE_PAD = 1.25;
// Out on the open street the camera follows the player but stops at the
// walkable town limits (town edges, cave-entrance flanks, the back plaza) so it
// never pans out over the void beyond where the player can actually go.
const CAMERA_EDGE_PAD = 1.25;
// Default camera framing (height/back/distance offset from the focus point).
// Indoors starts a little farther back than the street; portrait viewports
// pull the shop cam back further (see fitShopCamera in game.js). All of these
// — pads, offsets, the zone/bounds limits — are overridable per-save from
// layout.json's optional `camera` block via _applyCameraLayout (shop-build.js),
// which is what the overworld editor's Camera panel writes.
const CAMERA_SHOP_OFFSET = [0, 12.8, 10.2];
const CAMERA_STREET_OFFSET = [0, 12.6, 9.4];
const CAMERA_SHOP_FIT_ASPECT = 0.65;

export class Shop {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
    this.slots = []; // display slots: {pos, tableMesh, item, mesh}
    this.customers = [];
    this.passersby = []; // ambient pedestrians strolling the street outside
    this._npcInUse = new Set(); // skins (variants) currently on screen — kept unique
    this.shafts = []; // god-ray light shafts (animated each frame)
    this.lampLights = []; // interior lamp point-lights, lit after dusk
    this.streetLampLights = []; // lamppost point-lights out on the street
    this.streetLampGlows = []; // lamppost glow-sphere materials (dim by day)
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
    this._cameraZoneTarget = { cx: 0, cz: 0 };
    this._streetTarget = { cx: 0, cz: 0 };
    // camera limits & framing — code defaults, folded over by layout.json's
    // optional `camera` block at build time (_applyCameraLayout). The editor
    // reads these live values back to seed & preview its Camera panel.
    this.cameraZonePad = CAMERA_ZONE_PAD;
    this.cameraEdgePad = CAMERA_EDGE_PAD;
    this.camShopOffset = new THREE.Vector3().fromArray(CAMERA_SHOP_OFFSET);
    this.camStreetOffset = new THREE.Vector3().fromArray(CAMERA_STREET_OFFSET);
    this.camShopFitAspect = CAMERA_SHOP_FIT_ASPECT;
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

  // Which camera zone the player is standing in. Indoors, follow the player
  // left/right (clamped to the room's borders) while keeping the vertical
  // focus pinned to the room centre — the camera pans sideways but never up or
  // down. This matters on portrait phones, where a fixed whole-room frame
  // leaves the player stranded at the edge. The open street uses streetCenter.
  zoneCenter(pos) {
    for (const z of this.zones) {
      if (pos.x < z.minX || pos.x > z.maxX || pos.z < z.minZ || pos.z > z.maxZ) continue;
      const minX = z.minX + this.cameraZonePad;
      const maxX = z.maxX - this.cameraZonePad;
      // Left/right: track the player but clamp to the room's borders.
      // Up/down: pinned to the room centre so the camera never pans vertically.
      this._cameraZoneTarget.cx = minX <= maxX ? Math.max(minX, Math.min(maxX, pos.x)) : z.cx;
      this._cameraZoneTarget.cz = z.cz;
      return this._cameraZoneTarget;
    }
    return null;
  }

  // Camera focus out on the open street/plaza: follow the player, but clamp to
  // the walkable town bounds (minus a pad) so the camera stops at the world
  // limits — the cave-entrance flanks, the town edges, the back of the plaza —
  // instead of drifting off over ground the player can never reach.
  streetCenter(pos) {
    const b = this.bounds;
    if (!b) { this._streetTarget.cx = pos.x; this._streetTarget.cz = pos.z; return this._streetTarget; }
    const minX = b.minX + this.cameraEdgePad;
    const maxX = b.maxX - this.cameraEdgePad;
    const minZ = b.minZ + this.cameraEdgePad;
    const maxZ = b.maxZ - this.cameraEdgePad;
    this._streetTarget.cx = minX <= maxX ? Math.max(minX, Math.min(maxX, pos.x)) : (b.minX + b.maxX) / 2;
    this._streetTarget.cz = minZ <= maxZ ? Math.max(minZ, Math.min(maxZ, pos.z)) : (b.minZ + b.maxZ) / 2;
    return this._streetTarget;
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
    // a locked shelf is just a floor outline — drop its hitbox so the player can
    // walk over the footprint until they've paid to build the fixture
    if (table.collider) table.collider.disabled = broken;
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

    // ease the shopfront doors toward their open/shut pose. The swing rides on
    // top of the town bake's yaw (_doorBaseY) — setting absolute angles here
    // would wipe the rotation and leave the leaves spinning against the wall.
    const doorTgt = wantOpen ? 1 : 0;
    this._doorAngle += (doorTgt - this._doorAngle) * Math.min(1, dt * 7);
    if (this.doorLeaves) {
      const a = this._doorAngle * 2.1; // ~120° when fully open
      const base = this._doorBaseY ?? 0;
      this.doorLeaves[0].rotation.y = base + a;
      this.doorLeaves[1].rotation.y = base - a;
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

    const br = this.buildingRect;
    const inBuilding = !!pp && this.game.playerArea === "shop" &&
      pp.x > br.minX - 0.3 && pp.x < br.maxX + 0.3 &&
      pp.z > br.minZ - 0.3 && pp.z < br.maxZ + 0.3;

    // The roof and the wall nearest the camera disappear while the player is
    // anywhere inside (shop + back rooms), keeping the whole interior readable.
    if (this.nearCameraWalls) {
      for (const wall of this.nearCameraWalls) wall.visible = !inBuilding;
    }
    if (this.roof) {
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

  // Light the shop by the real wall-clock time of day: the outdoor palette
  // sweeps morning → midday → dusk → night off the player's system clock, and
  // the shop + street lamps kindle once it gets dark. The dungeon (and the
  // FTUE cave, which shares its look) holds a fixed moody underground palette so
  // descending never looks like broad daylight.
  _updateLighting(dt) {
    const game = this.game;
    const eng = game.engine;

    // resolve the target palette + how far into night we are (0 = day, 1 = night)
    let hemiI, sunI, night;
    if (game.playerArea === "dungeon" || game.playerArea === "cave") {
      const p = DUNGEON_PAL;
      _tSky.copy(p.sky); _tGround.copy(p.ground); _tSun.copy(p.sun); _tBg.copy(p.bg); _tShaft.copy(p.shaft);
      hemiI = p.hemiI; sunI = p.sunI; night = 0; // underground: street lamps stay dark
    } else {
      // the admin panel can pin the clock to a fixed hour for debugging; when
      // it's null we run off the player's real wall-clock time
      let hour = game.debugHour;
      if (hour == null) {
        const now = new Date();
        hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
      }
      const s = sampleDayClock(hour);
      _tSky.copy(s.sky); _tGround.copy(s.ground); _tSun.copy(s.sun); _tBg.copy(s.bg); _tShaft.copy(s.shaft);
      hemiI = s.hemiI; sunI = s.sunI; night = s.night;
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

    // interior + street lamps kindle as night falls so the shop stays warm and
    // the street stays readable after dark
    const interiorTgt = night * 2.4;
    for (const l of this.lampLights) l.intensity += (interiorTgt - l.intensity) * k;
    const streetTgt = night * 3.2;
    for (const l of this.streetLampLights) l.intensity += (streetTgt - l.intensity) * k;
    // the lamp heads glow bright at night, dim to near-dark in daylight
    _tGlow.copy(_GLOW_OFF).lerp(_GLOW_ON, night);
    for (const gm of this.streetLampGlows) gm.color.lerp(_tGlow, k);

    // the street tree/bush billboards are unlit SpriteMaterial, so they don't
    // pick up hemi/sun like the rest of the world — approximate the diffuse
    // irradiance (ambient sky fill + warm key) off the already-eased lights and
    // tint the sprites so they cool and darken into dusk/night with everything
    // else instead of staying full-bright.
    const hi = eng.hemi.intensity, si = eng.sun.intensity, hc = eng.hemi.color, sc = eng.sun.color;
    _tDecor.setRGB(
      Math.min(1, (hc.r * hi * 0.5 + sc.r * si * 0.22) * 1.25),
      Math.min(1, (hc.g * hi * 0.5 + sc.g * si * 0.22) * 1.25),
      Math.min(1, (hc.b * hi * 0.5 + sc.b * si * 0.22) * 1.25),
    );
    for (const g of this.decorSprites ?? []) {
      const m = g.userData.decorMat;
      if (m) m.color.copy(_tDecor);
    }
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
// and the god-ray shafts, `bg` the backdrop + fog. The dungeon holds a fixed
// moody underground look; the street runs the 24-hour clock below.
const _col = (hex) => new THREE.Color(hex);
// pitch-black backdrop underground so anything outside the dungeon itself
// (the void past the walls, the pit under the descent stairs) reads as solid dark
const DUNGEON_PAL = { sky: _col(0xb7a1ff), ground: _col(0x160e28), hemiI: 0.6, sun: _col(0xffdca0), sunI: 1.9,  bg: _col(0x000000), shaft: _col(0xffd08a) };

// The street's palette keyed on the real wall-clock hour (0–24). Adjacent keys
// are lerped by the current hour; `night` (0 = full day → 1 = full dark) drives
// the shop + lamppost lights. Keys span the full circle so 24:00 mirrors 00:00.
// The bright midday plateau is deliberately held from ~10:00 to ~16:30 so the
// afternoon stays sunlit instead of sliding early into a dim golden hour.
// `swatch` is a representative sky tone used only by the debug gradient bar.
const DAY_CLOCK = [
  { h: 0,    sky: _col(0x6a79cc), ground: _col(0x0d0a1e), hemiI: 0.5,  sun: _col(0x9fb2ff), sunI: 0.55, bg: _col(0x0c0a1e), shaft: _col(0xaebdff), night: 1,    swatch: 0x0c0a1e }, // deep night
  { h: 5,    sky: _col(0x6a79cc), ground: _col(0x0d0a1e), hemiI: 0.5,  sun: _col(0x9fb2ff), sunI: 0.55, bg: _col(0x0e0b22), shaft: _col(0xaebdff), night: 1,    swatch: 0x141438 }, // pre-dawn
  { h: 6.5,  sky: _col(0x9db6ff), ground: _col(0x24203a), hemiI: 0.82, sun: _col(0xffd2b0), sunI: 1.4,  bg: _col(0x2a2a58), shaft: _col(0xffe0c8), night: 0.4,  swatch: 0xffb98a }, // dawn
  { h: 8,    sky: _col(0x9db6ff), ground: _col(0x24203a), hemiI: 0.92, sun: _col(0xfff0d2), sunI: 1.85, bg: _col(0x24325c), shaft: _col(0xfff2d0), night: 0,    swatch: 0xbcd0ff }, // fresh morning
  { h: 10,   sky: _col(0xc3c2e6), ground: _col(0x1c1630), hemiI: 0.98, sun: _col(0xffe7b4), sunI: 2.15, bg: _col(0x2b2848), shaft: _col(0xffe6ad), night: 0,    swatch: 0xcfe0ff }, // bright — plateau start
  { h: 16.5, sky: _col(0xc7c0e0), ground: _col(0x1e1734), hemiI: 0.96, sun: _col(0xffe0a6), sunI: 2.1,  bg: _col(0x2e2846), shaft: _col(0xffdf9e), night: 0,    swatch: 0xcadcff }, // still bright — plateau end
  { h: 18,   sky: _col(0xd3bcd6), ground: _col(0x221836), hemiI: 0.82, sun: _col(0xffd7a0), sunI: 1.9,  bg: _col(0x322044), shaft: _col(0xffd79e), night: 0,    swatch: 0xffe0b4 }, // golden afternoon
  { h: 19.5, sky: _col(0xc7a7c2), ground: _col(0x241636), hemiI: 0.66, sun: _col(0xffb473), sunI: 1.5,  bg: _col(0x33203f), shaft: _col(0xffb877), night: 0.2,  swatch: 0xffb987 }, // amber dusk
  { h: 20.75,sky: _col(0x8a6fae), ground: _col(0x1a1030), hemiI: 0.55, sun: _col(0xc98ce0), sunI: 0.95, bg: _col(0x241640), shaft: _col(0xd0a0ff), night: 0.6,  swatch: 0x5a4a8a }, // nightfall
  { h: 22,   sky: _col(0x6a79cc), ground: _col(0x0d0a1e), hemiI: 0.5,  sun: _col(0x9fb2ff), sunI: 0.55, bg: _col(0x120a26), shaft: _col(0xaebdff), night: 1,    swatch: 0x141438 }, // night
  { h: 24,   sky: _col(0x6a79cc), ground: _col(0x0d0a1e), hemiI: 0.5,  sun: _col(0x9fb2ff), sunI: 0.55, bg: _col(0x0c0a1e), shaft: _col(0xaebdff), night: 1,    swatch: 0x0c0a1e }, // wraps to 00:00
];

// A CSS `linear-gradient(...)` stop list spanning 24h, built from each key's
// representative `swatch` tone. Used by the admin panel's day/night bar.
export function dayClockStops() {
  return DAY_CLOCK.map((k) => `#${k.swatch.toString(16).padStart(6, "0")} ${((k.h / 24) * 100).toFixed(1)}%`).join(", ");
}

// Sample the day clock at `hour` (0–24), writing the interpolated colors into
// the shared scratch targets and returning the scalar channels.
function sampleDayClock(hour) {
  let a = DAY_CLOCK[0], b = DAY_CLOCK[DAY_CLOCK.length - 1];
  for (let i = 0; i < DAY_CLOCK.length - 1; i++) {
    if (hour >= DAY_CLOCK[i].h && hour <= DAY_CLOCK[i + 1].h) { a = DAY_CLOCK[i]; b = DAY_CLOCK[i + 1]; break; }
  }
  const t = a.h === b.h ? 0 : (hour - a.h) / (b.h - a.h);
  return {
    sky: _tSky.copy(a.sky).lerp(b.sky, t),
    ground: _tGround.copy(a.ground).lerp(b.ground, t),
    sun: _tSun.copy(a.sun).lerp(b.sun, t),
    bg: _tBg.copy(a.bg).lerp(b.bg, t),
    shaft: _tShaft.copy(a.shaft).lerp(b.shaft, t),
    hemiI: a.hemiI + (b.hemiI - a.hemiI) * t,
    sunI: a.sunI + (b.sunI - a.sunI) * t,
    night: a.night + (b.night - a.night) * t,
  };
}

// lamp-head glow colors: near-dark by day, warm and bright once lit
const _GLOW_OFF = _col(0x2a2418);
const _GLOW_ON = _col(0xffe6a8);
const _tGlow = new THREE.Color();
const _tSky = new THREE.Color();
const _tGround = new THREE.Color();
const _tSun = new THREE.Color();
const _tBg = new THREE.Color();
const _tShaft = new THREE.Color();
const _tDecor = new THREE.Color();

// Re-export the shared data so existing import sites (game.js imports SHOP +
// ARCHETYPES, admin.js imports ARCHETYPES) keep working unchanged.
export { SHOP, ARCHETYPES } from "./shop-data.js";
