// Fire-and-forget PostHog capture from edge functions.
//
// Uses PostHog's HTTP capture endpoint directly — no SDK. Matches the
// project's client-side PostHog config (EU region by default). No-ops if
// the project key isn't configured, so edge functions stay healthy on
// dev / preview environments without PostHog set up.
//
// Required Supabase secrets (set via the dashboard or `supabase secrets set`):
//   POSTHOG_KEY  — PostHog project API key (public/write key, safe to embed)
//   POSTHOG_HOST — e.g. https://eu.i.posthog.com (defaults to EU)

const POSTHOG_KEY = Deno.env.get('POSTHOG_KEY')
const POSTHOG_HOST = Deno.env.get('POSTHOG_HOST') || 'https://eu.i.posthog.com'

export function capturePosthog(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {}
): void {
  if (!POSTHOG_KEY) return
  if (!distinctId) return

  // Fire-and-forget: don't await, don't block the caller on telemetry.
  fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: POSTHOG_KEY,
      event,
      distinct_id: distinctId,
      properties: {
        ...properties,
        $lib: 'supabase-edge',
      },
      timestamp: new Date().toISOString(),
    }),
  }).catch((err) => {
    // Never throw; worst case is we lose a telemetry event.
    console.warn('PostHog capture failed:', err?.message ?? err)
  })
}
