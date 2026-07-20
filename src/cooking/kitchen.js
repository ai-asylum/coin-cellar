// The 2D cooking screen — infinite-kitchen's interaction model, rebuilt
// lean on DOM + pointer events:
//   · ingredient drawers slide in from the right edge, one tab per category
//   · drag ingredients from a drawer onto the counter, stack them on each other
//   · bottom dock: three collapsible trays (Tools / Stations / Vessels), each
//     hanging off its own square tab — collapsing a tray deselects its pick
//   · holdable tools become the cursor, click a stack to apply
//   · stations & vessels are radio picks: one of each at a time, dropped on
//     the counter and draggable — drag food onto them, click to cook/plate
import { resolve } from "./resolver.js";
import { spriteFor } from "./sprites.js";
import { resetSteps, recordStep, collectSteps } from "./steplog.js";
import { fetchIngredients, fetchTools, serveDishRemote, judgeDish, titleCase } from "./net/backend.js";
import { save } from "./save.js";
import { TOOL_DEFS, VESSELS } from "./data/tools.js";
import { INGREDIENT_SLUGS } from "./ingredients.js";
import { STATE_EMOJI } from "./data/states.js";

let _uid = 0;
const uid = () => ++_uid;

// Fresh saves get a starter pick so the counter isn't empty.
const DEFAULT_SELECTED = { station: "stove", vessel: "plate" };

// Hard cap on how many ingredients can sit on the counter at once. Spawning
// past this shows an error toast instead of adding another item.
const MAX_ITEMS = 15;

// Minimum on-screen cook time so the telegraph/loading text registers even on
// an instant (cached/memoized) resolve. The resolve runs concurrently with
// this floor — it never stacks on top of the network call.
const COOK_MIN_MS = 260; // stations
const TOOL_MIN_MS = 200; // holdable tools

// Where a freshly picked placeable lands on the counter (center fractions
// of the surface). Draggable afterwards; the moved spot is remembered.
const STATION_ANCHOR = { fx: 0.5, fy: 0.4 };
const VESSEL_ANCHOR = { fx: 0.72, fy: 0.56 };

// Ingredient drawers on the right edge, in display order. Matches the
// ingredients.category column; rows with a null/unknown category land in
// "other".
const TRAY_CATEGORIES = [
  ["produce", "Produce"],
  ["protein", "Protein"],
  ["pantry", "Pantry"],
  ["spices", "Spices"],
  ["other", "Other"],
];

// Line icons for the tray tabs (24px grid, stroke = currentColor).
const svgIcon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const TAB_ICONS = {
  tools: svgIcon(
    `<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>`
  ),
  stations: svgIcon(
    `<path d="M2 12h20"/><path d="M20 12v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6"/><path d="m4 8 16-8"/><path d="M8.86 6.78l-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8"/>`
  ),
  vessels: svgIcon(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>`),
  produce: svgIcon(
    `<path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7z"/><path d="M8.64 14l-2.05-2.04"/><path d="M15.34 15l-2.46-2.46"/><path d="M22 9s-1.33-2-3.5-2S15 9 15 9s1.33 2 3.5 2S22 9 22 9z"/><path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z"/>`
  ),
  protein: svgIcon(
    `<path d="M18.6 5.4a6.5 6.5 0 0 0-9.2 0c-2.3 2.3-2.5 5.9-.7 8.5l-2 2a2.4 2.4 0 1 0-2.6 3.9 2.4 2.4 0 1 0 3.9-2.6l2-2c2.6 1.8 6.2 1.6 8.5-.7a6.5 6.5 0 0 0 .1-9.1Z"/>`
  ),
  pantry: svgIcon(
    `<path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/><path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/><path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/><path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>`
  ),
  spices: svgIcon(
    `<path d="M16.5 3c-1.8 0-3 1.3-3 3"/><path d="M13.5 6c-.5 6-3.2 10.8-10 13.6 5.4 2 13.3 1 15.8-4.8 1.6-3.8-.5-7.7-3-8.8-1-.4-2.8-.4-2.8 0Z"/>`
  ),
  other: svgIcon(
    `<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>`
  ),
};

export class Kitchen {
  constructor({ audio, onDishPlated, onExit }) {
    this.audio = audio;
    this.onDishPlated = onDishPlated;
    this.onExit = onExit;
    this.items = new Map(); // uid → item
    this.placed = new Map(); // slug → placed station/vessel
    this.selectedTool = null;
    this.drag = null;
    this.root = this._buildDom();
    document.body.appendChild(this.root);
    this._bindGlobal();
  }

  // ------------------------------------------------------------- lifecycle

  async show() {
    resetSteps();
    this.root.classList.add("open");
    this.audio?.doorbell();
    // walkthrough line for the first few kitchen visits
    const seen = Number(localStorage.getItem("cc_kitchen_help") || 0);
    this.root.querySelector(".k-help").hidden = seen >= 3;
    localStorage.setItem("cc_kitchen_help", seen + 1);
    await this._refreshTray();
    await this._refreshBelt();
  }

  hide() {
    this.root.classList.remove("open");
    this._deselectTool();
  }

  clearBoard() {
    for (const item of [...this.items.values()]) this._removeItem(item.uid);
    for (const s of this.placed.values()) {
      s.items = [];
      this._renderStationItems(s);
    }
    resetSteps();
  }

  _allPlaced() {
    return [...this.placed.values()];
  }

  // ------------------------------------------------------------------ DOM

  _buildDom() {
    const root = document.createElement("div");
    root.id = "kitchen";
    root.innerHTML = `
      <div class="k-surface"></div>
      <div class="k-dock"></div>
      <div class="k-side"></div>
      <button class="k-exit">← Back to the shop</button>
      <div class="k-help" hidden>Pick a station from the bottom tray → drag ingredients from the side tabs onto it → click it to cook → drop the result on your vessel and plate it</div>
      <div class="k-tool-cursor" hidden></div>
    `;
    root.querySelector(".k-exit").addEventListener("click", () => {
      this.audio?.pickup();
      this.onExit?.();
    });
    this.surfaceEl = root.querySelector(".k-surface");
    this.dockEl = root.querySelector(".k-dock");
    this.sideEl = root.querySelector(".k-side");
    this.cursorEl = root.querySelector(".k-tool-cursor");
    return root;
  }

  // One sliding rack on the right edge: a column of category tabs bolted to
  // the tray, one panel per category behind them. The whole rack (tabs
  // included) slides together, so you can switch category while it's open.
  async _refreshTray() {
    const slugs = [...INGREDIENT_SLUGS, ...save.data.unlockedIngredients];
    const rows = await fetchIngredients(slugs);
    const groups = new Map(TRAY_CATEGORIES.map(([cat]) => [cat, []]));
    for (const row of rows) {
      (groups.get(row.category) || groups.get("other")).push(row);
    }
    this.sideEl.innerHTML = `<div class="k-side-tabs"></div><div class="k-side-panels"></div>`;
    const tabsEl = this.sideEl.querySelector(".k-side-tabs");
    const panelsEl = this.sideEl.querySelector(".k-side-panels");
    this._sideTabs = new Map();
    this._sidePanels = new Map();
    this._activeDrawer = null;
    for (const [cat, label] of TRAY_CATEGORIES) {
      const group = groups.get(cat);
      if (!group.length) continue;
      const tab = document.createElement("button");
      tab.className = "k-tab";
      tab.dataset.tray = cat;
      tab.title = label;
      tab.innerHTML = `<span class="k-tab-icon">${TAB_ICONS[cat]}</span>`;
      tab.addEventListener("click", () => this._toggleDrawer(cat));
      tabsEl.appendChild(tab);
      const panel = document.createElement("div");
      panel.className = "k-drawer-panel";
      panel.dataset.tray = cat;
      panel.innerHTML = `<h3 class="k-panel-title">${label}</h3><div class="k-panel-grid"></div>`;
      const grid = panel.querySelector(".k-panel-grid");
      for (const row of group) {
        const cell = document.createElement("button");
        cell.className = "k-tray-item";
        cell.title = row.name;
        const { url } = await spriteFor(row.slug, row);
        cell.innerHTML = `<img src="${url}" draggable="false"><span>${row.name}</span>`;
        cell.addEventListener("pointerdown", (e) => this._trayPointerDown(row, e));
        grid.appendChild(cell);
      }
      panelsEl.appendChild(panel);
      this._sideTabs.set(cat, tab);
      this._sidePanels.set(cat, panel);
    }
  }

  _toggleDrawer(cat) {
    const isOpen = this.sideEl.classList.contains("open");
    if (isOpen && this._activeDrawer === cat) {
      this.sideEl.classList.remove("open");
      this._sideTabs.get(cat)?.classList.remove("active");
      this._activeDrawer = null;
      this.audio?.hop();
      return;
    }
    this._activeDrawer = cat;
    for (const [c, t] of this._sideTabs) t.classList.toggle("active", c === cat);
    for (const [c, p] of this._sidePanels) p.classList.toggle("active", c === cat);
    this.sideEl.classList.add("open");
    this.audio?.pickup();
  }

  // Bottom dock: one sliding tray with three tabs (Tools / Stations /
  // Vessels) bolted to its top edge — the tabs ride the tray, so you switch
  // panels while it's open. Collapsing via the active tab deselects that
  // tab's pick. Holdables arm the cursor; stations/vessels are radio picks
  // auto-placed on the counter — one of each kind at a time.
  async _refreshBelt() {
    const unlocked = TOOL_DEFS.filter(
      (t) => t.starter || save.data.unlockedTools.includes(t.slug)
    );
    const defs = [...unlocked, ...VESSELS];
    const rows = await fetchTools(defs.map((t) => t.slug));
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    for (const def of defs) {
      const row = bySlug.get(def.slug);
      def.iconUrl = row?.sprite_icon_url || row?.sprite_url || null;
      def.spriteUrl = row?.sprite_url || row?.sprite_icon_url || null;
      def.placedScale = row?.placed_scale || 1.0;
      def.actionVerb = row?.action_verb || def.name;
      def.isVessel = VESSELS.includes(def);
    }
    const art = (def) =>
      def.iconUrl
        ? `<img src="${def.iconUrl}" draggable="false">`
        : stationGlyph(def.slug) || toolGlyph(def.slug);

    // dock panels: holdables / counter stations / plating vessels
    const dockGroups = [
      ["tools", "Tools", null, defs.filter((d) => d.holdable)],
      ["stations", "Stations", "pick one", defs.filter((d) => !d.holdable && !d.isVessel)],
      ["vessels", "Vessels", "pick one", defs.filter((d) => d.isVessel)],
    ];
    this.dockEl.innerHTML = `<div class="k-dock-tabs"></div><div class="k-dock-panels"></div>`;
    this.dockEl.classList.add("open");
    const tabsEl = this.dockEl.querySelector(".k-dock-tabs");
    const panelsEl = this.dockEl.querySelector(".k-dock-panels");
    this._beltButtons = new Map();
    this._dockTabs = new Map();
    this._dockPanels = new Map();
    for (const [key, label, note, group] of dockGroups) {
      if (!group.length) continue;
      const tab = document.createElement("button");
      tab.className = "k-tab";
      tab.dataset.tray = key;
      tab.title = label;
      tab.innerHTML = `<span class="k-tab-icon">${TAB_ICONS[key]}</span>`;
      tab.addEventListener("click", () => this._toggleDockTab(key));
      tabsEl.appendChild(tab);
      const panel = document.createElement("div");
      panel.className = "k-dock-panel";
      panel.dataset.tray = key;
      panel.innerHTML = `
        <h3 class="k-dock-title">${label}${note ? ` <em>· ${note}</em>` : ""}</h3>
        <div class="k-dock-row"></div>`;
      const rowEl = panel.querySelector(".k-dock-row");
      for (const def of group) {
        const btn = document.createElement("button");
        btn.className = "k-tool";
        btn.dataset.slug = def.slug;
        btn.innerHTML = `<span class="k-tool-art">${art(def)}</span><span>${def.name}</span>`;
        if (def.holdable) {
          btn.addEventListener("click", () => this._toggleTool(def, btn));
        } else {
          btn.addEventListener("click", () => this._selectPlaceable(def));
        }
        rowEl.appendChild(btn);
        this._beltButtons.set(def.slug, btn);
      }
      panelsEl.appendChild(panel);
      this._dockTabs.set(key, tab);
      this._dockPanels.set(key, panel);
    }
    this._setDockTab(this._activeDock && this._dockTabs.has(this._activeDock) ? this._activeDock : "tools");

    // restore the saved station/vessel pick (or the starter one)
    if (!save.data.kitchenSelected) {
      save.data.kitchenSelected = { ...DEFAULT_SELECTED };
      save.persist();
    }
    for (const s of this._allPlaced()) s.el.remove();
    this.placed.clear();
    for (const slug of [save.data.kitchenSelected.station, save.data.kitchenSelected.vessel]) {
      const def = defs.find((d) => d.slug === slug);
      if (def) this._spawnPlaced(def, false);
    }
  }

  _setDockTab(key) {
    this._activeDock = key;
    for (const [k, t] of this._dockTabs) t.classList.toggle("active", k === key);
    for (const [k, p] of this._dockPanels) p.classList.toggle("active", k === key);
  }

  // Tab click: switch panels while the tray is open; clicking the active tab
  // collapses the tray AND deselects that tab's pick — tools drop the armed
  // cursor, stations/vessels come off the counter (contents spill back).
  _toggleDockTab(key) {
    const isOpen = this.dockEl.classList.contains("open");
    if (isOpen && this._activeDock === key) {
      if (key !== "tools") {
        const current = this._placedOfKind(key === "vessels");
        if (current?.busy) {
          this._wiggle(this._dockTabs.get(key));
          this.audio?.deny();
          return; // no yanking a cooking pot off the counter
        }
        if (current) {
          this._removePlaced(current);
          this._persistSelected();
        }
      } else {
        this._deselectTool();
      }
      this.dockEl.classList.remove("open");
      this.audio?.hop();
      return;
    }
    this._setDockTab(key);
    this.dockEl.classList.add("open");
    this.audio?.pickup();
  }

  // --------------------------------------------------------- placeables

  _placedOfKind(isVessel) {
    return this._allPlaced().find((s) => !!s.isVessel === !!isVessel) || null;
  }

  _persistSelected() {
    save.data.kitchenSelected = {
      station: this._placedOfKind(false)?.def.slug || null,
      vessel: this._placedOfKind(true)?.def.slug || null,
      // per-slug dragged positions survive swaps, so re-picking a station
      // puts it back where you left it
      positions: save.data.kitchenSelected?.positions || {},
    };
    save.persist();
  }

  _persistPlacedPos(station) {
    this._persistSelected();
    save.data.kitchenSelected.positions[station.def.slug] = { fx: station.fx, fy: station.fy };
    save.persist();
  }

  // Radio behavior: picking a station/vessel swaps out the current one of
  // that kind; picking the active one again deselects it.
  _selectPlaceable(def) {
    const existing = this.placed.get(def.slug);
    if (existing) {
      if (existing.busy) {
        this._float(existing.el, "cooking…");
        this.audio?.deny();
        return;
      }
      this._removePlaced(existing);
      this._persistSelected();
      this.audio?.hop();
      return;
    }
    const current = this._placedOfKind(def.isVessel);
    if (current) {
      if (current.busy) {
        this._float(current.el, "cooking…");
        this.audio?.deny();
        return;
      }
      this._removePlaced(current);
    }
    this._spawnPlaced(def, true);
    this._persistSelected();
    this.audio?.pickup();
  }

  _spawnPlaced(def, pop) {
    const el = document.createElement("div");
    el.className = "k-placed" + (def.isVessel ? " k-placed-vessel" : "");
    el.dataset.slug = def.slug;
    const size = Math.round(293 * (def.placedScale || 1));
    el.innerHTML = `
      ${def.spriteUrl
        ? `<img class="k-placed-art" src="${def.spriteUrl}" draggable="false" style="width:${size}px;height:${size}px">`
        : `<div class="k-placed-art k-placed-glyph" style="width:${size}px;height:${size}px;font-size:${size * 0.6}px">${stationGlyph(def.slug)}</div>`}
      <div class="k-station-items"></div>
      ${def.isVessel ? `<button class="k-plate-btn" hidden>PLATE ✨</button>` : ""}
      <span class="k-placed-name">${def.name}</span>`;
    const station = {
      def,
      el,
      itemsEl: el.querySelector(".k-station-items"),
      items: [],
      isVessel: def.isVessel,
      x: 0,
      y: 0,
    };
    if (def.isVessel) {
      el.querySelector(".k-plate-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this._plate(station);
      });
    }
    // click = cook/plate; drag (>6px) = move it around the counter
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._placedPress(station, e);
    });
    this.surfaceEl.appendChild(el);
    this._positionPlaced(station);
    this.placed.set(def.slug, station);
    this._beltButtons?.get(def.slug)?.classList.add("placed");
    if (pop) {
      el.classList.add("pop");
      setTimeout(() => el.classList.remove("pop"), 500);
    }
    return station;
  }

  _removePlaced(station) {
    // spill contents back onto the counter, infinite-kitchen style
    const rect = station.el.getBoundingClientRect();
    const surf = this.surfaceEl.getBoundingClientRect();
    [...station.items].forEach((id, i) => {
      const item = this.items.get(id);
      if (!item) return;
      station.items = station.items.filter((x) => x !== id);
      this._placeItem(item, rect.left - surf.left + i * 60, rect.top - surf.top + 30, true);
    });
    station.el.remove();
    this.placed.delete(station.def.slug);
    this._beltButtons?.get(station.def.slug)?.classList.remove("placed");
  }

  // Place at the remembered spot for this slug, or the default anchor.
  _positionPlaced(station) {
    const saved = save.data.kitchenSelected?.positions?.[station.def.slug];
    const a = saved || (station.isVessel ? VESSEL_ANCHOR : STATION_ANCHOR);
    this._movePlacedFrac(station, a.fx, a.fy);
  }

  _movePlacedFrac(station, fx, fy) {
    const rect = this.surfaceEl.getBoundingClientRect();
    const w = station.el.offsetWidth || 225;
    const h = station.el.offsetHeight || 225;
    this._movePlaced(station, rect.width * fx - w / 2, rect.height * fy - h / 2);
  }

  _movePlaced(station, x, y) {
    const rect = this.surfaceEl.getBoundingClientRect();
    const w = station.el.offsetWidth || 225;
    const h = station.el.offsetHeight || 225;
    station.x = Math.max(0, Math.min(rect.width - w, x));
    station.y = Math.max(0, Math.min(rect.height - h, y));
    // center fractions — used to re-place on resize and to persist
    station.fx = (station.x + w / 2) / rect.width;
    station.fy = (station.y + h / 2) / rect.height;
    station.el.style.left = station.x + "px";
    station.el.style.top = station.y + "px";
  }

  _placedPress(station, e) {
    const sx = e.clientX;
    const sy = e.clientY;
    const startX = station.x;
    const startY = station.y;
    let dragging = false;
    station.el.classList.add("pressed");
    const onMove = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      dragging = true;
      station.el.classList.remove("pressed");
      station.el.classList.add("dragging");
      this._movePlaced(station, startX + ev.clientX - sx, startY + ev.clientY - sy);
    };
    const onUp = () => {
      cleanup();
      station.el.classList.remove("pressed");
      if (dragging) {
        station.el.classList.remove("dragging");
        this._persistPlacedPos(station);
        return;
      }
      if (station.isVessel) {
        if (station.items.length) this._plate(station);
        else {
          this._float(station.el, `Drop food on the ${station.def.name}, then plate it`);
          this._wiggle(station.el);
          this.audio?.haggle();
        }
      } else {
        this._activateStation(station);
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ------------------------------------------------------------ tray spawn

  // A plain click pops the ingredient onto the middle of the counter; only a
  // real drag (>6px) spawns it under the pointer and keeps dragging.
  _trayPointerDown(row, e) {
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      cleanup();
      this._spawnFromTray(row, ev);
    };
    const onUp = () => {
      cleanup();
      this._spawnFromTray(row, null);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async _spawnFromTray(row, e) {
    if (this.items.size >= MAX_ITEMS) {
      this._toast(`Counter full — max ${MAX_ITEMS} ingredients. Cook or clear some first.`);
      this.audio?.deny();
      return;
    }
    this.audio?.pickup();
    const rect = this.surfaceEl.getBoundingClientRect();
    const item = await this._makeItem(row.slug, { name: row.name, emoji: row.emoji, states: [], description: row.description });
    if (e) {
      // drag: center the item under the pointer and hand it to the drag
      // handler (_placeItem clamps it onto the counter while the cursor is
      // still over the side panel).
      this._placeItem(item, e.clientX - rect.left - 82, e.clientY - rect.top - 82, true);
      // the pointer may have been released while the sprite loaded
      if (e.buttons > 0) this._startDrag(item, e);
      return;
    }
    // click: drop it near the center of the counter, spiralling outward to
    // the first spot that doesn't overlap an existing ingredient so repeats
    // arrange themselves instead of stacking in one exact spot.
    const spot = this._findFreeSpot(rect.width / 2 - 82, rect.height / 2 - 82);
    this._placeItem(item, spot.x, spot.y, true);
  }

  // Archimedean-spiral search for a free landing spot: start at the desired
  // point, then sweep outward until we find a spot far enough from every
  // loose ingredient on the counter (stacked/stationed items are ignored).
  _findFreeSpot(x, y, ignore = null) {
    const rect = this.surfaceEl.getBoundingClientRect();
    const minDist = 120; // center-to-center spacing before it reads as overlap
    const clampX = (vx) => Math.max(10, Math.min(rect.width - 168, vx));
    const clampY = (vy) => Math.max(rect.height * 0.13, Math.min(rect.height - 168, vy));
    const overlaps = (px, py) => {
      for (const other of this.items.values()) {
        if (other === ignore) continue;
        if (other.el.parentNode !== this.surfaceEl) continue; // loose items only
        if (Math.hypot(other.x - px, other.y - py) < minDist) return true;
      }
      return false;
    };
    let px = clampX(x);
    let py = clampY(y);
    if (!overlaps(px, py)) return { x: px, y: py };
    for (let i = 1; i < 480; i++) {
      const ang = i * 0.7;
      const rad = minDist * 0.11 * ang;
      px = clampX(x + Math.cos(ang) * rad);
      py = clampY(y + Math.sin(ang) * rad);
      if (!overlaps(px, py)) return { x: px, y: py };
    }
    return { x: px, y: py };
  }

  async _makeItem(slug, { name, emoji, states = [], spriteUrl = null, description = "" }) {
    const { url } = spriteUrl ? { url: spriteUrl } : await spriteFor(slug, { name, emoji });
    const el = document.createElement("div");
    el.className = "k-item";
    el.innerHTML = `<img src="${url}" draggable="false"><div class="k-badges"></div><span class="k-item-name">${name}</span>`;
    const item = { uid: uid(), slug, name, emoji, states, description, x: 0, y: 0, el, stackedOn: null };
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (this.selectedTool) this._applyToolTo(item);
      else this._startDrag(item, e);
    });
    this.items.set(item.uid, item);
    this._renderBadges(item);
    return item;
  }

  _placeItem(item, x, y, pop = false) {
    const rect = this.surfaceEl.getBoundingClientRect();
    // keep items on the counter (below the back-wall band)
    item.x = Math.max(10, Math.min(rect.width - 168, x));
    item.y = Math.max(rect.height * 0.13, Math.min(rect.height - 168, y));
    item.el.style.left = item.x + "px";
    item.el.style.top = item.y + "px";
    if (!item.el.parentNode) this.surfaceEl.appendChild(item.el);
    if (pop) {
      item.el.classList.remove("pop");
      void item.el.offsetWidth;
      item.el.classList.add("pop");
    }
  }

  _renderBadges(item) {
    const el = item.el.querySelector(".k-badges");
    el.innerHTML = item.states.map((s) => `<i title="${s}">${STATE_EMOJI[s] || "•"}</i>`).join("");
    item.el.classList.toggle("hot", item.states.includes("HOT") || item.states.includes("ON_FIRE"));
    item.el.classList.toggle("frozen", item.states.includes("FROZEN") || item.states.includes("CHILLED"));
    item.el.classList.toggle("burnt", item.states.includes("BURNT") || item.states.includes("CHARRED"));
  }

  // ----------------------------------------------------------------- drag

  _startDrag(item, e) {
    if (item.locked) return;
    this._unstack(item);
    this._pullFromStations(item);
    item.el.classList.add("dragging");
    this.surfaceEl.appendChild(item.el); // back to loose surface while held
    const rect = this.surfaceEl.getBoundingClientRect();
    this.drag = { item, dx: e.clientX - rect.left - item.x, dy: e.clientY - rect.top - item.y };
  }

  _bindGlobal() {
    window.addEventListener("pointermove", (e) => {
      if (this.selectedTool) {
        this.cursorEl.style.left = e.clientX + "px";
        this.cursorEl.style.top = e.clientY + "px";
      }
      if (!this.drag) return;
      const rect = this.surfaceEl.getBoundingClientRect();
      this._placeItem(this.drag.item, e.clientX - rect.left - this.drag.dx, e.clientY - rect.top - this.drag.dy);
    });
    window.addEventListener("pointerup", (e) => {
      if (!this.drag) return;
      const item = this.drag.item;
      this.drag = null;
      item.el.classList.remove("dragging");
      if (!this._checkStationDrop(item, e)) this._checkStacking(item);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this._deselectTool();
    });
    window.addEventListener("resize", () => {
      for (const s of this._allPlaced()) this._movePlacedFrac(s, s.fx, s.fy);
    });
    this.root.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this._deselectTool();
    });
  }

  // --------------------------------------------------------------- stacks

  _stackOf(item) {
    // Walk to root, then collect everything stacked on the chain.
    let root = item;
    while (root.stackedOn) root = this.items.get(root.stackedOn);
    const stack = [root];
    let changed = true;
    while (changed) {
      changed = false;
      for (const other of this.items.values()) {
        if (!stack.includes(other) && other.stackedOn && stack.some((s) => s.uid === other.stackedOn)) {
          stack.push(other);
          changed = true;
        }
      }
    }
    return stack;
  }

  _unstack(item) {
    // Anyone stacked on me re-parents to what I was on.
    for (const other of this.items.values()) {
      if (other.stackedOn === item.uid) other.stackedOn = item.stackedOn;
    }
    item.stackedOn = null;
  }

  _checkStacking(item) {
    for (const other of this.items.values()) {
      if (other === item || other.stackedOn === item.uid) continue;
      if (other.el.parentNode !== this.surfaceEl) continue;
      const dx = other.x - item.x;
      const dy = other.y - item.y;
      if (Math.hypot(dx, dy) < 64) {
        const top = this._stackOf(other).at(-1);
        item.stackedOn = top.uid;
        this._placeItem(item, top.x + 13, top.y - 13);
        this.audio?.hop();
        return true;
      }
    }
    return false;
  }

  _pullFromStations(item) {
    for (const s of this._allPlaced()) {
      const i = s.items.indexOf(item.uid);
      if (i >= 0) {
        s.items.splice(i, 1);
        this._renderStationItems(s);
      }
    }
  }

  // ------------------------------------------------------------- stations

  _checkStationDrop(item, e) {
    for (const s of this._allPlaced()) {
      // central 60% of the placed tool counts as its drop zone (IK's rule)
      const r = s.el.getBoundingClientRect();
      const padX = r.width * 0.2;
      const padY = r.height * 0.2;
      if (
        e.clientX > r.left - padX && e.clientX < r.right + padX &&
        e.clientY > r.top - padY && e.clientY < r.bottom + padY
      ) {
        if (s.busy) {
          this._float(s.el, "cooking…");
          return false;
        }
        if (s.items.length >= s.def.maxInputs) {
          this._float(s.el, "Full!");
          this.audio?.deny();
          return false;
        }
        // the whole stack goes in together
        const stack = this._stackOf(item);
        for (const st of stack) {
          if (s.items.length >= s.def.maxInputs) break;
          this._unstack(st);
          st.stackedOn = null;
          s.items.push(st.uid);
        }
        this._renderStationItems(s);
        this.audio?.hop();
        return true;
      }
    }
    return false;
  }

  _renderStationItems(s) {
    s.itemsEl.innerHTML = "";
    for (const id of s.items) {
      const item = this.items.get(id);
      if (!item) continue;
      item.el.remove();
      const mini = item.el.querySelector("img").cloneNode();
      mini.className = "k-mini";
      mini.title = item.name;
      mini.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (s.busy) return; // mid-cook: contents are spoken for
        // click = cook/plate the station; only a real drag (>6px) pulls the
        // item back out
        const sx = e.clientX;
        const sy = e.clientY;
        const onMove = (ev) => {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          cleanup();
          s.items = s.items.filter((x) => x !== id);
          this._renderStationItems(s);
          const rect = this.surfaceEl.getBoundingClientRect();
          this._placeItem(item, ev.clientX - rect.left - 50, ev.clientY - rect.top - 50, true);
          this._startDrag(item, ev);
        };
        const onUp = () => {
          cleanup();
          if (s.isVessel) {
            if (s.items.length) this._plate(s);
          } else {
            this._activateStation(s);
          }
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      s.itemsEl.appendChild(mini);
    }
    if (s.isVessel) {
      s.el.querySelector(".k-plate-btn").hidden = s.items.length === 0;
    }
  }

  async _activateStation(s) {
    if (s.isVessel) return;
    if (s.items.length === 0) {
      // empty station: tell the player what it wants instead of doing nothing
      this._float(s.el, `Drop ingredients on the ${s.def.name} first`);
      this._wiggle(s.el);
      this.audio?.haggle();
      return;
    }
    if (s.busy) {
      this._float(s.el, "cooking…");
      return;
    }
    const items = s.items.map((id) => this.items.get(id));
    s.busy = true;
    s.el.classList.add("cooking");
    this._lockItems(items);
    this.audio?.telegraph();
    this._stationParticles(s, s.def.slug);
    const hideLoading = this._showLoadingText(s.el, s.def.actionVerb || s.def.name);
    try {
      // Run the cook animation concurrently with the resolve (infinite-kitchen
      // style) instead of stacking a fixed delay on top of the network call —
      // a cached combo now returns as fast as it resolves. COOK_MIN_MS is just
      // a tiny floor so the telegraph registers on instant (memo) hits.
      const [result] = await Promise.all([
        resolve({ toolSlug: s.def.slug, items }),
        wait(COOK_MIN_MS),
      ]);
      hideLoading();
      await this._applyResult(result, s.def.slug, items, s);
    } finally {
      hideLoading();
      s.el.classList.remove("cooking");
      s.busy = false;
      this._unlockItems(items);
    }
  }

  // --------------------------------------------------------------- tools

  _toggleTool(def, btn) {
    if (this.selectedTool?.slug === def.slug) return this._deselectTool();
    this._deselectTool();
    this.selectedTool = def;
    btn.classList.add("selected");
    this.cursorEl.hidden = false;
    this.cursorEl.innerHTML = def.iconUrl
      ? `<img src="${def.iconUrl}" draggable="false">`
      : toolGlyph(def.slug);
    this.root.classList.add("tool-armed");
    this.audio?.pickup();
  }

  _deselectTool() {
    this.selectedTool = null;
    this.dockEl?.querySelectorAll(".selected").forEach((b) => b.classList.remove("selected"));
    if (this.cursorEl) this.cursorEl.hidden = true;
    this.root?.classList.remove("tool-armed");
  }

  async _applyToolTo(item) {
    const def = this.selectedTool;
    if (!def) return;
    const stack = this._stackOf(item);
    if (stack.some((s) => s.locked)) {
      this._float(item.el, "still cooking…");
      return;
    }
    if (stack.length > def.maxInputs) {
      this._float(item.el, `${def.name}: max ${def.maxInputs}`);
      this.audio?.deny();
      return;
    }
    this.audio?.swing();
    this._lockItems(stack);
    stack.forEach((s) => s.el.classList.add("working"));
    const hideLoading = this._showLoadingText(item.el, def.actionVerb || def.name);
    try {
      const [result] = await Promise.all([
        resolve({ toolSlug: def.slug, items: stack }),
        wait(TOOL_MIN_MS),
      ]);
      stack.forEach((s) => s.el.classList.remove("working"));
      hideLoading();
      await this._applyResult(result, def.slug, stack);
    } finally {
      hideLoading();
      stack.forEach((s) => s.el.classList.remove("working"));
      this._unlockItems(stack);
    }
  }

  // Items involved in an in-flight resolution: no dragging, no re-applying —
  // infinite-kitchen's "processing" + disableInteractive equivalent.
  _lockItems(items) {
    for (const it of items) {
      it.locked = true;
      it.el.classList.add("locked");
    }
  }

  // infinite-kitchen's loading indicator: pulsing bold white text with a
  // black stroke, "{Verb}ing..." from the tool's action_verb, hovering above
  // the thing being processed. Returns a disposer.
  _showLoadingText(anchorEl, actionVerb) {
    const el = document.createElement("div");
    el.className = "k-loading-text";
    el.textContent = `${loadingVerb(actionVerb)}...`;
    const r = anchorEl.getBoundingClientRect();
    el.style.left = r.left + r.width / 2 + "px";
    // above the anchor; when that would clip off-screen, sit just below
    el.style.top = (r.top - 34 > 8 ? r.top - 34 : r.bottom + 10) + "px";
    document.body.appendChild(el);
    return () => el.remove();
  }

  _unlockItems(items) {
    for (const it of items) {
      it.locked = false;
      if (this.items.has(it.uid)) it.el.classList.remove("locked");
    }
  }

  // -------------------------------------------------------- result common

  async _applyResult(result, toolSlug, inputs, station = null) {
    const anchor = station ? station.el : inputs[0].el;
    if (result.outcomeType === "no_effect") {
      this._float(anchor, "no effect");
      this._wiggle(anchor);
      this.audio?.deny();
      return;
    }

    recordStep({ toolSlug, verb: result.verb, inputs, outputs: result.outputs });
    const discovery = result.isFirstDiscovery || result.isLocalFirst;

    if (result.outcomeType === "modify") {
      // backend speaks in input indices — consume + mutate by position
      for (const idx of result.consumedIdx) {
        const item = inputs[idx];
        if (item) this._removeItem(item.uid, station);
      }
      for (const m of result.modified) {
        const item = inputs[m.index];
        if (!item || !this.items.has(item.uid)) continue;
        item.states = m.states;
        this._renderBadges(item);
        this._pulse(item.el);
      }
      if (station) this._renderStationItems(station);
      this.audio?.hit();
      this._float(anchor, result.verb + "!");
      return;
    }

    // transform / multi_output — build the outputs and wait for their sprite
    // images to finish loading BEFORE consuming the inputs, so the old item
    // never vanishes ahead of its replacement.
    const center = this._anchorPos(anchor);
    const spawned = [];
    for (const out of result.outputs) {
      const item = await this._makeItem(out.slug, out);
      item.states = out.states || [];
      this._renderBadges(item);
      spawned.push(item);
    }
    await Promise.all(spawned.map((item) => imageReady(item.el)));

    for (const idx of result.consumedIdx) {
      const item = inputs[idx];
      if (item) this._removeItem(item.uid, station);
    }
    this.audio?.[discovery ? "perfect" : "sale"]?.();
    spawned.forEach((item, i) => {
      this._placeItem(item, center.x - 50 + i * 64, center.y - 30, true);
    });
    if (station) {
      station.items = station.items.filter((id) => this.items.has(id));
      this._renderStationItems(station);
    }
    const label = discovery && result.outputs.length
      ? "✨ " + result.outputs.map((o) => o.name).join(" + ")
      : result.verb + "!";
    this._float(anchor, label);
  }

  _removeItem(id, station = null) {
    const item = this.items.get(id);
    if (!item) return;
    this._unstack(item);
    this._pullFromStations(item);
    item.el.remove();
    this.items.delete(id);
  }

  _anchorPos(el) {
    const r = el.getBoundingClientRect();
    const s = this.surfaceEl.getBoundingClientRect();
    return { x: r.left + r.width / 2 - s.left, y: Math.max(30, r.top + r.height / 2 - s.top) };
  }

  // -------------------------------------------------------------- plating

  async _plate(vessel) {
    if (vessel.items.length === 0 || this._plating) return;
    this._plating = true;
    const plateBtn = vessel.el.querySelector(".k-plate-btn");
    plateBtn.disabled = true;
    plateBtn.textContent = "Plating...";
    plateBtn.classList.add("k-btn-loading");
    const items = vessel.items.map((id) => this.items.get(id));
    const steps = collectSteps();
    const ingredients = items.map((i) => ({
      slug: i.slug,
      name: i.name,
      emoji: i.emoji || "",
      states: [...i.states],
      // the generated sprite each plated item is wearing right now — this is
      // the dish's illustration everywhere (never emojis)
      spriteUrl: i.el.querySelector("img")?.src || null,
    }));
    // dish identity = hash(ingredients + states + steps + vessel)
    const identity = await sha1(
      JSON.stringify({
        v: vessel.def.slug,
        i: ingredients.map((x) => `${x.slug}|${[...x.states].sort()}`).sort(),
        s: steps.map((s) => `${s.tool}:${s.action}`),
      })
    );

    const resetBtn = () => {
      plateBtn.disabled = false;
      plateBtn.textContent = "PLATE ✨";
      plateBtn.classList.remove("k-btn-loading");
    };

    const already = save.data.cookbook.find((d) => d.identity === identity);
    if (already) {
      this._plating = false;
      resetBtn();
      this._float(vessel.el, `Already in cookbook: ${already.name}`);
      this.audio?.deny();
      for (const id of [...vessel.items]) this._removeItem(id);
      vessel.items = [];
      this._renderStationItems(vessel);
      resetSteps();
      return;
    }

    // reveal overlay with a working spinner while the LLM prices the dish
    const overlay = this._dishOverlay();
    this.audio?.chest();

    const base = localPrice(ingredients, steps);
    const [remote, valuation] = await Promise.all([
      serveDishRemote(
        ingredients.map((i) => ({ name: i.name, slug: i.slug })),
        steps,
        vessel.def.slug
      ),
      // the LLM decides the price: it scores the dish 0–5 as a menu item and
      // that verdict scales the base value
      judgeDish({
        title: "Menu pricing",
        description:
          "You are a restaurant consultant pricing a new menu item. Judge how appealing, complete and well-crafted this dish is as a paid menu item.",
        reward: base,
        ingredientNames: ingredients.map((i) =>
          i.states.length ? `${i.name} (${i.states.join(", ").toLowerCase()})` : i.name
        ),
      }),
    ]);

    const fallbackName = localDishName(ingredients, steps, vessel.def.slug);
    const name = remote?.aiDishName || fallbackName;
    const priced = valuation
      ? base * (0.6 + Math.max(0, Math.min(5, valuation.score)) * 0.3)
      : base;
    const price = clampPrice(Math.max(priced, remote?.totalCoins || 0));
    const dish = {
      uid: "dish_" + Date.now().toString(36),
      identity,
      remoteDishId: remote?.dishId || null,
      name,
      vessel: vessel.def.slug,
      ingredients,
      steps,
      price,
      spriteUrl: ingredients.find((x) => x.spriteUrl)?.spriteUrl || null,
      createdAt: Date.now(),
      timesServed: 0,
      stars: null,
    };
    save.data.cookbook.push(dish);
    save.persist();

    for (const id of [...vessel.items]) this._removeItem(id);
    vessel.items = [];
    this._renderStationItems(vessel);
    resetSteps();

    this._fillDishOverlay(overlay, dish);
    this.audio?.victory();
    this.onDishPlated?.(dish);
    this._plating = false;
    resetBtn();
  }

  _dishOverlay() {
    const ov = document.createElement("div");
    ov.className = "k-reveal";
    ov.innerHTML = `<div class="k-reveal-card"><div class="k-spinner"></div><h2>Plating…</h2></div>`;
    this.root.appendChild(ov);
    return ov;
  }

  _fillDishOverlay(ov, dish) {
    const art = dish.spriteUrl
      ? `<img class="k-reveal-art" src="${dish.spriteUrl}" draggable="false">`
      : `<div class="k-reveal-art k-reveal-art-blank"></div>`;
    ov.querySelector(".k-reveal-card").innerHTML = `
      <div class="k-reveal-stars">✦ NEW RECIPE ✦</div>
      ${art}
      <h2>${dish.name}</h2>
      <p class="k-reveal-price">💰 ${dish.price} coins</p>
      <p class="k-reveal-sub">Added to your cookbook.</p>
      <button class="k-reveal-ok">Nice!</button>`;
    ov.querySelector(".k-reveal-ok").addEventListener("click", () => ov.remove());
    confettiBurst(ov);
  }

  // ----------------------------------------------------------------- juice

  _float(el, text) {
    const f = document.createElement("div");
    f.className = "k-float";
    f.textContent = text;
    const r = el.getBoundingClientRect();
    f.style.left = r.left + r.width / 2 + "px";
    f.style.top = r.top + "px";
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  // Centered banner for counter-wide messages (e.g. hitting the item cap).
  _toast(text) {
    if (this._toastEl) this._toastEl.remove();
    const t = document.createElement("div");
    t.className = "k-toast";
    t.textContent = text;
    this.root.appendChild(t);
    this._toastEl = t;
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => {
        t.remove();
        if (this._toastEl === t) this._toastEl = null;
      }, 300);
    }, 2000);
  }

  _wiggle(el) {
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 400);
  }

  _pulse(el) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }

  _stationParticles(s, slug) {
    const kind = { stove: "🔥", oven: "🔥", grill: "♨️", deep_fryer: "🫧", pot: "🫧", freezer: "❄️", smoker: "💨", barrel: "🫧" }[slug] || "✨";
    for (let i = 0; i < 8; i++) {
      const p = document.createElement("span");
      p.className = "k-particle";
      p.textContent = kind;
      p.style.left = 20 + Math.random() * 60 + "%";
      p.style.animationDelay = i * 90 + "ms";
      s.el.appendChild(p);
      setTimeout(() => p.remove(), 1400 + i * 90);
    }
  }
}

// ------------------------------------------------------------------ misc

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Present participle for loading text (e.g. "Cut" → "Cutting") — ported
// verbatim from infinite-kitchen's getLoadingVerb.
function loadingVerb(actionVerb) {
  const verb = actionVerb.toLowerCase();
  if (["cut", "chop", "stir", "whip", "grill"].includes(verb)) {
    return actionVerb + actionVerb.slice(-1) + "ing";
  }
  if (verb.endsWith("e")) {
    return actionVerb.slice(0, -1) + "ing";
  }
  return actionVerb + "ing";
}

// Resolves once the element's <img> has loaded (or errored/timed out) so
// item swaps never leave a blank frame.
function imageReady(el, timeout = 4000) {
  const img = el.querySelector("img");
  if (!img || (img.complete && img.naturalWidth > 0)) return Promise.resolve();
  return new Promise((res) => {
    const done = () => res();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    setTimeout(done, timeout);
  });
}

async function sha1(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clampPrice(p) {
  return Math.max(4, Math.min(150, Math.round(p || 0)));
}

function localDishName(ingredients, steps, vessel) {
  const main = ingredients[0]?.name || "Mystery";
  const verb = steps.at(-1)?.actionVerb || "plated";
  const style = { plate: "Plate", bowl: "Bowl", cup: "Cup" }[vessel] || "Dish";
  return `${titleCase(verb)} ${main} ${style}`;
}

function localPrice(ingredients, steps) {
  return 6 + ingredients.length * 4 + steps.length * 3;
}

function confettiBurst(host) {
  for (let i = 0; i < 24; i++) {
    const c = document.createElement("i");
    c.className = "k-confetti";
    c.style.setProperty("--dx", (Math.random() * 2 - 1) * 240 + "px");
    c.style.setProperty("--dy", -(80 + Math.random() * 260) + "px");
    c.style.background = `hsl(${(Math.random() * 360) | 0} 80% 60%)`;
    c.style.animationDelay = Math.random() * 150 + "ms";
    host.appendChild(c);
    setTimeout(() => c.remove(), 1600);
  }
}

function stationGlyph(slug) {
  return {
    stove: "🍳", oven: "🔥", pot: "🍲", grill: "♨️", deep_fryer: "🍟",
    freezer: "❄️", smoker: "💨", barrel: "🛢️",
    plate: "🍽️", bowl: "🥣", cup: "🥤",
  }[slug] || "🔧";
}

function toolGlyph(slug) {
  return {
    hands: "🤲", knife: "🔪", whisk: "🥄", grater: "🧀", rolling_pin: "🪵",
    blender: "🌀", mortar: "🥣", peeler: "🥕",
  }[slug] || "🔧";
}
