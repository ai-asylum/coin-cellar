// Low-poly dungeon kit loader ("Dungeon Asset Pack", FBX → GLB). One shared
// palette texture drives every model's colour: each face's UVs point at a swatch
// in Pallet.png, so a single nearest-filtered texture paints the whole set.
//
// The pack is authored on a 2-unit grid; the game's CELL is 2.4, so every model
// is scaled by 1.2 at load so a wall/floor tile spans exactly one cell. Templates
// are preloaded once at boot and cloned synchronously while a floor is built (the
// same cache-and-clone pattern as the character GLBs in chargen/assets.js).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { makeToonMaterial } from "../core/toon.js";

const BASE = "assets/dungeon/";
// logical name -> GLB file (minus extension)
const FILES = {
  wallFull: "Wall0", wallFullB: "Wall1", wallHalf: "Wall2",
  wallLow: "Wall3", wallLowHalf: "Wall4",
  floorA: "Floor0", floorB: "Floor1",
  stair: "Stair", door: "Door", doorWall: "DoorWall",
  chestWood: "ChestWood", chestIron: "ChestIron",
  barrel: "Barrel", box: "Box", key: "Key",
  brazier: "LightBrazier", floorTorch: "LightFloorTorch", wallTorch: "LightWallTorch",
  chain0: "Chain0", chain1: "Chain1", chain2: "Chain2",
};

// pack authored on a 2u grid; CELL (dungeon-geometry) is 2.4 → 2.4/2 = 1.2
export const MODEL_SCALE = 1.2;

// logical name -> THREE.Group template (already scaled by MODEL_SCALE)
export const DUNGEON_MODELS = {};

let _loaded = false;
let _palette = null;
// walls share one occlusion-aware material so a wall between the camera and the
// hero dithers away (fed each frame by feedOccluder in Dungeon.update)
let _wallMat = null;

export function dungeonAssetsReady() { return _loaded; }
export function dungeonPalette() { return _palette; }
export function dungeonWallMaterial() { return _wallMat; }

/** Preload the palette + every kit GLB. Call once before the first delve. */
export async function loadDungeonAssets(onProgress) {
  if (_loaded) return DUNGEON_MODELS;

  const texLoader = new THREE.TextureLoader();
  _palette = await texLoader.loadAsync(BASE + "palette.png");
  _palette.colorSpace = THREE.SRGBColorSpace;
  // glTF UVs assume a top-left origin (flipY=false); the palette is a swatch
  // atlas so keep it crisp — nearest, no mips, or neighbouring swatches bleed
  _palette.flipY = false;
  _palette.magFilter = THREE.NearestFilter;
  _palette.minFilter = THREE.NearestFilter;
  _palette.generateMipmaps = false;

  // one occlusion material for every wall instance (the hero never hides)
  _wallMat = makeToonMaterial({ map: _palette, rim: 0, occlude: true });

  const loader = new GLTFLoader();
  const entries = Object.entries(FILES);
  let done = 0;
  await Promise.all(
    entries.map(async ([name, file]) => {
      const gltf = await loader.loadAsync(`${BASE}${file}.glb`);
      const scene = gltf.scene;
      scene.scale.setScalar(MODEL_SCALE);
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        if (!o.isMesh) return;
        // walls reuse the shared occluder; everything else gets a plain toon
        // material over the same palette (props/chests/floor don't need to fade)
        o.material = name.startsWith("wall") && name !== "wallTorch"
          ? _wallMat
          : makeToonMaterial({ map: _palette, rim: 0 });
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
// MODEL_SCALE + any node offset folded in) plus its material — ready to feed an
// InstancedMesh (walls, floor tiles) so a whole floor's worth draws in one call.
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
