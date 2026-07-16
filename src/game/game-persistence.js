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
        shortcutUntil: this.shortcutUntil,
        bossBeaten: this.bossBeaten,
        equipment: this.equipment,
        expansions: this.expansionsBought,
        town: this.townRestored,
        tables: this.tablesRepaired,
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
        // drop any item ids that no longer exist (e.g. renamed/removed items)
        // and quest props (the FTUE shop key — a resumed save skips the FTUE,
        // so the key would otherwise land in the stash as sellable junk).
        // A run always resumes in the shop, so anything saved in the bag
        // (including legacy saves from before the storeroom) lands in the stash.
        const keeps = (id) => ITEMS[id] && !ITEMS[id].quest;
        this.stash = (s.stash ?? []).filter(keeps);
        this.stash.push(...(s.inv ?? []).filter(keeps));
        this.inventory = [];
        if (Array.isArray(s.shortcutUntil)) {
          // keep the array shape stable even if N_DUNGEONS ever changes
          for (let i = 1; i < this.shortcutUntil.length; i++)
            this.shortcutUntil[i] = s.shortcutUntil[i] ?? 0;
          // migrate saves from before bossBeaten existed: any earned deeper
          // shortcut means a boss has already fallen, so keep record of it
          if (s.bossBeaten === undefined && this.shortcutUntil.some((t) => t > 0))
            this.bossBeaten = true;
        }
        if (Array.isArray(s.expansions))
          this.expansionsBought = [!!s.expansions[0], !!s.expansions[1]];
        if (Array.isArray(s.town))
          this.townRestored = s.town.map(Boolean);
        if (Array.isArray(s.tables))
          this.tablesRepaired = s.tables.map(Boolean);
        // restore the loadout, dropping any worn piece whose id no longer maps
        // to a real item of the right slot (schema drift / removed content)
        if (s.equipment) {
          for (const slot of SLOTS) {
            const id = s.equipment[slot];
            const eq = equipInfo(id);
            this.equipment[slot] = eq && eq.slot === slot ? id : (slot === "weapon" ? "wsword" : null);
          }
        }
      }
    } catch {}
  },
};
