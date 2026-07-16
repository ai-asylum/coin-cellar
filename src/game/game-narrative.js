// The first-run FTUE ("What He Left") + the Mayor's post-FTUE cameo. Attached
// to Game.prototype via Object.assign, so `this` is the live Game instance.
//
// The old shopkeeper's only kin inherited his shop, and the road to it ends
// at a cave: the heir wakes at its deep end (the scripted slime opener),
// walks out into the daylight with a full pack, finds the shop shut — and
// opens it with the key that came with the will. Nobody welcomes them; a
// note on the first table explains the shop instead. The loop is then taught
// in the order you live it: stock a table, watch the first sale land, and
// follow the guide back to the cave, whose pit is the way down. Steps:
//   exit → shop → stock → sell → delve
// The Mayor exists but stays out of the FTUE — his first appearance is the
// praise visit after the player funds their first ruin rebuild.
import * as THREE from "three";
import { BlockyCreature } from "../chargen/blocky.js";
import { portraitDataURL } from "../chargen/portrait.js";
import { icon, itemIcon } from "../core/icons.js";
import { ITEMS } from "./items.js";
import { SHOP } from "./shop-data.js";
import { npcLinesFor, timeOfDay } from "./npc-data.js";
import { track } from "../core/analytics.js";

// The Mayor NPC: a fixed character variant (so his walking body matches the
// dialogue bust). One sentence per bubble throughout.
const MAYOR_VARIANT = "q"; // Kenney "Villager Q"
// The shop clerk who hauls you home after a shallow-floor knockout: a fixed
// variant so the body you wake up next to matches the bust in the dialogue.
const CLERK_VARIANT = "e";
const CLERK_LINE = "We found you in the dungeon, you're lucky you didn't pass out deeper.";

// ---- the script -------------------------------------------------------------
// The editable script lives in FTUE_SCRIPT.md (design notes in
// specs/game-design/08-ftue-script-inheritance.md) — keep them in sync. House
// rules: one idea per bubble, ≤ ~70 chars, no speaker gets more than 3 in a
// row, every line readable by a 10-year-old.
// Scene 1 — the cave, right after the scripted slime kill
const PLAYER_WAKE_LINES = [
  "Is this cave REALLY the only way to this town?",
  "Alright, uncle. Let's go see what you left me.",
];
// Scene 2 — out on the road, first sight of the village (the guide arrow
// carries the instruction, so one line is plenty)
const PLAYER_ROAD_LINES = [
  "So that's the town? Smaller than I thought.",
];
// Scene 3 — the shopfront won't open, and the heir came prepared: one bubble,
// then the key that came with the will turns. Nobody has to hand over
// anything.
const PLAYER_DOOR_LINE = "Time to use the key that uncle left me.";
// Scene 3½ — the note the uncle left on the first table: the loop in line
// one, and in line two the reason to care — nice people, shabby town, someone
// should fix it up. It replaces the Mayor's welcome.
const NOTE_LINES = [
  "Fill the tables and townsfolk will come to buy.",
  "They're nice people. The town just needs fixing up.",
];
// Scene 4 — the first sale just landed: the resolve bookend (answering Scene
// 1's "let's go see what you left me"), then straight back to work — the
// last bubble hands off to the delve arrow.
const PLAYER_RESOLVE_LINES = [
  "...So that's what you really left me.",
  "I'll need to get used to this new life...",
  "But first, let's do some restocking!",
];
// The optional epilogue: the player rebuilt their first home, the Mayor drops by
const MAYOR_PRAISE_LINES = [
  "Ha! A family already — would you look at that.",
  "Every roof you raise brings more custom through your door.",
];

const TUT_ORDER = ["exit", "shop", "stock", "sell", "delve"];

// per-call scratch vectors (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const narrativeMethods = {
  // ---- first-run onboarding -------------------------------------------------
  // Kick off the FTUE on a fresh solo save: wake up deep in the (permanent)
  // cave with the haul already in the bag, right beside the first dungeon
  // mouth — as if just climbed out — and queue the scripted slime-kill opener.
  _tutStart() {
    this.tutorial = "exit";
    this.shop.doorLocked = true; // the shopfront reads firmly shut until Scene 3
    this._doorScene = false; // Scene 3 runs once
    this._ftueFreeze = false; // the bag beats root the player while they're live
    this._noteSpawned = false; // the uncle's note appears on the first entry
    this._notePicked = false; // …is picked off the table like any drop
    this._noteRead = false; // …and is consumed by reading it from the bag
    // the key that came with the will rides at the top of the bag until the
    // shopfront's gates consume it (see _useShopKey)
    if (!this.inventory.includes("shopkey")) this.inventory.unshift("shopkey");
    this.cave.spawnSlime();
    this.cave.spawnFtueRat(); // a rat pottering in the light with them
    this.cave.setTrapdoorOpen(false, true); // shut behind them on the climb out
    this.cave.setFtueVeil(true); // thick black fog + fence seals the chamber off behind him
    this.playerArea = "cave";
    this.player.position.copy(this.cave.entrancePos);
    this.player.heading = 0; // face the daylight, south down the tunnel
    this.player.animator.prevPos.copy(this.player.position);
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showStore(false);
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
    // the note on the table flashes while it's the thing to grab: a slow
    // white↔gold breathe plus a size pulse, same cadence as the bag cue
    if (this._noteProp) {
      const k = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 7.4);
      this._noteProp.mesh.scale.setScalar(1 + 0.18 * k);
      this._noteProp.mesh.material.color.setRGB(1, 1 - 0.17 * k, 1 - 0.65 * k);
    }
    const p = this.player.position;
    switch (this.tutorial) {
      case "shop":
        // fires only right on the door step (the shut door stops the player
        // ~0.65 out, so 0.9 means walking straight up to it on purpose — the
        // scene shouldn't trip from halfway across the street)
        if (!this._doorScene && this.playerArea === "shop" && p.distanceTo(this.shop.doorPos) < 0.9)
          this._shopDoorScene();
        break;
      case "stock": {
        // first step through the door: the gates swing shut behind the heir,
        // and the uncle's note waits on the first table (the town is rotated a
        // quarter-turn, so the shop rect is D wide in x and W deep in z)
        if (!this._noteSpawned && this.playerArea === "shop" &&
            Math.abs(p.x) < SHOP.D / 2 && Math.abs(p.z) < SHOP.W / 2) {
          this._noteSpawned = true;
          this.shop.doorLocked = true; // the doors close behind the player
          this._spawnNoteProp();
        }
        // the note picks up like any drop: walk up to the table and it hops
        // into the bag (then wants reading — see _pickUpNote)
        if (this._noteProp && !this._notePicked &&
            p.distanceTo(_v.copy(this._noteProp.pos).setY(0)) < 1.2)
          this._pickUpNote();
        break;
      }
    }
  },

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      exit: `${icon("bag")} Pack's ready — head for the daylight`,
      shop: `${icon("shop")} Head down the road and take a look at the shop`,
      // the stock step is two beats now: the note first, then the tables
      stock: this._noteRead
        ? `${icon("box")} Stand at the glowing table and lay out your goods`
        : `${icon("scroll")} Step inside — something's on the table`,
      sell: `${icon("coin")} A shopper's on their way in — watch your first sale land`,
      delve: `${icon("hole")} Head back to the cave — its pit is the way down for more loot`,
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
    // the first sale just landed — a beat for the coin to fly, then the hero,
    // alone in their shop, closes the loop's first lap
    if (this.tutorial === "delve")
      setTimeout(() => this._selfSay(PLAYER_RESOLVE_LINES), 600);
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
  },

  // Where the FTUE guide arrow should point right now. Re-resolved every frame
  // so it tracks moving targets (the Mayor, customers, drops) and area changes;
  // the arrow itself lives in the HUD (hud.guide) and clamps to the screen edge
  // when the objective is out of view.
  _updateTutGuide() {
    if (!this.tutorial) return this.hud.hideGuide();
    // arrows wait their turn: never on screen with a dialogue bubble or a
    // sheet, and the frozen bag beats hand the stage to the bag arrow instead
    if (this.gameOver || this.hud.sheetOpen || this.hud.speakOpen ||
        this._ftueFreeze || this._respawnT >= 0 || this._cine)
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
        if (inShop) { pos = _v.copy(this.shop.doorPos); text = "Inspect"; }
        break;
      case "stock": {
        if (!inShop) break;
        if (!this._noteSpawned) { pos = _v.copy(this.shop.doorInside); text = "Step inside"; break; }
        if (!this._notePicked) {
          if (this._noteProp) { pos = _v.copy(this._noteProp.pos).setY(0); text = "Take the note"; }
          break;
        }
        if (!this._noteRead) break; // frozen with the bag arrow up — nothing to point at
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
          text = "To the cave — delve for more loot";
        } else if (this.playerArea === "cave") {
          pos = _v.copy(this.cave.descentPos);
          text = "Delve here for more loot";
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

  // Scene 3, at the shopfront: the door won't open — the hero already holds
  // the answer, but the player has to reach into the bag for it themselves.
  // The line plays, then the bag pulses with an arrow and the hero stays
  // rooted on the step until the key is used (see _useShopKey).
  _shopDoorScene() {
    this._doorScene = true;
    this.audio.deny();
    this._ftueFreeze = true;
    this._selfSay([PLAYER_DOOR_LINE], () => this.hud.bagAttention("Open the backpack"));
  },

  // The bag's "Use" on the shop key: the key turns, the gates swing open and
  // consume it, and the heir is free to step inside.
  _useShopKey() {
    if (this.tutorial !== "shop") return;
    const i = this.inventory.indexOf("shopkey");
    if (i === -1) return;
    this.inventory.splice(i, 1);
    this._syncInv();
    this.hud.hideSheet();
    this.hud.clearBagAttention();
    this._ftueFreeze = false;
    this.shop.doorLocked = false; // the doors swing for the player right here
    this.audio.pickup();
    this.hud.toast(`${icon("key")} The key fits — the gates swing open`);
    this._tutAdvance("shop");
  },

  // Scene 3½, just inside: the doors have shut behind the heir and the
  // uncle's note waits on the first table as a real prop — the guide arrow
  // walks the player to it and it pops into the bag like any drop.
  _spawnNoteProp() {
    if (this._noteProp) return;
    const slot = this.shop.freeSlot();
    if (!slot) return;
    // placeholder art: a plain white sheet lying flat on the tabletop,
    // skewed a little so it reads as left there, not laid out for sale
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.65),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = 0.35;
    mesh.position.copy(slot.pos).y += 0.01; // just off the wood, no z-fighting
    this.shop.group.add(mesh);
    this._noteProp = { mesh, pos: slot.pos.clone() };
  },

  _removeNoteProp() {
    if (!this._noteProp) return;
    this.shop.group.remove(this._noteProp.mesh);
    this._noteProp.mesh.geometry.dispose();
    this._noteProp.mesh.material.dispose();
    this._noteProp = null;
  },

  // The note hops into the bag with the usual loot juice, then the bag pulses
  // again — arrow only, the player knows this dance now — and the hero stays
  // put until it's read (see _readNote).
  _pickUpNote() {
    this._notePicked = true;
    const at = this._noteProp.pos;
    this._removeNoteProp();
    this.inventory.unshift("unclenote"); // top of the bag, like the key was
    this.audio.pickup();
    const it = ITEMS.unclenote;
    this.hud.float(_v.copy(at).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
    this.hud.flyToBag(_v.copy(at).setY(0.9), itemIcon(it.icon));
    this._ftueFreeze = true;
    this.hud.bagAttention();
  },

  // The bag's "Read" on the note: the uncle's pitch plays beside his sepia,
  // burnt-edged bust — the game's only glimpse of him, never in the flesh,
  // only as the note's voice. Reading consumes the note; then the haul moves
  // to the storeroom (not a moment sooner) and the shop is open for business.
  _readNote() {
    if (!this._notePicked || this._noteRead) return;
    this.hud.hideSheet();
    this.hud.clearBagAttention();
    this._speakLines("The Note", "characters/uncle-portrait.png", NOTE_LINES, () => {
      this._noteRead = true;
      const i = this.inventory.indexOf("unclenote");
      if (i !== -1) this.inventory.splice(i, 1);
      this._ftueFreeze = false;
      this.shop.doorLocked = false; // read up — open for business
      this._depositBag();
      this._tutHint();
    });
  },

  // Which story action a quest prop offers in the bag right now, if any
  // (rendered by _openBagSheet in place of the usual Use/Drop pair).
  _questBagAction(id) {
    if (id === "shopkey" && this._doorScene && this.tutorial === "shop")
      return { label: "Use", fn: () => this._useShopKey() };
    if (id === "unclenote" && this._notePicked && !this._noteRead)
      return { label: "Read", fn: () => this._readNote() };
    return null;
  },

  // ---- the Mayor (post-FTUE only) --------------------------------------------
  // The Mayor's body, created on the spot if a scene needs him and he isn't
  // already on stage.
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

  // Cycle a speaker's bubbles through the in-world dialogue bar (portrait +
  // text, tap to advance), then fire onDone. `portrait` is a data URL or an
  // asset path; pass null for a faceless speaker.
  _speakLines(name, portrait, lines, onDone) {
    let i = 0;
    const step = () => {
      if (i >= lines.length) { this.hud.hideSpeak(); return onDone?.(); }
      this.audio.pickup?.();
      const last = i === lines.length - 1;
      this.hud.speak({
        name,
        portrait,
        text: lines[i],
        cta: last ? "▸ done" : "▸ next",
        onAdvance: () => { i++; step(); },
      });
    };
    step();
  },

  _mayorSay(lines, onDone) {
    this._speakLines("The Mayor", this._mayor?.portrait, lines, onDone);
  },

  // The hero thinking out loud — same dialogue bar, the player's own bust.
  _selfSay(lines, onDone) {
    this._speakLines("Me", portraitDataURL(this.player.variant ?? "a", "left"), lines, onDone);
  },

  // ---- chatting with the townsfolk ------------------------------------------
  // Strike up a conversation with a shopper or passer-by. Their body pauses and
  // faces the player (see shop-customers: the `chatting` flag), and the dialogue
  // bar shows their name and a single line — a fresh one each time you talk,
  // cycling through their five. Advancing closes it.
  _talkToNpc(target) {
    if (!target || !target.npc || this._npcChat) return;
    const npc = target.npc;
    const c = target.creature;
    c.heading = Math.atan2(this.player.position.x - c.position.x, this.player.position.z - c.position.z);
    target.chatting = true;
    // small talk keyed to the town's day/night clock: pick the bucket for the
    // current hour (admin can pin it via debugHour), then cycle its five lines.
    // A per-bucket line index keeps the greeting fresh within a time of day and
    // resets when the clock rolls into the next one.
    const hour = this.debugHour != null ? this.debugHour : (() => {
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60;
    })();
    const tod = timeOfDay(hour);
    const lines = npcLinesFor(npc, hour);
    if (target._lineTod !== tod) { target._lineTod = tod; target._lineIdx = 0; }
    else target._lineIdx = (target._lineIdx == null ? 0 : target._lineIdx + 1);
    const line = lines[target._lineIdx % lines.length];
    this._npcChat = { target };
    // the hero walks up and squares off with them as the bubble opens (driven
    // per-frame in _updateTalkApproach — runs even while the dialogue is up)
    this._talkApproach = { target, t: 0, stopDist: 1.15 };
    track("npc_talk", { npc: npc.id, personality: npc.personality });
    this.audio.pickup?.();
    this.hud.speak({
      name: npc.name,
      portrait: portraitDataURL(npc.variant, "left"),
      text: line,
      cta: "▸ close",
      onAdvance: () => this._endNpcChat(),
    });
  },

  _endNpcChat() {
    const s = this._npcChat;
    if (s && s.target) s.target.chatting = false;
    this._npcChat = null;
    this._talkApproach = null;
    this.hud.hideSpeak();
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
  // talking. The body auto-animates from its own position delta.
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
        c.heading = Math.atan2(this.player.position.x - c.position.x, this.player.position.z - c.position.z);
        break;
      // "idle": hold the pose
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
