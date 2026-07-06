// All 2D UI is DOM — crisp on any mobile screen, styled in style.css.
// The HUD projects 3D anchors for floating damage numbers / emotes.
import * as THREE from "three";

const _v = new THREE.Vector3();

export class HUD {
  constructor(root, engine) {
    this.engine = engine;
    root.innerHTML = `
      <div id="topbar">
        <div class="chip" id="gold-chip">💰 <b id="gold-num">0</b></div>
        <div class="chip" id="day-chip">Day 1</div>
        <div class="chip" id="debt-chip">📜 –</div>
        <div class="chip" id="hearts"></div>
        <div class="chip-btns">
          <button class="icon-btn" id="bag-btn">🎒</button>
          <button class="icon-btn" id="coop-btn">👥</button>
          <button class="icon-btn" id="mute-btn">🔊</button>
        </div>
      </div>
      <div id="banner" class="hidden"><div id="banner-main"></div><div id="banner-sub"></div></div>
      <div id="toast-wrap"></div>
      <div id="floaties"></div>
      <div id="sheet" class="hidden"></div>
    `;
    this.root = root;
    this.goldNum = root.querySelector("#gold-num");
    this.goldChip = root.querySelector("#gold-chip");
    this.dayChip = root.querySelector("#day-chip");
    this.debtChip = root.querySelector("#debt-chip");
    this.heartsEl = root.querySelector("#hearts");
    this.bannerEl = root.querySelector("#banner");
    this.sheetEl = root.querySelector("#sheet");
    this.floatiesEl = root.querySelector("#floaties");
    this.toastWrap = root.querySelector("#toast-wrap");
    this._bannerT = null;
    this._tracked = [];
    this._gold = 0;
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

  setDay(day, phase) {
    this.dayChip.textContent = `Day ${day} ${phase === "day" ? "☀️" : "🌙"}`;
  }

  setDebt(text, urgent = false) {
    this.debtChip.textContent = `📜 ${text}`;
    this.debtChip.classList.toggle("urgent", urgent);
  }

  setHearts(hp, max) {
    let s = "";
    for (let i = 0; i < max; i++) s += i < hp ? "❤️" : "🖤";
    this.heartsEl.textContent = s;
  }

  banner(main, sub = "", dur = 2.2) {
    this.bannerEl.classList.remove("hidden");
    this.bannerEl.querySelector("#banner-main").textContent = main;
    this.bannerEl.querySelector("#banner-sub").textContent = sub;
    clearTimeout(this._bannerT);
    if (dur > 0) this._bannerT = setTimeout(() => this.bannerEl.classList.add("hidden"), dur * 1000);
  }

  hideBanner() {
    this.bannerEl.classList.add("hidden");
  }

  toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toastWrap.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /** Floating text at a world position (damage numbers, +gold). */
  float(worldPos, text, cls = "") {
    const p = this._project(worldPos);
    if (!p) return;
    const el = document.createElement("div");
    el.className = "floaty " + cls;
    el.textContent = text;
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    this.floatiesEl.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  /** Emoji that follows a 3D object (customer emotes, "!" bubbles). */
  emote(target, emoji, dur = 1.6, cls = "emote") {
    const el = document.createElement("div");
    el.className = "floaty " + cls;
    el.textContent = emoji;
    this.floatiesEl.appendChild(el);
    const entry = { target, el, yOff: target.height ?? 1.6, until: performance.now() + dur * 1000 };
    this._tracked.push(entry);
    return entry;
  }

  removeEmote(entry) {
    entry.until = 0;
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
    return {
      x: ((_v.x + 1) / 2) * window.innerWidth,
      y: ((1 - _v.y) / 2) * window.innerHeight,
    };
  }

  // ------------------------------------------------------------- sheets
  showSheet(html, cls = "") {
    this.sheetEl.className = cls;
    this.sheetEl.innerHTML = html;
    return this.sheetEl;
  }

  hideSheet() {
    this.sheetEl.className = "hidden";
    this.sheetEl.innerHTML = "";
  }

  get sheetOpen() {
    return !this.sheetEl.classList.contains("hidden");
  }

  /**
   * The Recettear moment. cfg: {itemName, emoji, base, custName, mood0}
   * cb: {onDeal(price), onLeave()} — returns controller with methods the
   * shop uses to advance the negotiation.
   */
  haggle(cfg, cb) {
    let price = Math.round(cfg.base * 1.25);
    const el = this.showSheet(`
      <div class="sheet-title"><span class="big-emoji">${cfg.emoji}</span>
        <div><b>${cfg.itemName}</b><br/><small>base value ${cfg.base}g</small></div>
        <div class="mood" id="hg-mood">🙂</div>
      </div>
      <div class="hg-speech" id="hg-speech">"How much for the ${cfg.itemName}?"</div>
      <div class="hg-price-row">
        <button class="btn small" id="hg-m10">−10%</button>
        <button class="btn small" id="hg-m">−</button>
        <div class="hg-price"><b id="hg-price">${price}</b>g</div>
        <button class="btn small" id="hg-p">+</button>
        <button class="btn small" id="hg-p10">+10%</button>
      </div>
      <div class="sheet-btns">
        <button class="btn deny" id="hg-no">No sale</button>
        <button class="btn deal" id="hg-deal">Offer!</button>
      </div>
    `, "sheet-card");
    const priceEl = el.querySelector("#hg-price");
    const moodEl = el.querySelector("#hg-mood");
    const speechEl = el.querySelector("#hg-speech");
    const dealBtn = el.querySelector("#hg-deal");
    const setPrice = (p) => {
      price = Math.max(1, Math.round(p));
      priceEl.textContent = price;
    };
    el.querySelector("#hg-m").onclick = () => setPrice(price - Math.max(1, cfg.base * 0.02));
    el.querySelector("#hg-p").onclick = () => setPrice(price + Math.max(1, cfg.base * 0.02));
    el.querySelector("#hg-m10").onclick = () => setPrice(price - cfg.base * 0.1);
    el.querySelector("#hg-p10").onclick = () => setPrice(price + cfg.base * 0.1);
    dealBtn.onclick = () => cb.onDeal(price);
    el.querySelector("#hg-no").onclick = () => cb.onLeave();
    return {
      setMood: (m) => (moodEl.textContent = m),
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
