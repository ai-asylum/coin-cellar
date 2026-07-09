// Thin wrapper around posthog-js so the rest of the game can fire analytics
// without importing the SDK everywhere (and so tracking is a no-op if init
// never ran, e.g. in the lab/admin tools or when a blocker kills the script).
//
// The project key below is a *public* capture key (safe to ship client-side,
// same as the Supabase publishable key in net/lobby.js). It points at the
// "CoinCellar" project in the AI Asylum org on PostHog EU cloud.
import posthog from "posthog-js";

const POSTHOG_KEY = "phc_qgZdvj7qXuXqgQhAdui4vpackVAUk4AymytrtRktL9cU";
const POSTHOG_HOST = "https://eu.i.posthog.com";

let ready = false;

export function initAnalytics() {
  if (ready) return;
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: "https://eu.posthog.com",
      person_profiles: "always",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
    });
    ready = true;
  } catch (err) {
    // analytics must never take the game down
    console.warn("PostHog init failed", err);
  }
}

export function track(event, props) {
  if (!ready) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* swallow — never let a stat break gameplay */
  }
}

export { posthog };
