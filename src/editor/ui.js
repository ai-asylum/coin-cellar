// Tiny DOM helpers shared by the editor's panels (overworld + dungeon tabs).

export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const c of children) n.append(c);
  return n;
}

export function row(labelText, ...inputs) {
  return el("div", { className: "row" }, el("label", { textContent: labelText }), ...inputs);
}

export function numInput(value, oncommit, step = 0.1) {
  return el("input", {
    type: "number", step: String(step), value: String(value),
    onchange(e) { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) oncommit(v); },
  });
}

// hex number (0xrrggbb) ↔ <input type=color> value ("#rrggbb")
export const hexToCss = (h) => `#${(h & 0xffffff).toString(16).padStart(6, "0")}`;
export const cssToHex = (s) => parseInt(s.slice(1), 16);

export function colorInput(hex, oncommit) {
  return el("input", {
    type: "color", value: hexToCss(hex),
    onchange(e) { oncommit(cssToHex(e.target.value)); },
  });
}
