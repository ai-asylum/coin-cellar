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
    this.hudEl = hudEl;
    this.move = new THREE.Vector2();
    this._keys = new Set();
    this._actionQueued = false;
    this.actionEdge = false;
    this.actionHeld = false;
    this._dodgeQueued = false;
    this.dodgeEdge = false; // true for the frame a dodge/roll was requested
    this._interactQueued = false;
    this.interactEdge = false; // true for the frame the interact key was pressed
    // A quick, stationary touch on the play area reads as a tap (not a joystick
    // drag): it mirrors a desktop left click for shop pick-to-interact. `tap`
    // holds its screen point for the frame `tapEdge` is set.
    this._tapQueued = false;
    this.tapEdge = false;
    this.tap = null;
    this.isTouch = matchMedia("(pointer: coarse)").matches;
    // Landscape touch swaps the on-screen attack button for tap-to-attack (see
    // `tapAttack`): the screen's the target, so a quick tap fires the dash.
    const oriMq = matchMedia("(orientation: landscape)");
    this.isLandscape = oriMq.matches;
    const syncOri = () => (this.isLandscape = oriMq.matches);
    if (oriMq.addEventListener) oriMq.addEventListener("change", syncOri);
    else oriMq.addListener(syncOri);

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

  // Touch landscape drops the on-screen attack button: a quick tap on the play
  // area fires the dash instead (the game reads this to route taps to combat).
  get tapAttack() {
    return this.isTouch && this.isLandscape;
  }

  // Label the primary button with an icon name (the crossed-swords attack glyph
  // while delving, a context icon above ground), or pass a falsy name to hide
  // it. Touch-only: never forces it visible on desktop, where CSS keeps it
  // hidden. In tap-to-attack mode (landscape) the swords button is suppressed —
  // the tap is the attack, so the button would just be dead weight.
  setActionLabel(name, show = true) {
    if (name === "swords" && this.tapAttack) name = null;
    const on = !!name;
    if (this.isTouch) this.actionBtn.style.display = on ? "" : "none";
    // Let CSS know the primary button is live so the bag/store buttons can slot
    // inboard of it (and fill its corner when it's gone).
    this.hudEl?.classList.toggle("action-on", this.isTouch && on);
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
        // remember where/when this touch began so a quick, near-motionless
        // release can be told apart from a joystick drag and fire as a tap
        this._joyStartT = performance.now();
        this._joyStartClient = { x: t.clientX, y: t.clientY };
        this._joyMoved = false;
        this.stick.style.display = "block";
        this._joyBase.style.transform = `translate(${p.x}px, ${p.y}px)`;
        this._joyKnob.style.transform = `translate(${p.x}px, ${p.y}px)`;
      } else if (this.tapAttack) {
        // moving with one thumb: a second finger anywhere is an attack (dash),
        // so landscape players can strike without lifting off the joystick
        e.preventDefault();
        this._dodgeQueued = true;
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
        if (len > 12) this._joyMoved = true; // past the slop: it's a drag, not a tap
        const k = len > max ? max / len : 1;
        this._joyVec = { x: (dx * k) / max, y: (dy * k) / max };
        this._joyKnob.style.transform = `translate(${this._joyOrigin.x + dx * k}px, ${this._joyOrigin.y + dy * k}px)`;
      }
    }
  }

  _touchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        // a short, motionless press fires as a tap (shop pick-to-interact)
        if (!this._joyMoved && performance.now() - this._joyStartT < 300) {
          this._tapQueued = true;
          this.tap = { x: this._joyStartClient.x, y: this._joyStartClient.y };
        }
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
    this.tapEdge = this._tapQueued;
    this._tapQueued = false;

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
