// A Kenney "Blocky Characters" actor that mimics the Creature interface so it
// can drop straight into the game as the player, the co-op partner, and the
// shop customers. Body parts are node-animated (no skin), so we clone the
// cached template and drive a per-instance AnimationMixer with the pack's
// clips (idle / walk / sprint / attack-melee-right / die / …).
import * as THREE from "three";
import { Spring } from "../core/engine.js";
import { makeBlobShadow } from "../core/toon.js";
import { CHARACTERS, CHAR_VARIANTS } from "./assets.js";

// The rig faces +Z (anatomical left arm sits on +X ⇒ forward = +Z), which
// already matches the game's forward at heading 0, so no yaw offset is needed.
// Set to Math.PI if a future pack is authored facing the other way.
const MODEL_YAW = 0;

const _v = new THREE.Vector3();
const _box = new THREE.Box3();

// DEBUG: set to a number to hard-pin every seed-derived character to one fixed
// value (all customers / previews render as the same person). null restores
// normal per-seed variety.
export const HARD_SEED = null;

// The hero always renders as variant "a", so NPCs draw from every other model
// in the pack — no shopper should be a doppelgänger of the player.
export const PLAYER_VARIANT = "a";
export const NPC_VARIANTS = CHAR_VARIANTS.filter((v) => v !== PLAYER_VARIANT);

export function variantForSeed(seed) {
  if (HARD_SEED != null) seed = HARD_SEED;
  return NPC_VARIANTS[Math.abs(Math.floor(seed)) % NPC_VARIANTS.length];
}

export class BlockyCreature extends THREE.Group {
  constructor(variant = "a", opts = {}) {
    super();
    this.variant = variant;
    this.heading = 0;
    const targetH = opts.height ?? 1.7;

    const src = CHARACTERS[variant] || CHARACTERS.a;
    const model = src.scene.clone(true);

    // clone materials so per-instance hurt-flash / tint doesn't leak between
    // creatures that share a texture template
    this._mats = [];
    this._baseColors = [];
    model.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.frustumCulled = false;
        this._mats.push(o.material);
        this._baseColors.push(o.material.color.clone());
      }
    });

    // scale to a consistent world height and stand feet on the floor
    model.updateMatrixWorld(true);
    _box.setFromObject(model);
    const rawH = Math.max(0.001, _box.max.y - _box.min.y);
    this._scale = targetH / rawH;
    model.scale.setScalar(this._scale);
    model.position.y = -_box.min.y * this._scale;
    if (opts.tint) for (const c of this._baseColors) c.multiply(new THREE.Color(opts.tint));
    this._applyColors();

    this.add(model);
    this.model = model;
    this.mesh = model; // game toggles .visible for invuln blink
    this.armR = model.getObjectByName("arm-right") || model.getObjectByName("torso");

    // animation
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = {};
    for (const clip of src.animations) this.clips[clip.name] = clip;
    this._actions = {};
    this._current = null;
    this._attackDur = (this.clips["attack-melee-right"]?.duration ?? 0.45) * 0.85;
    this.play("idle", { fade: 0 });

    // blob shadow (glued to the floor even when hopping / dying)
    this.radius = (opts.radius ?? 0.42) * (targetH / 1.7);
    this.height = targetH;
    this.shadow = makeBlobShadow(this.radius * 1.5);
    this.shadow.position.y = 0.015;
    this.add(this.shadow);

    this._squash = new Spring(0, 15, 0.45);
    this._flashT = 0;
    this._stepT = 0;
    this._primed = false;

    // Creature-compatible animator facade
    this.animator = {
      attackT: -1,
      dead: false,
      onFootstep: null,
      prevPos: new THREE.Vector3(), // game copies position here on teleport
      squash: { kick: (v) => this._squash.kick(v) },
      die: (imp) => this.die(imp),
    };
  }

  _applyColors() {
    for (let i = 0; i < this._mats.length; i++) this._mats[i].color.copy(this._baseColors[i]);
  }

  // ---------------------------------------------------------------- anim
  play(name, { loop = true, fade = 0.2, reset = false } = {}) {
    const clip = this.clips[name];
    if (!clip) return null;
    let action = this._actions[name];
    if (!action) {
      action = this.mixer.clipAction(clip);
      this._actions[name] = action;
    }
    if (this._current === action && !reset) return action;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    if (fade > 0) action.fadeIn(fade);
    if (this._current && this._current !== action) this._current.fadeOut(fade);
    action.play();
    this._current = action;
    return action;
  }

  /** Attach a prop (sword) to the right hand. */
  holdItem(obj) {
    if (!this.armR) return;
    obj.position.set(0, -1.05, 0.25);
    obj.rotation.set(-0.3, 0, 0);
    this.armR.add(obj);
    this.heldItem = obj;
  }

  attack() {
    if (this.animator.attackT >= 0 || this.animator.dead) return false;
    this.animator.attackT = 0;
    this.play("attack-melee-right", { loop: false, fade: 0.06, reset: true });
    return true;
  }

  hurt() {
    this._squash.kick(6);
    this._flashT = 0.14;
  }

  die(impulse) {
    if (this.animator.dead) return;
    this.animator.dead = true;
    this.play("die", { loop: false, fade: 0.1, reset: true });
    if (this.shadow) this.shadow.visible = false;
    if (impulse) this._squash.kick(4);
  }

  get dead() {
    return this.animator.dead;
  }

  update(dt, elapsed) {
    // speed from position delta (game / AI drive position directly)
    if (!this._primed) {
      this._primed = true;
      this.animator.prevPos.copy(this.position);
    }
    _v.subVectors(this.position, this.animator.prevPos);
    _v.y = 0;
    const speed = _v.length() / Math.max(dt, 1e-4);
    this.animator.prevPos.copy(this.position);

    // smooth turn toward heading
    let dh = this.heading + MODEL_YAW - this.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.rotation.y += dh * (1 - Math.pow(0.0001, dt));

    if (!this.animator.dead) {
      if (this.animator.attackT >= 0) {
        this.animator.attackT += dt / this._attackDur;
        if (this.animator.attackT >= 1) this.animator.attackT = -1;
      } else {
        this.play(speed > 4.2 ? "sprint" : speed > 0.35 ? "walk" : "idle");
      }
      // footsteps while moving
      if (speed > 0.4 && this.animator.onFootstep) {
        this._stepT -= dt;
        if (this._stepT <= 0) {
          this._stepT = 0.32;
          this.animator.onFootstep(_v.copy(this.position), 1);
        }
      }
    }

    // hurt flash: pulse emissive (base color is white * texture, so tinting
    // the diffuse would be invisible — emissive reads clearly)
    if (this._flashT > 0) {
      this._flashT -= dt;
      const k = Math.max(0, this._flashT / 0.14);
      for (const m of this._mats) {
        if (m.emissive) m.emissive.copy(_flashColor).multiplyScalar(k);
      }
    }

    // squash pop
    const sq = this._squash.update(dt);
    const s = this._scale;
    this.model.scale.set(s * (1 - sq * 0.05), s * (1 + sq * 0.08), s * (1 - sq * 0.05));

    this.mixer.update(dt);
    if (this.shadow) this.shadow.position.y = 0.015 - this.position.y;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    // geometry is shared with the cached template — only per-instance
    // materials (cloned in the constructor) are ours to free
    for (const m of this._mats) m.dispose();
    if (this.shadow) this.shadow.material.dispose();
    this.removeFromParent();
  }
}

const _flashColor = new THREE.Color(1, 0.45, 0.45);
