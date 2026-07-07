// Unified input: WASD / arrows to move, MOUSE to aim + click to attack on
// desktop; dynamic virtual joystick + context action button on touch.
// The game reads:
//   input.move        THREE.Vector2 (len <= 1)
//   input.actionEdge  true for the frame the action was pressed
//   input.pointer     THREE.Vector2 mouse in NDC (-1..1), for aim raycasts
//   input.aimActive   true when the mouse is driving the aim (desktop)
//   input.onKey       optional (code) => void callback for keyboard shortcuts
//   input.setActionLabel("swords") to relabel the context button (icon name)
import * as THREE from "three";
import { icon } from "./icons.js";

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

    // mouse aim (desktop): pointer in normalized device coords, aim on until touch
    this.pointer = new THREE.Vector2(0, 0);
    this.aimActive = !this.isTouch;
    this.onKey = null; // set by the game to receive shortcut keydowns

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === "Space" || e.code === "KeyJ" || e.code === "Enter") {
        this._actionQueued = true;
        this.actionHeld = true;
      }
      // dodge / roll: Shift, K, or L
      if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyK" || e.code === "KeyL") {
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
      if (e.code === "Space" || e.code === "KeyJ" || e.code === "Enter") this.actionHeld = false;
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

    // --- action button (labelled by icon name; see core/icons.js)
    this.actionBtn = document.createElement("button");
    this.actionBtn.id = "action-btn";
    this._actionLabel = "swords";
    this.actionBtn.innerHTML = icon("swords");
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

    // --- dodge button (touch): a quick roll with i-frames
    this.dodgeBtn = document.createElement("button");
    this.dodgeBtn.id = "dodge-btn";
    this.dodgeBtn.innerHTML = icon("walk");
    hudEl.appendChild(this.dodgeBtn);
    const dodgePress = (e) => {
      e.preventDefault();
      this._dodgeQueued = true;
    };
    this.dodgeBtn.addEventListener("touchstart", dodgePress, { passive: false });
    this.dodgeBtn.addEventListener("mousedown", dodgePress);

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

    // --- mouse aim + click-to-attack (desktop). The HUD sits above the
    // canvas with pointer-events:none, so clicks on buttons never reach here.
    window.addEventListener("mousemove", (e) => {
      this.aimActive = true;
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    area.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // left click only
      this.aimActive = true;
      this._actionQueued = true;
      this.actionHeld = true;
    });
    area.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.actionHeld = false;
    });
    // right mouse button = dodge / roll
    area.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        this.aimActive = true;
        this._dodgeQueued = true;
      }
    });
    area.addEventListener("contextmenu", (e) => e.preventDefault());
    // first touch hands control back to the virtual stick / on-screen button
    window.addEventListener("touchstart", () => (this.aimActive = false), { passive: true });

    if (!this.isTouch) {
      this.stick.style.display = "none";
      this.dodgeBtn.style.display = "none";
    }
  }

  setActionLabel(name, show = true) {
    if (this._actionLabel !== name) {
      this._actionLabel = name;
      this.actionBtn.innerHTML = icon(name);
    }
    this.actionBtn.classList.toggle("pulse", show && name !== "swords");
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
        this._joyId = t.identifier;
        this._joyOrigin = { x: t.clientX, y: t.clientY };
        this._joyVec = { x: 0, y: 0 };
        this.stick.style.display = "block";
        this._joyBase.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        this._joyKnob.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
      }
    }
  }

  _touchMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        e.preventDefault();
        const dx = t.clientX - this._joyOrigin.x;
        const dy = t.clientY - this._joyOrigin.y;
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
