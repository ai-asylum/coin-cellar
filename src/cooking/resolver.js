// Combination resolver — same flow as infinite-kitchen:
//
//   1. cache-first read of our `interactions` table (hash-compatible)
//   2. miss → `interact` edge function (which consults IK's community cache
//      server-side before spending an AI call)
//   3. offline / backend failure → hand-tuned local rules table
//
// All three paths return the same internal shape the kitchen consumes:
//   { outcomeType, modified: [{ index, states }], outputs: [{ slug, name,
//     emoji, states, spriteUrl }], consumedIdx: [i], verb, description,
//     isFirstDiscovery, isLocalFirst }
import { TOOL_RULES, RECIPE_INDEX, recipeKey, BURN_PROGRESSION, SEASONINGS, MARINADES } from "./data/rules.js";
import { applyState, removeState } from "./data/states.js";
import { supabase, FUNCTION_URL, getAuthHeaders, authReady, isOnline } from "./net/supabase.js";
import { playerName, titleCase } from "./net/backend.js";
import { save } from "./save.js";

// State-aware hash — byte-identical to infinite-kitchen's generateInputHashV2.
export function inputHash(toolSlug, items) {
  const descriptors = items
    .map((item) => {
      const states = [...item.states].sort().join(",");
      return `${item.slug.toLowerCase()}|${states}`;
    })
    .sort();
  return `${toolSlug.toLowerCase()}+${descriptors.join("+")}`;
}

// Session-scoped memo of resolved combos. Keyed by the *ordered* signature
// (not the sorted hash) so the input-index fields in `modified`/`consumedIdx`
// stay valid on replay. Makes a combo you've already made this session
// resolve instantly — no Supabase round-trip at all.
const _memCache = new Map();

function memKey(toolSlug, items) {
  return (
    toolSlug.toLowerCase() +
    "|" +
    items
      .map((i) => `${i.slug.toLowerCase()}:${[...i.states].sort().join(",")}`)
      .join("+")
  );
}

function cloneResult(r) {
  return typeof structuredClone === "function"
    ? structuredClone(r)
    : JSON.parse(JSON.stringify(r));
}

export function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .slice(0, 80);
}

export async function resolve({ toolSlug, items }) {
  const hash = inputHash(toolSlug, items);
  const isLocalFirst = !save.data.discoveries[hash];

  // 0. session memo — instant replay of a combo already resolved this session
  const key = memKey(toolSlug, items);
  if (_memCache.has(key)) {
    const result = cloneResult(_memCache.get(key));
    result.isFirstDiscovery = false; // only the very first make counts
    result.hash = hash;
    result.isLocalFirst = isLocalFirst && result.outcomeType !== "no_effect";
    if (result.isLocalFirst) recordLocalDiscovery(hash, result);
    return result;
  }

  let result = null;

  // 1. our interactions cache, straight from the table
  try {
    const { data: cached } = await supabase
      .from("interactions")
      .select("result_json, discovered_by")
      .eq("input_hash", hash)
      .maybeSingle();
    if (cached?.result_json) {
      result = adaptBackendResult(cached.result_json, toolSlug, items);
      result.isFirstDiscovery = false;
      result.discoveredBy = cached.discovered_by;
    }
  } catch {
    /* offline — fall through */
  }

  // 2. edge function (community-cache fallback + AI live server-side)
  if (!result) {
    result = await callInteract(toolSlug, items, hash);
  }

  // 3. hand-tuned rules, always available offline
  if (!result) {
    result = resolveRules(toolSlug, items);
  }

  // memo the raw verdict (no_effect included — those are cheap to replay too)
  _memCache.set(key, cloneResult(result));

  result.hash = hash;
  result.isLocalFirst = isLocalFirst && result.outcomeType !== "no_effect";
  if (result.isLocalFirst) recordLocalDiscovery(hash, result);
  return result;
}

function recordLocalDiscovery(hash, result) {
  save.data.discoveries[hash] = {
    at: Date.now(),
    out: result.outputs.map((o) => o.slug),
  };
  save.persist();
}

async function callInteract(toolSlug, items, hash) {
  await authReady();
  if (!isOnline()) return null;
  try {
    const res = await fetch(`${FUNCTION_URL}/interact`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        toolSlug,
        items: items.map((i) => ({
          id: i.uid ? String(i.uid) : i.slug,
          slug: i.slug,
          name: i.name,
          states: i.states,
          description: i.description || "",
        })),
        userName: playerName(),
      }),
    });
    if (!res.ok) {
      console.warn(`[resolver] interact ${res.status}: ${(await res.text()).slice(0, 150)}`);
      return null;
    }
    const raw = await res.json();
    const result = adaptBackendResult(raw, toolSlug, items);
    result.isFirstDiscovery = !!raw.isFirstDiscovery;
    result.discoveredBy = raw.discoveredBy;
    return result;
  } catch (err) {
    console.warn("[resolver] interact failed:", err?.message);
    return null;
  }
}

// Backend InteractionResultV2 → internal shape. The backend speaks in input
// indices (modified[].inputIndex, consumedInputs); outputs carry sprite URLs.
function adaptBackendResult(raw, toolSlug, items) {
  const verb = TOOL_RULES[toolSlug]?.verb || "used";
  const out = {
    outcomeType: raw.outcomeType || "no_effect",
    modified: [],
    outputs: [],
    consumedIdx: Array.isArray(raw.consumedInputs) ? [...raw.consumedInputs] : [],
    verb,
    description: raw.description || "",
  };

  if (raw.outcomeType === "modify") {
    for (const m of raw.modified || []) {
      const item = items[m.inputIndex];
      if (!item) continue;
      let states = [...item.states];
      for (const s of m.removeStates || []) states = removeState(states, s);
      for (const s of m.addStates || []) states = applyState(states, s);
      out.modified.push({ index: m.inputIndex, states });
    }
  } else if (raw.outcomeType === "transform" || raw.outcomeType === "multi_output") {
    out.outputs = (raw.outputs || []).map((o) => ({
      slug: nameToSlug(o.name || "mystery"),
      name: o.name || "Mystery",
      emoji: o.emoji || "",
      states: o.states || [],
      spriteUrl: o.spriteUrl || null,
      description: o.description || "",
    }));
    // transforms consume every input unless the backend says otherwise
    if (!out.consumedIdx.length) out.consumedIdx = items.map((_, i) => i);
  }
  return out;
}

// ------------------------------------------------- local rules (offline)

function resolveRules(toolSlug, items) {
  const slugs = items.map((i) => i.slug);

  // 1. Specific recipe?
  const rule = RECIPE_INDEX.get(recipeKey(toolSlug, slugs));
  if (rule) {
    return {
      outcomeType: rule.outputs.length > 1 ? "multi_output" : "transform",
      modified: [],
      outputs: rule.outputs.map((o) => ({ ...o, states: o.states || [], spriteUrl: null })),
      consumedIdx: items.map((_, i) => i),
      verb: rule.verb,
      description: "",
      isFirstDiscovery: false,
    };
  }

  const tool = TOOL_RULES[toolSlug];
  if (!tool) return noEffect();

  // 2. Seasoning with hands: food + seasoning → SEASONED / MARINATED food.
  if (toolSlug === "hands" && items.length >= 2) {
    const seasoningIdx = items.map((i, idx) => (SEASONINGS.includes(i.slug) ? idx : -1)).filter((x) => x >= 0);
    const marinadeIdx = items.map((i, idx) => (MARINADES.includes(i.slug) ? idx : -1)).filter((x) => x >= 0);
    const foodIdx = items.map((_, idx) => idx).filter((idx) => !seasoningIdx.includes(idx) && !marinadeIdx.includes(idx));
    if (foodIdx.length >= 1 && (seasoningIdx.length || marinadeIdx.length)) {
      const addSt = marinadeIdx.length ? "MARINATED" : "SEASONED";
      return {
        outcomeType: "modify",
        modified: foodIdx.map((idx) => ({ index: idx, states: applyState(items[idx].states, addSt) })),
        outputs: [],
        consumedIdx: [...seasoningIdx, ...marinadeIdx],
        verb: marinadeIdx.length ? "marinated" : "seasoned",
        description: "",
        isFirstDiscovery: false,
      };
    }
  }

  // 3. Generic modify tools (heat / freeze / dry / ferment).
  if (tool.kind === "modify") {
    const adds = Array.isArray(tool.add) ? tool.add : [tool.add];
    let verb = tool.verb;
    const modified = items.map((item, index) => {
      let states = item.states;
      if (tool.burns && adds.includes("HOT")) {
        const worst = ["ON_FIRE", "CHARRED", "BURNT", "HOT"].find((s) => states.includes(s));
        if (worst && BURN_PROGRESSION[worst]) {
          verb = "burnt";
          return { index, states: applyState(states, BURN_PROGRESSION[worst]) };
        }
      }
      for (const s of adds) states = applyState(states, s);
      return { index, states };
    });
    const changed = modified.some((m) => m.states.join() !== items[m.index].states.join());
    if (!changed) return noEffect();
    return { outcomeType: "modify", modified, outputs: [], consumedIdx: [], verb, description: "", isFirstDiscovery: false };
  }

  // 4. Generic transform tools (knife, grater...) — single input only.
  if (tool.kind === "transform" && items.length === 1) {
    const item = items[0];
    if (item.slug.startsWith(tool.prefix + "_")) return noEffect();
    return {
      outcomeType: "transform",
      modified: [],
      outputs: [{
        slug: `${tool.prefix}_${item.slug}`,
        name: `${titleCase(tool.prefix)} ${item.name}`,
        emoji: "",
        states: item.states,
        spriteUrl: null,
      }],
      consumedIdx: [0],
      verb: tool.verb,
      description: "",
      isFirstDiscovery: false,
    };
  }

  // 5. Generic combine tools (whisk/blender/hands) with 2+ inputs → mixture.
  if ((tool.kind === "combine" || toolSlug === "mortar") && items.length >= 2) {
    const base = items.map((i) => i.name).join(" & ");
    const slug = slugs.sort().join("_").slice(0, 60) + "_" + (tool.output || "paste");
    return {
      outcomeType: "transform",
      modified: [],
      outputs: [{ slug, name: `${base} ${titleCase(tool.output || "paste")}`, emoji: "🥣", states: [], spriteUrl: null }],
      consumedIdx: items.map((_, i) => i),
      verb: tool.verb,
      description: "",
      isFirstDiscovery: false,
    };
  }

  return noEffect();
}

function noEffect() {
  return { outcomeType: "no_effect", modified: [], outputs: [], consumedIdx: [], verb: "tried", description: "", isFirstDiscovery: false };
}
