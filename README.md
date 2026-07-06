# 🏪 Shop Slop — *delve by night, deal by day*

A mobile-first **co-op dungeon-crawling shopkeeper** built with Three.js.
[Recettear](https://en.wikipedia.org/wiki/Recettear:_An_Item_Shop%27s_Tale) is
the north star: you run a little item shop with a monster-filled cellar. Crawl
the dungeon for loot at night, put it on your display tables by day, and
**haggle** customers as close to their hidden pay limit as you dare — then pay
off the Guild's escalating debt before it repossesses your shop.
Capitalism, ho!

**Co-op twist:** one player keeps shop while the other delves. Shared gold,
shared stock, one shared debt. (2-player peer-to-peer over WebRTC — no server.)

## The loop

1. **☀️ Day** — customers wander in and covet items on your tables. Walk up to
   the ones with a ❗ and name a price. Every customer archetype (cheapskate,
   regular, wealthy, collector) has a hidden tolerance around the item's base
   value; pin within ~8% under their limit for a **PERFECT DEAL** and chain
   combos. Push too hard three times and they storm out.
2. **🌙 Night** — the shop closes. Open the trapdoor and delve seeded
   procedural floors: skitters, slimes, goblins, wisps and brutes drop the
   gold and merchandise you'll sell tomorrow. Stairs go down, risk goes up,
   tiers of loot get shinier. Get carried out at 0 HP and half your gold
   stays behind.
3. **📜 Every 3rd day** — the Guild collects. Five payments and the deed is
   yours; miss one and it's game over.

## Controls

| Input | Action |
| --- | --- |
| Left drag (anywhere) | virtual joystick — move |
| Big round button | context action: ⚔️ attack · 🗣️ haggle · 🕳️ delve · 🎁 open · ⬇️ descend · 🏠 return · 🛏️ sleep |
| `WASD` / arrows + `Space` | same thing on desktop |
| 🎒 | bag — tap an item to put it on a table |
| 👥 | co-op — host a 4-letter room code or join one |

## The character tech (the fun part)

Every creature in the game — the shopkeeper, every customer, every monster —
is generated at runtime by one pipeline, **no modelling, no rigging, no
keyframes**:

1. **Blob-bake.** A creature is authored as a dozen primitive SDFs (spheres,
   tapered capsules, ellipsoids) blended with a **polynomial smooth-min**, so
   separate primitives melt into one seamless noodly body — the seams simply
   don't exist in the field. The field is polygonised once through the
   three.js `MarchingCubes` addon (isolation 0, field = −distance) and welded
   into a single indexed mesh.
2. **Field-gradient normals.** Normals come from the SDF gradient instead of
   triangle averaging — buttery toon shading, and no degenerate normals on
   sub-cell details like horn tips.
3. **Auto-skinning from the same field.** Each primitive is bound to a bone;
   per-vertex skin weights are computed from each primitive's distance
   contribution (wide falloff for bones = noodle deformation, sharp falloff
   for **vertex colors** = crisp airbrushed color zones). The mesh becomes a
   `SkinnedMesh` on a procedurally-built skeleton.
4. **Toon + outline.** A 4-step gradient ramp `MeshToonMaterial` with an
   injected fresnel rim light, plus an inverted-hull outline shell that
   shares the skeleton so it hugs the body while it deforms. Shadows are
   radial-gradient blob sprites — no shadow maps, mobile-cheap.
5. **Procedural animation brains.** One `Animator` handles:
   - **walker** — 2, 4 or 6 legs: feet plant in world space and take
     phase-grouped steps; limb bones aim socket→foot and stretch a little
     (blob skinning turns that into squash). Arms swing, hips bob and lean,
     heads lag turns on springs.
   - **hopper** — legless grounded things squash, launch, stretch, land.
   - **floater** — hover-bob, bank into velocity, tail bones dangle on springs.
   - **ragdoll** — on death every brain switches to a verlet simulation over
     the same bones and the body flops into a puddle.

Open **`/lab.html`** for the style zoo: a parade of every species, reroll
seeds, ragdoll them all.

Also fully procedural: dungeon floors (seeded rooms + corridors, shared with
co-op peers as just `(floor, seed)`), item props, floor/tile textures, and
every sound (WebAudio synth — two generative music moods, coins, ka-chings).

## Running

Requires Node.js.

```bash
npm install
npm run dev      # http://localhost:5173  (game) and /lab.html (creature lab)
npm run build    # static build into dist/
```

## Project layout

```
src/
  chargen/   sdf.js (primitives+smin) · bake.js (marching cubes → skinned mesh)
             species.js (recipes) · animator.js (gait/hop/float/ragdoll brains)
             creature.js (mesh+skeleton+face+shadow bundle)
  core/      engine (renderer/loop/springs) · toon (ramp/rim/outline/blob shadow)
             input (joystick) · audio (procedural synth + music)
  game/      game.js (director) · shop.js (customers/haggling) · dungeon.js
             items.js · hud.js (DOM UI) · particles.js
  net/       coop.js (PeerJS host-authoritative sync)
```
