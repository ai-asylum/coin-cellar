// Procedural animation "brains". No keyframes anywhere in this game:
//  - walker: works for 2, 4 or 6 legs — feet plant in the world and take
//    phase-grouped steps; limb bones aim socket->foot and stretch a little
//    (the blob skinning turns that stretching into noodly squash).
//  - hopper: grounded, no legs -> squash / launch / stretch / land.
//  - floater: hovers, bobs, banks into velocity, tail bones dangle on springs.
// Death switches every brain to a verlet ragdoll over the same bones.
import * as THREE from "three";
import { Spring, clamp, lerp } from "../core/engine.js";

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class Animator {
  constructor(creature, spec) {
    this.c = creature;
    this.spec = spec;
    this.anim = spec.anim;
    this.mode = spec.anim.mode;
    this.phase = Math.random() * 10;
    this.t = Math.random() * 10;
    this.speed = 0;
    this.speedN = 0; // 0..1 normalized
    this.prevPos = creature.position.clone();
    this.vel = new THREE.Vector3();
    this.squash = new Spring(0, 14, 0.5);
    this.headYaw = new Spring(0, 9, 0.6);
    this.headPitch = new Spring(0, 9, 0.6);
    this.prevHeading = 0;
    this.attackT = -1;
    this.hurtT = -1;
    this.carry = false; // shopkeeping pose: arms up
    this.dead = false;
    this.ragdoll = null;
    this.onFootstep = null;

    const bones = creature.bones;
    // per-leg runtime state
    this.legs = this.anim.legs.map((leg) => {
      const socket = new THREE.Vector3().fromArray(leg.socket);
      const foot = new THREE.Vector3().fromArray(leg.foot);
      const restDir = foot.clone().sub(socket).normalize();
      return {
        def: leg,
        bone: bones[leg.bone],
        restDir,
        restLen: foot.distanceTo(socket),
        footLocal: foot,
        pos: creature.localToWorld(foot.clone()),
        swing: null,
      };
    });
    this.arms = this.anim.arms.map((arm) => {
      const socket = new THREE.Vector3().fromArray(arm.socket);
      const hand = new THREE.Vector3().fromArray(arm.hand);
      return {
        def: arm,
        bone: bones[arm.bone],
        restDir: hand.clone().sub(socket).normalize(),
        swing: new Spring(0, 11, 0.55),
      };
    });
    this.tails = (this.anim.tail || []).map((idx) => ({
      bone: bones[idx],
      sx: new Spring(0, 6, 0.4),
      sz: new Spring(0, 6, 0.4),
    }));
    this.hopT = 1; // hopper cycle
    this.gaitBlock = -1; // which group is mid-swing

    // Per-bone ragdoll floor height, from the SDF flesh hanging off each
    // bone. Bones don't necessarily sit inside their flesh (some rigs park
    // them well above it), so measure against the bind pose: a node may sink
    // no lower than "rest bone height minus how far its flesh bottom sits
    // above the ground at rest" — that rests the flesh on the floor.
    creature.updateMatrixWorld(true);
    const groundY = spec.groundY ?? 0;
    const toW = (y) => (y - groundY) * spec.scale; // char space -> world
    this.boneFloor = bones.map((b, i) => {
      const restW = b.getWorldPosition(new THREE.Vector3()).y;
      let floor = 0.05 * spec.scale;
      for (const part of spec.parts ?? []) {
        if (part.bone !== i) continue;
        const bottoms = part.kind === "ellipsoid"
          ? [toW(part.a[1]) - part.ry * spec.scale]
          : part.kind === "capsule"
            ? [toW(part.a[1]) - part.r * spec.scale,
               toW(part.b[1]) - (part.r2 ?? part.r) * spec.scale]
            : [toW(part.a[1]) - part.r * spec.scale];
        for (const bot of bottoms) floor = Math.max(floor, restW - bot);
      }
      return floor;
    });
  }

  update(dt, elapsed) {
    if (dt <= 0) return;
    const c = this.c;
    this.t += dt;

    // --- locomotion state from how the game moved us
    _v.copy(c.position).sub(this.prevPos);
    this.prevPos.copy(c.position);
    const instV = _v.divideScalar(dt);
    this.vel.lerp(instV, 1 - Math.pow(0.0001, dt));
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.speedN = clamp(this.speed / (3.2 * this.spec.scale), 0, 1);

    // smooth heading
    let dh = c.heading - c.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const turn = dh * (1 - Math.pow(0.0001, dt));
    c.rotation.y += turn;
    this.headYaw.kick(-turn * 6);

    if (this.dead) {
      this._ragdollStep(dt);
      return;
    }

    this.phase += (this.speed / Math.max(this.anim.stride ?? 0.4, 0.15)) * dt * Math.PI;
    this.squash.update(dt);
    this.headYaw.update(dt);
    this.headPitch.update(dt);

    c.updateMatrixWorld(true);
    if (this.mode === "walker") this._walker(dt);
    else if (this.mode === "hopper") this._hopper(dt);
    else this._floater(dt);

    this._face(dt);
  }

  // ------------------------------------------------------------- walker
  _walker(dt) {
    const bones = this.c.bones;
    const a = this.anim;
    const hips = bones[a.hips];
    const sN = this.speedN;

    // body: bob with the gait, breathe when idle, squash spring on top
    const bob = Math.abs(Math.sin(this.phase)) * 0.06 * this.spec.scale * sN;
    const breathe = Math.sin(this.t * 2.4) * 0.008 * this.spec.scale;
    hips.position.y = hips.userData.restY + bob + breathe;
    const sq = this.squash.x;
    hips.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
    // lean into motion + gait wiggle
    _v2.copy(this.vel);
    _v2.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.c.rotation.y);
    hips.rotation.x = clamp(_v2.z * 0.055, -0.22, 0.22);
    hips.rotation.z = clamp(-_v2.x * 0.045, -0.18, 0.18) + Math.sin(this.phase) * 0.06 * sN;
    hips.rotation.y = Math.sin(this.phase) * 0.1 * sN;

    if (a.chest !== a.hips) {
      const chest = bones[a.chest];
      chest.rotation.x = hips.rotation.x * 0.6;
      chest.rotation.y = Math.sin(this.phase) * 0.14 * sN;
    }

    // head lags turns, bobs slightly
    if (a.head !== a.hips) {
      const head = bones[a.head];
      head.rotation.y = clamp(this.headYaw.x, -0.7, 0.7);
      head.rotation.x = this.headPitch.x - hips.rotation.x * 0.7 + Math.sin(this.t * 2.4 + 1) * 0.02;
    }

    this.c.updateMatrixWorld(true);

    // --- feet
    const stepThresh = (a.stride ?? 0.4) * (0.55 - 0.15 * sN);
    const dur = clamp(0.24 - this.speed * 0.02, 0.12, 0.24);
    let anySwing = -1;
    for (const leg of this.legs) if (leg.swing) anySwing = leg.def.group;

    for (const leg of this.legs) {
      leg.bone.getWorldPosition(_v); // socket (post-bob)
      const socketW = _v;
      // rest target in world
      _v2.copy(leg.footLocal);
      this.c.localToWorld(_v2);
      _v2.y = 0;
      _v2.addScaledVector(this.vel, 0.1);

      if (leg.swing) {
        const s = leg.swing;
        s.t += dt / s.dur;
        if (s.t >= 1) {
          leg.pos.copy(s.to);
          leg.swing = null;
          if (this.onFootstep && this.speed > 0.5) this.onFootstep(leg.pos, this.speedN);
        } else {
          const e = s.t * s.t * (3 - 2 * s.t);
          leg.pos.lerpVectors(s.from, s.to, e);
          leg.pos.y = Math.sin(s.t * Math.PI) * s.h;
        }
      } else {
        let err = Math.hypot(leg.pos.x - _v2.x, leg.pos.z - _v2.z);
        if (err > (a.stride ?? 0.4) * 4) {
          // teleported (or way out of range): snap instead of stepping
          leg.pos.copy(_v2);
          leg.pos.y = 0;
          err = 0;
        }
        const otherSwinging = anySwing !== -1 && anySwing !== leg.def.group;
        const idleSettle = this.speed < 0.2 && err > 0.09 * this.spec.scale;
        if ((err > stepThresh || idleSettle) && !otherSwinging) {
          leg.swing = {
            from: leg.pos.clone(),
            to: _v2.clone().addScaledVector(this.vel, dur * 1.1),
            t: 0,
            dur: idleSettle ? 0.22 : dur,
            h: (0.08 + 0.1 * sN) * this.spec.scale,
          };
          leg.swing.to.y = 0;
          anySwing = leg.def.group;
        }
      }

      // aim the leg bone socket->foot, with a squishy stretch
      this._aimLimb(leg.bone, socketW, leg.pos, leg.restDir, leg.restLen);
    }

    // --- arms
    for (const arm of this.arms) {
      const bone = arm.bone;
      const side = arm.def.side ?? 1;
      let ang;
      if (this.attackT >= 0 && side === 1) {
        // attack: windup, slash, recover (drives the right arm directly)
        const t = this.attackT;
        if (t < 0.3) ang = lerp(0, -2.1, t / 0.3); // raise back
        else if (t < 0.5) ang = lerp(-2.1, 1.5, (t - 0.3) / 0.2); // slash!
        else ang = lerp(1.5, 0, (t - 0.5) / 0.5);
        bone.rotation.set(ang, 0, 0.35);
        continue;
      }
      if (this.carry) {
        bone.rotation.set(-1.5, side * 0.3, side * 0.25);
        continue;
      }
      arm.swing.target = Math.sin(this.phase + (side > 0 ? Math.PI : 0)) * 0.55 * this.speedN;
      ang = arm.swing.update(dt) + Math.sin(this.t * 2.4) * 0.03;
      bone.rotation.set(ang, 0, side * (0.12 + 0.1 * this.speedN));
    }
  }

  _aimLimb(bone, socketW, targetW, restDir, restLen) {
    _v3.copy(targetW).sub(socketW);
    const dist = _v3.length();
    _v3.normalize();
    // into parent space
    bone.parent.getWorldQuaternion(_q2);
    _q2.invert();
    _v3.applyQuaternion(_q2);
    bone.quaternion.setFromUnitVectors(restDir, _v3);
    const s = clamp(dist / (restLen * this.c.scale.y || 1e-3), 0.7, 1.35);
    // stretch mostly along the limb's rest axis
    bone.scale.set(
      1 + (s - 1) * restDir.x * restDir.x,
      1 + (s - 1) * restDir.y * restDir.y,
      1 + (s - 1) * restDir.z * restDir.z
    );
  }

  // ------------------------------------------------------------- hopper
  _hopper(dt) {
    const bones = this.c.bones;
    const hips = bones[this.anim.hips];
    const moving = this.speed > 0.25;
    const hopDur = 0.55;
    if (moving || this.hopT < 1) {
      const wasAir = this.hopT > 0.15 && this.hopT < 0.85;
      this.hopT += dt / hopDur;
      if (this.hopT >= 1) {
        if (moving) this.hopT = 0;
        else this.hopT = 1;
        if (wasAir) {
          this.squash.kick(4.5);
          if (this.onFootstep) this.onFootstep(this.c.position, 1);
        }
      }
    }
    const t = Math.min(this.hopT, 1);
    const air = 4 * t * (1 - t); // parabola 0..1..0
    const h = 0.5 * this.spec.scale;
    const sq = this.squash.update(dt);
    const stretch = air * 0.35 - sq;
    hips.position.y = hips.userData.restY + air * h + Math.sin(this.t * 3) * 0.01;
    hips.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
    // tilt into motion
    _v2.copy(this.vel).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.c.rotation.y);
    hips.rotation.x = clamp(_v2.z * 0.1 * air, -0.5, 0.5);

    // secondary jelly: crown bone lags vertically
    if (this.anim.chest !== this.anim.hips) {
      const crown = bones[this.anim.chest];
      crown.userData.lag = lerp(crown.userData.lag ?? 0, air * h, 1 - Math.pow(0.00005, dt));
      crown.position.y = crown.userData.restY - (air * h - crown.userData.lag) * 0.8;
      crown.rotation.x = -hips.rotation.x * 0.7;
    }
  }

  // ------------------------------------------------------------- floater
  _floater(dt) {
    const bones = this.c.bones;
    const hips = bones[this.anim.hips];
    const hover = this.anim.hover ?? 0.8;
    hips.position.y =
      hips.userData.restY + hover + Math.sin(this.t * 2.1 + this.phase) * 0.12 * this.spec.scale;
    const sq = this.squash.update(dt);
    hips.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    _v2.copy(this.vel).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.c.rotation.y);
    hips.rotation.x = clamp(_v2.z * 0.16, -0.5, 0.5);
    hips.rotation.z = clamp(-_v2.x * 0.16, -0.5, 0.5) + Math.sin(this.t * 1.3) * 0.06;

    for (let i = 0; i < this.tails.length; i++) {
      const tl = this.tails[i];
      tl.sx.target = clamp(-_v2.z * 0.5, -0.9, 0.9);
      tl.sz.target = clamp(_v2.x * 0.5, -0.9, 0.9);
      tl.bone.rotation.x = tl.sx.update(dt) + Math.sin(this.t * 2.6 + i) * 0.14;
      tl.bone.rotation.z = tl.sz.update(dt) + Math.cos(this.t * 2.2 + i) * 0.14;
    }
  }

  // ------------------------------------------------------------- face
  _face(dt) {
    const f = this.c.faceGroup;
    if (!f) return;
    f.userData.blinkT = (f.userData.blinkT ?? 1 + Math.random() * 3) - dt;
    if (f.userData.blinkT <= 0) {
      f.userData.blinkT = 1.6 + Math.random() * 3.4;
      f.userData.blink = 0.14;
    }
    if (f.userData.blink > 0) {
      f.userData.blink -= dt;
      const s = f.userData.blink > 0.07 ? 0.1 : 1;
      for (const eye of f.children) eye.scale.y = eye.scale.x * s;
    }
  }

  // ------------------------------------------------------------- ragdoll
  die(impulse) {
    if (this.dead) return;
    this.dead = true;
    const bones = this.c.bones;
    this.c.updateMatrixWorld(true);
    const nodes = bones.map((b, i) => {
      const p = b.getWorldPosition(new THREE.Vector3());
      const pp = p.clone();
      if (impulse) pp.sub(_v.copy(impulse).multiplyScalar(0.03 * (0.5 + Math.random())));
      pp.y += 0.01 + Math.random() * 0.02;
      return { p, pp, floor: this.boneFloor[i] };
    });
    const cons = [];
    bones.forEach((b, i) => {
      const pi = bones.indexOf(b.parent);
      if (pi >= 0) {
        cons.push({ a: pi, b: i, d: nodes[pi].p.distanceTo(nodes[i].p) || 0.01 });
      }
    });
    this.ragdoll = { nodes, cons, restDirs: null, t: 0 };
    // cache parent->child rest directions (world, at death) for re-orienting
    this.ragdoll.restDirs = cons.map((c2) => {
      const q = new THREE.Quaternion();
      bones[c2.b].parent.getWorldQuaternion(q);
      return { con: c2 };
    });
  }

  _ragdollStep(dt) {
    const rd = this.ragdoll;
    if (!rd) return;
    rd.t += dt;
    const { nodes, cons } = rd;
    const bones = this.c.bones;
    // verlet
    for (const n of nodes) {
      _v.copy(n.p).sub(n.pp).multiplyScalar(0.985);
      n.pp.copy(n.p);
      n.p.add(_v);
      n.p.y -= 14 * dt * dt * 20; // gravity (verlet uses dt^2; scaled for feel)
      if (n.p.y < n.floor) {
        n.p.y = n.floor;
        // ground friction
        n.p.x = lerp(n.p.x, n.pp.x, 0.4);
        n.p.z = lerp(n.p.z, n.pp.z, 0.4);
      }
    }
    for (let it = 0; it < 3; it++) {
      for (const c2 of cons) {
        const a = nodes[c2.a], b = nodes[c2.b];
        _v.copy(b.p).sub(a.p);
        const d = _v.length() || 1e-6;
        const diff = (d - c2.d) / d;
        _v.multiplyScalar(0.5 * diff);
        a.p.add(_v);
        b.p.sub(_v);
      }
    }
    // write back: positions in parent space; keep rotations (skin stays chunky)
    this.c.updateMatrixWorld(true);
    bones.forEach((b, i) => {
      if (!b.parent || !b.parent.isBone) {
        // root bone: move in creature-local space
        _v.copy(nodes[i].p);
        this.c.worldToLocal(_v);
        b.position.copy(_v);
        return;
      }
      const pi = bones.indexOf(b.parent);
      if (pi < 0) return;
      _v.copy(nodes[i].p);
      b.parent.worldToLocal(_v);
      b.position.copy(_v);
      b.updateMatrixWorld(true);
    });
  }
}
