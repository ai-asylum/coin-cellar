// Game director: player, area transitions, combat glue, economy, co-op message
// handling. The open-ended shop loop:
//   stock the tables, open the doors
//   haggle ("capitalism, ho!"), or let your partner keep shop
//   delve the cellar below for merchandise — then it locks for an hour of real time
import * as THREE from "three";
import { rng, pick, clamp, lerp } from "../core/engine.js";
import { BlockyCreature, variantForSeed } from "../chargen/blocky.js";
import { portraitDataURL } from "../chargen/portrait.js";
import { Shop, SHOP, ARCHETYPES } from "./shop.js";
import { Dungeon, DUNGEON_ORIGIN, MAX_DEPTH, FLOORS_PER_DUNGEON, isBossFloor, dungeonIndexFor, bossDefFor, BOSS_ATK_GLOW } from "./dungeon.js";
import { Sewer } from "./sewer.js";
import { ITEMS, itemSprite, swordMesh } from "./items.js";
import { SLOTS, SLOT_META, starterEquipment, aggregateStats, weaponMesh, equipInfo } from "./gear.js";
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

// A sewer shortcut, once earned by descending past a boss, stays unsealed for
// three hours of real time before it re-locks.
const SHORTCUT_TTL_MS = 3 * 60 * 60 * 1000;
// New shopkeepers start with an empty bag on purpose: bare shelves push
// them straight down the trapdoor to earn their first stock (see _tutStart).
const START_INV = [];
const SAVE_KEY = "coincellar_save_v1";
const NAME_KEY = "coincellar_name";

// The Mayor NPC: a fixed character variant (so his walking body matches the
// dialogue bust), and his short spiel. One sentence per bubble — he offers the
// shop rent-free in exchange for helping rebuild the town, then again once the
// first lot goes up.
const MAYOR_VARIANT = "q"; // Kenney "Villager Q"
const MAYOR_INTRO_LINES = [
  "Ha! I was looking for one of those!",
  "The shop's yours rent-free, but you need to help me revive this town.",
  "Let's see what you can do, follow me.",
];
const MAYOR_PRAISE_LINES = [
  "Would you look at that, a family's already moving in!",
  "Keep it up: every home you raise brings more custom to your door.",
];
const FRIENDS_KEY = "coincellar_friends";
const LEVEL_INVULN = 1.8; // damage-immunity grace when arriving on a new floor
const BASE_MAXHP = 6; // hearts before any chestplate / ring bonuses

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
    this.day = 1; // run counter — bumps each fresh delve, feeds dungeon variety
    this.gold = 100;
    // sewer shortcuts: epoch ms each deeper mouth (index 1..N-1) re-locks; index
    // 0 is the always-open entrance. Earned by descending past each boss, they
    // let you drop straight to floors 4/7/10. Persisted (wall-clock TTL).
    this.shortcutUntil = [0, 0, 0, 0];
    this.inventory = [...START_INV];
    this.invCap = 10;
    // the shop storeroom: loot hauled up from the cellar lands here, and the
    // display tables are stocked from it. Unlimited — only the bag is capped.
    this.stash = [];
    this.hp = BASE_MAXHP;
    this.maxHp = BASE_MAXHP;
    // equipment: five slots (weapon / chest / shield / ring / boots). Each holds
    // an ITEMS id pulled straight from the storeroom — worn pieces live in the
    // slot, not the storeroom, and drop back when swapped out. `stats` is the
    // rolled-up bundle applied to combat, movement and survival — recomputed
    // whenever the loadout changes.
    this.equipment = starterEquipment();
    this.stats = aggregateStats(this.equipment);
    this._rangedCd = 0; // cadence gate for bow / staff shots
    this.combo = 0;
    this.gameOver = false; // kept as a universal guard; nothing sets it any more
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
    this.tutorial = null; // first-run onboarding step (see _tutStart); null once done
    this._hadSave = false; // set by _load — suppresses the tutorial for returning players
    // whether the player has ever felled a boss. Until they have, delving drops
    // straight into the dungeon (the sewer hub stays hidden); once a boss falls
    // the sewer opens for good, letting later runs pick a shortcut mouth.
    // Persisted (see _save/_load).
    this.bossBeaten = false;
    // which flanking rooms the player has bought their way into (left, right).
    // Persisted; re-applied to the shop right after it's built (see below).
    this.expansionsBought = [false, false];
    // which of the street's restoration lots the player has rebuilt with the
    // Mayor's fund (one flag per lot; sized to the shop's lots once it's built).
    // townResidents mirrors the archetype each restored house brings, weighting
    // the shopper crowd (see Shop._spawnCustomer). Persisted.
    this.townRestored = [];
    this.townResidents = [];
    // which display tables the player has repaired (one flag per shop table;
    // sized to the shop's tables once it's built). The first shelf is always
    // free — the rest (and the fancy vitrine) start broken until paid for.
    // Persisted.
    this.tablesRepaired = [];
    // the Mayor cutscene: a walking NPC plus a persistent objective arrow that
    // points the player at the lot he's asked them to rebuild.
    this._mayor = null;
    this._questArrow = null; // { pos: Vector3, text } shown outside the tutorial
    this._restockNudge = false; // post-Mayor: steer the guide back to the cellar once

    this._load();

    // Friends: a display name (so friends can find us on the broker) plus the
    // list of names we've saved. If we already have a name, hop online right
    // away so invites can land.
    this.playerName = localStorage.getItem(NAME_KEY) || "";
    this.friends = this._loadFriends();
    if (this.playerName) this.net.goOnline(this.playerName);

    // running tally of this session's trading (loot/sales/spend) for stats
    this.today = this._freshDayStats();

    // --- world
    this.shop = new Shop(this);
    // re-open any flanking rooms bought in a previous session
    this.expansionsBought.forEach((bought, i) => { if (bought) this.shop.unlockExpansion(i, true); });
    // size the flag array to however many lots the shop built (padding a shorter
    // saved array with fresh, un-restored lots), then rebuild any restored
    // street lots (and re-seat their residents) from the save
    while (this.townRestored.length < this.shop.lots.length) this.townRestored.push(false);
    this.townRestored.length = this.shop.lots.length;
    this.townResidents = [];
    this.townRestored.forEach((done, i) => {
      if (!done) return;
      this.shop.restoreLot(i, true);
      const lot = this.shop.lots[i];
      if (lot) this.townResidents.push(lot.resident);
    });
    // size the repaired-tables flags to the shop's tables (padding shorter saved
    // arrays), keep the first shelf always open, and restore any bought repairs
    while (this.tablesRepaired.length < this.shop.tables.length) this.tablesRepaired.push(false);
    this.tablesRepaired.length = this.shop.tables.length;
    this.tablesRepaired[0] = true;
    this.tablesRepaired.forEach((done, i) => { if (done) this.shop.repairTable(i, true); });
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
    this._heldWeaponId = this.equipment.weapon;
    this.player.holdItem(weaponMesh(this.equipment.weapon));
    engine.scene.add(this.player);
    this._recomputeStats();
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
    this._beginShop(true);
    engine.onTick((dt, t) => this.update(dt, t));
  }

  // ================================================================ loop
  update(dt, elapsed) {
    this.input.update();
    if (this.paused || this._fsPaused) {
      // Paused: ESC menu / descend prompt up, or a touch player has dropped out
      // of fullscreen. Freeze the world but keep the HUD live.
      this.highlight.visible = false;
      this.shop.highlightTable(null);
      this.hud.hideGuide();
      this.hud.hideInteractHint();
      this.hud.update();
      return;
    }
    this._updatePlayer(dt, elapsed);
    this._updateRemote(dt, elapsed);
    this._updateLobbyPlayers(dt, elapsed);
    this.shop.update(dt, elapsed);
    this._updateMayor(dt, elapsed);
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

    // camera follows the player in the dungeon, but stays put in the shop —
    // and locks onto the arena's centre once inside the boss room (fixed cam)
    const p = this.player.position;
    const inDungeon = this.playerArea === "dungeon";
    const inSewer = this.playerArea === "sewer";
    const inBoss = inDungeon && this.dungeon.active && this.dungeon.inBossRoom(p);
    // in the shop/town the camera locks onto whichever room the player stands in
    // (like the classic fixed shop framing); out on the street it follows them.
    const zone = !inDungeon && !inSewer && !inBoss ? this.shop.zoneCenter(p) : null;
    const camTarget = inBoss ? this.dungeon.bossCenter
      : inDungeon || inSewer ? p
      : zone ? _townCenter.set(zone.cx, 0, zone.cz)
      : p;
    const camOffset = inBoss ? _camBoss : inDungeon ? _camDungeon : inSewer ? _camSewer
      : zone ? _camShop : _camStreet;
    this.engine.camTarget.lerp(camTarget, 1 - Math.pow(0.001, dt));
    this.engine.camOffset.lerp(camOffset, 1 - Math.pow(0.1, dt));
    this.audio.setMood(this.gameOver ? null : inDungeon || inSewer ? "dungeon" : "shop");

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
      this.shop.highlightTable(null);
      this.hud.hideInteractHint();
      this._updateHoleDive(dt, elapsed);
      return;
    }
    if (this._respawnT >= 0) {
      this._respawnT -= dt;
      this.highlight.visible = false;
      this.shop.highlightTable(null);
      this.hud.hideInteractHint();
      c.update(dt, elapsed);
      if (this._respawnT < 0) this._respawn();
      return;
    }
    this._invulnT -= dt;
    this._dodgeCd -= dt;
    if (this._rangedCd > 0) this._rangedCd -= dt;
    if (this._comboT > 0) this._comboT -= dt;
    c.mesh.visible = this._invulnT < 0 || Math.sin(elapsed * 30) > -0.3;

    // movement
    const mv = this.input.move;
    // A sheet or a live dialogue bubble both freeze the player: no walking,
    // no swinging, no context-interacts until it's dismissed.
    const sheetBlocked = this.hud.sheetOpen || this.hud.speakOpen;

    // A live dialogue bubble eats the action press to advance itself: a click
    // anywhere on screen, Space/J/Enter, or the on-screen action button. The
    // edge is consumed so it can't leak into an attack or interact this frame
    // (movement/actions are already frozen by sheetBlocked above).
    if (this.hud.speakOpen) {
      if (this.input.actionEdge) this.hud.advanceSpeak();
      this.input.actionEdge = false;
      this.input.interactEdge = false;
    }

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
      const speed = 3.7 * (this.stats.speedMul || 1); // boots / heavy-armour tweak
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
    const colliders = this.playerArea === "shop" ? this.shop.playerColliders
      : this.playerArea === "sewer" ? this.sewer.colliders : this.dungeon.colliders;
    this.collide(c.position, c.radius * 0.8, colliders);
    if (this.playerArea === "shop") {
      // town-wide fence: walls (colliders) do the real containment; this just
      // keeps the player on the ground across the shop, its rooms and the street
      const b = this.shop.bounds;
      c.position.x = clamp(c.position.x, b.minX, b.maxX);
      c.position.z = clamp(c.position.z, b.minZ, b.maxZ);
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
    // a repair-able table lights up wholesale (white glow) instead of getting a
    // ground ring, so hand the glow target to the shop and skip the ring for it.
    const glowTable = (!sheetBlocked && !this.gameOver) ? (act.glowTable || null) : null;
    this.shop.highlightTable(glowTable);
    this._updateHighlight(glowTable ? null : act.focus, act.color, elapsed);
    // control hint under the highlight ring: keycap + verb on desktop, verb
    // only on touch (the action button itself already pulses there)
    if (act.focus && act.hint && !sheetBlocked && !this.gameOver)
      // swing actions (chests) answer to the attack button, not E — so drop the
      // keycap for them and only show it for true E-interacts on desktop
      this.hud.interactHint(act.focus, act.hint, this.input.isTouch || !hasInteract ? "" : "E");
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

    // Serve the whole line in one go: after the player opens the first deal we
    // keep the counter "hot" and auto-open the next shopper's sheet the instant
    // they shuffle up to the head — no re-pressing E per customer. The spell
    // ends when the queue is empty or the player steps away from the counter.
    if (this._autoServe && this.playerArea === "shop") {
      const nearCounter = c.position.distanceTo(this.shop.counterPos) < 2.4;
      const lineWaiting = this.shop.customers.some(
        (o) => o.state === "want" || o.state === "offer" || o.state === "haggling"
      );
      if (!nearCounter || !lineWaiting) {
        this._autoServe = false;
      } else if (!this.hud.sheetOpen && !this._adminOpen && !this._escOpen && !this.gameOver) {
        const head = this.shop.counterCustomer();
        if (head) {
          if (head.state === "want") this._haggle(head);
          else this._buyFrom(head);
        }
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
    // A live dialogue bubble swallows every shortcut so you can't pop menus or
    // interact mid-sentence. Advancing runs off the action press (Space/J/Enter,
    // a click anywhere, or the on-screen button) in _updatePlayer instead — this
    // just makes sure those keys don't also trigger a shortcut here.
    if (this.hud.speakOpen) return;
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
      // step behind the counter to serve whoever's at the head of the queue —
      // the deal only opens when you interact here, never on its own.
      if (p.distanceTo(this.shop.counterPos) < 2.4) {
        const head = this.shop.counterCustomer();
        if (head) {
          const focus = _focus.copy(head.creature.position).setY(0.06).clone();
          if (head.state === "want")
            return { label: "speak", hint: "Haggle", fn: () => this._haggle(head), focus, color: 0xffd34d };
          return { label: "moneyfly", hint: "Buy", fn: () => this._buyFrom(head), focus, color: 0x8fe0ff };
        }
      }
      // the guided first day only offers the cellar on its delve step — no
      // re-delving until the FTUE's walked you through stocking and selling
      const tutBlocksCellar = this.tutorial && this.tutorial !== "delve";
      if (!tutBlocksCellar && this.shop.trapdoorOpen && p.distanceTo(this.shop.trapdoorPos) < 1.5)
        return { label: "hole", hint: "Enter", fn: () => this._delve(), focus: _focus.copy(this.shop.trapdoorPos).setY(0.06).clone(), color: 0xb98cff };
      // the sealed side rooms: step up to a locked door to buy the extension.
      // Once bought the door swings open for good and there's nothing to prompt.
      // Locked out until the FTUE's done so a new player isn't pulled off the loop.
      if (!this.tutorial && this.shop.expansions) {
        for (let i = 0; i < this.shop.expansions.length; i++) {
          const ex = this.shop.expansions[i];
          if (ex.unlocked || p.distanceTo(ex.interactPos) >= 1.6) continue;
          const focus = _focus.copy(ex.interactPos).setY(0.06).clone();
          const broke = this.gold < ex.cost;
          return {
            label: broke ? "warning" : "coin",
            hint: `Extend ${ex.cost}g`,
            fn: () => this._extendShop(i),
            focus,
            color: broke ? 0x9aa0aa : 0x66ff9e,
          };
        }
      }
      // the street's restoration lots: step up to a ruin/empty plot to pay the
      // Mayor's fund and rebuild it into a home. Hidden during the FTUE.
      if (!this.tutorial && this.shop.lots) {
        for (let i = 0; i < this.shop.lots.length; i++) {
          const lot = this.shop.lots[i];
          if (lot.restored || p.distanceTo(lot.interactPos) >= 1.8) continue;
          const focus = _focus.copy(lot.interactPos).setY(0.06).clone();
          const broke = this.gold < lot.cost;
          return {
            label: broke ? "warning" : "home",
            hint: `Restore ${lot.cost}g`,
            fn: () => this._restoreLot(i),
            focus,
            color: broke ? 0x9aa0aa : 0x66ff9e,
          };
        }
      }
      // display tables: walk up to a slot to stock it. A stocked slot offers a
      // swap / take-back; an empty one takes stock from the storeroom. A table
      // still awaiting repair offers to buy the fix instead (all but the first
      // shelf, and the fancy vitrine, start broken — see Shop.repairTable).
      const slot = this._tableSlotTarget();
      if (slot) {
        const table = slot.table;
        if (table && !table.repaired) {
          // Hold back the repair UI until the tutorial's first house is rebuilt:
          // a brand-new player shouldn't be nudged to fix shelves before the
          // Mayor's put them on the restoration loop. Until then a broken table
          // just reads as scenery (no prompt, no glow). townPop() is persisted,
          // so returning players — who've already raised a home — see it as usual.
          if (this.townPop() > 0) {
            const i = this.shop.tables.indexOf(table);
            const broke = this.gold < table.cost;
            return {
              label: broke ? "warning" : "coin",
              hint: `Repair ${table.cost}g`,
              fn: () => this._repairTable(i),
              // no ground ring for tables — the whole table glows white instead
              // (see Shop.highlightTable); the hint text floats above the top.
              focus: _focus.copy(table.group.position).setY(1.35).clone(),
              color: broke ? 0x9aa0aa : 0x66ff9e,
              glowTable: table,
            };
          }
        } else {
          if (slot.item)
            return { label: "box", hint: "Swap", fn: () => this._replaceMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0xff9d5c };
          if (this.stash.length > 0)
            return { label: "box", hint: "Stock", fn: () => this._placeMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0x66ff9e };
        }
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
          if (!this._shortcutOpen(hole.id))
            return { label: "warning", hint: "Locked", fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: 0x9aa0aa };
          return { label: "hole", hint: hole.name, fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: hole.color };
        }
      }
      return { label: "swords", fn: () => this._attack() };
    }
    // dungeon (positions are group-local, player is world — offset). Leaving
    // the cellar is folded into the stairs prompt now, so there's no separate
    // return circle at the entrance.
    if (this.dungeon.active) {
      // the portal left behind by the fallen boss: it either drops deeper into
      // the next stacked dungeon, or (final boss) is the way straight home
      if (this.dungeon.returnPortal) {
        const rp = this.dungeon.returnPortal;
        _v.copy(rp.pos);
        if (_v.distanceTo(p) < 1.7) {
          if (rp.descend)
            return { label: "arrowDown", hint: "Descend", fn: () => this._descend(), focus: _v.clone().setY(0.06), color: 0xff8a3d };
          return { label: "home", hint: "Return", fn: () => this._returnHome(), focus: _v.clone().setY(0.06), color: 0x7fd8ff };
        }
      }
      // the sealed boss door: unlock it with the key, or read the "locked" cue
      if (this.dungeon.gatePos && !this.dungeon.gateOpen) {
        _v.copy(this.dungeon.gatePos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 2.0) {
          const has = this._hasBossKey();
          return { label: has ? "skull" : "warning", hint: has ? "Unlock" : "Locked", fn: () => this._openGate(), focus: _v.clone().setY(0.06), color: has ? 0xff5a5a : 0x9aa0aa };
        }
      }
      // stairs stay inert (and invisible) on the tutorial floor until the chest
      // is cracked — see Dungeon.revealStairs
      if (!this.dungeon.stairsHidden) {
        _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.5) return { label: "arrowDown", hint: "Stairs", fn: () => this._descendPrompt(), focus: _v.clone().setY(0.06), color: 0xb98cff };
      }
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

  // ================================================================ combat
  // Roll the equipped loadout into `this.stats` and reflect the parts that live
  // on the player directly: max hearts (chest / ring) and the held weapon mesh.
  _recomputeStats() {
    this.stats = aggregateStats(this.equipment);
    this.maxHp = BASE_MAXHP + this.stats.maxHpBonus;
    this.hp = Math.min(this.hp, this.maxHp);
    this.hud.setHearts(this.hp, this.maxHp);
    if (this.player && this._heldWeaponId !== this.equipment.weapon) {
      this._heldWeaponId = this.equipment.weapon;
      this.player.holdItem(weaponMesh(this.equipment.weapon));
    }
  }

  // Effective crit chance folds in the ring bonus.
  get _crit() {
    return this._critChance + (this.stats?.critBonus || 0);
  }

  // Three-hit chain: light, light, then a wider, heavier finisher. Swing again
  // within the combo window to advance; pause and it resets to the first hit.
  // Ranged weapons (bow / staff) route to _rangedAttack instead.
  _attack() {
    if (this.playerArea === "shop") return; // no swinging behind the counter
    if (this._dashT >= 0) return; // no attacking mid-roll
    if (this.stats.weaponType !== "sword") return this._rangedAttack();
    if (!this.player.attack()) return; // still mid-swing — ignore this press

    if (this._comboT > 0 && this._comboStep < 3) this._comboStep++;
    else this._comboStep = 1;
    this._comboT = 0.6; // window to chain the next swing
    const step = this._comboStep;
    const finisher = step === 3;

    const crit = Math.random() < this._crit;
    let dmg = Math.max(1, Math.round((finisher ? 4 : 2) * this.stats.dmgMul));
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

  // Bow / staff shot: gated by the weapon's cadence, auto-aimed at the nearest
  // live foe (or the facing direction if the floor's clear). Spawns a friendly
  // projectile the dungeon resolves against enemies. Crits still roll off the
  // ring bonus; the staff's bolts pierce and can carry a splash.
  _rangedAttack() {
    if (this._rangedCd > 0 || this._dashT >= 0 || this._respawnT >= 0 || this.gameOver) return;
    const w = this.stats.weapon;
    if (!w) return;
    this._rangedCd = w.cd || 0.4;
    const h = this._nearestEnemyHeading(this.player.heading);
    this.player.heading = h;
    this.player.attack(); // reuse the arm swing as a draw / cast gesture
    this.audio.swingCombo(0);
    const crit = Math.random() < this._crit;
    let dmg = Math.max(1, Math.round((w.projDmg || 3) * this.stats.dmgMul));
    if (crit) dmg *= 2;
    if (this.playerArea !== "dungeon" || !this.dungeon.active) return;
    const sx = Math.sin(h), sz = Math.cos(h);
    const sp = w.projSpeed || 14;
    const ox = this.player.position.x + sx * 0.5;
    const oz = this.player.position.z + sz * 0.5;
    this.dungeon.spawnPlayerProjectile(ox, oz, sx * sp, sz * sp, {
      color: w.projColor || 0xffffff, dmg, crit,
      radius: w.type === "staff" ? 0.3 : 0.2,
      pierce: !!w.pierce, splash: w.splash || 0,
      y: this.player.height * 0.55, life: 2.2,
    });
    _v.set(ox, this.player.height * 0.55, oz);
    this.particles.burst(_v, { color: w.projColor || 0xffffff, n: 5, speed: 2.2, up: 0.6, life: 0.25, size: 0.7 });
  }

  // Heading toward the closest living foe within a generous radius — used for
  // ranged auto-aim (unlike _assistedHeading it doesn't require a frontal cone).
  _nearestEnemyHeading(h) {
    if (this.playerArea !== "dungeon" || !this.dungeon.active) return h;
    const p = this.player.position;
    let best = null, bestD = 16 * 16;
    for (const e of this.dungeon.enemies) {
      if (e.deadT >= 0) continue;
      const dx = e.creature.position.x - p.x;
      const dz = e.creature.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD && d > 0.001) { bestD = d; best = { dx, dz }; }
    }
    return best ? Math.atan2(best.dx, best.dz) : h;
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
    this._dodgeCd = 0.55 * (this.stats.dodgeCdMul || 1);
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
    // shield: a chance to fully turn the blow aside, with a brief grace after
    if (this.stats.blockChance > 0 && Math.random() < this.stats.blockChance) {
      this._invulnT = 0.5;
      this.audio.dodge();
      this.hud.float(_v2.copy(this.player.position).setY(1.8), `${icon("shield")} block`, "loot");
      this.particles.burst(_v2.copy(this.player.position).setY(this.player.height * 0.6), { color: 0x9fd0ff, n: 10, speed: 3, up: 1.2, life: 0.4, size: 0.9 });
      return;
    }
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
    this._heldWeaponId = this.equipment.weapon;
    this.player.holdItem(weaponMesh(this.equipment.weapon));
    this.engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => this.audio.step();
    this.playerArea = "shop";
    this.lobby.leave();
    this.hud.showHearts(false);
    this.hud.showBag(false);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false);
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
    // the ring's fortune bonus rounds up on every windfall
    if (this.stats.goldMul > 1) amount = Math.round(amount * this.stats.goldMul);
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
    if (pos) {
      this.hud.float(_v2.copy(pos).setY(pos.y + 1.4), `-${amount}g`, "dmg");
      // coins peel off the gold counter and fly out toward whatever's being
      // bought, ticking a coin sound as each lands (mirrors the sale cascade)
      const coins = 5 + Math.min(11, Math.floor(amount / 20));
      this.hud.spendCoins(_v2.copy(pos).setY(pos.y + 1.0), coins, (i) => this.audio.coin(i % 6));
    }
    this._syncState();
  }

  _pickupDrop(drop) {
    if (this.inventory.length >= this.invCap) {
      if (!this._bagFullT || performance.now() - this._bagFullT > 2000) {
        this.hud.bagFull();
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
      if (this.dungeon.tutorial) this.dungeon.revealStairs();
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
    if (!slot || slot.item || slot.disabled)
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
    // stepping up to the counter commits the shopkeeper to working the whole
    // line: once this deal closes, the next shopper's sheet opens on its own
    // (see the auto-serve pass in _updatePlayer) until the queue drains or the
    // player walks away from the counter.
    this._autoServe = true;
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
      if (cust.isMayor) this._mayorFromCustomer(cust);
    } else {
      this.combo = 0;
      this.audio.deny();
      // the Mayor won't take no for an answer during onboarding — put him back
      // at the head of the counter so the haggle simply reopens
      if (cust.isMayor) { cust.state = "want"; cust.ready = true; cust.strikes = 0; cust.t = 0; }
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
    if (cust.isMayor) this._mayorFromCustomer(cust);
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
    this._autoServe = true;
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

  // Set up the shop for a fresh session. No more day/night cycle — the shop is
  // always open for trade; the cellar stays open so you can delve any time.
  _beginShop(first = false) {
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(this.gold, false);

    if (first) {
      this.hud.banner(`${icon("shop")} COIN CELLAR`, "", 3);
      if (this.day === 1 && !this._hadSave && !this.net.connected) this._tutStart();
    }
    this.today = this._freshDayStats();
    this._syncState();
    this._save();
  }

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
  }

  _tutHint() {
    if (!this.tutorial) return;
    const hints = {
      delve: `${icon("hole")} Your shelves are bare — step onto the trapdoor to delve for stock`,
      return: `${icon("arrowDown")} Take the stairs to bring your loot back to the shop`,
      stock: `${icon("box")} Stand at a glowing table and place your loot — a customer will come`,
      sell: `${icon("speak")} Step behind the counter and haggle to seal your first sale`,
    };
    if (hints[this.tutorial]) this.hud.toast(hints[this.tutorial]);
  }

  // Called at each loop milestone with the step it completes; advances (and
  // re-hints) only if that's the step we're currently waiting on.
  _tutAdvance(step) {
    if (this.tutorial !== step) return;
    const order = ["delve", "loot", "return", "stock", "sell"];
    this.tutorial = order[order.indexOf(step) + 1] || null;
    // reaching the sell step means the first table's just been stocked — send in
    // the Mayor (disguised as an ordinary shopper) to buy that first item. Once
    // the sale lands he reveals himself, so there's no separate walk-in here.
    if (this.tutorial === "sell") this.shop.spawnMayorCustomer(MAYOR_VARIANT);
    if (this.tutorial) setTimeout(() => this._tutHint(), 700);
  }

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
  }

  _freshDayStats() {
    return {
      goldStart: this.gold,
      earned: 0, spent: 0, sold: 0, perfect: 0, bestCombo: 0,
      bought: 0, slain: 0, looted: 0, deepest: 0,
    };
  }

  // Buy the flanking room i (2000g). The door swings open for good and the
  // room lights up as an extension of the shop. Purchase is persisted.
  _extendShop(i) {
    if (this.net.isGuest) return this.hud.toast("Only the host runs the shop.");
    const ex = this.shop.expansions && this.shop.expansions[i];
    if (!ex || ex.unlocked) return;
    if (this.gold < ex.cost) {
      this.audio.deny();
      return this.hud.toast(`${icon("coin")} Not enough gold — need ${ex.cost}g`);
    }
    this._spendGold(ex.cost, ex.interactPos);
    this.shop.unlockExpansion(i);
    this.expansionsBought[i] = true;
    this.audio.chest();
    this.engine.shake(0.12);
    this.hud.toast(`${icon("shop")} Shop extended!`);
    this._save();
    this._syncState();
  }

  // Pay to repair display table `i`: a broken shelf (200g) or the fancy vitrine
  // (1000g) is dusted off and its slots open up for stock. Persisted; solo /
  // host only (guests don't run the shop).
  _repairTable(i) {
    if (this.net.isGuest) return this.hud.toast("Only the host runs the shop.");
    const table = this.shop.tables && this.shop.tables[i];
    if (!table || table.repaired) return;
    if (this.gold < table.cost) {
      this.audio.deny();
      return this.hud.toast(`${icon("coin")} Not enough gold — need ${table.cost}g`);
    }
    this._spendGold(table.cost, table.group.position);
    this.today.spent += table.cost;
    this.shop.repairTable(i);
    this.tablesRepaired[i] = true;
    this.hud.toast(`${icon("shop")} ${table.fancy ? "Vitrine" : "Shelf"} repaired!`);
    this._save();
    this._syncTables();
  }

  // ---- town restoration (the Mayor's project) -------------------------------
  // How many street lots have been rebuilt — read by the shop to quicken the
  // customer trickle as the town fills back out.
  townPop() {
    return this.townRestored.reduce((n, done) => n + (done ? 1 : 0), 0);
  }

  // Pay the Mayor's fund to rebuild street lot i: a run-down ruin or boarded-up
  // plot becomes a proper house and a new resident moves in — a distinct (often
  // wealthier) shopper who now frequents your counter. Persisted; solo only.
  _restoreLot(i) {
    if (this.net.isGuest) return this.hud.toast("Only the host runs the town.");
    const lot = this.shop.lots && this.shop.lots[i];
    if (!lot || lot.restored) return;
    if (this.gold < lot.cost) {
      this.audio.deny();
      return this.hud.toast(`${icon("coin")} Not enough gold — need ${lot.cost}g`);
    }
    this._spendGold(lot.cost, lot.interactPos);
    this.today.spent += lot.cost;
    this.shop.restoreLot(i);
    this.townRestored[i] = true;
    this.townResidents.push(lot.resident);
    const arch = ARCHETYPES[lot.resident];
    this.hud.banner(`${icon("home")} A new home!`,
      `a ${arch ? arch.name : "new"} family moves in`, 2.8);
    this._save();
    this._syncState();
    // the Mayor's pointed lot just went up — he drops back by with a word
    if (this._questArrow && this.shop.lots[i]?.interactPos.equals(this._questArrow.pos))
      this._mayorAfterRestore();
  }

  // The cheapest lot still awaiting restoration — the one the Mayor points at.
  _mayorTargetLot() {
    let best = -1, bestCost = Infinity;
    (this.shop.lots || []).forEach((lot, i) => {
      if (!lot.restored && lot.cost < bestCost) { bestCost = lot.cost; best = i; }
    });
    return best;
  }

  // The Mayor's pitch, played once when the FTUE loop closes. He actually walks
  // in through the shopfront as a character (a bust flanks the dialogue so you
  // can see who's talking, like the haggle panel), gives a short spiel — the
  // shop's yours rent-free, but you help revive the town — then strolls out to
  // the lot he wants rebuilt, leaving an objective arrow on it.
  _mayorIntro() {
    if (this.net.connected || this._mayor) return; // solo onboarding, once
    const target = this._mayorTargetLot();
    this._mayorEnter(MAYOR_INTRO_LINES, () => this._mayorGoToLot(target));
  }

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
  }

  // The disguised first customer just bought the player's opener — drop the act
  // and reveal the Mayor, talking on the spot, then he heads to the first lot.
  _mayorFromCustomer(cust) {
    if (this.net.connected || this._mayor) return;
    const creature = this.shop.detachCustomer(cust);
    const target = this._mayorTargetLot();
    this._mayorEnter(MAYOR_INTRO_LINES, () => this._mayorGoToLot(target), creature);
  }

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
    // one last FTUE beat: the opener sold, so nudge the player back down to
    // restock before chasing the Mayor's rebuild. The real game's open now
    // (tutorial is null), so this is a lightweight flag that only steers the
    // guide arrow + a hint; it clears on the next delve, handing the arrow to
    // the lot quest above.
    if (!this.net.connected) {
      this._restockNudge = true;
      setTimeout(() => {
        if (this._restockNudge)
          this.hud.toast(`${icon("hole")} Restock the inventory — head back down to the cellar for more stock`);
      }, 700);
    }
  }

  _mayorLeave() {
    const m = this._mayor;
    if (!m) return;
    this.hud.hideSpeak();
    m.state = "leave";
    m.path = null; // force the leave route to rebuild from wherever he's standing
  }

  _endMayorScene() {
    const m = this._mayor;
    if (!m) return;
    this._mayor = null;
    this.shop.doorHeld = false;
    this.hud.hideSpeak();
    m.creature.dispose?.();
    this.shop.group.remove(m.creature);
  }

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
  }

  // Once the Mayor's target lot is rebuilt: clear the arrow and give him a short
  // congratulatory follow-up (walking back on if he's already wandered off).
  _mayorAfterRestore() {
    this._questArrow = null;
    const done = () => this._mayorLeave();
    if (this._mayor) {
      this._mayor.state = "talk";
      this._mayor.path = null;
      this._mayor.afterTalk = done;
      this._mayorSay(MAYOR_PRAISE_LINES, done);
    } else {
      this._mayorEnter(MAYOR_PRAISE_LINES, done);
    }
  }

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
  }

  // ================================================================ dungeon
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
  }

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
      if (!this.dungeon.active || this.dungeon.floor !== 1)
        this.dungeon.generate(1, seed);
      this._beginHoleDive(this.shop.trapdoorPos, () => this._enterDungeon());
      return;
    }
    // drop down the cellar trapdoor into the shared sewer — dive in first
    this._beginHoleDive(this.shop.trapdoorPos, () => this._enterSewer());
  }

  _enterSewer() {
    this.playerArea = "sewer";
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false); // the sewer's a safe hub — keep gold up top
    this.input.setDodgeVisible(false);
    if (this.hud.sheetOpen) this.hud.hideSheet();
    this.player.position.copy(this.sewer.entrancePos).add(_v.set(0, 0, -1.4));
    this.player.animator.prevPos.copy(this.player.position);
    this.audio.stairs();
    this._snapCamera();
    this.lobby.join("sewer");
    this.hud.banner(`${icon("hole")} The Sewers`, "", 2.6);
  }

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
  }

  // Is sewer mouth `id` open? The entrance (0) always is; the deeper mouths
  // stay open until their earned wall-clock expiry lapses.
  _shortcutOpen(id) {
    if (id <= 0) return true;
    return Date.now() < (this.shortcutUntil?.[id] ?? 0);
  }

  // Short "time left" label for an open shortcut (e.g. "2h 41m").
  _shortcutLabel(id) {
    const ms = Math.max(0, (this.shortcutUntil?.[id] ?? 0) - Date.now());
    const mins = Math.ceil(ms / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

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
  }

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
  }

  // What's worth carrying back down: only consumables (they can be used in the
  // cellar) and the Brass Key for the boss door — the rest is merchandise.
  _packable() {
    return this.stash
      .map((id, i) => ({ id, i, it: ITEMS[id] }))
      .filter(({ id, it }) => it.heal || id === "key");
  }

  // How many storeroom pieces are equippable gear — used to decide whether the
  // pack menu is worth opening even when there are no supplies to carry.
  _stashGearCount() {
    return this.stash.reduce((n, id) => n + (equipInfo(id) ? 1 : 0), 0);
  }

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
  }

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
    if (area === "dungeon" || area === "sewer") {
      this.engine.camTarget.copy(this.player.position);
      this.engine.camOffset.copy(area === "dungeon" ? _camDungeon : _camSewer);
      return;
    }
    const zone = this.shop.zoneCenter(this.player.position);
    if (zone) {
      this.engine.camTarget.set(zone.cx, 0, zone.cz);
      this.engine.camOffset.copy(_camShop);
    } else {
      this.engine.camTarget.copy(this.player.position);
      this.engine.camOffset.copy(_camStreet);
    }
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
  }

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

  // "The seal breaks…" with this dungeon's boss in the subtitle (host + guests)
  _bossAwakenBanner() {
    this.hud.banner(`${icon("skull")} The seal breaks…`, bossDefFor(dungeonIndexFor(this.dungeon.floor)).awaken, 2.6);
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
    const name = this.dungeon.boss?.def?.name ?? bossDefFor(dungeonIndexFor(this.dungeon.floor)).name;
    this.hud.banner(`${icon("warning")} ${name} is enraged!`, "", 2.4);
  }

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
  }

  // ================================================================ reset
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
    this.input.setDodgeVisible(this.playerArea === "dungeon");
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
        <div><b>Paused</b><br/><small>${this.gold}g in the purse</small></div>
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
        return `<button class="inv-item ti-${it.tier}" data-i="${i}">${itemIcon(it.icon)}<small>${it.name}</small><span>${it.base}g</span></button>`;
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

  // -------------------------------------------------------------- gear sheet
  // The equip UI is a Minecraft-style paper-doll: three body slots up top
  // (weapon / chest / shield) and two below (ring / boots). It no longer has a
  // screen of its own — it's embedded in the pre-delve "Pack your bag" sheet
  // above ground and in the backpack sheet while delving. Each slot shows the
  // worn piece's icon, or an empty glyph; tapping one opens the per-slot picker.
  // Whether tapping a slot's cell would open a picker with anything actionable:
  // at least one matching piece to equip in the pool, or a worn piece we're
  // allowed to take off (every slot but the weapon, which is never left bare).
  _slotHasOptions(slot, source) {
    const pool = source === "inv" ? this.inventory : this.stash;
    for (const id of pool) {
      const eq = equipInfo(id);
      if (eq && eq.slot === slot) return true;
    }
    return !!this.equipment[slot] && slot !== "weapon";
  }

  _gearDollHTML(source) {
    const cell = (slot) => {
      const wornId = this.equipment[slot];
      const it = wornId && ITEMS[wornId];
      const ic = it ? `<span class="gear-cell-ic">${itemIcon(it.icon)}</span>`
        : `<span class="gear-cell-ic empty">${icon(SLOT_META[slot].icon)}</span>`;
      // Nothing to swap in and nothing to take off → there's no picker worth
      // opening, so lock the cell rather than showing an empty list.
      const locked = !this._slotHasOptions(slot, source);
      return `<button class="gear-cell${it ? " filled ti-" + it.tier : ""}${locked ? " locked" : ""}" data-slot="${slot}"${locked ? " disabled" : ""}>
        ${ic}
        <small>${SLOT_META[slot].name}</small>
        <span class="gear-cell-name">${it ? it.name : SLOT_META[slot].empty}</span>
      </button>`;
    };
    const top = SLOTS.filter((s) => SLOT_META[s].row === "top").map(cell).join("");
    const bottom = SLOTS.filter((s) => SLOT_META[s].row === "bottom").map(cell).join("");

    return `
      <div class="gear-doll">
        <div class="gear-row top">${top}</div>
        <div class="gear-row bottom">${bottom}</div>
      </div>`;
  }

  // Wire the slot buttons of an already-rendered paper-doll to open the per-slot
  // picker. `source` is "stash" (above ground: pieces come from / return to the
  // storeroom) or "inv" (delving: pieces come from / return to the bag).
  _wireGearDoll(el, source) {
    el.querySelectorAll(".gear-cell").forEach((b) => {
      b.onclick = () => this._openEquipPicker(b.dataset.slot, source);
    });
  }

  // Reopen whichever host sheet the paper-doll is embedded in — the pack menu
  // above ground, the backpack while delving.
  _reopenGearHost(source) {
    if (source === "inv") this._openBagDungeon();
    else this._packMenu();
  }

  // The per-slot picker: every candidate piece that fits this slot, plus (for
  // non-weapon slots) an "unequip" option. Picking one swaps it in — the old
  // piece drops back into the pool (`source`). Candidates come from the
  // storeroom above ground, or the bag while delving.
  _openEquipPicker(slot, source) {
    const meta = SLOT_META[slot];
    const inDungeon = source === "inv";
    const pool = inDungeon ? this.inventory : this.stash;
    const wornId = this.equipment[slot];
    // gather matching pieces, remembering each one's index in the pool
    const seen = new Map(); // id -> { i, count } collapse duplicates to one row
    pool.forEach((id, i) => {
      const eq = equipInfo(id);
      if (!eq || eq.slot !== slot) return;
      if (seen.has(id)) seen.get(id).count++;
      else seen.set(id, { i, count: 1 });
    });

    const rows = [];
    if (wornId && slot !== "weapon") {
      // weapon is never left empty; other slots can be stripped bare
      const it = ITEMS[wornId];
      const noRoom = inDungeon && this.inventory.length >= this.invCap;
      rows.push(`<button class="gear-opt equipped ti-${it.tier}" data-act="unequip"${noRoom ? " disabled" : ""}>
        <span class="gear-opt-ic">${itemIcon(it.icon)}</span>
        <div class="gear-opt-txt"><b>${it.name}</b><small>${noRoom ? "bag is full — no room to stow it" : "equipped — tap to remove"}</small></div>
        <span class="gear-opt-act off">${icon("undo")} Remove</span>
      </button>`);
    }
    for (const [id, { i, count }] of seen) {
      const it = ITEMS[id];
      const eq = it.equip;
      rows.push(`<button class="gear-opt ti-${it.tier}" data-i="${i}">
        <span class="gear-opt-ic">${itemIcon(it.icon)}</span>
        <div class="gear-opt-txt"><b>${it.name}${count > 1 ? ` ×${count}` : ""}</b><small>${eq.blurb || ""}</small></div>
        <span class="gear-opt-act">Equip</span>
      </button>`);
    }
    if (!rows.length) {
      const where = inDungeon ? "your bag" : "the storeroom";
      const hint = inDungeon ? "Loot gear from bosses as you delve." : "Bosses drop gear — bring some home first.";
      rows.push(`<div class="gear-empty">${icon(meta.icon)}<span>No ${meta.name.toLowerCase()} in ${where}.<br/><small>${hint}</small></span></div>`);
    }

    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon(meta.icon)}</span>
        <div><b>${meta.name}</b></div>
        <button class="icon-btn" id="pick-back">${icon("arrowLeft")}</button></div>
      <div class="gear-list">${rows.join("")}</div>
    `, inDungeon ? "sheet-card gear-sheet bag-sheet" : "sheet-card gear-sheet");

    el.querySelector("#pick-back").onclick = () => this._reopenGearHost(source);
    el.querySelectorAll("[data-i]").forEach((b) => {
      b.onclick = () => { this._equipFromPool(slot, Number(b.dataset.i), source); this._reopenGearHost(source); };
    });
    el.querySelectorAll('[data-act="unequip"]').forEach((b) => {
      b.onclick = () => { this._unequip(slot, source); this._reopenGearHost(source); };
    });
  }

  // Slot a piece into `slot`, pulling it from the pool (`source`) and dropping
  // anything already worn there back into that same pool. In co-op both the
  // storeroom and the bag are shared, so the guest mirrors the move locally and
  // asks the host to make it official.
  _equipFromPool(slot, idx, source) {
    const pool = source === "inv" ? this.inventory : this.stash;
    const id = pool[idx];
    const eq = equipInfo(id);
    if (!eq || eq.slot !== slot) return;
    const prev = this.equipment[slot];
    pool.splice(idx, 1);
    if (prev) pool.push(prev);
    this.equipment[slot] = id;
    this._recomputeStats();
    this.audio.pickup();
    if (this.net.isGuest) this.net.send({ t: "equipReq", id, prev: prev || null, src: source });
    else { this._syncInv(); this._save(); }
  }

  _unequip(slot, source) {
    const prev = this.equipment[slot];
    if (!prev || slot === "weapon") return; // you always carry a weapon
    // stowing gear takes a bag slot while delving — refuse if there's no room
    if (source === "inv" && this.inventory.length >= this.invCap) {
      return this.hud.toast(`${icon("bag")} Bag is full!`);
    }
    const pool = source === "inv" ? this.inventory : this.stash;
    this.equipment[slot] = null;
    pool.push(prev);
    this._recomputeStats();
    this.audio.pickup();
    if (this.net.isGuest) this.net.send({ t: "unequipReq", id: prev, src: source });
    else { this._syncInv(); this._save(); }
  }

  _openBag() {
    // The bag is a dungeon survival kit: use consumables or drop loot to free space.
    if (this.playerArea !== "dungeon") return;
    this._openBagDungeon();
  }

  _openBagDungeon() {
    // Reopening while the bag is already up (after a use/drop) is a refresh, not
    // a fresh open — skip the pop-out entrance so the panels don't re-scale.
    const refresh = this.hud.sheetOpen;
    const rows = this.inventory
      .map((id, i) => {
        const it = ITEMS[id];
        const useBtn = it.heal
          ? `<button class="bag-act use" data-i="${i}">Use <small>+${it.heal}${icon("heart")}</small></button>`
          : `<span class="bag-act ghost">not usable</span>`;
        return `<div class="bag-row ti-${it.tier}">
          <span class="bag-face">${itemIcon(it.icon)}</span>
          <span class="bag-name">${it.name}<small>${it.base}g</small></span>
          ${useBtn}
          <button class="bag-act drop" data-i="${i}">Drop</button>
        </div>`;
      })
      .join("");
    const el = this.hud.showSheet(`
      <div class="gear-panel sheet-card">
        <div class="gear-panel-head">${icon("sword")}<b>Equipment</b></div>
        ${this._gearDollHTML("inv")}
      </div>
      <div class="bag-panel sheet-card">
        ${this._bagHead("sip a potion or drop loot to free space")}
        <div class="bag-list">${rows || "<small class='empty'>empty — go delve!</small>"}</div>
      </div>
    `, `bag-sheet bag-split${refresh ? " bag-refresh" : ""}`, { onBackdrop: () => this.hud.hideSheet() });
    this._wireGearDoll(el, "inv");
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
        <button class="inv-item shown ti-${cur.tier}" id="take-back">${itemIcon(cur.icon)}<small>${cur.name}</small><span>take back</span></button>
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
        <button data-a="stockshelves">${icon("box")} Stock shelves</button>
        <button data-a="clearbag">${icon("trash")} Empty bag</button>
        <button data-a="delve">${icon("hole")} Delve</button>
        <button data-a="floor">${icon("arrowDown")} Next floor</button>
        <button data-a="key">${itemIcon("key")} Give key</button>
        <button data-a="kill">${icon("skull")} Kill enemies</button>
        <button data-a="reset" class="danger">${icon("recycle")} Wipe save</button>
      </div>
      <div class="admin-head"><b>${icon("crown")} FTUE jump</b><span>load a tutorial step</span></div>
      <div class="admin-grid">
        <button data-a="tut:delve">${icon("hole")} 1 · Delve</button>
        <button data-a="tut:loot">${itemIcon("meat") || icon("swords")} 2 · Loot</button>
        <button data-a="tut:return">${icon("arrowDown")} 3 · Return</button>
        <button data-a="tut:stock">${icon("box")} 4 · Stock</button>
        <button data-a="tut:sell">${icon("speak")} 5 · Sell</button>
        <button data-a="tut:mayor">${icon("crown")} 6 · Mayor</button>
        <button data-a="tut:restock">${icon("hole")} 7 · Restock</button>
      </div>
      <div class="admin-hints">keys: <b>WASD</b> move · <b>click/Space</b> attack · <b>E</b> interact · <b>B</b> bag · <b>C</b> friends · <b>M</b> mute</div>
    `;
    this.hud.root.appendChild(el);
    this.adminEl = el;
    this._adminOpen = true;
    // delegate on the whole panel so every grid (admin + FTUE jump) is covered
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-a]");
      if (btn) this._adminAction(btn.dataset.a);
    });
  }

  _adminAction(a) {
    if (a.startsWith("tut:")) return this._tutJump(a.slice(4));
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
      case "stockshelves": {
        if (this.playerArea !== "shop") { this.hud.toast("Head up to the shop to stock shelves."); break; }
        const ids = Object.keys(ITEMS);
        let n = 0;
        for (const slot of this.shop.slots) {
          if (slot.item) continue;
          this.shop.stockItem(pick(Math.random, ids), slot);
          n++;
        }
        this._syncStock();
        this._save();
        this.hud.toast(n ? `${icon("box")} Stocked ${n} shelf slot${n === 1 ? "" : "s"}` : `${icon("box")} Shelves already full`);
        break;
      }
      case "clearbag":
        this.inventory.length = 0;
        this.stash.length = 0;
        this._syncInv();
        this._save();
        this.hud.toast(`${icon("trash")} Bag & storeroom emptied`);
        break;
      case "delve":
        if (this.playerArea !== "dungeon") this._delve();
        break;
      case "floor":
        if (this.playerArea === "dungeon" && this.dungeon.active) {
          if (this.dungeon.floor >= MAX_DEPTH) this.hud.toast("This is the final boss floor — deepest there is.");
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
          this.hud.bagFull();
        }
        break;
      case "kill":
        for (const e of [...this.dungeon.enemies]) this.dungeon.damageEnemy(e, 999);
        break;
      case "reset":
        this._reset();
        break;
    }
    // refresh god-mode label without rebuilding everything
    const g = this.adminEl?.querySelector('[data-a="god"] b');
    if (g) g.textContent = this.godMode ? "ON" : "off";
  }

  // Debug: drop straight into any FTUE checkpoint by rebuilding the exact game
  // state that step expects, then driving the real transition into it. Loads a
  // "premade" tutorial state so each beat can be inspected without playing the
  // whole loop from scratch. Solo only; wired to the ` admin panel.
  _tutJump(step) {
    if (this._adminOpen) this._toggleAdmin();
    if (this.net.connected) return this.hud.toast("FTUE jump is solo-only.");
    this.hud.hideSheet();

    // --- clean tutorial baseline ---------------------------------------------
    this.tutorial = null; // silence any in-flight step transitions during setup
    this._endMayorScene(); // tear down any in-flight Mayor cutscene
    this._questArrow = null;
    this._restockNudge = false;
    this.gold = 100;
    this.hud.setGold(this.gold, false);
    for (const c of [...this.shop.customers]) this.shop._removeCustomer(c);
    this.inventory.length = 0;
    this.stash.length = 0;
    for (const s of this.shop.slots) if (s.item) this.shop.unstockSlot(s);
    this._syncStock();

    const wares = ["mushroom", "meat"]; // the FTUE's fixed starter loot
    const genTutFloor = () => {
      this.sewerHole = -1;
      this.dungeon.dispose();
      this.dungeon.generate(1, this.day * 1000 + Math.floor(Math.random() * 999), true);
    };
    const toShop = () => { if (this.playerArea !== "shop") this._returnHome(); };

    switch (step) {
      case "delve":
        toShop();
        this.tutorial = "delve";
        this.player.position.copy(this.shop.trapdoorPos).add(_v.set(1.4, 0, 1.0));
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        break;

      case "loot":
        genTutFloor();
        this.tutorial = "delve"; // _enterDungeon advances delve -> loot
        this._enterDungeon();
        break;

      case "return": {
        genTutFloor();
        this.tutorial = "return";
        this._enterDungeon(); // sets area/camera; _tutAdvance("delve") no-ops, so it stays "return"
        this.inventory = [...wares];
        this._syncInv();
        _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
        this.player.position.set(_v.x + 1.0, 0, _v.z + 1.0);
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        break;
      }

      case "stock":
        toShop();
        this.stash = [...wares];
        this._syncInv();
        this.tutorial = "stock";
        this._tutHint();
        break;

      case "sell":
        toShop();
        this.stash = [...wares];
        this._syncInv();
        this.tutorial = "stock";
        this._stockFromStash(0); // advances stock -> sell + hurries a customer in
        break;

      case "mayor":
        toShop();
        this.tutorial = null;
        this._mayorIntro();
        return; // _mayorIntro opens its own sheet

      case "restock": {
        // post-Mayor state: the FTUE proper is done (tutorial null), he's already
        // picked a lot to rebuild, and the restock nudge is steering the player
        // back down for more stock (the lot quest arrow waits behind the nudge
        // until the next delve clears it)
        toShop();
        this.shop.doorLocked = false;
        this.tutorial = null;
        this._restockNudge = true;
        const lot = this.shop.lots[this._mayorTargetLot()];
        if (lot) this._questArrow = { pos: lot.interactPos.clone(), text: `${icon("home")} Rebuild — ${lot.cost}g` };
        this.player.position.copy(this.shop.trapdoorPos).add(_v.set(1.4, 0, 1.0));
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        this.hud.toast(`${icon("hole")} Restock the inventory — head back down to the cellar for more stock`);
        break;
      }
    }
    this._save();
  }

  // ================================================================ net
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
    // Positions arrive as ~11 Hz snapshots; interpolate them into a smooth
    // glide (see sampleSnaps) so the walk cycle doesn't stutter on packet jitter.
    if (sampleSnaps(r.buf)) {
      c.position.x = _snap.x;
      c.position.z = _snap.z;
      c.heading = _snap.h;
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
      if (sampleSnaps(pl.buf)) {
        c.position.x = _snap.x;
        c.position.z = _snap.z;
        c.heading = _snap.h;
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
    this.net.send({ t: "state", gold: this.gold, day: this.day, doorsOpen: this.shop.doorsOpen });
  }

  // Push the repaired-tables set to a connected guest so their shop shows the
  // same shelves greyed out / restored.
  _syncTables() {
    this._syncState();
    if (!this.net.isGuest) this.net.send({ t: "tables", tables: this.tablesRepaired });
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
        day: this.day, gold: this.gold, inv: this.inventory, stash: this.stash,
        shortcutUntil: this.shortcutUntil,
        bossBeaten: this.bossBeaten,
        equipment: this.equipment,
        expansions: this.expansionsBought,
        town: this.townRestored,
        tables: this.tablesRepaired,
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
        this.bossBeaten = !!s.bossBeaten;
        // drop any item ids that no longer exist (e.g. renamed/removed items).
        // A run always resumes in the shop, so anything saved in the bag
        // (including legacy saves from before the storeroom) lands in the stash.
        this.stash = (s.stash ?? []).filter((id) => ITEMS[id]);
        this.stash.push(...(s.inv ?? []).filter((id) => ITEMS[id]));
        this.inventory = [];
        if (Array.isArray(s.shortcutUntil)) {
          // keep the array shape stable even if N_DUNGEONS ever changes
          for (let i = 1; i < this.shortcutUntil.length; i++)
            this.shortcutUntil[i] = s.shortcutUntil[i] ?? 0;
          // migrate saves from before bossBeaten existed: any earned deeper
          // shortcut means a boss has already fallen, so keep the sewer open
          if (s.bossBeaten === undefined && this.shortcutUntil.some((t) => t > 0))
            this.bossBeaten = true;
        }
        if (Array.isArray(s.expansions))
          this.expansionsBought = [!!s.expansions[0], !!s.expansions[1]];
        if (Array.isArray(s.town))
          this.townRestored = s.town.map(Boolean);
        if (Array.isArray(s.tables))
          this.tablesRepaired = s.tables.map(Boolean);
        // restore the loadout, dropping any worn piece whose id no longer maps
        // to a real item of the right slot (schema drift / removed content)
        if (s.equipment) {
          for (const slot of SLOTS) {
            const id = s.equipment[slot];
            const eq = equipInfo(id);
            this.equipment[slot] = eq && eq.slot === slot ? id : (slot === "weapon" ? "wsword" : null);
          }
        }
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

// One shared layout per UTC day for the whole 1‑12 descent: every client that
// delves today generates the identical stack of floors from this base seed,
// without exchanging a single message.
function utcDay() {
  return Math.floor(Date.now() / 86400000);
}
function daySeed() {
  return utcDay() * 8191 + 5;
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
// out on the street the camera follows the player, pulled back a touch higher
const _camStreet = new THREE.Vector3(0, 12.6, 9.4);
// scratch target for whichever town room the player is standing in
const _townCenter = new THREE.Vector3();
