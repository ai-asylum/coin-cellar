import * as THREE from "three";

// VoxelRenderer — a compact port of spellwright's engine/Renderer.js, scoped
// to what the voxel character rigs + MotionRunner need to animate an authored
// creature render-tree (see buildCharacterEntity / buildCreatureRender).
//
// It intentionally drops spellwright's toon/painterly materials, outline
// pass, FBX loader, procedural buildVisual path, and declarative `animate`
// specs — the farm animals use none of those. What it MUST preserve is the
// contract the rigs depend on:
//
//   1. getMesh(id) -> the root Object3D for an entity, whose descendant part
//      meshes each carry `.name = slot` (so rig.getObjectByName(slot) works)
//      and voxel primitive geometry whose `.parameters` the rigs read to
//      derive pivot anchors (width/height/depth, radius).
//   2. userData._renderBase on every built node (position/rotation/scale
//      snapshot) — the rigs re-parent parts under pivot Groups and patch this
//      base, and update() resets each descendant to its base every frame so
//      the rig + MotionRunner re-apply their deltas cleanly (no compounding).
//   3. userData._pivot / userData._wobble forwarded from the part data so
//      MotionRunner can find wobbly parts and anchor them.
//   4. userData._renderChildren so the reset walk mirrors the authored tree.

const FACETED_SPHERE_W = 4;
const FACETED_SPHERE_H = 4;

function createGeometry(r) {
  switch (r.kind) {
    case "box": {
      const s = r.size ?? { x: 1, y: 1, z: 1 };
      return new THREE.BoxGeometry(s.x ?? 1, s.y ?? 1, s.z ?? 1);
    }
    case "plane": {
      const s = r.size ?? { x: 1, y: 1 };
      return new THREE.PlaneGeometry(s.x ?? 1, s.y ?? 1);
    }
    case "sphere":
      return new THREE.SphereGeometry(r.radius ?? 0.5, FACETED_SPHERE_W, FACETED_SPHERE_H);
    case "cylinder":
      return new THREE.CylinderGeometry(r.radius ?? 0.5, r.radius ?? 0.5, r.height ?? 1, 24);
    case "cone":
      return new THREE.ConeGeometry(r.radius ?? 0.5, r.height ?? 1, 24);
    default:
      return new THREE.SphereGeometry(0.3, FACETED_SPHERE_W, FACETED_SPHERE_H);
  }
}

function renderMaterials(obj) {
  const material = obj.material;
  if (!material) return [];
  return Array.isArray(material) ? material.filter(Boolean) : [material];
}

// Snapshot a node's transform + material emissive/opacity so update() can
// reset to it each frame. Mirrors spellwright's captureRenderBase.
function captureRenderBase(obj) {
  obj.userData._renderBase = {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    materials: renderMaterials(obj).map((material) => ({
      material,
      emissiveIntensity: material.emissiveIntensity ?? 1,
      opacity: material.opacity ?? 1,
    })),
  };
}

// Recursively build a THREE object from a render-tree node. Voxel look: flat
// shaded standard material. Flat/zero-thickness boxes and planes become
// double-sided depth-biased decals (eyes, nostrils, mouths) exactly like the
// engine treats them.
function meshFromRender(r, { applyRootOffset = false } = {}) {
  let mesh;
  if (r.kind === "group") {
    mesh = new THREE.Group();
  } else {
    const geom = createGeometry(r);
    if (applyRootOffset && Array.isArray(r.offset)) {
      geom.translate(r.offset[0] ?? 0, r.offset[1] ?? 0, r.offset[2] ?? 0);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: r.color ?? 0xffffff,
      emissive: r.emissive ?? 0x000000,
      emissiveIntensity: r.emissiveIntensity ?? 1,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: true,
    });
    if (r.opacity != null && r.opacity < 1) {
      mat.transparent = true;
      mat.opacity = r.opacity;
    }
    mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = r.castShadow ?? true;
    mesh.receiveShadow = r.receiveShadow ?? false;

    const flatBox =
      r.kind === "box" &&
      r.size &&
      ((r.size.x ?? 1) === 0 || (r.size.y ?? 1) === 0 || (r.size.z ?? 1) === 0);
    if (r.kind === "plane" || flatBox) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
      mat.side = THREE.DoubleSide;
    }
  }
  if (r.name) mesh.name = r.name;
  // Forwarded so MotionRunner can find + anchor wobbly parts post-build.
  if (r.pivot != null) mesh.userData._pivot = r.pivot;
  if (r.wobble != null) mesh.userData._wobble = r.wobble;

  const renderChildren = [];
  if (Array.isArray(r.children)) {
    for (const c of r.children) {
      const child = meshFromRender(c);
      if (!child) continue;
      if (c.offset) child.position.set(c.offset[0] ?? 0, c.offset[1] ?? 0, c.offset[2] ?? 0);
      if (c.rotation) child.rotation.set(c.rotation[0] ?? 0, c.rotation[1] ?? 0, c.rotation[2] ?? 0);
      if (c.name) child.name = c.name;
      captureRenderBase(child);
      renderChildren.push(child);
      mesh.add(child);
    }
  }
  if (renderChildren.length) mesh.userData._renderChildren = renderChildren;
  captureRenderBase(mesh);
  return mesh;
}

function createMesh(entity) {
  const r = entity.render;
  if (!r) return null;
  const mesh = meshFromRender(r, { applyRootOffset: true });
  if (!mesh) return null;
  mesh.userData.entity = entity;
  return mesh;
}

// Reset a single node to its baked base transform + material state. The rigs
// and MotionRunner patch `_renderBase` after re-parenting, so this always
// snaps back to the intended rest pose for the current pivot arrangement.
function resetRenderBase(obj) {
  const base = obj.userData._renderBase;
  if (!base) return;
  obj.position.set(base.position[0], base.position[1], base.position[2]);
  obj.rotation.set(base.rotation[0], base.rotation[1], base.rotation[2]);
  obj.scale.set(base.scale[0], base.scale[1], base.scale[2]);
  for (const entry of base.materials ?? []) {
    if (!entry.material) continue;
    entry.material.emissiveIntensity = entry.emissiveIntensity;
    entry.material.opacity = entry.opacity;
  }
}

// Reset every descendant that carries a base snapshot (skips the root, whose
// transform is driven by entity.pos / yaw in updateMesh, and skips rig /
// MotionRunner pivot Groups, which have no base and own their own rotation).
function resetTree(root) {
  root.traverse((node) => {
    if (node === root) return;
    if (node.userData?._renderBase) resetRenderBase(node);
  });
}

function updateMesh(mesh, e) {
  mesh.position.set(e.pos?.x ?? 0, e.pos?.y ?? 0, e.pos?.z ?? 0);
  const rot = e.render?.rotation;
  if (Array.isArray(rot)) {
    mesh.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
  } else {
    mesh.rotation.set(0, e.yaw || 0, 0);
  }
  // Snap the authored tree back to rest each frame; the rig + MotionRunner
  // (run by the caller AFTER this) layer their deltas on top.
  if (mesh.userData._renderChildren) resetTree(mesh);
}

function disposeMesh(mesh) {
  mesh.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) m?.dispose?.();
    }
  });
}

export class VoxelRenderer {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
  }

  update(entities, _dt = 0) {
    const active = new Set();
    for (const e of entities) {
      active.add(e.id);
      let mesh = this.meshes.get(e.id);
      if (!mesh) {
        mesh = createMesh(e);
        if (!mesh) continue;
        this.scene.add(mesh);
        this.meshes.set(e.id, mesh);
      }
      updateMesh(mesh, e);
    }
    for (const [id, mesh] of this.meshes) {
      if (!active.has(id)) {
        this.scene.remove(mesh);
        disposeMesh(mesh);
        this.meshes.delete(id);
      }
    }
  }

  getMesh(id) {
    return this.meshes.get(id);
  }

  invalidate(id) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.scene.remove(mesh);
    disposeMesh(mesh);
    this.meshes.delete(id);
  }
}
