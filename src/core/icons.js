// Icon set. Two kinds of glyph live here:
//
//  1. MASK icons — flat pictograms from the Layer Lab "GUI Pro / Minimal" packs
//     (see the private ai-asylum/2d-game-assets repo). The PNGs live in
//     public/icons/<name>.png and are rendered as CSS masks tinted with
//     `currentColor`, so a white-on-transparent sprite picks up the surrounding
//     text colour exactly like the old inline SVGs did. A few carry a fixed
//     colour cue (hearts red, coins/crown gold).
//
//  2. SVG icons — the mood faces + emote bubbles (the packs only ship two
//     smileys, nowhere near our nine haggle expressions) and the small admin
//     creature badges. These stay inline so they can be tinted / animated and
//     so the day/night clock can embed the sun & moon straight into its SVG.
//
// `icon(name)` returns an HTML string; sizing is CSS (`.ic { width:1em }`).

// ------------------------------------------------------------- masked pictos
// name === file basename in public/icons/, unless overridden below.
const MASK = new Set([
  "coin", "moneyfly", "scroll", "bag", "people", "soundOn", "soundOff",
  "pause", "play", "close", "plus", "arrowDown", "arrowLeft", "skip", "undo",
  "recycle", "trash", "shield", "tools", "warning", "speak", "hole", "bed",
  "home", "chest", "crown", "shop", "shopping", "skull", "dice", "walk",
  "flask", "jelly", "herb", "ring", "dagger", "potion", "amulet",
  "lantern", "fang", "tome", "gem", "heart", "box", "sword", "swords", "bread",
]);

// ------------------------------------------------------------- colour items
// The merchandise deserves full-colour art (a monochrome silhouette reads as
// dull "UI chrome"), so sellable items render the colour PNGs in public/items/
// verbatim — no mask, no currentColor tint — via `itemIcon()`. The key is the
// item's `icon` field (see game/items.js); the file is public/items/<key>.png.
const COLOR = new Set([
  "caveshroom", "jelly", "herb", "bread", "sword", "potion", "ring", "dagger",
  "lantern", "amulet", "swords", "tome", "gem", "fang", "crown",
  "mushroom", "meat", "egg", "key", "bomb", "shield", "bell", "feather",
  "hourglass", "star",
]);

// ------------------------------------------------------------- mood faces
const F_BG = "#f6c744";
const F_LINE = "#4a3210";
const F_STROKE = "#c99a1a";
const mface = (feat) =>
  `<circle cx="12" cy="12" r="10" fill="${F_BG}" stroke="${F_STROKE}" stroke-width="1"/>${feat}`;
const eyeDot = (x, y = 10.5) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${F_LINE}"/>`;
const EYES = eyeDot(8.7) + eyeDot(15.3);
const SMILE = `<path d="M8.3 14q3.7 3.2 7.4 0" stroke="${F_LINE}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
const FLAT = `<line x1="9" y1="15" x2="15" y2="15" stroke="${F_LINE}" stroke-width="1.6" stroke-linecap="round"/>`;
const FROWN = `<path d="M8.3 16q3.7-3.2 7.4 0" stroke="${F_LINE}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
const starEye = (x) =>
  `<path d="M${x} 8.4l.7 1.5 1.6.2-1.2 1.1.3 1.6L${x} 12.1l-1.4.7.3-1.6-1.2-1.1 1.6-.2z" fill="${F_LINE}"/>`;

// ------------------------------------------------------------- inline SVG set
const SVG = {
  // day / night (also embedded directly into the HUD clock)
  sun: `<circle cx="12" cy="12" r="4.2" fill="#f6b73c"/><g stroke="#f6b73c" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="7" y2="7"/><line x1="17" y1="17" x2="18.8" y2="18.8"/><line x1="18.8" y1="5.2" x2="17" y2="7"/><line x1="7" y1="17" x2="5.2" y2="18.8"/></g>`,
  moon: `<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.2A7 7 0 0 1 15.5 3.5z" fill="#cdd7ff"/>`,

  // mood faces
  faceHappy: mface(EYES + SMILE),
  faceNeutral: mface(EYES + FLAT),
  faceSmile: mface(
    `<path d="M7 11q1.7-2 3.4 0" stroke="${F_LINE}" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M13.6 11q1.7-2 3.4 0" stroke="${F_LINE}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
      SMILE
  ),
  faceStar: mface(
    starEye(8.7) + starEye(15.3) + `<path d="M8.6 14.5h6.8a3.4 3.4 0 0 1-6.8 0z" fill="${F_LINE}"/>`
  ),
  faceMonocle: mface(
    eyeDot(8.7) +
      `<circle cx="15.3" cy="10.8" r="2.7" fill="none" stroke="${F_LINE}" stroke-width="1"/><circle cx="15.3" cy="10.8" r="1.3" fill="${F_LINE}"/><path d="M15.3 13.5v2.3" stroke="${F_LINE}" stroke-width=".9"/>` +
      `<path d="M6.8 7.8l3-.9" stroke="${F_LINE}" stroke-width="1.3" stroke-linecap="round"/>` +
      FLAT
  ),
  faceRoll: mface(eyeDot(8.7, 9) + eyeDot(15.3, 9) + FLAT),
  faceThink: mface(
    EYES +
      `<path d="M6.6 8l3.2-.6" stroke="${F_LINE}" stroke-width="1.3" stroke-linecap="round"/>` +
      `<path d="M11 16q2-1.2 4.5-.4" stroke="${F_LINE}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  ),
  faceHuff: mface(
    `<path d="M7 9.4l2.8-1M17 9.4l-2.8-1" stroke="${F_LINE}" stroke-width="1.4" stroke-linecap="round"/>` +
      eyeDot(8.9, 11) +
      eyeDot(15.1, 11) +
      FROWN +
      `<path d="M8.2 5.6q-1-1.2 0-2.6M10 5.2q-.8-1 0-2.2" stroke="#8fd0ff" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
  ),
  faceConfused: mface(
    EYES + `<path d="M8.5 15.5q1.75-1.6 3.5 0t3.5 0" stroke="${F_LINE}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  ),
  faceAngry: mface(
    `<path d="M7 8.6l3.2 1.3M17 8.6l-3.2 1.3" stroke="${F_LINE}" stroke-width="1.5" stroke-linecap="round"/>` +
      eyeDot(9, 11.4) +
      eyeDot(15, 11.4) +
      FROWN
  ),

  // emote bubbles
  alert: `<rect x="10.4" y="4" width="3.2" height="10" rx="1.6" fill="#e23b4e"/><circle cx="12" cy="18.2" r="1.9" fill="#e23b4e"/>`,
  thought: `<path d="M8.5 13a3 3 0 0 1-.4-6 4 4 0 0 1 7.6-.6A3 3 0 0 1 16 13z" fill="#fdfaf0" stroke="#c9bfa6" stroke-width="1"/><circle cx="8" cy="16.5" r="1.3" fill="#fdfaf0" stroke="#c9bfa6" stroke-width="1"/><circle cx="5.8" cy="19.5" r=".9" fill="#fdfaf0" stroke="#c9bfa6" stroke-width="1"/>`,
  anger: `<path d="M12 6v12M8 8l8 8M16 8l-8 8" stroke="#e23b4e" stroke-width="1.7" stroke-linecap="round"/>`,

  // admin creature badges (the catalogue also renders the real 3D models)
  spider: `<circle cx="12" cy="13" r="3.2" fill="#3a2f4a"/><circle cx="12" cy="8.6" r="2" fill="#3a2f4a"/><g stroke="#3a2f4a" stroke-width="1.5" stroke-linecap="round"><path d="M9.5 12L5 9M9.3 13.6L4.5 13.4M9.5 15.2L6 18"/><path d="M14.5 12L19 9M14.7 13.6L19.5 13.4M14.5 15.2L18 18"/></g><circle cx="11" cy="8.3" r=".6" fill="#f4c542"/><circle cx="13" cy="8.3" r=".6" fill="#f4c542"/>`,
  goblin: `<path d="M6 6l3.2 3.4M18 6l-3.2 3.4" stroke="#3f7a35" stroke-width="2" stroke-linecap="round"/><path d="M12 6c-3.5 0-6 2.8-6 6.5S8.5 20 12 20s6-3.8 6-7.5S15.5 6 12 6z" fill="#5fa53f" stroke="#3f7a35" stroke-width="1"/><circle cx="9.5" cy="12" r="1.1" fill="#1c3a12"/><circle cx="14.5" cy="12" r="1.1" fill="#1c3a12"/><path d="M9 16q3 2 6 0" stroke="#1c3a12" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  ghost: `<path d="M6 12a6 6 0 0 1 12 0v7l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z" fill="#e8ecff" stroke="#b7bfe0" stroke-width="1" stroke-linejoin="round"/><circle cx="9.8" cy="11.5" r="1.1" fill="#4a4a6a"/><circle cx="14.2" cy="11.5" r="1.1" fill="#4a4a6a"/>`,
  ogre: `<path d="M7 7C6 5 4.5 4.5 4.5 4.5S5 7 6.5 8M17 7c1-2 2.5-2.5 2.5-2.5S19 7 17.5 8" fill="#b8452f" stroke="#8a3423" stroke-width="1" stroke-linejoin="round"/><path d="M12 6c-3.5 0-6 2.8-6 6.5S8.5 20 12 20s6-3.8 6-7.5S15.5 6 12 6z" fill="#d0563a" stroke="#8a3423" stroke-width="1"/><circle cx="9.5" cy="12" r="1.1" fill="#3a140c"/><circle cx="14.5" cy="12" r="1.1" fill="#3a140c"/><path d="M9.5 16h5M10.7 16v1.4M13.3 16v1.4" stroke="#3a140c" stroke-width="1.1" stroke-linecap="round"/>`,
  farmer: `<path d="M8 5a4 4 0 0 1 8 0z" fill="#c98a3a"/><circle cx="12" cy="9.5" r="3.6" fill="#e8b98a" stroke="#b98a5e" stroke-width="1"/><path d="M4.5 20c0-4.2 3.4-6.5 7.5-6.5s7.5 2.3 7.5 6.5z" fill="#6b8f4e" stroke="#4e6c37" stroke-width="1"/><path d="M7 5.5h10" stroke="#a5702f" stroke-width="1.2"/>`,

  // fallback
  unknown: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.2 9.5a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.1" fill="currentColor"/>`,
};

/**
 * Returns an inline HTML string for the named icon. MASK names render as a
 * `<i class="ic ic-mask …">` tinted PNG; everything else renders inline SVG.
 * `heartEmpty` reuses the heart sprite, dimmed.
 * @param {string} name
 * @param {{cls?: string}} [opts] extra class(es) to add
 */
const maskStyle = (name) => {
  const u = `url('icons/${name}.png')`;
  return `-webkit-mask-image:${u};mask-image:${u}`;
};

/**
 * Full-colour merchandise icon (used for sellable items). Renders the colour
 * PNG in public/items/ directly — no mask/tint — so the wares look lively next
 * to the monochrome UI glyphs. Falls back to the monochrome `icon()` glyph if
 * the name isn't a known colour item.
 * @param {string} name item icon key
 * @param {{cls?: string}} [opts]
 */
export function itemIcon(name, { cls = "" } = {}) {
  if (!COLOR.has(name)) return icon(name, { cls });
  const extra = cls ? " " + cls : "";
  return `<i class="ic ic-color ic-item-${name}${extra}" style="background-image:url('items/${name}.png')" aria-hidden="true"></i>`;
}

export function icon(name, { cls = "" } = {}) {
  const extra = cls ? " " + cls : "";
  // NB: the mask url() must live in the inline style, not a CSS custom property.
  // A relative url() inside `var(--icon)` gets resolved against the *stylesheet*
  // that consumes it (/src/style.css → /src/icons/…, a 404), whereas a url() in
  // the style attribute resolves against the document base — correct in dev and
  // under the base:"./" production build alike.
  if (name === "heartEmpty") {
    return `<i class="ic ic-mask ic-heart ic--empty${extra}" style="${maskStyle("heart")}" aria-hidden="true"></i>`;
  }
  if (MASK.has(name)) {
    return `<i class="ic ic-mask ic-${name}${extra}" style="${maskStyle(name)}" aria-hidden="true"></i>`;
  }
  const body = SVG[name] || SVG.unknown;
  return `<svg class="ic ic-${name}${extra}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
}

// Inline SVG bodies, exported for callers that embed them directly (the HUD
// clock stitches the sun/moon into its own <svg>).
export { SVG as ICONS };
