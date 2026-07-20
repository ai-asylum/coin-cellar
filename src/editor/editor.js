// Standalone overworld editor (editor.html) — modeled on spellwright's map
// editor. A free-flying camera over the real town scene (the same Shop build
// code the game runs, fed a live copy of src/game/layout.json), click-to-select
// with Blender-ish transforms, a bottom decor palette, and Ctrl+S persisting
// through the dev server's /api/layout endpoint back into layout.json.
//
// What it edits:
//   · shop display tables + the fancy vitrine — position & yaw ("the shelves")
//   · street decor billboards — position, height, art, add/remove
//   · restoration lots — position/yaw/cost/resident, and each lot's two
//     primitive-part models: the run-down "before" and renovated "after"
//     (B toggles which state is shown; click a selected lot again to drill
//     into a single part and move/rotate/scale/recolor it)
//
// The scene is shown post-quarter-turn exactly as the game frames it; edits
// are mapped back into the authored (pre-rotation) space layout.json uses:
//   authored (a1, a2) → world (−a2, a1), world yaw = −π/2 + authored yaw.
import * as THREE from "three";
import { Engine } from "../core/engine.js";
import { Shop } from "../game/shop.js";
import { setLayout } from "../game/layout-store.js";
import { DECOR, decorSprite } from "../game/decor.js";
import { loadCharacters } from "../chargen/assets.js";
import { el, row, numInput } from "./ui.js";
import { DungeonPreview } from "./dungeon-preview.js";
import { CavePreview } from "./cave-preview.js";

// ---------- boot: layout, engine, scene ----------
let readOnly = false;
let layout = null;
async function fetchInitialLayout() {
  try {
    const res = await fetch("/api/layout");
    if (!res.ok) throw new Error(`GET /api/layout -> ${res.status}`);
    layout = await res.json();
  } catch (_err) {
    // no dev endpoint (prod build) — browse the bundled layout, saving disabled
    readOnly = true;
    layout = structuredClone((await import("../game/layout.json")).default);
  }
}

const engine = new Engine(document.getElementById("app"));
const canvas = engine.renderer.domElement;
const camera = engine.camera;

// fixed bright-midday palette (mirrors shop.js SHOP_PAL) and no fog — the
// editor camera roams far past the fog band the game tunes for its close rig
engine.scene.fog = null;
engine.scene.background = new THREE.Color(0x2b2848);
engine.hemi.color.set(0xc3c2e6);
engine.hemi.groundColor.set(0x1c1630);
engine.hemi.intensity = 0.95;
engine.sun.color.set(0xffe7b4);
engine.sun.intensity = 2.1;

// the Shop only needs these slivers of the game to build itself
const stubGame = {
  engine,
  audio: { chest() {}, deny() {} },
  net: { isGuest: true },
  player: null,
  playerArea: "street",
  gameOver: false,
  editor: true, // splits the near "wall" hills into individually-pickable meshes
};

// ---------- editor state ----------
let tab = "overworld"; // 'overworld' | 'cave' | 'dungeon' — which editor mode is active
// which layer clicks grab: "contents" picks the movable objects (shelves,
// vitrine, house parts, decor, dojo dummies/master); "buildings" picks whole
// buildings (shop, cave, dojo) so you can slide the structure around as a unit.
let editScope = "contents";
let shop = null;
let selection = null; // { type: 'table'|'fancy'|'lot'|'part'|'decor'|'building'|'dojoDummy'|'dojoMaster'|'hill', index, key?, state?, partIndex? }
let selBox = null; // THREE.BoxHelper tracking the selected object
let mode = "idle"; // 'idle' | 'grab' | 'place'
let grabbed = null; // { obj, planeY, restore: {pos, rotY} } while mode === 'grab'
let armed = null; // { cat, path, height, ghost } while mode === 'place'
let paletteMode = "add"; // 'add' | 'replace' — what a palette thumb click does
let showRoof = false;
let showCamLimits = false; // draw the camera zone/bounds guides + framing gizmos
let camLimitsGroup = null; // THREE.Group holding the guide wireframes (in scene, not shop.group)
let camPreview = null; // 'shop' | 'street' while the freecam is snapped to game framing
let lotView = "before"; // which lot state is visible: 'before' | 'after'
let dirty = false;
const undoStack = [];
let lastUndoKey = null;

const round2 = (v) => Math.round(v * 100) / 100;
const authFromWorld = (wx, wz) => ({ x: round2(wz), z: round2(-wx) });
// hold Ctrl while grabbing/placing to snap to the grid (the grid is axis-
// aligned in both world and authored space, so snapping world coords holds)
const GRID = 0.5;
const snapHeld = () => !!(editorInput.keys.ControlLeft || editorInput.keys.ControlRight);
const maybeSnap = (v) => (snapHeld() ? Math.round(v / GRID) * GRID : v);
const BAKED_YAW = -Math.PI / 2; // _rotateTown's quarter-turn on top-level groups
// selections whose grab works in PARENT-LOCAL space (they live inside a
// positioned/rotated group): house parts, the dojo's dummies / master, and the
// near "wall" hills (children of the quarter-turned terrain group, so their
// local x/z read straight back as authored coords)
const isLocalSel = (sel) => sel && (sel.type === "part" || sel.type === "dojoDummy" || sel.type === "dojoMaster" || sel.type === "hill");
const isBuildingSel = (sel) => sel && sel.type === "building";

// ---------- build / rebuild the town from the live layout ----------
function disposeShop() {
  if (!shop) return;
  engine.scene.remove(shop.group);
  shop.group.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) m.dispose?.();
    // textures (decor sprites, floor canvas) stay — the sprite cache is shared
  });
  shop = null;
}

function applyViewState() {
  for (const t of shop.tables) {
    t.repaired = true; // show every fixture, even ones the player hasn't built
    shop._applyTableState(t);
  }
  shop.roof.visible = showRoof;
  for (const lot of shop.lots) {
    lot.before.visible = lotView === "before";
    lot.after.visible = lotView === "after";
  }
}

function tagEditables() {
  shop.tables.forEach((t, i) => {
    t.group.userData.edit = i < layout.tables.length
      ? { type: "table", index: i }
      : { type: "fancy", index: 0 };
  });
  shop.lots.forEach((lot, i) => { lot.group.userData.edit = { type: "lot", index: i }; });
  shop.decorSprites.forEach((s, i) => { s.userData.edit = { type: "decor", index: i }; });
  // whole buildings (grabbed in Buildings mode): the shop shell + interior, the
  // cave mouth, and the dojo — each a group the game builds from layout.json's
  // `buildings` block
  if (shop.shopGroup) shop.shopGroup.userData.edit = { type: "building", key: "shop" };
  if (shop._caveMouthGroup) shop._caveMouthGroup.userData.edit = { type: "building", key: "cave" };
  if (shop._dojoGroup) shop._dojoGroup.userData.edit = { type: "building", key: "dojo" };
  // the dojo's contents (grabbed in Contents mode): the training dummies and
  // the resident master, authored in dojo-local coords
  if (shop.dojo) {
    shop.dojo.dummies.forEach((d, i) => { d.group.userData.edit = { type: "dojoDummy", index: i }; });
    if (shop.dojo.master?.creature) shop.dojo.master.creature.userData.edit = { type: "dojoMaster" };
  }
  // the near "wall" hills — the ridge behind the buildings + the cave hillside
  // (the horizon ring belt stays merged/procedural and isn't pickable)
  (shop._hillMeshes || []).forEach((m, i) => { m.userData.edit = { type: "hill", index: i }; });
}

// Seed layout.hills from the near hills the terrain just built (procedural or
// already-authored) so the first edit has a record to mutate — mirrors
// ensureBuildings. Colours are serialised to the "#rrggbb" strings the panel's
// colour input and the lot parts use.
function ensureHills() {
  if (!Array.isArray(layout.hills) || !layout.hills.length) {
    layout.hills = (shop?._hillDescs || []).map((h) => ({
      x: round2(h.x), z: round2(h.z),
      radius: round2(h.radius), sink: round2(h.sink),
      color: "#" + ((h.color >>> 0) & 0xffffff).toString(16).padStart(6, "0"),
    }));
  }
  return layout.hills;
}

// Seed layout.buildings from the code defaults so the first edit has a record
// to mutate (matches the shape shop-build / dojo read back).
function ensureBuildings() {
  const b = layout.buildings || (layout.buildings = {});
  if (!b.shop) b.shop = { x: 0, z: 0 };
  if (!b.cave) b.cave = { x: 3, z: -18 };
  if (!b.dojo) b.dojo = { x: 2, z: -33 };
  if (!b.dojo.dummies) b.dojo.dummies = [{ x: -2.6, z: 0.4 }, { x: 0, z: 0.4 }, { x: 2.6, z: 0.4 }];
  if (!b.dojo.master) b.dojo.master = { x: -2.2, z: -2.5 };
  return b;
}

function selectionValid(sel) {
  if (!sel) return false;
  if (sel.type === "table") return sel.index < layout.tables.length;
  if (sel.type === "fancy") return true;
  if (sel.type === "lot") return sel.index < layout.lots.length;
  if (sel.type === "part") {
    const lot = layout.lots[sel.index];
    return !!lot && sel.state === lotView && sel.partIndex < lot[sel.state].length;
  }
  if (sel.type === "decor") return sel.index < layout.decor.length;
  if (sel.type === "building") return sel.key === "shop" || sel.key === "cave" || sel.key === "dojo";
  if (sel.type === "dojoDummy") return sel.index < (layout.buildings?.dojo?.dummies?.length ?? 0);
  if (sel.type === "dojoMaster") return true;
  if (sel.type === "hill") return !!shop && sel.index < (shop._hillMeshes?.length ?? 0);
  return false;
}

function rebuild(keepSelection = true) {
  const prev = keepSelection ? selection : null;
  cancelGrab(false);
  disposeShop();
  setLayout(layout);
  shop = new Shop(stubGame);
  applyViewState();
  tagEditables();
  selection = selectionValid(prev) ? prev : null;
  refreshSelBox();
  rebuildCamLimits();
  renderPanel();
}

// ---------- selection plumbing ----------
function selectedObject(sel = selection) {
  if (!sel || !shop) return null;
  if (sel.type === "table") return shop.tables[sel.index]?.group ?? null;
  if (sel.type === "fancy") return shop.tables[layout.tables.length]?.group ?? null;
  if (sel.type === "lot") return shop.lots[sel.index]?.group ?? null;
  if (sel.type === "part") return shop.lots[sel.index]?.[sel.state]?.children[sel.partIndex] ?? null;
  if (sel.type === "decor") return shop.decorSprites[sel.index] ?? null;
  if (sel.type === "building") {
    return (sel.key === "shop" ? shop.shopGroup : sel.key === "dojo" ? shop._dojoGroup : shop._caveMouthGroup) ?? null;
  }
  if (sel.type === "dojoDummy") return shop.dojo?.dummies[sel.index]?.group ?? null;
  if (sel.type === "dojoMaster") return shop.dojo?.master?.creature ?? null;
  if (sel.type === "hill") return shop._hillMeshes?.[sel.index] ?? null;
  return null;
}

function selectedRecord(sel = selection) {
  if (!sel) return null;
  if (sel.type === "table") return layout.tables[sel.index];
  if (sel.type === "fancy") return layout.fancy;
  if (sel.type === "lot") return layout.lots[sel.index];
  if (sel.type === "part") return layout.lots[sel.index]?.[sel.state]?.[sel.partIndex];
  if (sel.type === "decor") return layout.decor[sel.index];
  if (sel.type === "building") return ensureBuildings()[sel.key];
  if (sel.type === "dojoDummy") return ensureBuildings().dojo.dummies[sel.index];
  if (sel.type === "dojoMaster") return ensureBuildings().dojo.master;
  if (sel.type === "hill") return ensureHills()[sel.index];
  return null;
}

function selLabel(sel = selection) {
  if (!sel) return "";
  if (sel.type === "table") return `table ${sel.index + 1}${sel.index === 0 ? " (starter shelf)" : ""}`;
  if (sel.type === "fancy") return "fancy vitrine";
  if (sel.type === "lot") return `lot ${sel.index + 1} (${layout.lots[sel.index]?.kind})`;
  if (sel.type === "part") {
    const p = selectedRecord(sel);
    return `lot ${sel.index + 1} · ${sel.state} part ${sel.partIndex + 1} (${p?.shape})`;
  }
  if (sel.type === "decor") return `decor ${sel.index + 1} (${layout.decor[sel.index]?.cat})`;
  if (sel.type === "building") return sel.key === "shop" ? "shop building" : sel.key === "dojo" ? "dojo building" : "cave mouth";
  if (sel.type === "dojoDummy") return `dojo dummy ${sel.index + 1}`;
  if (sel.type === "dojoMaster") return "dojo master";
  if (sel.type === "hill") return `wall hill ${sel.index + 1}`;
  return "";
}

function setSelection(sel) {
  selection = sel;
  lastUndoKey = null;
  refreshSelBox();
  renderPanel();
  if (sel) setStatus(`selected: ${selLabel()}`);
}

function refreshSelBox() {
  if (selBox) {
    engine.scene.remove(selBox);
    selBox.geometry?.dispose();
    selBox.material?.dispose();
    selBox = null;
  }
  const obj = selectedObject();
  if (!obj) return;
  selBox = new THREE.BoxHelper(obj, selection.type === "part" ? 0x8ae6ff : 0xffcf86);
  engine.scene.add(selBox);
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerNdc = new THREE.Vector2();

function updatePointer(e) {
  const r = canvas.getBoundingClientRect();
  pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function groundPointAt(y = 0) {
  raycaster.setFromCamera(pointerNdc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const pt = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, pt) ? pt : null;
}

// Walk a raycast hit up to the tagged editable group. Returns
// { edit, partIndex, stateGroup } or null. Hits inside a hidden subtree
// (the lot state that's toggled off) are rejected.
function resolveHit(hit) {
  let o = hit.object;
  let partIndex = null;
  let prev = null;
  const chain = []; // every tagged ancestor, nearest (deepest) first
  while (o) {
    if (o.visible === false) return null;
    if (o.userData.partIndex != null && partIndex == null) partIndex = o.userData.partIndex;
    if (o.userData.edit) chain.push({ edit: o.userData.edit, stateGroup: prev });
    prev = o;
    o = o.parent;
  }
  if (!chain.length) return null;
  if (editScope === "buildings") {
    // whole structures: the shop/cave/dojo shells AND the houses (lots), grabbed
    // as one unit regardless of which fixture/part was clicked
    const b = chain.find((c) => c.edit.type === "building" || c.edit.type === "lot");
    return b ? { edit: b.edit, partIndex: null, stateGroup: null } : null;
  }
  // contents: the nearest non-building fixture (skip the building shells). A lot
  // hit keeps its partIndex so handleSelectClick can drop straight onto the part.
  const c = chain.find((c) => c.edit.type !== "building");
  return c ? { edit: c.edit, partIndex, stateGroup: c.stateGroup } : null;
}

function pick() {
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(shop.group.children, true);
  const resolved = [];
  for (const h of hits) {
    const r = resolveHit(h);
    if (r) resolved.push({ ...r, distance: h.distance });
  }
  return resolved;
}

function handleSelectClick() {
  const picks = pick();
  if (!picks.length) { setSelection(null); return; }
  let hit = picks[0];
  // drill-down clicks on the selected lot shouldn't be stolen by overlapping
  // scenery — prefer a hit on that lot anywhere in the ray
  if (selection && (selection.type === "lot" || selection.type === "part")) {
    const own = picks.find((p) => p.edit.type === "lot" && p.edit.index === selection.index);
    if (own) hit = own;
  }
  // decor billboards raycast as their full quad, transparent corners included;
  // when solid geometry sits just behind the quad, the mesh is what was aimed at
  if (hit.edit.type === "decor") {
    const solid = picks.find((p) => p.edit.type !== "decor");
    if (solid && solid.distance - hit.distance < 4) hit = solid;
  }
  const { edit, partIndex, stateGroup } = hit;
  // In Contents mode a house drops straight onto the clicked part (the whole
  // house is a Buildings-mode thing now). Buildings mode selects the whole lot.
  if (editScope === "contents" && edit.type === "lot" && partIndex != null) {
    const lot = shop.lots[edit.index];
    const state = stateGroup === lot.before ? "before" : stateGroup === lot.after ? "after" : lotView;
    setSelection({ type: "part", index: edit.index, state, partIndex });
    return;
  }
  setSelection({ ...edit });
}

// ---------- undo / save ----------
function pushUndo(key = null) {
  if (key && key === lastUndoKey) return; // coalesce a held-down / repeated op
  undoStack.push(JSON.stringify(layout));
  if (undoStack.length > 64) undoStack.shift();
  lastUndoKey = key;
  dirty = true;
}

function undo() {
  if (!undoStack.length) { setStatus("nothing to undo"); return; }
  layout = JSON.parse(undoStack.pop());
  lastUndoKey = null;
  dirty = true;
  if (tab === "cave") { setLayout(layout); cavePreview.build(); }
  else rebuild();
  setStatus("undid last change", "ok");
}

async function save() {
  if (readOnly) { setStatus("read-only build — run the dev server to save", "error"); return; }
  try {
    const res = await fetch("/api/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layout, null, 2),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `POST /api/layout -> ${res.status}`);
    }
    dirty = false;
    renderPanel();
    setStatus("saved to src/game/layout.json — reload the game tab to see it", "ok");
  } catch (err) {
    setStatus(`save failed: ${err.message}`, "error");
  }
}

async function reloadFromDisk() {
  if (dirty && !window.confirm("Discard unsaved changes and reload layout.json?")) return;
  try {
    const res = await fetch("/api/layout");
    if (!res.ok) throw new Error(`GET /api/layout -> ${res.status}`);
    layout = await res.json();
    undoStack.length = 0;
    dirty = false;
    setSelection(null);
    rebuild(false);
    setStatus("reloaded layout.json", "ok");
  } catch (err) {
    setStatus(`reload failed: ${err.message}`, "error");
  }
}

// ---------- transforms ----------
function beginGrab() {
  const obj = selectedObject();
  if (!obj) { setStatus("select something first, then G to grab"); return; }
  cancelPlacement();
  pushUndo();
  grabbed = {
    obj,
    planeY: isLocalSel(selection) ? obj.getWorldPosition(new THREE.Vector3()).y : 0,
    restore: { pos: obj.position.clone(), rotY: obj.rotation.y },
  };
  mode = "grab";
  setStatus(`grabbing ${selLabel()} — click to drop, hold Ctrl to snap to grid, Esc to cancel`);
}

function updateGrab() {
  if (!grabbed) return;
  const pt = groundPointAt(grabbed.planeY);
  if (!pt) return;
  if (isLocalSel(selection)) {
    const local = grabbed.obj.parent.worldToLocal(pt.clone());
    grabbed.obj.position.x = maybeSnap(local.x);
    grabbed.obj.position.z = maybeSnap(local.z);
  } else {
    grabbed.obj.position.x = maybeSnap(pt.x);
    grabbed.obj.position.z = maybeSnap(pt.z);
  }
}

function commitGrab() {
  const rec = selectedRecord();
  const obj = grabbed.obj;
  if (selection.type === "part") {
    rec.pos[0] = round2(obj.position.x);
    rec.pos[2] = round2(obj.position.z);
  } else if (selection.type === "dojoDummy" || selection.type === "dojoMaster" || selection.type === "hill") {
    // dojo pieces sit in dojo-local coords; near hills sit in the quarter-turned
    // terrain group — either way the local x/z read straight back as authored
    rec.x = round2(obj.position.x);
    rec.z = round2(obj.position.z);
  } else {
    const a = authFromWorld(obj.position.x, obj.position.z);
    rec.x = a.x;
    rec.z = a.z;
  }
  grabbed = null;
  mode = "idle";
  refreshSelBox();
  renderPanel();
  setStatus(`moved ${selLabel()}`, "ok");
}

function cancelGrab(report = true) {
  if (!grabbed) return;
  grabbed.obj.position.copy(grabbed.restore.pos);
  grabbed.obj.rotation.y = grabbed.restore.rotY;
  grabbed = null;
  mode = "idle";
  // the aborted grab pushed an undo snapshot; drop it so Ctrl+Z stays honest
  undoStack.pop();
  lastUndoKey = null;
  if (report) setStatus("grab cancelled");
}

function rotateSelected(delta) {
  const rec = selectedRecord();
  const obj = selectedObject();
  if (!rec || !obj) { setStatus("select something to rotate"); return; }
  if (selection.type === "decor") { setStatus("billboards always face the camera — no yaw"); return; }
  if (selection.type === "building") { setStatus("buildings keep their built orientation — position only"); return; }
  if (selection.type === "dojoDummy" || selection.type === "dojoMaster") { setStatus("dojo pieces are position-only"); return; }
  if (selection.type === "hill") { setStatus("hills are round — no yaw (use [ ] to resize)"); return; }
  pushUndo(`rot:${JSON.stringify(selection)}`);
  rec.yaw = round2((rec.yaw || 0) + delta);
  obj.rotation.y = selection.type === "part" ? rec.yaw : BAKED_YAW + rec.yaw;
  refreshSelBox();
  renderPanel();
  setStatus(`${selLabel()} yaw: ${Math.round((rec.yaw * 180) / Math.PI)}°`);
}

function scaleSelected(factor) {
  const rec = selectedRecord();
  const obj = selectedObject();
  if (!rec || !obj) { setStatus("select something to scale"); return; }
  if (selection.type === "building") { setStatus("buildings keep their built size"); return; }
  if (selection.type === "dojoDummy" || selection.type === "dojoMaster") { setStatus("dojo pieces keep their built size"); return; }
  const key = `scale:${JSON.stringify(selection)}`;
  if (selection.type === "decor") {
    pushUndo(key);
    rec.height = round2(rec.height * factor);
    obj.scale.multiplyScalar(factor);
    refreshSelBox();
    renderPanel();
    setStatus(`decor height: ${rec.height}`);
    return;
  }
  if (selection.type === "part") {
    pushUndo(key);
    const n = rec.shape === "box" ? 3 : 2; // cone's 3rd entry is segments, ground has none
    for (let i = 0; i < n; i++) rec.size[i] = round2(rec.size[i] * factor);
    obj.scale.multiplyScalar(factor);
    refreshSelBox();
    renderPanel();
    setStatus(`part size: [${rec.size.join(", ")}]`);
    return;
  }
  if (selection.type === "hill") {
    // radius drives the buried centre height too, so rebuild to reseat it
    pushUndo(key);
    rec.radius = round2((rec.radius ?? 6) * factor);
    rebuild();
    setStatus(`hill radius: ${rec.radius}`);
    return;
  }
  setStatus("fixtures don't scale — tables, vitrine and lots keep game size");
}

function nudgeSelectedY(delta) {
  if (selection?.type !== "part") { setStatus("Q/E only lifts house parts"); return; }
  const rec = selectedRecord();
  const obj = selectedObject();
  pushUndo(`lift:${JSON.stringify(selection)}`);
  rec.pos[1] = round2(rec.pos[1] + delta);
  obj.position.y = rec.pos[1];
  refreshSelBox();
  renderPanel();
  setStatus(`part y: ${rec.pos[1]}`);
}

function duplicateSelected() {
  if (!selection) { setStatus("select something to duplicate"); return; }
  if (selection.type === "fancy") { setStatus("the game expects a single vitrine"); return; }
  if (selection.type === "building") { setStatus("buildings are one-of-a-kind"); return; }
  if (selection.type === "dojoDummy" || selection.type === "dojoMaster") { setStatus("dojo pieces can't be duplicated (yet)"); return; }
  pushUndo();
  if (selection.type === "table") {
    const rec = layout.tables[selection.index];
    layout.tables.push({ ...rec, x: round2(rec.x + 1), z: round2(rec.z + 1) });
    rebuild();
    setSelection({ type: "table", index: layout.tables.length - 1 });
  } else if (selection.type === "lot") {
    const rec = structuredClone(layout.lots[selection.index]);
    rec.x = round2(rec.x + 2.5);
    layout.lots.push(rec);
    rebuild();
    setSelection({ type: "lot", index: layout.lots.length - 1 });
  } else if (selection.type === "part") {
    const parts = layout.lots[selection.index][selection.state];
    const rec = structuredClone(parts[selection.partIndex]);
    rec.pos[0] = round2(rec.pos[0] + 0.5);
    parts.push(rec);
    rebuild();
    setSelection({ type: "part", index: selection.index, state: selection.state, partIndex: parts.length - 1 });
  } else if (selection.type === "decor") {
    const rec = layout.decor[selection.index];
    layout.decor.push({ ...rec, x: round2(rec.x + 0.8), z: round2(rec.z + 0.8) });
    rebuild();
    setSelection({ type: "decor", index: layout.decor.length - 1 });
  } else if (selection.type === "hill") {
    const list = ensureHills();
    const rec = list[selection.index];
    list.push({ ...rec, x: round2(rec.x + 3), z: round2(rec.z + 3) });
    rebuild();
    setSelection({ type: "hill", index: list.length - 1 });
  }
  setStatus(`duplicated → ${selLabel()}`, "ok");
}

function deleteSelected() {
  if (!selection) { setStatus("select something to delete"); return; }
  if (selection.type === "fancy") { setStatus("the game expects the vitrine — can't delete it"); return; }
  if (selection.type === "building") { setStatus("the game needs its buildings — can't delete"); return; }
  if (selection.type === "dojoDummy" || selection.type === "dojoMaster") { setStatus("dojo pieces can't be deleted (yet)"); return; }
  if (selection.type === "table" && layout.tables.length <= 1) {
    setStatus("the game needs at least one table (the starter shelf)");
    return;
  }
  const label = selLabel();
  pushUndo();
  if (selection.type === "table") layout.tables.splice(selection.index, 1);
  else if (selection.type === "lot") layout.lots.splice(selection.index, 1);
  else if (selection.type === "part") layout.lots[selection.index][selection.state].splice(selection.partIndex, 1);
  else if (selection.type === "decor") layout.decor.splice(selection.index, 1);
  else if (selection.type === "hill") ensureHills().splice(selection.index, 1);
  const wasPart = selection.type === "part" ? { type: "lot", index: selection.index } : null;
  selection = null;
  rebuild();
  if (wasPart) setSelection(wasPart);
  setStatus(`deleted ${label}`, "ok");
}

function addLotPart(shape) {
  if (selection?.type !== "lot" && selection?.type !== "part") return;
  const index = selection.index;
  pushUndo();
  const parts = layout.lots[index][lotView];
  parts.push(shape === "cone"
    ? { shape: "cone", size: [1, 1.2, 8], pos: [0, 2, 0], yaw: 0, color: "#9a4a3a" }
    : { shape: "box", size: [1, 1, 1], pos: [0, 0.5, 0], yaw: 0, color: "#8a7a66" });
  rebuild();
  setSelection({ type: "part", index, state: lotView, partIndex: parts.length - 1 });
  setStatus(`added ${shape} to lot ${index + 1} (${lotView})`, "ok");
}

// ---------- view toggles ----------
function setLotView(state) {
  lotView = state;
  if (selection?.type === "part" && selection.state !== state) {
    selection = { type: "lot", index: selection.index };
  }
  for (const lot of shop.lots) {
    lot.before.visible = state === "before";
    lot.after.visible = state === "after";
  }
  refreshSelBox();
  renderPanel();
  setStatus(`houses: showing ${state === "before" ? "BEFORE (ruins/plots)" : "AFTER (renovated)"}`);
}

function toggleRoof() {
  showRoof = !showRoof;
  shop.roof.visible = showRoof;
  renderPanel();
}

// Flip between grabbing whole buildings and grabbing the objects inside them.
// Switching drops a now-unreachable selection so the panel/box stay honest.
function setEditScope(scope) {
  if (scope === editScope) return;
  editScope = scope;
  cancelGrab(false);
  // the building category is the shop/cave/dojo shells + whole houses (lots);
  // everything else (fixtures, parts, decor, dojo pieces) is contents
  const inBuildingCat = isBuildingSel(selection) || selection?.type === "lot";
  if (scope === "buildings" && !inBuildingCat) selection = null;
  else if (scope === "contents" && inBuildingCat) selection = null;
  refreshSelBox();
  renderPanel();
  renderHint();
  setStatus(scope === "buildings"
    ? "Buildings mode — click a building to move the whole thing"
    : "Contents mode — click fixtures, house parts, decor or dojo pieces");
}

// ---------- camera limits & framing ----------
// The shop camera never clamps its own position — it picks a focus point and
// sits at focus + offset. The "limits" are the indoor zones (camera tracks the
// player left/right within one, pinned vertically to its centre) and the street
// bounds (focus follows freely, clamped to the walkable rectangle minus a pad).
// These live in world space on the shop; here we draw them and edit them into
// layout.json's `camera` block. Guide colours: amber = room extent, blue =
// street walkable, green = where the camera focus can actually travel, and a
// little wire cone marks where the game camera sits framing each area.
const CAM_Y0 = 0.05, CAM_Y1 = 3.2;

function wireBox(minX, maxX, minZ, maxZ, y0, y1, color, opacity = 1) {
  const geo = new THREE.BoxGeometry(
    Math.max(0.02, maxX - minX), Math.max(0.02, y1 - y0), Math.max(0.02, maxZ - minZ));
  const line = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  line.position.set((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
  geo.dispose();
  return line;
}

// A wire cone at the game camera's resting spot for a focus point, aimed at it.
function camGizmo(cx, cz, offset, color) {
  const g = new THREE.Group();
  const pos = new THREE.Vector3(cx + offset.x, offset.y, cz + offset.z);
  const target = new THREE.Vector3(cx, 0.6, cz);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.1, 4),
    new THREE.MeshBasicMaterial({ color, wireframe: true }));
  cone.position.copy(pos);
  cone.lookAt(target);
  cone.rotateX(-Math.PI / 2); // ConeGeometry points +Y; aim its tip down the view
  g.add(cone);
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([pos, target]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
  g.add(line);
  return g;
}

// The shop offset scaled for the current editor aspect, matching game.js's
// fitShopCamera so the guide/preview frame the shop like the game does.
function fitShopOffset() {
  const scale = Math.max(1, shop.camShopFitAspect / Math.max(0.01, engine.camera.aspect));
  return shop.camShopOffset.clone().multiplyScalar(scale);
}

function disposeCamLimits() {
  if (!camLimitsGroup) return;
  engine.scene.remove(camLimitsGroup);
  camLimitsGroup.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  camLimitsGroup = null;
}

function rebuildCamLimits() {
  disposeCamLimits();
  if (!showCamLimits || !shop || tab !== "overworld") return;
  const g = new THREE.Group();
  const zp = shop.cameraZonePad, ep = shop.cameraEdgePad;
  // indoor zones: full room extent (amber) + the sideways focus rail at z = cz
  shop.zones.forEach((z) => {
    g.add(wireBox(z.minX, z.maxX, z.minZ, z.maxZ, CAM_Y0, CAM_Y1, 0xff9a3a, 0.85));
    const a = Math.min(z.minX + zp, z.maxX - zp), b = Math.max(z.minX + zp, z.maxX - zp);
    g.add(wireBox(a, b, z.cz - 0.05, z.cz + 0.05, 0.08, 0.14, 0x66ffcc, 0.95));
  });
  // street bounds: full walkable (blue) + the padded focus-travel rectangle
  const bd = shop.bounds;
  g.add(wireBox(bd.minX, bd.maxX, bd.minZ, bd.maxZ, CAM_Y0, CAM_Y1 * 0.5, 0x3aa0ff, 0.85));
  g.add(wireBox(bd.minX + ep, bd.maxX - ep, bd.minZ + ep, bd.maxZ - ep, 0.08, 0.14, 0x66ffcc, 0.95));
  // where the game camera rests framing the shop and a mid-street spot
  const shopZone = shop.zones[0];
  g.add(camGizmo(shopZone.cx, shopZone.cz, fitShopOffset(), 0xffcf86));
  g.add(camGizmo(0, (bd.minZ + bd.maxZ) / 2, shop.camStreetOffset, 0x9ad0ff));
  engine.scene.add(g);
  camLimitsGroup = g;
}

function toggleCamLimits() {
  showCamLimits = !showCamLimits;
  rebuildCamLimits();
  renderPanel();
  setStatus(showCamLimits
    ? "camera guides on — amber rooms · blue street · green focus rails · cones = camera spots"
    : "camera guides off");
}

// Snap the editor's freecam to the game camera pose for an area, so the framing
// (height/back/angle) reads exactly as it will in play.
function applyCamPreview(kind) {
  const bd = shop.bounds;
  const cx = kind === "shop" ? shop.zones[0].cx : 0;
  const cz = kind === "shop" ? shop.zones[0].cz : (bd.minZ + bd.maxZ) / 2;
  const offset = kind === "shop" ? fitShopOffset() : shop.camStreetOffset.clone();
  const pos = new THREE.Vector3(cx + offset.x, offset.y, cz + offset.z);
  const target = new THREE.Vector3(cx, 0.6, cz);
  freecam.pos.copy(pos);
  const d = target.clone().sub(pos).normalize();
  editorInput.cam.yaw = Math.atan2(-d.x, -d.z);
  editorInput.cam.pitch = Math.asin(Math.max(-1, Math.min(1, -d.y)));
  camPreview = kind;
}

// Seed layout.camera from the live shop values (world space) so the first edit
// has a full block to mutate — same shape shop-build._applyCameraLayout reads.
function ensureCameraLayout() {
  if (layout.camera) return layout.camera;
  // the shop's indoor zone (index 0) is authored in DEFAULT-shop space — pull
  // out any live shop offset so _applyShopOffset/_applyCameraLayout re-add it
  // exactly once (keeps the zone tracking the shop without drifting).
  const o = shop.shopOrigin ?? { x: 0, z: 0 };
  layout.camera = {
    zonePad: round2(shop.cameraZonePad),
    edgePad: round2(shop.cameraEdgePad),
    zones: shop.zones.map((z, i) => {
      const ox = i === 0 ? o.x : 0, oz = i === 0 ? o.z : 0;
      return {
        minX: round2(z.minX - ox), maxX: round2(z.maxX - ox),
        minZ: round2(z.minZ - oz), maxZ: round2(z.maxZ - oz),
        cx: round2(z.cx - ox), cz: round2(z.cz - oz),
      };
    }),
    bounds: {
      minX: round2(shop.bounds.minX), maxX: round2(shop.bounds.maxX),
      minZ: round2(shop.bounds.minZ), maxZ: round2(shop.bounds.maxZ),
    },
    shopOffset: shop.camShopOffset.toArray().map(round2),
    streetOffset: shop.camStreetOffset.toArray().map(round2),
    shopFitAspect: round2(shop.camShopFitAspect),
  };
  return layout.camera;
}

// Camera edits touch no geometry, so skip the town rebuild: mutate the block,
// re-apply it onto the live shop, then redraw guides / preview / panel.
function editCam(mut) {
  pushUndo();
  mut(ensureCameraLayout());
  shop._applyCameraLayout();
  rebuildCamLimits();
  if (camPreview) applyCamPreview(camPreview);
  renderPanel();
}

function resetCameraLayout() {
  if (!layout.camera) { setStatus("camera already at code defaults"); return; }
  pushUndo();
  delete layout.camera;
  rebuild(); // full rebuild so the shop falls back to the code-defined limits
  setStatus("camera limits & framing reset to defaults — Ctrl+S to save", "ok");
}

// ---------- decor palette ----------
const paletteEl = document.getElementById("palette");
const DECOR_HEIGHTS = {
  trees: 3.5, smallTrees: 1.5, bushes: 1.2, flowers: 0.4,
  mushrooms: 0.5, stones: 0.8, dead: 2.0, bones: 0.8,
};
let paletteTab = "trees";

function renderPalette() {
  const tabs = Object.keys(DECOR)
    .map((cat) => `<button data-cat="${cat}" class="${cat === paletteTab ? "active" : ""}">${cat}</button>`)
    .join("");
  const thumbs = DECOR[paletteTab]
    .map((path) => `<button data-path="${path}" title="${path}"><img src="${path}" alt=""></button>`)
    .join("");
  paletteEl.innerHTML = `<div class="tabs">${tabs}</div><div class="thumbs">${thumbs}</div>`;
  for (const b of paletteEl.querySelectorAll(".tabs button")) {
    b.onclick = () => { paletteTab = b.dataset.cat; renderPalette(); };
  }
  for (const b of paletteEl.querySelectorAll(".thumbs button")) {
    b.onclick = () => pickPaletteArt(paletteTab, b.dataset.path);
  }
}

function pickPaletteArt(cat, path) {
  if (paletteMode === "replace" && selection?.type === "decor") {
    pushUndo();
    const rec = layout.decor[selection.index];
    rec.cat = cat;
    rec.path = path;
    rebuild();
    setStatus("swapped decor art", "ok");
    paletteMode = "add";
    paletteEl.hidden = true;
    return;
  }
  armPlacement(cat, path);
}

function togglePalette(forceOpen = false) {
  paletteEl.hidden = forceOpen ? false : !paletteEl.hidden;
  if (!paletteEl.hidden) renderPalette();
  else if (paletteMode === "replace") paletteMode = "add";
}

function armPlacement(cat, path) {
  cancelPlacement();
  cancelGrab(false);
  const height = DECOR_HEIGHTS[cat] ?? 1;
  const ghost = decorSprite(path, { height, opacity: 0.75 });
  engine.scene.add(ghost);
  armed = { cat, path, height, ghost };
  mode = "place";
  setStatus(`placing ${cat} — click to plant (stays armed), Ctrl snaps to grid, Esc/RMB to stop`);
}

function updatePlacement() {
  if (!armed) return;
  const pt = groundPointAt(0);
  if (pt) armed.ghost.position.set(maybeSnap(pt.x), pt.y, maybeSnap(pt.z));
}

function placeArmed() {
  const pt = groundPointAt(0);
  if (!pt || !armed) return;
  pushUndo();
  const a = authFromWorld(maybeSnap(pt.x), maybeSnap(pt.z));
  layout.decor.push({ cat: armed.cat, path: armed.path, x: a.x, z: a.z, height: armed.height });
  const keep = { ...armed };
  rebuild(false);
  setSelection({ type: "decor", index: layout.decor.length - 1 });
  armPlacement(keep.cat, keep.path); // stay armed for repeat planting
}

function cancelPlacement() {
  if (!armed) return;
  engine.scene.remove(armed.ghost);
  armed = null;
  if (mode === "place") mode = "idle";
}

// ---------- panel ----------
const panelEl = document.getElementById("panel");

// panel edits mutate the layout record then rebuild in place
function editRec(mutate) {
  pushUndo();
  mutate();
  rebuild();
}

function renderPanel() {
  if (tab !== "overworld") return; // the dungeon tab owns the panel then
  panelEl.innerHTML = "";
  const h = el("h2", { textContent: "Coin Cellar — overworld" });
  if (readOnly) h.append(el("span", { className: "badge", textContent: "read-only" }));
  panelEl.append(h);

  const saveBtn = el("button", { className: "primary", textContent: dirty ? "Save*" : "Save", onclick: save });
  panelEl.append(
    el("div", {},
      saveBtn,
      el("button", { textContent: "Undo", onclick: undo }),
      el("button", { textContent: "Reload", onclick: reloadFromDisk }),
    ),
  );

  // move scope: whole buildings vs the objects inside them (M toggles)
  panelEl.append(el("h3", { textContent: "Move (M)" }));
  const cMode = el("button", { textContent: "Contents", onclick: () => setEditScope("contents") });
  const bMode = el("button", { textContent: "Buildings", onclick: () => setEditScope("buildings") });
  (editScope === "buildings" ? bMode : cMode).className = "primary";
  panelEl.append(el("div", { className: "row" }, el("label", { textContent: "grab" }), cMode, bMode));

  // view toggles
  panelEl.append(el("h3", { textContent: "View" }));
  const roofChk = el("input", { type: "checkbox", checked: showRoof, onchange: toggleRoof });
  panelEl.append(el("div", { className: "row" }, roofChk, el("label", { textContent: "shop roof", style: "flex:1" })));
  const before = el("button", { textContent: "Before", onclick: () => setLotView("before") });
  const after = el("button", { textContent: "After", onclick: () => setLotView("after") });
  (lotView === "before" ? before : after).className = "primary";
  panelEl.append(el("div", { className: "row" }, el("label", { textContent: "houses" }), before, after));

  // selection
  panelEl.append(el("h3", { textContent: "Selection" }));
  const rec = selectedRecord();
  if (!rec) {
    panelEl.append(el("div", { className: "muted", textContent: editScope === "buildings"
      ? "Buildings mode (M): click the shop, cave, dojo or a house, then G to drag the whole thing."
      : "Contents mode (M): click a shelf, house part, decor sprite, dojo dummy/master, or a wall hill. Enter opens the decor palette." }));
  } else {
    panelEl.append(el("div", { className: "muted", textContent: selLabel() }));
    const sel = selection;

    if (sel.type === "table" || sel.type === "fancy" || sel.type === "lot") {
      panelEl.append(
        row("x", numInput(rec.x, (v) => editRec(() => { rec.x = v; }))),
        row("z", numInput(rec.z, (v) => editRec(() => { rec.z = v; }))),
        row("yaw °", numInput(Math.round(((rec.yaw || 0) * 180) / Math.PI), (v) => editRec(() => { rec.yaw = round2((v * Math.PI) / 180); }), 5)),
        row("cost g", numInput(rec.cost ?? 0, (v) => editRec(() => { rec.cost = Math.round(v); }), 50)),
      );
    }

    if (sel.type === "building") {
      panelEl.append(
        row("x", numInput(rec.x, (v) => editRec(() => { rec.x = v; }))),
        row("z", numInput(rec.z, (v) => editRec(() => { rec.z = v; }))),
        el("div", { className: "muted", textContent: "press G to grab and drag the whole building around" }),
      );
    }

    if (sel.type === "dojoDummy" || sel.type === "dojoMaster") {
      panelEl.append(
        row("x", numInput(rec.x, (v) => editRec(() => { rec.x = v; }))),
        row("z", numInput(rec.z, (v) => editRec(() => { rec.z = v; }))),
        el("div", { className: "muted", textContent: "local to the dojo — press G to drag it on the mats" }),
      );
    }

    if (sel.type === "lot") {
      const kindSel = el("select", {
        onchange(e) { editRec(() => { rec.kind = e.target.value; }); },
      }, el("option", { value: "plot", textContent: "plot" }), el("option", { value: "ruin", textContent: "ruin" }));
      kindSel.value = rec.kind;
      const resSel = el("select", { onchange(e) { editRec(() => { rec.resident = Number(e.target.value); }); } },
        ...["Cheapskate", "Regular", "Wealthy", "Collector"].map((n, i) => el("option", { value: String(i), textContent: `${i} — ${n}` })));
      resSel.value = String(rec.resident);
      panelEl.append(row("kind", kindSel), row("resident", resSel));
      panelEl.append(el("div", { className: "muted", textContent: `editing the ${lotView.toUpperCase()} model — switch to Contents mode (M) to move its parts` }));
      panelEl.append(el("div", {},
        el("button", { textContent: "+ box part", onclick: () => addLotPart("box") }),
        el("button", { textContent: "+ cone part", onclick: () => addLotPart("cone") }),
      ));
    }

    if (sel.type === "part") {
      const sizeLabels = rec.shape === "box" ? ["w", "h", "d"] : rec.shape === "cone" ? ["radius", "height", "segs"] : ["w", "d"];
      sizeLabels.forEach((lab, i) => {
        panelEl.append(row(`size ${lab}`, numInput(rec.size[i], (v) => editRec(() => { rec.size[i] = lab === "segs" ? Math.max(3, Math.round(v)) : v; }))));
      });
      ["x", "y", "z"].forEach((lab, i) => {
        panelEl.append(row(`pos ${lab}`, numInput(rec.pos[i], (v) => editRec(() => { rec.pos[i] = v; }))));
      });
      panelEl.append(row("yaw °", numInput(Math.round(((rec.yaw || 0) * 180) / Math.PI), (v) => editRec(() => { rec.yaw = round2((v * Math.PI) / 180); }), 5)));
      const colorIn = el("input", { type: "color", value: rec.color, onchange(e) { editRec(() => { rec.color = e.target.value; }); } });
      panelEl.append(row("color", colorIn));
      const matSel = el("select", { onchange(e) { editRec(() => { if (e.target.value === "basic") rec.mat = "basic"; else delete rec.mat; }); } },
        el("option", { value: "toon", textContent: "toon (lit)" }),
        el("option", { value: "basic", textContent: "basic (glowing)" }));
      matSel.value = rec.mat === "basic" ? "basic" : "toon";
      panelEl.append(row("material", matSel));
    }

    if (sel.type === "decor") {
      panelEl.append(
        row("x", numInput(rec.x, (v) => editRec(() => { rec.x = v; }))),
        row("z", numInput(rec.z, (v) => editRec(() => { rec.z = v; }))),
        row("height", numInput(rec.height, (v) => editRec(() => { rec.height = v; }))),
        el("div", { className: "muted", textContent: rec.path }),
        el("div", {}, el("button", {
          textContent: "Replace art…",
          onclick() { paletteMode = "replace"; togglePalette(true); setStatus("pick replacement art in the palette"); },
        })),
      );
    }

    if (sel.type === "hill") {
      panelEl.append(
        row("x", numInput(rec.x, (v) => editRec(() => { rec.x = v; }))),
        row("z", numInput(rec.z, (v) => editRec(() => { rec.z = v; }))),
        row("radius", numInput(rec.radius ?? 6, (v) => editRec(() => { rec.radius = round2(v); }), 0.5)),
        row("sink", numInput(rec.sink ?? 0.58, (v) => editRec(() => { rec.sink = round2(v); }), 0.05)),
      );
      const colorIn = el("input", { type: "color", value: rec.color || "#40613a", onchange(e) { editRec(() => { rec.color = e.target.value; }); } });
      panelEl.append(row("color", colorIn));
      panelEl.append(el("div", { className: "muted", textContent: "wall hill — G to drag, [ ] to resize. 'sink' buries it (bigger = flatter). The horizon ring stays fixed." }));
    }

    panelEl.append(el("div", {},
      el("button", { textContent: "Duplicate (Ctrl+D)", onclick: duplicateSelected }),
      el("button", { textContent: "Delete", onclick: deleteSelected }),
    ));
  }

  // ---- camera limits & framing
  panelEl.append(el("h3", { textContent: "Camera" }));
  const camChk = el("input", { type: "checkbox", checked: showCamLimits, onchange: toggleCamLimits });
  panelEl.append(el("div", { className: "row" }, camChk, el("label", { textContent: "show limits & framing", style: "flex:1" })));
  if (showCamLimits && shop) {
    panelEl.append(el("div", { className: "muted", textContent: "amber = room extent · blue = street walkable · green = focus travel · cones = camera spots" }));

    shop.zones.forEach((z, i) => {
      // the shop zone (0) is stored in default-shop space; the panel shows the
      // live world value but writes back with the shop offset removed so the
      // saved override stays offset-free (see _applyCameraLayout).
      const o = i === 0 ? (shop.shopOrigin ?? { x: 0, z: 0 }) : { x: 0, z: 0 };
      panelEl.append(el("h4", { textContent: i === 0 ? "zone · shop" : `zone · ${i}` }));
      panelEl.append(
        row("min x", numInput(round2(z.minX), (v) => editCam((c) => { c.zones[i].minX = v - o.x; }))),
        row("max x", numInput(round2(z.maxX), (v) => editCam((c) => { c.zones[i].maxX = v - o.x; }))),
        row("min z", numInput(round2(z.minZ), (v) => editCam((c) => { c.zones[i].minZ = v - o.z; }))),
        row("max z", numInput(round2(z.maxZ), (v) => editCam((c) => { c.zones[i].maxZ = v - o.z; }))),
        row("focus cx", numInput(round2(z.cx), (v) => editCam((c) => { c.zones[i].cx = v - o.x; }))),
        row("focus cz", numInput(round2(z.cz), (v) => editCam((c) => { c.zones[i].cz = v - o.z; }))),
      );
    });

    const bd = shop.bounds;
    panelEl.append(el("h4", { textContent: "street bounds" }));
    panelEl.append(
      row("min x", numInput(round2(bd.minX), (v) => editCam((c) => { c.bounds.minX = v; }))),
      row("max x", numInput(round2(bd.maxX), (v) => editCam((c) => { c.bounds.maxX = v; }))),
      row("min z", numInput(round2(bd.minZ), (v) => editCam((c) => { c.bounds.minZ = v; }))),
      row("max z", numInput(round2(bd.maxZ), (v) => editCam((c) => { c.bounds.maxZ = v; }))),
    );

    panelEl.append(el("h4", { textContent: "focus padding" }));
    panelEl.append(
      row("zone pad", numInput(round2(shop.cameraZonePad), (v) => editCam((c) => { c.zonePad = v; }))),
      row("edge pad", numInput(round2(shop.cameraEdgePad), (v) => editCam((c) => { c.edgePad = v; }))),
    );

    panelEl.append(el("h4", { textContent: "framing (position)" }));
    const so = shop.camShopOffset, st = shop.camStreetOffset;
    panelEl.append(
      row("shop x/y/z",
        numInput(round2(so.x), (v) => editCam((c) => { c.shopOffset[0] = v; })),
        numInput(round2(so.y), (v) => editCam((c) => { c.shopOffset[1] = v; })),
        numInput(round2(so.z), (v) => editCam((c) => { c.shopOffset[2] = v; })),
      ),
      row("street x/y/z",
        numInput(round2(st.x), (v) => editCam((c) => { c.streetOffset[0] = v; })),
        numInput(round2(st.y), (v) => editCam((c) => { c.streetOffset[1] = v; })),
        numInput(round2(st.z), (v) => editCam((c) => { c.streetOffset[2] = v; })),
      ),
      row("portrait fit", numInput(round2(shop.camShopFitAspect), (v) => editCam((c) => { c.shopFitAspect = v; }), 0.05)),
    );
    panelEl.append(el("div", { className: "muted", textContent: "'portrait fit' pulls the shop cam back on narrow screens until this aspect fits." }));

    panelEl.append(el("div", {},
      el("button", { textContent: "Preview shop cam", onclick: () => { applyCamPreview("shop"); setStatus("framing preview: shop indoor camera"); } }),
      el("button", { textContent: "Preview street cam", onclick: () => { applyCamPreview("street"); setStatus("framing preview: street camera"); } }),
    ));
    panelEl.append(el("div", {}, el("button", { textContent: "Reset to defaults", onclick: resetCameraLayout })));
  }

  panelEl.append(el("h3", { textContent: "Layout" }));
  panelEl.append(el("div", {
    className: "muted",
    textContent: `${layout.tables.length} tables + vitrine · ${layout.lots.length} lots · ${layout.decor.length} decor · ${(layout.hills?.length ?? 0) || (shop?._hillMeshes?.length ?? 0)} wall hills`,
  }));
}

// ---------- status ----------
const statusEl = document.getElementById("status");
let statusTimer = null;
function setStatus(text, tone = "") {
  statusEl.textContent = text;
  statusEl.className = tone;
  if (statusTimer) clearTimeout(statusTimer);
  if (tone !== "error") statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 4000);
}

// ---------- freecam (ported from spellwright's Freecam + editor input) ----------
const editorInput = { cam: { yaw: Math.PI / 2, pitch: 0.82 }, keys: Object.create(null) };
const freecam = {
  pos: new THREE.Vector3(30, 26, 0),
  speed: 14,
  _fwd: new THREE.Vector3(),
  _right: new THREE.Vector3(),
  _move: new THREE.Vector3(),
  update(dt) {
    const { yaw, pitch } = editorInput.cam;
    const cp = Math.cos(pitch);
    this._fwd.set(-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp);
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this._move.set(0, 0, 0);
    const k = editorInput.keys;
    if (k.KeyW) this._move.add(this._fwd);
    if (k.KeyS) this._move.sub(this._fwd);
    if (k.KeyD) this._move.add(this._right);
    if (k.KeyA) this._move.sub(this._right);
    if (k.Space) this._move.y += 1;
    if (k.KeyC) this._move.y -= 1;
    if (this._move.lengthSq() > 0) {
      this._move.normalize();
      const sprint = k.ShiftLeft || k.ShiftRight;
      this.pos.addScaledVector(this._move, this.speed * (sprint ? 3 : 1) * dt);
      this.pos.y = Math.max(0.5, this.pos.y);
    }
    camera.position.copy(this.pos);
    camera.lookAt(this.pos.x + this._fwd.x, this.pos.y + this._fwd.y, this.pos.z + this._fwd.z);
  },
};

// ---------- tabs: overworld editor ⇄ cave preview ⇄ dungeon generator preview
const dungeonPreview = new DungeonPreview(engine, panelEl, setStatus);
const cavePreview = new CavePreview(engine, panelEl, setStatus, { pushUndo });
const tabButtons = {
  overworld: document.getElementById("tab-overworld"),
  cave: document.getElementById("tab-cave"),
  dungeon: document.getElementById("tab-dungeon"),
};
const camPoses = { overworld: null, cave: null, dungeon: null }; // each tab keeps its own fly pose
const hintEl = document.getElementById("hint");
const HINTS = {
  overworld: `
    <strong>Overworld editor</strong>
    <span><kbd>WASD</kbd> + <kbd>Space</kbd>/<kbd>C</kbd> fly · <kbd>Shift</kbd> sprint</span>
    <span><kbd>RMB</kbd> drag look · <kbd>Wheel</kbd> fly speed</span>
    <span><kbd>M</kbd> Contents ⇄ Buildings mode</span>
    <span><kbd>Click</kbd> select · <kbd>G</kbd> grab · click to drop</span>
    <span><kbd>Ctrl</kbd> snaps to grid</span>
    <span><kbd>R</kbd>/<kbd>Shift+R</kbd> rotate 15°</span>
    <span><kbd>[</kbd>/<kbd>]</kbd> or <kbd>Alt</kbd>+<kbd>Wheel</kbd> scale</span>
    <span><kbd>Q</kbd>/<kbd>E</kbd> lower/raise part</span>
    <span><kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Del</kbd> delete</span>
    <span><kbd>B</kbd> before/after · <kbd>H</kbd> roof</span>
    <span><kbd>Enter</kbd> decor palette</span>
    <span><kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</span>
    <span><kbd>Esc</kbd>/<kbd>RMB</kbd> cancel</span>`,
  cave: `
    <strong>Cave editor</strong>
    <span><kbd>WASD</kbd> + <kbd>Space</kbd>/<kbd>C</kbd> fly · <kbd>Shift</kbd> sprint</span>
    <span><kbd>RMB</kbd> drag look · <kbd>Wheel</kbd> fly speed</span>
    <span><kbd>Click</kbd> select rock / entrance / mouth</span>
    <span><kbd>G</kbd> grab · click to drop · <kbd>Ctrl</kbd> snaps</span>
    <span><kbd>R</kbd> rotate rock · <kbd>[</kbd>/<kbd>]</kbd> or <kbd>Alt</kbd>+<kbd>Wheel</kbd> scale</span>
    <span><kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate rock · <kbd>Del</kbd> delete</span>
    <span><kbd>F</kbd> FTUE opener · <kbd>T</kbd> trapdoor</span>
    <span><kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</span>
    <span><kbd>Esc</kbd> cancel/deselect</span>`,
  dungeon: `
    <strong>Dungeon preview</strong>
    <span><kbd>WASD</kbd> + <kbd>Space</kbd>/<kbd>C</kbd> fly · <kbd>Shift</kbd> sprint</span>
    <span><kbd>RMB</kbd> drag look · <kbd>Wheel</kbd> fly speed</span>
    <span><kbd>,</kbd>/<kbd>.</kbd> floor down/up</span>
    <span><kbd>N</kbd> reroll seed</span>
    <span><kbd>G</kbd> summon boss (boss floors)</span>
    <span><kbd>L</kbd> spawn monster lineup</span>
    <span>palette, monsters &amp; params in the panel →</span>
    <span><kbd>Ctrl</kbd>+<kbd>S</kbd> save tuning</span>`,
};
function renderHint() {
  let html = HINTS[tab];
  if (tab === "overworld") {
    const mode = editScope === "buildings" ? "BUILDINGS" : "CONTENTS";
    html = html.replace("<strong>Overworld editor</strong>", `<strong>Overworld — ${mode} mode</strong>`);
  }
  hintEl.innerHTML = html;
}

async function setTab(next) {
  if (next === tab || !shop) return;
  camPoses[tab] = { pos: freecam.pos.clone(), yaw: editorInput.cam.yaw, pitch: editorInput.cam.pitch };
  if (tab === "overworld") {
    cancelGrab(false);
    cancelPlacement();
    paletteEl.hidden = true;
    shop.group.visible = false;
    if (selBox) selBox.visible = false;
    if (camLimitsGroup) camLimitsGroup.visible = false;
  } else if (tab === "cave") {
    cavePreview.exit();
  } else {
    dungeonPreview.exit();
  }
  tab = next;
  for (const [name, b] of Object.entries(tabButtons)) b.classList.toggle("active", name === tab);
  const pose = camPoses[tab] ?? (
    tab === "dungeon" ? dungeonPreview.defaultCamPose()
      : tab === "cave" ? cavePreview.defaultCamPose()
        : null);
  if (pose) {
    freecam.pos.copy(pose.pos);
    editorInput.cam.yaw = pose.yaw;
    editorInput.cam.pitch = pose.pitch;
  }
  renderHint();
  if (tab === "dungeon") {
    await dungeonPreview.enter();
  } else if (tab === "cave") {
    await cavePreview.enter();
  } else {
    shop.group.visible = true;
    if (selBox) selBox.visible = true;
    rebuildCamLimits();
    renderPanel();
    setStatus(readOnly ? "prod build: browsing bundled layout (saving disabled)" : "editing src/game/layout.json — Ctrl+S saves");
  }
}
tabButtons.overworld.onclick = () => setTab("overworld");
tabButtons.cave.onclick = () => setTab("cave");
tabButtons.dungeon.onclick = () => setTab("dungeon");

// ---------- input wiring ----------
let lookActive = false;
let downAt = null;
const SENS = 0.0035;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    // macOS reports Ctrl+click as a right-click; while snapping mid-grab or
    // mid-place that click means "drop here", not "cancel"
    if (e.ctrlKey && mode === "grab") { commitGrab(); return; }
    if (e.ctrlKey && mode === "place") { placeArmed(); return; }
    if (mode === "place") { cancelPlacement(); setStatus("placement cancelled"); return; }
    if (mode === "grab") { cancelGrab(); return; }
    if (tab === "cave" && cavePreview.grabbing) {
      if (e.ctrlKey) cavePreview.commitGrab(); else cavePreview.cancelGrab();
      return;
    }
    camPreview = null; // dragging to look breaks the game-framing snap
    lookActive = true;
    canvas.requestPointerLock?.();
    return;
  }
  if (e.button === 0) downAt = { x: e.clientX, y: e.clientY };
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 2) {
    lookActive = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    return;
  }
  if (e.button !== 0 || !downAt || !shop) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4 || e.target !== canvas) return; // a drag or a UI click, not a pick
  if (tab === "cave") {
    updatePointer(e);
    if (cavePreview.grabbing) cavePreview.commitGrab();
    else cavePreview.selectAt(pointerNdc);
    return;
  }
  if (tab !== "overworld") return; // nothing to pick in the dungeon preview
  updatePointer(e);
  if (mode === "grab") { commitGrab(); return; }
  if (mode === "place") { placeArmed(); return; }
  handleSelectClick();
});

window.addEventListener("mousemove", (e) => {
  if (lookActive) {
    editorInput.cam.yaw -= e.movementX * SENS;
    editorInput.cam.pitch = Math.max(-1.4, Math.min(1.5, editorInput.cam.pitch + e.movementY * SENS));
    return;
  }
  if (e.target === canvas || document.pointerLockElement === canvas) {
    updatePointer(e);
    if (mode === "grab") updateGrab();
    if (mode === "place") updatePlacement();
    if (tab === "cave" && cavePreview.grabbing) cavePreview.updateGrab(pointerNdc, snapHeld());
  }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.altKey) {
    if (tab === "overworld" && selection) scaleSelected(e.deltaY < 0 ? 1.08 : 1 / 1.08);
    else if (tab === "cave") cavePreview.scaleSelected(e.deltaY < 0 ? 1.08 : 1 / 1.08);
    return;
  }
  freecam.speed = Math.max(2, Math.min(80, freecam.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  setStatus(`fly speed: ${freecam.speed.toFixed(0)}`);
}, { passive: false });

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  editorInput.keys[e.code] = true;
  // flying the freecam breaks the game-framing snap set by the Camera preview
  if (camPreview && ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyC"].includes(e.code)) camPreview = null;

  if (e.code === "ControlLeft" || e.code === "ControlRight") {
    if (mode === "grab") updateGrab();
    else if (mode === "place") updatePlacement();
  }

  // the dungeon tab has its own (much smaller) key map
  if (tab === "dungeon") {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
      e.preventDefault();
      if (readOnly) { setStatus("read-only build — run the dev server to save", "error"); return; }
      dungeonPreview.saveTuning();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    dungeonPreview.handleKey(e.code, e);
    return;
  }

  // the cave tab edits a few fixtures (rocks, entrance, mouths) into
  // layout.json's `cave` block — save & undo share the overworld plumbing
  if (tab === "cave") {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyD") { e.preventDefault(); cavePreview.duplicateSelected(); return; }
    if (e.ctrlKey || e.metaKey) return;
    cavePreview.handleKey(e.code, e);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyD") { e.preventDefault(); duplicateSelected(); return; }
  if (e.ctrlKey || e.metaKey) return;

  switch (e.code) {
    case "Enter": togglePalette(); break;
    case "Escape":
      if (mode === "place") { cancelPlacement(); setStatus("placement cancelled"); }
      else if (mode === "grab") cancelGrab();
      else if (!paletteEl.hidden) togglePalette();
      else if (selection?.type === "part") setSelection({ type: "lot", index: selection.index });
      else if (selection) setSelection(null);
      break;
    case "KeyG": beginGrab(); break;
    case "KeyR": rotateSelected(e.shiftKey ? -Math.PI / 12 : Math.PI / 12); break;
    case "BracketLeft": scaleSelected(1 / 1.1); break;
    case "BracketRight": scaleSelected(1.1); break;
    case "KeyQ": nudgeSelectedY(-0.1); break;
    case "KeyE": nudgeSelectedY(0.1); break;
    case "KeyB": setLotView(lotView === "before" ? "after" : "before"); break;
    case "KeyM": setEditScope(editScope === "buildings" ? "contents" : "buildings"); break;
    case "KeyH": toggleRoof(); break;
    case "Delete":
    case "Backspace": deleteSelected(); break;
  }
});

window.addEventListener("keyup", (e) => {
  editorInput.keys[e.code] = false;
  if (e.code === "ControlLeft" || e.code === "ControlRight") {
    if (mode === "grab") updateGrab();
    else if (mode === "place") updatePlacement();
  }
});
window.addEventListener("blur", () => { editorInput.keys = Object.create(null); lookActive = false; });
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// ---------- go ----------
// the town now includes the dojo, whose resident master is a BlockyCreature —
// the character GLBs must be preloaded before the first synchronous Shop build
Promise.all([fetchInitialLayout(), loadCharacters()]).then(() => {
  rebuild(false);
  renderPanel();
  renderHint();
  setStatus(readOnly
    ? "prod build: browsing bundled layout (saving disabled)"
    : "editing src/game/layout.json — Ctrl+S saves");
  // debug/testing handle, same spirit as the game's window.__game
  window.__editor = {
    engine,
    get shop() { return shop; },
    get layout() { return layout; },
    get selection() { return selection; },
    get tab() { return tab; },
    get dungeon() { return dungeonPreview.dungeon; },
    get cave() { return cavePreview.cave; },
    dungeonPreview,
    cavePreview,
    setTab,
    select: setSelection,
    save,
    rebuild,
    setLotView,
    setScope: setEditScope,
    get editScope() { return editScope; },
  };
}).catch((err) => {
  console.error(err);
  setStatus(`editor failed to boot: ${err.message}`, "error");
});

const clock = new THREE.Clock();
engine.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  freecam.update(dt);
  if (tab === "dungeon") dungeonPreview.update(dt, clock.elapsedTime);
  if (tab === "cave") cavePreview.update(dt, clock.elapsedTime);
  if (selBox) selBox.update();
  engine.renderer.render(engine.scene, camera);
});
