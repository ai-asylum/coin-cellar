// Calls into the shared cooking Supabase backend (same project the
// infinite-restaurant game uses). Every function degrades gracefully to a
// local fallback so the kitchen stays playable offline.
import { supabase, FUNCTION_URL, getAuthHeaders, getUserId, isOnline, authReady } from "./supabase.js";
import { ingredientDef, localArt } from "../ingredients.js";

// ------------------------------------------------------------- catalogue

// Ingredient rows by slug: { slug, name, emoji, sprite_url, category,
// description }. Cached forever. Coin Cellar's own wares resolve straight
// from the local catalogue (game art, no round-trip); only backend-born
// discoveries hit the ingredients table.
const _ingredientCache = new Map();

export async function fetchIngredients(slugs) {
  let missing = slugs.filter((s) => !_ingredientCache.has(s));
  for (const s of missing) {
    const def = ingredientDef(s);
    if (def) {
      _ingredientCache.set(s, {
        slug: s,
        name: def.name,
        emoji: def.emoji,
        sprite_url: localArt(s),
        category: def.category,
        description: def.description,
      });
    }
  }
  missing = missing.filter((s) => !_ingredientCache.has(s));
  if (missing.length) {
    try {
      const { data } = await supabase
        .from("ingredients")
        .select("slug, name, emoji, sprite_url, category, description")
        .in("slug", missing);
      for (const row of data || []) _ingredientCache.set(row.slug, row);
    } catch {
      /* offline — fallbacks fill in below */
    }
    for (const s of missing) {
      if (!_ingredientCache.has(s)) {
        _ingredientCache.set(s, { slug: s, name: titleCase(s), emoji: "", sprite_url: null });
      }
    }
  }
  return slugs.map((s) => _ingredientCache.get(s));
}

export async function lookupIngredient(slug) {
  return (await fetchIngredients([slug]))[0];
}

export async function fetchTools(slugs) {
  try {
    const { data } = await supabase
      .from("tools")
      .select("slug, name, is_holdable, mode, max_inputs, sprite_url, sprite_icon_url, action_verb")
      .in("slug", slugs);
    const bySlug = new Map((data || []).map((t) => [t.slug, t]));
    return slugs.map((s) => bySlug.get(s) || null).filter(Boolean);
  } catch {
    return [];
  }
}

// ------------------------------------------------------- discovery cache

// Read-only peek at our community interactions cache, keyed by the combo
// input hash.
export async function checkSharedInteraction(inputHash) {
  try {
    const { data } = await supabase
      .from("interactions")
      .select("result_json, discovered_by, discovery_count")
      .eq("input_hash", inputHash)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ serve-dish

// LLM names the dish and decides its value (coins) — this is the "price
// decided by the LLM" moment when a dish is plated into the cookbook.
export async function serveDishRemote(ingredients, steps, vessel) {
  await authReady();
  if (!isOnline()) return null;
  const payload = JSON.stringify({
    ingredients,
    steps,
    vessel,
    userId: getUserId(),
    userName: playerName(),
    earnedBadgeIds: [],
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${FUNCTION_URL}/serve-dish`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: payload,
      });
      if (res.ok) return await res.json(); // { dishId, aiDishName, badgesEarned, totalCoins }
      const text = await res.text().catch(() => "");
      console.warn(`[net] serve-dish ${res.status}: ${text.slice(0, 200)}`);
      if (res.status < 500) return null; // 4xx won't improve on retry
    } catch (err) {
      console.warn("[net] serve-dish failed:", err?.message);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

// ------------------------------------------------------------ score-order

// The LLM "hungry customer" judge. Used for two things:
//  - craving checks (does this cookbook dish satisfy the craving?)
//  - critic reviews (does this dish live up to the critic's taste?)
export async function judgeDish({ title, description, reward, ingredientNames }) {
  await authReady();
  if (!isOnline()) return null;
  try {
    const res = await fetch(`${FUNCTION_URL}/score-order`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        orders: [
          {
            orderId: "craving-" + Date.now(),
            dishName: title,
            description,
            baseCoinReward: reward,
          },
        ],
        ingredientNames,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // shape: { orderId, dishName, score (0-5), feedback, coinsEarned }
    return Array.isArray(data) ? data[0] : data.results?.[0] || data;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- menu sync

// Best-effort mirror of the local 5-slot menu into the backend so the
// restaurant participates in the critic circuit.
export async function addMenuSlotRemote(slotIndex, dishId) {
  await authReady();
  if (!isOnline() || !dishId) return null;
  try {
    const res = await fetch(`${FUNCTION_URL}/add-menu-slot`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ slot_index: slotIndex, dish_id: dishId }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function removeMenuSlotRemote(slotIndex) {
  await authReady();
  if (!isOnline()) return null;
  try {
    const res = await fetch(`${FUNCTION_URL}/remove-menu-slot`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ slot_index: slotIndex }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- helpers

export function playerName() {
  let name = localStorage.getItem("cc_cook_name");
  if (!name) {
    const a = ["Sizzling", "Golden", "Copper", "Dungeon", "Rustic", "Midnight", "Brave"];
    const b = ["Spoon", "Ladle", "Skillet", "Cauldron", "Cleaver", "Apron", "Tankard"];
    name = `${a[(Math.random() * a.length) | 0]} ${b[(Math.random() * b.length) | 0]}`;
    localStorage.setItem("cc_cook_name", name);
  }
  return name;
}

export function titleCase(slug) {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
