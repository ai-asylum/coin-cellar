// Snapshot a Kenney blocky character to a transparent PNG for 2D UI use —
// e.g. the shopkeeper (left) and the haggling customer (right) flanking the
// "Capitalism, ho!" panel. A single tiny offscreen renderer is reused for all
// portraits and results are cached per variant so opening the panel is cheap.
import * as THREE from "three";
import { CHARACTERS } from "./assets.js";

let _renderer, _scene, _cam;
const _cache = new Map(); // `${variant}|${side}` -> dataURL

function ensure() {
  if (_renderer) return true;
  try {
    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _renderer.setClearColor(0x000000, 0);
  _scene = new THREE.Scene();
  _cam = new THREE.PerspectiveCamera(30, 0.62, 0.1, 100);
  const key = new THREE.DirectionalLight(0xfff2d8, 2.4);
  key.position.set(3, 4, 5);
  const fill = new THREE.DirectionalLight(0xffe0b0, 0.7);
  fill.position.set(-4, 1.5, 3);
  _scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.95));
  return true;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * Render a character bust/body to a data URL.
 * @param {string} variant  one of a…r
 * @param {"left"|"right"} side  which way they angle (they face inward)
 */
export function portraitDataURL(variant, side = "left", { w = 260, h = 420 } = {}) {
  const cacheKey = `${variant}|${side}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);
  if (!ensure()) return null;
  const src = CHARACTERS[variant] || CHARACTERS.a;
  if (!src) return null;

  const model = src.scene.clone(true);
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getSize(_size);
  _box.getCenter(_center);
  const H = Math.max(0.001, _size.y);
  // feet on y=0, centred on x/z
  model.position.x -= _center.x;
  model.position.z -= _center.z;
  model.position.y -= _box.min.y;
  // angle slightly so they face inward toward the panel (3/4 view)
  model.rotation.y = (side === "left" ? 0.22 : -0.22) - Math.PI * 0.0;
  _scene.add(model);

  _renderer.setSize(w, h, false);
  _cam.aspect = w / h;
  const dist = H * 2.35;
  _cam.position.set(0, H * 0.62, dist);
  _cam.lookAt(0, H * 0.48, 0);
  _cam.updateProjectionMatrix();
  _renderer.render(_scene, _cam);

  let url = null;
  try {
    url = _renderer.domElement.toDataURL("image/png");
  } catch {
    url = null;
  }
  _scene.remove(model);
  if (url) _cache.set(cacheKey, url);
  return url;
}
