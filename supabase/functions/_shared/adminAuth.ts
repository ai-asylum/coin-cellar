// Admin authentication via Supabase Auth + is_admin flag on player_profiles
// Replaces the old custom token system

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Verify the request is from an authenticated admin user.
 * Reads JWT from Authorization header, validates it, and checks is_admin on player_profiles.
 * Returns an error Response if not admin, or null if authorized.
 */
export async function requireAdminAuth(
  supabase: SupabaseClient,
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized - no token provided' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate JWT and get user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized - invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check is_admin flag
  const { data: profile, error: profileError } = await supabase
    .from('player_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.is_admin) {
    return new Response(
      JSON.stringify({ error: 'Forbidden - not an admin' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return null // Authorized, continue processing
}
