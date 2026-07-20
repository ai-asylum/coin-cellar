// Boot for /cooking.html — the 2D kitchen as its own page, ported from the
// infinite-restaurant project. No 3D world here: the kitchen owns the whole
// screen, cooks Coin Cellar's wares (see ingredients.js) against the shared
// cooking backend, and keeps its dishes in its own localStorage save.
import { AudioBus } from "../core/audio.js";
import { Kitchen } from "./kitchen.js";
import { authReady } from "./net/supabase.js";

authReady(); // fire early; everything degrades gracefully offline

const audio = new AudioBus();
const kitchen = new Kitchen({
  audio,
  onDishPlated: () => {},
  onExit: () => {
    window.location.href = "./";
  },
});
kitchen.show();
