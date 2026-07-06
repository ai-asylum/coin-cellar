// Creature Lab — the style prototype page. A parade of every species baked
// by the pipeline, marching in circles. Reroll for new seeds, ragdoll them
// for the noodle payoff. This page is also our visual regression check.
import * as THREE from "three";
import { Engine, rng } from "./core/engine.js";
import { makeToonMaterial } from "./core/toon.js";
import { Creature } from "./chargen/creature.js";
import {
  heroSpec, customerSpec, goblinSpec, bruteSpec,
  skitterSpec, slimeSpec, wispSpec,
} from "./chargen/species.js";

const engine = new Engine(document.getElementById("app"));
engine.scene.background = new THREE.Color(0x241639);
engine.scene.fog = new THREE.Fog(0x241639, 30, 70);
engine.camOffset.set(0, 12, 12);

// floor
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2),
  makeToonMaterial({ color: 0x4a3670, rim: 0 })
);
engine.scene.add(floor);

let creatures = [];
let marching = true;
let seedBase = 12;
const solo = new URLSearchParams(location.search).get("solo");

function build() {
  if (solo) {
    for (const c of creatures) c.dispose();
    creatures = [];
    const makers = {
      hero: () => heroSpec(seedBase),
      customer: () => customerSpec(seedBase + 1),
      goblin: () => goblinSpec(seedBase + 4, 0),
      brute: () => bruteSpec(seedBase + 5, 0),
      skitter: () => skitterSpec({ key: "sk" + seedBase, seed: seedBase + 6, legsN: 6 }),
      slime: () => slimeSpec({ key: "sl" + seedBase }),
      wisp: () => wispSpec({ key: "wi" + seedBase }),
    };
    const c = new Creature((makers[solo] || makers.hero)());
    c.userData.ang = 0;
    c.userData.rad = 0.001;
    engine.scene.add(c);
    creatures.push(c);
    engine.camOffset.set(0, 1.6, 4.2);
    return;
  }
  buildRing();
}

function buildRing() {
  for (const c of creatures) c.dispose();
  creatures = [];
  const specs = [
    heroSpec(seedBase),
    customerSpec(seedBase + 1),
    customerSpec(seedBase + 2),
    customerSpec(seedBase + 3),
    goblinSpec(seedBase + 4, 0),
    bruteSpec(seedBase + 5, 0),
    skitterSpec({ key: "sk" + seedBase, seed: seedBase + 6, legsN: 6 }),
    skitterSpec({ key: "sk4" + seedBase, seed: seedBase + 7, legsN: 4, scale: 0.6, hue: 0.1 }),
    slimeSpec({ key: "sl" + seedBase, hue: 0.36 + (seedBase % 5) * 0.1 }),
    wispSpec({ key: "wi" + seedBase, hue: 0.55 + (seedBase % 4) * 0.1 }),
  ];
  specs.forEach((spec, i) => {
    const c = new Creature(spec);
    const ang = (i / specs.length) * Math.PI * 2;
    c.userData.ang = ang;
    c.userData.rad = 4;
    c.position.set(Math.cos(ang) * 4, 0, Math.sin(ang) * 4);
    engine.scene.add(c);
    creatures.push(c);
  });
}
build();

engine.onTick((dt, t) => {
  for (const c of creatures) {
    if (!c.dead && marching) {
      c.userData.ang += dt * 0.35;
      const a = c.userData.ang;
      c.position.set(Math.cos(a) * c.userData.rad, 0, Math.sin(a) * c.userData.rad);
      c.heading = -a; // tangent, facing travel direction
    }
    c.update(dt, t);
  }
  engine.camTarget.set(0, 0.5, 0);
});

document.getElementById("lab-reroll").onclick = () => {
  seedBase = Math.floor(Math.random() * 99999);
  build();
};
document.getElementById("lab-ragdoll").onclick = () => {
  for (const c of creatures) {
    const dir = new THREE.Vector3(c.position.x, -2, c.position.z).normalize().multiplyScalar(-6);
    c.die(dir);
  }
};
document.getElementById("lab-walk").onclick = () => {
  marching = !marching;
};

engine.start();
