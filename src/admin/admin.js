// Coin Cellar — Admin data browser.
// A standalone, read-only catalogue of every game definition (merchandise,
// dungeon monsters, shopper archetypes, the character roster, and the floor
// progression). Served at /admin via its own Vite entry; it imports the exact
// source-of-truth modules the game uses and rebuilds the real meshes, so the
// catalogue always reflects the current game — it can't drift.
import * as THREE from "three";

import { ITEMS, LOOT_BY_TIER, itemSprite } from "../game/items.js";
import { ENEMY_KINDS, FLOOR_MIX, BOSSES, bossDefFor } from "../game/dungeon.js";
import { HOLE_DEFS } from "../game/sewer.js";
import { ARCHETYPES } from "../game/shop.js";
import { Creature } from "../chargen/creature.js";
import { BlockyCreature, variantForSeed } from "../chargen/blocky.js";
import { CHAR_VARIANTS, loadCharacters } from "../chargen/assets.js";
import { icon, itemIcon } from "../core/icons.js";

// --- helpers ---------------------------------------------------------------

const hex = (n) =>
  typeof n === "number" ? "#" + (n & 0xffffff).toString(16).padStart(6, "0") : String(n);

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function swatch(label, n) {
  return `<span class="swatch"><i style="background:${hex(n)}"></i>${esc(label)} <code>${hex(n)}</code></span>`;
}

function stat(label, value) {
  return `<div class="stat"><span class="stat-k">${esc(label)}</span><span class="stat-v">${esc(value)}</span></div>`;
}

function badge(text, kind = "") {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

// Render a uniform card. entry = { title, id?, icon?, color?, desc?, badges?,
// stats?, swatches?, visual? }
function card(entry) {
  const head = `
    <div class="card-head">
      ${entry.color != null ? `<span class="card-dot" style="background:${hex(entry.color)}"></span>` : ""}
      ${entry.icon ? `<span class="card-icon">${entry.icon}</span>` : ""}
      <div class="card-titles">
        <h3>${esc(entry.title)}</h3>
        ${entry.id ? `<code class="card-id">${esc(entry.id)}</code>` : ""}
      </div>
      ${(entry.badges || []).map((b) => badge(b.text, b.kind)).join("")}
    </div>`;
  const visual = entry.visual || "";
  const desc = entry.desc ? `<p class="card-desc">${esc(entry.desc)}</p>` : "";
  const stats = (entry.stats || []).length
    ? `<div class="stats">${entry.stats.map(([k, v]) => stat(k, v)).join("")}</div>`
    : "";
  const sw = (entry.swatches || []).length
    ? `<div class="swatches">${entry.swatches.map(([l, n]) => swatch(l, n)).join("")}</div>`
    : "";
  return `<article class="card">${head}${visual}${desc}${stats}${sw}</article>`;
}

// Entries are cards, except `{ section, icon? }` markers which render as a
// full-width divider so a tab can group its cards into categories.
function grid(entries) {
  return `<div class="grid">${entries
    .map((e) => (e.section ? `<div class="grid-section">${e.icon || ""}<span>${esc(e.section)}</span></div>` : card(e)))
    .join("")}</div>`;
}

// --- shared WebGL renderer -------------------------------------------------
// One renderer draws every visible card preview via the scissor test, so the
// page can show dozens of live models without ever exhausting the browser's
// WebGL-context budget (the naive one-canvas-per-card approach caps out ~16).

const glCanvas = document.createElement("canvas");
glCanvas.className = "gl-overlay";
document.body.appendChild(glCanvas);

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;

const clock = new THREE.Clock();
let elapsed = 0;
let vw = 0;
let vh = 0;

// A single card's model: its own scene, lights, auto-framed camera, and a
// slowly-turning pivot. Creatures are ticked so they idle-breathe.
class View {
  constructor(el, model, { yaw = -0.55, animate = false, disposeModel = false } = {}) {
    this.el = el;
    this.animate = animate;
    this.disposeModel = disposeModel;
    this.model = model;

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xb7a1ff, 0x160e28, 0.95));
    const sun = new THREE.DirectionalLight(0xffdca0, 2.0);
    sun.position.set(4, 7, 5);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbfd7ff, 0.55);
    rim.position.set(-4, 2.5, -3);
    this.scene.add(rim);

    this.pivot = new THREE.Group();
    this.pivot.rotation.y = yaw;
    this.scene.add(this.pivot);
    this.pivot.add(model);

    // center on the pivot and frame the camera to the model's bounds — after
    // one anim tick, so floaters (wisps) are framed at hover height, not rest
    if (animate && typeof model.update === "function") model.update(0.016, 0);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    const fov = 42;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    const dist = (radius / Math.tan((fov * Math.PI) / 360)) * 1.42;
    this.camera.position.set(dist * 0.34, radius * 0.32, dist);
    this.camera.lookAt(0, 0, 0);
  }

  tick(dt, t) {
    this.pivot.rotation.y += dt * 0.5;
    if (this.animate && typeof this.model.update === "function") this.model.update(dt, t);
  }

  dispose() {
    if (this.disposeModel && typeof this.model.dispose === "function") {
      try {
        this.model.dispose();
      } catch {
        /* best effort */
      }
    }
    this.pivot.remove(this.model);
  }
}

let views = [];

function disposeViews() {
  for (const v of views) v.dispose();
  views = [];
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w !== vw || h !== vh) {
    vw = w;
    vh = h;
    renderer.setSize(w, h, false);
  }

  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setScissorTest(true);

  if (!views.length) return;

  for (const v of views) {
    const r = v.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w || r.width < 2) continue;
    const bottom = h - r.bottom;
    renderer.setViewport(r.left, bottom, r.width, r.height);
    renderer.setScissor(r.left, bottom, r.width, r.height);
    v.camera.aspect = r.width / r.height;
    v.camera.updateProjectionMatrix();
    v.tick(dt, elapsed);
    renderer.render(v.scene, v.camera);
  }
}

// --- catalogue data --------------------------------------------------------

const TIER_NAMES = { 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Fabled" };

// Which dungeon floors a given item can drop on (LOOT_BY_TIER is indexed by
// the loot tier the roll lands in, which tracks floor depth).
function itemFloors(id) {
  const tiers = [];
  LOOT_BY_TIER.forEach((arr, i) => {
    if (i > 0 && arr.includes(id)) tiers.push(i);
  });
  return tiers;
}

function buildItems() {
  return Object.values(ITEMS).map((it) => ({
    title: it.name,
    id: it.id,
    icon: itemIcon(it.icon),
    badges: [
      { text: `${it.base}g`, kind: "price" },
      { text: `T${it.tier} · ${TIER_NAMES[it.tier]}`, kind: `tier tier${it.tier}` },
    ],
    visual: `<div class="model3d" data-kind="item" data-item="${it.id}"></div>`,
    stats: [
      ["Base value", it.base + "g"],
      ["Tier", `${it.tier} — ${TIER_NAMES[it.tier]}`],
      ["Drops on tiers", itemFloors(it.id).join(", ") || "—"],
    ],
  }));
}

const ENEMY_META = {
  skitter: { name: "Skitter", icon: icon("spider"), desc: "The dungeon's bread-and-butter critter — a scuttling 4-or-6-legged bug that swarms in the shallow floors." },
  slime: { name: "Slime", icon: icon("jelly"), desc: "A wobbling gel blob that hops toward intruders. Slow, but they come in numbers." },
  goblin: { name: "Goblin", icon: icon("goblin"), desc: "A pointy-eared humanoid raider; grows horns and toughens as the floors deepen." },
  wisp: { name: "Wisp", icon: icon("ghost"), desc: "A darting arcane mote — fast and twitchy, floating just off the floor." },
  archer: { name: "Archer", icon: icon("goblin"), desc: "A hooded, robed kiter — hangs back at range and looses fast straight bolts." },
  brute: { name: "Brute", icon: icon("ogre"), desc: "A hulking horned bruiser. Slow but hits twice as hard and soaks up a beating." },
};

// Deterministic seed per kind so the preview looks the same on every reload.
const ENEMY_SEED = { skitter: 7, slime: 12, goblin: 3, wisp: 9, archer: 4, brute: 5 };

// Card copy for the per-hole bosses (index matches BOSSES / Sewer.holes).
const BOSS_META = [
  { icon: icon("spider"), desc: "The Rat Warren's matriarch — a giant rust skitter that leads with room-crossing charges and calls her brood when enraged." },
  { icon: icon("jelly"), desc: "A mountain of waterlogged ooze in the Flooded Deep — ponderous, hugely tough, and drowns the arena in radial orb bursts." },
  { icon: icon("ogre"), desc: "The classic ashen ogre, throned in the Bone Hollow ossuary — the original arena boss, wide slams and heavy charges." },
  { icon: icon("ghost"), desc: "A swollen marsh-light ruling the Gloom Drain — nimble, quick to telegraph, spitting fast dense orb rings." },
];

function enemyFloors(kind) {
  const floors = [];
  FLOOR_MIX.forEach((mix, i) => {
    if (mix.includes(kind)) floors.push(i + 1);
  });
  return floors;
}

function buildEnemies() {
  // regular floor monsters (the base `boss` kind is covered by the Bosses
  // category below — one card per sewer hole's arena keeper)
  const cards = Object.entries(ENEMY_KINDS)
    .filter(([kind]) => kind !== "boss")
    .map(([kind, def]) => {
      const meta = ENEMY_META[kind] || { name: kind, icon: icon("unknown"), desc: "" };
      const badges = [];
      if (kind === "brute") badges.push({ text: "BRUISER", kind: "boss" });
      if (kind === "wisp") badges.push({ text: "FAST", kind: "ranged" });
      return {
        title: meta.name,
        id: kind,
        icon: meta.icon,
        desc: meta.desc,
        badges,
        visual: `<div class="model3d" data-kind="enemy" data-enemy="${kind}"></div>`,
        stats: [
          ["HP", def.hp],
          ["Damage", def.dmg],
          ["Speed", def.speed + " m/s"],
          ["Aggro range", def.aggro + " m"],
          ["Drops loot", `${def.gold[0]}–${def.gold[1]}g worth`],
          ["Floors", enemyFloors(kind).join(", ")],
        ],
      };
    });

  cards.push({ section: "Bosses — one per sewer hole", icon: icon("crown") });
  BOSSES.forEach((_, i) => {
    const def = bossDefFor(i);
    const meta = BOSS_META[i] ?? { icon: icon("unknown"), desc: "" };
    const hole = HOLE_DEFS[i]?.name ?? `Hole ${i}`;
    cards.push({
      title: def.name,
      id: `boss · ${hole.toLowerCase()}`,
      icon: meta.icon,
      desc: meta.desc,
      badges: [{ text: "BOSS", kind: "boss" }],
      visual: `<div class="model3d" data-kind="boss" data-hole="${i}"></div>`,
      stats: [
        ["HP", def.hp],
        ["Damage", def.dmg],
        ["Speed", def.speed + " m/s"],
        ["Base windup", def.windup + "s"],
        ["Ranged rotation", (def.rotation ?? ["charge", "burst"]).join(" → ")],
        ["Burst orbs", `${def.burstN ?? 8} (+4 enraged)`],
        ["Enrage pack", (def.minions ?? ["skitter", "skitter", "slime"]).join(", ")],
        ["Lair", `${hole} — final-floor arena`],
      ],
    });
  });
  return cards;
}

function buildCustomers() {
  const totalW = ARCHETYPES.reduce((s, a) => s + a.w, 0);
  // representative body seeds — just varied so each card shows a different face
  const seeds = [1003, 1041, 1207, 1338];
  return ARCHETYPES.map((a, i) => ({
    title: a.name,
    id: a.name.toLowerCase(),
    icon: icon(a.moods),
    badges: [{ text: `${Math.round((a.w / totalW) * 100)}% of crowd`, kind: "" }],
    visual: `<div class="model3d" data-kind="customer" data-seed="${seeds[i % seeds.length]}"></div>`,
    stats: [
      ["Markup they tolerate", `${a.lo.toFixed(2)}× – ${a.hi.toFixed(2)}×`],
      ["Chance to make an offer", Math.round(a.buy * 100) + "%"],
      ["Spawn weight", a.w],
    ],
  }));
}

// The character art roster: the Kenney "Blocky Characters" pack the hero and
// every shopper are cloned from (character-a … character-r).
function buildCast() {
  const cards = [
    {
      title: "Hero (you)",
      id: "player",
      icon: icon("farmer"),
      badges: [{ text: "PLAYER", kind: "player" }],
      desc: "The shopkeeper you control above and below ground — Blocky variant “a”, scaled to 1.3 m.",
      visual: `<div class="model3d" data-kind="blocky" data-variant="a" data-height="1.3"></div>`,
      stats: [["Model", "character-a"], ["Height", "1.3 m"]],
    },
  ];
  for (const v of CHAR_VARIANTS) {
    cards.push({
      title: `Villager ${v.toUpperCase()}`,
      id: `character-${v}`,
      badges: [{ text: "TOWNSFOLK", kind: "" }],
      visual: `<div class="model3d" data-kind="blocky" data-variant="${v}"></div>`,
      stats: [["Model", `character-${v}`]],
    });
  }
  return cards;
}

// Mirror of the dungeon floor palette (dungeon.js `generate()` — kept in sync
// by hand). Used only to visualise each floor's tile colours here.
const FLOOR_PALETTE = [
  [0x8a70b5, 0x715a99],
  [0x5f93a8, 0x4d7a8c],
  [0xa8756a, 0x8c5f55],
  [0x7a75ad, 0x635e94],
  [0x9c6693, 0x7f5178],
];

function buildFloors() {
  return FLOOR_MIX.map((mix, i) => {
    const floorN = i + 1;
    const tier = Math.min(floorN, 5) - 1;
    const [c0, c1] = FLOOR_PALETTE[Math.min(floorN - 1, 4) % 5];
    const enemyIcons = mix.map((k) => (ENEMY_META[k] ? ENEMY_META[k].name : k)).join(", ");
    return {
      title: `Floor ${floorN}`,
      id: `tier ${tier}`,
      color: c0,
      badges: floorN >= 5 ? [{ text: "DEEPEST", kind: "boss" }] : [],
      desc: `Spawns: ${enemyIcons}.`,
      stats: [
        ["Enemy tier", tier],
        ["Enemies", `≈ ${4 + floorN}–${4 + floorN + 2}`],
        ["Rooms", `≈ ${5 + Math.min(3, Math.floor(floorN / 2))}–${6 + Math.min(3, Math.floor(floorN / 2))}`],
        ["Chest loot tier", Math.min(floorN, 4)],
      ],
      swatches: [
        ["tile A", c0],
        ["tile B", c1],
      ],
    };
  });
}

// --- preview mounting ------------------------------------------------------

function mountPreviews(root) {
  root.querySelectorAll(".model3d").forEach((el) => {
    const kind = el.dataset.kind;
    try {
      if (kind === "item") {
        const model = itemSprite(el.dataset.item);
        views.push(new View(el, model, { disposeModel: false }));
      } else if (kind === "enemy") {
        const k = el.dataset.enemy;
        const def = ENEMY_KINDS[k];
        const creature = new Creature(def.make(ENEMY_SEED[k] ?? 1, 0));
        views.push(new View(el, creature, { animate: true, disposeModel: true }));
      } else if (kind === "boss") {
        const def = bossDefFor(Number(el.dataset.hole));
        const creature = new Creature(def.make(54321, 2));
        views.push(new View(el, creature, { animate: true, disposeModel: true }));
      } else if (kind === "blocky" || kind === "customer") {
        const variant = kind === "customer" ? variantForSeed(Number(el.dataset.seed)) : el.dataset.variant;
        const height = el.dataset.height ? Number(el.dataset.height) : 1.6;
        const body = new BlockyCreature(variant, { height });
        views.push(new View(el, body, { animate: true, yaw: -0.4, disposeModel: true }));
      }
    } catch (err) {
      console.error("preview failed", kind, err);
      el.classList.add("model3d--failed");
    }
  });
}

// --- tabs ------------------------------------------------------------------

const TABS = [
  { id: "items", icon: "shopping", label: "Merchandise", build: buildItems, unit: "item" },
  { id: "enemies", icon: "ogre", label: "Monsters", build: buildEnemies, unit: "monster" },
  { id: "customers", icon: "faceHappy", label: "Shoppers", build: buildCustomers, unit: "archetype" },
  { id: "cast", icon: "people", label: "Cast", build: buildCast, unit: "character" },
  { id: "floors", icon: "hole", label: "Dungeon", build: buildFloors, unit: "floor" },
];

function render(tabId) {
  const tab = TABS.find((t) => t.id === tabId) || TABS[0];
  disposeViews();
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab.id);
  });

  const entries = tab.build();
  const body = document.getElementById("admin-body");
  const n = entries.filter((e) => !e.section).length;
  body.innerHTML = `
    <div class="section-head">
      <h2>${icon(tab.icon)} ${esc(tab.label)}</h2>
      <span class="count">${n} ${n === 1 ? tab.unit : tab.unit + "s"}</span>
    </div>
    ${grid(entries)}`;
  mountPreviews(body);

  if (location.hash !== "#" + tab.id) history.replaceState(null, "", "#" + tab.id);
}

function mount() {
  const app = document.getElementById("admin-app");
  app.innerHTML = `
    <header class="admin-header">
      <div class="brand">
        <span class="brand-mark">${icon("shop")}</span>
        <div>
          <h1>Coin Cellar — Admin</h1>
          <p>Read-only catalogue of every game definition</p>
        </div>
      </div>
      <div class="header-links">
        <a class="back-link" href="/lab.html">${icon("flask")} Creature Lab</a>
        <a class="back-link" href="/">${icon("arrowLeft")} Back to shop</a>
      </div>
    </header>
    <nav class="tabs">
      ${TABS.map((t) => `<button class="tab" data-tab="${t.id}">${icon(t.icon)} ${esc(t.label)}</button>`).join("")}
    </nav>
    <main id="admin-body"></main>`;

  app.querySelectorAll(".tab").forEach((el) => {
    el.addEventListener("click", () => render(el.dataset.tab));
  });
  window.addEventListener("hashchange", () => render(location.hash.slice(1)));

  render(location.hash.slice(1) || TABS[0].id);
  renderLoop();
}

// --- boot ------------------------------------------------------------------

async function boot() {
  const app = document.getElementById("admin-app");
  app.innerHTML = `<div class="boot">Loading character roster…</div>`;
  try {
    await loadCharacters();
  } catch (err) {
    console.error("character load failed", err);
  }
  mount();
}

boot();
