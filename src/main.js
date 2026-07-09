import { Engine } from "./core/engine.js";
import { Input } from "./core/input.js";
import { AudioBus } from "./core/audio.js";
import { HUD } from "./game/hud.js";
import { Game, requestFullscreen } from "./game/game.js";
import { loadCharacters } from "./chargen/assets.js";
import { loadDungeonAssets } from "./game/dungeon-assets.js";
import { icon } from "./core/icons.js";
import { initAnalytics, track } from "./core/analytics.js";

initAnalytics();

const app = document.getElementById("app");
const hudRoot = document.getElementById("hud");

function loadingScreen(text) {
  hudRoot.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;
    color:#ffe9c4;font-family:'Trebuchet MS',system-ui,sans-serif;text-align:center">
    <div><div style="font-size:40px">${icon("shop")}</div>
    <div style="font-size:20px;font-weight:900;margin-top:8px">COIN CELLAR</div>
    <div id="load-sub" style="font-size:13px;color:#cdb8ff;margin-top:6px">${text}</div></div></div>`;
}

// A quick title screen — wait here until the player hits Play so the game
// starts on a deliberate tap (also unlocks audio, which browsers gate behind
// a user gesture).
function startMenu() {
  return new Promise((resolve) => {
    hudRoot.innerHTML = `
      <div id="start-menu">
        <div class="start-card">
          <img class="start-logo-img" src="logo.png" alt="Coin Cellar" />
          <h1 class="start-title">COIN CELLAR</h1>
          <button class="btn deal start-play" id="start-play">${icon("play")} Play</button>
        </div>
      </div>`;
    document.getElementById("start-play").onclick = () => {
      // First tap: on touch, go fullscreen straight away (must run inside the
      // gesture). Desktop stays windowed.
      if (matchMedia("(pointer: coarse)").matches) requestFullscreen();
      resolve();
    };
  });
}

async function boot() {
  loadingScreen("Loading characters…");
  await loadCharacters((done, total) => {
    const sub = document.getElementById("load-sub");
    if (sub) sub.textContent = `Loading characters… ${done}/${total}`;
  });
  await loadDungeonAssets((done, total) => {
    const sub = document.getElementById("load-sub");
    if (sub) sub.textContent = `Loading dungeon… ${done}/${total}`;
  });
  await startMenu();
  track("game_started");
  hudRoot.innerHTML = "";

  const engine = new Engine(app);
  const hud = new HUD(hudRoot, engine);
  const input = new Input(hudRoot);
  const audio = new AudioBus();
  const game = new Game(engine, input, audio, hud);
  engine.start();
  window.__game = game; // debug/testing handle
}

// Register the service worker so the game is installable as a PWA and can
// launch offline once cached. Fire-and-forget after load; failures are silent.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

boot().catch((err) => {
  console.error(err);
  hudRoot.innerHTML = `<div style="color:#ffd; padding:40px; font-size:18px">
    ${icon("warning")} Couldn't start (WebGL or assets failed).<br/><small>${String(err).slice(0, 200)}</small></div>`;
});
