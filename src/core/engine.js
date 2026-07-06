// Renderer / scene / camera / main loop. Mobile-first: capped pixel ratio,
// no shadow maps (blob shadows instead), single hemisphere + dir light.
import * as THREE from "three";

export class Engine {
  constructor(mountEl) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    mountEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2b1c46);
    this.scene.fog = new THREE.Fog(0x2b1c46, 26, 60);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, 9, 8);
    this.camera.lookAt(0, 0.6, 0);

    // Camera rig: follows a target with a phase-dependent offset.
    this.camTarget = new THREE.Vector3();
    this.camOffset = new THREE.Vector3(0, 8.4, 7.2);
    this.camLookAhead = new THREE.Vector3();
    this.camShake = 0;

    this.hemi = new THREE.HemisphereLight(0xcdb8ff, 0x3a2a55, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    this.sun.position.set(6, 12, 4);
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
    const w = window.innerWidth;
    const h = window.innerHeight;
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
    this.camShake = Math.min(0.8, this.camShake + amount);
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
