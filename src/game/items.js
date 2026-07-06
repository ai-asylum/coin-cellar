// The merchandise. Every item has a tiny procedural toon mesh for display
// tables / dungeon drops, an emoji for the DOM UI, and a base value that
// haggling revolves around.
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

export const ITEMS = {
  apple:   { name: "Apple",         emoji: "🍎", base: 8,   tier: 1 },
  jelly:   { name: "Slime Jelly",   emoji: "🟢", base: 12,  tier: 1 },
  herb:    { name: "Moon Herb",     emoji: "🌿", base: 16,  tier: 1 },
  bread:   { name: "Honey Bread",   emoji: "🍞", base: 14,  tier: 1 },
  wsword:  { name: "Pine Sword",    emoji: "🗡️", base: 28,  tier: 1 },
  potion:  { name: "Red Potion",    emoji: "🧪", base: 34,  tier: 2 },
  ring:    { name: "Copper Ring",   emoji: "💍", base: 48,  tier: 2 },
  dagger:  { name: "Fang Dagger",   emoji: "🔪", base: 60,  tier: 2 },
  lantern: { name: "Wisp Lantern",  emoji: "🏮", base: 75,  tier: 2 },
  amulet:  { name: "Silver Amulet", emoji: "📿", base: 105, tier: 3 },
  ssword:  { name: "Steel Sword",   emoji: "⚔️", base: 140, tier: 3 },
  tome:    { name: "Spell Tome",    emoji: "📕", base: 170, tier: 3 },
  gem:     { name: "Dawn Gem",      emoji: "💎", base: 260, tier: 4 },
  fang:    { name: "Dragon Fang",   emoji: "🦷", base: 340, tier: 4 },
  crown:   { name: "Lost Crown",    emoji: "👑", base: 450, tier: 4 },
};
for (const [id, it] of Object.entries(ITEMS)) it.id = id;

export const LOOT_BY_TIER = [
  [],
  ["apple", "jelly", "herb", "bread", "wsword"],
  ["jelly", "herb", "potion", "ring", "dagger", "lantern"],
  ["potion", "ring", "amulet", "ssword", "tome", "lantern"],
  ["amulet", "tome", "gem", "fang", "crown", "ssword"],
];

// -------------------------------------------------------- tiny prop meshes
const makers = {
  apple: () =>
    group(
      mesh(new THREE.SphereGeometry(0.11, 12, 10), M(0xe23b3b), 0, 0.1),
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07), M(0x5b3a1e), 0, 0.22),
      mesh(new THREE.SphereGeometry(0.045, 8, 6), M(0x4fae3d), 0.045, 0.23)
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
};

export function swordMesh(bladeColor, gripColor, len = 0.6) {
  // authored pointing -Y so it extends naturally from a hand bone
  const g = group(
    mesh(new THREE.BoxGeometry(0.05, len, 0.016), M(bladeColor), 0, -len / 2 - 0.1),
    mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), M(gripColor), 0, -0.1),
    mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12), M(gripColor), 0, -0.03)
  );
  return g;
}

const _protoCache = new Map();
export function itemMesh(id) {
  if (!_protoCache.has(id)) _protoCache.set(id, makers[id]());
  return _protoCache.get(id).clone();
}
