// Combat resolution: projectile hit tests, melee swings, enemy damage/death,
// boss enrage/explode, loot drops, chests and the boss stairs. Mixed onto
// Dungeon.prototype via Object.assign in dungeon.js, so every `this._method()`
// call keeps working.
import * as THREE from "three";
import { makeBlobShadow, makeToonMaterial, feedOccluder, fogPuffTexture } from "../core/toon.js";
import { makeLightShaft } from "../core/godrays.js";
import { EQUIP_DROPS, itemSprite } from "./items.js";
import { disposeDecor, DECOR_LOOT } from "./decor.js";
import { rng, pick } from "../core/engine.js";
import { DUNGEON_ORIGIN, dungeonIndexFor, DUNGEON_LOOT, FLOORS_PER_DUNGEON } from "./dungeon-data.js";
import { CELL, makeStairs, modelCollider } from "./dungeon-geometry.js";

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
    // strike-in-place passes a wider reach (the hero doesn't travel into the
    // foe); the moving dash leaves it undefined for the body-to-body default.
    const reach = opts.reach ?? attacker.radius + 0.5;
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
    // shatter any destructible scenery in the path — a puff of leaves/dust/bone
    // that can also forage a drop (herbs, mushrooms, rock crystals)
    if (this._smashDecor(pos, reach)) hitAny = true;
    // structural props (pillars, standing torches) don't give — they spark
    if (this._sparkStructural(pos, reach, hitIds)) hitAny = true;
    return hitAny;
  },

  // A dash raking a structural prop: a shower of sparks and a stony clank, but
  // the prop stands. Purely cosmetic and local (nothing changes state, so co-op
  // peers need no message). Deduped per dash via `hitIds` so a pass-through
  // doesn't spark every frame.
  _sparkStructural(pos, reach, hitIds = null) {
    let hit = false;
    for (let i = 0; i < this.structural.length; i++) {
      const s = this.structural[i];
      const key = "sp:" + i;
      if (hitIds && hitIds.has(key)) continue;
      if (Math.hypot(s.wx - pos.x, s.wz - pos.z) > reach + s.radius) continue;
      hitIds && hitIds.add(key);
      _v.set(s.wx, 0.9, s.wz);
      this.game.particles.burst(_v, { color: 0xffd98a, n: 9, speed: 3.6, up: 1.6, life: 0.35, size: 0.6 });
      this.game.particles.burst(_v, { color: 0xffffff, n: 4, speed: 2.6, up: 2.0, life: 0.28, size: 0.5 });
      this.game.audio.clank?.();
      hit = true;
    }
    return hit;
  },

  // Smash non-forage scenery caught within `reach` of `pos`. Loot-bearing
  // environmental props are contact-harvested instead (see collectDecor).
  // The burst
  // (particles + crunch) is cosmetic and runs client-side for everyone (the
  // layout is seeded, so peers agree). Loot-bearing categories are skipped.
  _smashDecor(pos, reach) {
    if (!this.decor.length) return false;
    const isGuest = this.game.net.isGuest;
    let hit = false;
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      if (DECOR_LOOT[d.cat]) continue;
      const dx = d.wx - pos.x;
      const dz = d.wz - pos.z;
      if (Math.hypot(dx, dz) > reach + d.radius) continue;
      this.decor.splice(i, 1);
      this._burstDecor(d);
      if (isGuest) this.game.net.send({ t: "dSmash", id: d.id });
      else this._dropDecorLoot(d);
      hit = true;
    }
    return hit;
  },

  // Walking into a loot-bearing environmental prop harvests it. Networking is
  // identical to a smashed prop so host and guest still roll exactly one drop.
  collectDecor(pos) {
    if (!this.decor.length) return false;
    const isGuest = this.game.net.isGuest;
    let hit = false;
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      if (!DECOR_LOOT[d.cat]) continue;
      if (Math.hypot(d.wx - pos.x, d.wz - pos.z) > d.radius) continue;
      this.decor.splice(i, 1);
      this._burstDecor(d);
      if (isGuest) this.game.net.send({ t: "dSmash", id: d.id });
      else this._dropDecorLoot(d);
      hit = true;
    }
    return hit;
  },

  // Host-side: a guest smashed a prop — burst its twin here (so it can't be
  // smashed twice) and roll its drop once. No-op if we already smashed it.
  smashDecorById(id) {
    const i = this.decor.findIndex((d) => d.id === id);
    if (i < 0) return;
    const d = this.decor[i];
    this.decor.splice(i, 1);
    this._burstDecor(d);
    this._dropDecorLoot(d);
  },

  // Roll a prop's forage drop from DECOR_LOOT and spawn it where it fell. Seeded
  // off the prop's stable id so a given prop always yields the same haul.
  _dropDecorLoot(d) {
    const table = DECOR_LOOT[d.cat];
    if (!table) return;
    const r = rng(this.seed + d.id * 131 + 7);
    // Morel's errand can't hinge on a coin flip: on the FTUE forage floor
    // every mushroom cluster pays out a mushroom, no herb subs, no blanks
    if (this.ftue && d.cat === "mushrooms")
      return this.spawnDrop(r() < 0.7 ? "mushroom" : "caveshroom", d.wx, d.wz);
    if (r() > table.chance) return;
    this.spawnDrop(pick(r, table.items), d.wx, d.wz);
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
    disposeDecor(d.group); // sprite materials only — kit models share templates
    d.group.removeFromParent();
    // a smashed kit prop stops blocking (billboard decor never had a collider)
    if (d.collider) this.colliders = this.colliders.filter((c) => c !== d.collider);
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
    // the boss goes out slow: felled, its body chars to black while the arena
    // fog is drawn back into the corpse; only once the last of the smoke is
    // swallowed does it blow apart, spilling the hoard and opening the way down
    // (see _beginBossDeath — the callback runs after the final blast).
    if (e.isBoss) {
      this.boss = null;
      this._beginBossDeath(e, () => {
        game.onBossDefeated?.(e.creature.position);
        this._spawnBossLoot(e);
        this._removeEnemy(e);
      });
      return;
    }
    // loot: enemies only drop merchandise — gold comes solely from selling it.
    // Mostly the monster's own signature loot, sometimes the dungeon's themed
    // table. Rare finds can't turn up on a dungeon's entry floor (localFloor 0)
    // at all — they only start appearing deeper, growing likelier toward the
    // hole's boss floor.
    const r = rng(e.seed + 99);
    if (r() < (e.def.dropRate ?? 0.6)) {
      const table = DUNGEON_LOOT[dungeonIndexFor(this.floor)] ?? DUNGEON_LOOT[0];
      const localFloor = (this.floor - 1) % FLOORS_PER_DUNGEON;
      const rareChance = localFloor > 0 ? 0.12 + localFloor * 0.06 : 0;
      const id = e.def.loot && r() < 0.65 ? pick(r, e.def.loot)
        : r() < rareChance ? pick(r, table.rare)
        : pick(r, table.common);
      this.spawnDrop(id, e.creature.position.x, e.creature.position.z);
    }
  },

  /** Roll a thick fog bank through the boss arena. It's an occluder material
   * (like the walls), so the wall-removal dither eats the puffs sitting between
   * the camera and the keeper — you see the boss through the smoke. Built on
   * host + guest and seeded off the floor so co-op peers agree. The puffs are
   * flat quads billboarded to the camera each frame (see _updateBossFog), which
   * keeps them round like the cave's veil while still taking the shader. */
  _buildBossFog(center, BW, BH) {
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = makeToonMaterial({ map: fogPuffTexture(), color: 0x0b0d18, rim: 0, occlude: true });
    mat.transparent = true;
    mat.opacity = 0.92;
    mat.depthWrite = false; // stack cleanly; the boss (solid) still occludes it
    mat.fog = false;
    const r = rng(this.seed + 7788);
    const puffs = [];
    const hw = (BW * CELL) / 2, hd = (BH * CELL) / 2;
    const add = (x, y, z, sc) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(center.x + x, y, center.z + z);
      m.scale.set(sc, sc, 1);
      m.raycast = () => {};
      m.userData = { hx: center.x + x, hy: y, hz: center.z + z, sc, delay: r() * 0.5, fly: 0.55 + r() * 0.45, ang: r() * Math.PI * 2 };
      group.add(m);
      puffs.push(m);
    };
    // fill the arena, biased toward the back (−z) so the doorway and its
    // portcullis (the +z rim) stay clear — no smoke spilling over the locked
    // gate or into the corridor — while still leaving plenty of haze between
    // the camera and the keeper for the see-through dither to read against.
    const zLo = -hd * 0.9, zHi = hd * 0.4; // never reach the +z gate line (±hd)
    for (let i = 0; i < 80; i++)
      add((r() - 0.5) * hw * 1.7, 0.3 + r() * 3.2, zLo + (zHi - zLo) * r(), 2.2 + r() * 1.6);
    // a denser inner band the hero peers through — kept a stride north of the
    // doorway so it thickens the room without hiding the gate
    for (let i = 0; i < 22; i++)
      add((r() - 0.5) * hw * 1.5, 0.3 + r() * 2.6, hd * (0.2 + r() * 0.2), 2.2 + r() * 1.2);
    this.group.add(group);
    this._bossFogMat = mat;
    this.bossFog = { group, puffs, mat, geo };
  },

  /** Per-frame arena fog: billboard the puffs, breathe them, and feed the
   * occluder so the keeper (and any hero inside) reads through the smoke. Once
   * the boss is felled (_fogDeath set), stream every puff into the corpse while
   * the body chars black, then hand off to _explodeBoss. */
  _updateBossFog(dt, elapsed) {
    const fog = this.bossFog;
    if (!fog) return;
    const cam = this.game.engine.camera;
    for (const m of fog.puffs) m.quaternion.copy(cam.quaternion);

    if (!this._fogDeath) {
      const occ = [];
      if (this.boss && this.boss.deadT < 0) occ.push(this.boss.creature);
      feedOccluder(fog.mat, this.game.player, cam, 0.55, occ);
      // a wider clear than the walls use (1.7) so the whole keeper reads through
      // the smoke, not just a narrow tube to its torso
      const sh = fog.mat.userData.shader;
      if (sh?.uniforms?.uFadeRadius) sh.uniforms.uFadeRadius.value = 2.6;
      for (const m of fog.puffs) {
        const u = m.userData;
        const w = elapsed * 0.6 + u.hx * 0.4;
        m.position.x = u.hx + Math.sin(w) * 0.35;
        m.position.y = u.hy + Math.cos(w * 0.9) * 0.22;
        m.position.z = u.hz + Math.sin(w * 0.6) * 0.18;
      }
      return;
    }

    // death: char the body to black and swirl the whole bank into the corpse
    const d = this._fogDeath;
    d.t += dt;
    const e = d.e;
    const bm = e.creature.bodyMat?.userData?.uBlacken;
    if (bm) bm.value = Math.min(1, d.t / 0.5);
    const cx = e.creature.position.x - DUNGEON_ORIGIN.x;
    const cz = e.creature.position.z - DUNGEON_ORIGIN.z;
    const cy = e.creature.height * 0.5;
    let alive = 0;
    for (const m of fog.puffs) {
      const u = m.userData;
      const k = Math.min(1, Math.max(0, (d.t - u.delay) / u.fly));
      if (k >= 1) { m.visible = false; continue; }
      alive++;
      if (k <= 0) continue;
      const e2 = k * k * (3 - 2 * k);
      const swirl = Math.sin(k * Math.PI) * 1.3; // arcs in, tightening as it lands
      const a = u.ang + k * 7;
      m.position.set(
        u.hx + (cx - u.hx) * e2 + Math.cos(a) * swirl,
        u.hy + (cy - u.hy) * e2,
        u.hz + (cz - u.hz) * e2 + Math.sin(a) * swirl
      );
      m.scale.setScalar(u.sc * (1 - e2));
    }
    if (alive === 0 || d.t >= d.dur) {
      const after = d.afterExplode;
      this.group.remove(fog.group);
      fog.geo.dispose();
      fog.mat.dispose();
      this.bossFog = null;
      this._bossFogMat = null;
      this._fogDeath = null;
      // the smoke was the keeper's life — swallowed, the body detonates
      this._explodeBoss(e, after);
    }
  },

  /** Begin the boss's drawn-out death: it's already ragdolling from die(), but
   * we take over the char/dissolve driver so the body stays put and blackens in
   * place while the arena fog pours into it (see _updateBossFog). Run on host +
   * guest; `afterExplode` fires once the final blast plays. If there's no fog
   * (shouldn't happen), it detonates at once. */
  _beginBossDeath(e, afterExplode) {
    // stop Creature.update's auto blacken→dissolve; we drive the blacken and
    // never dissolve (the body vanishes in the explosion's bursts instead)
    e.creature._deathT = undefined;
    if (e.creature.bodyMat?.userData?.uDissolve) e.creature.bodyMat.userData.uDissolve.value = 0;
    if (e.creature.outline?.material?.userData?.uDissolve) e.creature.outline.material.userData.uDissolve.value = 0;
    if (this.bossFog) {
      this._fogDeath = { e, t: 0, dur: 1.5, afterExplode };
    } else {
      this._explodeBoss(e, afterExplode);
    }
  },

  /** The boss hoard: the only source of gear — two distinct pieces, a crown, a
   * potion and a fistful of the dungeon's top spoils, arcing out from the
   * corpse in a snug ring. Host-only (guests receive the drops over the wire). */
  _spawnBossLoot(e) {
    const bx = e.creature.position.x, bz = e.creature.position.z;
    const rl = rng(e.seed + 5);
    let g1 = pick(rl, EQUIP_DROPS), g2 = pick(rl, EQUIP_DROPS);
    while (g2 === g1) g2 = pick(rl, EQUIP_DROPS);
    const hole = dungeonIndexFor(this.floor);
    const table = DUNGEON_LOOT[hole] ?? DUNGEON_LOOT[0];
    const spoils = [g1, g2, "crown", "potion"];
    for (let i = 0; i < 3 + hole; i++) spoils.push(pick(rl, table.rare));
    spoils.forEach((id, i) => {
      const a = (i / spoils.length) * Math.PI * 2 + rl() * 0.7;
      const rad = 0.9 + rl() * 1.1; // ~1–2 units out, a snug pile by the body
      this.spawnDrop(id, bx + Math.sin(a) * rad, bz + Math.cos(a) * rad, null, { flyFrom: { x: bx, z: bz } });
    });
  },

  /** Blow the boss apart piece by piece: each body mesh pops in a staggered
   * burst of debris and vanishes, capped by one big white flash. Cosmetic, so
   * it runs on host + guest (see the eDie mirror). `onDone` fires with the
   * final blast (loot + stairs hang off it). */
  _explodeBoss(e, onDone) {
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
      onDone?.();
    }, parts.length * 85 + 80);
  },

  /** Conjure a flight of stairs at world coords (wx,wz) where the boss fell.
   * `descend` makes it a fiery down-flight into the next stacked dungeon;
   * otherwise it's the cool arcane way HOME (final boss only). Built
   * identically on host and guest (both run onBossDefeated), so it needs no
   * dedicated net message to stay in sync. */
  spawnBossStairs(wx, wz, descend = false) {
    if (this.bossStairs) return;
    const lx = wx - DUNGEON_ORIGIN.x, lz = wz - DUNGEON_ORIGIN.z;
    const discColor = descend ? 0xff8a3d : 0x5dd0ff;
    const ringColor = descend ? 0xffd36b : 0x9a6dff;
    const shaftColor = descend ? 0xff9a4d : 0x7fd8ff;
    const g = new THREE.Group();
    g.position.set(lx, 0, lz);
    // the stairs themselves, over a glowing disc with a brighter outer ring
    const stairMesh = makeStairs(descend ? "down" : "up");
    g.add(stairMesh);
    // solid footprint fitted to the flight (not the wide glow disc), so you
    // brush against the stairs and step up to them to travel
    const stairsCollider = modelCollider(stairMesh, DUNGEON_ORIGIN);
    this.colliders.push(stairsCollider);
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
    // a bright column of light rising from the stairs (animated via shafts)
    const shaft = makeLightShaft({ color: shaftColor, length: 4.8, topWidth: 0.5, bottomWidth: 2.2, opacity: 0.55, tilt: 0, spin: 1.6, motes: 16, always: true });
    shaft.position.set(lx, 3.4, lz);
    this.group.add(shaft);
    this.shafts.push(shaft);
    this.bossStairs = { pos: new THREE.Vector3(wx, 0, wz), mesh: g, disc, ring, descend, collider: stairsCollider };
  },

  /** Reveal the staircase down cut into the boss arena's back wall (built
   * hidden by _buildBossArena). Drops the cover, lands its collider, lights a
   * warm shaft over it and wires it up as `bossStairs` — the same shape the
   * arrow, minimap and interact prompt already read. Built from the seed, so
   * host and guest both run it from onBossDefeated. Returns false (so the
   * caller can fall back to a conjured flight) when there's nothing to reveal —
   * e.g. the final boss, which leaves the way home instead. */
  revealBossStairs() {
    if (this.bossStairs) return true;
    const d = this.bossDescent;
    if (!d) return false;
    d.group.visible = true;
    if (d.cover) {
      d.cover.removeFromParent();
      d.cover.geometry.dispose();
      d.cover.material.dispose();
      d.cover = null;
    }
    this.colliders.push(d.collider);
    const lx = d.pos.x - DUNGEON_ORIGIN.x, lz = d.pos.z - DUNGEON_ORIGIN.z;
    const shaft = makeLightShaft({ color: 0xff9a4d, length: 4.8, topWidth: 0.5, bottomWidth: 2.2, opacity: 0.5, tilt: 0, spin: 1.4, motes: 14, always: true });
    shaft.position.set(lx, 3.4, lz);
    this.group.add(shaft);
    this.shafts.push(shaft);
    this.bossStairs = { pos: d.pos.clone(), mesh: d.group, descend: true, collider: d.collider };
    return true;
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
    // `pull` tracks the magnet speed once a hero is in range (see game._updatePlayer).
    const drop = { id: id ?? this.game.net.newId(), item: itemId, mesh, phase: Math.random() * 9, restX: rx, restZ: rz, pull: 0 };
    if (opts.flyFrom) {
      drop.fly = { fromX: opts.flyFrom.x, fromZ: opts.flyFrom.z, t: 0, dur: 0.5 + Math.random() * 0.4, arc: 1.6 + Math.random() * 1.4 };
      mesh.position.set(opts.flyFrom.x, 0.7, opts.flyFrom.z);
    } else {
      // a small in-place hop so freshly-dropped loot visibly pops out and lands
      // on the floor first — it can't be collected while it's still arcing, so
      // kills at point-blank range no longer vanish straight into the bag.
      drop.fly = { fromX: rx, fromZ: rz, t: 0, dur: 0.38, arc: 0.5 };
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
    // the flight is solid now that it's back — land its held-back collider
    if (this._hiddenStairsCollider) {
      this.colliders.push(this._hiddenStairsCollider);
      this._hiddenStairsCollider = null;
    }
  },

  openChest(chest) {
    if (chest.opened) return null;
    chest.opened = true;
    const cover = chest.mesh.userData.cover ?? chest.mesh.children[1];
    if (cover) cover.rotation[chest.mesh.userData.coverAxis ?? "x"] = -1.9; // lid flips open
    // cracking the tutorial chest is what unlocks the way home
    if (this.tutorial) this.revealStairs();
    const r = rng(this.seed + chest.id * 313);
    // chest loot draws from the dungeon's own themed table. The rare shelf is
    // sealed on a dungeon's entry floor (localFloor 0) and only opens deeper,
    // growing likelier the closer the floor sits to the hole's boss.
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
    // the FTUE chest always pays out the same two starter wares — a Wild
    // Mushroom to top up Morel's basket and a Roast Meat for the new shelf
    if (this.tutorial || this.ftue) {
      this.spawnDrop("mushroom", cx, cz + 0.8);
      this.spawnDrop("meat", cx + 0.7, cz);
      return "mushroom";
    }
    const rareChance = localFloor > 0 ? 0.22 + localFloor * 0.18 : 0;
    const item = r() < rareChance ? pick(r, table.rare) : pick(r, table.common);
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
