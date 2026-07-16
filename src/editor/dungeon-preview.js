// The editor's Dungeon tab: drives the real floor generator (the same Dungeon
// class the game runs) against a stub game, so seeds, palettes, monster mixes
// and the GEN tuning knobs can be checked without delving. Everything edited
// here mutates the live in-memory tables (GEN / HOLE_THEMES / DUNGEON_MIX /
// ENEMY_KINDS) and regenerates. Ctrl+S ("Save tuning") persists them to
// src/game/dungeon-tuning.json, which dungeon-data.js folds over its code
// defaults at load; "Copy tuning JSON" is a clipboard fallback.
import * as THREE from "three";
import { Dungeon } from "../game/dungeon.js";
import { loadDungeonAssets, dungeonAssetsReady } from "../game/dungeon-assets.js";
import {
  DUNGEON_ORIGIN, GEN, GEN_BY_FLOOR, genFor, ENEMY_KINDS, HOLE_THEMES, DEFAULT_THEME, DUNGEON_MIX,
  BOSSES, MAX_DEPTH, FLOORS_PER_DUNGEON, isBossFloor, dungeonIndexFor,
  bossDefFor, floorMixFor,
} from "../game/dungeon-data.js";
import { el, row, numInput, colorInput } from "./ui.js";

const DUNGEON_NAMES = ["Rat Warren", "Flooded Deep", "Bone Hollow", "Gloom Drain"];

// GEN knobs surfaced in the panel: [key, label, step]
const GEN_FIELDS = [
  ["gw", "grid w", 1], ["gh", "grid h", 1], ["ghBoss", "boss grid h", 1],
  ["roomsBase", "rooms base", 1], ["roomsCap", "rooms cap", 1], ["roomsRand", "rooms rand", 1],
  ["roomMin", "room min", 1], ["roomWRand", "room w rand", 1], ["roomHRand", "room h rand", 1],
  ["loopBase", "loops base", 1], ["loopRand", "loops rand", 1],
  ["enemyBase", "enemies base", 1], ["enemyRand", "enemies rand", 1],
  ["spawnCapBase", "spawn cap", 1], ["spawnCapPer", "cap / floor", 1],
  ["chestBase", "chests base", 1], ["chestRand", "chests rand", 1],
  ["keyChance", "key chance", 0.05],
];

// per-kind stats surfaced for monster tuning: [key, step]
const KIND_FIELDS = [
  ["hp", 1], ["dmg", 1], ["speed", 0.1], ["aggro", 0.5],
  ["windup", 0.02], ["reach", 0.05], ["dropRate", 0.05],
];

export class DungeonPreview {
  constructor(engine, panelEl, setStatus) {
    this.engine = engine;
    this.panelEl = panelEl;
    this.setStatus = setStatus;
    this.dungeon = null;
    this.floor = 1;
    this.seed = 1;
    this.tutorial = false;
    this.statKind = null; // which ENEMY_KINDS entry the stats block shows
    this._loading = false;
    // the wall-dither "hero" the occlusion shader tracks — pinned to wherever
    // the freecam is looking so walls between camera and focus fade away
    this.probe = { position: new THREE.Vector3().copy(DUNGEON_ORIGIN), height: 1.7 };
  }

  _stubGame() {
    const noop = () => {};
    let nextId = 1;
    return {
      engine: this.engine,
      audio: new Proxy({}, { get: () => noop }),
      particles: { burst: noop },
      net: { isGuest: false, newId: () => nextId++, send: noop, trackEnemy: noop },
      player: this.probe,
      playersInDungeon: () => [],
      enemyHitsPlayer: noop,
      enemyProjectileHitsPlayer: noop,
      gameOver: false,
      // same AABB pushout as Game.collide — enemies wander without walking
      // through walls even though no real Game is running
      collide(pos, radius, colliders) {
        for (const c of colliders) {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const px = c.hw + radius - Math.abs(dx);
          const pz = c.hd + radius - Math.abs(dz);
          if (px > 0 && pz > 0) {
            if (px < pz) pos.x += dx > 0 ? px : -px;
            else pos.z += dz > 0 ? pz : -pz;
          }
        }
      },
    };
  }

  async enter() {
    if (!dungeonAssetsReady() && !this._loading) {
      this._loading = true;
      this.setStatus("loading dungeon kit…");
      try {
        await loadDungeonAssets();
      } catch (err) {
        console.error(err);
        this.setStatus("dungeon kit failed to load — previewing with fallback boxes", "error");
      }
      this._loading = false;
    }
    if (!this.dungeon) this.dungeon = new Dungeon(this._stubGame());
    this.regen();
  }

  exit() {
    this.dungeon?.dispose();
  }

  regen(report = true) {
    this.dungeon.generate(this.floor, this.seed, this.tutorial);
    this.renderPanel();
    if (report) this.setStatus(`floor ${this.floor} · seed ${this.seed} — ${this.dungeon.rooms.length} rooms, ${this.dungeon.enemies.length} enemies, ${this.dungeon.chests.length} chests`, "ok");
  }

  reroll() {
    this.seed = Math.floor(Math.random() * 1e6);
    this.regen();
  }

  setFloor(n) {
    this.floor = Math.max(1, Math.min(MAX_DEPTH, Math.round(n)));
    this.statKind = null; // re-pick from the new floor's mix
    this.regen();
  }

  // Set one GEN knob for the current floor. A value equal to the base clears the
  // override so GEN_BY_FLOOR stays sparse (clean diffs) and the field re-inherits
  // the base; otherwise it's stored as this floor's override.
  setGenParam(key, v) {
    const floor = this.floor;
    if (v === GEN[key]) {
      const over = GEN_BY_FLOOR[floor];
      if (over) { delete over[key]; if (!Object.keys(over).length) delete GEN_BY_FLOOR[floor]; }
    } else {
      (GEN_BY_FLOOR[floor] ||= {})[key] = v;
    }
    this.regen();
  }

  summonBoss() {
    if (!this.dungeon.isBoss) { this.setStatus("not a boss floor — bosses guard every 3rd floor"); return; }
    if (this.dungeon.gateOpen) { this.setStatus("gate already open"); return; }
    this.dungeon.openGate();
    this.renderPanel();
    this.setStatus(`${bossDefFor(dungeonIndexFor(this.floor)).awaken}…`, "ok");
  }

  /** One of each kind in the current floor's mix, lined up by the entrance. */
  spawnLineup() {
    const mix = [...new Set(floorMixFor(this.floor))];
    const tier = Math.min(this.floor, 5) - 1;
    const base = this.dungeon.entrancePos;
    mix.forEach((kind, i) => {
      const wx = base.x + DUNGEON_ORIGIN.x + (i - (mix.length - 1) / 2) * 1.7;
      const wz = base.z + DUNGEON_ORIGIN.z - 2.2; // one row up-grid of the entrance
      this.dungeon.spawnEnemy(kind, Math.floor(Math.random() * 1e6), tier, wx, wz);
    });
    this.setStatus(`lineup: ${mix.join(", ")}`, "ok");
  }

  // The live tunable tables, serialized. JSON.stringify drops each kind's
  // make() closure — what's left is exactly the tunable numbers/tables, the
  // same shape dungeon-data.js folds back in from dungeon-tuning.json.
  tuningSnapshot() {
    return { GEN, GEN_BY_FLOOR, HOLE_THEMES, DUNGEON_MIX, ENEMY_KINDS, BOSSES };
  }

  async copyTuning() {
    const json = JSON.stringify(this.tuningSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.setStatus("tuning JSON copied — paste values back into dungeon-data.js", "ok");
    } catch (_err) {
      console.log(json);
      this.setStatus("clipboard blocked — tuning JSON dumped to the console", "error");
    }
  }

  // Persist the live tables to src/game/dungeon-tuning.json via the dev server
  // (Ctrl+S). dungeon-data.js overlays that file over its code defaults on the
  // next reload, so the game and this editor both pick the values up.
  async saveTuning() {
    try {
      const res = await fetch("/api/dungeon-tuning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.tuningSnapshot(), null, 2),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `POST /api/dungeon-tuning -> ${res.status}`);
      }
      this.setStatus("saved to src/game/dungeon-tuning.json — reload the game tab to see it", "ok");
    } catch (err) {
      this.setStatus(`save failed: ${err.message}`, "error");
    }
  }

  /** Freecam pose framing the entrance (bottom of the grid) on first entry. */
  defaultCamPose() {
    return { pos: new THREE.Vector3(DUNGEON_ORIGIN.x, 34, DUNGEON_ORIGIN.z + 62), yaw: 0, pitch: 0.75 };
  }

  update(dt, elapsed) {
    if (!this.dungeon?.active) return;
    // park the occlusion probe where the camera is looking (ground plane)
    const cam = this.engine.camera;
    cam.getWorldDirection(_dir);
    if (_dir.y < -0.05) {
      const t = -cam.position.y / _dir.y;
      this.probe.position.copy(cam.position).addScaledVector(_dir, t);
    }
    this.dungeon.update(dt, elapsed);
  }

  handleKey(code, e) {
    switch (code) {
      case "KeyN": this.reroll(); return true;
      case "KeyG": this.summonBoss(); return true;
      case "KeyL": this.spawnLineup(); return true;
      case "Comma": this.setFloor(this.floor - 1); return true;
      case "Period": this.setFloor(this.floor + 1); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- panel
  renderPanel() {
    const p = this.panelEl;
    p.innerHTML = "";
    const d = dungeonIndexFor(this.floor);
    const local = (this.floor - 1) % FLOORS_PER_DUNGEON;
    const boss = !this.tutorial && isBossFloor(this.floor);

    const h = el("h2", { textContent: "Coin Cellar — dungeon" });
    h.append(el("span", { className: "badge", textContent: "preview" }));
    p.append(h);
    p.append(el("div", { className: "muted", textContent: `${DUNGEON_NAMES[d]} — floor ${local + 1}/${FLOORS_PER_DUNGEON}${boss ? " · BOSS" : ""}` }));

    // ---- floor & seed
    p.append(el("h3", { textContent: "Floor" }));
    p.append(row("floor",
      el("button", { textContent: "−", onclick: () => this.setFloor(this.floor - 1) }),
      numInput(this.floor, (v) => this.setFloor(v), 1),
      el("button", { textContent: "+", onclick: () => this.setFloor(this.floor + 1) }),
    ));
    p.append(row("seed",
      numInput(this.seed, (v) => { this.seed = Math.round(v); this.regen(); }, 1),
      el("button", { textContent: "Reroll (N)", onclick: () => this.reroll() }),
    ));
    const tutChk = el("input", {
      type: "checkbox", checked: this.tutorial,
      onchange: (e) => { this.tutorial = e.target.checked; this.regen(); },
    });
    p.append(el("div", { className: "row" }, tutChk, el("label", { textContent: "tutorial floor", style: "flex:1" })));
    if (boss) {
      const def = bossDefFor(d);
      p.append(el("div", { className: "muted", textContent: `${def.name} — hp ${def.hp} · dmg ${def.dmg} · speed ${def.speed.toFixed(2)}` }));
      p.append(el("div", {}, el("button", {
        className: "primary",
        textContent: this.dungeon?.gateOpen ? "Gate open" : "Summon boss (G)",
        onclick: () => this.summonBoss(),
      })));
    }

    // ---- generator params (per floor: base GEN + this floor's overrides)
    const gen = genFor(this.floor);
    const over = GEN_BY_FLOOR[this.floor];
    const overCount = over ? Object.keys(over).length : 0;
    p.append(el("h3", { textContent: "Generator params" }));
    p.append(el("div", {
      className: "muted",
      textContent: `floor ${this.floor} — ${overCount ? `${overCount} override${overCount > 1 ? "s" : ""} (◂); rest inherits base` : "all inherited from base"}`,
    }));
    for (const [key, label, step] of GEN_FIELDS) {
      const overridden = !!over && key in over;
      p.append(row(`${label}${overridden ? " ◂" : ""}`,
        numInput(gen[key], (v) => this.setGenParam(key, v), step)));
    }
    p.append(el("div", {}, el("button", {
      textContent: `Reset floor ${this.floor} params`,
      disabled: !overCount,
      onclick: () => { delete GEN_BY_FLOOR[this.floor]; this.regen(); },
    })));

    // ---- theme (palette / torch / shafts / decor) for the current dungeon
    const theme = this.tutorial ? DEFAULT_THEME : (HOLE_THEMES[d] ?? DEFAULT_THEME);
    p.append(el("h3", { textContent: `Theme — ${this.tutorial ? "default (tutorial)" : DUNGEON_NAMES[d]}` }));
    theme.palettes.forEach((pal, i) => {
      p.append(row(`floor ${i + 1}${i === local ? " ◂" : ""}`,
        ...pal.map((_, j) => colorInput(pal[j], (hex) => { pal[j] = hex; this.regen(); })),
      ));
    });
    p.append(row("torch", ...theme.torch.map((_, j) =>
      colorInput(theme.torch[j], (hex) => { theme.torch[j] = hex; this.regen(); }))));
    p.append(row("shafts", ...theme.shafts.map((_, j) =>
      colorInput(theme.shafts[j], (hex) => { theme.shafts[j] = hex; this.regen(); }))));
    if (theme.decor) {
      p.append(row("decor tint", colorInput(theme.decor.tint, (hex) => { theme.decor.tint = hex; this.regen(); })));
      for (const w of Object.keys(theme.decor.weights)) {
        p.append(row(w, numInput(theme.decor.weights[w], (v) => { theme.decor.weights[w] = v; this.regen(); }, 0.05)));
      }
    }

    // ---- monsters: the floor's spawn mix + per-kind stat tuning
    p.append(el("h3", { textContent: "Monsters" }));
    const mix = floorMixFor(this.floor);
    const mixIn = el("input", {
      type: "text", value: mix.join(", "),
      onchange: (e) => {
        const kinds = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
        const bad = kinds.filter((k) => !ENEMY_KINDS[k]);
        if (!kinds.length || bad.length) {
          this.setStatus(`unknown kind${bad.length > 1 ? "s" : ""}: ${bad.join(", ") || "(empty)"} — valid: ${Object.keys(ENEMY_KINDS).join(", ")}`, "error");
          e.target.value = mix.join(", ");
          return;
        }
        DUNGEON_MIX[d][Math.min(local, DUNGEON_MIX[d].length - 1)] = kinds;
        this.regen();
      },
    });
    p.append(row("mix", mixIn));
    p.append(el("div", {}, el("button", { textContent: "Spawn lineup (L)", onclick: () => this.spawnLineup() })));

    const kind = this.statKind && ENEMY_KINDS[this.statKind] ? this.statKind : mix[0];
    this.statKind = kind;
    const kindSel = el("select", { onchange: (e) => { this.statKind = e.target.value; this.renderPanel(); } },
      ...Object.keys(ENEMY_KINDS).map((k) => el("option", { value: k, textContent: k })));
    kindSel.value = kind;
    p.append(row("kind", kindSel));
    const def = ENEMY_KINDS[kind];
    for (const [key, step] of KIND_FIELDS) {
      if (def[key] == null) continue;
      p.append(row(key, numInput(def[key], (v) => { def[key] = v; this.setStatus(`${kind}.${key} = ${v} (applies to new spawns)`); }, step)));
    }
    if (def.gold) {
      p.append(row("gold",
        numInput(def.gold[0], (v) => { def.gold[0] = Math.round(v); }, 1),
        numInput(def.gold[1], (v) => { def.gold[1] = Math.round(v); }, 1),
      ));
    }

    // ---- export
    p.append(el("h3", { textContent: "Save" }));
    p.append(el("div", { className: "muted", textContent: "Ctrl+S saves to dungeon-tuning.json (reload the game tab to see it)" }));
    p.append(el("div", {},
      el("button", { className: "primary", textContent: "Save tuning", onclick: () => this.saveTuning() }),
      el("button", { textContent: "Copy tuning JSON", onclick: () => this.copyTuning() }),
    ));

    if (this.dungeon?.active) {
      p.append(el("h3", { textContent: "Floor stats" }));
      p.append(el("div", {
        className: "muted",
        textContent: `${this.dungeon.rooms.length} rooms · ${this.dungeon.enemies.length} enemies · ${this.dungeon.chests.length} chests · key ${this.dungeon.keyChestId >= 0 ? "in chest " + (this.dungeon.keyChestId + 1) : "not on this floor"}`,
      }));
    }
  }
}

const _dir = new THREE.Vector3();
