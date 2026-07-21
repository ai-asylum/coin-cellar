// Morel's little mushroom shop: a primitive-built roadside stall across from
// the cave. It lives in the shared town world like the dojo, with its authored
// centre stored in layout.json's pre-rotation convention (world = -z, x).
import * as THREE from "three";
import { makeToonMaterial } from "../core/toon.js";
import { getLayout } from "./layout-store.js";
import { BUILDING_LIFT } from "./shop-data.js";

export const MOREL_SHOP_DEFAULT = { x: 23, z: -7 };
export const MOREL_SHOP_HW = 2.5;
export const MOREL_SHOP_HD = 2.2;

export function buildMorelShop(shop) {
  const authored = getLayout().buildings?.morelShop ?? MOREL_SHOP_DEFAULT;
  const cx = -authored.z;
  const cz = authored.x;
  const g = new THREE.Group();
  g.position.set(cx, BUILDING_LIFT, cz);
  g.rotation.y = Math.PI; // turn the open front toward the bottom of the screen
  shop.group.add(g);
  shop._morelShopGroup = g;

  const rect = {
    minX: cx - MOREL_SHOP_HW, maxX: cx + MOREL_SHOP_HW,
    minZ: cz - MOREL_SHOP_HD, maxZ: cz + MOREL_SHOP_HD,
  };
  const frontZ = -MOREL_SHOP_HD; // local front; group rotation turns it down-screen
  const backZ = MOREL_SHOP_HD;
  const wallH = 2.45;

  const timber = makeToonMaterial({ color: 0x654126, rim: 0 });
  const dark = makeToonMaterial({ color: 0x3f291d, rim: 0 });
  const plaster = makeToonMaterial({ color: 0xd7c49b, rim: 0 });
  const green = makeToonMaterial({ color: 0x52734a, rim: 0 });

  // Raised timber floor.
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(MOREL_SHOP_HW * 2, 0.18, MOREL_SHOP_HD * 2),
    timber,
  );
  floor.position.y = 0.09;
  g.add(floor);

  const wall = (w, h, d, x, y, z, mat = plaster) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  wall(MOREL_SHOP_HW * 2, wallH, 0.24, 0, wallH / 2, backZ);
  for (const sx of [-1, 1])
    wall(0.24, wallH, MOREL_SHOP_HD * 2, sx * MOREL_SHOP_HW, wallH / 2, 0);
  // Short front returns frame a wide open doorway.
  const doorHalf = 0.82;
  const returnW = MOREL_SHOP_HW - doorHalf;
  for (const sx of [-1, 1])
    wall(returnW, wallH, 0.24, sx * (doorHalf + returnW / 2), wallH / 2, frontZ);

  shop.colliders.push(
    { x: cx, z: cz - MOREL_SHOP_HD, hw: MOREL_SHOP_HW, hd: 0.22 },
    { x: cx - MOREL_SHOP_HW, z: cz, hw: 0.22, hd: MOREL_SHOP_HD },
    { x: cx + MOREL_SHOP_HW, z: cz, hw: 0.22, hd: MOREL_SHOP_HD },
    { x: cx - (doorHalf + returnW / 2), z: cz + MOREL_SHOP_HD, hw: returnW / 2, hd: 0.22 },
    { x: cx + (doorHalf + returnW / 2), z: cz + MOREL_SHOP_HD, hw: returnW / 2, hd: 0.22 },
  );

  // Front posts and a green canvas awning make the upward-facing entrance read
  // clearly from the gameplay camera.
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.55, 0.18), dark);
    post.position.set(sx * (MOREL_SHOP_HW - 0.18), 1.275, frontZ - 0.15);
    g.add(post);
  }
  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.05), green);
  awning.position.set(0, 2.25, frontZ - 0.42);
  awning.rotation.x = -0.15;
  g.add(awning);

  // Peaked shingle roof. Materials fade while the player is inside.
  const roof = new THREE.Group();
  const roofMats = [
    makeToonMaterial({ color: 0x4f6742, rim: 0 }),
    makeToonMaterial({ color: 0x34492f, rim: 0 }),
  ];
  for (const mat of roofMats) mat.transparent = true;
  for (const sx of [-1, 1]) {
    const slope = new THREE.Mesh(
      new THREE.BoxGeometry(MOREL_SHOP_HW + 0.75, 0.2, MOREL_SHOP_HD * 2 + 0.8),
      roofMats[0],
    );
    slope.position.set(sx * (MOREL_SHOP_HW + 0.2) / 2, 3.0, 0);
    slope.rotation.z = sx * -0.46;
    roof.add(slope);
  }
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.25, MOREL_SHOP_HD * 2 + 1.0),
    roofMats[1],
  );
  ridge.position.y = 3.62;
  roof.add(ridge);
  g.add(roof);

  // A pair of warm mushroom lamps over the back display. Their real lights join
  // the shop's day/night lighting system; the glowing caps remain readable by day.
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Group();
    const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), dark);
    bracket.position.y = 0.28;
    lamp.add(bracket);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 10), plaster);
    stem.position.y = -0.12;
    lamp.add(stem);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffbd68 }),
    );
    cap.position.y = 0.04;
    lamp.add(cap);
    const light = new THREE.PointLight(0xffb45c, 0, 6, 1.7);
    light.position.y = -0.05;
    lamp.add(light);
    shop.lampLights.push(light);
    lamp.position.set(sx * 1.35, 1.85, backZ - 0.2);
    g.add(lamp);
  }

  // Mushroom wares: shallow crates and chunky cap/stem primitives, pushed
  // against the back wall so the entrance and Morel's counter space stay clear.
  const displayZ = backZ - 0.55;
  for (const sx of [-1, 1]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.45, 0.72), timber);
    crate.position.set(sx * 1.45, 0.38, displayZ);
    g.add(crate);
    for (let i = 0; i < 3; i++) {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.06, 0.2, 8),
        makeToonMaterial({ color: 0xeadfc5, rim: 0 }),
      );
      stem.position.set(sx * 1.45 + (i - 1) * 0.25, 0.7, displayZ);
      g.add(stem);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        makeToonMaterial({ color: sx < 0 ? 0xb55c4d : 0xd3a34d, rim: 0 }),
      );
      cap.position.set(stem.position.x, 0.81, stem.position.z);
      g.add(cap);
    }
  }

  // Hanging mushroom sign beside the doorway.
  const sign = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.12), timber);
  board.position.y = 1.55;
  sign.add(board);
  const signStem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.3, 8), plaster);
  signStem.position.set(0, 1.47, -0.08);
  sign.add(signStem);
  const signCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
    makeToonMaterial({ color: 0xc95b4c, rim: 0 }),
  );
  signCap.position.set(0, 1.66, -0.08);
  sign.add(signCap);
  sign.position.set(MOREL_SHOP_HW + 0.25, 0, frontZ);
  g.add(sign);

  const doorPos = new THREE.Vector3(cx, 0, cz - frontZ + 0.65);
  const doorInside = new THREE.Vector3(cx, 0, cz - frontZ - 0.75);
  const morelHome = new THREE.Vector3(cx, 0, cz - 0.75);
  // With the entrance turned away from the road, Morel routes around the east
  // wall instead of trying to walk home through the solid back wall.
  const returnPath = [
    new THREE.Vector3(cx + MOREL_SHOP_HW + 0.8, 0, cz - MOREL_SHOP_HD - 0.7),
    new THREE.Vector3(cx + MOREL_SHOP_HW + 0.8, 0, cz + MOREL_SHOP_HD + 0.7),
    doorPos.clone(),
    doorInside.clone(),
    morelHome.clone(),
  ];

  return {
    group: g, rect, roof, roofMats, roofA: 1,
    doorPos, doorInside, morelHome, returnPath,
  };
}

