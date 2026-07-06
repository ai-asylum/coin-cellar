// Kenney "Blocky Characters" pack loader (CC0, www.kenney.nl). The 18 GLBs
// (character-a … character-r) are node-animated (no skin) and each ships its
// own texture, giving instant crowd variety. We preload every clip once and
// clone from the cache so creature construction stays synchronous.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const CHAR_VARIANTS = "abcdefghijklmnopqr".split("");

// variant -> { scene: THREE.Group (template), animations: AnimationClip[] }
export const CHARACTERS = {};

let _loaded = false;

export function charactersReady() {
  return _loaded;
}

/** Preload all character GLBs. Call once before constructing the game. */
export async function loadCharacters(onProgress) {
  if (_loaded) return CHARACTERS;
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(
    CHAR_VARIANTS.map(
      (v) =>
        new Promise((resolve, reject) => {
          loader.load(
            `characters/character-${v}.glb`,
            (gltf) => {
              const scene = gltf.scene;
              // textures are pixel-art: keep them crisp
              scene.traverse((o) => {
                if (o.isMesh && o.material && o.material.map) {
                  o.material.map.magFilter = THREE.NearestFilter;
                  o.material.map.minFilter = THREE.NearestFilter;
                  o.material.map.generateMipmaps = false;
                }
              });
              CHARACTERS[v] = { scene, animations: gltf.animations };
              onProgress?.(++done, CHAR_VARIANTS.length);
              resolve();
            },
            undefined,
            reject
          );
        })
    )
  );
  _loaded = true;
  return CHARACTERS;
}
