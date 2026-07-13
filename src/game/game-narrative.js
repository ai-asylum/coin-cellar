// The first-run FTUE ("The End of the Road") + the Mayor cutscenes. Attached
// to Game.prototype via Object.assign, so `this` is the live Game instance.
//
// A brand-new shopkeeper wakes up mid-spelunk in the cave at the end of the
// road, watches their own hero cut down one last slime (the scripted opener),
// walks out into the daylight with a full pack, finds the village shop CLOSED
// — and the Mayor hands them the keys. The loop is then taught in the order
// you live it: stock a table, watch the first sale land, and take the Mayor's
// dare back to the cave, whose pit is the way down to the dungeons. Steps:
//   exit → shop → stock → sell → delve
import * as THREE from "three";
import { BlockyCreature } from "../chargen/blocky.js";
import { portraitDataURL } from "../chargen/portrait.js";
import { icon, itemIcon } from "../core/icons.js";
import { ITEMS } from "./items.js";
import { SHOP } from "./shop-data.js";
import { track } from "../core/analytics.js";

// The Mayor NPC: a fixed character variant (so his walking body matches the
// dialogue bust). One sentence per bubble throughout.
const MAYOR_VARIANT = "q"; // Kenney "Villager Q"
// The shop clerk who hauls you home after a shallow-floor knockout: a fixed
// variant so the body you wake up next to matches the bust in the dialogue.
const CLERK_VARIANT = "e";
const CLERK_LINE = "We found you in the dungeon, you're lucky you didn't pass out deeper.";

// ---- the script -------------------------------------------------------------
// The full annotated script (staging, tap budgets, cut lines and why) lives in
// specs/game-design/08-ftue-script.md — keep the two in sync. House rules:
// one idea per bubble, ≤ ~70 chars, no speaker gets more than 3 in a row.
// Scene 1 — the cave, right after the scripted slime kill
const PLAYER_WAKE_LINES = [
  "Whew. That should be enough for today.",
  "Now — where was that exit...",
];
// Scene 2 — out on the road, first sight of the village (the guide arrow
// carries the "go sell" instruction, so one line is plenty)
const PLAYER_ROAD_LINES = [
  "Finally — a village. My back is killing me.",
];
// Scene 3 — the shopfront: the sign tells the shopkeeper's story, so the
// Mayor only makes the deal. No "follow me" — walking in IS the invitation.
const SIGN_TEXT = "“CLOSED — gone delving. Don't wait up. — the management”";
const PLAYER_CLOSED_LINE = "Closed?! You have GOT to be kidding me.";
const MAYOR_DOOR_LINES = [
  "Don't bother, friend — he's been gone a year.",
  "You, though... full pack, strong back. I have a mad idea.",
  "The shop's yours. Rent-free. Help me wake this town up.",
];
// Scene 4 — the first sale just landed: the Mayor's praise doubles as the
// send-off. The rebuild ask is soft (one line, never a quest); the cave
// reveal is a dare, not a lecture — the guide arrow finishes the sentence.
const MAYOR_SALE_LINES = [
  "Ha! Sold already. You're made for this.",
  "Purse ever heavy? Spare a ruin a thought — I'll do the hammering.",
  "That pit in the cave? The old owner didn't dig it for potatoes. Go see.",
];
const PLAYER_RESOLVE_LINE = "“Enough for today,” huh... not anymore.";
// The optional epilogue: the player rebuilt their first home, the Mayor drops by
const MAYOR_PRAISE_LINES = [
  "Ha! A family already — would you look at that.",
  "Every roof you raise brings more custom through your door.",
];

// where the Mayor stands inside the shop while you set up and make the sale
// (just in from the street-side door on the up-street half, clear of the
// vitrine and the tables; rotated-town coordinates — the road runs along z)
const WATCH_SPOT = new THREE.Vector3(3.3, 0, -1.5);

const TUT_ORDER = ["exit", "shop", "stock", "sell", "delve"];

// per-call scratch vectors (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const narrativeMethods = {
  // ---- first-run onboarding -------------------------------------------------
  // Kick off the FTUE on a fresh solo save: wake up deep in the (permanent)
  // cave with the haul already in the bag, right beside the cellar descent —
  // as if just climbed out — and queue the scripted slime-kill opener.
  _tutStart() {
    this.tutorial = "exit";
    this.shop.doorLocked = true; // the shopfront reads firmly shut until Scene 3
    this._doorScene = false; // Scene 3 runs once
    this._bagStowed = false; // the haul moves to the storeroom on first entry
    this.cave.spawnSlime();
    this.playerArea = "cave";
    this.player.position.copy(this.cave.entrancePos);
    this.player.heading = 0; // face the daylight, south down the tunnel
    this.player.animator.prevPos.copy(this.player.position);
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.setGoldCorner(true);
    this._snapCamera();
    // let the title banner breathe, then the opener takes the hero
    this._cine = { phase: "wait", t: 0 };
  },

  // The scripted opener: a beat of quiet, a wary walk as the slime hops in to
  // meet the hero, one dash through it (the real dash's juice, minus the
  // input), the jelly popping into the bag, then the hero's first words.
  // Runs from _updatePlayer while `this._cine` is live.
  _updateCaveIntro(dt, elapsed) {
    const cine = this._cine;
    const c = this.player;
    const slime = this.cave?.slime;
    cine.t += dt;
    switch (cine.phase) {
      case "wait":
        if (cine.t >= 0.8 && slime) {
          cine.phase = "approach";
          cine.t = 0;
        }
        break;
      case "approach": {
        if (!slime || slime.dead) { cine.phase = "loot"; cine.t = 0; break; }
        // both close the gap: the hero at a wary walk, the slime at a hungry
        // hop (its animator derives the bounce from the position delta)
        _v.set(slime.position.x - c.position.x, 0, slime.position.z - c.position.z);
        const gap = _v.length();
        _v.normalize();
        c.heading = Math.atan2(_v.x, _v.z);
        slime.heading = Math.atan2(-_v.x, -_v.z);
        c.position.addScaledVector(_v, 2.2 * dt);
        slime.position.addScaledVector(_v, -1.25 * dt);
        if (gap <= 2.3 || cine.t > 3) {
          cine.phase = "dash";
          cine.t = 0;
          cine.dx = _v.x;
          cine.dz = _v.z;
          c.animator.squash.kick(5);
          this.audio.dodge();
          this.particles.burst(_v2.copy(c.position).setY(0.1), { color: 0xbfe8ff, n: 9, speed: 2.6, up: 0.6, gravity: 3, life: 0.35, size: 0.9 });
          this.slash.play(_v2.copy(c.position).setY(0.62), c.heading, 1.2);
        }
        break;
      }
      case "dash": {
        const k = Math.max(0, 1 - cine.t / 0.34);
        const sp = 13 * (0.35 + 0.65 * k);
        c.position.x += cine.dx * sp * dt;
        c.position.z += cine.dz * sp * dt;
        this.slash.follow(c.position.x, 0.62, c.position.z);
        const felled = slime && !slime.dead &&
          (c.position.distanceTo(slime.position) < 0.7 || cine.t >= 0.34);
        if (felled) {
          cine.killPos = slime.position.clone();
          slime.die(_v.set(cine.dx * 7, -2, cine.dz * 7));
          this.audio.hit();
          this.audio.kill();
          this.engine.hitStop(0.08);
          this.engine.shake(0.16);
          this.particles.burst(_v2.copy(slime.position).setY(0.5), { color: 0x53c66e, n: 16, speed: 3.4, up: 1.6, life: 0.6, size: 1.1 });
        }
        if (cine.t >= 0.34) {
          cine.phase = "loot";
          cine.t = 0;
        }
        break;
      }
      case "loot":
        if (cine.t >= 0.55 && !cine.looted) {
          // the felled slime's jelly pops straight into the pack
          cine.looted = true;
          this.inventory.push("jelly");
          this.audio.pickup();
          const it = ITEMS.jelly;
          const at = cine.killPos ?? this.cave.slimePos;
          this.hud.float(_v.copy(at).setY(1.1), `${itemIcon(it.icon)} ${it.name}`, "loot");
          this.hud.flyToBag(_v.copy(at).setY(0.8), itemIcon(it.icon));
        }
        if (cine.t >= 1.35) {
          this._cine = null;
          this._selfSay(PLAYER_WAKE_LINES, () => this._tutHint());
        }
        break;
    }
    c.update(dt, elapsed);
  },

  // A cave rat fell to the player's dash (see Cave.dashHit): the kill juice
  // and its hide popping into the pack.
  _onCaveRatKilled(pos) {
    this.audio.hit();
    this.audio.kill();
    this.engine.shake(0.1);
    this.particles.burst(_v.copy(pos).setY(0.4), { color: 0x8a5a3a, n: 12, speed: 3, up: 1.4, life: 0.5, size: 1.0 });
    if (this.inventory.length < this.invCap) {
      this.inventory.push("rathide");
      this.audio.pickup();
      const it = ITEMS.rathide;
      this.hud.float(_v.copy(pos).setY(1.0), `${itemIcon(it.icon)} ${it.name}`, "loot");
      this.hud.flyToBag(_v.copy(pos).setY(0.7), itemIcon(it.icon));
    }
  },

  // Per-frame FTUE triggers that aren't tied to an existing action: reaching
  // the shopfront, and crossing the threshold with the haul. (The cave's
  // daylight walk-out is generic travel now — see _exitCave / _onFtueCaveExit.)
  _updateFtue() {
    if (!this.tutorial || this.net.connected || this._cine || this.hud.speakOpen) return;
    const p = this.player.position;
    switch (this.tutorial) {
      case "shop":
        if (!this._doorScene && this.playerArea === "shop" && p.distanceTo(this.shop.doorPos) < 2.3)
          this._shopDoorScene();
        break;
      case "stock":
        // first step through the door: the pack empties into the storeroom, so
        // the tables can be stocked from it (the town is rotated a quarter-turn,
        // so the shop rect is D wide in x and W deep in z)
        if (!this._bagStowed && this.playerArea === "shop" &&
            Math.abs(p.x) < SHOP.D / 2 && Math.abs(p.z) < SHOP.W / 2) {
          this._bagStowed = true;
          this._depositBag();
        }
        break;
    }
  },

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      exit: `${icon("bag")} Pack's full — head for the daylight`,
      shop: `${icon("shop")} Take your haul to the shop and sell it`,
      stock: `${icon("box")} Stand at the glowing table and lay out your goods`,
      sell: `${icon("coin")} A shopper's on their way in — watch your first sale land`,
      delve: `${icon("hole")} Head back to the cave — its pit is the way down for stock`,
    };
    if (hints[this.tutorial]) this.hud.toast(hints[this.tutorial]);
  },

  // Called at each loop milestone with the step it completes; advances (and
  // re-hints) only if that's the step we're currently waiting on.
  _tutAdvance(step) {
    if (this.tutorial !== step) return;
    this.tutorial = TUT_ORDER[TUT_ORDER.indexOf(step) + 1] || null;
    track("ftue_step", { step, day: this.day, gold: this.gold });
    // advancing past the last step (the first real descent) ends the FTUE
    if (!this.tutorial) track("ftue_completed", { day: this.day, gold: this.gold });
    // the first table's just been stocked — send in the scripted first shopper,
    // who always commits: a plain-table purchase the player just watches land
    if (this.tutorial === "sell") this.shop.spawnScriptedCustomer();
    // the first sale just landed — the Mayor's praise doubles as the send-off
    if (this.tutorial === "delve") this._mayorSaleScene();
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
  },

  // Where the FTUE guide arrow should point right now. Re-resolved every frame
  // so it tracks moving targets (the Mayor, customers, drops) and area changes;
  // the arrow itself lives in the HUD (hud.guide) and clamps to the screen edge
  // when the objective is out of view.
  _updateTutGuide() {
    if (!this.tutorial) return this.hud.hideGuide();
    if (this.gameOver || this.hud.sheetOpen || this._respawnT >= 0 || this._cine)
      return this.hud.hideGuide();
    const inShop = this.playerArea === "shop";
    let pos = null, text = "";
    switch (this.tutorial) {
      case "exit":
        if (this.playerArea === "cave" && this.cave) {
          pos = _v.copy(this.cave.exitPos);
          text = "Head for the daylight";
        }
        break;
      case "shop":
        if (inShop) { pos = _v.copy(this.shop.doorPos); text = "Sell your haul here"; }
        break;
      case "stock": {
        if (!inShop) break;
        if (!this._bagStowed) { pos = _v.copy(this.shop.doorInside); text = "Step inside"; break; }
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
      case "delve":
        // the send-off: point down the road at the cave mouth, then — once
        // inside — at the descent pit itself. Completes on the first descent.
        if (inShop && this.shop.caveMouthPos) {
          pos = _v.copy(this.shop.caveMouthPos);
          text = "To the cave — delve for stock";
        } else if (this.playerArea === "cave") {
          pos = _v.copy(this.cave.descentPos);
          text = "Delve here for stock";
        }
        break;
    }
    if (pos) this.hud.guide(pos.setY(1.4), text);
    else this.hud.hideGuide();
  },

  // ---- scene transitions ------------------------------------------------------
  // The FTUE's first walk into the daylight (called by _exitCave): the banner,
  // the step advance, and the hero's first look at the village.
  _onFtueCaveExit() {
    this.hud.banner(`${icon("home")} The end of the road`, "", 2.2);
    this._tutAdvance("exit");
    setTimeout(() => {
      if (this.tutorial === "shop" && !this.hud.speakOpen) this._selfSay(PLAYER_ROAD_LINES);
    }, 1000);
  },

  // Scene 3, at the shopfront: the dusty sign, the hero's outburst, and the
  // Mayor hurrying over with the keys to the rest of the game.
  _shopDoorScene() {
    this._doorScene = true;
    this.audio.deny();
    this.hud.speak({
      name: "A dusty sign",
      text: SIGN_TEXT,
      cta: "▸ …",
      onAdvance: () => this._selfSay([PLAYER_CLOSED_LINE], () => this._mayorDoorScene()),
    });
  },

  _mayorDoorScene() {
    if (this._mayor) return;
    const m = this._ensureMayor(this.shop.streetEndS);
    this._mayorWalk(m, [this.shop.doorPos.clone().add(_v.set(0.7, 0, 1.7))], () => {
      m.state = "talk";
      this._mayorSay(MAYOR_DOOR_LINES, () => {
        // the keys are yours: unlock the shopfront and lead the way in
        this.shop.doorLocked = false;
        this.shop.doorHeld = true; // hold the doors while he shows you inside
        this._tutAdvance("shop");
        this._mayorWalk(m, [this.shop.doorPos.clone(), this.shop.doorInside.clone(), WATCH_SPOT.clone()], () => {
          m.state = "watch"; // stands by, facing the player, while you set up
          this.shop.doorHeld = false;
        });
      });
    });
  },

  // Scene 4: the first sale just landed. The watching Mayor applauds, drops
  // the ruin aside and the cave dare, then sees himself out and off up the
  // street — the hero's resolve line closes the scene, and the arrow takes
  // over pointing back down the road at the cave.
  _mayorSaleScene() {
    const m = this._ensureMayor(WATCH_SPOT);
    m.state = "talk";
    this._mayorSay(MAYOR_SALE_LINES, () => {
      this.shop.doorHeld = true;
      this._mayorWalk(m, [this.shop.doorInside.clone(), this.shop.doorPos.clone(),
        this.shop.streetEndS.clone().add(_v.set(0, 0, 1.5))], () => this._endMayorScene());
      this._selfSay([PLAYER_RESOLVE_LINE]);
    });
  },

  // ---- the Mayor -------------------------------------------------------------
  // Where the Mayor stands while the player sets up shop (admin jumps reuse it).
  _mayorWatchSpot() {
    return WATCH_SPOT.clone();
  },

  // The Mayor's body, created on the spot if a scene needs him and he isn't
  // already on stage (also lets the admin FTUE jumps land mid-story).
  _ensureMayor(pos) {
    if (this._mayor) return this._mayor;
    const creature = new BlockyCreature(MAYOR_VARIANT, { height: 1.55 });
    creature.position.copy(pos);
    creature.heading = Math.atan2(this.player.position.x - pos.x, this.player.position.z - pos.z);
    this.shop.group.add(creature);
    this._mayor = {
      creature,
      portrait: portraitDataURL(MAYOR_VARIANT, "left"),
      state: "idle",
      path: null, pathIdx: 0, pathT: 0, onArrive: null,
    };
    return this._mayor;
  },

  // Send the Mayor down a waypoint path; `onArrive` fires at the last point.
  _mayorWalk(m, path, onArrive) {
    m.state = "walk";
    m.path = path;
    m.pathIdx = 0;
    m.pathT = 0;
    m.onArrive = onArrive;
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

  // The hero thinking out loud — same dialogue bar, the player's own bust.
  _selfSay(lines, onDone) {
    let i = 0;
    const portrait = portraitDataURL(this.player.variant ?? "a", "left");
    const step = () => {
      if (i >= lines.length) { this.hud.hideSpeak(); return onDone?.(); }
      this.audio.pickup?.();
      const last = i === lines.length - 1;
      this.hud.speak({
        name: "Me",
        portrait,
        text: lines[i],
        cta: last ? "▸ done" : "▸ next",
        onAdvance: () => { i++; step(); },
      });
    };
    step();
  },

  // The optional epilogue: the player just funded their first home (their own
  // call — there's no quest for it). The Mayor strolls up the road to the
  // player for a word of praise, then sees himself off.
  _mayorAfterRestore() {
    if (this.net.connected || this._mayor) return;
    const m = this._ensureMayor(this.shop.streetEndS);
    const spot = this.player.position.clone().add(_v2.set(1.5, 0, 0.8));
    this._mayorWalk(m, [spot], () => {
      m.state = "talk";
      this._mayorSay(MAYOR_PRAISE_LINES, () => {
        this._mayorWalk(m, [this.shop.streetEndS.clone().add(_v.set(0, 0, 1.5))], () => this._endMayorScene());
      });
    });
  },

  // Drive the Mayor each frame: walk his current path (straight seek +
  // wall-slide, per-leg timeout so he can never wedge), face the player while
  // talking or watching, hold his pose at the overlook. The body auto-animates
  // from its own position delta.
  _updateMayor(dt, elapsed) {
    const m = this._mayor;
    if (!m) return;
    const c = m.creature;
    switch (m.state) {
      case "walk": {
        m.pathT += dt;
        const tgt = m.path[m.pathIdx];
        _v.set(tgt.x - c.position.x, 0, tgt.z - c.position.z);
        const d = _v.length();
        if (d < 0.16 || m.pathT > 8) { // reached, or a per-leg timeout guard
          m.pathIdx++;
          m.pathT = 0;
          if (m.pathIdx >= m.path.length) {
            m.path = null;
            m.onArrive?.();
          }
        } else {
          _v.normalize();
          c.position.addScaledVector(_v, Math.min(2.5 * dt, d));
          c.heading = Math.atan2(_v.x, _v.z);
          this.collide(c.position, c.radius * 0.8, this.shop.colliders);
        }
        break;
      }
      case "talk":
      case "watch":
        c.heading = Math.atan2(this.player.position.x - c.position.x, this.player.position.z - c.position.z);
        break;
      // "overlook" / "idle": hold the pose
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
      path: [this.shop.doorInside, this.shop.doorPos, this.shop.streetEndS.clone()],
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
