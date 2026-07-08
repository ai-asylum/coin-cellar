// Combat resolution: projectile hit tests, melee swings, enemy damage/death,
// boss enrage/explode, loot drops, chests and portals. Mixed onto
// Dungeon.prototype via Object.assign in dungeon.js, so every `this._method()`
// call keeps working.
import * as THREE from "three";
import { makeBlobShadow } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { EQUIP_DROPS, itemSprite } from "./items.js";
import { disposeDecor } from "./decor.js";
import { rng, pick } from "../core/engine.js";
import { DUNGEON_ORIGIN, dungeonIndexFor, DUNGEON_LOOT, FLOORS_PER_DUNGEON } from "./dungeon-data.js";

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

export const combatMethods = {
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
  },

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
  },

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
  },

  _projHitsWall(proj) {
    for (const col of this.colliders) {
      if (Math.abs(proj.x - col.x) < col.hw && Math.abs(proj.z - col.z) < col.hd) return true;
    }
    return false;
  },

  _projBurst(proj) {
    this.game.particles.burst(_v.set(proj.x, proj.y, proj.z), { color: proj.color ?? 0xb98cff, n: 8, speed: 3, life: 0.4 });
    this.game.audio.projHit();
    this.projectiles.remove(proj);
  },

  /** The dash's sweep, resolved each frame the dash is live. Contact is
   * body-to-body (the dash barrels straight through, so there's no frontal arc):
   * every foe within reach takes the hit — once per dash, deduped via
   * `opts.hitIds` — and any chest or destructible prop in the path is cracked /
   * smashed too. Host applies damage; a guest sends the hit and juices locally.
   * Returns whether anything was struck. */
  dashHit(attacker, dmg, game, opts = {}) {
    const { crit = false, knock = 1.4, hitIds = null } = opts;
    const pos = attacker.position;
    const reach = attacker.radius + 0.5;
    let hitAny = false;
    for (const e of this.enemies) {
      if (e.deadT >= 0 || e.hitCd > 0) continue;
      if (hitIds && hitIds.has(e.id)) continue;
      const c = e.creature;
      const dx = c.position.x - pos.x;
      const dz = c.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + c.radius) continue;
      hitIds && hitIds.add(e.id);
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
        this.damageEnemy(e, dmg, nx, nz, { crit, knock });
      }
    }
    // burst open any treasure chest the dash barrels through — there's no
    // dedicated "open" button any more, you crack them with the dash
    for (const chest of this.chests) {
      if (chest.opened) continue;
      const key = "chest:" + chest.id;
      if (hitIds && hitIds.has(key)) continue;
      const dx = chest.mesh.position.x + DUNGEON_ORIGIN.x - pos.x;
      const dz = chest.mesh.position.z + DUNGEON_ORIGIN.z - pos.z;
      if (Math.hypot(dx, dz) > reach + 0.5) continue;
      hitIds && hitIds.add(key);
      hitAny = true;
      game._openChest(chest);
    }
    // shatter any destructible scenery in the path — a purely cosmetic puff of
    // leaves/dust/bone, no loot, and rocks are spared
    if (this._smashDecor(pos, reach)) hitAny = true;
    return hitAny;
  },

  // Smash every destructible prop caught within `reach` of `pos`. Cosmetic only:
  // bursts particles, plays a crunch, drops nothing. Runs client-side for
  // everyone (the layout is seeded, so peers agree).
  _smashDecor(pos, reach) {
    if (!this.decor.length) return false;
    let hit = false;
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      const dx = d.wx - pos.x;
      const dz = d.wz - pos.z;
      if (Math.hypot(dx, dz) > reach + d.radius) continue;
      this.decor.splice(i, 1);
      this._burstDecor(d);
      hit = true;
    }
    return hit;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  takeDrop(drop) {
    drop.mesh.removeFromParent();
    this.drops = this.drops.filter((d) => d !== drop);
  },

  /** Bring the tutorial's hidden stairs (steps, glow, light shaft) back into
   * view. No-op once already shown or off the tutorial floor. */
  revealStairs() {
    if (!this.stairsHidden) return;
    this.stairsHidden = false;
    for (const mesh of this._stairsMeshes || []) mesh.visible = true;
  },

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
  },

  _removeEnemy(e) {
    e.creature.dispose();
    this.enemies = this.enemies.filter((x) => x !== e);
    this.game.net.send({ t: "eDel", id: e.id });
  },
};
