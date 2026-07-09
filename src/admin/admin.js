// Coin Cellar — Admin data browser.
// A standalone, read-only catalogue of every game definition (merchandise,
// dungeon monsters, shopper archetypes, the character roster, and the floor
// progression). Served at /admin via its own Vite entry; it imports the exact
// source-of-truth modules the game uses and rebuilds the real meshes, so the
// catalogue always reflects the current game — it can't drift.
import * as THREE from "three";

import { ITEMS, itemSprite, EQUIP_DROPS } from "../game/items.js";
import { ENEMY_KINDS, DUNGEON_MIX, HOLE_THEMES, DUNGEON_LOOT, BOSSES, bossDefFor, FLOORS_PER_DUNGEON } from "../game/dungeon.js";
import { HOLE_DEFS } from "../game/cellar.js";
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
// stats?, swatches?, visual?, tier? } — `tier` paints the card's edge with the
// item's loot-rarity colour (see admin.css .card--tN).
function card(entry) {
  const tierCls = entry.tier ? ` card--t${entry.tier}` : "";
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
  return `<article class="card${tierCls}">${head}${visual}${desc}${stats}${sw}</article>`;
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

// Which themed dungeons a given item drops in (from the per-dungeon loot
// tables plus each monster kind's signature loot list).
function itemDungeons(id) {
  const names = [];
  DUNGEON_LOOT.forEach((table, d) => {
    const fromKinds = DUNGEON_MIX[d]?.some((mix) => mix.some((k) => ENEMY_KINDS[k]?.loot?.includes(id)));
    if (table.common.includes(id) || table.rare.includes(id) || fromKinds)
      names.push(HOLE_DEFS[d]?.name ?? `Dungeon ${d + 1}`);
  });
  return names;
}

function buildItems() {
  return Object.values(ITEMS).map((it) => ({
    title: it.name,
    id: it.id,
    tier: it.tier,
    icon: itemIcon(it.icon),
    badges: [
      { text: `${it.base}g`, kind: "price" },
      { text: `T${it.tier} · ${TIER_NAMES[it.tier]}`, kind: `tier tier${it.tier}` },
    ],
    visual: `<div class="model3d" data-kind="item" data-item="${it.id}"></div>`,
    stats: [
      ["Base value", it.base + "g"],
      ["Tier", `${it.tier} — ${TIER_NAMES[it.tier]}`],
      ["Drops in", itemDungeons(it.id).join(", ") || "—"],
    ],
  }));
}

// --- loot table ------------------------------------------------------------
// A reverse index of every drop table: for each item, where it can turn up and
// the odds of it showing from that specific source. Every probability is
// derived straight from the tables the game rolls against (see dungeon.js:
// openChest / killEnemy), so the catalogue can't drift from the real drops.

// Human-friendly percentage from a 0..1 chance.
function pctStr(f) {
  if (f <= 0) return "—";
  const p = f * 100;
  if (p < 0.1) return "<0.1%";
  return (p < 10 ? p.toFixed(1) : Math.round(p)) + "%";
}

// Chance a freshly-opened chest in themed dungeon `d` holds item `id`, averaged
// across the dungeon's floors (the rare shelf grows likelier the deeper you go).
// Mirrors Dungeon.openChest: a primary roll (rare vs common) plus a 60% bonus
// common drop.
function chestChance(id, d) {
  const table = DUNGEON_LOOT[d];
  if (!table) return 0;
  const inC = table.common.includes(id);
  const inR = table.rare.includes(id);
  if (!inC && !inR) return 0;
  const nc = table.common.length || 1;
  const nr = table.rare.length || 1;
  let sum = 0;
  for (let lf = 0; lf < FLOORS_PER_DUNGEON; lf++) {
    const rare = 0.22 + lf * 0.18; // openChest's rare-shelf odds per floor
    const first = rare * (inR ? 1 / nr : 0) + (1 - rare) * (inC ? 1 / nc : 0);
    const second = inC ? 0.6 * (1 / nc) : 0; // the bonus second drop (common only)
    sum += 1 - (1 - first) * (1 - second);
  }
  return sum / FLOORS_PER_DUNGEON;
}

// Chance a monster drops item `id` as its signature loot (killEnemy: dropRate,
// then 65% of the time it's the kind's own loot, picked evenly).
function mobSignatureChance(def, id) {
  if (!def.loot?.includes(id)) return 0;
  return (def.dropRate ?? 0.6) * 0.65 / def.loot.length;
}

// Best single-boss chance for item `id` across the four keepers (each fight is
// one hole). Bosses always drop a crown + a potion, two distinct equipment
// pieces from EQUIP_DROPS, and a fistful of the hole's rare spoils.
const EQUIP_PICK_P = 2 / (EQUIP_DROPS.length || 1); // odds a given equip is one of the 2 picks
function bossChance(id) {
  const isEquip = EQUIP_DROPS.includes(id);
  const guaranteed = id === "crown" || id === "potion";
  let best = 0;
  BOSSES.forEach((_, hole) => {
    const parts = [];
    if (guaranteed) parts.push(1);
    if (isEquip) parts.push(EQUIP_PICK_P);
    const table = DUNGEON_LOOT[hole];
    if (table?.rare.includes(id)) {
      const k = 3 + hole; // rare spoils rolled from this hole's table
      parts.push(1 - Math.pow(1 - 1 / (table.rare.length || 1), k));
    }
    if (parts.length) best = Math.max(best, 1 - parts.reduce((q, a) => q * (1 - a), 1));
  });
  return best;
}

// Every place item `id` can be found, each with its own drop chance.
function lootSources(id) {
  const sources = [];
  // a monster's signature loot
  for (const [kind, def] of Object.entries(ENEMY_KINDS)) {
    if (kind === "boss") continue;
    const p = mobSignatureChance(def, id);
    if (p > 0) sources.push({ kind: "mob", where: `${ENEMY_META[kind]?.name ?? kind} loot`, p });
  }
  // themed-dungeon chests
  DUNGEON_LOOT.forEach((_, d) => {
    const p = chestChance(id, d);
    if (p > 0) sources.push({ kind: "chest", where: `${HOLE_DEFS[d]?.name ?? `Dungeon ${d + 1}`} chest`, p });
  });
  // boss spoils
  const bp = bossChance(id);
  if (bp > 0) sources.push({ kind: "boss", where: "Boss spoils", p: bp });
  return sources.sort((a, b) => b.p - a.p);
}

function buildLoot() {
  const items = Object.values(ITEMS)
    .map((it) => ({ it, src: lootSources(it.id) }))
    .sort((a, b) => a.it.tier - b.it.tier || a.it.base - b.it.base);

  const rows = items
    .map(({ it, src }) => {
      const best = src.length ? src[0].p : 0;
      const chips = src.length
        ? src
            .map((s) => `<span class="loot-src loot-src--${s.kind}">${esc(s.where)} <b>${pctStr(s.p)}</b></span>`)
            .join("")
        : `<span class="loot-src loot-src--none">shop / quest only</span>`;
      return `<tr class="loot-row loot-t${it.tier}">
        <td class="loot-ic">${itemIcon(it.icon)}</td>
        <td class="loot-name"><b>${esc(it.name)}</b><span class="loot-tier tier${it.tier}">T${it.tier} · ${TIER_NAMES[it.tier]}</span></td>
        <td class="loot-pct">${pctStr(best)}</td>
        <td class="loot-where">${chips}</td>
        <td class="loot-price">${it.base}g</td>
      </tr>`;
    })
    .join("");

  const html = `
    <table class="loot-table">
      <thead>
        <tr>
          <th class="loot-ic"></th>
          <th class="loot-name">Item</th>
          <th class="loot-pct">Best drop</th>
          <th class="loot-where">Where it drops</th>
          <th class="loot-price">Price</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  return { html, n: items.length };
}

const ENEMY_META = {
  skitter: { name: "Skitter", icon: icon("spider"), desc: "The Rat Warren's bread-and-butter critter — a scuttling 4-or-6-legged bug that swarms in the shallow floors." },
  slime: { name: "Slime", icon: icon("jelly"), desc: "A wobbling gel blob that hops toward intruders. Slow, but they come in numbers." },
  goblin: { name: "Goblin", icon: icon("goblin"), desc: "A pointy-eared humanoid raider; grows horns and toughens as the floors deepen." },
  wisp: { name: "Wisp", icon: icon("ghost"), desc: "A darting arcane mote — fast and twitchy, floating just off the floor." },
  archer: { name: "Archer", icon: icon("goblin"), desc: "A hooded, robed kiter — hangs back at range and looses fast straight bolts." },
  brute: { name: "Brute", icon: icon("ogre"), desc: "A hulking horned bruiser. Slow but hits twice as hard and soaks up a beating." },
  puddle: { name: "Puddle", icon: icon("jelly"), desc: "A waterlogged blob of the Flooded Deep. Pounces like a slime — and bursts into two Puddlings when it dies." },
  puddling: { name: "Puddling", icon: icon("jelly"), desc: "The droplets a slain Puddle splits into: tiny, quick and frail, swarming in to bite." },
  snapper: { name: "Snapper", icon: icon("spider"), desc: "A four-legged tide crab that circles its prey and darts in with a quick pinch." },
  angler: { name: "Angler", icon: icon("ghost"), desc: "A deep-water lure light. It marks a splash zone under your feet and erupts a geyser — step off the ring to dodge." },
  rattler: { name: "Rattler", icon: icon("spider"), desc: "A dry bone-bug of the Hollow — faster and twitchier than the warren's skitters." },
  gravewisp: { name: "Gravewisp", icon: icon("ghost"), desc: "A pale grave-light caster whose bolts fly noticeably faster than a wisp's orbs." },
  boneguard: { name: "Boneguard", icon: icon("ogre"), desc: "A bleached ossuary sentinel. Telegraphs a lane of sparks, then hurls itself down it — step out of the lane." },
  sporeling: { name: "Sporeling", icon: icon("jelly"), desc: "A walking spore sac of the Gloom Drain. Rushes in, swells, and blows itself apart — the ring shows the blast." },
  gloomcaster: { name: "Gloomcaster", icon: icon("ghost"), desc: "A slippery marsh-light that marks a ripple at your flank, blinks onto it and fires the instant it lands." },
  mossbrute: { name: "Mossbrute", icon: icon("ogre"), desc: "A moss-grown hulk — the drain's answer to the brute, with a wider slam and more meat on it." },
};

// Deterministic seed per kind so the preview looks the same on every reload.
const ENEMY_SEED = {
  skitter: 7, slime: 12, goblin: 3, wisp: 9, archer: 4, brute: 5,
  puddle: 6, puddling: 8, snapper: 11, angler: 2,
  rattler: 13, gravewisp: 5, boneguard: 1, sporeling: 10, gloomcaster: 3, mossbrute: 2,
};

// Card copy for the per-hole bosses (index matches BOSSES / Cellar.holes).
const BOSS_META = [
  { icon: icon("spider"), desc: "The Rat Warren's matriarch — a giant rust skitter that leads with room-crossing charges and calls her brood when enraged." },
  { icon: icon("jelly"), desc: "A mountain of waterlogged ooze in the Flooded Deep — ponderous, hugely tough, and drowns the arena in radial orb bursts." },
  { icon: icon("ogre"), desc: "The classic ashen ogre, throned in the Bone Hollow ossuary — the original arena boss, wide slams and heavy charges." },
  { icon: icon("ghost"), desc: "A swollen marsh-light ruling the Gloom Drain — nimble, quick to telegraph, spitting fast dense orb rings." },
];

function enemyFloors(kind) {
  const floors = [];
  DUNGEON_MIX.forEach((mixes, d) => {
    mixes.forEach((mix, f) => {
      if (mix.includes(kind)) floors.push(d * mixes.length + f + 1);
    });
  });
  return floors;
}

function buildEnemies() {
  // regular floor monsters (the base `boss` kind is covered by the Bosses
  // category below — one card per cellar mouth's arena keeper)
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

  cards.push({ section: "Bosses — one per cellar mouth", icon: icon("crown") });
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
        ["Base windup", def.windup.toFixed(2) + "s"],
        ["Ranged rotation", (def.rotation ?? ["charge", "burst"]).join(" → ")],
        ["Burst orbs", `${def.burstN ?? 8} (+4 enraged)`],
        ["Enrage pack", `${def.minionN ?? 3} × ${(def.minions ?? ["skitter", "skitter", "slime"]).join("/")}`],
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

function buildFloors() {
  // one card per floor of the full 12-floor descent, grouped by themed
  // dungeon — mixes and tile palettes come straight from dungeon.js
  const cards = [];
  DUNGEON_MIX.forEach((mixes, d) => {
    const holeName = HOLE_DEFS[d]?.name ?? `Dungeon ${d + 1}`;
    mixes.forEach((mix, f) => {
      const floorN = d * mixes.length + f + 1;
      const tier = Math.min(floorN, 5) - 1;
      const palettes = HOLE_THEMES[d]?.palettes ?? [[0x8a70b5, 0x715a99]];
      const [c0, c1] = palettes[Math.min(f, palettes.length - 1)];
      const enemyIcons = mix.map((k) => (ENEMY_META[k] ? ENEMY_META[k].name : k)).join(", ");
      const isBoss = f === mixes.length - 1;
      cards.push({
        title: `Floor ${floorN} — ${holeName}`,
        id: `tier ${tier}`,
        color: c0,
        badges: isBoss ? [{ text: "BOSS", kind: "boss" }] : [],
        desc: `Spawns: ${enemyIcons}.${isBoss ? " The sealed arena waits at the far end." : ""}`,
        stats: [
          ["Enemy tier", tier],
          ["Enemies", `≈ ${4 + floorN}–${4 + floorN + 2}`],
          ["Rooms", `≈ ${5 + Math.min(3, Math.floor(floorN / 2))}–${6 + Math.min(3, Math.floor(floorN / 2))}`],
          ["Dungeon", holeName],
        ],
        swatches: [
          ["tile A", c0],
          ["tile B", c1],
        ],
      });
    });
  });
  return cards;
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
  { id: "loot", icon: "chest", label: "Loot", build: buildLoot, unit: "item" },
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

  // most tabs build an array of card entries; a few (Loot) build a ready-made
  // block of HTML instead — those return { html, n } so we skip the card grid.
  const built = tab.build();
  const isBlock = built && !Array.isArray(built) && built.html != null;
  const body = document.getElementById("admin-body");
  const n = isBlock ? built.n : built.filter((e) => !e.section).length;
  body.innerHTML = `
    <div class="section-head">
      <h2>${icon(tab.icon)} ${esc(tab.label)}</h2>
      <span class="count">${n} ${n === 1 ? tab.unit : tab.unit + "s"}</span>
    </div>
    ${isBlock ? built.html : grid(built)}`;
  mountPreviews(body);

  // NB: index.html sets <base href="/">, so a bare "#id" would resolve against
  // "/" and drop the /admin/ path — keep the current path explicitly.
  if (location.hash !== "#" + tab.id)
    history.replaceState(null, "", location.pathname + location.search + "#" + tab.id);
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
