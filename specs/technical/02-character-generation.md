# 02 — Character Generation

Character generation (`src/chargen/`) is **hybrid**. This is the biggest place
where the current build diverges from the README's description of an all-SDF
pipeline.

> **Important:** The README describes *every* creature as SDF blob-baked. In the
> **current build**, humans use the Kenney "Blocky Characters" GLB pack, while
> **dungeon monsters** use the SDF blob-bake pipeline. Both live under
> `src/chargen/`.

| Role | System | Modules |
| --- | --- | --- |
| Player, co-op partner, lobby avatars, townsfolk/customers | **Kenney Blocky GLB** | `assets.js`, `blocky.js`, `portrait.js` |
| Dungeon monsters | **SDF blob-bake** | `species.js`, `sdf.js`, `bake.js`, `creature.js`, `animator.js` |
| Farm animals (admin-only, unused in game) | **Voxel rigs** | `voxel/` |

---

## Part A — Kenney Blocky characters (humans)

### Assets (`assets.js`)

- 18 rigged GLB models: `character-a` … `character-r`, each with a matching texture
  atlas in `public/characters/Textures/`.
- `loadCharacters()` preloads all variants at boot (via `GLTFLoader`) — this is
  what the loading screen waits on.
- `CHAR_VARIANTS` is the variant list; `variantForSeed(seed)` deterministically
  maps a seed to a variant (`CHAR_VARIANTS[seed % 18]`), so a given customer seed
  always yields the same look (and co-op peers agree).
- Pack is **CC0** (`public/characters/KENNEY-LICENSE.txt`).

### `BlockyCreature` (`blocky.js`)

Wraps a cloned GLB model + a Three.js `AnimationMixer`:

- **Clips:** idle, walk, sprint, attack-melee-right, die.
- **Scaling:** to a target height (player ~1.3m; customers ~1.05–1.4m).
- **Extras:** blob shadow, squash spring, emissive hurt flash.
- A **sword mesh** is attached to the `arm-right` bone for the player.
- `HARD_SEED` is a debug pin — when set non-zero, forces all customers to one
  variant (handy for testing).

### Portraits (`portrait.js`)

Renders blocky characters to **PNG data URLs** via an offscreen WebGL renderer, for
the Recettear-style flanking portraits in the haggle UI. Cached per `variant|side`
so each portrait renders once. (The one authored portrait exception: the uncle's
sepia bust, `public/characters/uncle-portrait.png`, used by his note in the FTUE.)

---

## Part B — SDF blob-bake pipeline (monsters)

This is the "fun tech" from the README, still used for all dungeon creatures. A
creature goes from a list of math primitives to an animated `SkinnedMesh` at
runtime — no modelling, rigging, or keyframes.

### 1. Author as SDFs (`species.js`, `sdf.js`)

A creature is a list of signed-distance primitives (spheres, tapered capsules,
ellipsoids) bound to bones, blended with a **polynomial smooth-min** so separate
primitives melt into one seamless body — the seams don't exist in the field.

Design space is roughly the `[-0.8, 0.8]` cube with the ground plane at
`GROUND = -0.75`.

Species factories in `species.js` include:

- `humanoidSpec()` — shared body plan reused by goblins, brutes, archers.
- `skitterSpec()` — N-legged bug.
- `slimeSpec()` — legless hopper blob.
- `wispSpec()` — floating body with a dangling tail.
- Plus role wrappers: `goblinSpec`, `archerSpec`, `bruteSpec`, `customerSpec`,
  `heroSpec`.

### 2. Polygonize (`bake.js`)

The field is polygonized once through Three.js's `MarchingCubes` addon (isolation
0, field = −distance) and welded into a single indexed mesh.

- **Field-gradient normals** — normals come from the SDF gradient, not triangle
  averaging, giving buttery toon shading with no degenerate normals on tiny
  details (horn tips, etc.).
- **Auto-skinning from the same field** — each primitive is bound to a bone;
  per-vertex skin weights come from each primitive's distance contribution (wide
  falloff → noodle-like bone deformation; sharp falloff → crisp **vertex-color**
  zones). The output is a `SkinnedMesh` on a procedurally built skeleton.

### 3. Assemble (`creature.js`)

Bundles the baked `SkinnedMesh` with the toon material + rim + **inverted-hull
outline** (sharing the skeleton so it hugs the deforming body), **bead eyes**, and
a **blob shadow**.

### 4. Animate (`animator.js`)

Procedural motion brains — no keyframes:

- **walker** (2/4/6 legs) — feet plant in world space and take phase-grouped steps;
  limb bones aim socket→foot and stretch (blob skinning turns stretch into squash);
  arms swing, hips bob/lean, head lags turns on springs.
- **hopper** — legless things squash → launch → stretch → land.
- **floater** — hover-bob, bank into velocity, tail bones dangle on springs.
- **ragdoll** — on death, every brain switches to a **verlet** simulation over the
  same bones and the body flops into a puddle.

### Determinism & caching

Baking is comparatively expensive, so baked meshes are **cached by key**. Enemy
`make` functions build cache keys that include every parameter that changes the
geometry — note `skitter` includes its leg count in the key, because a different
bone count is a genuinely different mesh:

```js
// dungeon.js — skitter cache key includes legsN
return skitterSpec({ key: `e_sk${tier}_${legsN}_${seed % 5}`, seed, legsN, ... });
```

---

## Part C — Voxel rigs (`chargen/voxel/`, not in the game)

A third, self-contained pipeline ported from another project: voxel-modelled
farm animals (cow, pig, piglet, sheep, chicken) with procedural
quadruped/biped-avian rigs and a `MotionRunner`. It's rendered only by the
**Farm tab** of the admin catalogue (`farmViewer.js`) — nothing in the game
uses it. Treat it as a parked experiment (a farming loop candidate) until a
feature claims or deletes it.

## Where to look next

- Monster stats and floor mixes: [Data Reference](04-data-reference.md).
- Seeing them in isolation: the [creature lab](06-tooling-lab-and-admin.md).
