// Delve flow: the trapdoor, the shared sewer hub and its holes, sewer
// shortcuts, the pre-delve pack menu, the hole-dive cutscene, entering /
// leaving dungeons, descending floors and the boss-gate cluster. Attached to
// Game.prototype via Object.assign, so `this` is the live Game instance. NB:
// `_snapCamera` stays in game.js (it drives the retained update()/camera
// offsets) — the methods here reach it through `this` as usual.
import * as THREE from "three";
import { lerp } from "../core/engine.js";
import { icon, itemIcon } from "../core/icons.js";
import { ITEMS } from "./items.js";
import { equipInfo } from "./gear.js";
import { DUNGEON_ORIGIN, MAX_DEPTH, FLOORS_PER_DUNGEON, isBossFloor, dungeonIndexFor, bossDefFor } from "./dungeon.js";
import { daySeed, utcDay } from "./game-util.js";

// A sewer shortcut, once earned by descending past a boss, stays unsealed for
// three hours of real time before it re-locks.
const SHORTCUT_TTL_MS = 3 * 60 * 60 * 1000;
const LEVEL_INVULN = 1.8; // damage-immunity grace when arriving on a new floor

// per-call scratch vector (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();

export const dungeonFlowMethods = {
  _delve() {
    // the guided first day is a one-way trip: once you've hauled up your first
    // stock, the cellar stays shut so the FTUE can walk you through stocking and
    // selling before you delve again
    if (this.tutorial && this.tutorial !== "delve") {
      this.hud.toast(`${icon("box")} Finish setting up shop before delving again`);
      return;
    }
    // before dropping down: gear up and pick supplies from the storeroom
    if (this._packable().length > 0 || this._stashGearCount() > 0) return this._packMenu();
    this._startDelve();
  },

  // Dropping through the trapdoor lands in the shared sewer now, not straight
  // in a dungeon — the holes down there are the real entrances. The tutorial
  // keeps the old direct drop: a private single-floor cellar on a random seed,
  // no sewer, no lobby (sewerHole stays -1 so _enterDungeon never joins one).
  _startDelve() {
    // heading down clears the post-Mayor restock nudge; the first restock skips
    // both the tutorial cellar and the sewer hub and drops straight into
    // dungeon 1, so it stays a smooth continuation of the guided loop.
    const restocking = this._restockNudge;
    this._restockNudge = false;
    if (this.tutorial) {
      this.sewerHole = -1;
      if (!this.dungeon.active)
        this.dungeon.generate(1, this.day * 1000 + Math.floor(Math.random() * 999), true);
      // plunge down the cellar trapdoor into the private tutorial floor
      this._beginHoleDive(this.shop.trapdoorPos, () => this._enterDungeon());
      return;
    }
    // before the first boss falls (or on the guided restock), the sewer hub
    // stays hidden — the trapdoor drops straight into the day's first dungeon
    // (mouth 0, floors 1-3). Only solo: co-op always routes through the sewer so
    // host/guest floor sync (delveReq / floor messages) keeps working.
    if ((restocking || !this.bossBeaten) && !this.net.connected) {
      const seed = daySeed();
      this.sewerHole = 0;
      // regenerate unless a real (non-tutorial) floor 1 is already live — after
      // the FTUE the private tutorial cellar is still active on floor 1, so the
      // restock delve must rebuild it as the actual Rat Warren dungeon.
      if (!this.dungeon.active || this.dungeon.floor !== 1 || this.dungeon.tutorial)
        this.dungeon.generate(1, seed);
      this._beginHoleDive(this.shop.trapdoorPos, () => this._enterDungeon());
      return;
    }
    // drop down the cellar trapdoor into the shared sewer — dive in first
    this._beginHoleDive(this.shop.trapdoorPos, () => this._enterSewer());
  },

  _enterSewer() {
    this.playerArea = "sewer";
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false); // the sewer's a safe hub — keep gold up top
    if (this.hud.sheetOpen) this.hud.hideSheet();
    this.player.position.copy(this.sewer.entrancePos).add(_v.set(0, 0, -1.4));
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this._snapCamera();
    this.lobby.join("sewer");
    this.hud.banner(`${icon("hole")} The Sewers`, "", 2.6);
  },

  // Confirm sheet at a sewer mouth's lip. The first is always open; a deeper
  // one only offers the dive once its shortcut's been earned (see _shortcutOpen).
  _holePrompt(id) {
    if (this.hud.sheetOpen) return;
    const hole = this.sewer.holes[id];
    if (!hole) return;
    if (!this._shortcutOpen(id)) {
      // still barred — spell out how the shortcut opens
      this.hud.toast(`${icon("hole")} Locked — beat the Floor ${id * FLOORS_PER_DUNGEON} boss to open this shortcut`);
      this.audio.deny();
      return;
    }
    this.paused = !this.net.connected;
    const sub = id === 0
      ? ""
      : `shortcut to Floor ${hole.floor} — ${this._shortcutLabel(id)} left`;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("hole")}</span>
        <div><b>${hole.name}</b><br/><small>${sub}</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="hole-no">${icon("close")} Not this one</button>
        <button class="btn deal" id="hole-yes">${icon("arrowDown")} Jump in</button>
      </div>
    `, "sheet-card");
    el.querySelector("#hole-yes").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._enterHole(id);
    };
    el.querySelector("#hole-no").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
    };
  },

  // Is sewer mouth `id` open? The entrance (0) always is; the deeper mouths
  // stay open until their earned wall-clock expiry lapses.
  _shortcutOpen(id) {
    if (id <= 0) return true;
    return Date.now() < (this.shortcutUntil?.[id] ?? 0);
  },

  // Short "time left" label for an open shortcut (e.g. "2h 41m").
  _shortcutLabel(id) {
    const ms = Math.max(0, (this.shortcutUntil?.[id] ?? 0) - Date.now());
    const mins = Math.ceil(ms / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },

  // Open a deeper mouth's shortcut for the full TTL — called on the host when a
  // boss floor is crossed into the dungeon this mouth heads. Persisted + synced
  // so a co-op guest sees the same open mouths.
  _unlockShortcut(id) {
    if (id <= 0 || id >= this.shortcutUntil.length) return;
    const until = Date.now() + SHORTCUT_TTL_MS;
    const fresh = !this._shortcutOpen(id);
    this.shortcutUntil[id] = until;
    this._save();
    this.net.send({ t: "shortcut", id, until });
    if (fresh) {
      const name = this.sewer.holes[id]?.name ?? "a deeper vault";
      this.hud.toast(`${icon("hole")} Sewer shortcut to ${name} opened for 3h`);
    }
  },

  // Jump into mouth `id`, landing at the head of its stacked dungeon (floors
  // 1/4/7/10). The layout is seeded off the UTC day, so everyone delving today
  // shares it. In PeerJS co-op the pair shares one dungeon: host generates,
  // guest requests.
  _enterHole(id) {
    const floor = id * FLOORS_PER_DUNGEON + 1;
    if (this.net.isGuest) {
      if (!this.dungeon.active) {
        this.sewerHole = id;
        this._wantDelve = true;
        this.net.send({ t: "delveReq", hole: id });
        return;
      }
      // the pair shares one dungeon: whichever mouth is live is where we land
      // (sewerHole already tracks it from the host's "floor" message)
      this._enterDungeon();
      return;
    }
    if (!this.dungeon.active || this.dungeon.floor !== floor) {
      this.sewerHole = id;
      const seed = daySeed();
      this.dungeon.generate(floor, seed);
      this.net.send({ t: "floor", n: floor, seed, hole: id });
      this._syncState();
    }
    this._enterDungeon();
  },

  // What's worth carrying back down: only consumables (they can be used in the
  // cellar) and the Brass Key for the boss door — the rest is merchandise.
  _packable() {
    return this.stash
      .map((id, i) => ({ id, i, it: ITEMS[id] }))
      .filter(({ id, it }) => it.heal || id === "key");
  },

  // How many storeroom pieces are equippable gear — used to decide whether the
  // pack menu is worth opening even when there are no supplies to carry.
  _stashGearCount() {
    return this.stash.reduce((n, id) => n + (equipInfo(id) ? 1 : 0), 0);
  },

  // The pre-delve staging sheet: kit out from the storeroom (paper-doll up top)
  // and tap supplies to load into the bag, then head down. Closing the sheet
  // cancels the delve. The supply selection is held on `this._packSel` so it
  // survives round-trips into the per-slot equip picker.
  _packMenu() {
    if (this.hud.sheetOpen) this.hud.hideSheet();
    const packable = this._packable();
    const free = this.invCap - this.inventory.length;
    if (!this._packSel) this._packSel = new Set();
    const sel = this._packSel;
    // forget any picks that no longer point at a packable slot (e.g. gear moved)
    const valid = new Set(packable.map((p) => p.i));
    for (const i of [...sel]) if (!valid.has(i)) sel.delete(i);
    const rows = packable
      .map(({ id, i, it }) => `<button class="inv-item pack-item ti-${it.tier}${sel.has(i) ? " sel" : ""}" data-i="${i}">${itemIcon(it.icon)}<small>${it.name}</small>
        <span>${it.heal ? `+${it.heal} ${icon("heart")}` : "boss door"}</span></button>`)
      .join("");
    const supplies = packable.length
      ? `<div class="pack-section">${icon("bag")} Supplies — <span id="pack-n">${sel.size}</span>/${free} slots</div>
         <div class="inv-grid">${rows}</div>`
      : "";
    const el = this.hud.showSheet(`
      <div class="gear-panel sheet-card">
        <div class="gear-panel-head">${icon("sword")}<b>Equipment</b></div>
        ${this._gearDollHTML("stash")}
      </div>
      <div class="pack-panel sheet-card">
        <div class="sheet-title"><span class="big-emoji">${icon("bag")}</span>
          <div><b>Pack your bag</b><br/><small>gear up, then grab supplies for the delve</small></div>
          <button class="icon-btn" id="pack-close">${icon("close")}</button></div>
        ${supplies}
        <div class="sheet-btns">
          <button class="btn deny" id="pack-skip">${icon("close")} Travel light</button>
          <button class="btn deal" id="pack-go">${icon("hole")} Delve</button>
        </div>
      </div>
    `, "pack-split");
    this._wireGearDoll(el, "stash");
    const counter = el.querySelector("#pack-n");
    el.querySelectorAll(".pack-item").forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i);
        if (sel.has(i)) {
          sel.delete(i);
          btn.classList.remove("sel");
        } else if (sel.size < free) {
          sel.add(i);
          btn.classList.add("sel");
        } else {
          this.hud.toast(`${icon("bag")} Bag is full!`);
        }
        if (counter) counter.textContent = sel.size;
      };
    });
    el.querySelector("#pack-close").onclick = () => {
      this._packSel = null;
      this.hud.hideSheet();
    };
    el.querySelector("#pack-skip").onclick = () => {
      this._packSel = null;
      this.hud.hideSheet();
      this._startDelve();
    };
    el.querySelector("#pack-go").onclick = () => {
      const idxs = [...sel];
      this._packSel = null;
      this.hud.hideSheet();
      this._pack(idxs);
      this._startDelve();
    };
  },

  // Move the chosen storeroom items into the bag. Guests mirror the move
  // locally and let the host (who owns the shared bag) make it official.
  _pack(idxs) {
    if (!idxs.length) return;
    if (this.net.isGuest) this.net.send({ t: "pack", idxs });
    idxs.sort((a, b) => b - a); // splice from the back so indices stay valid
    for (const i of idxs) {
      if (this.inventory.length >= this.invCap) break;
      const id = this.stash[i];
      if (id == null) continue;
      this.stash.splice(i, 1);
      this.inventory.push(id);
    }
    if (!this.net.isGuest) {
      this._syncInv();
      this._save();
    }
  },

  // Coming up from the cellar, the whole bag empties into the storeroom —
  // tables get stocked from there. Skipped while a partner is still delving
  // (the bag is shared in co-op and they may still need what's in it).
  _depositBag() {
    if (!this.inventory.length) return;
    if (this.remote && this.remote.area === "dungeon" && !this.remote.dead) return;
    if (this.net.isGuest) return this.net.send({ t: "depositReq" });
    const n = this.inventory.length;
    this.stash.push(...this.inventory);
    this.inventory = [];
    this.hud.toast(`${icon("box")} ${n} item${n > 1 ? "s" : ""} moved to the storeroom`);
    this._syncInv();
    this._save();
  },

  // A short "jump into the hole" cutscene before the next area loads: the
  // player springs up over the mouth, then plunges down the dark shaft,
  // spinning and shrinking away into the black. Purely cosmetic and local —
  // used both for the shop's cellar trapdoor and each sewer hole. `center` is
  // the mouth to dive into; `after` runs the real transition once it wraps up.
  _beginHoleDive(center, after) {
    const c = this.player;
    center = center.clone().setY(0);
    this._holeDive = { t: 0, dur: 1.0, from: c.position.clone().setY(0), center, after };
    c.animator.attackT = -1; // drop any half-swung strike
    this.highlight.visible = false;
    this.hud.hideInteractHint();
    // face the mouth as you leap in
    const dx = center.x - c.position.x, dz = center.z - c.position.z;
    if (dx || dz) c.heading = Math.atan2(dx, dz);
    this.audio.hop();
  },

  _updateHoleDive(dt, elapsed) {
    const d = this._holeDive;
    const c = this.player;
    d.t += dt;
    const p = Math.min(1, d.t / d.dur);
    const HOP = 0.3; // fraction of the dive spent springing up before the plunge
    if (p < HOP) {
      // anticipation hop: glide onto the mouth and arc upward
      const k = p / HOP;
      const e = k * k * (3 - 2 * k);
      c.position.x = lerp(d.from.x, d.center.x, e);
      c.position.z = lerp(d.from.z, d.center.z, e);
      c.position.y = Math.sin(k * Math.PI) * 0.7;
      c.scale.setScalar(1);
    } else {
      // the plunge: drop down the shaft, accelerating, spinning and shrinking
      const k = (p - HOP) / (1 - HOP);
      c.position.x = d.center.x;
      c.position.z = d.center.z;
      c.position.y = lerp(0.7, -3.0, k * k);
      c.scale.setScalar(Math.max(0.03, 1 - k * 0.95));
      c.model.rotation.y += dt * 10;
      c.shadow.visible = false;
      if (!d.dusted) {
        d.dusted = true;
        this.audio.dive();
        this.particles.burst(_v.copy(d.center).setY(0.1),
          { color: 0x6a5a48, n: 14, speed: 2.2, up: 1.6, gravity: 4, life: 0.5, size: 0.9 });
      }
    }
    c.update(dt, elapsed);
    if (d.t >= d.dur) {
      this._holeDive = null;
      c.scale.setScalar(1);
      c.position.y = 0;
      c.model.rotation.y = 0;
      c.shadow.visible = true;
      d.after();
    }
  },

  _enterDungeon() {
    // dropping in from a sewer hole: play the plunge animation first, then land
    // in the dungeon once it finishes (the dive re-calls us with the flag set).
    // Descending stairs mid-run starts in the dungeon, so it skips this.
    if (this.playerArea === "sewer" && this.sewerHole >= 0 && !this._diveDone) {
      const hole = this.sewer.holes[this.sewerHole];
      this._beginHoleDive(hole ? hole.pos : this.player.position, () => {
        this._diveDone = true;
        this._enterDungeon();
      });
      return;
    }
    this._diveDone = false;
    // the themed dungeon (and its boss/palette) follows the current floor now
    // that dungeons are stacked; the tutorial cellar keeps its private look
    if (!this.tutorial) this.sewerHole = dungeonIndexFor(this.dungeon.floor);
    // a fresh drop (not descending stairs mid-run) bumps the run counter that
    // feeds dungeon variety — guarded on playerArea so mid-run stairs, which
    // start already in the dungeon, don't re-roll it. Solo only.
    if (!this.net.connected && this.playerArea !== "dungeon") this.day++;
    this.playerArea = "dungeon";
    this.hud.showHearts(true);
    this.hud.showBag(true);
    this.hud.showGold(true);
    this.hud.setGoldCorner(true);
    _v.copy(this.dungeon.entrancePos).add(DUNGEON_ORIGIN);
    this.player.position.set(_v.x + 0.8, 0, _v.z + 0.8);
    this.player.animator.prevPos.copy(this.player.position);
    this._invulnT = Math.max(this._invulnT, LEVEL_INVULN); // grace on arrival
    this.today.deepest = Math.max(this.today.deepest, this.dungeon.floor);
    // hop onto this hole's realtime channel so fellow delvers show up
    if (this.sewerHole >= 0) this.lobby.join(`hole:${utcDay()}:${this.sewerHole}`);
    this.audio.stairs();
    this._snapCamera();
    const bossFloor = isBossFloor(this.dungeon.floor);
    const finalFloor = this.dungeon.floor >= MAX_DEPTH;
    const place = this.sewer.holes[this.sewerHole]?.name ?? "Cellar";
    this.hud.banner(
      bossFloor
        ? `${icon("skull")} ${place} — ${finalFloor ? "Final Floor" : "Boss Floor"}`
        : `${icon("hole")} ${place} — Floor ${this.dungeon.floor}`,
      bossFloor ? (this._hasBossKey() ? "unlock the sealed door" : "find a Brass Key to breach the boss door") : "",
      bossFloor ? 2.6 : 1.6
    );
    this._tutAdvance("delve");
  },

  _returnHome() {
    this.playerArea = "shop";
    this._floorDesync = false;
    this._pendingLead = null;
    this.lobby.leave();
    this._depositBag();
    // a trip home patches you up — no day/night rest to do it any more
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.showHearts(false);
    this.hud.showBag(false);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false);
    if (this.hud.sheetOpen) this.hud.hideSheet();
    this.player.position.copy(this.shop.trapdoorPos).add(_v.set(1.2, 0, 0.5));
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this._snapCamera();
    this.hud.banner(`${icon("shop")} Back to the shop`, "", 1.4);
    this._tutAdvance("return");
    this._save();
  },

  // At the stairs down: ask whether to press on or head back. Saying no is the
  // way out of the cellar now that the return circle is gone.
  _descendPrompt() {
    if (this.hud.sheetOpen) return;
    // during the tutorial the cellar is one floor deep and the stairs lead
    // straight home — no prompt, no choice, the loop closes itself
    if (this.tutorial) return this._returnHome();
    // freeze the sim while the choice is up (but not during co-op, so the
    // other player isn't stranded mid-run)
    this.paused = !this.net.connected;
    // on a boss floor the stairs only lead back UP — the way deeper opens
    // beyond the boss (its portal), so this is purely the way out
    if (isBossFloor(this.dungeon.floor)) {
      const final = this.dungeon.floor >= MAX_DEPTH;
      const el = this.hud.showSheet(`
        <div class="sheet-title"><span class="big-emoji">${icon("home")}</span>
          <div><b>Head back up?</b><br/><small>${final ? "The deepest boss lies beyond the sealed door." : "The way deeper opens past the boss — these stairs only lead back up."}</small></div></div>
        <div class="sheet-btns">
          <button class="btn deny" id="descend-stay">${icon("close")} Keep exploring</button>
          <button class="btn deal" id="descend-home">${icon("home")} Back to shop</button>
        </div>
      `, "sheet-card");
      el.querySelector("#descend-home").onclick = () => {
        this.paused = false;
        this.hud.hideSheet();
        this._returnHome();
      };
      el.querySelector("#descend-stay").onclick = () => {
        this.paused = false;
        this.hud.hideSheet();
      };
      return;
    }
    const next = this.dungeon.floor + 1;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("arrowDown")}</span>
        <div><b>Go deeper?</b><br/><small>Floor ${next} — tougher foes, better loot</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="descend-no">${icon("home")} Back to shop</button>
        <button class="btn deal" id="descend-yes">${icon("arrowDown")} Descend</button>
      </div>
    `, "sheet-card");
    el.querySelector("#descend-yes").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._descend();
    };
    el.querySelector("#descend-no").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._returnHome();
    };
  },

  // One floor deeper. Within a dungeon this is the stairs; crossing a boss
  // floor (3/6/9) it's the boss's descent portal, which also unseals the sewer
  // shortcut to the dungeon we're dropping into.
  _descend() {
    if (this.tutorial) return; // tutorial cellar is a single floor
    if (this.dungeon.floor >= MAX_DEPTH) return; // 12 is the deepest there is
    if (this.net.isGuest) {
      // A floor behind the party? Take the stairs to catch up to where the
      // host already went, rather than asking to open a fresh floor.
      if (this._floorDesync && this._pendingLead) {
        this._followLead();
        return;
      }
      this.net.send({ t: "stairsReq", from: this.dungeon.floor });
      return;
    }
    // host: advance our own floor and drop down. The partner isn't dragged with
    // us — we flag this as a "lead" so a delving partner can follow at will.
    const from = this.dungeon.floor;
    const n = from + 1;
    const seed = this.dungeon.seed;
    // crossing a boss floor drops into the next stacked dungeon — open its
    // sewer shortcut for the day (3h)
    if (isBossFloor(from)) this._unlockShortcut(dungeonIndexFor(n));
    this.sewerHole = dungeonIndexFor(n);
    this.dungeon.generate(n, seed);
    this._hostDungeonFloor = n;
    this.net.send({ t: "floor", n, seed, hole: this.sewerHole, lead: 1 });
    this._enterDungeon();
    this.engine.shake(0.2);
  },

  // Guest: catch up to the floor the host has already advanced to.
  _followLead() {
    const { n, seed, hole } = this._pendingLead;
    if (hole != null) this.sewerHole = hole;
    this.dungeon.generate(n, seed);
    this._hostDungeonFloor = n;
    this._floorDesync = false;
    this._pendingLead = null;
    this._enterDungeon();
    this.engine.shake(0.2);
  },

  // The boss door key is just a Brass Key ("key") carried in the bag — any one
  // will do, whether found in the guaranteed key chest or picked up as loot.
  _hasBossKey() {
    return this.inventory.includes("key");
  },

  // Spend one Brass Key from the bag (used when the boss door is unlocked).
  _consumeBossKey() {
    const i = this.inventory.indexOf("key");
    if (i < 0) return;
    this.inventory.splice(i, 1);
    this._syncInv();
    this._save();
  },

  // Standing at the sealed boss door: offer the plunge into the arena OR a
  // retreat back up the way you came. The boss fight is a commitment, so this
  // gives an out — a keyless (or simply unready) delver isn't forced through.
  _gatePrompt() {
    if (this.hud.sheetOpen || this.dungeon.gateOpen) return;
    // freeze the sim while the choice is up (but not in co-op, so a delving
    // partner isn't stranded mid-run) — mirrors the stairs descend prompt
    this.paused = !this.net.connected;
    const has = this._hasBossKey();
    const boss = bossDefFor(dungeonIndexFor(this.dungeon.floor));
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("skull")}</span>
        <div><b>The sealed door</b><br/><small>${has ? `${boss.name} waits beyond — enter, or turn back up?` : `You need a ${itemIcon("key")} Brass Key to breach it.`}</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="gate-up">${icon("home")} Go back up</button>
        <button class="btn deal" id="gate-enter">${icon("skull")} Enter boss</button>
      </div>
    `, "sheet-card");
    el.querySelector("#gate-up").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._returnHome();
    };
    el.querySelector("#gate-enter").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._openGate();
    };
  },

  // Unlock the sealed boss door. Needs a Brass Key in the bag, which the door
  // consumes; the host owns the world so guests route the request through it.
  _openGate() {
    if (this.hud.sheetOpen || this.dungeon.gateOpen) return;
    if (!this._hasBossKey()) {
      this.hud.toast(`${icon("warning")} The door is sealed — you need a ${itemIcon("key")} Brass Key`);
      this.audio.deny();
      return;
    }
    if (this.net.isGuest) {
      this.net.send({ t: "gateReq" });
      return;
    }
    this._consumeBossKey();
    this.dungeon.openGate();
    this.net.send({ t: "gateOpen" });
    this.audio.stairs();
    this.engine.shake(0.3);
    this._bossAwakenBanner();
    this._enterBossRoom();
  },

  // "The seal breaks…" with this dungeon's boss in the subtitle (host + guests)
  _bossAwakenBanner() {
    this.hud.banner(`${icon("skull")} The seal breaks…`, bossDefFor(dungeonIndexFor(this.dungeon.floor)).awaken, 2.6);
  },

  // Unlocking the gate pulls whoever's delving straight into the arena — the
  // fight starts the moment the seal breaks, no walking through the doorway.
  _enterBossRoom() {
    const D = this.dungeon;
    if (this.playerArea !== "dungeon" || !D.gatePos || !D.bossCenter) return;
    _v.copy(D.gatePos).add(DUNGEON_ORIGIN);
    const dx = D.bossCenter.x - _v.x, dz = D.bossCenter.z - _v.z;
    const l = Math.hypot(dx, dz) || 1;
    this.player.position.set(_v.x + (dx / l) * 3.2, 0, _v.z + (dz / l) * 3.2);
    this.player.animator.prevPos.copy(this.player.position);
    this._invulnT = Math.max(this._invulnT, LEVEL_INVULN); // grace to read the room
  },

  // The boss hit half health: phase two (minions + faster patterns, see dungeon)
  onBossEnraged() {
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(dungeonIndexFor(this.dungeon.floor)).name;
    this.hud.banner(`${icon("warning")} ${name} is enraged!`, "", 2.4);
  },

  // The boss is down: fanfare, a shower of sparks, and the treasure it guarded.
  // The portal it leaves drops deeper into the next stacked dungeon; the final
  // boss (floor 12) leaves the way straight home instead.
  onBossDefeated(pos = null) {
    this.audio.victory();
    this.engine.shake(0.45);
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(dungeonIndexFor(this.dungeon.floor)).name;
    const final = this.dungeon.floor >= MAX_DEPTH;
    // first boss ever felled: unseal the sewer hub for all future runs
    if (!this.bossBeaten) {
      this.bossBeaten = true;
      this._save();
    }
    this.hud.banner(`${icon("crown")} ${name} falls!`, "", 3.4);
    if (pos) {
      this.particles.burst(_v.copy(pos).setY(1), { color: 0xffe08a, n: 30, speed: 5, up: 2.2, life: 1.1, size: 1.3 });
      // deterministic on host + guest (both run this): a descent portal, or the
      // way home once the deepest boss falls
      this.dungeon.spawnReturnPortal(pos.x, pos.z, !final);
    }
  },
};
