// Billboard scenery. Flat, camera-facing sprites of trees, bushes, flowers,
// mushrooms, stones and bones (Layer Lab art, see public/decor/NOTICE.md) that
// dress the street outside the shop and the rooms of the cellar below. Every
// piece is a THREE.Sprite anchored at its bottom edge so it "stands" on the
// ground and always turns to face the camera — the cheap, classic way to fill
// a 3D world with hand-painted 2D set dressing.
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

// A single billboard. `height` is the world height it stands; its width is
// derived from the image aspect (applied the moment the texture is decoded, so
// nothing is squashed). `tint` multiplies the art — handy for dimming/cooling
// props to sit in the cellar's moodier light. Returned as a Group so callers
// can position/rotate it like any other prop (rotation is a harmless no-op).
export function decorSprite(path, { height = 1, tint = null, opacity = 1 } = {}) {
  const e = getTex(path);
  const mat = new THREE.SpriteMaterial({
    map: e.tex,
    transparent: true,
    alphaTest: 0.14, // keep the soft baked ground-shadow, drop the halo
    opacity,
  });
  if (tint != null) mat.color.set(tint);
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0); // anchor the bottom edge to the group origin
  const apply = (aspect) => sprite.scale.set(height * aspect, height, 1);
  if (e.tex.image && e.tex.image.width) apply(e.aspect);
  else {
    apply(e.aspect);
    e.waiters.push(apply);
  }
  const g = new THREE.Group();
  g.add(sprite);
  g.userData.decorMat = mat;
  return g;
}

// Free the per-sprite materials under a group (textures stay cached & shared).
export function disposeDecor(group) {
  group.traverse((o) => {
    if (o.isSprite) o.material?.dispose();
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
// Dress the street glimpsed through the shopfront: a treeline banked against
// the far facade, leafy trees flanking the doorway well clear of the walking
// lanes, and bushes / flower tufts freckling the pavement by the wall. Purely
// cosmetic; added straight into the shop group, built once and never touched.
export function populateStreet(group, r, { W, backZ, streetHalfX }) {
  const add = (cat, x, z, height, tint = null) => {
    const s = decorSprite(pick(r, DECOR[cat]), { height, tint });
    s.position.set(x, 0, z);
    group.add(s);
    return s;
  };

  // street geometry (mirrors Shop._build): road runs from the pavement out to
  // the far building facade — decor must sit in front of that wall to be seen
  const roadFar = backZ - 9.5;
  const facadeFront = roadFar - 0.05; // just in front of the facade wall

  // treeline banked against the facade across the whole street width
  for (let x = -12.5; x <= 12.5; x += 1.7 + r() * 0.7) {
    add("trees", x + (r() - 0.5) * 0.6, facadeFront + 0.3 + r() * 0.8, 3.2 + r() * 1.6);
  }
  // a looser second rank a little nearer, out on the road, for depth
  for (let x = -12; x <= 12; x += 2.6 + r()) {
    if (r() < 0.5) continue;
    add(r() < 0.7 ? "trees" : "smallTrees", x + (r() - 0.5) * 1.2, roadFar + 2.4 + r() * 1.8, 2.4 + r() * 1.2);
  }

  // leafy trees flanking the shopfront, out past the pedestrian lanes so they
  // never overlap a walking customer
  for (const side of [-1, 1]) {
    add("trees", side * (streetHalfX + 1.6 + r()), backZ - 2.0 - r() * 1.4, 3.0 + r() * 1.3);
    add(r() < 0.5 ? "smallTrees" : "bushes", side * (streetHalfX + 0.4 + r() * 0.8), backZ - 4.2 - r() * 1.5, 1.4 + r());
  }

  // bushes + flower tufts hugging the base of the shopfront wall (the sliver of
  // pavement the customers never tread), skipping the doorway and window
  const doorCx = -3.0;
  for (let x = -W / 2 + 0.8; x <= W / 2 - 0.8; x += 1.1 + r() * 0.5) {
    if (Math.abs(x - doorCx) < 1.9) continue; // keep the doorstep clear
    const z = backZ - 0.55 - r() * 0.5;
    if (r() < 0.4) add("bushes", x, z, 0.8 + r() * 0.5);
    else add("flowers", x + (r() - 0.5) * 0.4, z, 0.34 + r() * 0.22);
  }
  // a few flower clusters further out on the pavement corners
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      add("flowers", side * (4.5 + r() * 3), backZ - 0.7 - r() * 1.1, 0.3 + r() * 0.2);
    }
  }
}

// Burst colour for each destructible prop, keyed by catalogue category. Stones
// are absent on purpose — rocks don't shatter into a puff, they just sit there.
export const DECOR_BURST = {
  trees: 0x5aa84f,
  smallTrees: 0x5aa84f,
  bushes: 0x5fae54,
  flowers: 0x9bd77a,
  mushrooms: 0xd98ab8,
  dead: 0x8a6a45,
  bones: 0xe8e0c8,
};

// --------------------------------------------------------- dungeon floors
// Freckle the cellar with grim set dressing: dark stones and pale mushrooms
// tucked into room corners, the odd gnarled dead tree against a wall, and a
// stray bone pile. Seeded off the floor's rng so co-op peers see the same
// layout, and dimmed to a cool tint so it sits in the cellar's moody light.
// Returns the list of destructible props (everything but the stones) so the
// dungeon can let the player smash them into a particle puff.
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
      // flowers are still swingable and big dead trees aren't a huge target
      destructibles.push({ group: s, x: wx, z: wz, height, color, radius: clampR(height * 0.4) });
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
