import * as THREE from "three";
import "./replay.css";
import { Engine } from "../core/engine.js";
import { Input } from "../core/input.js";
import { AudioBus } from "../core/audio.js";
import { HUD } from "../game/hud.js";
import { Game } from "../game/game.js";
import { loadCharacters } from "../chargen/assets.js";
import { loadDungeonAssets } from "../game/dungeon-assets.js";
import {
  buildReplayTimeline,
  formatTimecode,
  groupReplayFiles,
  nearestSample,
  normalizePosthogRows,
  parseTranscript,
  sampleAt,
} from "./replay-data.js";
import { scanTesterId } from "./replay-ocr.js";

const TESTER_ID_PATTERN = /^#[0-9A-F]{8}$/i;

function waitFor(video, event) {
  if (event === "loadedmetadata" && video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(video.error || new Error("Video failed to load")); };
    const cleanup = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

class ReplayReviewer {
  constructor(game, engine, panel, overlay) {
    this.game = game;
    this.engine = engine;
    this.panel = panel;
    this.overlay = overlay;
    this.video = panel.querySelector("#replay-video");
    this.statusEl = panel.querySelector("#replay-status");
    this.sessionSelect = panel.querySelector("#replay-session");
    this.testerInput = panel.querySelector("#replay-tester-id");
    this.offsetInput = panel.querySelector("#replay-offset");
    this.transcriptBody = panel.querySelector("#replay-transcript-body");
    this.footstepToggle = panel.querySelector("#replay-footsteps");
    this.divider = document.getElementById("replay-divider");
    this.sessions = [];
    this.session = null;
    this.events = [];
    this.timeline = [];
    this.cues = [];
    this.markers = [];
    this.videoUrl = null;
    this.idVideoTime = 0;
    this.activeCueIndex = -1;
    this.loadToken = 0;
    this._projection = new THREE.Vector3();
    this._nextProjection = new THREE.Vector3();
    this._wire();
    this.engine.onTick(() => this._renderWorldMarkers());
  }

  _wire() {
    const acceptFiles = (files) => this._acceptFiles(files);
    this.panel.querySelector("#replay-folder").addEventListener("change", (event) => acceptFiles(event.target.files));
    this.panel.querySelector("#replay-files").addEventListener("change", (event) => acceptFiles(event.target.files));
    this.sessionSelect.addEventListener("change", () => this._loadSession(this.sessionSelect.value));
    this.panel.querySelector("#replay-connect").addEventListener("click", () => {
      const testerId = this._normalizedTesterId(this.testerInput.value);
      if (!testerId) return this._status("Enter an ID like #00000000.", true);
      this.testerInput.value = testerId;
      this._loadPosthog(testerId);
    });
    this.offsetInput.addEventListener("change", () => this._rebuildTimeline());
    this.footstepToggle.addEventListener("change", () => this._buildWorldMarkers());
    this.video.addEventListener("timeupdate", () => this.seek(this.video.currentTime, false));
    this.video.addEventListener("seeking", () => this.seek(this.video.currentTime, false));
    this.transcriptBody.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-cue]");
      if (row) this.seek(this.cues[Number(row.dataset.cue)]?.start ?? 0);
    });
    let resizing = false;
    const resize = (event) => {
      if (!resizing) return;
      const left = Math.max(innerWidth * 0.25, Math.min(innerWidth * 0.75, event.clientX));
      document.body.style.setProperty("--replay-left", `${left}px`);
      this.engine.resize();
      this._renderWorldMarkers();
    };
    const stopResize = (event) => {
      if (!resizing) return;
      resizing = false;
      document.body.classList.remove("replay-resizing");
      this.divider.releasePointerCapture?.(event.pointerId);
      this.engine.resize();
    };
    this.divider.addEventListener("pointerdown", (event) => {
      resizing = true;
      document.body.classList.add("replay-resizing");
      this.divider.setPointerCapture(event.pointerId);
      resize(event);
    });
    this.divider.addEventListener("pointermove", resize);
    this.divider.addEventListener("pointerup", stopResize);
    this.divider.addEventListener("pointercancel", stopResize);
    this.divider.addEventListener("dblclick", () => {
      document.body.style.setProperty("--replay-left", "58vw");
      requestAnimationFrame(() => this.engine.resize());
    });
  }

  _normalizedTesterId(value) {
    let id = String(value || "").trim().toUpperCase();
    id = id.replace(/^PLAYTEST\s*/i, "");
    if (!id.startsWith("#")) id = `#${id}`;
    return TESTER_ID_PATTERN.test(id) ? id : null;
  }

  _status(message, error = false) {
    this.statusEl.textContent = message;
    this.statusEl.style.color = error ? "#ff9b9b" : "";
  }

  _acceptFiles(files) {
    this.sessions = groupReplayFiles(files);
    this.sessionSelect.replaceChildren(...this.sessions.map((session) => {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = `${session.name}${session.warnings.length ? " — incomplete" : ""}`;
      return option;
    }));
    this.sessionSelect.disabled = !this.sessions.length;
    if (!this.sessions.length) return this._status("No files selected.", true);
    this._loadSession(this.sessions[0].id);
  }

  async _loadSession(id) {
    const token = ++this.loadToken;
    this.session = this.sessions.find((session) => session.id === id);
    this.events = [];
    this.timeline = [];
    this.cues = [];
    this.testerInput.value = "";
    this.idVideoTime = 0;
    this.offsetInput.value = "0";
    this._clearMarkers();
    this._renderTranscript();
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = null;
    this.video.removeAttribute("src");
    this.video.load();

    if (!this.session) return;
    if (this.session.warnings.length) this._status(this.session.warnings.join(". "), true);
    if (this.session.transcriptFile) {
      try {
        this.cues = await parseTranscript(this.session.transcriptFile);
        this._renderTranscript();
      } catch (error) {
        this._status(`Transcript error: ${error.message}`, true);
      }
    }
    if (!this.session.videoFile) return;

    this.videoUrl = URL.createObjectURL(this.session.videoFile);
    this.video.src = this.videoUrl;
    await waitFor(this.video, "loadedmetadata");
    if (token !== this.loadToken) return;
    this._status("Scanning the first 30 seconds for the playtest ID…");
    try {
      const result = await scanTesterId(this.video, ({ phase, progress, time }) => {
        if (token !== this.loadToken) return;
        const detail = phase === "frames" ? `frame ${formatTimecode(time || 0)}` : `${Math.round(progress * 100)}% OCR`;
        this._status(`Looking for playtest ID — ${detail}`);
      });
      if (token !== this.loadToken) return;
      if (!result) {
        this._status("Could not read the playtest ID. Enter it manually, then press Link PostHog.", true);
        this.testerInput.focus();
        return;
      }
      this.testerInput.value = result.testerId;
      this.idVideoTime = result.videoTime;
      await this._loadPosthog(result.testerId);
    } catch (error) {
      if (token !== this.loadToken) return;
      this._status(`OCR failed: ${error.message}. Enter the ID manually.`, true);
    }
  }

  async _loadPosthog(testerId) {
    this._status(`Loading PostHog data for ${testerId}…`);
    try {
      const response = await fetch("/api/replay/posthog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tester_id: testerId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "PostHog query failed");
      this.events = normalizePosthogRows(payload);
      if (!this.events.length) throw new Error(`No matching PostHog events for ${testerId}`);
      this._rebuildTimeline();
      this._status(`Linked ${testerId}: ${this.timeline.length} position samples, ${this.cues.length} transcript lines.`);
      this.seek(this.video.currentTime || 0, false);
    } catch (error) {
      this._status(error.message, true);
    }
  }

  _rebuildTimeline() {
    const offset = Number(this.offsetInput.value) || 0;
    this.timeline = buildReplayTimeline(this.events, this.idVideoTime, offset);
    this._buildWorldMarkers();
    this.seek(this.video.currentTime || 0, false);
  }

  _renderTranscript() {
    if (!this.cues.length) {
      this.transcriptBody.innerHTML = `<tr><td colspan="2" class="replay-empty">Choose a folder containing a VTT or timestamped TXT transcript.</td></tr>`;
      return;
    }
    this.transcriptBody.innerHTML = this.cues.map((cue, index) => `
      <tr data-cue="${index}">
        <td>${formatTimecode(cue.start)}</td>
        <td>${this._escape(cue.text)}</td>
      </tr>`).join("");
  }

  _escape(text) {
    const element = document.createElement("div");
    element.textContent = text;
    return element.innerHTML;
  }

  _clearMarkers() {
    for (const marker of this.markers) marker.el.remove();
    this.markers = [];
  }

  _buildWorldMarkers() {
    this._clearMarkers();
    if (!this.timeline.length) return;
    this.cues.forEach((cue, cueIndex) => {
      const sample = nearestSample(this.timeline, cue.start);
      if (!sample) return;
      const el = document.createElement("button");
      el.className = "replay-world-marker";
      el.innerHTML = `<time>${formatTimecode(cue.start)}</time>${this._escape(cue.text)}`;
      el.addEventListener("click", () => this.seek(cue.start));
      this.overlay.appendChild(el);
      this.markers.push({ el, sample, time: cue.start, cueIndex, type: "cue" });
    });
    if (this.footstepToggle.checked) {
      const end = Math.max(this.video.duration || 0, this.timeline.at(-1)?.time || 0);
      const steps = [];
      for (let time = 0; time <= end; time += 1) {
        const sample = nearestSample(this.timeline, time);
        if (!sample) continue;
        const key = `${sample.area}:${sample.floor ?? ""}:${sample.x}:${sample.z}`;
        steps.push({ key, sample, time });
      }

      const groups = new Map();
      steps.forEach((step, index) => {
        let group = groups.get(step.key);
        if (!group) {
          group = { ...step, firstIndex: index, times: [], count: 0 };
          groups.set(step.key, group);
        }
        group.count += 1;
        if (step.time % 30 === 0) group.times.push(step.time);
      });

      for (const group of groups.values()) {
        let next = null;
        for (let index = group.firstIndex + 1; index < steps.length; index++) {
          if (steps[index].key !== group.key) {
            next = steps[index];
            break;
          }
        }
        const el = document.createElement("button");
        el.className = "replay-world-marker footstep";
        const firstTimestamp = group.times[0];
        const lastTimestamp = group.times.at(-1);
        const timestampLabel = group.times.length > 1
          ? `${formatTimecode(firstTimestamp)}–${formatTimecode(lastTimestamp)}`
          : formatTimecode(firstTimestamp);
        const timestamps = group.times.length
          ? `<time data-time="${firstTimestamp}">${timestampLabel}</time>`
          : "";
        el.innerHTML = `${timestamps}<span class="footstep-glyph" aria-hidden="true">👣</span>`;
        el.title = group.count > 1
          ? `${formatTimecode(group.time)} — ${group.count} seconds at this position`
          : formatTimecode(group.time);
        el.style.setProperty("--footstep-opacity", Math.min(0.95, 0.3 + group.count * 0.13));
        el.addEventListener("click", () => this.seek(group.time));
        el.querySelectorAll("time").forEach((timeEl) => {
          timeEl.addEventListener("click", (event) => {
            event.stopPropagation();
            this.seek(Number(timeEl.dataset.time));
          });
        });
        this.overlay.appendChild(el);
        this.markers.push({
          el,
          sample: group.sample,
          nextSample: next?.sample || null,
          time: group.time,
          cueIndex: -1,
          type: "footstep",
        });
      }
    }
    this._renderWorldMarkers();
  }

  _renderWorldMarkers() {
    if (!this.markers.length) return;
    const rect = this.engine.renderer.domElement.getBoundingClientRect();
    const area = this.game.playerArea;
    const floor = area === "dungeon" ? this.game.dungeon.floor : null;
    for (const marker of this.markers) {
      const samePlace = marker.sample.area === area &&
        (area !== "dungeon" || marker.sample.floor === floor);
      if (!samePlace) {
        marker.el.style.display = "none";
        continue;
      }
      this._projection.set(marker.sample.x, marker.type === "cue" ? 1.8 : 0.12, marker.sample.z)
        .project(this.engine.camera);
      if (this._projection.z > 1 || Math.abs(this._projection.x) > 1.2 || Math.abs(this._projection.y) > 1.2) {
        marker.el.style.display = "none";
        continue;
      }
      marker.el.style.display = "block";
      marker.el.style.left = `${((this._projection.x + 1) / 2) * rect.width}px`;
      marker.el.style.top = `${((1 - this._projection.y) / 2) * rect.height}px`;
      marker.el.classList.toggle("active",
        marker.type === "cue" && marker.cueIndex === this.activeCueIndex);

      if (marker.type === "footstep" && marker.nextSample &&
          marker.nextSample.area === marker.sample.area &&
          marker.nextSample.floor === marker.sample.floor) {
        this._nextProjection.set(marker.nextSample.x, 0.12, marker.nextSample.z)
          .project(this.engine.camera);
        const dx = this._nextProjection.x - this._projection.x;
        const dy = this._projection.y - this._nextProjection.y;
        const angle = Math.atan2(dy, dx) + Math.PI / 2;
        marker.el.style.setProperty("--footstep-angle", `${angle}rad`);
      }
    }
  }

  _cueIndexAt(time) {
    let active = -1;
    for (let index = 0; index < this.cues.length; index++) {
      if (this.cues[index].start > time) break;
      active = index;
      if (time <= this.cues[index].end) return index;
    }
    return active;
  }

  seek(time, moveVideo = true) {
    const target = Math.max(0, Math.min(Number(time) || 0, this.video.duration || Infinity));
    if (moveVideo && Math.abs(this.video.currentTime - target) > 0.03) this.video.currentTime = target;
    const sample = sampleAt(this.timeline, target);
    if (sample) this.game.setReplaySample(sample);

    const cueIndex = this._cueIndexAt(target);
    if (cueIndex !== this.activeCueIndex) {
      const old = this.transcriptBody.querySelector("tr.active");
      old?.classList.remove("active");
      this.activeCueIndex = cueIndex;
      const row = cueIndex >= 0 ? this.transcriptBody.querySelector(`tr[data-cue="${cueIndex}"]`) : null;
      row?.classList.add("active");
      row?.scrollIntoView({ block: "nearest" });
    }
    this._renderWorldMarkers();
  }
}

function reviewerHtml() {
  return `
    <aside id="replay-panel">
      <div class="replay-toolbar">
        <div class="replay-title">Playtest Replay Reviewer</div>
        <label class="replay-file-btn">Choose folder
          <input id="replay-folder" type="file" webkitdirectory multiple
            accept="video/*,.vtt,.txt" />
        </label>
        <label class="replay-file-btn">Choose files
          <input id="replay-files" type="file" multiple accept="video/*,.vtt,.txt" />
        </label>
        <select id="replay-session" disabled><option>Select a playtest</option></select>
        <input id="replay-tester-id" placeholder="#00000000" aria-label="Playtest ID" />
        <button id="replay-connect">Link PostHog</button>
        <label>Offset <input id="replay-offset" type="number" step="0.5" value="0" />s</label>
        <label><input id="replay-footsteps" type="checkbox" /> Footsteps</label>
        <div id="replay-status">Choose a PlaytestCloud folder to begin. Press \` for the game admin panel.</div>
      </div>
      <div id="replay-video-wrap"><video id="replay-video" controls preload="metadata"></video></div>
      <div id="replay-transcript">
        <table>
          <thead><tr><th>Timecode</th><th>Transcript</th></tr></thead>
          <tbody id="replay-transcript-body"></tbody>
        </table>
      </div>
    </aside>
    <div id="replay-divider" role="separator" aria-label="Resize game and review panels"></div>
    <div id="replay-world-overlay"></div>`;
}

export async function bootReplay({ app, hudRoot }) {
  document.body.classList.add("replay-mode");
  document.body.insertAdjacentHTML("beforeend", reviewerHtml());
  const panel = document.getElementById("replay-panel");
  const overlay = document.getElementById("replay-world-overlay");
  hudRoot.innerHTML = `<div class="replay-empty">Loading replay world…</div>`;
  await Promise.all([loadCharacters(), loadDungeonAssets()]);
  hudRoot.innerHTML = "";

  const engine = new Engine(app, { fitMount: true });
  const hud = new HUD(hudRoot, engine);
  const input = new Input(hudRoot);
  const audio = new AudioBus();
  const game = new Game(engine, input, audio, hud, { replayMode: true });
  window.__game = game;
  window.__replay = new ReplayReviewer(game, engine, panel, overlay);
  engine.start();
  requestAnimationFrame(() => engine.resize());
}
