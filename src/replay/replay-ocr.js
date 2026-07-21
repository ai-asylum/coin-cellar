import { createWorker } from "tesseract.js";

function waitFor(video, event) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(video.error || new Error(`Video ${event} failed`)); };
    const cleanup = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

async function seek(video, time) {
  if (Math.abs(video.currentTime - time) < 0.02) return;
  video.currentTime = time;
  await waitFor(video, "seeked");
}

function extractTesterId(text) {
  const upper = String(text).toUpperCase()
    .replace(/[OQ]/g, "0")
    .replace(/[IL|]/g, "1");
  const playtestAt = upper.indexOf("PLAYTEST");
  const candidate = playtestAt >= 0 ? upper.slice(playtestAt) : upper;
  const hash = candidate.match(/#\s*([0-9A-F](?:\s*[0-9A-F]){7})/);
  if (!hash) return null;
  return `#${hash[1].replace(/\s/g, "")}`;
}

export async function scanTesterId(video, onProgress = () => {}) {
  if (video.readyState < 1) await waitFor(video, "loadedmetadata");
  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const maxTime = Math.min(30, Math.max(0, video.duration || 30));
  const frameTimes = [];
  for (let time = 0; time <= maxTime; time += 2) frameTimes.push(time);

  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text")
        onProgress({ phase: "ocr", progress: message.progress || 0 });
    },
  });
  await worker.setParameters({
    tessedit_char_whitelist: "playtPLAYTstST #0123456789ABCDEFabcdef",
    preserve_interword_spaces: "1",
  });

  try {
    for (let index = 0; index < frameTimes.length; index++) {
      const time = frameTimes[index];
      onProgress({ phase: "frames", progress: index / frameTimes.length, time });
      await seek(video, time);
      const sourceW = video.videoWidth || 1280;
      const sourceH = video.videoHeight || 720;
      // Scan the full upper third: PlaytestCloud/recording headers can push the
      // badge down or sideways, so a fixed top-left crop is not reliable.
      const cropH = Math.max(80, Math.floor(sourceH * 0.36));
      // The badge is deliberately compact in-game; enlarge it for OCR instead
      // of downscaling high-resolution PlaytestCloud captures.
      const scale = Math.min(2, 2400 / sourceW);
      canvas.width = Math.max(1, Math.floor(sourceW * scale));
      canvas.height = Math.max(1, Math.floor(cropH * scale));
      ctx.drawImage(video, 0, 0, sourceW, cropH, 0, 0, canvas.width, canvas.height);
      const { data } = await worker.recognize(canvas);
      const testerId = extractTesterId(data.text);
      if (testerId) return { testerId, videoTime: time, rawText: data.text };
    }
    return null;
  } finally {
    await worker.terminate();
    await seek(video, Math.min(originalTime, video.duration || originalTime));
    if (!wasPaused) video.play().catch(() => {});
  }
}
