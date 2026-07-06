import { Engine } from "./core/engine.js";
import { Input } from "./core/input.js";
import { AudioBus } from "./core/audio.js";
import { HUD } from "./game/hud.js";
import { Game } from "./game/game.js";

const app = document.getElementById("app");
const hudRoot = document.getElementById("hud");

try {
  const engine = new Engine(app);
  const hud = new HUD(hudRoot, engine);
  const input = new Input(hudRoot);
  const audio = new AudioBus();
  const game = new Game(engine, input, audio, hud);
  engine.start();
  window.__game = game; // debug/testing handle
} catch (err) {
  console.error(err);
  hudRoot.innerHTML = `<div style="color:#ffd; padding:40px; font-size:18px">
    😵 Couldn't start (WebGL needed).<br/><small>${String(err).slice(0, 200)}</small></div>`;
}
