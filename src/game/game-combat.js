// Player combat: the dash strike (auto-aiming lunge that damages what it sweeps
// through — combat is dash-only), taking damage and respawn. Attached to
// Game.prototype via Object.assign, so `this` is the
// live Game instance. NB: `_recomputeStats` and the `get _crit` accessor stay
// in game.js (Object.assign would copy a getter's value, not the accessor) —
// the methods here reach them through `this` as usual.
import * as THREE from "three";
import { BlockyCreature } from "../chargen/blocky.js";
import { weaponMesh } from "./gear.js";
import { icon } from "../core/icons.js";

// per-call scratch vectors (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// The shallow floors act as a safe zone: pass out on floor 1–3 and the shop
// clerk hauls you back up with your bag intact (see _respawn). Deeper than
// this and a knockout still costs you everything you were carrying.
const SAFE_ZONE_FLOOR = 3;

// How close a foe must be for the dash to auto-aim onto it. Kept just past the
// lunge's own travel + reach so it only nudges toward foes it can actually hit.
// Exported: game.js also squares the hero off with any foe inside this range
// *before* the press, so the coming strike's target is always telegraphed.
export const AUTOAIM_RANGE = 3.2;
// The dash locks onto any foe inside this forward arc (cos(80°) ≈ 0.17): the
// lunge redirects into that foe and the hero turns to face it. A generous arc
// so you dive into — and visibly swing toward — off-axis foes, not just the
// one dead ahead. Foes further to the side or behind are left alone so you can
// still dash to reposition.
const AUTOAIM_FACE_DOT = 0.17;
// Keep facing the locked foe for this beat past the lunge so the turn reads and
// your stick doesn't snap the hero straight back the instant the dash ends.
const AUTOAIM_FACE_HOLD = 0.28;
// A locked dash winds up before it fires: the hero roots for this beat and
// coils DASH_WINDBACK radians past the foe's bearing, then whips through it as
// the lunge launches. The coil guarantees a visible swing on every locked dash
// — even a foe dead ahead gets a wind-back-and-snap instead of no turn at all.
const DASH_WINDUP = 0.12;
const DASH_WINDBACK = 0.55; // ~31° past the foe's bearing

export const combatMethods = {
  // Offset to the nearest living foe within `range` that sits inside the dash's
  // aim cone (or null if none). `dirX/dirZ` is the intended (unit) dash
  // direction; a foe only counts when the (normalised) offset to it aligns with
  // the dash by at least `minDot`, so foes off to the side or behind you are
  // left alone and you keep dashing where you steered.
  _nearestEnemyWithin(range, dirX, dirZ, minDot = 0) {
    // in the FTUE cave the only things to aim at are the ambient rats
    const targets = this.playerArea === "dungeon" && this.dungeon.active ? this.dungeon.enemies
      : this.playerArea === "cave" && this.cave ? this.cave.rats
      : null;
    if (!targets) return null;
    const p = this.player.position;
    let best = null, bestD = range * range;
    for (const e of targets) {
      if (e.deadT >= 0 || e.creature.dead) continue;
      const dx = e.creature.position.x - p.x;
      const dz = e.creature.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d >= bestD || d <= 0.0001) continue;
      // only aim at foes aligned enough with the dash direction
      const dist = Math.sqrt(d);
      if ((dx * dirX + dz * dirZ) / dist < minDot) continue;
      bestD = d; best = { dx, dz, dist, foe: e };
    }
    return best;
  },

  // The dash is the whole of your offence now: a quick lunge with brief i-frames
  // that damages every foe it sweeps through (and cracks chests / smashes props
  // in its path — see Dungeon.dashHit). When a foe is close the dash auto-aims:
  // the hero plants, coils back past the foe's bearing for a beat, then whips
  // around into the lunge — the wind-up is what makes the turn readable.
  _dodge() {
    if (this._dashT >= 0 || this._dashWindT >= 0 || this._dodgeCd > 0 || this._respawnT >= 0 || this.gameOver) return;
    const mv = this.input.move;
    let dx, dz;
    if (mv.x || mv.y) {
      const l = Math.hypot(mv.x, mv.y) || 1;
      dx = mv.x / l; dz = mv.y / l;
    } else {
      // no steer: lunge the way you're facing (a forward strike now that the
      // dash is an attack, not a backstep)
      dx = Math.sin(this.player.heading);
      dz = Math.cos(this.player.heading);
    }
    this._dodgeCd = 0.55 * (this.stats.dodgeCdMul || 1);
    // auto-aim: whenever a foe sits within the dash arc, LOCK onto it and wind
    // up — a rooted beat where nothing moves but the hero's shoulders, so the
    // pivot toward the foe can't get lost under the lunge's VFX. The lunge
    // itself fires from _launchDash once the beat runs out (ticked in game.js).
    const target = this._nearestEnemyWithin(AUTOAIM_RANGE, dx, dz, AUTOAIM_FACE_DOT);
    if (!target) {
      this._dashFaceT = 0;
      this._dashDX = dx;
      this._dashDZ = dz;
      this._launchDash(false);
      return;
    }
    this._dashFaceDX = target.dx / target.dist;
    this._dashFaceDZ = target.dz / target.dist;
    this._dashFaceT = 0; // no stale gaze-hold may steal the coiled pose
    this._dashWindFoe = target.foe;
    this._dashWindT = DASH_WINDUP;
    // i-frames + solid draw from the press — the wind-up must not add a
    // vulnerable beat to what used to be an instant dodge
    this._invulnT = Math.max(this._invulnT, DASH_WINDUP + 0.36);
    this._dashSolidT = DASH_WINDUP + 0.36;
    // coil: swing to just past the foe's bearing on the near side, crouched,
    // so the launch always whips visibly through the target
    const face = Math.atan2(this._dashFaceDX, this._dashFaceDZ);
    let d = face - this.player.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.player.heading = face - (d >= 0 ? 1 : -1) * DASH_WINDBACK;
    this.player.animator.squash.kick(3);
    // and flag the locked foe itself, so there's no doubt who's about to get hit
    _v.copy(target.foe.creature.position).setY(0.3);
    this.particles.burst(_v, { color: 0xffd76a, n: 10, speed: 2.4, up: 0.9, gravity: 2.5, life: 0.3, size: 0.8 });
  },

  // Fire the lunge itself — immediately for a plain (unlocked) dash, or at the
  // end of the wind-up beat for a locked one (game.js ticks _dashWindT down and
  // calls this with locked=true).
  _launchDash(locked) {
    this._dashWindT = -1;
    if (locked) {
      // re-aim at where the foe stands NOW — it may have stepped mid-wind-up
      const foe = this._dashWindFoe;
      this._dashWindFoe = null;
      if (foe && !(foe.deadT >= 0) && !foe.creature.dead) {
        const fdx = foe.creature.position.x - this.player.position.x;
        const fdz = foe.creature.position.z - this.player.position.z;
        const dist = Math.hypot(fdx, fdz);
        if (dist > 0.01) {
          this._dashFaceDX = fdx / dist;
          this._dashFaceDZ = fdz / dist;
        }
      }
      this._dashDX = this._dashFaceDX;
      this._dashDZ = this._dashFaceDZ;
      // hold the gaze past the lunge so the stick can't snap the whip short
      this._dashFaceT = this._dashDur + AUTOAIM_FACE_HOLD;
    }
    this._dashT = 0;
    this._invulnT = Math.max(this._invulnT, 0.36); // i-frames through the dash
    this._dashSolidT = Math.max(this._dashSolidT, 0.36); // drawn solid throughout
    // fresh damage pass for this dash: each foe / chest takes the hit only once
    this._dashHitIds = new Set();
    this._dashCrit = Math.random() < this._crit;
    this._dashDmg = Math.max(1, Math.round(4 * this.stats.dmgMul)) * (this._dashCrit ? 2 : 1);
    // snap heading through the target: from the coiled pose this is the whip
    // the wind-up promised; a heavier squash pop sells the turn-strike
    this.player.heading = Math.atan2(this._dashDX, this._dashDZ);
    this.player.animator.squash.kick(locked ? 8 : 5);
    this.audio.dodge();
    // Keep the dash's own VFX: the blue burst at the feet ...
    _v.copy(this.player.position).setY(0.1);
    this.particles.burst(_v, { color: 0xbfe8ff, n: 9, speed: 2.6, up: 0.6, gravity: 3, life: 0.35, size: 0.9 });
    // ... plus a slash swoosh along the lunge so the strike reads as an attack
    _v.copy(this.player.position).setY(0.62);
    this.slash.play(_v, this.player.heading, 1.2);
  },

  // Resolve the dash's contact for the current frame while it's live: damage
  // every foe swept through (each hit once, tracked in _dashHitIds), crack any
  // chest it barrels into and smash scenery in its path. Host applies damage; a
  // guest sends the hit and lets the host echo it back.
  _dashStrike() {
    if (this._dashT < 0 || !this._dashHitIds) return;
    if (this.playerArea === "cave" && this.cave) {
      this.cave.dashHit(this.player);
      return;
    }
    if (this.playerArea !== "dungeon" || !this.dungeon.active) return;
    this.dungeon.dashHit(this.player, this._dashDmg, this, {
      crit: this._dashCrit, hitIds: this._dashHitIds,
    });
  },

  enemyHitsPlayer(e, targetEntry) {
    if (!targetEntry.local) {
      this.net.send({ t: "pHurt", dmg: e.def.dmg });
      return;
    }
    this.applyPlayerDamage(e.def.dmg, e.creature.position);
  },

  // routed like enemyHitsPlayer, but the source is a flying orb/bolt
  enemyProjectileHitsPlayer(proj, targetEntry) {
    if (!targetEntry.local) {
      this.net.send({ t: "pHurt", dmg: proj.dmg });
      return;
    }
    this.applyPlayerDamage(proj.dmg, _v.set(proj.x, 0, proj.z));
  },

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
      // On the shallow floors the clerk recovers you before you drop your bag —
      // latch it now (the floor is still known here) so _respawn keeps the loot.
      this._safeRecovery = this.playerArea === "dungeon" &&
        this.dungeon.floor >= 1 && this.dungeon.floor <= SAFE_ZONE_FLOOR;
      this.player.die(_v.multiplyScalar(-6).setY(-2));
      this.hud.banner("You got carried home…",
        this._safeRecovery ? "the clerk found you in the street" : "your bag was lost", 2.6);
      this.audio.gameover();
      this._respawnT = 2.4;
    }
  },

  _respawn() {
    // drop any mid-flight use flourishes (the old player blob is a ragdoll now)
    for (const fx of this._useFx) fx.mesh.removeFromParent();
    this._useFx = [];
    // dying empties your bag (the loot you were carrying) instead of taxing gold —
    // unless the clerk pulled you out of the safe-zone floors, where it stays put
    const safeRecovery = this._safeRecovery;
    this._safeRecovery = false;
    if (!safeRecovery) this.inventory = [];
    if (!this.net.isGuest) {
      this._syncState();
    }
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(this.gold);
    // rebuild the player blob (the old one is a ragdoll now) — carry over the
    // shoulder-pivot turn rate from the outgoing hero so respawns keep the same
    // capped-turn feel set at init (PLAYER_TURN_RATE in game.js)
    const held = this.player.heldItem;
    const turnRate = this.player.turnRate;
    this.player.dispose();
    this.player = new BlockyCreature("a", { height: 1.3, turnRate });
    this.player.position.set(0, 0, 2.5);
    this._heldWeaponId = this.equipment.weapon;
    this.player.holdItem(weaponMesh(this.equipment.weapon));
    this.engine.scene.add(this.player);
    this.player.animator.onFootstep = (pos, k) => this.audio.step();
    this.playerArea = "shop";
    this.lobby.leave();
    this.hud.showHearts(false);
    this.hud.showBag(true);
    this.hud.showStore(!this.tutorial);
    this.hud.showGold(true);
    this.hud.setGoldCorner(false);
    this._save();
    if (safeRecovery) {
      // the clerk hauled you back with the loot — tuck it into the storeroom
      // like any homecoming, then bring the clerk in beside you to explain what
      // happened (a character you wake up next to, who then sees himself out)
      this._depositBag();
      this._clerkRecovery();
    }
  },

  playersInDungeon() {
    const list = [];
    if (this.playerArea === "dungeon" && this._respawnT < 0) list.push({ creature: this.player, local: true });
    // only count the partner as a target while they share our floor — the host
    // simulates one floor, so a partner off on another floor isn't in the fight
    if (this.remote && this.remote.area === "dungeon" && !this.remote.dead &&
        (this.remote.floor < 0 || this.remote.floor === this.dungeon.floor))
      list.push({ creature: this.remote.creature, local: false });
    return list;
  },
};
