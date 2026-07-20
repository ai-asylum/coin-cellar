// Shared Vertex AI (Gemini) client for edge functions.
//
// Replaces the old Google AI Studio path (`@google/generative-ai` + GEMINI_API_KEY).
// Vertex has no API-key auth, so we authenticate with a service-account credential
// stored as the base64 secret GCP_SA_KEY_B64. ADC is NOT available in Supabase's
// Deno runtime (it isn't on GCP), which is why we pass explicit credentials.
//
// Secrets required (set via `supabase secrets set`):
//   GCP_SA_KEY_B64  — base64 of the service-account JSON key
//   GCP_PROJECT_ID  — e.g. sc-ai-innovation-lab-2-dev
//   GCP_LOCATION    — e.g. global  (must be "global" for gemini-3 models)
// NOTE: the `/node` build is required — the default/plain build resolves to an
// "unspecified environment" in Deno that only supports API-key auth and throws on
// service-account (googleAuthOptions) credentials.
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.34.0/node"

// Re-exported so call sites keep referencing `SchemaType.OBJECT` etc. The @google/genai
// `Type` enum uses the uppercase values Vertex expects, so this is a drop-in swap for
// the old `SchemaType` from @google/generative-ai.
export { Type as SchemaType }

let cachedCreds: Record<string, unknown> | null = null
function loadCredentials(): Record<string, unknown> {
  if (cachedCreds) return cachedCreds
  const b64 = Deno.env.get("GCP_SA_KEY_B64")
  if (!b64) throw new Error("GCP_SA_KEY_B64 not configured")
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
  )
  cachedCreds = JSON.parse(json)
  return cachedCreds
}

let cachedClient: GoogleGenAI | null = null
export function vertexAI(): GoogleGenAI {
  if (!cachedClient) {
    // Prefer a plain AI Studio key when configured; fall back to the Vertex
    // service-account path infinite-kitchen uses. Either secret works.
    const apiKey = Deno.env.get("GEMINI_API_KEY")
    if (apiKey) {
      cachedClient = new GoogleGenAI({ apiKey })
    } else {
      cachedClient = new GoogleGenAI({
        vertexai: true,
        project: Deno.env.get("GCP_PROJECT_ID")!,
        location: Deno.env.get("GCP_LOCATION") ?? "global",
        googleAuthOptions: { credentials: loadCredentials() },
      })
    }
  }
  return cachedClient
}

// Compatibility shim exposing the small slice of the @google/generative-ai surface the
// edge functions use: `genAI.getGenerativeModel({ model, generationConfig }).generateContent(prompt)`
// returning `{ response: { text() } }`. Lets us port each function by changing only the
// import + client-construction lines, leaving all call sites untouched.
export function createGeminiCompat() {
  return {
    getGenerativeModel(opts: {
      model: string
      generationConfig?: Record<string, unknown>
    }) {
      return {
        async generateContent(prompt: string) {
          const res = await vertexAI().models.generateContent({
            model: opts.model,
            contents: prompt,
            config: opts.generationConfig,
          })
          const text = res.text
          return { response: { text: () => text } }
        },
      }
    },
  }
}
