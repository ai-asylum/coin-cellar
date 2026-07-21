// Inventory / gear paper-doll, friends & social sheets, and the dev admin
// panel. Attached to Game.prototype via Object.assign, so `this` is the Game.
import * as THREE from "three";
import { pick } from "../core/engine.js";
import { icon, itemIcon } from "../core/icons.js";
import { ITEMS } from "./items.js";
import { SLOTS, SLOT_META, equipInfo, canEquip } from "./gear.js";
import { MAX_DEPTH, DUNGEON_ORIGIN } from "./dungeon.js";
import { dayClockStops } from "./shop.js";
import { OCCASIONS, activeOccasion } from "./npc-data.js";
import { godraysEnabled, setGodraysEnabled } from "../core/godrays.js";
import { esc } from "./game-util.js";
import { NAME_KEY } from "./game-persistence.js";
import { ATTACK_MODES, COMBAT_SLIDERS, combat, attackMode, setCombatSettings, saveCombatSettings } from "./combat-settings.js";

// per-call scratch vector (duplicated from game.js — these are transient)
const _v = new THREE.Vector3();

// the real wall-clock hour as a 0–24 float, and a HH:MM label for a slider value
const _realHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
const _fmtHour = (h) => {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

// The real-date occasion in parentheses for the "Live" option, e.g. " (Easter)"
const _liveOccasionLabel = () => {
  const o = activeOccasion();
  return o ? ` (${o.label})` : "";
};

export const uiMethods = {
  // Storeroom items as a tappable grid (used by the place / replace menus).
  _stashRows() {
    return this.stash
      .map((id, i) => {
        const it = ITEMS[id];
        return `<button class="inv-item ti-${it.tier}" data-i="${i}">${itemIcon(it.icon)}<small>${it.name}</small><span>${it.base}g</span></button>`;
      })
      .join("");
  },

  // Shared backpack header + capacity meter for both bag views.
  _bagHead(subtitle) {
    const n = this.inventory.length, cap = this.invCap;
    const pct = cap ? Math.min(100, (n / cap) * 100) : 0;
    const full = n >= cap;
    return `
      <div class="bag-head">
        <span class="bag-emoji">${icon("bag")}</span>
        <div class="bag-title"><b>Backpack</b><small>${subtitle}</small></div>
        <button class="icon-btn" id="bag-close">${icon("close")}</button>
      </div>
      <div class="bag-cap${full ? " full" : ""}">
        <div class="bag-cap-bar"><span style="width:${pct}%"></span></div>
        <div class="bag-cap-num">${n}/${cap}</div>
      </div>`;
  },

  _toggleBag() {
    // The backpack opens anywhere (shop, cave lobby, delving) — it's always the
    // window into what you carry and what you've got equipped. In the shop you
    // also stock straight onto the tables via the context action.
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    this._openBag();
  },

  // -------------------------------------------------------------- gear sheet
  // The equip UI is a Minecraft-style paper-doll: three body slots up top
  // (weapon / chest / shield) and two below (ring / boots). It no longer has a
  // screen of its own — it's embedded in the pre-delve "Pack your bag" sheet
  // above ground and in the backpack sheet while delving. Each slot shows the
  // worn piece's icon, or an empty glyph; tapping one opens the per-slot picker.
  // Whether tapping a slot's cell would open a picker with anything actionable:
  // at least one matching piece to equip in the pool, or a worn piece we can
  // take off — including the weapon, which can now be stripped to fight bare-
  // handed when there's nothing better to swap in.
  _slotHasOptions(slot, source) {
    const pool = source === "inv" ? this.inventory : this.stash;
    for (const id of pool) {
      const eq = equipInfo(id);
      if (eq && eq.slot === slot && canEquip(id)) return true;
    }
    return !!this.equipment[slot];
  },

  _gearDollHTML(source) {
    const cell = (slot) => {
      const wornId = this.equipment[slot];
      const it = wornId && ITEMS[wornId];
      const ic = it ? `<span class="gear-cell-ic">${itemIcon(it.icon)}</span>`
        : `<span class="gear-cell-ic empty">${icon(SLOT_META[slot].icon)}</span>`;
      // Nothing to swap in and nothing to take off → there's no picker worth
      // opening, so lock the cell rather than showing an empty list.
      const locked = !this._slotHasOptions(slot, source);
      return `<button class="gear-cell${it ? " filled ti-" + it.tier : ""}${locked ? " locked" : ""}" data-slot="${slot}"${locked ? " disabled" : ""}>
        ${ic}
        <small>${SLOT_META[slot].name}</small>
        <span class="gear-cell-name">${it ? it.name : SLOT_META[slot].empty}</span>
      </button>`;
    };
    const top = SLOTS.filter((s) => SLOT_META[s].row === "top").map(cell).join("");
    const bottom = SLOTS.filter((s) => SLOT_META[s].row === "bottom").map(cell).join("");

    return `
      <div class="gear-doll">
        <div class="gear-row top">${top}</div>
        <div class="gear-row bottom">${bottom}</div>
      </div>`;
  },

  // Wire the slot buttons of an already-rendered paper-doll to open the per-slot
  // picker. `source` is "stash" (above ground: pieces come from / return to the
  // storeroom) or "inv" (delving: pieces come from / return to the bag).
  _wireGearDoll(el, source) {
    el.querySelectorAll(".gear-cell").forEach((b) => {
      b.onclick = () => this._openEquipPicker(b.dataset.slot, source);
    });
  },

  // Reopen whichever host sheet the paper-doll is embedded in — the pack menu
  // above ground, the backpack while delving.
  _reopenGearHost(source) {
    if (source === "inv") this._openBagSheet();
    else this._packMenu();
  },

  // The per-slot picker: every candidate piece that fits this slot, plus (for
  // non-weapon slots) an "unequip" option. Picking one swaps it in — the old
  // piece drops back into the pool (`source`). Candidates come from the
  // storeroom above ground, or the bag while delving.
  _openEquipPicker(slot, source) {
    const meta = SLOT_META[slot];
    const inDungeon = source === "inv";
    const pool = inDungeon ? this.inventory : this.stash;
    const wornId = this.equipment[slot];
    // gather matching pieces, remembering each one's index in the pool
    const seen = new Map(); // id -> { i, count } collapse duplicates to one row
    pool.forEach((id, i) => {
      const eq = equipInfo(id);
      if (!eq || eq.slot !== slot || !canEquip(id)) return; // only swords are equippable for now
      if (seen.has(id)) seen.get(id).count++;
      else seen.set(id, { i, count: 1 });
    });

    const rows = [];
    if (wornId) {
      // any slot can be stripped bare now — taking off the weapon just leaves
      // you fighting bare-handed. Show what the worn piece does (its blurb),
      // same as the candidates below; the Remove button carries the tap action.
      const it = ITEMS[wornId];
      const noRoom = inDungeon && this.inventory.length >= this.invCap;
      const sub = noRoom ? "bag is full — no room to stow it" : (it.equip?.blurb || "");
      rows.push(`<button class="gear-opt equipped ti-${it.tier}" data-act="unequip"${noRoom ? " disabled" : ""}>
        <span class="gear-opt-ic">${itemIcon(it.icon)}</span>
        <div class="gear-opt-txt"><b>${it.name}</b><small>${sub}</small></div>
        <span class="gear-opt-act off">${icon("undo")} Remove</span>
      </button>`);
    }
    for (const [id, { i, count }] of seen) {
      const it = ITEMS[id];
      const eq = it.equip;
      rows.push(`<button class="gear-opt ti-${it.tier}" data-i="${i}">
        <span class="gear-opt-ic">${itemIcon(it.icon)}</span>
        <div class="gear-opt-txt"><b>${it.name}${count > 1 ? ` ×${count}` : ""}</b><small>${eq.blurb || ""}</small></div>
        <span class="gear-opt-act">Equip</span>
      </button>`);
    }
    if (!rows.length) {
      const where = inDungeon ? "your bag" : "the storeroom";
      const hint = inDungeon ? "Loot gear from bosses as you dive." : "Bosses drop gear — bring some home first.";
      rows.push(`<div class="gear-empty">${icon(meta.icon)}<span>No ${meta.name.toLowerCase()} in ${where}.<br/><small>${hint}</small></span></div>`);
    }

    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon(meta.icon)}</span>
        <div><b>${meta.name}</b></div>
        <button class="icon-btn" id="pick-back">${icon("arrowLeft")}</button></div>
      <div class="gear-list">${rows.join("")}</div>
    `, inDungeon ? "sheet-card gear-sheet bag-sheet" : "sheet-card gear-sheet");

    el.querySelector("#pick-back").onclick = () => this._reopenGearHost(source);
    el.querySelectorAll("[data-i]").forEach((b) => {
      b.onclick = () => { this._equipFromPool(slot, Number(b.dataset.i), source); this._reopenGearHost(source); };
    });
    el.querySelectorAll('[data-act="unequip"]').forEach((b) => {
      b.onclick = () => { this._unequip(slot, source); this._reopenGearHost(source); };
    });
  },

  // Slot a piece into `slot`, pulling it from the pool (`source`) and dropping
  // anything already worn there back into that same pool. In co-op both the
  // storeroom and the bag are shared, so the guest mirrors the move locally and
  // asks the host to make it official.
  _equipFromPool(slot, idx, source) {
    const pool = source === "inv" ? this.inventory : this.stash;
    const id = pool[idx];
    const eq = equipInfo(id);
    if (!eq || eq.slot !== slot || !canEquip(id)) return; // only swords are equippable for now
    const prev = this.equipment[slot];
    pool.splice(idx, 1);
    if (prev) pool.push(prev);
    this.equipment[slot] = id;
    this._recomputeStats();
    this.audio.pickup();
    if (this.net.isGuest) this.net.send({ t: "equipReq", id, prev: prev || null, src: source });
    else { this._syncInv(); this._save(); }
  },

  _unequip(slot, source) {
    const prev = this.equipment[slot];
    if (!prev) return; // nothing worn here; weapon may be stripped to bare hands
    // stowing gear takes a bag slot while delving — refuse if there's no room
    if (source === "inv" && this.inventory.length >= this.invCap) {
      return this.hud.toast(`${icon("bag")} Bag is full!`);
    }
    const pool = source === "inv" ? this.inventory : this.stash;
    this.equipment[slot] = null;
    pool.push(prev);
    this._recomputeStats();
    this.audio.pickup();
    if (this.net.isGuest) this.net.send({ t: "unequipReq", id: prev, src: source });
    else { this._syncInv(); this._save(); }
  },

  _openBag() {
    // The bag opens anywhere — it's the always-available view of what you carry
    // and what you've got equipped. Dropping loot is still delve-only (see the
    // guard below and in _dropItem).
    this._openBagSheet();
  },

  // Re-render the backpack in place, but only if it's the sheet actually on
  // screen (not the gear picker or any other sheet layered over it). Called
  // whenever the inventory changes passively while the bag is open — loot
  // magneted off the floor, forage pocketed, or a co-op partner's grab echoing
  // in — so the list never silently falls out of sync with what you carry.
  _refreshBagIfOpen() {
    // `bag-split` is unique to the backpack list — the in-dungeon gear picker
    // also carries `bag-sheet`, so match the split class to avoid clobbering it.
    if (this.hud.sheetOpen && this.hud.sheetEl.classList.contains("bag-split"))
      this._openBagSheet();
  },

  _openBagSheet() {
    // Reopening while the bag is already up (after a use/drop) is a refresh, not
    // a fresh open — skip the pop-out entrance so the panels don't re-scale.
    const refresh = this.hud.sheetOpen;
    const ftue = !!this.tutorial;
    // Drop is delve-only (loot tossed anywhere else would just be lost — see
    // _dropItem), and it's also withheld during the FTUE so a new player can't
    // throw away the haul the tutorial is about to teach them to sell.
    const canDrop = this.playerArea === "dungeon" && !ftue;
    // In the shop the bag is a loading dock: every row's action becomes "Store",
    // dropping the item into the storeroom to be stocked onto the tables.
    const inShop = this.playerArea === "shop" && !ftue;
    const rows = this.inventory
      .map((id, i) => {
        const it = ITEMS[id];
        // bagged quest props (the shop key and letter): no price or Drop — only
        // the story action the FTUE wires up right now, if any
        if (it.quest) {
          const act = this._questBagAction(id);
          return `<div class="bag-row ti-${it.tier}">
            <span class="bag-face">${itemIcon(it.icon)}</span>
            <span class="bag-name">${it.name}<small>${it.blurb}</small></span>
            ${act ? `<button class="bag-act use" data-q="${id}">${act.label}</button>` : ""}
          </div>`;
        }
        // during the FTUE the plain rows carry no actions at all — the only
        // button in the whole bag is the story action that advances the story.
        // Gear (anything with an `equip` block) gets a one-tap Equip button so
        // you can slot it straight from the bag without opening the paper-doll;
        // in the shop it keeps its Store button too, so gear can still be stocked.
        const canEq = canEquip(id); // only swords are equippable for now
        const useBtn = ftue ? ""
          : canEq
            ? `<button class="bag-act equip" data-equip="${i}">${icon("sword")} Equip</button>`
              + (inShop ? `<button class="bag-act store" data-store="${i}">${icon("box")} Store</button>` : "")
            : inShop
              ? `<button class="bag-act store" data-store="${i}">${icon("box")} Store</button>`
              : it.heal
                ? `<button class="bag-act use" data-i="${i}">Use <small>+${it.heal}${icon("heart")}</small></button>`
                : `<span class="bag-act ghost">not usable</span>`;
        return `<div class="bag-row ti-${it.tier}">
          <span class="bag-face">${itemIcon(it.icon)}</span>
          <span class="bag-name">${it.name}<small>${it.base}g</small></span>
          ${useBtn}
          ${canDrop ? `<button class="bag-act drop" data-i="${i}">Drop</button>` : ""}
        </div>`;
      })
      .join("");
    const el = this.hud.showSheet(`
      <div class="gear-panel sheet-card">
        <div class="gear-panel-head">${icon("sword")}<b>Equipment</b></div>
        ${this._gearDollHTML("inv")}
      </div>
      <div class="bag-panel sheet-card">
        ${this._bagHead(canDrop ? "sip a potion or drop loot to free space" : inShop ? "store items in the storeroom" : "everything you carry")}
        <div class="bag-list">${rows || "<small class='empty'>empty — go dive!</small>"}</div>
      </div>
    `, `bag-sheet bag-split${refresh ? " bag-refresh" : ""}`, { onBackdrop: () => this.hud.hideSheet() });
    this._wireGearDoll(el, "inv");
    el.querySelector("#bag-close").onclick = () => this.hud.hideSheet();
    el.querySelectorAll(".bag-act.use").forEach((btn) => {
      btn.onclick = () => this._useItem(Number(btn.dataset.i));
    });
    el.querySelectorAll(".bag-act.drop").forEach((btn) => {
      btn.onclick = () => this._dropItem(Number(btn.dataset.i));
    });
    el.querySelectorAll(".bag-act.store").forEach((btn) => {
      btn.onclick = () => this._storeItem(Number(btn.dataset.store), btn);
    });
    el.querySelectorAll(".bag-act.equip").forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.equip);
        const eq = equipInfo(this.inventory[i]);
        if (!eq) return;
        this._equipFromPool(eq.slot, i, "inv");
        this._openBagSheet();
      };
    });
    el.querySelectorAll(".bag-act[data-q]").forEach((btn) => {
      btn.onclick = () => this._questBagAction(btn.dataset.q)?.fn();
    });
  },

  // -------------------------------------------------------------- storeroom
  // The shop's back room: everything the tables are stocked from. Twin of the
  // backpack (popping out of its own HUD button), but the flow runs the other
  // way — tap "Take" to pull a piece back into the bag (to gear up or carry a
  // supply down). Shop-only; the button that opens it is hidden underground.
  _toggleStore() {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    // shop-only, and only from inside the building — matches the HUD button's
    // visibility so the V shortcut can't reach it out on the street
    if (this.playerArea !== "shop" || !this.shop.inBuilding) return;
    this._openStoreSheet();
  },

  _openStoreSheet() {
    const refresh = this.hud.sheetOpen;
    const n = this.stash.length;
    const full = this.inventory.length >= this.invCap;
    const rows = this.stash
      .map((id, i) => {
        const it = ITEMS[id];
        return `<div class="bag-row ti-${it.tier}">
          <span class="bag-face">${itemIcon(it.icon)}</span>
          <span class="bag-name">${it.name}<small>${it.base}g</small></span>
          <button class="bag-act take" data-take="${i}"${full ? " disabled" : ""}>Take</button>
        </div>`;
      })
      .join("");
    const el = this.hud.showSheet(`
      <div class="bag-head">
        <span class="bag-emoji">${icon("box")}</span>
        <div class="bag-title"><b>Storeroom</b><small>${n ? `${n} item${n === 1 ? "" : "s"} out back` : "empty"}</small></div>
        <button class="icon-btn" id="store-close">${icon("close")}</button>
      </div>
      <div class="bag-list">${rows || "<small class='empty'>storeroom empty — go dive!</small>"}</div>
    `, `store-sheet bag-sheet sheet-card${refresh ? " bag-refresh" : ""}`, { onBackdrop: () => this.hud.hideSheet() });
    el.querySelector("#store-close").onclick = () => this.hud.hideSheet();
    el.querySelectorAll(".bag-act.take").forEach((btn) => {
      btn.onclick = () => this._takeFromStore(Number(btn.dataset.take), btn);
    });
  },

  // Shared builder for the two per-table storeroom menus. "Place" (empty table)
  // and "Replace" (occupied table) differ only in the title, an optional
  // "take back" row for the item already on show, and which action a storeroom
  // pick triggers. The sheet floats right above the slot so the choices land
  // under the cursor instead of at the bottom of the screen.
  _tableMenu(slot, { title, shownItem, onPick, onTakeBack }) {
    const slotIdx = this.shop.slots.indexOf(slot);
    const shownRow = shownItem
      ? `<div class="inv-grid swap-grid swap-shown">
          <button class="inv-item shown ti-${shownItem.tier}" id="take-back">${itemIcon(shownItem.icon)}<small>${shownItem.name}</small><span>take back</span></button>
        </div>`
      : "";
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("box")}</span>
        <div><b>${title}</b></div>
        <button class="icon-btn" id="bag-close">${icon("close")}</button></div>
      ${shownRow}
      <div class="inv-grid swap-grid swap-stash">${this._stashRows() || "<small class='empty'>storeroom empty — nothing to swap in</small>"}</div>
    `, "sheet-card");
    el.querySelector("#bag-close").onclick = () => this.hud.hideSheet();
    if (onTakeBack) {
      el.querySelector("#take-back").onclick = () => {
        onTakeBack();
        this.hud.hideSheet();
      };
    }
    el.querySelectorAll(".inv-grid .inv-item[data-i]").forEach((btn) => {
      btn.onclick = () => {
        onPick(Number(btn.dataset.i), slotIdx);
        this.hud.hideSheet();
      };
    });
    this.hud.anchorSheetAbove(slot.pos);
  },

  // Placement menu opened by the context action at a specific empty table.
  _placeMenu(slot) {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    if (this.stash.length === 0) return this.hud.toast("Storeroom is empty — go dive!");
    this._tableMenu(slot, {
      title: "Place on this table",
      onPick: (i, slotIdx) => this._stockFromStash(i, slotIdx),
    });
  },

  // Opened by the context action at an occupied table: pick a storeroom item
  // to swap in (the current one drops back to the storeroom), or tap the item
  // already on show to pull it off the table entirely.
  _replaceMenu(slot) {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    this._tableMenu(slot, {
      title: "Replace on this table",
      shownItem: ITEMS[slot.item],
      onPick: (i, slotIdx) => this._swapFromStash(i, slotIdx),
      onTakeBack: () => this._unstock(slot),
    });
  },

  // Swap the item on a filled table for one from the storeroom: the displayed
  // item goes back to the storeroom, the chosen item takes its place.
  _swapFromStash(idx, slotIdx) {
    if (this.playerArea !== "shop") return this.hud.toast("You can only stock in the shop.");
    const itemId = this.stash[idx];
    if (itemId == null) return;
    if (this.net.isGuest) {
      this.net.send({ t: "swapReq", idx, slotIdx });
      return;
    }
    const slot = this.shop.slots[slotIdx];
    if (!slot || !slot.item) return;
    const old = this.shop.unstockSlot(slot);
    this.stash.splice(idx, 1);
    this.shop.stockItem(itemId, slot);
    if (old != null) this.stash.push(old);
    this.audio.pickup();
    this._syncInv();
    this._syncStock();
    this._save();
  },

  // -------------------------------------------------------------- friends
  // Pick / change our display name and (re)register on the broker so friends
  // can reach us by it.
  setPlayerName(name) {
    name = String(name).trim().slice(0, 16);
    if (!name) return;
    this.playerName = name;
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    this.net.goOnline(name);
  },

  addFriend(name) {
    name = String(name).trim().slice(0, 16);
    if (!name) return;
    const key = name.toLowerCase();
    if (key === this.playerName.toLowerCase()) return; // no adding yourself
    if (this.friends.some((f) => f.toLowerCase() === key)) return;
    this.friends.push(name);
    this._saveFriends();
  },

  removeFriend(name) {
    this.friends = this.friends.filter((f) => f !== name);
    this._saveFriends();
  },

  _friendSheet() {
    if (this.hud.sheetOpen) return this.hud.hideSheet();
    this._renderFriendSheet();
  },

  _renderFriendSheet() {
    const inShop = this.playerArea === "shop";
    const connected = this.net.connected;
    let body;
    if (!this.playerName) {
      // First time: you need a name before anyone can invite you.
      body = `
        <div id="fr-status" class="hg-speech">Pick a name so friends can find you.</div>
        <div class="sheet-btns">
          <input id="fr-name" class="fr-input" maxlength="16" placeholder="Your name" autocapitalize="off" autocomplete="off" />
          <button class="btn deal" id="fr-setname">Save</button>
        </div>`;
    } else {
      const rows = this.friends.length
        ? this.friends
            .map(
              (f) => `
          <div class="fr-row">
            <span class="fr-name">${icon("people")} ${esc(f)}</span>
            <div class="fr-row-btns">
              <button class="btn small fr-invite" data-name="${esc(f)}" ${inShop && !connected ? "" : "disabled"}>Invite</button>
              <button class="icon-btn fr-remove" data-name="${esc(f)}" aria-label="Remove ${esc(f)}">${icon("close")}</button>
            </div>
          </div>`
            )
            .join("")
        : `<small class="empty">No friends yet — add one below.</small>`;
      const statusMsg = connected
        ? "A friend is in your shop!"
        : inShop
          ? "Invite a friend to teleport into your shop."
          : "Come up to the shop to invite a friend.";
      body = `
        <div class="fr-you">You're <b>${esc(this.playerName)}</b> <button class="btn small" id="fr-rename">Rename</button></div>
        <div id="fr-status" class="hg-speech">${statusMsg}</div>
        <div class="fr-list">${rows}</div>
        <div class="sheet-btns">
          <input id="fr-add" class="fr-input" maxlength="16" placeholder="Add friend by name" autocapitalize="off" autocomplete="off" />
          <button class="btn deal" id="fr-addbtn">Add</button>
        </div>
        ${connected ? `<div class="sheet-btns"><button class="btn deny" id="fr-leave">Leave session</button></div>` : ""}`;
    }
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("people")}</span>
        <div><b>Friends</b><br/><small>invite a friend to your shop</small></div>
        <button class="icon-btn" id="fr-close">${icon("close")}</button></div>
      ${body}
    `, "sheet-card");
    const status = el.querySelector("#fr-status");
    this.net.onStatus = (s) => { if (status) status.textContent = s; };
    el.querySelector("#fr-close").onclick = () => this.hud.hideSheet();

    if (!this.playerName) {
      const save = () => {
        const v = el.querySelector("#fr-name").value;
        if (v.trim()) { this.setPlayerName(v); this._renderFriendSheet(); }
      };
      el.querySelector("#fr-setname").onclick = save;
      el.querySelector("#fr-name").addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
      return;
    }

    el.querySelector("#fr-rename").onclick = () => {
      const v = prompt("Your name:", this.playerName);
      if (v && v.trim()) { this.setPlayerName(v); this._renderFriendSheet(); }
    };
    const add = () => {
      const input = el.querySelector("#fr-add");
      if (input.value.trim()) { this.addFriend(input.value); input.value = ""; this._renderFriendSheet(); }
    };
    el.querySelector("#fr-addbtn").onclick = add;
    el.querySelector("#fr-add").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    el.querySelectorAll(".fr-invite").forEach((b) => (b.onclick = () => this.net.invite(b.dataset.name)));
    el.querySelectorAll(".fr-remove").forEach((b) => (b.onclick = () => { this.removeFriend(b.dataset.name); this._renderFriendSheet(); }));
    const leave = el.querySelector("#fr-leave");
    if (leave) leave.onclick = () => { this.net.leave(); this._renderFriendSheet(); };
  },

  // A friend has invited us to teleport into their shop. You can only accept
  // from above ground — no bailing out of a live delve.
  onTpInvite(fromName) {
    this.audio.doorbell?.();
    const canAccept = this.playerArea !== "dungeon";
    const el = this.hud.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${icon("people")}</span>
        <div><b>${esc(fromName)} invites you</b><br/><small>teleport into their shop</small></div></div>
      <div class="hg-speech">${canAccept ? "Hop over and lend a hand?" : "You're deep in the cellar — surface before you can teleport."}</div>
      <div class="sheet-btns">
        <button class="btn deny" id="tp-decline">Decline</button>
        <button class="btn deal" id="tp-accept" ${canAccept ? "" : "disabled"}>Accept</button>
      </div>
    `, "sheet-card");
    el.querySelector("#tp-decline").onclick = () => { this.net.declineInvite(); this.hud.hideSheet(); };
    el.querySelector("#tp-accept").onclick = () => { this.net.acceptInvite(); };
  },

  // ================================================================ admin panel
  // Toggled with the ` (backquote) key. A dev/cheat overlay that lives outside
  // the sheet system so gameplay keeps running while it's open.
  _toggleAdmin() {
    if (this._adminOpen) {
      this.adminEl?.remove();
      this.adminEl = null;
      this._adminOpen = false;
      return;
    }
    const el = document.createElement("div");
    el.id = "admin-panel";
    el.innerHTML = `
      <div class="admin-head admin-title"><b>${icon("tools")} Admin</b><span>press \` to close</span></div>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("heart")} Player</b></summary>
        <div class="admin-grid">
          <button data-a="g100">${icon("coin")} +100g</button>
          <button data-a="g1k">${icon("coin")} +1000g</button>
          <button data-a="heal">${icon("heart")} Full heal</button>
          <button data-a="maxhp">${icon("plus")} +1 heart</button>
          <button data-a="god">${icon("shield")} God: <b>${this.godMode ? "ON" : "off"}</b></button>
        </div>
      </details>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("bag")} Inventory &amp; shop</b></summary>
        <div class="admin-grid">
          <button data-a="fillbag">${icon("bag")} Fill bag</button>
          <button data-a="stockshelves">${icon("box")} Stock shelves</button>
          <button data-a="clearbag">${icon("trash")} Empty bag</button>
        </div>
      </details>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("hole")} Dungeon</b></summary>
        <div class="admin-grid">
          <button data-a="delve">${icon("hole")} Dive</button>
          <button data-a="floor">${icon("arrowDown")} Next floor</button>
          <button data-a="tpexit">${icon("hole")} TP to exit</button>
          <button data-a="key">${itemIcon("key")} Give key</button>
          <button data-a="kill">${icon("skull")} Kill enemies</button>
        </div>
      </details>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("sun")} World &amp; debug</b></summary>
        <div class="admin-grid">
          <button data-a="freezeNoclip">${icon("pause")} Freeze + noclip: <b>${this.debugFreezeNoclip ? "ON" : "off"}</b></button>
          <button data-a="godrays">${icon("sun")} God rays: <b>${godraysEnabled() ? "ON" : "off"}</b></button>
          <button data-a="npcdbg">${icon("people")} NPC debug: <b>${this.npcDebug ? "ON" : "off"}</b></button>
        </div>
      </details>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("swords")} Combat input</b><span id="admin-combat-status"></span></summary>
        <div id="admin-combat">${this._combatPanelHtml()}</div>
      </details>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("sun")} Time &amp; town</b></summary>
        <div class="admin-control-label"><b>Time of day</b><span id="admin-clock-val">${this.debugHour == null ? "live" : _fmtHour(this.debugHour)}</span></div>
        <div class="admin-gradient" style="background:linear-gradient(90deg, ${dayClockStops()})">
          <div class="admin-gradient-mark" id="admin-clock-mark" style="left:${((this.debugHour == null ? _realHour() : this.debugHour) / 24) * 100}%"></div>
        </div>
        <div class="admin-slider">
          <input type="range" id="admin-clock" min="0" max="24" step="0.25" value="${this.debugHour == null ? _realHour() : this.debugHour}">
          <button data-a="clocklive">Live</button>
        </div>
        <div class="admin-control-label"><b>Occasion</b><span>townsfolk greeting</span></div>
        <div class="admin-slider">
          <select id="admin-occasion">
            <option value=""${this.debugOccasion == null ? " selected" : ""}>Live${_liveOccasionLabel()}</option>
            ${OCCASIONS.map((o) => `<option value="${o.id}"${this.debugOccasion === o.id ? " selected" : ""}>${esc(o.label)}</option>`).join("")}
          </select>
        </div>
      </details>
      <details class="admin-section">
        <summary class="admin-head"><b>${icon("crown")} FTUE jump</b><span>load a tutorial step</span></summary>
        <div class="admin-grid">
          <button data-a="tut:cave">${icon("swords")} 1 · Cave opening</button>
          <button data-a="tut:road">${icon("home")} 2 · Road to shop</button>
          <button data-a="tut:shopfront">${itemIcon("key")} 3 · Shopfront key</button>
          <button data-a="tut:fetch">${icon("scroll")} 4 · Empty shop</button>
          <button data-a="tut:forage">${icon("bag")} 5 · Forage floor</button>
          <button data-a="tut:trade">${icon("speak")} 6a · Return basket</button>
          <button data-a="tut:stock">${icon("box")} 6b · Stock shelf</button>
          <button data-a="tut:delve">${icon("hole")} 7 · Send-off</button>
        </div>
      </details>
      <details class="admin-section admin-danger-section">
        <summary class="admin-head"><b>${icon("recycle")} Save data</b></summary>
        <div class="admin-grid">
          <button data-a="reset" class="danger">${icon("recycle")} Wipe save</button>
        </div>
      </details>
      <div class="admin-hints">keys: <b>WASD</b> move · <b>Shift/RMB</b> dash-attack · <b>E/Space</b> interact · <b>B</b> bag · <b>C</b> friends · <b>M</b> mute</div>
    `;
    this.hud.root.appendChild(el);
    this.adminEl = el;
    this._adminOpen = true;
    // delegate on the whole panel so every grid (admin + FTUE jump) is covered
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-a]");
      if (btn) this._adminAction(btn.dataset.a);
    });
    // scrub the time-of-day slider to pin the lighting to a fixed hour
    el.querySelector("#admin-clock").addEventListener("input", (e) => {
      this.debugHour = +e.target.value;
      const lbl = this.adminEl?.querySelector("#admin-clock-val");
      if (lbl) lbl.textContent = _fmtHour(this.debugHour);
      const mark = this.adminEl?.querySelector("#admin-clock-mark");
      if (mark) mark.style.left = `${(this.debugHour / 24) * 100}%`;
    });
    // pin the townsfolk's occasion greeting to preview a holiday's chatter, or
    // "" to hand it back to the real calendar date
    el.querySelector("#admin-occasion").addEventListener("change", (e) => {
      this.debugOccasion = e.target.value || null;
      this.hud.toast(`${icon("speak")} Occasion: ${this.debugOccasion ?? "live"}`);
    });
    // combat sliders: live-update the setting as you drag (reflected in the
    // label), and persist to the JSON file on release
    el.addEventListener("input", (e) => {
      const t = e.target.closest("input[data-cset]");
      if (!t) return;
      const [m, key] = t.dataset.cset.split(".");
      const v = +t.value;
      setCombatSettings({ [m]: { [key]: v } });
      const lbl = el.querySelector(`[data-cval="${m}.${key}"]`);
      if (lbl) lbl.textContent = v;
    });
    el.addEventListener("change", (e) => {
      if (e.target.closest("input[data-cset]")) this._saveCombat();
    });
  },

  // The combat-input section's inner markup: the tuning sliders for the
  // currently selected mode (the mode picker itself lives in the pause menu,
  // see _escCombatHtml). Rebuilt in place on a mode switch (see _setAttackMode)
  // so the knobs always match the active mode.
  _combatPanelHtml() {
    const mode = attackMode();
    const active = ATTACK_MODES.find((m) => m.id === mode);
    const sliders = (COMBAT_SLIDERS[mode] || []).map((d) => {
      const val = combat[mode]?.[d.key];
      return `<div class="admin-slider cslider">
        <label>${esc(d.label)} <b data-cval="${mode}.${d.key}">${val}</b></label>
        <input type="range" data-cset="${mode}.${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}">
      </div>`;
    }).join("");
    return `
      <div class="admin-hints cmode-desc"><b>${active ? esc(active.label) : ""}</b> — ${active ? esc(active.desc) : ""}</div>
      ${sliders}
    `;
  },

  // Redraw just the admin combat section (keeps the rest of the panel steady).
  _renderCombatPanel() {
    const box = this.adminEl?.querySelector("#admin-combat");
    if (box) box.innerHTML = this._combatPanelHtml();
  },

  // The attack-mode picker shown in the pause menu: one numbered button per
  // mode plus a one-line description of the active mode. Wired in _toggleEscMenu.
  _escCombatHtml() {
    const mode = attackMode();
    const active = ATTACK_MODES.find((m) => m.id === mode);
    const picker = ATTACK_MODES.map((m) =>
      `<button class="cmode-btn cmode-btn-named${m.id === mode ? " on" : ""}" data-cmode="${m.id}" title="${esc(m.desc)}" aria-label="${esc(m.label)}">${esc(m.label)}</button>`
    ).join("");
    return `
      <div class="esc-combat-label">${icon("swords")} Attack type</div>
      <div class="cmode-picker">${picker}</div>
      <div class="esc-combat-desc"><b>${active ? esc(active.label) : ""}</b> — ${active ? esc(active.desc) : ""}</div>
    `;
  },

  // Switch attack mode, refresh any open picker/sliders, and persist.
  _setAttackMode(id) {
    if (!ATTACK_MODES.some((m) => m.id === id)) return;
    setCombatSettings({ attackMode: id });
    this._renderCombatPanel();
    const escBox = document.getElementById("esc-combat");
    if (escBox) escBox.innerHTML = this._escCombatHtml();
    this._saveCombat();
    const label = ATTACK_MODES.find((m) => m.id === id)?.label || id;
    this.hud.toast(`${icon("swords")} Combat: ${label}`);
  },

  // Write the live combat settings to disk (dev server); reflect the outcome in
  // the section header so it's clear whether it stuck or is session-only.
  _saveCombat() {
    saveCombatSettings().then((ok) => {
      const s = this.adminEl?.querySelector("#admin-combat-status");
      if (s) s.textContent = ok ? "saved" : "session only";
    });
  },

  // Float a small state/stuck card over every townsperson while the admin's
  // "NPC debug" toggle is on — the quickest way to see who's wedged and why.
  // Shows each shopper's errand state, stuck timer and remaining distance to
  // their goal (the same fields the stuck watchdog watches), plus a simpler
  // line for the ambient street strollers.
  _updateNpcDebug(dt = 0) {
    if (!this.npcDebug || this.playerArea !== "shop" || !this.shop) {
      this.hud.hideNpcDebug();
      return;
    }
    const pp = this.player.position;
    const entries = [];
    // Shoppers: the errand state machine has a real stuck watchdog, so show its
    // fields directly (state, distance to goal, the watchdog's stuck timer).
    for (const c of this.shop.customers) {
      if (!c.creature?.parent) continue;
      const st = c._stuckT || 0;
      const goal = c._goalDist != null ? `goal ${c._goalDist.toFixed(2)}m` : "";
      entries.push({
        target: c.creature,
        stuck: st > 1.2,
        html:
          `<b>${esc(c.npc?.name ?? "?")}</b>` +
          `<i>${esc(c.state)}${c.mode === "sell" ? " · sell" : ""}${c.ready ? " · ready" : ""}</i>` +
          (goal ? `<i>${goal}</i>` : "") +
          (st > 0.05 ? `<i class="warn">stuck ${st.toFixed(1)}s</i>` : ""),
      });
    }
    // Strollers have no pathing or collision: the only thing that halts one is
    // the player standing inside its stop radius (the AC-style pause). So the
    // useful readout is *why* it's stopped — blocked by you, noticing you,
    // pausing, or leaving — plus a no-progress timer to catch a genuine wedge.
    for (const p of this.shop.passersby) {
      const c = p.creature;
      if (!c?.parent) continue;
      const leaving = p.life <= -1e7;
      const pdist = Math.hypot(pp.x - c.position.x, pp.z - c.position.z);
      const blocked = pdist < 1.45; // NPC_STOP_R
      const noticing = pdist < 2.6; // NPC_NOTICE_R
      const dTo = Math.hypot(p.tx - c.position.x, p.tz - c.position.z);
      // no-progress timer (debug bookkeeping only): trying to walk but the
      // distance to the target isn't shrinking, and it's not the player pausing it
      const moving = !p.chatting && p.pause <= 0 && !blocked;
      if (moving && p._dbgPrevD != null && dTo > p._dbgPrevD - 0.004) {
        p._dbgStuckT = (p._dbgStuckT || 0) + dt;
      } else {
        p._dbgStuckT = 0;
      }
      p._dbgPrevD = dTo;
      const status = p.chatting ? "chatting"
        : blocked ? "stopped · you"
        : p.pause > 0 ? "pausing"
        : leaving ? "leaving"
        : noticing ? "noticing you"
        : "strolling";
      entries.push({
        target: c,
        stuck: (p._dbgStuckT || 0) > 1,
        html:
          `<b>${esc(p.npc?.name ?? "stroller")}</b>` +
          `<i${blocked ? ' class="warn"' : ""}>${status}</i>` +
          `<i>→ ${dTo.toFixed(1)}m · spd ${(p.curSpeed || 0).toFixed(2)}</i>` +
          (noticing ? `<i>you ${pdist.toFixed(1)}m</i>` : "") +
          (leaving ? "" : `<i>life ${p.life.toFixed(1)}s</i>`) +
          ((p._dbgStuckT || 0) > 0.05 ? `<i class="warn">no-progress ${p._dbgStuckT.toFixed(1)}s</i>` : ""),
      });
    }
    this.hud.renderNpcDebug(entries);
  },

  _adminAction(a) {
    if (a.startsWith("tut:")) return this._tutJump(a.slice(4));
    if (a.startsWith("cmode:")) return this._setAttackMode(a.slice(6));
    switch (a) {
      case "g100": this.gainGold(100); break;
      case "g1k": this.gainGold(1000); break;
      case "heal":
        this.hp = this.maxHp;
        this.hud.setHearts(this.hp, this.maxHp);
        break;
      case "maxhp":
        this.maxHp++;
        this.hp = this.maxHp;
        this.hud.setHearts(this.hp, this.maxHp);
        break;
      case "god":
        this.godMode = !this.godMode;
        this.hud.toast(`God mode ${this.godMode ? "ON" : "off"}`);
        break;
      case "freezeNoclip": {
        this.debugFreezeNoclip = !this.debugFreezeNoclip;
        const b = this.adminEl?.querySelector('[data-a="freezeNoclip"] b');
        if (b) b.textContent = this.debugFreezeNoclip ? "ON" : "off";
        break;
      }
      case "godrays": {
        const on = setGodraysEnabled(!godraysEnabled());
        this.hud.toast(`${icon("sun")} God rays ${on ? "ON" : "off"}`);
        const b = this.adminEl?.querySelector('[data-a="godrays"] b');
        if (b) b.textContent = on ? "ON" : "off";
        break;
      }
      case "fillbag": {
        // fills whatever you're living out of: the bag below, the stash above
        const ids = Object.keys(ITEMS);
        if (this.playerArea === "dungeon") {
          while (this.inventory.length < this.invCap) this.inventory.push(pick(Math.random, ids));
        } else {
          for (let i = 0; i < this.invCap; i++) this.stash.push(pick(Math.random, ids));
        }
        this._syncInv();
        this._save();
        this.hud.toast(this.playerArea === "dungeon" ? `${icon("bag")} Bag filled` : `${icon("box")} Storeroom stocked`);
        break;
      }
      case "stockshelves": {
        if (this.playerArea !== "shop") { this.hud.toast("Head up to the shop to stock shelves."); break; }
        const ids = Object.keys(ITEMS);
        let n = 0;
        for (const slot of this.shop.slots) {
          if (slot.item) continue;
          this.shop.stockItem(pick(Math.random, ids), slot);
          n++;
        }
        this._syncStock();
        this._save();
        this.hud.toast(n ? `${icon("box")} Stocked ${n} shelf slot${n === 1 ? "" : "s"}` : `${icon("box")} Shelves already full`);
        break;
      }
      case "clearbag":
        this.inventory.length = 0;
        this.stash.length = 0;
        this._syncInv();
        this._save();
        this.hud.toast(`${icon("trash")} Bag & storeroom emptied`);
        break;
      case "delve":
        if (this.playerArea !== "dungeon") this._delve();
        break;
      case "floor":
        if (this.playerArea === "dungeon" && this.dungeon.active) {
          if (this.dungeon.floor >= MAX_DEPTH) this.hud.toast("This is the final boss floor — deepest there is.");
          else this._descend();
        } else this.hud.toast("Dive first!");
        break;
      case "tpexit": {
        // hop straight to the floor's way onward — the descent stairs, the boss
        // stairs once conjured, or the gate / up-stairs where nothing else leads
        // deeper. Lands a step to the side so the prompt isn't primed on arrival.
        if (this.playerArea !== "dungeon" || !this.dungeon.active) { this.hud.toast("Dive first!"); break; }
        const D = this.dungeon;
        if (D.bossStairs) _v.copy(D.bossStairs.pos);
        else if (D.hasDownStairs) _v.copy(D.stairsPos).add(DUNGEON_ORIGIN);
        else if (D.gatePos) _v.copy(D.gatePos).add(DUNGEON_ORIGIN);
        else _v.copy(D.upStairsPos).add(DUNGEON_ORIGIN);
        this.player.position.set(_v.x + 1.5, 0, _v.z + 1.1);
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        this.hud.toast(`${icon("hole")} Teleported to the exit`);
        break;
      }
      case "key":
        // into the bag while delving, into the storeroom back home
        if (this.playerArea !== "dungeon") {
          this.stash.push("key");
          this._syncInv();
          this._save();
          this.hud.toast(`${itemIcon("key")} Brass Key added to storeroom`);
        } else if (this.inventory.length < this.invCap) {
          this.inventory.push("key");
          this._syncInv();
          this._save();
          this.hud.toast(`${itemIcon("key")} Brass Key added to bag`);
        } else {
          this.hud.bagFull();
        }
        break;
      case "kill":
        for (const e of [...this.dungeon.enemies]) this.dungeon.damageEnemy(e, 999);
        break;
      case "npcdbg": {
        this.npcDebug = !this.npcDebug;
        if (!this.npcDebug) this.hud.hideNpcDebug();
        const b = this.adminEl?.querySelector('[data-a="npcdbg"] b');
        if (b) b.textContent = this.npcDebug ? "ON" : "off";
        this.hud.toast(`${icon("people")} NPC debug ${this.npcDebug ? "ON" : "off"}`);
        break;
      }
      case "clocklive": {
        // hand the day/night cycle back to the real wall clock
        this.debugHour = null;
        const now = _realHour();
        const slider = this.adminEl?.querySelector("#admin-clock");
        const lbl = this.adminEl?.querySelector("#admin-clock-val");
        const mark = this.adminEl?.querySelector("#admin-clock-mark");
        if (slider) slider.value = now;
        if (lbl) lbl.textContent = "live";
        if (mark) mark.style.left = `${(now / 24) * 100}%`;
        this.hud.toast(`${icon("sun")} Clock back to live time`);
        break;
      }
      case "reset":
        this._reset();
        break;
    }
    // refresh god-mode label without rebuilding everything
    const g = this.adminEl?.querySelector('[data-a="god"] b');
    if (g) g.textContent = this.godMode ? "ON" : "off";
  },

  // Debug: drop straight into any FTUE checkpoint by rebuilding the exact game
  // state that step expects, then driving the real transition into it. Loads a
  // "premade" tutorial state so each beat can be inspected without playing the
  // whole loop from scratch. Solo only; wired to the ` admin panel.
  _tutJump(step) {
    if (this._adminOpen) this._toggleAdmin();
    if (this.net.connected) return this.hud.toast("FTUE jump is solo-only.");
    this.hud.hideSheet();

    // --- clean tutorial baseline ---------------------------------------------
    this.tutorial = null; // silence any in-flight step transitions during setup
    this._endMayorScene(); // tear down any in-flight Mayor cutscene
    this.hud.hideSpeak(); // drop any open bubble (its tap-callback chains old scenes)
    this._cine = null;
    this._doorScene = false;
    this._ftueFreeze = false;
    this._sceneCam = false;
    this._letterSpawned = false;
    this._letterPicked = false;
    this._letterRead = false;
    this._removeLetterProp();
    this._morelIntroDone = false;
    this._morelTradeDone = false;
    this.hud.clearBagAttention();
    this.shop.doorLocked = false;
    this.shop.doorHeld = false;
    this.gold = 100;
    this.hud.setGold(this.gold, false);
    for (const c of [...this.shop.customers]) this.shop._removeCustomer(c);
    this.inventory.length = 0;
    this.stash.length = 0;
    for (const s of this.shop.slots) if (s.item) this.shop.unstockSlot(s);
    this._syncStock();
    // shelves back to unbuilt (the FTUE's opening state); steps that need the
    // gifted shelf re-open it below
    this.tablesRepaired = this.tablesRepaired.map(() => false);
    for (const t of this.shop.tables) { t.repaired = false; this.shop._applyTableState(t); }
    // Morel back at his patch, mid-scene walks dropped
    const morel = this.shop.morel;
    if (morel?.creature) {
      morel.state = "idle";
      morel.path = null;
      morel.onArrive = null;
      morel.creature.position.set(morel.home.x, 0, morel.home.z);
      morel.creature.heading = morel.homeHeading;
      morel.creature.visible = true;
    }
    // park Morel just inside the door, waiting on his basket (post-intro state)
    const morelInside = () => {
      if (!morel?.creature) return;
      const o = this.shop.shopOrigin;
      morel.creature.position.set(
        (this.shop.doorInside.x + o.x) / 2, 0, (this.shop.doorInside.z + o.z) / 2);
    };

    const wares = ["jelly", "rathide"]; // the cave haul
    const toShop = () => {
      if (this.playerArea !== "shop") {
        // climbing out of a delve first cleans up its state (bag, HP)
        if (this.playerArea !== "cave") this._returnHome();
        this.playerArea = "shop";
        this.lobby.leave();
        this.hud.showBag(true);
        this.hud.showStore(true);
        this.hud.setGoldCorner(false);
      }
      this.player.position.copy(this.shop.doorPos);
      this.player.animator.prevPos.copy(this.player.position);
      this._snapCamera();
    };
    // "inside the shop, key spent, Morel's order named" — the state the
    // errand steps build on
    const insideSetup = (tut) => {
      toShop();
      this.tutorial = tut;
      this._doorScene = true;
      this._letterSpawned = true;
      this._letterPicked = true;
      this._letterRead = true;
      this._morelIntroDone = true;
      this._syncInv();
    };

    switch (step) {
      case "cave":
        // replay the whole opening: the cave, the slime kill, the wake-up lines
        toShop(); // normalize area/HUD state before _tutStart flips it to the cave
        this.inventory = wares.slice(0, -1); // the jelly arrives via the cinematic
        this._syncInv();
        this._tutStart();
        break;

      case "road":
        toShop();
        this.tutorial = "shop";
        this.shop.doorLocked = true;
        this.inventory = ["shopkey", ...wares]; // the door scene spends the key
        this._syncInv();
        // stand where the cave spits you out, facing down the road at the shop
        this.player.position.copy(this.shop.caveMouthPos).add(_v.set(0, 0, 1.9));
        this.player.heading = 0;
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        this._tutHint();
        break;

      case "shopfront":
        // Scene 3 begins on the locked doorstep, immediately before the line
        // that points the player to the inherited key in their bag.
        toShop();
        this.tutorial = "shop";
        this.shop.doorLocked = true;
        this.inventory = ["shopkey", ...wares];
        this._syncInv();
        this.player.position.copy(this.shop.doorPos);
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        this._shopDoorScene();
        break;

      case "fetch":
        // just inside the bare shop, one step from finding the counter letter;
        // Morel does not appear indoors until it has been read
        toShop();
        this.tutorial = "fetch";
        this._doorScene = true;
        if (morel?.creature) morel.creature.visible = false;
        this.inventory = [...wares];
        this._syncInv();
        this.player.position.copy(this.shop.doorInside);
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        break;

      case "forage":
        // Morel's order named — standing at the cave pit, basket empty
        insideSetup("forage");
        this.inventory = [...wares];
        this._syncInv();
        morelInside();
        this._enterCave();
        this.player.position.copy(this.cave.descentPos).add(_v.set(0, 0, 1.6));
        this.player.animator.prevPos.copy(this.player.position);
        this._snapCamera();
        this._tutHint();
        break;

      case "trade":
        // back with the full basket; Morel waits by the counter
        insideSetup("trade");
        this.inventory = ["mushroom", "mushroom", "caveshroom", "meat", ...wares];
        this._syncInv();
        morelInside();
        this._tutHint();
        break;

      case "stock":
        // shelf delivered, haul stowed — one mushroom wants laying out
        insideSetup("stock");
        this._morelTradeDone = true;
        this.tablesRepaired[0] = true;
        this.shop.repairTable(0, true);
        this.stash = ["mushroom", "meat", ...wares];
        this._syncInv();
        morelInside();
        this._tutHint();
        break;

      case "delve":
        // the send-off: shelf stocked, arrow pointing down the road at the
        // cave (the step completes on the first dive down a mouth)
        insideSetup("delve");
        this._morelTradeDone = true;
        this.tablesRepaired[0] = true;
        this.shop.repairTable(0, true);
        this.stash = ["meat", ...wares];
        this._syncInv();
        this._stockFromStash(0);
        this._tutHint();
        break;
    }
    this._save();
  },
};
