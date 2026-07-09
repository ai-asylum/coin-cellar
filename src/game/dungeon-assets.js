// KayKit "Dungeon Remastered" kit loader (glTF). Every model is UV-mapped onto
// one shared 1024² atlas (dungeon_texture.png), so a single texture paints the
// whole set. Models ship as .gltf + .bin; GLTFLoader pulls the bin + atlas in
// automatically as long as they sit beside the .gltf.
//
// The kit is authored on a 4-unit grid; the game's CELL is 2.4, so every model
// is scaled by 0.6 at load (2.4/4) so a wall/floor tile spans exactly one cell.
// A couple of models get per-model overrides (see XFORM): the wall is rotated
// 90° so its length runs N–S at rotation 0 — the orientation buildAssetWalls
// assumes — and the tall stairway is scaled down to read as a modest flight.
// Templates are preloaded once at boot and cloned synchronously while a floor
// is built (the same cache-and-clone pattern as the character GLBs).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { makeToonMaterial } from "../core/toon.js";

const BASE = "assets/dungeon/";
// logical name -> glTF file (minus extension)
const FILES = {
  wallFull: "wall",
  floorA: "floor_tile_large", floorB: "floor_tile_large_rocks",
  stair: "stairs",
  chestWood: "chest", chestIron: "chest_gold",
  barrel: "barrel_large", barrelSmall: "barrel_small",
  box: "box_large", boxSmall: "box_small",
  key: "key",
  brazier: "torch_lit", floorTorch: "torch_lit", wallTorch: "torch_mounted",
  pillar: "pillar", crates: "crates_stacked", rubble: "rubble_large",
  table: "table_medium", coins: "coin_stack_large", banner: "banner_red",
};

// kit authored on a 4u grid; CELL (dungeon-geometry) is 2.4 → 2.4/4 = 0.6
export const MODEL_SCALE = 0.6;

// per-model transform overrides folded into the template before baking/cloning.
//  - the wall model runs along +X; rotate it 90° so at rotation 0 it runs N–S
//    (buildAssetWalls places panels on that assumption)
//  - the stairway is 5 units tall; shrink it so it fits a single cell as a prop
const XFORM = {
  wallFull: { rotY: Math.PI / 2 },
  stair: { scale: 0.3 },
};

// logical name -> THREE.Group template (already scaled/rotated)
export const DUNGEON_MODELS = {};

let _loaded = false;
let _atlas = null;
// walls share one occlusion-aware material so a wall between the camera and the
// hero dithers away (fed each frame by feedOccluder in Dungeon.update)
let _wallMat = null;

export function dungeonAssetsReady() { return _loaded; }
export function dungeonPalette() { return _atlas; }
export function dungeonWallMaterial() { return _wallMat; }

/** Preload the atlas + every kit model. Call once before the first delve. */
export async function loadDungeonAssets(onProgress) {
  if (_loaded) return DUNGEON_MODELS;

  const texLoader = new THREE.TextureLoader();
  _atlas = await texLoader.loadAsync(BASE + "dungeon_texture.png");
  _atlas.colorSpace = THREE.SRGBColorSpace;
  // glTF UVs assume a top-left origin (flipY=false); the atlas is a smooth
  // gradient sheet, so linear filtering + mips (the kit's own sampler) look best
  _atlas.flipY = false;

  // one occlusion material for every wall instance (the hero never hides)
  _wallMat = makeToonMaterial({ map: _atlas, rim: 0, occlude: true });

  const loader = new GLTFLoader();
  const entries = Object.entries(FILES);
  let done = 0;
  await Promise.all(
    entries.map(async ([name, file]) => {
      const gltf = await loader.loadAsync(`${BASE}${file}.gltf`);
      const scene = gltf.scene;
      const xf = XFORM[name] || {};
      scene.scale.setScalar(xf.scale ?? MODEL_SCALE);
      if (xf.rotY) scene.rotation.y = xf.rotY;
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        if (!o.isMesh) return;
        // walls reuse the shared occluder; everything else gets a plain toon
        // material over the same atlas (props/chests/floor don't need to fade)
        o.material = name.startsWith("wall") && name !== "wallTorch"
          ? _wallMat
          : makeToonMaterial({ map: _atlas, rim: 0 });
        o.castShadow = false;
        o.receiveShadow = false;
      });
      DUNGEON_MODELS[name] = scene;
      onProgress?.(++done, entries.length);
    })
  );

  _loaded = true;
  return DUNGEON_MODELS;
}

/** A fresh, positionable clone of a template (geometry + materials shared). */
export function cloneModel(name) {
  const t = DUNGEON_MODELS[name];
  return t ? t.clone(true) : null;
}

// Bake a template's first mesh down to a single world-space geometry (its
// scale/rotation + any node offset folded in) plus its material — ready to feed
// an InstancedMesh (walls, floor tiles) so a whole floor's worth draws in one call.
export function bakedGeometry(name) {
  const t = DUNGEON_MODELS[name];
  if (!t) return null;
  t.updateMatrixWorld(true);
  let geo = null, mat = null;
  t.traverse((o) => {
    if (o.isMesh && !geo) {
      geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      mat = o.material;
    }
  });
  return geo ? { geo, mat } : null;
}
