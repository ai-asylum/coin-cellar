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

    const { slot_index, dish_id } = await req.json()

    if (typeof slot_index !== 'number' || !Number.isInteger(slot_index) || slot_index < 0 || slot_index > 4) {
      return new Response(
        JSON.stringify({ error: 'slot_index must be an integer 0-4' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (typeof dish_id !== 'string' || dish_id.length === 0) {
      return new Response(
        JSON.stringify({ error: 'dish_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data, error } = await supabase.rpc('add_menu_slot', {
      p_user_id: user.id,
      p_slot_index: slot_index,
      p_dish_id: dish_id,
    })

    if (error) {
      console.error('add_menu_slot RPC failed:', error)
      // Surface the RPC's validation errors (ownership / duplicate) to the client
      // so the UI can show a meaningful message.
      const status = error.message?.includes('already in slot') || error.message?.includes('do not own') ? 400 : 500
      return new Response(
        JSON.stringify({ error: error.message || 'Failed to add menu slot' }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const row = Array.isArray(data) ? data[0] : data

    return new Response(
      JSON.stringify({
        slot_index: row?.slot_index ?? slot_index,
        replaced_existing: row?.replaced_existing ?? false,
        is_first_add: row?.is_first_add ?? false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('add-menu-slot error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
