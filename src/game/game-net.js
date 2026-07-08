// Co-op (PeerJS) + shared-world (Supabase Realtime lobby) networking glue.
// Attached to Game.prototype via Object.assign, so `this` is the live Game.
import * as THREE from "three";
import { BlockyCreature, variantForSeed } from "../chargen/blocky.js";
import { ITEMS, swordMesh } from "./items.js";
import { FLOORS_PER_DUNGEON, MAX_DEPTH, isBossFloor, dungeonIndexFor, BOSS_ATK_GLOW } from "./dungeon.js";
import { icon } from "../core/icons.js";
import { sampleSnaps, _snap, hashStr, daySeed } from "./game-util.js";

// per-call scratch vector (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();

export const netMethods = {
  onPeerJoined() {
    // host: send full state
    this.hud.hideSheet();
    this.hud.banner(`${icon("people")} A friend teleported in!`, "", 2);
    this.net.send({
      t: "welcome",
      day: this.day, gold: this.gold,
      doorsOpen: this.shop.doorsOpen,
      inv: this.inventory,
      stash: this.stash,
      stocked: this.shop.slots.map((s) => s.item),
      floor: this.dungeon.active ? this.dungeon.floor : 0,
      seed: this.dungeon.seed ?? 0,
      hole: this.sewerHole,
      gateOpen: this.dungeon.gateOpen,
      shortcuts: this.shortcutUntil,
      town: this.townRestored,
      tables: this.tablesRepaired,
    });
    this._spawnRemote();
  },

  onJoinedHost() {
    this.hud.hideSheet();
    this.hud.banner(`${icon("people")} Teleported to your friend's shop!`, "", 2.4);
    this._spawnRemote();
  },

  onPeerLeft() {
    this.hud.toast(`${icon("people")} Your friend left.`);
    if (this.remote) {
      this.remote.creature.dispose();
      this.remote = null;
    }
  },

  _spawnRemote() {
    if (this.remote) this.remote.creature.dispose();
    const c = new BlockyCreature("j", { height: 1.3 });
    c.position.set(1.5, 0, 3);
    c.holdItem(swordMesh(0xd7dde6, 0x3f5f9e, 0.75));
    c.setNameLabel(this.net.partnerName || "friend");
    this.engine.scene.add(c);
    this.remote = {
      creature: c,
      buf: [{ t: performance.now() / 1000, x: 1.5, z: 3, h: 0 }],
      area: "shop",
      floor: -1,
      dead: false,
      wasAtk: false,
    };
  },

  _updateRemote(dt, elapsed) {
    const r = this.remote;
    if (!r) return;
    const c = r.creature;
    // hide the partner while they're off on a different dungeon floor — their
    // world coords would otherwise overlap ours (floors share a footprint)
    c.visible = !(r.area === "dungeon" && this.playerArea === "dungeon" && r.floor >= 0 && r.floor !== this.dungeon.floor);
    // Positions arrive as ~11 Hz snapshots; interpolate them into a smooth
    // glide (see sampleSnaps) so the walk cycle doesn't stutter on packet jitter.
    if (sampleSnaps(r.buf)) {
      c.position.x = _snap.x;
      c.position.z = _snap.z;
      c.heading = _snap.h;
    }
    c.update(dt, elapsed);
  },

  // The partner swung: play their arm animation + crescent swoosh + spark
  // burst as one unit. Fired from BOTH the reliable ~11 Hz "p" snapshot (rising
  // edge of their attack flag) and the discrete "atk" event, so the VFX always
  // rides along with the animation even if one signal is missed. A short debounce
  // collapses the two triggers for the same swing into a single play; real
  // consecutive swings are always >~0.35 s apart (a swing can't restart until the
  // previous one finishes), so this never eats a genuine follow-up swing.
  _remoteSwing(r, h, finisher) {
    const c = r.creature;
    c.attack(); // no-op if already mid-swing, so it's safe to call from both paths
    const now = performance.now();
    if (now - (r.lastSwingFx ?? -1e9) < 160) return; // fx already played this swing
    r.lastSwingFx = now;
    _v.copy(c.position).setY(0.62);
    this.remoteSlash.play(_v, h, finisher ? 1.5 : 1);
    _v.set(c.position.x + Math.sin(h) * 1.4, 0.8, c.position.z + Math.cos(h) * 1.4);
    this.particles.burst(_v, { color: finisher ? 0xffe0a0 : 0xdfe8ff, n: finisher ? 12 : 7, speed: finisher ? 3 : 2.1, up: 1.4, gravity: 3, life: 0.3, size: 0.85 });
    if (r.area === this.playerArea) {
      this.audio.swingCombo(finisher ? 2 : 0);
      if (finisher) this.audio.finisher();
    }
  },

  // Avatars for the lobby crowd (Supabase Realtime): everyone sharing our
  // current zone — the sewer, or the same hole's dungeon. Purely visual;
  // they use the same snapshot-interpolation trick as the co-op remote.
  _updateLobbyPlayers(dt, elapsed) {
    const av = this._lobbyAvatars;
    for (const [id, a] of av) {
      if (!this.lobby.players.has(id)) {
        a.creature.dispose();
        av.delete(id);
      }
    }
    const myFloor = this.playerArea === "dungeon" ? this.dungeon.floor : 0;
    for (const [id, pl] of this.lobby.players) {
      if (!pl.buf.length) continue; // presence known, no position yet
      let a = av.get(id);
      if (!a) {
        const c = new BlockyCreature(variantForSeed(hashStr(id)), { height: 1.3 });
        c.holdItem(swordMesh(0xd7dde6, 0x3f5f9e, 0.75));
        const last = pl.buf[pl.buf.length - 1];
        c.position.set(last.x, 0, last.z);
        this.engine.scene.add(c);
        a = { creature: c, wasAtk: false };
        av.set(id, a);
      }
      const c = a.creature;
      c.setNameLabel(pl.name || "a wanderer");
      // hide delvers on other floors of the same hole (identical world coords)
      c.visible = pl.floor === myFloor && !pl.dead;
      if (!c.visible) continue;
      if (sampleSnaps(pl.buf)) {
        c.position.x = _snap.x;
        c.position.z = _snap.z;
        c.heading = _snap.h;
      }
      if (pl.atk && !a.wasAtk) c.attack();
      a.wasAtk = pl.atk;
      c.update(dt, elapsed);
    }
  },

  // Guest-side: are we standing on the host's live/simulated floor? When we've
  // lagged a floor behind or pushed ahead onto a quiet solo floor, the host's
  // enemy/drop/projectile broadcasts are for a floor we're not on, so we ignore
  // them rather than injecting phantom content into our floor.
  _onLiveFloor() {
    return !this.net.isGuest || this.dungeon.floor === this._hostDungeonFloor;
  },

  onNetMessage(m) {
    const D = this.dungeon;
    switch (m.t) {
      case "p": {
        const r = this.remote;
        if (!r) return;
        if (m.area !== r.area) r.buf.length = 0; // area change is a teleport: snap
        r.buf.push({ t: performance.now() / 1000, x: m.x, z: m.z, h: m.h });
        if (r.buf.length > 12) r.buf.shift();
        r.area = m.area;
        if (typeof m.fl === "number") r.floor = m.fl;
        r.dead = !!m.dead;
        // rising edge of their swing flag: play the whole swing (anim + vfx) as
        // a fallback in case the precise "atk" event slipped between packets
        if (m.atk && !r.wasAtk) this._remoteSwing(r, r.creature.heading, false);
        r.wasAtk = !!m.atk;
        break;
      }
      case "atk": {
        // partner swung: the precise, immediate trigger — carries the committed
        // swing heading + finisher flag, so it wins over the snapshot fallback.
        // Mark wasAtk so the imminent "p" snapshot doesn't re-fire the same swing.
        const r = this.remote;
        if (!r) return;
        this._remoteSwing(r, typeof m.h === "number" ? m.h : r.creature.heading, !!m.finisher);
        r.wasAtk = true;
        break;
      }
      case "welcome": {
        this.day = m.day; this.gold = m.gold;
        this.inventory = m.inv;
        this.stash = m.stash ?? [];
        if (Array.isArray(m.shortcuts)) this.shortcutUntil = m.shortcuts.slice();
        if (typeof m.doorsOpen === "boolean") this.shop.setDoorsOpen(m.doorsOpen);
        if (Array.isArray(m.town)) m.town.forEach((done, i) => { if (done) this.shop.restoreLot(i, true); });
        if (Array.isArray(m.tables)) m.tables.forEach((done, i) => { if (done) this.shop.repairTable(i, true); });
        this.hud.setGold(this.gold, false);
        m.stocked.forEach((item, i) => this._applyStockSlot(i, item));
        if (m.floor > 0) {
          if (m.hole != null) this.sewerHole = m.hole;
          D.generate(m.floor, m.seed);
          this._hostDungeonFloor = m.floor;
          if (m.gateOpen) D.openGate();
        }
        break;
      }
      case "state": {
        if (m.gold !== this.gold) this.hud.setGold((this.gold = m.gold));
        this.day = m.day;
        if (typeof m.doorsOpen === "boolean") this.shop.setDoorsOpen(m.doorsOpen);
        break;
      }
      case "tables":
        if (Array.isArray(m.tables)) m.tables.forEach((done, i) => { if (done) this.shop.repairTable(i, true); });
        break;
      case "inv":
        this.inventory = m.list;
        if (m.stash) this.stash = m.stash;
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
      case "custWant":
        if (this.net.isGuest) this.shop.mirrorCustomerWant(m);
        break;
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
        // first delver picks the mouth; once a dungeon is live the pair shares
        // it, so a request for a different mouth just lands in the live one
        if (!D.active) {
          this.sewerHole = m.hole ?? 0;
          D.generate(this.sewerHole * FLOORS_PER_DUNGEON + 1, daySeed());
          this._syncState();
        }
        this.net.send({ t: "floor", n: D.floor, seed: D.seed, hole: this.sewerHole });
        break;
      }
      case "stairsReq": {
        if (this.net.isGuest) return;
        const from = typeof m.from === "number" ? m.from : D.floor;
        if (from >= MAX_DEPTH) return; // 12 is the deepest there is
        const n = from + 1;
        // crossing a boss floor drops into the next stacked dungeon — open its
        // sewer shortcut (host owns the progression, for host + guest alike)
        if (isBossFloor(from)) this._unlockShortcut(dungeonIndexFor(n));
        const hole = dungeonIndexFor(n);
        // If we're delving too, we can't advance the live dungeon without
        // yanking ourselves along — so we send the guest on ahead to a quiet
        // solo floor while we hold our ground.
        if (this.playerArea === "dungeon") {
          this.net.send({ t: "floor", n, seed: D.seed, hole, solo: 1 });
          break;
        }
        // minding the shop: the live floor advances and the guest rides along
        D.generate(n, D.seed);
        this._hostDungeonFloor = n;
        this.sewerHole = hole;
        this.net.send({ t: "floor", n, seed: D.seed, hole });
        break;
      }
      case "gateReq": {
        // guest asked to unlock the boss door — host owns the bag + world
        if (this.net.isGuest) return;
        if (this._hasBossKey() && !D.gateOpen) {
          this._consumeBossKey();
          D.openGate();
          this.net.send({ t: "gateOpen" });
          this.audio.stairs();
          this.engine.shake(0.3);
          this._bossAwakenBanner();
          this._enterBossRoom();
        }
        break;
      }
      case "gateOpen": {
        // host told everyone the boss door is open
        if (!this.net.isGuest) return;
        D.openGate();
        this.audio.stairs();
        this.engine.shake(0.25);
        this._bossAwakenBanner();
        this._enterBossRoom();
        break;
      }
      case "shortcut": {
        // the host earned (or refreshed) a sewer shortcut — mirror its expiry
        // so our sewer shows the same open mouths
        if (!Array.isArray(this.shortcutUntil)) this.shortcutUntil = [0, 0, 0, 0];
        this.shortcutUntil[m.id] = m.until;
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
          this._floatPickup(drop); // show what the partner just grabbed
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
        const slot = m.slotIdx >= 0 ? this.shop.slots[m.slotIdx] : this.shop.freeSlot();
        if (slot && !slot.item && !slot.disabled && this.stash[m.idx] != null) {
          const id = this.stash.splice(m.idx, 1)[0];
          this.shop.stockItem(id, slot);
          this._syncInv();
          this._syncStock();
        }
        break;
      }
      case "unstockReq": {
        if (this.net.isGuest) return;
        const slot = this.shop.slots[m.slotIdx];
        if (slot?.item) {
          this.stash.push(this.shop.unstockSlot(slot));
          this._syncInv();
          this._syncStock();
        }
        break;
      }
      case "equipReq": {
        // a partner slotted a piece from a shared pool (storeroom above ground,
        // bag while delving): pull one matching id out (and drop whatever they
        // were wearing back in), then rebroadcast
        if (this.net.isGuest) return;
        const pool = m.src === "inv" ? this.inventory : this.stash;
        const i = pool.indexOf(m.id);
        if (i >= 0) pool.splice(i, 1);
        if (m.prev) pool.push(m.prev);
        this._syncInv();
        this._save();
        break;
      }
      case "unequipReq": {
        // a partner stripped a slot: its piece comes back to the shared pool
        if (this.net.isGuest) return;
        const pool = m.src === "inv" ? this.inventory : this.stash;
        pool.push(m.id);
        this._syncInv();
        this._save();
        break;
      }
      case "swapReq": {
        if (this.net.isGuest) return;
        const slot = this.shop.slots[m.slotIdx];
        if (slot?.item && this.stash[m.idx] != null) {
          const itemId = this.stash.splice(m.idx, 1)[0];
          const old = this.shop.unstockSlot(slot);
          this.shop.stockItem(itemId, slot);
          if (old != null) this.stash.push(old);
          this._syncInv();
          this._syncStock();
        }
        break;
      }
      case "pack": {
        // guest packed supplies for a delve: storeroom → shared bag
        if (this.net.isGuest) return;
        const idxs = [...m.idxs].sort((a, b) => b - a);
        for (const i of idxs) {
          if (this.inventory.length >= this.invCap) break;
          const id = this.stash[i];
          if (id == null || !(ITEMS[id].heal || id === "key")) continue;
          this.stash.splice(i, 1);
          this.inventory.push(id);
        }
        this._syncInv();
        this._save();
        break;
      }
      case "depositReq": {
        // guest came home: empty the shared bag into the storeroom, unless
        // the host is still down in the cellar and needs what's in it
        if (this.net.isGuest) return;
        if (this.playerArea === "dungeon") return;
        this.stash.push(...this.inventory);
        this.inventory = [];
        this._syncInv();
        this._save();
        break;
      }
      case "useReq": {
        if (this.net.isGuest) return;
        const id = this.inventory[m.idx];
        if (id != null && ITEMS[id]?.heal) {
          this.inventory.splice(m.idx, 1);
          this._syncInv();
        }
        break;
      }
      case "dropReq": {
        if (this.net.isGuest) return;
        const id = this.inventory[m.idx];
        if (id != null && D.active) {
          this.inventory.splice(m.idx, 1);
          D.spawnDrop(id, m.x, m.z);
          this._syncInv();
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
      case "buy": {
        // guest bought stock from a seller — host owns the shared wallet/bag
        if (this.net.isGuest) return;
        const cust = this.shop.customers.find((c) => c.id === m.custId);
        if (cust) {
          if (m.bought) {
            cust.state = "happy";
            cust.t = 0;
          } else cust.state = "leave";
          this.shop._clearEmote(cust);
          this._resolveBuy(cust, m.bought, m.price, m.grade, ITEMS[cust.sellItem]);
          this.net.send({ t: "custState", id: cust.id, state: cust.state });
        }
        break;
      }

      // ---- host -> guest world updates
      case "floor": {
        if (!this.net.isGuest) return;
        const wasIn = this.playerArea === "dungeon";
        if (m.hole != null) this.sewerHole = m.hole;

        // "solo": the host stayed put and waved us on ahead. We lead into a
        // quiet floor the host isn't simulating; the live floor is unchanged.
        if (m.solo) {
          D.generate(m.n, m.seed);
          this._floorDesync = false;
          this._pendingLead = null;
          this._enterDungeon();
          break;
        }

        // any non-solo floor message is the host's live/simulated floor
        this._hostDungeonFloor = m.n;

        // "lead": the partner descended mid-run. Don't rip us off our floor —
        // stay put on our (now quiet) floor and offer to follow via the stairs.
        if (m.lead && wasIn && !this._wantDelve) {
          this._floorDesync = true;
          this._pendingLead = { n: m.n, seed: m.seed, hole: this.sewerHole };
          this.hud.banner(`${icon("arrowDown")} Your friend went deeper`, "take the stairs to follow", 2.2);
          break;
        }

        D.generate(m.n, m.seed);
        this._floorDesync = false;
        this._pendingLead = null;
        if (wasIn || this._wantDelve) this._enterDungeon();
        this._wantDelve = false;
        break;
      }
      case "dungeonReset":
        D.dispose();
        this.sewerHole = -1;
        this._floorDesync = false;
        this._pendingLead = null;
        if (this.playerArea === "dungeon") this._returnHome();
        break;
      case "eSnap": {
        if (!this.net.isGuest || !this._onLiveFloor()) return;
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
      case "bossTel": {
        // host announced a boss windup: mirror the glow, ground FX and HUD
        // countdown so guests can read the dodge too
        if (!this.net.isGuest) return;
        const e = D.enemies.find((v) => v.id === m.id);
        if (!e) return;
        e.bossAttack = m.atk;
        e.telT = 0;
        e.telDur = m.dur;
        e.ringRadius = m.r;
        e.chargeX = m.dx;
        e.chargeZ = m.dz;
        // signature-attack ground marks (pounce landing / blink ripple / deluge zones)
        e.markX = m.px || null;
        e.markZ = m.pz || null;
        e.delugePts = m.pts ?? null;
        e.creature.setGlow(BOSS_ATK_GLOW[m.atk] ?? [0.95, 0.08, 0.05]);
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
          // guests share the boss fanfare (drops arrive separately from the host)
          if (e.isBoss) {
            D.boss = null;
            D._explodeBoss(e);
            this.onBossDefeated(e.creature.position);
          }
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
        if (this.net.isGuest && D.active && this._onLiveFloor())
          D.spawnDrop(m.item, m.x, m.z, m.id, m.fx != null ? { flyFrom: { x: m.fx, z: m.fz } } : {});
        break;
      case "proj":
        // guests spawn a visual-only orb; the host owns the damage collision
        if (this.net.isGuest && D.active && this._onLiveFloor())
          D.projectiles.spawn(m.x, m.z, m.vx, m.vz, { color: m.color, dmg: m.dmg, radius: m.radius, life: m.life });
        break;
      case "dropTake": {
        if (!this.net.isGuest) return;
        const drop = D.drops.find((d) => d.id === m.id);
        // a drop still present here means the host grabbed it (our own pickups
        // are removed optimistically) — surface what the partner took
        if (drop) {
          this._floatPickup(drop);
          D.takeDrop(drop);
        }
        break;
      }
      case "chest": {
        if (!this.net.isGuest) return;
        const chest = D.chests.find((c) => c.id === m.id);
        if (chest && !chest.opened) {
          chest.opened = true;
          chest.mesh.children[1].rotation.x = -1.9;
          if (D.tutorial) D.revealStairs();
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
      case "useFx": {
        // partner quaffed a consumable: mirror the over-head flourish + sparkle
        if (!this.remote || ITEMS[m.item] == null) return;
        this._spawnRemoteUseFx(m.item);
        if (this.remote.area === this.playerArea) {
          this.audio.heal();
          this.particles.burst(
            _v.copy(this.remote.creature.position).setY(this.remote.creature.height * 0.6),
            { color: 0x7be08a, n: 12, speed: 2.6, up: 1.6, life: 0.5, size: 1.0 }
          );
        }
        break;
      }
    }
  },

  _applyStockSlot(i, item) {
    const slot = this.shop.slots[i];
    if (!slot) return;
    if (slot.item) this.shop.unstockSlot(slot);
    // stockItem handles the sprite + the fancy-table glow shader
    if (item) this.shop.stockItem(item, slot);
  },

  _syncState() {
    if (this.net.isGuest) return;
    this.net.send({ t: "state", gold: this.gold, day: this.day, doorsOpen: this.shop.doorsOpen });
  },

  // Push the repaired-tables set to a connected guest so their shop shows the
  // same shelves greyed out / restored.
  _syncTables() {
    this._syncState();
    if (!this.net.isGuest) this.net.send({ t: "tables", tables: this.tablesRepaired });
  },

  _syncInv() {
    this.net.send({ t: "inv", list: this.inventory, stash: this.stash });
  },

  _syncStock() {
    this.net.send({ t: "stockAll", stocked: this.shop.slots.map((s) => s.item) });
  },
};
