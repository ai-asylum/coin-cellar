// Tool catalogue — same slugs as the shared infinite-kitchen tools table, so
// sprite icons and action verbs are fetched from the same backend the cooking
// project uses. There's no upgrade shop wired up here yet, so every tool is a
// starter and the whole bench is available from the first visit.
export const TOOL_DEFS = [
  // slug, holdable, maxInputs
  { slug: "hands", name: "Hands", holdable: true, maxInputs: 3, starter: true },
  { slug: "knife", name: "Knife", holdable: true, maxInputs: 1, starter: true },
  { slug: "whisk", name: "Whisk", holdable: true, maxInputs: 3, starter: true },
  { slug: "grater", name: "Grater", holdable: true, maxInputs: 1, starter: true },
  { slug: "rolling_pin", name: "Rolling Pin", holdable: true, maxInputs: 1, starter: true },
  { slug: "blender", name: "Blender", holdable: true, maxInputs: 5, starter: true },
  { slug: "mortar", name: "Mortar", holdable: true, maxInputs: 3, starter: true },
  { slug: "peeler", name: "Peeler", holdable: true, maxInputs: 1, starter: true },
  { slug: "stove", name: "Stove", holdable: false, maxInputs: 5, starter: true },
  { slug: "pot", name: "Pot", holdable: false, maxInputs: 5, starter: true },
  { slug: "oven", name: "Oven", holdable: false, maxInputs: 5, starter: true },
  { slug: "freezer", name: "Freezer", holdable: false, maxInputs: 1, starter: true },
  { slug: "grill", name: "Grill", holdable: false, maxInputs: 3, starter: true },
  { slug: "deep_fryer", name: "Deep Fryer", holdable: false, maxInputs: 4, starter: true },
  { slug: "smoker", name: "Smoker", holdable: false, maxInputs: 3, starter: true },
  { slug: "barrel", name: "Barrel", holdable: false, maxInputs: 1, starter: true },
];

// Plating vessels — same slugs as infinite-kitchen's PLATING_VESSEL_SLUGS.
export const VESSELS = [
  { slug: "plate", name: "Plate", maxInputs: 10 },
  { slug: "bowl", name: "Bowl", maxInputs: 6 },
  { slug: "cup", name: "Cup", maxInputs: 3 },
];
