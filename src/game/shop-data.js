// Shared shop data: customer archetypes, room dimensions, and flow tuning
// constants. Split out of shop.js so build/pathfinding/customer modules (and
// external importers like game.js and admin.js) can share them without pulling
// in the whole shop.

export const ARCHETYPES = [
  // `buy` = chance they actually make an offer once they've browsed
  { name: "Cheapskate", moods: "faceRoll", lo: 1.02, hi: 1.18, w: 3, buy: 0.5 },
  { name: "Regular", moods: "faceHappy", lo: 1.1, hi: 1.4, w: 5, buy: 0.62 },
  { name: "Wealthy", moods: "faceMonocle", lo: 1.3, hi: 1.75, w: 2, buy: 0.74 },
  { name: "Collector", moods: "faceStar", lo: 1.5, hi: 2.2, w: 1, buy: 0.88 },
];

export const MAX_CUSTOMERS = 6;
export const SELLER_CHANCE = 0.3; // fraction of shoppers who come to sell, not buy

export const SHOP = {
  W: 13,
  D: 11,
};
