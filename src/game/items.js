// The merchandise. Every item has a tiny procedural toon mesh for display
// tables / dungeon drops, an `icon` (a key into core/icons.js) for the DOM UI,
// and a base value that haggling revolves around.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";

const M = (color) => makeToonMaterial({ color, rim: 0.25 });

function group(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) g.add(m);
  return g;
}
const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.rotation.z = rz;
  return m;
};

// `heal` marks a consumable: using it restores that many hearts and removes it from the bag.
export const ITEMS = {
  caveshroom: { name: "Cave Mushroom", icon: "caveshroom", base: 8, tier: 1, heal: 1 },
  jelly:   { name: "Slime Jelly",   icon: "jelly",   base: 12,  tier: 1 },
  herb:    { name: "Moon Herb",     icon: "herb",    base: 16,  tier: 1, heal: 1 },
  bread:   { name: "Honey Bread",   icon: "bread",   base: 14,  tier: 1, heal: 2 },
  wsword:  { name: "Pine Sword",    icon: "sword",   base: 28,  tier: 1 },
  potion:  { name: "Red Potion",    icon: "potion",  base: 34,  tier: 2, heal: 4 },
  ring:    { name: "Copper Ring",   icon: "ring",    base: 48,  tier: 2 },
  dagger:  { name: "Fang Dagger",   icon: "dagger",  base: 60,  tier: 2 },
  lantern: { name: "Wisp Lantern",  icon: "lantern", base: 75,  tier: 2 },
  amulet:  { name: "Silver Amulet", icon: "amulet",  base: 105, tier: 3 },
  ssword:  { name: "Steel Sword",   icon: "swords",  base: 140, tier: 3 },
  tome:    { name: "Spell Tome",    icon: "tome",    base: 170, tier: 3 },
  gem:     { name: "Dawn Gem",      icon: "gem",     base: 260, tier: 4 },
  fang:    { name: "Dragon Fang",   icon: "fang",    base: 340, tier: 4 },
  crown:   { name: "Lost Crown",    icon: "crown",   base: 450, tier: 4 },

  // ---- second wave: colourful merch that leans on the icon pack ----
  mushroom: { name: "Wild Mushroom",    icon: "mushroom",  base: 10,  tier: 1, heal: 1 },
  meat:     { name: "Roast Meat",       icon: "meat",      base: 18,  tier: 1, heal: 2 },
  egg:      { name: "Griffon Egg",      icon: "egg",       base: 40,  tier: 2 },
  key:      { name: "Brass Key",        icon: "key",       base: 52,  tier: 2 },
  bomb:     { name: "Blast Bomb",       icon: "bomb",      base: 44,  tier: 2 },
  shield:   { name: "Kite Shield",      icon: "shield",    base: 120, tier: 3 },
  bell:     { name: "Gold Bell",        icon: "bell",      base: 150, tier: 3 },
  feather:  { name: "Phoenix Feather",  icon: "feather",   base: 160, tier: 3 },
  hourglass:{ name: "Chrono Hourglass", icon: "hourglass", base: 300, tier: 4 },
  star:     { name: "Star Shard",       icon: "star",      base: 380, tier: 4 },
};
for (const [id, it] of Object.entries(ITEMS)) it.id = id;

export const LOOT_BY_TIER = [
  [],
  ["caveshroom", "jelly", "herb", "bread", "wsword", "mushroom", "meat"],
  ["jelly", "herb", "potion", "ring", "dagger", "lantern", "egg", "key", "bomb"],
  ["potion", "ring", "amulet", "ssword", "tome", "lantern", "shield", "bell", "feather"],
  ["amulet", "tome", "gem", "fang", "crown", "ssword", "hourglass", "star"],
];

// -------------------------------------------------------- tiny prop meshes
const makers = {
  // Cave Mushroom — a fat, edible tan-capped mushroom (its own look, distinct
  // from the red-spotted Wild Mushroom below).
  caveshroom: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.14, 10), M(0xefe2c6), 0, 0.075),
      mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xb06a3a), 0, 0.15),
      mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.02, 12), M(0xd9b48a), 0, 0.14)
    ),
  jelly: () => mesh(new THREE.SphereGeometry(0.13, 10, 8), M(0x53c66e), 0, 0.09),
  herb: () =>
    group(
      mesh(new THREE.ConeGeometry(0.05, 0.22, 6), M(0x3fa957), -0.05, 0.11, 0, 0, 0.4),
      mesh(new THREE.ConeGeometry(0.05, 0.28, 6), M(0x57c26f), 0, 0.14),
      mesh(new THREE.ConeGeometry(0.05, 0.2, 6), M(0x3fa957), 0.05, 0.1, 0, 0, -0.4)
    ),
  bread: () => mesh(new THREE.CapsuleGeometry(0.08, 0.16, 4, 8).rotateZ(Math.PI / 2), M(0xd99a4e), 0, 0.08),
  wsword: () => swordMesh(0x9c7b4f, 0x6e5433, 0.5),
  potion: () =>
    group(
      mesh(new THREE.SphereGeometry(0.1, 10, 8), M(0xd4425f), 0, 0.1),
      mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09), M(0x88c9d8), 0, 0.22),
      mesh(new THREE.SphereGeometry(0.045, 8, 6), M(0xb3762a), 0, 0.27)
    ),
  ring: () => mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 16), M(0xd08c4a), 0, 0.1, 0, Math.PI / 3),
  dagger: () => swordMesh(0xc8cdd6, 0x54324a, 0.34),
  lantern: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 8), M(0xffd979), 0, 0.13),
      mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.03, 8), M(0x424a63), 0, 0.24),
      mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.03, 8), M(0x424a63), 0, 0.04)
    ),
  amulet: () =>
    group(
      mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), M(0xc9d3dd), 0, 0.14),
      mesh(new THREE.OctahedronGeometry(0.055), M(0x7fd0e0), 0, 0.08)
    ),
  ssword: () => swordMesh(0xd7dde6, 0x3f5f9e, 0.62),
  tome: () =>
    group(
      mesh(new THREE.BoxGeometry(0.2, 0.05, 0.26), M(0xa63d4e), 0, 0.05),
      mesh(new THREE.BoxGeometry(0.17, 0.055, 0.23), M(0xe8dcc0), 0, 0.052)
    ),
  gem: () => mesh(new THREE.OctahedronGeometry(0.13), M(0x86e8ff), 0, 0.14),
  fang: () => mesh(new THREE.ConeGeometry(0.07, 0.28, 8), M(0xf2ead8), 0, 0.14, 0, 0.35, 0.5),
  crown: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 8), M(0xf0c04a), 0, 0.08),
      ...[0, 1, 2, 3, 4].map((i) =>
        mesh(
          new THREE.ConeGeometry(0.025, 0.08, 4),
          M(0xf0c04a),
          Math.cos((i / 5) * Math.PI * 2) * 0.11,
          0.17,
          Math.sin((i / 5) * Math.PI * 2) * 0.11
        )
      )
    ),

  // ---- second wave meshes ----
  mushroom: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.13, 8), M(0xf1e6cf), 0, 0.07),
      mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xd6473b), 0, 0.14),
      mesh(new THREE.SphereGeometry(0.014, 6, 6), M(0xfbe6d0), 0.04, 0.17),
      mesh(new THREE.SphereGeometry(0.014, 6, 6), M(0xfbe6d0), -0.05, 0.155)
    ),
  meat: () =>
    group(
      mesh(new THREE.CapsuleGeometry(0.08, 0.13, 4, 10).rotateZ(Math.PI / 2), M(0x9c5a2e), 0, 0.1),
      mesh(new THREE.SphereGeometry(0.05, 10, 8), M(0xe1738a), 0.11, 0.1),
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1).rotateZ(Math.PI / 2), M(0xf1ead8), -0.16, 0.1)
    ),
  egg: () => mesh(new THREE.CapsuleGeometry(0.075, 0.06, 6, 12), M(0xd8e6dc), 0, 0.12),
  key: () =>
    group(
      mesh(new THREE.TorusGeometry(0.05, 0.02, 8, 14), M(0xe8c04a), 0, 0.18),
      mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), M(0xe8c04a), 0, 0.08),
      mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), M(0xe8c04a), 0.03, 0.03),
      mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), M(0xe8c04a), 0.03, 0.075)
    ),
  bomb: () =>
    group(
      mesh(new THREE.SphereGeometry(0.11, 14, 12), M(0x2b2b36), 0, 0.12),
      mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.04, 8), M(0x3a3a46), 0, 0.24),
      mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.07), M(0x9c7a44), 0.03, 0.29, 0, 0, 0.5),
      mesh(new THREE.SphereGeometry(0.022, 8, 8), M(0xffb038), 0.06, 0.32)
    ),
  shield: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 20), M(0x3f6fae), 0, 0.13, 0, Math.PI / 2),
      mesh(new THREE.TorusGeometry(0.12, 0.016, 8, 20), M(0xd7c27a), 0, 0.13),
      mesh(new THREE.SphereGeometry(0.035, 10, 8), M(0xd7c27a), 0, 0.13, 0.03)
    ),
  bell: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.035, 0.11, 0.15, 14), M(0xe8c04a), 0, 0.1),
      mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 14), M(0xcfa22f), 0, 0.03),
      mesh(new THREE.TorusGeometry(0.022, 0.008, 6, 12), M(0xcfa22f), 0, 0.2),
      mesh(new THREE.SphereGeometry(0.028, 8, 8), M(0x9c7b2f), 0, 0.025)
    ),
  feather: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.28, 6), M(0xf0e6cc), 0, 0.14, 0, 0, 0.18),
      mesh(new THREE.ConeGeometry(0.06, 0.22, 4).rotateX(Math.PI / 2), M(0xe0503a), 0.02, 0.16, 0, 0, 0.18)
    ),
  hourglass: () =>
    group(
      mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), M(0x8a5a2e), 0, 0.22),
      mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), M(0x8a5a2e), 0, 0.02),
      mesh(new THREE.ConeGeometry(0.075, 0.09, 12), M(0x8fd0e0), 0, 0.16, 0, Math.PI),
      mesh(new THREE.ConeGeometry(0.075, 0.09, 12), M(0x8fd0e0), 0, 0.075),
      ...[0, 1, 2].map((i) =>
        mesh(
          new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6),
          M(0x8a5a2e),
          Math.cos((i / 3) * Math.PI * 2) * 0.075,
          0.12,
          Math.sin((i / 3) * Math.PI * 2) * 0.075
        )
      )
    ),
  star: () => mesh(starGeometry(0.13, 0.055, 5, 0.05), M(0xf6c825), 0, 0.15),
};

// A flat, extruded N-point star (used for the Star Shard prop / drop).
function starGeometry(outer, inner, points = 5, depth = 0.05) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
  geo.center();
  return geo;
}

export function swordMesh(bladeColor, gripColor, len = 0.6) {
  // authored pointing -Y so it extends naturally from a hand bone
  const g = group(
    mesh(new THREE.BoxGeometry(0.11, len, 0.04), M(bladeColor), 0, -len / 2 - 0.1),
    mesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), M(gripColor), 0, -0.1),
    mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.18), M(gripColor), 0, -0.02)
  );
  return g;
}

const _protoCache = new Map();
export function itemMesh(id) {
  if (!_protoCache.has(id)) _protoCache.set(id, makers[id]());
  return _protoCache.get(id).clone();
}

// -------------------------------------------------------- billboarded icons
// In-world merchandise (shop shelves, dungeon drops, admin catalogue) shows the
// flat colour icon (public/items/<icon>.png) as a camera-facing sprite rather
// than a tiny primitive model — the icon art simply reads better at a glance.
// The sprite is wrapped in a Group so call sites keep the itemMesh() API
// (`position` / `scale` / `add(shadow)`); rotating the group is a harmless
// no-op since the billboard always faces the camera.
const _texLoader = new THREE.TextureLoader();
const _texCache = new Map();
function itemTexture(icon) {
  let tex = _texCache.get(icon);
  if (!tex) {
    tex = _texLoader.load(`items/${icon}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    _texCache.set(icon, tex);
  }
  return tex;
}

export function itemSprite(id, size = 0.5) {
  const icon = ITEMS[id]?.icon || id;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: itemTexture(icon), transparent: true, alphaTest: 0.5 })
  );
  sprite.scale.setScalar(size);
  sprite.center.set(0.5, 0); // anchor the bottom edge so the icon "stands" on the group origin
  const g = new THREE.Group();
  g.add(sprite);
  return g;
}
