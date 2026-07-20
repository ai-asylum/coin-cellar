// localStorage persistence for the kitchen — its own blob, separate from the
// main game save (game-persistence.js), so cooking experiments never touch a
// run in progress. Saved eagerly on every mutation.
const KEY = "coin-cellar-cooking-v1";

const DEFAULTS = () => ({
  discoveries: {}, // inputHash → { at, out: [slug] }
  cookbook: [], // dish entries, see kitchen.js _plate()
  unlockedTools: [], // beyond starters (every tool is a starter for now)
  unlockedIngredients: [], // beyond the game-item catalogue
  kitchenSelected: null, // { station, vessel, positions } on the counter
});

class Save {
  constructor() {
    this.data = DEFAULTS();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS(), ...JSON.parse(raw) };
    } catch {
      /* corrupted save — start fresh */
    }
  }

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full/blocked — keep playing in memory */
    }
  }

  reset() {
    this.data = DEFAULTS();
    this.persist();
  }
}

export const save = new Save();
