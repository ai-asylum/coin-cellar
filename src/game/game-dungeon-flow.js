// Delve flow: the cave's trapdoor mouths (the shared lobby lives in the cave
// now), the walk-through between road and cave, cellar shortcuts, the
// pre-delve pack menu, the hole-dive cutscene, entering / leaving dungeons,
// descending floors and the boss-gate cluster. Attached to
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
import { track } from "../core/analytics.js";

// A cellar shortcut, once earned by descending past a boss, stays unsealed for
// three hours of real time before it re-locks.
const SHORTCUT_TTL_MS = 3 * 60 * 60 * 1000;
const LEVEL_INVULN = 1.8; // damage-immunity grace when arriving on a new floor

// per-call scratch vector (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();

export const dungeonFlowMethods = {
  // Commit to diving into cave mouth `id`: pack first if there's anything in
  // the storeroom worth carrying, otherwise straight down the hole.
  _delve(id = 0) {
    // the guided first day holds the mouths shut until the FTUE has walked
    // you through selling — the send-off's "delve" step is the first real trip
    if (this.tutorial && this.tutorial !== "delve") {
      this.hud.toast(`${icon("box")} Finish setting up shop first`);
      return;
    }
    this._packHole = id;
    this._enterHole(id);
  },

  // Walk-through travel between the village road and the cave at its east end
  // (both directions are proximity triggers, no button). Landing spots sit
  // clear of the opposite trigger so the pair can't ping-pong.
  _updateCaveTravel() {
    if (this._holeDive || this._cine || this._respawnT >= 0 || this.gameOver) return;
    const p = this.player.position;
    if (this.playerArea === "cave") {
      if (p.distanceTo(this.cave.exitPos) < 1.25) this._exitCave();
    } else if (this.playerArea === "shop" && this.shop.caveMouthPos) {
      if (p.distanceTo(this.shop.caveMouthPos) < 1.5) this._enterCave();
    }
  },

  _enterCave() {
    this.playerArea = "cave";
    this.shop.doorHeld = false; // drop any FTUE send-off hold once they head out
    this.player.position.copy(this.cave.exitPos).add(_v.set(0, 0, -1.8));
    this.player.heading = Math.PI; // walking north, deeper into the dark
    this.player.animator.prevPos.copy(this.player.position);
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showStore(false); // storeroom lives in the shop, not the cave
    this.hud.setGoldCorner(true);
    this.audio.stairs();
    this._snapCamera();
    // the cave is the shared lobby now: strangers' avatars show up here
    this.lobby.join("cave");
    // coming back for more loot: the trapdoor the hero shut behind them
    // swings open ahead — the FTUE's last reveal, and nobody said a word
    if (!this.cave.trapdoorOpen && (!this.tutorial || this.tutorial === "delve")) {
      this.cave.setTrapdoorOpen(true);
      this.audio.chest();
    }
  },

  _exitCave() {
    this.playerArea = "shop";
    this.cave.setFtueVeil(false); // out in the daylight — clear the FTUE fog so the mouths read again
    this.lobby.leave();
    // step out beside the rocky mouth at the top of the road
    this.player.position.copy(this.shop.caveMouthPos).add(_v.set(0, 0, 1.9));
    this.player.heading = 0; // face south, down the road toward the shop
    this.player.animator.prevPos.copy(this.player.position);
    this.hud.showBag(true); // the bag is reachable everywhere, town included
    const storeUp = this.playerArea === "shop" && !this.tutorial;
    this.hud.showStore(storeUp);
    this.hud.setGoldCorner(false);
    this.audio.stairs();
    this._snapCamera();
    // homecoming juice: the loot banked on the way up (see _depositBag) whooshes
    // from the backpack button across to the now-visible storeroom button. Give
    // the layout a beat to settle before measuring the buttons.
    const loot = this._pendingStoreFly;
    this._pendingStoreFly = null;
    if (storeUp && loot && loot.length) {
      this.audio.chest?.();
      setTimeout(() => this.hud.flyBagToStore(loot, () => this.audio.pickup?.()), 320);
    }
    // the FTUE's first walk-out is a beat of its own (banner + the road line)
    if (this.tutorial === "exit") this._onFtueCaveExit();
  },

  // A barred cave mouth: spell out how the shortcut opens. (Open mouths dive
  // straight in — see the cave interact in _contextAction, no confirm sheet.)
  _holePrompt(id) {
    if (this._shortcutOpen(id)) return;
    this.hud.toast(`${icon("hole")} Locked — beat the Floor ${id * FLOORS_PER_DUNGEON} boss to open this shortcut`);
    this.audio.deny();
  },

  // Is cellar mouth `id` open? The entrance (0) always is; the deeper mouths
  // stay open until their earned wall-clock expiry lapses.
  _shortcutOpen(id) {
    if (id <= 0) return true;
    return Date.now() < (this.shortcutUntil?.[id] ?? 0);
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
      const name = this.cave.holes[id]?.name ?? "a deeper vault";
      this.hud.toast(`${icon("hole")} Cellar shortcut to ${name} opened for 3h`);
    }
  },

  // Jump into mouth `id`, landing at the head of its stacked dungeon (floors
  // 1/4/7/10). The layout is seeded off the UTC day, so everyone delving today
  // shares it. In PeerJS co-op the pair shares one dungeon: host generates,
  // guest requests.
  _enterHole(id) {
    // the FTUE's send-off step completes on the first real descent
    this._tutAdvance("delve");
    const floor = id * FLOORS_PER_DUNGEON + 1;
    if (this.net.isGuest) {
      if (!this.dungeon.active) {
        this.cellarHole = id;
        this._wantDelve = true;
        this.net.send({ t: "delveReq", hole: id });
        return;
      }
      // the pair shares one dungeon: whichever mouth is live is where we land
      // (cellarHole already tracks it from the host's "floor" message)
      this._enterDungeon();
      return;
    }
    if (!this.dungeon.active || this.dungeon.floor !== floor) {
      this.cellarHole = id;
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
  // cancels the delve. The supply selection (and which cave mouth the delve is
  // headed into, `this._packHole`) is held on `this` so it survives
  // round-trips into the per-slot equip picker.
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
          <div><b>Pack your bag</b><br/><small>gear up, then grab supplies for the dive</small></div>
          <button class="icon-btn" id="pack-close">${icon("close")}</button></div>
        ${supplies}
        <div class="sheet-btns">
          <button class="btn deny" id="pack-skip">${icon("close")} Travel light</button>
          <button class="btn deal" id="pack-go">${icon("hole")} Dive</button>
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
      this._enterHole(this._packHole ?? 0);
    };
    el.querySelector("#pack-go").onclick = () => {
      const idxs = [...sel];
      this._packSel = null;
      this.hud.hideSheet();
      this._pack(idxs);
      this._enterHole(this._packHole ?? 0);
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
    // remember what was banked so the walk into the shop can play the loot
    // whooshing from the backpack over to the storeroom (see _exitCave)
    this._pendingStoreFly = this.inventory.map((id) => itemIcon(ITEMS[id]?.icon || "box"));
    this.stash.push(...this.inventory);
    this.inventory = [];
    this.hud.toast(`${icon("box")} ${n} item${n > 1 ? "s" : ""} moved to the storeroom`);
    this._syncInv();
    this._save();
  },

  // A short "jump into the hole" cutscene before the next area loads: the
  // player springs up over the mouth, then plunges down the dark shaft,
  // spinning and shrinking away into the black. Purely cosmetic and local —
  // used for each of the cave's dungeon mouths. `center` is
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
    // dropping in from a cave mouth: play the plunge animation first, then
    // land in the dungeon once it finishes (the dive re-calls us with the flag
    // set). Descending stairs mid-run starts in the dungeon, so it skips this.
    if (this.playerArea === "cave" && this.cellarHole >= 0 && !this._diveDone) {
      const hole = this.cave.holes[this.cellarHole];
      this._beginHoleDive(hole ? hole.pos : this.player.position, () => {
        this._diveDone = true;
        this._enterDungeon();
      });
      return;
    }
    this._diveDone = false;
    // the themed dungeon (and its boss/palette) follows the current floor now
    // that dungeons are stacked; the tutorial cellar keeps its private look
    if (!this.tutorial) this.cellarHole = dungeonIndexFor(this.dungeon.floor);
    // a fresh drop (not descending stairs mid-run) bumps the run counter that
    // feeds dungeon variety — guarded on playerArea so mid-run stairs, which
    // start already in the dungeon, don't re-roll it. Solo only.
    if (!this.net.connected && this.playerArea !== "dungeon") this.day++;
    this.playerArea = "dungeon";
    this.hud.showHearts(true);
    this.hud.showBag(true);
    this.hud.showStore(false);
    this.hud.showGold(true);
    this.hud.setGoldCorner(true);
    _v.copy(this.dungeon.entrancePos).add(DUNGEON_ORIGIN);
    // land a step clear of the up-stairs at the arrival spot, so the "go up"
    // action doesn't sit primed the moment you drop in
    this.player.position.set(_v.x + 1.4, 0, _v.z + 1.0);
    this.player.animator.prevPos.copy(this.player.position);
    this._invulnT = Math.max(this._invulnT, LEVEL_INVULN); // grace on arrival
    this.today.deepest = Math.max(this.today.deepest, this.dungeon.floor);
    const place = this.cave.holes[this.cellarHole]?.name ?? "Cellar";
    // a genuinely new deepest floor is town news — the residents remark on it
    // next time you chat (floor 1 doesn't count as a "deeper" push)
    if (this.dungeon.floor > this.deepestEver && this.dungeon.floor > 1) {
      this.deepestEver = this.dungeon.floor;
      this.recordPlayerDeed("newDepth", { floor: this.dungeon.floor, place });
      if (!this.net.isGuest) this._save();
    }
    // hop onto this hole's realtime channel so fellow delvers show up
    if (this.cellarHole >= 0) this.lobby.join(`hole:${utcDay()}:${this.cellarHole}`);
    this.audio.stairs();
    this._snapCamera();
    const bossFloor = isBossFloor(this.dungeon.floor);
    const finalFloor = this.dungeon.floor >= MAX_DEPTH;
    this.hud.banner(
      bossFloor
        ? `${icon("skull")} ${place} — ${finalFloor ? "Final Floor" : "Boss Floor"}`
        : `${icon("hole")} ${place} — Floor ${this.dungeon.floor}`,
      bossFloor ? (this._hasBossKey() ? "unlock the sealed door" : "find a Brass Key to breach the boss door") : "",
      bossFloor ? 2.6 : 1.6
    );
    track("dungeon_entered", {
      floor: this.dungeon.floor,
      place,
      boss_floor: bossFloor,
      coop: this.net.connected,
    });
  },

  // Standing on the up-stairs: leaving ends the run and banks whatever the bag
  // holds, so confirm before climbing out rather than bouncing straight home
  // off a stray tap. In co-op the sim keeps ticking so a partner isn't stranded.
  _returnHomePrompt() {
    if (this.hud.sheetOpen) return;
    // the guided first delve stays friction-free — climb straight out
    if (this.tutorial) return this._returnHome();
    this.paused = !this.net.connected;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("home")}</span>
        <div><b>Leave the dungeon?</b></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="up-stay">${icon("arrowDown")} Keep delving</button>
        <button class="btn deal" id="up-leave">${icon("home")} Go up</button>
      </div>
    `, "sheet-card leave-sheet");
    el.querySelector("#up-stay").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
    };
    el.querySelector("#up-leave").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._returnHome();
    };
  },

  // "Go up" from a dungeon: climb back out into the cave beside the mouth you
  // dove into — the bag deposits itself into the storeroom on the way, and
  // the walk down the road to the shop is the homecoming.
  _returnHome() {
    this.playerArea = "cave";
    this._floorDesync = false;
    this._pendingLead = null;
    this.lobby.join("cave"); // back in the shared lobby
    this._depositBag();
    // a trip back up patches you up — no day/night rest to do it any more
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showStore(false); // still in the cave — home is a road-walk away
    this.hud.showGold(true);
    this.hud.setGoldCorner(true);
    if (this.hud.sheetOpen) this.hud.hideSheet();
    const mouth = this.cave.holes[this.cellarHole]?.pos ?? this.cave.descentPos;
    this.player.position.copy(mouth).add(_v.set(0, 0, 1.9));
    this.player.heading = 0; // facing the daylight, homeward
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this._snapCamera();
    this.hud.banner(`${icon("hole")} Back to the surface`, "", 1.4);
    track("returned_home", { deepest: this.today?.deepest ?? 0, gold: this.gold });
    this._save();
  },

  // One floor deeper. Within a dungeon this is the down-stairs; crossing a
  // boss floor (3/6/9) it's the boss's descent stairs, which also unseal the
  // cellar shortcut to the dungeon we're dropping into.
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
    // cellar shortcut for the day (3h)
    if (isBossFloor(from)) this._unlockShortcut(dungeonIndexFor(n));
    this.cellarHole = dungeonIndexFor(n);
    this.dungeon.generate(n, seed);
    this._hostDungeonFloor = n;
    this.net.send({ t: "floor", n, seed, hole: this.cellarHole, lead: 1 });
    this._enterDungeon();
    this.engine.shake(0.2);
  },

  // Guest: catch up to the floor the host has already advanced to.
  _followLead() {
    const { n, seed, hole } = this._pendingLead;
    if (hole != null) this.cellarHole = hole;
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
    // partner isn't stranded mid-run)
    this.paused = !this.net.connected;
    const has = this._hasBossKey();
    const boss = bossDefFor(dungeonIndexFor(this.dungeon.floor));
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("skull")}</span>
        <div><b>The sealed door</b><br/><small>${has ? `${boss.name} — enter, or turn back up?` : `You need a ${itemIcon("key")} Brass Key to breach it.`}</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="gate-up">${icon("home")} Go back up</button>
        <button class="btn deal" id="gate-enter">${icon("skull")} Enter boss</button>
      </div>
    `, "sheet-card gate-sheet");
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

  // Breaking the seal wakes the keeper — it storms out of its cell after
  // whoever opened the door. No teleport: the boss comes to you, wherever you
  // stand. (openGate wakes it host-side; this makes the aggro explicit and is a
  // harmless no-op for guests, whose boss AI is driven by the host.)
  _enterBossRoom() {
    const boss = this.dungeon.boss;
    if (!boss) return;
    boss.dormant = false;
    boss.woke = true;
    boss.state = "chase";
  },

  // The boss hit half health: phase two (minions + faster patterns, see dungeon)
  onBossEnraged() {
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(dungeonIndexFor(this.dungeon.floor)).name;
    this.hud.banner(`${icon("warning")} ${name} is enraged!`, "", 2.4);
  },

  // The boss is down: fanfare, a shower of sparks, and the treasure it guarded.
  // The stairs it leaves drop deeper into the next stacked dungeon; the final
  // boss (floor 12) leaves the way straight home instead.
  onBossDefeated(pos = null) {
    this.audio.victory();
    this.engine.shake(0.45);
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(dungeonIndexFor(this.dungeon.floor)).name;
    const final = this.dungeon.floor >= MAX_DEPTH;
    // records the first boss ever felled (kept for save-migration purposes)
    if (!this.bossBeaten) {
      this.bossBeaten = true;
      this._save();
    }
    this.hud.banner(`${icon("crown")} ${name} falls!`, "", 3.4);
    // town news: the next resident you chat with leads with the boss kill
    this.recordPlayerDeed("bossFelled", { boss: name, place: this.cave.holes[this.cellarHole]?.name ?? "the cellar", floor: this.dungeon.floor });
    if (pos) {
      this.particles.burst(_v.copy(pos).setY(1), { color: 0xffe08a, n: 30, speed: 5, up: 2.2, life: 1.1, size: 1.3 });
      // deterministic on host + guest (both run this): reveal the real staircase
      // down sunk into the arena's back wall — or, once the deepest boss falls,
      // conjure the way straight home where it fell (no floor deeper to sink into)
      if (final || !this.dungeon.revealBossStairs()) this.dungeon.spawnBossStairs(pos.x, pos.z, !final);
    }
  },
};
