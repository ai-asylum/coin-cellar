// Ingredient art: Coin Cellar's base wares use the game's own colour PNGs
// (public/items/), discoveries prefer the sprite library in the shared
// Supabase storage, and everything else falls back to a procedurally drawn
// emoji chip so every item always has a face, even offline.
import { lookupIngredient } from "./net/backend.js";
import { localArt } from "./ingredients.js";

const _urlCache = new Map(); // slug → sprite url | null
const _chipCache = new Map(); // slug|emoji|name → dataURL

export async function spriteFor(slug, { name, emoji, plain = false } = {}) {
  const art = localArt(slug);
  if (art) return { url: art, generated: false };
  if (!_urlCache.has(slug)) {
    const row = await lookupIngredient(slug);
    _urlCache.set(slug, row?.sprite_url || null);
    if (row && !emoji) emoji = row.emoji;
    if (row && !name) name = row.name;
  }
  const url = _urlCache.get(slug);
  if (url) return { url, generated: false };
  // plain: initial-letter chip, no emoji glyph (recipe illustrations)
  return { url: chipSprite(slug, name || slug, plain ? "" : emoji), generated: true };
}

// Draw a round toon-style chip with the emoji (or initial) — matches the
// stepped-ramp look: flat fill, darker rim, single highlight.
export function chipSprite(slug, name, emoji) {
  const key = `${slug}|${emoji || ""}`;
  if (_chipCache.has(key)) return _chipCache.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const hue = [...slug].reduce((a, ch) => a + ch.charCodeAt(0) * 7, 0) % 360;
  g.fillStyle = `hsl(${hue} 62% 62%)`;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = `hsl(${hue} 55% 30%)`;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.beginPath();
  g.ellipse(45, 40, 20, 12, -0.6, 0, Math.PI * 2);
  g.fill();
  const glyph = emoji || (name || slug).charAt(0).toUpperCase();
  g.font = emoji ? "56px serif" : "bold 52px system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (!emoji) g.fillStyle = "#fff";
  g.fillText(glyph, 64, 68);
  const url = c.toDataURL();
  _chipCache.set(key, url);
  return url;
}
