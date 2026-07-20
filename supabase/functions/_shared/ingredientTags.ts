// Tag vocabulary for the sub-tools system. See docs/specs/sub-tools.md.
//
// IMPORTANT: This file MUST stay in sync with lib/ingredientTags.ts.
// The client uses lib/ingredientTags.ts (TypeScript build) and edge functions
// use this Deno-compatible mirror. Keep both lists identical.
//
// Why two files: Deno edge functions can't import from the project's lib/ dir
// (different module system, no Node-style resolution), so we mirror the
// vocabulary here. The validateTags() boundary catches any drift between them.

export const INGREDIENT_TAGS: readonly string[] = [
  // Food families (14)
  'meat', 'fish', 'seafood', 'vegetable', 'fruit', 'grain', 'dairy', 'egg',
  'herb', 'spice', 'nut', 'seed', 'mushroom', 'tofu',

  // Animal subtypes (8)
  'poultry', 'red_meat', 'pork', 'game', 'offal', 'shellfish', 'crustacean', 'cephalopod',

  // Fish subtypes (4)
  'raw_fish', 'fatty_fish', 'white_fish', 'roe',

  // Vegetable subtypes (8)
  'leafy_green', 'root_vegetable', 'cruciferous', 'nightshade', 'allium',
  'squash', 'legume', 'tuber',

  // Fruit subtypes (3)
  'citrus', 'berry', 'tropical_fruit',

  // Grain subtypes (5)
  'rice', 'noodles', 'bread', 'dough', 'flour',

  // Dairy subtypes (3)
  'hard_cheese', 'soft_cheese', 'cream',

  // State (6)
  'raw', 'cooked', 'dried', 'frozen', 'fermented', 'pickled',

  // Form (5)
  'whole', 'bone', 'liquid', 'sauce', 'fat',

  // Flavor properties (6)
  'spicy', 'acidic', 'sweet', 'bitter', 'umami', 'aromatic',

  // Texture (4)
  'tender', 'tough', 'delicate', 'crunchy',

  // Functional roles (4)
  'oil', 'condiment', 'thickener', 'leavening',

  // Specialty (3)
  'chocolate', 'seaweed', 'algae',

  // Origin (5)
  'japanese', 'chinese', 'italian', 'mexican', 'french',
] as const;

const TAG_SET = new Set<string>(INGREDIENT_TAGS);

/**
 * Filter an arbitrary value down to known vocabulary tags.
 * Used at the edge function boundary so the AI can't pollute the tag set
 * with invented tags. Returns a deduplicated array of valid tags.
 */
export function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const normalized = t.trim().toLowerCase();
    if (TAG_SET.has(normalized)) seen.add(normalized);
  }
  return Array.from(seen);
}
