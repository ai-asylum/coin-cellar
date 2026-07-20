// Player equipment. Gear is no longer a separate catalogue you buy with gold —
// it's ordinary merchandise from items.js that happens to carry an `equip` block
// (see ITEMS). Bosses drop it, you can shelve/sell it like anything else, or you
// can slot it into one of five body slots for a stat boost. This module just
// knows how to (a) describe the slots, (b) roll an equipped loadout into a flat
// stat bundle, and (c) build the little held-weapon prop for the player's hand.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { ITEMS, swordMesh } from "./items.js";

const M = (color) => makeToonMaterial({ color, rim: 0.25 });
const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.rotation.z = rz;
  return m;
};

export const SLOTS = ["weapon", "chest", "shield", "ring", "boots"];

// UI chrome for each slot: its label and the monochrome glyph shown when the
// slot is empty. `row` groups the paper-doll layout (three on top, two below).
export const SLOT_META = {
  weapon: { name: "Weapon", icon: "swords", empty: "Unarmed", row: "top" },
  chest: { name: "Chestplate", icon: "armor", empty: "No armor", row: "top" },
  shield: { name: "Shield", icon: "shield", empty: "No shield", row: "top" },
  ring: { name: "Ring", icon: "ring", empty: "No ring", row: "bottom" },
  boots: { name: "Boots", icon: "boots", empty: "Barefoot", row: "bottom" },
};

// The `equip` block for an item id (or null for anything that isn't gear).
export function equipInfo(id) {
  return (id && ITEMS[id]?.equip) || null;
}

// Whether a piece can actually be slotted right now. For now only swords are
// equippable — bows, staves and the armour/ring/shield/boots slots are held
// back until they're properly balanced — so the picker and the bag's one-tap
// Equip button both gate on this.
export function canEquip(id) {
  const eq = equipInfo(id);
  return !!eq && eq.type === "sword";
}

// Fresh loadout for a new game: every slot bare — the heir starts unarmed,
// fighting with their fists until they find or stock a proper weapon.
export function starterEquipment() {
  return { weapon: null, chest: null, shield: null, ring: null, boots: null };
}

// Roll every equipped piece's modifiers into one flat bundle the game applies to
// combat, movement and survivability. Kept pure so it's trivial to recompute
// whenever the loadout changes.
export function aggregateStats(equipment) {
  const s = {
    weaponType: "sword", weapon: null, dmgMul: 1,
    critBonus: 0, maxHpBonus: 0, speedMul: 1,
    blockChance: 0, dodgeCdMul: 1, goldMul: 1,
  };
  for (const slot of SLOTS) {
    const g = equipInfo(equipment[slot]);
    if (!g || g.slot !== slot) continue;
    if (slot === "weapon") {
      s.weapon = g;
      s.weaponType = g.type || "sword";
      s.dmgMul *= g.dmgMul ?? 1;
    }
    if (g.maxHp) s.maxHpBonus += g.maxHp;
    if (g.crit) s.critBonus += g.crit;
    if (g.speed) s.speedMul *= 1 + g.speed;
    if (g.block) s.blockChance = Math.max(s.blockChance, g.block);
    if (g.dodgeCd) s.dodgeCdMul *= 1 - g.dodgeCd;
    if (g.gold) s.goldMul *= 1 + g.gold;
  }
  // Bare hands: nothing in the weapon slot. You can still fight, but a punch
  // lands for about half a blade's bite — enough that going weaponless is a
  // real trade-off, not a free ride.
  if (!s.weapon) {
    s.weaponType = "unarmed";
    s.dmgMul *= 0.5;
  }
  return s;
}

// -------------------------------------------------------- held weapon meshes
// The prop clipped to the player's right hand. Swords reuse the shared blade
// builder; bows and staves get their own little toon models.
export function weaponMesh(itemId) {
  if (!itemId) return null; // empty weapon slot → bare hands, no prop
  const g = equipInfo(itemId);
  if (!g || g.type === "sword") {
    return swordMesh(g?.blade ?? 0xd7dde6, g?.grip ?? 0x6e4526, g?.len ?? 0.5);
  }
  if (g.type === "bow") return bowMesh();
  return staffMesh();
}

function bowMesh() {
  const g = new THREE.Group();
  // a curved limb approximated by two angled staves + a taut string
  const wood = M(0x8a5a2e);
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6), wood, 0.06, 0.17, 0, 0, 0.5));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6), wood, 0.06, -0.17, 0, 0, -0.5));
  g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.62, 4), M(0xe8e0cf), -0.02, 0, 0));
  return g;
}

function staffMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.72, 8), M(0x6e4a2c), 0, -0.16, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), M(0x8fd8ff), 0, 0.24, 0));
  g.add(mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 12), M(0xd7c27a), 0, 0.2, 0, Math.PI / 2));
  return g;
}
