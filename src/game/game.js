// Game director: player, day/night cycle, debt schedule, area transitions,
// combat glue, economy, co-op message handling. The Recettear loop:
//   morning — stock the tables, open the doors
//   day     — haggle ("capitalism, ho!"), or let your partner keep shop
//   night   — delve the dungeon below for tomorrow's merchandise
//   pay the Guild every 3rd day or lose the shop.
import * as THREE from "three";
import { rng, pick, clamp, lerp } from "../core/engine.js";
import { BlockyCreature, variantForSeed } from "../chargen/blocky.js";
import { Shop, SHOP } from "./shop.js";
import { Dungeon, DUNGEON_ORIGIN, MAX_FLOORS, bossDefFor, BOSS_ATK_GLOW } from "./dungeon.js";
import { Sewer } from "./sewer.js";
import { ITEMS, itemSprite, swordMesh } from "./items.js";
import { Particles } from "./particles.js";
import { SlashArc } from "./slash.js";
import { Coop } from "../net/coop.js";
import { Lobby } from "../net/lobby.js";
import { icon, itemIcon } from "../core/icons.js";
import { viewport } from "../core/viewport.js";

// Cross-browser fullscreen helpers (touch play runs fullscreen).
export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
export function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
  if (!fn) return;
  try {
    const r = fn.call(el);
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {}
}

const DAY_LEN = 160;
const UNSEAL_FEE = 100; // what the Guild charges to unseal the cellar for a second delve
const HOLE_FEE = 25; // toll to unseal a sewer hole's grate before delving in
// The day runs on action points, not a wall clock: each errand (opening the
// doors for a rush, heading down the cellar) burns one AP and slides the sun
// a third of the way across the dial. Out of AP = dusk.
const AP_PER_DAY = 3;
const AP_DRAIN_SECS = 4; // how long the sun takes to glide through one AP's arc
// The Guild's collector who barges in at the end of the FTUE day (see
// _updateLandlord). A fixed variant so he's the same face every campaign.
const LANDLORD_VARIANT = "r";
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
const NAME_KEY = "coincellar_name";
const FRIENDS_KEY = "coincellar_friends";
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
    this.remoteSlash = new SlashArc(engine.scene); // co-op partner's swoosh

    // --- state
    this.day = 1;
    this.phase = "day";
    this.dayT = DAY_LEN;
    this.ap = AP_PER_DAY; // errands left today — the sun tracks these, not a clock
    this.gold = 100;
    this.debtIdx = 0;
    // one cellar run a day: set the moment you drop down, sealed till morning
    this.delvedToday = false;
    this._holesToday = 0; // dungeons unsealed today — each costs more than the last
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
    this._remoteUseFx = []; // same flourish, mirrored over the co-op partner
    // Co-op floors aren't lock-stepped: the host's floor is always the "live"
    // (simulated) one, and a partner can lag a floor behind or push a floor
    // ahead onto a quiet floor. These track our view of the host's live floor
    // and whether we've chosen not to follow a partner deeper yet.
    this._hostDungeonFloor = 0;
    this._floorDesync = false;
    this._pendingLead = null; // { n, seed, hole } — where to catch up to
    this.godMode = false;
    this._adminOpen = false;
    this.paused = false;
    this._fsPaused = false; // set while a touch player is out of fullscreen
    this._escOpen = false;
    this._autoDealCd = 0; // brief breather between auto-opened haggles
    this.tutorial = null; // first-run onboarding step (see _tutStart); null once done
    this._hadSave = false; // set by _load — suppresses the tutorial for returning players
    // FTUE landlord scene: armed when the tutorial's first sale lands, played
    // out by _updateLandlord once night falls and the doors have swung shut
    this._landlordDue = false;
    this._landlord = null; // { creature, state, leg } while he's on stage
    this._landlordWaitT = 0;
    // The top-bar rent chip stays hidden until the landlord scene introduces
    // the Guild's ledger. Only the fresh solo tutorial hides it (_tutStart);
    // returning/connected players skip that beat and already know the score.
    this._rentSeen = true;

    this._load();

    // Friends: a display name (so friends can find us on the broker) plus the
    // list of names we've saved. If we already have a name, hop online right
    // away so invites can land.
    this.playerName = localStorage.getItem(NAME_KEY) || "";
    this.friends = this._loadFriends();
    if (this.playerName) this.net.goOnline(this.playerName);

    // running tally for the "good night" recap — reset each morning
    this.today = this._freshDayStats();

    // --- world
    this.shop = new Shop(this);
    this.dungeon = new Dungeon(this);
    this.sewer = new Sewer(this);
    // the shared-world lobby (Supabase Realtime): joined while in the sewer or
    // down a hole, so strangers' avatars show up alongside the co-op partner
    this.lobby = new Lobby(this);
    this.sewerHole = -1; // which sewer hole the current dungeon hangs under
    this._lobbyAvatars = new Map(); // lobby player id -> {creature, wasAtk}

    // --- player
    this.player = new BlockyCreature("a", { height: 1.3 });
    this.player.position.set(0, 0, 2.5);
    this.player.holdItem(swordMesh(0xd7dde6, 0x6e4526, 0.75));
    engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => {
      this.audio.step();
      this.particles.burst(pos, { color: 0x9a8f80, n: 1, speed: 0.4, up: 0.5, gravity: 2, life: 0.35, size: 0.7 });
    };

    this.remote = null; // {creature, buf:[{t,x,z,h}], area}
    this.highlight = this._makeHighlight();

    this._wireHud();
    this._initFullscreenGate();
    this._initLandscapeLock();
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
    if (this.paused || this._fsPaused) {
      // Paused: ESC menu / descend prompt up, or a touch player has dropped out
      // of fullscreen. Freeze the world but keep the HUD live.
      this.highlight.visible = false;
      this.hud.hideGuide();
      this.hud.hideInteractHint();
      this.hud.update();
      return;
    }
    this._updatePlayer(dt, elapsed);
    this._updateRemote(dt, elapsed);
    this._updateLobbyPlayers(dt, elapsed);
    this.shop.update(dt, elapsed);
    this._updateLandlord(dt, elapsed);
    this._autoDeal(dt);
    this.dungeon.update(dt, elapsed);
    this.sewer.update(dt, elapsed);
    this.particles.update(dt);
    this.slash.update(dt);
    this.remoteSlash.update(dt);
    this._updateUseFx(dt);
    this._updateRemoteUseFx(dt);
    this._updateTutGuide();
    this.hud.update();
    this.net.update(dt);
    this.lobby.update(dt);

    // day "timer" (host authority): the sun only moves when AP is spent —
    // dayT eases toward the mark set by the remaining AP instead of ticking
    if (!this.net.isGuest && this.phase === "day" && !this.gameOver) {
      const target = (DAY_LEN * this.ap) / AP_PER_DAY;
      const rate = DAY_LEN / AP_PER_DAY / AP_DRAIN_SECS;
      if (this.dayT > target) this.dayT = Math.max(target, this.dayT - rate * dt);
      // out of AP: the day ends the moment the final errand wraps up (rush
      // served and doors shut, player back up from the cellar) — no waiting for
      // the sun to finish its glide
      if (this.ap <= 0 && this.playerArea === "shop" && !this.shop.doorsOpen && this.shop.customers.length === 0) {
        this.dayT = 0;
        this._nightfall();
      }
    }
    if (this.phase === "day" && !this.gameOver) {
      this.hud.setDayProgress(1 - Math.max(0, this.dayT) / DAY_LEN, "day");
    }

    // camera follows the player in the dungeon, but stays put in the shop —
    // and locks onto the arena's centre once inside the boss room (fixed cam)
    const p = this.player.position;
    const inDungeon = this.playerArea === "dungeon";
    const inSewer = this.playerArea === "sewer";
    const inBoss = inDungeon && this.dungeon.active && this.dungeon.inBossRoom(p);
    const camTarget = inBoss ? this.dungeon.bossCenter : inDungeon || inSewer ? p : _shopCenter;
    const camOffset = inBoss ? _camBoss : inDungeon ? _camDungeon : inSewer ? _camSewer : _camShop;
    this.engine.camTarget.lerp(camTarget, 1 - Math.pow(0.001, dt));
    this.engine.camOffset.lerp(camOffset, 1 - Math.pow(0.1, dt));
    this.audio.setMood(this.gameOver ? null : inDungeon || inSewer ? "dungeon" : this.phase === "day" ? "shop" : null);

    // boss health bar: pinned up while the boss lives and you're in the cellar
    const boss = this.dungeon.boss;
    if (inDungeon && boss && boss.deadT < 0) {
      const bossName = boss.def?.name ?? "Ogre King of the Cellar";
      this.hud.showBossBar(boss.enraged ? `${bossName} — Enraged` : bossName, boss.enraged);
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
    if (this._holeDive) {
      this.highlight.visible = false;
      this.hud.hideInteractHint();
      this._updateHoleDive(dt, elapsed);
      return;
    }
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

    // dodge / roll (underground only) — grabbed before movement so it can override it
    if (this.input.dodgeEdge && !sheetBlocked && (this.playerArea === "dungeon" || this.playerArea === "sewer")) this._dodge();

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

    // facing follows the direction of movement
    const swinging = c.animator.attackT >= 0 && c.animator.attackT < 0.45;
    if (this._dashT >= 0) {
      // keep the roll facing its travel direction
      c.heading = Math.atan2(this._dashDX, this._dashDZ);
    } else if (swinging) {
      // hold the committed swing direction (set by _attack's aim assist) until
      // the blow lands, so the hit connects where the swoosh points
    } else if (!sheetBlocked && (mv.x || mv.y)) {
      c.heading = Math.atan2(mv.x, mv.y);
    }
    const colliders = this.playerArea === "shop" ? this.shop.colliders
      : this.playerArea === "sewer" ? this.sewer.colliders : this.dungeon.colliders;
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

    // context action — and, crucially, keep the swing and the "use this"
    // press on separate inputs so the two never clash. In the cellar the main
    // button always swings; portals / stairs / chests answer to E (a dedicated
    // touch button). Up in the shop there's no combat, so the button just acts.
    const act = this._contextAction();
    const inDungeon = this.playerArea === "dungeon";
    const hasInteract = act.label !== "swords";
    // On touch there's no separate interact button in the dungeon: the main
    // action button doubles as the interact (stairs / gate / portal) when you're
    // standing on one — so changing floors is the same tap as hitting — and
    // swings otherwise. Desktop still fires those off E.
    const foldInteract = inDungeon && hasInteract && this.input.isTouch;
    if (inDungeon) {
      this.input.setActionLabel(foldInteract ? act.label : "swords", foldInteract);
      this.input.setInteract(act.label, hasInteract && !this.input.isTouch);
    } else {
      this.input.setActionLabel(act.label);
      this.input.setInteract(null, false);
    }
    this._updateHighlight(act.focus, act.color, elapsed);
    // control hint under the highlight ring: keycap + verb on desktop, verb
    // only on touch (the action button itself already pulses there)
    if (act.focus && act.hint && !sheetBlocked && !this.gameOver)
      this.hud.interactHint(act.focus, act.hint, this.input.isTouch ? "" : "E");
    else this.hud.hideInteractHint();
    if (!sheetBlocked && this._dashT < 0) {
      // E / interact button (desktop): fire the context action (portal, stairs, …)
      if (this.input.interactEdge && hasInteract) act.fn();
      // Space / click / action button: interact when folded (touch, standing on
      // a stairs / gate / portal), otherwise swing in the cellar, act in the shop
      if (this.input.actionEdge) {
        if (foldInteract) act.fn();
        else if (inDungeon) this._attack();
        else act.fn();
      }
    }

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

  // Keyboard shortcuts for the on-screen actions + the admin panel.
  _handleKey(code) {
    // An open modal takes keyboard priority: J/K move the highlight, Enter
    // picks it, Esc backs out — and the haggle sheet remaps those to nudge the
    // price / seal the deal / walk away. The esc-menu keeps Esc = resume; the
    // admin panel isn't a sheet, so it never intercepts here.
    if (this.hud.sheetOpen && !this._adminOpen) {
      if (code === "Escape" && this._escOpen) return this._closeEscMenu();
      if (this.hud.sheetKey(code)) return;
    }
    switch (code) {
      case "Backquote": return this._toggleAdmin();
      case "Escape":
        if (this._adminOpen) return this._toggleAdmin();
        if (this._escOpen) return this._closeEscMenu();
        if (this.hud.sheetOpen) return this.hud.hideSheet();
        return this._toggleEscMenu();
      case "KeyB":
      case "KeyI": return this._toggleBag();
      case "KeyC": return this._friendSheet();
      case "KeyM": return document.getElementById("mute-btn").click();
      // NB: E / F (interact) are read as an input edge in _updatePlayer so they
      // stay separate from the Space/click attack — see the action routing there.
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
      // the shopfront doors: open up for customers by day, head home by night.
      // There's no manual "close up" — the doors shut themselves once the rush
      // is over, so only offer the door when there's actually something to do.
      if (p.distanceTo(this.shop.doorInside) < 1.5) {
        const doorFocus = _focus.copy(this.shop.doorInside).setY(0.06).clone();
        if (this.phase === "night")
          return { label: "home", hint: "Go home", fn: () => this._doorPrompt(), focus: doorFocus, color: 0x8fd0ff };
        // day, but sold out with the cellar spent → the doors offer an early night
        if (this._daySpent())
          return { label: "bed", hint: "Turn in", fn: () => this._doorPrompt(), focus: doorFocus, color: 0x8fd0ff };
        if (!this.shop.doorsOpen)
          return { label: "shop", hint: "Open up", fn: () => this._doorPrompt(), focus: doorFocus, color: 0x66ff9e };
        // doors already open for the day's rush — nothing to do at the door
      }
      // the guided first day only offers the cellar on its delve step — no
      // re-delving until the FTUE's walked you through stocking and selling
      const tutBlocksCellar = this.tutorial && this.tutorial !== "delve";
      if (!tutBlocksCellar && this.shop.trapdoorOpen && p.distanceTo(this.shop.trapdoorPos) < 1.5)
        return { label: "hole", hint: "Delve", fn: () => this._delve(), focus: _focus.copy(this.shop.trapdoorPos).setY(0.06).clone(), color: 0xb98cff };
      // already delved today (solo): the Guild will unseal the cellar for a fee
      if (!tutBlocksCellar && !this.net.connected && this.delvedToday && p.distanceTo(this.shop.trapdoorPos) < 1.5)
        return { label: "hole", hint: "Unseal", fn: () => this._delve(), focus: _focus.copy(this.shop.trapdoorPos).setY(0.06).clone(), color: 0x9aa0aa };
      // display tables: walk up to a slot to stock it. A stocked slot offers a
      // swap / take-back; an empty one takes stock from the storeroom.
      const slot = this._tableSlotTarget();
      if (slot) {
        if (slot.item)
          return { label: "box", hint: "Swap", fn: () => this._replaceMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0xff9d5c };
        if (this.stash.length > 0)
          return { label: "box", hint: "Stock", fn: () => this._placeMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0x66ff9e };
      }
      return { label: "swords", fn: () => this._attack() };
    }
    // sewer: the ladder home and the four dungeon mouths
    if (this.playerArea === "sewer") {
      _v.copy(this.sewer.exitPos);
      if (_v.distanceTo(p) < 1.7)
        return { label: "home", hint: "Back to shop", fn: () => this._returnHome(), focus: _v.clone().setY(0.06), color: 0x8fd0ff };
      for (const hole of this.sewer.holes) {
        _v.copy(hole.pos);
        if (_v.distanceTo(p) < 1.8) {
          if (!hole.open)
            return { label: "coin", hint: `Unseal ${this._holeFee()}g`, fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: 0x9aa0aa };
          return { label: "hole", hint: hole.name, fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: hole.color };
        }
      }
      return { label: "swords", fn: () => this._attack() };
    }
    // dungeon (positions are group-local, player is world — offset). Leaving
    // the cellar is folded into the stairs prompt now, so there's no separate
    // return circle at the entrance.
    if (this.dungeon.active) {
      // the return portal left behind by the fallen boss: step in to go home
      if (this.dungeon.returnPortal) {
        _v.copy(this.dungeon.returnPortal.pos);
        if (_v.distanceTo(p) < 1.7) return { label: "home", hint: "Return", fn: () => this._returnHome(), focus: _v.clone().setY(0.06), color: 0x7fd8ff };
      }
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
      // chests aren't a button any more — you crack them open with the sword
      // (handled in dungeon.meleeHit). We still ring the nearest one and prompt
      // "Hit" so it reads as a target for the swing rather than a walk-up prompt.
      for (const chest of this.dungeon.chests) {
        if (chest.opened) continue;
        _v.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.7) return { label: "swords", hint: "Hit", fn: () => this._attack(), focus: _v.clone().setY(0.06), color: 0xffd34d };
      }
    }
    return { label: "swords", fn: () => this._attack() };
  }

  // Which display slot the "Stock / Swap" action lands on: the nearest slot the
  // player is standing beside.
  _tableSlotTarget() {
    const p = this.player.position;
    let best = null, bd = 1.5;
    for (const slot of this.shop.slots) {
      const d = _v.copy(slot.pos).setY(0).distanceTo(p);
      if (d < bd) { bd = d; best = slot; }
    }
    return best;
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
      range: finisher ? 2.8 : 2.1,
      arc: finisher ? -0.2 : 0.3, // the finisher sweeps a much wider arc
      knock: finisher ? 1.7 : 1,
    };

    // gentle aim assist: bend the swing toward the nearest foe in front so a
    // hit lands without needing pixel-perfect aim (this is why melee used to
    // only connect when an enemy was practically touching you). The committed
    // heading is then held through the swing (see the facing block above) so
    // the delayed hit lands where the swoosh points.
    this.player.heading = this._assistedHeading(this.player.heading);
    const h = this.player.heading;
    // crescent swoosh — larger + warmer on the finisher
    _v.copy(this.player.position).setY(0.62);
    this.slash.play(_v, h, finisher ? 1.5 : 1);
    _v.set(this.player.position.x + Math.sin(h) * 1.4, 0.8, this.player.position.z + Math.cos(h) * 1.4);
    this.particles.burst(_v, { color: finisher ? 0xffe0a0 : 0xdfe8ff, n: finisher ? 12 : 7, speed: finisher ? 3 : 2.1, up: 1.4, gravity: 3, life: 0.3, size: 0.85 });
    if (finisher) {
      this.audio.finisher();
    }
    // Tell the partner to swing right now. The periodic "p" snapshot only
    // samples at ~11 Hz, so a quick swing can slip between packets — an explicit
    // event guarantees the swoosh (and its committed heading) always land.
    this.net.send({ t: "atk", h, finisher: finisher ? 1 : 0 });
  }

  // Pick a swing heading with a bit of aim assist: if a live foe sits within
  // reach and roughly in front, snap the swing onto it; otherwise keep the
  // player's own facing. Favours whatever's closest to the current aim, then
  // by distance, and ignores anything clearly behind you.
  _assistedHeading(h) {
    if (this.playerArea !== "dungeon" || !this.dungeon.active) return h;
    const p = this.player.position;
    const fwdX = Math.sin(h), fwdZ = Math.cos(h);
    const ASSIST = 3.0;
    let best = null, bestScore = -Infinity;
    for (const e of this.dungeon.enemies) {
      if (e.deadT >= 0) continue;
      const dx = e.creature.position.x - p.x;
      const dz = e.creature.position.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.001 || dist > ASSIST + e.creature.radius) continue;
      const dot = (dx * fwdX + dz * fwdZ) / dist;
      if (dot < -0.15) continue; // don't wheel around to hit something behind
      const score = dot * 2 - dist * 0.15;
      if (score > bestScore) { bestScore = score; best = { dx, dz }; }
    }
    return best ? Math.atan2(best.dx, best.dz) : h;
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
    this.player.holdItem(swordMesh(0xd7dde6, 0x6e4526, 0.75));
    this.engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => this.audio.step();
    this.playerArea = "shop";
    this.lobby.leave();
    this.hud.showHearts(false);
    this.hud.showBag(false);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false);
    this.hud.showDebt(this._rentSeen);
    this.input.setDodgeVisible(false);
    this._save();
  }

  playersInDungeon() {
    const list = [];
    if (this.playerArea === "dungeon" && this._respawnT < 0) list.push({ creature: this.player, local: true });
    // only count the partner as a target while they share our floor — the host
    // simulates one floor, so a partner off on another floor isn't in the fight
    if (this.remote && this.remote.area === "dungeon" && !this.remote.dead &&
        (this.remote.floor < 0 || this.remote.floor === this.dungeon.floor))
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
    // the loot flies across the screen into the backpack
    this.hud.flyToBag(_v.copy(drop.mesh.position).setY(0.8), itemIcon(it.icon));
    this._tutAdvance("loot");
    this._save();
  }

  // Floating "picked up X" label at a drop's spot — used to surface the co-op
  // partner's grabs on the local screen (the picker sees their own via
  // _pickupDrop). Skipped if the drop is in a different area than us.
  _floatPickup(drop) {
    if (this.playerArea !== "dungeon") return;
    const it = ITEMS[drop.item];
    if (!it) return;
    this.hud.float(_v.copy(drop.mesh.position).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
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

  // A plain-table sale: no haggle, the shopper pays full sticker price (100% of
  // the item's value) and leaves happy. Driven by the host's shop sim, so the
  // wallet + stock stay authoritative; the combo streak is a haggle-only reward.
  _autoSell(cust, slot) {
    const item = ITEMS[slot.item];
    if (!item) return;
    const price = item.base;
    this.shop.unstockSlot(slot);
    cust.state = "happy";
    cust.t = 0;
    cust.creature.animator.squash.kick(6);
    this.hud.emote(cust.creature, "faceSmile", 1.4);
    this.today.sold++;
    this.today.earned += price;
    this.gainGold(price, cust.creature.position);
    this._saleJuice(price, "good", cust.creature.position);
    this._tutAdvance("sell");
    this._syncStock();
    this._save();
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
    this._holesToday = 0; // dungeon tolls reset to the base price each dawn
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
    this._rentSeen = false; // the landlord scene reveals the rent chip later
    this.hud.showDebt(false); // _wireHud already ran — pull the chip back down
    // FTUE beat: you wake with the morning already half gone — one errand's
    // worth of sun is spent, so the first day funnels straight through the
    // guided loop (delve + open = the two AP left) and ends on the first sale.
    this.ap = AP_PER_DAY - 1;
    setTimeout(() => this._tutHint(), 3200); // let the intro banner clear first
  }

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      delve: `${icon("hole")} Your shelves are bare — step onto the trapdoor to delve for stock`,
      return: `${icon("arrowDown")} Take the stairs to bring your loot back to the shop`,
      stock: `${icon("box")} Stand at a glowing table and place your loot to sell it`,
      open: `${icon("shop")} Now open the doors to let a customer in`,
      sell: `${icon("speak")} Haggle a good price to seal your first sale`,
    };
    if (hints[this.tutorial]) this.hud.toast(hints[this.tutorial]);
  }

  // Called at each loop milestone with the step it completes; advances (and
  // re-hints) only if that's the step we're currently waiting on.
  _tutAdvance(step) {
    if (this.tutorial !== step) return;
    const order = ["delve", "loot", "return", "stock", "open", "sell"];
    this.tutorial = order[order.indexOf(step) + 1] || null;
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
    // tutorial done — the landlord scene delivers the "now pay the Guild"
    // payoff in person once the doors shut on this first sale
    else this._landlordDue = true;
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
        // nothing to fight (e.g. the monster-free tutorial room) — point at the
        // nearest unopened chest so the player knows to crack it for stock
        if (!best) for (const chest of this.dungeon.chests) {
          if (chest.opened) continue;
          _v2.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
          const d = _v2.distanceToSquared(p);
          if (d < bestD) { bestD = d; best = _v2.clone(); text = "Smash the chest for loot"; }
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
    // keep the closing banner terse when the landlord's about to barge in
    if (this._landlordDue) this.hud.banner(`${icon("moon")} Closing time`, "", 1.6);
    else this.hud.banner(`${icon("moon")} Closing time`, spent ? `the cellar's sealed — sleep, or pay the Guild ${UNSEAL_FEE}g to unseal it` : "delve the cellar, or sleep to open again", 2.6);
    for (const cust of [...this.shop.customers]) {
      if (cust.state !== "haggling") cust.state = "leave";
    }
    this._syncState();
  }

  // ---- the FTUE landlord scene ---------------------------------------------
  // Night falls on the first sale, the doors swing shut… and the Guild's
  // collector throws them open again, marches in, demands the rent, and leaves
  // the new shopkeep staring at the ledger. Runs once, at the end of the
  // tutorial day (armed by _tutAdvance, so solo + fresh save only).
  _updateLandlord(dt, elapsed) {
    if (this._landlordDue && !this._landlord) {
      // wait for the stage to clear: night, everyone out, doors fully shut,
      // shopkeep home and no sheet up — then a beat of quiet before the BANG
      const staged = this.phase === "night" && this.playerArea === "shop"
        && this.shop.customers.length === 0 && this.shop._doorAngle < 0.08
        && !this.hud.sheetOpen && !this.gameOver;
      this._landlordWaitT = staged ? this._landlordWaitT + dt : 0;
      if (this._landlordWaitT < 1.1) return;
      this._landlordDue = false;
      const creature = new BlockyCreature(LANDLORD_VARIANT, { height: 1.55 });
      creature.position.copy(this.shop.doorPos);
      creature.heading = 0; // facing into the shop
      this.shop.group.add(creature);
      this._landlord = { creature, state: "enter", leg: 0 };
      this.shop.doorHeld = true; // he lets himself in
      this.audio.doorbell();
      this.engine.shake(0.22);
      return;
    }
    const lord = this._landlord;
    if (!lord) return;
    lord.creature.update(dt, elapsed);
    const walkTo = (tx, tz, speed = 2.4) => {
      const c = lord.creature.position;
      const dx = tx - c.x, dz = tz - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) return true;
      const step = Math.min(d, speed * dt);
      c.x += (dx / d) * step;
      c.z += (dz / d) * step;
      lord.creature.heading = Math.atan2(dx, dz);
      return false;
    };
    switch (lord.state) {
      case "enter":
        if (walkTo(this.shop.doorInside.x, this.shop.doorInside.z + 1.1)) {
          lord.state = "talk";
          this._landlordTalk();
        }
        break;
      case "talk": {
        // square up to the shopkeep while he growls
        const dx = this.player.position.x - lord.creature.position.x;
        const dz = this.player.position.z - lord.creature.position.z;
        if (dx * dx + dz * dz > 0.01) lord.creature.heading = Math.atan2(dx, dz);
        // Esc can force-hide a sheet without a cancel button — the landlord
        // won't be brushed off: reshow the line he's on
        if (!this.hud.sheetOpen) this._landlordSay(lord.line ?? 0);
        break;
      }
      case "leave":
        if (lord.leg === 0) {
          if (walkTo(this.shop.doorPos.x, this.shop.doorPos.z)) {
            lord.leg = 1;
            this.shop.doorHeld = false; // the doors bang shut behind him
          }
        } else if (walkTo(this.shop.streetHalfX, this.shop.streetWalkZ, 2.0)) {
          lord.creature.removeFromParent();
          this._landlord = null;
          this._landlordFarewell();
        }
        break;
    }
  }

  _landlordTalk() {
    this._landlordSay(0);
  }

  // Once the collector's slammed the door behind him, the shopkeep sighs and
  // resolves to turn in — closing the FTUE on a beat that nudges them home.
  _landlordFarewell() {
    this.hud.showDialogue({
      name: "YOU", variant: this.player?.variant ?? "a", side: "left",
      text: `“I better go back home.”`, btn: "…",
      onNext: () => {
        this.hud.hideSheet();
        this.hud.toast(`${icon("crown")} That's the loop — delve, stock, deal. Keep the Guild paid!`);
        // turn in for the night, same as tapping "Go home" at the door
        this._showDayRecap();
      },
    });
    this.audio.haggle();
  }

  // Show line `i` of the landlord exchange (re-entrant so the talk-state
  // watchdog can reshow the current line if the sheet gets dismissed).
  _landlordSay(i) {
    const due = DEBT[this.debtIdx];
    const lines = [
      { name: "LANDLORD", variant: LANDLORD_VARIANT, side: "right",
        text: `“Rent, shopkeep. The Guild collects.”` },
      { name: "YOU", variant: this.player?.variant ?? "a", side: "left",
        text: `“I can't pay yet — give me a few days.”` },
      { name: "LANDLORD", variant: LANDLORD_VARIANT, side: "right",
        text: `“<b>THREE DAYS</b>${due ? ` — ${due.amt}g by day ${due.day}` : ""}, or the shop is ours.”`, btn: "…" },
    ];
    if (i >= lines.length) {
      this.hud.hideSheet();
      // the collector's laid out the terms — the ledger chip goes live now
      this._rentSeen = true;
      this.hud.showDebt(true);
      return this._showRentSheet({ intro: true });
    }
    if (this._landlord) this._landlord.line = i;
    this.hud.showDialogue({ ...lines[i], onNext: () => this._landlordSay(i + 1) });
    if (lines[i].name === "LANDLORD") this.audio.deny();
    else this.audio.haggle();
  }

  // The Guild's rent ledger: the whole payment schedule, what's been paid, and
  // a "pay now" for settling the current installment early. Introduced by the
  // landlord scene, then reachable all campaign by tapping the debt chip.
  _showRentSheet({ intro = false } = {}) {
    const due = DEBT[this.debtIdx];
    const rows = DEBT.map((d, i) => {
      const cls = i < this.debtIdx ? " paid" : i === this.debtIdx ? " due" : "";
      return `<div class="recap-row rent-row${cls}">${icon(i < this.debtIdx ? "crown" : "scroll")}
        <span class="recap-label">Day ${d.day}</span>
        <span class="recap-val">${d.amt}g${i < this.debtIdx ? " — paid" : ""}</span></div>`;
    }).join("");
    const canPay = due && this.gold >= due.amt && !this.net.isGuest;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("scroll")}</span>
        <div><b>The Guild's rent ledger</b><br/><small>${due ? `next: ${due.amt}g due day ${due.day} · you have ${this.gold}g` : "all paid — the shop is yours!"}</small></div></div>
      <div class="recap-rows rent-rows">${rows}</div>
      <div class="sheet-btns">
        <button class="btn deny" id="rent-close">${intro ? `${icon("moon")} Three days…` : `${icon("close")} Close`}</button>
        ${due ? `<button class="btn deal" id="rent-pay" ${canPay ? "" : "disabled"}>${icon("coin")} Pay ${due.amt}g now</button>` : ""}
      </div>
    `, "sheet-card rent-sheet");
    const close = () => {
      this.hud.hideSheet();
      // scene wrap-up: the landlord's said his piece — see himself out
      if (intro && this._landlord?.state === "talk") this._landlord.state = "leave";
    };
    el.querySelector("#rent-close").onclick = close;
    const pay = el.querySelector("#rent-pay");
    if (pay) pay.onclick = () => {
      if (!this._payRent()) return;
      close();
    };
  }

  // Settle the current installment from the ledger (early or on the day).
  // The dawn auto-collection in _morning stays as the enforcement backstop.
  _payRent() {
    const due = DEBT[this.debtIdx];
    if (!due || this.gold < due.amt || this.net.isGuest) return false;
    this.gold -= due.amt;
    this.debtIdx++;
    this.hud.setGold(this.gold);
    this.audio.victory();
    this.hud.banner(`${icon("scroll")} Paid ${due.amt}g to the Guild!`, this.debtIdx >= DEBT.length ? "The shop is YOURS!" : `next payment: day ${DEBT[this.debtIdx].day}`, 3);
    if (this.debtIdx >= DEBT.length && !this.victory) {
      this.victory = true;
      setTimeout(() => this._victoryScreen(), 2600);
    }
    this._updateDebtChip();
    this._syncState();
    this._save();
    return true;
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
    // no sleeping through the landlord's visit
    if (this._landlord || (this._landlordDue && this.phase === "night"))
      return this.hud.toast(`${icon("alert")} Someone's at the door…`);
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
    ].filter((r) => r.show);

    const rowsHtml = rows
      .map((r, i) => `<div class="recap-row" style="--i:${i}">${icon(r.ic)}<span class="recap-label">${r.label}</span><span class="recap-val">${r.val}</span></div>`)
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
    this.sewerHole = -1;
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

    // daytime. The shopfront shuts itself once the rush is over, so there's no
    // manual "close up" — the door only opens up, or (once you've sold out)
    // offers to turn in early.
    if (this._daySpent()) {
      const el = this.hud.showSheet(`
        <div class="sheet-title"><span class="big-emoji">${icon("bed")}</span>
          <div><b>Turn in early?</b><br/><small>nothing left to sell — call it a day</small></div></div>
        <div class="sheet-btns">
          <button class="btn deny" id="door-no">${icon("close")} Not yet</button>
          <button class="btn deal" id="door-sleep">${icon("bed")} Turn in early</button>
        </div>
      `, "sheet-card");
      el.querySelector("#door-sleep").onclick = () => {
        this.hud.hideSheet();
        this._sleep();
      };
      el.querySelector("#door-no").onclick = () => this.hud.hideSheet();
      return;
    }
    // doors already open — they'll swing shut on their own when the rush ends
    if (this.shop.doorsOpen) return;
    // tutorial: no opening up before there's something on the tables — the
    // FTUE walks delve → stock → open in that order, so hold the doors shut
    if (this.tutorial && this.tutorial !== "open" && this.tutorial !== "sell") {
      this.hud.toast(this.tutorial === "stock"
        ? `${icon("box")} Put your loot on a table before opening up`
        : `${icon("hole")} Nothing to sell yet — delve the cellar for stock first`);
      this.audio.deny();
      return;
    }
    // opening up is one of the day's errands — no AP, no rush
    if (this.ap <= 0) {
      this.hud.toast(`${icon("moon")} The day's spent — no time to open up again`);
      this.audio.deny();
      return;
    }
    // FTUE: skip the confirm modal — the guide's already told them to open up,
    // so a tap on the doors just swings them wide
    if (this.tutorial === "open") return this._openShopDoors();
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("shop")}</span>
        <div><b>Open the doors?</b><br/><small>the rush takes a chunk of the day (${icon("sun")} 1 of ${this.ap} left)</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="door-no">${icon("close")} Not yet</button>
        <button class="btn deal" id="door-yes">${icon("shop")} Open up</button>
      </div>
    `, "sheet-card");
    el.querySelector("#door-yes").onclick = () => {
      this.hud.hideSheet();
      this._openShopDoors();
    };
    el.querySelector("#door-no").onclick = () => this.hud.hideSheet();
  }

  // Swing the shopfront open for the day's rush. The whole crowd arrives at
  // once — but a crowd-less opening (bare tables) costs nothing; only a real
  // rush burns an AP.
  _openShopDoors() {
    this.shop.setDoorsOpen(true);
    this.shop.beginWave();
    if (this.shop.stockedCount() > 0) {
      this._spendAP();
      this.hud.toast(`${icon("shop")} Doors open — here comes the crowd!`);
    } else {
      this.hud.toast(`${icon("box")} Doors open… but bare tables send folks right back out`);
    }
    this._tutAdvance("open");
    this._syncState();
  }

  // ================================================================ dungeon
  _delve() {
    // the landlord's on his way in (or mid-tirade) — the cellar can wait
    if (this._landlord || (this._landlordDue && this.phase === "night")) {
      this.hud.toast(`${icon("alert")} Someone's at the door…`);
      return;
    }
    // the guided first day is a one-way trip: once you've hauled up your first
    // stock, the cellar stays shut so the FTUE can walk you through stocking and
    // selling before you delve again
    if (this.tutorial && this.tutorial !== "delve") {
      this.hud.toast(`${icon("box")} Finish setting up shop before delving again`);
      return;
    }
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
      this.sewerHole = -1;
      this.net.send({ t: "dungeonReset" });
      this.hud.toast(`${icon("hole")} The seal cracks open — one more run`);
      this._delve();
    };
    el.querySelector("#unseal-no").onclick = () => this.hud.hideSheet();
  }

  // Dropping through the trapdoor lands in the shared sewer now, not straight
  // in a dungeon — the holes down there are the real entrances. The tutorial
  // keeps the old direct drop: a private single-floor cellar on a random seed,
  // no sewer, no lobby (sewerHole stays -1 so _enterDungeon never joins one).
  _startDelve() {
    if (this.tutorial) {
      this.sewerHole = -1;
      if (!this.dungeon.active)
        this.dungeon.generate(1, this.day * 1000 + Math.floor(Math.random() * 999), true);
      // plunge down the cellar trapdoor into the private tutorial floor
      this._beginHoleDive(this.shop.trapdoorPos, () => this._enterDungeon());
      return;
    }
    // drop down the cellar trapdoor into the shared sewer — dive in first
    this._beginHoleDive(this.shop.trapdoorPos, () => this._enterSewer());
  }

  _enterSewer() {
    this.playerArea = "sewer";
    this.sewer.resetHoles(); // every visit, the mouths are barred again
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false); // the sewer's a safe hub — keep gold up top
    this.hud.showDebt(false);
    this.input.setDodgeVisible(false);
    if (this.hud.sheetOpen) this.hud.hideSheet();
    this.player.position.copy(this.sewer.entrancePos).add(_v.set(0, 0, -1.4));
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this._snapCamera();
    this.lobby.join("sewer");
    this.hud.banner(`${icon("hole")} The Sewers`, "shared tunnels — every hole hides its own dungeon", 2.4);
  }

  // Confirm sheet at a sewer hole's lip, mirroring the stairs prompt. A barred
  // hole first asks for the toll to unseal its grate; an open one offers the dive.
  _holePrompt(id) {
    if (this.hud.sheetOpen) return;
    const hole = this.sewer.holes[id];
    if (!hole) return;
    if (!hole.open) return this._unsealHolePrompt(id);
    this.paused = !this.net.connected;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("hole")}</span>
        <div><b>${hole.name}</b><br/><small>a dungeon lies below — today's layout is the same for everyone</small></div></div>
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
  }

  // The Guild's toll to unseal a dungeon climbs with every one you crack open
  // today — the first is cheap, each dive after that costs more.
  _holeFee() {
    return HOLE_FEE * (this._holesToday + 1);
  }

  // The grate over a hole is sealed — pay the Guild's toll to crank it open.
  _unsealHolePrompt(id) {
    const hole = this.sewer.holes[id];
    const fee = this._holeFee();
    const broke = this.gold < fee;
    this.paused = !this.net.connected;
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("hole")}</span>
        <div><b>${hole.name}</b><br/><small>a grate bars the way — pay the Guild ${fee}g to unseal it</small></div></div>
      <div class="sheet-btns">
        <button class="btn deny" id="hole-no">${icon("close")} Not this one</button>
        <button class="btn deal" id="hole-pay" ${broke ? "disabled" : ""}>${icon("coin")} Pay ${fee}g${broke ? ` (you have ${this.gold}g)` : ""}</button>
      </div>
    `, "sheet-card");
    el.querySelector("#hole-pay").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
      this._openHole(id);
    };
    el.querySelector("#hole-no").onclick = () => {
      this.paused = false;
      this.hud.hideSheet();
    };
  }

  // Pay the toll and crank a hole's grate open. Host-authoritative wallet: a
  // guest asks the host to spend, then everyone's lid swings up via "holeOpen".
  _openHole(id) {
    if (this.sewer.holes[id]?.open) return;
    if (this.net.isGuest) return this.net.send({ t: "holeReq", id });
    const fee = this._holeFee();
    if (this.gold < fee) return this.hud.toast(`${icon("coin")} Not enough gold`);
    this._spendGold(fee, this.player.position);
    this._holesToday++;
    this.sewer.openHole(id);
    this.audio.stairs();
    this.net.send({ t: "holeOpen", id });
  }

  // Jump into hole `id`. Its dungeon seed is derived from the hole and the UTC
  // day, so every player who picks this hole today delves an identical layout
  // (and shares the hole's realtime channel). In PeerJS co-op the pair still
  // shares one dungeon: the host generates, the guest requests.
  _enterHole(id) {
    if (this.net.isGuest) {
      if (!this.dungeon.active) {
        this.sewerHole = id;
        this._wantDelve = true;
        this.net.send({ t: "delveReq", hole: id });
        return;
      }
      // the pair shares one dungeon: whichever hole is open is where we land
      // (sewerHole already tracks it from the host's "floor" message)
      this._enterDungeon();
      return;
    }
    if (!this.dungeon.active || this.sewerHole !== id) {
      this.sewerHole = id;
      const seed = holeSeed(id);
      this.dungeon.generate(1, seed);
      this.net.send({ t: "floor", n: 1, seed, hole: id });
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
  }

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
  }

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
    // dropping down (not each floor) burns an errand — guarded by delvedToday
    // so descending stairs mid-run doesn't charge again
    if (!this.net.isGuest && !this.delvedToday) this._spendAP();
    this.delvedToday = true; // this run counts as the day's one delve
    this.playerArea = "dungeon";
    this.hud.showHearts(true);
    this.hud.showBag(true);
    this.hud.showGold(true);
    this.hud.setGoldCorner(true);
    this.hud.showDebt(false);
    this.input.setDodgeVisible(true);
    _v.copy(this.dungeon.entrancePos).add(DUNGEON_ORIGIN);
    this.player.position.set(_v.x + 0.8, 0, _v.z + 0.8);
    this.player.animator.prevPos.copy(this.player.position);
    this._invulnT = Math.max(this._invulnT, LEVEL_INVULN); // grace on arrival
    this.today.deepest = Math.max(this.today.deepest, this.dungeon.floor);
    // hop onto this hole's realtime channel so fellow delvers show up
    if (this.sewerHole >= 0) this.lobby.join(`hole:${utcDay()}:${this.sewerHole}`);
    this.audio.stairs();
    this._snapCamera();
    const finalFloor = this.dungeon.floor >= MAX_FLOORS;
    const place = this.sewer.holes[this.sewerHole]?.name ?? "Cellar";
    this.hud.banner(
      finalFloor ? `${icon("skull")} ${place} — Final Floor` : `${icon("hole")} ${place} — Floor ${this.dungeon.floor}`,
      finalFloor ? (this._hasBossKey() ? "unlock the sealed door — the boss waits within" : "find a Brass Key to breach the boss door") : "",
      finalFloor ? 2.6 : 1.6
    );
    this._tutAdvance("delve");
  }

  _returnHome() {
    this.playerArea = "shop";
    this._floorDesync = false;
    this._pendingLead = null;
    this.lobby.leave();
    this._depositBag();
    this.hud.showHearts(false);
    this.hud.showBag(false);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false);
    this.hud.showDebt(this._rentSeen);
    this.input.setDodgeVisible(false);
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
    const area = this.playerArea;
    const follow = area === "dungeon" || area === "sewer";
    this.engine.camTarget.copy(follow ? this.player.position : _shopCenter);
    this.engine.camOffset.copy(area === "dungeon" ? _camDungeon : area === "sewer" ? _camSewer : _camShop);
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
    const n = this.dungeon.floor + 1;
    const seed = this.dungeon.seed;
    this.dungeon.generate(n, seed);
    this._hostDungeonFloor = n;
    this.net.send({ t: "floor", n, seed, hole: this.sewerHole, lead: 1 });
    this._enterDungeon();
    this.engine.shake(0.2);
  }

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
    this._bossAwakenBanner();
    this._enterBossRoom();
  }

  // "The seal breaks…" with this hole's boss in the subtitle (host + guests)
  _bossAwakenBanner() {
    this.hud.banner(`${icon("skull")} The seal breaks…`, bossDefFor(this.sewerHole).awaken, 2.6);
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
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(this.sewerHole).name;
    this.hud.banner(`${icon("warning")} ${name} is enraged!`, "faster, angrier — and it brought friends", 2.4);
  }

  // The boss is down: fanfare, a shower of sparks, and the treasure it guarded.
  onBossDefeated(pos = null) {
    this.audio.victory();
    this.engine.shake(0.45);
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(this.sewerHole).name;
    this.hud.banner(`${icon("crown")} ${name} falls!`, "grab the spoils, then take the portal home", 3.4);
    if (pos) {
      this.particles.burst(_v.copy(pos).setY(1), { color: 0xffe08a, n: 30, speed: 5, up: 2.2, life: 1.1, size: 1.3 });
      // a way out opens where the boss fell — step in to head straight home
      this.dungeon.spawnReturnPortal(pos.x, pos.z);
    }
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
    this.hud.showDebt(this.playerArea !== "dungeon" && this._rentSeen);
    this.input.setDodgeVisible(this.playerArea === "dungeon");
    // the debt chip doubles as the door to the Guild's rent ledger
    this.hud.debtChip.onclick = () => {
      if (this.hud.sheetOpen || this.gameOver || this.playerArea === "dungeon") return;
      this._showRentSheet();
    };
    document.getElementById("coop-btn").onclick = () => this._friendSheet();
    document.getElementById("pause-btn").onclick = () => this._toggleEscMenu();
    // set the mute button to match saved preference
    document.getElementById("mute-btn").innerHTML = icon(this.audio.muted ? "soundOff" : "soundOn");
  }

  // --------------------------------------------------------- fullscreen gate
  // On touch, the game runs fullscreen. The first tap enters it (wired from the
  // Play button), and if the player ever drops out we freeze the sim and put up
  // a "tap to go fullscreen" gate. Skipped where the Fullscreen API is missing
  // (e.g. iPhone Safari) so the game stays playable.
  _initFullscreenGate() {
    this.fsGate = document.getElementById("fs-gate");
    if (!this.fsGate || !this.input.isTouch) return;
    const el = document.documentElement;
    const supported = !!(el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen);
    if (!supported) return;
    const sync = () => {
      const fs = isFullscreen();
      this._fsPaused = !fs;
      this.fsGate.classList.toggle("hidden", fs);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    this.fsGate.addEventListener("click", () => requestFullscreen());
    sync();
  }

  // ------------------------------------------------------------ landscape lock
  // On touch the game only plays in landscape, and we never ask the player to
  // tilt: we just render landscape directly. First choice is the real Screen
  // Orientation lock (Android/Chrome, once fullscreen) — the browser rotates and
  // all coordinate math stays native. Where that isn't available (notably iOS
  // Safari) we fall back to CSS-rotating #app / #hud 90°, flipping `viewport`
  // into its swapped-dimension mode so the renderer, HUD projection and joystick
  // all follow the rotated layout. Desktop (mouse) is never touched.
  _initLandscapeLock() {
    if (!this.input.isTouch) return;
    const so = screen.orientation;
    const tryLock = () => {
      if (so && so.lock) so.lock("landscape").catch(() => {});
    };
    // A native lock only takes once we're fullscreen, so retry on entry too.
    document.addEventListener("fullscreenchange", tryLock);
    document.addEventListener("webkitfullscreenchange", tryLock);
    tryLock();

    const mq = matchMedia("(orientation: portrait)");
    const sync = () => {
      const portrait = mq.matches; // still portrait ⇒ the lock didn't take
      document.documentElement.classList.toggle("force-landscape", portrait);
      viewport.rotated = portrait;
      this.engine.resize();
    };
    // matchMedia change fires on rotation; the extras catch mobile browsers that
    // only settle the viewport a beat after the orientation event lands.
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else mq.addListener(sync);
    window.addEventListener("orientationchange", () => setTimeout(sync, 120));
    window.addEventListener("resize", sync);
    sync();
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
        <button class="btn" id="esc-coop">${icon("people")} Friends</button>
        <button class="btn deny" id="esc-restart">${icon("recycle")} New shop</button>
      </div>
      <div class="esc-hint"><b>WASD</b> move · <b>click/Space</b> attack · <b>E</b> interact · <b>Shift</b> roll · <b>B</b> bag · <b>J/K</b> menus · <b>Enter/Esc</b> pick · <b>\`</b> admin</div>
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
      this._friendSheet();
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
    // mirror the over-head flourish on the partner's screen (visual only —
    // the heal itself is local to whoever quaffed it)
    this.net.send({ t: "useFx", item: itemId });
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

  // The partner's over-head "used an item" flourish. Purely cosmetic: it rides
  // the remote creature the same way _updateUseFx rides the local player, but
  // never touches HP (each player heals their own hearts).
  _spawnRemoteUseFx(itemId) {
    if (!this.remote) return;
    const mesh = itemSprite(itemId, USE_FX_SIZE);
    mesh.scale.setScalar(0.0001);
    mesh.visible = false;
    this.engine.scene.add(mesh);
    this._remoteUseFx.push({ mesh, t: -this._remoteUseFx.length * 0.28 });
  }

  _updateRemoteUseFx(dt) {
    if (!this._remoteUseFx.length) return;
    const c = this.remote?.creature;
    for (const fx of [...this._remoteUseFx]) {
      if (!c) { fx.mesh.removeFromParent(); this._remoteUseFx.splice(this._remoteUseFx.indexOf(fx), 1); continue; }
      fx.t += dt;
      if (fx.t < 0) continue;
      fx.mesh.visible = true;
      const k = fx.t / USE_FX_DUR;
      const baseY = c.height + 0.35;
      let scale, y;
      if (k < 0.25) { scale = _easeOutBack(k / 0.25); y = baseY; }
      else if (k < 0.6) { scale = 1; y = baseY + Math.sin((fx.t - 0.25 * USE_FX_DUR) * 14) * 0.05; }
      else { const a = Math.min(1, (k - 0.6) / 0.4); scale = 1 - a; y = lerp(baseY, c.height * 0.5, a); }
      fx.mesh.position.set(c.position.x, y, c.position.z);
      fx.mesh.scale.setScalar(USE_FX_SIZE * Math.max(0.0001, scale));
      if (k >= 1) {
        fx.mesh.removeFromParent();
        this._remoteUseFx.splice(this._remoteUseFx.indexOf(fx), 1);
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
        <div><b>Place on this table</b></div>
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
    // same as the replace menu: float the choices right above the slot so the
    // storeroom picks land under the cursor.
    this.hud.anchorSheetAbove(slot.pos);
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
    // pop the menu open right above the table slot being edited so the swap
    // choices land under the cursor instead of at the bottom of the screen.
    this.hud.anchorSheetAbove(slot.pos);
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

  // -------------------------------------------------------------- friends
  _loadFriends() {
    try {
      const a = JSON.parse(localStorage.getItem(FRIENDS_KEY));
      return Array.isArray(a) ? a.filter((f) => typeof f === "string") : [];
    } catch {
      return [];
    }
  }

  _saveFriends() {
    try {
      localStorage.setItem(FRIENDS_KEY, JSON.stringify(this.friends));
    } catch {}
  }

  // Pick / change our display name and (re)register on the broker so friends
  // can reach us by it.
  setPlayerName(name) {
    name = String(name).trim().slice(0, 16);
    if (!name) return;
    this.playerName = name;
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    this.net.goOnline(name);
  }

  addFriend(name) {
    name = String(name).trim().slice(0, 16);
    if (!name) return;
    const key = name.toLowerCase();
    if (key === this.playerName.toLowerCase()) return; // no adding yourself
    if (this.friends.some((f) => f.toLowerCase() === key)) return;
    this.friends.push(name);
    this._saveFriends();
  }

  removeFriend(name) {
    this.friends = this.friends.filter((f) => f !== name);
    this._saveFriends();
  }

  _friendSheet() {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    this._renderFriendSheet();
  }

  _renderFriendSheet() {
    const inShop = this.playerArea === "shop";
    const connected = this.net.connected;
    let body;
    if (!this.playerName) {
      // First time: you need a name before anyone can invite you.
      body = `
        <div id="fr-status" class="hg-speech">Pick a name so friends can find you.</div>
        <div class="sheet-btns">
          <input id="fr-name" class="fr-input" maxlength="16" placeholder="Your name" autocapitalize="off" autocomplete="off" />
          <button class="btn deal" id="fr-setname">Save</button>
        </div>`;
    } else {
      const rows = this.friends.length
        ? this.friends
            .map(
              (f) => `
          <div class="fr-row">
            <span class="fr-name">${icon("people")} ${esc(f)}</span>
            <div class="fr-row-btns">
              <button class="btn small fr-invite" data-name="${esc(f)}" ${inShop && !connected ? "" : "disabled"}>Invite</button>
              <button class="icon-btn fr-remove" data-name="${esc(f)}" aria-label="Remove ${esc(f)}">${icon("close")}</button>
            </div>
          </div>`
            )
            .join("")
        : `<small class="empty">No friends yet — add one below.</small>`;
      const statusMsg = connected
        ? "A friend is in your shop!"
        : inShop
          ? "Invite a friend to teleport into your shop."
          : "Come up to the shop to invite a friend.";
      body = `
        <div class="fr-you">You're <b>${esc(this.playerName)}</b> <button class="btn small" id="fr-rename">Rename</button></div>
        <div id="fr-status" class="hg-speech">${statusMsg}</div>
        <div class="fr-list">${rows}</div>
        <div class="sheet-btns">
          <input id="fr-add" class="fr-input" maxlength="16" placeholder="Add friend by name" autocapitalize="off" autocomplete="off" />
          <button class="btn deal" id="fr-addbtn">Add</button>
        </div>
        ${connected ? `<div class="sheet-btns"><button class="btn deny" id="fr-leave">Leave session</button></div>` : ""}`;
    }
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("people")}</span>
        <div><b>Friends</b><br/><small>invite a friend to your shop</small></div>
        <button class="icon-btn" id="fr-close">${icon("close")}</button></div>
      ${body}
    `, "sheet-card");
    const status = el.querySelector("#fr-status");
    this.net.onStatus = (s) => { if (status) status.textContent = s; };
    el.querySelector("#fr-close").onclick = () => this.hud.hideSheet();

    if (!this.playerName) {
      const save = () => {
        const v = el.querySelector("#fr-name").value;
        if (v.trim()) { this.setPlayerName(v); this._renderFriendSheet(); }
      };
      el.querySelector("#fr-setname").onclick = save;
      el.querySelector("#fr-name").addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
      return;
    }

    el.querySelector("#fr-rename").onclick = () => {
      const v = prompt("Your name:", this.playerName);
      if (v && v.trim()) { this.setPlayerName(v); this._renderFriendSheet(); }
    };
    const add = () => {
      const input = el.querySelector("#fr-add");
      if (input.value.trim()) { this.addFriend(input.value); input.value = ""; this._renderFriendSheet(); }
    };
    el.querySelector("#fr-addbtn").onclick = add;
    el.querySelector("#fr-add").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    el.querySelectorAll(".fr-invite").forEach((b) => (b.onclick = () => this.net.invite(b.dataset.name)));
    el.querySelectorAll(".fr-remove").forEach((b) => (b.onclick = () => { this.removeFriend(b.dataset.name); this._renderFriendSheet(); }));
    const leave = el.querySelector("#fr-leave");
    if (leave) leave.onclick = () => { this.net.leave(); this._renderFriendSheet(); };
  }

  // A friend has invited us to teleport into their shop. You can only accept
  // from above ground — no bailing out of a live delve.
  onTpInvite(fromName) {
    this.audio.doorbell?.();
    const canAccept = this.playerArea !== "dungeon";
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("people")}</span>
        <div><b>${esc(fromName)} invites you</b><br/><small>teleport into their shop</small></div></div>
      <div class="hg-speech">${canAccept ? "Hop over and lend a hand?" : "You're deep in the cellar — surface before you can teleport."}</div>
      <div class="sheet-btns">
        <button class="btn deny" id="tp-decline">Decline</button>
        <button class="btn deal" id="tp-accept" ${canAccept ? "" : "disabled"}>Accept</button>
      </div>
    `, "sheet-card");
    el.querySelector("#tp-decline").onclick = () => { this.net.declineInvite(); this.hud.hideSheet(); };
    el.querySelector("#tp-accept").onclick = () => { this.net.acceptInvite(); };
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
      <div class="admin-hints">keys: <b>WASD</b> move · <b>click/Space</b> attack · <b>E</b> interact · <b>B</b> bag · <b>C</b> friends · <b>M</b> mute</div>
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
    this.hud.hideSheet();
    this.hud.banner(`${icon("people")} A friend teleported in!`, "", 2);
    this.net.send({
      t: "welcome",
      day: this.day, phase: this.phase, gold: this.gold, debtIdx: this.debtIdx,
      doorsOpen: this.shop.doorsOpen,
      inv: this.inventory,
      stash: this.stash,
      stocked: this.shop.slots.map((s) => s.item),
      floor: this.dungeon.active ? this.dungeon.floor : 0,
      seed: this.dungeon.seed ?? 0,
      hole: this.sewerHole,
      gateOpen: this.dungeon.gateOpen,
    });
    this._spawnRemote();
  }

  onJoinedHost() {
    this.hud.hideSheet();
    this.hud.banner(`${icon("people")} Teleported to your friend's shop!`, "", 2.4);
    this._spawnRemote();
  }

  onPeerLeft() {
    this.hud.toast(`${icon("people")} Your friend left.`);
    if (this.remote) {
      this.remote.creature.dispose();
      this.remote = null;
    }
    // with the last client gone, shut up shop right away — no lingering rush to
    // keep the doors open for a partner who's no longer here. Existing shoppers
    // are sent packing so the doors can swing shut behind them.
    if (this.net.isHost && this.shop.doorsOpen) {
      this.shop.setDoorsOpen(false);
      for (const cust of [...this.shop.customers]) {
        if (cust.state !== "haggling") cust.state = "leave";
      }
    }
  }

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
  }

  _updateRemote(dt, elapsed) {
    const r = this.remote;
    if (!r) return;
    const c = r.creature;
    // hide the partner while they're off on a different dungeon floor — their
    // world coords would otherwise overlap ours (floors share a footprint)
    c.visible = !(r.area === "dungeon" && this.playerArea === "dungeon" && r.floor >= 0 && r.floor !== this.dungeon.floor);
    // Positions arrive as ~11 Hz snapshots; render 150 ms in the past so we
    // always sit between two snapshots and glide instead of chasing the
    // newest one (which reads as move-stop-move jitter).
    const t = performance.now() / 1000 - 0.15;
    const buf = r.buf;
    while (buf.length > 2 && buf[1].t <= t) buf.shift();
    const a = buf[0], b = buf[1];
    if (b && b.t > a.t) {
      const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
      c.position.x = lerp(a.x, b.x, k);
      c.position.z = lerp(a.z, b.z, k);
      c.heading = lerpAngle(a.h, b.h, k);
    } else if (a) {
      c.position.x = a.x;
      c.position.z = a.z;
      c.heading = a.h;
    }
    c.update(dt, elapsed);
  }

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
  }

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
      const t = performance.now() / 1000 - 0.15;
      const buf = pl.buf;
      while (buf.length > 2 && buf[1].t <= t) buf.shift();
      const s0 = buf[0], s1 = buf[1];
      if (s1 && s1.t > s0.t) {
        const k = clamp((t - s0.t) / (s1.t - s0.t), 0, 1);
        c.position.x = lerp(s0.x, s1.x, k);
        c.position.z = lerp(s0.z, s1.z, k);
        c.heading = lerpAngle(s0.h, s1.h, k);
      } else if (s0) {
        c.position.x = s0.x;
        c.position.z = s0.z;
        c.heading = s0.h;
      }
      if (pl.atk && !a.wasAtk) c.attack();
      a.wasAtk = pl.atk;
      c.update(dt, elapsed);
    }
  }

  // Guest-side: are we standing on the host's live/simulated floor? When we've
  // lagged a floor behind or pushed ahead onto a quiet solo floor, the host's
  // enemy/drop/projectile broadcasts are for a floor we're not on, so we ignore
  // them rather than injecting phantom content into our floor.
  _onLiveFloor() {
    return !this.net.isGuest || this.dungeon.floor === this._hostDungeonFloor;
  }

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
        this.day = m.day; this.phase = m.phase; this.gold = m.gold; this.debtIdx = m.debtIdx;
        this.inventory = m.inv;
        this.stash = m.stash ?? [];
        if (typeof m.doorsOpen === "boolean") this.shop.setDoorsOpen(m.doorsOpen);
        this.hud.setDay(this.day, this.phase);
        this.hud.setGold(this.gold, false);
        this._updateDebtChip();
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
        // first delver picks the hole; once a dungeon is live the pair shares
        // it, so a request for a different hole just lands in the open one
        if (!D.active) {
          this.sewerHole = m.hole ?? 0;
          D.generate(1, holeSeed(this.sewerHole));
          this._syncState();
        }
        this.net.send({ t: "floor", n: D.floor, seed: D.seed, hole: this.sewerHole });
        break;
      }
      case "stairsReq": {
        if (this.net.isGuest) return;
        const from = typeof m.from === "number" ? m.from : D.floor;
        if (from >= MAX_FLOORS) return; // boss floor is the deepest
        // If we're delving too, we can't advance the live dungeon without
        // yanking ourselves along — so we send the guest on ahead to a quiet
        // solo floor while we hold our ground.
        if (this.playerArea === "dungeon") {
          this.net.send({ t: "floor", n: from + 1, seed: D.seed, hole: this.sewerHole, solo: 1 });
          break;
        }
        // minding the shop: the live floor advances and the guest rides along
        const n = D.floor + 1;
        D.generate(n, D.seed);
        this._hostDungeonFloor = n;
        this.net.send({ t: "floor", n, seed: D.seed, hole: this.sewerHole });
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
      case "holeReq": {
        // guest paid to unseal a sewer hole — host owns the wallet
        if (this.net.isGuest) return;
        const fee = this._holeFee();
        if (this.gold >= fee && !this.sewer.holes[m.id]?.open) {
          this._spendGold(fee, this.player.position);
          this._holesToday++;
          this.sewer.openHole(m.id);
          this.net.send({ t: "holeOpen", id: m.id });
        }
        break;
      }
      case "holeOpen": {
        // a hole's grate is open now — swing our copy of the lid up too
        this.sewer.openHole(m.id);
        this.audio.stairs();
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
        if (this.net.isGuest && D.active && this._onLiveFloor()) D.spawnDrop(m.item, m.x, m.z, m.id);
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
  }

  _applyStockSlot(i, item) {
    const slot = this.shop.slots[i];
    if (!slot) return;
    if (slot.item) this.shop.unstockSlot(slot);
    // stockItem handles the sprite + the fancy-table glow shader
    if (item) this.shop.stockItem(item, slot);
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

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// Friend names are player-supplied — escape them before dropping into markup.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Sewer-hole dungeon seeds: derived from the UTC day and the hole index, so
// every client that jumps into the same hole today generates the same layout
// without exchanging a single message.
function utcDay() {
  return Math.floor(Date.now() / 86400000);
}
function holeSeed(hole) {
  return utcDay() * 8191 + hole * 127 + 5;
}

// small stable hash for picking a lobby avatar's look from its session id
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _camShop = new THREE.Vector3(0, 10.2, 8.6);
const _camDungeon = new THREE.Vector3(0, 8.4, 8.2);
const _camSewer = new THREE.Vector3(0, 9.6, 8.6);
// pulled back + higher so the whole boss arena stays framed while the cam is fixed
const _camBoss = new THREE.Vector3(0, 13.5, 10);
// fixed look-at point for the shop so the camera holds a steady framing
const _shopCenter = new THREE.Vector3(0, 0, 0);
