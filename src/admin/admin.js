// Coin Cellar — Admin data browser.
// A standalone, read-only catalogue of every game definition (merchandise,
// dungeon monsters, shopper archetypes, the character roster, and the floor
// progression). Served at /admin via its own Vite entry; it imports the exact
// source-of-truth modules the game uses and rebuilds the real meshes, so the
// catalogue always reflects the current game — it can't drift.
import * as THREE from "three";

import { ITEMS, itemSprite, itemMesh, EQUIP_DROPS, ITEM_KINDS, ITEM_KIND_LABELS } from "../game/items.js";
import { makeChest, makeGate, makeStairs, makeDescent } from "../game/dungeon-geometry.js";
import { makeCaveMouth, buildLotParts } from "../game/shop-build.js";
import layoutData from "../game/layout.json";
import { weaponMesh } from "../game/gear.js";
import { ENEMY_KINDS, DUNGEON_MIX, HOLE_THEMES, DUNGEON_LOOT, BOSSES, bossDefFor, FLOORS_PER_DUNGEON } from "../game/dungeon.js";
import { HOLE_DEFS } from "../game/cave.js";
import { ARCHETYPES } from "../game/shop.js";
import { NPCS, CROWD_NPCS, PERSONALITIES, personalityName, personalityArchetype, personalityTaste, REFLECTION_BUCKETS, SPECIAL_REACTIONS, TIMES_OF_DAY, npcIntroLines, OCCASIONS, OCCASION_LINES, PLAYER_DEEDS, DEED_LINES, activeOccasions } from "../game/npc-data.js";
import { Creature } from "../chargen/creature.js";
import { BlockyCreature, variantForSeed } from "../chargen/blocky.js";
import { CHAR_VARIANTS, loadCharacters } from "../chargen/assets.js";
import { mountFarmViewer } from "../chargen/voxel/farmViewer.js";
import { icon, itemIcon } from "../core/icons.js";
import { ATTACK_MODES, COMBAT_SLIDERS, combat, attackMode, setCombatSettings, saveCombatSettings } from "../game/combat-settings.js";

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
  const lines = (entry.lines || []).length
    ? `<ul class="card-lines">${entry.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : (entry.lineGroups || []).length
      ? entry.lineGroups
          .filter((g) => (g.lines || []).length)
          .map((g) => `<div class="card-lines-group"><span class="card-lines-time">${esc(g.label)}</span><ul class="card-lines">${g.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`)
          .join("")
      : "";
  return `<article class="card${tierCls}">${head}${visual}${desc}${stats}${sw}${lines}</article>`;
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

// The Farm tab runs its own self-contained WebGL viewer (own canvas + rAF),
// separate from the shared scissor renderer that drives the .model3d cards.
// render() calls this before drawing a new tab so leaving Farm tears it down.
let _farmDispose = null;

function disposeViews() {
  for (const v of views) v.dispose();
  views = [];
  if (_farmDispose) {
    _farmDispose();
    _farmDispose = null;
  }
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
  // Each townsperson shops as a fixed archetype set by their personality, so the
  // crowd's wealth mix is just the count of townsfolk per archetype (the whole
  // town roams and shops now — Mayor and Clerk included).
  const counts = new Map(ARCHETYPES.map((a) => [a.name, 0]));
  for (const npc of CROWD_NPCS) {
    const name = personalityArchetype(npc);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const total = CROWD_NPCS.length || 1;
  // representative body seeds — just varied so each card shows a different face
  const seeds = [1003, 1041, 1207, 1338];
  return ARCHETYPES.map((a, i) => {
    const n = counts.get(a.name) || 0;
    return {
      title: a.name,
      id: a.name.toLowerCase(),
      icon: icon(a.moods),
      badges: [{ text: `${Math.round((n / total) * 100)}% of crowd`, kind: "" }],
      visual: `<div class="model3d" data-kind="customer" data-seed="${seeds[i % seeds.length]}"></div>`,
      stats: [
        ["Markup they tolerate", `${a.lo.toFixed(2)}× – ${a.hi.toFixed(2)}×`],
        ["Chance to make an offer", Math.round(a.buy * 100) + "%"],
        ["Townsfolk of this type", n],
      ],
    };
  });
}

// The named townsfolk. Every shopper and street passer-by is one of these
// residents, and everything the game knows about a person now lives on a single
// full-width card: their skin and personality voice up front, and behind
// per-card tabs their small talk (by time of day), their first-meeting intro,
// their shopping tastes, and what they say after a trip. One resident per row.

// A resident's shopper archetype definition (markup range + offer chance), or
// null if their personality maps to an unknown archetype.
function npcArchetypeDef(npc) {
  const name = personalityArchetype(npc);
  return ARCHETYPES.find((a) => a.name === name) || null;
}

// A single quoted-lines list (an NPC's spoken bubbles), or an em-dash if empty.
function linesList(lines) {
  return (lines || []).length
    ? `<ul class="card-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : `<p class="npc-empty">—</p>`;
}

// Grouped line columns (time-of-day buckets, reflection outcomes…) laid out
// across the row so a card uses its full width instead of one tall column.
function lineColumns(groups) {
  const cols = groups
    .filter((g) => (g.lines || []).length)
    .map((g) => `<div class="npc-col"><span class="npc-col-h">${esc(g.label)}</span>${linesList(g.lines)}</div>`)
    .join("");
  return cols ? `<div class="npc-cols">${cols}</div>` : `<p class="npc-empty">No lines yet.</p>`;
}

// The four kind multipliers as little labelled bars — >1 draws them in (green),
// <1 turns their nose up (red). Bar fills relative to a 2× ceiling.
function tasteBars(taste) {
  return `<div class="taste-bars">${ITEM_KINDS.map((k) => {
    const m = taste.kinds[k] ?? 1;
    const cls = m > 1.05 ? "up" : m < 0.95 ? "down" : "even";
    const w = Math.max(4, Math.min(100, Math.round((m / 2) * 100)));
    return `<div class="taste-bar taste-bar--${cls}">
      <span class="taste-bar-k">${esc(ITEM_KIND_LABELS[k])}</span>
      <span class="taste-bar-track"><i style="width:${w}%"></i></span>
      <span class="taste-bar-v">${m.toFixed(2)}×</span>
    </div>`;
  }).join("")}</div>`;
}

// The Tastes panel: temperament blurb, the kind-appeal bars, and the shopper
// numbers (archetype, tolerated markup, offer chance) plus the tier lean.
function npcTastePanel(npc) {
  const persona = PERSONALITIES[npc.personality];
  const taste = personalityTaste(npc);
  const { favours, avoids, leanTxt } = tasteSummary(taste);
  const arch = npcArchetypeDef(npc);
  const shopStats = arch
    ? [
        ["Shops as", arch.name],
        ["Markup they tolerate", `${arch.lo.toFixed(2)}× – ${arch.hi.toFixed(2)}×`],
        ["Chance to make an offer", Math.round(arch.buy * 100) + "%"],
      ]
    : [["Shops as", personalityArchetype(npc)]];
  const stats = [...shopStats, ["Tier lean", leanTxt], ["Favours", favours.join(", ") || "—"], ["Turns up nose at", avoids.join(", ") || "—"]];
  return `
    <p class="npc-blurb">${esc(persona.blurb)}</p>
    ${tasteBars(taste)}
    <div class="stats">${stats.map(([k, v]) => stat(k, v)).join("")}</div>`;
}

// The signature-item reactions for this voice: bespoke lines for the handful of
// items the temperament fixates on (see SPECIAL_REACTIONS). Empty if it has none.
function npcSignaturePanel(npc) {
  const specials = SPECIAL_REACTIONS[npc.personality] || {};
  const items = Object.entries(specials);
  if (!items.length) return "";
  return items
    .map(([itemId, byBucket]) => {
      const it = ITEMS[itemId];
      const groups = REFLECTION_BUCKETS
        .filter((b) => byBucket[b.id]?.length)
        .map((b) => ({ label: b.label, lines: byBucket[b.id] }));
      return `<div class="npc-signature">
        <div class="npc-signature-head">${itemIcon(itemId)}<b>${esc(it?.name || itemId)}</b><span class="badge boss">SIGNATURE</span></div>
        ${lineColumns(groups)}
      </div>`;
    })
    .join("");
}

// The After-shopping panel: the generic per-outcome reflection lines, then the
// taste-hint "wishlist" asides they follow up with, then the bespoke
// signature-item reactions if this resident has any.
function npcReflectPanel(npc) {
  const generic = lineColumns(REFLECTION_BUCKETS.map((b) => ({ label: b.label, lines: npc.buyLines?.[b.id] || [] })));
  const wish = npc.wishLines?.length
    ? `<div class="npc-sub-h">Wishlist hint (what to stock)</div>${lineColumns([{ label: "Hint", lines: npc.wishLines }])}`
    : "";
  const sig = npcSignaturePanel(npc);
  return `${generic}${wish}${sig ? `<div class="npc-sub-h">Signature items</div>${sig}` : ""}`;
}

// The Occasions panel: what this resident says on notable calendar days —
// their bespoke voice line where they have one, else the shared "(shared)"
// default every resident falls back to. Holidays first, then day-of-the-week.
function npcOccasionsPanel(npc) {
  const groups = OCCASIONS.map((o) => {
    const own = OCCASION_LINES[npc.personality]?.[o.id];
    const shared = !(own && own.length);
    const lines = shared ? OCCASION_LINES._default[o.id] || [] : own;
    return { label: `${o.label}${shared ? " · shared" : ""}`, lines };
  });
  return `<p class="npc-blurb">Greets you differently on these days (a holiday always wins over the weekday flavour).</p>${lineColumns(groups)}`;
}

// The Player-deeds panel: how this resident reacts when the player pulls off
// something notable underground. {boss}/{place}/{floor} are filled in live from
// the deed; "(shared)" marks the generic fallback lines.
function npcDeedsPanel(npc) {
  const groups = PLAYER_DEEDS.map((d) => {
    const own = DEED_LINES[npc.personality]?.[d.id];
    const shared = !(own && own.length);
    const lines = shared ? DEED_LINES._default[d.id] || [] : own;
    return { label: `${d.label}${shared ? " · shared" : ""}`, lines };
  });
  return `<p class="npc-blurb">Said once, the next time you chat after the deed. <code>{boss}</code>, <code>{place}</code> and <code>{floor}</code> fill in from what you did.</p>${lineColumns(groups)}`;
}

// One full-width card per resident: portrait + identity on the left, and the
// content tabs (small talk / first meeting / tastes / after shopping /
// occasions / player deeds) on the right, wired up by mountCardTabs after render.
function characterCard(npc) {
  const persona = PERSONALITIES[npc.personality];
  const badges = [{ text: personalityName(npc), kind: "" }, { text: personalityArchetype(npc), kind: "" }];
  if (npc.reserved) badges.push({ text: "STORY CAMEO", kind: "boss" });
  const intro = npcIntroLines(npc);
  const panels = [
    {
      id: "talk",
      label: "Small talk",
      body: lineColumns(TIMES_OF_DAY.map((t) => ({ label: `${t[0].toUpperCase()}${t.slice(1)}`, lines: npc.lines?.[t] || [] }))),
    },
    {
      id: "intro",
      label: "First meeting",
      body: intro.length
        ? `<ul class="card-lines">${intro.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
        : `<p class="npc-empty">Opens straight into small talk — no special intro.</p>`,
    },
    {
      id: "arrive",
      label: "Heading to shop",
      body: npc.arriveLines?.length
        ? `<p class="npc-blurb">Floats over their head as they head in to shop.</p>${linesList(npc.arriveLines)}`
        : `<p class="npc-empty">No arrival lines — they walk in quietly.</p>`,
    },
    { id: "taste", label: "Tastes", body: npcTastePanel(npc) },
    { id: "reflect", label: "After shopping", body: npcReflectPanel(npc) },
    { id: "occasions", label: "Occasions", body: npcOccasionsPanel(npc) },
    { id: "deeds", label: "Player deeds", body: npcDeedsPanel(npc) },
  ];
  return `
    <article class="npc-card">
      <div class="npc-portrait">
        <div class="model3d" data-kind="blocky" data-variant="${npc.variant}"></div>
        <h3>${icon(persona.mood)} ${esc(npc.name)}</h3>
        <code class="card-id">${esc(npc.id)} · character-${npc.variant}</code>
        <div class="npc-badges">${badges.map((b) => badge(b.text, b.kind)).join("")}</div>
      </div>
      <div class="npc-detail">
        <div class="npc-tabs" role="tablist">
          ${panels.map((p, i) => `<button class="npc-tab${i === 0 ? " active" : ""}" data-ct="${p.id}">${esc(p.label)}</button>`).join("")}
        </div>
        <div class="npc-panels">
          ${panels.map((p, i) => `<div class="npc-panel${i === 0 ? " active" : ""}" data-cp="${p.id}">${p.body}</div>`).join("")}
        </div>
      </div>
    </article>`;
}

function buildNpcs() {
  // a quick read on today's real-world date: which occasion greeting the town
  // would actually lead with right now (holidays win over the weekday flavour)
  const today = activeOccasions();
  const occNote = today.length
    ? `Today (${new Date().toDateString()}) is <b>${today.map((o) => esc(o.label)).join(" · ")}</b> — residents lead with the “${esc(today[0].label)}” greeting.`
    : `No special occasion today (${new Date().toDateString()}) — residents open with ordinary small talk.`;
  const banner = `<div class="admin-banner">${icon("speak")} ${occNote} See each resident's <b>Occasions</b> and <b>Player deeds</b> tabs for their reactions.</div>`;
  const html = `${banner}<div class="npc-list">${NPCS.map(characterCard).join("")}</div>`;
  return { html, n: NPCS.length };
}

// A short human summary of a personality's item taste: which kinds tempt them
// (mult > 1), which they turn their nose up at (mult < 1), and their tier lean.
function tasteSummary(taste) {
  const favours = ITEM_KINDS
    .filter((k) => (taste.kinds[k] ?? 1) > 1.05)
    .sort((a, b) => (taste.kinds[b] ?? 1) - (taste.kinds[a] ?? 1))
    .map((k) => ITEM_KIND_LABELS[k]);
  const avoids = ITEM_KINDS
    .filter((k) => (taste.kinds[k] ?? 1) < 0.95)
    .sort((a, b) => (taste.kinds[a] ?? 1) - (taste.kinds[b] ?? 1))
    .map((k) => ITEM_KIND_LABELS[k]);
  const lean = taste.tierLean;
  const leanTxt = lean > 0.3 ? `leans costly (+${lean.toFixed(1)})`
    : lean < -0.3 ? `leans thrifty (${lean.toFixed(1)})`
    : "no strong tier lean";
  return { favours, avoids, leanTxt };
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
      desc: "The shopkeeper you control above and below ground — Blocky variant “a”, scaled to 1.5 m.",
      visual: `<div class="model3d" data-kind="blocky" data-variant="a" data-height="1.5"></div>`,
      stats: [["Model", "character-a"], ["Height", "1.5 m"]],
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

// --- town & world models ---------------------------------------------------
// The buildings and set-dressing of the overworld: the dungeon's cave mouth
// and every restoration lot's two states (the boarded-up plot / stone ruin,
// and the finished house it becomes). Built by the exact game constructors —
// makeCaveMouth and buildLotParts from shop-build.js, fed the committed
// layout.json — so the catalogue mirrors the real village.

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// key -> factory, shared by buildTown (reads the breakdown) and mountPreviews
// (builds the live View). Repopulated on every buildTown() call.
const _townFactories = new Map();

function buildTown() {
  _townFactories.clear();
  const cards = [];

  const add = (key, entry, make) => {
    _townFactories.set(key, make);
    let bd = { meshes: 0, parts: [] };
    try {
      bd = primitiveBreakdown(make());
    } catch (err) {
      console.error("town build failed", key, err);
    }
    cards.push({
      ...entry,
      badges: [{ text: `${bd.meshes} ${bd.meshes === 1 ? "part" : "parts"}` }, ...(entry.badges || [])],
      desc: entry.desc ?? (bd.parts.length ? `Assembled from ${bd.parts.join(", ")}.` : undefined),
      visual: `<div class="model3d" data-kind="town" data-town="${key}"></div>`,
    });
  };

  // the dungeon's front door — the rocky mouth capping the village road
  cards.push({ section: "Dungeon entrance", icon: icon("hole") });
  add("cave", {
    title: "Cave Mouth",
    id: "dungeon entrance",
    icon: icon("hole"),
    desc: "The rocky maw at the top of the road — walking into it steps down to the cave lobby and its four trapdoors.",
  }, () => makeCaveMouth());

  // the restoration lots: each is a buildable plot the Mayor's fund rebuilds.
  // Show the finished houses first, then the derelict states they start in.
  const lots = layoutData.lots || [];
  cards.push({ section: "Village houses — restored", icon: icon("home") });
  lots.forEach((lot, i) => {
    add(`house:${i}`, {
      title: `${cap(lot.kind)} house ${i + 1}`,
      id: `lot ${i + 1} · restored`,
      icon: icon("home"),
      badges: [{ text: `${lot.cost}g`, kind: "price" }],
      desc: `The finished home revealed when lot ${i + 1} is rebuilt; a new resident then moves in and shops here.`,
    }, () => buildLotParts(lot.after));
  });
  cards.push({ section: "Derelict lots — before restoration", icon: icon("hole") });
  lots.forEach((lot, i) => {
    add(`ruin:${i}`, {
      title: lot.kind === "ruin" ? `Stone ruin ${i + 1}` : `Boarded plot ${i + 1}`,
      id: `lot ${i + 1} · ${lot.kind}`,
      icon: icon("hole"),
      badges: [{ text: lot.kind.toUpperCase() }],
      desc: `The run-down site the player pays ${lot.cost}g to rebuild into ${lot.kind === "ruin" ? "the house above" : "a home"}.`,
    }, () => buildLotParts(lot.before));
  });

  return cards;
}

// --- primitive models ------------------------------------------------------
// Every mesh the game assembles by hand from raw THREE primitives (boxes,
// cylinders, spheres…) instead of a loaded art asset. The same constructors
// the game ships are called here, so the per-card geometry breakdown is the
// real thing. The dungeon fixtures fall back to their primitive form because
// the admin never loads the KayKit pack (dungeonAssetsReady() stays false).

const GEO_LABEL = {
  BoxGeometry: "Box", CylinderGeometry: "Cylinder", SphereGeometry: "Sphere",
  ConeGeometry: "Cone", TorusGeometry: "Torus", CapsuleGeometry: "Capsule",
  OctahedronGeometry: "Octahedron", IcosahedronGeometry: "Icosahedron",
  ExtrudeGeometry: "Extruded shape", PlaneGeometry: "Plane",
};

// Tally the geometry primitives a model is composed of, e.g. "3× Cylinder,
// 2× Sphere" — read straight off the built meshes so it can't drift.
function primitiveBreakdown(model) {
  const counts = new Map();
  let meshes = 0;
  model.traverse((o) => {
    if (o.isMesh && o.geometry) {
      meshes++;
      const type = o.geometry.type || "Geometry";
      const label = GEO_LABEL[type] || type.replace(/Geometry$/, "");
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  });
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${n}× ${label}`);
  return { meshes, parts };
}

// key -> factory, shared by the card builder (which builds one to read its
// breakdown) and mountPreviews (which builds another for the live View).
// Repopulated on every buildPrimitives() call.
const _primFactories = new Map();

function buildPrimitives() {
  _primFactories.clear();
  const cards = [];

  const add = (key, entry, make) => {
    _primFactories.set(key, make);
    let bd = { meshes: 0, parts: [] };
    try {
      bd = primitiveBreakdown(make());
    } catch (err) {
      console.error("primitive build failed", key, err);
    }
    cards.push({
      ...entry,
      icon: entry.icon ?? icon("box"),
      badges: [{ text: `${bd.meshes} ${bd.meshes === 1 ? "part" : "parts"}` }, ...(entry.badges || [])],
      desc: bd.parts.length ? `Assembled from ${bd.parts.join(", ")}.` : entry.desc,
      visual: `<div class="model3d" data-kind="prim" data-prim="${key}"></div>`,
    });
  };

  // every sellable item's tiny toon prop (the in-world / dungeon-drop mesh —
  // the Merchandise tab shows the flat icon art; this is the 3D model behind it)
  cards.push({ section: "Merchandise props", icon: icon("box") });
  for (const it of Object.values(ITEMS)) {
    add(`item:${it.id}`, {
      title: it.name,
      id: it.id,
      tier: it.tier,
      icon: itemIcon(it.icon),
      badges: [{ text: `T${it.tier}`, kind: `tier tier${it.tier}` }],
    }, () => itemMesh(it.id));
  }

  // static dungeon set-dressing built in dungeon-geometry.js
  cards.push({ section: "Dungeon fixtures", icon: icon("chest") });
  const fixtures = [
    ["fx:chestWood", "Treasure Chest", "chest · wood", () => makeChest("wood")],
    ["fx:chestIron", "Iron Chest", "chest · iron", () => makeChest("iron")],
    ["fx:gate", "Boss Portcullis", "gate", () => makeGate()],
    ["fx:stairsUp", "Ascending Stairs", "stairs · up", () => makeStairs("up")],
    ["fx:stairsDown", "Descending Stairs", "stairs · down", () => makeStairs("down")],
    ["fx:descent", "Descent Shaft", "descent", () => makeDescent()],
  ];
  for (const [key, title, id, make] of fixtures) add(key, { title, id }, make);

  // the in-hand weapon meshes gear.js builds per weapon type (distinct from the
  // shelf props above — these are sized and oriented to sit in the hero's hand)
  cards.push({ section: "Wielded weapons", icon: icon("swords") });
  const weapons = [
    ["wp:wsword", "wsword", "Pine Sword"],
    ["wp:bow", "bow", "Hunter's Bow"],
    ["wp:staff", "staff", "Oak Staff"],
  ];
  for (const [key, wid, title] of weapons) {
    add(key, { title: `${title} — wielded`, id: `${wid} · in-hand` }, () => weaponMesh(wid));
  }

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
      } else if (kind === "prim") {
        const make = _primFactories.get(el.dataset.prim);
        if (make) views.push(new View(el, make(), { disposeModel: false }));
      } else if (kind === "town") {
        const make = _townFactories.get(el.dataset.town);
        if (make) views.push(new View(el, make(), { disposeModel: false }));
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

// Wire up the per-card content tabs (Townsfolk cards): clicking a tab shows its
// matching panel and hides the siblings. Scoped per card so cards are independent.
function mountCardTabs(root) {
  root.querySelectorAll(".npc-card").forEach((cardEl) => {
    const tabs = [...cardEl.querySelectorAll(".npc-tab")];
    const panels = [...cardEl.querySelectorAll(".npc-panel")];
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const id = tab.dataset.ct;
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        panels.forEach((p) => p.classList.toggle("active", p.dataset.cp === id));
      });
    });
  });
}

// --- combat settings (editable) --------------------------------------------
// The one tab that WRITES: mirrors the in-game ` panel's combat-input section.
// Picks the attack mode + tunes its knobs, POSTing to /api/combat-settings so
// the change lands in src/game/combat-settings.json (dev server only).

function combatCardHtml() {
  const mode = attackMode();
  const modeBtns = ATTACK_MODES.map((m) => `
    <button class="cmode-card${m.id === mode ? " on" : ""}" data-cmode="${m.id}">
      <b>${esc(m.label)}</b>
      <span>${esc(m.desc)}</span>
    </button>`).join("");
  const sliders = (COMBAT_SLIDERS[mode] || []).map((d) => {
    const val = combat[mode]?.[d.key];
    return `<label class="cset-row">
      <span class="cset-label">${esc(d.label)}</span>
      <input type="range" data-cset="${mode}.${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}">
      <b class="cset-val" data-cval="${mode}.${d.key}">${val}</b>
    </label>`;
  }).join("");
  const knobs = sliders
    ? `<div class="cset-block"><h4>Tuning</h4>${sliders}</div>`
    : `<div class="cset-block"><p class="cset-none">This mode has no extra knobs — the classic dash strike.</p></div>`;
  return `
    <div class="combat-modes">${modeBtns}</div>
    ${knobs}
    <p class="cset-status" id="combat-status">Changes save to <code>src/game/combat-settings.json</code> (dev server).</p>`;
}

function buildCombat() {
  return { html: `<div class="combat-settings" id="combat-settings">${combatCardHtml()}</div>`, n: ATTACK_MODES.length };
}

// --- farm animals (ported voxel character viewer) --------------------------
// A self-contained 3-pane viewer (animations / stage / roster + timeline)
// for the barnyard livestock ported from the spellwright project's voxel
// character system — cow, chicken, pig, piglet, sheep. See
// src/chargen/voxel/ for the ported models, rigs, motion, and renderer.

const FARM_ANIMAL_COUNT = 5;

function buildFarm() {
  return {
    html: `
      <div class="admin-banner">
        Voxel livestock ported from the <code>spellwright</code> character system
        (<code>src/chargen/voxel/</code>) — cow, chicken, pig, piglet, sheep.
        Pick an animation on the left; play/pause/scrub via the timeline.
      </div>
      <div id="farm-viewport" class="farm-viewport"></div>`,
    n: FARM_ANIMAL_COUNT,
  };
}

function mountFarm(root) {
  const el = root.querySelector("#farm-viewport");
  if (!el) return;
  _farmDispose = mountFarmViewer(el);
}

function mountCombat(root) {
  const box = root.querySelector("#combat-settings");
  if (!box) return;
  const status = (msg) => { const s = box.querySelector("#combat-status"); if (s) s.textContent = msg; };
  const persist = () => saveCombatSettings().then((ok) =>
    status(ok ? "Saved to src/game/combat-settings.json." : "Session only — dev server not reachable."));
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cmode]");
    if (!btn) return;
    setCombatSettings({ attackMode: btn.dataset.cmode });
    box.innerHTML = combatCardHtml();
    persist();
  });
  box.addEventListener("input", (e) => {
    const t = e.target.closest("input[data-cset]");
    if (!t) return;
    const [m, key] = t.dataset.cset.split(".");
    const v = +t.value;
    setCombatSettings({ [m]: { [key]: v } });
    const lbl = box.querySelector(`[data-cval="${m}.${key}"]`);
    if (lbl) lbl.textContent = v;
  });
  box.addEventListener("change", (e) => {
    if (e.target.closest("input[data-cset]")) persist();
  });
}

// --- tabs ------------------------------------------------------------------

const TABS = [
  { id: "items", icon: "shopping", label: "Merchandise", build: buildItems, unit: "item" },
  { id: "loot", icon: "chest", label: "Loot", build: buildLoot, unit: "item" },
  { id: "enemies", icon: "ogre", label: "Monsters", build: buildEnemies, unit: "monster" },
  { id: "customers", icon: "faceHappy", label: "Shoppers", build: buildCustomers, unit: "archetype" },
  { id: "npcs", icon: "people", label: "Townsfolk", build: buildNpcs, unit: "resident" },
  { id: "cast", icon: "people", label: "Cast", build: buildCast, unit: "character" },
  { id: "farm", icon: "people", label: "Farm", build: buildFarm, unit: "animal", mount: mountFarm },
  { id: "floors", icon: "hole", label: "Dungeon", build: buildFloors, unit: "floor" },
  { id: "town", icon: "shop", label: "Town", build: buildTown, unit: "model" },
  { id: "prims", icon: "box", label: "Primitives", build: buildPrimitives, unit: "model" },
  { id: "combat", icon: "swords", label: "Combat", build: buildCombat, unit: "mode", mount: mountCombat },
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
  mountCardTabs(body);
  tab.mount?.(body);

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
