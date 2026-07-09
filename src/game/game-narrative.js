// The Mayor cutscene + the first-run FTUE tutorial guide. Attached to
// Game.prototype via Object.assign, so `this` is the live Game instance.
import * as THREE from "three";
import { BlockyCreature } from "../chargen/blocky.js";
import { portraitDataURL } from "../chargen/portrait.js";
import { icon } from "../core/icons.js";
import { DUNGEON_ORIGIN } from "./dungeon.js";
import { track } from "../core/analytics.js";

// The Mayor NPC: a fixed character variant (so his walking body matches the
// dialogue bust), and his short spiel. One sentence per bubble — he offers the
// shop rent-free in exchange for helping rebuild the town, then again once the
// first lot goes up.
const MAYOR_VARIANT = "q"; // Kenney "Villager Q"
// The shop clerk who hauls you home after a shallow-floor knockout: a fixed
// variant so the body you wake up next to matches the bust in the dialogue.
const CLERK_VARIANT = "e";
const CLERK_LINE = "We found you in the dungeon, you're lucky you didn't pass out deeper.";
const MAYOR_INTRO_LINES = [
  "Ha! I was looking for one of those!",
  "The shop's yours rent-free, but you need to help me revive this town.",
  "Let's see what you can do, follow me.",
];
const MAYOR_PRAISE_LINES = [
  "Would you look at that, a family's already moving in!",
  "Keep it up: every home you raise brings more custom to your door.",
];

// per-call scratch vectors (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const narrativeMethods = {
  // ---- first-run onboarding -------------------------------------------------
  // Rather than front-loading four timed toasts, we teach the loop in the order
  // you actually live it — delve for stock, bring it up, put it on a table, and
  // make the sale — advancing only as each step is done. The shop trades all
  // day now, so there's no "open the doors" beat: the moment stock hits a table
  // a customer wanders in. Combined with the near-empty START_INV, the bare
  // shelves point a brand-new player straight at the trapdoor. Runs once, on a
  // fresh save, solo only, and hands off to the Mayor when the loop closes.
  _tutStart() {
    this.tutorial = "delve";
    this.shop.doorLocked = true; // keep the new player in until the Mayor's intro
    setTimeout(() => this._tutHint(), 3200); // let the intro banner clear first
  },

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      delve: `${icon("hole")} Your shelves are bare — step onto the trapdoor to delve for stock`,
      return: `${icon("arrowDown")} Take the stairs to bring your loot back to the shop`,
      stock: `${icon("box")} Stand at a glowing table and place your loot — a customer will come`,
      sell: `${icon("speak")} Step behind the counter and haggle to seal your first sale`,
    };
    if (hints[this.tutorial]) this.hud.toast(hints[this.tutorial]);
  },

  // Called at each loop milestone with the step it completes; advances (and
  // re-hints) only if that's the step we're currently waiting on.
  _tutAdvance(step) {
    if (this.tutorial !== step) return;
    const order = ["delve", "loot", "return", "stock", "sell"];
    this.tutorial = order[order.indexOf(step) + 1] || null;
    // advancing past the last step (the first sale) closes the FTUE loop
    if (!this.tutorial) track("ftue_completed", { day: this.day, gold: this.gold });
    // reaching the sell step means the first table's just been stocked — send in
    // the Mayor (disguised as an ordinary shopper) to buy that first item. Once
    // the sale lands he reveals himself, so there's no separate walk-in here.
    if (this.tutorial === "sell") this.shop.spawnMayorCustomer(MAYOR_VARIANT);
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
  },

  // Where the FTUE guide arrow should point right now. Re-resolved every frame
  // so it tracks moving targets (customers, drops) and area changes; the arrow
  // itself lives in the HUD (hud.guide) and clamps to the screen edge when the
  // objective is out of view.
  _updateTutGuide() {
    // outside the first-run tutorial, the same arrow serves the Mayor's quest:
    // point at the lot he's asked us to rebuild until it's restored
    if (!this.tutorial) {
      const blocked = this.gameOver || this.hud.sheetOpen;
      // one last post-Mayor nudge: the opener sold thinned the shelves, so point
      // back at the trapdoor to restock before chasing the rebuild (clears on the
      // next delve, at which point the lot quest arrow below takes over)
      if (this._restockNudge && !blocked && this.playerArea === "shop") {
        this.hud.guide(_v.copy(this.shop.trapdoorPos).setY(1.4), "Restock the inventory");
        return;
      }
      const q = this._questArrow;
      if (q && !blocked && this.playerArea === "shop")
        this.hud.guide(_v.copy(q.pos).setY(1.4), q.text);
      else this.hud.hideGuide();
      return;
    }
    if (this.gameOver || this.hud.sheetOpen || this._respawnT >= 0)
      return this.hud.hideGuide();
    const inShop = this.playerArea === "shop";
    let pos = null, text = "";
    switch (this.tutorial) {
      case "delve":
        if (inShop) { pos = _v.copy(this.shop.trapdoorPos); text = "Delve here for stock"; }
        break;
      case "loot": {
        if (inShop) { pos = _v.copy(this.shop.trapdoorPos); text = "Delve here for stock"; break; }
        if (!this.dungeon.active) break;
        // nearest drop to grab, else nearest foe to slay, else press deeper
        const p = this.player.position;
        let best = null, bestD = Infinity;
        for (const drop of this.dungeon.drops) {
          const d = drop.mesh.position.distanceToSquared(p);
          if (d < bestD) { bestD = d; best = drop.mesh.position; text = "Grab the loot"; }
        }
        if (!best) for (const e of this.dungeon.enemies) {
          if (e.deadT >= 0) continue;
          const d = e.creature.position.distanceToSquared(p);
          if (d < bestD) { bestD = d; best = e.creature.position; text = "Slay it for loot"; }
        }
        // nothing to fight (e.g. the monster-free tutorial room) — point at the
        // nearest unopened chest so the player knows to crack it for stock
        if (!best) for (const chest of this.dungeon.chests) {
          if (chest.opened) continue;
          _v2.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
          const d = _v2.distanceToSquared(p);
          if (d < bestD) { bestD = d; best = _v2.clone(); text = "Smash the chest for loot"; }
        }
        if (best) pos = _v.copy(best);
        else { pos = _v.copy(this.dungeon.upStairsPos).add(DUNGEON_ORIGIN); text = "To the stairs"; }
        break;
      }
      case "return":
        if (!inShop && this.dungeon.active) {
          pos = _v.copy(this.dungeon.upStairsPos).add(DUNGEON_ORIGIN);
          text = "Stairs — back to shop";
        }
        break;
      case "stock": {
        if (!inShop) {
          if (this.dungeon.active) { pos = _v.copy(this.dungeon.upStairsPos).add(DUNGEON_ORIGIN); text = "Back to shop"; }
          break;
        }
        if (!this.stash.length) break; // nothing left to place — no target
        const slot = this.shop.freeSlot();
        if (slot) { pos = _v.copy(slot.pos).setY(0); text = "Stock this table"; }
        break;
      }
      case "sell": {
        const cust = this.shop.customers.find((c) => c.ready && c.state === "want")
          || this.shop.customers.find((c) => !c._outside);
        if (cust) { pos = _v.copy(cust.creature.position); text = "Here is your first customer"; }
        break;
      }
    }
    if (pos) this.hud.guide(pos.setY(1.4), text);
    else this.hud.hideGuide();
  },

  // The cheapest lot still awaiting restoration — the one the Mayor points at.
  _mayorTargetLot() {
    let best = -1, bestCost = Infinity;
    (this.shop.lots || []).forEach((lot, i) => {
      if (!lot.restored && lot.cost < bestCost) { bestCost = lot.cost; best = i; }
    });
    return best;
  },

  // The Mayor's pitch, played once when the FTUE loop closes. He actually walks
  // in through the shopfront as a character (a bust flanks the dialogue so you
  // can see who's talking, like the haggle panel), gives a short spiel — the
  // shop's yours rent-free, but you help revive the town — then strolls out to
  // the lot he wants rebuilt, leaving an objective arrow on it.
  _mayorIntro() {
    if (this.net.connected || this._mayor) return; // solo onboarding, once
    const target = this._mayorTargetLot();
    this._mayorEnter(MAYOR_INTRO_LINES, () => this._mayorGoToLot(target));
  },

  // Bring the Mayor into a dialogue. `lines` are his bubbles; `afterTalk` runs
  // once the player's clicked through them. Pass `existing` to adopt a body
  // that's already in the shop (the disguised first customer) and talk on the
  // spot; otherwise he spawns on the street and walks in first.
  _mayorEnter(lines, afterTalk, existing = null) {
    if (this._mayor) return;
    let creature = existing;
    if (!creature) {
      creature = new BlockyCreature(MAYOR_VARIANT, { height: 1.55 });
      creature.position.copy(this.shop.doorPos).add(_v.set(0, 0, -1.4));
      creature.heading = 0;
      this.shop.group.add(creature);
    }
    this.shop.doorHeld = true; // hold the shopfront open so he can come and go
    this._mayor = {
      creature,
      portrait: portraitDataURL(MAYOR_VARIANT, "left"),
      state: existing ? "talk" : "enter",
      lines, afterTalk,
      talkSpot: new THREE.Vector3(0.9, 0, 1.9), // just inside, by the tables
      leaveStage: 0,
    };
    if (existing) {
      // already standing at the counter — turn to the player and start talking
      creature.heading = Math.atan2(
        this.player.position.x - creature.position.x,
        this.player.position.z - creature.position.z);
      this._mayorSay(lines, afterTalk);
    }
  },

  // The disguised first customer just bought the player's opener — drop the act
  // and reveal the Mayor, talking on the spot, then he heads to the first lot.
  _mayorFromCustomer(cust) {
    if (this.net.connected || this._mayor) return;
    const creature = this.shop.detachCustomer(cust);
    const target = this._mayorTargetLot();
    this._mayorEnter(MAYOR_INTRO_LINES, () => this._mayorGoToLot(target), creature);
  },

  // Intro over: head out to the target lot and raise the objective arrow on it.
  _mayorGoToLot(idx) {
    const m = this._mayor;
    if (!m) return;
    this.shop.doorLocked = false; // first dialog's done — the shopfront's free now
    m.targetLot = idx;
    m.state = idx >= 0 ? "toLot" : "leave";
    const lot = this.shop.lots[idx];
    if (lot) {
      // wait a couple of metres to the right of the plot — clear of the spot the
      // player stands on to rebuild — and hold there until the house goes up.
      m.standSpot = lot.interactPos.clone().add(_v.set(2.5, 0, 0));
      this._questArrow = { pos: lot.interactPos.clone(), text: `${icon("home")} Rebuild — ${lot.cost}g` };
    }
  },

  _mayorLeave() {
    const m = this._mayor;
    if (!m) return;
    this.hud.hideSpeak();
    m.state = "leave";
    m.path = null; // force the leave route to rebuild from wherever he's standing
  },

  _endMayorScene() {
    const m = this._mayor;
    if (!m) return;
    this._mayor = null;
    this.shop.doorHeld = false;
    this.hud.hideSpeak();
    m.creature.dispose?.();
    this.shop.group.remove(m.creature);
  },

  // Cycle the Mayor's bubbles through the in-world dialogue bar (portrait + text,
  // tap to advance), then fire onDone.
  _mayorSay(lines, onDone) {
    let i = 0;
    const step = () => {
      if (i >= lines.length) { this.hud.hideSpeak(); return onDone?.(); }
      this.audio.pickup?.();
      const last = i === lines.length - 1;
      this.hud.speak({
        name: "The Mayor",
        portrait: this._mayor?.portrait,
        text: lines[i],
        cta: last ? "▸ done" : "▸ next",
        onAdvance: () => { i++; step(); },
      });
    };
    step();
  },

  // Once the Mayor's target lot is rebuilt: clear the arrow and give him a short
  // congratulatory follow-up (walking back on if he's already wandered off).
  // Only now — with the house up — do we send the final FTUE beat: nudge the
  // player back down to restock the thinned shelves. It's a lightweight flag
  // that steers the guide arrow + a hint and clears on the next delve.
  _mayorAfterRestore() {
    this._questArrow = null;
    const done = () => {
      this._mayorLeave();
      if (!this.net.connected) {
        this._restockNudge = true;
        setTimeout(() => {
          if (this._restockNudge)
            this.hud.toast(`${icon("hole")} Restock the inventory — head back down to the cellar for more stock`);
        }, 700);
      }
    };
    if (this._mayor) {
      this._mayor.state = "talk";
      this._mayor.path = null;
      this._mayor.afterTalk = done;
      this._mayorSay(MAYOR_PRAISE_LINES, done);
    } else {
      this._mayorEnter(MAYOR_PRAISE_LINES, done);
    }
  },

  // Drive the Mayor cutscene each frame: walk in, stand and talk, stroll out to
  // a spot just right of the target lot and wait there until it's rebuilt (then
  // a praise beat sends him off). He follows a short waypoint path (routed
  // through the doorway so he doesn't try to walk through the back wall);
  // movement is a simple seek + wall-slide and the body auto-animates from its
  // own position delta. A per-state timeout keeps him from ever getting stuck.
  _updateMayor(dt, elapsed) {
    const m = this._mayor;
    if (!m) return;
    const c = m.creature;
    const facePlayer = () => {
      c.heading = Math.atan2(this.player.position.x - c.position.x, this.player.position.z - c.position.z);
    };
    // walk `m.path` in order; returns true once the last waypoint is reached
    const follow = (speed = 2.4) => {
      m.pathT = (m.pathT ?? 0) + dt;
      const tgt = m.path[m.pathIdx];
      _v.set(tgt.x - c.position.x, 0, tgt.z - c.position.z);
      const d = _v.length();
      const reached = d < 0.16 || m.pathT > 8; // timeout guard
      if (reached) {
        m.pathIdx++;
        m.pathT = 0;
        return m.pathIdx >= m.path.length;
      }
      _v.normalize();
      c.position.addScaledVector(_v, Math.min(speed * dt, d));
      c.heading = Math.atan2(_v.x, _v.z);
      this.collide(c.position, c.radius * 0.8, this.shop.colliders);
      return false;
    };
    const setPath = (pts) => { m.path = pts; m.pathIdx = 0; m.pathT = 0; };
    if (!m.path && (m.state === "enter" || m.state === "toLot" || m.state === "leave")) {
      // lazily build the path for the current walking state on first tick
      if (m.state === "enter") setPath([this.shop.doorInside, m.talkSpot]);
      else if (m.state === "toLot") {
        const lot = this.shop.lots[m.targetLot];
        setPath(lot ? [this.shop.doorInside, this.shop.doorPos, m.standSpot] : [this.shop.doorInside]);
      } else setPath([this.shop.doorInside, this.shop.doorPos,
        new THREE.Vector3(this.shop.streetHalfX, 0, this.shop.streetWalkZ)]);
    }
    switch (m.state) {
      case "enter":
        if (follow(2.3)) {
          m.path = null;
          m.state = "talk";
          facePlayer();
          this._mayorSay(m.lines, m.afterTalk);
        }
        break;
      case "talk":
        facePlayer();
        break;
      case "toLot":
        if (follow(2.6)) {
          m.path = null;
          m.state = "await";
          const lot = this.shop.lots[m.targetLot];
          if (lot) c.heading = Math.atan2(lot.cx - c.position.x, lot.collider.z - c.position.z);
        }
        break;
      case "await":
        // hold by the plot (facing it) until the player rebuilds it — the repair
        // fires _mayorAfterRestore, which moves him on. No timed walk-off.
        break;
      case "leave":
        if (follow(2.7)) return this._endMayorScene();
        break;
    }
    if (this._mayor === m) c.update(dt, elapsed);
  },

  // ---- shallow-floor rescue: the shop clerk -------------------------------
  // After a knockout on floors 1–3 the clerk hauls you back up. He's standing
  // right beside you as you come to, delivers a single reassuring line (his face
  // flanks the bubble like the Mayor's), then heads out through the shopfront.
  _clerkRecovery() {
    if (this._clerk) return;
    const creature = new BlockyCreature(CLERK_VARIANT, { height: 1.5 });
    const p = this.player.position;
    creature.position.set(p.x + 1.1, 0, p.z + 0.3);
    creature.heading = Math.atan2(p.x - creature.position.x, p.z - creature.position.z);
    this.shop.group.add(creature);
    this.shop.doorHeld = true; // hold the shopfront open so he can see himself out
    this._clerk = {
      creature,
      portrait: portraitDataURL(CLERK_VARIANT, "left"),
      state: "talk",
      path: [this.shop.doorInside, this.shop.doorPos,
        new THREE.Vector3(this.shop.streetHalfX, 0, this.shop.streetWalkZ)],
      pathIdx: 0, pathT: 0,
    };
    this.hud.speak({
      name: "Shop Clerk",
      portrait: this._clerk.portrait,
      text: CLERK_LINE,
      cta: "▸ ok",
      onAdvance: () => {
        this.hud.hideSpeak();
        if (this._clerk) this._clerk.state = "leave";
      },
    });
  },

  _endClerkScene() {
    const m = this._clerk;
    if (!m) return;
    this._clerk = null;
    this.shop.doorHeld = false;
    m.creature.dispose?.();
    this.shop.group.remove(m.creature);
  },

  // Drive the clerk each frame: face you while he talks, then walk his exit path
  // out the door and off up the street, disposing once he's gone.
  _updateClerk(dt, elapsed) {
    const m = this._clerk;
    if (!m) return;
    const c = m.creature;
    if (m.state === "leave") {
      const tgt = m.path[m.pathIdx];
      _v.set(tgt.x - c.position.x, 0, tgt.z - c.position.z);
      const d = _v.length();
      m.pathT += dt;
      if (d < 0.16 || m.pathT > 8) { // reached, or a per-leg timeout guard
        m.pathIdx++;
        m.pathT = 0;
        if (m.pathIdx >= m.path.length) return this._endClerkScene();
      } else {
        _v.normalize();
        c.position.addScaledVector(_v, Math.min(2.6 * dt, d));
        c.heading = Math.atan2(_v.x, _v.z);
        this.collide(c.position, c.radius * 0.8, this.shop.colliders);
      }
    } else {
      // still coming to — the clerk stays put, watching over you
      c.heading = Math.atan2(this.player.position.x - c.position.x, this.player.position.z - c.position.z);
    }
    c.update(dt, elapsed);
  },
};
