// The shop economy: the wallet, dungeon pickups, stocking/unstocking the
// storeroom, the haggle callbacks (sell + buy), sale/buy juice, and the
// town restoration purchases. Attached to Game.prototype via Object.assign, so
// `this` is the live Game instance.
import * as THREE from "three";
import { icon, itemIcon } from "../core/icons.js";
import { ITEMS } from "./items.js";
import { ARCHETYPES } from "./shop.js";
import { builderGoRepair } from "./builder.js";
import { track } from "../core/analytics.js";

// per-call scratch vectors (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const economyMethods = {
  gainGold(amount, pos = null) {
    // the ring's fortune bonus rounds up on every windfall
    if (this.stats.goldMul > 1) amount = Math.round(amount * this.stats.goldMul);
    this.gold += amount;
    this.hud.setGold(this.gold);
    if (pos) {
      const wp = _v2.copy(pos); // world coords
      this.particles.burst(wp.setY(wp.y + 0.6), { color: 0xffd34d, n: Math.min(4 + amount / 4, 14), speed: 2, life: 0.7 });
      this.hud.float(wp, `+${amount}g`, "gold");
    }
    // NB: coin sounds now cascade from the flying-coin landings (see _saleJuice)
    this._syncState();
  },

  // Pay out gold (buying stock from a customer). Host-authoritative like the
  // rest of the wallet; guests see the new total echoed back via "state".
  _spendGold(amount, pos = null) {
    this.gold = Math.max(0, this.gold - amount);
    this.hud.setGold(this.gold);
    if (pos) {
      this.hud.float(_v2.copy(pos).setY(pos.y + 1.4), `-${amount}g`, "dmg");
      // coins peel off the gold counter and fly out toward whatever's being
      // bought, ticking a coin sound as each lands (mirrors the sale cascade)
      const coins = 5 + Math.min(11, Math.floor(amount / 20));
      this.hud.spendCoins(_v2.copy(pos).setY(pos.y + 1.0), coins, (i) => this.audio.coin(i % 6));
    }
    this._syncState();
  },

  _pickupDrop(drop) {
    if (this.inventory.length >= this.invCap) {
      if (!this._bagFullT || performance.now() - this._bagFullT > 2000) {
        this.hud.bagFull();
        this._bagFullT = performance.now();
      }
      return;
    }
    this.dungeon.takeDrop(drop);
    this.today.looted++;
    this.audio.pickup();
    if (this.net.isGuest) {
      this.net.send({ t: "take", id: drop.id });
    } else {
      this.inventory.push(drop.item);
      this._syncInv();
      this.net.send({ t: "dropTake", id: drop.id });
    }
    const it = ITEMS[drop.item];
    this.hud.float(_v.copy(drop.mesh.position).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
    // the loot flies across the screen into the backpack
    this.hud.flyToBag(_v.copy(drop.mesh.position).setY(0.8), itemIcon(it.icon));
    this._tutAdvance("loot");
    this._refreshBagIfOpen(); // magneted in while the bag's open — keep the list live
    this._save();
  },

  // Pocket a piece of meadow forage off the ground. Kept separate from
  // _pickupDrop (which is bound to the dungeon's synced drop list): forage is
  // scattered client-side out in the fields, so the grab is resolved locally —
  // it drops into the bag and syncs the bag onward like any other change.
  _pickupForage(drop) {
    if (this.inventory.length >= this.invCap) {
      if (!this._bagFullT || performance.now() - this._bagFullT > 2000) {
        this.hud.bagFull();
        this._bagFullT = performance.now();
      }
      return;
    }
    this.shop.takeForageDrop(drop);
    if (this.today) this.today.looted++;
    this.audio.pickup();
    this.inventory.push(drop.item);
    this._syncInv();
    const it = ITEMS[drop.item];
    this.hud.float(_v.copy(drop.mesh.position).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
    this.hud.flyToBag(_v.copy(drop.mesh.position).setY(0.8), itemIcon(it.icon));
    this._refreshBagIfOpen(); // pocketed while the bag's open — keep the list live
    this._save();
  },

  // Floating "picked up X" label at a drop's spot — used to surface the co-op
  // partner's grabs on the local screen (the picker sees their own via
  // _pickupDrop). Skipped if the drop is in a different area than us.
  _floatPickup(drop) {
    if (this.playerArea !== "dungeon") return;
    const it = ITEMS[drop.item];
    if (!it) return;
    this.hud.float(_v.copy(drop.mesh.position).setY(1.2), `${itemIcon(it.icon)} ${it.name}`, "loot");
  },

  _openChest(chest) {
    this.audio.chest();
    if (this.net.isGuest) {
      chest.opened = true;
      chest.mesh.children[1].rotation.x = -1.9;
      if (this.dungeon.tutorial) this.dungeon.revealStairs();
      this.net.send({ t: "chestReq", id: chest.id });
      return;
    }
    this.dungeon.openChest(chest);
    this.net.send({ t: "chest", id: chest.id });
    this.engine.shake(0.15);
  },

  _stockFromStash(idx, slotIdx = -1) {
    if (this.playerArea !== "shop") return this.hud.toast("You can only stock in the shop.");
    const itemId = this.stash[idx];
    if (itemId == null) return;
    if (this.net.isGuest) {
      this.net.send({ t: "stockReq", idx, slotIdx });
      return;
    }
    const slot = slotIdx >= 0 ? this.shop.slots[slotIdx] : this.shop.freeSlot();
    if (!slot || slot.item || slot.disabled)
      return this.hud.toast(slotIdx >= 0 ? "That table is taken." : "All display slots are full.");
    this.stash.splice(idx, 1);
    this.shop.stockItem(itemId, slot);
    this.audio.pickup();
    this._tutAdvance("stock");
    this._syncInv();
    this._syncStock();
    this._save();
  },

  _unstock(slot) {
    if (this.net.isGuest) {
      const slotIdx = this.shop.slots.indexOf(slot);
      this.net.send({ t: "unstockReq", slotIdx });
      return;
    }
    const id = this.shop.unstockSlot(slot);
    if (id) {
      this.stash.push(id);
      this._syncInv();
      this._syncStock();
    }
  },

  // The bag's "Store" action: drop one carried item into the storeroom, from
  // where it can be stocked onto the tables. Shop-only; refreshes the open
  // backpack so the row vanishes in place.
  _storeItem(idx, srcBtn = null) {
    if (this.playerArea !== "shop") return;
    const id = this.inventory[idx];
    if (id == null) return;
    // grab the tapped row's icon before the sheet rebuilds, then fly it over to
    // the storeroom button so the hand-off is visible
    const srcEl = srcBtn?.closest(".bag-row")?.querySelector(".bag-face") || srcBtn;
    this.inventory.splice(idx, 1);
    this.stash.push(id);
    this.audio.pickup();
    if (this.net.isGuest) this.net.send({ t: "storeReq", idx });
    else { this._syncInv(); this._save(); }
    this.hud.flyItem(srcEl, "#store-btn", itemIcon(ITEMS[id].icon));
    if (this.hud.sheetOpen) this._openBagSheet();
  },

  // The storeroom's "Take" action: pull one item back out of the storeroom and
  // into the bag (to gear up or carry a supply down), refusing when the bag is
  // full. Refreshes the open storeroom sheet in place.
  _takeFromStore(idx, srcBtn = null) {
    if (this.playerArea !== "shop") return;
    const id = this.stash[idx];
    if (id == null) return;
    if (this.inventory.length >= this.invCap) return this.hud.bagFull();
    // grab the tapped row's icon before the sheet rebuilds, then fly it over to
    // the backpack button so the hand-off is visible
    const srcEl = srcBtn?.closest(".bag-row")?.querySelector(".bag-face") || srcBtn;
    this.stash.splice(idx, 1);
    this.inventory.push(id);
    this.audio.pickup();
    if (this.net.isGuest) this.net.send({ t: "takeReq", idx });
    else { this._syncInv(); this._save(); }
    this.hud.flyItem(srcEl, "#bag-btn", itemIcon(ITEMS[id].icon));
    if (this.hud.sheetOpen) this._openStoreSheet();
  },

  _haggle(cust) {
    // stepping up to the counter commits the shopkeeper to working the whole
    // line: once this deal closes, the next shopper's sheet opens on its own
    // (see the auto-serve pass in _updatePlayer) until the queue drains or the
    // player walks away from the counter.
    this._autoServe = true;
    this.audio.haggle();
    this.shop.startHaggle(cust, this.hud, this.audio, (sold, price, grade, item) => {
      if (this.net.isGuest) {
        this.net.send({ t: "sale", custId: cust.id, sold, price, grade });
        if (sold) this._saleJuice(price, grade, cust.creature.position);
        return;
      }
      this._resolveSale(cust, sold, price, grade);
    });
  },

  _resolveSale(cust, sold, price, grade) {
    // remember how this went for the shopper — a gushing "loved it" or a shrug
    // of a whim if it closed, a "wanted it but…" if the haggle fell through
    if (cust?.npc) {
      this.recordNpcReflection(cust.npc, sold ? (cust._boughtLoved ? "boughtLoved" : "boughtWhim") : "passedPricey", cust.slot?.item);
    }
    if (sold) {
      this.combo = grade === "perfect" ? this.combo + 1 : 0;
      this.today.sold++;
      this.today.earned += price;
      if (grade === "perfect") this.today.perfect++;
      this.today.bestCombo = Math.max(this.today.bestCombo, this.combo);
      this.gainGold(price, cust.creature.position);
      this._saleJuice(price, grade, cust.creature.position);
      this._tutAdvance("sell");
      this._syncStock();
      this._save();
      track("item_sold", { price, grade, combo: this.combo, haggled: true });
    } else {
      this.combo = 0;
      this.audio.deny();
      // the FTUE's scripted first shopper won't take no for an answer — put them
      // back at the head of the counter so the haggle simply reopens
      if (cust.scripted) { cust.state = "want"; cust.ready = true; cust.strikes = 0; cust.t = 0; }
    }
  },

  // A plain-table sale: no haggle, the shopper pays full sticker price (100% of
  // the item's value) and leaves happy. Driven by the host's shop sim, so the
  // wallet + stock stay authoritative; the combo streak is a haggle-only reward.
  _autoSell(cust, slot) {
    const item = ITEMS[slot.item];
    if (!item) return;
    const price = item.base;
    if (cust?.npc) this.recordNpcReflection(cust.npc, cust._boughtLoved ? "boughtLoved" : "boughtWhim", slot.item);
    this.shop.unstockSlot(slot);
    cust.state = "happy";
    cust.t = 0;
    cust.creature.animator.squash.kick(6);
    this.hud.emote(cust.creature, "faceSmile", 1.4);
    this.today.sold++;
    this.today.earned += price;
    this.gainGold(price, cust.creature.position);
    this._saleJuice(price, "good", cust.creature.position);
    this._tutAdvance("sell");
    this._syncStock();
    this._save();
    track("item_sold", { price, grade: "good", combo: 0, haggled: false });
  },

  _saleJuice(price, grade, pos) {
    // coins arc up to the gold counter, ticking a coin sound as each lands
    const coins = 5 + Math.min(11, Math.floor(price / 12));
    this.hud.flyCoins(_v.copy(pos).setY(1.0), coins, (i) => this.audio.coin(i % 6));
    if (grade === "perfect") {
      this.audio.perfect();
      this.hud.banner(`PERFECT DEAL! ${this.combo > 1 ? "x" + this.combo + " combo!" : ""}`, `${price}g — right at their limit`, 1.6);
      this.engine.shake(0.15);
      this.particles.burst(_v.copy(pos).setY(1.4), { color: 0xffe08a, n: 18, speed: 3.5, life: 0.9 });
    } else {
      this.audio.sale();
      this.hud.toast(`Sold for ${price}g!`);
    }
  },

  // ---- buying stock from a customer (the reverse haggle) -------------------
  _buyFrom(seller) {
    this._autoServe = true;
    this.audio.haggle();
    this.shop.startBuyHaggle(seller, this.hud, this.audio, (bought, price, grade, item) => {
      if (this.net.isGuest) {
        this.net.send({ t: "buy", custId: seller.id, bought, price, grade });
        if (bought) this._buyJuice(price, grade, seller.creature.position);
        return;
      }
      this._resolveBuy(seller, bought, price, grade, item);
    });
  },

  _resolveBuy(cust, bought, price, grade, item) {
    if (!bought) {
      this.audio.deny();
      return;
    }
    this.combo = 0; // buying stock doesn't feed the sell-combo
    this.today.bought++;
    this.today.spent += price;
    this._spendGold(price, cust.creature.position);
    this.stash.push(item.id); // bought stock goes straight to the storeroom
    this._syncInv();
    this._buyJuice(price, grade, cust.creature.position);
    this._save();
  },

  _buyJuice(price, grade, pos) {
    if (grade === "perfect") {
      this.audio.perfect();
      this.hud.banner("STEAL OF A DEAL!", `bought for ${price}g — a bargain`, 1.6);
      this.engine.shake(0.12);
      this.particles.burst(_v.copy(pos).setY(1.4), { color: 0x8fe0ff, n: 16, speed: 3.2, life: 0.8 });
    } else {
      this.audio.sale();
      this.hud.toast(`Bought for ${price}g`);
    }
  },

  // Set up the shop for a fresh session. No more day/night cycle — the shop is
  // always open for trade; the cellar stays open so you can delve any time.
  _beginShop(first = false) {
    this.hp = this.maxHp;
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(this.gold, false);

    if (first) {
      this.hud.banner(`${icon("shop")} COIN CELLAR`, "", 3);
      if (this.day === 1 && !this._hadSave && !this.net.connected) this._tutStart();
      // no FTUE (returning player / co-op): the cave's trapdoor was claimed
      // long ago — it boots already open
      if (!this.tutorial) this.cave.setTrapdoorOpen(true, true);
    }
    this.today = this._freshDayStats();
    this._syncState();
    this._save();
  },

  // Pay to repair display table `i`: a broken shelf (200g) or the fancy vitrine
  // (1000g) is dusted off and its slots open up for stock. Persisted; solo /
  // host only (guests don't run the shop).
  _repairTable(i) {
    if (this.net.isGuest) return this.hud.toast("Only the host runs the shop.");
    const table = this.shop.tables && this.shop.tables[i];
    if (!table || table.repaired) return;
    if (this.gold < table.cost) {
      this.audio.deny();
      return this.hud.toast(`${icon("coin")} Not enough gold — need ${table.cost}g`);
    }
    this._spendGold(table.cost, table.group.position);
    this.today.spent += table.cost;
    this.shop.repairTable(i);
    this.tablesRepaired[i] = true;
    this.hud.toast(`${icon("shop")} ${table.fancy ? "Vitrine" : "Shelf"} repaired!`);
    this._save();
    this._syncTables();
  },

  // ---- town restoration (the Mayor's project) -------------------------------
  // How many street lots have been rebuilt — read by the shop to quicken the
  // customer trickle as the town fills back out.
  townPop() {
    return this.townRestored.reduce((n, done) => n + (done ? 1 : 0), 0);
  },

  // Pay the Mayor's fund to rebuild street lot i: a run-down ruin or boarded-up
  // plot becomes a proper house and a new resident moves in — a distinct (often
  // wealthier) shopper who now frequents your counter. Persisted; solo only.
  _restoreLot(i) {
    if (this.net.isGuest) return this.hud.toast("Only the host runs the town.");
    const lot = this.shop.lots && this.shop.lots[i];
    if (!lot || lot.restored) return;
    if (this.gold < lot.cost) {
      this.audio.deny();
      return this.hud.toast(`${icon("coin")} Not enough gold — need ${lot.cost}g`);
    }
    this._spendGold(lot.cost, lot.interactPos);
    this.today.spent += lot.cost;
    this.shop.restoreLot(i);
    this.townRestored[i] = true;
    this.townResidents.push(lot.resident);
    const arch = ARCHETYPES[lot.resident];
    this.hud.banner(`${icon("home")} A new home!`,
      `a ${arch ? arch.name : "new"} family moves in`, 2.8);
    this._save();
    this._syncState();
    // rebuilding is the player's own call (no quest for it) — but the town's
    // first family is a moment, so the Mayor drops by with a word of praise
    if (this.townPop() === 1) this._mayorAfterRestore();
  },

  // Hire the town builder to raise the house on lot `i`: charge the fee up front
  // and send the foreman off to work (see builder.js). The gold + save happen
  // now (so a mid-build reload can't lose the payment — the finished house is
  // replayed instantly on load via townRestored), but the visible house is held
  // back until the foreman actually finishes hammering (_finishLotRestore).
  _dispatchBuilder(i) {
    if (this.net.isGuest) return this.hud.toast("Only the host runs the town.");
    const lot = this.shop.lots && this.shop.lots[i];
    const b = this.shop.builder;
    if (!lot || lot.restored || this.townRestored[i]) return;
    if (!b || b.state !== "idle") return this.hud.toast("The builder's already on a job.");
    if (this.gold < lot.cost) {
      this.audio.deny();
      return this.hud.toast(`${icon("coin")} Not enough gold — need ${lot.cost}g`);
    }
    this._spendGold(lot.cost, b.creature.position);
    this.today.spent += lot.cost;
    this.townRestored[i] = true;      // paid — the next offer skips to the next-cheapest
    this.townResidents.push(lot.resident);
    this._save();
    this._syncState();
    this.audio.pickup?.();
    this.hud.toast(`${icon("tools")} The builder heads out to raise it.`);
    builderGoRepair(this.shop, i);
  },

  // The foreman just finished a job: reveal the house and welcome the family.
  // Payment/persistence already happened in _dispatchBuilder, so this is the
  // purely visible half (and the one-time Mayor cameo on the first home).
  _finishLotRestore(i) {
    const lot = this.shop.lots && this.shop.lots[i];
    if (!lot || lot.restored) return;
    this.shop.restoreLot(i); // before→after swap + chest sound + shake
    this.particles.burst(_v.copy(lot.group.position).setY(1.1),
      { color: 0xffe6a3, n: 18, speed: 3.4, up: 2, gravity: 3, life: 0.7, size: 0.9 });
    const arch = ARCHETYPES[lot.resident];
    this.hud.banner(`${icon("home")} A new home!`,
      `a ${arch ? arch.name : "new"} family moves in`, 2.8);
    if (this.townPop() === 1) this._mayorAfterRestore();
  },
};
