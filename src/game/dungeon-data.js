// Dungeon data tables: enemy roster, boss definitions, loot tables, themes and
// the floor/dungeon geometry math. Pure data + tiny helpers, split out of
// dungeon.js so the class file can stay a slim orchestrator.
import * as THREE from "three";
import { goblinSpec, bruteSpec, skitterSpec, slimeSpec, wispSpec, archerSpec, bossSpec, humanoidSpec, ratSpec, hsl } from "../chargen/species.js";
import { rng, pick, clamp } from "../core/engine.js";

export const DUNGEON_ORIGIN = new THREE.Vector3(200, 0, 0);

// Each kind now carries a `behavior` that drives a distinct combat pattern, a
// windup time (how long its telegraph reads before the blow lands — the
// reaction window the player dodges into) and, for ranged foes, a keep-away
// band. Every attack now telegraphs before it can hurt you.
export const ENEMY_KINDS = {
  // warren rat: harmless prey. It never attacks — the moment it notices you it
  // bolts the other way (behavior "flee"), so the first floor is a low-stakes
  // chase. Frail and quick; drops its hide when you finally corner one.
  rat: {
    make: (seed) => ratSpec({ key: `e_rat_${seed % 6}`, seed, scale: 0.55 + (seed % 3) * 0.03, hue: 0.05 + (seed % 4) * 0.02 }),
    // low aggro so it only bolts once you're right on top of it (otherwise it
    // just potters about); rathide is an uncommon drop so hides stay worth it
    hp: 2, dmg: 0, speed: 3.4, aggro: 4, gold: [2, 6],
    behavior: "flee", harmless: true, windup: 0.3, reach: 0.9, glow: [0.5, 0.35, 0.3],
    loot: ["rathide"], dropRate: 0.3,
  },
  // fast erratic swarmer: darts in, quick bite, backs off
  skitter: {
    make: (seed, tier) => {
      const legsN = pick(rng(seed), [4, 6]);
      // legsN MUST be part of the cache key — bone counts differ
      return skitterSpec({ key: `e_sk${tier}_${legsN}_${seed % 5}`, seed, legsN, scale: 0.62 + tier * 0.05, hue: 0.78 - tier * 0.13 });
    },
    hp: 2, dmg: 1, speed: 2.9, aggro: 7, gold: [3, 8],
    behavior: "swarm", windup: 0.28, reach: 1.05, glow: [0.6, 0.15, 0.15],
    loot: ["egg", "caveshroom"],
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
    loot: ["lantern"],
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
    loot: ["lantern", "potion"],
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
    loot: ["bell", "caveshroom"],
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
    loot: ["caveshroom"],
  },
  // slippery marsh-light: marks a ripple at your flank, blinks onto it and
  // fires the instant it lands (behavior "blinker")
  gloomcaster: {
    make: (seed) => wispSpec({ key: `e_gc_${seed % 4}`, scale: 0.7, hue: 0.75 }),
    hp: 5, dmg: 1, speed: 3.0, aggro: 11, gold: [12, 24],
    behavior: "blinker", windup: 0.6, band: [4, 8], projSpeed: 5.5, projColor: 0xd48cff, glow: [0.6, 0.25, 0.85],
    loot: ["gem", "potion"],
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
export const BOSS_ATK_WINDUP = { charge: 0.32, burst: 0.07, slam: 0.25, pounce: 0.2, deluge: 0.45, blink: 0 };
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
  { // Rat Warren — forage and scraps (herbs/shrooms come from smashing decor now)
    common: ["meat", "bread", "caveshroom", "crystal", "jelly", "egg"],
    rare: ["wsword", "ring", "fang"],
  },
  { // Flooded Deep — what washes down the drain
    common: ["jelly", "crystal", "egg", "potion"],
    rare: ["lantern", "feather", "gem"],
  },
  { // Bone Hollow — grave goods
    common: ["fang", "bomb", "key", "ring", "crystal"],
    rare: ["bell", "ssword", "crown"],
  },
  { // Gloom Drain — marsh treasures
    common: ["potion", "crystal", "gem", "feather"],
    rare: ["star", "hourglass", "crown"],
  },
];

// Visual identity per sewer hole: floor/wall palette (indexed by floor,
// clamped to the last entry), torch crystal colors, god-ray shaft colors and
// the set-dressing mix. Index matches Sewer.holes; the tutorial's private
// cellar (sewerHole -1) falls back to the classic look.
export const DEFAULT_THEME = {
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
// Every floor mixes in the odd skittish rat for ambient life (harmless prey you
// can chase for a hide), except the very first floor, which stays rats-only as
// a gentle, no-damage warm-up.
export const DUNGEON_MIX = [
  [ // Rat Warren — the first floor is nothing but skittish rats (a gentle,
    // no-damage warm-up); the crawl proper starts on the second floor
    ["rat"],
    ["skitter", "slime", "goblin", "rat"],
    ["slime", "goblin", "wisp", "archer", "rat"],
  ],
  [ // Flooded Deep — splitting blobs, tide crabs and geyser lures
    ["puddle", "snapper", "rat"],
    ["puddle", "snapper", "angler", "rat"],
    ["snapper", "angler", "puddle", "puddle", "rat"],
  ],
  [ // Bone Hollow — bone-bugs, grave-lights and charging sentinels
    ["rattler", "gravewisp", "rat"],
    ["rattler", "gravewisp", "boneguard", "rat"],
    ["rattler", "boneguard", "gravewisp", "boneguard", "rat"],
  ],
  [ // Gloom Drain — walking bombs, blink-casters and moss hulks
    ["sporeling", "gloomcaster", "rat"],
    ["sporeling", "gloomcaster", "mossbrute", "rat"],
    ["gloomcaster", "sporeling", "mossbrute", "mossbrute", "rat"],
  ],
];
export function floorMixFor(floorN) {
  const mixes = DUNGEON_MIX[dungeonIndexFor(floorN)] ?? DUNGEON_MIX[0];
  return mixes[Math.min((floorN - 1) % FLOORS_PER_DUNGEON, mixes.length - 1)];
}
