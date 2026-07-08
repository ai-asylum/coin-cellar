// Enemy AI: the per-frame update loop, aggro/locomotion behaviors, the
// telegraph FX and the attack state machine. Mixed onto Dungeon.prototype via
// Object.assign in dungeon.js, so every `this._method()` call keeps working.
import * as THREE from "three";
import { BOSS_ATK_WINDUP, BOSS_ATK_GLOW } from "./dungeon-data.js";

const IMP_DECAY = 0.0012; // per-second base for impulse/knockback friction
// an impulse of v decays to a total travel of v / -ln(IMP_DECAY); invert that so
// a lunge can be aimed to land a chosen distance away instead of a fixed speed
const LEAP_K = -Math.log(IMP_DECAY);

const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

// shortest-arc lerp between two headings (radians), so a fleeing creature turns
// smoothly across the ±π wrap instead of spinning the long way round
function angLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const aiMethods = {
  // touching an enemy's body hurts, attacking or not — a slime that drifts
  // into you should still sting. The player's i-frames gate the actual damage;
  // a per-enemy cooldown keeps the net traffic (remote player) sane.
  _contactDamage(e, dt, players) {
    // harmless critters (the fleeing rat) never sting on contact — brushing
    // past one as it bolts should cost the player nothing
    if (e.deadT >= 0 || e.def.harmless) return;
    e.contactCd = (e.contactCd ?? 0) - dt;
    if (e.contactCd > 0) return;
    const c = e.creature;
    for (const p of players) {
      const pc = p.creature;
      const touch = c.radius + pc.radius + 0.05;
      const dx = pc.position.x - c.position.x;
      const dz = pc.position.z - c.position.z;
      if (dx * dx + dz * dz <= touch * touch) {
        this.game.enemyHitsPlayer(e, p);
        e.contactCd = 0.6;
        break;
      }
    }
  },

  _nearestPlayer(c, players) {
    let target = null, bd = 1e9;
    for (const p of players) {
      const d = c.position.distanceTo(p.creature.position);
      if (d < bd) { bd = d; target = p; }
    }
    return target;
  },

  _updateEnemy(e, dt, elapsed, players) {
    const c = e.creature;
    if (e.deadT >= 0) {
      e.deadT += dt;
      c.update(dt, elapsed);
      if (e.deadT > 1.4) {
        c.position.y -= dt * 1.2; // sink away
        if (e.deadT > 2.2) this._removeEnemy(e);
      }
      return;
    }
    e.t += dt;
    e.attackCd -= dt;

    // apply + decay impulse velocity (knockback + lunge dashes) every frame
    const fr = Math.pow(IMP_DECAY, dt);
    c.position.x += e.vx * dt;
    c.position.z += e.vz * dt;
    e.vx *= fr;
    e.vz *= fr;

    // a lunging foe (slime) only lands its blow once the leap actually reaches a
    // player — checked each frame during the dash rather than up front, so a
    // pounce that falls short or misses deals nothing.
    if (e.lungeHitT > 0) {
      e.lungeHitT -= dt;
      if (this._meleeStrikeHit(e, players, 0.3)) e.lungeHitT = 0;
    }

    const target = this._nearestPlayer(c, players);
    const bd = target ? c.position.distanceTo(target.creature.position) : 1e9;
    const def = e.def;
    const speed = def.speed * (1 + e.tier * 0.08) * (e.enraged ? 1.35 : 1);

    // -------- attack state machine (takes priority over locomotion) --------
    if (e.atkState === "windup") {
      e.atkT += dt;
      if (e.behavior === "boss") this._bossTelegraphFx(e, e.atkT / e.windupDur, dt);
      else this._minionTelegraphFx(e, e.atkT / e.windupDur, dt);
      if (target) c.heading = Math.atan2(target.creature.position.x - c.position.x, target.creature.position.z - c.position.z);
      // melee foes lunge along their committed direction during the windup so
      // the blow lands on contact — they visibly charge in and collide instead
      // of swiping from a gap. Direction is locked at windup start so a dodge
      // still beats it (they charge past where you were).
      if (e.isCharge && target) {
        const contact = c.radius + target.creature.radius;
        const cd = c.position.distanceTo(target.creature.position);
        if (cd > contact) {
          const step = Math.min(speed * 1.9 * dt, cd - contact);
          c.position.x += e.chargeX * step;
          c.position.z += e.chargeZ * step;
        }
      }
      if (e.atkT >= e.windupDur) {
        this._enemyStrike(e, target, players);
        e.atkState = "recover";
        e.atkT = 0;
        c.setGlow(null);
      }
      this._finishFrame(e, dt, elapsed);
      return;
    }
    if (e.atkState === "recover") {
      e.atkT += dt;
      if (e.atkT >= e.recoverDur) e.atkState = "none";
      this._finishFrame(e, dt, elapsed);
      return;
    }

    // -------- aggro + locomotion --------
    if (target && bd < def.aggro) e.state = "chase";
    else if (e.state === "chase") e.state = "idle";

    const preX = c.position.x, preZ = c.position.z;
    if (e.state === "chase" && target) this._chase(e, target, bd, speed, dt);
    else this._wander(e, speed, dt);

    this._finishFrame(e, dt, elapsed);

    // Prey that barely moved while fleeing is jammed against geometry — bank a
    // sideways turn so next frame it peels along the wall instead of grinding
    // into it. Clears once it's running freely again.
    if (e.behavior === "flee" && e.state === "chase") {
      const moved = Math.hypot(c.position.x - preX, c.position.z - preZ);
      if (moved < speed * dt * 0.5) {
        if (!e.fleeTurn) e.fleeTurn = (Math.random() < 0.5 ? -1 : 1) * 0.7;
        e.fleeTurn = clampN(e.fleeTurn * 1.25, -2.4, 2.4);
      } else {
        e.fleeTurn = (e.fleeTurn || 0) * 0.6;
      }
    }
  },

  // separation + wall collision + creature tick + net track, shared by every path
  _finishFrame(e, dt, elapsed) {
    this._separate(e);
    this.game.collide(e.creature.position, e.creature.radius, this.colliders);
    e.creature.update(dt, elapsed);
    this.game.net.trackEnemy(e);
  },

  _chase(e, target, dist, speed, dt) {
    const c = e.creature;
    const tp = target.creature.position;
    _d.set(tp.x - c.position.x, 0, tp.z - c.position.z);
    _d.y = 0;
    _d.normalize();
    const face = Math.atan2(_d.x, _d.z);
    const strike = c.radius + target.creature.radius + (e.def.reach ?? 1);
    const ready = e.attackCd <= 0;

    switch (e.behavior) {
      case "flee": {
        // prey, not predator: run away from the nearest player and never wind up
        // an attack. Rather than sprint dead-away (which pins it in corners), it
        // eases a committed escape heading toward "away from the player", plus a
        // gentle scurry weave and any sideways kick banked from bumping a wall
        // last frame (see _updateEnemy) — so a cornered rat peels along the wall
        // and slips free instead of grinding face-first into it.
        const away = Math.atan2(-_d.x, -_d.z); // _d points at the player
        if (e.fleeHeading == null) e.fleeHeading = away;
        const weave = Math.sin(e.t * 9 + e.seed) * 0.25;
        const goal = away + (e.fleeTurn || 0) + weave;
        e.fleeHeading = angLerp(e.fleeHeading, goal, 0.2);
        c.heading = e.fleeHeading;
        const panic = dist < 2.2 ? 1.4 : 1; // extra scramble when close
        c.position.x += Math.sin(e.fleeHeading) * speed * panic * dt;
        c.position.z += Math.cos(e.fleeHeading) * speed * panic * dt;
        break;
      }
      case "swarm": {
        // erratic weave so a swarm doesn't march in a straight line
        const weave = Math.sin(e.t * 7 + e.seed) * 0.55;
        _p.set(-_d.z, 0, _d.x).multiplyScalar(weave);
        _d.add(_p).normalize();
        c.heading = Math.atan2(_d.x, _d.z);
        if (dist > strike) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "strafe": {
        c.heading = face;
        const ring = strike + 0.7;
        if (dist > ring + 0.4) c.position.addScaledVector(_d, speed * dt);
        else if (dist < ring - 0.5) c.position.addScaledVector(_d, -speed * 0.7 * dt);
        else {
          _p.set(-_d.z, 0, _d.x).multiplyScalar(e.strafeDir);
          c.position.addScaledVector(_p, speed * 0.85 * dt);
          if (Math.random() < 0.012) e.strafeDir *= -1;
        }
        if (dist <= strike + 0.5 && ready) this._beginWindup(e, target);
        break;
      }
      case "lunge": {
        c.heading = face;
        const range = c.radius + target.creature.radius + 3.4;
        if (dist > range) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "slam": {
        c.heading = face;
        if (dist > strike - 0.4) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "boss": {
        // pattern rotation: slam when the player is in reach; at range, swap
        // between a room-crossing charge and a radial orb burst so kiting and
        // hugging the boss demand different dodges
        c.heading = face;
        if (ready) {
          if (dist <= strike + 0.5) e.bossAttack = "slam";
          else {
            // each boss cycles its own ranged rotation (see BOSSES)
            const rot = e.def.rotation ?? ["charge", "burst"];
            e.rotIdx = ((e.rotIdx ?? -1) + 1) % rot.length;
            e.bossAttack = rot[e.rotIdx];
          }
          this._beginWindup(e, target);
        } else if (dist > strike - 0.6) c.position.addScaledVector(_d, speed * dt);
        break;
      }
      case "charger": {
        // hangs at mid-range, then telegraphs a lane and hurls itself down it
        c.heading = face;
        const range = c.radius + target.creature.radius + 5.5;
        if (dist > range) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "bomber": {
        // a straight rush — it wants to hug you before it blows
        c.heading = face;
        if (dist > strike - 0.3) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "caster":
      case "archer":
      case "geyser":
      case "blinker": {
        c.heading = face;
        const [near, far] = e.def.band;
        if (dist < near) c.position.addScaledVector(_d, -speed * dt);
        else if (dist > far) c.position.addScaledVector(_d, speed * dt);
        else {
          _p.set(-_d.z, 0, _d.x).multiplyScalar(e.strafeDir);
          c.position.addScaledVector(_p, speed * 0.5 * dt);
          if (Math.random() < 0.009) e.strafeDir *= -1;
          if (ready) this._beginWindup(e, target);
        }
        break;
      }
      default: {
        c.heading = face;
        if (dist > strike) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
      }
    }
  },

  _wander(e, speed, dt) {
    const c = e.creature;
    if (e.t > 2.5) {
      e.t = 0;
      e.wanderTarget = e.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
    }
    if (e.wanderTarget) {
      _d.set(e.wanderTarget.x - c.position.x, 0, e.wanderTarget.z - c.position.z);
      if (_d.length() > 0.3) {
        _d.normalize();
        c.heading = Math.atan2(_d.x, _d.z);
        c.position.addScaledVector(_d, speed * 0.35 * dt);
      }
    }
  },

  // push apart from other living enemies so a mob doesn't collapse into one blob
  _separate(e) {
    const c = e.creature;
    for (const o of this.enemies) {
      if (o === e || o.deadT >= 0) continue;
      const oc = o.creature;
      const dx = c.position.x - oc.position.x;
      const dz = c.position.z - oc.position.z;
      const min = c.radius + oc.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        c.position.x += (dx / d) * push;
        c.position.z += (dz / d) * push;
      }
    }
  },

  // Ground sparks that trace where the boss's next attack will land, emitted
  // every few frames through the windup: a red ring on the slam's full reach,
  // an orange lane down the charge path, and a purple ripple swelling out to
  // where the burst orbs will fly. frac is windup progress, 0 → 1.
  _bossTelegraphFx(e, frac, dt) {
    e.telFxT = (e.telFxT ?? 0) - dt;
    if (e.telFxT > 0) return;
    e.telFxT = 0.07;
    const c = e.creature;
    const P = this.game.particles;
    const atk = e.bossAttack ?? "slam";
    if (atk === "charge") {
      for (let i = 1; i <= 9; i++) {
        _v.set(c.position.x + e.chargeX * i * 1.1, 0.08, c.position.z + e.chargeZ * i * 1.1);
        P.burst(_v, { color: 0xffb25a, n: 1, speed: 0.3, up: 0.6, gravity: 0, life: 0.28, size: 0.8 });
      }
    } else if (atk === "burst") {
      P.ring(_v.copy(c.position).setY(0.08), c.radius + 0.4 + frac * 2.6, { color: 0xb06cff, n: 16, life: 0.3, size: 0.85 });
    } else if (atk === "pounce") {
      // the landing ring, tightening as the leap gets close
      if (e.markX != null) P.ring(_v.set(e.markX, 0.08, e.markZ), 2.4 - frac * 0.5, { color: 0xff8a3a, n: 14, life: 0.3, size: 0.9 });
    } else if (atk === "deluge") {
      // every splash zone shimmers through the whole windup
      for (const pt of e.delugePts ?? []) {
        P.ring(_v.set(pt.x, 0.08, pt.z), 1.7, { color: 0x4db9ff, n: 10, life: 0.3, size: 0.8 });
      }
    } else if (atk === "blink") {
      // the arrival ripple — it appears *there*, not where it's standing
      if (e.markX != null) P.ring(_v.set(e.markX, 0.08, e.markZ), 1.1 + frac * 0.4, { color: 0x7fe8d8, n: 12, life: 0.3, size: 0.8 });
    } else {
      P.ring(_v.copy(c.position).setY(0.08), e.ringRadius + 0.25, { color: 0xff5a3a, n: 18, life: 0.3, size: 0.9 });
    }
  },

  // Ground FX for the themed minions' signature attacks (host-side, same
  // throttle as the boss version): a lane for the charger, a splash ring on
  // the geyser's mark, a swelling blast ring on the bomber, and the blinker's
  // arrival ripple. Plain melee/ranged kinds still telegraph with glow alone.
  _minionTelegraphFx(e, frac, dt) {
    const b = e.behavior;
    if (b !== "charger" && b !== "geyser" && b !== "bomber" && b !== "blinker") return;
    e.telFxT = (e.telFxT ?? 0) - dt;
    if (e.telFxT > 0) return;
    e.telFxT = 0.08;
    const c = e.creature;
    const P = this.game.particles;
    if (b === "charger") {
      for (let i = 1; i <= 6; i++) {
        _v.set(c.position.x + e.chargeX * i * 1.0, 0.08, c.position.z + e.chargeZ * i * 1.0);
        P.burst(_v, { color: 0xf5e6b8, n: 1, speed: 0.3, up: 0.5, gravity: 0, life: 0.25, size: 0.7 });
      }
    } else if (b === "geyser" && e.markX != null) {
      P.ring(_v.set(e.markX, 0.08, e.markZ), e.def.reach ?? 1.7, { color: 0x4db9ff, n: 10, life: 0.28, size: 0.8 });
    } else if (b === "bomber") {
      P.ring(_v.copy(c.position).setY(0.08), (e.ringRadius + 0.2) * (0.4 + frac * 0.6), { color: 0xd06cff, n: 12, life: 0.26, size: 0.8 });
    } else if (b === "blinker" && e.markX != null) {
      P.ring(_v.set(e.markX, 0.08, e.markZ), 0.9 + frac * 0.4, { color: 0xd48cff, n: 10, life: 0.26, size: 0.7 });
    }
  },

  // begin a telegraphed attack: crouch, glow, warn the ear
  _beginWindup(e, target) {
    const c = e.creature;
    const def = e.def;
    e.atkState = "windup";
    e.atkT = 0;
    e.windupDur = def.windup;
    e.recoverDur = 0.32 + def.windup * 0.35;
    e.attackCd = 1.3 + Math.random() * 0.7;
    c.animator.squash.kick(-2.5); // anticipation dip
    c.setGlow(def.glow ?? [0.6, 0.2, 0.1]);
    // ranged foes telegraph with the body glow only; melee reaches farther
    const ranged = ["caster", "archer", "geyser", "blinker"].includes(e.behavior);
    // lock a charge direction for melee foes (lunge/charger dash on strike)
    e.isCharge = !ranged && e.behavior !== "lunge" && e.behavior !== "charger";
    if ((e.isCharge || e.behavior === "charger") && target) {
      _p.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z).normalize();
      e.chargeX = _p.x;
      e.chargeZ = _p.z;
    }
    e.ringRadius = ranged ? 0 : e.behavior === "slam" || e.behavior === "bomber"
      ? def.reach + c.radius
      : (def.reach ?? 1) + c.radius + (target ? target.creature.radius : 0.34);
    // signature minion attacks lock their ground mark at windup start, boss-style:
    // the telegraph shows exactly where the blow lands, and moving off it dodges
    e.markX = e.markZ = null;
    if (e.behavior === "geyser" && target) {
      e.markX = target.creature.position.x;
      e.markZ = target.creature.position.z;
    } else if (e.behavior === "blinker" && target) {
      const t = target.creature.position;
      const a = Math.random() * Math.PI * 2;
      e.markX = t.x + Math.sin(a) * 2.4;
      e.markZ = t.z + Math.cos(a) * 2.4;
    }
    // the boss telegraphs each pattern differently: its own windup length and
    // a distinct glow colour per attack, all faster once enraged
    if (e.behavior === "boss") {
      const atk = e.bossAttack ?? "slam";
      // longer windups + a fat gap between attacks so each pattern reads as
      // its own beat: telegraph, dodge, punish, breathe
      // per-attack windups scale off the boss's base windup (stock boss: the
      // original 1.1 / 0.85 / 1.03 beats), so a quick boss telegraphs quicker
      e.windupDur = (def.windup + (BOSS_ATK_WINDUP[atk] ?? 0.25)) * (e.enraged ? 0.8 : 1);
      // deeper keepers breathe less between patterns (paceMul, see bossDefFor)
      e.attackCd = (2.8 + Math.random() * 0.9) * (def.paceMul ?? 1);
      if (e.enraged) e.attackCd *= 0.75;
      e.recoverDur = 0.85;
      e.isCharge = false; // patterns move on strike, not during the windup
      e.ringRadius = atk === "slam" ? def.reach + c.radius : 0;
      c.setGlow(BOSS_ATK_GLOW[atk] ?? def.glow);
      // signature patterns lock their ground marks at windup start, so the
      // telegraph shows exactly where the blow will land — moving off the
      // mark is the dodge (clear stale marks so the net message can't leak
      // a previous attack's point)
      e.markX = e.markZ = null;
      e.delugePts = null;
      if (atk === "pounce" && target) {
        // leap onto where the target stands right now (capped range)
        const t = target.creature.position;
        const dx = t.x - c.position.x, dz = t.z - c.position.z;
        const d = Math.hypot(dx, dz) || 1;
        const reach = Math.min(d, 8);
        e.markX = c.position.x + (dx / d) * reach;
        e.markZ = c.position.z + (dz / d) * reach;
      } else if (atk === "deluge") {
        // one geyser under the target, the rest scattered around the arena
        const pts = [];
        if (target) pts.push({ x: target.creature.position.x, z: target.creature.position.z });
        while (pts.length < 5) {
          const a = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 3.5;
          pts.push({ x: c.position.x + Math.sin(a) * r, z: c.position.z + Math.cos(a) * r });
        }
        e.delugePts = pts;
      } else if (atk === "blink" && target) {
        // reappear at the target's side — the ripple marks the arrival spot
        const t = target.creature.position;
        const a = Math.random() * Math.PI * 2;
        e.markX = t.x + Math.sin(a) * 2.2;
        e.markZ = t.z + Math.cos(a) * 2.2;
      }
      // guests mirror the telegraph (HUD countdown + ground FX) from this
      this.game.net.send({
        t: "bossTel", id: e.id, atk, dur: e.windupDur, r: e.ringRadius,
        dx: e.chargeX ?? 0, dz: e.chargeZ ?? 0,
        px: e.markX ?? 0, pz: e.markZ ?? 0, pts: e.delugePts ?? null,
      });
    }
    this.game.audio.telegraph();
  },

  // resolve a telegraphed attack the moment it lands — only hits players still
  // in range, so dodging or backing out beats it cleanly.
  _enemyStrike(e, target, players) {
    const c = e.creature;
    const def = e.def;
    const game = this.game;
    c.attack();
    c.animator.squash.kick(4);

    switch (e.behavior) {
      case "caster":
      case "archer": {
        if (!target) break;
        _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z);
        _d.y = 0;
        _d.normalize();
        const sp = def.projSpeed;
        const y = Math.max(0.5, c.height * 0.6);
        const ox = c.position.x + _d.x * (c.radius + 0.2);
        const oz = c.position.z + _d.z * (c.radius + 0.2);
        this.spawnProjectile(ox, oz, _d.x * sp, _d.z * sp, { color: def.projColor, dmg: def.dmg, radius: 0.28, life: 3.0, y });
        // deeper casters throw a 3-orb fan
        if (e.behavior === "caster" && e.tier >= 2) {
          for (const off of [-0.32, 0.32]) {
            const dx = _d.x * Math.cos(off) - _d.z * Math.sin(off);
            const dz = _d.x * Math.sin(off) + _d.z * Math.cos(off);
            this.spawnProjectile(c.position.x + dx * (c.radius + 0.2), c.position.z + dz * (c.radius + 0.2), dx * sp, dz * sp, { color: def.projColor, dmg: def.dmg, radius: 0.24, life: 3.0, y });
          }
        }
        game.audio.shoot();
        break;
      }
      case "lunge": {
        if (target) {
          _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z);
          _d.y = 0;
          const dist = _d.length();
          _d.normalize();
          // leap just past where the target stands so the pounce actually reaches
          // them; damage is dealt on contact during the dash (see _updateEnemy),
          // not instantly from a gap — dodging sideways makes it whiff.
          const leap = (dist + 0.3) * LEAP_K;
          e.vx = _d.x * leap;
          e.vz = _d.z * leap;
          c.animator.squash.kick(6);
          e.lungeHitT = 0.5; // window the dash can connect its blow
        }
        game.audio.hit();
        break;
      }
      case "slam": {
        const r = e.ringRadius + 0.25;
        for (const p of players) {
          if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
        }
        game.engine.shake(0.18);
        game.audio.kill();
        game.particles.burst(_v.copy(c.position).setY(0.1), { color: 0xff8a5a, n: 16, speed: 4.2, up: 1.6, life: 0.5, size: 1.1 });
        break;
      }
      case "charger": {
        // hurl itself down the lane locked at windup start; damage lands on
        // contact during the dash, so stepping out of the lane dodges it clean
        if (target) {
          const dist = c.position.distanceTo(target.creature.position);
          const leap = (dist + 1.2) * LEAP_K;
          e.vx = e.chargeX * leap;
          e.vz = e.chargeZ * leap;
          c.animator.squash.kick(5);
          e.lungeHitT = 0.5;
        }
        game.audio.hit();
        game.engine.shake(0.1);
        break;
      }
      case "geyser": {
        // the marked splash zone erupts — only hits players still on the mark
        if (e.markX != null) {
          const r = def.reach ?? 1.7;
          for (const p of players) {
            if (Math.hypot(p.creature.position.x - e.markX, p.creature.position.z - e.markZ) <= r + p.creature.radius)
              game.enemyHitsPlayer(e, p);
          }
          game.particles.burst(_v.set(e.markX, 0.1, e.markZ), { color: 0x5dd0ff, n: 16, speed: 3.6, up: 3.6, life: 0.7, size: 1.1 });
          game.audio.kill();
        }
        break;
      }
      case "blinker": {
        // vanish, reappear on the marked ripple and fire the instant it lands
        if (e.markX != null) {
          game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0xd48cff, n: 10, speed: 3, life: 0.4, size: 0.8 });
          c.position.set(e.markX, 0, e.markZ);
          c.animator.prevPos.copy(c.position);
          game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0xd48cff, n: 10, speed: 3, life: 0.4, size: 0.8 });
          if (target) {
            _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z).normalize();
            c.heading = Math.atan2(_d.x, _d.z);
            const sp = def.projSpeed;
            const y = Math.max(0.5, c.height * 0.6);
            this.spawnProjectile(c.position.x + _d.x * (c.radius + 0.2), c.position.z + _d.z * (c.radius + 0.2), _d.x * sp, _d.z * sp, { color: def.projColor, dmg: def.dmg, radius: 0.26, life: 2.4, y });
          }
        }
        game.audio.shoot();
        break;
      }
      case "bomber": {
        // blows itself apart — everything inside the swollen ring gets hit,
        // and the sporeling dies in the blast (its own loot still drops)
        const r = e.ringRadius + 0.25;
        for (const p of players) {
          if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
        }
        game.particles.burst(_v.copy(c.position).setY(0.15), { color: 0xd06cff, n: 22, speed: 5, up: 2.4, life: 0.6, size: 1.2 });
        game.particles.burst(_v.copy(c.position).setY(0.15), { color: 0x9fe07a, n: 12, speed: 3.4, up: 3, life: 0.7, size: 0.9 });
        game.engine.shake(0.16);
        game.audio.kill();
        this.killEnemy(e, 0, 0);
        break;
      }
      case "boss": {
        const atk = e.bossAttack ?? "slam";
        if (atk === "burst") {
          // radial ring of slow orbs — weave between them or roll through
          const n = (e.def.burstN ?? 8) + (e.enraged ? 4 : 0);
          const y = Math.max(0.5, c.height * 0.45);
          const sp = def.projSpeed;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + c.heading;
            const dx = Math.sin(a), dz = Math.cos(a);
            this.spawnProjectile(c.position.x + dx * (c.radius + 0.3), c.position.z + dz * (c.radius + 0.3), dx * sp, dz * sp, { color: def.projColor, dmg: 1, radius: 0.3, life: 2.6, y });
          }
          game.audio.shoot();
          game.engine.shake(0.12);
        } else if (atk === "charge") {
          // hurl itself down the lane locked (and telegraphed) at windup start;
          // damage lands on contact during the dash (lungeHitT), so stepping
          // out of the marked lane makes it barrel past
          if (target) {
            const dist = c.position.distanceTo(target.creature.position);
            const leap = (dist + 1.6) * LEAP_K;
            e.vx = e.chargeX * leap;
            e.vz = e.chargeZ * leap;
            c.animator.squash.kick(6);
            e.lungeHitT = 0.6;
          }
          game.audio.hit();
          game.engine.shake(0.15);
        } else if (atk === "pounce") {
          // leap exactly onto the marked ring; damage on contact during the
          // flight, so stepping off the mark makes her sail past
          if (e.markX != null) {
            const dx = e.markX - c.position.x, dz = e.markZ - c.position.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.01) {
              const leap = d * LEAP_K;
              e.vx = (dx / d) * leap;
              e.vz = (dz / d) * leap;
            }
            c.animator.squash.kick(7);
            e.lungeHitT = 0.55;
          }
          game.audio.hit();
          game.engine.shake(0.18);
        } else if (atk === "deluge") {
          // every marked splash zone erupts at once — one hit per player max
          const soaked = new Set();
          for (const pt of e.delugePts ?? []) {
            for (const p of players) {
              if (soaked.has(p)) continue;
              if (Math.hypot(p.creature.position.x - pt.x, p.creature.position.z - pt.z) <= 1.7 + p.creature.radius) {
                soaked.add(p);
                game.enemyHitsPlayer(e, p);
              }
            }
            game.particles.burst(_v.set(pt.x, 0.1, pt.z), { color: 0x5dd0ff, n: 14, speed: 3.4, up: 3.4, life: 0.7, size: 1.1 });
          }
          e.delugePts = null;
          game.audio.kill();
          game.engine.shake(0.2);
        } else if (atk === "blink") {
          // vanish and reappear on the marked ripple, spitting a tight ring of
          // quick orbs on arrival — roll through the gaps
          if (e.markX != null) {
            game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0x7fe8d8, n: 12, speed: 3, life: 0.4, size: 0.9 });
            c.position.set(e.markX, 0, e.markZ);
            c.animator.prevPos.copy(c.position);
            game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0x7fe8d8, n: 12, speed: 3, life: 0.4, size: 0.9 });
            const y = Math.max(0.5, c.height * 0.45);
            const sp = def.projSpeed;
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + c.heading;
              const dx = Math.sin(a), dz = Math.cos(a);
              this.spawnProjectile(c.position.x + dx * (c.radius + 0.25), c.position.z + dz * (c.radius + 0.25), dx * sp, dz * sp, { color: def.projColor, dmg: 1, radius: 0.26, life: 1.8, y });
            }
          }
          game.audio.shoot();
          game.engine.shake(0.1);
        } else {
          // the wide arena-shaking slam (same shape as the brute's, but bigger)
          const r = e.ringRadius + 0.25;
          for (const p of players) {
            if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
          }
          game.engine.shake(0.24);
          game.audio.kill();
          game.particles.burst(_v.copy(c.position).setY(0.1), { color: 0xff5a3a, n: 22, speed: 5, up: 1.8, life: 0.55, size: 1.25 });
        }
        break;
      }
      default: { // swarm, strafe: a quick directional swipe
        this._meleeStrikeHit(e, players, (def.reach ?? 1) + 0.35);
        game.audio.swing();
      }
    }
  },

  // hit the first player inside the swing's reach + rough frontal arc
  _meleeStrikeHit(e, players, extra) {
    const c = e.creature;
    for (const p of players) {
      const pc = p.creature;
      const dx = pc.position.x - c.position.x;
      const dz = pc.position.z - c.position.z;
      const d = Math.hypot(dx, dz);
      const range = c.radius + pc.radius + extra;
      if (d > range) continue;
      const dot = (dx * Math.sin(c.heading) + dz * Math.cos(c.heading)) / (d || 1);
      if (dot > -0.15) {
        this.game.enemyHitsPlayer(e, p);
        return true;
      }
    }
    return false;
  },
};
