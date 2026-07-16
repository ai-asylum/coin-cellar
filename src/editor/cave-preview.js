// The editor's Cave tab: drives the real Cave the game runs (the village
// burrow that fronts the dungeons and stages the FTUE opener) against a stub
// game, so its layout, dressing, the four dungeon mouths and the first-run fog
// bank can be checked without launching the game.
//
// Unlike the Dungeon tab (pure tuning preview), a few of the cave's fixtures
// ARE editable here: the two flanking rocks (free move + rotate), the daylight
// exit, and the four dungeon mouths (the last two snap to whole grid cells,
// since their floor cut-outs and colliders are cell-based). Moves are written
// into layout.json's `cave` block and persisted with Ctrl+S — the same file the
// overworld editor saves — and the game's Cave reads them back at build time.
import * as THREE from "three";
import { Cave, CAVE_ORIGIN, HOLE_DEFS, localToCaveCell } from "../game/cave.js";
import { FLOORS_PER_DUNGEON } from "../game/dungeon.js";
import { getLayout } from "../game/layout-store.js";
import { loadDungeonAssets, dungeonAssetsReady } from "../game/dungeon-assets.js";
import { el, row } from "./ui.js";

const round2 = (v) => Math.round(v * 100) / 100;
const GRID = 0.5; // rock free-move snap step when Ctrl is held

export class CavePreview {
  constructor(engine, panelEl, setStatus, host = {}) {
    this.engine = engine;
    this.panelEl = panelEl;
    this.setStatus = setStatus;
    this.host = host; // { pushUndo } — shared undo/dirty plumbing with the editor
    this.cave = null;
    this.ftue = true; // show the first-run opener (fog bank + slime + lone rat)
    this.trapdoorOpen = false; // the first mouth's lid
    this._loading = false;
    // selection + grab, mirroring the overworld editor's model but scoped to
    // the cave's own handles: { type: 'rock'|'exit'|'hole', index }
    this.selection = null;
    this.selBox = null;
    this.grab = null; // { obj, restore } while dragging
    this._dragLocal = null; // last ground point under the cursor (group-local)
    this.raycaster = new THREE.Raycaster();
    // the wall-dither occlusion probe — pinned to wherever the freecam looks
    this.probe = { position: new THREE.Vector3().copy(CAVE_ORIGIN), height: 1.7, radius: 0.35 };
  }

  get grabbing() { return !!this.grab; }

  _stubGame() {
    const noop = () => {};
    return {
      engine: this.engine,
      particles: { burst: noop },
      player: this.probe,
      playerArea: "cave", // the cave's update() early-outs unless we're "in" it
      gameOver: false,
      _shortcutOpen: () => false, // no earned shortcuts in the preview
      _onCaveRatKilled: noop,
      // same AABB pushout as Game.collide — the ambient rats stay off the walls
      collide(pos, radius, colliders) {
        for (const c of colliders) {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const px = c.hw + radius - Math.abs(dx);
          const pz = c.hd + radius - Math.abs(dz);
          if (px > 0 && pz > 0) {
            if (px < pz) pos.x += dx > 0 ? px : -px;
            else pos.z += dz > 0 ? pz : -pz;
          }
        }
      },
    };
  }

  async enter() {
    if (!dungeonAssetsReady() && !this._loading) {
      this._loading = true;
      this.setStatus("loading dungeon kit…");
      try {
        await loadDungeonAssets();
      } catch (err) {
        console.error(err);
        this.setStatus("dungeon kit failed to load — previewing with fallback boxes", "error");
      }
      this._loading = false;
    }
    this.build();
  }

  // Cave has no partial teardown for the FTUE extras or the layout overrides, so
  // any change (a move, an FTUE toggle, an undo) just rebuilds the whole thing —
  // cheap enough for a one-off preview, and it re-reads layout.json's `cave`.
  build(reselect = true) {
    const keep = reselect ? this.selection : null;
    this.cancelGrab(false);
    this.cave?.dispose();
    this.cave = new Cave(this._stubGame());
    if (this.ftue) {
      this.cave.spawnSlime();
      this.cave.spawnFtueRat();
      this.cave.setFtueVeil(true);
    }
    this.cave.setTrapdoorOpen(this.trapdoorOpen, true);
    this.selection = keep;
    this._refreshSelBox();
    this.renderPanel();
  }

  exit() {
    this.cancelGrab(false);
    this._clearSelBox();
    this.cave?.dispose();
    this.cave = null;
  }

  /** Freecam pose looking down the tunnel from the daylight (south) end. */
  defaultCamPose() {
    return { pos: new THREE.Vector3(CAVE_ORIGIN.x, 20, CAVE_ORIGIN.z + 30), yaw: 0, pitch: 0.9 };
  }

  update(dt, elapsed) {
    if (!this.cave) return;
    // park the occlusion probe where the camera is looking (ground plane)
    const cam = this.engine.camera;
    cam.getWorldDirection(_dir);
    if (_dir.y < -0.05) {
      const t = -cam.position.y / _dir.y;
      this.probe.position.copy(cam.position).addScaledVector(_dir, t);
    }
    this.cave.update(dt, elapsed);
    this.selBox?.update();
  }

  // ---------------------------------------------------------------- selection
  _selectedObject(sel = this.selection) {
    if (!sel || !this.cave) return null;
    if (sel.type === "rock") return this.cave.rockObjs[sel.index] ?? null;
    if (sel.type === "exit") return this.cave.exitObj ?? null;
    if (sel.type === "hole") return this.cave.holes[sel.index]?.lid ?? null;
    return null;
  }

  _selLabel(sel = this.selection) {
    if (!sel) return "";
    if (sel.type === "rock") return `rock ${sel.index + 1}`;
    if (sel.type === "exit") return "daylight entrance";
    if (sel.type === "hole") return `mouth ${sel.index + 1} (${HOLE_DEFS[sel.index].name})${sel.index === 0 ? " · trapdoor" : ""}`;
    return "";
  }

  _clearSelBox() {
    if (!this.selBox) return;
    this.engine.scene.remove(this.selBox);
    this.selBox.geometry?.dispose();
    this.selBox.material?.dispose();
    this.selBox = null;
  }

  _refreshSelBox() {
    this._clearSelBox();
    const obj = this._selectedObject();
    if (!obj) return;
    this.selBox = new THREE.BoxHelper(obj, 0xffcf86);
    this.engine.scene.add(this.selBox);
  }

  setSelection(sel) {
    this.selection = sel;
    this._refreshSelBox();
    this.renderPanel();
    if (sel) this.setStatus(`selected: ${this._selLabel()} — G to grab${sel.type === "rock" ? ", R to rotate" : ""}`);
  }

  /** Raycast the cave's edit handles under the pointer and select the nearest. */
  selectAt(ndc) {
    if (!this.cave) return;
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hits = this.raycaster.intersectObjects(this.cave.group.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.cave.group) {
        if (o.visible === false) break;
        if (o.userData.caveEdit) { this.setSelection({ ...o.userData.caveEdit }); return; }
        o = o.parent;
      }
    }
    this.setSelection(null);
  }

  // ---------------------------------------------------------------- grab
  _groundLocal(ndc, y = 0) {
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y + CAVE_ORIGIN.y));
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, pt)) return null;
    return { x: pt.x - CAVE_ORIGIN.x, z: pt.z - CAVE_ORIGIN.z };
  }

  beginGrab() {
    const obj = this._selectedObject();
    if (!obj) { this.setStatus("select a rock, the entrance or a mouth first, then G to grab"); return; }
    this.grab = { obj, restore: obj.position.clone() };
    // rocks read their drop from where they land; the exit & mouths read it from
    // the ground point under the cursor, so leave it null until the mouse moves
    // (a click-with-no-move then leaves their cell untouched)
    this._dragLocal = this.selection.type === "rock" ? { x: obj.position.x, z: obj.position.z } : null;
    this.setStatus(`grabbing ${this._selLabel()} — click to drop${this.selection.type === "rock" ? ", Ctrl snaps" : " (snaps to grid)"}, Esc cancels`);
  }

  updateGrab(ndc, snap = false) {
    if (!this.grab) return;
    const local = this._groundLocal(ndc);
    if (!local) return;
    this._dragLocal = local;
    // rocks follow the cursor freely (Ctrl → 0.5-grid); the exit and mouths
    // track it too for feedback, but commit re-snaps them to a whole cell
    let x = local.x, z = local.z;
    if (this.selection.type === "rock" && snap) {
      x = Math.round(x / GRID) * GRID;
      z = Math.round(z / GRID) * GRID;
    }
    this.grab.obj.position.x = x;
    this.grab.obj.position.z = z;
    this.selBox?.update();
  }

  commitGrab() {
    if (!this.grab) return;
    const sel = this.selection;
    const local = this._dragLocal;
    this.host.pushUndo?.();
    if (sel.type === "rock") {
      this.cave.rockDefs[sel.index].x = round2(this.grab.obj.position.x);
      this.cave.rockDefs[sel.index].z = round2(this.grab.obj.position.z);
    } else if (local && sel.type === "exit") {
      const c = localToCaveCell(local.x, local.z);
      this.cave.exitCell = { x: c.gx, y: c.gy };
    } else if (local && sel.type === "hole") {
      const c = localToCaveCell(local.x, local.z);
      this.cave.holeCells[sel.index] = { gx: c.gx, gy: c.gy };
    }
    this._writeLayout();
    this.grab = null;
    this.build(); // rebuild so floor cut-outs, colliders & shafts follow the move
    this.setStatus(`moved ${this._selLabel(sel)} — Ctrl+S to save`, "ok");
  }

  cancelGrab(report = true) {
    if (!this.grab) return;
    this.grab.obj.position.copy(this.grab.restore);
    this.grab = null;
    this._dragLocal = null;
    this.selBox?.update();
    if (report) this.setStatus("grab cancelled");
  }

  rotateSelected(delta) {
    if (!this.selection) { this.setStatus("select a rock to rotate"); return; }
    if (this.selection.type !== "rock") { this.setStatus("only the rocks rotate — the entrance & mouths are grid-locked"); return; }
    const obj = this._selectedObject();
    if (!obj) return;
    this.host.pushUndo?.(`rot:${this.selection.index}`);
    const def = this.cave.rockDefs[this.selection.index];
    def.yaw = round2((def.yaw ?? 0) + delta);
    obj.rotation.y = def.yaw;
    this._writeLayout();
    this.selBox?.update();
    this.setStatus(`rotated ${this._selLabel()} — Ctrl+S to save`, "ok");
  }

  scaleSelected(factor) {
    if (!this.selection) { this.setStatus("select a rock to scale"); return; }
    if (this.selection.type !== "rock") { this.setStatus("only the rocks scale — the entrance & mouths are grid-locked"); return; }
    const obj = this._selectedObject();
    if (!obj) return;
    this.host.pushUndo?.(`scale:${this.selection.index}`);
    const def = this.cave.rockDefs[this.selection.index];
    const next = Math.max(0.2, Math.min(6, (def.s ?? 1) * factor));
    obj.scale.multiplyScalar(next / (def.s ?? 1));
    def.s = round2(next);
    this._writeLayout();
    this.selBox?.update();
    this.renderPanel();
    this.setStatus(`scaled ${this._selLabel()} ×${def.s} — Ctrl+S to save`, "ok");
  }

  duplicateSelected() {
    if (this.selection?.type !== "rock") { this.setStatus("only the rocks duplicate — there's one entrance and four fixed mouths"); return; }
    this.host.pushUndo?.();
    const src = this.cave.rockDefs[this.selection.index];
    this.cave.rockDefs.push({ x: round2(src.x + 1), z: round2(src.z + 1), yaw: src.yaw ?? 0, s: src.s ?? 1 });
    this._writeLayout();
    this.build();
    this.setSelection({ type: "rock", index: this.cave.rockObjs.length - 1 });
    this.setStatus(`duplicated rock — ${this.cave.rockObjs.length} rocks — Ctrl+S to save`, "ok");
  }

  deleteSelected() {
    if (this.selection?.type !== "rock") { this.setStatus("only the rocks delete — the entrance & mouths are permanent"); return; }
    this.host.pushUndo?.();
    this.cave.rockDefs.splice(this.selection.index, 1);
    this.selection = null;
    this._writeLayout();
    this.build();
    this.setStatus(`deleted rock — ${this.cave.rockObjs.length} left — Ctrl+S to save`, "ok");
  }

  _writeLayout() {
    const l = getLayout();
    l.cave = {
      exit: { gx: this.cave.exitCell.x, gy: this.cave.exitCell.y },
      holes: this.cave.holeCells.map((c) => ({ gx: c.gx, gy: c.gy })),
      rocks: this.cave.rockDefs.map((r) => ({ x: round2(r.x), z: round2(r.z), yaw: round2(r.yaw ?? 0), s: round2(r.s ?? 1) })),
    };
  }

  handleKey(code) {
    switch (code) {
      case "KeyF": this.ftue = !this.ftue; this.build(); return true;
      case "KeyT":
        this.trapdoorOpen = !this.trapdoorOpen;
        this.cave?.setTrapdoorOpen(this.trapdoorOpen, true);
        this.renderPanel();
        return true;
      case "KeyG": this.beginGrab(); return true;
      case "KeyR": this.rotateSelected(0.2618); return true; // 15°
      case "BracketLeft": this.scaleSelected(1 / 1.1); return true;
      case "BracketRight": this.scaleSelected(1.1); return true;
      case "Delete":
      case "Backspace": this.deleteSelected(); return true;
      case "Escape":
        if (this.grab) this.cancelGrab();
        else if (this.selection) this.setSelection(null);
        return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- panel
  renderPanel() {
    const p = this.panelEl;
    p.innerHTML = "";
    const h = el("h2", { textContent: "Coin Cellar — cave" });
    h.append(el("span", { className: "badge", textContent: "preview + edit" }));
    p.append(h);
    p.append(el("div", { className: "muted", textContent: "The village cave — the dungeons' front door and lobby, plus the first-run FTUE opener." }));

    p.append(el("h3", { textContent: "State" }));
    const ftueChk = el("input", {
      type: "checkbox", checked: this.ftue,
      onchange: (e) => { this.ftue = e.target.checked; this.build(); },
    });
    p.append(el("div", { className: "row" }, ftueChk, el("label", { textContent: "FTUE opener (F)", style: "flex:1" })));
    const trapChk = el("input", {
      type: "checkbox", checked: this.trapdoorOpen,
      onchange: (e) => { this.trapdoorOpen = e.target.checked; this.cave?.setTrapdoorOpen(e.target.checked, true); },
    });
    p.append(el("div", { className: "row" }, trapChk, el("label", { textContent: "first trapdoor open (T)", style: "flex:1" })));

    // ---- selection / editing
    p.append(el("h3", { textContent: "Selection" }));
    if (this.selection) {
      p.append(el("div", { className: "muted", textContent: this._selLabel() }));
      const c = this.cave;
      if (this.selection.type === "rock") {
        const rk = c.rockDefs[this.selection.index];
        p.append(row("x", numInputRO(rk.x)));
        p.append(row("z", numInputRO(rk.z)));
        p.append(row("yaw", numInputRO(round2(rk.yaw ?? 0))));
        p.append(row("scale", numInputRO(round2(rk.s ?? 1))));
      } else if (this.selection.type === "exit") {
        p.append(row("cell", numInputRO(c.exitCell.x), numInputRO(c.exitCell.y)));
      } else if (this.selection.type === "hole") {
        const hc = c.holeCells[this.selection.index];
        p.append(row("cell", numInputRO(hc.gx), numInputRO(hc.gy)));
      }
      p.append(el("div", { className: "row" },
        el("button", { textContent: "Grab (G)", onclick: () => this.beginGrab() }),
        this.selection.type === "rock"
          ? el("button", { textContent: "Rotate (R)", onclick: () => this.rotateSelected(0.2618) })
          : el("span", { className: "muted", textContent: "grid-locked", style: "flex:1;text-align:right" }),
      ));
      if (this.selection.type === "rock") {
        p.append(el("div", { className: "row" },
          el("button", { textContent: "−", onclick: () => this.scaleSelected(1 / 1.1) }),
          el("button", { textContent: "Scale +", onclick: () => this.scaleSelected(1.1) }),
          el("button", { textContent: "Duplicate", onclick: () => this.duplicateSelected() }),
          el("button", { textContent: "Delete", onclick: () => this.deleteSelected() }),
        ));
      }
    } else {
      p.append(el("div", { className: "muted", textContent: "click a rock, the daylight entrance, or a dungeon mouth to select it" }));
    }

    p.append(el("h3", { textContent: "Dungeon mouths" }));
    HOLE_DEFS.forEach((hdef, i) => {
      const btn = el("button", {
        textContent: `${i + 1}. ${hdef.name} — floor ${i * FLOORS_PER_DUNGEON + 1}`,
        style: "display:block;width:100%;text-align:left",
        onclick: () => this.setSelection({ type: "hole", index: i }),
      });
      p.append(btn);
    });

    p.append(el("h3", { textContent: "Layout" }));
    p.append(el("div", { className: "muted", textContent: "rocks move/rotate/scale/duplicate freely; the entrance & mouths snap to grid cells. Changes save to layout.json with Ctrl+S." }));
  }
}

// a read-only value display styled like the panel's number inputs
function numInputRO(value) {
  return el("input", { type: "number", value: String(value), disabled: true });
}

const _dir = new THREE.Vector3();
