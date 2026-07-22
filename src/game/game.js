// Game director: player, area transitions, combat glue, economy, co-op message
// handling. The open-ended shop loop:
//   stock the tables, open the doors
//   haggle ("capitalism, ho!"), or let your partner keep shop
//   delve the cellar below for merchandise — then it locks for an hour of real time
import * as THREE from "three";
import { clamp, lerp } from "../core/engine.js";
import { BlockyCreature, variantForSeed } from "../chargen/blocky.js";
import { Shop } from "./shop.js";
import { Dungeon, DUNGEON_ORIGIN } from "./dungeon.js";
import { Cave } from "./cave.js";
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
import { combatMethods, AUTOAIM_RANGE, DASH_DUR, DASH_SPEED } from "./game-combat.js";
import { combat, attackMode, ATTACK_MODES } from "./combat-settings.js";
import { economyMethods } from "./game-economy.js";
import { dungeonFlowMethods } from "./game-dungeon-flow.js";
import { setLayout } from "./layout-store.js";
import { setAnalyticsContextProvider, track } from "../core/analytics.js";
import { getPlayableTesterId, isPlayableSession } from "../core/playable-session.js";
import layoutData from "./layout.json";

// The game builds the town from the bundled layout (the overworld editor —
// /editor.html in dev — writes this file through the /api/layout endpoint).
// Injected via the store so the editor can feed the same build code a live
// copy instead; see layout-store.js.
setLayout(layoutData);

// New shopkeepers wake up in the FTUE cave with a day's spelunking haul
// already in the bag — the goods that the closed shop (and the Mayor's offer)
// give a reason to sell. The opening cinematic adds the slime's jelly on top.
const START_INV = ["caveshroom", "meat"];

// The hero turns with the same capped rad/s pivot as the townsfolk (see
// BlockyCreature.turnRate) so the body visibly swings its shoulders toward a
// new heading — including the little turn toward an aligned foe on a dash —
// rather than snapping. Brisker than the townsfolk's stroll so combat stays
// responsive. Shared by _respawn in game-combat.js (kept in sync there).
export const PLAYER_TURN_RATE = 7;
const BASE_MAXHP = 6; // hearts before any chestplate / ring bonuses
const CHEST_AUTO_OPEN_RANGE = 1.7;
const TARGET_MOVE_SPEED_MUL = 0.55;

export class Game {
  constructor(engine, input, audio, hud, opts = {}) {
    this.engine = engine;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    // Attract mode: build the whole town but hold off the real session so the
    // title screen can show the hero strolling around behind the menu (Animal
    // Crossing-style). startPlay() drops it and boots the game for real.
    this._replayMode = !!opts.replayMode;
    this._titleAttract = !this._replayMode && !!opts.titleAttract;
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
    // keeps the hero drawn solid for the whole dash i-frame window (which
    // outlasts the lunge motion) so the flicker never bites at the dash's tail
    this._dashSolidT = 0;
    // baseline shape; _dodge re-derives both per launch (auto-lunge mode
    // carries its own lungeTime/lungeDist knobs)
    this._dashDur = DASH_DUR;
    this._dashSpeed = DASH_SPEED;
    this._dashDX = 0;
    this._dashDZ = 0;
    // when a dash auto-aims onto a foe, the hero *looks* fully at it (a stronger
    // turn than the gently-bent lunge line) and holds that gaze for a short beat
    // after the lunge so the controls don't instantly snap facing back — this is
    // the visible "turn toward the enemy" feedback.
    this._dashFaceDX = 0;
    this._dashFaceDZ = 0;
    this._dashFaceT = 0;
    // the locked dash winds up before it fires: a rooted beat where the hero
    // coils past the foe's bearing, then whips through it as the lunge launches
    this._dashWindT = -1;
    this._dashWindFoe = null;
    // "Auto strike" telegraph: counts down once a foe is strikeable, so the
    // swing doesn't fire the instant a foe steps into range (see update())
    this._autoStrikeWindT = 0;
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
    this.debugFreezeNoclip = false;
    this.debugHour = null; // admin time-of-day override (0–24); null = real clock
    this.debugOccasion = null; // admin calendar-occasion override (id); null = real date
    this._adminOpen = false;
    this.npcDebug = false; // admin toggle: float state/stuck cards over townsfolk
    this.paused = false;
    this._fsPaused = false; // set while a touch player is out of fullscreen
    this._escOpen = false;
    this.tutorial = null; // first-run onboarding step (see _tutStart); null once done
    this._ftueFreeze = false; // FTUE bag beats root the player (key turn / note read)
    this._hadSave = false; // set by _load — suppresses the tutorial for returning players
    // whether the player has ever felled a boss. Kept for save migration (a
    // pre-bossBeaten save with earned shortcuts implies a fallen boss).
    // Persisted (see _save/_load).
    this.bossBeaten = false;
    // the deepest dungeon floor ever reached — used to detect a genuinely new
    // depth milestone the townsfolk react to (see _enterDungeon). Persisted.
    this.deepestEver = 0;
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
    // the Mayor cutscene: a walking NPC driven through the FTUE's scenes (and
    // the praise beat when the first home goes up).
    this._mayor = null;
    // What each townsperson last thought of their shopping trip, keyed by npc
    // id — surfaced (once) as their opening line the next time you chat with
    // them (see recordNpcReflection / _talkToNpc). In-memory flavour only.
    this._npcMemory = new Map();
    // the latest notable player deed the town is gossiping about (boss felled,
    // new depth reached), surfaced as the next chat's opening line — one
    // reaction per resident (see recordPlayerDeed / _takeNpcDeed).
    this._recentDeed = null;
    // townsfolk you've already been introduced to — the very first chat with
    // each gets a one-off "oh, you're new in town" hello (see _talkToNpc).
    // Filled from the save in _load; persisted so intros never repeat.
    this._npcMet = new Set();
    // the FTUE's scripted opening cinematic (see _updateCaveIntro)
    this._cine = null;

    if (!this._replayMode) this._load();

    // Friends: a display name (so friends can find us on the broker) plus the
    // list of names we've saved. If we already have a name, hop online right
    // away so invites can land.
    this.playerName = this._replayMode ? "" : localStorage.getItem(NAME_KEY) || "";
    this.friends = this._replayMode ? [] : this._loadFriends();
    // hold off going online until the player actually starts (see startPlay)
    if (!this._replayMode && this.playerName && !this._titleAttract) this.net.goOnline(this.playerName);

    // running tally of this session's trading (loot/sales/spend) for stats
    this.today = this._freshDayStats();

    // --- world
    this.shop = new Shop(this);
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
    // arrays) and restore any bought repairs. Any existing save keeps the first
    // shelf open (also the safety net for saves abandoned mid-FTUE); a fresh
    // game starts shelf-less — the first shelf is Morel's gift.
    while (this.tablesRepaired.length < this.shop.tables.length) this.tablesRepaired.push(false);
    this.tablesRepaired.length = this.shop.tables.length;
    if (this._hadSave) this.tablesRepaired[0] = true;
    this.tablesRepaired.forEach((done, i) => { if (done) this.shop.repairTable(i, true); });
    // now the tables exist and any bought repairs are replayed, put the saved
    // shelf stock back out on display (see _load / _restoreStock)
    this._restoreStock();
    this.dungeon = new Dungeon(this);
    // the cave at the end of the road — the dungeon's permanent front door and
    // shared lobby (its trapdoor mouths are the way down; see _updateCaveTravel
    // for the walk-through between the road and the cave mouth)
    this.cave = new Cave(this);
    // the shared-world lobby (Supabase Realtime): joined while in the cave or
    // down a hole, so strangers' avatars show up alongside the co-op partner
    this.lobby = new Lobby(this);
    this.cellarHole = -1; // which cellar mouth the current dungeon hangs under
    this._lobbyAvatars = new Map(); // lobby player id -> {creature, wasAtk}

    // --- player
    this.player = new BlockyCreature("a", { height: 1.5, turnRate: PLAYER_TURN_RATE });
    this.player.setTorchLit(false); // the hero's own lantern shouldn't wash out their model
    this.player.position.copy(this.shop.playerSpawn);
    this._dungeonCamLook = new THREE.Vector3(0, 0, -DUNGEON_LOOKAHEAD);
    this._dungeonCamPrevPos = this.player.position.clone();
    this._cameraArea = this.playerArea;
    this._heldWeaponId = this.equipment.weapon;
    this.player.holdItem(weaponMesh(this.equipment.weapon));
    engine.scene.add(this.player);
    this._recomputeStats();
    this._playableAnalytics = isPlayableSession();
    this._testerId = getPlayableTesterId();
    this._analyticsSampleT = 0;
    this._analyticsPositionSampleT = POSITION_SAMPLE_SECONDS;
    this._analyticsPositionBatch = [];
    setAnalyticsContextProvider(() => this._analyticsState());
    this.player.animator.onFootstep = (pos, k) => {
      this.audio.step();
      this.particles.burst(pos, { color: 0x9a8f80, n: 1, speed: 0.4, up: 0.5, gravity: 2, life: 0.35, size: 0.7 });
    };

    this.remote = null; // {creature, buf:[{t,x,z,h}], area}
    this.highlight = this._makeHighlight();

    // click-to-interact in the shop: a left click straight onto a display slot,
    // a customer with a deal, or the cellar trapdoor opens it without walking
    // up. The raw screen point is stashed here and resolved in _updatePlayer.
    this._ray = new THREE.Raycaster();
    this._pendingClick = null;
    // last mouse position (screen px), so hovering a shop fixture can preview
    // its interact hint under the cursor before you click — mirrors the ring
    // and hint you get when the hero walks right up to it.
    this._pointer = null;
    this._clickArea = document.getElementById("app");
    const clickArea = this._clickArea;
    if (clickArea) {
      clickArea.addEventListener("mousedown", (e) => {
        if (e.button === 0) this._pendingClick = { x: e.clientX, y: e.clientY };
      });
      clickArea.addEventListener("mousemove", (e) => {
        this._pointer = { x: e.clientX, y: e.clientY };
      });
      clickArea.addEventListener("mouseleave", () => {
        this._pointer = null;
      });
    }

    this._wireHud();
    this._initFullscreenGate();
    this.input.onKey = (code) => this._handleKey(code);
    if (this._replayMode) this._beginReplayMode();
    else if (this._titleAttract) this._beginTitleAttract();
    else this._beginShop(true);
    engine.onTick((dt, t) => this.update(dt, t));
  }

  _beginReplayMode() {
    this.godMode = false;
    this.paused = false;
    this.tutorial = null;
    this._cine = null;
    this._ftueFreeze = false;
    this.cave.setTrapdoorOpen(true, true);
    this.player.mesh.visible = true;
    this.player.position.copy(this.shop.playerSpawn);
    this.player.animator.prevPos.copy(this.player.position);
    this.shop.group.visible = true;
    this.cave.group.visible = false;
    this.dungeon.group.visible = false;
    this._snapCamera();
  }

  // Drive the frozen review world from a normalized telemetry sample.
  setReplaySample(sample) {
    if (!this._replayMode || !sample) return;
    const area = sample.area === "dungeon" || sample.area === "cave" ? sample.area : "shop";
    const floor = Number(sample.floor) || 1;
    const seed = Number(sample.seed) || REPLAY_FALLBACK_SEED;
    const areaChanged = this.playerArea !== area;
    const floorChanged = area === "dungeon" &&
      (!this.dungeon.active || this.dungeon.floor !== floor || this.dungeon.seed !== seed);
    if (floorChanged) this.dungeon.generate(floor, seed, false, sample.tutorial === "forage");
    this.playerArea = area;
    this.shop.group.visible = area === "shop";
    this.cave.group.visible = area === "cave";
    this.dungeon.group.visible = area === "dungeon";
    this.player.position.set(sample.x, 0, sample.z);
    this.player.animator.prevPos.copy(this.player.position);
    this._syncReplayShopRoof();
    this._updateReplayCamera(areaChanged || floorChanged);
  }

  _updateReplayCamera(snap = false) {
    const p = this.player.position;
    if (this.playerArea === "dungeon" || this.playerArea === "cave") {
      this.engine.camTarget.set(p.x, 0, p.z - DUNGEON_LOOKAHEAD);
      this.engine.camOffset.copy(_camDungeon);
    } else {
      const zone = this.shop.zoneCenter(p);
      const street = !zone ? this.shop.streetCenter(p) : null;
      this.engine.camTarget.set(zone?.cx ?? street?.cx ?? p.x, 0, zone?.cz ?? street?.cz ?? p.z);
      this.engine.camOffset.copy(zone ? fitShopCamera(this.engine.camera.aspect, this.shop) : this.shop.camStreetOffset);
    }
    if (snap) this.engine.camera.position.copy(this.engine.camTarget).add(this.engine.camOffset);
  }

  _syncReplayShopRoof() {
    if (!this.shop?.roof) return;
    const p = this.player.position;
    const rect = this.shop.buildingRect;
    const inside = this.playerArea === "shop" &&
      p.x > rect.minX - 0.3 && p.x < rect.maxX + 0.3 &&
      p.z > rect.minZ - 0.3 && p.z < rect.maxZ + 0.3;
    this.shop.inBuilding = inside;
    this.shop._roofA = inside ? 0 : 1;
    this.shop.roof.visible = !inside;
    for (const mat of this.shop._roofMats || []) mat.opacity = inside ? 0 : 1;
    for (const wall of this.shop.nearCameraWalls || []) wall.visible = !inside;
  }

  _updateFrozenNoclip(dt, elapsed) {
    const focusedInReviewer = this._replayMode && document.activeElement?.closest?.("#replay-panel");
    const mv = this.input.move;
    const moving = !focusedInReviewer && !this._adminOpen && (mv.x || mv.y);
    if (moving) {
      const p = this.player.position;
      const speed = 3.7 * (this.stats.speedMul || 1);
      p.x += mv.x * speed * dt;
      p.z += mv.y * speed * dt;
      this.player.heading = Math.atan2(mv.x, mv.y);
      this.player.update(dt, elapsed);
    }
    this._syncReplayShopRoof();
    this._updateReplayCamera();
    this.hud.update();
  }

  // ---- title attract (menu backdrop) ---------------------------------------
  // Park the hero out on the street and set them wandering between waypoints so
  // the title screen has a living, in-game backdrop. The full shop still ticks
  // (lighting, ambient strollers), just with no HUD, input or trade.
  _beginTitleAttract() {
    // Roaming band on the road: the full width to stroll across (x) and a good
    // stretch along the street (z). The camera follows the focal NPC through it.
    const R = this.shop.streetRegion;
    const pad = 1.0;
    this._titleBand = {
      xLo: R.minAlong + pad, // along the road (screen X)
      xHi: R.maxAlong - pad,
      zLo: R.minCross + pad, // across the road (screen Z)
      zHi: R.maxCross - pad,
    };
    const B = this._titleBand;
    const cx = (B.xLo + B.xHi) / 2;
    const czTitle = (B.zLo + B.zHi) / 2;

    // The star of the title screen: a townsperson the camera follows around.
    const npc = new BlockyCreature(variantForSeed(1 + Math.floor(Math.random() * 999)), {
      height: 1.5, turnRate: 2.6, animScale: 0.85,
    });
    npc.position.set(cx, 0, czTitle);
    npc.animator.prevPos.copy(npc.position);
    this.shop.group.add(npc);
    this._titleNpc = npc;
    this._titleNpcWander = { tx: cx, tz: czTitle, pause: 0, speed: 1.3, curSpeed: 0 };
    this._pickTitleTarget(this._titleNpcWander);

    // keep the hero out of the title screen entirely — the menu shot is just
    // the focal NPC roaming the town, with the player revealed on Play.
    this.player.mesh.visible = false;

    // frame the NPC straight away so the camera doesn't sail in from the origin
    const street = this.shop.streetCenter(npc.position);
    this.engine.camTarget.set(street.cx, 0, street.cz);
    this.engine.camOffset.copy(this.shop.camStreetOffset);
    this.engine.camera.position.copy(this.engine.camTarget).add(this.engine.camOffset);
    this.hud.showBag(false);
    this.hud.showHearts(false);
  }

  _pickTitleTarget(w) {
    const B = this._titleBand;
    w.tx = B.xLo + Math.random() * (B.xHi - B.xLo);
    w.tz = B.zLo + Math.random() * (B.zHi - B.zLo);
  }

  // Step one wandering character toward its waypoint, easing pace and pausing
  // now and then (shared by the focal NPC and the ambient hero).
  _titleWanderStep(c, w, dt, elapsed) {
    if (w.pause > 0) {
      w.pause -= dt;
      // stood still: idly turn to look about every couple of seconds
      w.lookT = (w.lookT ?? 0) - dt;
      if (w.lookT <= 0) {
        w.lookBase = (w.lookBase ?? c.heading) + (0.5 + Math.random() * 1.0) * (Math.random() < 0.5 ? -1 : 1);
        c.heading = w.lookBase;
        w.lookT = 0.9 + Math.random() * 1.7;
      }
      w.curSpeed += (0 - w.curSpeed) * Math.min(1, dt * 5.5);
    } else {
      const dx = w.tx - c.position.x, dz = w.tz - c.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) {
        this._pickTitleTarget(w);
        if (Math.random() < 0.65) { w.pause = 1.2 + Math.random() * 2.4; w.lookBase = c.heading; w.lookT = 0.4 + Math.random() * 0.7; }
        else w.pause = 0;
        w.curSpeed += (0 - w.curSpeed) * Math.min(1, dt * 5.5);
      } else {
        w.curSpeed += (w.speed - w.curSpeed) * Math.min(1, dt * 5.5);
        if (d > 1e-4) {
          c.position.x += (dx / d) * w.curSpeed * dt;
          c.position.z += (dz / d) * w.curSpeed * dt;
        }
        c.heading = Math.atan2(dx, dz);
      }
    }
    this.collide(c.position, c.radius * 0.8, this.shop.playerColliders);
    c.update(dt, elapsed);
  }

  _updateTitleAttract(dt, elapsed) {
    this._titleWanderStep(this._titleNpc, this._titleNpcWander, dt, elapsed);

    this.shop.update(dt, elapsed);
    this.particles.update(dt);

    // the camera follows the focal NPC around the street
    const street = this.shop.streetCenter(this._titleNpc.position);
    _townCenter.set(street.cx, 0, street.cz);
    this.engine.camTarget.lerp(_townCenter, 1 - Math.pow(0.001, dt));
    this.engine.camOffset.lerp(this.shop.camStreetOffset, 1 - Math.pow(0.1, dt));
  }

  // Leave attract mode and boot the real session — called when Play is tapped.
  startPlay() {
    if (!this._titleAttract) return;
    this._titleAttract = false;
    this._titleNpcWander = null;
    if (this._titleNpc) { this._titleNpc.dispose(); this._titleNpc = null; }
    this.player.mesh.visible = true;
    this.player.position.copy(this.shop.playerSpawn);
    this.player.animator.prevPos.copy(this.player.position);
    if (this.playerName) this.net.goOnline(this.playerName);
    this._beginShop(true);
    // the title attract dimmed the bag/store buttons for its clean menu shot;
    // a returning player boots straight onto the shop floor, so bring the
    // overground HUD back (the FTUE drives its own cave HUD from _tutStart)
    if (!this.tutorial) {
      this.hud.showBag(true);
      this.hud.showStore(this.playerArea === "shop");
    }
  }

  // ================================================================ loop
  update(dt, elapsed) {
    this.input.update();
    if (this.debugFreezeNoclip) {
      this._updateFrozenNoclip(dt, elapsed);
      return;
    }
    if (this._titleAttract) {
      this.audio.setMood("menu"); // calm title-screen theme behind the menu
      this._updateTitleAttract(dt, elapsed);
      return;
    }
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
    // if a townsfolk chat's dialogue closed for any reason, make sure the
    // person it froze is released back onto the move
    if (this._npcChat && !this.hud.speakOpen) this._endNpcChat();
    this.shop.update(dt, elapsed);
    this._updateNpcDebug(dt);
    // Storeroom is the back room — its shortcut only makes sense while the
    // player is actually inside the building, not out on the street or at the
    // cave mouth (both of which are still the "shop" area).
    if (this.playerArea === "shop")
      this.hud.showStore(this.shop.inBuilding && !this.tutorial);
    this._updateMayor(dt, elapsed);
    this._updateClerk(dt, elapsed);
    this.dungeon.update(dt, elapsed);
    this.cave?.update(dt, elapsed);
    this.particles.update(dt);
    this.slash.update(dt);
    this.remoteSlash.update(dt);
    this._updateUseFx(dt);
    this._updateRemoteUseFx(dt);
    this._updateCaveTravel();
    this._updateFtue();
    this._updateTutGuide();
    if (this._playableAnalytics) {
      this._analyticsPositionSampleT -= dt;
      if (this._analyticsPositionSampleT <= 0) {
        this._analyticsPositionSampleT = POSITION_SAMPLE_SECONDS;
        this._samplePlayablePosition();
      }
    } else {
      this._analyticsSampleT -= dt;
      if (this._analyticsSampleT <= 0) {
        this._analyticsSampleT = ANALYTICS_SAMPLE_SECONDS;
        track("player_state_sampled");
      }
    }
    this.hud.update();
    this.net.update(dt);
    this.lobby.update(dt);

    // camera follows the player in the dungeon, but stays put in the shop. The
    // boss fight plays out in the open now (the keeper storms out of its cell),
    // so there's no fixed arena lock — the camera just tracks the hero as ever.
    const p = this.player.position;
    const inDungeon = this.playerArea === "dungeon";
    const inCave = this.playerArea === "cave";
    // Indoors the camera follows within the current room's bounds; out on the
    // street it follows the player but stops at the walkable town limits.
    const outdoors = !inDungeon && !inCave;
    const zone = outdoors ? this.shop.zoneCenter(p) : null;
    const street = outdoors && !zone ? this.shop.streetCenter(p) : null;
    // In the dungeon, ease the framing toward the direction the hero is
    // actually travelling. Vertical movement gets the full portrait-friendly
    // look-ahead; sideways movement only nudges the view and preserves the
    // default extra space toward the top of the screen.
    if (inDungeon) {
      _dungeonLookWanted.set(0, 0, -DUNGEON_LOOKAHEAD);
      if (this._cameraArea === "dungeon") {
        const dx = p.x - this._dungeonCamPrevPos.x;
        const dz = p.z - this._dungeonCamPrevPos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.0001) {
          const nx = dx / d;
          const nz = dz / d;
          _dungeonLookWanted.x = nx * DUNGEON_SIDE_LOOKAHEAD;
          _dungeonLookWanted.z = nz * DUNGEON_LOOKAHEAD -
            (1 - Math.abs(nz)) * DUNGEON_LOOKAHEAD;
        }
      }
      this._dungeonCamLook.lerp(_dungeonLookWanted, 1 - Math.pow(0.08, dt));
    } else {
      this._dungeonCamLook.set(0, 0, -DUNGEON_LOOKAHEAD);
    }
    this._dungeonCamPrevPos.copy(p);
    this._cameraArea = this.playerArea;
    const camTarget =
      inDungeon ? _dungeonFocus.copy(p).add(this._dungeonCamLook).setY(0)
      // The cave keeps the original upward-biased framing.
      : inCave ? _dungeonFocus.set(p.x, 0, p.z - DUNGEON_LOOKAHEAD)
      : zone ? _townCenter.set(zone.cx, 0, zone.cz)
      : street ? _townCenter.set(street.cx, 0, street.cz)
      : p;
    const shopOffset = zone ? fitShopCamera(this.engine.camera.aspect, this.shop) : null;
    const camOffset = inDungeon || inCave ? _camDungeon
      : shopOffset || this.shop.camStreetOffset;
    // a live conversation pulls the camera down to eye level (chatting with a
    // townsperson, or reading the note); otherwise the usual overview framing
    if (this._dialogueCamTarget()) {
      this.engine.camTarget.lerp(_dialogueTarget, 1 - Math.pow(0.02, dt));
      this.engine.camOffset.lerp(_dialogueOffset, 1 - Math.pow(0.02, dt));
    } else {
      this.engine.camTarget.lerp(camTarget, 1 - Math.pow(0.001, dt));
      this.engine.camOffset.lerp(camOffset, 1 - Math.pow(0.1, dt));
    }
    // music mood: boss theme once the keeper's fight is live, dungeon while
    // delving, shop while standing in a shop zone, town out on the street
    const boss = this.dungeon.boss;
    const bossFight = inDungeon && boss && boss.deadT < 0 && this.dungeon.gateOpen;
    this.audio.setMood(
      this.gameOver ? null
      : bossFight ? "boss"
      : inDungeon || inCave ? "dungeon"
      : zone ? "shop"
      : "town"
    );

    // boss health bar: only once the gate's been breached and the fight is on —
    // the keeper waits dormant behind the bars before that, so no bar yet
    if (inDungeon && boss && boss.deadT < 0 && this.dungeon.gateOpen) {
      const bossName = boss.def?.name ?? "Ogre King of the Cellar";
      this.hud.showBossBar(boss.enraged ? `${bossName} — Enraged` : bossName, boss.enraged);
      this.hud.setBossBar(boss.hp / boss.maxHp);
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
      this.input.setJoyDash(false);
      this._updateHoleDive(dt, elapsed);
      return;
    }
    if (this._cine) {
      // the FTUE's scripted opening (the cave slime kill) drives the hero
      // itself — input is ignored until the little scene wraps up
      this.highlight.visible = false;
      this.hud.hideInteractHint();
      this.input.setJoyDash(false);
      this._updateCaveIntro(dt, elapsed);
      return;
    }
    if (this._respawnT >= 0) {
      this._respawnT -= dt;
      this.highlight.visible = false;
      this.shop.highlightTable(null);
      this.hud.hideInteractHint();
      this.input.setJoyDash(false);
      c.update(dt, elapsed);
      if (this._respawnT < 0) this._respawn();
      return;
    }
    // stepping up to a townsperson for a chat: the hero closes the gap and
    // squares off with them while the dialogue bubble is opening (see
    // _talkToNpc). Movement is otherwise frozen mid-sentence, so drive it here.
    if (this._talkApproach) {
      this._updateTalkApproach(dt);
      this.hud.hideInteractHint();
      this.highlight.visible = false;
      this.input.setJoyDash(false);
      c.update(dt, elapsed);
      return;
    }
    this._invulnT -= dt;
    this._dodgeCd -= dt;
    this._dashSolidT -= dt;
    // i-frame flicker — but never blink through a dash: the lunge AND the brief
    // i-frame grace that trails it should both read as solid
    c.mesh.visible = this._dashSolidT > 0 || this._invulnT < 0 || Math.sin(elapsed * 30) > -0.3;

    // movement
    const mv = this.input.move;
    // A sheet or a live dialogue bubble both freeze the player: no walking,
    // no swinging, no context-interacts until it's dismissed. The FTUE's
    // bag beats (turn the key, read the note) root the player the same way —
    // the bag itself stays openable, that's the whole point.
    const sheetBlocked = this.hud.sheetOpen || this.hud.speakOpen || this.hud.chatOpen || this._ftueFreeze;

    // A live dialogue bubble eats the action press to advance itself: a click
    // anywhere on screen, Space/Enter/J, or the on-screen action button. The
    // edges are consumed so they can't leak into an attack or interact this
    // frame (movement/actions are already frozen by sheetBlocked above).
    if (this.hud.speakOpen) {
      if (this.input.actionEdge || this._speakAdvanceQueued) this.hud.advanceSpeak();
      this._speakAdvanceQueued = false;
      this.input.actionEdge = false;
      this.input.dodgeEdge = false;
      this.input.interactEdge = false;
    }

    // dash / attack — grabbed before movement so it can override it. Underground
    // (dungeon or the FTUE cave) the primary on-screen button IS the attack, so
    // a press of it (actionEdge) triggers the dash too; keys (J/Shift) and the
    // right mouse button dash in every area via dodgeEdge. In touch landscape
    // there's no attack button — a quick tap on the screen is the attack.
    const underground = this.playerArea === "dungeon" || this.playerArea === "cave";
    const mode = attackMode();
    const attackDistanceMul = combat.distanceMultiplier ?? 1;
    const targetRange = mode === "autodash"
      ? (combat.autodash.range || 3.0) * attackDistanceMul
      : (combat.strikeInPlace.range || 2.2) * attackDistanceMul;
    // Manual triggers work in EVERY mode (keys / RMB, the on-screen button and
    // the landscape screen-tap while delving) so combat is always reachable.
    let attackPress = this.input.dodgeEdge ||
      (underground && this.input.actionEdge) ||
      // landscape has no attack button so a screen-tap dashes — but not in the
      // joystick-button mode, where the tap belongs to the shared centre button
      // (it only attacks when a foe's in range, else it runs the context action)
      (underground && mode !== "joystickButton" && this.input.tapAttack && this.input.tapEdge);
    let swipeDir = null;
    // joystick-button mode parks a foe here so the shared stick-centre button
    // (armed down in the context block) knows whether it's an attack or an interact
    let joyFoe = null;
    if (mode === "swipe" && this.input.swipeEdge) {
      attackPress = true;
      swipeDir = this.input.swipeDir; // dash in the flicked direction
    }
    if (mode === "joystickButton") {
      // Note whether a foe's in range for the stick-centre button; the button
      // itself (and every non-combat context action that shares it) is armed
      // below in the context block. Attack always wins the button when a foe's
      // near: the on-screen button OR a tap anywhere fires the strike here.
      // a chest is a strike target too, so it lights the attack button like a foe
      // the button now fires a plant-and-strike (not a lunge), so it should only
      // light within the strike's actual reach — otherwise there's a dead zone
      // where the button reads "attack" but the swing can't land
      const joyRange = (combat.strikeInPlace.range || 2.2) * attackDistanceMul;
      joyFoe = underground && !sheetBlocked
        ? (this._nearestEnemyWithin(joyRange, 0, 0, -2)
          || this._nearestChestWithin(joyRange, 0, 0, -2)) : null;
      if (joyFoe && (this.input.joyDashEdge || this.input.tapEdge)) attackPress = true;
    } else {
      this.input.setJoyDash(false);
    }
    const autoDashTarget = mode === "autodash"
      ? this._nearestEnemyWithin(targetRange, 0, 0, -2)
      : null;
    let movingAwayFromDash = false;
    if (autoDashTarget) {
      const moveLen = Math.hypot(this.input.move.x, this.input.move.y);
      if (moveLen > 0.15) {
        const moveTowardTarget =
          (this.input.move.x * autoDashTarget.dx + this.input.move.y * autoDashTarget.dz) /
          (moveLen * autoDashTarget.dist);
        movingAwayFromDash = moveTowardTarget < -0.1;
      }
    }
    if (mode === "autodash" && underground && !sheetBlocked &&
        this._dashT < 0 && this._dashWindT < 0 && this._dodgeCd <= 0 &&
        autoDashTarget && !movingAwayFromDash) {
      attackPress = true; // no button — a foe in range triggers the strike
    }
    // "Auto strike": like autodash (no button, foe-in-range triggers) but it
    // plants and swings in place instead of lunging. Its own strike cooldown
    // (set in _strikeInPlace) gates re-triggering via the _dodgeCd <= 0 check.
    // A short wind-up telegraph delays the swing after a foe becomes strikeable
    // so it doesn't fire the instant one steps into range; it re-arms after each
    // swing (and whenever no foe is reachable) so every strike waits the beat.
    const strikeRange = (combat.strikeInPlace.range || 2.2) * attackDistanceMul;
    if (mode === "strikeInPlace" && underground && !sheetBlocked &&
        this._dashT < 0 && this._dashWindT < 0 && this._dodgeCd <= 0 &&
        (this._nearestEnemyWithin(strikeRange, 0, 0, -2) ||
         this._nearestChestWithin(strikeRange, 0, 0, -2))) {
      this._autoStrikeWindT -= dt;
      if (this._autoStrikeWindT <= 0) {
        attackPress = true;
        this._autoStrikeWindT = combat.strikeInPlace.windup ?? 0.5;
      }
    } else {
      this._autoStrikeWindT = combat.strikeInPlace.windup ?? 0.5;
    }
    if (attackPress && !sheetBlocked) {
      if ((mode === "strikeInPlace" || mode === "joystickButton") && underground) this._strikeInPlace();
      else this._dodge(swipeDir);
      // autodash holds off re-triggering for its configured beat COUNTED FROM
      // THE END OF THE SWING (hence + lunge duration — _dodge just set _dashDur
      // for this launch), never shorter than the dash's own recovery
      if (mode === "autodash") this._dodgeCd = Math.max(this._dodgeCd, (combat.autodash.cooldown || 0.8) + this._dashDur);
    }

    // wound up on a locked foe: rooted while the shoulders coil back, then the
    // lunge itself fires the frame the beat runs out (see _dodge / _launchDash)
    if (this._dashWindT >= 0) {
      this._dashWindT -= dt;
      if (this._dashWindT < 0) this._launchDash(true);
    }

    // Locking onto a nearby foe keeps the hero facing it. Advancing/strafing
    // slows for deliberate footwork, while retreating keeps the visual lock but
    // restores full movement speed.
    const combatTarget = !sheetBlocked
      ? this._nearestEnemyWithin(targetRange, 0, 0, -2)
      : null;

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
    } else if (!sheetBlocked && this._dashWindT < 0 && (mv.x || mv.y)) {
      const fullSpeedRetreat = mode === "autodash" && movingAwayFromDash;
      const targetMul = combatTarget && !fullSpeedRetreat ? TARGET_MOVE_SPEED_MUL : 1;
      const speed = 3.7 * (this.stats.speedMul || 1) * targetMul; // boots / target lock tweak
      c.position.x += mv.x * speed * dt;
      c.position.z += mv.y * speed * dt;
    }

    // facing: through a wind-up the hero holds the coiled pose set at the press
    // (nothing may snap it away — the coil-then-whip IS the turn read); when a
    // dash locked onto a foe, look straight at it for the lunge plus a short
    // lingering beat. Otherwise facing follows the direction of travel — the
    // committed dash direction while lunging, else the movement input.
    if (this._dashFaceT > 0) this._dashFaceT -= dt;
    if (this._dashWindT >= 0) {
      // coiled — heading was set once in _dodge, leave it be
    } else if (this._dashFaceT > 0) {
      c.heading = Math.atan2(this._dashFaceDX, this._dashFaceDZ);
    } else if (this._dashT >= 0) {
      c.heading = Math.atan2(this._dashDX, this._dashDZ);
    } else if (!sheetBlocked) {
      // inside auto-aim range the hero squares off with the nearest foe —
      // standing or strafing — so who the next dash will strike is telegraphed
      // before the press ever lands. The stick only steers facing when nothing
      // is close enough to fight. (minDot -2: any bearing, no forward-arc cut.)
      const foe = combatTarget;
      if (foe) c.heading = Math.atan2(foe.dx, foe.dz);
      else if (mv.x || mv.y) c.heading = Math.atan2(mv.x, mv.y);
      else {
        // standing still by a chest: square off with it so the tap-strike that
        // cracks it open is telegraphed, the same way the hero faces a foe
        const chest = this._nearestChestWithin(AUTOAIM_RANGE * attackDistanceMul, 0, 0, -2);
        if (chest) c.heading = Math.atan2(chest.dx, chest.dz);
      }
    }
    const colliders = this.playerArea === "shop" ? this.shop.playerColliders
      : this.playerArea === "cave" ? this.cave.colliders : this.dungeon.colliders;
    this.collide(c.position, c.radius * 0.8, colliders);
    // Treasure is collected by proximity: once the final, collision-corrected
    // player position reaches a chest, crack it without requiring an attack or
    // interact press.
    if (!sheetBlocked && !this.gameOver) {
      const nearbyChest = this._nearestChestWithin(CHEST_AUTO_OPEN_RANGE, 0, 0, -2);
      if (nearbyChest) this._openChest(nearbyChest.chest);
    }
    // Environmental forage is gathered by contact, not by attacking it.
    if (!sheetBlocked) {
      if (this.playerArea === "shop") this.shop.collectForage(c.position);
      else if (this.playerArea === "dungeon" && this.dungeon.active)
        this.dungeon.collectDecor(c.position);
    }
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

    // the same floor-loot magnet works out on the meadow: forage gathered from the
    // fields (blossoms, berries, nuts, mushrooms) is pulled in and pocketed.
    if (this.playerArea === "shop" && this.shop.drops &&
        performance.now() >= (this._pickupSuppressT || 0)) {
      const bagFull = this.inventory.length >= this.invCap;
      for (const drop of [...this.shop.drops]) {
        if (drop.fly) continue;
        const dp = drop.mesh.position;
        const dx = c.position.x - dp.x;
        const dz = c.position.z - dp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= PICKUP_COLLECT_R * PICKUP_COLLECT_R) {
          this._pickupForage(drop);
          continue;
        }
        if (!bagFull && d2 <= PICKUP_MAGNET_R * PICKUP_MAGNET_R) {
          const d = Math.sqrt(d2) || 1e-4;
          drop.pull = Math.min(PICKUP_PULL_MAX, (drop.pull || PICKUP_PULL_MIN) + PICKUP_PULL_ACCEL * dt);
          const step = Math.min(drop.pull * dt, d);
          dp.x += (dx / d) * step;
          dp.z += (dz / d) * step;
        } else if (drop.pull) {
          drop.pull = 0;
        }
      }
    }

    // context action. Combat is dash-only now, so the action button is purely a
    // context / interact button: it appears for portals / stairs / gates and the
    // shop's deals, and hides when there's nothing to do. `act.label`
    // is null when the floor's clear — there's no "swing" fallback any more.
    const act = this._contextAction();
    const inDungeon = this.playerArea === "dungeon";
    const hasInteract = !!act.label;
    // out in the open meadow (no interact in reach, not indoors) the button
    // doubles as a traversal dash through the fields.
    const fieldDash = !hasInteract && this.playerArea === "shop" && !this.shop.inBuilding;
    if (mode === "joystickButton") {
      // Everything the player can do rides ONE pulsing button at the stick's
      // centre — the same one the dash uses — and a tap anywhere fires it. A foe
      // in range makes it the attack (fired up in the combat block); otherwise
      // it shows the context icon and runs act.fn (talk, dive, chest, stairs,
      // shop deals…), or becomes the open-field forage dash. No separate bottom
      // attack button or interact button in this mode — it's all the one button.
      this.input.setActionLabel(null);
      this.input.setInteract(null, false);
      this._fieldDashBtn = fieldDash;
      const joyTap = this.input.joyDashEdge || this.input.tapEdge;
      if (sheetBlocked || this.gameOver) {
        this.input.setJoyDash(false); // a sheet / dialogue owns the screen
      } else if (joyFoe) {
        this.input.setJoyDash(true, "swords", "danger");
      } else if (hasInteract) {
        this.input.setJoyDash(true, act.label, this._actionTier(act.label, act.color));
        // A tap that landed directly on a shop fixture acts on THAT fixture (via
        // the pick-to-interact path below), so tapping an object does what you
        // tapped — not merely what's nearest to the centre button. Only when the
        // tap missed every fixture (empty ground) or came from the centre button
        // itself do we route it to the proximity action; swallow it then so the
        // pick underneath can't fire on top.
        const tapOnFixture = this.playerArea === "shop" && this.input.tapEdge &&
          this.input.tap && this._dashT < 0 &&
          !!this._shopPick(this.input.tap.x, this.input.tap.y);
        if (joyTap && !tapOnFixture) { this.input.interactEdge = true; this.input.tapEdge = false; }
      } else if (fieldDash) {
        this.input.setJoyDash(true, "swords", "danger");
        if (joyTap && this._dashT < 0) { this._dodge(); this.input.tapEdge = false; }
      } else {
        this.input.setJoyDash(false);
      }
    } else if (underground) {
      // Auto lunge needs no attack button. Manual strike modes keep the crossed
      // swords button; real interactions retain their separate context button.
      this.input.setActionLabel(mode === "autodash" ? null : "swords", false);
      this.input.setInteract(act.label, hasInteract);
      this._fieldDashBtn = false;
    } else {
      // above ground the primary button is the context button when something's
      // in reach; out in the open fields (nothing to interact with, not indoors)
      // it becomes a dash button so touch players can forage the meadow too.
      this._fieldDashBtn = fieldDash;
      // portrait touch interacts by tapping the fixture directly (see _shopPick),
      // so the context button is just clutter — drop it and keep only the
      // field/forage dash button out in the open meadow.
      const portraitTouch = this.input.isTouch && !this.input.isLandscape;
      const ctxLabel = portraitTouch ? null : act.label;
      this.input.setActionLabel(this._fieldDashBtn ? "swords" : ctxLabel);
      this.input.setInteract(null, false);
    }
    // hovering a shop fixture with the mouse previews the same ring + hint you'd
    // get by walking up to it, but pinned to what's under the cursor. A live
    // hover target wins over the proximity one so the hint tracks the mouse.
    const hover = (!sheetBlocked && !this.gameOver) ? this._shopHoverAction() : null;
    if (this._clickArea) this._clickArea.style.cursor = hover ? "pointer" : "";
    const disp = hover || act;
    // a repair-able table lights up wholesale (white glow) instead of getting a
    // ground ring, so hand the glow target to the shop and skip the ring for it.
    const glowTable = (!sheetBlocked && !this.gameOver) ? (disp.glowTable || null) : null;
    this.shop.highlightTable(glowTable);
    this._updateHighlight(glowTable ? null : disp.focus, disp.color, elapsed);
    // control hint under the highlight ring: keycap + verb on desktop, verb
    // only on touch (the action button itself already pulses there). A hover
    // preview is click-driven, so it drops the [E] keycap.
    if (disp.focus && disp.hint && !sheetBlocked && !this.gameOver)
      this.hud.interactHint(disp.focus, disp.hint, hover || this.input.isTouch ? "" : "E");
    else this.hud.hideInteractHint();
    // direct click-to-interact (shop only): a left click that lands on a display
    // slot, a customer with a deal, or the cellar trapdoor opens it straight
    // away — no walking up. Handled here so it can swallow this frame's press
    // and keep the proximity action below from firing on top of it.
    let clickHandled = false;
    // touch has no mouse, so a stationary tap on the play area stands in for the
    // desktop left click that drives shop pick-to-interact (e.g. tap a shelf to
    // stock it). Fold it into the same pending-click slot the mouse feeds.
    if (!this._pendingClick && this.input.tapEdge && this.input.tap)
      this._pendingClick = { x: this.input.tap.x, y: this.input.tap.y };
    if (this._pendingClick) {
      if (this.playerArea === "shop" && !sheetBlocked && !this.gameOver && this._dashT < 0) {
        const tgt = this._shopPick(this._pendingClick.x, this._pendingClick.y);
        if (tgt) { this._doShopClick(tgt); clickHandled = true; }
      }
      this._pendingClick = null;
    }
    if (!sheetBlocked && this._dashT < 0 && !clickHandled) {
      // E / interact button: fire the context action (portal, stairs, chest, …)
      if (this.input.interactEdge && hasInteract && act.fn) act.fn();
      // primary button / Space / click acts only above ground — while delving it
      // attacks instead (handled up top via attackPress), so skip it in-dungeon
      if (this.input.actionEdge && !inDungeon) {
        if (act.fn) act.fn();
        // out in the fields with nothing to interact with, the touch button
        // fires the forage dash (desktop dashes with right-click / J / Shift)
        else if (this._fieldDashBtn && this.input.isTouch) this._dodge();
      }
      // touch landscape has no attack button: a tap that didn't land on a shop
      // fixture fires the forage dash out in the open field
      if (this.input.tapAttack && this.input.tapEdge && this._fieldDashBtn) this._dodge();
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
    if (this.hud.speakOpen) {
      if (code === "KeyJ") this._speakAdvanceQueued = true;
      return;
    }
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
      case "KeyV": return this._toggleStore();
      case "KeyC": return this._friendSheet();
      case "KeyT": return this._openChat();
      case "KeyM": return document.getElementById("mute-btn").click();
      case "Digit1": case "Digit2": case "Digit3": case "Digit4": case "Digit5": {
        const m = ATTACK_MODES[+code.slice(5) - 1];
        if (m) this._setAttackMode(m.id);
        return;
      }
      // NB: E / F (interact) are read as an input edge in _updatePlayer so they
      // stay separate from the Space/click attack — see the action routing there.
    }
  }

  // Importance tier for the shared stick-centre button (joystick-button mode):
  // red is reserved for the highest-stakes actions (combat, the boss door),
  // gold for progression / deals, green for building up the shop, grey for
  // things you can't do yet (locked, can't afford). Derived from the action's
  // icon + ring colour so each _contextAction return needn't spell it out.
  _actionTier(label, color) {
    if (label === "swords" || label === "skull") return "danger";
    if (label === "warning") return "muted"; // locked / can't afford
    if (label === "coin" || label === "box") return "build"; // repair / stock / swap
    if (label === "tools") return "build"; // hire the builder to raise a house
    if (label === "home" && color === 0x66ff9e) return "build"; // restore a lot
    return "primary"; // talk, haggle, buy, dive, descend, go up/home…
  }

  _contextAction() {
    const p = this.player.position;
    // the cave: the daylight mouth is a walk-through (see _updateCaveTravel);
    // the interacts are the four dungeon mouths in the deep chamber — all
    // silent during the FTUE's shop half, and the first stays silent while its
    // trapdoor is still shut
    if (this.playerArea === "cave") {
      const tutBlocks = this.tutorial &&
        this.tutorial !== "fetch" && this.tutorial !== "delve";
      if (!tutBlocks) {
        for (const hole of this.cave.holes) {
          _v.copy(hole.pos);
          if (_v.distanceTo(p) >= 1.8) continue;
          if (hole.id === 0 && !this.cave.trapdoorOpen) continue;
          if (!this._shortcutOpen(hole.id))
            return { label: "warning", hint: "Locked", fn: () => this._holePrompt(hole.id), focus: _v.clone().setY(0.06), color: 0x9aa0aa };
          return { label: "hole", hint: hole.name, fn: () => this._delve(hole.id), focus: _v.clone().setY(0.06), color: hole.color };
        }
      }
      return { label: null };
    }
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
      // Morel repeats his cave nudge whenever the player talks to him after
      // receiving the mushroom order. Once the FTUE is over he becomes the
      // shelf fellow and offers the next unbuilt display.
      const morel = this.shop.morel;
      const morelOrderLive = this._morelIntroDone &&
        (this.tutorial === "fetch" || this.tutorial === "forage" || this.tutorial === "trade");
      if (morelOrderLive && morel?.creature && morel.state === "idle" &&
          p.distanceTo(morel.creature.position) < 1.9) {
        const focus = _focus.copy(morel.creature.position).setY(0.06).clone();
        return { label: "speak", hint: "Talk", fn: () => this._morelReminder(), focus, color: 0x9ad0ff };
      }
      if (!this.tutorial && morel?.creature && morel.state === "idle" &&
          p.distanceTo(morel.creature.position) < 1.9 &&
          this.shop.tables.some((t) => !t.repaired)) {
        const focus = _focus.copy(morel.creature.position).setY(0.06).clone();
        return { label: "speak", hint: "Buy shelf", fn: () => this._morelPrompt(), focus, color: 0x66ff9e };
      }
      // the town builder: step up to the foreman waiting by the ruined row to
      // hire him to raise the next house (cheapest first). Unlike the old direct
      // restore, the offer shows even when short on gold (the choice sheet spells
      // out the price, like the boss gate). Hidden during the FTUE.
      const builder = this.shop.builder;
      if (!this.tutorial && builder?.creature && builder.state === "idle") {
        const hasWork = this.shop.lots?.some((lot, i) => !lot.restored && !this.townRestored[i]);
        if (hasWork && p.distanceTo(builder.creature.position) < 1.9) {
          const focus = _focus.copy(builder.creature.position).setY(0.06).clone();
          return { label: "tools", hint: "Hire builder", fn: () => this._builderPrompt(), focus, color: 0x66ff9e };
        }
      }
      // display tables: walk up to a slot to stock it. A stocked slot offers a
      // swap / take-back; an empty one takes stock from the storeroom. An
      // unbuilt table is invisible scenery — new shelves are bought from
      // Morel (see _morelPrompt), not from a walk-up repair prompt.
      const slot = this._tableSlotTarget();
      if (slot) {
        const table = slot.table;
        if (table && !table.repaired) {
          // nothing here — the spot reads as bare floor until Morel delivers
        } else {
          // during the FTUE a placed item is locked in — no swap or take-back,
          // so the player can't undo the one stock they were guided through
          if (slot.item)
            return this.tutorial ? { label: null } : { label: "box", hint: "Swap", fn: () => this._replaceMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0xff9d5c };
          if (this.stash.length > 0)
            return { label: "box", hint: "Stock", fn: () => this._placeMenu(slot), focus: _focus.copy(slot.pos).clone(), color: 0x66ff9e };
        }
      }
      // townsfolk: step up to any shopper or passer-by (not one mid-deal at the
      // counter) to strike up a chat.
      const talk = this._nearestTalkNpc();
      if (talk) {
        const focus = talk.creature.getWorldPosition(_focus).setY(0.06).clone();
        return { label: "speak", hint: "Talk", fn: () => this._talkToNpc(talk), focus, color: 0x9ad0ff };
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
        if (_v.distanceTo(p) < 1.5) return { label: "home", hint: "Go up", fn: () => this._returnHomePrompt(), focus: _v.clone().setY(0.06), color: 0x8fd0ff };
      }
      // the down-stairs press on (absent on boss floors — the way deeper there
      // is the stairs the boss leaves behind; sealed shut under the FTUE
      // forage floor's trapdoor — no prompt, the lid says it all)
      if (this.dungeon.hasDownStairs && !this.dungeon.ftue) {
        _v.copy(this.dungeon.stairsPos).add(DUNGEON_ORIGIN);
        if (_v.distanceTo(p) < 1.5) return { label: "arrowDown", hint: "Descend", fn: () => this._descend(), focus: _v.clone().setY(0.06), color: 0xff8a3d };
      }
      // Chests open automatically at arm's reach. Ring the nearest one while the
      // player approaches so the proximity target is easy to read.
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

  // The nearest townsperson (shopper or street passer-by) the player can chat
  // with — within arm's reach and not busy at the counter. Returns the customer
  // or passer-by object (both carry `.npc` and `.creature`), or null.
  _nearestTalkNpc() {
    const p = this.player.position;
    const head = this.shop.counterCustomer();
    let best = null, bd = 1.7;
    const consider = (obj) => {
      if (!obj || obj === head || !obj.npc || !obj.creature) return;
      // world position: most townsfolk live directly in shop.group (local ==
      // world), but the dojo master is nested in the positioned dojo group, so
      // his local .position is dojo-relative — getWorldPosition reconciles both
      const d = obj.creature.getWorldPosition(_v2).setY(0).distanceTo(p);
      if (d < bd) { bd = d; best = obj; }
    };
    for (const c of this.shop.customers) {
      // skip anyone committed to a deal — they're haggling, not chatting
      if (c.state === "want" || c.state === "offer" || c.state === "haggling" || c.state === "autobuy") continue;
      consider(c);
    }
    for (const pb of this.shop.passersby) consider(pb);
    if (this.shop.dojo?.master) consider(this.shop.dojo.master);
    return best;
  }

  // Walk the hero up to a townsperson at the start of a chat (see _talkToNpc):
  // seek their position, stop a conversational arm's length short, and face
  // them the whole way. Runs while the dialogue bubble is already open, so it
  // has to move the player itself (normal movement is frozen mid-sentence).
  _updateTalkApproach(dt) {
    const a = this._talkApproach;
    const c = this.player;
    const npc = a.target?.creature;
    if (!npc) { this._talkApproach = null; return; }
    a.t += dt;
    npc.getWorldPosition(_v2); // dojo master lives in a positioned group (see _nearestTalkNpc)
    _v.set(_v2.x - c.position.x, 0, _v2.z - c.position.z);
    const d = _v.length();
    if (d > 1e-3) c.heading = Math.atan2(_v.x, _v.z); // square up to them
    if (d <= a.stopDist || a.t > 2.5) { this._talkApproach = null; return; }
    _v.normalize();
    const speed = 3.7 * (this.stats.speedMul || 1);
    c.position.addScaledVector(_v, Math.min(speed * dt, d - a.stopDist));
    this.collide(c.position, c.radius * 0.8, this.shop.playerColliders);
  }

  // Raycast a shop click (screen point) against the interactable fixtures and
  // return what it hit: a display `slot` or a `customer` you can deal with.
  // Null when the click misses everything actionable.
  _shopPick(clientX, clientY) {
    const shop = this.shop;
    if (!shop) return null;
    const canvasRect = this.engine.renderer.domElement.getBoundingClientRect();
    const local = this.engine.fitMount
      ? { x: clientX - canvasRect.left, y: clientY - canvasRect.top }
      : viewport.toLocal(clientX, clientY);
    const width = this.engine.fitMount ? canvasRect.width : viewport.w;
    const height = this.engine.fitMount ? canvasRect.height : viewport.h;
    _ndc.set((local.x / width) * 2 - 1, -((local.y / height) * 2 - 1));
    this._ray.setFromCamera(_ndc, this.engine.camera);

    // candidate roots paired with what they represent; we intersect them all
    // and map the nearest hit back through its ancestry to the owning fixture.
    const pairs = [];
    const head = shop.counterCustomer();
    // anyone not busy at the counter can be clicked to strike up a chat (held
    // back during the FTUE, like the proximity Talk action)
    const talkable = (o) => !this.tutorial && o && o !== head && o.npc && o.creature &&
      o.state !== "want" && o.state !== "offer" && o.state !== "haggling" && o.state !== "autobuy";
    for (const cust of shop.customers) {
      const dealable = (cust.state === "want" && cust.slot?.item) ||
        (cust.state === "offer" && cust.sellItem);
      if (dealable && cust.creature) pairs.push([cust.creature, { type: "customer", cust }]);
      else if (talkable(cust)) pairs.push([cust.creature, { type: "npc", obj: cust }]);
    }
    for (const pb of shop.passersby) if (talkable(pb)) pairs.push([pb.creature, { type: "npc", obj: pb }]);
    if (talkable(shop.dojo?.master)) pairs.push([shop.dojo.master.creature, { type: "npc", obj: shop.dojo.master }]);
    // Morel has story/vendor dialogue rather than the generic townsfolk chat,
    // but tapping him should work at any distance just like tapping another NPC.
    const morel = shop.morel;
    const morelOrderLive = this._morelIntroDone &&
      (this.tutorial === "fetch" || this.tutorial === "forage" || this.tutorial === "trade");
    const morelShelfLive = !this.tutorial && shop.tables.some((t) => !t.repaired);
    if (morel?.creature?.visible && morel.state === "idle" && (morelOrderLive || morelShelfLive)) {
      pairs.push([morel.creature, {
        type: "morel",
        action: morelOrderLive ? "reminder" : "shelves",
      }]);
    }
    // the town builder: click him (or a ruined lot below) to open his repair offer
    if (!this.tutorial && shop.builder?.creature) pairs.push([shop.builder.creature, { type: "builder" }]);
    for (const table of shop.tables) pairs.push([table.group, { type: "table", table }]);
    for (const slot of shop.slots) if (slot.mesh) pairs.push([slot.mesh, { type: "slot", slot }]);
    // restoration lots: tap the run-down ruin/plot to rebuild it (the same
    // action the proximity button used to run — held back during the FTUE)
    if (!this.tutorial && shop.lots)
      shop.lots.forEach((lot, i) => {
        if (!lot.restored && lot.before) pairs.push([lot.before, { type: "lot", idx: i }]);
      });

    const objs = pairs.map((p) => p[0]);
    const hits = this._ray.intersectObjects(objs, true);
    if (!hits.length) return null;
    const hit = hits[0];
    let meta = null;
    for (let o = hit.object; o && !meta; o = o.parent) {
      const idx = objs.indexOf(o);
      if (idx >= 0) meta = pairs[idx][1];
    }
    if (!meta) return null;
    // a click on a table body resolves to the nearest slot on that table
    if (meta.type === "table") {
      let best = null, bd = Infinity;
      for (const s of meta.table.slots) {
        const d = (s.pos.x - hit.point.x) ** 2 + (s.pos.z - hit.point.z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      return best ? { type: "slot", slot: best } : null;
    }
    return meta;
  }

  // Resolve whatever shop fixture the mouse is hovering into the same shape a
  // proximity context action produces ({hint, focus, color, glowTable}), so the
  // ring + hint can preview a click before you make it. Desktop-only (touch has
  // no hover); null when the cursor isn't over anything actionable.
  _shopHoverAction() {
    if (this.playerArea !== "shop" || this.input.isTouch || !this._pointer) return null;
    if (this._dashT >= 0) return null;
    const target = this._shopPick(this._pointer.x, this._pointer.y);
    if (!target) return null;
    if (target.type === "customer") {
      const cust = target.cust;
      const focus = _focus.copy(cust.creature.position).setY(0.06).clone();
      if (cust.state === "want") return { hint: "Haggle", focus, color: 0xffd34d };
      return { hint: "Buy", focus, color: 0x8fe0ff };
    }
    if (target.type === "npc") {
      const focus = target.obj.creature.getWorldPosition(_focus).setY(0.06).clone();
      return { hint: "Talk", focus, color: 0x9ad0ff };
    }
    if (target.type === "morel") {
      const focus = this.shop.morel.creature.getWorldPosition(_focus).setY(0.06).clone();
      return {
        hint: target.action === "reminder" ? "Talk" : "Buy shelf",
        focus,
        color: target.action === "reminder" ? 0x9ad0ff : 0x66ff9e,
      };
    }
    if (target.type === "builder") {
      const b = this.shop.builder;
      const hasWork = this.shop.lots?.some((lot, i) => !lot.restored && !this.townRestored[i]);
      if (!hasWork || b.state !== "idle") return null;
      return { hint: "Hire builder", focus: _focus.copy(b.creature.position).setY(0.06).clone(), color: 0x66ff9e };
    }
    if (target.type === "lot") {
      const b = this.shop.builder;
      if (!b || b.state !== "idle") return null; // he's already busy on a house
      return { hint: "Hire builder", focus: _focus.copy(this.shop.lots[target.idx].interactPos).setY(0.06).clone(), color: 0x66ff9e };
    }
    if (target.type === "slot") {
      const slot = target.slot;
      const table = slot.table;
      if (table && !table.repaired) return null; // unbuilt shelves are scenery — see Morel
      if (slot.disabled) return null;
      // a placed item is locked in during the FTUE — no swap or take-back
      if (slot.item) return this.tutorial ? null : { hint: "Swap", focus: _focus.copy(slot.pos).clone(), color: 0xff9d5c };
      if (this.stash.length > 0) return { hint: "Stock", focus: _focus.copy(slot.pos).clone(), color: 0x66ff9e };
    }
    return null;
  }

  // Run the interaction for a clicked shop fixture — mirrors the proximity
  // context action, so clicking a slot / customer does exactly what walking
  // up and pressing E would.
  _doShopClick(target) {
    if (target.type === "customer") {
      const cust = target.cust;
      if (cust.state === "want" && cust.slot?.item) this._haggle(cust);
      else if (cust.state === "offer" && cust.sellItem) this._buyFrom(cust);
      return;
    }
    if (target.type === "npc") {
      this._talkToNpc(target.obj);
      return;
    }
    if (target.type === "morel") {
      if (target.action === "reminder") this._morelReminder();
      else this._morelPrompt();
      return;
    }
    if (target.type === "builder") {
      this._builderPrompt();
      return;
    }
    if (target.type === "lot") {
      // clicking a ruined lot goes through the builder (he does the actual work)
      if (!this.tutorial) this._builderPrompt();
      return;
    }
    if (target.type === "slot") {
      const slot = target.slot;
      const table = slot.table;
      if (table && !table.repaired) return; // unbuilt shelves are scenery — see Morel
      if (slot.disabled) return;
      if (slot.item) { if (!this.tutorial) this._replaceMenu(slot); }
      else if (this.stash.length > 0) this._placeMenu(slot);
      else this.hud.toast("Storeroom's empty — dive for stock.");
    }
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

  // Playtest sessions retain one-second spatial detail while only
  // spending one PostHog event per five samples.
  _samplePlayablePosition() {
    const p = this.player?.position;
    if (!p) return;
    const round = (n) => Math.round(n * 10) / 10;
    this._analyticsPositionBatch.push({
      timestamp: Date.now(),
      x: round(p.x),
      z: round(p.z),
      area: this.playerArea,
      floor: this.playerArea === "dungeon" ? this.dungeon?.floor ?? null : null,
      seed: this.playerArea === "dungeon" ? this.dungeon?.seed ?? null : null,
      tutorial: this.tutorial,
    });
    if (this._analyticsPositionBatch.length < POSITION_BATCH_SIZE) return;
    const samples = this._analyticsPositionBatch.splice(0, POSITION_BATCH_SIZE);
    track("player_position_batch", {
      sample_timestamp_ms: samples.map((sample) => sample.timestamp),
      player_x: samples.map((sample) => sample.x),
      player_z: samples.map((sample) => sample.z),
      area: samples.map((sample) => sample.area),
      dungeon_floor: samples.map((sample) => sample.floor),
      dungeon_seed: samples.map((sample) => sample.seed),
      tutorial_step: samples.map((sample) => sample.tutorial),
      sample_count: samples.length,
    });
  }

  // Shared PostHog properties. Position is rounded to a tenth of a world unit:
  // enough resolution for route/heatmap analysis without near-unique floats.
  // The walkable ground plane is X/Z; Y is retained as the true vertical axis.
  _analyticsState() {
    const p = this.player?.position;
    const round = (n) => Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
    const bagContents = [...(this.inventory || [])].sort();
    const displayContents = (this.shop?.slots || [])
      .map((slot) => slot.item)
      .filter(Boolean)
      .sort();
    return {
      player_x: round(p?.x),
      player_y: round(p?.y),
      player_z: round(p?.z),
      area: this.playerArea,
      dungeon_floor: this.playerArea === "dungeon" ? this.dungeon?.floor ?? null : null,
      ...(this._testerId ? { tester_id: this._testerId } : {}),
      hp: this.hp,
      max_hp: this.maxHp,
      gold: this.gold,
      coins: this.gold,
      bag_items: bagContents.length,
      bag_capacity: this.invCap,
      bag_full: bagContents.length >= this.invCap,
      bag_contents: bagContents,
      bag_unique_items: new Set(bagContents).size,
      stash_items: this.stash?.length ?? 0,
      stash_unique_items: new Set(this.stash || []).size,
      display_items: displayContents.length,
      display_contents: displayContents,
      run_day: this.day,
      tutorial_step: this.tutorial,
      deepest_floor: this.deepestEver,
      town_population: this.townPop?.() ?? 0,
      shelves_repaired: this.tablesRepaired?.filter(Boolean).length ?? 0,
      weapon: this.equipment?.weapon ?? null,
      chest_armor: this.equipment?.chest ?? null,
      shield: this.equipment?.shield ?? null,
      ring: this.equipment?.ring ?? null,
      boots: this.equipment?.boots ?? null,
      attack_mode: attackMode(),
      coop: !!this.net?.connected,
      coop_role: !this.net?.connected ? "solo" : this.net.isGuest ? "guest" : "host",
    };
  }

  // ================================================================ economy
  _freshDayStats() {
    return {
      goldStart: this.gold,
      earned: 0, spent: 0, sold: 0, perfect: 0, bestCombo: 0,
      bought: 0, slain: 0, looted: 0, deepest: 0,
    };
  }

  // set the current area's resting framing, then open on a close-up of the
  // hero and let the engine's camera lerp glide out to it (see _introCamera)
  _snapCamera() {
    // area transitions are teleports, so the light palette snaps with the
    // camera — otherwise the street spends seconds brightening out of the
    // cave's gloom on every walk-through (see Shop._updateLighting)
    this.shop._litInit = false;
    const area = this.playerArea;
    if (area === "dungeon" || area === "cave") {
      const p = this.player.position;
      this.engine.camTarget.set(p.x, 0, p.z - DUNGEON_LOOKAHEAD);
      this.engine.camOffset.copy(_camDungeon);
    } else {
      const zone = this.shop.zoneCenter(this.player.position);
      if (zone) {
        this.engine.camTarget.set(zone.cx, 0, zone.cz);
        this.engine.camOffset.copy(fitShopCamera(this.engine.camera.aspect, this.shop));
      } else {
        const street = this.shop.streetCenter(this.player.position);
        this.engine.camTarget.set(street.cx, 0, street.cz);
        this.engine.camOffset.copy(this.shop.camStreetOffset);
      }
    }
    this._introCamera();
  }

  // Start each entry from a soft close-up: the camera sits a short hop in front
  // of the hero at face height (eye level, no dive), so the engine's per-frame
  // lerp zooms out to the resting framing instead of swooping in from wherever
  // the previous area's camera happened to sit.
  _introCamera() {
    const p = this.player.position;
    const faceY = p.y + (this.player.height ?? 1.5) * 0.9;
    // pull straight back along the camera's viewing axis (it looks from +z),
    // keeping a pure dolly-out with no lateral swing
    this.engine.camera.position.set(p.x, faceY, p.z + 2.4);
  }

  // While a conversation is on stage — chatting with a townsperson, or the hero
  // reading the uncle's note — the camera leaves its high overview and glides
  // down to an intimate eye-level two-shot, framed between the speakers and
  // looking at head height from the world's usual +z vantage. Populates the
  // module scratch framing and returns true when a dialogue is live; the main
  // loop lerps toward it and, once the chat closes, drifts back on its own.
  _dialogueCamTarget() {
    let a = null, b = null;
    const chat = this._npcChat?.target?.creature;
    if (chat) {
      a = this.player.position;
      b = chat.getWorldPosition(_dialogueB);
    } else if (this._sceneCam || this._selfCam) {
      a = b = this.player.position; // the hero, alone with their thoughts (or Morel's)
    } else return false;
    // focus on the midpoint of the two speakers, raised so the look point
    // (camTarget + 0.6, see Engine._updateCamera) lands around their faces
    _dialogueTarget.set((a.x + b.x) / 2, 0.9, (a.z + b.z) / 2);
    // sit low and close, straight back along +z (the authored viewing axis),
    // pulling back on narrow portrait viewports so both speakers still fit
    const pull = Math.max(1, 0.6 / Math.max(0.01, this.engine.camera.aspect));
    _dialogueOffset.set(0, 0.15, 3.1 * pull);
    return true;
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
    document.getElementById("store-btn").onclick = () => this._toggleStore();
    this.hud.miniUpBtn.onclick = () => this._returnHomePrompt();
    this.hud.showBag(true); // the bag is reachable everywhere
    this.hud.showStore(this.playerArea === "shop" && !this.tutorial); // storeroom is shop-only
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

  // ------------------------------------------------------------ orientation
  // The game plays in whatever orientation the device is held — both portrait
  // and landscape are supported. We never lock the screen or CSS-rotate; we
  // just keep the renderer sized to the live viewport on every rotation. The
  // coordinate math reads native window dimensions (`viewport.rotated` stays
  // false), so nothing needs swapping.
  _initLandscapeLock() {
    if (!this.input.isTouch) return;
    viewport.rotated = false;
    document.documentElement.classList.remove("force-landscape");
    const sync = () => this.engine.resize();
    const mq = matchMedia("(orientation: portrait)");
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else mq.addListener(sync);
    // Some mobile browsers only settle the viewport a beat after the event.
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
      <div id="esc-combat" class="esc-combat">${this._escCombatHtml()}</div>
    `, "sheet-card esc-sheet");
    el.querySelector("#esc-combat").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-cmode]");
      if (btn) this._setAttackMode(btn.dataset.cmode);
    });
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
      if (c.disabled) continue;
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
// A low-rate heartbeat for spatial occupancy and state analysis. Meaningful
// gameplay events also receive the same context through the provider above.
const ANALYTICS_SAMPLE_SECONDS = 30;
const POSITION_SAMPLE_SECONDS = 1;
const POSITION_BATCH_SIZE = 5;
const REPLAY_FALLBACK_SEED = 19790417;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _ndc = new THREE.Vector2();
// The indoor shop framing (shop.camShopOffset) pulled back for narrow portrait
// viewports so the shop's width still fits on screen. The base offset and the
// fit aspect both live on the shop now (editable via layout.json's `camera`).
const _camShopFit = new THREE.Vector3();
function fitShopCamera(aspect, shop) {
  const scale = Math.max(1, shop.camShopFitAspect / Math.max(0.01, aspect));
  return _camShopFit.copy(shop.camShopOffset).multiplyScalar(scale);
}
// Pulled back to sit the same distance from the hero as the overworld street
// cam (~15.7 units — see CAMERA_STREET_OFFSET), so delving isn't more zoomed-in
// than town. Keeps the dungeon's own (slightly lower, more forward) tilt.
const _camDungeon = new THREE.Vector3(0, 11.25, 10.98);
// how far up the floor the delving camera looks past the hero (world units):
// biases the focus toward the top of the screen so more of the path ahead shows
const DUNGEON_LOOKAHEAD = 3;
// Horizontal look-ahead is deliberately restrained: portrait screens have
// much less room at the sides than above and below the hero.
const DUNGEON_SIDE_LOOKAHEAD = 1.15;
// scratch focus point for the delving camera's look-ahead bias
const _dungeonFocus = new THREE.Vector3();
const _dungeonLookWanted = new THREE.Vector3();
// scratch target for the bounded indoor camera focus
const _townCenter = new THREE.Vector3();
// scratch framing for the eye-level dialogue camera (see _dialogueCamTarget)
const _dialogueTarget = new THREE.Vector3();
const _dialogueOffset = new THREE.Vector3();
const _dialogueB = new THREE.Vector3();
