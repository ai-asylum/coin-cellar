// Unified input: WASD / arrows to move (facing follows movement); dynamic
// virtual joystick + a primary button on touch. Combat is dash-only: that
// primary button is the ATTACK button while delving (its press dashes) and the
// context button above ground; a separate interact button handles stairs /
// portals / chests. The game reads:
//   input.move        THREE.Vector2 (len <= 1)
//   input.actionEdge  true for the frame the action/context press fired
//   input.dodgeEdge   true for the frame a dash was requested
//   input.onKey       optional (code) => void callback for keyboard shortcuts
//   input.setActionLabel(name) to label/show the context button (or null hides)
import * as THREE from "three";
import { icon } from "./icons.js";
import { viewport } from "./viewport.js";

export class Input {
  constructor(hudEl) {
    this.move = new THREE.Vector2();
    this._keys = new Set();
    this._actionQueued = false;
    this.actionEdge = false;
    this.actionHeld = false;
    this._dodgeQueued = false;
    this.dodgeEdge = false; // true for the frame a dodge/roll was requested
    this._interactQueued = false;
    this.interactEdge = false; // true for the frame the interact key was pressed
    this.isTouch = matchMedia("(pointer: coarse)").matches;

    this.onKey = null; // set by the game to receive shortcut keydowns

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === "Space" || e.code === "Enter") {
        this._actionQueued = true;
        this.actionHeld = true;
      }
      // dash attack: J or Shift (K is no longer bound to combat)
      if (e.code === "KeyJ" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        this._dodgeQueued = true;
      }
      // interact (portals, stairs, chests, doors, haggle): E or F — kept apart
      // from the attack button so the two never fight over the same press
      if (e.code === "KeyE" || e.code === "KeyF") {
        this._interactQueued = true;
      }
      // shortcuts (skip while typing in a field)
      const t = document.activeElement && document.activeElement.tagName;
      if (t !== "INPUT" && t !== "TEXTAREA") this.onKey?.(e.code, e);
    });
    window.addEventListener("keyup", (e) => {
      this._keys.delete(e.code);
      if (e.code === "Space" || e.code === "Enter") this.actionHeld = false;
    });

    // --- virtual joystick (left 60% of screen, dynamic origin)
    this.stick = document.createElement("div");
    this.stick.id = "joystick";
    this.stick.innerHTML = `<div id="joy-base"></div><div id="joy-knob"></div>`;
    hudEl.appendChild(this.stick);
    this._joyBase = this.stick.querySelector("#joy-base");
    this._joyKnob = this.stick.querySelector("#joy-knob");
    this._joyId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._joyVec = { x: 0, y: 0 };

    // --- primary button (labelled by icon name; see core/icons.js). It is the
    // ATTACK button (fires the dash) while delving, and the context button
    // (shop deals, prompts) above ground — the game routes its press per area.
    this.actionBtn = document.createElement("button");
    this.actionBtn.id = "action-btn";
    this._actionLabel = null;
    this.actionBtn.style.display = "none";
    hudEl.appendChild(this.actionBtn);
    const press = (e) => {
      e.preventDefault();
      this._actionQueued = true;
      this.actionHeld = true;
    };
    const release = () => (this.actionHeld = false);
    this.actionBtn.addEventListener("touchstart", press, { passive: false });
    this.actionBtn.addEventListener("touchend", release);
    this.actionBtn.addEventListener("mousedown", press);
    this.actionBtn.addEventListener("mouseup", release);

    // --- interact button (touch): portals / stairs / chests — only shown when
    // something's in reach, so it never steals the attack button's press
    this.interactBtn = document.createElement("button");
    this.interactBtn.id = "interact-btn";
    this.interactBtn.innerHTML = icon("arrowDown");
    this.interactBtn.style.display = "none";
    hudEl.appendChild(this.interactBtn);
    this._interactLabel = null;
    const interactPress = (e) => {
      e.preventDefault();
      this._interactQueued = true;
    };
    this.interactBtn.addEventListener("touchstart", interactPress, { passive: false });
    this.interactBtn.addEventListener("mousedown", interactPress);

    const area = document.getElementById("app");
    area.addEventListener("touchstart", (e) => this._touchStart(e), { passive: false });
    area.addEventListener("touchmove", (e) => this._touchMove(e), { passive: false });
    area.addEventListener("touchend", (e) => this._touchEnd(e));
    area.addEventListener("touchcancel", (e) => this._touchEnd(e));

    // --- left click = context action (desktop): advance dialogue, serve at the
    // counter, fire an interact. Combat is dash-only, so it no longer attacks.
    // The HUD sits above the canvas with pointer-events:none, so clicks on
    // buttons never reach here.
    area.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // left click only
      this._actionQueued = true;
      this.actionHeld = true;
    });
    area.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.actionHeld = false;
    });
    // right mouse button = dash (the attack)
    area.addEventListener("mousedown", (e) => {
      if (e.button === 2) this._dodgeQueued = true;
    });
    area.addEventListener("contextmenu", (e) => e.preventDefault());

    if (!this.isTouch) {
      this.stick.style.display = "none";
    }
  }

  // Label the primary button with an icon name (the crossed-swords attack glyph
  // while delving, a context icon above ground), or pass a falsy name to hide
  // it. Touch-only: never forces it visible on desktop, where CSS keeps it
  // hidden.
  setActionLabel(name, show = true) {
    const on = !!name;
    if (this.isTouch) this.actionBtn.style.display = on ? "" : "none";
    if (!on) { this._actionLabel = null; return; }
    if (this._actionLabel !== name) {
      this._actionLabel = name;
      this.actionBtn.innerHTML = icon(name);
    }
    this.actionBtn.classList.toggle("pulse", show);
  }

  // Show/hide the touch interact button and label it with the current context
  // icon (portal, stairs, chest, …). Desktop uses E/F, so it stays hidden there.
  setInteract(name, show = true) {
    const on = show && !!name && this.isTouch;
    if (name && this._interactLabel !== name) {
      this._interactLabel = name;
      this.interactBtn.innerHTML = icon(name);
    }
    this.interactBtn.style.display = on ? "flex" : "none";
  }

  _touchStart(e) {
    for (const t of e.changedTouches) {
      if (this._joyId === null) {
        e.preventDefault();
        // The joystick lives inside #hud, which is CSS-rotated in forced
        // landscape, so we place/measure it in the rotated layout's local space.
        const p = viewport.toLocal(t.clientX, t.clientY);
        this._joyId = t.identifier;
        this._joyOrigin = { x: p.x, y: p.y };
        this._joyVec = { x: 0, y: 0 };
        this.stick.style.display = "block";
        this._joyBase.style.transform = `translate(${p.x}px, ${p.y}px)`;
        this._joyKnob.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    }
  }

  _touchMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        e.preventDefault();
        const p = viewport.toLocal(t.clientX, t.clientY);
        const dx = p.x - this._joyOrigin.x;
        const dy = p.y - this._joyOrigin.y;
        const len = Math.hypot(dx, dy);
        const max = 52;
        const k = len > max ? max / len : 1;
        this._joyVec = { x: (dx * k) / max, y: (dy * k) / max };
        this._joyKnob.style.transform = `translate(${this._joyOrigin.x + dx * k}px, ${this._joyOrigin.y + dy * k}px)`;
      }
    }
  }

  _touchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        this._joyId = null;
        this._joyVec = { x: 0, y: 0 };
        this.stick.style.display = "none";
      }
    }
  }

  update() {
    this.actionEdge = this._actionQueued;
    this._actionQueued = false;
    this.dodgeEdge = this._dodgeQueued;
    this._dodgeQueued = false;
    this.interactEdge = this._interactQueued;
    this._interactQueued = false;

    let x = 0, y = 0;
    if (this._keys.has("KeyA") || this._keys.has("ArrowLeft")) x -= 1;
    if (this._keys.has("KeyD") || this._keys.has("ArrowRight")) x += 1;
    if (this._keys.has("KeyW") || this._keys.has("ArrowUp")) y -= 1;
    if (this._keys.has("KeyS") || this._keys.has("ArrowDown")) y += 1;
    x += this._joyVec.x;
    y += this._joyVec.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.set(x, y);
  }
}
