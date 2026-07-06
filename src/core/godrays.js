// Fake volumetric light shafts ("god rays") + drifting dust motes. No
// post-processing: each shaft is three crossed additive trapezoid quads that
// read as a soft cone of light from any angle, matching the game's cheap,
// stylised look (blob shadows, additive glows, canvas textures elsewhere).
import * as THREE from "three";

let _beamTex = null;
// Grey beam baked into RGB (additive blending adds it * material.color):
// bright at the top (the light source), fading down and softly at the edges.
function beamTexture() {
  if (_beamTex) return _beamTex;
  const W = 64, H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const vy = y / (H - 1); // 0 = top (source), 1 = bottom
    const vert = Math.pow(1 - vy, 0.7) * (0.35 + 0.65 * Math.min(1, vy * 6)); // fade in from the very top, then fall off
    for (let x = 0; x < W; x++) {
      const ex = (x / (W - 1)) * 2 - 1; // -1..1 across width
      const edge = Math.pow(Math.max(0, Math.cos(ex * Math.PI * 0.5)), 1.6);
      const v = Math.round(255 * vert * edge);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _beamTex = new THREE.CanvasTexture(c);
  _beamTex.colorSpace = THREE.SRGBColorSpace;
  return _beamTex;
}

// Trapezoid hanging from y=0 down to y=-length: narrow at the top, wide at
// the bottom. UVs put the texture's top row (bright) at y=0.
function trapezoidGeo(topW, botW, length) {
  const ht = topW / 2, hb = botW / 2;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([
    -ht, 0, 0, ht, 0, 0, hb, -length, 0,
    -ht, 0, 0, hb, -length, 0, -hb, -length, 0,
  ]);
  const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

let _moteTex = null;
function moteTexture() {
  if (_moteTex) return _moteTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  _moteTex = new THREE.CanvasTexture(c);
  return _moteTex;
}

/**
 * Build a light shaft. Returns a THREE.Group hanging straight down from its
 * origin (the light source); rotate/position it wherever you like. Call
 * `group.userData.update(dt, elapsed)` each frame for the flicker + motes.
 */
export function makeLightShaft({
  length = 6,
  topWidth = 0.55,
  bottomWidth = 2.4,
  color = 0xffe6b0,
  opacity = 0.5,
  motes = 12,
  tilt = 0.32,
  spin = 0,
} = {}) {
  const group = new THREE.Group();
  group.rotation.set(tilt, spin, 0);

  const geo = trapezoidGeo(topWidth, bottomWidth, length);
  const mat = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const beams = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (i / 3) * Math.PI; // 0°, 60°, 120°
    m.raycast = () => {};
    beams.add(m);
  }
  group.add(beams);

  // --- drifting dust motes trapped in the beam
  let motePts = null;
  let vel = null;
  if (motes > 0) {
    const arr = new Float32Array(motes * 3);
    vel = new Float32Array(motes);
    for (let i = 0; i < motes; i++) {
      const y = -Math.random() * length;
      const spread = (bottomWidth * 0.5) * (-y / length) * 0.85 + topWidth * 0.3;
      arr[i * 3] = (Math.random() - 0.5) * 2 * spread;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 2 * spread;
      vel[i] = 0.12 + Math.random() * 0.25;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mm = new THREE.PointsMaterial({
      map: moteTexture(),
      color,
      size: 0.13,
      transparent: true,
      opacity: opacity * 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
      toneMapped: false,
    });
    motePts = new THREE.Points(mg, mm);
    motePts.raycast = () => {};
    group.add(motePts);
  }

  group.renderOrder = 3;
  const base = opacity;
  const phase = Math.random() * Math.PI * 2;
  group.userData.update = (dt, elapsed) => {
    // lazy, candle-ish flicker
    const f = 0.8 + Math.sin(elapsed * 1.1 + phase) * 0.13 + Math.sin(elapsed * 4.3 + phase) * 0.05;
    mat.opacity = base * f;
    if (motePts) {
      motePts.material.opacity = base * 0.9 * f;
      const p = motePts.geometry.attributes.position;
      for (let i = 0; i < motes; i++) {
        let y = p.array[i * 3 + 1] + vel[i] * dt; // drift upward toward the source
        p.array[i * 3] += Math.sin(elapsed * 0.6 + i) * dt * 0.05;
        if (y > 0) {
          y = -length;
          const spread = topWidth * 0.3 + bottomWidth * 0.5;
          p.array[i * 3] = (Math.random() - 0.5) * 2 * spread;
          p.array[i * 3 + 2] = (Math.random() - 0.5) * 2 * spread;
        }
        p.array[i * 3 + 1] = y;
      }
      p.needsUpdate = true;
    }
  };
  // Retint the beam (and its motes) — used to shift the shafts warm/cool as
  // the shop's time of day changes. Accepts anything THREE.Color takes.
  group.userData.setColor = (c) => {
    mat.color.set(c);
    if (motePts) motePts.material.color.set(c);
  };
  group.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
    if (motePts) {
      motePts.geometry.dispose();
      motePts.material.dispose();
    }
  };
  return group;
}
