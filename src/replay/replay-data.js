const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);

export function parseTimecode(value) {
  const parts = String(value).trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.length === 1 ? parts[0] : null;
}

export function formatTimecode(seconds, milliseconds = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const base = hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return milliseconds ? `${base}.${String(Math.floor((safe % 1) * 1000)).padStart(3, "0")}` : base;
}

export function parseVtt(text) {
  const normalized = String(text).replace(/\r/g, "");
  const cues = [];
  const blocks = normalized.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const start = parseTimecode(rawStart);
    const end = parseTimecode(rawEnd);
    const cueText = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (start == null || end == null || !cueText) continue;
    cues.push({ start, end: Math.max(start, end), text: cueText });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseTxt(text) {
  const cues = [];
  const linePattern = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s+(.+?)\s*$/;
  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    const match = line.match(linePattern);
    if (!match) continue;
    const start = parseTimecode(match[1]);
    if (start == null || !match[2]) continue;
    cues.push({ start, end: start + 5, text: match[2].trim() });
  }
  cues.sort((a, b) => a.start - b.start);
  cues.forEach((cue, index) => {
    const next = cues[index + 1];
    cue.end = next ? Math.max(cue.start + 0.25, next.start) : cue.start + 5;
  });
  return cues;
}

export async function parseTranscript(file) {
  if (!file) return [];
  const text = await file.text();
  return file.name.toLowerCase().endsWith(".vtt") ? parseVtt(text) : parseTxt(text);
}

export function groupReplayFiles(fileList) {
  const files = Array.from(fileList || []);
  const entries = files.map((file) => {
    const rawPath = file.webkitRelativePath || file.name;
    return { file, parts: rawPath.split("/").filter(Boolean) };
  });
  const sharedRoot = entries.length > 1 &&
    entries.every((entry) => entry.parts.length > 1 && entry.parts[0] === entries[0].parts[0])
    ? entries[0].parts[0]
    : null;
  const groups = new Map();
  for (const entry of entries) {
    const relative = sharedRoot ? entry.parts.slice(1) : entry.parts;
    const parent = relative.length > 1 ? relative.slice(0, -1).join("/") : sharedRoot || "Playtest";
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(entry.file);
  }
  return [...groups.entries()].map(([name, grouped], index) => {
    const ext = (file) => file.name.toLowerCase().split(".").pop();
    const videoFile = grouped.find((file) => VIDEO_EXTENSIONS.has(ext(file))) || null;
    const vttFile = grouped.find((file) => ext(file) === "vtt") || null;
    const txtFile = grouped.find((file) => ext(file) === "txt") || null;
    return {
      id: `${index}:${name}`,
      name,
      files: grouped,
      videoFile,
      transcriptFile: vttFile || txtFile,
      warnings: [
        ...(!videoFile ? ["No playable video found"] : []),
        ...(!(vttFile || txtFile) ? ["No VTT or TXT transcript found"] : []),
      ],
    };
  });
}

export function normalizePosthogRows(payload) {
  const columns = payload?.columns || [];
  return (payload?.results || []).map((row) => {
    const result = Array.isArray(row)
      ? Object.fromEntries(columns.map((column, index) => [column, row[index]]))
      : row;
    let properties = result?.properties || {};
    if (typeof properties === "string") {
      try { properties = JSON.parse(properties); } catch { properties = {}; }
    }
    return { timestamp: result?.timestamp, event: result?.event, properties };
  });
}

export function buildReplayTimeline(events, idVideoTime = 0, manualOffset = 0) {
  const anchor = events.find((event) => event.event === "playtest_id_shown");
  const anchorMs = Number(anchor?.properties?.shown_timestamp_ms) ||
    (anchor?.timestamp ? Date.parse(anchor.timestamp) : NaN);
  const batches = events.filter((event) => event.event === "player_position_batch");
  const firstSampleMs = Math.min(...batches
    .map((batch) => Number(batch.properties?.sample_timestamp_ms?.[0]))
    .filter(Number.isFinite));
  const samples = [];
  for (const batch of batches) {
    const props = batch.properties || {};
    const count = Math.min(
      Number(props.sample_count) || 0,
      props.sample_timestamp_ms?.length || 0,
      props.player_x?.length || 0,
      props.player_z?.length || 0
    );
    for (let index = 0; index < count; index++) {
      const timestampMs = Number(props.sample_timestamp_ms[index]);
      const inferredBase = Number.isFinite(anchorMs)
        ? idVideoTime + (timestampMs - anchorMs) / 1000
        : idVideoTime + (timestampMs - firstSampleMs) / 1000;
      samples.push({
        time: Math.max(0, inferredBase + manualOffset),
        timestampMs,
        x: Number(props.player_x[index]),
        z: Number(props.player_z[index]),
        area: props.area?.[index] || "shop",
        floor: props.dungeon_floor?.[index] ?? null,
        seed: props.dungeon_seed?.[index] ?? null,
        tutorial: props.tutorial_step?.[index] ?? null,
      });
    }
  }
  return samples
    .filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.z))
    .sort((a, b) => a.time - b.time);
}

export function sampleAt(timeline, time) {
  if (!timeline.length) return null;
  let lo = 0, hi = timeline.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (timeline[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = timeline[lo];
  const b = timeline[Math.min(lo + 1, timeline.length - 1)];
  if (!b || b === a || b.area !== a.area || b.floor !== a.floor) return { ...a };
  const span = b.time - a.time;
  const k = span > 0 ? Math.max(0, Math.min(1, (time - a.time) / span)) : 0;
  return { ...a, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
}

export function nearestSample(timeline, time) {
  if (!timeline.length) return null;
  return timeline.reduce((best, sample) =>
    Math.abs(sample.time - time) < Math.abs(best.time - time) ? sample : best
  );
}
