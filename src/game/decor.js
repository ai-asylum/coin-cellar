// Billboard scenery. Flat, camera-facing cutouts of trees, bushes, flowers,
// mushrooms, stones and bones (Layer Lab art, see public/decor/NOTICE.md) that
// dress the street outside the shop and the rooms of the cellar below. Each is
// an upright quad anchored at its bottom edge so it "stands" on the ground and
// yaws about the vertical (Y) axis to face the camera — an *axial* (cylindrical)
// billboard, not a full THREE.Sprite. That keeps every piece rooted and plumb:
// its base stays planted and it never tilts back when the camera looks down,
// the way a Sprite would. The cheap, classic way to fill a 3D world with
// hand-painted 2D set dressing.
import * as THREE from "three";
import { pick } from "../core/engine.js";

// -------------------------------------------------------- texture + sprite
const _loader = new THREE.TextureLoader();
const _cache = new Map(); // path -> { tex, aspect, waiters:[fn] }

function getTex(path) {
  let e = _cache.get(path);
  if (e) return e;
  e = { tex: null, aspect: 0.7, waiters: [] };
  _cache.set(path, e);
  e.tex = _loader.load(path, (t) => {
    if (t.image && t.image.height) {
      e.aspect = t.image.width / t.image.height;
      for (const cb of e.waiters) cb(e.aspect);
      e.waiters.length = 0;
    }
  });
  e.tex.colorSpace = THREE.SRGBColorSpace;
  e.tex.anisotropy = 4;
  return e;
}

// A unit quad in the XY plane, shifted up so it spans y=[0,1]: the bottom edge
// sits on the group origin, so scaling by `height` plants the base on the
// ground. Shared across every billboard (never disposed per-instance).
const _quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const _camPos = new THREE.Vector3();
const _wp = new THREE.Vector3();

// A single billboard. `height` is the world height it stands; its width is
// derived from the image aspect (applied the moment the texture is decoded, so
// nothing is squashed). `tint` multiplies the art — handy for dimming/cooling
// props to sit in the cellar's moodier light. Returned as a Group so callers
// can position it like any other prop.
//
// Orientation is axial: each frame (via onBeforeRender) the quad yaws about Y
// to face the camera in the XZ plane but stays perfectly upright, so it reads
// as a standing cutout rather than a decal that lies flat under a top-down cam.
export function decorSprite(path, { height = 1, tint = null, opacity = 1 } = {}) {
  const e = getTex(path);
  const mat = new THREE.MeshBasicMaterial({
    map: e.tex,
    transparent: true,
    alphaTest: 0.14, // keep the soft baked ground-shadow, drop the halo
    opacity,
    side: THREE.DoubleSide, // readable from either side as it yaws around
  });
  if (tint != null) mat.color.set(tint);
  const mesh = new THREE.Mesh(_quad, mat);
  const apply = (aspect) => mesh.scale.set(height * aspect, height, 1);
  if (e.tex.image && e.tex.image.width) apply(e.aspect);
  else {
    apply(e.aspect);
    e.waiters.push(apply);
  }
  // Y-only billboard: point the quad's +Z face at the camera horizontally, then
  // fold the fresh yaw straight into matrixWorld so it lands this frame (the
  // renderer has already composed matrices by the time onBeforeRender fires).
  mesh.onBeforeRender = (renderer, scene, camera) => {
    camera.getWorldPosition(_camPos);
    _wp.setFromMatrixPosition(mesh.matrixWorld);
    mesh.rotation.y = Math.atan2(_camPos.x - _wp.x, _camPos.z - _wp.z);
    mesh.updateMatrix();
    if (mesh.parent) mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix);
    else mesh.matrixWorld.copy(mesh.matrix);
  };
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.decorMat = mat;
  return g;
}

// Free the per-billboard materials under a group (the shared quad geometry and
// the cached textures stay put).
export function disposeDecor(group) {
  group.traverse((o) => {
    if (o.isMesh) o.material?.dispose();
  });
}

// -------------------------------------------------------------- catalogue
const P = "decor/";
export const DECOR = {
  trees: [
    "trees/Tree_Green_03.png", "trees/Tree_Green_06.png", "trees/Tree_Green_10.png",
    "trees/Tree_Green_14.png", "trees/Tree_Orange_04.png", "trees/Tree_Orange_09.png",
    "trees/Tree_Pink_05.png", "trees/Tree_Pink_12.png", "trees/Tree_Yellow_07.png",
    "trees/Tree_Yellow_15.png", "trees/Birch_Green_01.png",
  ].map((p) => P + p),
  smallTrees: [
    "trees/Small_Tree_Green_01.png", "trees/Small_Tree_Green_02.png",
    "trees/Small_Tree_Orange_01.png", "trees/Small_Tree_Yellow_01.png",
  ].map((p) => P + p),
  bushes: [
    "bushes/Bush_Green_01.png", "bushes/Bush_Green_02.png", "bushes/Bush_Green_03.png",
    "bushes/Bush_Yellow_02.png", "bushes/Bush_Yellow_04.png",
  ].map((p) => P + p),
  flowers: [
    "flowers/Forest_Flower_01.png", "flowers/Forest_Flower_02.png",
    "flowers/Autumn_Flower_01.png", "flowers/Autumn_Flower_02.png",
    "flowers/DeepForest_Flower_01.png", "flowers/Forest_Grass.png",
  ].map((p) => P + p),
  mushrooms: [
    "mushrooms/Mushroom_Pink_01.png", "mushrooms/Mushroom_Pink_02.png",
    "mushrooms/Mushroom_Wihte_01.png", "mushrooms/Mushroom_Wihte_02.png",
    "mushrooms/Mushroom_Yellow_01.png", "mushrooms/Mushroom_Yellow_03.png",
  ].map((p) => P + p),
  stones: [
    "stones/Stone_Dark_01.png", "stones/Stone_Dark_02.png", "stones/Stone_Dark_04.png",
    "stones/Stone_Gray1_03.png", "stones/Stone_Gray1_07.png",
    "stones/Stone_Brown_02.png", "stones/Stone_Brown_05.png",
  ].map((p) => P + p),
  dead: [
    "dead/Dead_Tree_Brown_01.png", "dead/Dead_Tree_Brown_02.png", "dead/Dead_Tree_White_01.png",
  ].map((p) => P + p),
  bones: ["bones/Big_Bone.png"].map((p) => P + p),
};

// ----------------------------------------------------------- shop street
// Dress the street glimpsed through the shopfront from explicit placements
// (src/game/layout.json `decor`, authored in the overworld editor — the old
// seeded scatter was baked into that file once and is hand-tuned from there).
// Purely cosmetic; added straight into the shop group. Returns the sprite
// groups in placement order so the editor can map them back to the layout.
export function placeStreetDecor(group, placements) {
  return placements.map((p) => {
    const s = decorSprite(p.path, { height: p.height });
    s.position.set(p.x, 0, p.z);
    group.add(s);
    return s;
  });
}

// Burst colour for each destructible prop, keyed by catalogue category. Stones
// shatter into a puff of grey rock-dust now that rocks are breakable (they cough
// up crystals — see DECOR_LOOT).
export const DECOR_BURST = {
  trees: 0x5aa84f,
  smallTrees: 0x5aa84f,
  bushes: 0x5fae54,
  flowers: 0x9bd77a,
  mushrooms: 0xd98ab8,
  stones: 0xa9a2b4,
  dead: 0x8a6a45,
  bones: 0xe8e0c8,
};

// What each destructible category coughs up when smashed. `chance` is the odds a
// single smash yields anything at all; `items` is a flat pool the drop is picked
// from (repeat an id to weight it). This is where moon herb and wild mushrooms
// live now — foraged from the scenery rather than looted off monsters/chests —
// and where the rocks pay out their crystals. Categories left out (bones, and
// the street-only trees/bushes/flowers) smash purely for show. Rolled
// host-side, so the item ids just need to exist in ITEMS.
export const DECOR_LOOT = {
  mushrooms: { chance: 0.6, items: ["mushroom", "mushroom", "caveshroom", "herb"] },
  dead: { chance: 0.5, items: ["herb", "herb", "mushroom"] },
  stones: { chance: 0.55, items: ["crystal"] },
};

// The forageable scenery dotted across the meadow fields around town, and the
// edible loot each kind coughs up when the player dashes through it. Unlike the
// cellar's grim decor, everything out here pays out food you can eat or sell —
// blossoms, berries, nuts, mushrooms, herbs. `weight` biases how often each
// kind is scattered (see Shop._buildForage); `chance`/`items` mirror DECOR_LOOT.
export const FIELD_FORAGE = {
  flowers:    { weight: 0.42, chance: 0.85, items: ["flower", "flower", "herb"], height: [0.4, 0.7] },
  bushes:     { weight: 0.22, chance: 0.75, items: ["berries", "berries", "flower"], height: [0.7, 1.1] },
  smallTrees: { weight: 0.18, chance: 0.75, items: ["nuts", "nuts", "berries"], height: [1.3, 2.0] },
  mushrooms:  { weight: 0.18, chance: 0.7, items: ["mushroom", "mushroom", "caveshroom"], height: [0.4, 0.75] },
};

// --------------------------------------------------------- dungeon floors
// Freckle the cellar with grim set dressing: dark stones and pale mushrooms
// tucked into room corners, the odd gnarled dead tree against a wall, and a
// stray bone pile. Seeded off the floor's rng so co-op peers see the same
// layout, and dimmed to a cool tint so it sits in the cellar's moody light.
// Returns the list of destructible props (every category with a DECOR_BURST
// colour, which now includes stones) so the dungeon can let the player smash
// them into a particle puff — and, for some, forage a drop (see DECOR_LOOT).
const CAVE_TINT = 0xc7c2d4;
// default mix, matching the classic cellar look; a hole theme can override
// both the category weights and the tint via opts.theme
const CAVE_WEIGHTS = { mushrooms: 0.42, stones: 0.36, dead: 0.14, bones: 0.08 };
const CAVE_HEIGHT = {
  mushrooms: (r) => 0.45 + r() * 0.5,
  stones: (r) => 0.55 + r() * 0.6,
  dead: (r) => 1.6 + r() * 0.9,
  bones: (r) => 0.7 + r() * 0.3,
};
export function scatterDungeonDecor(group, r, rooms, cellPos, opts = {}) {
  const { skip = [], theme = null } = opts;
  const tint = theme?.tint ?? CAVE_TINT;
  const weights = theme?.weights ?? CAVE_WEIGHTS;
  const cats = Object.keys(weights);
  const total = cats.reduce((s, c) => s + weights[c], 0);
  const rollCat = () => {
    let roll = r() * total;
    for (const c of cats) {
      roll -= weights[c];
      if (roll <= 0) return c;
    }
    return cats[cats.length - 1];
  };
  const blocked = (cx, cy) => skip.some((s) => Math.abs(s.x - cx) < 1.5 && Math.abs(s.y - cy) < 1.5);
  const destructibles = [];

  const add = (cat, wx, wz, height) => {
    const s = decorSprite(pick(r, DECOR[cat]), { height, tint });
    s.position.set(wx, 0, wz);
    group.add(s);
    const color = DECOR_BURST[cat];
    if (color != null) {
      // hit radius roughly follows the prop's footprint, clamped so tiny
      // flowers are still swingable and big dead trees aren't a huge target.
      // `cat` rides along so combat can roll the right drop (see DECOR_LOOT).
      destructibles.push({ group: s, cat, x: wx, z: wz, height, color, radius: clampR(height * 0.4) });
    }
    return s;
  };

  for (const room of rooms) {
    if (blocked(room.cx, room.cy)) continue;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      // bias toward the room's edge so props hug the walls, not the walkway
      const edgeX = r() < 0.5 ? room.x + 0.2 : room.x + room.w - 1.2;
      const edgeY = r() < 0.5 ? room.y + 0.2 : room.y + room.h - 1.2;
      const gx = r() < 0.5 ? edgeX : room.x + 0.4 + r() * (room.w - 1);
      const gy = r() < 0.5 ? room.y + 0.4 + r() * (room.h - 1) : edgeY;
      const p = cellPos(gx, gy);
      const cat = rollCat();
      add(cat, p.x, p.z, CAVE_HEIGHT[cat](r));
    }
  }
  return destructibles;
}

const clampR = (v) => Math.max(0.55, Math.min(1.0, v));
