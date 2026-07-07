// Shared prototype scaffolding for the bargaining minigames.
// Mirrors shop.js data (archetypes, maxPay rolls, grade bands) so a winning
// prototype maps 1:1 onto the real haggle — but imports nothing from src/.

export const ARCHETYPES = [
  { name: "Cheapskate", face: "🙄", lo: 1.02, hi: 1.18, w: 3 },
  { name: "Regular", face: "🙂", lo: 1.1, hi: 1.4, w: 5 },
  { name: "Wealthy", face: "🧐", lo: 1.3, hi: 1.75, w: 2 },
  { name: "Collector", face: "🤩", lo: 1.5, hi: 2.2, w: 1 },
];

export const ITEMS = [
  { name: "Rusty Dagger", icon: "🗡️", base: 40 },
  { name: "Healing Tonic", icon: "🧪", base: 65 },
  { name: "Bat-Wing Cloak", icon: "🦇", base: 90 },
  { name: "Silver Lantern", icon: "🏮", base: 120 },
  { name: "Rune Shield", icon: "🛡️", base: 160 },
  { name: "Moon Amulet", icon: "🌙", base: 220 },
];

export const NAMES = [
  "Barnaby", "Greta", "Pip", "Morwenna", "Tobias", "Hilda",
  "Cornelius", "Fenn", "Ottoline", "Grum", "Sable", "Wick",
];

export const MOODS = {
  happy: "🙂", eager: "😃", star: "🤩", think: "🤔",
  confused: "😕", angry: "😠", huff: "😤", shocked: "😲",
};

export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function weightedArch() {
  const total = ARCHETYPES.reduce((s, a) => s + a.w, 0);
  let r = Math.random() * total;
  for (const a of ARCHETYPES) if ((r -= a.w) < 0) return a;
  return ARCHETYPES[0];
}

/** Roll a customer + item pair, with the same hidden maxPay as the game. */
export function rollCustomer() {
  const arch = weightedArch();
  const item = pick(ITEMS);
  const maxPay = Math.round(item.base * (arch.lo + Math.random() * (arch.hi - arch.lo)));
  return { name: pick(NAMES), arch, item, maxPay };
}

/** Same grade bands as shop.js startHaggle. */
export function gradeSale(price, maxPay) {
  return price >= maxPay * 0.92 ? "perfect" : price >= maxPay * 0.75 ? "good" : "cheap";
}

/** Wire up the shared customer card + result overlay. Returns UI handles. */
export function setupUI(root = document) {
  const $ = (id) => root.getElementById(id);
  const faceEl = $("face"), sayEl = $("say"), nameEl = $("custname"), archEl = $("arch");
  const itemEl = $("itemname"), baseEl = $("itembase"), strikesEl = $("strikes");
  const resultEl = $("result"), gradeEl = $("grade"), detailEl = $("detail");
  const statsEl = $("stats");

  let earned = 0, deals = 0, seen = 0;

  return {
    showCustomer(cust) {
      seen++;
      nameEl.textContent = cust.name;
      archEl.textContent = cust.arch.name;
      itemEl.textContent = `${cust.item.icon} ${cust.item.name}`;
      baseEl.textContent = `base value ${cust.item.base}g`;
      this.mood(cust.arch.face);
      resultEl.classList.remove("show");
    },
    mood(emoji) {
      faceEl.textContent = emoji;
      faceEl.classList.remove("pop");
      void faceEl.offsetWidth; // restart the pop animation
      faceEl.classList.add("pop");
    },
    say(text) { sayEl.textContent = text; },
    strikes(n, max = 3) {
      strikesEl.textContent = n ? "❌".repeat(n) + "▫️".repeat(max - n) : "";
    },
    /** grade: perfect/good/cheap/fair/fail. price 0 on fail. */
    finish(grade, price, detail, maxPay) {
      if (price > 0) { earned += price; deals++; }
      gradeEl.textContent =
        grade === "fail" ? "NO DEAL" : grade.toUpperCase() + (grade === "perfect" ? "!" : "");
      gradeEl.className = "grade " + grade;
      detailEl.textContent =
        (price > 0 ? `Sold for ${price}g\n` : "") +
        (maxPay != null ? `(they'd have paid up to ${maxPay}g)\n` : "") +
        (detail || "");
      resultEl.classList.add("show");
      statsEl.textContent = `${deals}/${seen} deals · ${earned}g earned this session`;
    },
  };
}

/** Shared page skeleton so each prototype only writes its minigame area. */
export function pageShell({ title, tag, gameHTML, extraControls = "" }) {
  document.body.innerHTML = `
    <a class="back" href="./index.html">← all prototypes</a>
    <h1>${title}</h1>
    <div class="tag">${tag}</div>
    <div class="sheet">
      <div class="cust">
        <div class="face" id="face">🙂</div>
        <div class="who">
          <b id="custname"></b> <span class="arch" id="arch"></span>
          <div class="say" id="say"></div>
        </div>
      </div>
      <div class="item">
        <span id="itemname"></span>
        <span class="base" id="itembase"></span>
      </div>
      <div id="game">${gameHTML}</div>
      <div class="strikes" id="strikes"></div>
      ${extraControls}
    </div>
    <div class="stats" id="stats"></div>
    <div class="result" id="result">
      <div class="card">
        <div class="grade" id="grade"></div>
        <div class="detail" id="detail"></div>
        <button class="btn primary" id="next">Next customer</button>
      </div>
    </div>`;
}
