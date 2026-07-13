// Customer simulation: the flow that trickles shoppers in, walks them around
// the floor browsing, queues them at the counter, and — for co-op guests —
// mirrors the host's crowd. Also the ambient street passers-by. Split out of
// shop.js as prototype methods (mixed onto Shop via Object.assign) so they keep
// using `this` unchanged.
import * as THREE from "three";
import { BlockyCreature, variantForSeed, HARD_SEED } from "../chargen/blocky.js";
import { ITEMS, LOOT_BY_TIER } from "./items.js";
import { rng, pick, clamp } from "../core/engine.js";
import { ARCHETYPES, SELLER_CHANCE, MAX_CUSTOMERS } from "./shop-data.js";

const _d = new THREE.Vector3();

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
    this._spawnCustomer();
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
    const creature = new BlockyCreature(variantForSeed(seed), { height: 1.5 });
    creature.position.set(-this.streetHalfX, 0, this.streetWalkZ);
    creature.heading = Math.PI / 2;
    this.group.add(creature);
    const cust = {
      id: game.net.newId(),
      seed,
      creature,
      arch: ARCHETYPES[1] || ARCHETYPES[0],
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
      exitPoint: new THREE.Vector3(-this.streetHalfX, 0, this.streetWalkZ),
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    return cust;
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
      if (this._passerT <= 0 && this.passersby.length < 5) {
        this._passerT = 1.6 + Math.random() * 3;
        this._spawnPasserby();
      }
    }
    for (const p of [...this.passersby]) {
      const c = p.creature;
      p.life -= dt;
      if (p.pause > 0) {
        p.pause -= dt; // loitering — stand still but keep the idle anim ticking
      } else {
        const dx = p.tx - c.position.x, dz = p.tz - c.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.35) {
          // reached the waypoint: dawdle, then pick the next spot (or head off
          // the edge once this stroller's time is up)
          if (p.life <= 0) { p.tx = p.exitX; p.tz = p.exitZ; p.life = -1e9; p.pause = 0; }
          else { this._pickPasserTarget(p); p.pause = Math.random() < 0.4 ? 0.6 + Math.random() * 1.4 : 0; }
        } else {
          c.position.x += (dx / d) * p.speed * dt;
          c.position.z += (dz / d) * p.speed * dt;
          c.heading = Math.atan2(dx, dz);
        }
      }
      c.update(dt, elapsed);
      // retire once they've reached the exit point beyond the street edge
      if (p.life <= -1e8 && Math.abs(c.position.x) > this.streetRegion.xMax + 2.5) {
        c.dispose();
        this.passersby = this.passersby.filter((x) => x !== p);
      }
    }
  },

  // Roll a fresh waypoint out on the open road for a stroller: anywhere across
  // the full width and depth of the road/pavement (which sits in front of the
  // buildings, so a straight stroll between waypoints never clips a wall).
  _pickPasserTarget(p) {
    const R = this.streetRegion;
    p.tx = (Math.random() - 0.5) * 2 * R.xMax;
    p.tz = R.farZ + Math.random() * (R.nearZ - R.farZ);
  },

  _spawnPasserby() {
    const R = this.streetRegion;
    const dir = Math.random() < 0.5 ? 1 : -1; // which edge they walk in from
    const creature = makeCustomerBody(Math.floor(Math.random() * 1e6));
    const span = R.xMax + 2.5;
    creature.position.set(-dir * span, 0, R.farZ + Math.random() * (R.nearZ - R.farZ));
    creature.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.group.add(creature);
    const p = {
      creature,
      speed: 1.0 + Math.random() * 0.9,
      life: 10 + Math.random() * 14, // seconds of milling before they head off
      pause: 0,
      exitX: dir * span, // where they leave once done
      exitZ: R.farZ + Math.random() * (R.nearZ - R.farZ),
      tx: 0, tz: 0,
    };
    this._pickPasserTarget(p);
    this.passersby.push(p);
  },

  _spawnCustomer() {
    const game = this.game;
    const seed = pick(rng(Math.random() * 1e9), this._custSeedPool) + Math.floor(Math.random() * 4) * 100;
    const creature = makeCustomerBody(seed);
    // arrive from one end of the street and stroll toward the door
    const side = Math.random() < 0.5 ? -1 : 1;
    creature.position.set(side * this.streetHalfX, 0, this.streetWalkZ + (Math.random() - 0.5) * 0.5);
    creature.heading = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.group.add(creature);

    // weighted archetype. Restored houses add residents who shop here: each
    // bumps their archetype's odds, so a livelier town draws wealthier, rarer
    // clientele into rotation on top of the passing baseline crowd.
    const bag = [];
    for (const a of ARCHETYPES) for (let i = 0; i < a.w; i++) bag.push(a);
    for (const idx of this.game.townResidents || []) {
      const a = ARCHETYPES[idx];
      if (a) for (let i = 0; i < 3; i++) bag.push(a);
    }
    const arch = bag[Math.floor(Math.random() * bag.length)];

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
      exitPoint: new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * this.streetHalfX, 0, this.streetWalkZ),
      emote: null,
    };
    this.customers.push(cust);
    game.audio.doorbell();
    game.net.send({
      t: "custAdd",
      id: cust.id, seed,
      x: creature.position.x, z: creature.position.z,
      archIdx: ARCHETYPES.indexOf(arch),
      mode, sellItem, minSell,
    });
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

  // Choose which side of an item's table a shopper should stand at. Rather than
  // always crowding the front (which can wall a customer off behind a table),
  // pick the reachable spot closest to where they're standing now — so someone
  // coming from the door views it from the near side instead of squeezing past.
  _browseSpotFor(cust, slot) {
    const spots = slot.browseSpots || [slot.browsePos];
    const from = cust.creature?.position || cust.creature?.group?.position;
    let best = null, bestD = Infinity;
    for (const s of spots) {
      if (this._spotBlocked(s)) continue;
      const d = from ? from.distanceToSquared(s) : 0;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best || slot.browsePos;
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

  // How much this shopper fancies a given item — pricier goods tug harder at
  // wealthier archetypes, with a dose of personal-taste noise.
  _appeal(cust, slot) {
    const base = ITEMS[slot.item].base;
    return base * (0.5 + cust.arch.hi * 0.3) * (0.6 + Math.random() * 0.8);
  },

  // Done browsing: maybe make an offer on their favourite, maybe just wander off.
  _decide(cust) {
    const fav = cust.favorite;
    // FTUE: on the tutorial's sell step every shopper must actually commit, so a
    // brand-new player is always handed a haggle to win instead of watching the
    // rush browse and wander off — skip the usual "maybe they just leave" roll.
    const mustBuy = this.game.tutorial === "sell";
    if (fav && fav.item && (mustBuy || Math.random() < cust.arch.buy)) {
      cust.slot = fav;
      const base = ITEMS[fav.item].base;
      cust.maxPay = Math.round(base * (cust.arch.lo + Math.random() * (cust.arch.hi - cust.arch.lo)));
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
      // browsed but not sold on anything — shrug and head out
      if (fav) this.game.hud.emote(cust.creature, pick(rng(cust.seed + cust.visited), ["faceThink", "faceNeutral", "faceRoll", "thought"]), 1.4);
      cust.state = "leave";
      cust._atDoor = false;
      cust.t = 0;
    }
  },

  // ---------------------------------------------------- guest-side mirrors
  mirrorCustomerAdd(m) {
    const creature = makeCustomerBody(m.seed);
    creature.position.set(m.x, 0, m.z);
    this.group.add(creature);
    this.customers.push({
      id: m.id,
      seed: m.seed,
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
      _d.set(wp.x - c.position.x, 0, wp.z - c.position.z);
      const step = _d.length();
      if (step > 1e-4) {
        _d.normalize();
        c.position.addScaledVector(_d, Math.min(speed * dt, step));
        c.heading = Math.atan2(_d.x, _d.z);
      }
      return false;
    };

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
        if (walkTo(cust.buySpot || (cust.buySpot = this._browseSpotFor(cust, slot)), 2.6)) {
          faceSlot(slot);
          cust._payT -= dt;
          if (cust._payT <= 0) {
            this._clearEmote(cust);
            this.game._autoSell(cust, slot);
          }
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
          if (walkTo(this.doorPos, 2.4)) cust._outside = true;
        } else if (walkTo(cust.exitPoint, 1.8)) {
          this._removeCustomer(cust);
          return;
        }
        break;
      }
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
    cust.creature.dispose();
    this.customers = this.customers.filter((x) => x !== cust);
    this.game.net.send({ t: "custDel", id: cust.id });
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

// A Kenney blocky customer, deterministically varied by seed so host + guest
// (and repeat visits) render the same person.
function makeCustomerBody(seed) {
  if (HARD_SEED != null) seed = HARD_SEED;
  const r = rng(seed * 104729 + 11);
  return new BlockyCreature(variantForSeed(seed), { height: 1.05 + r() * 0.35 });
}
