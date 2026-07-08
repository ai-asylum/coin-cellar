// The dungeon under the shop. Seeded procedural floors (rooms + L-shaped
// corridors on a grid), instanced walls, chests, a stairway down and a
// portal home. Enemies come out of the same blob-bake pipeline as the
// customers upstairs — skitters, slimes, goblins, wisps, brutes.
import * as THREE from "three";
import { makeToonMaterial, makeBlobShadow, feedOccluder } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { Creature } from "../chargen/creature.js";
import { goblinSpec, bruteSpec, skitterSpec, slimeSpec, wispSpec, archerSpec, bossSpec, humanoidSpec, hsl } from "../chargen/species.js";
import { ITEMS, EQUIP_DROPS, itemSprite } from "./items.js";
import { scatterDungeonDecor, disposeDecor } from "./decor.js";
import { Projectiles } from "./projectile.js";
import { rng, pick, clamp, lerp } from "../core/engine.js";

export const DUNGEON_ORIGIN = new THREE.Vector3(200, 0, 0);
const CELL = 2.4;
const IMP_DECAY = 0.0012; // per-second base for impulse/knockback friction
// an impulse of v decays to a total travel of v / -ln(IMP_DECAY); invert that so
// a lunge can be aimed to land a chosen distance away instead of a fixed speed
const LEAP_K = -Math.log(IMP_DECAY);

// Each kind now carries a `behavior` that drives a distinct combat pattern, a
// windup time (how long its telegraph reads before the blow lands — the
// reaction window the player dodges into) and, for ranged foes, a keep-away
// band. Every attack now telegraphs before it can hurt you.
export const ENEMY_KINDS = {
  // fast erratic swarmer: darts in, quick bite, backs off
  skitter: {
    make: (seed, tier) => {
      const legsN = pick(rng(seed), [4, 6]);
      // legsN MUST be part of the cache key — bone counts differ
      return skitterSpec({ key: `e_sk${tier}_${legsN}_${seed % 5}`, seed, legsN, scale: 0.62 + tier * 0.05, hue: 0.78 - tier * 0.13 });
    },
    hp: 2, dmg: 1, speed: 2.9, aggro: 7, gold: [3, 8],
    behavior: "swarm", windup: 0.28, reach: 1.05, glow: [0.6, 0.15, 0.15],
    loot: ["egg", "mushroom"],
  },
  // slow but telegraphs a leaping lunge that closes distance fast
  slime: {
    make: (seed, tier) => slimeSpec({ key: `e_sl${tier}_${seed % 5}`, scale: 0.6 + tier * 0.07, hue: (0.36 + (seed % 5) * 0.13) % 1 }),
    hp: 4, dmg: 1, speed: 1.9, aggro: 6, gold: [4, 10],
    behavior: "lunge", windup: 0.5, reach: 1.5, glow: [0.15, 0.55, 0.2],
    loot: ["jelly", "caveshroom"],
  },
  // circles the player and darts in with a quick slash
  goblin: {
    make: (seed, tier) => goblinSpec(seed % 7, Math.min(tier, 2)),
    hp: 5, dmg: 1, speed: 3.0, aggro: 8, gold: [8, 16],
    behavior: "strafe", windup: 0.34, reach: 1.35, glow: [0.6, 0.2, 0.1],
    loot: ["meat", "bread"],
  },
  // arcane caster: keeps its distance, telegraphs, hurls a homing-ish orb
  wisp: {
    make: (seed, tier) => wispSpec({ key: `e_wi${tier}_${seed % 4}`, scale: 0.6, hue: (0.55 + (seed % 4) * 0.11) % 1 }),
    hp: 3, dmg: 1, speed: 3.2, aggro: 9, gold: [6, 12],
    behavior: "caster", windup: 0.55, band: [4.5, 7.5], projSpeed: 3.8, projColor: 0xb98cff, glow: [0.4, 0.25, 0.7],
    loot: ["herb"],
  },
  // hooded archer: kites at range, telegraphs then flooses a fast straight bolt
  archer: {
    make: (seed, tier) => archerSpec(seed % 6, Math.min(tier, 2)),
    hp: 4, dmg: 1, speed: 2.7, aggro: 10, gold: [10, 20],
    behavior: "archer", windup: 0.42, band: [5, 9], projSpeed: 6.5, projColor: 0x8fe0ff, glow: [0.15, 0.5, 0.7],
    loot: ["bread", "ring"],
  },
  // heavy: slow, but winds up a wide overhead slam that hits everything near it
  brute: {
    make: (seed, tier) => bruteSpec(seed % 5, Math.min(tier, 2)),
    hp: 12, dmg: 2, speed: 1.6, aggro: 7, gold: [25, 45],
    behavior: "slam", windup: 0.72, reach: 2.4, glow: [0.75, 0.1, 0.05],
    loot: ["fang", "meat"],
  },

  // ---- Flooded Deep natives (floors 4–6): everything drips ----
  // big waterlogged blob: same pouncing lunge as a slime, but on death it
  // bursts into a pair of livelier droplets (see killEnemy's splitInto)
  puddle: {
    make: (seed) => slimeSpec({ key: `e_pd_${seed % 5}`, scale: 0.88, hue: 0.55 + (seed % 5) * 0.02 }),
    hp: 6, dmg: 1, speed: 1.7, aggro: 7, gold: [6, 14],
    behavior: "lunge", windup: 0.55, reach: 1.6, glow: [0.1, 0.4, 0.75],
    splitInto: "puddling", loot: ["jelly", "potion"],
  },
  // the droplets a puddle splits into: tiny, quick, frail biters
  puddling: {
    make: (seed) => slimeSpec({ key: `e_pl_${seed % 5}`, scale: 0.4, hue: 0.58 }),
    hp: 1, dmg: 1, speed: 3.4, aggro: 9, gold: [1, 3],
    behavior: "swarm", windup: 0.24, reach: 0.9, glow: [0.15, 0.45, 0.75],
    loot: ["jelly"], dropRate: 0.15,
  },
  // four-legged tide crab: circles and darts in with a quick pinch
  snapper: {
    make: (seed) => skitterSpec({ key: `e_sn_4_${seed % 5}`, seed, legsN: 4, scale: 0.78, hue: 0.5 }),
    hp: 5, dmg: 1, speed: 3.1, aggro: 8, gold: [8, 16],
    behavior: "strafe", windup: 0.3, reach: 1.2, glow: [0.1, 0.5, 0.6],
    loot: ["egg", "meat"],
  },
  // deep-water lure light: hangs back and erupts a marked geyser under you —
  // the ring on the floor is the dodge (behavior "geyser")
  angler: {
    make: (seed) => wispSpec({ key: `e_an_${seed % 4}`, scale: 0.68, hue: 0.6 }),
    hp: 4, dmg: 1, speed: 2.6, aggro: 10, gold: [10, 20],
    behavior: "geyser", windup: 0.85, band: [4, 7], reach: 1.8, glow: [0.1, 0.5, 0.9],
    loot: ["lantern", "herb"],
  },

  // ---- Bone Hollow natives (floors 7–9): the ossuary stirs ----
  // dry bone-bug: faster and twitchier than the warren's skitters
  rattler: {
    make: (seed) => skitterSpec({ key: `e_ra_6_${seed % 5}`, seed, legsN: 6, scale: 0.68, hue: 0.12 }),
    hp: 3, dmg: 1, speed: 3.6, aggro: 9, gold: [6, 12],
    behavior: "swarm", windup: 0.24, reach: 1.0, glow: [0.8, 0.75, 0.5],
    loot: ["fang"],
  },
  // pale grave-light: a quicker caster whose bolts fly noticeably faster
  gravewisp: {
    make: (seed) => wispSpec({ key: `e_gw_${seed % 4}`, scale: 0.64, hue: 0.13 }),
    hp: 5, dmg: 1, speed: 3.0, aggro: 10, gold: [10, 20],
    behavior: "caster", windup: 0.5, band: [4.5, 8], projSpeed: 5.2, projColor: 0xffe9a8, glow: [0.85, 0.8, 0.4],
    loot: ["bell", "herb"],
  },
  // bleached ossuary sentinel: telegraphs a lane on the floor, then hurls
  // itself down it — step out of the lane and it barrels past (behavior "charger")
  boneguard: {
    make: (seed, tier) => humanoidSpec({
      key: `e_bg_${seed % 4}_${Math.min(tier, 2)}`,
      scale: 1.15 + Math.min(tier, 2) * 0.06, fat: 1.25, headR: 0.22, armR: 0.11,
      skin: hsl(0.11, 0.18, 0.72), cloth: hsl(0.1, 0.15, 0.62), pants: hsl(0.08, 0.2, 0.3),
      accent: hsl(0.07, 0.5, 0.35), earType: "none", hat: "horns",
    }),
    hp: 9, dmg: 2, speed: 2.0, aggro: 9, gold: [18, 34],
    behavior: "charger", windup: 0.7, reach: 1.6, glow: [0.9, 0.85, 0.6],
    loot: ["key", "bomb"],
  },

  // ---- Gloom Drain natives (floors 10–12): the marsh bites back ----
  // walking spore sac: rushes in, swells, and blows itself apart — the
  // expanding ring is the blast radius, and the kill costs it its own life
  sporeling: {
    make: (seed) => slimeSpec({ key: `e_sp_${seed % 5}`, scale: 0.52, hue: 0.8 }),
    hp: 2, dmg: 2, speed: 3.3, aggro: 10, gold: [4, 9],
    behavior: "bomber", windup: 0.6, reach: 1.9, glow: [0.75, 0.3, 0.9],
    loot: ["mushroom", "caveshroom"],
  },
  // slippery marsh-light: marks a ripple at your flank, blinks onto it and
  // fires the instant it lands (behavior "blinker")
  gloomcaster: {
    make: (seed) => wispSpec({ key: `e_gc_${seed % 4}`, scale: 0.7, hue: 0.75 }),
    hp: 5, dmg: 1, speed: 3.0, aggro: 11, gold: [12, 24],
    behavior: "blinker", windup: 0.6, band: [4, 8], projSpeed: 5.5, projColor: 0xd48cff, glow: [0.6, 0.25, 0.85],
    loot: ["gem", "herb"],
  },
  // moss-grown hulk: the drain's answer to the brute, wider slam, more meat
  mossbrute: {
    make: (seed, tier) => humanoidSpec({
      key: `e_mb_${seed % 4}_${Math.min(tier, 2)}`,
      scale: 1.55, fat: 1.55, headR: 0.2, armR: 0.13,
      skin: hsl(0.33, 0.35, 0.34), cloth: hsl(0.33, 0.35, 0.34), pants: hsl(0.3, 0.3, 0.22),
      accent: hsl(0.42, 0.5, 0.5), earType: "none", hat: "horns",
    }),
    hp: 14, dmg: 2, speed: 1.6, aggro: 8, gold: [28, 50],
    behavior: "slam", windup: 0.75, reach: 2.5, glow: [0.4, 0.85, 0.4],
    loot: ["feather", "fang"],
  },
  // the floor boss: a giant that owns the sealed arena. Huge HP pool and a
  // rotation of telegraphed patterns — a wide ground-shaking slam up close, a
  // room-crossing charge, and a radial orb burst at range. Enrages at half HP.
  boss: {
    make: (seed) => bossSpec(seed),
    hp: 70, dmg: 2, speed: 1.7, aggro: 15, gold: [0, 0],
    behavior: "boss", windup: 0.78, reach: 3.4, glow: [0.95, 0.08, 0.05],
    projSpeed: 3.6, projColor: 0xff7a4d,
  },
};

// Each sewer hole crowns its final floor with its own boss: a themed look
// (giant version of a native species), its own stats, attack rotation,
// enrage minion pack and copy. Entries override the base `boss` kind above;
// index matches Sewer.holes. All bosses share the "boss" behavior machine
// (slam in reach; charge/burst at range per `rotation`), so guests mirror
// them with the same kind string — the def resolves from the synced hole id.
const DEFAULT_BOSS = {
  name: "Ogre King of the Cellar",
  awaken: "the Ogre King awakens",
};
// Per-attack telegraph tuning shared by every boss: how much windup each
// pattern adds on top of the boss's base windup, and the body-glow colour
// that announces it. The signature moves (pounce / deluge / blink) lock a
// ground mark at windup start — standing off the mark is the dodge.
const BOSS_ATK_WINDUP = { charge: 0.32, burst: 0.07, slam: 0.25, pounce: 0.2, deluge: 0.45, blink: 0 };
export const BOSS_ATK_GLOW = {
  charge: [0.9, 0.45, 0.05],
  burst: [0.55, 0.15, 0.8],
  pounce: [0.95, 0.35, 0.1],
  deluge: [0.1, 0.45, 0.85],
  blink: [0.3, 0.8, 0.75],
};
export const BOSSES = [
  { // Rat Warren — the nest's matriarch: quick, frail (for a boss), and all
    // over the arena: her signature POUNCE leaps onto a ring marked at your feet
    name: "Broodmother of the Warren",
    awaken: "the Broodmother skitters from her nest",
    make: (seed) => skitterSpec({ key: `boss_rw_6_${seed % 5}`, seed, legsN: 6, scale: 1.9, hue: 0.05 }),
    hp: 58, speed: 2.25, windup: 0.66, reach: 2.7,
    rotation: ["pounce", "charge", "pounce", "burst"],
    minions: ["skitter", "skitter", "skitter"],
    projSpeed: 3.2, projColor: 0xffb25a,
  },
  { // Flooded Deep — a mountain of ooze: ponderous, huge HP. Its signature
    // DELUGE marks five splash zones (one under your feet) that all erupt at once
    name: "The Drowned Maw",
    awaken: "something vast heaves out of the deep",
    make: (seed) => slimeSpec({ key: `boss_fd_${seed % 5}`, scale: 2.3, hue: 0.55 }),
    hp: 92, speed: 1.25, windup: 0.95, reach: 3.2,
    rotation: ["deluge", "burst", "deluge", "charge"],
    minions: ["puddling", "puddling", "snapper"],
    burstN: 10, projSpeed: 2.9, projColor: 0x5dd0ff,
  },
  { // Bone Hollow — the classic: the hulking Ogre King in his ossuary,
    // fighting the original slam / charge / burst book
    name: "Ogre King of the Hollow",
    awaken: "the Ogre King awakens",
    minions: ["rattler", "rattler", "boneguard"],
  },
  { // Gloom Drain — a swollen marsh-light: nimble and slippery. Its signature
    // BLINK teleports to a ripple marked at your side and spits a quick orb ring
    name: "Sovereign of the Gloom",
    awaken: "the marsh-lights bend toward their sovereign",
    make: (seed) => wispSpec({ key: `boss_gd_${seed % 4}`, scale: 1.9, hue: 0.45 }),
    hp: 62, speed: 2.0, windup: 0.75, reach: 2.4,
    rotation: ["blink", "burst", "blink", "charge"],
    minions: ["gloomcaster", "sporeling", "sporeling"],
    projSpeed: 4.0, projColor: 0x6fd6c8,
  },
];

// The full def for the boss guarding a given hole's dungeon (tutorial cellar
// and anything out of range fall back to the classic Ogre King). Every hole
// deeper, the keeper asks more of you: a fatter HP pool, harder hits, snappier
// telegraphs, a shorter breather between patterns and a bigger enrage pack —
// so the four boss fights ramp 1 → 4 even before their unique movesets differ.
export function bossDefFor(hole) {
  const def = { ...ENEMY_KINDS.boss, ...(BOSSES[hole] ?? DEFAULT_BOSS) };
  const h = clamp(hole ?? 0, 0, N_DUNGEONS - 1);
  def.hp = Math.round(def.hp * (1 + h * 0.5));
  def.dmg += h >= 2 ? 1 : 0;
  def.speed *= 1 + h * 0.07;
  def.windup = Math.max(0.5, def.windup * (1 - h * 0.07));
  def.paceMul = 1 - h * 0.09; // gap between attacks tightens with depth
  def.minionN = 3 + h; // enrage pack grows
  def.burstN = (def.burstN ?? 8) + h;
  return def;
}

// Themed loot per dungeon: what its monsters carry and its chests hold. The
// per-kind `loot` lists above are each monster's signature drops; these tables
// back the rest of the rolls so every hole's haul reads distinctly. Index
// matches Sewer.holes.
export const DUNGEON_LOOT = [
  { // Rat Warren — forage and scraps
    common: ["mushroom", "meat", "bread", "caveshroom", "jelly", "egg"],
    rare: ["wsword", "ring", "fang"],
  },
  { // Flooded Deep — what washes down the drain
    common: ["jelly", "herb", "egg", "potion"],
    rare: ["lantern", "feather", "gem"],
  },
  { // Bone Hollow — grave goods
    common: ["fang", "bomb", "key", "ring"],
    rare: ["bell", "ssword", "crown"],
  },
  { // Gloom Drain — marsh treasures
    common: ["herb", "potion", "gem", "feather"],
    rare: ["star", "hourglass", "crown"],
  },
];

// Visual identity per sewer hole: floor/wall palette (indexed by floor,
// clamped to the last entry), torch crystal colors, god-ray shaft colors and
// the set-dressing mix. Index matches Sewer.holes; the tutorial's private
// cellar (sewerHole -1) falls back to the classic look.
const DEFAULT_THEME = {
  palettes: [
    [0x8a70b5, 0x715a99],
    [0x5f93a8, 0x4d7a8c],
    [0xa8756a, 0x8c5f55],
    [0x7a75ad, 0x635e94],
    [0x9c6693, 0x7f5178],
  ],
  torch: [0x9a6dff, 0x5dd0ff, 0xff9a5d],
  shafts: [0x8fb6ff, 0xb98cff, 0x6fd6c8],
  decor: null, // default cave mix (see scatterDungeonDecor)
};
export const HOLE_THEMES = [
  { // Rat Warren — burrowed earth: warm browns, gnawed bones, dead roots
    palettes: [[0xa8756a, 0x8c5f55], [0x9c6b55, 0x7f5643], [0x8a5f4d, 0x6f4c3d]],
    torch: [0xff9a5d, 0xffd34d],
    shafts: [0xffb97a, 0xd9a066],
    decor: { tint: 0xd4c2b0, weights: { mushrooms: 0.15, stones: 0.4, dead: 0.25, bones: 0.2 } },
  },
  { // Flooded Deep — waterlogged stone: cold blues, slick rocks, pale caps
    palettes: [[0x5f93a8, 0x4d7a8c], [0x54879e, 0x426a7d], [0x4a7a93, 0x385d70]],
    torch: [0x5dd0ff, 0x6fd6c8],
    shafts: [0x8fb6ff, 0x6fd6c8],
    decor: { tint: 0xb8cfd8, weights: { mushrooms: 0.35, stones: 0.55, dead: 0.05, bones: 0.05 } },
  },
  { // Bone Hollow — ossuary: pale ash and dust, bone piles at every turn
    palettes: [[0xa89a8a, 0x8c7f70], [0x9a8c7a, 0x7d7060], [0x8a7c6a, 0x6d6050]],
    torch: [0xffe9c4, 0xff9a5d],
    shafts: [0xffd9a0, 0xe8e0c8],
    decor: { tint: 0xe0d8c8, weights: { mushrooms: 0.1, stones: 0.25, dead: 0.25, bones: 0.4 } },
  },
  { // Gloom Drain — fungal gloom: mossy greens, mushroom thickets
    palettes: [[0x6a9a70, 0x557f5c], [0x5d8c66, 0x487252], [0x4f7d58, 0x3b6345]],
    torch: [0x6fd6c8, 0x9a6dff],
    shafts: [0x6fd6c8, 0x8fb6ff],
    decor: { tint: 0xbcd4be, weights: { mushrooms: 0.55, stones: 0.25, dead: 0.15, bones: 0.05 } },
  },
];

// Dungeons are stacked: four themed dungeons of three floors each, so the
// descent runs 1‑12 with a boss guarding every third floor (3, 6, 9, 12). The
// sewer mouths are shortcuts to the head of each dungeon (floors 1, 4, 7, 10).
export const FLOORS_PER_DUNGEON = 3;
export const N_DUNGEONS = 4;
export const MAX_DEPTH = FLOORS_PER_DUNGEON * N_DUNGEONS; // deepest floor (final boss)
// Which themed dungeon (0..N_DUNGEONS-1) a floor belongs to.
export function dungeonIndexFor(floorN) {
  return clamp(Math.floor((floorN - 1) / FLOORS_PER_DUNGEON), 0, N_DUNGEONS - 1);
}
// A boss guards the last floor of every dungeon (every third floor).
export function isBossFloor(floorN) {
  return floorN > 0 && floorN % FLOORS_PER_DUNGEON === 0;
}
// Each themed dungeon spawns only its own natives — DUNGEON_MIX[dungeon] lists
// the roster per local floor (1st/2nd/3rd), thickening toward the boss floor.
export const DUNGEON_MIX = [
  [ // Rat Warren — the classic starter crawl, exactly the original mixes
    ["skitter", "slime"],
    ["skitter", "slime", "goblin"],
    ["slime", "goblin", "wisp", "archer"],
  ],
  [ // Flooded Deep — splitting blobs, tide crabs and geyser lures
    ["puddle", "snapper"],
    ["puddle", "snapper", "angler"],
    ["snapper", "angler", "puddle", "puddle"],
  ],
  [ // Bone Hollow — bone-bugs, grave-lights and charging sentinels
    ["rattler", "gravewisp"],
    ["rattler", "gravewisp", "boneguard"],
    ["rattler", "boneguard", "gravewisp", "boneguard"],
  ],
  [ // Gloom Drain — walking bombs, blink-casters and moss hulks
    ["sporeling", "gloomcaster"],
    ["sporeling", "gloomcaster", "mossbrute"],
    ["gloomcaster", "sporeling", "mossbrute", "mossbrute"],
  ],
];
export function floorMixFor(floorN) {
  const mixes = DUNGEON_MIX[dungeonIndexFor(floorN)] ?? DUNGEON_MIX[0];
  return mixes[Math.min((floorN - 1) % FLOORS_PER_DUNGEON, mixes.length - 1)];
}

export class Dungeon {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(DUNGEON_ORIGIN);
    game.engine.scene.add(this.group);
    this.group.visible = false;
    this.active = false;
    this.floor = 0;
    this.enemies = [];
    this.drops = [];
    this.chests = [];
    this.decor = []; // destructible billboard props (smashable, no loot)
    this.shafts = []; // god-ray light shafts (animated each frame)
    this.colliders = [];
    this.projectiles = new Projectiles(game.engine.scene);
    this._wallMesh = null;
    this._floorMesh = null;
    // boss floor: sealed arena, its portcullis gate, and which chest holds the key
    this.gate = null;
    this.gateOpen = false;
    this.gatePos = null; // group-local doorway centre (game offsets by DUNGEON_ORIGIN)
    this.bossRoom = null; // world-space AABB used to lock the camera on the arena
    this.bossCenter = null;
    this.boss = null;
    this.keyChestId = -1;
    // the summoning portal the boss rises out of when the gate is unlocked
    this._bossPortal = null;
    // return portal home, conjured where the boss falls (world-space anchor)
    this.returnPortal = null;
  }

  /** Build floor n from a seed (deterministic — co-op peers share the seed).
   * `tutorial` swaps the maze for a single tiny room: no monsters, one chest —
   * a gentle first delve that teaches loot → stairs without any combat. */
  generate(floorN, seed, tutorial = false) {
    this.dispose();
    this.floor = floorN;
    this.seed = seed;
    this.active = true;
    this.tutorial = tutorial;
    this.group.visible = true;
    const r = rng(seed + floorN * 7717);

    // The final floor is the boss floor: a big sealed arena is reserved along
    // the top of a taller grid, and the normal rooms are packed in below it.
    // (Never on the tutorial floor — it's a single peaceful room.)
    const isBoss = !tutorial && isBossFloor(floorN);
    this.isBoss = isBoss;

    // --- grid: non-overlapping rooms linked by wide L-shaped corridors
    const GW = 25, GH = isBoss ? 30 : 24;
    // boss arena rectangle + its 2-wide doorway (only meaningful on the boss floor)
    const BW = 9, BH = 6, BX = Math.floor((GW - BW) / 2), BY = 1;
    const gateX = BX + Math.floor(BW / 2) - 1, gateY = BY + BH;
    const yMin = isBoss ? BY + BH + 2 : 1; // keep normal rooms clear of the arena
    const open = Array.from({ length: GH }, () => new Array(GW).fill(false));
    const rooms = [];
    if (tutorial) {
      // One snug room in the middle of the grid — nothing to fight, just a chest
      // to crack and the stairs home on the far wall. Kept deliberately tiny so a
      // new player's whole first delve fits in a couple of steps.
      const w = 5, h = 5;
      const x = Math.floor((GW - w) / 2), y = Math.floor((GH - h) / 2);
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) open[yy][xx] = true;
    } else {
    const nRooms = 8 + Math.min(4, Math.floor(floorN / 2)) + Math.floor(r() * 3);
    // rejection-sample room rects that keep a 1-cell gap from their neighbours
    for (let tries = 0; rooms.length < nRooms && tries < nRooms * 14; tries++) {
      const w = 3 + Math.floor(r() * 3);
      const h = 3 + Math.floor(r() * 3);
      const x = 1 + Math.floor(r() * (GW - w - 2));
      const y = yMin + Math.floor(r() * (GH - h - yMin - 1));
      const overlaps = rooms.some((o) =>
        x - 1 < o.x + o.w && x + w + 1 > o.x && y - 1 < o.y + o.h && y + h + 1 > o.y
      );
      if (overlaps) continue;
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) open[yy][xx] = true;
    }
    }

    // carve a 2-cell-wide L corridor (horizontal leg then vertical leg)
    const carve = (a, b) => {
      for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) {
        open[a.cy][x] = true;
        if (open[a.cy + 1]) open[a.cy + 1][x] = true;
      }
      for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) {
        open[y][b.cx] = true;
        if (b.cx + 1 < GW) open[y][b.cx + 1] = true;
      }
    };

    // connect every room via a minimum spanning tree (Prim's) so corridors go
    // to the nearest room rather than following spawn order
    const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    const connected = new Set([0]);
    while (connected.size < rooms.length) {
      let from = 0, to = -1, best = Infinity;
      for (const i of connected)
        for (let j = 0; j < rooms.length; j++) {
          if (connected.has(j)) continue;
          const d = dist(rooms[i], rooms[j]);
          if (d < best) { best = d; from = i; to = j; }
        }
      if (to < 0) break;
      carve(rooms[from], rooms[to]);
      connected.add(to);
    }
    // a couple of extra links create loops so floors aren't strictly tree-shaped
    for (let k = 0, extra = 1 + Math.floor(r() * 2); k < extra && rooms.length > 2; k++) {
      const a = rooms[Math.floor(r() * rooms.length)];
      const b = rooms[Math.floor(r() * rooms.length)];
      if (a !== b) carve(a, b);
    }

    // --- boss arena: open its big rectangle + a 2-wide doorway, then run a
    // corridor from the nearest normal room up to the door (sealed by a gate).
    if (isBoss) {
      for (let yy = BY; yy < BY + BH; yy++)
        for (let xx = BX; xx < BX + BW; xx++) open[yy][xx] = true;
      for (let yy = BY + BH; yy <= BY + BH + 1; yy++)
        for (let xx = gateX; xx <= gateX + 1; xx++) open[yy][xx] = true;
      let near = rooms[0], nd = Infinity;
      for (const rm of rooms) {
        const dd = Math.abs(rm.cx - gateX) + Math.abs(rm.cy - (BY + BH + 2));
        if (dd < nd) { nd = dd; near = rm; }
      }
      if (near) carve(near, { cx: gateX, cy: BY + BH + 2 });
    }

    this.open = open;
    this.GW = GW;
    this.GH = GH;
    this.rooms = rooms;
    // fog-of-war: minimap cells start hidden and are revealed as players explore
    this.discovered = Array.from({ length: GH }, () => new Array(GW).fill(false));
    this.revealVersion = 0;

    const cellPos = (x, y) => new THREE.Vector3((x - GW / 2 + 0.5) * CELL, 0, (y - GH / 2 + 0.5) * CELL);

    // --- floor slab (colors come from the hole's theme; tutorial gets the default)
    const theme = tutorial ? DEFAULT_THEME : (HOLE_THEMES[dungeonIndexFor(floorN)] ?? DEFAULT_THEME);
    this.theme = theme;
    // palette deepens with the floor within its own dungeon (1st/2nd/3rd floor)
    const localFloor = (floorN - 1) % FLOORS_PER_DUNGEON;
    const palette = theme.palettes[Math.min(localFloor, theme.palettes.length - 1)];
    const floorTex = makeTilesTexture(palette, seed + floorN);
    // the floor only exists under open (walkable) cells — one merged quad per
    // cell rather than a single slab, so there's no floor hanging out beyond the
    // walls. UVs keep the tiled texture continuous across neighbouring cells.
    this._floorMesh = new THREE.Mesh(
      makeFloorGeometry(open, GW, GH, cellPos),
      new THREE.MeshToonMaterial({ map: floorTex })
    );
    this.group.add(this._floorMesh);

    // --- instanced walls on closed cells that touch open cells
    const wallCells = [];
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (open[y][x]) continue;
        let touches = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
          if (open[y + dy]?.[x + dx]) touches = true;
        if (touches) wallCells.push([x, y]);
        // colliders for every closed cell adjacent to open (cheap enough)
        if (touches) {
          const p = cellPos(x, y);
          this.colliders.push({ x: p.x + DUNGEON_ORIGIN.x, z: p.z + DUNGEON_ORIGIN.z, hw: CELL / 2, hd: CELL / 2 });
        }
      }
    const wallGeo = new THREE.BoxGeometry(CELL, 1.7, CELL);
    const wallMat = makeToonMaterial({ color: new THREE.Color(palette[1]).multiplyScalar(0.55).getHex(), rim: 0, occlude: true });
    this._wallMat = wallMat;
    this._wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    const m = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => {
      const p = cellPos(x, y);
      const jitter = 0.92 + rng(seed + x * 31 + y * 57)() * 0.18;
      m.makeScale(1, jitter, 1);
      m.setPosition(p.x, 0.85 * jitter, p.z);
      this._wallMesh.setMatrixAt(i, m);
    });
    this.group.add(this._wallMesh);

    // --- entrance (room 0) is just the arrival spot now (marked by its light
    // shaft below) — leaving the cellar happens at the stairs prompt instead of
    // a return circle. & stairs down (last room). On the tutorial floor the lone
    // room holds both, tucked against opposite walls so there's room to breathe.
    const rm0 = rooms[0];
    const entranceCell = tutorial ? { x: rm0.x + 1, y: rm0.cy } : { x: rm0.cx, y: rm0.cy };
    this.entrancePos = cellPos(entranceCell.x, entranceCell.y);
    this.entranceCell = entranceCell;
    // start with the entrance room revealed
    this.reveal(this.entrancePos.x + DUNGEON_ORIGIN.x, this.entrancePos.z + DUNGEON_ORIGIN.z);

    // stairs go in the room farthest from the entrance for a longer descent
    let last = rooms[0], far = -1;
    for (const room of rooms) {
      const d = Math.abs(room.cx - rooms[0].cx) + Math.abs(room.cy - rooms[0].cy);
      if (d > far) { far = d; last = room; }
    }
    const stairsCell = tutorial ? { x: rm0.x + rm0.w - 2, y: rm0.cy } : { x: last.cx, y: last.cy };
    this.stairsPos = cellPos(stairsCell.x, stairsCell.y);
    this.stairsCell = stairsCell;
    const stairs = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.5 - i * 0.28, 0.42, 1.5 - i * 0.28),
        makeToonMaterial({ color: 0x2a2038, rim: 0 })
      );
      // lift slightly so the top step's face doesn't sit coplanar with the
      // floor slab (y=0), which caused z-fighting on the descent
      step.position.y = -0.19 - i * 0.16;
      stairs.add(step);
    }
    stairs.position.copy(this.stairsPos);
    this.group.add(stairs);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.4 })
    );
    glow.position.copy(this.stairsPos).setY(0.05);
    this.group.add(glow);
    // On the tutorial floor the way home stays hidden until the chest is cracked,
    // so the first objective is unmistakably "smash the chest". revealStairs()
    // (called from openChest) brings the stairs + their light shaft back in.
    this._stairsMeshes = [stairs, glow];
    this.stairsHidden = tutorial;
    if (this.stairsHidden) for (const mesh of this._stairsMeshes) mesh.visible = false;

    // --- billboard set dressing: mushrooms, stones, dead trees & bones tucked
    // into the rooms (seeded off the same rng so co-op peers match). Skips the
    // entrance and stairs cells so nothing clutters the arrival/exit spots.
    // group-local props; store their world position so combat can smash them
    this.decor = scatterDungeonDecor(this.group, r, rooms, cellPos, {
      skip: [this.entranceCell, this.stairsCell],
      theme: theme.decor,
    }).map((d) => ({ ...d, wx: d.x + DUNGEON_ORIGIN.x, wz: d.z + DUNGEON_ORIGIN.z }));

    // --- god-ray shafts: light leaking through cracks in the ceiling above.
    // Cool arcane glow over the entrance portal, warm dusk over the stairs,
    // and a couple of pale beams scattered through the deeper rooms.
    const addShaft = (pos, opts) => {
      const shaft = makeLightShaft(opts);
      shaft.position.set(pos.x, 3.4, pos.z);
      this.group.add(shaft);
      this.shafts.push(shaft);
      return shaft;
    };
    addShaft(this.entrancePos, { color: 0x9a6dff, length: 4.6, topWidth: 0.6, bottomWidth: 2.6, opacity: 0.4, tilt: 0.28, spin: 0.4, motes: 14 });
    const stairsShaft = addShaft(this.stairsPos, { color: 0xff9a4d, length: 4.6, topWidth: 0.55, bottomWidth: 2.4, opacity: 0.34, tilt: 0.24, spin: 1.2, motes: 12 });
    // the stairs' beam is part of the "way home" reveal on the tutorial floor
    if (this.stairsHidden) { stairsShaft.visible = false; this._stairsMeshes.push(stairsShaft); }
    for (const room of rooms.slice(1, -1)) {
      if (r() < 0.5) {
        const p = cellPos(room.cx, room.cy);
        addShaft(p, { color: pick(r, theme.shafts), length: 4.4, topWidth: 0.5, bottomWidth: 2.1, opacity: 0.24 + r() * 0.1, tilt: 0.18 + r() * 0.3, spin: r() * Math.PI, motes: 10 });
      }
    }

    // --- enemies (host decides; guests get them mirrored via net). The
    // tutorial floor is deliberately monster-free.
    if (!this.game.net.isGuest && !tutorial) {
      const tier = Math.min(floorN, 5) - 1;
      const mix = floorMixFor(floorN);
      const n = 4 + floorN + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const room = rooms[1 + Math.floor(r() * (rooms.length - 1))];
        const kind = mix[Math.floor(r() * mix.length)];
        const px = room.x + r() * room.w;
        const py = room.y + r() * room.h;
        const p = cellPos(px - 0.5, py - 0.5);
        if (p.distanceTo(this.entrancePos) < 3) continue;
        // enemies live in world space (the scene root), not the group
        this.spawnEnemy(kind, Math.floor(r() * 1e6), tier, p.x + DUNGEON_ORIGIN.x, p.z + DUNGEON_ORIGIN.z);
      }
    }

    // --- rolling spawns (Minecraft-style): the floor keeps repopulating on a
    // timer, but only away from every player, and never past a per-depth cap.
    // Disabled on the peaceful tutorial and inside the sealed boss arena so the
    // arena stays a controlled fight. Host-only (guests mirror via eSnap).
    this._spawnTier = Math.min(floorN, 5) - 1;
    this._spawnMix = floorMixFor(floorN);
    this.spawnCap = isBoss || tutorial ? 0 : 6 + floorN * 2;
    this._spawnT = 4 + r() * 4; // first top-up a few seconds in

    // --- chests. The tutorial floor gets exactly one, dead centre between the
    // arrival spot and the stairs, so a new player can't miss it.
    if (tutorial) {
      const chest = makeChest();
      chest.position.copy(cellPos(rooms[0].cx, rooms[0].cy));
      chest.rotation.y = -Math.PI / 2;
      this.group.add(chest);
      this.chests.push({ mesh: chest, opened: false, id: 0 });
    } else {
    const nChests = 1 + Math.floor(r() * 2);
    for (let i = 0; i < nChests; i++) {
      const room = rooms[Math.floor(r() * rooms.length)];
      const p = cellPos(room.x + Math.floor(r() * room.w), room.y + Math.floor(r() * room.h));
      if (p.distanceTo(this.entrancePos) < 2.5) continue;
      const chest = makeChest();
      chest.position.copy(p);
      chest.rotation.y = r() * Math.PI * 2;
      this.group.add(chest);
      this.chests.push({ mesh: chest, opened: false, id: i });
    }
    }

    // --- the boss door key. It's hidden in one chest during the run: the boss
    // floor always guarantees one (so the arena is never un-openable), and
    // earlier floors give it a chance so it can turn up on the way down. The
    // choice is derived from the seed alone, so co-op peers agree on it.
    this.keyChestId = -1;
    const keyHere = !tutorial && (isBoss || rng(seed + 900 + floorN * 17)() < 0.4);
    if (keyHere) {
      if (isBoss && this.chests.length === 0) {
        // extremely unlucky roll left the arena floor chest-less — force one
        const room = rooms[rooms.length - 1];
        const p = cellPos(room.cx, room.cy);
        const chest = makeChest();
        chest.position.copy(p);
        this.group.add(chest);
        this.chests.push({ mesh: chest, opened: false, id: 0 });
      }
      if (this.chests.length)
        this.keyChestId = this.chests[Math.floor(rng(seed + 123 + floorN * 7)() * this.chests.length)].id;
    }

    // --- boss arena furniture, gate and the boss itself (final floor only)
    if (isBoss) this._buildBossArena(seed, cellPos, BX, BY, BW, BH, gateX, gateY);
  }

  // Build the sealed arena: a moody slab, a dramatic red light shaft, the
  // portcullis gate (blocking colliders + a mesh that rises when unlocked),
  // the world-space bounds the camera locks onto, and the boss (host only).
  _buildBossArena(seed, cellPos, BX, BY, BW, BH, gateX, gateY) {
    const center = cellPos(BX + BW / 2 - 0.5, BY + BH / 2 - 0.5);

    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(BW * CELL, BH * CELL).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({ color: 0x3a2030 })
    );
    slab.position.set(center.x, 0.02, center.z);
    this.group.add(slab);

    const shaft = makeLightShaft({ color: 0xff3b3b, length: 5.2, topWidth: 0.85, bottomWidth: 3.6, opacity: 0.3, tilt: 0.1, spin: 0.7, motes: 18 });
    shaft.position.set(center.x, 3.6, center.z);
    this.group.add(shaft);
    this.shafts.push(shaft);

    // portcullis across the 2-wide doorway
    const gcolliders = [];
    for (const gx of [gateX, gateX + 1]) {
      const gp = cellPos(gx, gateY);
      const col = { x: gp.x + DUNGEON_ORIGIN.x, z: gp.z + DUNGEON_ORIGIN.z, hw: CELL / 2, hd: CELL / 2 };
      this.colliders.push(col);
      gcolliders.push(col);
    }
    const gc = cellPos(gateX + 0.5, gateY);
    const gateMesh = makeGate();
    gateMesh.position.set(gc.x, 0, gc.z);
    this.group.add(gateMesh);
    this.gate = { colliders: gcolliders, mesh: gateMesh, open: false, raiseT: -1 };
    this.gateOpen = false;
    this.gatePos = gc.clone();

    // world-space arena bounds (for the fixed camera) + its centre
    const bMin = cellPos(BX, BY), bMax = cellPos(BX + BW - 1, BY + BH - 1);
    this.bossRoom = {
      minX: bMin.x - CELL / 2 + DUNGEON_ORIGIN.x, maxX: bMax.x + CELL / 2 + DUNGEON_ORIGIN.x,
      minZ: bMin.z - CELL / 2 + DUNGEON_ORIGIN.z, maxZ: bMax.z + CELL / 2 + DUNGEON_ORIGIN.z,
    };
    this.bossCenter = new THREE.Vector3(center.x + DUNGEON_ORIGIN.x, 0, center.z + DUNGEON_ORIGIN.z);
    // the boss itself stays out of the world until the gate is unlocked —
    // the arena reads as an ominous empty room through the bars until then
  }

  /** Unlock the boss door: drop its colliders, start the gate rising, and wake
   * the boss (host authoritative; guests receive it mirrored via net). */
  openGate() {
    if (!this.gate || this.gate.open) return;
    this.gate.open = true;
    this.gateOpen = true;
    this.colliders = this.colliders.filter((c) => !this.gate.colliders.includes(c));
    this.gate.raiseT = 0;
    // the boss doesn't just pop in — a summoning portal blooms on the arena
    // floor and, once it's fully open, the boss heaves out of it (host spawns
    // the actual enemy; guests mirror the portal FX + receive the boss via net).
    if (this.isBoss && !this.boss && !this._bossPortal && this.bossCenter) this._summonBoss();
  }

  /** Bloom a fiery summoning portal at the arena centre and, after a beat, let
   * the boss rise from it (see the _bossPortal branch in update()). Runs on
   * host + guest so both see the entrance; only the host spawns the enemy. */
  _summonBoss() {
    const lx = this.bossCenter.x - DUNGEON_ORIGIN.x, lz = this.bossCenter.z - DUNGEON_ORIGIN.z;
    const g = new THREE.Group();
    g.position.set(lx, 0, lz);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff3a24, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    disc.position.y = 0.05;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 2.5, 44).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.y = 0.06;
    g.add(disc, ring);
    this.group.add(g);
    const shaft = makeLightShaft({ color: 0xff5a3a, length: 5.4, topWidth: 0.6, bottomWidth: 3.0, opacity: 0.5, tilt: 0, spin: 2.4, motes: 20 });
    shaft.position.set(lx, 3.7, lz);
    this.group.add(shaft);
    this.shafts.push(shaft);
    this._bossPortal = { mesh: g, disc, ring, shaft, t: 0, spawned: false };
    this.game.audio.telegraph?.();
    this.game.engine.shake(0.25);
  }

  _disposeBossPortal() {
    const bp = this._bossPortal;
    if (!bp) return;
    bp.disc.material.dispose();
    bp.ring.material.dispose();
    bp.mesh.removeFromParent();
    this.shafts = this.shafts.filter((s) => s !== bp.shaft);
    bp.shaft.removeFromParent();
    this._bossPortal = null;
  }

  /** True when a world position sits inside the boss arena (camera lock test). */
  inBossRoom(pos) {
    const b = this.bossRoom;
    return !!b && pos.x >= b.minX && pos.x <= b.maxX && pos.z >= b.minZ && pos.z <= b.maxZ;
  }

  /** x/z are WORLD coordinates. */
  spawnEnemy(kind, seed, tier, x, z, id = null, hpOverride = null) {
    // the boss def is themed per dungeon, derived from the current floor (same
    // on host + guest, since the floor is synced)
    const def = kind === "boss" ? bossDefFor(dungeonIndexFor(this.floor)) : ENEMY_KINDS[kind];
    const creature = new Creature(def.make(seed, tier));
    creature.position.set(x, 0, z);
    creature.heading = Math.random() * Math.PI * 2;
    this.game.engine.scene.add(creature);
    const maxHp = hpOverride ?? def.hp + Math.floor(tier * 0.7);
    const e = {
      id: id ?? this.game.net.newId(),
      kind, seed, tier,
      creature,
      hp: maxHp,
      maxHp,
      def,
      behavior: def.behavior ?? "swarm",
      state: "idle",
      t: Math.random() * 2,
      home: new THREE.Vector3(x, 0, z),
      attackCd: 1 + Math.random(),
      hitCd: 0,
      deadT: -1,
      // combat state machine
      atkState: "none", // none | windup | recover
      atkT: 0,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
      vx: 0, vz: 0, // impulse velocity (knockback + lunges)
      ringRadius: 1,
      telT: -1, // guest-side boss telegraph clock (host drives atkT instead)
    };
    // the boss is flagged here so guests mirroring it via eSnap also get the
    // reference (HP bar) and the flag (loot/fanfare on death)
    if (kind === "boss") {
      e.isBoss = true;
      this.boss = e;
    }
    this.enemies.push(e);
    return e;
  }

  /** x/z world; velocity vx/vz. Fired by ranged foes; mirrored to guests. */
  spawnProjectile(x, z, vx, vz, opts) {
    this.projectiles.spawn(x, z, vx, vz, opts);
    this.game.net.send({ t: "proj", x, z, vx, vz, color: opts.color, dmg: opts.dmg, radius: opts.radius, life: opts.life });
  }

  /** A player bow/staff bolt — collides with enemies rather than players.
   *  Local-only visually (kept off the wire to spare the co-op switch); damage
   *  routes through the usual host/guest split when it lands. */
  spawnPlayerProjectile(x, z, vx, vz, opts = {}) {
    const p = this.projectiles.spawn(x, z, vx, vz, opts);
    p.friendly = true;
    p.crit = !!opts.crit;
    p.pierce = !!opts.pierce;
    p.splash = opts.splash || 0;
    p.hitIds = new Set();
    return p;
  }

  /** Fractional grid cell → group-local position (inverse of worldToCell). */
  cellCenter(x, y) {
    return new THREE.Vector3((x - this.GW / 2 + 0.5) * CELL, 0, (y - this.GH / 2 + 0.5) * CELL);
  }

  /** World x/z → fractional grid cell coords (for the minimap). */
  worldToCell(worldX, worldZ) {
    return {
      x: (worldX - DUNGEON_ORIGIN.x) / CELL + this.GW / 2 - 0.5,
      y: (worldZ - DUNGEON_ORIGIN.z) / CELL + this.GH / 2 - 0.5,
    };
  }

  /** Reveal minimap cells around a world position: nearby corridor cells plus
   * any whole room the point sits inside. Bumps revealVersion when new ground
   * is uncovered so the minimap knows to rebuild its cached layer. */
  reveal(worldX, worldZ, radius = 2.2) {
    if (!this.discovered) return;
    const c = this.worldToCell(worldX, worldZ);
    let changed = false;
    const R = Math.ceil(radius);
    const cx = Math.round(c.x), cy = Math.round(c.y);
    for (let y = cy - R; y <= cy + R; y++)
      for (let x = cx - R; x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= this.GW || y >= this.GH) continue;
        if (!this.open[y][x] || this.discovered[y][x]) continue;
        const dx = x - c.x, dy = y - c.y;
        if (dx * dx + dy * dy <= radius * radius) { this.discovered[y][x] = true; changed = true; }
      }
    for (const rm of this.rooms) {
      if (c.x < rm.x - 0.5 || c.x >= rm.x + rm.w + 0.5 || c.y < rm.y - 0.5 || c.y >= rm.y + rm.h + 0.5) continue;
      for (let y = rm.y; y < rm.y + rm.h; y++)
        for (let x = rm.x; x < rm.x + rm.w; x++)
          if (this.open[y][x] && !this.discovered[y][x]) { this.discovered[y][x] = true; changed = true; }
    }
    if (changed) this.revealVersion++;
  }

  // ---------------------------------------------------------------- update
  update(dt, elapsed) {
    if (!this.active) return;

    // keep the wall-occlusion shader fed with the camera + player torso so
    // walls between them dither away instead of hiding the hero
    feedOccluder(this._wallMat, this.game.player, this.game.engine.camera);

    for (const s of this.shafts) s.userData.update(dt, elapsed);

    // the return portal pulses and slowly spins once it's been conjured
    if (this.returnPortal) {
      const rp = this.returnPortal;
      rp.mesh.rotation.y += dt * 0.7;
      rp.disc.material.opacity = 0.45 + Math.sin(elapsed * 3) * 0.15;
      rp.ring.material.opacity = 0.6 + Math.sin(elapsed * 3 + 1) * 0.15;
    }

    // the boss summoning portal: bloom open, spit the boss out, then fade away
    if (this._bossPortal) {
      const bp = this._bossPortal;
      bp.t += dt;
      bp.mesh.rotation.y += dt * 2.6;
      const grow = Math.min(1, bp.t / 0.5);
      const s = 0.2 + grow * 0.8;
      bp.mesh.scale.set(s, 1, s);
      const puls = 0.5 + Math.sin(elapsed * 12) * 0.22;
      bp.disc.material.opacity = grow * 0.6 * puls;
      bp.ring.material.opacity = grow * 0.85;
      bp.shaft.userData.update(dt, elapsed);
      if (Math.random() < 0.7)
        this.game.particles.burst(_v.copy(bp.mesh.position).setY(0.2), { color: 0xff6a3a, n: 3, speed: 1.6, up: 4, life: 0.7, size: 0.85 });
      // portal fully open — the boss rises out (host authoritative)
      if (!bp.spawned && bp.t >= 1.4) {
        bp.spawned = true;
        if (!this.game.net.isGuest && this.isBoss && !this.boss) {
          const e = this.spawnEnemy("boss", (this.seed % 100000) + 54321 + this.floor * 991, dungeonIndexFor(this.floor) + 2, this.bossCenter.x, this.bossCenter.z);
          e.creature.animator.squash.kick(6);
        }
        this.game.particles.burst(_v.copy(this.bossCenter).setY(0.2), { color: 0xff5a3a, n: 30, speed: 6, up: 3, life: 0.9, size: 1.4 });
        this.game.engine.shake(0.4);
        this.game.audio.kill?.();
      }
      if (bp.t >= 2.1) this._disposeBossPortal();
    }

    // the boss gate slides up out of sight once it's been unlocked
    if (this.gate && this.gate.raiseT >= 0) {
      this.gate.raiseT += dt;
      const k = Math.min(1, this.gate.raiseT / 0.8);
      this.gate.mesh.position.y = k * 2.0;
      if (k >= 1) { this.gate.mesh.visible = false; this.gate.raiseT = -1; }
    }

    for (const drop of this.drops) {
      if (drop.fly) {
        const f = drop.fly;
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        const e = 1 - (1 - k) * (1 - k); // ease-out toward the resting spot
        drop.mesh.position.x = f.fromX + (drop.restX - f.fromX) * e;
        drop.mesh.position.z = f.fromZ + (drop.restZ - f.fromZ) * e;
        drop.mesh.position.y = 0.35 + Math.sin(k * Math.PI) * f.arc; // popped arc
        if (k >= 1) drop.fly = null;
      } else {
        drop.mesh.position.y = 0.35 + Math.sin(elapsed * 3 + drop.phase) * 0.09;
      }
    }

    const players = this.game.playersInDungeon();
    // host tops the floor back up on a timer (guests receive the spawns via net)
    if (!this.game.net.isGuest && this.spawnCap > 0) this._tickSpawner(dt, players);
    for (const e of [...this.enemies]) {
      if (this.game.net.isGuest) {
        e.creature.update(dt, elapsed); // guest: positions come from the host
        // replay the host's boss telegraph locally (ground FX + HUD countdown)
        if (e.telT >= 0) {
          e.telT += dt;
          if (e.telT >= e.telDur) { e.telT = -1; e.creature.setGlow(null); }
          else this._bossTelegraphFx(e, e.telT / e.telDur, dt);
        }
        continue;
      }
      this._updateEnemy(e, dt, elapsed, players);
      this._contactDamage(e, dt, players);
    }

    // projectiles: move everywhere (visuals); the host resolves enemy→player
    // hits, while friendly bolts→enemy hits resolve for everyone (guests relay
    // the hit to the host, same as a melee swing)
    this.projectiles.update(dt, elapsed);
    this._resolveFriendlyProjectiles();
    if (!this.game.net.isGuest) this._resolveProjectiles(players);
  }

  // Rolling repopulation: every few seconds, if the floor is under its cap,
  // slip one fresh wanderer into a random room that no player can see (well
  // outside every hero's bubble) — so the cellar stays alive as you clear it
  // without monsters ever popping in on top of you. Guests get it via eSnap.
  _tickSpawner(dt, players) {
    this._spawnT -= dt;
    if (this._spawnT > 0) return;
    this._spawnT = 4 + Math.random() * 3; // next attempt in ~4–7s
    // count only living rank-and-file against the cap (the boss doesn't count)
    let live = 0;
    for (const e of this.enemies) if (e.deadT < 0 && !e.isBoss) live++;
    if (live >= this.spawnCap) return;
    if (this.rooms.length < 2) return;

    const MIN_DIST = 9; // world units the spawn must clear every player by
    for (let tries = 0; tries < 12; tries++) {
      const room = this.rooms[1 + Math.floor(Math.random() * (this.rooms.length - 1))];
      const p = this.cellCenter(room.x + Math.random() * room.w - 0.5, room.y + Math.random() * room.h - 0.5);
      if (p.distanceTo(this.entrancePos) < 4) continue; // never at the arrival spot
      const wx = p.x + DUNGEON_ORIGIN.x, wz = p.z + DUNGEON_ORIGIN.z;
      let clear = true;
      for (const pl of players) {
        const dx = pl.creature.position.x - wx, dz = pl.creature.position.z - wz;
        if (dx * dx + dz * dz < MIN_DIST * MIN_DIST) { clear = false; break; }
      }
      if (!clear) continue;
      const kind = this._spawnMix[Math.floor(Math.random() * this._spawnMix.length)];
      this.spawnEnemy(kind, Math.floor(Math.random() * 1e6), this._spawnTier, wx, wz);
      return;
    }
  }

  // touching an enemy's body hurts, attacking or not — a slime that drifts
  // into you should still sting. The player's i-frames gate the actual damage;
  // a per-enemy cooldown keeps the net traffic (remote player) sane.
  _contactDamage(e, dt, players) {
    if (e.deadT >= 0) return;
    e.contactCd = (e.contactCd ?? 0) - dt;
    if (e.contactCd > 0) return;
    const c = e.creature;
    for (const p of players) {
      const pc = p.creature;
      const touch = c.radius + pc.radius + 0.05;
      const dx = pc.position.x - c.position.x;
      const dz = pc.position.z - c.position.z;
      if (dx * dx + dz * dz <= touch * touch) {
        this.game.enemyHitsPlayer(e, p);
        e.contactCd = 0.6;
        break;
      }
    }
  }

  _nearestPlayer(c, players) {
    let target = null, bd = 1e9;
    for (const p of players) {
      const d = c.position.distanceTo(p.creature.position);
      if (d < bd) { bd = d; target = p; }
    }
    return target;
  }

  _updateEnemy(e, dt, elapsed, players) {
    const c = e.creature;
    if (e.deadT >= 0) {
      e.deadT += dt;
      c.update(dt, elapsed);
      if (e.deadT > 1.4) {
        c.position.y -= dt * 1.2; // sink away
        if (e.deadT > 2.2) this._removeEnemy(e);
      }
      return;
    }
    e.t += dt;
    e.attackCd -= dt;

    // apply + decay impulse velocity (knockback + lunge dashes) every frame
    const fr = Math.pow(IMP_DECAY, dt);
    c.position.x += e.vx * dt;
    c.position.z += e.vz * dt;
    e.vx *= fr;
    e.vz *= fr;

    // a lunging foe (slime) only lands its blow once the leap actually reaches a
    // player — checked each frame during the dash rather than up front, so a
    // pounce that falls short or misses deals nothing.
    if (e.lungeHitT > 0) {
      e.lungeHitT -= dt;
      if (this._meleeStrikeHit(e, players, 0.3)) e.lungeHitT = 0;
    }

    const target = this._nearestPlayer(c, players);
    const bd = target ? c.position.distanceTo(target.creature.position) : 1e9;
    const def = e.def;
    const speed = def.speed * (1 + e.tier * 0.08) * (e.enraged ? 1.35 : 1);

    // -------- attack state machine (takes priority over locomotion) --------
    if (e.atkState === "windup") {
      e.atkT += dt;
      if (e.behavior === "boss") this._bossTelegraphFx(e, e.atkT / e.windupDur, dt);
      else this._minionTelegraphFx(e, e.atkT / e.windupDur, dt);
      if (target) c.heading = Math.atan2(target.creature.position.x - c.position.x, target.creature.position.z - c.position.z);
      // melee foes lunge along their committed direction during the windup so
      // the blow lands on contact — they visibly charge in and collide instead
      // of swiping from a gap. Direction is locked at windup start so a dodge
      // still beats it (they charge past where you were).
      if (e.isCharge && target) {
        const contact = c.radius + target.creature.radius;
        const cd = c.position.distanceTo(target.creature.position);
        if (cd > contact) {
          const step = Math.min(speed * 1.9 * dt, cd - contact);
          c.position.x += e.chargeX * step;
          c.position.z += e.chargeZ * step;
        }
      }
      if (e.atkT >= e.windupDur) {
        this._enemyStrike(e, target, players);
        e.atkState = "recover";
        e.atkT = 0;
        c.setGlow(null);
      }
      this._finishFrame(e, dt, elapsed);
      return;
    }
    if (e.atkState === "recover") {
      e.atkT += dt;
      if (e.atkT >= e.recoverDur) e.atkState = "none";
      this._finishFrame(e, dt, elapsed);
      return;
    }

    // -------- aggro + locomotion --------
    if (target && bd < def.aggro) e.state = "chase";
    else if (e.state === "chase") e.state = "idle";

    if (e.state === "chase" && target) this._chase(e, target, bd, speed, dt);
    else this._wander(e, speed, dt);

    this._finishFrame(e, dt, elapsed);
  }

  // separation + wall collision + creature tick + net track, shared by every path
  _finishFrame(e, dt, elapsed) {
    this._separate(e);
    this.game.collide(e.creature.position, e.creature.radius, this.colliders);
    e.creature.update(dt, elapsed);
    this.game.net.trackEnemy(e);
  }

  _chase(e, target, dist, speed, dt) {
    const c = e.creature;
    const tp = target.creature.position;
    _d.set(tp.x - c.position.x, 0, tp.z - c.position.z);
    _d.y = 0;
    _d.normalize();
    const face = Math.atan2(_d.x, _d.z);
    const strike = c.radius + target.creature.radius + (e.def.reach ?? 1);
    const ready = e.attackCd <= 0;

    switch (e.behavior) {
      case "swarm": {
        // erratic weave so a swarm doesn't march in a straight line
        const weave = Math.sin(e.t * 7 + e.seed) * 0.55;
        _p.set(-_d.z, 0, _d.x).multiplyScalar(weave);
        _d.add(_p).normalize();
        c.heading = Math.atan2(_d.x, _d.z);
        if (dist > strike) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "strafe": {
        c.heading = face;
        const ring = strike + 0.7;
        if (dist > ring + 0.4) c.position.addScaledVector(_d, speed * dt);
        else if (dist < ring - 0.5) c.position.addScaledVector(_d, -speed * 0.7 * dt);
        else {
          _p.set(-_d.z, 0, _d.x).multiplyScalar(e.strafeDir);
          c.position.addScaledVector(_p, speed * 0.85 * dt);
          if (Math.random() < 0.012) e.strafeDir *= -1;
        }
        if (dist <= strike + 0.5 && ready) this._beginWindup(e, target);
        break;
      }
      case "lunge": {
        c.heading = face;
        const range = c.radius + target.creature.radius + 3.4;
        if (dist > range) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "slam": {
        c.heading = face;
        if (dist > strike - 0.4) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "boss": {
        // pattern rotation: slam when the player is in reach; at range, swap
        // between a room-crossing charge and a radial orb burst so kiting and
        // hugging the boss demand different dodges
        c.heading = face;
        if (ready) {
          if (dist <= strike + 0.5) e.bossAttack = "slam";
          else {
            // each boss cycles its own ranged rotation (see BOSSES)
            const rot = e.def.rotation ?? ["charge", "burst"];
            e.rotIdx = ((e.rotIdx ?? -1) + 1) % rot.length;
            e.bossAttack = rot[e.rotIdx];
          }
          this._beginWindup(e, target);
        } else if (dist > strike - 0.6) c.position.addScaledVector(_d, speed * dt);
        break;
      }
      case "charger": {
        // hangs at mid-range, then telegraphs a lane and hurls itself down it
        c.heading = face;
        const range = c.radius + target.creature.radius + 5.5;
        if (dist > range) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "bomber": {
        // a straight rush — it wants to hug you before it blows
        c.heading = face;
        if (dist > strike - 0.3) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
        break;
      }
      case "caster":
      case "archer":
      case "geyser":
      case "blinker": {
        c.heading = face;
        const [near, far] = e.def.band;
        if (dist < near) c.position.addScaledVector(_d, -speed * dt);
        else if (dist > far) c.position.addScaledVector(_d, speed * dt);
        else {
          _p.set(-_d.z, 0, _d.x).multiplyScalar(e.strafeDir);
          c.position.addScaledVector(_p, speed * 0.5 * dt);
          if (Math.random() < 0.009) e.strafeDir *= -1;
          if (ready) this._beginWindup(e, target);
        }
        break;
      }
      default: {
        c.heading = face;
        if (dist > strike) c.position.addScaledVector(_d, speed * dt);
        else if (ready) this._beginWindup(e, target);
      }
    }
  }

  _wander(e, speed, dt) {
    const c = e.creature;
    if (e.t > 2.5) {
      e.t = 0;
      e.wanderTarget = e.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
    }
    if (e.wanderTarget) {
      _d.set(e.wanderTarget.x - c.position.x, 0, e.wanderTarget.z - c.position.z);
      if (_d.length() > 0.3) {
        _d.normalize();
        c.heading = Math.atan2(_d.x, _d.z);
        c.position.addScaledVector(_d, speed * 0.35 * dt);
      }
    }
  }

  // push apart from other living enemies so a mob doesn't collapse into one blob
  _separate(e) {
    const c = e.creature;
    for (const o of this.enemies) {
      if (o === e || o.deadT >= 0) continue;
      const oc = o.creature;
      const dx = c.position.x - oc.position.x;
      const dz = c.position.z - oc.position.z;
      const min = c.radius + oc.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        c.position.x += (dx / d) * push;
        c.position.z += (dz / d) * push;
      }
    }
  }

  // Ground sparks that trace where the boss's next attack will land, emitted
  // every few frames through the windup: a red ring on the slam's full reach,
  // an orange lane down the charge path, and a purple ripple swelling out to
  // where the burst orbs will fly. frac is windup progress, 0 → 1.
  _bossTelegraphFx(e, frac, dt) {
    e.telFxT = (e.telFxT ?? 0) - dt;
    if (e.telFxT > 0) return;
    e.telFxT = 0.07;
    const c = e.creature;
    const P = this.game.particles;
    const atk = e.bossAttack ?? "slam";
    if (atk === "charge") {
      for (let i = 1; i <= 9; i++) {
        _v.set(c.position.x + e.chargeX * i * 1.1, 0.08, c.position.z + e.chargeZ * i * 1.1);
        P.burst(_v, { color: 0xffb25a, n: 1, speed: 0.3, up: 0.6, gravity: 0, life: 0.28, size: 0.8 });
      }
    } else if (atk === "burst") {
      P.ring(_v.copy(c.position).setY(0.08), c.radius + 0.4 + frac * 2.6, { color: 0xb06cff, n: 16, life: 0.3, size: 0.85 });
    } else if (atk === "pounce") {
      // the landing ring, tightening as the leap gets close
      if (e.markX != null) P.ring(_v.set(e.markX, 0.08, e.markZ), 2.4 - frac * 0.5, { color: 0xff8a3a, n: 14, life: 0.3, size: 0.9 });
    } else if (atk === "deluge") {
      // every splash zone shimmers through the whole windup
      for (const pt of e.delugePts ?? []) {
        P.ring(_v.set(pt.x, 0.08, pt.z), 1.7, { color: 0x4db9ff, n: 10, life: 0.3, size: 0.8 });
      }
    } else if (atk === "blink") {
      // the arrival ripple — it appears *there*, not where it's standing
      if (e.markX != null) P.ring(_v.set(e.markX, 0.08, e.markZ), 1.1 + frac * 0.4, { color: 0x7fe8d8, n: 12, life: 0.3, size: 0.8 });
    } else {
      P.ring(_v.copy(c.position).setY(0.08), e.ringRadius + 0.25, { color: 0xff5a3a, n: 18, life: 0.3, size: 0.9 });
    }
  }

  // Ground FX for the themed minions' signature attacks (host-side, same
  // throttle as the boss version): a lane for the charger, a splash ring on
  // the geyser's mark, a swelling blast ring on the bomber, and the blinker's
  // arrival ripple. Plain melee/ranged kinds still telegraph with glow alone.
  _minionTelegraphFx(e, frac, dt) {
    const b = e.behavior;
    if (b !== "charger" && b !== "geyser" && b !== "bomber" && b !== "blinker") return;
    e.telFxT = (e.telFxT ?? 0) - dt;
    if (e.telFxT > 0) return;
    e.telFxT = 0.08;
    const c = e.creature;
    const P = this.game.particles;
    if (b === "charger") {
      for (let i = 1; i <= 6; i++) {
        _v.set(c.position.x + e.chargeX * i * 1.0, 0.08, c.position.z + e.chargeZ * i * 1.0);
        P.burst(_v, { color: 0xf5e6b8, n: 1, speed: 0.3, up: 0.5, gravity: 0, life: 0.25, size: 0.7 });
      }
    } else if (b === "geyser" && e.markX != null) {
      P.ring(_v.set(e.markX, 0.08, e.markZ), e.def.reach ?? 1.7, { color: 0x4db9ff, n: 10, life: 0.28, size: 0.8 });
    } else if (b === "bomber") {
      P.ring(_v.copy(c.position).setY(0.08), (e.ringRadius + 0.2) * (0.4 + frac * 0.6), { color: 0xd06cff, n: 12, life: 0.26, size: 0.8 });
    } else if (b === "blinker" && e.markX != null) {
      P.ring(_v.set(e.markX, 0.08, e.markZ), 0.9 + frac * 0.4, { color: 0xd48cff, n: 10, life: 0.26, size: 0.7 });
    }
  }

  // begin a telegraphed attack: crouch, glow, warn the ear
  _beginWindup(e, target) {
    const c = e.creature;
    const def = e.def;
    e.atkState = "windup";
    e.atkT = 0;
    e.windupDur = def.windup;
    e.recoverDur = 0.32 + def.windup * 0.35;
    e.attackCd = 1.3 + Math.random() * 0.7;
    c.animator.squash.kick(-2.5); // anticipation dip
    c.setGlow(def.glow ?? [0.6, 0.2, 0.1]);
    // ranged foes telegraph with the body glow only; melee reaches farther
    const ranged = ["caster", "archer", "geyser", "blinker"].includes(e.behavior);
    // lock a charge direction for melee foes (lunge/charger dash on strike)
    e.isCharge = !ranged && e.behavior !== "lunge" && e.behavior !== "charger";
    if ((e.isCharge || e.behavior === "charger") && target) {
      _p.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z).normalize();
      e.chargeX = _p.x;
      e.chargeZ = _p.z;
    }
    e.ringRadius = ranged ? 0 : e.behavior === "slam" || e.behavior === "bomber"
      ? def.reach + c.radius
      : (def.reach ?? 1) + c.radius + (target ? target.creature.radius : 0.34);
    // signature minion attacks lock their ground mark at windup start, boss-style:
    // the telegraph shows exactly where the blow lands, and moving off it dodges
    e.markX = e.markZ = null;
    if (e.behavior === "geyser" && target) {
      e.markX = target.creature.position.x;
      e.markZ = target.creature.position.z;
    } else if (e.behavior === "blinker" && target) {
      const t = target.creature.position;
      const a = Math.random() * Math.PI * 2;
      e.markX = t.x + Math.sin(a) * 2.4;
      e.markZ = t.z + Math.cos(a) * 2.4;
    }
    // the boss telegraphs each pattern differently: its own windup length and
    // a distinct glow colour per attack, all faster once enraged
    if (e.behavior === "boss") {
      const atk = e.bossAttack ?? "slam";
      // longer windups + a fat gap between attacks so each pattern reads as
      // its own beat: telegraph, dodge, punish, breathe
      // per-attack windups scale off the boss's base windup (stock boss: the
      // original 1.1 / 0.85 / 1.03 beats), so a quick boss telegraphs quicker
      e.windupDur = (def.windup + (BOSS_ATK_WINDUP[atk] ?? 0.25)) * (e.enraged ? 0.8 : 1);
      // deeper keepers breathe less between patterns (paceMul, see bossDefFor)
      e.attackCd = (2.8 + Math.random() * 0.9) * (def.paceMul ?? 1);
      if (e.enraged) e.attackCd *= 0.75;
      e.recoverDur = 0.85;
      e.isCharge = false; // patterns move on strike, not during the windup
      e.ringRadius = atk === "slam" ? def.reach + c.radius : 0;
      c.setGlow(BOSS_ATK_GLOW[atk] ?? def.glow);
      // signature patterns lock their ground marks at windup start, so the
      // telegraph shows exactly where the blow will land — moving off the
      // mark is the dodge (clear stale marks so the net message can't leak
      // a previous attack's point)
      e.markX = e.markZ = null;
      e.delugePts = null;
      if (atk === "pounce" && target) {
        // leap onto where the target stands right now (capped range)
        const t = target.creature.position;
        const dx = t.x - c.position.x, dz = t.z - c.position.z;
        const d = Math.hypot(dx, dz) || 1;
        const reach = Math.min(d, 8);
        e.markX = c.position.x + (dx / d) * reach;
        e.markZ = c.position.z + (dz / d) * reach;
      } else if (atk === "deluge") {
        // one geyser under the target, the rest scattered around the arena
        const pts = [];
        if (target) pts.push({ x: target.creature.position.x, z: target.creature.position.z });
        while (pts.length < 5) {
          const a = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 3.5;
          pts.push({ x: c.position.x + Math.sin(a) * r, z: c.position.z + Math.cos(a) * r });
        }
        e.delugePts = pts;
      } else if (atk === "blink" && target) {
        // reappear at the target's side — the ripple marks the arrival spot
        const t = target.creature.position;
        const a = Math.random() * Math.PI * 2;
        e.markX = t.x + Math.sin(a) * 2.2;
        e.markZ = t.z + Math.cos(a) * 2.2;
      }
      // guests mirror the telegraph (HUD countdown + ground FX) from this
      this.game.net.send({
        t: "bossTel", id: e.id, atk, dur: e.windupDur, r: e.ringRadius,
        dx: e.chargeX ?? 0, dz: e.chargeZ ?? 0,
        px: e.markX ?? 0, pz: e.markZ ?? 0, pts: e.delugePts ?? null,
      });
    }
    this.game.audio.telegraph();
  }

  // resolve a telegraphed attack the moment it lands — only hits players still
  // in range, so dodging or backing out beats it cleanly.
  _enemyStrike(e, target, players) {
    const c = e.creature;
    const def = e.def;
    const game = this.game;
    c.attack();
    c.animator.squash.kick(4);

    switch (e.behavior) {
      case "caster":
      case "archer": {
        if (!target) break;
        _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z);
        _d.y = 0;
        _d.normalize();
        const sp = def.projSpeed;
        const y = Math.max(0.5, c.height * 0.6);
        const ox = c.position.x + _d.x * (c.radius + 0.2);
        const oz = c.position.z + _d.z * (c.radius + 0.2);
        this.spawnProjectile(ox, oz, _d.x * sp, _d.z * sp, { color: def.projColor, dmg: def.dmg, radius: 0.28, life: 3.0, y });
        // deeper casters throw a 3-orb fan
        if (e.behavior === "caster" && e.tier >= 2) {
          for (const off of [-0.32, 0.32]) {
            const dx = _d.x * Math.cos(off) - _d.z * Math.sin(off);
            const dz = _d.x * Math.sin(off) + _d.z * Math.cos(off);
            this.spawnProjectile(c.position.x + dx * (c.radius + 0.2), c.position.z + dz * (c.radius + 0.2), dx * sp, dz * sp, { color: def.projColor, dmg: def.dmg, radius: 0.24, life: 3.0, y });
          }
        }
        game.audio.shoot();
        break;
      }
      case "lunge": {
        if (target) {
          _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z);
          _d.y = 0;
          const dist = _d.length();
          _d.normalize();
          // leap just past where the target stands so the pounce actually reaches
          // them; damage is dealt on contact during the dash (see _updateEnemy),
          // not instantly from a gap — dodging sideways makes it whiff.
          const leap = (dist + 0.3) * LEAP_K;
          e.vx = _d.x * leap;
          e.vz = _d.z * leap;
          c.animator.squash.kick(6);
          e.lungeHitT = 0.5; // window the dash can connect its blow
        }
        game.audio.hit();
        break;
      }
      case "slam": {
        const r = e.ringRadius + 0.25;
        for (const p of players) {
          if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
        }
        game.engine.shake(0.18);
        game.audio.kill();
        game.particles.burst(_v.copy(c.position).setY(0.1), { color: 0xff8a5a, n: 16, speed: 4.2, up: 1.6, life: 0.5, size: 1.1 });
        break;
      }
      case "charger": {
        // hurl itself down the lane locked at windup start; damage lands on
        // contact during the dash, so stepping out of the lane dodges it clean
        if (target) {
          const dist = c.position.distanceTo(target.creature.position);
          const leap = (dist + 1.2) * LEAP_K;
          e.vx = e.chargeX * leap;
          e.vz = e.chargeZ * leap;
          c.animator.squash.kick(5);
          e.lungeHitT = 0.5;
        }
        game.audio.hit();
        game.engine.shake(0.1);
        break;
      }
      case "geyser": {
        // the marked splash zone erupts — only hits players still on the mark
        if (e.markX != null) {
          const r = def.reach ?? 1.7;
          for (const p of players) {
            if (Math.hypot(p.creature.position.x - e.markX, p.creature.position.z - e.markZ) <= r + p.creature.radius)
              game.enemyHitsPlayer(e, p);
          }
          game.particles.burst(_v.set(e.markX, 0.1, e.markZ), { color: 0x5dd0ff, n: 16, speed: 3.6, up: 3.6, life: 0.7, size: 1.1 });
          game.audio.kill();
        }
        break;
      }
      case "blinker": {
        // vanish, reappear on the marked ripple and fire the instant it lands
        if (e.markX != null) {
          game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0xd48cff, n: 10, speed: 3, life: 0.4, size: 0.8 });
          c.position.set(e.markX, 0, e.markZ);
          c.animator.prevPos.copy(c.position);
          game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0xd48cff, n: 10, speed: 3, life: 0.4, size: 0.8 });
          if (target) {
            _d.set(target.creature.position.x - c.position.x, 0, target.creature.position.z - c.position.z).normalize();
            c.heading = Math.atan2(_d.x, _d.z);
            const sp = def.projSpeed;
            const y = Math.max(0.5, c.height * 0.6);
            this.spawnProjectile(c.position.x + _d.x * (c.radius + 0.2), c.position.z + _d.z * (c.radius + 0.2), _d.x * sp, _d.z * sp, { color: def.projColor, dmg: def.dmg, radius: 0.26, life: 2.4, y });
          }
        }
        game.audio.shoot();
        break;
      }
      case "bomber": {
        // blows itself apart — everything inside the swollen ring gets hit,
        // and the sporeling dies in the blast (its own loot still drops)
        const r = e.ringRadius + 0.25;
        for (const p of players) {
          if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
        }
        game.particles.burst(_v.copy(c.position).setY(0.15), { color: 0xd06cff, n: 22, speed: 5, up: 2.4, life: 0.6, size: 1.2 });
        game.particles.burst(_v.copy(c.position).setY(0.15), { color: 0x9fe07a, n: 12, speed: 3.4, up: 3, life: 0.7, size: 0.9 });
        game.engine.shake(0.16);
        game.audio.kill();
        this.killEnemy(e, 0, 0);
        break;
      }
      case "boss": {
        const atk = e.bossAttack ?? "slam";
        if (atk === "burst") {
          // radial ring of slow orbs — weave between them or roll through
          const n = (e.def.burstN ?? 8) + (e.enraged ? 4 : 0);
          const y = Math.max(0.5, c.height * 0.45);
          const sp = def.projSpeed;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + c.heading;
            const dx = Math.sin(a), dz = Math.cos(a);
            this.spawnProjectile(c.position.x + dx * (c.radius + 0.3), c.position.z + dz * (c.radius + 0.3), dx * sp, dz * sp, { color: def.projColor, dmg: 1, radius: 0.3, life: 2.6, y });
          }
          game.audio.shoot();
          game.engine.shake(0.12);
        } else if (atk === "charge") {
          // hurl itself down the lane locked (and telegraphed) at windup start;
          // damage lands on contact during the dash (lungeHitT), so stepping
          // out of the marked lane makes it barrel past
          if (target) {
            const dist = c.position.distanceTo(target.creature.position);
            const leap = (dist + 1.6) * LEAP_K;
            e.vx = e.chargeX * leap;
            e.vz = e.chargeZ * leap;
            c.animator.squash.kick(6);
            e.lungeHitT = 0.6;
          }
          game.audio.hit();
          game.engine.shake(0.15);
        } else if (atk === "pounce") {
          // leap exactly onto the marked ring; damage on contact during the
          // flight, so stepping off the mark makes her sail past
          if (e.markX != null) {
            const dx = e.markX - c.position.x, dz = e.markZ - c.position.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.01) {
              const leap = d * LEAP_K;
              e.vx = (dx / d) * leap;
              e.vz = (dz / d) * leap;
            }
            c.animator.squash.kick(7);
            e.lungeHitT = 0.55;
          }
          game.audio.hit();
          game.engine.shake(0.18);
        } else if (atk === "deluge") {
          // every marked splash zone erupts at once — one hit per player max
          const soaked = new Set();
          for (const pt of e.delugePts ?? []) {
            for (const p of players) {
              if (soaked.has(p)) continue;
              if (Math.hypot(p.creature.position.x - pt.x, p.creature.position.z - pt.z) <= 1.7 + p.creature.radius) {
                soaked.add(p);
                game.enemyHitsPlayer(e, p);
              }
            }
            game.particles.burst(_v.set(pt.x, 0.1, pt.z), { color: 0x5dd0ff, n: 14, speed: 3.4, up: 3.4, life: 0.7, size: 1.1 });
          }
          e.delugePts = null;
          game.audio.kill();
          game.engine.shake(0.2);
        } else if (atk === "blink") {
          // vanish and reappear on the marked ripple, spitting a tight ring of
          // quick orbs on arrival — roll through the gaps
          if (e.markX != null) {
            game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0x7fe8d8, n: 12, speed: 3, life: 0.4, size: 0.9 });
            c.position.set(e.markX, 0, e.markZ);
            c.animator.prevPos.copy(c.position);
            game.particles.burst(_v.copy(c.position).setY(c.height * 0.5), { color: 0x7fe8d8, n: 12, speed: 3, life: 0.4, size: 0.9 });
            const y = Math.max(0.5, c.height * 0.45);
            const sp = def.projSpeed;
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + c.heading;
              const dx = Math.sin(a), dz = Math.cos(a);
              this.spawnProjectile(c.position.x + dx * (c.radius + 0.25), c.position.z + dz * (c.radius + 0.25), dx * sp, dz * sp, { color: def.projColor, dmg: 1, radius: 0.26, life: 1.8, y });
            }
          }
          game.audio.shoot();
          game.engine.shake(0.1);
        } else {
          // the wide arena-shaking slam (same shape as the brute's, but bigger)
          const r = e.ringRadius + 0.25;
          for (const p of players) {
            if (c.position.distanceTo(p.creature.position) <= r + p.creature.radius) game.enemyHitsPlayer(e, p);
          }
          game.engine.shake(0.24);
          game.audio.kill();
          game.particles.burst(_v.copy(c.position).setY(0.1), { color: 0xff5a3a, n: 22, speed: 5, up: 1.8, life: 0.55, size: 1.25 });
        }
        break;
      }
      default: { // swarm, strafe: a quick directional swipe
        this._meleeStrikeHit(e, players, (def.reach ?? 1) + 0.35);
        game.audio.swing();
      }
    }
  }

  // hit the first player inside the swing's reach + rough frontal arc
  _meleeStrikeHit(e, players, extra) {
    const c = e.creature;
    for (const p of players) {
      const pc = p.creature;
      const dx = pc.position.x - c.position.x;
      const dz = pc.position.z - c.position.z;
      const d = Math.hypot(dx, dz);
      const range = c.radius + pc.radius + extra;
      if (d > range) continue;
      const dot = (dx * Math.sin(c.heading) + dz * Math.cos(c.heading)) / (d || 1);
      if (dot > -0.15) {
        this.game.enemyHitsPlayer(e, p);
        return true;
      }
    }
    return false;
  }

  // Player bow/staff bolts vs. enemies. Non-piercing shots burst on first hit;
  // staff bolts pierce (tracking who they've already struck) and may splash.
  _resolveFriendlyProjectiles() {
    const game = this.game;
    for (const proj of this.projectiles.list) {
      if (proj.dead || !proj.friendly) continue;
      if (this._projHitsWall(proj)) { this._projBurst(proj); continue; }
      for (const e of this.enemies) {
        if (e.deadT >= 0 || e.hitCd > 0) continue;
        if (proj.hitIds && proj.hitIds.has(e.id)) continue;
        const c = e.creature;
        const dx = proj.x - c.position.x;
        const dz = proj.z - c.position.z;
        const rr = proj.radius + c.radius;
        if (dx * dx + dz * dz > rr * rr) continue;
        const nx = -dx / (Math.hypot(dx, dz) || 1);
        const nz = -dz / (Math.hypot(dx, dz) || 1);
        if (game.net.isGuest) {
          c.hurt();
          game.audio.hit();
          game.net.send({ t: "hit", id: e.id, dmg: proj.dmg, kx: nx, kz: nz });
        } else {
          this.damageEnemy(e, proj.dmg, nx, nz, { crit: proj.crit, knock: 1 });
          if (proj.splash > 0) this._splashDamage(proj, e);
        }
        if (proj.pierce) { proj.hitIds?.add(e.id); continue; }
        this._projBurst(proj);
        break;
      }
    }
  }

  // Staff splash: everything near the struck foe takes half damage (host only).
  _splashDamage(proj, hitEnemy) {
    const r2 = proj.splash * proj.splash;
    const half = Math.max(1, Math.round(proj.dmg / 2));
    for (const e of this.enemies) {
      if (e === hitEnemy || e.deadT >= 0 || e.hitCd > 0) continue;
      const dx = e.creature.position.x - hitEnemy.creature.position.x;
      const dz = e.creature.position.z - hitEnemy.creature.position.z;
      if (dx * dx + dz * dz > r2) continue;
      this.damageEnemy(e, half, dx / (Math.hypot(dx, dz) || 1), dz / (Math.hypot(dx, dz) || 1), { knock: 0.6 });
    }
  }

  _resolveProjectiles(players) {
    for (const proj of this.projectiles.list) {
      if (proj.dead || proj.friendly) continue;
      if (this._projHitsWall(proj)) { this._projBurst(proj); continue; }
      for (const p of players) {
        const pc = p.creature;
        const dx = proj.x - pc.position.x;
        const dz = proj.z - pc.position.z;
        const rr = proj.radius + pc.radius;
        if (dx * dx + dz * dz <= rr * rr) {
          this.game.enemyProjectileHitsPlayer(proj, p);
          this._projBurst(proj);
          break;
        }
      }
    }
  }

  _projHitsWall(proj) {
    for (const col of this.colliders) {
      if (Math.abs(proj.x - col.x) < col.hw && Math.abs(proj.z - col.z) < col.hd) return true;
    }
    return false;
  }

  _projBurst(proj) {
    this.game.particles.burst(_v.set(proj.x, proj.y, proj.z), { color: proj.color ?? 0xb98cff, n: 8, speed: 3, life: 0.4 });
    this.game.audio.projHit();
    this.projectiles.remove(proj);
  }

  /** Player attack hits: arc in front of attacker. Returns whether anything was hit. */
  meleeHit(attacker, dmg, game, opts = {}) {
    const { range = 1.75, arc = 0.35, crit = false, finisher = false, knock = 1 } = opts;
    const pos = attacker.position;
    const fwdX = Math.sin(attacker.heading);
    const fwdZ = Math.cos(attacker.heading);
    let hitAny = false;
    for (const e of this.enemies) {
      if (e.deadT >= 0 || e.hitCd > 0) continue;
      const c = e.creature;
      const dx = c.position.x - pos.x;
      const dz = c.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      // reach counts both bodies' girth, so a hit lands when the blade would
      // reasonably reach the foe — not only when centres nearly overlap
      if (dist > range + c.radius + attacker.radius) continue;
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < arc && dist > 1.0) continue;
      hitAny = true;
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      if (game.net.isGuest) {
        // local juice now; the host applies damage and echoes eHurt/eDie
        e.creature.hurt();
        game.audio.hit();
        game.engine.hitStop(0.05);
        game.net.send({ t: "hit", id: e.id, dmg, kx: nx, kz: nz });
      } else {
        this.damageEnemy(e, dmg, nx, nz, { crit, finisher, knock });
      }
    }
    // the same swing bursts open any treasure chest it sweeps through — there's
    // no dedicated "open" button any more, you crack them with the blade
    for (const chest of this.chests) {
      if (chest.opened) continue;
      const dx = chest.mesh.position.x + DUNGEON_ORIGIN.x - pos.x;
      const dz = chest.mesh.position.z + DUNGEON_ORIGIN.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + attacker.radius + 0.5) continue;
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < arc && dist > 1.0) continue;
      hitAny = true;
      game._openChest(chest);
    }
    // the same swing shatters any destructible scenery it sweeps through — a
    // purely cosmetic puff of leaves/dust/bone, no loot, and rocks are spared
    if (this._smashDecor(pos, fwdX, fwdZ, range, arc)) hitAny = true;
    return hitAny;
  }

  // Smash every destructible prop caught in the swing's reach + frontal arc.
  // Cosmetic only: bursts particles, plays a crunch, drops nothing. Runs
  // client-side for everyone (the layout is seeded, so peers agree).
  _smashDecor(pos, fwdX, fwdZ, range, arc) {
    if (!this.decor.length) return false;
    let hit = false;
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      const dx = d.wx - pos.x;
      const dz = d.wz - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + d.radius) continue;
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < arc && dist > 1.0) continue;
      this.decor.splice(i, 1);
      this._burstDecor(d);
      hit = true;
    }
    return hit;
  }

  // Pop one prop: a two-tone particle spray (its own colour plus a paler mote)
  // scaled to its size, a light crunch, then free the sprite.
  _burstDecor(d) {
    const game = this.game;
    const n = Math.round(10 + d.height * 8);
    _v.set(d.wx, d.height * 0.45, d.wz);
    game.particles.burst(_v, { color: d.color, n, speed: 3 + d.height, up: 2 + d.height * 0.8, life: 0.6, size: 0.9 + d.height * 0.2 });
    game.particles.burst(_v, { color: 0xffffff, n: Math.ceil(n * 0.35), speed: 2.4, up: 2.2, life: 0.45, size: 0.7 });
    game.audio.projHit?.();
    disposeDecor(d.group);
    d.group.removeFromParent();
  }

  damageEnemy(e, dmg, kx = 0, kz = 0, opts = {}) {
    if (e.deadT >= 0) return;
    const game = this.game;
    const { crit = false, finisher = false, knock = 1 } = opts;
    e.hp -= dmg;
    e.hitCd = 0.12;
    setTimeout(() => (e.hitCd = 0), 130);
    const c = e.creature;
    c.hurt();
    // knockback as a decaying impulse — weightier than the old teleport nudge
    const kAmt = (finisher ? 9 : crit ? 6 : 4) * knock;
    e.vx += kx * kAmt;
    e.vz += kz * kAmt;
    // a crit or finisher staggers a winding-up enemy, cancelling its attack —
    // except the boss, which shrugs it off so it can't be stun-locked
    if ((crit || finisher) && e.atkState === "windup" && !e.isBoss) {
      e.atkState = "recover";
      e.atkT = 0;
      c.setGlow(null);
    }
    // half-health boss flips to its enraged phase: faster, harsher patterns,
    // and it calls a pack of minions into the arena
    if (e.isBoss && !e.enraged && e.hp > 0 && e.hp <= e.maxHp / 2) this._enrageBoss(e);
    game.hud.float(_v.copy(c.position).setY(c.height + 0.3), crit ? `${dmg}!` : `${dmg}`, crit ? "dmg crit" : "dmg");
    game.particles.burst(_v.copy(c.position).setY(c.height * 0.6), { color: crit ? 0xfff1a8 : 0xffe08a, n: crit ? 12 : 6, speed: crit ? 3.6 : 2.5, life: 0.4 });
    if (crit) game.audio.crit();
    else game.audio.hit();
    game.engine.hitStop(finisher ? 0.11 : crit ? 0.08 : 0.05);
    if (e.hp <= 0) this.killEnemy(e, kx, kz);
    else game.net.send({ t: "eHurt", id: e.id, hp: e.hp });
  }

  // Boss phase two (host only — runs inside damageEnemy): summon a minion pack
  // around the arena and let the enraged flags speed everything up.
  _enrageBoss(e) {
    e.enraged = true;
    const game = this.game;
    const bp = e.creature.position;
    const r = rng(e.seed + 606);
    const pack = e.def.minions ?? ["skitter", "skitter", "slime"];
    const n = e.def.minionN ?? 3; // deeper bosses call a bigger pack
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      this.spawnEnemy(pick(r, pack), Math.floor(r() * 1e6), 1, bp.x + Math.sin(a) * 2.6, bp.z + Math.cos(a) * 2.6);
    }
    game.particles.burst(_v.copy(bp).setY(e.creature.height * 0.5), { color: 0xff3b3b, n: 26, speed: 5.5, up: 2, life: 0.8, size: 1.3 });
    game.engine.shake(0.3);
    game.audio.telegraph();
    game.onBossEnraged?.();
  }

  killEnemy(e, kx, kz) {
    const game = this.game;
    e.deadT = 0;
    e.creature.setGlow(null);
    e.creature.die(_v.set(kx * 8, -3, kz * 8));
    game.audio.kill();
    game.engine.shake(0.15);
    game.net.send({ t: "eDie", id: e.id, kx, kz });
    if (game.net.isGuest) return;
    if (game.today) game.today.slain++;
    // split-on-death (puddle → puddlings): the body bursts into livelier bits
    if (e.def.splitInto && this.active) {
      const rs = rng(e.seed + 41);
      for (let i = 0; i < 2; i++) {
        const a = rs() * Math.PI * 2;
        const m = this.spawnEnemy(e.def.splitInto, Math.floor(rs() * 1e6), e.tier, e.creature.position.x + Math.sin(a) * 0.55, e.creature.position.z + Math.cos(a) * 0.55);
        // brief grace so the killing swing can't sweep them too — must clear on
        // a timer (hitCd is never ticked down per-frame; it's only reset here
        // and after a hit in damageEnemy), or the droplets stay unhittable.
        m.hitCd = 0.35;
        setTimeout(() => (m.hitCd = 0), 350);
        m.creature.animator.squash.kick(5);
      }
    }
    // the boss goes out with a bang: its body blows apart and the treasure it
    // guarded flies out across the whole arena
    if (e.isBoss) {
      this.boss = null;
      this._explodeBoss(e);
      game.onBossDefeated?.(e.creature.position);
      const bx = e.creature.position.x, bz = e.creature.position.z;
      const rl = rng(e.seed + 5);
      const b = this.bossRoom;
      // bosses are the only source of gear: two distinct equipment pieces, plus
      // a guaranteed crown, a healing potion and a fistful of top-tier spoils
      let g1 = pick(rl, EQUIP_DROPS), g2 = pick(rl, EQUIP_DROPS);
      while (g2 === g1) g2 = pick(rl, EQUIP_DROPS);
      // the rest of the hoard is the dungeon's own treasure, and deeper
      // keepers guard a bigger pile of it
      const hole = dungeonIndexFor(this.floor);
      const table = DUNGEON_LOOT[hole] ?? DUNGEON_LOOT[0];
      const spoils = [g1, g2, "crown", "potion"];
      for (let i = 0; i < 3 + hole; i++) spoils.push(pick(rl, table.rare));
      spoils.forEach((id, i) => {
        // scatter across the arena floor (kept off the walls) — each spoil arcs
        // out from where the boss fell, so the loot showers across the room
        let x, z;
        if (b) {
          x = b.minX + 1.6 + rl() * (b.maxX - b.minX - 3.2);
          z = b.minZ + 1.6 + rl() * (b.maxZ - b.minZ - 3.2);
        } else {
          const a = (i / spoils.length) * Math.PI * 2;
          x = bx + Math.sin(a) * 3.4;
          z = bz + Math.cos(a) * 3.4;
        }
        this.spawnDrop(id, x, z, null, { flyFrom: { x: bx, z: bz } });
      });
      return;
    }
    // loot: enemies only drop merchandise — gold comes solely from selling it.
    // Mostly the monster's own signature loot, sometimes the dungeon's themed
    // table, with rare finds growing likelier toward each hole's boss floor.
    const r = rng(e.seed + 99);
    if (r() < (e.def.dropRate ?? 0.6)) {
      const table = DUNGEON_LOOT[dungeonIndexFor(this.floor)] ?? DUNGEON_LOOT[0];
      const localFloor = (this.floor - 1) % FLOORS_PER_DUNGEON;
      const id = e.def.loot && r() < 0.65 ? pick(r, e.def.loot)
        : r() < 0.12 + localFloor * 0.06 ? pick(r, table.rare)
        : pick(r, table.common);
      this.spawnDrop(id, e.creature.position.x, e.creature.position.z);
    }
  }

  /** Blow the boss apart piece by piece: each body mesh pops in a staggered
   * burst of debris and vanishes, capped by one big white flash. Cosmetic, so
   * it runs on host + guest (see the eDie mirror). */
  _explodeBoss(e) {
    const game = this.game;
    const c = e.creature;
    const parts = [];
    c.traverse((o) => { if (o.isMesh && o !== c.shadow) parts.push(o); });
    // hide the blob shadow right away so it doesn't linger under the debris
    if (c.shadow) c.shadow.visible = false;
    parts.forEach((mesh, i) => {
      setTimeout(() => {
        if (!mesh.parent) return;
        mesh.getWorldPosition(_p);
        game.particles.burst(_p, { color: 0xff7a3a, n: 10, speed: 5.5, up: 3.2, life: 0.7, size: 1.05 });
        game.particles.burst(_p, { color: 0xffe08a, n: 6, speed: 3.6, up: 2.6, life: 0.5, size: 0.8 });
        mesh.visible = false;
        game.engine.shake(0.12);
        game.audio.hit?.();
      }, i * 85);
    });
    // a final concussive flash once the last piece is gone
    setTimeout(() => {
      if (!c.parent) return;
      c.getWorldPosition(_p);
      _p.y += c.height * 0.5;
      game.particles.burst(_p, { color: 0xffffff, n: 34, speed: 7.5, up: 3.4, life: 0.85, size: 1.5 });
      game.particles.burst(_p, { color: 0xff5a3a, n: 20, speed: 5, up: 2.6, life: 0.9, size: 1.2 });
      game.engine.shake(0.5);
    }, parts.length * 85 + 80);
  }

  /** Conjure a shimmering portal at world coords (wx,wz) where the boss fell.
   * `descend` tints it fiery and marks it as the way DOWN to the next stacked
   * dungeon; otherwise it's the cool arcane way HOME (final boss only). Built
   * identically on host and guest (both run onBossDefeated), so it needs no
   * dedicated net message to stay in sync. */
  spawnReturnPortal(wx, wz, descend = false) {
    if (this.returnPortal) return;
    const lx = wx - DUNGEON_ORIGIN.x, lz = wz - DUNGEON_ORIGIN.z;
    const discColor = descend ? 0xff8a3d : 0x5dd0ff;
    const ringColor = descend ? 0xffd36b : 0x9a6dff;
    const shaftColor = descend ? 0xff9a4d : 0x7fd8ff;
    const g = new THREE.Group();
    g.position.set(lx, 0, lz);
    // a glowing disc on the floor with a brighter outer ring
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: discColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    disc.position.y = 0.05;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.35, 30).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.y = 0.06;
    g.add(disc, ring);
    this.group.add(g);
    // a bright column of light rising from the portal (animated via shafts)
    const shaft = makeLightShaft({ color: shaftColor, length: 4.8, topWidth: 0.5, bottomWidth: 2.2, opacity: 0.55, tilt: 0, spin: 1.6, motes: 16 });
    shaft.position.set(lx, 3.4, lz);
    this.group.add(shaft);
    this.shafts.push(shaft);
    this.returnPortal = { pos: new THREE.Vector3(wx, 0, wz), mesh: g, disc, ring, descend };
  }

  /** x/z are WORLD coordinates. `opts.flyFrom` ({x,z}) makes the drop arc out
   * from that point to its resting spot (boss loot spilling across the arena). */
  spawnDrop(itemId, x, z, id = null, opts = {}) {
    const mesh = itemSprite(itemId);
    const rx = x + (Math.random() - 0.5) * 0.6;
    const rz = z + (Math.random() - 0.5) * 0.6;
    mesh.position.set(rx, 0.35, rz);
    mesh.scale.setScalar(1.35);
    const shadow = makeBlobShadow(0.3);
    shadow.position.set(0, -mesh.position.y + 0.02, 0);
    mesh.add(shadow);
    this.game.engine.scene.add(mesh);
    const drop = { id: id ?? this.game.net.newId(), item: itemId, mesh, phase: Math.random() * 9, restX: rx, restZ: rz };
    if (opts.flyFrom) {
      drop.fly = { fromX: opts.flyFrom.x, fromZ: opts.flyFrom.z, t: 0, dur: 0.5 + Math.random() * 0.4, arc: 1.6 + Math.random() * 1.4 };
      mesh.position.set(opts.flyFrom.x, 0.7, opts.flyFrom.z);
    }
    this.drops.push(drop);
    const msg = { t: "drop", id: drop.id, item: itemId, x, z };
    if (opts.flyFrom) { msg.fx = opts.flyFrom.x; msg.fz = opts.flyFrom.z; }
    this.game.net.send(msg);
    return drop;
  }

  takeDrop(drop) {
    drop.mesh.removeFromParent();
    this.drops = this.drops.filter((d) => d !== drop);
  }

  /** Bring the tutorial's hidden stairs (steps, glow, light shaft) back into
   * view. No-op once already shown or off the tutorial floor. */
  revealStairs() {
    if (!this.stairsHidden) return;
    this.stairsHidden = false;
    for (const mesh of this._stairsMeshes || []) mesh.visible = true;
  }

  openChest(chest) {
    if (chest.opened) return null;
    chest.opened = true;
    chest.mesh.children[1].rotation.x = -1.9; // lid flips open
    // cracking the tutorial chest is what unlocks the way home
    if (this.tutorial) this.revealStairs();
    const r = rng(this.seed + chest.id * 313);
    // chest loot draws from the dungeon's own themed table, with the rare
    // shelf growing likelier the closer the floor sits to the hole's boss
    const table = DUNGEON_LOOT[dungeonIndexFor(this.floor)] ?? DUNGEON_LOOT[0];
    const localFloor = (this.floor - 1) % FLOORS_PER_DUNGEON;
    const cx = chest.mesh.position.x + DUNGEON_ORIGIN.x; // chest is group-local
    const cz = chest.mesh.position.z + DUNGEON_ORIGIN.z;
    // the designated key chest guarantees a Brass Key drop — a normal bag item
    // that doubles as the boss door key (see game._openGate). Also pays out a
    // little ordinary loot alongside it, like any other chest.
    if (chest.id === this.keyChestId) {
      this.spawnDrop("key", cx, cz + 0.8);
      this.spawnDrop(pick(r, table.common), cx + 0.7, cz);
      return "key";
    }
    // the FTUE chest always pays out the same two starter wares so the guided
    // first sale is predictable — a Wild Mushroom and a Roast Meat, every time
    if (this.tutorial) {
      this.spawnDrop("mushroom", cx, cz + 0.8);
      this.spawnDrop("meat", cx + 0.7, cz);
      return "mushroom";
    }
    const item = r() < 0.22 + localFloor * 0.18 ? pick(r, table.rare) : pick(r, table.common);
    this.spawnDrop(item, cx, cz + 0.8);
    if (r() < 0.6) this.spawnDrop(pick(r, table.common), cx + 0.7, cz);
    return item;
  }

  _removeEnemy(e) {
    e.creature.dispose();
    this.enemies = this.enemies.filter((x) => x !== e);
    this.game.net.send({ t: "eDel", id: e.id });
  }

  dispose() {
    for (const e of this.enemies) {
      e.creature.dispose();
    }
    this.enemies = [];
    this.projectiles.clear();
    for (const d of this.drops) d.mesh.removeFromParent();
    this.drops = [];
    this.chests = [];
    this.decor = [];
    for (const s of this.shafts) s.userData.dispose();
    this.shafts = [];
    this.colliders = [];
    disposeDecor(this.group); // free the billboard scenery's sprite materials
    this.group.clear();
    this.active = false;
    this.group.visible = false;
    // boss/arena state is torn down with the floor
    this.gate = null;
    this.gateOpen = false;
    this.gatePos = null;
    this.bossRoom = null;
    this.bossCenter = null;
    this.boss = null;
    this.keyChestId = -1;
    this.isBoss = false;
    this._bossPortal = null;
    this.returnPortal = null;
  }
}

const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

function makeChest() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), makeToonMaterial({ color: 0x8a5a33, rim: 0.2 }));
  base.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.3, 0.64), makeToonMaterial({ color: 0x9c6a3e, rim: 0.2 }));
  lid.geometry.translate(0, 0.15, 0.32); // hinge at back edge
  lid.position.set(0, 0.5, -0.32);
  const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.05), makeToonMaterial({ color: 0xf0c04a, rim: 0.3 }));
  clasp.position.set(0, 0.45, 0.31);
  g.add(base, lid, clasp);
  return g;
}

// A portcullis sealing the boss doorway: a stone frame + a grid of iron bars,
// spanning the 2-cell opening. Sits on the floor until the key raises it.
function makeGate() {
  const g = new THREE.Group();
  const barMat = makeToonMaterial({ color: 0x4a4150, rim: 0.2 });
  const stoneMat = makeToonMaterial({ color: 0x241c2e, rim: 0.1 });
  const W = CELL * 2 - 0.15, H = 1.7;
  // side posts + top lintel frame the opening
  const post = () => new THREE.Mesh(new THREE.BoxGeometry(0.22, H, 0.5), stoneMat);
  const pl = post(); pl.position.set(-W / 2, H / 2, 0); g.add(pl);
  const pr = post(); pr.position.set(W / 2, H / 2, 0); g.add(pr);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.3, 0.55), stoneMat);
  lintel.position.set(0, H - 0.05, 0); g.add(lintel);
  // vertical iron bars
  const bars = 7;
  for (let i = 0; i < bars; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, H - 0.1, 6), barMat);
    b.position.set(-W / 2 + (i + 0.5) * (W / bars), (H - 0.1) / 2, 0);
    g.add(b);
  }
  // a couple of horizontal rails tie the bars together
  for (const y of [H * 0.28, H * 0.72]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.09, 0.09), barMat);
    rail.position.set(0, y, 0);
    g.add(rail);
  }
  return g;
}

// Build a single merged floor mesh covering only the open cells of the grid.
// Each open cell becomes one upward-facing quad; UVs are mapped to the cell's
// grid position so the tiled texture stays continuous across the whole floor.
function makeFloorGeometry(open, GW, GH, cellPos) {
  const hw = CELL / 2;
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  let v = 0;
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (!open[y][x]) continue;
      const p = cellPos(x, y);
      // four corners (A,B,C,D) counter-clockwise from viewed above
      const A = [p.x - hw, 0, p.z - hw];
      const B = [p.x + hw, 0, p.z - hw];
      const C = [p.x + hw, 0, p.z + hw];
      const D = [p.x - hw, 0, p.z + hw];
      positions.push(...A, ...B, ...C, ...D);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      // continuous UVs as a fraction of the grid, matching the old single-plane
      // mapping (the texture's own repeat wrap handles the tiling density)
      const u0 = x / GW, u1 = (x + 1) / GW, v0 = y / GH, v1 = (y + 1) / GH;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
      v += 4;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function makeTilesTexture(palette, seed) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const r = rng(seed);
  const c0 = new THREE.Color(palette[0]);
  const c1 = new THREE.Color(palette[1]);
  g.fillStyle = "#" + c1.clone().multiplyScalar(0.72).getHexString();
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const t = r() * 0.5 + ((x + y) % 2) * 0.5;
      const col = c0.clone().lerp(c1, t);
      g.fillStyle = "#" + col.getHexString();
      g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}
