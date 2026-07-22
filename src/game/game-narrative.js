// The first-run FTUE ("What He Left") + the Mayor's post-FTUE cameo. Attached
// to Game.prototype via Object.assign, so `this` is the live Game instance.
//
// The old shopkeeper's only kin inherited his shop, and the road to it ends
// at a cave: the heir wakes at its deep end (the scripted slime opener),
// walks out into the daylight with a full pack, finds the shop shut — and
// opens it with the key that came with the will. Nobody welcomes them:
// Morel barges in wanting mushrooms before the second step lands, and the
// loop is taught in the order you live it — dive the pit (rats only, the
// way deeper sealed), gather the basket full, trade it for the shop's first
// shelf, lay a mushroom out, and take the send-off back to the cave. Steps:
//   exit → shop → fetch → forage → trade → stock → delve
// The Mayor exists but stays out of the FTUE — his first appearance is the
// praise visit after the player funds their first ruin rebuild.
import * as THREE from "three";
import { BlockyCreature } from "../chargen/blocky.js";
import { portraitDataURL } from "../chargen/portrait.js";
import { icon, itemIcon } from "../core/icons.js";
import { ITEMS } from "./items.js";
import { SHOP } from "./shop-data.js";
import { morelWalk } from "./morel.js";
import { DUNGEON_ORIGIN } from "./dungeon-data.js";
import { npcLinesFor, timeOfDay, npcReflectionLine, npcIntroLines, npcWishLine, activeOccasion, npcOccasionLine, npcDeedLine } from "./npc-data.js";
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
// Scene 3 — the shopfront won't open, and the heir came prepared: one bubble,
// then the key that came with the will turns. Nobody has to hand over
// anything.
const PLAYER_DOOR_LINE = "Time to use the key that uncle left me.";
// Scene 4 — the uncle's letter on the counter: the shop loop and the reason
// to care. Morel waits until both lines have been read before barging in.
const LETTER_LINES = [
  "Fill the tables and townsfolk will come to buy.",
  "They're nice people. The town just needs fixing up.",
];
// Once the letter is finished, Morel arrives with the first concrete order.
const MOREL_INTRO_ORDER = "Finally, you're open! One basket of mushrooms, please.";
const PLAYER_INTRO_LINE = "I... JUST got here.";
const MOREL_INTRO_JOB = "the old keeper got them in the cave. Your job now!";
const MOREL_REMINDER_LINE = "Your uncle would be in the cave already...";
// Scene 6 — the trade: the basket lands, and Morel pays the only way he
// knows how (coin jingles; jingling wakes the dog).
const MOREL_TRADE_LINES = [
  "THERE they are! Oh, the knobbly ones!",
  "I don't have any coin but I can give you this table in exchange",
];
// …and his sign-off once the first item hits the shelf: he explains the sale
// loop, then establishes himself as the shelf fellow (see _morelPrompt).
const MOREL_STOCKED_LINES = [
  "People may buy what you put on there!",
  "Come see me if you need more of them",
];
// The optional epilogue: the player rebuilt their first home, the Mayor drops by
const MAYOR_PRAISE_LINES = [
  "Ha! A family already — would you look at that.",
  "Every roof you raise brings more custom through your door.",
];

const TUT_ORDER = ["exit", "shop", "fetch", "forage", "trade", "stock", "delve"];
// Morel's order: how many mushrooms (either kind) fill the basket
const BASKET_SIZE = 3;

// Which player deed is the bigger news when two land close together: a boss
// kill always trumps a mere new-depth push (see recordPlayerDeed).
const DEED_PRIORITY = { newDepth: 1, bossFelled: 2 };

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
    this._letterSpawned = false; // the uncle's letter waits on the counter
    this._letterPicked = false;
    this._letterRead = false; // Morel enters only after the player finishes it
    this._morelIntroDone = false; // Morel barges in on the first step inside
    this._morelTradeDone = false; // …and takes his basket exactly once
    // Morel does not wait conspicuously outside the inherited shop. He first
    // appears just inside its door when the letter has been read.
    if (this.shop.morel?.creature) this.shop.morel.creature.visible = false;
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
  // the shopfront, the first step inside (Morel!), and walking the full
  // basket back up to him. (The cave's daylight walk-out is generic travel
  // now — see _exitCave / _onFtueCaveExit.)
  _updateFtue() {
    if (!this.tutorial || this.net.connected || this._cine || this.hud.speakOpen) return;
    // Make the letter unmistakable while it is the current objective.
    if (this._letterProp) {
      const k = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 7.4);
      this._letterProp.mesh.scale.setScalar(1 + 0.18 * k);
      this._letterProp.paperMats.forEach((mat) =>
        mat.color.setRGB(1, 0.87 - 0.12 * k, 0.58 - 0.2 * k));
    }
    const p = this.player.position;
    // is the player inside the shop's footprint? (the town is rotated a
    // quarter-turn, so the rect is D wide in x and W deep in z; measured
    // against the live origin so a relocated shop still trips the trigger)
    const o = this.shop.shopOrigin;
    const inside = this.playerArea === "shop" &&
      Math.abs(p.x - o.x) < SHOP.D / 2 && Math.abs(p.z - o.z) < SHOP.W / 2;
    switch (this.tutorial) {
      case "shop":
        // fires only right on the door step (the shut door stops the player
        // ~0.65 out, so 0.9 means walking straight up to it on purpose — the
        // scene shouldn't trip from halfway across the street)
        if (!this._doorScene && this.playerArea === "shop" && p.distanceTo(this.shop.doorPos) < 0.9)
          this._shopDoorScene();
        break;
      case "fetch":
        // The first step inside reveals the uncle's letter on the counter.
        // Morel waits outside until the player walks over and picks it up.
        if (!inside || this._morelIntroDone) break;
        if (!this._letterSpawned) this._spawnLetterProp();
        if (this._letterProp && !this._letterPicked &&
            p.distanceTo(_v.copy(this._letterProp.pos).setY(0)) < 1.2)
          this._pickUpLetter();
        break;
      case "trade": {
        // (safety: a player who somehow skipped the intro gets it now)
        if (!this._morelIntroDone) {
          if (inside) this._morelIntroScene();
          break;
        }
        const m = this.shop.morel;
        if (!this._morelTradeDone && m?.creature && this.playerArea === "shop" &&
            p.distanceTo(m.creature.position) < 1.6)
          this._morelTradeScene();
        break;
      }
    }
  },

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      exit: `${icon("bag")} Pack's ready — head for the daylight`,
      shop: `${icon("shop")} Head down the road and take a look at the shop`,
      // the fetch step is three beats: enter, take the letter, hear the errand
      fetch: this._morelIntroDone
        ? `${icon("hole")} Morel wants mushrooms — the cave pit is the way down`
        : this._letterSpawned
          ? `${icon("scroll")} Pick up uncle's letter from the counter`
          : `${icon("shop")} Step inside`,
      forage: `${icon("bag")} Walk through mushrooms till the basket's full (${BASKET_SIZE})`,
      trade: `${icon("shop")} Bring Morel his mushrooms`,
      stock: `${icon("box")} Put an item on the shelf`,
      delve: `${icon("hole")} Dive deeper for better goods`,
    };
    if (hints[this.tutorial]) this.hud.toast(hints[this.tutorial]);
  },

  // Called at each loop milestone with the step it completes; advances (and
  // re-hints) only if that's the step we're currently waiting on.
  _tutAdvance(step) {
    if (this.tutorial !== step) return;
    this.tutorial = TUT_ORDER[TUT_ORDER.indexOf(step) + 1] || null;
    track("ftue_step", { step, day: this.day, gold: this.gold });
    // advancing past the last step (the send-off's real dive) ends the FTUE
    if (!this.tutorial) track("ftue_completed", { day: this.day, gold: this.gold });
    // the first item just hit the shelf — Morel explains what happens next,
    // reminds the player where more shelves come from, and sees himself out.
    // A beat later his promise comes true: a villager wanders
    // in and buys the stocked mushroom at sticker price, no words (the
    // scripted shopper always commits — see shop-customers).
    if (this.tutorial === "delve") {
      const m = this.shop.morel;
      this.shop.doorHeld = true; // hold the shopfront open for his exit
      setTimeout(() => this._speakLines(m?.npc.name ?? "Morel", m?.portrait, MOREL_STOCKED_LINES, () => {
        if (m) morelWalk(this.shop, [this.shop.doorInside, this.shop.doorPos, ...m.returnPath], () => {
          this.shop.doorHeld = false;
        });
        if (!this.net.connected) setTimeout(() => this.shop.spawnScriptedCustomer(), 3500);
      }), 600);
    }
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
  },

  // Where the FTUE guide arrow should point right now. Re-resolved every frame
  // so it tracks moving targets (the Mayor, customers, drops) and area changes;
  // the arrow itself lives in the HUD (hud.guide) and clamps to the screen edge
  // when the objective is out of view.
  _updateTutGuide() {
    // arrows wait their turn: never on screen with a dialogue bubble or a
    // sheet, and the frozen bag beats hand the stage to the bag arrow instead
    if (this.gameOver || this.hud.sheetOpen || this.hud.speakOpen ||
        this._ftueFreeze || this._respawnT >= 0 || this._cine)
      return this.hud.hideGuide();
    // outside the FTUE, the one standing guide is the way the fallen boss
    // opened: point at the stairs it leaves behind (same bouncing arrow) until
    // the delver takes them (descending regenerates the floor, clearing it).
    if (!this.tutorial) {
      const bs = this.dungeon.bossStairs;
      if (this.playerArea === "dungeon" && this.dungeon.active && bs) {
        return this.hud.guide(_v.copy(bs.pos).setY(1.4), bs.descend ? "Descend — the way deeper" : "The way home");
      }
      return this.hud.hideGuide();
    }
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
      case "fetch":
        // Step inside, take the counter letter, then follow Morel's errand down
        // the road and into the pit. Completes on descent (see _enterHole).
        if (!this._morelIntroDone) {
          if (!this._letterSpawned) {
            if (inShop) { pos = _v.copy(this.shop.doorInside); text = "Step inside"; }
          } else if (!this._letterPicked && this._letterProp) {
            pos = _v.copy(this._letterProp.pos).setY(0);
            text = "Pick up the letter";
          }
          break;
        }
        if (inShop && this.shop.caveMouthPos) {
          pos = _v.copy(this.shop.caveMouthPos);
          text = "Get mushrooms in the cave";
        } else if (this.playerArea === "cave") {
          pos = _v.copy(this.cave.descentPos);
          text = "Get mushrooms in the cave";
        }
        break;
      case "forage": {
        // underground: fill the basket, crack the chest, take the stairs
        // home. Above ground short a mushroom (climbed out early), the
        // arrows point back down the pit.
        if (this.playerArea !== "dungeon" || !this.dungeon.active) {
          if (inShop && this.shop.caveMouthPos) { pos = _v.copy(this.shop.caveMouthPos); text = ""; }
          else if (this.playerArea === "cave") { pos = _v.copy(this.cave.descentPos); text = ""; }
          break;
        }
        const basket = this._ftueBasket();
        if (basket < BASKET_SIZE) {
          const shroom = this._nearestFtueShroom();
          if (shroom) {
            pos = _v.set(shroom.wx, 0, shroom.wz);
            text = `Gather the mushrooms  ${basket}/${BASKET_SIZE}`;
            break;
          }
        }
        const chest = this.dungeon.chests.find((c) => !c.opened);
        if (chest && basket < BASKET_SIZE + 1) {
          pos = _v.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
          text = "Crack the chest";
          break;
        }
        if (basket >= BASKET_SIZE) {
          pos = _v.copy(this.dungeon.upStairsPos).add(DUNGEON_ORIGIN);
          text = "Back to shop";
        }
        break;
      }
      case "trade": {
        // ate one on the walk home? the basket's short — back down the pit
        if (this._ftueBasket() < BASKET_SIZE) {
          if (inShop && this.shop.caveMouthPos) { pos = _v.copy(this.shop.caveMouthPos); text = ""; }
          else if (this.playerArea === "cave") { pos = _v.copy(this.cave.descentPos); text = ""; }
          break;
        }
        const m = this.shop.morel;
        if (inShop && m?.creature) { pos = _v.copy(m.creature.position); text = "Give mushrooms to Morel"; }
        else if (this.playerArea === "cave") { pos = _v.copy(this.cave.exitPos); text = "Back to shop"; }
        break;
      }
      case "stock": {
        if (!inShop || !this.stash.length) break; // nothing to place — no target
        const slot = this.shop.freeSlot();
        if (slot) { pos = _v.copy(slot.pos).setY(0); text = "Put an item on the shelf"; }
        break;
      }
      case "delve":
        // the send-off: point down the road at the cave mouth, then — once
        // inside — at the descent pit itself. Completes on the first descent.
        if (inShop && this.shop.caveMouthPos) {
          pos = _v.copy(this.shop.caveMouthPos);
          text = "Dive deeper for better goods";
        } else if (this.playerArea === "cave") {
          pos = _v.copy(this.cave.descentPos);
          text = "Dive deeper for better goods";
        }
        break;
    }
    if (pos) this.hud.guide(pos.setY(1.4), text);
    else this.hud.hideGuide();
  },

  // ---- scene transitions ------------------------------------------------------
  // The FTUE's first walk into the daylight (called by _exitCave): the banner
  // and the step advance. The guide arrow carries the player on to the shop.
  _onFtueCaveExit() {
    this.hud.banner(`${icon("home")} The end of the road`, "", 2.2);
    this._tutAdvance("exit");
  },

  // Scene 3, at the shopfront: the door won't open — the hero already holds
  // the answer, but the player has to reach into the bag for it themselves.
  // The line plays, then the bag pulses with an arrow and the hero stays
  // rooted on the step until the key is used (see _useShopKey).
  _shopDoorScene() {
    this._doorScene = true;
    this.audio.deny();
    this._ftueFreeze = true;
    this._selfSay([PLAYER_DOOR_LINE], () => this.hud.bagAttention("Open backpack"));
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

  // Put the uncle's letter on the clear centre of the counter. This restores
  // the old FTUE note prop without depending on a display slot: Morel's version
  // of the opening deliberately starts with every shelf unbuilt.
  _spawnLetterProp() {
    if (this._letterProp || !this.shop.counterLetterPos) return;
    const letter = new THREE.Group();
    const paper = new THREE.MeshBasicMaterial({ color: 0xf3ddb0 });
    const fold = new THREE.MeshBasicMaterial({ color: 0xc79f68 });
    const wax = new THREE.MeshBasicMaterial({ color: 0xa83232 });

    // A thick paper envelope, built from primitives so it reads from the high
    // gameplay camera instead of disappearing into the benchtop like a plane.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.48), paper);
    letter.add(body);

    // Two inset diagonal seams imply the closed triangular flap. Keeping the
    // seams inside the rectangular silhouette avoids the old triangle primitive
    // poking out of the envelope when viewed from the gameplay camera.
    for (const side of [-1, 1]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.018), fold);
      seam.position.set(side * 0.17, 0.026, -0.065);
      seam.rotation.y = side * 0.65;
      letter.add(seam);
    }

    // Red wax seal at the flap's point.
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.028, 12), wax);
    seal.position.set(0, 0.045, 0.065);
    letter.add(seal);

    letter.rotation.y = 0.35;
    letter.position.copy(this.shop.counterLetterPos);
    this.shop.group.add(letter);
    this._letterProp = {
      mesh: letter,
      pos: this.shop.counterLetterPos.clone(),
      paperMats: [paper, fold],
    };
    this._letterSpawned = true;
  },

  _removeLetterProp() {
    if (!this._letterProp) return;
    this.shop.group.remove(this._letterProp.mesh);
    this._letterProp.mesh.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    this._letterProp = null;
  },

  // Reaching the counter takes the letter with the usual pickup flourish.
  // It lands at the top of the bag and roots the player until they read it.
  _pickUpLetter() {
    if (!this._letterProp || this._letterPicked) return;
    this._letterPicked = true;
    const at = this._letterProp.pos.clone();
    this._removeLetterProp();
    this.inventory.unshift("unclenote");
    this._syncInv();
    this.audio.pickup();
    const it = ITEMS.unclenote;
    this.hud.float(_v.copy(at).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
    this.hud.flyToBag(_v.copy(at).setY(0.9), itemIcon(it.icon));
    this._ftueFreeze = true;
    this.hud.bagAttention();
  },

  // The bag's Read action plays every letter bubble. Only after the final
  // bubble is dismissed is the letter consumed and Morel allowed through.
  _readLetter() {
    if (!this._letterPicked || this._letterRead) return;
    this.hud.hideSheet();
    this.hud.clearBagAttention();
    this._sceneCam = true;
    this._speakLines("The Letter", "characters/uncle-portrait.png", LETTER_LINES, () => {
      this._letterRead = true;
      const i = this.inventory.indexOf("unclenote");
      if (i !== -1) this.inventory.splice(i, 1);
      this._syncInv();
      this._sceneCam = false;
      this._morelIntroScene();
    });
  },

  // Scene 4, the empty shop: once the heir finishes the counter letter, Morel
  // appears just inside the door, walks right up to them, and orders mushrooms.
  _morelIntroScene() {
    const m = this.shop.morel;
    if (!m || !this._letterRead || this._morelIntroDone) return;
    this._morelIntroDone = true;
    this._ftueFreeze = true; // rooted while Morel makes his entrance
    this._sceneCam = true; // eye level for the whole barge-in, no cam bouncing
    const inward = _v.copy(this.shop.doorInside).sub(this.shop.doorPos).setY(0).normalize();
    m.creature.position.copy(this.shop.doorInside).addScaledVector(inward, 0.55);
    m.creature.visible = true;
    // Stop less than a stride away, on the door side of the player.
    const towardDoor = _v.copy(m.creature.position).sub(this.player.position).setY(0);
    const spot = this.player.position.clone().addScaledVector(
      towardDoor.lengthSq() > 0.01 ? towardDoor.normalize() : towardDoor.set(0, 0, 1),
      0.95);
    morelWalk(this.shop, [spot], () => {
      m.state = "talk";
      // Square both characters toward one another before the first bubble opens.
      m.creature.heading = Math.atan2(
        this.player.position.x - m.creature.position.x,
        this.player.position.z - m.creature.position.z);
      this.player.heading = Math.atan2(
        m.creature.position.x - this.player.position.x,
        m.creature.position.z - this.player.position.z);
      this._speakLines(m.npc.name, m.portrait, [MOREL_INTRO_ORDER], () =>
        this._selfSay([PLAYER_INTRO_LINE], () =>
          this._speakLines(m.npc.name, m.portrait, [MOREL_INTRO_JOB], () => {
            m.state = "idle"; // he waits right here — very good at waiting
            this._sceneCam = false;
            this._ftueFreeze = false;
            this._tutHint();
          })));
    });
  },

  // Scene 6, the trade: walking the full basket up to Morel hands it over —
  // three mushrooms out of the bag, and his payment lands with a THUNK: the
  // shop's first shelf. The rest of the haul slides to the storeroom so the
  // stock beat has something to lay out.
  _morelTradeScene() {
    const m = this.shop.morel;
    if (!m || this._morelTradeDone) return;
    if (this._ftueBasket() < BASKET_SIZE) return; // short — arrows point back down
    this._morelTradeDone = true;
    this._ftueFreeze = true;
    this._sceneCam = true;
    m.state = "talk";
    // the basket leaves the bag
    let need = BASKET_SIZE;
    for (let i = this.inventory.length - 1; i >= 0 && need > 0; i--) {
      const id = this.inventory[i];
      if (id === "mushroom" || id === "caveshroom") {
        this.inventory.splice(i, 1);
        need--;
      }
    }
    this._syncInv();
    this.audio.pickup();
    this.hud.float(_v.copy(m.creature.position).setY(1.5), `${itemIcon(ITEMS.mushroom.icon)} ×${BASKET_SIZE}`, "loot");
    this._speakLines(m.npc.name, m.portrait, MOREL_TRADE_LINES, () => {
      // THUNK — the first shelf lands (repairTable brings its own chest-thunk
      // + shake), plus a puff of sawdust where it settles
      this.shop.repairTable(0);
      this.tablesRepaired[0] = true;
      this._syncTables();
      const t = this.shop.tables[0];
      if (t) this.particles.burst(_v.copy(t.group.position).setY(0.6), { color: 0xcaa46a, n: 14, speed: 2.8, up: 1.6, gravity: 4, life: 0.55, size: 0.8 });
      this._depositBag();
      this._sceneCam = false;
      this._ftueFreeze = false;
      this._tutAdvance("trade");
    });
  },

  // The mushroom order stays conversational: speaking to Morel before it is
  // fulfilled always gets the same impatient nudge, however often he is asked.
  _morelReminder() {
    const m = this.shop.morel;
    if (!m || !this._morelIntroDone) return;
    this._beginNpcPrompt(m);
    m.state = "talk";
    this.player.heading = Math.atan2(
      m.creature.position.x - this.player.position.x,
      m.creature.position.z - this.player.position.z);
    this._speakLines(m.npc.name, m.portrait, [MOREL_REMINDER_LINE], () => {
      m.state = "idle";
    });
  },

  // Post-FTUE, Morel is the shelf fellow: talking to him at his patch offers
  // the next unbuilt table (cheapest first — the vitrine last) with the same
  // pay/not-now choice as the builder. All built → a proud brush-off.
  _morelPrompt() {
    const m = this.shop.morel;
    if (!m) return;
    this._beginNpcPrompt(m);
    let idx = -1, best = Infinity;
    this.shop.tables.forEach((t, i) => {
      if (!t.repaired && t.cost < best) { best = t.cost; idx = i; }
    });
    if (idx < 0) {
      return this._speakLines(m.npc.name, m.portrait, ["Not a shelf left in my cart. Fine shop you've built!"]);
    }
    const table = this.shop.tables[idx];
    const what = table.fancy ? "a fancy glass case" : "another shelf";
    this.audio.pickup?.();
    this.hud.speak({
      name: m.npc.name, portrait: m.portrait,
      text: `I've got ${what} in the cart. ${table.cost}g and it's yours.`,
      choices: [
        { label: `${icon("coin")} Pay ${table.cost}g`, fn: () => {
          this.hud.hideSpeak();
          if (this.gold < table.cost) {
            this.audio.deny();
            return this._speakLines(m.npc.name, m.portrait, [
              `You don't have enough coin. Come back when you have ${table.cost}g.`,
            ]);
          }
          this._repairTable(idx);
        } },
        { label: "Not now", fn: () => this.hud.hideSpeak() },
      ],
    });
  },

  // How many of Morel's mushrooms (either kind) ride in the bag right now.
  _ftueBasket() {
    return this.inventory.reduce((n, id) => n + (id === "mushroom" || id === "caveshroom" ? 1 : 0), 0);
  },

  // The closest uncollected mushroom cluster on the FTUE forage floor — the
  // guide arrow's target while the basket wants filling.
  _nearestFtueShroom() {
    let bestD = Infinity, best = null;
    const p = this.player.position;
    for (const d of this.dungeon.decor) {
      if (d.cat !== "mushrooms") continue;
      const dist = Math.hypot(d.wx - p.x, d.wz - p.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  },

  // Which story action a quest prop offers in the bag right now, if any
  // (rendered by _openBagSheet in place of the usual Use/Drop pair).
  _questBagAction(id) {
    if (id === "shopkey" && this._doorScene && this.tutorial === "shop")
      return { label: "Use", fn: () => this._useShopKey() };
    if (id === "unclenote" && this._letterPicked && !this._letterRead)
      return { label: "Read", fn: () => this._readLetter() };
    return null;
  },

  // ---- the Mayor (post-FTUE only) --------------------------------------------
  // The Mayor's body, created on the spot if a scene needs him and he isn't
  // already on stage.
  _ensureMayor(pos) {
    if (this._mayor) return this._mayor;
    this.shop.holdVariantForCameo(MAYOR_VARIANT); // pull any roaming Mayor so there's only one
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
    this.shop.releaseCameoVariant(MAYOR_VARIANT); // he can rejoin the ambient crowd
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

  // The hero thinking out loud — same dialogue bar, the player's own bust. The
  // camera glides down to the same intimate eye-level framing as a chat, since
  // the hero's alone with their thoughts (see _dialogueCamTarget / _selfCam).
  _selfSay(lines, onDone) {
    this._selfCam = true;
    this._speakLines("Me", portraitDataURL(this.player.variant ?? "a", "left"), lines, () => {
      this._selfCam = false;
      onDone?.();
    });
  },

  // ---- purchase reflections -------------------------------------------------
  // Note what a townsperson made of their visit so they can mention it the next
  // time you chat. `bucket` is one of the REFLECTION_BUCKETS ids; `itemId` fills
  // the {item} placeholder in their line (omitted for "nothing caught my eye").
  // Keyed by npc id, so it follows the person, not the transient customer body.
  recordNpcReflection(npc, bucket, itemId) {
    if (!npc?.id || !bucket) return;
    this._npcMemory.set(npc.id, { bucket, itemId: itemId || null, itemName: itemId ? (ITEMS[itemId]?.name || "") : "" });
  },

  // Consume a townsperson's pending reflection (if any), returning the spoken
  // line with {item} filled in — a bespoke item-specific reaction where one
  // exists, else their generic line. One-shot: cleared as it's read.
  _takeNpcReflection(npc) {
    const mem = this._npcMemory?.get(npc?.id);
    if (!mem) return null;
    this._npcMemory.delete(npc.id);
    return npcReflectionLine(npc, mem.bucket, mem.itemId, mem.itemName);
  },

  // ---- chatting with the townsfolk ------------------------------------------
  // Purchase/job prompts are still NPC conversations even though they don't use
  // the ambient chatter path. Register their speaker as the active chat target
  // so the shared dialogue camera frames the same player/NPC two-shot.
  _beginNpcPrompt(target) {
    if (!target?.creature) return;
    target.creature.getWorldPosition(_v);
    target.creature.heading = Math.atan2(
      this.player.position.x - _v.x,
      this.player.position.z - _v.z);
    this.player.heading = Math.atan2(
      _v.x - this.player.position.x,
      _v.z - this.player.position.z);
    target.chatting = true;
    this._npcChat = { target };
  },

  // Strike up a conversation with a shopper or passer-by. Their body pauses and
  // faces the player (see shop-customers: the `chatting` flag), and the dialogue
  // bar shows their name and a single line — a fresh one each time you talk,
  // cycling through their five. Advancing closes it.
  _talkToNpc(target) {
    if (!target || !target.npc || this._npcChat) return;
    const npc = target.npc;
    const c = target.creature;
    // world position: the dojo master is nested in the positioned dojo group,
    // so his local .position is dojo-relative (see _nearestTalkNpc)
    c.getWorldPosition(_v);
    c.heading = Math.atan2(this.player.position.x - _v.x, this.player.position.z - _v.z);
    target.chatting = true;
    this._npcChat = { target };
    // the hero walks up and squares off with them as the bubble opens (driven
    // per-frame in _updateTalkApproach — runs even while the dialogue is up)
    this._talkApproach = { target, t: 0, stopDist: 1.15 };
    const firstMeeting = !this._npcMet.has(npc.id);
    track("npc_talk", { npc: npc.id, personality: npc.personality, firstMeeting });
    this.audio.pickup?.();
    // the very first chat with someone: they clock the new face and introduce
    // themselves before any small talk. Marked (and saved) so it never repeats,
    // and any pending shopping reflection is left for the next, ordinary chat.
    const intro = firstMeeting ? npcIntroLines(npc) : [];
    if (intro.length) {
      this._npcMet.add(npc.id);
      this._save();
      return this._npcSayLines(npc, intro);
    }
    if (firstMeeting) this._npcMet.add(npc.id); // no intro line for them, but they've now been met
    // biggest news first: if the player just pulled off something notable
    // underground (felled a boss, hit a new deepest floor), the townsfolk lead
    // with it — one reaction per person per deed (see _takeNpcDeed)
    const deed = this._takeNpcDeed(npc);
    if (deed) return this._npcSayLines(npc, [deed]);
    // small talk keyed to the town's day/night clock: pick the bucket for the
    // current hour (admin can pin it via debugHour), then cycle its five lines.
    // A per-bucket line index keeps the greeting fresh within a time of day and
    // resets when the clock rolls into the next one.
    const hour = this.debugHour != null ? this.debugHour : (() => {
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60;
    })();
    const tod = timeOfDay(hour);
    // if they've been shopping since you last spoke, they lead with why they
    // bought (or didn't buy) what they did — a one-off reflection that's cleared
    // as it's spoken, so the next chat falls back to ordinary time-of-day chatter
    const reflection = this._takeNpcReflection(npc);
    const lines = npcLinesFor(npc, hour);
    if (target._lineTod !== tod) { target._lineTod = tod; target._lineIdx = 0; }
    else target._lineIdx = (target._lineIdx == null ? 0 : target._lineIdx + 1);
    // after a shopping trip they reflect on it, then follow up with a hint at
    // what tempts them (see npcWishLine) so the player learns what to stock
    if (reflection) {
      const wish = npcWishLine(npc);
      return this._npcSayLines(npc, wish ? [reflection, wish] : [reflection]);
    }
    // on a notable calendar day (a holiday, or the day-of-the-week flavour) the
    // very first chat with someone leads with an occasion greeting; after that,
    // and on ordinary days, they fall back to the usual time-of-day small talk.
    const occId = this.debugOccasion !== undefined && this.debugOccasion !== null
      ? this.debugOccasion
      : activeOccasion()?.id || null;
    if (occId && target._occGreeted !== occId) {
      const occLine = npcOccasionLine(npc, occId);
      if (occLine) {
        target._occGreeted = occId;
        return this._npcSayLines(npc, [occLine]);
      }
    }
    const line = lines[target._lineIdx % lines.length];
    this._npcSayLines(npc, [line]);
  },

  // Record a fresh player deed for the townsfolk to gossip about — felling a
  // boss, reaching a new deepest floor, etc. Keyed by the current run day so it
  // goes stale after the trip home; `data` carries the {boss}/{place}/{floor}
  // context the lines fill in. Only the latest, biggest news survives: a fresh
  // higher-priority deed (a boss kill) is never bumped by a lesser one (a new
  // depth) on the same run, so a descent right after a kill doesn't bury it.
  recordPlayerDeed(id, data = {}) {
    if (!id) return;
    const prev = this._recentDeed;
    if (prev && this.day - prev.day <= 1 && (DEED_PRIORITY[prev.id] || 0) > (DEED_PRIORITY[id] || 0)) return;
    this._recentDeed = { id, day: this.day, reactedBy: new Set(), ...data };
  },

  // Consume this townsperson's reaction to the latest deed, if there's one they
  // haven't already remarked on and it's still fresh (this run day, or the next
  // one). One-shot per person: each resident mentions a given deed only once,
  // then falls back to ordinary chatter.
  _takeNpcDeed(npc) {
    const d = this._recentDeed;
    if (!d || !npc?.id) return null;
    if (this.day - d.day > 1) { this._recentDeed = null; return null; }
    if (d.reactedBy.has(npc.id)) return null;
    d.reactedBy.add(npc.id);
    return npcDeedLine(npc, d.id, d);
  },

  // Cycle one or more bubbles through the dialogue bar in a townsperson's voice,
  // closing the chat when the last is dismissed. Used for both the one-off
  // first-meeting intro and ordinary single-line small talk.
  _npcSayLines(npc, lines) {
    let i = 0;
    const step = () => {
      if (i >= lines.length) return this._endNpcChat();
      const last = i === lines.length - 1;
      this.hud.speak({
        name: npc.name,
        portrait: portraitDataURL(npc.variant, "left"),
        text: lines[i],
        cta: last ? "▸ close" : "▸ next",
        onAdvance: () => { i++; step(); },
      });
    };
    step();
  },

  _endNpcChat() {
    const s = this._npcChat;
    if (s && s.target) s.target.chatting = false;
    this._npcChat = null;
    this._talkApproach = null;
    this.hud.hideSpeak();
  },

  // ---- the town builder ------------------------------------------------------
  // Hire the foreman by the ruined row: he offers to raise a house on the
  // cheapest run-down lot, justified by the extra custom a new family brings.
  // Uses the same in-world dialogue bar as every other townsperson, with one
  // reply that asks whether to pay; then he walks over and builds it (see
  // builder.js + game-economy _dispatchBuilder).
  _builderPrompt() {
    const b = this.shop && this.shop.builder;
    if (!b) return;
    this._beginNpcPrompt(b);
    const name = b.npc?.name ?? "The Builder";
    // busy mid-job → a quick line rather than the offer
    if (b.state !== "idle") {
      return this._speakLines(name, b.portrait, ["Can't stop now — this one's not done yet!"]);
    }
    // the cheapest lot not yet paid for (townRestored flips the moment it's paid)
    let idx = -1, best = Infinity;
    this.shop.lots.forEach((lot, i) => {
      if (this.townRestored[i] || lot.restored) return;
      if (lot.cost < best) { best = lot.cost; idx = i; }
    });
    if (idx < 0) {
      return this._speakLines(name, b.portrait, ["Whole street's standing tall now — grand work, eh?"]);
    }
    const lot = this.shop.lots[idx];
    const what = lot.kind === "ruin" ? "that old ruin" : "that empty plot";
    const line1 = `Pay for the timber on ${what} and I'll raise a proper home on it.`;
    const line2 = "More families in town means more folk through your shop door.";
    // can't afford it yet → just the pitch and a nudge to come back with the gold
    if (this.gold < lot.cost) {
      return this._speakLines(name, b.portrait, [line1, line2, `Come back when you've saved ${lot.cost}g.`]);
    }
    const askToPay = (text) => {
      this.audio.pickup?.();
      this.hud.speak({
        name, portrait: b.portrait, text,
        choices: [
          { label: `${icon("coin")} Pay ${lot.cost}g`, fn: () => { this.hud.hideSpeak(); this._dispatchBuilder(idx); } },
          { label: "Not now", fn: () => this.hud.hideSpeak() },
        ],
      });
    };
    // the full two-bubble pitch plays once; after that he cuts straight to the ask
    if (b.pitched) return askToPay(line1);
    b.pitched = true;
    this.audio.pickup?.();
    this.hud.speak({
      name, portrait: b.portrait, text: line1, cta: "▸ next",
      onAdvance: () => askToPay(line2),
    });
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
    this.shop.holdVariantForCameo(CLERK_VARIANT); // pull any roaming Clerk so there's only one
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
    this.shop.releaseCameoVariant(CLERK_VARIANT); // he can rejoin the ambient crowd
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
