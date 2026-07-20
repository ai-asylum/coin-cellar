#!/usr/bin/env node
// Generates the game's music tracks via the Scenario API (Google Lyria 2,
// text-to-music, 30s instrumental clips) and saves them to public/music.
//
// Usage:
//   node scripts/gen-music.js            # generate every track
//   node scripts/gen-music.js shop boss  # only the named tracks
//
// Requires SCENARIO_API_KEY / SCENARIO_API_SECRET in .env (gitignored).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "music");
const API = "https://api.cloud.scenario.com/v1";
// Google Lyria 3 Clip: polished 30s instrumental clips from a text prompt.
// (Lyria 2 is deprecated and returns 403.) No negativePrompt support, so
// "fully instrumental, no vocals" is folded into each prompt.
const MODEL_ID = "model_lyria-3-clip";

const TRACKS = {
  // --- menu (calm harp / music-box / warm pad) ---
  menu: {
    prompt:
      "Calm, quiet main-menu theme for a cozy medieval fantasy pixel game. Soft and peaceful, sparse gentle harp and mellow music-box notes, warm sustained strings pad, slow and airy, understated and soothing, plenty of space and stillness. Very low intensity, slow tempo, major key, loopable ambient background music, fully instrumental, no vocals, no singing.",
  },
  "menu-morning": {
    prompt:
      "Calm main-menu theme for a cozy medieval fantasy pixel game, early-morning dawn variation. Gentle and hopeful awakening mood, soft harp and mellow music-box, warm airy strings pad, a hint of light flute like distant birdsong, fresh and tender. Very low intensity, slow tempo, major key, loopable ambient background music, fully instrumental, no vocals, no singing.",
  },
  "menu-night": {
    prompt:
      "Calm main-menu theme for a cozy medieval fantasy pixel game, late-night variation. Very quiet and dreamy starlit mood, sparse music-box and soft harp, deep warm sustained pad, hushed and intimate, lots of stillness. Extremely low intensity, very slow tempo, major key, loopable ambient background music, fully instrumental, no vocals, no singing.",
  },
  // --- shop (warm lute / harp / light woodwinds, bouncy merchant) ---
  shop: {
    prompt:
      "Cozy medieval fantasy shopkeeper theme for a pixel-art shop game. Warm and welcoming, gentle plucked lute and harp, light woodwinds, soft hand percussion, a bouncy friendly merchant melody. Relaxed mid tempo, major key, loopable background music, fully instrumental, no vocals, no singing.",
  },
  "shop-morning": {
    prompt:
      "Cozy medieval fantasy shopkeeper theme for a pixel-art shop game, sleepy early-morning variation. Same warm lute and harp with light woodwinds, but softer and slower, a gentle waking-up feel, tender and unhurried opening-time mood. Slow-to-mid tempo, major key, loopable background music, fully instrumental, no vocals, no singing.",
  },
  "shop-night": {
    prompt:
      "Cozy medieval fantasy shopkeeper theme for a pixel-art shop game, late-night variation. Same warm lute and harp with light woodwinds, but hushed, mellow and intimate, lantern-lit closing-time mood, slower and quieter. Slow tempo, major key, loopable background music, fully instrumental, no vocals, no singing.",
  },
  dungeon: {
    prompt:
      "Dark atmospheric dungeon-crawl theme for a fantasy pixel game. Tense and mysterious, low drones, distant echoing percussion, subtle eerie strings and dripping cavern ambience, a slow ominous pulse building quiet dread. Minor key, slow tempo, loopable background music, fully instrumental, no vocals, no singing.",
  },
  // --- town (folksy strings / flute / fiddle) ---
  town: {
    prompt:
      "Pleasant medieval town theme for a fantasy pixel game. Cheerful daytime village mood, folksy acoustic strings, flute and fiddle melody, light tambourine, gentle strolling rhythm, wholesome and inviting. Major key, easy mid tempo, loopable background music, fully instrumental, no vocals, no singing.",
  },
  "town-morning": {
    prompt:
      "Pleasant medieval town theme for a fantasy pixel game, early-morning variation. Misty calm dawn village, soft solo flute and light acoustic strings, gentle and dewy, unhurried, a peaceful waking-up feel with no percussion. Major key, slow-to-mid tempo, loopable background music, fully instrumental, no vocals, no singing.",
  },
  "town-night": {
    prompt:
      "Pleasant medieval town theme for a fantasy pixel game, night variation. Quiet nighttime village, distant cozy tavern warmth, soft lute and low acoustic strings, sparse and peaceful, gentle and mellow with no percussion. Major key, slow tempo, loopable background music, fully instrumental, no vocals, no singing.",
  },
  boss: {
    prompt:
      "Epic boss battle theme for a fantasy pixel action game. Intense and dramatic, driving pounding percussion, aggressive low brass and staccato strings, soaring heroic-yet-dangerous melody, high stakes and urgency. Minor key, fast tempo, loopable battle music, fully instrumental, no vocals, no singing.",
  },
};

function loadEnv() {
  try {
    const txt = readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

function authHeader() {
  const key = process.env.SCENARIO_API_KEY;
  const secret = process.env.SCENARIO_API_SECRET;
  if (!key || !secret) {
    console.error("Missing SCENARIO_API_KEY / SCENARIO_API_SECRET (put them in .env)");
    process.exit(1);
  }
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

const AUTH = { Authorization: "" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: AUTH.Authorization, "Content-Type": "application/json", Accept: "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function generate(name, { prompt }) {
  console.log(`[${name}] starting generation...`);
  const start = await api(`/generate/custom/${MODEL_ID}`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
  const jobId = start.job?.jobId || start.jobId;
  if (!jobId) throw new Error(`[${name}] no jobId in response: ${JSON.stringify(start)}`);
  console.log(`[${name}] job ${jobId} queued, polling...`);

  let status = "queued";
  let job;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!["success", "failed", "failure", "canceled"].includes(status)) {
    if (Date.now() > deadline) throw new Error(`[${name}] timed out waiting for job`);
    await sleep(4000);
    const poll = await api(`/jobs/${jobId}`);
    job = poll.job || poll;
    status = job.status;
    const pct = Math.round((job.progress || 0) * 100);
    console.log(`[${name}] status=${status} progress=${pct}%`);
  }
  if (status !== "success") throw new Error(`[${name}] job ended: ${status} ${JSON.stringify(job.error || {})}`);

  const assetIds = job.metadata?.assetIds || [];
  if (!assetIds.length) throw new Error(`[${name}] no assetIds: ${JSON.stringify(job.metadata)}`);

  const asset = await api(`/assets/${assetIds[0]}`);
  const url = asset.asset?.url;
  if (!url) throw new Error(`[${name}] no asset url: ${JSON.stringify(asset)}`);

  console.log(`[${name}] downloading ${url}`);
  const audio = await fetch(url);
  if (!audio.ok) throw new Error(`[${name}] download failed ${audio.status}`);
  const buf = Buffer.from(await audio.arrayBuffer());

  const outPath = join(OUT_DIR, `${name}.mp3`);
  writeFileSync(outPath, buf);
  console.log(`[${name}] saved -> ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  return outPath;
}

async function main() {
  loadEnv();
  AUTH.Authorization = authHeader();
  mkdirSync(OUT_DIR, { recursive: true });

  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const names = requested.length ? requested : Object.keys(TRACKS);

  const results = await Promise.allSettled(
    names.map((name) => {
      const t = TRACKS[name];
      if (!t) return Promise.reject(new Error(`unknown track "${name}" (have: ${Object.keys(TRACKS).join(", ")})`));
      return generate(name, t);
    })
  );

  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed++;
      console.error(`FAILED ${names[i]}: ${r.reason?.message || r.reason}`);
    }
  });
  if (failed) process.exit(1);
  console.log("All tracks generated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
