import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/getAuthUser.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

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

    const { slot_index } = await req.json()

    if (typeof slot_index !== 'number' || !Number.isInteger(slot_index) || slot_index < 0 || slot_index > 4) {
      return new Response(
        JSON.stringify({ error: 'slot_index must be an integer 0-4' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data, error } = await supabase.rpc('remove_menu_slot', {
      p_user_id: user.id,
      p_slot_index: slot_index,
    })

    if (error) {
      console.error('remove_menu_slot RPC failed:', error)
      return new Response(
        JSON.stringify({ error: error.message || 'Failed to remove menu slot' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const row = Array.isArray(data) ? data[0] : data

    return new Response(
      JSON.stringify({
        removed_dish_id: row?.removed_dish_id ?? null,
        had_reviews: row?.had_reviews ?? 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('remove-menu-slot error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
