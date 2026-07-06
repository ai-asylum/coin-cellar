// A living blob: baked seamless SkinnedMesh + procedural skeleton + toon
// materials + outline shell + blob shadow + bead eyes + an Animator brain.
// Game code moves the Group (position / heading) and calls update(dt);
// everything else — gait, jiggle, blinking, ragdolling — is automatic.
import * as THREE from "three";
import { bakeBody, buildSkeleton } from "./bake.js";
import { Animator } from "./animator.js";
import { makeToonMaterial, addOutline, makeBlobShadow } from "../core/toon.js";

const _eyeGeo = new THREE.SphereGeometry(1, 10, 8);
const _eyeMat = new THREE.MeshBasicMaterial({ color: 0x141021 });
const _eyeShineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

export class Creature extends THREE.Group {
  constructor(spec) {
    super();
    this.spec = spec;
    this.heading = 0;

    const baked = bakeBody(spec);
    this.bones = buildSkeleton(baked.boneDefs, baked.scale, baked.groundY);
    for (const b of this.bones) b.userData.restY = b.position.y;

    this.bodyMat = makeToonMaterial({ vertexColors: true, rim: 0.45 });
    const mesh = new THREE.SkinnedMesh(baked.geometry, this.bodyMat);
    mesh.add(this.bones[0]);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.frustumCulled = false; // skinned bounds don't track the ragdoll
    this.mesh = mesh;
    this.add(mesh);
    this.outline = addOutline(mesh, 0.02 * baked.scale + 0.008);

    // eyes: two beads + tiny shines, parented to the head bone
    if (spec.face) {
      const headBone = this.bones[spec.face.head];
      const fg = new THREE.Group();
      this.faceGroup = fg;
      const e = spec.face.eyes;
      for (const key of ["l", "r"]) {
        const eye = new THREE.Mesh(_eyeGeo, _eyeMat);
        eye.scale.setScalar(e.r0);
        // bone-local position: subtract the bone's rest world offset
        eye.position.fromArray(e[key]);
        fg.add(eye);
        const shine = new THREE.Mesh(_eyeGeo, _eyeShineMat);
        shine.scale.setScalar(0.35);
        shine.position.set(0.35, 0.35, 0.75);
        eye.add(shine);
      }
      // convert face group into head-bone space
      headBone.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4()
        .copy(headBone.matrixWorld)
        .invert()
        .multiply(this.matrixWorld);
      fg.applyMatrix4(inv);
      headBone.add(fg);
    }

    this.shadow = makeBlobShadow(spec.anim.radius * 1.15);
    this.shadow.position.y = 0.015;
    this.add(this.shadow);

    this.animator = new Animator(this, spec);
    this.radius = spec.anim.radius;
    this.height = spec.anim.height;
    this._flashT = 0;
    this._glow = null; // [r,g,b] steady emissive tint (attack telegraph)
    this._attackDur = 0.45;
  }

  /** Steady emissive tint for attack telegraphs. Pass null to clear. */
  setGlow(rgb) {
    this._glow = rgb;
  }

  /** Attach a prop (e.g. a sword) to the hand bone tip. */
  holdItem(obj) {
    const a = this.spec.anim;
    if (a.handBone === undefined) return;
    const bone = this.bones[a.handBone];
    const socket = bone.getWorldPosition(new THREE.Vector3());
    this.updateMatrixWorld(true);
    const tip = new THREE.Vector3().fromArray(a.handTip);
    this.localToWorld(tip);
    obj.position.copy(bone.worldToLocal(tip));
    bone.add(obj);
    this.heldItem = obj;
  }

  attack() {
    if (this.animator.attackT >= 0 || this.animator.dead) return false;
    this.animator.attackT = 0;
    return true;
  }

  hurt(fromDir) {
    this.animator.squash.kick(5);
    this._flashT = 0.12;
    this.bodyMat.emissive.setRGB(1, 1, 1);
  }

  die(impulse) {
    this.animator.die(impulse);
    if (this.shadow) this.shadow.visible = false;
  }

  get dead() {
    return this.animator.dead;
  }

  update(dt, elapsed) {
    if (this.animator.attackT >= 0) {
      this.animator.attackT += dt / this._attackDur;
      if (this.animator.attackT >= 1) this.animator.attackT = -1;
    }
    if (this._flashT > 0) {
      this._flashT -= dt;
      const k = Math.max(this._flashT / 0.12, 0);
      this.bodyMat.emissive.setRGB(k, k * 0.9, k * 0.8);
    } else if (this._glow) {
      this.bodyMat.emissive.setRGB(this._glow[0], this._glow[1], this._glow[2]);
    } else {
      this.bodyMat.emissive.setRGB(0, 0, 0);
    }
    this.animator.update(dt, elapsed);
    // keep the blob shadow glued to the floor even when we hop/float/die
    if (this.shadow) {
      this.shadow.position.y = 0.015 - this.position.y;
    }
  }

  dispose() {
    this.mesh.skeleton.dispose();
    this.bodyMat.dispose();
    this.outline.material.dispose();
    this.removeFromParent();
  }
}
