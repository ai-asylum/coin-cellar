// Coin Cellar's own cooking backend — a fresh Supabase project cloned
// structure-only from the infinite-restaurant one (the schema baseline and
// edge functions live in this repo under supabase/). Schema, functions and
// the `sprites` storage bucket all live in this one project; the
// interaction/discovery cache is served from its tables.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_FUNCTION_URL ||
  "https://oedoqjgqdjdnxxhdslcr.supabase.co/functions/v1"
).replace("/functions/v1", "");

export const FUNCTION_URL = `${SUPABASE_URL}/functions/v1`;

// The anon key is a public, RLS-protected JWT meant to ship in the browser
// (same pattern as coin-cellar's publishable key). A hardcoded fallback keeps
// the game working out of the box; override it with VITE_SUPABASE_ANON_KEY.
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lZG9xamdxZGpkbnh4aGRzbGNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NzE5NjcsImV4cCI6MjEwMDE0Nzk2N30.5sNE22yJU9skWi0xB6hkvPbUnBdFX4hXyPPeDV_B1lw";
export const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

// Never let a bad/empty key crash the whole app at import time — the game must
// still boot and run offline (see authReady's graceful fallback below).
export const supabase = (() => {
  try {
    if (!ANON_KEY) throw new Error("missing anon key");
    return createClient(SUPABASE_URL, ANON_KEY);
  } catch (err) {
    console.warn("[net] Supabase client unavailable, running offline:", err?.message);
    return null;
  }
})();

let _session = null;
let _readyPromise = null;

// Anonymous-first auth, same model as infinite-kitchen: every browser gets a
// real Supabase user via signInAnonymously so edge functions that require a
// JWT (serve-dish, score-order, add-menu-slot) work without an account.
export function authReady() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    try {
      if (!supabase) throw new Error("no supabase client");
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        _session = data.session;
        return _session;
      }
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      _session = anon.session;
      return _session;
    } catch (err) {
      console.warn("[net] auth unavailable, running offline:", err?.message);
      _session = null;
      return null;
    }
  })();
  return _readyPromise;
}

export function getUserId() {
  return _session?.user?.id || null;
}

export function isOnline() {
  return !!_session;
}

export function getAuthHeaders() {
  const token = _session?.access_token || ANON_KEY;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    apikey: ANON_KEY,
  };
}
