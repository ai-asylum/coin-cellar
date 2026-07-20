import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Vec3 } from "./Vec3.js";
import { VoxelRenderer } from "./VoxelRenderer.js";
import { buildCharacterEntity } from "./buildCharacterEntity.js";
import { MotionRunner } from "./MotionRunner.js";
import { QuadrupedRig } from "./rigs/QuadrupedRig.js";
import { BipedAvianRig } from "./rigs/BipedAvianRig.js";
import { CHICKEN } from "./models/chicken.js";
import { COW } from "./models/cow.js";
import { PIG } from "./models/pig.js";
import { PIGLET } from "./models/piglet.js";
import { SHEEP } from "./models/sheep.js";

// Farm viewer — ported from spellwright's admin Character tab, scoped to the
// barnyard livestock extracted from that project (cow, chicken, pig, piglet,
// sheep) plus their procedural rigs + secondary motion. Self-contained: its
// own WebGL canvas, lights, ground disc, orbit camera, and playback timeline.
// Returns a dispose() the admin calls when leaving the tab.

const PREVIEW_ID = "farm-preview";
const TIMELINE_DURATION = 3.0; // seconds; loop length for the playhead

// bodyPlan -> rig. Cow/pig/piglet/sheep are quadrupeds; the chicken is a
// two-legged avian.
const RIGS = {
  quadruped: QuadrupedRig,
  bipedAvian: BipedAvianRig,
};

const FARM_ANIMALS = [CHICKEN, COW, PIG, PIGLET, SHEEP];

// Each "animation" is a parameter pack every rig understands: `vel` drives the
// gait + speed-derived behavior; `grounded` toggles the airborne pose on rigs
// that read it (and the wing-flap state machine in MotionRunner).
const ANIMATIONS = [
  { id: "idle", label: "Idle", vel: [0, 0, 0], grounded: true },
  { id: "walk", label: "Walk", vel: [0, 0, 1.5], grounded: true },
  { id: "run", label: "Run", vel: [0, 0, 4.0], grounded: true },
  { id: "jump", label: "Jump", vel: [0, 4.0, 0], grounded: false },
  { id: "fall", label: "Fall", vel: [0, -4.0, 0], grounded: false },
];

function makeRig(entity, entityRenderer, def) {
  const RigCtor = RIGS[def.bodyPlan];
  if (!RigCtor) {
    console.warn(`[farm-viewer] no rig for bodyPlan="${def.bodyPlan}"`);
    return { update() {}, attach() {} };
  }
  return new RigCtor({ entity, entityRenderer });
}

function formatTime(t) {
  const total = Math.min(Math.max(0, t), 99 * 60);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 100);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

/**
 * Mount the farm-animal preview into `container` (three panes + timeline).
 * Returns a dispose function; call it when leaving the tab so WebGL and
 * listeners are torn down.
 */
export function mountFarmViewer(container) {
  if (!container) return () => {};
  container.classList.add("farm-viewer");

  // ----- DOM scaffolding (3-column grid + transport row) -----
  const animPanel = document.createElement("div");
  animPanel.className = "farm-list";
  const animTitle = document.createElement("div");
  animTitle.className = "farm-list-title";
  animTitle.textContent = "Animations";
  animPanel.appendChild(animTitle);

  const stage = document.createElement("div");
  stage.className = "farm-stage";

  const rosterPanel = document.createElement("div");
  rosterPanel.className = "farm-roster";
  const rosterTitle = document.createElement("div");
  rosterTitle.className = "farm-list-title";
  rosterTitle.textContent = "Livestock";
  rosterPanel.appendChild(rosterTitle);

  const transport = document.createElement("div");
  transport.className = "farm-transport";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "farm-play";
  playBtn.title = "Play / Pause (Space)";
  playBtn.textContent = "\u25B6";

  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.className = "farm-scrubber";
  scrubber.min = "0";
  scrubber.max = String(TIMELINE_DURATION);
  scrubber.step = "0.01";
  scrubber.value = "0";

  const timeLabel = document.createElement("span");
  timeLabel.className = "farm-time";

  transport.append(playBtn, scrubber, timeLabel);
  container.append(animPanel, stage, rosterPanel, transport);

  // ----- 3D setup -----
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2033, 1.0));
  const sun = new THREE.DirectionalLight(0xffe8c2, 2.1);
  sun.position.set(4, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xbfd7ff, 0.5);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
  camera.position.set(3.0, 1.6, 2.8);

  const canvas = document.createElement("canvas");
  canvas.className = "farm-canvas";
  stage.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.7, 0);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 18;

  const entityRenderer = new VoxelRenderer(scene);

  // ----- entity + rig state (mutable so the roster can hot-swap) -----
  let currentDef = FARM_ANIMALS[0];
  let activeOutfitIds = new Set((currentDef.defaultOutfits ?? []).map((o) => o.id));
  let entity = buildEntityFor(currentDef);
  let rig = makeRig(entity, entityRenderer, currentDef);
  const runner = new MotionRunner();
  bakeInitialPose();

  function getActiveOutfits(def) {
    return (def.defaultOutfits ?? []).filter((o) => activeOutfitIds.has(o.id));
  }

  function buildEntityFor(def) {
    return buildCharacterEntity(def, {
      id: PREVIEW_ID,
      pos: new Vec3(0, 0, 0),
      outfits: getActiveOutfits(def),
    });
  }

  // Build the mesh and wrap the MotionRunner's pivots against the rest pose.
  // The rig attaches lazily on its first update() (matching how it wraps its
  // slot pivots), so we only wire the runner here.
  function bakeInitialPose() {
    entityRenderer.update([entity], 0);
    const root = entityRenderer.getMesh(PREVIEW_ID);
    runner.detach();
    if (root) runner.attach(root, entity);
  }

  function rebuildEntity() {
    entityRenderer.invalidate(PREVIEW_ID);
    entity = buildEntityFor(currentDef);
    rig = makeRig(entity, entityRenderer, currentDef);
    bakeInitialPose();
    applyAnimationParams();
  }

  // ----- Animation list (left panel) -----
  const animButtons = new Map();
  for (const anim of ANIMATIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "farm-item";
    btn.dataset.id = anim.id;
    btn.textContent = anim.label;
    btn.addEventListener("click", () => selectAnimation(anim.id));
    animPanel.appendChild(btn);
    animButtons.set(anim.id, btn);
  }

  // ----- Livestock roster (right panel) -----
  const characterButtons = new Map();
  for (const def of FARM_ANIMALS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "farm-item";
    btn.dataset.id = def.id;
    btn.textContent = def.label ?? def.id;
    btn.addEventListener("click", () => loadCharacter(def.id));
    rosterPanel.appendChild(btn);
    characterButtons.set(def.id, btn);
  }
  function refreshCharacterButtons() {
    for (const [id, btn] of characterButtons) {
      btn.classList.toggle("active", id === currentDef.id);
    }
  }
  refreshCharacterButtons();

  // ----- Addon checkboxes (right panel, below roster) -----
  // One checkbox per outfit in currentDef.defaultOutfits (the sheep's wool is
  // the only farm addon today). Hidden when the active animal has none.
  const addonsHeading = document.createElement("div");
  addonsHeading.className = "farm-list-title farm-addons-heading";
  addonsHeading.textContent = "Addons";
  rosterPanel.appendChild(addonsHeading);

  const addonsList = document.createElement("div");
  addonsList.className = "farm-addons-list";
  rosterPanel.appendChild(addonsList);

  function refreshAddonList() {
    addonsList.replaceChildren();
    const outfits = currentDef.defaultOutfits ?? [];
    const hasAny = outfits.length > 0;
    addonsHeading.style.display = hasAny ? "" : "none";
    addonsList.style.display = hasAny ? "" : "none";
    for (const outfit of outfits) {
      const row = document.createElement("label");
      row.className = "farm-addon-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = activeOutfitIds.has(outfit.id);
      cb.addEventListener("change", () => {
        if (cb.checked) activeOutfitIds.add(outfit.id);
        else activeOutfitIds.delete(outfit.id);
        rebuildEntity();
      });
      const text = document.createElement("span");
      text.textContent = outfit.label ?? outfit.id;
      row.append(cb, text);
      addonsList.appendChild(row);
    }
  }
  refreshAddonList();

  function loadCharacter(id) {
    const next = FARM_ANIMALS.find((d) => d.id === id);
    if (!next || next === currentDef) return;
    currentDef = next;
    activeOutfitIds = new Set((next.defaultOutfits ?? []).map((o) => o.id));
    rebuildEntity();
    refreshCharacterButtons();
    refreshAddonList();
  }

  // ----- Timeline state -----
  let selectedAnimId = ANIMATIONS[0].id;
  let playing = true;
  let displayTime = 0;
  let scrubbing = false;
  let resumeAfterScrub = false;

  function applyAnimationParams() {
    const anim = ANIMATIONS.find((a) => a.id === selectedAnimId) ?? ANIMATIONS[0];
    entity.vel.set(anim.vel[0], anim.vel[1], anim.vel[2]);
    entity._grounded = anim.grounded ?? true;
  }

  function selectAnimation(id) {
    if (!ANIMATIONS.some((a) => a.id === id)) return;
    selectedAnimId = id;
    for (const [animId, btn] of animButtons) {
      btn.classList.toggle("active", animId === id);
    }
    applyAnimationParams();
  }
  selectAnimation(selectedAnimId);

  function setPlaying(next) {
    playing = !!next;
    playBtn.textContent = playing ? "\u275A\u275A" : "\u25B6";
    playBtn.title = playing ? "Pause (Space)" : "Play (Space)";
  }
  setPlaying(true);

  playBtn.addEventListener("click", () => setPlaying(!playing));

  scrubber.addEventListener("pointerdown", () => {
    resumeAfterScrub = playing;
    if (playing) setPlaying(false);
    scrubbing = true;
  });
  scrubber.addEventListener("input", () => {
    displayTime = Math.max(0, Math.min(TIMELINE_DURATION, parseFloat(scrubber.value) || 0));
    timeLabel.textContent = `${formatTime(displayTime)} / ${formatTime(TIMELINE_DURATION)}`;
  });
  function endScrub() {
    if (!scrubbing) return;
    scrubbing = false;
    if (resumeAfterScrub) {
      resumeAfterScrub = false;
      setPlaying(true);
    }
  }
  scrubber.addEventListener("pointerup", endScrub);
  scrubber.addEventListener("pointercancel", endScrub);

  function onKey(e) {
    if (e.code !== "Space") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    setPlaying(!playing);
  }
  window.addEventListener("keydown", onKey);

  // ----- Frame loop -----
  const clock = new THREE.Clock();
  let raf = 0;

  function syncCanvasSize() {
    const w = Math.max(320, stage.clientWidth || 640);
    const h = Math.max(240, stage.clientHeight || 360);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(clock.getDelta(), 0.1);

    let dt = 0;
    if (playing && !scrubbing) {
      dt = realDt;
      displayTime = (displayTime + realDt) % TIMELINE_DURATION;
      scrubber.value = String(displayTime);
    }
    timeLabel.textContent = `${formatTime(displayTime)} / ${formatTime(TIMELINE_DURATION)}`;

    // Re-apply params each frame so the rig sees a stable vel, then advance
    // renderer (resets rest pose) -> rig (gait) -> runner (secondary motion).
    applyAnimationParams();
    entityRenderer.update([entity], dt);
    rig.update(dt);
    runner.update(dt);

    controls.update();
    renderer.render(scene, camera);
  }

  syncCanvasSize();
  frame();

  let ro = null;
  function onWinResize() {
    syncCanvasSize();
  }
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(stage);
  } else {
    window.addEventListener("resize", onWinResize);
  }

  return () => {
    cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    else window.removeEventListener("resize", onWinResize);
    window.removeEventListener("keydown", onKey);
    controls.dispose();
    runner.detach();
    try {
      entityRenderer.invalidate(PREVIEW_ID);
    } catch {
      /* ignore */
    }
    while (scene.children.length > 0) {
      const o = scene.children[0];
      scene.remove(o);
      o.traverse?.((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) m?.dispose?.();
        }
      });
    }
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (animPanel.parentNode) animPanel.parentNode.removeChild(animPanel);
    if (rosterPanel.parentNode) rosterPanel.parentNode.removeChild(rosterPanel);
    if (stage.parentNode) stage.parentNode.removeChild(stage);
    if (transport.parentNode) transport.parentNode.removeChild(transport);
  };
}
