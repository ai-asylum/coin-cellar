// All 2D UI is DOM — crisp on any mobile screen, styled in style.css.
// The HUD projects 3D anchors for floating damage numbers / emotes.
import * as THREE from "three";
import { portraitDataURL } from "../chargen/portrait.js";
import { icon, itemIcon, ICONS } from "../core/icons.js";

const _v = new THREE.Vector3();

export class HUD {
  constructor(root, engine) {
    this.engine = engine;
    root.innerHTML = `
      <div id="topbar">
        <div class="chip" id="gold-chip">${icon("coin")} <b id="gold-num">0</b></div>
        <div class="chip" id="debt-chip">${icon("scroll")} –</div>
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
      ${this._clockMarkup()}
      <canvas id="minimap" class="hidden" aria-hidden="true"></canvas>
      <div id="banner" class="hidden"><div id="banner-main"></div><div id="banner-sub"></div></div>
      <div id="bossbar" class="hidden">
        <div id="bossbar-name"></div>
        <div id="bossbar-track"><div id="bossbar-fill"></div></div>
        <div id="bossbar-tel" class="hidden">
          <span id="bossbar-tel-name"></span>
          <div id="bossbar-tel-track"><div id="bossbar-tel-fill"></div></div>
        </div>
      </div>
      <div id="toast-wrap"></div>
      <div id="floaties"></div>
      <div id="tut-guide" class="hidden">
        <div class="tg-text"></div>
        <div class="tg-arrow"><span class="tg-bob"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5 h16 l-8 14 z"/></svg></span></div>
      </div>
      <div id="interact-hint" class="hidden"></div>
      <div id="hearts" class="hidden"></div>
      <div id="portraits"></div>
      <div id="hurt-flash"></div>
      <div id="sheet" class="hidden"></div>
    `;
    this.root = root;
    this.goldNum = root.querySelector("#gold-num");
    this.goldChip = root.querySelector("#gold-chip");
    this.clockEl = root.querySelector("#dayclock");
    this.clockSky = root.querySelector("#clk-sky");
    this.clockArc = root.querySelector("#clk-arc");
    this.clockHand = root.querySelector("#clk-hand");
    this.clockMarker = root.querySelector("#clk-marker");
    this.clockDayNum = root.querySelector("#clk-daynum");
    this.clockPhase = root.querySelector("#clk-phase");
    this.clockGlyph = root.querySelector("#clk-marker-icon .clk-marker-glyph");
    this._clockGlyphPhase = "day";
    this._clockDay = 1;
    this._clockPhaseName = "day";
    this.debtChip = root.querySelector("#debt-chip");
    this.heartsEl = root.querySelector("#hearts");
    this.bannerEl = root.querySelector("#banner");
    this.bossbarEl = root.querySelector("#bossbar");
    this.bossbarNameEl = root.querySelector("#bossbar-name");
    this.bossbarFillEl = root.querySelector("#bossbar-fill");
    this._bossbarName = null;
    this.bossTelEl = root.querySelector("#bossbar-tel");
    this.bossTelNameEl = root.querySelector("#bossbar-tel-name");
    this.bossTelFillEl = root.querySelector("#bossbar-tel-fill");
    this._bossTelAtk = null;
    this.sheetEl = root.querySelector("#sheet");
    this.portraitsEl = root.querySelector("#portraits");
    this.floatiesEl = root.querySelector("#floaties");
    this.hurtFlashEl = root.querySelector("#hurt-flash");
    this.toastWrap = root.querySelector("#toast-wrap");
    this.guideEl = root.querySelector("#tut-guide");
    this.guideTextEl = this.guideEl.querySelector(".tg-text");
    this.guideArrowEl = this.guideEl.querySelector(".tg-arrow");
    this._guideText = null;
    this.hintEl = root.querySelector("#interact-hint");
    this._hintSig = null;
    this.minimapEl = root.querySelector("#minimap");
    this.minimapCtx = this.minimapEl.getContext("2d");
    this._miniBase = null;
    this._miniBaseKey = null;
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

  // ------------------------------------------------------- Majora clock
  _clockMarkup() {
    // Semicircle dial (like Majora's Mask): the sun rises at the left horizon
    // (dawn), peaks at the top (noon) and sets at the right (dusk). The progress
    // half-ring has radius 53, so its arc length is π·53 ≈ 166.5.
    const ticks = Array.from({ length: 9 }, (_, i) => {
      const th = Math.PI - (i / 8) * Math.PI; // 180° (left) → 0° (right)
      const major = i % 4 === 0;
      const r0 = major ? 44 : 47, r1 = 51;
      return `<line x1="${(70 + Math.cos(th) * r0).toFixed(2)}" y1="${(66 - Math.sin(th) * r0).toFixed(2)}" x2="${(70 + Math.cos(th) * r1).toFixed(2)}" y2="${(66 - Math.sin(th) * r1).toFixed(2)}" class="${major ? "clk-tick-major" : "clk-tick"}"/>`;
    }).join("");
    return `
      <div id="dayclock" class="phase-day">
        <svg viewBox="0 0 140 76" aria-hidden="true">
          <defs>
            <linearGradient id="clk-sky-grad" x1="0" y1="0" x2="0" y2="1">
              <stop id="clk-sky" offset="0%" stop-color="#ffe9a8"/>
              <stop offset="100%" stop-color="#e7a13c"/>
            </linearGradient>
          </defs>
          <path class="clk-face" d="M 12 66 A 58 58 0 0 1 128 66 Z" fill="url(#clk-sky-grad)"/>
          <g class="clk-ticks">${ticks}</g>
          <path class="clk-track" d="M 17 66 A 53 53 0 0 1 123 66"/>
          <path id="clk-arc" class="clk-arc" d="M 17 66 A 53 53 0 0 1 123 66"
                stroke-dasharray="166.5" stroke-dashoffset="166.5"/>
          <text id="clk-daynum" x="70" y="47" class="clk-daynum">1</text>
          <text id="clk-phase" x="70" y="60" class="clk-daylabel">DAY</text>
          <g id="clk-hand" transform="translate(17 66)">
            <circle id="clk-marker" r="8" class="clk-marker"/>
            <g id="clk-marker-icon"><g class="clk-marker-glyph" transform="scale(0.3) translate(-12 -12)">${ICONS.sun}</g></g>
          </g>
        </svg>
      </div>`;
  }

  setDay(day, phase) {
    this._clockDay = day;
    this._clockPhaseName = phase;
    if (this.clockDayNum) this.clockDayNum.textContent = day;
    if (this.clockPhase) this.clockPhase.textContent = phase === "day" ? "DAY" : "NIGHT";
    if (this.clockEl) {
      this.clockEl.classList.toggle("phase-day", phase === "day");
      this.clockEl.classList.toggle("phase-night", phase !== "day");
    }
    // Night has no countdown — park the moon at dusk with the arc filled.
    if (phase !== "day") this.setDayProgress(1, "night");
  }

  /**
   * Advance the Majora's-Mask dial. `frac` is how much of the day has elapsed
   * (0 at dawn → 1 at dusk). During `night` we show the moon instead of the sun.
   */
  setDayProgress(frac, phase = "day") {
    if (!this.clockArc) return;
    frac = Math.max(0, Math.min(1, frac));
    const L = 166.5; // arc length of the r=53 half-ring
    this.clockArc.style.strokeDashoffset = (L * (1 - frac)).toFixed(2);
    // Slide the sun/moon along the semicircle: 180° (dawn) → 0° (dusk).
    const th = Math.PI - frac * Math.PI;
    const x = 70 + Math.cos(th) * 53;
    const y = 66 - Math.sin(th) * 53;
    this.clockHand.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    if (this.clockGlyph && phase !== this._clockGlyphPhase) {
      this.clockGlyph.innerHTML = phase === "day" ? ICONS.sun : ICONS.moon;
      this._clockGlyphPhase = phase;
    }
    // Warm daylight sky slowly cools toward sunset red as the day burns down.
    if (this.clockSky && phase === "day") {
      const t = frac;
      const g = Math.round(233 - t * 90);
      const b = Math.round(168 - t * 120);
      this.clockSky.setAttribute("stop-color", `rgb(255,${Math.max(60, g)},${Math.max(40, b)})`);
    }
  }

  setDebt(text, urgent = false) {
    this.debtChip.innerHTML = `${icon("scroll")} ${text}`;
    this.debtChip.classList.toggle("urgent", urgent);
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

  // The backpack button is a dungeon-only affordance.
  showBag(visible) {
    const btn = this.root.querySelector("#bag-btn");
    if (btn) btn.classList.toggle("hidden", !visible);
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
    this.clearBossTelegraph();
  }

  /** Windup warning under the boss bar: which attack is coming + a fill that
   * races toward the moment it lands. frac is windup progress, 0 → 1. */
  setBossTelegraph(atk, frac) {
    this.bossTelEl.classList.remove("hidden");
    if (atk !== this._bossTelAtk) {
      this._bossTelAtk = atk;
      this.bossTelEl.dataset.atk = atk;
      this.bossTelNameEl.textContent =
        atk === "charge" ? "⚠ Charge — sidestep!" :
        atk === "burst" ? "⚠ Orb Burst — weave the gaps!" :
        "⚠ Slam — back away!";
    }
    this.bossTelFillEl.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + "%";
  }

  clearBossTelegraph() {
    this.bossTelEl.classList.add("hidden");
    this._bossTelAtk = null;
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

  // -------------------------------------------------- FTUE guide + key hints
  /**
   * Bouncing arrow + text label over a world position (the current tutorial
   * objective). When the target is off-screen the arrow clamps to the screen
   * edge and swivels to point toward it. Call every frame while guiding.
   */
  guide(worldPos, text) {
    const p = this._project(worldPos);
    if (!p) return this.hideGuide();
    const el = this.guideEl;
    el.classList.remove("hidden");
    if (text !== this._guideText) {
      this._guideText = text;
      this.guideTextEl.innerHTML = text;
    }
    const m = 70;
    const x = Math.max(m, Math.min(window.innerWidth - m, p.x));
    const y = Math.max(m, Math.min(window.innerHeight - m, p.y - 44));
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

  // ------------------------------------------------------------- minimap
  showMinimap(visible) {
    this.minimapEl.classList.toggle("hidden", !visible);
  }

  /**
   * Draw the dungeon floor plan: revealed room/corridor cells, the entrance,
   * the stairs down (exit), live enemies and the player(s). `d` is the Dungeon;
   * `player`/`remote` are Creatures (world-space) — remote may be null.
   */
  renderMinimap(d, player, remote) {
    const el = this.minimapEl;
    if (!el || el.classList.contains("hidden") || !d.open) return;
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
      // fill discovered cells as one merged shape (full cells → no inner seams)
      bx.fillStyle = "#e6d3a1";
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++)
          if (seen(x, y)) bx.fillRect(x * cell, y * cell, cell, cell);
      // black outline only where a discovered cell meets undiscovered ground
      bx.strokeStyle = "#000";
      bx.lineWidth = 1.4;
      bx.lineCap = "square";
      bx.beginPath();
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++) {
          if (!seen(x, y)) continue;
          const l = x * cell, t = y * cell, r = l + cell, b = t + cell;
          if (!seen(x, y - 1)) { bx.moveTo(l, t); bx.lineTo(r, t); }
          if (!seen(x, y + 1)) { bx.moveTo(l, b); bx.lineTo(r, b); }
          if (!seen(x - 1, y)) { bx.moveTo(l, t); bx.lineTo(l, b); }
          if (!seen(x + 1, y)) { bx.moveTo(r, t); bx.lineTo(r, b); }
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

    // entrance (green) and stairs down / exit (amber) — exit hides until found
    if (d.entranceCell) dot(d.entranceCell.x, d.entranceCell.y, cell * 0.42, "#6fce5b", "#1c3a16");
    if (d.stairsCell && seen(d.stairsCell.x, d.stairsCell.y))
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
    this.portraitsEl.innerHTML = "";
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
        <div class="hg-frame"><span class="big-emoji">${itemIcon(cfg.icon)}</span></div>
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
    `, "sheet-card hg-card");
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
