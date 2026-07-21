// The town dojo: an open-fronted training hall that sits just south of the shop
// ("under the shop" on screen — post-rotation +z). A resident master always
// stands at the back, and a row of straw training dummies waits out front for
// the player to whack with the dash. Built into the shop world (same "shop"
// playerArea, same shop.group), so no separate scene/area plumbing: the roof
// fades away when the player steps under it (like the shopfront), the dummies
// take the dash's hit and wobble back upright, and the master is wired into the
// townsfolk chat via _nearestTalkNpc.
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { BlockyCreature } from "../chargen/blocky.js";
import { npcById } from "./npc-data.js";
import { getLayout } from "./layout-store.js";
import { BUILDING_LIFT } from "./shop-data.js";

// The master reuses Rocco's skin (the jock) — a fitting trainer, and the roster
// only ships 18 Kenney skins (all spoken for), so a dedicated one isn't free.
// Holding his variant keeps a doppelgänger from roaming the street.
const MASTER_ID = "rocco";
const MASTER_VARIANT = "f";

// Footprint (post-rotation WORLD space): the hall sits at the RIGHT end of the
// horizontal high street's top row (shop | cave | dojo), its open front still
// facing south toward the camera and the approaching player. Its centre is
// authored in layout.json's `buildings.dojo` (editable in the overworld editor),
// stored in the same pre-rotation convention as the lots (world = (−z, x)).
const DOJO_DEFAULT = { x: 2, z: -33 }; // authored → world (33, 2)
const HW = 4.6, HD = 3.6;  // half-width (x) / half-depth (z)
const WALL_H = 2.7;        // back wall height
const SIDE_H = 0.95;       // side rails kept low so they never hide the player
const ROOF_Y = 3.2;

// The movable "things" inside the hall — a row of straw dummies and the master
// — are authored in DOJO-LOCAL coords (relative to the hall's centre) under
// layout.json's `buildings.dojo`, so the overworld editor's Contents mode can
// drag them around. Absent → these code defaults.
const DUMMIES_DEFAULT = [{ x: -2.6, z: 0.4 }, { x: 0, z: 0.4 }, { x: 2.6, z: 0.4 }];
const MASTER_DEFAULT = { x: -2.2, z: -HD + 1.1 };

// Build the whole dojo into shop.group and return its runtime state. Colliders
// are pushed onto shop.colliders in world coords (this runs after _rotateTown,
// so nothing here is turned again).
export function buildDojo(shop) {
  const g = new THREE.Group();
  shop.group.add(g);
  shop._dojoGroup = g; // exposed so the editor can select / grab it

  // authored (pre-rotation) → world centre: CX = −z, CZ = x. The hall is built
  // entirely in DOJO-LOCAL space (centre at 0,0) and the group is positioned at
  // (CX, CZ), so the editor can grab it as a unit and its contents can be
  // authored/moved in local coords. World-space anchors (rect, colliders, dummy
  // hit coords, master facing spot) are derived from the centre explicitly.
  const dd = getLayout().buildings?.dojo ?? DOJO_DEFAULT;
  const CX = -dd.z, CZ = dd.x;
  g.position.set(CX, BUILDING_LIFT, CZ); // lift off the road to avoid z-fighting

  const rect = { minX: CX - HW, maxX: CX + HW, minZ: CZ - HD, maxZ: CZ + HD };
  const backZ = -HD;   // north edge (nearest the shop), local
  const frontZ = HD;   // south edge (open, facing the camera), local

  const woodMat = makeToonMaterial({ color: 0x8a5a33, rim: 0 });
  const wood2 = makeToonMaterial({ color: 0x6e4526, rim: 0 });
  const darkWood = makeToonMaterial({ color: 0x4a2c17, rim: 0 });

  // --- the training floor: a raised tatami-style deck of alternating mats
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(HW * 2, 0.16, HD * 2),
    makeToonMaterial({ color: 0xb7a06a, rim: 0 })
  );
  deck.position.set(0, 0.08, 0);
  g.add(deck);
  const matMat = makeToonMaterial({ color: 0x9c8347, rim: 0 });
  for (let i = 0; i < 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 - 0.3, 0.02, 0.14), matMat);
    strip.position.set(0, 0.17, -HD + 1 + i * ((HD * 2 - 2) / 3));
    g.add(strip);
  }

  // --- back wall with a hanging banner, then two low side rails
  const back = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, WALL_H, 0.3), wood2);
  back.position.set(0, WALL_H / 2, backZ);
  g.add(back);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.6),
    makeToonMaterial({ color: 0x9a2f2f, rim: 0 })
  );
  banner.position.set(0, WALL_H - 0.9, backZ + 0.17);
  g.add(banner);
  const bannerBar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), darkWood);
  bannerBar.rotation.z = Math.PI / 2;
  bannerBar.position.set(0, WALL_H - 0.12, backZ + 0.2);
  g.add(bannerBar);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, SIDE_H, HD * 2), wood2);
    rail.position.set(sx * HW, SIDE_H / 2, 0);
    g.add(rail);
  }

  // colliders: back wall (full) + the two side rails, leaving the front open so
  // the player walks straight in. Dummies get no collider — you dash into them.
  shop.colliders.push(
    { x: CX, z: CZ - HD, hw: HW, hd: 0.25 },
    { x: CX - HW, z: CZ, hw: 0.25, hd: HD },
    { x: CX + HW, z: CZ, hw: 0.25, hd: HD },
  );

  // --- four corner posts holding a peaked roof that fades while you're inside
  const roof = new THREE.Group();
  const roofMats = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, ROOF_Y, 0.32), darkWood);
      post.position.set(sx * (HW - 0.2), ROOF_Y / 2, sz * (HD - 0.2));
      g.add(post);
    }
  }
  const eaveMat = makeToonMaterial({ color: 0x7a382c, rim: 0 });
  const tileMat = makeToonMaterial({ color: 0x9a4a3a, rim: 0 });
  for (const m of [eaveMat, tileMat]) { m.transparent = true; roofMats.push(m); }
  const eave = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 0.8, 0.3, HD * 2 + 0.8), eaveMat);
  eave.position.y = ROOF_Y + 0.15;
  roof.add(eave);
  // two sloped slabs meeting in a ridge running along x
  for (const sz of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 1.0, 0.22, HD + 0.9), tileMat);
    slope.position.set(0, ROOF_Y + 0.7, sz * (HD + 0.4) / 2);
    slope.rotation.x = sz * -0.5;
    roof.add(slope);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 1.2, 0.2, 0.4), eaveMat);
  ridge.position.y = ROOF_Y + 1.15;
  roof.add(ridge);
  roof.position.set(0, 0, 0);
  g.add(roof);

  // --- a small torii-style gate out front, marking the entrance
  const gate = new THREE.Group();
  const gateMat = makeToonMaterial({ color: 0xb2402f, rim: 0 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.6, 10), gateMat);
    leg.position.set(sx * 1.5, 1.3, 0);
    gate.add(leg);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.28, 0.4), gateMat);
  lintel.position.y = 2.55;
  gate.add(lintel);
  const lintel2 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.3), darkWood);
  lintel2.position.y = 2.2;
  gate.add(lintel2);
  gate.position.set(0, 0, frontZ + 1.2);
  g.add(gate);

  // --- warm paper lanterns (chōchin): their paper bodies always read warm, and
  // each carries a real point light kindled after dusk (pushed into
  // shop.lampLights, eased toward night in Shop._updateLighting — same as the
  // shop's own interior lamps). A red pair hangs at the open front to mark the
  // entrance, and a smaller amber pair flanks the banner to light the master.
  for (const sx of [-1, 1]) {
    const front = makeLantern(shop, darkWood, { paper: 0xff8a5c, light: 0xff9a55, range: 7, cord: 0.55 });
    front.position.set(sx * 3.2, 2.5, frontZ - 0.5);
    g.add(front);
    const rear = makeLantern(shop, darkWood, { paper: 0xffd08a, light: 0xffca7a, range: 5.5, cord: 0.45, size: 0.2 });
    rear.position.set(sx * 2.7, 2.05, backZ + 0.35);
    g.add(rear);
  }

  // --- the master: an always-present resident, held off the ambient crowd so
  // he never roams the street as a double. Position is authored in local coords
  // (editable in Contents mode); he faces the entrance / player.
  shop.holdVariantForCameo(MASTER_VARIANT);
  const mp = dd.master ?? MASTER_DEFAULT;
  const body = new BlockyCreature(MASTER_VARIANT, { height: 1.5 });
  body.position.set(mp.x, 0, mp.z);
  body.heading = 0; // face +z (south) — toward the entrance / player
  g.add(body);
  const master = {
    npc: npcById(MASTER_ID),
    creature: body,
    homeHeading: 0,
    x: CX + mp.x, // world spot, for the facing check in updateDojo
    z: CZ + mp.z,
  };

  // --- a row of straw training dummies out on the mats (local coords authored
  // in layout; world x/z stored for the dash hit-test in dojoHitDummies)
  const dummies = [];
  for (const dp of (dd.dummies ?? DUMMIES_DEFAULT)) {
    const d = makeDummy(woodMat, darkWood);
    d.group.position.set(dp.x, 0, dp.z);
    g.add(d.group);
    d.x = CX + dp.x;
    d.z = CZ + dp.z;
    d.radius = 0.55;
    dummies.push(d);
  }

  return { group: g, rect, roof, roofMats, roofA: 1, master, dummies };
}

// One warm paper lantern (chōchin): a glowing squashed-sphere paper body under
// dark caps, hung from a short cord, with a real point light inside. The paper
// (MeshBasicMaterial) always glows; the point light starts dark and is handed to
// shop.lampLights so it kindles at night with the rest of the town's interiors.
function makeLantern(shop, darkWood, { paper = 0xffcaa0, light = 0xffca7a, range = 6, cord = 0.5, size = 0.26 } = {}) {
  const grp = new THREE.Group();
  const cordMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, cord, 6), darkWood);
  cordMesh.position.y = size + 0.08 + cord / 2;
  grp.add(cordMesh);
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.4, size * 0.55, 0.08, 12), darkWood);
  topCap.position.y = size + 0.04;
  grp.add(topCap);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(size, 14, 12),
    new THREE.MeshBasicMaterial({ color: paper }),
  );
  body.scale.y = 0.85;
  grp.add(body);
  // a couple of dark rib rings so it reads as a folded paper lantern
  for (const y of [-size * 0.4, 0, size * 0.4]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(size * 0.96, 0.012, 6, 18), darkWood);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = y * 0.85;
    grp.add(rib);
  }
  const botCap = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.55, size * 0.4, 0.08, 12), darkWood);
  botCap.position.y = -size * 0.85 - 0.04;
  grp.add(botCap);
  const glow = new THREE.PointLight(light, 0, range, 1.7);
  grp.add(glow);
  shop.lampLights.push(glow);
  return grp;
}

// One straw practice dummy: a post, a burlap body, a round head and a belt,
// all under a `lean` pivot at the base so a hit can tip the whole thing.
function makeDummy(woodMat, darkWood) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 14), darkWood);
  base.position.y = 0.09;
  group.add(base);

  const lean = new THREE.Group();
  group.add(lean);
  const strawMat = makeToonMaterial({ color: 0xd9b45a, rim: 0 });
  const beltMat = makeToonMaterial({ color: 0x6e4526, rim: 0 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.9, 8), woodMat);
  post.position.y = 0.95;
  lean.add(post);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.28, 0.95, 12), strawMat);
  body.position.y = 1.05;
  lean.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), strawMat);
  head.position.y = 1.72;
  lean.add(head);
  for (const y of [0.72, 1.5]) {
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 12), beltMat);
    belt.position.y = y;
    lean.add(belt);
  }
  // stubby crossarm so it reads as a training figure
  const arms = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.12), woodMat);
  arms.position.y = 1.15;
  lean.add(arms);

  return { group, lean, body, tiltX: 0, tiltZ: 0, tvX: 0, tvZ: 0, hitCd: 0, flash: 0 };
}

// The player's dash swept through the mats: knock any dummy it caught. They're
// practice targets, not foes, so they tip away, wobble and spring back upright —
// no death, no removal. Returns whether anything was struck.
export function dojoHitDummies(shop, dojo, pos, reach) {
  if (!dojo) return false;
  const game = shop.game;
  let hitAny = false;
  for (const d of dojo.dummies) {
    if (d.hitCd > 0) continue;
    const dx = d.x - pos.x, dz = d.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > reach + d.radius) continue;
    hitAny = true;
    d.hitCd = 0.35;
    d.flash = 1;
    const l = dist || 1e-4;
    const nx = dx / l, nz = dz / l;
    // tip away from the blow (+ a touch of random spin), capped so it never lies flat
    d.tvX += nx * 6.5 + (Math.random() - 0.5) * 1.5;
    d.tvZ += nz * 6.5 + (Math.random() - 0.5) * 1.5;
    const hp = new THREE.Vector3(d.x, 1.0, d.z);
    game.particles.burst(hp, { color: 0xd9b45a, n: 12, speed: 3.2, up: 1.6, gravity: 4, life: 0.5, size: 0.8 });
    game.particles.burst(hp, { color: 0xfff2cf, n: 5, speed: 2.2, up: 1.4, life: 0.4, size: 0.6 });
    game.audio.projHit?.();
    game.engine.hitStop?.(0.05);
  }
  return hitAny;
}

// Per-frame: fade the roof while the player's under it, spring the dummies back
// upright, and keep the master idling — turning to face a nearby player.
export function updateDojo(shop, dojo, dt, elapsed) {
  if (!dojo) return;
  const game = shop.game;
  const pp = game.player && game.player.position;
  const r = dojo.rect;
  const inside = !!pp && game.playerArea === "shop" &&
    pp.x > r.minX - 0.3 && pp.x < r.maxX + 0.3 && pp.z > r.minZ - 0.3 && pp.z < r.maxZ + 0.3;

  // roof: fade out while inside so the interior stays readable (like the shop)
  const tgt = inside ? 0 : 1;
  dojo.roofA += (tgt - dojo.roofA) * Math.min(1, dt * 9);
  dojo.roof.visible = dojo.roofA > 0.02;
  if (dojo.roof.visible) for (const m of dojo.roofMats) m.opacity = dojo.roofA;

  // a conversation drops the camera to an eye-level two-shot (chatting with the
  // master, or reading the note) — the straw dummies out front would fill the
  // frame at that height, so they duck out of sight for the duration and pop
  // back the moment the dialogue closes
  const dialogue = !!game._npcChat || !!game._sceneCam || !!game._selfCam;

  // dummies: critically-ish damped spring back to upright, with a hit flash
  for (const d of dojo.dummies) {
    d.group.visible = !dialogue;
    if (d.hitCd > 0) d.hitCd -= dt;
    const K = 55, DAMP = 6.5; // stiffness / damping
    d.tvX += (-K * d.tiltX - DAMP * d.tvX) * dt;
    d.tvZ += (-K * d.tiltZ - DAMP * d.tvZ) * dt;
    d.tiltX += d.tvX * dt;
    d.tiltZ += d.tvZ * dt;
    const cap = 1.15;
    d.tiltX = Math.max(-cap, Math.min(cap, d.tiltX));
    d.tiltZ = Math.max(-cap, Math.min(cap, d.tiltZ));
    // tilt toward +x → lean about -z; tilt toward +z → lean about +x
    d.lean.rotation.z = -d.tiltX * 0.9;
    d.lean.rotation.x = d.tiltZ * 0.9;
    if (d.flash > 0) {
      d.flash = Math.max(0, d.flash - dt * 4);
      const s = 1 + d.flash * 0.12;
      d.lean.scale.set(s, 1 - d.flash * 0.12, s);
    }
  }

  // master: idle animation, and square off with the player when they draw near
  const m = dojo.master;
  if (m?.creature) {
    if (pp && game.playerArea === "shop") {
      // m.x / m.z are the master's WORLD spot (his mesh sits at dojo-local coords
      // inside the positioned group), so compare against the world player pos
      const dx = pp.x - m.x, dz = pp.z - m.z;
      if (dx * dx + dz * dz < 9) m.creature.heading = Math.atan2(dx, dz);
      else m.creature.heading = m.homeHeading;
    }
    m.creature.update(dt, elapsed);
  }
}
