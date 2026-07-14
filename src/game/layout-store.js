// Holds the world layout (src/game/layout.json) the shop builds from.
// Injected rather than imported by shop-build.js so the same build code can
// serve two masters: the game statically imports layout.json and sets it
// (game.js), while the overworld editor fetches the live file via /api/layout
// and sets whatever it's editing. Keeping the JSON out of the editor's module
// graph also means saving from the editor doesn't trigger a Vite reload of
// the editor page itself.
let LAYOUT = null;

export function setLayout(layout) {
  LAYOUT = layout;
}

export function getLayout() {
  if (!LAYOUT) throw new Error("layout not loaded — setLayout() must run before the shop builds");
  return LAYOUT;
}
