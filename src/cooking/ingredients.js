// Coin Cellar's wares as cooking ingredients. Every non-quest item from the
// game catalogue (src/game/items.js) can land on the kitchen counter — the
// forage is produce, the monster drops are protein, and yes, you can cook a
// sword. Slugs are prefixed `cc_` so they never collide with the restaurant
// game's rows in the shared Supabase `ingredients` table.
//
// The game's own PNG art (public/items/<icon>.png) is the sprite for these
// base ingredients; the shared backend only takes over for discoveries.
import { ITEMS } from "../game/items.js";

// category → which side drawer the ingredient lives in (kitchen.js
// TRAY_CATEGORIES: produce / protein / pantry / spices / other).
// `starter` marks the two items a fresh save carries (game.js START_INV) —
// those are the rows flagged is_starter in the database seed.
const DEFS = {
  // -- forage & food
  caveshroom: { cat: "produce", emoji: "🍄", starter: true,
    desc: "a fat tan-capped mushroom foraged down in the cellar" },
  mushroom: { cat: "produce", emoji: "🍄",
    desc: "a red-capped wild mushroom with white spots" },
  herb: { cat: "produce", emoji: "🌿",
    desc: "a fragrant silvery herb that glows faintly at night" },
  flower: { cat: "produce", emoji: "🌸",
    desc: "a sweet meadow blossom dripping with nectar" },
  berries: { cat: "produce", emoji: "🫐",
    desc: "a handful of ripe wild berries" },
  nuts: { cat: "produce", emoji: "🌰",
    desc: "crunchy acorn-like nuts from the meadow saplings" },
  meat: { cat: "protein", emoji: "🍖", starter: true,
    desc: "a hearty haunch of roast meat on the bone" },
  egg: { cat: "protein", emoji: "🥚",
    desc: "a huge speckled egg laid by a griffon" },
  jelly: { cat: "protein", emoji: "🟢",
    desc: "a wobbly green blob of slime, oddly edible" },
  bread: { cat: "pantry", emoji: "🍞",
    desc: "a golden loaf baked with honey" },
  potion: { cat: "pantry", emoji: "🧪",
    desc: "a bubbling red healing drink" },

  // -- crushable minerals: the dungeon's answer to seasoning
  crystal: { cat: "spices", emoji: "💎",
    desc: "a shard of rock crystal that grinds into glittering dust" },
  star: { cat: "spices", emoji: "⭐",
    desc: "a fallen star shard, warm to the touch" },

  // -- treasure, trinkets and curios
  rathide: { cat: "other", emoji: "🐀", desc: "a rolled-up rat pelt cinched with cord" },
  gem: { cat: "other", emoji: "💠", desc: "a pale blue gem that catches the dawn" },
  fang: { cat: "other", emoji: "🦷", desc: "a curved ivory fang from a dragon" },
  crown: { cat: "other", emoji: "👑", desc: "a lost golden crown, five points" },
  key: { cat: "other", emoji: "🗝️", desc: "a heavy brass key to nobody-knows-what" },
  bomb: { cat: "other", emoji: "💣", desc: "a round black bomb with a short fuse" },
  lantern: { cat: "other", emoji: "🏮", desc: "a lantern with a wisp trapped inside" },
  ring: { cat: "other", emoji: "💍", desc: "a plain ring of polished copper" },
  amulet: { cat: "other", emoji: "📿", desc: "a silver amulet on a fine chain" },
  bell: { cat: "other", emoji: "🔔", desc: "a small bell cast in solid gold" },
  feather: { cat: "other", emoji: "🪶", desc: "a red feather that is always warm" },
  hourglass: { cat: "other", emoji: "⏳", desc: "an hourglass whose sand falls slowly" },
  tome: { cat: "other", emoji: "📕", desc: "a heavy spellbook humming with magic" },

  // -- gear (the AI can cook a sword if you insist)
  wsword: { cat: "other", emoji: "🗡️", desc: "a sword carved from pine wood" },
  dagger: { cat: "other", emoji: "🗡️", desc: "a quick little dagger with a fang blade" },
  ssword: { cat: "other", emoji: "⚔️", desc: "a long sword of polished steel" },
  shield: { cat: "other", emoji: "🛡️", desc: "a kite shield with a gold boss" },
  bow: { cat: "other", emoji: "🏹", desc: "a hunter's bow of springy wood" },
  staff: { cat: "other", emoji: "🪄", desc: "an oak staff topped with a blue stone" },
  armor: { cat: "other", emoji: "🦺", desc: "a steel chestplate, dungeon-dented" },
  boots: { cat: "other", emoji: "🥾", desc: "a pair of swift leather boots" },
};

export const INGREDIENTS = Object.entries(DEFS).map(([id, d]) => ({
  slug: "cc_" + id,
  itemId: id,
  name: ITEMS[id].name,
  emoji: d.emoji,
  category: d.cat,
  description: d.desc,
  icon: ITEMS[id].icon,
  starter: !!d.starter,
}));

export const INGREDIENT_SLUGS = INGREDIENTS.map((i) => i.slug);

const BY_SLUG = new Map(INGREDIENTS.map((i) => [i.slug, i]));

export function ingredientDef(slug) {
  return BY_SLUG.get(slug) || null;
}

// The game's flat colour icon for a base ingredient (page-relative, same art
// the shop shelves use), or null for backend-born discoveries.
export function localArt(slug) {
  const def = BY_SLUG.get(slug);
  return def ? `items/${def.icon}.png` : null;
}
