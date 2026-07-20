// Analytics helper for logging game events
// Fire-and-forget - doesn't block the response

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export type EventType =
  | 'interaction'           // Kitchen: player used a tool on ingredients
  | 'ingredient_discovered' // Kitchen: first time this ingredient combo was created
  | 'dish_plated'           // Player plated a dish
  | 'dish_discovered'       // First time this dish was plated globally
  | 'session_start'         // Player started a new session (with referrer/UTM data)
  | 'rate_limited'          // Player hit rate limit
  | 'error'                 // Something went wrong

export interface GameEvent {
  event_type: EventType
  user_id?: string
  metadata?: Record<string, unknown>
}

export function logEvent(
  supabase: SupabaseClient,
  event: GameEvent
): void {
  // Fire-and-forget - don't await
  supabase
    .from('game_events')
    .insert({
      event_type: event.event_type,
      user_id: event.user_id || null,
      metadata: event.metadata || {}
    })
    .then(({ error }) => {
      if (error) {
        console.error('Failed to log event:', error.message)
      }
    })
}
