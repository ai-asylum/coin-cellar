// Save/load of the shopkeeper's run + the friends list. Attached to
// Game.prototype via Object.assign, so `this` is the live Game instance.
import { ITEMS } from "./items.js";
import { SLOTS, equipInfo } from "./gear.js";

export const SAVE_KEY = "coincellar_save_v1";
export const NAME_KEY = "coincellar_name";
export const FRIENDS_KEY = "coincellar_friends";

export const persistenceMethods = {
  _loadFriends() {
    try {
      const a = JSON.parse(localStorage.getItem(FRIENDS_KEY));
      return Array.isArray(a) ? a.filter((f) => typeof f === "string") : [];
    } catch {
      return [];
    }
  },

  _saveFriends() {
    try {
      localStorage.setItem(FRIENDS_KEY, JSON.stringify(this.friends));
    } catch {}
  },

  _save() {
    if (this.net.isGuest) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        day: this.day, gold: this.gold, inv: this.inventory, stash: this.stash,
        // what's out on the display tables, indexed by slot (null = empty slot)
        stock: this.shop ? this.shop.slots.map((s) => s.item) : [],
        shortcutUntil: this.shortcutUntil,
        bossBeaten: this.bossBeaten,
        deepestEver: this.deepestEver,
        equipment: this.equipment,
        town: this.townRestored,
        tables: this.tablesRepaired,
        npcMet: [...this._npcMet],
      }));
    } catch {}
  },

  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.day) {
        this._hadSave = true;
        this.day = s.day;
        this.gold = s.gold;
        this.bossBeaten = !!s.bossBeaten;
        this.deepestEver = Number(s.deepestEver) || 0;
        // drop any item ids that no longer exist (e.g. renamed/removed items)
        // and quest props (the FTUE shop key — a resumed save skips the FTUE,
        // so the key would otherwise land in the stash as sellable junk).
        // A run always resumes in the shop, so anything saved in the bag
        // (including legacy saves from before the storeroom) lands in the stash.
        const keeps = (id) => ITEMS[id] && !ITEMS[id].quest;
        this.stash = (s.stash ?? []).filter(keeps);
        this.stash.push(...(s.inv ?? []).filter(keeps));
        this.inventory = [];
        // what was on the display tables, indexed by slot. The shop isn't built
        // yet at load time, so stash it here for _restoreStock() to place back
        // onto the shelves once the fixtures exist (see game.js).
        this._savedStock = Array.isArray(s.stock) ? s.stock : null;
        if (Array.isArray(s.shortcutUntil)) {
          // keep the array shape stable even if N_DUNGEONS ever changes
          for (let i = 1; i < this.shortcutUntil.length; i++)
            this.shortcutUntil[i] = s.shortcutUntil[i] ?? 0;
          // migrate saves from before bossBeaten existed: any earned deeper
          // shortcut means a boss has already fallen, so keep record of it
          if (s.bossBeaten === undefined && this.shortcutUntil.some((t) => t > 0))
            this.bossBeaten = true;
        }
        if (Array.isArray(s.town))
          this.townRestored = s.town.map(Boolean);
        if (Array.isArray(s.tables))
          this.tablesRepaired = s.tables.map(Boolean);
        // townsfolk already introduced (so first-meeting hellos don't repeat)
        if (Array.isArray(s.npcMet))
          this._npcMet = new Set(s.npcMet.filter((id) => typeof id === "string"));
        // restore the loadout, dropping any worn piece whose id no longer maps
        // to a real item of the right slot (schema drift / removed content)
        if (s.equipment) {
          for (const slot of SLOTS) {
            const id = s.equipment[slot];
            const eq = equipInfo(id);
            if (eq && eq.slot === slot) this.equipment[slot] = id; // valid piece
            else if (id == null) this.equipment[slot] = null; // deliberately bare (incl. unarmed)
            // a saved id that no longer maps to real gear (removed content / drift):
            // rearm the pine sword for the weapon slot, leave others empty
            else this.equipment[slot] = slot === "weapon" ? "wsword" : null;
          }
        }
      }
    } catch {}
  },

  // Put the saved shelf stock back on the display tables. Called from the Game
  // constructor once the shop (and its restored/repaired tables) exists, since
  // _load runs before the shop is built. Items whose ids no longer map to real,
  // non-quest goods are dropped; slots on tables that never got repaired stay
  // empty (their slot is disabled, so stockItem refuses it).
  _restoreStock() {
    const stock = this._savedStock;
    this._savedStock = null;
    if (!this.shop || !Array.isArray(stock)) return;
    const keeps = (id) => ITEMS[id] && !ITEMS[id].quest;
    stock.forEach((id, i) => {
      if (id == null || !keeps(id)) return;
      const slot = this.shop.slots[i];
      if (slot && !slot.item && !slot.disabled) this.shop.stockItem(id, slot);
    });
  },
};
