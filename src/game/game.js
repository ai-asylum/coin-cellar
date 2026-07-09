// Game director: player, area transitions, combat glue, economy, co-op message
// handling. The open-ended shop loop:
//   stock the tables, open the doors
//   haggle ("capitalism, ho!"), or let your partner keep shop
//   delve the cellar below for merchandise — then it locks for an hour of real time
import * as THREE from "three";
import { clamp, lerp } from "../core/engine.js";
import { BlockyCreature } from "../chargen/blocky.js";
import { Shop } from "./shop.js";
import { Dungeon, DUNGEON_ORIGIN } from "./dungeon.js";
import { Cellar } from "./cellar.js";
import { ITEMS, itemSprite } from "./items.js";
import { starterEquipment, aggregateStats, weaponMesh } from "./gear.js";
import { Particles } from "./particles.js";
import { SlashArc } from "./slash.js";
import { Coop } from "../net/coop.js";
import { Lobby } from "../net/lobby.js";
import { icon, itemIcon } from "../core/icons.js";
import { viewport } from "../core/viewport.js";
import { _easeOutBack, isFullscreen, requestFullscreen } from "./game-util.js";
import { persistenceMethods, SAVE_KEY, NAME_KEY } from "./game-persistence.js";
import { netMethods } from "./game-net.js";
import { uiMethods } from "./game-ui.js";
import { narrativeMethods } from "./game-narrative.js";
import { combatMethods } from "./game-combat.js";
import { economyMethods } from "./game-economy.js";
import { dungeonFlowMethods } from "./game-dungeon-flow.js";

// New shopkeepers start with an empty bag on purpose: bare shelves push
// them straight down the trapdoor to earn their first stock (see _tutStart).
const START_INV = [];
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
    // cellar shortcuts: epoch ms each deeper mouth (index 1..N-1) re-locks; index
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
    this.combo = 0;
    this.gameOver = false; // kept as a universal guard; nothing sets it any more
    this.playerArea = "shop";
    this._invulnT = 0;
    // crit roll shared by the dash strike (see game-combat)
    this._critChance = 0.18;
    // dash — the sole attack now: a lunge that damages what it sweeps through
    this._dodgeCd = 0;
    this._dashT = -1;
    this._dashDur = 0.24;
    this._dashSpeed = 13;
    this._dashDX = 0;
    this._dashDZ = 0;
    this._dashHitIds = null; // foes / chests struck by the current dash (dedupe)
    this._dashDmg = 0;
    this._dashCrit = false;
    this._respawnT = -1;
    this._safeRecovery = false; // set on a shallow-floor knockout: keep the bag
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
    // whether the player has ever felled a boss. Kept for save migration (a
    // pre-bossBeaten save with earned shortcuts implies a fallen boss).
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
    this.cellar = new Cellar(this);
    // the shared-world lobby (Supabase Realtime): joined while in the cellar or
    // down a hole, so strangers' avatars show up alongside the co-op partner
    this.lobby = new Lobby(this);
    this.cellarHole = -1; // which cellar mouth the current dungeon hangs under
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
    this._updateClerk(dt, elapsed);
    this.dungeon.update(dt, elapsed);
    this.cellar.update(dt, elapsed);
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
    const inCellar = this.playerArea === "cellar";
    const inBoss = inDungeon && this.dungeon.active && this.dungeon.inBossRoom(p);
    // in the shop/town the camera locks onto whichever room the player stands in
    // (like the classic fixed shop framing); out on the street it follows them.
    const zone = !inDungeon && !inCellar && !inBoss ? this.shop.zoneCenter(p) : null;
    const camTarget = inBoss ? this.dungeon.bossCenter
      : inDungeon || inCellar ? p
      : zone ? _townCenter.set(zone.cx, 0, zone.cz)
      : p;
    const camOffset = inBoss ? _camBoss : inDungeon ? _camDungeon : inCellar ? _camCellar
      : zone ? _camShop : _camStreet;
    this.engine.camTarget.lerp(camTarget, 1 - Math.pow(0.001, dt));
    this.engine.camOffset.lerp(camOffset, 1 - Math.pow(0.1, dt));
    this.audio.setMood(this.gameOver ? null : inDungeon || inCellar ? "dungeon" : "shop");

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
    c.mesh.visible = this._invulnT < 0 || Math.sin(elapsed * 30) > -0.3;

    // movement
    const mv = this.input.move;
    // A sheet or a live dialogue bubble both freeze the player: no walking,
    // no swinging, no context-interacts until it's dismissed.
    const sheetBlocked = this.hud.sheetOpen || this.hud.speakOpen;

    // A live dialogue bubble eats the action press to advance itself: a click
    // anywhere on screen, Space/Enter, or the on-screen action button. The
    // edge is consumed so it can't leak into an attack or interact this frame
    // (movement/actions are already frozen by sheetBlocked above).
    if (this.hud.speakOpen) {
      if (this.input.actionEdge) this.hud.advanceSpeak();
      this.input.actionEdge = false;
      this.input.interactEdge = false;
    }

    // dash / attack — grabbed before movement so it can override it. Underground
    // the primary on-screen button IS the attack, so a press of it (actionEdge)
    // triggers the dash too; keys (J/Shift) and the right mouse button dash in
    // every area via dodgeEdge.
    const attackPress = this.input.dodgeEdge ||
      (this.playerArea === "dungeon" && this.input.actionEdge);
    if (attackPress && !sheetBlocked) this._dodge();

    if (this._dashT >= 0) {
      // committed dash: ease-out lunge along the dash direction, damaging every
      // foe / chest / prop it sweeps through (resolved per frame in _dashStrike)
      this._dashT += dt;
      const k = Math.max(0, 1 - this._dashT / this._dashDur);
      const sp = this._dashSpeed * (0.35 + 0.65 * k);
      c.position.x += this._dashDX * sp * dt;
      c.position.z += this._dashDZ * sp * dt;
      this._dashStrike();
      // the slash swoosh rides along with the hero through the whole lunge
      // instead of hanging in the air where the dash began
      this.slash.follow(c.position.x, 0.62, c.position.z);
      if (this._dashT >= this._dashDur) this._dashT = -1;
    } else if (!sheetBlocked && (mv.x || mv.y)) {
      const speed = 3.7 * (this.stats.speedMul || 1); // boots / heavy-armour tweak
      c.position.x += mv.x * speed * dt;
      c.position.z += mv.y * speed * dt;
    }

    // facing follows the direction of travel — the committed dash direction
    // while lunging, otherwise the movement input
    if (this._dashT >= 0) {
      c.heading = Math.atan2(this._dashDX, this._dashDZ);
    } else if (!sheetBlocked && (mv.x || mv.y)) {
      c.heading = Math.atan2(mv.x, mv.y);
    }
    const colliders = this.playerArea === "shop" ? this.shop.playerColliders
      : this.playerArea === "cellar" ? this.cellar.colliders : this.dungeon.colliders;
    this.collide(c.position, c.radius * 0.8, colliders);
    if (this.playerArea === "shop") {
      // town-wide fence: walls (colliders) do the real containment; this just
      // keeps the player on the ground across the shop, its rooms and the street
      const b = this.shop.bounds;
      c.position.x = clamp(c.position.x, b.minX, b.maxX);
      c.position.z = clamp(c.position.z, b.minZ, b.maxZ);
    }

    // floor loot: items rest on the ground and are drawn toward the hero once
    // they're inside the magnet field, accelerating the closer/longer they're
    // pulled, then collected on contact. Suppressed briefly after you toss
    // something so you don't instantly re-grab what you just dropped. The magnet
    // switches off entirely once the bag is full — nothing gets yanked around
    // that you can't pick up (walking onto a drop still surfaces the "bag full").
    if (this.playerArea === "dungeon" && performance.now() >= (this._pickupSuppressT || 0)) {
      const bagFull = this.inventory.length >= this.invCap;
      for (const drop of [...this.dungeon.drops]) {
        if (drop.fly) continue; // still popping out / arcing onto the floor
        const dp = drop.mesh.position;
        const dx = c.position.x - dp.x;
        const dz = c.position.z - dp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= PICKUP_COLLECT_R * PICKUP_COLLECT_R) {
          this._pickupDrop(drop);
          continue;
        }
        if (!bagFull && d2 <= PICKUP_MAGNET_R * PICKUP_MAGNET_R) {
          const d = Math.sqrt(d2) || 1e-4;
          drop.pull = Math.min(PICKUP_PULL_MAX, (drop.pull || PICKUP_PULL_MIN) + PICKUP_PULL_ACCEL * dt);
          const step = Math.min(drop.pull * dt, d);
          dp.x += (dx / d) * step;
          dp.z += (dz / d) * step;
        } else if (drop.pull) {
          drop.pull = 0; // drifted out of range (or bag full) — let it settle
        }
      }
    }

    // context action. Combat is dash-only now, so the action button is purely a
    // context / interact button: it appears for portals / stairs / gates / chests
    // and the shop's deals, and hides when there's nothing to do. `act.label`
    // is null when the floor's clear — there's no "swing" fallback any more.
    const act = this._contextAction();
    const inDungeon = this.playerArea === "dungeon";
    const hasInteract = !!act.label;
    if (inDungeon) {
      // the primary button is the ATTACK button while delving (crossed swords);
      // real interacts (stairs / gate / portal / chest) get their own button
      // when something's in reach, so the two never fight over one press.
      this.input.setActionLabel("swords", false);
      this.input.setInteract(act.label, hasInteract);
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
      this.hud.interactHint(act.focus, act.hint, this.input.isTouch ? "" : "E");
    else this.hud.hideInteractHint();
    if (!sheetBlocked && this._dashT < 0) {
      // E / interact button: fire the context action (portal, stairs, chest, …)
      if (this.input.interactEdge && hasInteract && act.fn) act.fn();
      // primary button / Space / click acts only above ground — while delving it
      // attacks instead (handled up top via attackPress), so skip it in-dungeon
      if (this.input.actionEdge && !inDungeon && act.fn) act.fn();
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
      return { label: null };
    }
    // cellar lobby: the stairs up to the shop and the four dungeon mouths
    if (this.playerArea === "cellar") {
      _v.copy(this.cellar.exitPos);
      if (_v.distanceTo(p) < 1.7)
        return { label: "home", hint: "Go up", fn: () => this._returnHome(), focus: _v.clone().setY(0.06), color: 0x8fd0ff };
      for (const hole of this.cellar.holes) {
        _v.copy(hole.pos);
        if (_v.distanceTo(p) < 1.8) {
          if (!this._shortcutOpen(hole.id))
            return { label: "warning", hint: "Locked", fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: 0x9aa0aa };
          return { label: "hole", hint: hole.name, fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: hole.color };
        }
      }
      return { label: null };
    }
    // dungeon (positions are group-local, player is world — offset). Every
    // floor has two flights of stairs now: up at the arrival spot, down in the
    // farthest room — no choice sheet, each flight goes where it goes.
    if (this.dungeon.active) {
      // the stairs left behind by the fallen boss: they either drop deeper into
      // the next stacked dungeon, or (final boss) are the way straight home
      if (this.dungeon.bossStairs) {
        const bs = this.dungeon.bossStairs;
        _v.copy(bs.pos);
        if (_v.distanceTo(p) < 1.7) {
          if (bs.descend)
            return { label: "arrowDown", hint: "Descend", fn: () => this._descend(), focus: _v.clone().setY(0.06), color: 0xff8a3d };
          return { label: "home", hint: "Go up", fn: () => this._returnHome(), focus: _v.clone().setY(0.06), color: 0x7fd8ff };
        }
      }
      // the sealed boss door: opens a choice — breach it (with a key) or turn
      // back up out of the dungeon rather than committing to the boss
      if (this.dungeon.gatePos && !this.dungeon.gateOpen) {
        _v.copy(this.dungeon.gatePos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 2.0) {
          const has = this._hasBossKey();
          return { label: has ? "skull" : "warning", hint: "Boss door", fn: () => this._gatePrompt(), focus: _v.clone().setY(0.06), color: has ? 0xff5a5a : 0x9aa0aa };
        }
      }
      // the up-stairs lead back out (the tutorial's stay inert and invisible
      // until the chest is cracked — see Dungeon.revealStairs). In the tutorial
      // "out" is straight home; everywhere else too — the bag deposits itself.
      if (!this.dungeon.stairsHidden) {
        _v.copy(this.dungeon.upStairsPos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.5) return { label: "home", hint: "Go up", fn: () => this._returnHome(), focus: _v.clone().setY(0.06), color: 0x8fd0ff };
      }
      // the down-stairs press on (absent on boss floors — the way deeper there
      // is the stairs the boss leaves behind)
      if (this.dungeon.hasDownStairs) {
        _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.5) return { label: "arrowDown", hint: "Descend", fn: () => this._descend(), focus: _v.clone().setY(0.06), color: 0xff8a3d };
      }
      // chests aren't a button — you crack them open with the dash (handled in
      // dungeon.dashHit). We just ring the nearest one so it reads as a target
      // to dash into; there's no button or keycap for it.
      for (const chest of this.dungeon.chests) {
        if (chest.opened) continue;
        _v.copy(chest.mesh.position).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.7) return { label: null, focus: _v.clone().setY(0.06), color: 0xffd34d };
      }
    }
    return { label: null };
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

  // ================================================================ economy
  _freshDayStats() {
    return {
      goldStart: this.gold,
      earned: 0, spent: 0, sold: 0, perfect: 0, bestCombo: 0,
      bought: 0, slain: 0, looted: 0, deepest: 0,
    };
  }

  // jump the camera straight to the current area's framing (no glide)
  _snapCamera() {
    const area = this.playerArea;
    if (area === "dungeon" || area === "cellar") {
      this.engine.camTarget.copy(this.player.position);
      this.engine.camOffset.copy(area === "dungeon" ? _camDungeon : _camCellar);
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
  // _updateUseFx). Driven by the player explicitly using an item from the bag.
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
    // the item visibly arcs out of the player toward its landing spot
    const flyFrom = { x: p.x, z: p.z };
    if (this.net.isGuest) {
      this.net.send({ t: "dropReq", idx, x: dropX, z: dropZ, fx: p.x, fz: p.z });
      this.inventory.splice(idx, 1);
    } else {
      this.inventory.splice(idx, 1);
      this.dungeon.spawnDrop(itemId, dropX, dropZ, null, { flyFrom });
      this._syncInv();
      this._save();
    }
    this.audio.pickup();
    this.hud.float(_v2.copy(p).setY(1.6), `dropped ${itemIcon(it.icon)}`, "dmg");
    if (this.hud.sheetOpen) this._openBag();
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
}

// Fold the split-out method groups back onto the prototype so the sibling
// modules' callbacks (and the class's own methods) resolve as before.
Object.assign(Game.prototype, persistenceMethods, netMethods, uiMethods, narrativeMethods, combatMethods, economyMethods, dungeonFlowMethods);

// Re-exported for main.js (and anything else that imported them from here);
// their definitions now live in game-util.js.
export { isFullscreen, requestFullscreen } from "./game-util.js";

// "used an item" flourish tuning: how long the pop-hover-drop lasts and how
// big the floating icon reads over the player's head.
const USE_FX_DUR = 0.85;
const USE_FX_SIZE = 0.8;
// how far in front of the player a dropped item lands (world units)
const DROP_FWD = 2.5;
// floor-loot magnet: items inside PICKUP_MAGNET_R are pulled toward the hero,
// their speed ramping from PICKUP_PULL_MIN up to PICKUP_PULL_MAX (units/s) at
// PICKUP_PULL_ACCEL (units/s²), and are collected once within PICKUP_COLLECT_R.
const PICKUP_MAGNET_R = 1.3;
const PICKUP_COLLECT_R = 0.55;
const PICKUP_PULL_MIN = 2.5;
const PICKUP_PULL_ACCEL = 22;
const PICKUP_PULL_MAX = 16;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _camShop = new THREE.Vector3(0, 10.2, 8.6);
const _camDungeon = new THREE.Vector3(0, 8.4, 8.2);
// the cellar lobby is the tutorial cellar — frame it exactly like a dungeon floor
const _camCellar = new THREE.Vector3(0, 8.4, 8.2);
// pulled back + higher so the whole boss arena stays framed while the cam is fixed
const _camBoss = new THREE.Vector3(0, 13.5, 10);
// out on the street the camera follows the player, pulled back a touch higher
const _camStreet = new THREE.Vector3(0, 12.6, 9.4);
// scratch target for whichever town room the player is standing in
const _townCenter = new THREE.Vector3();
