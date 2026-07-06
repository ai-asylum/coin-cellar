// Game director: player, day/night cycle, debt schedule, area transitions,
// combat glue, economy, co-op message handling. The Recettear loop:
//   morning — stock the tables, open the doors
//   day     — haggle ("capitalism, ho!"), or let your partner keep shop
//   night   — delve the dungeon below for tomorrow's merchandise
//   pay the Guild every 3rd day or lose the shop.
import * as THREE from "three";
import { rng, pick, clamp, lerp } from "../core/engine.js";
import { BlockyCreature } from "../chargen/blocky.js";
import { Shop, SHOP } from "./shop.js";
import { Dungeon, DUNGEON_ORIGIN, MAX_FLOORS } from "./dungeon.js";
import { ITEMS, itemSprite, swordMesh } from "./items.js";
import { Particles } from "./particles.js";
import { SlashArc } from "./slash.js";
import { Coop } from "../net/coop.js";
import { icon, itemIcon } from "../core/icons.js";

const DAY_LEN = 160;
const UNSEAL_FEE = 100; // what the Guild charges to unseal the cellar for a second delve
// The day runs on action points, not a wall clock: each errand (opening the
// doors for a rush, heading down the cellar) burns one AP and slides the sun
// a third of the way across the dial. Out of AP = dusk.
const AP_PER_DAY = 3;
const AP_DRAIN_SECS = 4; // how long the sun takes to glide through one AP's arc
const DEBT = [
  { day: 3, amt: 180 },
  { day: 6, amt: 450 },
  { day: 9, amt: 1100 },
  { day: 12, amt: 2400 },
  { day: 15, amt: 5200 },
];
// New shopkeepers start with an empty bag on purpose: bare shelves push
// them straight down the trapdoor to earn their first stock (see _tutStart).
const START_INV = [];
const SAVE_KEY = "coincellar_save_v1";
const LEVEL_INVULN = 1.8; // damage-immunity grace when arriving on a new floor

export class Game {
  constructor(engine, input, audio, hud) {
    this.engine = engine;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.net = new Coop(this);
    this.particles = new Particles(engine.scene);
    this.slash = new SlashArc(engine.scene);

    // --- state
    this.day = 1;
    this.phase = "day";
    this.dayT = DAY_LEN;
    this.ap = AP_PER_DAY; // errands left today — the sun tracks these, not a clock
    this.gold = 100;
    this.debtIdx = 0;
    // one cellar run a day: set the moment you drop down, sealed till morning
    this.delvedToday = false;
    this.inventory = [...START_INV];
    this.invCap = 10;
    // the shop storeroom: loot hauled up from the cellar lands here, and the
    // display tables are stocked from it. Unlimited — only the bag is capped.
    this.stash = [];
    this.hp = 6;
    this.maxHp = 6;
    this.combo = 0;
    this.gameOver = false;
    this.victory = false;
    this.playerArea = "shop";
    this._invulnT = 0;
    this._pendingHit = -1;
    this._pendingHitOpts = null;
    // melee combo + crits
    this._comboStep = 0;
    this._comboT = 0;
    this._critChance = 0.18;
    // dodge roll
    this._dodgeCd = 0;
    this._dashT = -1;
    this._dashDur = 0.24;
    this._dashSpeed = 13;
    this._dashDX = 0;
    this._dashDZ = 0;
    this._respawnT = -1;
    this._pickupSuppressT = 0;
    this._useFx = []; // in-flight "used an item" flourishes over the player's head
    this.godMode = false;
    this._adminOpen = false;
    this.paused = false;
    this._escOpen = false;
    this._autoDealCd = 0; // brief breather between auto-opened haggles
    this.tutorial = null; // first-run onboarding step (see _tutStart); null once done
    this._hadSave = false; // set by _load — suppresses the tutorial for returning players

    this._load();

    // running tally for the "good night" recap — reset each morning
    this.today = this._freshDayStats();

    // --- world
    this.shop = new Shop(this);
    this.dungeon = new Dungeon(this);

    // --- player
    this.player = new BlockyCreature("a", { height: 1.3 });
    this.player.position.set(0, 0, 2.5);
    this.player.holdItem(swordMesh(0xd7dde6, 0x6e4526, 0.55));
    engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => {
      this.audio.step();
      this.particles.burst(pos, { color: 0x9a8f80, n: 1, speed: 0.4, up: 0.5, gravity: 2, life: 0.35, size: 0.7 });
    };

    this.remote = null; // {creature, target:{x,z,h}, area}
    this.highlight = this._makeHighlight();

    this._wireHud();
    this.input.onKey = (code) => this._handleKey(code);
    this._morning(true);
    engine.onTick((dt, t) => this.update(dt, t));
  }

  // How far through the trading day we are, 0 (just opened) → 1 (dusk). Drives
  // the shop's shifting daylight so the hour reads at a glance.
  get dayProgress() {
    return 1 - clamp(this.dayT, 0, DAY_LEN) / DAY_LEN;
  }

  // ================================================================ loop
  update(dt, elapsed) {
    this.input.update();
    if (this.paused) {
      // ESC menu is up in single-player: freeze the world, keep the HUD live
      this.highlight.visible = false;
      this.hud.hideGuide();
      this.hud.hideInteractHint();
      this.hud.update();
      return;
    }
    this._updatePlayer(dt, elapsed);
    this._updateRemote(dt, elapsed);
    this.shop.update(dt, elapsed);
    this._autoDeal(dt);
    this.dungeon.update(dt, elapsed);
    this.particles.update(dt);
    this.slash.update(dt);
    this._updateUseFx(dt);
    this._updateTutGuide();
    this.hud.update();
    this.net.update(dt);

    // day "timer" (host authority): the sun only moves when AP is spent —
    // dayT eases toward the mark set by the remaining AP instead of ticking
    if (!this.net.isGuest && this.phase === "day" && !this.gameOver) {
      const target = (DAY_LEN * this.ap) / AP_PER_DAY;
      const rate = DAY_LEN / AP_PER_DAY / AP_DRAIN_SECS;
      if (this.dayT > target) this.dayT = Math.max(target, this.dayT - rate * dt);
      // last AP spent: dusk falls once the final errand wraps up (rush served
      // and doors shut, player back up from the cellar)
      if (this.dayT <= 0 && this.playerArea !== "dungeon" && !this.shop.doorsOpen && this.shop.customers.length === 0)
        this._nightfall();
    }
    if (this.phase === "day" && !this.gameOver) {
      this.hud.setDayProgress(1 - Math.max(0, this.dayT) / DAY_LEN, "day");
    }

    // camera follows the player in the dungeon, but stays put in the shop —
    // and locks onto the arena's centre once inside the boss room (fixed cam)
    const p = this.player.position;
    const inDungeon = this.playerArea === "dungeon";
    const inBoss = inDungeon && this.dungeon.active && this.dungeon.inBossRoom(p);
    const camTarget = inBoss ? this.dungeon.bossCenter : inDungeon ? p : _shopCenter;
    const camOffset = inBoss ? _camBoss : inDungeon ? _camDungeon : _camShop;
    this.engine.camTarget.lerp(camTarget, 1 - Math.pow(0.001, dt));
    this.engine.camOffset.lerp(camOffset, 1 - Math.pow(0.1, dt));
    this.audio.setMood(this.gameOver ? null : inDungeon ? "dungeon" : this.phase === "day" ? "shop" : null);

    // boss health bar: pinned up while the boss lives and you're in the cellar
    const boss = this.dungeon.boss;
    if (inDungeon && boss && boss.deadT < 0) {
      this.hud.showBossBar(boss.enraged ? "Ogre King — Enraged" : "Ogre King of the Cellar", boss.enraged);
      this.hud.setBossBar(boss.hp / boss.maxHp);
      // incoming-attack warning while the boss winds up (guests run telT,
      // mirrored from the host; the host reads its own attack clock)
      const windFrac = boss.atkState === "windup" ? boss.atkT / boss.windupDur
        : boss.telT >= 0 ? boss.telT / boss.telDur : -1;
      if (windFrac >= 0) this.hud.setBossTelegraph(boss.bossAttack ?? "slam", windFrac);
      else this.hud.clearBossTelegraph();
    } else this.hud.hideBossBar();

    // minimap: floor plan with entrance, exit, foes and players — dungeon only
    const showMap = inDungeon && this.dungeon.active;
    this.hud.showMinimap(showMap);
    if (showMap) {
      const remote = this.remote && this.remote.area === "dungeon" ? this.remote.creature : null;
      this.dungeon.reveal(this.player.position.x, this.player.position.z);
      if (remote) this.dungeon.reveal(remote.position.x, remote.position.z);
      this.hud.renderMinimap(this.dungeon, this.player, remote);
    }
  }

  _updatePlayer(dt, elapsed) {
    const c = this.player;
    if (this._respawnT >= 0) {
      this._respawnT -= dt;
      this.highlight.visible = false;
      this.hud.hideInteractHint();
      c.update(dt, elapsed);
      if (this._respawnT < 0) this._respawn();
      return;
    }
    this._invulnT -= dt;
    this._dodgeCd -= dt;
    if (this._comboT > 0) this._comboT -= dt;
    c.mesh.visible = this._invulnT < 0 || Math.sin(elapsed * 30) > -0.3;

    // movement
    const mv = this.input.move;
    const sheetBlocked = this.hud.sheetOpen;

    // dodge / roll (dungeon only) — grabbed before movement so it can override it
    if (this.input.dodgeEdge && !sheetBlocked && this.playerArea === "dungeon") this._dodge();

    if (this._dashT >= 0) {
      // committed roll: ease-out burst along the dash direction
      this._dashT += dt;
      const k = Math.max(0, 1 - this._dashT / this._dashDur);
      const sp = this._dashSpeed * (0.35 + 0.65 * k);
      c.position.x += this._dashDX * sp * dt;
      c.position.z += this._dashDZ * sp * dt;
      if (this._dashT >= this._dashDur) this._dashT = -1;
    } else if (!sheetBlocked && (mv.x || mv.y)) {
      const speed = 3.7;
      c.position.x += mv.x * speed * dt;
      c.position.z += mv.y * speed * dt;
    }

    // facing: mouse aim on desktop, movement direction on touch
    if (this._dashT >= 0) {
      // keep the roll facing its travel direction (don't fight the aim)
      c.heading = Math.atan2(this._dashDX, this._dashDZ);
    } else if (this.input.aimActive) {
      const aim = this._aimPoint();
      if (aim) {
        const dx = aim.x - c.position.x;
        const dz = aim.z - c.position.z;
        if (dx * dx + dz * dz > 0.02) c.heading = Math.atan2(dx, dz);
      }
    } else if (!sheetBlocked && (mv.x || mv.y)) {
      c.heading = Math.atan2(mv.x, mv.y);
    }
    const colliders = this.playerArea === "shop" ? this.shop.colliders : this.dungeon.colliders;
    this.collide(c.position, c.radius * 0.8, colliders);
    if (this.playerArea === "shop") {
      c.position.x = clamp(c.position.x, -SHOP.W / 2 + 0.5, SHOP.W / 2 - 0.5);
      c.position.z = clamp(c.position.z, -SHOP.D / 2 + 0.5, SHOP.D / 2 + 2.5);
    }

    // pending sword hit lands mid-swing (damage / crit / finisher set by _attack)
    if (this._pendingHit >= 0) {
      this._pendingHit -= dt;
      if (this._pendingHit < 0 && this.playerArea === "dungeon") {
        const o = this._pendingHitOpts || { dmg: 2 };
        this.dungeon.meleeHit(c, o.dmg, this, o);
      }
    }

    // auto-pickup drops (world coords)
    if (this.playerArea === "dungeon" && performance.now() >= (this._pickupSuppressT || 0)) {
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
    this._updateHighlight(act.focus, act.color, elapsed);
    // control hint under the highlight ring: keycap + verb on desktop, verb
    // only on touch (the action button itself already pulses there)
    if (act.focus && act.hint && !sheetBlocked && !this.gameOver)
      this.hud.interactHint(act.focus, act.hint, this.input.isTouch ? "" : "E");
    else this.hud.hideInteractHint();
    if (this.input.actionEdge && !sheetBlocked && this._dashT < 0) act.fn();

    c.update(dt, elapsed);
  }

  // Glowing ring that hovers over whatever the context action will act on
  // (an empty table to stock, a customer to haggle, the trapdoor, …) so it's
  // obvious where the action lands before you press it.
  _makeHighlight() {
    const g = new THREE.Group();
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xffd34d, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32).rotateX(-Math.PI / 2), discMat);
    disc.position.y = 0.012;
    g.add(disc);
    g.visible = false;
    g.renderOrder = 5;
    g.userData.mats = [discMat];
    this.engine.scene.add(g);
    return g;
  }

  _updateHighlight(focus, color, elapsed) {
    const h = this.highlight;
    if (!focus || this.hud.sheetOpen || this.gameOver) {
      h.visible = false;
      return;
    }
    h.visible = true;
    h.position.copy(focus);
    const pulse = 1 + Math.sin(elapsed * 6) * 0.1;
    h.scale.set(pulse, 1, pulse);
    h.rotation.y = elapsed * 1.4;
    const c = color ?? 0xffd34d;
    for (const m of h.userData.mats) m.color.setHex(c);
  }

  // Raycast the mouse pointer onto the ground plane (torso height) so the
  // player can aim in world space regardless of where they're standing.
  _aimPoint() {
    _ray.setFromCamera(this.input.pointer, this.engine.camera);
    return _ray.ray.intersectPlane(_aimPlane, _v3) ? _v3 : null;
  }

  // Keyboard shortcuts for the on-screen actions + the admin panel.
  _handleKey(code) {
    switch (code) {
      case "Backquote": return this._toggleAdmin();
      case "Escape":
        if (this._adminOpen) return this._toggleAdmin();
        if (this._escOpen) return this._closeEscMenu();
        if (this.hud.sheetOpen) return this.hud.hideSheet();
        return this._toggleEscMenu();
      case "KeyB":
      case "KeyI": return this._toggleBag();
      case "KeyC": return this._coopSheet();
      case "KeyM": return document.getElementById("mute-btn").click();
      case "KeyE":
      case "KeyF":
        // context action (attack / haggle / delve / …), same as click / Space
        if (!this.hud.sheetOpen) this._contextAction().fn();
        return;
    }
  }

  _contextAction() {
    const p = this.player.position;
    if (this.playerArea === "shop") {
      const cust = this.shop.wantingCustomerNear(p);
      const seller = this.shop.sellingCustomerNear(p);
      // whichever negotiation is closer wins the action button
      const custD = cust ? cust.creature.position.distanceTo(p) : Infinity;
      const sellD = seller ? seller.creature.position.distanceTo(p) : Infinity;
      if (cust && custD <= sellD)
        return { label: "speak", hint: "Haggle", fn: () => this._haggle(cust), focus: _focus.copy(cust.creature.position).setY(0.06).clone(), color: 0xffd34d };
      if (seller)
        return { label: "moneyfly", hint: "Buy", fn: () => this._buyFrom(seller), focus: _focus.copy(seller.creature.position).setY(0.06).clone(), color: 0x8fe0ff };
      // the shopfront doors: open up for customers by day, head home by night
      if (p.distanceTo(this.shop.doorInside) < 1.5) {
        // day, but sold out with the cellar spent → the doors offer an early night
        const spent = this.phase === "day" && this._daySpent();
        return { label: this.phase === "night" ? "home" : spent ? "bed" : "shop", hint: this.phase === "night" ? "Go home" : spent ? "Turn in" : this.shop.doorsOpen ? "Close up" : "Open up", fn: () => this._doorPrompt(), focus: _focus.copy(this.shop.doorInside).setY(0.06).clone(), color: this.phase === "night" || spent ? 0x8fd0ff : 0x66ff9e };
      }
      if (this.shop.trapdoorOpen && p.distanceTo(this.shop.trapdoorPos) < 1.5)
        return { label: "hole", hint: "Delve", fn: () => this._delve(), focus: _focus.copy(this.shop.trapdoorPos).setY(0.06).clone(), color: 0xb98cff };
      // already delved today (solo): the Guild will unseal the cellar for a fee
      if (!this.net.connected && this.delvedToday && p.distanceTo(this.shop.trapdoorPos) < 1.5)
        return { label: "hole", hint: "Unseal", fn: () => this._delve(), focus: _focus.copy(this.shop.trapdoorPos).setY(0.06).clone(), color: 0x9aa0aa };
      // stocked table → swap the item or take it back
      for (const slot of this.shop.slots) {
        if (slot.item && _v.copy(slot.pos).setY(0).distanceTo(p) < 1.5)
          return { label: "box", hint: "Swap", fn: () => this._replaceMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0xff9d5c };
      }
      // empty table → place an item (only when the storeroom has something)
      if (this.stash.length > 0) {
        for (const slot of this.shop.slots) {
          if (!slot.item && _v.copy(slot.pos).setY(0).distanceTo(p) < 1.5)
            return { label: "box", hint: "Stock", fn: () => this._placeMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0x66ff9e };
        }
      }
      return { label: "swords", fn: () => this._attack() };
    }
    // dungeon (positions are group-local, player is world — offset). Leaving
    // the cellar is folded into the stairs prompt now, so there's no separate
    // return circle at the entrance.
    if (this.dungeon.active) {
      // the sealed boss door: unlock it with the key, or read the "locked" cue
      if (this.dungeon.gatePos && !this.dungeon.gateOpen) {
        _v.copy(this.dungeon.gatePos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 2.0) {
          const has = this._hasBossKey();
          return { label: has ? "skull" : "warning", hint: has ? "Unlock" : "Locked", fn: () => this._openGate(), focus: _v.clone().setY(0.06), color: has ? 0xff5a5a : 0x9aa0aa };
        }
      }
      _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
      if (_v.distanceTo(p) < 1.5) return { label: "arrowDown", hint: "Stairs", fn: () => this._descendPrompt(), focus: _v.clone().setY(0.06), color: 0xb98cff };
      for (const chest of this.dungeon.chests) {
        if (chest.opened) continue;
        _v.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.7) return { label: "chest", hint: "Open", fn: () => this._openChest(chest), focus: _v.clone().setY(0.06), color: 0xffd34d };
      }
    }
    return { label: "swords", fn: () => this._attack() };
  }

  // Customers no longer wait to be approached: as soon as one has settled at
  // their spot (a buyer wanting an item, or a seller offering one) the haggle
  // sheet pops open on its own, so the player never has to walk over. Fires one
  // deal at a time with a short breather between them. Co-op keeps the manual
  // walk-up flow to avoid both clients auto-opening the same customer.
  _autoDeal(dt) {
    if (this.net.connected) return;
    if (this.gameOver || this.paused || this.playerArea !== "shop") return;
    if (this.hud.sheetOpen) {
      this._autoDealCd = 0.6; // a beat after the sheet closes before the next
      return;
    }
    this._autoDealCd -= dt;
    if (this._autoDealCd > 0) return;
    for (const cust of this.shop.customers) {
      if (!cust.ready) continue;
      if (cust.state === "want" && cust.slot?.item) return this._haggle(cust);
      if (cust.state === "offer" && cust.sellItem)
        return this._buyFrom(cust);
    }
  }

  // ================================================================ combat
  // Three-hit chain: light, light, then a wider, heavier finisher. Swing again
  // within the combo window to advance; pause and it resets to the first hit.
  _attack() {
    if (this._dashT >= 0) return; // no attacking mid-roll
    if (!this.player.attack()) return; // still mid-swing — ignore this press

    if (this._comboT > 0 && this._comboStep < 3) this._comboStep++;
    else this._comboStep = 1;
    this._comboT = 0.6; // window to chain the next swing
    const step = this._comboStep;
    const finisher = step === 3;

    const crit = Math.random() < this._critChance;
    let dmg = finisher ? 4 : 2;
    if (crit) dmg *= 2;

    this.audio.swingCombo(step - 1);
    this._pendingHit = finisher ? 0.2 : 0.14;
    this._pendingHitOpts = {
      dmg, crit, finisher,
      range: finisher ? 2.3 : 1.75,
      arc: finisher ? -0.2 : 0.35, // the finisher sweeps a much wider arc
      knock: finisher ? 1.7 : 1,
    };

    const h = this.player.heading;
    // crescent swoosh — larger + warmer on the finisher
    _v.copy(this.player.position).setY(0.62);
    this.slash.play(_v, h, finisher ? 1.5 : 1);
    _v.set(this.player.position.x + Math.sin(h) * 1.4, 0.8, this.player.position.z + Math.cos(h) * 1.4);
    this.particles.burst(_v, { color: finisher ? 0xffe0a0 : 0xdfe8ff, n: finisher ? 12 : 7, speed: finisher ? 3 : 2.1, up: 1.4, gravity: 3, life: 0.3, size: 0.85 });
    if (finisher) {
      this.audio.finisher();
    }
  }

  // A quick roll: brief i-frames + a burst of speed, on a short cooldown.
  // Rolls in the movement direction, or backsteps away from your facing.
  _dodge() {
    if (this._dashT >= 0 || this._dodgeCd > 0 || this._respawnT >= 0 || this.gameOver) return;
    const mv = this.input.move;
    let dx, dz;
    if (mv.x || mv.y) {
      const l = Math.hypot(mv.x, mv.y) || 1;
      dx = mv.x / l; dz = mv.y / l;
    } else {
      // backstep: away from where the player is facing
      dx = -Math.sin(this.player.heading);
      dz = -Math.cos(this.player.heading);
    }
    this._dashDX = dx;
    this._dashDZ = dz;
    this._dashT = 0;
    this._dodgeCd = 0.55;
    this._invulnT = Math.max(this._invulnT, 0.36); // i-frames through the roll
    this.player.animator.squash.kick(5);
    this.audio.dodge();
    _v.copy(this.player.position).setY(0.1);
    this.particles.burst(_v, { color: 0xbfe8ff, n: 9, speed: 2.6, up: 0.6, gravity: 3, life: 0.35, size: 0.9 });
  }

  enemyHitsPlayer(e, targetEntry) {
    if (!targetEntry.local) {
      this.net.send({ t: "pHurt", dmg: e.def.dmg });
      return;
    }
    this.applyPlayerDamage(e.def.dmg, e.creature.position);
  }

  // routed like enemyHitsPlayer, but the source is a flying orb/bolt
  enemyProjectileHitsPlayer(proj, targetEntry) {
    if (!targetEntry.local) {
      this.net.send({ t: "pHurt", dmg: proj.dmg });
      return;
    }
    this.applyPlayerDamage(proj.dmg, _v.set(proj.x, 0, proj.z));
  }

  applyPlayerDamage(dmg, fromPos = null) {
    if (this.godMode) return;
    if (this._invulnT > 0 || this._respawnT >= 0 || this.gameOver) return;
    this._invulnT = 1.2;
    this.hp = Math.max(0, this.hp - dmg);
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.flashHurt(); // red screen pulse
    this.player.hurt();
    this.audio.hurt();
    this.engine.hitStop(Math.min(0.14, 0.07 + dmg * 0.03));
    if (fromPos) {
      _v.copy(this.player.position).sub(fromPos).setY(0).normalize();
      this.player.position.addScaledVector(_v, 0.7);
      // impact spray on the side the blow came from — reads the contact clearly
      _v2.copy(this.player.position).setY(this.player.height * 0.6).addScaledVector(_v, this.player.radius * 0.5);
      this.particles.burst(_v2, { color: 0xff5a4a, n: 14, speed: 4.5, up: 1.4, life: 0.45, size: 1.1 });
    }
    this.particles.burst(_v2.copy(this.player.position).setY(this.player.height * 0.55), { color: 0xffd0c0, n: 6, speed: 2.2, up: 1.0, life: 0.35, size: 0.9 });
    this.hud.float(_v2.copy(this.player.position).setY(1.8), `-${dmg}`, "dmg hurt");
    if (this.hp <= 0) {
      this.player.die(_v.multiplyScalar(-6).setY(-2));
      this.hud.banner("You got carried home…", "your bag was lost", 2.6);
      this.audio.gameover();
      this._respawnT = 2.4;
    } else {
      // still standing but hurt — quaff a consumable if one fits the wound
      this._tryAutoHeal();
    }
  }

  _respawn() {
    // drop any mid-flight use flourishes (the old player blob is a ragdoll now)
    for (const fx of this._useFx) fx.mesh.removeFromParent();
    this._useFx = [];
    // dying empties your bag (the loot you were carrying) instead of taxing gold
    this.inventory = [];
    if (!this.net.isGuest) {
      this._syncState();
    }
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(this.gold);
    // rebuild the player blob (the old one is a ragdoll now)
    const held = this.player.heldItem;
    this.player.dispose();
    this.player = new BlockyCreature("a", { height: 1.3 });
    this.player.position.set(0, 0, 2.5);
    this.player.holdItem(swordMesh(0xd7dde6, 0x6e4526, 0.55));
    this.engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => this.audio.step();
    this.playerArea = "shop";
    this.hud.showHearts(false);
    this.hud.showBag(false);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false);
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
    // NB: coin sounds now cascade from the flying-coin landings (see _saleJuice)
    this._syncState();
  }

  // Pay out gold (buying stock from a customer). Host-authoritative like the
  // rest of the wallet; guests see the new total echoed back via "state".
  _spendGold(amount, pos = null) {
    this.gold = Math.max(0, this.gold - amount);
    this.hud.setGold(this.gold);
    if (pos) this.hud.float(_v2.copy(pos).setY(pos.y + 1.4), `-${amount}g`, "dmg");
    this._syncState();
  }

  _pickupDrop(drop) {
    if (this.inventory.length >= this.invCap) {
      if (!this._bagFullT || performance.now() - this._bagFullT > 2000) {
        this.hud.toast(`${icon("bag")} Bag is full!`);
        this._bagFullT = performance.now();
      }
      return;
    }
    this.dungeon.takeDrop(drop);
    this.today.looted++;
    this.audio.pickup();
    if (this.net.isGuest) {
      this.net.send({ t: "take", id: drop.id });
    } else {
      this.inventory.push(drop.item);
      this._syncInv();
      this.net.send({ t: "dropTake", id: drop.id });
    }
    const it = ITEMS[drop.item];
    this.hud.float(_v.copy(drop.mesh.position).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
    this._tutAdvance("loot");
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

  _stockFromStash(idx, slotIdx = -1) {
    if (this.playerArea !== "shop") return this.hud.toast("You can only stock in the shop.");
    const itemId = this.stash[idx];
    if (itemId == null) return;
    if (this.net.isGuest) {
      this.net.send({ t: "stockReq", idx, slotIdx });
      return;
    }
    const slot = slotIdx >= 0 ? this.shop.slots[slotIdx] : this.shop.freeSlot();
    if (!slot || slot.item)
      return this.hud.toast(slotIdx >= 0 ? "That table is taken." : "All display slots are full.");
    this.stash.splice(idx, 1);
    this.shop.stockItem(itemId, slot);
    this.audio.pickup();
    this._tutAdvance("stock");
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
    const id = this.shop.unstockSlot(slot);
    if (id) {
      this.stash.push(id);
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
      this.today.sold++;
      this.today.earned += price;
      if (grade === "perfect") this.today.perfect++;
      this.today.bestCombo = Math.max(this.today.bestCombo, this.combo);
      this.gainGold(price, cust.creature.position);
      this._saleJuice(price, grade, cust.creature.position);
      this._tutAdvance("sell");
      this._syncStock();
      this._save();
    } else {
      this.combo = 0;
      this.audio.deny();
    }
  }

  _saleJuice(price, grade, pos) {
    // coins arc up to the gold counter, ticking a coin sound as each lands
    const coins = 5 + Math.min(11, Math.floor(price / 12));
    this.hud.flyCoins(_v.copy(pos).setY(1.0), coins, (i) => this.audio.coin(i % 6));
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

  // ---- buying stock from a customer (the reverse haggle) -------------------
  _buyFrom(seller) {
    this.audio.haggle();
    this.shop.startBuyHaggle(seller, this.hud, this.audio, (bought, price, grade, item) => {
      if (this.net.isGuest) {
        this.net.send({ t: "buy", custId: seller.id, bought, price, grade });
        if (bought) this._buyJuice(price, grade, seller.creature.position);
        return;
      }
      this._resolveBuy(seller, bought, price, grade, item);
    });
  }

  _resolveBuy(cust, bought, price, grade, item) {
    if (!bought) {
      this.audio.deny();
      return;
    }
    this.combo = 0; // buying stock doesn't feed the sell-combo
    this.today.bought++;
    this.today.spent += price;
    this._spendGold(price, cust.creature.position);
    this.stash.push(item.id); // bought stock goes straight to the storeroom
    this._syncInv();
    this._buyJuice(price, grade, cust.creature.position);
    this._save();
  }

  _buyJuice(price, grade, pos) {
    if (grade === "perfect") {
      this.audio.perfect();
      this.hud.banner("STEAL OF A DEAL!", `bought for ${price}g — a bargain`, 1.6);
      this.engine.shake(0.12);
      this.particles.burst(_v.copy(pos).setY(1.4), { color: 0x8fe0ff, n: 16, speed: 3.2, life: 0.8 });
    } else {
      this.audio.sale();
      this.hud.toast(`Bought for ${price}g`);
    }
  }

  // ================================================================ day cycle
  // Burn one action point: the sun starts gliding toward its new mark (see the
  // day-timer block in update) — the clock itself is the AP meter.
  _spendAP() {
    this.ap = Math.max(0, this.ap - 1);
    this._syncState();
  }

  _morning(first = false) {
    this.phase = "day";
    this.dayT = DAY_LEN;
    this.ap = AP_PER_DAY; // a fresh day's worth of errands
    this.delvedToday = false; // a fresh morning re-opens the cellar for one run
    this.shop.setDoorsOpen(false); // start each day shut — open up when ready
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
        this.hud.banner(`${icon("scroll")} Paid ${due.amt}g to the Guild!`, this.debtIdx >= DEBT.length ? "The shop is YOURS!" : `next payment: day ${DEBT[this.debtIdx].day}`, 3);
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
    if (!first) this.hud.banner(`${icon("sun")} Day ${this.day}`, "stock the tables, then open the doors", 2.2);
    else {
      this.hud.banner(`${icon("shop")} COIN CELLAR`, "", 3);
      if (this.day === 1 && !this._hadSave && !this.net.connected) this._tutStart();
    }
    // fresh ledger for the new day (goldStart reflects the post-debt wallet)
    this.today = this._freshDayStats();
    this._syncState();
    this._save();
  }

  // ---- first-run onboarding -------------------------------------------------
  // Rather than front-loading four timed toasts, we teach the loop in the order
  // you actually live it — delve for stock, bring it up, put it on a table,
  // open the doors, make the sale — and advance only as each step is done.
  // Combined with the near-empty START_INV, the bare shelves point a brand-new
  // player straight at the trapdoor. Runs once, on a fresh save, solo only.
  _tutStart() {
    this.tutorial = "delve";
    setTimeout(() => this._tutHint(), 3200); // let the intro banner clear first
  }

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      delve: `${icon("hole")} Your shelves are bare — step onto the trapdoor to delve for stock`,
      loot: `${icon("swords")} Fight through and grab loot — it's tomorrow's merchandise`,
      return: `${icon("arrowDown")} Take the stairs to bring your loot back to the shop`,
      stock: `${icon("box")} Stand at a glowing table and place your loot to sell it`,
      open: `${icon("shop")} Now open the doors to let a customer in`,
      sell: `${icon("speak")} Haggle a good price to seal your first sale`,
    };
    this.hud.toast(hints[this.tutorial]);
  }

  // Called at each loop milestone with the step it completes; advances (and
  // re-hints) only if that's the step we're currently waiting on.
  _tutAdvance(step) {
    if (this.tutorial !== step) return;
    const order = ["delve", "loot", "return", "stock", "open", "sell"];
    this.tutorial = order[order.indexOf(step) + 1] || null;
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
    else this.hud.toast(`${icon("crown")} That's the loop — delve, stock, deal. Now pay off the Guild!`);
  }

  // Where the FTUE guide arrow should point right now. Re-resolved every frame
  // so it tracks moving targets (customers, drops) and area changes; the arrow
  // itself lives in the HUD (hud.guide) and clamps to the screen edge when the
  // objective is out of view.
  _updateTutGuide() {
    if (!this.tutorial || this.gameOver || this.hud.sheetOpen || this._respawnT >= 0)
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
        if (best) pos = _v.copy(best);
        else { pos = _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN); text = "To the stairs"; }
        break;
      }
      case "return":
        if (!inShop && this.dungeon.active) {
          pos = _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
          text = "Stairs — back to shop";
        }
        break;
      case "stock": {
        if (!inShop) {
          if (this.dungeon.active) { pos = _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN); text = "Back to shop"; }
          break;
        }
        if (!this.stash.length) break; // nothing left to place — no target
        const slot = this.shop.slots.find((s) => !s.item);
        if (slot) { pos = _v.copy(slot.pos).setY(0); text = "Stock this table"; }
        break;
      }
      case "open":
        if (inShop) { pos = _v.copy(this.shop.doorInside); text = "Open the doors"; }
        break;
      case "sell": {
        const cust = this.shop.customers.find((c) => c.ready && c.state === "want");
        if (cust) { pos = _v.copy(cust.creature.position); text = "Make the sale"; }
        break;
      }
    }
    if (pos) this.hud.guide(pos.setY(1.4), text);
    else this.hud.hideGuide();
  }

  _freshDayStats() {
    return {
      goldStart: this.gold,
      earned: 0, spent: 0, sold: 0, perfect: 0, bestCombo: 0,
      bought: 0, slain: 0, looted: 0, deepest: 0,
    };
  }

  _nightfall() {
    this.phase = "night";
    this.hud.setDay(this.day, "night");
    this.shop.setDoorsOpen(false); // shutters roll down at dusk
    const spent = !this.net.connected && this.delvedToday; // cellar already delved today
    this.hud.banner(`${icon("moon")} Closing time`, spent ? `the cellar's sealed — sleep, or pay the Guild ${UNSEAL_FEE}g to unseal it` : "delve the cellar, or sleep to open again", 2.6);
    for (const cust of [...this.shop.customers]) {
      if (cust.state !== "haggling") cust.state = "leave";
    }
    this._syncState();
  }

  // Nothing left to do today: cellar spent, bag banked, storeroom bare,
  // tables cleared — with no stock there are no customers (buyers or sellers).
  _daySpent() {
    return !this.net.connected && this.delvedToday
      && this.inventory.length === 0 && this.stash.length === 0
      && this.shop.stockedCount() === 0;
  }

  _sleep() {
    if (this.net.isGuest) return this.hud.toast("Only the host can end the day.");
    if (this.phase === "day") {
      if (!this._daySpent()) {
        this.hud.toast("There's still daylight left! (turn in at night)");
        return;
      }
      this._nightfall(); // sold out and the cellar's spent — close up early
    }
    this._showDayRecap();
  }

  // The "good night" summary of the day that just ended. Continue from here
  // actually advances the calendar (debt, fresh dungeon, new morning).
  _showDayRecap() {
    if (this.hud.sheetOpen) this.hud.hideSheet();
    this.audio.stairs();
    const t = this.today;
    const net = t.earned - t.spent;
    const netCls = net >= 0 ? "up" : "down";
    const netStr = `${net >= 0 ? "+" : "−"}${Math.abs(net)}g`;

    const rows = [
      { ic: "coin", label: "Items sold", val: `${t.sold} · +${t.earned}g`, show: true },
      { ic: "crown", label: "Perfect deals", val: t.bestCombo > 1 ? `${t.perfect} · best x${t.bestCombo}` : `${t.perfect}`, show: t.perfect > 0 },
      { ic: "shopping", label: "Stock bought", val: `${t.bought} · −${t.spent}g`, show: t.bought > 0 },
      { ic: "skull", label: "Monsters slain", val: `${t.slain}`, show: t.slain > 0 },
      { ic: "box", label: "Loot gathered", val: `${t.looted}`, show: t.looted > 0 },
      { ic: "hole", label: "Deepest floor", val: `B${t.deepest}`, show: t.deepest > 0 },
    ].filter((r) => r.show);

    const rowsHtml = rows
      .map((r) => `<div class="recap-row">${icon(r.ic)}<span class="recap-label">${r.label}</span><span class="recap-val">${r.val}</span></div>`)
      .join("");
    const quiet = rows.length <= 1 && t.sold === 0
      ? `<div class="recap-quiet">A quiet day at the shop. Tomorrow, then.</div>` : "";

    // A word about the Guild if a payment is looming.
    const due = DEBT[this.debtIdx];
    let guild = "";
    if (due) {
      const daysLeft = due.day - this.day;
      const short = this.gold < due.amt;
      if (daysLeft <= 0) guild = `<div class="recap-guild urgent">${icon("scroll")} The Guild collects ${due.amt}g at dawn!</div>`;
      else if (daysLeft <= 2) guild = `<div class="recap-guild${short ? " urgent" : ""}">${icon("scroll")} ${due.amt}g due in ${daysLeft} day${daysLeft > 1 ? "s" : ""} · you have ${this.gold}g</div>`;
    }

    const el = this.hud.showSheet(`
      <div class="sheet-card">
        <div class="sheet-title"><span class="big-emoji">${icon("moon")}</span>
          <div><b>Day ${this.day} — Good night</b><br/><small>time to turn in and open again tomorrow</small></div></div>
        <div class="recap-hero">
          <div class="recap-net ${netCls}">${netStr}<small>earned today</small></div>
          <div class="recap-purse">${icon("coin")} ${this.gold}g in the purse</div>
        </div>
        <div class="recap-rows">${rowsHtml}</div>
        ${quiet}
        ${guild}
        <div class="sheet-btns">
          <button class="btn deal" id="recap-sleep">${icon("bed")} Sleep → Day ${this.day + 1}</button>
        </div>
      </div>
    `, "recap-sheet");
    el.querySelector("#recap-sleep").onclick = () => {
      this.hud.hideSheet();
      this._advanceDay();
    };
  }

  _advanceDay() {
    this.audio.stairs();
    this.day++;
    this.dungeon.dispose(); // fresh dungeon every day
    this.net.send({ t: "dungeonReset" });
    this._morning();
  }

  // The shopfront doors: by day, a modal to open (or close) up so customers can
  // come in; by night, a modal asking whether to head home and end the day.
  _doorPrompt() {
    if (this.hud.sheetOpen) return;
    if (this.net.isGuest) return this.hud.toast("Only the host runs the shop.");

    if (this.phase === "night") {
      const el = this.hud.showSheet(`
        <div class="sheet-title"><span class="big-emoji">${icon("home")}</span>
          <div><b>Head home for the night?</b><br/><small>turn in and open up again tomorrow</small></div></div>
        <div class="sheet-btns">
          <button class="btn deny" id="door-no">${icon("close")} Not yet</button>
          <button class="btn deal" id="door-yes">${icon("bed")} Go home</button>
        </div>
      `, "sheet-card");
      el.querySelector("#door-yes").onclick = () => {
        this.hud.hideSheet();
        this._sleep();
      };
      el.querySelector("#door-no").onclick = () => this.hud.hideSheet();
      return;
    }

    // daytime — toggle the shopfront open or closed
    const opening = !this.shop.doorsOpen;
    // tutorial: no opening up before there's something on the tables — the
    // FTUE walks delve → stock → open in that order, so hold the doors shut
    if (opening && this.tutorial && this.tutorial !== "open" && this.tutorial !== "sell") {
      this.hud.toast(this.tutorial === "stock"
        ? `${icon("box")} Put your loot on a table before opening up`
        : `${icon("hole")} Nothing to sell yet — delve the cellar for stock first`);
      this.audio.deny();
      return;
    }
    // opening up is one of the day's errands — no AP, no rush
    if (opening && this.ap <= 0) {
      this.hud.toast(`${icon("moon")} The day's spent — no time to open up again`);
      this.audio.deny();
      return;
    }
    // sold out with the cellar spent: nothing left to trade, offer to turn in early
    const spent = this._daySpent();
    const earlyBtn = spent ? `<button class="btn deal" id="door-sleep">${icon("bed")} Turn in early</button>` : "";
    const el = this.hud.showSheet(opening ? `
      <div class="sheet-title"><span class="big-emoji">${icon("shop")}</span>
        <div><b>Open the doors?</b><br/><small>${spent ? "nothing left to sell — you could turn in early" : `the rush takes a chunk of the day (${icon("sun")} 1 of ${this.ap} left)`}</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="door-no">${icon("close")} Not yet</button>
        <button class="btn deal" id="door-yes">${icon("shop")} Open up</button>
        ${earlyBtn}
      </div>
    ` : `
      <div class="sheet-title"><span class="big-emoji">${icon("shop")}</span>
        <div><b>Close the doors?</b><br/><small>${spent ? "nothing left to sell — you could turn in early" : "no new customers will come in"}</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="door-no">${icon("close")} Keep open</button>
        <button class="btn deal" id="door-yes">${icon("shop")} Close up</button>
        ${earlyBtn}
      </div>
    `, "sheet-card");
    if (spent) el.querySelector("#door-sleep").onclick = () => {
      this.hud.hideSheet();
      this._sleep();
    };
    el.querySelector("#door-yes").onclick = () => {
      this.hud.hideSheet();
      this.shop.setDoorsOpen(opening);
      // shooing folks out on close so the leaves can actually swing shut behind
      // them (otherwise a lingering shopper holds the doorway open indefinitely)
      if (!opening) {
        for (const cust of [...this.shop.customers]) {
          if (cust.state !== "haggling") cust.state = "leave";
        }
      }
      if (opening) {
        // opening up brings the whole crowd at once — no stock, no crowd (and
        // a crowd-less opening costs nothing; only a real rush burns the AP)
        this.shop.beginWave();
        if (this.shop.stockedCount() > 0) {
          this._spendAP();
          this.hud.toast(`${icon("shop")} Doors open — here comes the crowd!`);
        } else {
          this.hud.toast(`${icon("box")} Doors open… but bare tables draw no crowd`);
        }
      } else {
        this.hud.toast(`${icon("shop")} Doors closed`);
      }
      if (opening) this._tutAdvance("open");
      this._syncState();
    };
    el.querySelector("#door-no").onclick = () => this.hud.hideSheet();
  }

  // ================================================================ dungeon
  _delve() {
    // the cellar's sealed while the shop's open for trade — close up first
    if (this.playerArea === "shop" && !this.shop.trapdoorOpen && !this.dungeon.active) {
      this.hud.toast(`${icon("shop")} Close the shop doors to open the cellar`);
      return;
    }
    // a run down the cellar is one of the day's errands — no AP, no delve
    // (checked before the unseal offer so you can't pay the fee for nothing)
    if (!this.net.isGuest && this.ap <= 0) {
      this.hud.toast(`${icon("moon")} The day's spent — the cellar can wait for dawn`);
      this.audio.deny();
      return;
    }
    // one run a day (solo): once you've delved, the cellar seals shut — but the
    // Guild will crack it open again for a fee
    if (!this.net.connected && this.delvedToday) return this._unsealPrompt();
    // before dropping down: pick supplies to pack from the storeroom
    if (this._packable().length > 0) return this._packMenu();
    this._startDelve();
  }

  // The cellar's sealed after the day's run — offer to pay the Guild to unseal
  // it for a second delve.
  _unsealPrompt() {
    if (this.hud.sheetOpen) return;
    const fee = UNSEAL_FEE;
    const broke = this.gold < fee;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("hole")}</span>
        <div><b>The cellar is sealed</b><br/><small>the Guild will crack it open again — for ${fee}g</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="unseal-no">${icon("close")} Not today</button>
        <button class="btn deal" id="unseal-yes" ${broke ? "disabled" : ""}>${icon("coin")} Pay ${fee}g${broke ? ` (you have ${this.gold}g)` : ""}</button>
      </div>
    `, "sheet-card");
    el.querySelector("#unseal-yes").onclick = () => {
      if (this.gold < fee) return;
      this.hud.hideSheet();
      this._spendGold(fee, this.shop.trapdoorPos);
      this.today.spent += fee;
      this.delvedToday = false;
      this.dungeon.dispose(); // scrap the morning's cleared floors — fresh run
      this.net.send({ t: "dungeonReset" });
      this.hud.toast(`${icon("hole")} The seal cracks open — one more run`);
      this._delve();
    };
    el.querySelector("#unseal-no").onclick = () => this.hud.hideSheet();
  }

  _startDelve() {
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
      this._syncState();
    }
    this._enterDungeon();
  }

  // What's worth carrying back down: only consumables (they can be used in the
  // cellar) and the Brass Key for the boss door — the rest is merchandise.
  _packable() {
    return this.stash
      .map((id, i) => ({ id, i, it: ITEMS[id] }))
      .filter(({ id, it }) => it.heal || id === "key");
  }

  // Small sheet before a delve: tap storeroom supplies to load them into the
  // bag, then head down. Closing the sheet cancels the delve entirely.
  _packMenu() {
    if (this.hud.sheetOpen) this.hud.hideSheet();
    const packable = this._packable();
    const free = this.invCap - this.inventory.length;
    const rows = packable
      .map(({ id, i, it }) => `<button class="inv-item pack-item" data-i="${i}">${itemIcon(it.icon)}<small>${it.name}</small>
        <span>${it.heal ? `+${it.heal} ${icon("heart")}` : "boss door"}</span></button>`)
      .join("");
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("bag")}</span>
        <div><b>Pack your bag</b><br/><small>tap supplies to bring down — <span id="pack-n">0</span>/${free} slots</small></div>
        <button class="icon-btn" id="pack-close">${icon("close")}</button></div>
      <div class="inv-grid">${rows}</div>
      <div class="sheet-btns">
        <button class="btn deny" id="pack-skip">${icon("close")} Travel light</button>
        <button class="btn deal" id="pack-go">${icon("hole")} Delve</button>
      </div>
    `, "sheet-card");
    const sel = new Set();
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
        counter.textContent = sel.size;
      };
    });
    el.querySelector("#pack-close").onclick = () => this.hud.hideSheet();
    el.querySelector("#pack-skip").onclick = () => {
      this.hud.hideSheet();
      this._startDelve();
    };
    el.querySelector("#pack-go").onclick = () => {
      this.hud.hideSheet();
      this._pack([...sel]);
      this._startDelve();
    };
  }

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
  }

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
  }

  _enterDungeon() {
    // dropping down (not each floor) burns an errand — guarded by delvedToday
    // so descending stairs mid-run doesn't charge again
    if (!this.net.isGuest && !this.delvedToday) this._spendAP();
    this.delvedToday = true; // this run counts as the day's one delve
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
    this.audio.stairs();
    this._snapCamera();
    const finalFloor = this.dungeon.floor >= MAX_FLOORS;
    this.hud.banner(
      finalFloor ? `${icon("skull")} Cellar — Final Floor` : `${icon("hole")} Cellar — Floor ${this.dungeon.floor}`,
      finalFloor ? (this._hasBossKey() ? "unlock the sealed door — the boss waits within" : "find a Brass Key to breach the boss door") : "",
      finalFloor ? 2.6 : 1.6
    );
    this._tutAdvance("delve");
  }

  _returnHome() {
    this.playerArea = "shop";
    this._depositBag();
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
  }

  // jump the camera straight to the current area's framing (no glide)
  _snapCamera() {
    const inDungeon = this.playerArea === "dungeon";
    this.engine.camTarget.copy(inDungeon ? this.player.position : _shopCenter);
    this.engine.camOffset.copy(inDungeon ? _camDungeon : _camShop);
  }

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
    // the boss floor is as deep as it goes — the stairs are just the way out
    if (this.dungeon.floor >= MAX_FLOORS) {
      const el = this.hud.showSheet(`
        <div class="sheet-title"><span class="big-emoji">${icon("home")}</span>
          <div><b>Leave the cellar?</b><br/><small>This is the deepest floor — the boss lies beyond the sealed door</small></div></div>
        <div class="sheet-btns">
          <button class="btn deny" id="descend-stay">${icon("close")} Keep delving</button>
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
  }

  _descend() {
    if (this.tutorial) return; // tutorial cellar is a single floor
    if (this.dungeon.floor >= MAX_FLOORS) return; // no deeper than the boss floor
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

  // The boss door key is just a Brass Key ("key") carried in the bag — any one
  // will do, whether found in the guaranteed key chest or picked up as loot.
  _hasBossKey() {
    return this.inventory.includes("key");
  }

  // Spend one Brass Key from the bag (used when the boss door is unlocked).
  _consumeBossKey() {
    const i = this.inventory.indexOf("key");
    if (i < 0) return;
    this.inventory.splice(i, 1);
    this._syncInv();
    this._save();
  }

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
    this.hud.banner(`${icon("skull")} The seal breaks…`, "the Ogre King awakens", 2.6);
    this._enterBossRoom();
  }

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
  }

  // The boss hit half health: phase two (minions + faster patterns, see dungeon)
  onBossEnraged() {
    this.hud.banner(`${icon("warning")} The Ogre King is enraged!`, "faster, angrier — and it brought friends", 2.4);
  }

  // The boss is down: fanfare, a shower of sparks, and the treasure it guarded.
  onBossDefeated(pos = null) {
    this.audio.victory();
    this.engine.shake(0.45);
    this.hud.banner(`${icon("crown")} The Cellar Boss falls!`, "grab the spoils, then head home", 3.4);
    if (pos) this.particles.burst(_v.copy(pos).setY(1), { color: 0xffe08a, n: 30, speed: 5, up: 2.2, life: 1.1, size: 1.3 });
  }

  // ================================================================ game over
  _gameOver(due) {
    this.gameOver = true;
    this.audio.gameover();
    this.hud.banner(`${icon("moneyfly")} THE GUILD TAKES THE SHOP`, `you owed ${due.amt}g`, 0);
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("moneyfly")}</span>
        <div><b>Repossessed!</b><br/><small>Day ${this.day} — ${this.gold}g wasn't enough</small></div></div>
      <div class="sheet-btns"><button class="btn deal" id="go-restart">Start a new shop</button></div>
    `, "sheet-card");
    el.querySelector("#go-restart").onclick = () => this._reset();
  }

  _victoryScreen() {
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("crown")}</span>
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
      document.getElementById("mute-btn").innerHTML = icon(muted ? "soundOff" : "soundOn");
    };
    document.getElementById("bag-btn").onclick = () => this._toggleBag();
    this.hud.showBag(this.playerArea === "dungeon");
    this.hud.showGold(true);
    this.hud.setGoldCorner(this.playerArea === "dungeon");
    document.getElementById("coop-btn").onclick = () => this._coopSheet();
    document.getElementById("pause-btn").onclick = () => this._toggleEscMenu();
    // set the mute button to match saved preference
    document.getElementById("mute-btn").innerHTML = icon(this.audio.muted ? "soundOff" : "soundOn");
  }

  // ------------------------------------------------------------- pause / ESC
  _toggleEscMenu() {
    if (this._escOpen) return this._closeEscMenu();
    if (this.hud.sheetOpen) this.hud.hideSheet(); // supersede any open sheet
    this._escOpen = true;
    this.paused = !this.net.connected; // don't freeze the sim during co-op
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("pause")}</span>
        <div><b>Paused</b><br/><small>Day ${this.day} · ${this.gold}g</small></div>
        <button class="icon-btn" id="esc-x">${icon("close")}</button></div>
      <div class="sheet-btns esc-col">
        <button class="btn deal" id="esc-resume">${icon("play")} Resume</button>
        <button class="btn" id="esc-sound">${icon(this.audio.muted ? "soundOff" : "soundOn")} Sound: ${this.audio.muted ? "off" : "on"}</button>
        <button class="btn" id="esc-coop">${icon("people")} Co-op</button>
        <button class="btn deny" id="esc-restart">${icon("recycle")} New shop</button>
      </div>
      <div class="esc-hint"><b>WASD</b> move · <b>mouse</b> aim · <b>click/E</b> act · <b>Space</b> menu · <b>B</b> bag · <b>\`</b> admin</div>
    `, "sheet-card");
    el.querySelector("#esc-x").onclick = () => this._closeEscMenu();
    el.querySelector("#esc-resume").onclick = () => this._closeEscMenu();
    el.querySelector("#esc-sound").onclick = (e) => {
      const muted = this.audio.toggleMute();
      e.currentTarget.innerHTML = `${icon(muted ? "soundOff" : "soundOn")} Sound: ${muted ? "off" : "on"}`;
      document.getElementById("mute-btn").innerHTML = icon(muted ? "soundOff" : "soundOn");
    };
    el.querySelector("#esc-coop").onclick = () => {
      this._closeEscMenu();
      this._coopSheet();
    };
    el.querySelector("#esc-restart").onclick = () => {
      if (confirm("Start a new shop? This wipes your saved progress.")) this._reset();
    };
  }

  _closeEscMenu() {
    this._escOpen = false;
    this.paused = false;
    this.hud.hideSheet();
  }

  // Storeroom items as a tappable grid (used by the place / replace menus).
  _stashRows() {
    return this.stash
      .map((id, i) => {
        const it = ITEMS[id];
        return `<button class="inv-item" data-i="${i}">${itemIcon(it.icon)}<small>${it.name}</small><span>${it.base}g</span></button>`;
      })
      .join("");
  }

  // Shared backpack header + capacity meter for both bag views.
  _bagHead(subtitle) {
    const n = this.inventory.length, cap = this.invCap;
    const pct = cap ? Math.min(100, (n / cap) * 100) : 0;
    const full = n >= cap;
    return `
      <div class="bag-head">
        <span class="bag-emoji">${icon("bag")}</span>
        <div class="bag-title"><b>Backpack</b><small>${subtitle}</small></div>
        <button class="icon-btn" id="bag-close">${icon("close")}</button>
      </div>
      <div class="bag-cap${full ? " full" : ""}">
        <div class="bag-cap-bar"><span style="width:${pct}%"></span></div>
        <div class="bag-cap-num">${n}/${cap}</div>
      </div>`;
  }

  _toggleBag() {
    // The backpack only opens while delving — in the shop you stock straight
    // onto the tables via the context action, so there's no standalone bag view.
    if (this.playerArea !== "dungeon") return;
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    this._openBag();
  }

  _openBag() {
    // The bag is a dungeon survival kit: use consumables or drop loot to free space.
    if (this.playerArea !== "dungeon") return;
    this._openBagDungeon();
  }

  _openBagDungeon() {
    const rows = this.inventory
      .map((id, i) => {
        const it = ITEMS[id];
        const useBtn = it.heal
          ? `<button class="bag-act use" data-i="${i}">Use <small>+${it.heal}${icon("heart")}</small></button>`
          : `<span class="bag-act ghost">not usable</span>`;
        return `<div class="bag-row">
          <span class="bag-face">${itemIcon(it.icon)}</span>
          <span class="bag-name">${it.name}<small>${it.base}g</small></span>
          ${useBtn}
          <button class="bag-act drop" data-i="${i}">Drop</button>
        </div>`;
      })
      .join("");
    const el = this.hud.showSheet(`
      ${this._bagHead("use a consumable, or drop loot to free space")}
      <div class="bag-list">${rows || "<small class='empty'>empty — go delve!</small>"}</div>
    `, "sheet-card bag-sheet");
    el.querySelector("#bag-close").onclick = () => this.hud.hideSheet();
    el.querySelectorAll(".bag-act.use").forEach((btn) => {
      btn.onclick = () => this._useItem(Number(btn.dataset.i));
    });
    el.querySelectorAll(".bag-act.drop").forEach((btn) => {
      btn.onclick = () => this._dropItem(Number(btn.dataset.i));
    });
  }

  _useItem(idx) {
    const itemId = this.inventory[idx];
    if (itemId == null) return;
    const it = ITEMS[itemId];
    if (!it.heal) return this.hud.toast(`${it.name} can't be used.`);
    if (this.hp >= this.maxHp) return this.hud.toast("Already at full health.");
    this._consumeHeal(idx);
    if (this.hud.sheetOpen) this._openBag();
  }

  // Pull a consumable out of the bag and kick off the over-head use flourish;
  // the actual heal lands when the item drops onto the player (see
  // _updateUseFx). Shared by manual bag use and the auto-heal below.
  _consumeHeal(idx) {
    const itemId = this.inventory[idx];
    const it = ITEMS[itemId];
    if (!it?.heal) return;
    // stagger so several heals in one burst pop one after another, not on top
    this._spawnUseFx(itemId, it.heal, this._useFx.length * 0.28);
    if (this.net.isGuest) {
      this.net.send({ t: "useReq", idx });
      // optimistic local removal so the list stays in sync until the host echoes
      this.inventory.splice(idx, 1);
    } else {
      this.inventory.splice(idx, 1);
      this._syncInv();
      this._save();
    }
  }

  // Auto-quaff the instant you're hurt, but only a consumable whose heal value
  // fits the hearts you're missing — so a big potion isn't wasted topping off a
  // single heart. Chains while more still fits (e.g. two +1s for a 2-heart hit).
  _tryAutoHeal() {
    if (this.playerArea !== "dungeon" || this.gameOver || this._respawnT >= 0) return;
    for (;;) {
      const missing = this.maxHp - this.hp;
      if (missing <= 0) break;
      // heals already in flight count against the deficit so a flurry of hits
      // doesn't over-consume before the earlier sips have landed
      let pending = 0;
      for (const fx of this._useFx) if (!fx.applied) pending += fx.heal;
      const need = missing - pending;
      if (need <= 0) break;
      let bestIdx = -1, bestHeal = 0;
      for (let i = 0; i < this.inventory.length; i++) {
        const heal = ITEMS[this.inventory[i]]?.heal || 0;
        if (heal && heal <= need && heal > bestHeal) { bestHeal = heal; bestIdx = i; }
      }
      if (bestIdx < 0) break;
      this._consumeHeal(bestIdx);
    }
    if (this.hud.sheetOpen) this._openBag();
  }

  // Spawn the item sprite above the player's head; _updateUseFx animates the
  // pop-in, hover and drop-onto-player, applying `heal` on impact.
  _spawnUseFx(itemId, heal, delay = 0) {
    const mesh = itemSprite(itemId, USE_FX_SIZE);
    mesh.position.copy(this.player.position).setY(this.player.height + 0.35);
    mesh.scale.setScalar(0.0001);
    mesh.visible = false;
    this.engine.scene.add(mesh);
    this._useFx.push({ mesh, t: -delay, heal, applied: false });
  }

  // The heal itself: bump HP, sparkle, float the gain. Local to whoever used
  // the item — the shared bag stays host-authoritative (handled in _consumeHeal).
  _applyHeal(heal) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + heal);
    this.hud.setHearts(this.hp, this.maxHp);
    this.audio.heal();
    const gained = this.hp - before;
    this.hud.float(_v2.copy(this.player.position).setY(1.8), `+${gained || heal}${icon("heart")}`, "loot");
    this.particles.burst(
      _v2.copy(this.player.position).setY(this.player.height * 0.6),
      { color: 0x7be08a, n: 12, speed: 2.6, up: 1.6, life: 0.5, size: 1.0 }
    );
  }

  _updateUseFx(dt) {
    if (!this._useFx.length) return;
    const c = this.player;
    // if the player left the dungeon / died mid-flourish, cash in any pending
    // heal and drop the sprite rather than leaving it floating in the shop
    const live = this.playerArea === "dungeon" && this._respawnT < 0 && !this.gameOver;
    for (const fx of [...this._useFx]) {
      if (!live) {
        if (!fx.applied) { fx.applied = true; this._applyHeal(fx.heal); }
        fx.mesh.removeFromParent();
        this._useFx.splice(this._useFx.indexOf(fx), 1);
        continue;
      }
      fx.t += dt;
      if (fx.t < 0) continue; // still waiting out its stagger delay
      fx.mesh.visible = true;
      const k = fx.t / USE_FX_DUR;
      const baseY = c.height + 0.35;
      let scale, y;
      if (k < 0.25) {
        scale = _easeOutBack(k / 0.25); // pop in with a little overshoot
        y = baseY;
      } else if (k < 0.6) {
        scale = 1;
        y = baseY + Math.sin((fx.t - 0.25 * USE_FX_DUR) * 14) * 0.05; // idle bob
      } else {
        const a = Math.min(1, (k - 0.6) / 0.4);
        scale = 1 - a; // shrink as it sinks into the player
        y = lerp(baseY, c.height * 0.5, a);
      }
      fx.mesh.position.set(c.position.x, y, c.position.z);
      fx.mesh.scale.setScalar(USE_FX_SIZE * Math.max(0.0001, scale));
      if (!fx.applied && k >= 0.6) { fx.applied = true; this._applyHeal(fx.heal); }
      if (k >= 1) {
        fx.mesh.removeFromParent();
        this._useFx.splice(this._useFx.indexOf(fx), 1);
      }
    }
  }

  _dropItem(idx) {
    const itemId = this.inventory[idx];
    if (itemId == null) return;
    if (this.playerArea !== "dungeon") return this.hud.toast("You can only drop while delving.");
    const it = ITEMS[itemId];
    const p = this.player.position;
    // toss it a good ways out in front of you so it lands clear of your feet
    const h = this.player.heading;
    const dropX = p.x + Math.sin(h) * DROP_FWD;
    const dropZ = p.z + Math.cos(h) * DROP_FWD;
    // brief window so you don't instantly re-grab what you just tossed
    this._pickupSuppressT = performance.now() + 1500;
    if (this.net.isGuest) {
      this.net.send({ t: "dropReq", idx, x: dropX, z: dropZ });
      this.inventory.splice(idx, 1);
    } else {
      this.inventory.splice(idx, 1);
      this.dungeon.spawnDrop(itemId, dropX, dropZ);
      this._syncInv();
      this._save();
    }
    this.audio.pickup();
    this.hud.float(_v2.copy(p).setY(1.6), `dropped ${itemIcon(it.icon)}`, "dmg");
    if (this.hud.sheetOpen) this._openBag();
  }

  // Placement menu opened by the context action at a specific empty table.
  _placeMenu(slot) {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    if (this.stash.length === 0) return this.hud.toast("Storeroom is empty — go delve!");
    const slotIdx = this.shop.slots.indexOf(slot);
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("box")}</span>
        <div><b>Place on this table</b><br/><small>tap a storeroom item to put it up for sale</small></div>
        <button class="icon-btn" id="bag-close">${icon("close")}</button></div>
      <div class="inv-grid">${this._stashRows()}</div>
    `, "sheet-card");
    el.querySelector("#bag-close").onclick = () => this.hud.hideSheet();
    el.querySelectorAll(".inv-item").forEach((btn) => {
      btn.onclick = () => {
        this._stockFromStash(Number(btn.dataset.i), slotIdx);
        this.hud.hideSheet();
      };
    });
  }

  // Opened by the context action at an occupied table: pick a storeroom item
  // to swap in (the current one drops back to the storeroom), or tap the item
  // already on show to pull it off the table entirely.
  _replaceMenu(slot) {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    const slotIdx = this.shop.slots.indexOf(slot);
    const cur = ITEMS[slot.item];
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("box")}</span>
        <div><b>Replace on this table</b><br/><small>tap a storeroom item to swap it in, or the shown item to take it back</small></div>
        <button class="icon-btn" id="bag-close">${icon("close")}</button></div>
      <div class="inv-grid">
        <button class="inv-item shown" id="take-back">${itemIcon(cur.icon)}<small>${cur.name}</small><span>take back</span></button>
      </div>
      <div class="inv-grid">${this._stashRows() || "<small class='empty'>storeroom empty — nothing to swap in</small>"}</div>
    `, "sheet-card");
    el.querySelector("#bag-close").onclick = () => this.hud.hideSheet();
    el.querySelector("#take-back").onclick = () => {
      this._unstock(slot);
      this.hud.hideSheet();
    };
    el.querySelectorAll(".inv-grid .inv-item[data-i]").forEach((btn) => {
      btn.onclick = () => {
        this._swapFromStash(Number(btn.dataset.i), slotIdx);
        this.hud.hideSheet();
      };
    });
  }

  // Swap the item on a filled table for one from the storeroom: the displayed
  // item goes back to the storeroom, the chosen item takes its place.
  _swapFromStash(idx, slotIdx) {
    if (this.playerArea !== "shop") return this.hud.toast("You can only stock in the shop.");
    const itemId = this.stash[idx];
    if (itemId == null) return;
    if (this.net.isGuest) {
      this.net.send({ t: "swapReq", idx, slotIdx });
      return;
    }
    const slot = this.shop.slots[slotIdx];
    if (!slot || !slot.item) return;
    const old = this.shop.unstockSlot(slot);
    this.stash.splice(idx, 1);
    this.shop.stockItem(itemId, slot);
    if (old != null) this.stash.push(old);
    this.audio.pickup();
    this._syncInv();
    this._syncStock();
    this._save();
  }

  _coopSheet() {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("people")}</span>
        <div><b>Co-op</b><br/><small>one deals, one delves — shared gold</small></div>
        <button class="icon-btn" id="co-close">${icon("close")}</button></div>
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

  // ================================================================ admin panel
  // Toggled with the ` (backquote) key. A dev/cheat overlay that lives outside
  // the sheet system so gameplay keeps running while it's open.
  _toggleAdmin() {
    if (this._adminOpen) {
      this.adminEl?.remove();
      this.adminEl = null;
      this._adminOpen = false;
      return;
    }
    const el = document.createElement("div");
    el.id = "admin-panel";
    el.innerHTML = `
      <div class="admin-head"><b>${icon("tools")} Admin</b><span>press \` to close</span></div>
      <div class="admin-grid">
        <button data-a="g100">${icon("coin")} +100g</button>
        <button data-a="g1k">${icon("coin")} +1000g</button>
        <button data-a="heal">${icon("heart")} Full heal</button>
        <button data-a="maxhp">${icon("plus")} +1 heart</button>
        <button data-a="god">${icon("shield")} God: <b>${this.godMode ? "ON" : "off"}</b></button>
        <button data-a="fillbag">${icon("bag")} Fill bag</button>
        <button data-a="clearbag">${icon("trash")} Empty bag</button>
        <button data-a="night">${icon("moon")} To nightfall</button>
        <button data-a="nextday">${icon("skip")} Next day</button>
        <button data-a="delve">${icon("hole")} Delve</button>
        <button data-a="floor">${icon("arrowDown")} Next floor</button>
        <button data-a="key">${itemIcon("key")} Give key</button>
        <button data-a="kill">${icon("skull")} Kill enemies</button>
        <button data-a="debt">${icon("scroll")} Skip debt</button>
        <button data-a="reset" class="danger">${icon("recycle")} Wipe save</button>
      </div>
      <div class="admin-hints">keys: <b>WASD</b> move · <b>mouse</b> aim · <b>click/E</b> act · <b>B</b> bag · <b>C</b> co-op · <b>M</b> mute</div>
    `;
    this.hud.root.appendChild(el);
    this.adminEl = el;
    this._adminOpen = true;
    el.querySelector(".admin-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) this._adminAction(btn.dataset.a);
    });
  }

  _adminAction(a) {
    switch (a) {
      case "g100": this.gainGold(100); break;
      case "g1k": this.gainGold(1000); break;
      case "heal":
        this.hp = this.maxHp;
        this.hud.setHearts(this.hp, this.maxHp);
        break;
      case "maxhp":
        this.maxHp++;
        this.hp = this.maxHp;
        this.hud.setHearts(this.hp, this.maxHp);
        break;
      case "god":
        this.godMode = !this.godMode;
        this.hud.toast(`God mode ${this.godMode ? "ON" : "off"}`);
        break;
      case "fillbag": {
        // fills whatever you're living out of: the bag below, the stash above
        const ids = Object.keys(ITEMS);
        if (this.playerArea === "dungeon") {
          while (this.inventory.length < this.invCap) this.inventory.push(pick(Math.random, ids));
        } else {
          for (let i = 0; i < this.invCap; i++) this.stash.push(pick(Math.random, ids));
        }
        this._syncInv();
        this._save();
        this.hud.toast(this.playerArea === "dungeon" ? `${icon("bag")} Bag filled` : `${icon("box")} Storeroom stocked`);
        break;
      }
      case "clearbag":
        this.inventory.length = 0;
        this.stash.length = 0;
        this._syncInv();
        this._save();
        this.hud.toast(`${icon("trash")} Bag & storeroom emptied`);
        break;
      case "night":
        if (this.phase === "day") this._nightfall();
        break;
      case "nextday":
        if (this.phase === "day") this._nightfall();
        this._sleep();
        break;
      case "delve":
        if (this.playerArea !== "dungeon") this._delve();
        break;
      case "floor":
        if (this.playerArea === "dungeon" && this.dungeon.active) {
          if (this.dungeon.floor >= MAX_FLOORS) this.hud.toast("This is the boss floor — deepest there is.");
          else this._descend();
        } else this.hud.toast("Delve first!");
        break;
      case "key":
        // into the bag while delving, into the storeroom back home
        if (this.playerArea !== "dungeon") {
          this.stash.push("key");
          this._syncInv();
          this._save();
          this.hud.toast(`${itemIcon("key")} Brass Key added to storeroom`);
        } else if (this.inventory.length < this.invCap) {
          this.inventory.push("key");
          this._syncInv();
          this._save();
          this.hud.toast(`${itemIcon("key")} Brass Key added to bag`);
        } else {
          this.hud.toast(`${icon("bag")} Bag is full!`);
        }
        break;
      case "kill":
        for (const e of [...this.dungeon.enemies]) this.dungeon.damageEnemy(e, 999);
        break;
      case "debt":
        this.debtIdx = Math.min(this.debtIdx + 1, DEBT.length);
        this._updateDebtChip();
        this.hud.toast(`${icon("scroll")} Debt skipped`);
        break;
      case "reset":
        this._reset();
        break;
    }
    // refresh god-mode label without rebuilding everything
    const g = this.adminEl?.querySelector('[data-a="god"] b');
    if (g) g.textContent = this.godMode ? "ON" : "off";
  }

  _updateDebtChip() {
    const due = DEBT[this.debtIdx];
    if (!due) this.hud.setDebt(`paid off! ${icon("crown")}`);
    else this.hud.setDebt(`${due.amt}g due day ${due.day}`, this.day >= due.day - 1);
  }

  // ================================================================ net
  onPeerJoined() {
    // host: send full state
    this.hud.toast(`${icon("people")} Partner joined!`);
    this.net.send({
      t: "welcome",
      day: this.day, phase: this.phase, gold: this.gold, debtIdx: this.debtIdx,
      doorsOpen: this.shop.doorsOpen,
      inv: this.inventory,
      stash: this.stash,
      stocked: this.shop.slots.map((s) => s.item),
      floor: this.dungeon.active ? this.dungeon.floor : 0,
      seed: this.dungeon.seed ?? 0,
      gateOpen: this.dungeon.gateOpen,
    });
    this._spawnRemote();
  }

  onJoinedHost() {
    this.hud.toast(`${icon("people")} Joined! The host runs the shop clock.`);
    this._spawnRemote();
    this.hud.hideSheet();
  }

  onPeerLeft() {
    this.hud.toast(`${icon("people")} Partner disconnected.`);
    if (this.remote) {
      this.remote.creature.dispose();
      this.remote = null;
    }
  }

  _spawnRemote() {
    if (this.remote) this.remote.creature.dispose();
    const c = new BlockyCreature("j", { height: 1.3 });
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
        this.stash = m.stash ?? [];
        if (typeof m.doorsOpen === "boolean") this.shop.setDoorsOpen(m.doorsOpen);
        this.hud.setDay(this.day, this.phase);
        this.hud.setGold(this.gold, false);
        this._updateDebtChip();
        m.stocked.forEach((item, i) => this._applyStockSlot(i, item));
        if (m.floor > 0) {
          D.generate(m.floor, m.seed);
          if (m.gateOpen) D.openGate();
        }
        break;
      }
      case "state": {
        if (m.gold !== this.gold) this.hud.setGold((this.gold = m.gold));
        this.day = m.day;
        if (m.phase !== this.phase) {
          this.phase = m.phase;
          this.hud.banner(m.phase === "day" ? `${icon("sun")} Day ${this.day}` : `${icon("moon")} Closing time`, "", 2);
        }
        this.debtIdx = m.debtIdx;
        if (typeof m.dayT === "number") this.dayT = m.dayT;
        if (typeof m.ap === "number") this.ap = m.ap;
        if (typeof m.doorsOpen === "boolean") this.shop.setDoorsOpen(m.doorsOpen);
        this.hud.setDay(this.day, this.phase);
        this._updateDebtChip();
        break;
      }
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
        if (!D.active) {
          const seed = this.day * 1000 + Math.floor(Math.random() * 999);
          D.generate(1, seed);
          this._syncState();
        }
        this.net.send({ t: "floor", n: D.floor, seed: D.seed });
        break;
      }
      case "stairsReq": {
        if (this.net.isGuest) return;
        if (D.floor >= MAX_FLOORS) return; // boss floor is the deepest
        const n = D.floor + 1;
        D.generate(n, D.seed);
        this.net.send({ t: "floor", n, seed: D.seed });
        if (this.playerArea === "dungeon") this._enterDungeon();
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
          this.hud.banner(`${icon("skull")} The seal breaks…`, "the Ogre King awakens", 2.6);
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
        this.hud.banner(`${icon("skull")} The seal breaks…`, "the Ogre King awakens", 2.6);
        this._enterBossRoom();
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
        const slot = m.slotIdx >= 0 ? this.shop.slots[m.slotIdx] : this.shop.freeSlot();
        if (slot && !slot.item && this.stash[m.idx] != null) {
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
        e.creature.setGlow(m.atk === "charge" ? [0.9, 0.45, 0.05] : m.atk === "burst" ? [0.55, 0.15, 0.8] : [0.95, 0.08, 0.05]);
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
        if (this.net.isGuest && D.active) D.spawnDrop(m.item, m.x, m.z, m.id);
        break;
      case "proj":
        // guests spawn a visual-only orb; the host owns the damage collision
        if (this.net.isGuest && D.active)
          D.projectiles.spawn(m.x, m.z, m.vx, m.vz, { color: m.color, dmg: m.dmg, radius: m.radius, life: m.life });
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
      slot.mesh = itemSprite(item);
      slot.mesh.position.copy(slot.pos);
      slot.mesh.scale.setScalar(1.4);
      this.shop.group.add(slot.mesh);
    }
  }

  _syncState() {
    if (this.net.isGuest) return;
    this.net.send({ t: "state", gold: this.gold, day: this.day, phase: this.phase, debtIdx: this.debtIdx, dayT: this.dayT, ap: this.ap, doorsOpen: this.shop.doorsOpen });
  }

  _syncInv() {
    this.net.send({ t: "inv", list: this.inventory, stash: this.stash });
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
        day: this.day, gold: this.gold, inv: this.inventory, stash: this.stash, debtIdx: this.debtIdx,
      }));
    } catch {}
  }

  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.day) {
        this._hadSave = true;
        this.day = s.day;
        this.gold = s.gold;
        // drop any item ids that no longer exist (e.g. renamed/removed items).
        // A run always resumes in the shop, so anything saved in the bag
        // (including legacy saves from before the storeroom) lands in the stash.
        this.stash = (s.stash ?? []).filter((id) => ITEMS[id]);
        this.stash.push(...(s.inv ?? []).filter((id) => ITEMS[id]));
        this.inventory = [];
        this.debtIdx = s.debtIdx ?? 0;
      }
    } catch {}
  }
}

// "used an item" flourish tuning: how long the pop-hover-drop lasts and how
// big the floating icon reads over the player's head.
const USE_FX_DUR = 0.85;
const USE_FX_SIZE = 0.8;
// how far in front of the player a dropped item lands (world units)
const DROP_FWD = 2.5;
// classic ease-out-back: overshoots past 1 then settles, giving the pop-in snap
function _easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _ray = new THREE.Raycaster();
// aim plane at roughly torso height (y = 0.6) so the cursor maps to the ground
const _aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
const _camShop = new THREE.Vector3(0, 10.2, 8.6);
const _camDungeon = new THREE.Vector3(0, 8.4, 8.2);
// pulled back + higher so the whole boss arena stays framed while the cam is fixed
const _camBoss = new THREE.Vector3(0, 13.5, 10);
// fixed look-at point for the shop so the camera holds a steady framing
const _shopCenter = new THREE.Vector3(0, 0, 0);
