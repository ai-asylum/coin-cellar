// All 2D UI is DOM — crisp on any mobile screen, styled in style.css.
// The HUD projects 3D anchors for floating damage numbers / emotes.
import * as THREE from "three";
import { portraitDataURL } from "../chargen/portrait.js";
import { icon, itemIcon } from "../core/icons.js";
import { viewport } from "../core/viewport.js";

const _v = new THREE.Vector3();
const _gdir = new THREE.Vector3();
const _gfwd = new THREE.Vector3();

export class HUD {
  constructor(root, engine) {
    this.engine = engine;
    root.innerHTML = `
      <div id="topbar">
        <div class="chip" id="gold-chip">${icon("coin")} <b id="gold-num">0</b></div>
        <div class="chip-btns">
          <button class="icon-btn" id="coop-btn">${icon("people")}</button>
          <button class="icon-btn" id="mute-btn">${icon("soundOn")}</button>
          <button class="icon-btn" id="pause-btn">${icon("pause")}</button>
        </div>
      </div>
      <button id="bag-btn" aria-label="Open backpack (B)">
        <span class="bag-btn-ic">${icon("bag")}</span>
        <span class="bag-btn-key">B</span>
      </button>
      <button id="store-btn" class="hidden" aria-label="Open storeroom (V)">
        <span class="bag-btn-ic">${icon("box")}</span>
        <span class="bag-btn-key">V</span>
      </button>
      <div id="minimap-wrap" class="hidden" aria-hidden="true">
        <canvas id="minimap"></canvas>
        <button id="mini-up-btn" aria-label="Go back up to the surface">${icon("hole")} <span>Go back up</span></button>
      </div>
      <div id="banner" class="hidden"><div id="banner-main"></div><div id="banner-sub"></div></div>
      <div id="bossbar" class="hidden">
        <div id="bossbar-name"></div>
        <div id="bossbar-track"><div id="bossbar-fill"></div></div>
      </div>
      <div id="toast-wrap"></div>
      <div id="floaties"></div>
      <div id="npc-debug"></div>
      <div id="tut-guide" class="hidden">
        <div class="tg-text"></div>
        <div class="tg-arrow"><span class="tg-bob"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5 h16 l-8 14 z"/></svg></span></div>
      </div>
      <div id="interact-hint" class="hidden"></div>
      <div id="hearts" class="hidden"></div>
      <div id="chat-bar" class="hidden">
        <input id="chat-input" type="text" maxlength="140" autocomplete="off" autocapitalize="sentences" placeholder="Say something\u2026" />
      </div>
      <div id="dialog" class="hidden"></div>
      <div id="portraits"></div>
      <div id="hurt-flash"></div>
      <div id="sheet-backdrop" class="hidden"></div>
      <div id="sheet" class="hidden"></div>
      <div id="fs-gate" class="hidden">
        <div class="fs-gate-card">
          <div class="fs-gate-ic">${icon("play")}</div>
          <div class="fs-gate-txt">Tap to play fullscreen</div>
        </div>
      </div>
    `;
    this.root = root;
    this.goldNum = root.querySelector("#gold-num");
    this.goldChip = root.querySelector("#gold-chip");
    this.heartsEl = root.querySelector("#hearts");
    this.bannerEl = root.querySelector("#banner");
    this.bossbarEl = root.querySelector("#bossbar");
    this.bossbarNameEl = root.querySelector("#bossbar-name");
    this.bossbarFillEl = root.querySelector("#bossbar-fill");
    this._bossbarName = null;
    this.sheetEl = root.querySelector("#sheet");
    this.backdropEl = root.querySelector("#sheet-backdrop");
    this._onBackdrop = null;
    this.backdropEl.addEventListener("click", () => this._onBackdrop?.());
    this.portraitsEl = root.querySelector("#portraits");
    this.chatBarEl = root.querySelector("#chat-bar");
    this.chatInputEl = root.querySelector("#chat-input");
    this._onChatSubmit = null;
    this._wireChatInput();
    this.dialogEl = root.querySelector("#dialog");
    this.speakOpen = false;
    this._onAdvance = null;
    this.floatiesEl = root.querySelector("#floaties");
    this.npcDbgEl = root.querySelector("#npc-debug");
    this._dbgPool = [];
    this.hurtFlashEl = root.querySelector("#hurt-flash");
    this.toastWrap = root.querySelector("#toast-wrap");
    this.guideEl = root.querySelector("#tut-guide");
    this.guideTextEl = this.guideEl.querySelector(".tg-text");
    this.guideArrowEl = this.guideEl.querySelector(".tg-arrow");
    this._guideText = null;
    this.hintEl = root.querySelector("#interact-hint");
    this._hintSig = null;
    this.minimapWrapEl = root.querySelector("#minimap-wrap");
    this.minimapEl = root.querySelector("#minimap");
    this.minimapCtx = this.minimapEl.getContext("2d");
    this.miniUpBtn = root.querySelector("#mini-up-btn");
    this._miniBase = null;
    this._miniBaseKey = null;
    this._bannerT = null;
    this._tracked = [];
    this._gold = 0;
  }

  _wireChatInput() {
    const inp = this.chatInputEl;
    // keep game shortcuts / movement from firing while typing
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = inp.value.trim();
        const cb = this._onChatSubmit; // grab before closeChat() clears it
        this.closeChat();
        if (text) cb?.(text);
      } else if (e.key === "Escape") {
        this.closeChat();
      }
    });
    // clicking away (e.g. tapping the world) dismisses the empty box on mobile
    inp.addEventListener("blur", () => { if (this.chatOpen && !inp.value.trim()) this.closeChat(); });
  }

  get chatOpen() { return !this.chatBarEl.classList.contains("hidden"); }

  /** Open the chat text box. `onSubmit(text)` fires when the player hits Enter. */
  openChat(onSubmit) {
    if (this.chatOpen) return;
    this._onChatSubmit = onSubmit;
    this.chatInputEl.value = "";
    this.chatBarEl.classList.remove("hidden");
    // focus on the next tick so the 't' that opened it isn't typed into the box
    setTimeout(() => this.chatInputEl.focus(), 0);
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatBarEl.classList.add("hidden");
    this.chatInputEl.blur();
    this._onChatSubmit = null;
  }

  setGold(g, animate = true) {
    if (g !== this._gold && animate) {
      this.goldChip.classList.remove("bounce");
      void this.goldChip.offsetWidth;
      this.goldChip.classList.add("bounce");
    }
    this._gold = g;
    this.goldNum.textContent = g;
  }

  setHearts(hp, max) {
    let s = "";
    for (let i = 0; i < max; i++) s += icon(i < hp ? "heart" : "heartEmpty");
    this.heartsEl.innerHTML = s;
  }

  // Hearts only matter while delving — keep the chip out of the shop.
  showHearts(visible) {
    this.heartsEl.classList.toggle("hidden", !visible);
  }

  // Gold only matters in the shop — hide the coin counter while delving.
  showGold(visible) {
    this.goldChip.classList.toggle("hidden", !visible);
  }

  // While delving, tuck the total-gold readout into the lower-left with the
  // hearts; in the shop it lives up in the topbar.
  setGoldCorner(corner) {
    this.goldChip.classList.toggle("gold-corner", corner);
  }

  // The backpack button is available everywhere; callers keep it up during
  // normal play. Its visibility is only suppressed while the bag panel itself
  // is open (see _applyBagBtn).
  showBag(visible) {
    this._bagWanted = visible;
    this._applyBagBtn();
  }

  // The storeroom shortcut is shop-only (there's nothing to stock underground).
  showStore(visible) {
    this._storeWanted = visible;
    this._applyBagBtn();
  }

  // The backpack / storeroom buttons stay on screen while their panel is open —
  // each sheet is parked just above its button and grows out of it, so the
  // button reads as the panel's anchor (and is the landing pad for the
  // store/take fly animation). Visibility just follows each button's wanted
  // state; only the joystick / action / interact buttons are hidden under an
  // open bag panel (see the CSS sibling rule in style.css).
  _applyBagBtn() {
    const bag = this.root.querySelector("#bag-btn");
    if (bag) bag.classList.toggle("hidden", !this._bagWanted);
    const store = this.root.querySelector("#store-btn");
    if (store) store.classList.toggle("hidden", !this._storeWanted);
  }

  banner(main, sub = "", dur = 2.2) {
    this.bannerEl.classList.remove("hidden");
    this.bannerEl.querySelector("#banner-main").innerHTML = main;
    this.bannerEl.querySelector("#banner-sub").innerHTML = sub;
    clearTimeout(this._bannerT);
    if (dur > 0) this._bannerT = setTimeout(() => this.bannerEl.classList.add("hidden"), dur * 1000);
  }

  hideBanner() {
    this.bannerEl.classList.add("hidden");
  }

  // ------------------------------------------------------------ boss bar
  /** Big top-of-screen health bar shown while a boss fight is live. */
  showBossBar(name, enraged = false) {
    this.bossbarEl.classList.remove("hidden");
    this.bossbarEl.classList.toggle("enraged", enraged);
    if (name !== this._bossbarName) {
      this._bossbarName = name;
      this.bossbarNameEl.textContent = name;
    }
  }

  /** frac is remaining health, 0 → 1 (CSS animates the width change). */
  setBossBar(frac) {
    this.bossbarFillEl.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + "%";
  }

  hideBossBar() {
    this.bossbarEl.classList.add("hidden");
  }

  /** Red screen pulse when the player takes a hit. */
  flashHurt() {
    const el = this.hurtFlashEl;
    if (!el) return;
    el.classList.remove("show");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("show");
  }

  toast(text) {
    // Disabled for now.
  }

  /** Floating text at a world position (damage numbers, +gold). */
  float(worldPos, text, cls = "") {
    const p = this._project(worldPos);
    if (!p) return;
    const el = document.createElement("div");
    el.className = "floaty " + cls;
    el.innerHTML = text;
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    this.floatiesEl.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  /** Brief "Bag is full!" nudge, popped by the bag button (or top-centre when
   * the button's hidden) when loot can't be picked up. */
  bagFull() {
    const bag = this.root.querySelector("#bag-btn");
    const el = document.createElement("div");
    el.className = "bag-full-msg";
    el.innerHTML = `${icon("bag")} Bag is full!`;
    this.floatiesEl.appendChild(el);
    const rect = bag && !bag.classList.contains("hidden") ? bag.getBoundingClientRect() : null;
    if (rect) {
      el.style.left = rect.left + rect.width / 2 + "px";
      el.style.top = rect.bottom + 10 + "px";
    } else {
      el.style.left = "50%";
      el.style.top = "20%";
    }
    // pop the bag button too so the eye goes there
    if (bag && rect) {
      bag.classList.remove("pop");
      void bag.offsetWidth;
      bag.classList.add("pop");
    }
    setTimeout(() => el.remove(), 1500);
  }

  /** Re-trigger the gold chip's little bounce (e.g. as coins land). */
  bumpGold() {
    this.goldChip.classList.remove("bounce");
    void this.goldChip.offsetWidth;
    this.goldChip.classList.add("bounce");
  }

  /**
   * Cha-ching! Spawn a burst of gold coins that arc from a 3D world point
   * (the sale) up to the gold counter. `onLand(i)` fires as each coin lands
   * so the game can tick a coin sound in sync.
   */
  flyCoins(worldPos, count = 8, onLand = null) {
    const start = this._project(worldPos);
    if (!start) return;
    const rect = this.goldChip.getBoundingClientRect();
    const end = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const n = Math.max(3, Math.min(Math.round(count), 16));
    for (let i = 0; i < n; i++) {
      const coin = document.createElement("div");
      coin.className = "coin-fly";
      coin.innerHTML = icon("coin");
      const sx = start.x + (Math.random() - 0.5) * 46;
      const sy = start.y + (Math.random() - 0.5) * 30;
      coin.style.left = sx + "px";
      coin.style.top = sy + "px";
      this.floatiesEl.appendChild(coin);
      const dx = end.x - sx;
      const dy = end.y - sy;
      const arc = 55 + Math.random() * 75;
      const anim = coin.animate(
        [
          { transform: "translate(-50%,-50%) scale(0.5)", opacity: 0, offset: 0 },
          { transform: `translate(calc(-50% + ${dx * 0.25}px), calc(-50% + ${dy * 0.25 - arc}px)) scale(1.15)`, opacity: 1, offset: 0.25 },
          { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6 - arc * 0.55}px)) scale(1.1)`, opacity: 1, offset: 0.6 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`, opacity: 0.85, offset: 1 },
        ],
        { duration: 560 + Math.random() * 240, delay: i * 55, easing: "cubic-bezier(.45,.05,.55,1)", fill: "forwards" }
      );
      anim.onfinish = () => {
        coin.remove();
        onLand?.(i);
        this.bumpGold();
      };
    }
  }

  /**
   * The reverse of flyCoins: when the player spends, coins peel off the gold
   * counter and fly out toward a 3D world point (whatever's being paid for),
   * shrinking away as they land on it. `onLand(i)` ticks per coin so the caller
   * can cascade a coin sound. Falls back to the screen centre when the target
   * isn't on screen, so a spend always shows *something* leaving the wallet.
   */
  spendCoins(worldPos, count = 8, onLand = null) {
    const rect = this.goldChip.getBoundingClientRect();
    const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const view = this._viewRect();
    const end = (worldPos && this._project(worldPos)) ||
      { x: view.left + view.width / 2, y: view.top + view.height / 2 };
    const n = Math.max(3, Math.min(Math.round(count), 16));
    for (let i = 0; i < n; i++) {
      const coin = document.createElement("div");
      coin.className = "coin-fly";
      coin.innerHTML = icon("coin");
      const sx = start.x + (Math.random() - 0.5) * 22;
      const sy = start.y + (Math.random() - 0.5) * 16;
      coin.style.left = sx + "px";
      coin.style.top = sy + "px";
      this.floatiesEl.appendChild(coin);
      const dx = end.x - sx;
      const dy = end.y - sy;
      const arc = 45 + Math.random() * 70;
      const anim = coin.animate(
        [
          { transform: "translate(-50%,-50%) scale(0.45)", opacity: 0, offset: 0 },
          { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${dy * 0.3 - arc}px)) scale(1.15)`, opacity: 1, offset: 0.3 },
          { transform: `translate(calc(-50% + ${dx * 0.68}px), calc(-50% + ${dy * 0.68 - arc * 0.5}px)) scale(1.0)`, opacity: 1, offset: 0.68 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`, opacity: 0, offset: 1 },
        ],
        { duration: 520 + Math.random() * 220, delay: i * 45, easing: "cubic-bezier(.45,.05,.55,1)", fill: "forwards" }
      );
      anim.onfinish = () => {
        coin.remove();
        onLand?.(i);
      };
    }
    // the counter reacts as the coins leave it
    this.bumpGold();
  }

  /**
   * A single loot sprite arcs from a 3D world point (the drop) across the
   * screen and into the backpack button, which gives a little pop on arrival.
   * Mirrors flyCoins but for a picked-up item.
   */
  flyToBag(worldPos, iconHtml) {
    const start = this._project(worldPos);
    const bag = this.root.querySelector("#bag-btn");
    if (!start || !bag || bag.classList.contains("hidden")) return;
    const rect = bag.getBoundingClientRect();
    const end = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const el = document.createElement("div");
    el.className = "item-fly";
    el.innerHTML = iconHtml;
    el.style.left = start.x + "px";
    el.style.top = start.y + "px";
    this.floatiesEl.appendChild(el);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const arc = 70 + Math.random() * 60;
    const anim = el.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.6) rotate(0deg)", opacity: 0, offset: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${dy * 0.3 - arc}px)) scale(1.25) rotate(-12deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${dx * 0.65}px), calc(-50% + ${dy * 0.65 - arc * 0.5}px)) scale(1.1) rotate(8deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35) rotate(0deg)`, opacity: 0.9, offset: 1 },
      ],
      { duration: 620, easing: "cubic-bezier(.4,.05,.5,1)", fill: "forwards" }
    );
    anim.onfinish = () => {
      el.remove();
      bag.classList.remove("pop");
      void bag.offsetWidth;
      bag.classList.add("pop");
    };
  }

  /**
   * Homecoming juice: the loot you just banked whooshes across the screen from
   * the backpack button over to the storeroom button. Each item bursts big
   * mid-arc then shrinks into the storeroom, and both buttons bounce as the
   * swarm leaves / lands — a button-to-button victory lap. `iconHtmls` is the
   * list of item icons to send; `onLand(i)` fires as each one arrives (for a
   * sound tick). No-op unless both buttons are on screen.
   */
  flyBagToStore(iconHtmls, onLand = null) {
    const bag = this.root.querySelector("#bag-btn");
    const store = this.root.querySelector("#store-btn");
    if (!bag || !store) return;
    if (bag.classList.contains("hidden") || store.classList.contains("hidden")) return;
    if (!iconHtmls || !iconHtmls.length) return;
    const bagR = bag.getBoundingClientRect();
    const stoR = store.getBoundingClientRect();
    if (!bagR.width || !stoR.width) return;
    const start = { x: bagR.left + bagR.width / 2, y: bagR.top + bagR.height / 2 };
    const end = { x: stoR.left + stoR.width / 2, y: stoR.top + stoR.height / 2 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const items = iconHtmls.slice(0, 12); // cap the swarm so it stays readable
    items.forEach((html, i) => {
      const el = document.createElement("div");
      el.className = "item-fly";
      el.innerHTML = html;
      el.style.left = start.x + "px";
      el.style.top = start.y + "px";
      this.floatiesEl.appendChild(el);
      const arc = 60 + Math.random() * 80;               // how high it bows up
      const sway = (Math.random() - 0.5) * 90;           // fan the swarm out
      const anim = el.animate(
        [
          { transform: "translate(-50%,-50%) scale(0.25) rotate(0deg)", opacity: 0, offset: 0 },
          { transform: `translate(calc(-50% + ${dx * 0.28 + sway}px), calc(-50% + ${dy * 0.28 - arc}px)) scale(1.7) rotate(-16deg)`, opacity: 1, offset: 0.35 },
          { transform: `translate(calc(-50% + ${dx * 0.7 + sway * 0.35}px), calc(-50% + ${dy * 0.7 - arc * 0.4}px)) scale(1.25) rotate(12deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.3) rotate(0deg)`, opacity: 0.85, offset: 1 },
        ],
        { duration: 660 + Math.random() * 260, delay: 100 + i * 95, easing: "cubic-bezier(.4,.05,.5,1)", fill: "forwards" }
      );
      // as each item launches, kick the bag; as it lands, kick the storeroom
      bag.classList.remove("pop");
      void bag.offsetWidth;
      bag.classList.add("pop");
      anim.onfinish = () => {
        el.remove();
        store.classList.remove("pop");
        void store.offsetWidth;
        store.classList.add("pop");
        onLand?.(i);
      };
    });
  }

  /**
   * A single item icon hops from a source element (the tapped backpack /
   * storeroom row) across to a destination HUD button (the storeroom or
   * backpack), which pops on arrival — so shuttling an item between the two
   * reads as a physical hand-off. `srcEl` is read synchronously, so the caller
   * can rebuild the sheet right after. No-op if either endpoint is missing or
   * off screen.
   */
  flyItem(srcEl, destSel, iconHtml, onLand = null) {
    const dest = this.root.querySelector(destSel);
    if (!srcEl || !dest || dest.classList.contains("hidden")) return;
    const sR = srcEl.getBoundingClientRect();
    const dR = dest.getBoundingClientRect();
    if (!sR.width || !dR.width) return;
    const start = { x: sR.left + sR.width / 2, y: sR.top + sR.height / 2 };
    const end = { x: dR.left + dR.width / 2, y: dR.top + dR.height / 2 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const el = document.createElement("div");
    el.className = "item-fly";
    el.innerHTML = iconHtml;
    el.style.left = start.x + "px";
    el.style.top = start.y + "px";
    this.floatiesEl.appendChild(el);
    const arc = 55 + Math.random() * 45; // bow the hop up so it arcs, not slides
    const anim = el.animate(
      [
        { transform: "translate(-50%,-50%) scale(1) rotate(0deg)", opacity: 1, offset: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${dy * 0.3 - arc}px)) scale(1.35) rotate(-12deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7 - arc * 0.45}px)) scale(1.1) rotate(10deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35) rotate(0deg)`, opacity: 0.85, offset: 1 },
      ],
      { duration: 540, easing: "cubic-bezier(.4,.05,.5,1)", fill: "forwards" }
    );
    anim.onfinish = () => {
      el.remove();
      dest.classList.remove("pop");
      void dest.offsetWidth;
      dest.classList.add("pop");
      onLand?.();
    };
  }

  // -------------------------------------------------- FTUE guide + key hints
  /**
   * Bouncing arrow + text label over a world position (the current tutorial
   * objective). When the target is off-screen the arrow clamps to the screen
   * edge and swivels to point toward it. Call every frame while guiding.
   */
  guide(worldPos, text) {
    const p = this._projectGuide(worldPos);
    const el = this.guideEl;
    el.classList.remove("hidden");
    el.classList.toggle("no-text", !text);
    if (text !== this._guideText) {
      this._guideText = text;
      this.guideTextEl.innerHTML = text;
    }
    // Keep the label + arrow inside a box that clears the fixed UI: the top bar
    // up top and the bag/store/action buttons along the bottom, with a little
    // breathing room on the sides. Bigger vertical insets so the guide never
    // slides up behind the top bar or down under the corner buttons.
    const insetX = 120;
    const insetTop = 100;
    const insetBottom = 130;
    const view = this._viewRect();
    const x = Math.max(view.left + insetX, Math.min(view.left + view.width - insetX, p.x));
    const y = Math.max(view.top + insetTop, Math.min(view.top + view.height - insetBottom, p.y - 44));
    const edge = x !== p.x || y !== p.y;
    el.classList.toggle("edge", edge);
    el.style.left = x + "px";
    el.style.top = y + "px";
    // on-target: arrow hangs below the label pointing down (bobbing via CSS);
    // clamped to an edge: swivel it to aim at the off-screen objective
    this.guideArrowEl.style.transform = edge
      ? `rotate(${(Math.atan2(p.y - y, p.x - x) - Math.PI / 2).toFixed(3)}rad)`
      : "";
  }

  hideGuide() {
    this.guideEl.classList.add("hidden");
  }

  /** FTUE "your next move is in the bag" cue: the backpack button pulses and
   * a bouncing arrow hangs above it. `label` is optional ("Open backpack"
   * the first time; the repeat visit gets the arrow alone). The arrow lives
   * inside the button so it follows it across layouts, and vanishes with it
   * while the bag sheet is up. Cleared by clearBagAttention(). */
  bagAttention(label = "") {
    const btn = this.root.querySelector("#bag-btn");
    if (!btn) return;
    this.clearBagAttention();
    btn.classList.add("attn");
    const el = document.createElement("div");
    el.className = "bag-attn";
    el.innerHTML = `${label ? `<span>${label}</span>` : ""}<b>▼</b>`;
    btn.appendChild(el);
  }

  clearBagAttention() {
    const btn = this.root.querySelector("#bag-btn");
    btn?.classList.remove("attn");
    btn?.querySelector(".bag-attn")?.remove();
  }

  /** In-world dialogue bar: a character bust on the left (so you can see who's
   * talking, like the haggle panel) plus a speech box. Non-blocking — the scene
   * stays visible behind it. Click/tap anywhere on the bar to advance. */
  speak({ name, tag, portrait, text, cta = "tap to continue", onAdvance, choices } = {}) {
    const el = this.dialogEl;
    el.classList.remove("hidden");
    // With choices, the player picks a reply button; without, the whole bar is
    // a "tap to continue" advance.
    const foot = choices && choices.length
      ? `<div class="dlg-choices">${choices
          .map((c, i) => `<button class="dlg-choice" data-i="${i}">${c.label}</button>`)
          .join("")}</div>`
      : `<div class="dlg-cta">${cta}</div>`;
    el.innerHTML = `
      <div class="dlg-wrap">
        ${portrait ? `<img class="dlg-portrait" src="${portrait}" alt="">` : ""}
        <div class="dlg-box">
          ${name ? `<div class="dlg-name">${name}${tag ? `<span class="dlg-tag">${tag}</span>` : ""}</div>` : ""}
          <div class="dlg-text">${text}</div>
          ${foot}
        </div>
      </div>`;
    this.speakOpen = true;
    if (choices && choices.length) {
      this._onAdvance = null; // a tap on the bar does nothing — pick a reply
      el.onclick = null;
      el.querySelectorAll(".dlg-choice").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          choices[Number(btn.dataset.i)]?.fn?.();
        };
      });
    } else {
      this._onAdvance = onAdvance;
      el.onclick = () => this.advanceSpeak();
    }
  }

  // Advance the open dialogue bubble (bar tap, or the "ok" key/button routed
  // through the game). No-op if nothing's being said.
  advanceSpeak() {
    if (this.speakOpen) this._onAdvance?.();
  }

  hideSpeak() {
    this.speakOpen = false;
    this._onAdvance = null;
    this.dialogEl.classList.add("hidden");
    this.dialogEl.onclick = null;
    this.dialogEl.innerHTML = "";
  }

  /** Control hint pinned under the context-action focus: a keycap (desktop)
   * plus a short verb, e.g. [E] Haggle. Pass key="" on touch for verb only. */
  interactHint(worldPos, text, key = "E") {
    const p = this._project(worldPos);
    if (!p) return this.hideInteractHint();
    const el = this.hintEl;
    el.classList.remove("hidden");
    const sig = key + "|" + text;
    if (sig !== this._hintSig) {
      this._hintSig = sig;
      el.innerHTML = `${key ? `<span class="ih-key">${key}</span>` : ""}<span class="ih-txt">${text}</span>`;
    }
    el.style.left = p.x + "px";
    el.style.top = p.y + 30 + "px";
  }

  hideInteractHint() {
    this.hintEl.classList.add("hidden");
  }

  /** Icon bubble that follows a 3D object (customer emotes, "!" bubbles).
   * `name` is a key from the icon set (see core/icons.js). */
  emote(target, name, dur = 1.6, cls = "emote") {
    const el = document.createElement("div");
    el.className = "floaty " + cls;
    el.innerHTML = icon(name);
    this.floatiesEl.appendChild(el);
    const entry = { target, el, yOff: target.height ?? 1.6, until: performance.now() + dur * 1000 };
    this._tracked.push(entry);
    return entry;
  }

  removeEmote(entry) {
    entry.until = 0;
  }

  /** A short text speech bubble that follows a 3D object (townsfolk asides,
   * e.g. what a shopper mutters on their way in). Non-blocking and unclickable —
   * it just floats over their head for `dur` seconds, then fades. Returns the
   * tracked entry so callers can drop it early via removeEmote(). */
  speechBubble(target, text, dur = 2.6) {
    if (!text) return null;
    const el = document.createElement("div");
    el.className = "floaty speech";
    el.textContent = text;
    this.floatiesEl.appendChild(el);
    const entry = { target, el, yOff: (target.height ?? 1.6) + 0.35, until: performance.now() + dur * 1000 };
    this._tracked.push(entry);
    return entry;
  }

  /** Debug overlay: a small info card pinned above each NPC while the admin's
   * "NPC debug" toggle is on. `entries` is an array of
   * { target: creature, html, stuck } — pooled label elements are reused frame
   * to frame so the crowd's worth of cards never thrashes the DOM. */
  renderNpcDebug(entries) {
    const pool = this._dbgPool;
    for (let i = 0; i < entries.length; i++) {
      let el = pool[i];
      if (!el) {
        el = document.createElement("div");
        el.className = "npc-dbg";
        this.npcDbgEl.appendChild(el);
        pool[i] = el;
      }
      const e = entries[i];
      _v.setFromMatrixPosition(e.target.matrixWorld);
      _v.y += (e.target.height ?? 1.6) + 0.55;
      const p = this._project(_v);
      if (!p) { el.style.display = "none"; continue; }
      el.style.display = "block";
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      if (el._html !== e.html) { el.innerHTML = e.html; el._html = e.html; }
      el.classList.toggle("stuck", !!e.stuck);
    }
    for (let i = entries.length; i < pool.length; i++) pool[i].style.display = "none";
  }

  hideNpcDebug() {
    for (const el of this._dbgPool) el.style.display = "none";
  }

  // ------------------------------------------------------------- minimap
  showMinimap(visible) {
    this.minimapWrapEl.classList.toggle("hidden", !visible);
  }

  /**
   * Draw the dungeon floor plan: revealed room/corridor cells, the entrance,
   * the stairs down (exit), live enemies and the player(s). `d` is the Dungeon;
   * `player`/`remote` are Creatures (world-space) — remote may be null.
   */
  renderMinimap(d, player, remote) {
    const el = this.minimapEl;
    if (!el || this.minimapWrapEl.classList.contains("hidden") || !d.open) return;
    const GW = d.GW, GH = d.GH, open = d.open;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cell = 8; // logical px per grid cell
    const w = GW * cell, h = GH * cell;
    if (el.width !== w * dpr || el.height !== h * dpr) {
      el.width = w * dpr;
      el.height = h * dpr;
      el.style.width = w + "px";
      el.style.height = h + "px";
      this._miniBaseKey = null;
    }

    // Cache the discovered floor plan; rebuild only when new ground is revealed.
    const disc = d.discovered;
    const seen = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && open[y][x] && disc[y][x];
    const key = `${d.floor}:${d.seed}:${d.revealVersion}`;
    if (this._miniBaseKey !== key || !this._miniBase) {
      const base = document.createElement("canvas");
      base.width = w * dpr;
      base.height = h * dpr;
      const bx = base.getContext("2d");
      bx.scale(dpr, dpr);
      // A "frontier" cell is discovered ground whose neighbour is open floor that
      // hasn't been discovered yet — i.e. an opening into an unexplored room, not a
      // wall. Those cells are drawn dotted so it reads as "more to explore here".
      const inb = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;
      const openUndisc = (x, y) => inb(x, y) && open[y][x] && !disc[y][x];
      const frontier = (x, y) =>
        seen(x, y) &&
        (openUndisc(x, y - 1) || openUndisc(x, y + 1) ||
         openUndisc(x - 1, y) || openUndisc(x + 1, y));
      // fill fully-discovered cells as one merged shape (full cells → no inner seams)
      bx.fillStyle = "#e6d3a1";
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++)
          if (seen(x, y) && !frontier(x, y)) bx.fillRect(x * cell, y * cell, cell, cell);
      // dotted (semi-transparent) fill for frontier cells opening onto the unknown
      const dotR = cell * 0.11, step = cell / 3;
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++) {
          if (!frontier(x, y)) continue;
          for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) {
              bx.beginPath();
              bx.arc(x * cell + step * (i + 0.5), y * cell + step * (j + 0.5), dotR, 0, Math.PI * 2);
              bx.fill();
            }
        }
      // black outline only where discovered ground meets an actual wall (or the map
      // edge) — open frontier edges are left unlined so unexplored rooms don't look
      // walled off.
      const wall = (x, y) => !seen(x, y) && !openUndisc(x, y);
      bx.strokeStyle = "#000";
      bx.lineWidth = 1.4;
      bx.lineCap = "square";
      bx.beginPath();
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++) {
          if (!seen(x, y)) continue;
          const l = x * cell, t = y * cell, r = l + cell, b = t + cell;
          if (wall(x, y - 1)) { bx.moveTo(l, t); bx.lineTo(r, t); }
          if (wall(x, y + 1)) { bx.moveTo(l, b); bx.lineTo(r, b); }
          if (wall(x - 1, y)) { bx.moveTo(l, t); bx.lineTo(l, b); }
          if (wall(x + 1, y)) { bx.moveTo(r, t); bx.lineTo(r, b); }
        }
      bx.stroke();
      this._miniBase = base;
      this._miniBaseKey = key;
    }

    const ctx = this.minimapCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(this._miniBase, 0, 0);
    ctx.save();
    ctx.scale(dpr, dpr);

    const dot = (gx, gy, r, fill, stroke) => {
      ctx.beginPath();
      ctx.arc((gx + 0.5) * cell, (gy + 0.5) * cell, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    };

    // up-stairs at the entrance (green) and stairs down (amber) — the descent
    // hides until found, and boss floors have no down-stairs at all
    if (d.entranceCell) dot(d.entranceCell.x, d.entranceCell.y, cell * 0.42, "#6fce5b", "#1c3a16");
    if (d.hasDownStairs && d.stairsCell && seen(d.stairsCell.x, d.stairsCell.y))
      dot(d.stairsCell.x, d.stairsCell.y, cell * 0.42, "#ff9a3d", "#5a2a08");

    // enemies (small red pips) — only in discovered ground
    for (const e of d.enemies) {
      if (e.deadT >= 0) continue;
      const c = d.worldToCell(e.creature.position.x, e.creature.position.z);
      if (!seen(Math.round(c.x), Math.round(c.y))) continue;
      dot(c.x, c.y, cell * 0.22, "#e0503a");
    }

    // remote co-op player (cyan)
    if (remote && remote.parent) {
      const c = d.worldToCell(remote.position.x, remote.position.z);
      dot(c.x, c.y, cell * 0.34, "#4fd0e0", "#0d2f34");
    }

    // local player (white with a heading wedge)
    if (player) {
      const c = d.worldToCell(player.position.x, player.position.z);
      const px = (c.x + 0.5) * cell, py = (c.y + 0.5) * cell;
      const hx = Math.sin(player.heading), hy = Math.cos(player.heading);
      ctx.beginPath();
      ctx.moveTo(px + hx * cell * 0.7, py + hy * cell * 0.7);
      ctx.lineTo(px - hy * cell * 0.36, py + hx * cell * 0.36);
      ctx.lineTo(px + hy * cell * 0.36, py - hx * cell * 0.36);
      ctx.closePath();
      ctx.fillStyle = "#fff6dc";
      ctx.fill();
      dot(c.x, c.y, cell * 0.3, "#fff6dc", "#3a220a");
    }

    ctx.restore();
  }

  update() {
    const now = performance.now();
    this._tracked = this._tracked.filter((e) => {
      if (now > e.until || !e.target.parent) {
        e.el.remove();
        return false;
      }
      _v.setFromMatrixPosition(e.target.matrixWorld);
      _v.y += e.yOff + 0.25;
      const p = this._project(_v);
      if (p) {
        e.el.style.left = p.x + "px";
        e.el.style.top = p.y + "px";
        e.el.style.display = "block";
      } else e.el.style.display = "none";
      return true;
    });
  }

  _project(worldPos) {
    _v.copy(worldPos).project(this.engine.camera);
    if (_v.z > 1) return null;
    const view = this._viewRect();
    return {
      x: view.left + ((_v.x + 1) / 2) * view.width,
      y: view.top + ((1 - _v.y) / 2) * view.height,
    };
  }

  _viewRect() {
    const canvas = this.engine.renderer.domElement.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    if (!canvas.width || !canvas.height) {
      return { left: 0, top: 0, width: viewport.w, height: viewport.h };
    }
    return {
      left: canvas.left - root.left,
      top: canvas.top - root.top,
      width: canvas.width,
      height: canvas.height,
    };
  }

  // Like _project, but the FTUE guide arrow must never wink out: a target
  // beyond the far plane or behind the camera still gets a usable screen point
  // (mirrored back when it folds behind us) so the arrow can clamp to the edge
  // and point the way from clear across a large room. Unlike _project, never
  // returns null.
  _projectGuide(worldPos) {
    const cam = this.engine.camera;
    _gfwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const behind = _gdir.copy(worldPos).sub(cam.position).dot(_gfwd) <= 0;
    _v.copy(worldPos).project(cam);
    let nx = _v.x, ny = _v.y;
    if (behind) { nx = -nx; ny = -ny; }
    const view = this._viewRect();
    return {
      x: view.left + ((nx + 1) / 2) * view.width,
      y: view.top + ((1 - ny) / 2) * view.height,
    };
  }

  // ------------------------------------------------------------- sheets
  // `opts.onBackdrop` (optional) makes the sheet dismissible: a full-screen
  // backdrop is shown behind it and clicking outside the panel fires the cb.
  showSheet(html, cls = "", opts = {}) {
    // clear any per-sheet anchoring left over from a previous popover so the
    // default bottom-centre layout applies unless something re-anchors it.
    this._clearSheetAnchor();
    this.sheetEl.className = cls;
    this.sheetEl.innerHTML = html;
    this._onBackdrop = opts.onBackdrop || null;
    // Fires if the sheet is torn down by anything *other* than its own buttons
    // (opening the bag/store, entering the dungeon, day-end, a net event…). Lets
    // an in-progress negotiation cancel cleanly instead of stranding the shopper
    // mid-haggle — see haggle() and shop.startHaggle.
    this._onSheetClose = opts.onClose || null;
    this.backdropEl.classList.toggle("hidden", !this._onBackdrop);
    this._applyBagBtn();
    this._initSheetNav();
    return this.sheetEl;
  }

  // ---------------------------------------------------------- keyboard nav
  // Every sheet gets basic keyboard driving for free: J/K (or arrows) move a
  // highlight across the primary buttons, Enter fires the focused one and Esc
  // backs out via the cancel button. Special sheets (the haggle deal) install
  // their own handler through `setSheetKeys`, which supersedes this.
  _initSheetNav() {
    this._sheetKeyHandler = null;
    this._navBtns = [...this.sheetEl.querySelectorAll(".sheet-btns button:not([disabled])")];
    // Esc backs out through whatever "cancel" the sheet offers. A corner close
    // (X) button is the truest "abandon without committing", so it wins over a
    // secondary deny choice; either way we fall back to the caller's Esc=close.
    this._navCancel =
      this.sheetEl.querySelector(".icon-btn[id$='-close'], #esc-x") ||
      this.sheetEl.querySelector(".sheet-btns .deny") ||
      null;
    this._navIdx = -1;
    if (this._navBtns.length) {
      // start on the primary (green "deal") action so Enter confirms at once
      const primary = this._navBtns.findIndex((b) => b.classList.contains("deal"));
      this._setNavFocus(primary >= 0 ? primary : 0);
    }
  }

  _setNavFocus(i) {
    if (!this._navBtns.length) return;
    const n = this._navBtns.length;
    this._navIdx = ((i % n) + n) % n;
    this._navBtns.forEach((b, k) => b.classList.toggle("kb-focus", k === this._navIdx));
  }

  // Let a sheet override the default button-nav with its own key routing
  // (return true from the handler to swallow a key). Call after showSheet.
  setSheetKeys(handler) {
    this._sheetKeyHandler = handler;
    // the custom sheet drives its own controls, so drop the button highlight
    this._navBtns?.forEach((b) => b.classList.remove("kb-focus"));
    this._navIdx = -1;
  }

  // Route a keydown into the open sheet. Returns true if the sheet consumed it.
  sheetKey(code) {
    if (!this.sheetOpen) return false;
    if (this._sheetKeyHandler) return this._sheetKeyHandler(code);
    const btns = this._navBtns || [];
    switch (code) {
      case "KeyK":
      case "ArrowRight":
      case "ArrowDown":
        if (!btns.length) return false;
        this._setNavFocus(this._navIdx + 1);
        return true;
      case "KeyJ":
      case "ArrowLeft":
      case "ArrowUp":
        if (!btns.length) return false;
        this._setNavFocus(this._navIdx - 1);
        return true;
      case "Enter":
      case "NumpadEnter":
        if (this._navIdx < 0 || !btns[this._navIdx]) return false;
        btns[this._navIdx].click();
        return true;
      case "Escape":
        if (!this._navCancel) return false; // let the caller close the sheet
        this._navCancel.click();
        return true;
    }
    return false;
  }

  _clearSheetAnchor() {
    const s = this.sheetEl.style;
    s.left = s.top = s.bottom = s.transform = "";
  }

  // Float the currently-shown sheet just above a world point (e.g. the table
  // slot being edited) so the player barely has to move the mouse. It can
  // overlap the point if that's what fits on screen.
  anchorSheetAbove(worldPos) {
    if (this.sheetEl.classList.contains("hidden")) return;
    // The backpack/storeroom buttons live on the bottom edge (66px tall plus
    // the safe-area inset), so keep the sheet's bottom clear of that strip
    // instead of letting it drop all the way down where it'd cover the bag.
    const bottomReserve = 66 + 26;
    // On a phone held upright the tables sit high in the frame, so anchoring the
    // menu above the slot pushes it out of thumb's reach. Keep it pinned near
    // the bottom, but raise it above the bag/storeroom buttons so they don't
    // overlap the sheet's controls.
    const view = this._viewRect();
    if (matchMedia("(pointer: coarse)").matches && view.height > view.width) {
      this._clearSheetAnchor();
      this.sheetEl.style.bottom = `calc(${bottomReserve}px + env(safe-area-inset-bottom))`;
      return;
    }
    const p = this._project(worldPos);
    const el = this.sheetEl;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = view.width, vh = view.height;
    const gap = 12, edge = 10;
    let left, top;
    if (p) {
      left = p.x - w / 2;
      top = p.y - h - gap; // sit above the point
    } else {
      left = (vw - w) / 2;
      top = vh - h - bottomReserve;
    }
    left = Math.max(edge, Math.min(left, vw - w - edge));
    top = Math.max(edge, Math.min(top, vh - h - bottomReserve));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.bottom = "auto";
    el.style.transform = "none";
  }

  hideSheet() {
    // Grab and clear the close hook up front so the callback firing (which may
    // itself close the sheet again) can't recurse back into here.
    const onClose = this._onSheetClose;
    this._onSheetClose = null;
    this._clearSheetAnchor();
    this._onBackdrop = null;
    this.backdropEl.classList.add("hidden");
    this.sheetEl.className = "hidden";
    this.sheetEl.innerHTML = "";
    this.portraitsEl.innerHTML = "";
    this._sheetKeyHandler = null;
    this._navBtns = [];
    this._navCancel = null;
    this._navIdx = -1;
    this._applyBagBtn();
    if (onClose) onClose();
  }

  get sheetOpen() {
    return !this.sheetEl.classList.contains("hidden");
  }

  /**
   * The Recettear moment. cfg: {itemName, icon, base, custName, mood0}
   * cb: {onDeal(price), onLeave()} — returns controller with methods the
   * shop uses to advance the negotiation.
   */
  haggle(cfg, cb) {
    // `buying` flips the negotiation: the customer is offloading an item onto
    // the player, so we open low and relabel the sheet for the reverse deal.
    const buying = !!cfg.buying;
    let price = Math.round(cfg.base * (buying ? 0.7 : 1.25));
    // shopkeeper on the left, customer on the right — like Recettear. When the
    // customer is the one selling, mirror the layout so the NPC sits on the
    // left and the player on the right (both still angled inward).
    const meSide = buying ? "right" : "left";
    const custSide = buying ? "left" : "right";
    const meImg = portraitDataURL(cfg.playerVariant ?? "a", meSide);
    const custImg = portraitDataURL(cfg.custVariant ?? "b", custSide);
    this.portraitsEl.innerHTML = `
      ${meImg ? `<img class="hg-portrait hg-me${buying ? " hg-flip" : ""}" src="${meImg}" alt="">` : ""}
      ${custImg ? `<img class="hg-portrait hg-cust${buying ? " hg-flip" : ""}" src="${custImg}" alt="">` : ""}
    `;
    const el = this.showSheet(`
      <div class="hg-eyecatch">
        <div class="hg-eyecatch-label">${buying ? "They're Selling" : "Eyecatch Item"}</div>
        <div class="hg-eyecatch-name">${cfg.itemName}</div>
        <div class="hg-frame ti-${cfg.tier ?? 1}"><span class="big-emoji">${itemIcon(cfg.icon)}</span></div>
        <div class="hg-base">Base Price ${cfg.base}</div>
        <div class="mood" id="hg-mood">${icon("faceHappy")}</div>
      </div>
      <div class="hg-speech" id="hg-speech">${buying ? `"Wanna buy this ${cfg.itemName}?"` : `"How much for the ${cfg.itemName}?"`}</div>
      <div class="hg-price-row">
        <button class="btn small" id="hg-m10">−10%</button>
        <button class="btn small" id="hg-m">−</button>
        <div class="hg-roulette" id="hg-price"></div>
        <button class="btn small" id="hg-p">+</button>
        <button class="btn small" id="hg-p10">+10%</button>
      </div>
      <div class="hg-pct" id="hg-pct">125% Of Base Price</div>
      <div class="sheet-btns">
        <button class="btn deny" id="hg-no">${buying ? "Walk away" : "No sale"}</button>
        <button class="btn deal" id="hg-deal">${buying ? "Buy!" : "Offer!"}</button>
      </div>
    `, "sheet-card hg-card", {
      // If the sheet is dismissed out from under the negotiation (the player
      // pops the bag/store/chat, descends to the cave, the day ends…), treat it
      // as walking away so the shopper resolves instead of freezing at the
      // counter forever. A normal deal/no-sale has already cleared this hook.
      onClose: () => cb.onLeave(),
    });
    const priceEl = el.querySelector("#hg-price");
    const pctEl = el.querySelector("#hg-pct");
    const moodEl = el.querySelector("#hg-mood");
    const speechEl = el.querySelector("#hg-speech");
    const dealBtn = el.querySelector("#hg-deal");
    const setPrice = (p) => {
      price = Math.max(1, Math.round(p));
      // digit-roulette display, padded so the number sits in fixed cells
      const digits = String(price).padStart(4, " ");
      priceEl.innerHTML = digits
        .split("")
        .map((d) => `<span class="hg-digit${d === " " ? " blank" : ""}">${d === " " ? "0" : d}</span>`)
        .join("");
      pctEl.textContent = `${Math.round((price / cfg.base) * 100)}% Of Base Price`;
    };
    setPrice(price);
    el.querySelector("#hg-m").onclick = () => setPrice(price - Math.max(1, cfg.base * 0.02));
    el.querySelector("#hg-p").onclick = () => setPrice(price + Math.max(1, cfg.base * 0.02));
    el.querySelector("#hg-m10").onclick = () => setPrice(price - cfg.base * 0.1);
    el.querySelector("#hg-p10").onclick = () => setPrice(price + cfg.base * 0.1);
    dealBtn.onclick = () => cb.onDeal(price);
    el.querySelector("#hg-no").onclick = () => cb.onLeave();
    // keyboard: J/K nudge the price down/up, Enter seals the deal, Esc walks.
    const step = Math.max(1, cfg.base * 0.02);
    this.setSheetKeys((code) => {
      switch (code) {
        case "KeyJ":
        case "ArrowLeft":
        case "ArrowDown":
          setPrice(price - step);
          return true;
        case "KeyK":
        case "ArrowRight":
        case "ArrowUp":
          setPrice(price + step);
          return true;
        case "Enter":
        case "NumpadEnter":
          cb.onDeal(price);
          return true;
        case "Escape":
          cb.onLeave();
          return true;
      }
      return false;
    });
    return {
      setMood: (m) => (moodEl.innerHTML = icon(m)),
      say: (t) => {
        speechEl.textContent = t;
        speechEl.classList.remove("pop");
        void speechEl.offsetWidth;
        speechEl.classList.add("pop");
      },
      setPrice,
      getPrice: () => price,
      close: () => this.hideSheet(),
    };
  }
}
