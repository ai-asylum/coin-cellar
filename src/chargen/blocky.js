// A Kenney "Blocky Characters" actor that mimics the Creature interface so it
// can drop straight into the game as the player, the co-op partner, and the
// shop customers. Body parts are node-animated (no skin), so we clone the
// cached template and drive a per-instance AnimationMixer with the pack's
// clips (idle / walk / sprint / attack-melee-right / die / …).
import * as THREE from "three";
import { Spring } from "../core/engine.js";
import { makeBlobShadow, makeToonMaterial } from "../core/toon.js";
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
    // Optional gentle turning: a rad/s cap so the body rotates toward its
    // heading at a steady, unhurried pace (townsfolk) instead of the default
    // snappy smoothing (the player). Null keeps the snappy default.
    this.turnRate = opts.turnRate ?? null;
    // Playback multiplier for this actor's animation clips (< 1 = a more
    // relaxed, ambling gait). Doesn't touch movement — see the game AI for that.
    this._animScale = opts.animScale ?? 1;
    const targetH = opts.height ?? 1.7;

    const src = CHARACTERS[variant] || CHARACTERS.a;
    const model = src.scene.clone(true);

    // The Kenney GLBs ship KHR_materials_unlit → THREE.MeshBasicMaterial, so
    // the stock characters ignore the scene's hemi/sun/fog entirely and stay
    // full-bright while the toon-shaded world darkens around them. Rebuild each
    // as a MeshToonMaterial over the same atlas so the player + NPCs pick up the
    // dusk/dungeon lighting like the floors and walls do. Per-instance so the
    // hurt-flash / tint below don't leak between creatures sharing a template.
    this._mats = [];
    this._baseColors = [];
    model.traverse((o) => {
      if (o.isMesh) {
        // src is the shared template material (clone(true) copies meshes but
        // keeps material refs), so read from it but never dispose it here.
        const src = o.material;
        const mat = makeToonMaterial({ map: src.map ?? null, rim: 0.18 });
        mat.transparent = src.transparent;
        mat.alphaTest = src.alphaTest;
        mat.side = src.side;
        o.material = mat;
        o.frustumCulled = false;
        this._mats.push(mat);
        this._baseColors.push(mat.color.clone());
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
    this._tossDur = (this.clips["pick-up"]?.duration ?? 0.6) * 0.9;
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
    this._animSpeed = 0; // low-pass filtered speed that drives the walk cycle
    this._loco = "idle"; // current locomotion clip, kept sticky via hysteresis

    // Creature-compatible animator facade
    this.animator = {
      attackT: -1,
      tossT: -1,
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

  /**
   * Show a floating name plate above the head (used for other players in the
   * shared world / co-op). Pass a falsy value to remove it. Cheap to call every
   * frame: it early-outs when the text is unchanged.
   */
  setNameLabel(text) {
    text = String(text ?? "").trim();
    if (!text) return this._clearNameLabel();
    if (this._nameSprite && this._nameText === text) return;
    this._clearNameLabel();
    const spr = makeTextSprite(text);
    spr.position.y = this.height + 0.32;
    this.add(spr);
    this._nameSprite = spr;
    this._nameText = text;
  }

  _clearNameLabel() {
    if (!this._nameSprite) return;
    this._nameSprite.material.map?.dispose();
    this._nameSprite.material.dispose();
    this.remove(this._nameSprite);
    this._nameSprite = null;
    this._nameText = null;
  }

  /**
   * Pop a speech bubble above the head (chat). Replaces any current bubble and
   * auto-clears after `dur` seconds (handled in update()). Like the name plate
   * it's a billboard sprite child, so it follows the character for free.
   */
  setChatBubble(text, dur = 6) {
    text = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (!text) return;
    this._clearChatBubble();
    const spr = makeBubbleSprite(text);
    spr.position.y = this.height + 0.6; // sits just above the name plate
    this.add(spr);
    this._chatSprite = spr;
    this._chatUntil = performance.now() + dur * 1000;
  }

  _clearChatBubble() {
    if (!this._chatSprite) return;
    this._chatSprite.material.map?.dispose();
    this._chatSprite.material.dispose();
    this.remove(this._chatSprite);
    this._chatSprite = null;
    this._chatUntil = 0;
  }

  /** Attach a prop (sword / bow / staff) to the right hand, replacing any prior. */
  holdItem(obj) {
    if (!this.armR) return;
    if (this.heldItem) this.heldItem.removeFromParent();
    obj.position.set(0, -1.0, 0.32);
    obj.rotation.set(-0.85, 0, 0.12);
    this.armR.add(obj);
    this.heldItem = obj;
  }

  attack() {
    if (this.animator.attackT >= 0 || this.animator.dead) return false;
    this.animator.attackT = 0;
    this.play("attack-melee-right", { loop: false, fade: 0.06, reset: true });
    return true;
  }

  /** Quick crouch-and-toss gesture, played when dropping loot. */
  toss() {
    if (this.animator.dead || this.animator.attackT >= 0) return false;
    this.animator.tossT = 0;
    this._squash.kick(3);
    this.play("pick-up", { loop: false, fade: 0.08, reset: true });
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
    const rawSpeed = _v.length() / Math.max(dt, 1e-4);
    this.animator.prevPos.copy(this.position);
    // Low-pass the speed (~80 ms) so remote avatars — whose position arrives as
    // interpolated network snapshots — don't flip idle/walk on tiny per-frame
    // wobble. Local movement is already smooth, so the filter is imperceptible.
    this._animSpeed += (rawSpeed - this._animSpeed) * (1 - Math.exp(-dt / 0.08));
    const speed = this._animSpeed;

    // smooth turn toward heading — a steady rad/s cap for a gentle, unhurried
    // pivot (townsfolk), otherwise the snappy exponential smoothing (player)
    let dh = this.heading + MODEL_YAW - this.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (this.turnRate != null) {
      const maxStep = this.turnRate * dt;
      this.rotation.y += Math.max(-maxStep, Math.min(maxStep, dh));
    } else {
      this.rotation.y += dh * (1 - Math.pow(0.0001, dt));
    }

    if (!this.animator.dead) {
      if (this.animator.attackT >= 0) {
        this.animator.attackT += dt / this._attackDur;
        if (this.animator.attackT >= 1) this.animator.attackT = -1;
      } else if (this.animator.tossT >= 0) {
        this.animator.tossT += dt / this._tossDur;
        if (this.animator.tossT >= 1) this.animator.tossT = -1;
      } else {
        // sticky thresholds (enter high, leave low) so a speed hovering near a
        // boundary doesn't strobe between two clips
        let loco = this._loco;
        if (loco === "idle") { if (speed > 0.55) loco = "walk"; }
        else if (loco === "walk") {
          if (speed < 0.25) loco = "idle";
          else if (speed > 4.6) loco = "sprint";
        } else if (loco === "sprint") {
          if (speed < 3.8) loco = "walk";
        }
        this._loco = loco;
        this.play(loco);
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

    this.mixer.update(dt * this._animScale);
    if (this.shadow) this.shadow.position.y = 0.015 - this.position.y;

    if (this._chatSprite && performance.now() > this._chatUntil) this._clearChatBubble();
  }

  dispose() {
    this._clearNameLabel();
    this._clearChatBubble();
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

// A billboard name plate: white text on a soft dark pill, baked to a canvas
// texture and hung on a THREE.Sprite so it always faces the camera. depthTest
// is off so the name stays legible even when the head clips scenery.
function makeTextSprite(text) {
  const font = 44, padX = 16, padY = 10;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const fontSpec = `700 ${font}px system-ui, -apple-system, sans-serif`;
  ctx.font = fontSpec;
  const w = Math.ceil(ctx.measureText(text).width);
  c.width = w + padX * 2;
  c.height = font + padY * 2;
  // resizing the canvas resets the 2d state, so re-apply everything
  ctx.font = fontSpec;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = c.width / 2, cy = c.height / 2;
  ctx.fillStyle = "rgba(18,20,28,0.6)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, 14);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(text, cx, cy + 1);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, cx, cy + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  const worldH = 0.24;
  spr.scale.set(worldH * (c.width / c.height), worldH, 1);
  spr.center.set(0.5, 0); // anchor bottom edge at the sprite's position
  spr.renderOrder = 999;
  return spr;
}

// A chat speech bubble: word-wrapped white text on a rounded dark panel, baked
// to a canvas and hung on a billboard sprite (same trick as the name plate, but
// multi-line and a touch larger). depthTest off so it stays readable.
function makeBubbleSprite(text) {
  const font = 40, padX = 24, padY = 16, lineH = Math.round(font * 1.18), maxTextW = 460;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const fontSpec = `600 ${font}px system-ui, -apple-system, sans-serif`;
  ctx.font = fontSpec;

  // greedy word wrap under maxTextW; a single over-long word is hard-broken
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxTextW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 5) { lines.length = 5; lines[4] = lines[4].replace(/.{0,3}$/, "…"); }

  let widest = 0;
  for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
  c.width = Math.ceil(Math.min(widest, maxTextW)) + padX * 2;
  c.height = lines.length * lineH + padY * 2;
  // resizing the canvas resets 2d state — re-apply
  ctx.font = fontSpec;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(20,22,32,0.82)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, 22);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, c.width, c.height);
  }
  const cx = c.width / 2;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i < lines.length; i++) {
    const y = padY + lineH * (i + 0.5);
    ctx.strokeText(lines[i], cx, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(lines[i], cx, y);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  const k = 0.0044; // px → world scale (keeps one line ≈ 0.32 world units tall)
  spr.scale.set(c.width * k, c.height * k, 1);
  spr.center.set(0.5, 0);
  spr.renderOrder = 1000;
  return spr;
}
