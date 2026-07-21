// Morel, the mushroom fellow (and the shelf fellow): the FTUE's quest-giver
// and, ever after, the town's shelf vendor. During the FTUE he stays hidden
// until the heir finishes the counter letter, then appears just inside the
// shop door, names the errand (mushrooms, the cave, "your job now"), waits for
// the basket, and pays in furniture — the shop's first shelf.
// Post-FTUE, talking to him buys the next one (see game-narrative
// _morelPrompt). Built into the shop world like the builder/dojo master and
// driven each frame from Shop.update via updateMorel.
import * as THREE from "three";
import { BlockyCreature } from "../chargen/blocky.js";
import { portraitDataURL } from "../chargen/portrait.js";

// Reuses Gus's skin (the zen gardener — close enough to a mushroom forager).
// Holding the variant keeps a doppelgänger off the street; the roster only
// ships 18 Kenney skins, all otherwise spoken for.
const MOREL_VARIANT = "l";

const WALK_SPEED = 2.7; // m/s — a man with mushrooms on his mind
const _v = new THREE.Vector3();

// Spawn Morel in his mushroom shop across the road from the cave. Runs after
// both town rotation and buildMorelShop, so every anchor is already world space.
export function buildMorel(shop) {
  shop.holdVariantForCameo(MOREL_VARIANT);
  const creature = new BlockyCreature(MOREL_VARIANT, { height: 1.52 });
  const home = shop.morelShop?.morelHome?.clone() ?? shop.doorPos.clone();
  home.y = 0;
  creature.position.copy(home);
  const facing = shop.morelShop?.doorPos ?? shop.doorPos;
  const homeHeading = Math.atan2(facing.x - home.x, facing.z - home.z);
  creature.heading = homeHeading;
  shop.group.add(creature);
  return {
    npc: { id: "morel", name: "Morel", variant: MOREL_VARIANT },
    variant: MOREL_VARIANT,
    creature,
    portrait: portraitDataURL(MOREL_VARIANT, "left"),
    home: { x: home.x, z: home.z },
    homeHeading,
    state: "idle", // idle | walk | talk
    path: null, pathIdx: 0, pathT: 0, onArrive: null,
  };
}

// Send Morel down a waypoint path; he lands "idle" at the last point unless
// `onArrive` (which runs there) sets a different state.
export function morelWalk(shop, path, onArrive) {
  const m = shop.morel;
  if (!m) return;
  m.state = "walk";
  m.path = path.map((p) => new THREE.Vector3(p.x, 0, p.z));
  m.pathIdx = 0;
  m.pathT = 0;
  m.onArrive = onArrive ?? null;
}

// Per-frame: walk the current path, face the player while talking, and idle
// facing his patch (turning to a nearby player, like the builder).
export function updateMorel(shop, dt, elapsed) {
  const m = shop.morel;
  if (!m?.creature) return;
  const game = shop.game;
  const c = m.creature;
  const pp = game.player && game.player.position;
  const hut = shop.morelShop;
  if (hut) {
    const r = hut.rect;
    const inside = !!pp && game.playerArea === "shop" &&
      pp.x > r.minX - 0.25 && pp.x < r.maxX + 0.25 &&
      pp.z > r.minZ - 0.25 && pp.z < r.maxZ + 0.25;
    const target = inside ? 0 : 1;
    hut.roofA += (target - hut.roofA) * Math.min(1, dt * 9);
    hut.roof.visible = hut.roofA > 0.02;
    if (hut.roof.visible) for (const mat of hut.roofMats) mat.opacity = hut.roofA;
  }
  switch (m.state) {
    case "idle": {
      if (pp && game.playerArea === "shop") {
        const dx = pp.x - c.position.x, dz = pp.z - c.position.z;
        c.heading = dx * dx + dz * dz < 9 ? Math.atan2(dx, dz) : m.homeHeading;
      }
      break;
    }
    case "walk": {
      m.pathT += dt;
      const tgt = m.path[m.pathIdx];
      _v.set(tgt.x - c.position.x, 0, tgt.z - c.position.z);
      const d = _v.length();
      if (d < 0.16 || m.pathT > 10) { // reached, or a per-leg timeout guard
        m.pathIdx++;
        m.pathT = 0;
        if (m.pathIdx >= m.path.length) {
          m.path = null;
          m.state = "idle";
          const fn = m.onArrive;
          m.onArrive = null;
          fn?.();
        }
      } else {
        _v.normalize();
        c.position.addScaledVector(_v, Math.min(WALK_SPEED * dt, d));
        c.heading = Math.atan2(_v.x, _v.z);
        game.collide(c.position, c.radius * 0.8, shop.colliders);
      }
      break;
    }
    case "talk": {
      if (pp) c.heading = Math.atan2(pp.x - c.position.x, pp.z - c.position.z);
      break;
    }
  }
  c.update(dt, elapsed);
}
