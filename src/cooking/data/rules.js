// Hand-tuned interaction rules. This is the deterministic rules table that
// sits behind the resolver interface (an AI resolver can replace it later —
// same interface, see cooking/resolver.js).
//
// Rule kinds:
//   modify      — add/remove states on the inputs (stove heats, freezer freezes)
//   transform   — inputs are consumed, new ingredient(s) come out
//   multi_output— one input becomes several outputs
//   no_effect   — nothing happens (default when no rule matches)
//
// Specific recipes are keyed on tool + sorted input slugs (states ignored for
// matching, checked via `when` if a rule needs them). Generic tool rules
// apply when no specific recipe matches.

// --------------------------------------------------------- generic tools

// Per-tool default behaviour. verb feeds the step log.
export const TOOL_RULES = {
  stove: { kind: "modify", add: "HOT", verb: "pan-fried", burns: true },
  oven: { kind: "modify", add: "HOT", verb: "roasted", burns: true },
  pot: { kind: "modify", add: ["HOT", "WET"], verb: "boiled", burns: false },
  grill: { kind: "modify", add: "HOT", verb: "grilled", burns: true, char: true },
  deep_fryer: { kind: "modify", add: "HOT", verb: "deep-fried", burns: true },
  freezer: { kind: "modify", add: "FROZEN", verb: "froze" },
  smoker: { kind: "modify", add: ["DRIED", "SEASONED"], verb: "smoked" },
  barrel: { kind: "modify", add: "FERMENTED", verb: "fermented" },
  knife: { kind: "transform", prefix: "chopped", verb: "chopped" },
  grater: { kind: "transform", prefix: "grated", verb: "grated" },
  peeler: { kind: "transform", prefix: "peeled", verb: "peeled" },
  rolling_pin: { kind: "transform", prefix: "flattened", verb: "rolled out" },
  mortar: { kind: "transform", prefix: "crushed", verb: "crushed", combine: "paste" },
  whisk: { kind: "combine", output: "mixture", verb: "whisked" },
  blender: { kind: "combine", output: "puree", verb: "blended" },
  hands: { kind: "combine", output: "mix", verb: "combined" },
};

// Tools that push HOT items to BURNT when applied twice.
export const BURN_PROGRESSION = { HOT: "BURNT", BURNT: "CHARRED", CHARRED: "ON_FIRE" };

// ------------------------------------------------------ specific recipes

// key: `${tool}:${sorted input slugs joined by +}` (base slugs, states free)
// out: outputs [{ slug, name, emoji, states? }] — consumed inputs vanish.
function r(tool, inputs, outputs, verb) {
  return {
    key: `${tool}:${[...inputs].sort().join("+")}`,
    tool,
    inputs,
    outputs,
    verb,
  };
}

export const RECIPES = [
  // -- doughs & batters
  r("hands", ["flour", "water"], [{ slug: "dough", name: "Dough", emoji: "🥟" }], "kneaded"),
  r("hands", ["flour", "egg"], [{ slug: "pasta_dough", name: "Pasta Dough", emoji: "🍝" }], "kneaded"),
  r("whisk", ["egg", "flour", "milk"], [{ slug: "batter", name: "Batter", emoji: "🥣" }], "whisked"),
  r("whisk", ["egg", "milk"], [{ slug: "custard_base", name: "Custard Base", emoji: "🍮" }], "whisked"),
  r("whisk", ["egg"], [{ slug: "beaten_egg", name: "Beaten Egg", emoji: "🥚" }], "beat"),
  r("whisk", ["cream"], [{ slug: "whipped_cream", name: "Whipped Cream", emoji: "🍦" }], "whipped"),
  r("whisk", ["cream", "sugar"], [{ slug: "sweet_whipped_cream", name: "Sweet Whipped Cream", emoji: "🍦" }], "whipped"),

  // -- stove classics
  r("stove", ["batter"], [{ slug: "pancake", name: "Pancake", emoji: "🥞", states: ["HOT"] }], "griddled"),
  r("stove", ["beaten_egg"], [{ slug: "omelette", name: "Omelette", emoji: "🍳", states: ["HOT"] }], "fried"),
  r("stove", ["egg"], [{ slug: "fried_egg", name: "Fried Egg", emoji: "🍳", states: ["HOT"] }], "fried"),
  r("stove", ["custard_base"], [{ slug: "custard", name: "Custard", emoji: "🍮", states: ["HOT"] }], "cooked"),
  r("pot", ["egg"], [{ slug: "boiled_egg", name: "Boiled Egg", emoji: "🥚", states: ["HOT"] }], "boiled"),
  r("pot", ["rice", "water"], [{ slug: "cooked_rice", name: "Cooked Rice", emoji: "🍚", states: ["HOT"] }], "simmered"),
  r("pot", ["noodles", "water"], [{ slug: "cooked_noodles", name: "Cooked Noodles", emoji: "🍜", states: ["HOT"] }], "boiled"),
  r("pot", ["tomato", "onion"], [{ slug: "tomato_sauce", name: "Tomato Sauce", emoji: "🥫", states: ["HOT"] }], "simmered"),
  r("pot", ["chocolate", "milk"], [{ slug: "hot_chocolate", name: "Hot Chocolate", emoji: "☕", states: ["HOT"] }], "melted in"),
  r("pot", ["chicken_breast", "water"], [{ slug: "chicken_broth", name: "Chicken Broth", emoji: "🍲", states: ["HOT"] }], "simmered"),

  // -- oven
  r("oven", ["dough"], [{ slug: "bread", name: "Bread", emoji: "🍞", states: ["HOT"] }], "baked"),
  r("oven", ["flattened_dough", "tomato_sauce", "grated_cheddar_cheese"], [{ slug: "pizza", name: "Pizza", emoji: "🍕", states: ["HOT"] }], "baked"),
  r("oven", ["batter", "chocolate"], [{ slug: "chocolate_cake", name: "Chocolate Cake", emoji: "🍰", states: ["HOT"] }], "baked"),
  r("oven", ["batter", "sugar"], [{ slug: "sponge_cake", name: "Sponge Cake", emoji: "🍰", states: ["HOT"] }], "baked"),
  r("oven", ["potato"], [{ slug: "baked_potato", name: "Baked Potato", emoji: "🥔", states: ["HOT"] }], "baked"),

  // -- knife specifics (things a bare prefix would name badly)
  r("knife", ["bread"], [{ slug: "bread_slices", name: "Bread Slices", emoji: "🍞" }], "sliced"),
  r("knife", ["potato"], [{ slug: "potato_sticks", name: "Potato Sticks", emoji: "🍟" }], "cut"),
  r("deep_fryer", ["potato_sticks"], [{ slug: "fries", name: "Fries", emoji: "🍟", states: ["HOT"] }], "deep-fried"),

  // -- combos
  r("hands", ["bread_slices", "cheddar_cheese"], [{ slug: "cheese_sandwich", name: "Cheese Sandwich", emoji: "🥪" }], "assembled"),
  r("stove", ["cheese_sandwich", "butter"], [{ slug: "grilled_cheese", name: "Grilled Cheese", emoji: "🥪", states: ["HOT"] }], "toasted"),
  r("hands", ["cooked_noodles", "tomato_sauce"], [{ slug: "spaghetti", name: "Spaghetti", emoji: "🍝" }], "tossed"),
  r("hands", ["lettuce", "tomato"], [{ slug: "salad", name: "Salad", emoji: "🥗" }], "tossed"),
  r("blender", ["strawberry", "milk"], [{ slug: "strawberry_smoothie", name: "Strawberry Smoothie", emoji: "🥤" }], "blended"),
  r("blender", ["banana", "milk"], [{ slug: "banana_smoothie", name: "Banana Smoothie", emoji: "🥤" }], "blended"),
  r("blender", ["tomato"], [{ slug: "tomato_juice", name: "Tomato Juice", emoji: "🧃" }], "blended"),
  r("blender", ["apple"], [{ slug: "apple_juice", name: "Apple Juice", emoji: "🧃" }], "juiced"),
  r("mortar", ["basil", "garlic", "olive_oil"], [{ slug: "pesto", name: "Pesto", emoji: "🌿" }], "ground"),
  r("hands", ["cooked_rice", "mushroom"], [{ slug: "mushroom_rice", name: "Mushroom Rice", emoji: "🍚" }], "folded"),
  r("freezer", ["custard"], [{ slug: "ice_cream", name: "Ice Cream", emoji: "🍨", states: ["FROZEN"] }], "churned"),
  r("freezer", ["strawberry_smoothie"], [{ slug: "strawberry_sorbet", name: "Strawberry Sorbet", emoji: "🍧", states: ["FROZEN"] }], "froze"),
  r("freezer", ["water"], [{ slug: "ice", name: "Ice", emoji: "🧊", states: ["FROZEN"] }], "froze"),
  r("rolling_pin", ["dough"], [{ slug: "flattened_dough", name: "Flattened Dough", emoji: "🫓" }], "rolled out"),
  r("stove", ["chicken_breast", "butter"], [{ slug: "butter_chicken_fillet", name: "Butter Chicken Fillet", emoji: "🍗", states: ["HOT"] }], "pan-seared"),

  // -- seasoning as modify-style recipes (salt/pepper/herbs never consumed alone)
];

// Seasoning ingredients: combining them onto food adds SEASONED instead of
// creating a new ingredient. Marinade liquids add MARINATED.
export const SEASONINGS = ["salt", "pepper", "chili", "basil", "sugar", "honey"];
export const MARINADES = ["olive_oil", "lemon"];

export const RECIPE_INDEX = new Map(RECIPES.map((rule) => [rule.key, rule]));

export function recipeKey(tool, slugs) {
  return `${tool}:${[...slugs].sort().join("+")}`;
}
