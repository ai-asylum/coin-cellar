// Game director: player, day/night cycle, debt schedule, area transitions,
// combat glue, economy, co-op message handling. The Recettear loop:
//   morning — stock the tables, open the doors
//   day     — haggle ("capitalism, ho!"), or let your partner keep shop
//   night   — delve the dungeon below for tomorrow's merchandise
//   pay the Guild every 3rd day or lose the shop.
import * as THREE from "three";
import { rng, pick, clamp, lerp } from "../core/engine.js";
import { Creature } from "../chargen/creature.js";
import { heroSpec } from "../chargen/species.js";
import { Shop, SHOP } from "./shop.js";
import { Dungeon, DUNGEON_ORIGIN } from "./dungeon.js";
import { ITEMS, itemMesh, swordMesh } from "./items.js";
import { Particles } from "./particles.js";
import { Coop } from "../net/coop.js";

const DAY_LEN = 160;
const DEBT = [
  { day: 3, amt: 180 },
  { day: 6, amt: 450 },
  { day: 9, amt: 1100 },
  { day: 12, amt: 2400 },
  { day: 15, amt: 5200 },
];
const START_INV = ["apple", "apple", "herb", "wsword"];
const SAVE_KEY = "shopslop_save_v1";

export class Game {
  constructor(engine, input, audio, hud) {
    this.engine = engine;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.net = new Coop(this);
    this.particles = new Particles(engine.scene);

    // --- state
    this.day = 1;
    this.phase = "day";
    this.dayT = DAY_LEN;
    this.gold = 100;
    this.debtIdx = 0;
    this.inventory = [...START_INV];
    this.invCap = 10;
    this.hp = 6;
    this.maxHp = 6;
    this.combo = 0;
    this.gameOver = false;
    this.victory = false;
    this.playerArea = "shop";
    this._invulnT = 0;
    this._pendingHit = -1;
    this._respawnT = -1;

    this._load();

    // --- world
    this.shop = new Shop(this);
    this.dungeon = new Dungeon(this);

    // --- player
    this.player = new Creature(heroSpec(7));
    this.player.position.set(0, 0, 2.5);
    this.player.holdItem(swordMesh(0xd7dde6, 0x6e4526, 0.55));
    engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => {
      this.audio.step();
      this.particles.burst(pos, { color: 0x9a8f80, n: 1, speed: 0.4, up: 0.5, gravity: 2, life: 0.35, size: 0.7 });
    };

    this.remote = null; // {creature, target:{x,z,h}, area}

    this._wireHud();
    this._morning(true);
    engine.onTick((dt, t) => this.update(dt, t));
  }

  // ================================================================ loop
  update(dt, elapsed) {
    this.input.update();
    this._updatePlayer(dt, elapsed);
    this._updateRemote(dt, elapsed);
    this.shop.update(dt, elapsed);
    this.dungeon.update(dt, elapsed);
    this.particles.update(dt);
    this.hud.update();
    this.net.update(dt);

    // day timer (host authority)
    if (!this.net.isGuest && this.phase === "day" && !this.gameOver) {
      this.dayT -= dt;
      if (this.dayT <= 0) this._nightfall();
    }

    // camera follows player
    const p = this.player.position;
    this.engine.camTarget.lerp(p, 1 - Math.pow(0.001, dt));
    const inDungeon = this.playerArea === "dungeon";
    this.engine.camOffset.lerp(inDungeon ? _camDungeon : _camShop, 1 - Math.pow(0.1, dt));
    this.audio.setMood(this.gameOver ? null : inDungeon ? "dungeon" : this.phase === "day" ? "shop" : null);
  }

  _updatePlayer(dt, elapsed) {
    const c = this.player;
    if (this._respawnT >= 0) {
      this._respawnT -= dt;
      c.update(dt, elapsed);
      if (this._respawnT < 0) this._respawn();
      return;
    }
    this._invulnT -= dt;
    c.mesh.visible = this._invulnT < 0 || Math.sin(elapsed * 30) > -0.3;

    // movement
    const mv = this.input.move;
    const sheetBlocked = this.hud.sheetOpen;
    if (!sheetBlocked && (mv.x || mv.y)) {
      const speed = 3.7;
      c.position.x += mv.x * speed * dt;
      c.position.z += mv.y * speed * dt;
      c.heading = Math.atan2(mv.x, mv.y);
    }
    const colliders = this.playerArea === "shop" ? this.shop.colliders : this.dungeon.colliders;
    this.collide(c.position, c.radius * 0.8, colliders);
    if (this.playerArea === "shop") {
      c.position.x = clamp(c.position.x, -SHOP.W / 2 + 0.5, SHOP.W / 2 - 0.5);
      c.position.z = clamp(c.position.z, -SHOP.D / 2 + 0.5, SHOP.D / 2 + 2.5);
    }

    // pending sword hit lands mid-swing
    if (this._pendingHit >= 0) {
      this._pendingHit -= dt;
      if (this._pendingHit < 0 && this.playerArea === "dungeon") {
        this.dungeon.meleeHit(c, 2, this);
      }
    }

    // auto-pickup drops (world coords)
    if (this.playerArea === "dungeon") {
      for (const drop of [...this.dungeon.drops]) {
        const dp = drop.mesh.position;
        const dx = dp.x - c.position.x;
        const dz = dp.z - c.position.z;
        if (dx * dx + dz * dz < 1.1) this._pickupDrop(drop);
      }
    }

    // context action
    const act = this._contextAction();
    this.input.setActionLabel(act.label);
    if (this.input.actionEdge && !sheetBlocked) act.fn();

    c.update(dt, elapsed);
  }

  _contextAction() {
    const p = this.player.position;
    if (this.playerArea === "shop") {
      const cust = this.shop.wantingCustomerNear(p);
      if (cust) return { label: "🗣️", fn: () => this._haggle(cust) };
      if (p.distanceTo(this.shop.trapdoorPos) < 1.5)
        return { label: "🕳️", fn: () => this._delve() };
      if (p.distanceTo(this.shop.bedPos) < 1.7)
        return { label: "🛏️", fn: () => this._sleep() };
      for (const slot of this.shop.slots) {
        if (slot.item && _v.copy(slot.pos).setY(0).distanceTo(p) < 1.5)
          return { label: "↩️", fn: () => this._unstock(slot) };
      }
      return { label: "⚔️", fn: () => this._attack() };
    }
    // dungeon (positions are group-local, player is world — offset)
    _v.copy(this.dungeon.entrancePos ?? _zero).add(DUNGEON_ORIGIN);
    if (this.dungeon.active && _v.distanceTo(p) < 1.4)
      return { label: "🏠", fn: () => this._returnHome() };
    if (this.dungeon.active) {
      _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
      if (_v.distanceTo(p) < 1.5) return { label: "⬇️", fn: () => this._descend() };
      for (const chest of this.dungeon.chests) {
        if (chest.opened) continue;
        _v.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.7) return { label: "🎁", fn: () => this._openChest(chest) };
      }
    }
    return { label: "⚔️", fn: () => this._attack() };
  }

  // ================================================================ combat
  _attack() {
    if (this.player.attack()) {
      this.audio.swing();
      this._pendingHit = 0.16;
      // swipe sparkle in front of the blade
      const h = this.player.heading;
      _v.set(this.player.position.x + Math.sin(h) * 1.1, 0.8, this.player.position.z + Math.cos(h) * 1.1);
      this.particles.burst(_v, { color: 0xdfe8ff, n: 5, speed: 1.6, up: 1.2, gravity: 3, life: 0.28, size: 0.8 });
    }
  }

  enemyHitsPlayer(e, targetEntry) {
    if (!targetEntry.local) {
      this.net.send({ t: "pHurt", dmg: e.def.dmg });
      return;
    }
    this.applyPlayerDamage(e.def.dmg, e.creature.position);
  }

  applyPlayerDamage(dmg, fromPos = null) {
    if (this._invulnT > 0 || this._respawnT >= 0 || this.gameOver) return;
    this._invulnT = 1.2;
    this.hp = Math.max(0, this.hp - dmg);
    this.hud.setHearts(this.hp, this.maxHp);
    this.player.hurt();
    this.audio.hurt();
    this.engine.hitStop(0.08);
    this.engine.shake(0.45);
    if (fromPos) {
      _v.copy(this.player.position).sub(fromPos).setY(0).normalize();
      this.player.position.addScaledVector(_v, 0.7);
    }
    this.hud.float(_v2.copy(this.player.position).setY(1.8), `-${dmg}`, "dmg hurt");
    if (this.hp <= 0) {
      this.player.die(_v.multiplyScalar(-6).setY(-2));
      this.hud.banner("You got carried home…", "half your gold slipped away", 2.6);
      this.audio.gameover();
      this._respawnT = 2.4;
    }
  }

  _respawn() {
    const lost = Math.floor(this.gold * 0.5);
    if (!this.net.isGuest) {
      this.gold -= lost;
      this._syncState();
    }
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(this.gold);
    // rebuild the player blob (the old one is a ragdoll now)
    const held = this.player.heldItem;
    this.player.dispose();
    this.player = new Creature(heroSpec(7));
    this.player.position.set(0, 0, 2.5);
    this.player.holdItem(swordMesh(0xd7dde6, 0x6e4526, 0.55));
    this.engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => this.audio.step();
    this.playerArea = "shop";
    this._save();
  }

  playersInDungeon() {
    const list = [];
    if (this.playerArea === "dungeon" && this._respawnT < 0) list.push({ creature: this.player, local: true });
    if (this.remote && this.remote.area === "dungeon" && !this.remote.dead)
      list.push({ creature: this.remote.creature, local: false });
    return list;
  }

  // ================================================================ economy
  gainGold(amount, pos = null) {
    this.gold += amount;
    this.hud.setGold(this.gold);
    if (pos) {
      const wp = _v2.copy(pos); // world coords
      this.particles.burst(wp.setY(wp.y + 0.6), { color: 0xffd34d, n: Math.min(4 + amount / 4, 14), speed: 2, life: 0.7 });
      this.hud.float(wp, `+${amount}g`, "gold");
    }
    for (let i = 0; i < Math.min(amount / 8, 5); i++) this.audio.coin(i);
    this._syncState();
  }

  _pickupDrop(drop) {
    if (this.inventory.length >= this.invCap) {
      if (!this._bagFullT || performance.now() - this._bagFullT > 2000) {
        this.hud.toast("🎒 Bag is full!");
        this._bagFullT = performance.now();
      }
      return;
    }
    this.dungeon.takeDrop(drop);
    this.audio.pickup();
    if (this.net.isGuest) {
      this.net.send({ t: "take", id: drop.id });
    } else {
      this.inventory.push(drop.item);
      this._syncInv();
      this.net.send({ t: "dropTake", id: drop.id });
    }
    const it = ITEMS[drop.item];
    this.hud.float(_v.copy(drop.mesh.position).setY(1.2), `${it.emoji} ${it.name}`, "loot");
    this._save();
  }

  _openChest(chest) {
    this.audio.chest();
    if (this.net.isGuest) {
      chest.opened = true;
      chest.mesh.children[1].rotation.x = -1.9;
      this.net.send({ t: "chestReq", id: chest.id });
      return;
    }
    this.dungeon.openChest(chest);
    this.net.send({ t: "chest", id: chest.id });
    this.engine.shake(0.15);
  }

  _stockFromBag(idx) {
    if (this.playerArea !== "shop") return this.hud.toast("You can only stock in the shop.");
    const itemId = this.inventory[idx];
    if (itemId == null) return;
    if (this.net.isGuest) {
      this.net.send({ t: "stockReq", idx });
      return;
    }
    if (!this.shop.freeSlot()) return this.hud.toast("All display slots are full.");
    this.inventory.splice(idx, 1);
    this.shop.stockItem(itemId);
    this.audio.pickup();
    this._syncInv();
    this._syncStock();
    this._save();
  }

  _unstock(slot) {
    if (this.net.isGuest) {
      const slotIdx = this.shop.slots.indexOf(slot);
      this.net.send({ t: "unstockReq", slotIdx });
      return;
    }
    if (this.inventory.length >= this.invCap) return this.hud.toast("🎒 Bag is full!");
    const id = this.shop.unstockSlot(slot);
    if (id) {
      this.inventory.push(id);
      this._syncInv();
      this._syncStock();
    }
  }

  _haggle(cust) {
    this.audio.haggle();
    this.shop.startHaggle(cust, this.hud, this.audio, (sold, price, grade, item) => {
      if (this.net.isGuest) {
        this.net.send({ t: "sale", custId: cust.id, sold, price, grade });
        if (sold) this._saleJuice(price, grade, cust.creature.position);
        return;
      }
      this._resolveSale(cust, sold, price, grade);
    });
  }

  _resolveSale(cust, sold, price, grade) {
    if (sold) {
      this.combo = grade === "perfect" ? this.combo + 1 : 0;
      this.gainGold(price, cust.creature.position);
      this._saleJuice(price, grade, cust.creature.position);
      this._syncStock();
      this._save();
    } else {
      this.combo = 0;
      this.audio.deny();
    }
  }

  _saleJuice(price, grade, pos) {
    if (grade === "perfect") {
      this.audio.perfect();
      this.hud.banner(`PERFECT DEAL! ${this.combo > 1 ? "x" + this.combo + " combo!" : ""}`, `${price}g — right at their limit`, 1.6);
      this.engine.shake(0.15);
      this.particles.burst(_v.copy(pos).setY(1.4), { color: 0xffe08a, n: 18, speed: 3.5, life: 0.9 });
    } else {
      this.audio.sale();
      this.hud.toast(`Sold for ${price}g!`);
    }
  }

  // ================================================================ day cycle
  _morning(first = false) {
    this.phase = "day";
    this.dayT = DAY_LEN;
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setDay(this.day, "day");
    this.hud.setGold(this.gold, false);
    this._updateDebtChip();

    // debt collection morning
    const due = DEBT[this.debtIdx];
    if (due && this.day >= due.day && !this.net.isGuest) {
      if (this.gold >= due.amt) {
        this.gold -= due.amt;
        this.debtIdx++;
        this.hud.setGold(this.gold);
        this.hud.banner(`📜 Paid ${due.amt}g to the Guild!`, this.debtIdx >= DEBT.length ? "The shop is YOURS!" : `next payment: day ${DEBT[this.debtIdx].day}`, 3);
        this.audio.victory();
        if (this.debtIdx >= DEBT.length && !this.victory) {
          this.victory = true;
          setTimeout(() => this._victoryScreen(), 2600);
        }
      } else {
        this._gameOver(due);
        return;
      }
      this._updateDebtChip();
    }
    if (!first) this.hud.banner(`☀️ Day ${this.day}`, "stock the tables — customers are coming", 2.2);
    else {
      this.hud.banner("🏪 SHOP SLOP", "delve by night · deal by day", 3);
      if (this.day === 1) {
        setTimeout(() => this.hud.toast("🎒 Tap the bag to put items on your tables"), 3200);
        setTimeout(() => this.hud.toast("🗣️ Walk up to customers with ❗ to haggle"), 6600);
        setTimeout(() => this.hud.toast("🕳️ The cellar hides loot — delve it for stock"), 10000);
      }
    }
    this._syncState();
    this._save();
  }

  _nightfall() {
    this.phase = "night";
    this.hud.setDay(this.day, "night");
    this.hud.banner("🌙 Closing time", "delve the cellar, or sleep to open again", 2.6);
    for (const cust of [...this.shop.customers]) {
      if (cust.state !== "haggling") cust.state = "leave";
    }
    this._syncState();
  }

  _sleep() {
    if (this.net.isGuest) return this.hud.toast("Only the host can end the day.");
    if (this.phase === "day" && this.dayT > 10) {
      this.hud.toast("The shop is still open! (sleep at night)");
      return;
    }
    this.audio.stairs();
    this.day++;
    this.dungeon.dispose(); // fresh dungeon every day
    this.net.send({ t: "dungeonReset" });
    this._morning();
  }

  // ================================================================ dungeon
  _delve() {
    if (this.net.isGuest) {
      if (!this.dungeon.active) {
        this._wantDelve = true;
        this.net.send({ t: "delveReq" });
        this.hud.toast("Opening the cellar…");
        return;
      }
      this._enterDungeon();
      return;
    }
    if (!this.dungeon.active) {
      const seed = this.day * 1000 + Math.floor(Math.random() * 999);
      this.dungeon.generate(1, seed);
      this.net.send({ t: "floor", n: 1, seed });
    }
    this._enterDungeon();
  }

  _enterDungeon() {
    this.playerArea = "dungeon";
    _v.copy(this.dungeon.entrancePos).add(DUNGEON_ORIGIN);
    this.player.position.set(_v.x + 0.8, 0, _v.z + 0.8);
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this.hud.banner(`🕳️ Cellar — Floor ${this.dungeon.floor}`, "", 1.6);
  }

  _returnHome() {
    this.playerArea = "shop";
    this.player.position.copy(this.shop.trapdoorPos).add(_v.set(1.2, 0, 0.5));
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this.hud.banner("🏪 Back to the shop", "", 1.4);
    this._save();
  }

  _descend() {
    if (this.net.isGuest) {
      this.net.send({ t: "stairsReq" });
      return;
    }
    const n = this.dungeon.floor + 1;
    const seed = this.dungeon.seed;
    this.dungeon.generate(n, seed);
    this.net.send({ t: "floor", n, seed });
    this._enterDungeon();
    this.engine.shake(0.2);
  }

  // ================================================================ game over
  _gameOver(due) {
    this.gameOver = true;
    this.audio.gameover();
    this.hud.banner("💸 THE GUILD TAKES THE SHOP", `you owed ${due.amt}g`, 0);
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">💸</span>
        <div><b>Repossessed!</b><br/><small>Day ${this.day} — ${this.gold}g wasn't enough</small></div></div>
      <div class="sheet-btns"><button class="btn deal" id="go-restart">Start a new shop</button></div>
    `, "sheet-card");
    el.querySelector("#go-restart").onclick = () => this._reset();
  }

  _victoryScreen() {
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">👑</span>
        <div><b>The deed is yours!</b><br/><small>All ${DEBT.length} payments made. Capitalism, ho!</small></div></div>
      <div class="sheet-btns"><button class="btn deal" id="v-endless">Keep playing</button></div>
    `, "sheet-card");
    el.querySelector("#v-endless").onclick = () => this.hud.hideSheet();
  }

  _reset() {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }

  // ================================================================ hud wiring
  _wireHud() {
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(this.gold, false);
    document.getElementById("mute-btn").onclick = () => {
      const muted = this.audio.toggleMute();
      document.getElementById("mute-btn").textContent = muted ? "🔇" : "🔊";
    };
    document.getElementById("bag-btn").onclick = () => this._toggleBag();
    document.getElementById("coop-btn").onclick = () => this._coopSheet();
  }

  _toggleBag() {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    const rows = this.inventory
      .map((id, i) => {
        const it = ITEMS[id];
        return `<button class="inv-item" data-i="${i}">${it.emoji}<small>${it.name}</small><span>${it.base}g</span></button>`;
      })
      .join("");
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">🎒</span>
        <div><b>Bag ${this.inventory.length}/${this.invCap}</b><br/><small>tap an item to put it on a table</small></div>
        <button class="icon-btn" id="bag-close">✕</button></div>
      <div class="inv-grid">${rows || "<small class='empty'>empty — go delve!</small>"}</div>
    `, "sheet-card");
    el.querySelector("#bag-close").onclick = () => this.hud.hideSheet();
    el.querySelectorAll(".inv-item").forEach((btn) => {
      btn.onclick = () => {
        this._stockFromBag(Number(btn.dataset.i));
        this.hud.hideSheet();
      };
    });
  }

  _coopSheet() {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">👥</span>
        <div><b>Co-op</b><br/><small>one deals, one delves — shared gold</small></div>
        <button class="icon-btn" id="co-close">✕</button></div>
      <div id="co-status" class="hg-speech">${this.net.connected ? "Connected!" : "Play with a friend over the internet."}</div>
      <div class="sheet-btns">
        <button class="btn" id="co-host">Host</button>
        <input id="co-code" maxlength="4" placeholder="CODE" autocapitalize="characters" />
        <button class="btn deal" id="co-join">Join</button>
      </div>
    `, "sheet-card");
    const status = el.querySelector("#co-status");
    this.net.onStatus = (s) => (status.textContent = s);
    el.querySelector("#co-close").onclick = () => this.hud.hideSheet();
    el.querySelector("#co-host").onclick = () => {
      const code = this.net.host();
      status.textContent = `Room code: ${code} — waiting…`;
    };
    el.querySelector("#co-join").onclick = () => {
      const code = el.querySelector("#co-code").value.trim();
      if (code.length === 4) this.net.join(code);
    };
  }

  _updateDebtChip() {
    const due = DEBT[this.debtIdx];
    if (!due) this.hud.setDebt("paid off! 👑");
    else this.hud.setDebt(`${due.amt}g due day ${due.day}`, this.day >= due.day - 1);
  }

  // ================================================================ net
  onPeerJoined() {
    // host: send full state
    this.hud.toast("👥 Partner joined!");
    this.net.send({
      t: "welcome",
      day: this.day, phase: this.phase, gold: this.gold, debtIdx: this.debtIdx,
      inv: this.inventory,
      stocked: this.shop.slots.map((s) => s.item),
      floor: this.dungeon.active ? this.dungeon.floor : 0,
      seed: this.dungeon.seed ?? 0,
    });
    this._spawnRemote();
  }

  onJoinedHost() {
    this.hud.toast("👥 Joined! The host runs the shop clock.");
    this._spawnRemote();
    this.hud.hideSheet();
  }

  onPeerLeft() {
    this.hud.toast("👥 Partner disconnected.");
    if (this.remote) {
      this.remote.creature.dispose();
      this.remote = null;
    }
  }

  _spawnRemote() {
    if (this.remote) this.remote.creature.dispose();
    const c = new Creature(heroSpec(7, true));
    c.position.set(1.5, 0, 3);
    c.holdItem(swordMesh(0xd7dde6, 0x3f5f9e, 0.55));
    this.engine.scene.add(c);
    this.remote = { creature: c, target: { x: 1.5, z: 3, h: 0 }, area: "shop", dead: false, wasAtk: false };
  }

  _updateRemote(dt, elapsed) {
    const r = this.remote;
    if (!r) return;
    const c = r.creature;
    c.position.x = lerp(c.position.x, r.target.x, 1 - Math.pow(0.0001, dt));
    c.position.z = lerp(c.position.z, r.target.z, 1 - Math.pow(0.0001, dt));
    c.heading = r.target.h;
    c.update(dt, elapsed);
  }

  onNetMessage(m) {
    const D = this.dungeon;
    switch (m.t) {
      case "p": {
        const r = this.remote;
        if (!r) return;
        r.target = { x: m.x, z: m.z, h: m.h };
        r.area = m.area;
        r.dead = !!m.dead;
        if (m.atk && !r.wasAtk) r.creature.attack();
        r.wasAtk = !!m.atk;
        break;
      }
      case "welcome": {
        this.day = m.day; this.phase = m.phase; this.gold = m.gold; this.debtIdx = m.debtIdx;
        this.inventory = m.inv;
        this.hud.setDay(this.day, this.phase);
        this.hud.setGold(this.gold, false);
        this._updateDebtChip();
        m.stocked.forEach((item, i) => this._applyStockSlot(i, item));
        if (m.floor > 0) D.generate(m.floor, m.seed);
        break;
      }
      case "state": {
        if (m.gold !== this.gold) this.hud.setGold((this.gold = m.gold));
        this.day = m.day;
        if (m.phase !== this.phase) {
          this.phase = m.phase;
          this.hud.banner(m.phase === "day" ? `☀️ Day ${this.day}` : "🌙 Closing time", "", 2);
        }
        this.debtIdx = m.debtIdx;
        this.hud.setDay(this.day, this.phase);
        this._updateDebtChip();
        break;
      }
      case "inv":
        this.inventory = m.list;
        break;
      case "stockAll":
        m.stocked.forEach((item, i) => this._applyStockSlot(i, item));
        break;

      // ---- customers (guest mirrors)
      case "custAdd": {
        if (!this.net.isGuest) return;
        this.shop.mirrorCustomerAdd(m);
        this.audio.doorbell();
        break;
      }
      case "cSnap":
        if (this.net.isGuest) this.shop.mirrorCustomerSnap(m.list);
        break;
      case "custDel":
        if (this.net.isGuest) this.shop.mirrorCustomerDel(m.id);
        break;
      case "custState":
        if (this.net.isGuest) this.shop.mirrorCustomerState(m);
        break;

      // ---- guest -> host intents
      case "delveReq": {
        if (this.net.isGuest) return;
        if (!D.active) {
          const seed = this.day * 1000 + Math.floor(Math.random() * 999);
          D.generate(1, seed);
        }
        this.net.send({ t: "floor", n: D.floor, seed: D.seed });
        break;
      }
      case "stairsReq": {
        if (this.net.isGuest) return;
        const n = D.floor + 1;
        D.generate(n, D.seed);
        this.net.send({ t: "floor", n, seed: D.seed });
        if (this.playerArea === "dungeon") this._enterDungeon();
        break;
      }
      case "hit": {
        if (this.net.isGuest) return;
        const e = D.enemies.find((x) => x.id === m.id);
        if (e) D.damageEnemy(e, m.dmg, m.kx, m.kz);
        break;
      }
      case "take": {
        if (this.net.isGuest) return;
        const drop = D.drops.find((d) => d.id === m.id);
        if (drop && this.inventory.length < this.invCap) {
          D.takeDrop(drop);
          this.inventory.push(drop.item);
          this._syncInv();
          this.net.send({ t: "dropTake", id: m.id });
        }
        break;
      }
      case "chestReq": {
        if (this.net.isGuest) return;
        const chest = D.chests.find((c) => c.id === m.id);
        if (chest && !chest.opened) {
          D.openChest(chest);
          this.net.send({ t: "chest", id: m.id });
        }
        break;
      }
      case "stockReq": {
        if (this.net.isGuest) return;
        if (this.shop.freeSlot() && this.inventory[m.idx] != null) {
          const id = this.inventory.splice(m.idx, 1)[0];
          this.shop.stockItem(id);
          this._syncInv();
          this._syncStock();
        }
        break;
      }
      case "unstockReq": {
        if (this.net.isGuest) return;
        const slot = this.shop.slots[m.slotIdx];
        if (slot?.item && this.inventory.length < this.invCap) {
          this.inventory.push(this.shop.unstockSlot(slot));
          this._syncInv();
          this._syncStock();
        }
        break;
      }
      case "sale": {
        if (this.net.isGuest) return;
        const cust = this.shop.customers.find((c) => c.id === m.custId);
        if (cust) {
          if (m.sold) {
            this.shop.unstockSlot(cust.slot);
            cust.state = "happy";
            cust.t = 0;
          } else cust.state = "leave";
          this.shop._clearEmote(cust);
          this._resolveSale(cust, m.sold, m.price, m.grade);
          this.net.send({ t: "custState", id: cust.id, state: cust.state });
        }
        break;
      }

      // ---- host -> guest world updates
      case "floor": {
        if (!this.net.isGuest) return;
        const wasIn = this.playerArea === "dungeon";
        D.generate(m.n, m.seed);
        if (wasIn || this._wantDelve) this._enterDungeon();
        this._wantDelve = false;
        break;
      }
      case "dungeonReset":
        D.dispose();
        if (this.playerArea === "dungeon") this._returnHome();
        break;
      case "eSnap": {
        if (!this.net.isGuest) return;
        for (const [id, kind, seed, tier, x, z, h, hp] of m.list) {
          let e = D.enemies.find((v) => v.id === id);
          if (!e && D.active) e = D.spawnEnemy(kind, seed, tier, x, z, id, hp);
          if (!e) continue;
          e.creature.position.set(x, 0, z);
          e.creature.heading = h;
          e.hp = hp;
        }
        break;
      }
      case "eHurt": {
        const e = D.enemies.find((v) => v.id === m.id);
        if (e && this.net.isGuest) {
          e.hp = m.hp;
          e.creature.hurt();
        }
        break;
      }
      case "eDie": {
        if (!this.net.isGuest) return;
        const e = D.enemies.find((v) => v.id === m.id);
        if (e && e.deadT < 0) {
          e.deadT = 0;
          e.creature.die(_v.set(m.kx * 8, -3, m.kz * 8));
          this.audio.kill();
        }
        break;
      }
      case "eDel": {
        if (!this.net.isGuest) return;
        const e = D.enemies.find((v) => v.id === m.id);
        if (e) {
          e.creature.dispose();
          D.enemies = D.enemies.filter((x) => x !== e);
        }
        break;
      }
      case "drop":
        if (this.net.isGuest && D.active) D.spawnDrop(m.item, m.x, m.z, m.id);
        break;
      case "dropTake": {
        if (!this.net.isGuest) return;
        const drop = D.drops.find((d) => d.id === m.id);
        if (drop) D.takeDrop(drop);
        break;
      }
      case "chest": {
        if (!this.net.isGuest) return;
        const chest = D.chests.find((c) => c.id === m.id);
        if (chest && !chest.opened) {
          chest.opened = true;
          chest.mesh.children[1].rotation.x = -1.9;
          this.audio.chest();
        }
        break;
      }
      case "stock":
        this._applyStockSlot(m.slotIdx, m.item);
        break;
      case "pHurt":
        this.applyPlayerDamage(m.dmg, this.remote?.creature.position ?? null);
        break;
    }
  }

  _applyStockSlot(i, item) {
    const slot = this.shop.slots[i];
    if (!slot) return;
    if (slot.item) this.shop.unstockSlot(slot);
    if (item) {
      slot.item = item;
      slot.mesh = itemMesh(item);
      slot.mesh.position.copy(slot.pos);
      this.shop.group.add(slot.mesh);
    }
  }

  _syncState() {
    if (this.net.isGuest) return;
    this.net.send({ t: "state", gold: this.gold, day: this.day, phase: this.phase, debtIdx: this.debtIdx });
  }

  _syncInv() {
    this.net.send({ t: "inv", list: this.inventory });
  }

  _syncStock() {
    this.net.send({ t: "stockAll", stocked: this.shop.slots.map((s) => s.item) });
  }

  // ================================================================ misc
  collide(pos, radius, colliders) {
    for (const c of colliders) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const px = c.hw + radius - Math.abs(dx);
      const pz = c.hd + radius - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) pos.x += dx > 0 ? px : -px;
        else pos.z += dz > 0 ? pz : -pz;
      }
    }
  }

  _save() {
    if (this.net.isGuest) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        day: this.day, gold: this.gold, inv: this.inventory, debtIdx: this.debtIdx,
      }));
    } catch {}
  }

  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.day) {
        this.day = s.day;
        this.gold = s.gold;
        this.inventory = s.inv ?? this.inventory;
        this.debtIdx = s.debtIdx ?? 0;
      }
    } catch {}
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _camShop = new THREE.Vector3(0, 10.2, 8.6);
const _camDungeon = new THREE.Vector3(0, 8.4, 8.2);
