import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { createGeminiCompat, SchemaType } from "../_shared/vertexGemini.ts"
import { checkRateLimit, RATE_LIMITS } from "../_shared/rateLimit.ts"
import { logEvent } from "../_shared/analytics.ts"
import { resolveUser } from "../_shared/resolvePlayer.ts"

const ALLOWED_ORIGINS = [
  'https://infinite-kitchen.com',
  'https://www.infinite-kitchen.com',
  'http://localhost:3000',
  'http://localhost:5173',
]

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  const allowedOrigin = origin || '*'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const genAI = createGeminiCompat()

interface RecipeStep {
  toolName: string
  actionVerb: string
  inputs: string[]
  outputs: string[]
  description?: string
}

function buildServePrompt(
  ingredients: string[],
  steps: RecipeStep[],
  vessel: string,
  candidateBadges: Array<{ id: string; ai_criteria: string }>
): string {
  const stepsText = steps.length > 0
    ? steps.map((s, i) =>
        `${i + 1}. Used ${s.toolName} (${s.actionVerb}) on ${s.inputs.join(' + ')} → ${s.outputs.join(' + ')}${s.description ? ` (${s.description})` : ''}`
      ).join('\n')
    : 'No cooking steps recorded — ingredients were plated raw.'

  const badgeCriteria = candidateBadges.length > 0
    ? candidateBadges.map(b => `- "${b.id}": ${b.ai_criteria}`).join('\n')
    : 'No badges to evaluate.'

  return `You are a chef naming a dish and evaluating badge criteria in a cooking game.

INGREDIENTS: ${ingredients.join(', ')}
VESSEL: ${vessel || 'plate'}

COOKING STEPS THE PLAYER PERFORMED:
${stepsText}

## TASK 1: Name the Dish

Give this dish a creative, appetizing name based on the ingredients, cooking technique, and vessel. Keep it concise (2-5 words). Think restaurant menu style.

Examples:
- Tomato + Onion + Cheese + Oven → "Rustic Tomato Gratin"
- Salmon + Lemon + Knife → "Salmon Tartare"
- Banana + Chocolate + Ice → "Frozen Chocolate Banana"

## TASK 2: Badge Evaluation

Evaluate whether this dish earns any of the following badges. Only award a badge if the criteria is CLEARLY met. When in doubt, do not award.

${badgeCriteria}

Return the IDs of any badges earned as an array. If none are earned, return an empty array.`
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const responseHeaders = { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { dishId, ingredients, steps, vessel, earnedBadgeIds } = body

    // Resolve user identity
    const user = await resolveUser(req, body.userId, body.userName)
    const userId = user.userId
    const userName = user.displayName

    // Validate inputs
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid ingredients' }),
        { status: 400, headers: responseHeaders }
      )
    }

    // Rate limit
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
    const rateLimitKey = `serve-dish:${userId || clientIp}`
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.cook)
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please slow down.', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) }),
        { status: 429, headers: { ...responseHeaders, 'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) } }
      )
    }

    // Fetch all active badges
    const alreadyEarned: string[] = Array.isArray(earnedBadgeIds) ? earnedBadgeIds : []
    const { data: allBadges, error: badgesError } = await supabase
      .from('badges')
      .select('id, title, emoji, coin_reward, ai_criteria, sprite_url, level')
      .eq('is_active', true)
      .order('sort_order')

    if (badgesError) {
      console.error('Error fetching badges:', badgesError)
    }

    // Derive player's current chef level
    const badges = allBadges || []
    let currentLevel = 1
    for (let lvl = 1; lvl <= 10; lvl++) {
      const levelBadges = badges.filter((b: any) => b.level === lvl)
      if (levelBadges.length === 0) continue
      const allLevelEarned = levelBadges.every((b: any) => alreadyEarned.includes(b.id))
      if (!allLevelEarned) { currentLevel = lvl; break }
      if (lvl === 10) currentLevel = 10
    }

    // Only evaluate badges for the player's current level
    const candidateBadges = badges.filter(
      (b: any) => b.level === currentLevel && !alreadyEarned.includes(b.id)
    )

    // Handle first-plate badge server-side
    let isFirstPlate = false
    if (candidateBadges.some((b: any) => b.id === 'first-plate')) {
      const { count } = await supabase
        .from('player_badges')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)

      isFirstPlate = (count === 0)
    }

    // Build prompt — exclude first-plate from AI eval
    const aiBadges = candidateBadges.filter((b: any) => b.id !== 'first-plate')

    const ingredientNames = ingredients.map((i: any) => typeof i === 'string' ? i : i.name || i.slug || String(i))

    // Generate dish name + evaluate badges with Gemini
    const model = genAI.getGenerativeModel({
      model: Deno.env.get('GEMINI_TEXT_MODEL') ?? 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            dishName: {
              type: SchemaType.STRING,
              description: 'Creative dish name (2-5 words)',
            },
            earnedBadgeIds: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description: 'Array of badge IDs earned by this dish',
            },
          },
          required: ['dishName', 'earnedBadgeIds'],
        },
      },
    })

    const prompt = buildServePrompt(ingredientNames, steps || [], vessel || 'plate', aiBadges)
    const result = await model.generateContent(prompt)
    const response = JSON.parse(result.response.text())

    const aiDishName = response.dishName || ingredientNames.join(', ')

    // Combine AI-awarded badges with server-side first-plate
    const aiEarnedIds: string[] = (response.earnedBadgeIds || []).filter(
      (id: string) => aiBadges.some((b: any) => b.id === id)
    )
    if (isFirstPlate) {
      aiEarnedIds.unshift('first-plate')
    }

    // Build badges earned response with full details
    const badgesEarned = aiEarnedIds
      .map((id: string) => {
        const badge = (allBadges || []).find((b: any) => b.id === id)
        if (!badge) return null
        return { id: badge.id, title: badge.title, emoji: badge.emoji, coinReward: badge.coin_reward, spriteUrl: badge.sprite_url || null }
      })
      .filter(Boolean)

    // Calculate coins from badge rewards
    const totalCoins = badgesEarned.reduce((sum: number, b: any) => sum + b.coinReward, 0)

    // Build dish name from ingredients (the plain label)
    const dishNameLabel = ingredientNames.join(', ')

    // Create or update dish record
    const newDishId = dishId || crypto.randomUUID()

    if (dishId) {
      // Update existing dish record (photo was taken first)
      const { error: updateError } = await supabase
        .from('dishes')
        .update({
          ai_dish_name: aiDishName,
          steps: steps || null,
          vessel: vessel || 'plate',
          badges_awarded: badgesEarned,
          coins_earned: totalCoins,
          served_at: new Date().toISOString(),
        })
        .eq('id', dishId)

      if (updateError) {
        console.error('Dish update error:', updateError)
      }
    } else {
      // Create new dish record (serve without prior photo)
      const { error: insertError } = await supabase
        .from('dishes')
        .insert({
          id: newDishId,
          user_id: userId,
          dish_name: dishNameLabel,
          ai_dish_name: aiDishName,
          ingredients: ingredients,
          steps: steps || null,
          vessel: vessel || 'plate',
          badges_awarded: badgesEarned,
          coins_earned: totalCoins,
          served_at: new Date().toISOString(),
        })

      if (insertError) {
        console.error('Dish insert error:', insertError)
      }
    }

    // Write earned badges to DB (fire-and-forget) — auth users only
    if (badgesEarned.length > 0 && user.isAuthenticated) {
      const badgeRows = badgesEarned.map((b: any) => ({
        user_id: userId,
        badge_id: b.id,
        dish_photo_id: newDishId,
      }))
      supabase.from('player_badges').insert(badgeRows).then(({ error: insertErr }) => {
        if (insertErr) console.error('Badge insert error:', insertErr)
      })
    }

    // Update player stats (fire-and-forget) — auth users only
    if (user.isAuthenticated && totalCoins > 0) {
      supabase.rpc('upsert_player_stats', {
        p_user_id: userId,
        p_action: 'coins',
        p_amount: totalCoins,
      }).then(({ error: statsError }: { error: any }) => {
        if (statsError) console.error('Player stats upsert error:', statsError)
      })
    }

    // Log event
    logEvent(supabase, {
      event_type: 'dish_plated',
      user_id: userId,
      metadata: {
        dish: aiDishName,
        ingredients: ingredientNames,
        vessel,
        badges_earned: badgesEarned.map((b: any) => b.id),
        total_coins: totalCoins,
        had_photo: !!dishId,
      },
    })

    return new Response(
      JSON.stringify({
        dishId: newDishId,
        aiDishName,
        badgesEarned,
        totalCoins,
      }),
      { headers: responseHeaders }
    )

  } catch (error) {
    console.error('Error in serve-dish:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to serve dish', details: error.message }),
      { status: 500, headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
