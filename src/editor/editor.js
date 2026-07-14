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
};

// ---------- editor state ----------
let shop = null;
let selection = null; // { type: 'table'|'fancy'|'lot'|'part'|'decor', index, state?, partIndex? }
let selBox = null; // THREE.BoxHelper tracking the selected object
let mode = "idle"; // 'idle' | 'grab' | 'place'
let grabbed = null; // { obj, planeY, restore: {pos, rotY} } while mode === 'grab'
let armed = null; // { cat, path, height, ghost } while mode === 'place'
let paletteMode = "add"; // 'add' | 'replace' — what a palette thumb click does
let showRoof = false;
let lotView = "before"; // which lot state is visible: 'before' | 'after'
let dirty = false;
const undoStack = [];
let lastUndoKey = null;

const round2 = (v) => Math.round(v * 100) / 100;
const authFromWorld = (wx, wz) => ({ x: round2(wz), z: round2(-wx) });
const BAKED_YAW = -Math.PI / 2; // _rotateTown's quarter-turn on top-level groups

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
  return null;
}

function selectedRecord(sel = selection) {
  if (!sel) return null;
  if (sel.type === "table") return layout.tables[sel.index];
  if (sel.type === "fancy") return layout.fancy;
  if (sel.type === "lot") return layout.lots[sel.index];
  if (sel.type === "part") return layout.lots[sel.index]?.[sel.state]?.[sel.partIndex];
  if (sel.type === "decor") return layout.decor[sel.index];
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
  while (o) {
    if (o.visible === false) return null;
    if (o.userData.partIndex != null && partIndex == null) partIndex = o.userData.partIndex;
    if (o.userData.edit) return { edit: o.userData.edit, partIndex, stateGroup: prev };
    prev = o;
    o = o.parent;
  }
  return null;
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
  // clicking the already-selected lot drills down into the hit part
  if (edit.type === "lot" && partIndex != null && selection &&
      (selection.type === "lot" || selection.type === "part") && selection.index === edit.index) {
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
  rebuild();
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
    planeY: selection.type === "part" ? obj.getWorldPosition(new THREE.Vector3()).y : 0,
    restore: { pos: obj.position.clone(), rotY: obj.rotation.y },
  };
  mode = "grab";
  setStatus(`grabbing ${selLabel()} — click to drop, Esc to cancel`);
}

function updateGrab() {
  if (!grabbed) return;
  const pt = groundPointAt(grabbed.planeY);
  if (!pt) return;
  if (selection.type === "part") {
    const local = grabbed.obj.parent.worldToLocal(pt.clone());
    grabbed.obj.position.x = local.x;
    grabbed.obj.position.z = local.z;
  } else {
    grabbed.obj.position.x = pt.x;
    grabbed.obj.position.z = pt.z;
  }
}

function commitGrab() {
  const rec = selectedRecord();
  const obj = grabbed.obj;
  if (selection.type === "part") {
    rec.pos[0] = round2(obj.position.x);
    rec.pos[2] = round2(obj.position.z);
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
  }
  setStatus(`duplicated → ${selLabel()}`, "ok");
}

function deleteSelected() {
  if (!selection) { setStatus("select something to delete"); return; }
  if (selection.type === "fancy") { setStatus("the game expects the vitrine — can't delete it"); return; }
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
  setStatus(`placing ${cat} — click to plant (stays armed), Esc/RMB to stop`);
}

function updatePlacement() {
  if (!armed) return;
  const pt = groundPointAt(0);
  if (pt) armed.ghost.position.copy(pt);
}

function placeArmed() {
  const pt = groundPointAt(0);
  if (!pt || !armed) return;
  pushUndo();
  const a = authFromWorld(pt.x, pt.z);
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

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const c of children) n.append(c);
  return n;
}

function row(labelText, input) {
  return el("div", { className: "row" }, el("label", { textContent: labelText }), input);
}

function numInput(value, oncommit, step = 0.1) {
  return el("input", {
    type: "number", step: String(step), value: String(value),
    onchange(e) { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) oncommit(v); },
  });
}

// panel edits mutate the layout record then rebuild in place
function editRec(mutate) {
  pushUndo();
  mutate();
  rebuild();
}

function renderPanel() {
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
    panelEl.append(el("div", { className: "muted", textContent: "Click a shelf, house or decor sprite. Enter opens the decor palette." }));
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

    if (sel.type === "lot") {
      const kindSel = el("select", {
        onchange(e) { editRec(() => { rec.kind = e.target.value; }); },
      }, el("option", { value: "plot", textContent: "plot" }), el("option", { value: "ruin", textContent: "ruin" }));
      kindSel.value = rec.kind;
      const resSel = el("select", { onchange(e) { editRec(() => { rec.resident = Number(e.target.value); }); } },
        ...["Cheapskate", "Regular", "Wealthy", "Collector"].map((n, i) => el("option", { value: String(i), textContent: `${i} — ${n}` })));
      resSel.value = String(rec.resident);
      panelEl.append(row("kind", kindSel), row("resident", resSel));
      panelEl.append(el("div", { className: "muted", textContent: `editing the ${lotView.toUpperCase()} model — click the lot again to pick a part` }));
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

    panelEl.append(el("div", {},
      el("button", { textContent: "Duplicate (Ctrl+D)", onclick: duplicateSelected }),
      el("button", { textContent: "Delete", onclick: deleteSelected }),
    ));
  }

  panelEl.append(el("h3", { textContent: "Layout" }));
  panelEl.append(el("div", {
    className: "muted",
    textContent: `${layout.tables.length} tables + vitrine · ${layout.lots.length} lots · ${layout.decor.length} decor`,
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

// ---------- input wiring ----------
let lookActive = false;
let downAt = null;
const SENS = 0.0035;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    if (mode === "place") { cancelPlacement(); setStatus("placement cancelled"); return; }
    if (mode === "grab") { cancelGrab(); return; }
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
  }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.altKey) {
    if (selection) scaleSelected(e.deltaY < 0 ? 1.08 : 1 / 1.08);
    return;
  }
  freecam.speed = Math.max(2, Math.min(80, freecam.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  setStatus(`fly speed: ${freecam.speed.toFixed(0)}`);
}, { passive: false });

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  editorInput.keys[e.code] = true;

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
    case "KeyH": toggleRoof(); break;
    case "Delete":
    case "Backspace": deleteSelected(); break;
  }
});

window.addEventListener("keyup", (e) => { editorInput.keys[e.code] = false; });
window.addEventListener("blur", () => { editorInput.keys = Object.create(null); lookActive = false; });
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// ---------- go ----------
fetchInitialLayout().then(() => {
  rebuild(false);
  renderPanel();
  setStatus(readOnly
    ? "prod build: browsing bundled layout (saving disabled)"
    : "editing src/game/layout.json — Ctrl+S saves");
  // debug/testing handle, same spirit as the game's window.__game
  window.__editor = {
    engine,
    get shop() { return shop; },
    get layout() { return layout; },
    get selection() { return selection; },
    select: setSelection,
    save,
    rebuild,
    setLotView,
  };
}).catch((err) => {
  console.error(err);
  setStatus(`editor failed to boot: ${err.message}`, "error");
});

const clock = new THREE.Clock();
engine.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  freecam.update(dt);
  if (selBox) selBox.update();
  engine.renderer.render(engine.scene, camera);
});
