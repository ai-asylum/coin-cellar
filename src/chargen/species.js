// Creature recipes. Everything in the game — hero, customers, monsters —
// comes out of the same blob-bake pipeline, differing only in this file's
// part lists. Author space: a [-0.8, 0.8] cube with the ground at y = GROUND.
import { rng, pick, lerp } from "../core/engine.js";

export const GROUND = -0.75;

class Rig {
  constructor() {
    this.parts = [];
    this.bones = [];
  }
  bone(name, parent, pos) {
    this.bones.push({ name, parent, pos });
    return this.bones.length - 1;
  }
  sphere(bone, a, r, color, blend) {
    this.parts.push({ kind: "sphere", bone, a, r, color, blend });
  }
  capsule(bone, a, b, r, r2, color, blend) {
    this.parts.push({ kind: "capsule", bone, a, b, r, r2, color, blend });
  }
  ellipsoid(bone, a, rx, ry, rz, color, blend) {
    this.parts.push({ kind: "ellipsoid", bone, a, rx, ry, rz, color, blend });
  }
}

function hsl(h, s, l) {
  // small hand-rolled hsl->rgb so specs stay plain arrays
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const SKIN_HUES = [0.07, 0.06, 0.08, 0.05, 0.33, 0.55, 0.86, 0.13];
const CLOTH_HUES = [0.0, 0.08, 0.14, 0.35, 0.5, 0.6, 0.72, 0.85, 0.93];

// ---------------------------------------------------------------- humanoid
// Shared body plan for hero, customers, goblins, brutes. Options control
// proportions and accessories so one function yields a whole village.
export function humanoidSpec(opts) {
  const {
    key,
    scale = 1.05,
    fat = 1,
    headR = 0.26,
    earType = "round", // round | point | cat | none
    snout = 0,
    hat = null, // null | "cap" | "horns" | "hood"
    skin,
    cloth,
    pants,
    accent,
    armR = 0.07,
    beltY = -0.05,
  } = opts;

  const g = new Rig();
  const root = g.bone("root", -1, [0, GROUND, 0]);
  const hips = g.bone("hips", root, [0, -0.15 - GROUND, 0]); // abs -0.15
  const chest = g.bone("chest", hips, [0, 0.3, 0]); // abs 0.15
  const head = g.bone("head", chest, [0, 0.28, 0]); // abs 0.43
  const armL = g.bone("armL", chest, [-0.27, 0.08, 0]); // socket abs (−0.27, .23)
  const armR_ = g.bone("armR", chest, [0.27, 0.08, 0]);
  const legL = g.bone("legL", hips, [-0.11, 0, 0]); // socket abs (−0.11, −0.15)
  const legR = g.bone("legR", hips, [0.11, 0, 0]);

  const rT = 0.19 * fat;
  // torso: pants-coloured lower half + shirt upper half, melting at the belt
  g.capsule(hips, [0, -0.24, 0], [0, beltY, 0], rT * 0.94, rT, pants);
  g.capsule(chest, [0, beltY, 0], [0, 0.2, 0], rT, rT * 0.78, cloth);
  // head
  g.sphere(head, [0, 0.5, 0.0], headR, skin, 0.07);
  if (snout > 0) g.sphere(head, [0, 0.45, headR * 0.9], headR * 0.4 * snout, skin, 0.06);
  // ears
  if (earType === "point") {
    g.capsule(head, [-headR * 0.85, 0.5, 0], [-headR * 1.7, 0.58, -0.02], 0.05, 0.015, skin, 0.06);
    g.capsule(head, [headR * 0.85, 0.5, 0], [headR * 1.7, 0.58, -0.02], 0.05, 0.015, skin, 0.06);
  } else if (earType === "cat") {
    g.capsule(head, [-headR * 0.6, 0.6, 0], [-headR * 0.85, 0.78, 0], 0.06, 0.012, accent, 0.05);
    g.capsule(head, [headR * 0.6, 0.6, 0], [headR * 0.85, 0.78, 0], 0.06, 0.012, accent, 0.05);
  } else if (earType === "round") {
    g.sphere(head, [-headR * 1.02, 0.47, 0], 0.055, skin, 0.05);
    g.sphere(head, [headR * 1.02, 0.47, 0], 0.055, skin, 0.05);
  }
  // hats
  if (hat === "cap") {
    g.ellipsoid(head, [0, 0.5 + headR * 0.75, 0], headR * 0.92, headR * 0.45, headR * 0.92, accent, 0.045);
    g.ellipsoid(head, [0, 0.5 + headR * 0.48, headR * 0.85], headR * 0.55, 0.025, headR * 0.45, accent, 0.04);
  } else if (hat === "horns") {
    g.capsule(head, [-headR * 0.7, 0.5 + headR * 0.55, 0], [-headR * 1.3, 0.5 + headR * 1.25, 0.05], 0.05, 0.012, accent, 0.045);
    g.capsule(head, [headR * 0.7, 0.5 + headR * 0.55, 0], [headR * 1.3, 0.5 + headR * 1.25, 0.05], 0.05, 0.012, accent, 0.045);
  } else if (hat === "hood") {
    g.ellipsoid(head, [0, 0.53, -0.05], headR * 1.12, headR * 1.08, headR * 1.08, accent, 0.07);
  }
  // arms (skin hands melt out of cloth sleeves)
  g.capsule(armL, [-0.29, 0.26, 0], [-0.34, 0.0, 0.02], armR, armR * 0.8, cloth, 0.07);
  g.sphere(armL, [-0.35, -0.06, 0.03], armR * 1.2, skin, 0.06);
  g.capsule(armR_, [0.29, 0.26, 0], [0.34, 0.0, 0.02], armR, armR * 0.8, cloth, 0.07);
  g.sphere(armR_, [0.35, -0.06, 0.03], armR * 1.2, skin, 0.06);
  // legs + feet
  g.capsule(legL, [-0.11, -0.15, 0], [-0.13, -0.62, 0.0], 0.085, 0.07, pants);
  g.sphere(legL, [-0.13, -0.68, 0.05], 0.095, accent, 0.08);
  g.capsule(legR, [0.11, -0.15, 0], [0.13, -0.62, 0.0], 0.085, 0.07, pants);
  g.sphere(legR, [0.13, -0.68, 0.05], 0.095, accent, 0.08);

  const L = (x, y, z) => [x * scale, (y - GROUND) * scale, z * scale];
  return {
    key,
    scale,
    groundY: GROUND,
    blend: 0.095,
    parts: g.parts,
    bones: g.bones,
    face: {
      head,
      eyes: { l: L(-0.095, 0.52, headR * 0.95), r: L(0.095, 0.52, headR * 0.95), r0: 0.042 * scale },
    },
    anim: {
      mode: "walker",
      hips, chest, head,
      legs: [
        { bone: legL, socket: L(-0.11, -0.15, 0), foot: L(-0.13, -0.72, 0.03), group: 0 },
        { bone: legR, socket: L(0.11, -0.15, 0), foot: L(0.13, -0.72, 0.03), group: 1 },
      ],
      arms: [
        { bone: armL, socket: L(-0.29, 0.26, 0), hand: L(-0.35, -0.06, 0.03), side: -1 },
        { bone: armR_, socket: L(0.29, 0.26, 0), hand: L(0.35, -0.06, 0.03), side: 1 },
      ],
      handBone: armR_,
      handTip: L(0.35, -0.06, 0.03),
      hipH: (-0.15 - GROUND) * scale,
      stride: 0.42 * scale,
      radius: 0.34 * scale,
      height: (0.47 + headR - GROUND) * scale,
    },
  };
}

// ---------------------------------------------------------------- skitter
// N-legged bug (4 or 6 legs), the dungeon's bread-and-butter critter.
export function skitterSpec({ key, seed, legsN = 6, scale = 0.75, hue = 0.78 }) {
  const r = rng(seed);
  const body = hsl(hue, 0.45, 0.42);
  const belly = hsl(hue, 0.35, 0.6);
  const accent = hsl((hue + 0.45) % 1, 0.7, 0.55);
  const g = new Rig();
  const root = g.bone("root", -1, [0, GROUND, 0]);
  const hips = g.bone("hips", root, [0, -0.38 - GROUND, 0]);
  const head = g.bone("head", hips, [0, 0.06, 0.3]);
  g.ellipsoid(hips, [0, -0.38, -0.05], 0.3, 0.23, 0.34, body);
  g.ellipsoid(hips, [0, -0.46, -0.02], 0.26, 0.18, 0.3, belly, 0.12);
  g.sphere(head, [0, -0.32, 0.3], 0.17, body);
  // little mandibles
  g.capsule(head, [-0.08, -0.38, 0.42], [-0.05, -0.42, 0.5], 0.03, 0.01, accent, 0.05);
  g.capsule(head, [0.08, -0.38, 0.42], [0.05, -0.42, 0.5], 0.03, 0.01, accent, 0.05);

  const legs = [];
  const half = legsN / 2;
  for (let i = 0; i < legsN; i++) {
    const side = i < half ? -1 : 1;
    const j = i % half;
    const t = half === 1 ? 0.5 : j / (half - 1);
    const z = lerp(0.22, -0.26, t);
    const sock = [side * 0.24, -0.38, z];
    const foot = [side * 0.52, GROUND + 0.03, z + lerp(0.12, -0.12, t)];
    const b = g.bone("leg" + i, hips, [sock[0], 0, sock[2] + 0.05]);
    g.capsule(b, sock, [foot[0], foot[1] + 0.02, foot[2]], 0.055, 0.035, body);
    const L = (p) => [p[0] * scale, (p[1] - GROUND) * scale, p[2] * scale];
    legs.push({ bone: b, socket: L(sock), foot: L(foot), group: (j + (side < 0 ? 0 : 1)) % 2 });
  }

  const L = (x, y, z) => [x * scale, (y - GROUND) * scale, z * scale];
  return {
    key,
    scale,
    groundY: GROUND,
    blend: 0.1,
    parts: g.parts,
    bones: g.bones,
    face: {
      head,
      eyes: { l: L(-0.075, -0.28, 0.42), r: L(0.075, -0.28, 0.42), r0: 0.05 * scale },
    },
    anim: {
      mode: "walker",
      hips, chest: hips, head,
      legs,
      arms: [],
      hipH: (-0.38 - GROUND) * scale,
      stride: 0.3 * scale,
      radius: 0.4 * scale,
      height: (0.0 - GROUND) * scale,
    },
  };
}

// ---------------------------------------------------------------- slime
export function slimeSpec({ key, scale = 0.7, hue = 0.36 }) {
  const body = hsl(hue, 0.6, 0.5);
  const top = hsl(hue, 0.55, 0.68);
  const g = new Rig();
  const root = g.bone("root", -1, [0, GROUND, 0]);
  const hips = g.bone("hips", root, [0, -0.45 - GROUND, 0]);
  const crown = g.bone("crown", hips, [0, 0.28, 0]);
  g.ellipsoid(hips, [0, -0.45, 0], 0.38, 0.3, 0.38, body);
  g.ellipsoid(crown, [0, -0.2, 0], 0.24, 0.2, 0.24, top, 0.2);
  g.sphere(crown, [0.1, -0.02, 0.05], 0.08, top, 0.14); // drippy blob
  const L = (x, y, z) => [x * scale, (y - GROUND) * scale, z * scale];
  return {
    key, scale, groundY: GROUND, blend: 0.16,
    parts: g.parts, bones: g.bones,
    face: { head: hips, eyes: { l: L(-0.13, -0.4, 0.33), r: L(0.13, -0.4, 0.33), r0: 0.05 * scale } },
    anim: {
      mode: "hopper",
      hips, chest: crown, head: crown,
      legs: [], arms: [],
      hipH: (-0.45 - GROUND) * scale,
      radius: 0.38 * scale,
      height: (0.0 - GROUND) * scale,
    },
  };
}

// ---------------------------------------------------------------- wisp
export function wispSpec({ key, scale = 0.62, hue = 0.55 }) {
  const body = hsl(hue, 0.7, 0.6);
  const glow = hsl(hue, 0.8, 0.8);
  const g = new Rig();
  const root = g.bone("root", -1, [0, GROUND, 0]);
  const hips = g.bone("hips", root, [0, -0.1 - GROUND, 0]);
  const t1 = g.bone("tail1", hips, [0, -0.3, 0]);
  const t2 = g.bone("tail2", t1, [0, -0.22, 0]);
  g.sphere(hips, [0, -0.1, 0], 0.28, body);
  g.ellipsoid(hips, [0, 0.12, 0], 0.16, 0.12, 0.16, glow, 0.14);
  g.capsule(t1, [0, -0.34, 0], [0, -0.55, 0], 0.13, 0.07, body);
  g.capsule(t2, [0, -0.58, 0], [0, -0.72, 0], 0.06, 0.02, glow, 0.1);
  const L = (x, y, z) => [x * scale, (y - GROUND) * scale, z * scale];
  return {
    key, scale, groundY: GROUND, blend: 0.13,
    parts: g.parts, bones: g.bones,
    face: { head: hips, eyes: { l: L(-0.1, -0.06, 0.24), r: L(0.1, -0.06, 0.24), r0: 0.045 * scale } },
    anim: {
      mode: "floater",
      hips, chest: hips, head: hips,
      tail: [t1, t2],
      legs: [], arms: [],
      hover: 0.9 * scale,
      hipH: (-0.1 - GROUND) * scale,
      radius: 0.3 * scale,
      height: (0.2 - GROUND) * scale,
    },
  };
}

// ------------------------------------------------------------- factories

export function heroSpec(seed = 1, isGuest = false) {
  const r = rng(seed * 7919 + 3);
  const skin = hsl(pick(r, SKIN_HUES.slice(0, 4)), 0.5, 0.72);
  const hue = isGuest ? 0.6 : 0.08;
  return humanoidSpec({
    key: "hero" + seed + (isGuest ? "g" : ""),
    scale: 1.05,
    skin,
    cloth: hsl(hue, 0.62, 0.5),
    pants: hsl(0.66, 0.25, 0.3),
    accent: hsl(hue, 0.5, 0.32),
    earType: "round",
    hat: "cap",
  });
}

export function customerSpec(seed) {
  const r = rng(seed * 104729 + 11);
  const skinHue = pick(r, SKIN_HUES);
  const clothHue = pick(r, CLOTH_HUES);
  return humanoidSpec({
    key: "cust" + seed,
    scale: 0.88 + r() * 0.3,
    fat: 0.85 + r() * 0.45,
    headR: 0.23 + r() * 0.06,
    skin: hsl(skinHue, skinHue > 0.2 ? 0.45 : 0.5, 0.55 + r() * 0.25),
    cloth: hsl(clothHue, 0.55, 0.42 + r() * 0.2),
    pants: hsl((clothHue + 0.4 + r() * 0.3) % 1, 0.35, 0.3 + r() * 0.15),
    accent: hsl((clothHue + 0.5) % 1, 0.6, 0.45),
    earType: pick(r, ["round", "point", "cat", "round"]),
    snout: r() < 0.25 ? 0.8 + r() * 0.6 : 0,
    hat: pick(r, [null, null, "cap", "hood", null]),
  });
}

export function goblinSpec(seed, tier = 0) {
  const r = rng(seed * 31 + 7);
  const skin = hsl(0.3 + r() * 0.08, 0.5, 0.42);
  const s = humanoidSpec({
    key: "gob" + seed + "_" + tier,
    scale: 0.66 + tier * 0.05,
    fat: 0.9,
    headR: 0.31,
    skin,
    cloth: hsl(0.08, 0.45, 0.3),
    pants: hsl(0.08, 0.35, 0.22),
    accent: hsl(0.12, 0.6, 0.45),
    earType: "point",
    hat: tier > 0 ? "horns" : null,
  });
  return s;
}

export function bruteSpec(seed, tier = 0) {
  const r = rng(seed * 131 + 5);
  const skin = hsl(0.02 + r() * 0.05, 0.5, 0.4);
  return humanoidSpec({
    key: "brute" + seed + "_" + tier,
    scale: 1.5 + tier * 0.12,
    fat: 1.5,
    headR: 0.2,
    armR: 0.13,
    skin,
    cloth: skin,
    pants: hsl(0.09, 0.4, 0.25),
    accent: hsl(0.0, 0.6, 0.35),
    earType: "none",
    hat: "horns",
  });
}
