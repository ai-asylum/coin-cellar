import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { generateAndSaveIngredientSprite } from "../_shared/spriteGeneration.ts"

const ALLOWED_ORIGINS = ['https://infinite-kitchen.com', 'https://www.infinite-kitchen.com', 'http://localhost:3000', 'http://localhost:5173']

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowedOrigin = origin || '*'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const headers = { ...corsHeaders, 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { ingredient_ids, input_names } = await req.json()

    if (!Array.isArray(ingredient_ids) || ingredient_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'ingredient_ids required' }), { status: 400, headers })
    }

    // Process ingredients that need Pro upgrade (count >= 10, no sprite or Klein tier)
    const { data: ingredients } = await supabase
      .from('ingredients')
      .select('id, name, description, sprite_tier')
      .in('id', ingredient_ids)
      .gte('discovery_count', 10)
      .or('sprite_url.is.null,sprite_tier.eq.klein')

    if (!ingredients?.length) {
      return new Response(JSON.stringify({ scheduled: 0 }), { headers })
    }

    // Schedule Pro sprite generation for all qualifying ingredients
    for (const ing of ingredients) {
      EdgeRuntime.waitUntil(generateAndSaveIngredientSprite(supabase, ing.id, ing.name, input_names, ing.description || ''))
    }

    console.log(`Scheduled ${ingredients.length} Pro sprite upgrades`)
    return new Response(JSON.stringify({ scheduled: ingredients.length }), { headers })
  } catch (err) {
    console.error('generate-discovery-sprite error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
})
