// The town builder ("the foreman"): an always-present resident who waits by the
// row of run-down lots and offers to raise a house on the cheapest one for a
// fee. Take the deal (see game-narrative _builderPrompt / game-economy
// _dispatchBuilder) and he shoulders his hammer, walks over to the plot, bangs
// it into shape (dust + taps), then the finished house pops up and he strolls
// back to his spot to offer the next-cheapest job. Built into the shop world
// (same "shop" playerArea, same shop.group) like the dojo master, and updated
// each frame from Shop.update via updateBuilder.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { BlockyCreature } from "../chargen/blocky.js";
import { npcById } from "./npc-data.js";
import { portraitDataURL } from "../chargen/portrait.js";

// Reuses Bruno's skin (the boastful one — a fitting braggart foreman). Like the
// dojo master, holding his variant keeps a doppelgänger from roaming the street
// (the roster only ships 18 Kenney skins, all otherwise spoken for).
const BUILDER_ID = "bruno";
const BUILDER_VARIANT = "n";

const WALK_SPEED = 2.6; // m/s along the road to and from the plot
const BUILD_TIME = 2.6; // seconds of hammering before the house springs up
const TAP_EVERY = 0.34; // dust-burst / hammer-tap cadence while building

const _v = new THREE.Vector3();

// Spawn the foreman at his roadside spot amid the lot row and return his
// runtime state. Runs after _buildLots + _rotateTown, so lot.interactPos and
// shop.counterPos are already in post-rotation world space.
export function buildBuilder(shop) {
  const npc = npcById(BUILDER_ID);
  const variant = npc?.variant ?? BUILDER_VARIANT;
  shop.holdVariantForCameo(variant); // no roaming double of the foreman

  const creature = new BlockyCreature(variant, { height: 1.5 });

  // home spot: the average of the lots' road-side stand points — a place in the
  // middle of the row where the foreman naturally waits between jobs
  const home = new THREE.Vector3();
  const lots = shop.lots ?? [];
  if (lots.length) {
    for (const lot of lots) home.add(lot.interactPos);
    home.multiplyScalar(1 / lots.length);
  }
  home.y = 0;
  creature.position.copy(home);

  // rest facing the shop counter (roughly back down the street toward the door)
  const cp = shop.counterPos;
  const homeHeading = cp ? Math.atan2(cp.x - home.x, cp.z - home.z) : 0;
  creature.heading = homeHeading;
  shop.group.add(creature);

  // a hammer the foreman swings on the job (parented to him, hidden off-duty)
  const hammer = makeHammer();
  hammer.visible = false;
  hammer.position.set(0.34, 0.92, 0.14); // in his right hand, chest height
  creature.add(hammer);

  return {
    npc, variant, creature,
    portrait: portraitDataURL(variant, "left"),
    home: { x: home.x, z: home.z },
    homeHeading,
    hammer,
    state: "idle", // idle | toLot | building | toHome
    job: null,     // { lotIndex, face:{x,z} } while working
    path: null, pathIdx: 0, pathT: 0,
    buildT: 0, tapT: 0,
  };
}

// A stubby carpenter's mallet: a wooden handle and an iron head.
function makeHammer() {
  const g = new THREE.Group();
  const wood = makeToonMaterial({ color: 0x8a5a33, rim: 0 });
  const iron = makeToonMaterial({ color: 0x777d85, rim: 0 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8), wood);
  g.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.17, 0.17), iron);
  head.position.y = 0.42;
  g.add(head);
  return g;
}

// Send the foreman off to raise the house on lot `i`: shoulder the hammer and
// walk to its road-side stand point. Called from game-economy _dispatchBuilder
// once the player has paid.
export function builderGoRepair(shop, i) {
  const b = shop.builder;
  const lot = shop.lots && shop.lots[i];
  if (!b || !lot) return;
  b.job = { lotIndex: i, face: { x: lot.group.position.x, z: lot.group.position.z } };
  b.state = "toLot";
  b.path = [lot.interactPos.clone()];
  b.pathIdx = 0; b.pathT = 0;
  b.buildT = 0; b.tapT = 0;
}

// Per-frame: drive the walk → build → walk-home loop, or idle (turning to face
// a nearby player, like the dojo master). Straight-seek movement + collide,
// mirroring the Mayor's scripted walk.
export function updateBuilder(shop, dt, elapsed) {
  const b = shop.builder;
  if (!b?.creature) return;
  const game = shop.game;
  const c = b.creature;
  const pp = game.player && game.player.position;

  switch (b.state) {
    case "idle": {
      if (pp && game.playerArea === "shop") {
        const dx = pp.x - b.home.x, dz = pp.z - b.home.z;
        c.heading = dx * dx + dz * dz < 9 ? Math.atan2(dx, dz) : b.homeHeading;
      }
      break;
    }
    case "toLot": {
      if (walkStep(b, c, dt, game, shop)) {
        b.state = "building";
        b.buildT = 0; b.tapT = 0;
        b.hammer.visible = true;
        c.heading = Math.atan2(b.job.face.x - c.position.x, b.job.face.z - c.position.z);
      }
      break;
    }
    case "building": {
      c.heading = Math.atan2(b.job.face.x - c.position.x, b.job.face.z - c.position.z);
      b.buildT += dt;
      // swing: a quick down-stroke on each beat, easing back up between
      b.hammer.rotation.x = -Math.abs(Math.sin(b.buildT * 8)) * 1.15;
      b.tapT -= dt;
      if (b.tapT <= 0) {
        b.tapT = TAP_EVERY;
        _v.set(b.job.face.x, 0.8 + Math.random() * 0.8, b.job.face.z);
        game.particles.burst(_v, { color: 0xcaa46a, n: 8, speed: 2.6, up: 1.4, gravity: 4, life: 0.5, size: 0.7 });
        game.particles.burst(_v, { color: 0xe9d3a0, n: 4, speed: 1.8, up: 1.2, life: 0.4, size: 0.5 });
        game.audio.hammer?.();
        game.engine.hitStop?.(0.02);
      }
      if (b.buildT >= BUILD_TIME) {
        b.hammer.visible = false;
        b.hammer.rotation.x = 0;
        const i = b.job.lotIndex;
        b.job = null;
        game._finishLotRestore(i); // the house springs up (visual + banner)
        b.state = "toHome";
        b.path = [new THREE.Vector3(b.home.x, 0, b.home.z)];
        b.pathIdx = 0; b.pathT = 0;
      }
      break;
    }
    case "toHome": {
      if (walkStep(b, c, dt, game, shop)) {
        b.state = "idle";
        c.heading = b.homeHeading;
      }
      break;
    }
  }
  c.update(dt, elapsed);
}

// Step toward the current path waypoint; returns true once the path is done.
// A generous timeout keeps the foreman from stalling if he snags on a collider.
function walkStep(b, c, dt, game, shop) {
  b.pathT += dt;
  const tgt = b.path[b.pathIdx];
  _v.set(tgt.x - c.position.x, 0, tgt.z - c.position.z);
  const d = _v.length();
  if (d < 0.16 || b.pathT > 10) {
    b.pathIdx++;
    b.pathT = 0;
    if (b.pathIdx >= b.path.length) { b.path = null; return true; }
    return false;
  }
  _v.normalize();
  c.position.addScaledVector(_v, Math.min(WALK_SPEED * dt, d));
  c.heading = Math.atan2(_v.x, _v.z);
  game.collide(c.position, c.radius * 0.8, shop.colliders);
  return false;
}
