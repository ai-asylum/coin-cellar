import { Engine } from "./core/engine.js";
import { Input } from "./core/input.js";
import { AudioBus } from "./core/audio.js";
import { HUD } from "./game/hud.js";
import { Game, requestFullscreen } from "./game/game.js";
import { loadCharacters } from "./chargen/assets.js";
import { loadDungeonAssets } from "./game/dungeon-assets.js";
import { icon } from "./core/icons.js";
import { initAnalytics, track } from "./core/analytics.js";
import { SAVE_KEY } from "./game/game-persistence.js";

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
// a user gesture). The menu floats over the live attract scene (the hero
// strolling the town), so it's its own transparent overlay on <body> rather
// than owning the HUD layer.
function hasSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return !!(s && s.day);
  } catch {
    return false;
  }
}

function startMenu() {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.id = "start-menu";
    // "New Game" only makes sense for returning players — a fresh start wipes
    // the saved run, so it's hidden entirely until there's something to wipe.
    const newGameBtn = hasSave()
      ? `<button class="btn deny start-new" id="start-new">${icon("play")} New Game</button>`
      : "";
    el.innerHTML = `
      <img class="start-logo-img" src="logo2.png" alt="Coin Cellar" />
      <div class="start-card">
        <button class="btn deal start-play" id="start-play">${icon("play")} Play</button>
        ${newGameBtn}
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#start-play").onclick = () => {
      // First tap: on touch, go fullscreen straight away (must run inside the
      // gesture). Desktop stays windowed.
      if (matchMedia("(pointer: coarse)").matches) requestFullscreen();
      el.remove();
      resolve();
    };
    el.querySelector("#start-new")?.addEventListener("click", () => confirmNewGame());
  });
}

// Confirm before starting over — wiping the save is destructive, so make the
// player opt in. On confirm we clear the save and reload; boot then rebuilds
// the world fresh (no save to load) and drops back to the menu, where Play
// starts the new run on a deliberate tap (keeping the audio-unlock gesture).
function confirmNewGame() {
  const modal = document.createElement("div");
  modal.id = "new-game-modal";
  modal.innerHTML = `
    <div class="ng-card">
      <div class="ng-title">Start a New Game?</div>
      <div class="ng-body">This will erase your saved run. This can't be undone.</div>
      <div class="ng-btns">
        <button class="btn ng-cancel">Cancel</button>
        <button class="btn deny ng-confirm">${icon("play")} New Game</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector(".ng-cancel").onclick = close;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector(".ng-confirm").onclick = () => {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  };
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
  hudRoot.innerHTML = "";

  // Build the world up front and run it in attract mode: the render loop starts
  // now so the title screen shows the hero wandering the town behind the menu.
  const engine = new Engine(app);
  const hud = new HUD(hudRoot, engine);
  const input = new Input(hudRoot);
  const audio = new AudioBus();
  const game = new Game(engine, input, audio, hud, { titleAttract: true });
  engine.start();
  window.__game = game; // debug/testing handle

  hudRoot.classList.add("title-hidden"); // keep the HUD out of the menu shot
  await startMenu();
  track("game_started");
  hudRoot.classList.remove("title-hidden");
  game.startPlay();
}

// Register the service worker so the game is installable as a PWA and can
// launch offline once cached. Fire-and-forget after load; failures are silent.
//
// Only do this in production builds. In dev the SW's stale-while-revalidate
// cache poisons Vite's client/HMR endpoints and asset requests (serving stale
// code or the HTML shell where JSON is expected), so we instead tear down any
// SW + caches left over from a previous prod visit on this origin.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) reg.unregister();
    });
    if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}

boot().catch((err) => {
  console.error(err);
  hudRoot.innerHTML = `<div style="color:#ffd; padding:40px; font-size:18px">
    ${icon("warning")} Couldn't start (WebGL or assets failed).<br/><small>${String(err).slice(0, 200)}</small></div>`;
});
