import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { createGeminiCompat, SchemaType } from "../_shared/vertexGemini.ts"
import { checkRateLimit, RATE_LIMITS } from "../_shared/rateLimit.ts"
import { logEvent } from "../_shared/analytics.ts"
import { getAuthUser } from "../_shared/getAuthUser.ts"

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

const ORDER_REWARD_MULTIPLIER = [0, 0.1, 0.25, 0.5, 0.8, 1.0]

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const responseHeaders = { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authenticate via JWT
    const user = await getAuthUser(req)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: responseHeaders }
      )
    }

    // Rate limit
    const rateLimit = checkRateLimit(`order-${user.id}`, RATE_LIMITS.cook)
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) }),
        { status: 429, headers: responseHeaders }
      )
    }

    const { orders, ingredientNames } = await req.json()

    if (!orders || !Array.isArray(orders) || orders.length === 0 ||
        !ingredientNames || !Array.isArray(ingredientNames) || ingredientNames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: responseHeaders }
      )
    }

    // Build prompt based on number of orders
    const isSingle = orders.length === 1

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: isSingle
          ? {
              type: SchemaType.OBJECT,
              properties: {
                bestOrderIndex: { type: SchemaType.INTEGER, description: 'Always 0 for single order' },
                score: { type: SchemaType.INTEGER, description: 'Score from 0-5' },
                feedback: { type: SchemaType.STRING, description: 'Brief 1-2 sentence feedback as the customer' },
              },
              required: ['bestOrderIndex', 'score', 'feedback'],
            }
          : {
              type: SchemaType.OBJECT,
              properties: {
                bestOrderIndex: { type: SchemaType.INTEGER, description: 'Index (0-based) of the order that best matches the ingredients' },
                score: { type: SchemaType.INTEGER, description: 'Score from 0-5 for the best matching order' },
                feedback: { type: SchemaType.STRING, description: 'Brief 1-2 sentence feedback as the customer' },
              },
              required: ['bestOrderIndex', 'score', 'feedback'],
            },
      },
    })

    let prompt: string

    if (isSingle) {
      const o = orders[0]
      prompt = `You are a hungry customer at a restaurant. You ordered "${o.dishName}" (${o.description}). The chef just brought you a dish made with: ${ingredientNames.join(', ')}.

Write your feedback in first person as the customer — be expressive, funny, and natural. Examples: "Mmm, this is exactly what I wanted!", "Um, I ordered pasta, not a salad...", "Close enough, but where's the cheese?"

Score how well this matches what you ordered (0-5):
5=perfect, 4=great, 3=decent, 2=partial, 1=barely related, 0=completely wrong

Set bestOrderIndex to 0.`
    } else {
      const orderList = orders.map((o: any, i: number) => `  ${i}: "${o.dishName}" (${o.description})`).join('\n')
      prompt = `You are a hungry customer at a restaurant with multiple orders pending:
${orderList}

The chef just brought you a dish made with: ${ingredientNames.join(', ')}.

Pick which order (by index) this dish best matches. Then write your feedback in first person as the customer — be expressive, funny, and natural. Examples: "Mmm, this is exactly what I wanted!", "Um, I ordered pasta, not a salad...", "Close enough, but where's the cheese?"

Score how well it matches (0-5):
5=perfect, 4=great, 3=decent, 2=partial, 1=barely related, 0=completely wrong

Set bestOrderIndex to the index of the best matching order.`
    }

    const result = await model.generateContent(prompt)
    let parsed: { bestOrderIndex?: number; score?: number; feedback?: string }
    try {
      parsed = JSON.parse(result.response.text())
    } catch {
      parsed = { bestOrderIndex: 0, score: 0, feedback: 'Hmm, I couldn\'t quite judge this one. Try again!' }
    }

    const bestIndex = Math.max(0, Math.min(orders.length - 1, Math.round(parsed.bestOrderIndex || 0)))
    const matchedOrder = orders[bestIndex]
    const score = Math.max(0, Math.min(5, Math.round(parsed.score || 0)))
    const feedback = parsed.feedback || 'Thanks for the dish!'
    const coinsEarned = Math.floor((matchedOrder.baseCoinReward || 30) * ORDER_REWARD_MULTIPLIER[score])

    // Fire-and-forget analytics
    logEvent(supabase, {
      event_type: 'dish_plated' as any,
      user_id: user.id,
      metadata: {
        source: 'order',
        orderId: matchedOrder.orderId,
        orderDishName: matchedOrder.dishName,
        ingredients: ingredientNames,
        score,
        coinsEarned,
      },
    })

    return new Response(
      JSON.stringify({
        orderId: matchedOrder.orderId,
        dishName: matchedOrder.dishName,
        score,
        feedback,
        coinsEarned,
      }),
      { headers: responseHeaders }
    )

  } catch (error) {
    console.error('Order scoring error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: responseHeaders }
    )
  }
})
