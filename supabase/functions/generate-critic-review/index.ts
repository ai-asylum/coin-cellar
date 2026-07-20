import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createGeminiCompat, SchemaType } from "../_shared/vertexGemini.ts"
import { getAuthUser } from '../_shared/getAuthUser.ts'
import { capturePosthog } from '../_shared/posthog.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const genAI = createGeminiCompat()

interface ReviewTarget {
  critic_id: string
  critic_name: string
  critic_taste_profile: string
  critic_weight: number
  dish_id: string
  dish_ai_dish_name: string | null
  dish_dish_name: string | null
  dish_ingredients: any
  dish_steps: any
  dish_star_rating: number | null
  next_fire: string
  was_onboarding_seed: boolean
}

function buildReviewPrompt(t: ReviewTarget): string {
  const dishName = t.dish_ai_dish_name || t.dish_dish_name || 'the dish'

  const ingredientList = Array.isArray(t.dish_ingredients)
    ? t.dish_ingredients
        .map((i: any) => i?.name || (typeof i === 'string' ? i : null))
        .filter(Boolean)
        .join(', ')
    : 'unknown'

  const stepSummary = Array.isArray(t.dish_steps) && t.dish_steps.length > 0
    ? t.dish_steps
        .map((s: any, i: number) => {
          const action = s?.description
            || `${s?.actionVerb || 'Used'} ${s?.toolName || 'a tool'} on ${Array.isArray(s?.inputs) ? s.inputs.join(' + ') : '?'}`
          return `${i + 1}. ${action}`
        })
        .join('\n')
    : 'No cooking steps recorded — ingredients were plated raw.'

  const starLine = t.dish_star_rating != null
    ? `${t.dish_star_rating}★`
    : 'not yet scored'

  return `You are ${t.critic_name}, a food critic. ${t.critic_taste_profile}

You've just eaten a dish called "${dishName}" at a small kitchen.
Ingredients: ${ingredientList}
Preparation:
${stepSummary}
The original plating critic gave it ${starLine}.

Write a SHORT review IN CHARACTER — one or two sentences MAX, under 180 characters total. Be punchy and quotable. One cutting line beats a paragraph. No hedging, no setup, get straight to the verdict.
Be honest to your stated tastes. If the dish conflicts with your preferences, dock stars — even if the plating was flawless.

Output strict JSON: { "stars": <float>, "review": "<string>" }`
}

async function callGemini(prompt: string): Promise<{ stars: number; review: string } | null> {
  const model = genAI.getGenerativeModel({
    model: Deno.env.get('GEMINI_TEXT_MODEL') ?? 'gemini-3-flash-preview',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          stars: { type: SchemaType.NUMBER, description: 'Star rating 0.0 to 5.0' },
          review: { type: SchemaType.STRING, description: '2-4 sentence review in character' },
        },
        required: ['stars', 'review'],
      },
    },
  })

  // One retry on parse / shape failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent(prompt)
      const parsed = JSON.parse(result.response.text())
      if (typeof parsed?.stars === 'number' && typeof parsed?.review === 'string') {
        return { stars: parsed.stars, review: parsed.review }
      }
    } catch (err) {
      console.warn(`Gemini review attempt ${attempt + 1} failed:`, err)
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await getAuthUser(req)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Atomic pick: gates + critic/dish selection + state updates.
    const { data: targetsRaw, error: pickErr } = await supabase.rpc('pick_critic_review_targets', {
      p_user_id: user.id,
    })

    if (pickErr) {
      console.error('pick_critic_review_targets failed:', pickErr)
      return new Response(
        JSON.stringify({ error: 'Failed to schedule review' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const targets: ReviewTarget[] = Array.isArray(targetsRaw) ? targetsRaw : []
    const newReviews: any[] = []

    for (const t of targets) {
      const parsed = await callGemini(buildReviewPrompt(t))
      if (!parsed) continue

      // Clamp stars into [0, 5] with one decimal.
      const stars = Math.max(0, Math.min(5, Math.round(parsed.stars * 10) / 10))
      const rep_awarded = Math.round(stars * 10 * (t.critic_weight || 1))

      const { data: reviewId, error: insertErr } = await supabase.rpc('insert_critic_review', {
        p_user_id: user.id,
        p_critic_id: t.critic_id,
        p_dish_id: t.dish_id,
        p_stars: stars,
        p_review_text: parsed.review,
        p_rep_awarded: rep_awarded,
        p_created_at: t.next_fire,
      })

      if (insertErr) {
        console.error('insert_critic_review failed:', insertErr)
        continue
      }

      newReviews.push({
        id: reviewId,
        critic_id: t.critic_id,
        critic_name: t.critic_name,
        dish_id: t.dish_id,
        dish_name: t.dish_ai_dish_name || t.dish_dish_name,
        stars,
        review_text: parsed.review,
        rep_awarded,
        created_at: t.next_fire,
        was_onboarding_seed: t.was_onboarding_seed,
      })

      capturePosthog('critic_review_generated', user.id, {
        critic_id: t.critic_id,
        critic_name: t.critic_name,
        dish_id: t.dish_id,
        stars,
        rep_awarded,
        was_onboarding_seed: t.was_onboarding_seed,
      })
    }

    // Final summary for the client (unread, rep, dry flag).
    const { data: summaryRaw, error: summaryErr } = await supabase.rpc('get_critic_review_summary', {
      p_user_id: user.id,
    })

    if (summaryErr) {
      console.error('get_critic_review_summary failed:', summaryErr)
    }

    const summary = Array.isArray(summaryRaw) ? summaryRaw[0] : summaryRaw

    return new Response(
      JSON.stringify({
        new_reviews: newReviews,
        unread_count: summary?.unread_count ?? 0,
        reputation: summary?.reputation ?? 0,
        critics_dry: summary?.critics_dry ?? false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('generate-critic-review error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
