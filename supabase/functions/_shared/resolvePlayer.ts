import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface ResolvedUser {
  userId: string;
  displayName: string;
  isAuthenticated: boolean;
}

export async function resolveUser(
  req: Request,
  bodyUserId?: string,
  bodyUserName?: string
): Promise<ResolvedUser> {
  const authHeader = req.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');

    // Try to resolve as a user JWT (will fail gracefully if it's the anon key)
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (user && !error) {
        // Check player_profiles for custom display name first
        const { data: profile } = await supabase
          .from('player_profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle();

        return {
          userId: user.id,
          displayName: profile?.display_name || user.user_metadata?.full_name || bodyUserName || 'Anonymous Chef',
          isAuthenticated: true,
        };
      }
    } catch {
      // Token is not a valid user JWT (likely anon key) — fall through
    }
  }

  // Fall back to body userId (guest)
  return {
    userId: bodyUserId || 'anonymous',
    displayName: bodyUserName || 'Anonymous Chef',
    isAuthenticated: false,
  };
}
