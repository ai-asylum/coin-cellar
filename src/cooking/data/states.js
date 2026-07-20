// Ingredient state vocabulary — mirrors infinite-kitchen's ItemState set so
// interaction hashes line up with the shared cache.
export const STATES = [
  "FROZEN",
  "CHILLED",
  "HOT",
  "MELTED",
  "BURNT",
  "CHARRED",
  "ON_FIRE",
  "WET",
  "DRIED",
  "SEASONED",
  "MARINATED",
  "FERMENTED",
  "AGED",
];

// Mutually exclusive groups: applying one removes the others in its group.
export const EXCLUSION_GROUPS = [
  ["FROZEN", "CHILLED", "HOT", "MELTED", "ON_FIRE"],
  ["BURNT", "CHARRED"],
  ["WET", "DRIED"],
];

// Tier 2 states are visible conditions (get particles in the kitchen);
// tier 3 are invisible flavour states (tooltip only).
export const STATE_TIERS = {
  FROZEN: 2,
  CHILLED: 2,
  HOT: 2,
  MELTED: 2,
  BURNT: 2,
  CHARRED: 2,
  ON_FIRE: 2,
  WET: 2,
  DRIED: 2,
  SEASONED: 3,
  MARINATED: 3,
  FERMENTED: 3,
  AGED: 3,
};

export const STATE_EMOJI = {
  FROZEN: "❄️",
  CHILLED: "🧊",
  HOT: "🔥",
  MELTED: "💧",
  BURNT: "🖤",
  CHARRED: "🖤",
  ON_FIRE: "🔥",
  WET: "💦",
  DRIED: "🍂",
  SEASONED: "🧂",
  MARINATED: "🫙",
  FERMENTED: "🫧",
  AGED: "⏳",
};

// Add a state to a list, evicting anything it excludes. Returns a new array.
export function applyState(states, next) {
  const group = EXCLUSION_GROUPS.find((g) => g.includes(next));
  const kept = states.filter((s) => s !== next && !(group && group.includes(s)));
  return [...kept, next];
}

export function removeState(states, gone) {
  return states.filter((s) => s !== gone);
}
