// Customer simulation: the flow that trickles shoppers in, walks them around
// the floor browsing, queues them at the counter, and — for co-op guests —
// mirrors the host's crowd. Also the ambient street passers-by. Split out of
// shop.js as prototype methods (mixed onto Shop via Object.assign) so they keep
// using `this` unchanged.
import * as THREE from "three";
import { BlockyCreature, variantForSeed, HARD_SEED } from "../chargen/blocky.js";
import { ITEMS, LOOT_BY_TIER, itemKind } from "./items.js";
import { rng, pick, clamp } from "../core/engine.js";
import { ARCHETYPES, SELLER_CHANCE, MAX_CUSTOMERS } from "./shop-data.js";
import { CROWD_NPCS, npcById, npcByVariant, personalityArchetype, personalityTaste, npcArriveLine } from "./npc-data.js";

const _d = new THREE.Vector3();

// Resolve a townsperson's fixed shopper characteristic (see npc-data.js) to its
// ARCHETYPES entry, so the same face always haggles in character. Falls back to
// the everyday "Regular" temperament if a personality has no archetype set.
const _archByName = new Map(ARCHETYPES.map((a) => [a.name, a]));
function archetypeForNpc(npc) {
  return _archByName.get(personalityArchetype(npc)) || ARCHETYPES[1] || ARCHETYPES[0];
}

// Did an item land squarely in this townsperson's taste? True when their
// personality strongly favours that item's kind (see PERSONALITIES.taste) —
// used to tell an "I loved it!" purchase from an out-of-character impulse buy.
const LOVE_THRESHOLD = 1.3;
function _lovesKind(npc, itemId) {
  const t = personalityTaste(npc);
  return (t.kinds[itemKind(itemId)] ?? 1) >= LOVE_THRESHOLD;
}

// How close the player must be for a townsperson to notice them: slow to a
// curious amble and turn to face them as they pass.
const NPC_NOTICE_R = 2.6;
// Closer still and they stop altogether — halting to face the player and let
// them by, the way Animal Crossing villagers pause the moment you walk up to
// them. Sits inside the notice radius so there's a brief amble before the stop.
const NPC_STOP_R = 1.45;
// Townsfolk carry themselves at an unhurried, Animal-Crossing-ish pace: a
// gentle steady turn, slightly slowed limbs, and a relaxed stroll.
const NPC_TURN_RATE = 2.6; // rad/s — a soft, unhurried pivot
const NPC_ANIM_SCALE = 0.85; // slightly slower gait
const NPC_WALK_MUL = 0.8; // relaxed base walking speed
const NPC_NOTICE_MUL = 0.3; // extra slow-down when ambling past the player
// How briskly a stroller eases between paces (walk ↔ amble ↔ full stop). Low
// enough that speeding up and slowing down reads as a natural roll, not a snap.
const NPC_ACCEL = 5.5;

export const customerMethods = {
  // Trickle shoppers in all day: as long as something's on the shelves and we
  // haven't hit the concurrent cap, a fresh customer arrives every few seconds.
  // The pace quickens as the town fills out (each restored house adds a resident
  // who shops here). Runs on the host regardless of where the player is, so
  // trade — and passive plain-table income — keeps ticking over while you delve.
  _pumpFlow(dt) {
    // During the first-run tutorial the crowd is hand-scripted: the one and
    // only customer is the FTUE's first shopper (see spawnScriptedCustomer),
    // so hold the auto-flow.
    if (this.game.tutorial) return;
    if (this.stockedCount() === 0 || this.customers.length >= MAX_CUSTOMERS) return;
    this._spawnT -= dt;
    if (this._spawnT > 0) return;
    const sent = this._spawnCustomer();
    if (!sent) {
      // nobody free to recruit this instant — check back shortly for a stroller
      this._spawnT = 0.5;
      return;
    }
    // more residents → livelier street: base ~5.5s, easing down toward ~1.8s
    const pop = this.game.townPop ? this.game.townPop() : 0;
    const interval = Math.max(1.8, 5.5 - pop * 0.5);
    this._spawnT = interval * (0.7 + Math.random() * 0.6);
  },

  // Nudge the next arrival to come almost immediately (used by the FTUE so a
  // customer shows up the moment the player stocks their first table).
  hurryNextCustomer(delay = 0.6) {
    this._spawnT = Math.min(this._spawnT, delay);
  },

  // The FTUE's scripted first shopper: an ordinary villager who walks in the
  // moment the first table is stocked, makes a beeline for it, and always
  // commits (see _decide's mustBuy) — a plain-table purchase at sticker price,
  // so the player's first sale simply happens before their eyes. Haggling
  // waits for the vitrine. Endless patience so onboarding can't stall out.
  spawnScriptedCustomer(seed = 4242) {
    const game = this.game;
    const npc = this._allocNpc(seed) || CROWD_NPCS[0];
    const creature = new BlockyCreature(npc.variant, {
      height: 1.5,
      turnRate: NPC_TURN_RATE,
      animScale: NPC_ANIM_SCALE,
    });
    // FTUE's first shopper enters fast: spawn just outside the shop, aligned
    // with the door and 4m out, so he steps in almost immediately instead of
    // trudging the whole street up from the village end.
    const outward = this.doorPos.clone().sub(this.doorInside).setY(0).normalize();
    const scriptedSpawn = this.doorPos.clone().addScaledVector(outward, 4);
    creature.position.copy(scriptedSpawn);
    creature.heading = Math.atan2(
      this.doorInside.x - scriptedSpawn.x,
      this.doorInside.z - scriptedSpawn.z,
    ); // facing the shop door
    this.group.add(creature);
    const cust = {
      id: game.net.newId(),
      seed,
      npc,
      creature,
      arch: archetypeForNpc(npc),
      mode: "buy",
      scripted: true,
      sellItem: null,
      minSell: 0,
      sellSpot: new THREE.Vector3(0, 0, 1.2),
      slot: null,
      ready: false,
      favorite: null,
      favScore: -1,
      target: null,
      seen: new Set(),
      toVisit: 1, // makes a beeline for the one stocked table
      visited: 0,
      lookT: 0,
      maxPay: 0,
      strikes: 0,
      state: "street",
      t: 0,
      patience: 1e9, // he won't leave until the deal is done
      exitPoint: this.streetEndS.clone(),
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    return cust;
  },

  // How many strollers may wander the street at once. The town starts out
  // sleepy and half-empty — the note's "the town just needs fixing up" — so
  // during the first-run FTUE (through the player's very first walk into the
  // village) only a couple of souls are about; the street fills out to its
  // usual bustle once onboarding is done.
  _maxPassersby() {
    return this.game.tutorial ? 2 : 3;
  },

  // Cosmetic pedestrians that mill about the whole street — not just a single
  // sidewalk lane. Each strolls between random waypoints spread across the road
  // (and now and then down the alley to the plaza), pausing here and there,
  // then wanders off after a while. They never enter the shop and never touch
  // game state; run on every client independently.
  _updatePassersby(dt, elapsed) {
    const game = this.game;
    if (!game.gameOver) {
      this._passerT -= dt;
      if (this._passerT <= 0 && this.passersby.length < this._maxPassersby()) {
        this._passerT = 1.6 + Math.random() * 3;
        this._spawnPasserby();
      }
    }
    for (const p of [...this.passersby]) {
      const c = p.creature;
      if (p.chatting) {
        // paused for a chat with the player — face them and idle in place
        const pp = game.player.position;
        c.heading = Math.atan2(pp.x - c.position.x, pp.z - c.position.z);
        c.update(dt, elapsed);
        continue;
      }
      p.life -= dt;
      // where the player is relative to this stroller drives the whole beat:
      // a curious amble at arm's length, a full stop (and a turn to face them)
      // once they've walked right up — Animal-Crossing style.
      const pp = game.player.position;
      const pdist = Math.hypot(pp.x - c.position.x, pp.z - c.position.z);
      const noticing = pdist < NPC_NOTICE_R;
      const blocking = pdist < NPC_STOP_R;
      const facePlayer = Math.atan2(pp.x - c.position.x, pp.z - c.position.z);
      if (p.pause > 0 && !blocking) {
        p.pause -= dt; // loitering — stand still but keep the idle anim ticking
        if (noticing) c.heading = facePlayer; // glance over if they wander close
        else this._lookAround(p, dt); // idle: glance about, taking in the street
        p.curSpeed += (0 - p.curSpeed) * Math.min(1, dt * NPC_ACCEL);
      } else {
        const dx = p.tx - c.position.x, dz = p.tz - c.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.35 && !blocking) {
          // reached the waypoint: dawdle, then pick the next spot (or head off
          // the edge once this stroller's time is up)
          if (p.life <= 0) { p.tx = p.exitX; p.tz = p.exitZ; p.life = -1e9; p.pause = 0; }
          else {
            this._pickPasserTarget(p);
            // stop and linger fairly often — they'll look around while stood
            // still, then set off toward the fresh (usually new) direction
            if (Math.random() < 0.65) { p.pause = 1.2 + Math.random() * 2.4; p.lookBase = c.heading; p.lookT = 0.4 + Math.random() * 0.7; }
            else p.pause = 0;
          }
          p.curSpeed += (0 - p.curSpeed) * Math.min(1, dt * NPC_ACCEL);
        } else {
          // ease speed toward the pace the moment calls for: a full stop when
          // the player's right up close, a curious amble when they're nearby,
          // an unhurried stroll otherwise. Smoothing the change (rather than
          // snapping) is what sells the gentle slow-down and pick-back-up.
          const mul = blocking ? 0 : noticing ? NPC_NOTICE_MUL : NPC_WALK_MUL;
          p.curSpeed += (p.speed * mul - p.curSpeed) * Math.min(1, dt * NPC_ACCEL);
          if (d > 1e-4) {
            c.position.x += (dx / d) * p.curSpeed * dt;
            c.position.z += (dz / d) * p.curSpeed * dt;
          }
          // face the player when they're near (stopped or ambling past), else
          // face the way they're walking
          c.heading = noticing ? facePlayer : Math.atan2(dx, dz);
        }
      }
      c.update(dt, elapsed);
      // retire once they've reached the exit point beyond the street edge. A
      // stall watchdog is the backstop: a leaving stroller the player isn't
      // pausing yet is making no headway (some geometry snag) is force-retired
      // so it can never freeze into a statue on the street.
      if (p.life <= -1e8) {
        if (!blocking && p.curSpeed < 0.06) p._stallT = (p._stallT || 0) + dt;
        else p._stallT = 0;
        const R = this.streetRegion;
        if (c.position.x > R.maxAlong + 2.4 || c.position.x < R.minAlong - 2.4 || p._stallT > 2.5) {
          this._freeNpc(p.npc);
          c.dispose();
          this.passersby = this.passersby.filter((x) => x !== p);
        }
      }
    }
  },

  // While a stroller is stood still, have them idly look about — turning to a
  // fresh angle every couple of seconds (left, then right, wherever) so a
  // paused pedestrian reads as taking in the street rather than a frozen statue.
  _lookAround(p, dt) {
    p.lookT = (p.lookT ?? 0) - dt;
    if (p.lookT > 0) return;
    const base = p.lookBase ?? p.creature.heading;
    const turn = (0.5 + Math.random() * 1.0) * (Math.random() < 0.5 ? -1 : 1);
    p.lookBase = base + turn;
    p.creature.heading = p.lookBase;
    p.lookT = 0.9 + Math.random() * 1.7;
  },

  // Roll a fresh waypoint out on the open road for a stroller: anywhere across
  // the full width and depth of the road/pavement (which sits in front of the
  // buildings, so a straight stroll between waypoints never clips a wall).
  _pickPasserTarget(p) {
    const R = this.streetRegion;
    p.tx = R.minAlong + Math.random() * (R.maxAlong - R.minAlong); // along = screen X
    p.tz = R.minCross + Math.random() * (R.maxCross - R.minCross); // across = screen Z
  },

  _spawnPasserby() {
    const R = this.streetRegion;
    const npc = this._allocNpc();
    if (!npc) return; // no free skin right now — skip this stroller
    const seed = Math.floor(Math.random() * 1e6);
    const creature = makeCustomerBody(npc, seed);
    // in from (and back out through) the village end — the RIGHT end of the road.
    const startX = R.maxAlong + 2.5;
    creature.position.set(startX, 0, R.minCross + Math.random() * (R.maxCross - R.minCross));
    creature.heading = -Math.PI / 2; // walk toward −X, into the street
    this.group.add(creature);
    const p = {
      creature,
      npc,
      seed, // carried over if this stroller is later recruited into the shop
      speed: 1.0 + Math.random() * 0.9,
      curSpeed: 0, // eased actual pace, so accel/decel reads as a natural roll
      life: 10 + Math.random() * 14, // seconds of milling before they head off
      pause: 0,
      // Aim the exit well past the despawn line (maxAlong + 2.4) so a leaving
      // stroller walks clean through it and retires — if the target sat right on
      // the edge they'd ease to a stop ~0.3m short and freeze there forever.
      exitX: R.maxAlong + 5,
      exitZ: R.minCross + Math.random() * (R.maxCross - R.minCross),
      tx: 0, tz: 0,
    };
    this._pickPasserTarget(p);
    this.passersby.push(p);
  },

  // Float a townsperson's "on my way in" aside over their head as they peel off
  // the street and head for the shop door (see npcArriveLine + hud.speechBubble).
  // Seeded off the customer's stable seed so the host and every co-op guest pick
  // the same line for the same shopper. Cosmetic — skipped during the FTUE so the
  // hand-scripted first sale stays uncluttered.
  _sayArrival(creature, npc, seed) {
    if (this.game.tutorial || !npc || !creature) return;
    const line = npcArriveLine(npc, rng(seed + 917)());
    if (line) this.game.hud.speechBubble(creature, line, 2.8);
  },

  // Hand out a townsperson whose skin isn't already on screen — and never the
  // player's own skin (nor the co-op partner's), so a shopper is never a
  // doppelgänger of anyone the players control. Returns null when every crowd
  // skin is taken (the spawn just waits for one to free up). `seed`, when
  // given, keeps the pick stable for a repeat body.
  _allocNpc(seed = null) {
    const taken = this._npcInUse;
    const held = this._cameoHold;
    const heroV = this.game.player?.variant;
    const mateV = this.game.remote?.creature?.variant;
    const free = CROWD_NPCS.filter(
      (n) => !taken.has(n.variant) && !held.has(n.variant) && n.variant !== heroV && n.variant !== mateV
    );
    if (!free.length) return null;
    const npc = seed != null
      ? free[Math.abs(Math.floor(seed)) % free.length]
      : pick(rng(Math.random() * 1e9), free);
    this._npcInUse.add(npc.variant);
    return npc;
  },

  // Release a townsperson's skin back into the pool once they've left the scene.
  _freeNpc(npc) {
    if (npc) this._npcInUse.delete(npc.variant);
  },

  // A scripted cameo (the Mayor, the Clerk) is about to take the stage as this
  // exact townsperson: pull any roaming/shopping copy of them off-screen and
  // bar the skin from the ambient crowd so there's never two of them at once.
  holdVariantForCameo(variant) {
    this._cameoHold.add(variant);
    for (const p of [...this.passersby]) {
      if (p.npc?.variant !== variant) continue;
      this._freeNpc(p.npc);
      p.creature.dispose();
      this.passersby = this.passersby.filter((x) => x !== p);
    }
    for (const cust of [...this.customers]) {
      if (cust.npc?.variant === variant) this._removeCustomer(cust);
    }
  },

  // The cameo's done — let their skin rejoin the ambient crowd.
  releaseCameoVariant(variant) {
    this._cameoHold.delete(variant);
  },

  // Pull a stroller off the street to send into the shop: their body, skin and
  // seed carry straight over, so the shopper you see at the counter is the very
  // person who was just wandering the road. Returns null when nobody's out.
  _takePasserbyForShop() {
    const cand = this.passersby.filter((p) => !p.chatting && p.life > -1e8);
    if (!cand.length) return null;
    const p = pick(rng(Math.random() * 1e9), cand);
    this.passersby = this.passersby.filter((x) => x !== p);
    return p; // { creature, npc, seed } — the customer inherits its skin/npc
  },

  _spawnCustomer() {
    const game = this.game;
    // Shoppers are always someone already out on the street: a stroller peels
    // off and heads for the door, carrying their body, skin and seed straight
    // over — so the person at your counter is the very one you saw wandering
    // past. If nobody's roaming yet, we hold the arrival (the passer-by pump
    // tops the crowd back up) rather than conjure a fresh body from thin air.
    const fromStreet = this._takePasserbyForShop();
    if (!fromStreet) return false;
    const creature = fromStreet.creature;
    const npc = fromStreet.npc;
    const seed = fromStreet.seed ?? pick(rng(Math.random() * 1e9), this._custSeedPool);

    // A shopper always shops in character: their archetype is a fixed trait of
    // who they are (set by their personality — see npc-data.js), so the same
    // townsperson haggles the same way every visit instead of rolling a fresh
    // temperament each time. The wealth mix of the crowd therefore follows the
    // roster of townsfolk out on the street, not a per-arrival dice roll.
    const arch = archetypeForNpc(npc);

    // Some shoppers arrive as sellers: they carry an item to offload onto the
    // player (the reverse haggle). They'll accept anything at or above a hidden
    // floor well under base value, so buying low here and re-shelving it is
    // where a lot of the profit lives. During the first-run tutorial, though,
    // hold everyone to buyers so a brand-new player learns to *sell* before
    // they're ever offered something to buy.
    // Sellers temporarily disabled: everyone arrives as a buyer.
    // const mode = !game.tutorial && Math.random() < SELLER_CHANCE ? "sell" : "buy";
    const mode = "buy";
    let sellItem = null, minSell = 0;
    if (mode === "sell") {
      // Sellers bring better goods as the shop grows: the *lowest* tier they'll
      // try to offload climbs with the day, so the early tier-1 trash (shrooms,
      // jelly, bread) stops clogging the counter once you're past the first days.
      const loTier = clamp(1 + Math.floor(game.day / 3), 1, 4);
      const hiTier = clamp(loTier + 1, 1, 4);
      const tier = loTier + Math.floor(Math.random() * (hiTier - loTier + 1));
      sellItem = pick(rng(seed + 7), LOOT_BY_TIER[tier]);
      minSell = Math.round(ITEMS[sellItem].base * (0.45 + Math.random() * 0.3)); // 45–75% of base
    }

    const cust = {
      id: game.net.newId(),
      seed,
      npc, // their fixed identity (name, personality, dialogue)
      creature,
      arch,
      mode,
      sellItem, // item id they're offloading (sellers only)
      minSell, // hidden floor they'll accept (sellers only)
      sellSpot: new THREE.Vector3((Math.random() - 0.5) * 4, 0, 0.6 + Math.random() * 1.8),
      slot: null, // chosen once they've made up their mind
      ready: false, // arrived at their waiting spot — auto-haggle can fire
      favorite: null, // best item seen while browsing
      favScore: -1,
      target: null, // slot currently being inspected
      seen: new Set(), // slot indices already looked at
      toVisit: 1 + Math.floor(Math.random() * 3), // browse 1–3 items
      visited: 0,
      lookT: 0,
      maxPay: 0,
      strikes: 0,
      state: "street", // street -> enter -> (roam.../offer) -> leave
      t: 0,
      patience: 18 + Math.random() * 10,
      exitPoint: this.streetEndS.clone(),
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    this._sayArrival(creature, npc, seed);
    game.net.send({
      t: "custAdd",
      id: cust.id, seed,
      npcId: npc.id,
      x: creature.position.x, z: creature.position.z,
      archIdx: ARCHETYPES.indexOf(arch),
      mode, sellItem, minSell,
    });
    return true;
  },

  // Someone else is already at (or heading for) this slot — browsing or
  // waiting to haggle. Shoppers skip busy slots so they don't pile up.
  _slotBusy(slot, cust) {
    return this.customers.some((o) => o !== cust && (
      ((o.state === "goto" || o.state === "look") && o.target === slot) ||
      (o.state === "want" && o.slot === slot)
    ));
  },

  // Is a world point on (or too near) a blocked nav cell? Used to weed out
  // browse spots that back into a wall or another table.
  _spotBlocked(p) {
    const nav = this._nav;
    if (!nav) return false;
    const c = Math.floor((p.x - nav.minX) / nav.cell);
    const r = Math.floor((p.z - nav.minZ) / nav.cell);
    if (c < 0 || c >= nav.cols || r < 0 || r >= nav.rows) return true;
    return !!nav.blocked[r * nav.cols + c];
  },

  // Another shopper already stands at (or is heading for) this exact spot.
  // Adjacent slots share their table's end spots as separate Vector3s with the
  // same coordinates, so compare by distance rather than identity.
  _spotTaken(p, cust) {
    return this.customers.some((o) => {
      if (o === cust) return false;
      const s =
        ((o.state === "goto" || o.state === "look") && o.browseSpot) ||
        (o.state === "autobuy" && o.buySpot) || null;
      return !!s && Math.hypot(s.x - p.x, s.z - p.z) < 0.5;
    });
  },

  // Choose which side of an item's table a shopper should stand at. Rather than
  // always crowding the front (which can wall a customer off behind a table),
  // pick the closest free reachable spot — so someone coming from the door
  // views it from the near side instead of squeezing past, and two shoppers at
  // adjacent slots never overlap on a shared end spot. If every side is taken,
  // settle for the closest reachable one anyway rather than stalling.
  _browseSpotFor(cust, slot) {
    const spots = slot.browseSpots || [slot.browsePos];
    const from = cust.creature?.position || cust.creature?.group?.position;
    let best = null, bestD = Infinity;
    let bestFree = null, bestFreeD = Infinity;
    for (const s of spots) {
      if (this._spotBlocked(s)) continue;
      const d = from ? from.distanceToSquared(s) : 0;
      if (d < bestD) { bestD = d; best = s; }
      if (!this._spotTaken(s, cust) && d < bestFreeD) { bestFreeD = d; bestFree = s; }
    }
    return bestFree || best || slot.browsePos;
  },

  // Position in the counter queue (0 = at the head, being served). Everyone
  // who's committed to a haggle — buyers wanting an item, sellers with an
  // offer, and whoever's mid-deal — shares one line, ordered by ticket number
  // so nobody jumps the queue and the rest shuffle up as the head is served.
  _queueIndexOf(cust) {
    const q = this.customers
      .filter((o) => o.queueOrder != null &&
        (o.state === "want" || o.state === "offer" || o.state === "haggling"))
      .sort((a, b) => a.queueOrder - b.queueOrder);
    return q.indexOf(cust);
  },

  // Pick a stocked slot this shopper hasn't inspected yet.
  // null = nothing left to see (decide); undefined = all taken (mill around).
  _pickBrowseSlot(cust) {
    const unseen = this.slots.filter((s) => s.item && !cust.seen.has(this.slots.indexOf(s)));
    if (!unseen.length) return null;
    const free = unseen.filter((s) => !this._slotBusy(s, cust));
    return free.length ? pick(rng(Math.random() * 1e9), free) : undefined;
  },

  // How much this shopper fancies a given item. Three pulls stack on top of the
  // item's base value: the archetype's wealth lean (richer folk are drawn to
  // pricier goods), the personality's taste for this *kind* of thing (see
  // itemKind + PERSONALITIES.taste — a Jock covets weapons, the Lazy want food),
  // and their lean toward cheap or costly tiers. A dose of personal-taste noise
  // keeps two same-personality shoppers from always fancying the exact same item.
  _appeal(cust, slot) {
    const item = ITEMS[slot.item];
    const taste = personalityTaste(cust.npc);
    const kindMul = taste.kinds[itemKind(item)] ?? 1;
    // tierLean > 0 pulls toward rare/costly (tier 4), < 0 toward cheap (tier 1)
    const tierMul = clamp(1 + taste.tierLean * (item.tier - 2.5) * 0.18, 0.4, 1.9);
    return item.base * (0.5 + cust.arch.hi * 0.3) * kindMul * tierMul * (0.6 + Math.random() * 0.8);
  },

  // Done browsing: maybe make an offer on their favourite, maybe just wander off.
  _decide(cust) {
    // The FTUE's scripted first shopper must always leave with something — a
    // brand-new player watches their first sale simply land. Fully deterministic
    // (no RNG at all): if browsing scored nothing (e.g. they reached the counter
    // before lingering at the table), fall back to the first stocked slot, and
    // always take the plain-table sticker sale rather than a haggle they'd have
    // to win. This is what keeps the sell step from ever soft-locking.
    if (cust.scripted) {
      const fav = (cust.favorite && cust.favorite.item)
        ? cust.favorite
        : this.slots.find((s) => s.item && !s.disabled);
      if (fav) {
        cust.slot = fav;
        cust.favorite = fav;
        cust._boughtLoved = _lovesKind(cust.npc, fav.item);
        cust.maxPay = ITEMS[fav.item].base; // full sticker; only used if a haggle ever opens
        cust.t = 0;
        this.game.net.send({ t: "custWant", id: cust.id, slotIdx: this.slots.indexOf(fav), maxPay: cust.maxPay });
        cust.state = "autobuy";
        cust.ready = false;
        cust.buySpot = this._browseSpotFor(cust, fav);
        cust._payT = 0.5;
        cust.emote = this.game.hud.emote(cust.creature, "moneyfly", 999);
        return;
      }
    }
    const fav = cust.favorite;
    if (fav && fav.item && Math.random() < cust.arch.buy) {
      cust.slot = fav;
      const base = ITEMS[fav.item].base;
      cust.maxPay = Math.round(base * (cust.arch.lo + Math.random() * (cust.arch.hi - cust.arch.lo)));
      // did their favourite land squarely in their wheelhouse? decides whether,
      // once the sale actually closes, they gush ("loved it") or shrug ("a whim")
      cust._boughtLoved = _lovesKind(cust.npc, fav.item);
      cust.t = 0;
      this.game.net.send({ t: "custWant", id: cust.id, slotIdx: this.slots.indexOf(fav), maxPay: cust.maxPay });
      if (fav.fancy) {
        // the velvet table: a proper haggle for the best price. They grab a
        // ticket and join the counter queue — the deal opens once they reach
        // the head of the line, not the instant they decide.
        cust.state = "want";
        cust.ready = false;
        cust.queueOrder = ++this._queueSeq;
        cust.emote = this.game.hud.emote(cust.creature, "alert", 999);
        this.game.audio.haggle();
      } else {
        // a plain table: they'll amble over and pay full sticker price, no haggle
        cust.state = "autobuy";
        cust.ready = false;
        cust.buySpot = this._browseSpotFor(cust, fav);
        cust._payT = 0.5;
        cust.emote = this.game.hud.emote(cust.creature, "moneyfly", 999);
      }
    } else {
      // browsed but not sold on anything — shrug and head out. They'll remember
      // why for next time: a favourite they balked at (passedPricey) vs nothing
      // that caught their eye at all (passedMeh).
      if (fav) this.game.hud.emote(cust.creature, pick(rng(cust.seed + cust.visited), ["faceThink", "faceNeutral", "faceRoll", "thought"]), 1.4);
      this.game.recordNpcReflection?.(cust.npc, fav && fav.item ? "passedPricey" : "passedMeh", fav?.item);
      cust.state = "leave";
      cust._atDoor = false;
      cust.t = 0;
    }
  },

  // ---------------------------------------------------- guest-side mirrors
  mirrorCustomerAdd(m) {
    const npc = npcById(m.npcId) || npcByVariant(variantForSeed(m.seed)) || CROWD_NPCS[0];
    this._npcInUse.add(npc.variant);
    const creature = makeCustomerBody(npc, m.seed);
    creature.position.set(m.x, 0, m.z);
    this.group.add(creature);
    this.customers.push({
      id: m.id,
      seed: m.seed,
      npc,
      creature,
      slot: null, // set when the host says they want something (custWant)
      arch: ARCHETYPES[m.archIdx] ?? ARCHETYPES[1],
      mode: m.mode ?? "buy",
      sellItem: m.sellItem ?? null,
      minSell: m.minSell ?? 0,
      maxPay: 0,
      strikes: 0,
      state: "enter",
      t: 0,
      emote: null,
      _target: { x: m.x, z: m.z, h: 0 },
    });
    this._sayArrival(creature, npc, m.seed);
  },

  // Host told us which item this shopper settled on — needed so the guest can
  // run the haggle sheet locally.
  mirrorCustomerWant(m) {
    const cust = this.customers.find((c) => c.id === m.id);
    if (!cust) return;
    cust.slot = this.slots[m.slotIdx] ?? null;
    cust.maxPay = m.maxPay;
  },

  mirrorCustomerSnap(list) {
    for (const [id, seed, x, z, h, state] of list) {
      const cust = this.customers.find((c) => c.id === id);
      if (!cust) continue;
      cust._target = { x, z, h };
      if (state !== cust.state && cust.state !== "haggling") {
        cust.state = state;
        if (state === "want" && !cust.emote) cust.emote = this.game.hud.emote(cust.creature, "alert", 999);
        if (state === "offer" && !cust.emote) cust.emote = this.game.hud.emote(cust.creature, "moneyfly", 999);
        if (state !== "want" && state !== "offer") this._clearEmote(cust);
        if (state === "happy") cust.creature.animator.squash.kick(6);
      }
    }
    for (const cust of this.customers) {
      if (!cust._target) continue;
      const c = cust.creature;
      c.position.x += (cust._target.x - c.position.x) * 0.2;
      c.position.z += (cust._target.z - c.position.z) * 0.2;
      c.heading = cust._target.h;
    }
  },

  mirrorCustomerDel(id) {
    const cust = this.customers.find((c) => c.id === id);
    if (cust) this._removeCustomer(cust);
  },

  mirrorCustomerState(m) {
    const cust = this.customers.find((c) => c.id === m.id);
    if (cust) {
      cust.state = m.state;
      cust.t = 0;
      this._clearEmote(cust);
    }
  },

  _updateCustomer(cust, dt, elapsed) {
    const c = cust.creature;
    const game = this.game;
    if (cust.chatting) {
      // paused mid-errand for a chat with the player — face them and idle
      const pp = game.player.position;
      c.heading = Math.atan2(pp.x - c.position.x, pp.z - c.position.z);
      c.update(dt, elapsed);
      return;
    }
    cust.t += dt;

    // Path-following walk: route around obstacles via the nav grid, stepping
    // from waypoint to waypoint. Falls back to a straight line (+collision
    // slide) when no grid path applies — e.g. out on the open street.
    const walkTo = (target, speed = 1.9) => {
      const key = target.x.toFixed(2) + "," + target.z.toFixed(2);
      if (cust._navKey !== key) {
        cust._navKey = key;
        cust._path = this._findPath(c.position, target);
        cust._navI = 0;
      }
      const path = cust._path;
      let wp = target;
      if (path && path.length) {
        while (
          cust._navI < path.length - 1 &&
          _d.set(path[cust._navI].x - c.position.x, 0, path[cust._navI].z - c.position.z).length() < 0.3
        ) {
          cust._navI++;
        }
        wp = path[Math.min(cust._navI, path.length - 1)];
      }
      const toFinal = Math.hypot(target.x - c.position.x, target.z - c.position.z);
      if (toFinal <= 0.12) return true;
      cust._goalDist = toFinal; // watched below to catch a shopper making no headway
      _d.set(wp.x - c.position.x, 0, wp.z - c.position.z);
      const step = _d.length();
      if (step > 1e-4) {
        _d.normalize();
        c.position.addScaledVector(_d, Math.min(speed * (cust._speedMul || 1) * dt, step));
        c.heading = Math.atan2(_d.x, _d.z);
        cust._triedMove = true; // for the stuck watchdog below
      }
      return false;
    };
    cust._triedMove = false;
    // shop customers go about their errand at a steady pace — they don't slow to
    // an amble or turn to face the player as they pass (that curious beat is for
    // the ambient street crowd only, see _updatePassersby)
    cust._speedMul = NPC_WALK_MUL;

    const faceSlot = (slot) =>
      (c.heading = Math.atan2(slot.pos.x - c.position.x, slot.pos.z - c.position.z));

    switch (cust.state) {
      case "street": {
        // hustle along the pavement to the doorstep, in full view outside
        if (walkTo(this.doorPos, 2.7)) {
          cust.state = "enter";
          cust.t = 0;
        }
        break;
      }
      case "enter": {
        // step in over the threshold, then either browse (buyers) or wander to
        // an open spot and flag down the shopkeeper to sell (sellers)
        if (walkTo(this.doorInside, 2.4)) {
          cust.state = cust.mode === "sell" ? "offer" : "roam";
          cust.t = 0;
          if (cust.mode === "sell") {
            cust.ready = false; // must reach the head of the counter queue first
            cust.queueOrder = ++this._queueSeq;
            if (!cust.emote) cust.emote = game.hud.emote(c, "moneyfly", 999);
          }
        }
        break;
      }
      case "roam": {
        // choose the next item to go inspect (or decide if there's nothing new)
        const slot = this._pickBrowseSlot(cust);
        if (slot === null) {
          this._decide(cust);
        } else if (slot === undefined) {
          // every unseen table has a shopper at it — drift to an open spot,
          // idle a beat, then look again once a table frees up
          cust.millSpot = { x: (Math.random() - 0.5) * 4, z: 0.6 + Math.random() * 2.4 };
          cust.state = "mill";
          cust.t = 0;
        } else {
          cust.target = slot;
          cust.browseSpot = this._browseSpotFor(cust, slot);
          cust.seen.add(this.slots.indexOf(slot));
          cust.state = "goto";
        }
        break;
      }
      case "mill": {
        walkTo(cust.millSpot, 1.7);
        if (cust.t > 0.7) {
          cust.state = "roam";
          cust.t = 0;
        }
        break;
      }
      case "goto": {
        const tgt = cust.target;
        if (!tgt || !tgt.item) {
          cust.state = "roam"; // item vanished — look for another
        } else if (walkTo(cust.browseSpot || tgt.browsePos, 2.7)) {
          cust.state = "look";
          cust.t = 0;
          cust.lookT = 0.7 + Math.random() * 1.2; // linger a beat
        }
        break;
      }
      case "look": {
        const tgt = cust.target;
        if (!tgt || !tgt.item) {
          cust.state = "roam";
          break;
        }
        faceSlot(tgt);
        if (cust.t > cust.lookT) {
          cust.visited++;
          const score = this._appeal(cust, tgt);
          if (score > cust.favScore) {
            cust.favScore = score;
            cust.favorite = tgt;
          }
          if (cust.visited >= cust.toVisit) this._decide(cust);
          else {
            cust.state = "roam";
            cust.t = 0;
          }
        }
        break;
      }
      case "want": {
        // queue up at the counter and shuffle forward as it clears; the one at
        // the head is ready to haggle. Lose patience if the wait drags on.
        const slot = cust.slot;
        if (!slot || !slot.item) {
          this._clearEmote(cust);
          cust.state = "leave";
          cust._atDoor = false;
        } else {
          if (cust.queueOrder == null) cust.queueOrder = ++this._queueSeq;
          const idx = this._queueIndexOf(cust);
          const spot = this.queueSpots[Math.min(idx, this.queueSpots.length - 1)];
          const arrived = walkTo(spot, 2.4);
          if (arrived) c.heading = Math.PI / 2; // face the counter
          cust.ready = arrived && idx === 0; // only the head can be served
          if (cust.t > cust.patience) {
            this._clearEmote(cust);
            game.hud.emote(c, "anger", 1.5);
            // waited for their pick but the queue never cleared — they wanted it
            game.recordNpcReflection?.(cust.npc, "passedPricey", slot.item);
            cust.state = "leave";
            cust._atDoor = false;
          }
        }
        break;
      }
      case "autobuy": {
        // a plain-table buyer: stroll to their pick, then it rings up on its
        // own at full sticker price (100%) — no haggling, no player input.
        const slot = cust.slot;
        if (!slot || !slot.item) {
          this._clearEmote(cust);
          cust.state = "leave";
          cust._atDoor = false;
          break;
        }
        // Head for their nearest chosen spot, but let the sale ring up the
        // moment they've reached ANY side of the table — the standing spots
        // ring it (see browseSpots), so a shopper buys from wherever they walk
        // up rather than having to squeeze onto one exact face.
        const spot = cust.buySpot || (cust.buySpot = this._browseSpotFor(cust, slot));
        const spots = slot.browseSpots || [slot.browsePos];
        const atTable = spots.some((s) => Math.hypot(s.x - c.position.x, s.z - c.position.z) < 0.6);
        if (!atTable && !walkTo(spot, 2.6)) break; // still walking up to the table
        faceSlot(slot);
        cust._payT -= dt;
        if (cust._payT <= 0) {
          this._clearEmote(cust);
          this.game._autoSell(cust, slot);
        }
        break;
      }
      case "offer": {
        // a seller: queue at the counter like the buyers do and wait their turn
        // to be haggled with; if the wait drags on, they take their goods and go.
        if (cust.queueOrder == null) cust.queueOrder = ++this._queueSeq;
        const idx = this._queueIndexOf(cust);
        const spot = this.queueSpots[Math.min(idx, this.queueSpots.length - 1)];
        const arrived = walkTo(spot);
        if (arrived) c.heading = Math.PI / 2; // face the counter
        cust.ready = arrived && idx === 0; // only the head can be served
        if (cust.t > cust.patience) {
          this._clearEmote(cust);
          game.hud.emote(c, "anger", 1.5);
          cust.state = "leave";
          cust._atDoor = false;
        }
        break;
      }
      case "haggling":
        break; // frozen while the sheet is open
      case "happy": {
        // little joy hop then leave
        if (cust.t > 1.1) {
          cust.state = "leave";
          cust._atDoor = false;
        }
        break;
      }
      case "leave": {
        // out through the door, then off down the street before despawning
        if (!cust._atDoor) {
          if (walkTo(this.doorInside, 2.2)) cust._atDoor = true;
        } else if (!cust._outside) {
          if (walkTo(this.doorPos, 2.4)) {
            cust._outside = true;
            // The FTUE's first shopper doesn't just vanish once they've bought:
            // they step back out and fold into the ambient crowd, so the very
            // person the player just served stays on to wander the town.
            if (cust.scripted) { this._convertCustomerToPasserby(cust); return; }
          }
        } else if (walkTo(cust.exitPoint, 1.8)) {
          this._removeCustomer(cust);
          return;
        }
        break;
      }
    }
    // Stuck watchdog: if a shopper who's trying to walk isn't getting any closer
    // to their goal — wedged on a table, a wall, or another shopper — first
    // recompute the route, then sidestep to slip free, and finally just head for
    // the door. Nobody ever freezes on the floor. Counter-queue waits (standing
    // still on purpose) never trip it, since they're not trying to move.
    if (cust._triedMove && cust._prevGoalDist != null && cust._goalDist > cust._prevGoalDist - 0.008) {
      cust._stuckT = (cust._stuckT || 0) + dt;
    } else {
      cust._stuckT = 0;
      cust._stuckSide = 0;
    }
    cust._prevGoalDist = cust._triedMove ? cust._goalDist : null;
    if (cust._stuckT > 0.6) cust._navKey = null; // force a fresh path next frame
    if (cust._stuckT > 1.2) {
      // shuffle sideways off the obstacle so the collision slide can round it
      if (!cust._stuckSide) cust._stuckSide = Math.random() < 0.5 ? 1 : -1;
      const a = c.heading + cust._stuckSide * Math.PI / 2;
      c.position.x += Math.sin(a) * 2.2 * dt;
      c.position.z += Math.cos(a) * 2.2 * dt;
    }
    if (cust._stuckT > 5 && cust.state !== "want" && cust.state !== "offer" && cust.state !== "haggling") {
      // give up on whatever they were doing and leave — better a clean exit
      // than a statue on the shop floor
      cust.state = "leave";
      cust._atDoor = false;
      cust._outside = false;
      cust._stuckT = 0;
      cust._stuckSide = 0;
      cust._navKey = null;
    }

    // slide around tables & furniture instead of walking through them
    game.collide(c.position, c.radius * 0.8, this.colliders);
    c.update(dt, elapsed);
    game.net.trackCustomer(cust);
  },

  _clearEmote(cust) {
    if (cust.emote) {
      this.game.hud.removeEmote(cust.emote);
      cust.emote = null;
    }
  },

  _removeCustomer(cust) {
    this._clearEmote(cust);
    this._freeNpc(cust.npc);
    cust.creature.dispose();
    this.customers = this.customers.filter((x) => x !== cust);
    this.game.net.send({ t: "custDel", id: cust.id });
  },

  // Retire a shopper from the counter sim but keep their body on its feet,
  // handing it straight to the ambient crowd as a stroller. Used for the FTUE's
  // first customer, who lingers to wander the town after their purchase instead
  // of walking off and despawning. The skin stays marked in-use (same body), so
  // it's simply moved between systems, never freed and re-allocated.
  _convertCustomerToPasserby(cust) {
    this._clearEmote(cust);
    this.customers = this.customers.filter((x) => x !== cust);
    this.game.net.send({ t: "custDel", id: cust.id });
    const R = this.streetRegion;
    const p = {
      creature: cust.creature,
      npc: cust.npc,
      seed: cust.seed, // carried over if they're later recruited back in
      speed: 1.0 + Math.random() * 0.9,
      curSpeed: 0,
      life: 14 + Math.random() * 12, // a good long amble before they head off
      pause: 0,
      exitX: R.maxAlong + 5, // past the despawn line, so they walk clean off (see _spawnPasserby)
      exitZ: R.minCross + Math.random() * (R.maxCross - R.minCross),
      tx: 0, tz: 0,
    };
    this._pickPasserTarget(p);
    this.passersby.push(p);
  },

  /** The customer at the head of the counter queue, waiting to be served — a
   *  buyer wanting an item or a seller with an offer. Only the one at the head
   *  of the line (and settled at the front spot) is flagged `ready`, so this
   *  hands back whoever the shopkeeper should deal with next, or null. */
  counterCustomer() {
    for (const cust of this.customers) {
      if (!cust.ready) continue;
      if (cust.state === "want" && cust.slot?.item) return cust;
      if (cust.state === "offer" && cust.sellItem) return cust;
    }
    return null;
  },
};

// A Kenney blocky body for a named townsperson. The skin comes from the NPC's
// fixed `variant`; `seed` still seeds a little height variety so repeat visits
// (and host/guest) render the same build. Their name shows when you talk to
// them, not on a floating plate.
function makeCustomerBody(npc, seed) {
  const variant = HARD_SEED != null ? variantForSeed(HARD_SEED) : npc.variant;
  const r = rng(seed * 104729 + 11);
  return new BlockyCreature(variant, {
    height: 1.05 + r() * 0.35,
    turnRate: NPC_TURN_RATE,
    animScale: NPC_ANIM_SCALE,
  });
}
