// Renderer / scene / camera / main loop. Mobile-first: capped pixel ratio,
// no shadow maps (blob shadows instead), single hemisphere + dir light.
import * as THREE from "three";
import { viewport } from "./viewport.js";

export class Engine {
  constructor(mountEl) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    mountEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Moodier backdrop: deeper twilight purple, tighter fog so the light
    // shafts have something to glow against and the room edges fall to dusk.
    this.scene.background = new THREE.Color(0x1a1030);
    this.scene.fog = new THREE.Fog(0x1a1030, 20, 52);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, 9, 8);
    this.camera.lookAt(0, 0.6, 0);

    // Camera rig: follows a target with a phase-dependent offset.
    this.camTarget = new THREE.Vector3();
    this.camOffset = new THREE.Vector3(0, 8.4, 7.2);
    this.camLookAhead = new THREE.Vector3();
    this.camShake = 0;
    this.camPunch = new THREE.Vector3(); // transient positional kick (decays)

    // Moody key + fill: a dim cool ambient (so shadows read as blue dusk)
    // and a strong warm, low-ish "sun" that the god-ray shafts trace.
    this.hemi = new THREE.HemisphereLight(0xb7a1ff, 0x160e28, 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffdca0, 1.9);
    this.sun.position.set(7, 10, 5);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.clock = new THREE.Clock();
    this.timeScale = 1; // hit-stop support
    this._hitStopT = 0;
    this.elapsed = 0;
    this._tickers = [];

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const w = viewport.w;
    const h = viewport.h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onTick(fn) {
    this._tickers.push(fn);
  }

  hitStop(dur = 0.07) {
    this._hitStopT = Math.max(this._hitStopT, dur);
  }

  shake(amount = 0.25) {
    // kept deliberately gentle — big values get scaled down and capped low
    this.camShake = Math.min(0.4, this.camShake + amount * 0.45);
  }

  // A directional shove of the whole view — sells the impact direction of a
  // hit far more than jitter alone. dx/dz are world-space; amt scales it.
  punch(dx = 0, dz = 0, amt = 0.25) {
    const len = Math.hypot(dx, dz) || 1;
    this.camPunch.x += (dx / len) * amt;
    this.camPunch.z += (dz / len) * amt;
    const cap = 0.6;
    this.camPunch.clampLength(0, cap);
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      let dt = Math.min(this.clock.getDelta(), 0.05);
      if (this._hitStopT > 0) {
        this._hitStopT -= dt;
        dt *= 0.06;
      }
      dt *= this.timeScale;
      this.elapsed += dt;
      for (const fn of this._tickers) fn(dt, this.elapsed);
      this._updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  _updateCamera(dt) {
    const want = _v1.copy(this.camTarget).add(this.camOffset);
    this.camera.position.lerp(want, 1 - Math.pow(0.0018, dt));
    // apply + decay the impact punch (springy snap-back)
    if (this.camPunch.lengthSq() > 1e-5) {
      this.camera.position.add(this.camPunch);
      this.camPunch.multiplyScalar(Math.pow(0.0009, dt));
    } else this.camPunch.set(0, 0, 0);
    const look = _v2.copy(this.camTarget).add(this.camLookAhead);
    look.y += 0.6;
    if (this.camShake > 0.001) {
      this.camShake *= Math.pow(0.001, dt);
      look.x += (Math.random() - 0.5) * this.camShake;
      look.y += (Math.random() - 0.5) * this.camShake;
    } else this.camShake = 0;
    this.camera.lookAt(look);
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Tiny deterministic RNG (mulberry32) used everywhere for procgen.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// Critically-damped-ish spring, the workhorse of all the juice in this game.
export class Spring {
  constructor(value = 0, freq = 8, damp = 0.7) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.freq = freq;
    this.damp = damp;
  }
  update(dt) {
    const k = this.freq * this.freq;
    const c = 2 * this.damp * this.freq;
    this.v += (k * (this.target - this.x) - c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(impulse) {
    this.v += impulse;
  }
}
