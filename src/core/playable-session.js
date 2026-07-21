const TESTER_ID_KEY = "coin-cellar:playtest-tester-id";

let cachedTesterId;

export function isPlayableSession() {
  return new URLSearchParams(location.search).has("playtest");
}

// Stable for the browser tab/session so the on-screen code and every PostHog
// event can be joined back to the same PlaytestCloud recording.
export function getPlayableTesterId() {
  if (!isPlayableSession()) return null;
  if (cachedTesterId) return cachedTesterId;

  try {
    cachedTesterId = sessionStorage.getItem(TESTER_ID_KEY);
  } catch {
    // Storage can be unavailable in an embedded playable; the module cache
    // still keeps the generated id stable for the lifetime of this page.
  }
  if (cachedTesterId) return cachedTesterId;

  const timestamp = String(Date.now());
  let hash = 0x811c9dc5;
  for (let i = 0; i < timestamp.length; i++) {
    hash ^= timestamp.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  cachedTesterId = `#${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;

  try {
    sessionStorage.setItem(TESTER_ID_KEY, cachedTesterId);
  } catch {
    // See storage note above.
  }
  return cachedTesterId;
}
