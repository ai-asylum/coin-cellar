// Player combat: swings, ranged shots, aim assist, dodge rolls, taking damage
// and respawn. Attached to Game.prototype via Object.assign, so `this` is the
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

export const combatMethods = {
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
  },

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
  },

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
  },

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
  },

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
      this.player.die(_v.multiplyScalar(-6).setY(-2));
      this.hud.banner("You got carried home…", "your bag was lost", 2.6);
      this.audio.gameover();
      this._respawnT = 2.4;
    } else {
      // still standing but hurt — quaff a consumable if one fits the wound
      this._tryAutoHeal();
    }
  },

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
