// Unified input: WASD / arrows on desktop, dynamic virtual joystick +
// context action button on touch. The game reads:
//   input.move        THREE.Vector2 (len <= 1)
//   input.actionEdge  true for the frame the action was pressed
//   input.setActionLabel("⚔️") to relabel the context button
import * as THREE from "three";

export class Input {
  constructor(hudEl) {
    this.move = new THREE.Vector2();
    this._keys = new Set();
    this._actionQueued = false;
    this.actionEdge = false;
    this.actionHeld = false;
    this.isTouch = matchMedia("(pointer: coarse)").matches;

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === "Space" || e.code === "KeyJ" || e.code === "Enter") {
        this._actionQueued = true;
        this.actionHeld = true;
      }
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

    // --- action button
    this.actionBtn = document.createElement("button");
    this.actionBtn.id = "action-btn";
    this.actionBtn.textContent = "⚔️";
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

    const area = document.getElementById("app");
    area.addEventListener("touchstart", (e) => this._touchStart(e), { passive: false });
    area.addEventListener("touchmove", (e) => this._touchMove(e), { passive: false });
    area.addEventListener("touchend", (e) => this._touchEnd(e));
    area.addEventListener("touchcancel", (e) => this._touchEnd(e));

    if (!this.isTouch) this.stick.style.display = "none";
  }

  setActionLabel(txt, show = true) {
    if (this.actionBtn.textContent !== txt) this.actionBtn.textContent = txt;
    this.actionBtn.classList.toggle("pulse", show && txt !== "⚔️");
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
