


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "archive";


ALTER SCHEMA "archive" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint, "p_dish_id" "uuid") RETURNS TABLE("slot_index" smallint, "replaced_existing" boolean, "is_first_add" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_dish_user_id    UUID;
  v_existing_slot   SMALLINT;
  v_replaced        BOOLEAN := FALSE;
  v_was_first_ever  BOOLEAN;
BEGIN
  IF p_slot_index < 0 OR p_slot_index > 4 THEN
    RAISE EXCEPTION 'Invalid slot_index: must be 0-4';
  END IF;

  -- Ownership check: the dish must belong to the caller.
  SELECT d.user_id INTO v_dish_user_id FROM dishes d WHERE d.id = p_dish_id;
  IF v_dish_user_id IS NULL THEN
    RAISE EXCEPTION 'Dish not found or has no owner';
  END IF;
  IF v_dish_user_id != p_user_id THEN
    RAISE EXCEPTION 'Cannot menu a dish you do not own';
  END IF;

  -- Duplicate check: same dish_id already in a different slot.
  SELECT pms.slot_index INTO v_existing_slot
    FROM player_menu_slots pms
    WHERE pms.user_id = p_user_id
      AND pms.dish_id = p_dish_id
      AND pms.slot_index != p_slot_index;
  IF v_existing_slot IS NOT NULL THEN
    RAISE EXCEPTION 'Dish already in slot %', v_existing_slot;
  END IF;

  -- Capture the "is this the first-ever add" latch BEFORE any writes.
  -- menu_first_added_at is NULL only before the very first slot add; once
  -- set it's preserved forever via COALESCE. Missing state row is also
  -- first-ever. This mirrors pending_first_review's trigger condition
  -- so the two telemetry signals stay in lockstep.
  SELECT (pcs.menu_first_added_at IS NULL) INTO v_was_first_ever
    FROM player_critic_state pcs
    WHERE pcs.user_id = p_user_id;

  -- Atomic replace (delete any existing row at this slot first, same txn).
  DELETE FROM player_menu_slots pms
    WHERE pms.user_id = p_user_id AND pms.slot_index = p_slot_index
    RETURNING true INTO v_replaced;

  INSERT INTO player_menu_slots (user_id, slot_index, dish_id)
    VALUES (p_user_id, p_slot_index, p_dish_id);

  -- Upsert critic-state. Latches menu_first_added_at and pending_first_review
  -- on first-ever add; preserves existing values on subsequent adds.
  INSERT INTO player_critic_state (user_id, menu_first_added_at, pending_first_review)
    VALUES (p_user_id, now(), TRUE)
    ON CONFLICT (user_id) DO UPDATE SET
      menu_first_added_at = COALESCE(player_critic_state.menu_first_added_at, EXCLUDED.menu_first_added_at),
      pending_first_review = CASE
        WHEN player_critic_state.menu_first_added_at IS NULL THEN TRUE
        ELSE player_critic_state.pending_first_review
      END;

  slot_index := p_slot_index;
  replaced_existing := COALESCE(v_replaced, FALSE);
  -- NULL = no pre-existing state row = first-ever; TRUE = had row with null
  -- menu_first_added_at (defensive, shouldn't occur); FALSE = repeat add.
  is_first_add := COALESCE(v_was_first_ever, TRUE);
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."add_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint, "p_dish_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_daily_reward"("p_user_id" "uuid") RETURNS TABLE("streak_day" integer, "coins_awarded" integer, "is_milestone" boolean, "grace_used" boolean, "was_reset" boolean, "previous_streak" integer, "days_missed" integer, "already_claimed_today" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::DATE;
  v_streak player_streaks%ROWTYPE;
  v_existing daily_reward_claims%ROWTYPE;
  v_prev_streak INT := 0;
  v_new_streak INT;
  v_days_missed INT := 0;
  v_use_grace BOOLEAN := FALSE;
  v_was_reset BOOLEAN := FALSE;
  v_coins INT;
  v_is_milestone BOOLEAN;
  v_new_grace_date DATE;
BEGIN
  -- 1. Idempotency: if we already have a claim for today, return its data.
  SELECT * INTO v_existing
    FROM daily_reward_claims
    WHERE user_id = p_user_id AND claim_date = v_today;

  IF FOUND THEN
    SELECT * INTO v_streak FROM player_streaks WHERE user_id = p_user_id;
    streak_day := v_existing.streak_day;
    coins_awarded := v_existing.coins_awarded;
    is_milestone := v_existing.is_milestone;
    grace_used := v_existing.grace_used;
    was_reset := v_existing.was_reset;
    previous_streak := COALESCE(v_streak.current_streak, v_existing.streak_day);
    days_missed := 0;
    already_claimed_today := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2. Load current streak row (locks for update to serialize concurrent calls).
  SELECT * INTO v_streak
    FROM player_streaks
    WHERE user_id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Brand-new player: first-ever claim.
    v_prev_streak := 0;
    v_days_missed := 0;
    v_new_streak := 1;
    v_new_grace_date := NULL;
    v_was_reset := FALSE;
  ELSE
    v_prev_streak := v_streak.current_streak;
    v_days_missed := COALESCE(v_today - v_streak.last_check_in_date, 0);

    IF v_days_missed <= 1 THEN
      -- Consecutive (or first-time with check-in already today — anomaly, still safe).
      v_new_streak := v_prev_streak + 1;
      v_new_grace_date := v_streak.last_grace_date;
    ELSIF v_days_missed = 2
      AND (v_streak.last_grace_date IS NULL
           OR (v_today - v_streak.last_grace_date) >= 7) THEN
      -- Grace: exactly one day missed, grace window open.
      v_use_grace := TRUE;
      v_new_streak := v_prev_streak + 1;
      v_new_grace_date := v_today;
    ELSE
      -- Reset: 2+ days missed without grace available, or 3+ days missed.
      v_was_reset := TRUE;
      v_new_streak := 1;
      v_new_grace_date := NULL; -- cleared per spec so rebuilt streak gets fresh grace
    END IF;
  END IF;

  v_coins := daily_reward_for_streak_day(v_new_streak);
  v_is_milestone := v_new_streak IN (3, 7, 14, 30);

  -- 3. Upsert streak row.
  INSERT INTO player_streaks (
    user_id, current_streak, longest_streak,
    last_check_in_date, last_grace_date,
    total_claimed_coins, updated_at
  )
  VALUES (
    p_user_id, v_new_streak, v_new_streak,
    v_today, v_new_grace_date,
    v_coins, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    current_streak = EXCLUDED.current_streak,
    longest_streak = GREATEST(player_streaks.longest_streak, EXCLUDED.current_streak),
    last_check_in_date = EXCLUDED.last_check_in_date,
    last_grace_date = EXCLUDED.last_grace_date,
    total_claimed_coins = player_streaks.total_claimed_coins + v_coins,
    updated_at = now();

  -- 4. Append audit row. Unique (user_id, claim_date) protects against races.
  INSERT INTO daily_reward_claims (
    user_id, claim_date, streak_day,
    coins_awarded, is_milestone, was_reset, grace_used
  )
  VALUES (
    p_user_id, v_today, v_new_streak,
    v_coins, v_is_milestone, v_was_reset, v_use_grace
  );

  -- 5. Credit the player. Mirrors the pattern in claim_message_coins and
  --    increment_player_coins (migration 093).
  UPDATE player_profiles
    SET coins = coins + v_coins,
        total_coins_earned = total_coins_earned + v_coins
    WHERE id = p_user_id;

  streak_day := v_new_streak;
  coins_awarded := v_coins;
  is_milestone := v_is_milestone;
  grace_used := v_use_grace;
  was_reset := v_was_reset;
  previous_streak := v_prev_streak;
  days_missed := v_days_missed;
  already_claimed_today := FALSE;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."claim_daily_reward"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_message_coins"("p_message_id" "uuid", "p_user_id" "uuid") RETURNS TABLE("coins_granted" integer, "new_balance" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_amount INT;
  v_balance INT;
BEGIN
  UPDATE player_messages
    SET coin_claimed_at = now()
    WHERE id = p_message_id
      AND user_id = p_user_id
      AND coin_claimed_at IS NULL
      AND coin_grant > 0
    RETURNING coin_grant INTO v_amount;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'not_eligible';
  END IF;

  UPDATE player_profiles
    SET coins = coins + v_amount,
        total_coins_earned = total_coins_earned + v_amount
    WHERE id = p_user_id
    RETURNING coins INTO v_balance;

  coins_granted := v_amount;
  new_balance := v_balance;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."claim_message_coins"("p_message_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_image_counts"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  delete from daily_image_counts
  where date < current_date - interval '7 days';
end;
$$;


ALTER FUNCTION "public"."cleanup_old_image_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_film"("p_user_id" "uuid", "p_daily_limit" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_profile player_profiles%rowtype;
  v_today date := current_date;
  v_source text;
begin
  -- Lock the row for update
  select * into v_profile
    from player_profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'source', null);
  end if;

  -- Reset daily counter if new day
  if v_profile.daily_film_date is null or v_profile.daily_film_date < v_today then
    update player_profiles
      set daily_film_date = v_today, daily_film_used = 0
      where id = p_user_id;
    v_profile.daily_film_used := 0;
  end if;

  -- Try daily free film first
  if v_profile.daily_film_used < p_daily_limit then
    update player_profiles
      set daily_film_used = daily_film_used + 1
      where id = p_user_id;

    v_source := 'daily';
    return jsonb_build_object(
      'allowed', true,
      'remaining', (p_daily_limit - v_profile.daily_film_used - 1) + v_profile.film_balance,
      'source', v_source
    );
  end if;

  -- Try purchased film
  if v_profile.film_balance > 0 then
    update player_profiles
      set film_balance = film_balance - 1
      where id = p_user_id;

    v_source := 'purchased';
    return jsonb_build_object(
      'allowed', true,
      'remaining', (v_profile.film_balance - 1),
      'source', v_source
    );
  end if;

  -- No film available
  return jsonb_build_object('allowed', false, 'remaining', 0, 'source', null);
end;
$$;


ALTER FUNCTION "public"."consume_film"("p_user_id" "uuid", "p_daily_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."credit_coins_for_purchase"("p_user_id" "uuid", "p_package_id" "uuid", "p_stripe_session_id" "text", "p_stripe_event_id" "text", "p_coins" integer, "p_amount_cents" integer, "p_currency" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Insert audit row first — UNIQUE constraint on stripe_event_id throws
  -- if we've already processed this event (idempotency).
  INSERT INTO coin_purchases (
    user_id, package_id, stripe_session_id, stripe_event_id,
    coins_credited, amount_cents, currency, status
  ) VALUES (
    p_user_id, p_package_id, p_stripe_session_id, p_stripe_event_id,
    p_coins, p_amount_cents, p_currency, 'completed'
  );

  -- Then credit the coins to the player profile.
  UPDATE player_profiles
  SET coins = coins + p_coins,
      total_coins_earned = total_coins_earned + p_coins
  WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."credit_coins_for_purchase"("p_user_id" "uuid", "p_package_id" "uuid", "p_stripe_session_id" "text", "p_stripe_event_id" "text", "p_coins" integer, "p_amount_cents" integer, "p_currency" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."daily_reward_for_streak_day"("p_day" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_day = 30 THEN 2000
    WHEN p_day = 14 THEN 800
    WHEN p_day = 7 THEN 400
    WHEN p_day = 3 THEN 150
    WHEN p_day >= 31 THEN 200
    WHEN p_day BETWEEN 15 AND 29 THEN 150
    WHEN p_day BETWEEN 8 AND 13 THEN 100
    WHEN p_day BETWEEN 4 AND 6 THEN 75
    ELSE 50
  END;
$$;


ALTER FUNCTION "public"."daily_reward_for_streak_day"("p_day" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_critic_review_summary"("p_user_id" "uuid") RETURNS TABLE("unread_count" integer, "reputation" integer, "critics_dry" boolean, "menu_size" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_menu_size  INT;
  v_any_critic_has_work BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_menu_size FROM player_menu_slots WHERE user_id = p_user_id;

  SELECT EXISTS (
    SELECT 1 FROM critics c
    WHERE c.active = TRUE
      AND EXISTS (
        SELECT 1 FROM player_menu_slots pms
        WHERE pms.user_id = p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM critic_reviews cr
            WHERE cr.user_id = p_user_id
              AND cr.critic_id = c.id
              AND cr.dish_id = pms.dish_id
          )
      )
  ) INTO v_any_critic_has_work;

  unread_count := (SELECT COUNT(*)::INT FROM critic_reviews WHERE user_id = p_user_id AND read_at IS NULL);
  reputation   := COALESCE((SELECT reputation FROM player_critic_state WHERE user_id = p_user_id), 0);
  -- Dry only matters when menu is non-empty; an empty menu isn't "dry", it's "empty".
  critics_dry  := v_menu_size > 0 AND NOT v_any_critic_has_work;
  menu_size    := v_menu_size;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."get_critic_review_summary"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_active_users"("p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "unique_discoverers" bigint, "total_discoveries" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(created_at) AS day,
    COUNT(DISTINCT discovered_by) AS unique_discoverers,
    COUNT(*) AS total_discoveries
  FROM interactions
  WHERE created_at >= (CURRENT_DATE - p_days)
  GROUP BY DATE(created_at)
  ORDER BY day;
END;
$$;


ALTER FUNCTION "public"."get_daily_active_users"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_game_stats"("p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "unique_players" bigint, "total_events" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(created_at) AS day,
    COUNT(DISTINCT player_id) AS unique_players,
    COUNT(*) AS total_events
  FROM game_events
  WHERE created_at >= (CURRENT_DATE - p_days)
  GROUP BY DATE(created_at)
  ORDER BY day;
END;
$$;


ALTER FUNCTION "public"."get_daily_game_stats"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_discovery_leaderboard"() RETURNS TABLE("player_id" "text", "discovery_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    discovered_by as player_id,
    COUNT(*) as discovery_count
  FROM recipes
  GROUP BY discovered_by
  ORDER BY discovery_count DESC
  LIMIT 10;
END;
$$;


ALTER FUNCTION "public"."get_discovery_leaderboard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_event_breakdown"() RETURNS TABLE("outcome_type" "text", "outcome_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.outcome_type,
    COUNT(*) AS outcome_count
  FROM interactions i
  GROUP BY i.outcome_type
  ORDER BY outcome_count DESC;
END;
$$;


ALTER FUNCTION "public"."get_event_breakdown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_film_count"("p_user_id" "uuid", "p_daily_limit" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_profile player_profiles%rowtype;
  v_today date := current_date;
  v_daily_remaining integer;
begin
  select * into v_profile
    from player_profiles
    where id = p_user_id;

  if not found then
    return jsonb_build_object('total', 0, 'daily_remaining', 0, 'purchased', 0);
  end if;

  if v_profile.daily_film_date is null or v_profile.daily_film_date < v_today then
    v_daily_remaining := p_daily_limit;
  else
    v_daily_remaining := greatest(0, p_daily_limit - v_profile.daily_film_used);
  end if;

  return jsonb_build_object(
    'total', v_daily_remaining + v_profile.film_balance,
    'daily_remaining', v_daily_remaining,
    'purchased', v_profile.film_balance
  );
end;
$$;


ALTER FUNCTION "public"."get_film_count"("p_user_id" "uuid", "p_daily_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_image_count"("p_player_id" "text", "p_limit" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_current_count integer;
  v_today date := current_date;
begin
  select count into v_current_count
  from daily_image_counts
  where player_id = p_player_id and date = v_today;

  v_current_count := coalesce(v_current_count, 0);

  return jsonb_build_object(
    'allowed', v_current_count < p_limit,
    'count', v_current_count,
    'remaining', greatest(0, p_limit - v_current_count)
  );
end;
$$;


ALTER FUNCTION "public"."get_image_count"("p_player_id" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_level_leaderboard"() RETURNS TABLE("player_id" "uuid", "completed_levels" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT player_id, COUNT(*)::BIGINT AS completed_levels
  FROM player_level_progress
  WHERE stars >= 1
  GROUP BY player_id;
$$;


ALTER FUNCTION "public"."get_level_leaderboard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_restaurant_rank"("p_user_id" "uuid") RETURNS TABLE("rank" integer, "reputation" integer, "total_ranked" integer, "display_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH me AS (
    SELECT
      COALESCE(pcs.reputation, 0) AS rep,
      COALESCE(pp.display_name, 'Anonymous Chef') AS name
    FROM player_profiles pp
    LEFT JOIN player_critic_state pcs ON pcs.user_id = pp.id
    WHERE pp.id = p_user_id
  )
  SELECT
    CASE
      WHEN (SELECT rep FROM me) = 0 THEN 0
      ELSE (
        SELECT COUNT(*)::INT + 1
        FROM player_critic_state pcs
        WHERE pcs.reputation > (SELECT rep FROM me)
      )
    END AS rank,
    (SELECT rep FROM me) AS reputation,
    (SELECT COUNT(*)::INT FROM player_critic_state WHERE reputation > 0) AS total_ranked,
    (SELECT name FROM me) AS display_name;
$$;


ALTER FUNCTION "public"."get_my_restaurant_rank"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_player_activity_summary"() RETURNS TABLE("total_discoverers" bigint, "discovered_today" bigint, "discovered_week" bigint, "discovered_month" bigint, "total_interactions" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(DISTINCT discovered_by) FROM interactions) AS total_discoverers,
    (SELECT COUNT(DISTINCT discovered_by) FROM interactions WHERE created_at >= CURRENT_DATE) AS discovered_today,
    (SELECT COUNT(DISTINCT discovered_by) FROM interactions WHERE created_at >= (CURRENT_DATE - 7)) AS discovered_week,
    (SELECT COUNT(DISTINCT discovered_by) FROM interactions WHERE created_at >= (CURRENT_DATE - 30)) AS discovered_month,
    (SELECT SUM(discovery_count)::bigint FROM interactions) AS total_interactions;
END;
$$;


ALTER FUNCTION "public"."get_player_activity_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rank_context"("p_user_id" "uuid", "p_neighbor_count" integer DEFAULT 3) RETURNS TABLE("rank" integer, "user_id" "uuid", "display_name" "text", "reputation" integer, "is_me" boolean, "total_ranked" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH ranked AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY pcs.reputation DESC, pp.created_at ASC)::INT AS r,
      pcs.user_id AS uid,
      COALESCE(pp.display_name, 'Anonymous Chef') AS name,
      pcs.reputation
    FROM player_critic_state pcs
    JOIN player_profiles pp ON pp.id = pcs.user_id
    WHERE pcs.reputation > 0
  ),
  my_row AS (
    SELECT * FROM ranked WHERE uid = p_user_id
  )
  SELECT
    r.r AS rank,
    r.uid AS user_id,
    r.name AS display_name,
    r.reputation,
    (r.uid = p_user_id) AS is_me,
    (SELECT COUNT(*)::INT FROM ranked) AS total_ranked
  FROM ranked r
  WHERE r.r >= GREATEST(1, (SELECT r FROM my_row) - GREATEST(0, LEAST(p_neighbor_count, 10)))
    AND r.r <= (SELECT r FROM my_row)
  ORDER BY r.r ASC;
$$;


ALTER FUNCTION "public"."get_rank_context"("p_user_id" "uuid", "p_neighbor_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_retention_cohorts"("p_days" integer DEFAULT 14) RETURNS TABLE("cohort_date" "date", "cohort_size" bigint, "day1_returned" bigint, "day1_pct" numeric, "day3_returned" bigint, "day3_pct" numeric, "day7_returned" bigint, "day7_pct" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  WITH daily_sessions AS (
    SELECT DISTINCT player_id, created_at::date AS session_date
    FROM game_events
    WHERE event_type = 'session_start'
    AND player_id IS NOT NULL
    AND created_at >= NOW() - (p_days + 7) * INTERVAL '1 day'
  ),
  cohorts AS (
    SELECT session_date, COUNT(DISTINCT player_id) AS cohort_size
    FROM daily_sessions
    GROUP BY session_date
  ),
  retention AS (
    SELECT
      c.session_date AS cohort_date,
      r.session_date AS return_date,
      COUNT(DISTINCT r.player_id) AS returned
    FROM daily_sessions c
    JOIN daily_sessions r ON c.player_id = r.player_id AND r.session_date > c.session_date
    GROUP BY c.session_date, r.session_date
  )
  SELECT
    co.session_date AS cohort_date,
    co.cohort_size,
    COALESCE(d1.returned, 0) AS day1_returned,
    ROUND(COALESCE(d1.returned, 0)::numeric / NULLIF(co.cohort_size, 0) * 100, 1) AS day1_pct,
    COALESCE(d3.returned, 0) AS day3_returned,
    ROUND(COALESCE(d3.returned, 0)::numeric / NULLIF(co.cohort_size, 0) * 100, 1) AS day3_pct,
    COALESCE(d7.returned, 0) AS day7_returned,
    ROUND(COALESCE(d7.returned, 0)::numeric / NULLIF(co.cohort_size, 0) * 100, 1) AS day7_pct
  FROM cohorts co
  LEFT JOIN retention d1 ON co.session_date = d1.cohort_date AND d1.return_date = co.session_date + 1
  LEFT JOIN retention d3 ON co.session_date = d3.cohort_date AND d3.return_date = co.session_date + 3
  LEFT JOIN retention d7 ON co.session_date = d7.cohort_date AND d7.return_date = co.session_date + 7
  WHERE co.session_date >= NOW()::date - p_days
  ORDER BY co.session_date DESC;
$$;


ALTER FUNCTION "public"."get_retention_cohorts"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_session_depth"("p_days" integer DEFAULT 14) RETURNS TABLE("day" "date", "unique_players" bigint, "total_interactions" bigint, "avg_interactions_per_player" numeric, "total_discoveries" bigint, "avg_discoveries_per_player" numeric, "total_platings" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT
    created_at::date AS day,
    COUNT(DISTINCT user_id) AS unique_players,
    COUNT(*) FILTER (WHERE event_type = 'interaction') AS total_interactions,
    ROUND(COUNT(*) FILTER (WHERE event_type = 'interaction')::numeric / NULLIF(COUNT(DISTINCT user_id), 0), 1) AS avg_interactions_per_player,
    COUNT(*) FILTER (WHERE event_type = 'ingredient_discovered') AS total_discoveries,
    ROUND(COUNT(*) FILTER (WHERE event_type = 'ingredient_discovered')::numeric / NULLIF(COUNT(DISTINCT user_id), 0), 1) AS avg_discoveries_per_player,
    COUNT(*) FILTER (WHERE event_type = 'dish_plated') AS total_platings
  FROM game_events
  WHERE created_at >= NOW() - p_days * INTERVAL '1 day'
    AND user_id IS NOT NULL
  GROUP BY created_at::date
  ORDER BY day DESC;
$$;


ALTER FUNCTION "public"."get_session_depth"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_streak"("p_user_id" "uuid") RETURNS TABLE("current_streak" integer, "longest_streak" integer, "last_check_in_date" "date")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT
    COALESCE(ps.current_streak, 0),
    COALESCE(ps.longest_streak, 0),
    ps.last_check_in_date
  FROM (SELECT 1) AS _
  LEFT JOIN player_streaks ps ON ps.user_id = p_user_id;
$$;


ALTER FUNCTION "public"."get_streak"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tool_usage_stats"() RETURNS TABLE("tool_slug" "text", "usage_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.tool_slug,
    SUM(i.discovery_count)::bigint AS usage_count
  FROM interactions i
  GROUP BY i.tool_slug
  ORDER BY usage_count DESC;
END;
$$;


ALTER FUNCTION "public"."get_tool_usage_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_players"("p_limit" integer DEFAULT 20) RETURNS TABLE("player_name" "text", "discovery_count" bigint, "last_active" timestamp with time zone, "first_seen" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.discovered_by AS player_name,
    COUNT(*) AS discovery_count,
    MAX(i.created_at) AS last_active,
    MIN(i.created_at) AS first_seen
  FROM interactions i
  WHERE i.discovered_by IS NOT NULL
  GROUP BY i.discovered_by
  ORDER BY discovery_count DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_top_players"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_restaurants"("p_limit" integer DEFAULT 20) RETURNS TABLE("rank" integer, "user_id" "uuid", "display_name" "text", "reputation" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY pcs.reputation DESC, pp.created_at ASC)::INT AS rank,
    pcs.user_id,
    COALESCE(pp.display_name, 'Anonymous Chef') AS display_name,
    pcs.reputation
  FROM player_critic_state pcs
  JOIN player_profiles pp ON pp.id = pcs.user_id
  WHERE pcs.reputation > 0
  ORDER BY pcs.reputation DESC, pp.created_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;


ALTER FUNCTION "public"."get_top_restaurants"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_traffic_sources"("p_days" integer DEFAULT 14) RETURNS TABLE("source" "text", "session_count" bigint, "unique_players" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT
    COALESCE(metadata->>'source', 'direct') AS source,
    COUNT(*) AS session_count,
    COUNT(DISTINCT player_id) AS unique_players
  FROM game_events
  WHERE event_type = 'session_start'
  AND created_at >= NOW() - p_days * INTERVAL '1 day'
  AND player_id IS NOT NULL
  GROUP BY COALESCE(metadata->>'source', 'direct')
  ORDER BY session_count DESC;
$$;


ALTER FUNCTION "public"."get_traffic_sources"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_photographed_chefs"() RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT COUNT(DISTINCT user_id)::BIGINT
  FROM dishes
  WHERE photo_url IS NOT NULL
    AND user_id IS NOT NULL;
$$;


ALTER FUNCTION "public"."get_unique_photographed_chefs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.player_profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Anonymous Chef')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_ingredient_discovery"("ingredient_ids" "uuid"[]) RETURNS TABLE("ingredient_id" "uuid", "ingredient_name" "text", "ingredient_description" "text")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  WITH updated AS (
    UPDATE ingredients
    SET discovery_count = discovery_count + 1
    WHERE id = ANY(ingredient_ids)
    RETURNING id, name, description, sprite_url, discovery_count, sprite_tier
  )
  SELECT id, name, description
  FROM updated
  WHERE discovery_count >= 10
    AND (sprite_url IS NULL OR sprite_tier = 'klein');
$$;


ALTER FUNCTION "public"."increment_ingredient_discovery"("ingredient_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_interaction_discovery"("p_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  UPDATE interactions SET discovery_count = discovery_count + 1 WHERE id = p_id;
$$;


ALTER FUNCTION "public"."increment_interaction_discovery"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_player_coins"("p_user_id" "uuid", "p_amount" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE player_profiles
  SET coins = coins + p_amount,
      total_coins_earned = total_coins_earned + p_amount
  WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."increment_player_coins"("p_user_id" "uuid", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_critic_review"("p_user_id" "uuid", "p_critic_id" "uuid", "p_dish_id" "uuid", "p_stars" numeric, "p_review_text" "text", "p_rep_awarded" integer, "p_created_at" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_review_id UUID;
BEGIN
  INSERT INTO critic_reviews (
    user_id, critic_id, dish_id, stars, review_text, rep_awarded,
    created_at, generated_at
  )
  VALUES (
    p_user_id, p_critic_id, p_dish_id, p_stars, p_review_text, p_rep_awarded,
    p_created_at, now()
  )
  RETURNING id INTO v_review_id;

  UPDATE player_critic_state
    SET reputation = reputation + p_rep_awarded
    WHERE user_id = p_user_id;

  RETURN v_review_id;
END;
$$;


ALTER FUNCTION "public"."insert_critic_review"("p_user_id" "uuid", "p_critic_id" "uuid", "p_dish_id" "uuid", "p_stars" numeric, "p_review_text" "text", "p_rep_awarded" integer, "p_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_reviews_read"("p_user_id" "uuid", "p_review_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE critic_reviews
    SET read_at = now()
    WHERE user_id = p_user_id
      AND id = ANY(p_review_ids)
      AND read_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."mark_reviews_read"("p_user_id" "uuid", "p_review_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pick_critic_review_targets"("p_user_id" "uuid") RETURNS TABLE("critic_id" "uuid", "critic_name" "text", "critic_taste_profile" "text", "critic_weight" integer, "dish_id" "uuid", "dish_ai_dish_name" "text", "dish_dish_name" "text", "dish_ingredients" "jsonb", "dish_steps" "jsonb", "dish_star_rating" numeric, "next_fire" timestamp with time zone, "was_onboarding_seed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_state          player_critic_state%ROWTYPE;
  v_slot_count     INT;
  v_unread_count   INT;
  v_anchor         TIMESTAMPTZ;
  v_now            TIMESTAMPTZ := now();
  v_interval_hrs   NUMERIC;
  v_elapsed_hrs    NUMERIC;
  v_to_make        INT;
  v_pending_seed   BOOLEAN := FALSE;
  v_targets_made   INT := 0;
  v_last_critic    UUID;
  v_picked_critic  UUID;
  v_picked_dish    UUID;
  v_next_fire      TIMESTAMPTZ;
  v_critic         critics%ROWTYPE;
  v_dish           dishes%ROWTYPE;
BEGIN
  -- Advisory lock scoped to this user. If another call is mid-generate,
  -- bail quietly — the other caller will do the work.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0)) THEN
    RETURN;
  END IF;

  SELECT * INTO v_state FROM player_critic_state WHERE user_id = p_user_id;

  -- Rate limit: 60s window. State row might not exist yet on a new player.
  IF v_state.user_id IS NOT NULL
      AND v_state.last_generate_call_at IS NOT NULL
      AND v_now - v_state.last_generate_call_at < INTERVAL '60 seconds' THEN
    RETURN;
  END IF;

  -- Menu empty? Update the rate-limit marker anyway so empty-menu calls
  -- can't hammer the function.
  SELECT COUNT(*) INTO v_slot_count
    FROM player_menu_slots
    WHERE user_id = p_user_id;

  IF v_slot_count = 0 THEN
    IF v_state.user_id IS NOT NULL THEN
      UPDATE player_critic_state
        SET last_generate_call_at = v_now
        WHERE user_id = p_user_id;
    END IF;
    RETURN;
  END IF;

  v_last_critic  := v_state.last_critic_id;
  v_pending_seed := COALESCE(v_state.pending_first_review, FALSE);

  SELECT COUNT(*) INTO v_unread_count
    FROM critic_reviews
    WHERE user_id = p_user_id AND read_at IS NULL;

  -- Determine how many reviews to make on this call.
  IF v_pending_seed THEN
    -- Instant-first-review path: always generate one, unconditionally.
    v_to_make := 1;
  ELSIF v_unread_count >= 3 THEN
    -- At cap.
    UPDATE player_critic_state
      SET last_generate_call_at = v_now
      WHERE user_id = p_user_id;
    RETURN;
  ELSE
    -- Compute anchor: latest of (last review, menu_first_added_at).
    v_anchor := GREATEST(
      COALESCE(
        (SELECT MAX(cr.created_at) FROM critic_reviews cr WHERE cr.user_id = p_user_id),
        '-infinity'::TIMESTAMPTZ
      ),
      COALESCE(v_state.menu_first_added_at, '-infinity'::TIMESTAMPTZ)
    );

    -- Stale-anchor snap: if a returning player has no unread and the anchor
    -- is > 24h old, snap the anchor forward so they get a review on this
    -- call instead of waiting another 4–8h.
    IF v_unread_count = 0 AND v_now - v_anchor > INTERVAL '24 hours' THEN
      v_interval_hrs := 4 + random() * 4;
      v_anchor := v_now - (v_interval_hrs * INTERVAL '1 hour');
    END IF;

    -- Fresh interval sample for the "how many fit in elapsed" calc.
    v_interval_hrs := 4 + random() * 4;
    v_elapsed_hrs  := EXTRACT(EPOCH FROM (v_now - v_anchor)) / 3600.0;
    v_to_make      := LEAST(3 - v_unread_count, FLOOR(v_elapsed_hrs / v_interval_hrs)::INT);

    IF v_to_make <= 0 THEN
      UPDATE player_critic_state
        SET last_generate_call_at = v_now
        WHERE user_id = p_user_id;
      RETURN;
    END IF;
  END IF;

  -- Loop and pick up to v_to_make targets.
  FOR i IN 1..v_to_make LOOP
    -- Critic pool: active, != last_critic_id, has at least one menued dish
    -- they haven't reviewed yet. Pick the one whose last review for this
    -- player is oldest (NULL = never visited, sorts first) with random
    -- tiebreak.
    SELECT c.id INTO v_picked_critic
      FROM critics c
      WHERE c.active = TRUE
        AND (v_last_critic IS NULL OR c.id != v_last_critic)
        AND EXISTS (
          SELECT 1 FROM player_menu_slots pms
          WHERE pms.user_id = p_user_id
            AND NOT EXISTS (
              SELECT 1 FROM critic_reviews cr
              WHERE cr.user_id = p_user_id
                AND cr.critic_id = c.id
                AND cr.dish_id = pms.dish_id
            )
        )
      ORDER BY (
        SELECT MAX(cr2.created_at) FROM critic_reviews cr2
        WHERE cr2.user_id = p_user_id AND cr2.critic_id = c.id
      ) NULLS FIRST, random()
      LIMIT 1;

    IF v_picked_critic IS NULL THEN
      -- Pool empty — critics dry. The edge function detects dryness via a
      -- separate summary query; we just stop picking here.
      EXIT;
    END IF;

    -- Pick a random unreviewed menued dish for this critic.
    SELECT pms.dish_id INTO v_picked_dish
      FROM player_menu_slots pms
      WHERE pms.user_id = p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM critic_reviews cr
          WHERE cr.user_id = p_user_id
            AND cr.critic_id = v_picked_critic
            AND cr.dish_id = pms.dish_id
        )
      ORDER BY random()
      LIMIT 1;

    IF v_picked_dish IS NULL THEN
      -- Shouldn't happen given the EXISTS filter above; defensive.
      EXIT;
    END IF;

    -- Stagger created_at across the elapsed window so reviews read as
    -- "Margaux 6h ago, Theo 11h ago" instead of all stamped now().
    -- First-ever review uses now() so the instant feedback lands immediately.
    IF v_pending_seed AND i = 1 THEN
      v_next_fire := v_now;
    ELSE
      v_next_fire := LEAST(
        v_now,
        v_anchor + ((i::NUMERIC / v_to_make::NUMERIC) * v_interval_hrs) * INTERVAL '1 hour'
      );
    END IF;

    -- Fetch critic + dish for the return row.
    SELECT * INTO v_critic FROM critics WHERE id = v_picked_critic;
    SELECT * INTO v_dish   FROM dishes  WHERE id = v_picked_dish;

    critic_id            := v_picked_critic;
    critic_name          := v_critic.name;
    critic_taste_profile := v_critic.taste_profile;
    critic_weight        := v_critic.weight;
    dish_id              := v_picked_dish;
    dish_ai_dish_name    := v_dish.ai_dish_name;
    dish_dish_name       := v_dish.dish_name;
    dish_ingredients     := v_dish.ingredients;
    dish_steps           := v_dish.steps;
    dish_star_rating     := v_dish.star_rating;
    next_fire            := v_next_fire;
    was_onboarding_seed  := (v_pending_seed AND i = 1);
    RETURN NEXT;

    v_last_critic  := v_picked_critic;
    v_targets_made := v_targets_made + 1;
  END LOOP;

  -- State updates. Clear pending_first_review only if we actually used it.
  -- Advance last_critic_id if we picked something.
  UPDATE player_critic_state
    SET last_generate_call_at = v_now,
        pending_first_review = CASE
          WHEN v_pending_seed AND v_targets_made > 0 THEN FALSE
          ELSE pending_first_review
        END,
        last_critic_id = CASE
          WHEN v_targets_made > 0 THEN v_last_critic
          ELSE last_critic_id
        END
    WHERE user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."pick_critic_review_targets"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_film_pack"("p_user_id" "uuid", "p_pack_slug" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile player_profiles%rowtype;
  v_rolls integer;
  v_cost  integer;
begin
  -- Hardcoded pack catalogue — single source of truth lives here.
  -- Keep in sync with the client-side PACKS array in ShopPopup.tsx.
  case p_pack_slug
    when 'film-pack-1'  then v_rolls := 1;  v_cost := 50;
    when 'film-pack-5'  then v_rolls := 5;  v_cost := 225;  -- 10% off (vs 250)
    when 'film-pack-20' then v_rolls := 20; v_cost := 800;  -- 20% off (vs 1000)
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_pack');
  end case;

  -- Lock the profile row so concurrent purchases can't double-spend.
  select * into v_profile
    from player_profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  if v_profile.coins < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_coins');
  end if;

  update player_profiles
    set coins = coins - v_cost,
        film_balance = film_balance + v_rolls
    where id = p_user_id
    returning coins, film_balance into v_profile.coins, v_profile.film_balance;

  return jsonb_build_object(
    'ok', true,
    'coins', v_profile.coins,
    'film_balance', v_profile.film_balance,
    'rolls_added', v_rolls,
    'cost', v_cost
  );
end;
$$;


ALTER FUNCTION "public"."purchase_film_pack"("p_user_id" "uuid", "p_pack_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_player_reputation"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total INT;
BEGIN
  SELECT COALESCE(SUM(rep_awarded), 0) INTO v_total
    FROM critic_reviews
    WHERE user_id = p_user_id;

  UPDATE player_critic_state
    SET reputation = v_total
    WHERE user_id = p_user_id;

  -- Defensive: if a player has reviews but no state row (shouldn't happen,
  -- but could under an edge-case insert order), materialize the state row.
  IF NOT FOUND AND v_total > 0 THEN
    INSERT INTO player_critic_state (user_id, reputation)
      VALUES (p_user_id, v_total)
      ON CONFLICT (user_id) DO UPDATE SET reputation = EXCLUDED.reputation;
  END IF;

  RETURN v_total;
END;
$$;


ALTER FUNCTION "public"."recompute_player_reputation"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint) RETURNS TABLE("removed_dish_id" "uuid", "had_reviews" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_dish_id UUID;
BEGIN
  IF p_slot_index < 0 OR p_slot_index > 4 THEN
    RAISE EXCEPTION 'Invalid slot_index: must be 0-4';
  END IF;

  DELETE FROM player_menu_slots
    WHERE user_id = p_user_id AND slot_index = p_slot_index
    RETURNING dish_id INTO v_dish_id;

  -- Return the dish_id and a count of reviews this player had for it
  -- (for telemetry on menu_slot_removed).
  removed_dish_id := v_dish_id;
  had_reviews := (
    SELECT COUNT(*)::INT FROM critic_reviews
      WHERE user_id = p_user_id AND dish_id = v_dish_id
  );
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."remove_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ingredients_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_ingredients_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_chef_level"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_working_level INTEGER;
BEGIN
  SELECT COALESCE(
    (SELECT MIN(bt.level)
     FROM (SELECT level, COUNT(*) AS total FROM badges WHERE is_active = true GROUP BY level) bt
     WHERE bt.total > (
       SELECT COUNT(*) FROM player_badges pb2
       JOIN badges b2 ON b2.id = pb2.badge_id AND b2.is_active = true AND b2.level = bt.level
       WHERE pb2.player_id = NEW.player_id
     )),
    (SELECT MAX(level) + 1 FROM badges WHERE is_active = true)
  ) INTO v_working_level;
  -- Store completed level = working level - 1
  UPDATE player_profiles SET chef_level = GREATEST(v_working_level - 1, 0) WHERE id = NEW.player_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_player_chef_level"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_chef_level_function"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Update the chef_level in player_profiles based on badge count
  UPDATE player_profiles
  SET chef_level = (SELECT COUNT(*) FROM player_badges WHERE user_id = NEW.user_id)
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_player_chef_level_function"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_level_progress_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."update_player_level_progress_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_profile_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."update_player_profile_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_tools_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_tools_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "sprite_url" "text",
    "cost" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_starter" boolean DEFAULT false NOT NULL,
    "starter_order" integer,
    "description" "text",
    "category" "text",
    "sprite_prompt_hint" "text",
    "discovery_count" integer DEFAULT 0 NOT NULL,
    "sprite_tier" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."ingredients" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text") RETURNS SETOF "public"."ingredients"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  INSERT INTO ingredients (slug, name, emoji, cost, description, discovery_count)
  VALUES (p_slug, p_name, p_emoji, p_cost, p_description, 1)
  ON CONFLICT (slug) DO UPDATE
    SET discovery_count = ingredients.discovery_count + 1
  RETURNING *;
$$;


ALTER FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text", "p_tags" "text"[] DEFAULT '{}'::"text"[]) RETURNS SETOF "public"."ingredients"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  INSERT INTO ingredients (slug, name, emoji, cost, description, discovery_count, tags)
  VALUES (p_slug, p_name, p_emoji, p_cost, p_description, 1, COALESCE(p_tags, '{}'))
  ON CONFLICT (slug) DO UPDATE
    SET discovery_count = ingredients.discovery_count + 1
  RETURNING *;
$$;


ALTER FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text", "p_tags" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_player_stats"("p_user_id" "uuid", "p_action" "text", "p_amount" integer DEFAULT 0, "p_delta_level" smallint DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO player_stats (user_id, dishes_plated, total_coins_earned, best_flavour_score)
  VALUES (p_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO UPDATE SET
    dishes_plated = CASE
      WHEN p_action = 'plate' THEN player_stats.dishes_plated + 1
      ELSE player_stats.dishes_plated
    END,
    total_coins_earned = CASE
      WHEN p_action = 'coin' THEN player_stats.total_coins_earned + p_amount
      ELSE player_stats.total_coins_earned
    END,
    best_flavour_score = CASE
      WHEN p_action = 'score' THEN GREATEST(player_stats.best_flavour_score, p_amount)
      ELSE player_stats.best_flavour_score
    END;
END;
$$;


ALTER FUNCTION "public"."upsert_player_stats"("p_user_id" "uuid", "p_action" "text", "p_amount" integer, "p_delta_level" smallint) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archive"."daily_image_counts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "text" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "archive"."daily_image_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archive"."dish_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "input_hash" "text",
    "dish_name" "text" NOT NULL,
    "ingredients" "jsonb" NOT NULL,
    "image_url" "text",
    "player_name" "text" DEFAULT 'Anonymous Chef'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "player_id" "text"
);


ALTER TABLE "archive"."dish_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archive"."plated_dishes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "model" "text" DEFAULT 'unknown'::"text"
);


ALTER TABLE "archive"."plated_dishes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archive"."recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "discovered_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_event" boolean DEFAULT false,
    "cost" integer
);


ALTER TABLE "archive"."recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcement_seen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "announcement_slug" "text" NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."announcement_seen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "priority" "text" DEFAULT 'info'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    CONSTRAINT "announcements_priority_check" CHECK (("priority" = ANY (ARRAY['info'::"text", 'important'::"text", 'urgent'::"text"])))
);


ALTER TABLE "public"."announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."badges" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "hint" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "coin_reward" integer DEFAULT 25 NOT NULL,
    "ai_criteria" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "level" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chapters" (
    "id" integer NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "sort_order" integer NOT NULL,
    "unlock_rewards" "jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "emoji" "text" DEFAULT '📖'::"text" NOT NULL,
    "sprite_url" "text",
    "sprite_prompt_hint" "text"
);


ALTER TABLE "public"."chapters" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."chapters_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."chapters_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."chapters_id_seq" OWNED BY "public"."chapters"."id";



CREATE TABLE IF NOT EXISTS "public"."chef_levels" (
    "level" integer NOT NULL,
    "rank_name" "text" NOT NULL,
    "rank_emoji" "text" NOT NULL,
    "sprite_url" "text",
    "description" "text",
    "sprite_prompt_hint" "text"
);


ALTER TABLE "public"."chef_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coin_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "coins" integer NOT NULL,
    "price_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    "stripe_price_id" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coin_packages_coins_check" CHECK (("coins" > 0)),
    CONSTRAINT "coin_packages_price_cents_check" CHECK (("price_cents" > 0))
);


ALTER TABLE "public"."coin_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coin_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "package_id" "uuid",
    "stripe_session_id" "text" NOT NULL,
    "stripe_event_id" "text" NOT NULL,
    "coins_credited" integer NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coin_purchases_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."coin_purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."critic_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "critic_id" "uuid" NOT NULL,
    "dish_id" "uuid" NOT NULL,
    "stars" numeric(2,1) NOT NULL,
    "review_text" "text" NOT NULL,
    "rep_awarded" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    CONSTRAINT "critic_reviews_stars_check" CHECK ((("stars" >= (0)::numeric) AND ("stars" <= (5)::numeric)))
);


ALTER TABLE "public"."critic_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."critics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "portrait_url" "text",
    "tagline" "text" DEFAULT ''::"text" NOT NULL,
    "taste_profile" "text" DEFAULT ''::"text" NOT NULL,
    "weight" integer DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."critics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "prompt_hint" "text",
    "image_url" "text",
    "min_tier" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_reward_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "claim_date" "date" NOT NULL,
    "streak_day" integer NOT NULL,
    "coins_awarded" integer NOT NULL,
    "is_milestone" boolean DEFAULT false NOT NULL,
    "was_reset" boolean DEFAULT false NOT NULL,
    "grace_used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."daily_reward_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dish_photos_archive" (
    "id" "uuid",
    "input_hash" "text",
    "dish_name" "text",
    "ingredients" "jsonb",
    "image_url" "text",
    "player_name" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."dish_photos_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dish_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dish_id" "uuid",
    "author_name" "text" NOT NULL,
    "author_avatar" "text",
    "rating" integer NOT NULL,
    "review_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "dish_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."dish_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dishes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dish_name" "text",
    "ai_dish_name" "text",
    "ingredients" "jsonb" NOT NULL,
    "steps" "jsonb",
    "vessel" "text",
    "photo_url" "text",
    "camera_tier" "text",
    "input_hash" "text",
    "photographed_at" timestamp with time zone,
    "review_text" "text",
    "star_rating" numeric(2,1),
    "reviewed_at" timestamp with time zone,
    "badges_awarded" "jsonb",
    "coins_earned" integer DEFAULT 0,
    "order_id" "uuid",
    "order_score" numeric(2,1),
    "order_coins" integer,
    "served_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "camera_slug" "text",
    "user_id" "uuid" NOT NULL,
    "generation_model" "text"
);


ALTER TABLE "public"."dishes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."dishes"."generation_model" IS 'Backend model that generated photo_url (e.g. black-forest-labs/flux-2-pro, gemini-3.1-flash-image-preview). NULL for rows created before this column existed.';



CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message" "text" NOT NULL,
    "page" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "user_id" "uuid" NOT NULL,
    "category" "text",
    "user_agent" "text",
    "screen_width" integer,
    "is_mobile" boolean,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "feedback_category_check" CHECK ((("category" IS NULL) OR ("category" = ANY (ARRAY['bug'::"text", 'suggestion'::"text", 'compliment'::"text", 'question'::"text"]))))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."game_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."generated_recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dish_name" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "servings" "text",
    "prep_time" "text",
    "cook_time" "text",
    "ingredients_list" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "instructions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "chef_tip" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dish_photo_id" "uuid",
    "flavour_score" smallint,
    "flavour_review" "text",
    "user_id" "uuid" NOT NULL,
    CONSTRAINT "generated_recipes_flavour_score_check" CHECK ((("flavour_score" >= 0) AND ("flavour_score" <= 5)))
);


ALTER TABLE "public"."generated_recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingredients_archive" (
    "id" "uuid",
    "slug" "text",
    "name" "text",
    "emoji" "text",
    "sprite_url" "text",
    "cost" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "is_starter" boolean,
    "starter_order" integer,
    "description" "text"
);


ALTER TABLE "public"."ingredients_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tool_slug" "text" NOT NULL,
    "input_hash" "text" NOT NULL,
    "outcome_type" "text" DEFAULT 'no_effect'::"text" NOT NULL,
    "result_json" "jsonb" NOT NULL,
    "discovered_by" "text",
    "discovery_count" integer DEFAULT 1 NOT NULL,
    "is_curated" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "interactions_outcome_type_check" CHECK (("outcome_type" = ANY (ARRAY['no_effect'::"text", 'modify'::"text", 'transform'::"text", 'multi_output'::"text"])))
);


ALTER TABLE "public"."interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."levels" (
    "id" integer NOT NULL,
    "chapter_id" integer NOT NULL,
    "sort_order" integer NOT NULL,
    "prompt" "text" NOT NULL,
    "hint" "text",
    "difficulty" integer DEFAULT 1 NOT NULL,
    "base_coin_reward" integer DEFAULT 10 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "levels_difficulty_check" CHECK ((("difficulty" >= 1) AND ("difficulty" <= 10)))
);


ALTER TABLE "public"."levels" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."levels_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."levels_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."levels_id_seq" OWNED BY "public"."levels"."id";



CREATE TABLE IF NOT EXISTS "public"."likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dish_name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "difficulty" integer DEFAULT 1 NOT NULL,
    "base_coin_reward" integer DEFAULT 30 NOT NULL,
    "category" "text" DEFAULT 'mains'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "orders_catalog_difficulty_check" CHECK ((("difficulty" >= 1) AND ("difficulty" <= 10)))
);


ALTER TABLE "public"."orders_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "badge_id" "text" NOT NULL,
    "dish_photo_id" "uuid",
    "earned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."player_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_critic_state" (
    "user_id" "uuid" NOT NULL,
    "reputation" integer DEFAULT 0 NOT NULL,
    "last_critic_id" "uuid",
    "menu_first_added_at" timestamp with time zone,
    "pending_first_review" boolean DEFAULT false NOT NULL,
    "last_generate_call_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_critic_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_level_progress" (
    "player_id" "uuid" NOT NULL,
    "level_id" integer NOT NULL,
    "stars" integer DEFAULT 0 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "player_level_progress_stars_check" CHECK ((("stars" >= 0) AND ("stars" <= 3)))
);


ALTER TABLE "public"."player_level_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_menu_slots" (
    "user_id" "uuid" NOT NULL,
    "slot_index" smallint NOT NULL,
    "dish_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "player_menu_slots_slot_index_check" CHECK ((("slot_index" >= 0) AND ("slot_index" <= 4)))
);


ALTER TABLE "public"."player_menu_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'letter'::"text" NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "priority" smallint DEFAULT 0 NOT NULL,
    "read" boolean DEFAULT false NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "sent_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "coin_grant" integer DEFAULT 0 NOT NULL,
    "coin_claimed_at" timestamp with time zone,
    CONSTRAINT "player_messages_coin_grant_range" CHECK ((("coin_grant" >= 0) AND ("coin_grant" <= 10000)))
);


ALTER TABLE "public"."player_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT 'Anonymous Chef'::"text" NOT NULL,
    "avatar_url" "text",
    "legacy_player_id" "text",
    "coins" integer DEFAULT 0 NOT NULL,
    "unlocked_tools" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "unlocked_ingredients" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_coins_earned" integer DEFAULT 0 NOT NULL,
    "chef_level" integer DEFAULT 0 NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "film_balance" integer DEFAULT 0 NOT NULL,
    "daily_film_date" "date",
    "daily_film_used" integer DEFAULT 0 NOT NULL,
    "equipped_tools" "text"[] DEFAULT ARRAY['knife'::"text", 'hands'::"text", 'whisk'::"text", 'rolling_pin'::"text", 'stove'::"text", 'oven'::"text", 'pot'::"text", 'freezer'::"text", 'camera-polaroid'::"text"] NOT NULL
);


ALTER TABLE "public"."player_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_stats" (
    "total_coins_earned" integer DEFAULT 0 NOT NULL,
    "dishes_plated" integer DEFAULT 0 NOT NULL,
    "best_flavour_score" smallint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."player_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_streaks" (
    "user_id" "uuid" NOT NULL,
    "current_streak" integer DEFAULT 0 NOT NULL,
    "longest_streak" integer DEFAULT 0 NOT NULL,
    "last_check_in_date" "date",
    "last_grace_date" "date",
    "total_claimed_coins" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_streaks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_tiers" (
    "tier" integer NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "background_url" "text",
    "prompt_hint" "text",
    "min_chef_level" integer DEFAULT 1 NOT NULL,
    "unlock_cost" integer DEFAULT 0 NOT NULL,
    "table_count" integer DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."restaurant_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "sprite_url" "text",
    "action_verb" "text" NOT NULL,
    "mode" "text" DEFAULT 'single'::"text" NOT NULL,
    "max_inputs" integer DEFAULT 1 NOT NULL,
    "is_holdable" boolean DEFAULT true NOT NULL,
    "unlock_cost" integer DEFAULT 0 NOT NULL,
    "unlock_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sprite_icon_url" "text",
    "placed_scale" numeric DEFAULT 1.0 NOT NULL,
    "display_name" "text",
    "sprite_prompt_hint" "text",
    "image_model" "text",
    "parent_slug" "text",
    "specialty_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "description" "text",
    CONSTRAINT "tools_mode_check" CHECK (("mode" = ANY (ARRAY['single'::"text", 'combine'::"text"])))
);


ALTER TABLE "public"."tools" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tools"."sprite_icon_url" IS 'Icon sprite URL for toolbar display (smaller than full sprite)';



ALTER TABLE ONLY "public"."chapters" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."chapters_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."levels" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."levels_id_seq"'::"regclass");



ALTER TABLE ONLY "archive"."daily_image_counts"
    ADD CONSTRAINT "daily_image_counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "archive"."dish_photos"
    ADD CONSTRAINT "dish_photos_input_hash_key" UNIQUE ("input_hash");



ALTER TABLE ONLY "archive"."dish_photos"
    ADD CONSTRAINT "dish_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "archive"."plated_dishes"
    ADD CONSTRAINT "plated_dishes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "archive"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "archive"."daily_image_counts"
    ADD CONSTRAINT "unique_player_date" UNIQUE ("player_id", "date");



ALTER TABLE ONLY "public"."announcement_seen"
    ADD CONSTRAINT "announcement_seen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."badges"
    ADD CONSTRAINT "badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chapters"
    ADD CONSTRAINT "chapters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chef_levels"
    ADD CONSTRAINT "chef_levels_pkey" PRIMARY KEY ("level");



ALTER TABLE ONLY "public"."coin_packages"
    ADD CONSTRAINT "coin_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coin_packages"
    ADD CONSTRAINT "coin_packages_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."coin_packages"
    ADD CONSTRAINT "coin_packages_stripe_price_id_key" UNIQUE ("stripe_price_id");



ALTER TABLE ONLY "public"."coin_purchases"
    ADD CONSTRAINT "coin_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coin_purchases"
    ADD CONSTRAINT "coin_purchases_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."critic_reviews"
    ADD CONSTRAINT "critic_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."critics"
    ADD CONSTRAINT "critics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."daily_reward_claims"
    ADD CONSTRAINT "daily_reward_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_reward_claims"
    ADD CONSTRAINT "daily_reward_claims_user_id_claim_date_key" UNIQUE ("user_id", "claim_date");



ALTER TABLE ONLY "public"."dish_reviews"
    ADD CONSTRAINT "dish_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dishes"
    ADD CONSTRAINT "dishes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generated_recipes"
    ADD CONSTRAINT "generated_recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_input_hash_key" UNIQUE ("input_hash");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."levels"
    ADD CONSTRAINT "levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders_catalog"
    ADD CONSTRAINT "orders_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_badges"
    ADD CONSTRAINT "player_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_critic_state"
    ADD CONSTRAINT "player_critic_state_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."player_level_progress"
    ADD CONSTRAINT "player_level_progress_pkey" PRIMARY KEY ("player_id", "level_id");



ALTER TABLE ONLY "public"."player_menu_slots"
    ADD CONSTRAINT "player_menu_slots_pkey" PRIMARY KEY ("user_id", "slot_index");



ALTER TABLE ONLY "public"."player_menu_slots"
    ADD CONSTRAINT "player_menu_slots_user_id_dish_id_key" UNIQUE ("user_id", "dish_id");



ALTER TABLE ONLY "public"."player_messages"
    ADD CONSTRAINT "player_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_stats"
    ADD CONSTRAINT "player_stats_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."player_streaks"
    ADD CONSTRAINT "player_streaks_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."restaurant_tiers"
    ADD CONSTRAINT "restaurant_tiers_pkey" PRIMARY KEY ("tier");



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_slug_key" UNIQUE ("slug");



CREATE INDEX "idx_daily_image_player_date" ON "archive"."daily_image_counts" USING "btree" ("player_id", "date");



CREATE INDEX "idx_dish_photos_created_at" ON "archive"."dish_photos" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_dish_photos_input_hash" ON "archive"."dish_photos" USING "btree" ("input_hash");



CREATE INDEX "idx_dish_photos_player_id" ON "archive"."dish_photos" USING "btree" ("player_id");



CREATE INDEX "idx_recipes_cost_null" ON "archive"."recipes" USING "btree" ("id") WHERE ("cost" IS NULL);



CREATE INDEX "customers_active_tier_idx" ON "public"."customers" USING "btree" ("is_active", "min_tier");



CREATE INDEX "customers_sort_idx" ON "public"."customers" USING "btree" ("sort_order");



CREATE INDEX "idx_announcement_seen_user_id" ON "public"."announcement_seen" USING "btree" ("user_id");



CREATE INDEX "idx_announcements_active" ON "public"."announcements" USING "btree" ("active") WHERE ("active" = true);



CREATE INDEX "idx_announcements_created_at" ON "public"."announcements" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "idx_chapters_sort_order" ON "public"."chapters" USING "btree" ("sort_order");



CREATE INDEX "idx_coin_purchases_created_at" ON "public"."coin_purchases" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_coin_purchases_user_id" ON "public"."coin_purchases" USING "btree" ("user_id");



CREATE INDEX "idx_critic_reviews_user_created" ON "public"."critic_reviews" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_critic_reviews_user_critic" ON "public"."critic_reviews" USING "btree" ("user_id", "critic_id");



CREATE INDEX "idx_critic_reviews_user_unread" ON "public"."critic_reviews" USING "btree" ("user_id") WHERE ("read_at" IS NULL);



CREATE INDEX "idx_critics_active_sort" ON "public"."critics" USING "btree" ("active", "sort_order");



CREATE INDEX "idx_daily_reward_claims_user_date" ON "public"."daily_reward_claims" USING "btree" ("user_id", "claim_date" DESC);



CREATE INDEX "idx_dish_reviews_dish" ON "public"."dish_reviews" USING "btree" ("dish_id");



CREATE INDEX "idx_dishes_created_at" ON "public"."dishes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_dishes_input_hash" ON "public"."dishes" USING "btree" ("input_hash");



CREATE INDEX "idx_dishes_photo_created_at" ON "public"."dishes" USING "btree" ("created_at" DESC) WHERE ("photo_url" IS NOT NULL);



CREATE INDEX "idx_dishes_served_at" ON "public"."dishes" USING "btree" ("served_at" DESC);



CREATE INDEX "idx_dishes_user_id" ON "public"."dishes" USING "btree" ("user_id");



CREATE INDEX "idx_dishes_user_photographed" ON "public"."dishes" USING "btree" ("user_id", "photographed_at" DESC) WHERE ("photo_url" IS NOT NULL);



CREATE INDEX "idx_feedback_created_at" ON "public"."feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_feedback_user_id" ON "public"."feedback" USING "btree" ("user_id");



CREATE INDEX "idx_game_events_created" ON "public"."game_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_game_events_type" ON "public"."game_events" USING "btree" ("event_type");



CREATE INDEX "idx_game_events_user_id" ON "public"."game_events" USING "btree" ("user_id");



CREATE INDEX "idx_generated_recipes_dish_photo_id" ON "public"."generated_recipes" USING "btree" ("dish_photo_id");



CREATE INDEX "idx_generated_recipes_user_id" ON "public"."generated_recipes" USING "btree" ("user_id");



CREATE INDEX "idx_ingredients_created_at" ON "public"."ingredients" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ingredients_missing_sprite" ON "public"."ingredients" USING "btree" ("id") WHERE ("sprite_url" IS NULL);



CREATE INDEX "idx_ingredients_slug" ON "public"."ingredients" USING "btree" ("slug");



CREATE INDEX "idx_ingredients_sprite" ON "public"."ingredients" USING "btree" ("id") WHERE ("sprite_url" IS NOT NULL);



CREATE INDEX "idx_ingredients_starter" ON "public"."ingredients" USING "btree" ("is_starter", "starter_order") WHERE ("is_starter" = true);



CREATE INDEX "idx_ingredients_tags" ON "public"."ingredients" USING "gin" ("tags");



CREATE INDEX "idx_interactions_created_at" ON "public"."interactions" USING "btree" ("created_at");



CREATE INDEX "idx_interactions_v2_curated" ON "public"."interactions" USING "btree" ("is_curated") WHERE ("is_curated" = true);



CREATE INDEX "idx_interactions_v2_tool" ON "public"."interactions" USING "btree" ("tool_slug");



CREATE INDEX "idx_levels_chapter_id" ON "public"."levels" USING "btree" ("chapter_id");



CREATE UNIQUE INDEX "idx_levels_chapter_sort" ON "public"."levels" USING "btree" ("chapter_id", "sort_order");



CREATE INDEX "idx_likes_target" ON "public"."likes" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_likes_user_id" ON "public"."likes" USING "btree" ("user_id");



CREATE INDEX "idx_player_badges_badge" ON "public"."player_badges" USING "btree" ("badge_id");



CREATE INDEX "idx_player_badges_user_id" ON "public"."player_badges" USING "btree" ("user_id");



CREATE INDEX "idx_player_critic_state_reputation" ON "public"."player_critic_state" USING "btree" ("reputation" DESC) WHERE ("reputation" > 0);



CREATE INDEX "idx_player_level_progress_player" ON "public"."player_level_progress" USING "btree" ("player_id");



CREATE INDEX "idx_player_menu_slots_dish_id" ON "public"."player_menu_slots" USING "btree" ("dish_id");



CREATE INDEX "idx_player_menu_slots_user_id" ON "public"."player_menu_slots" USING "btree" ("user_id");



CREATE INDEX "idx_player_messages_unread" ON "public"."player_messages" USING "btree" ("user_id", "read") WHERE (NOT "archived");



CREATE INDEX "idx_player_messages_user_id" ON "public"."player_messages" USING "btree" ("user_id");



CREATE INDEX "idx_player_profiles_legacy_id" ON "public"."player_profiles" USING "btree" ("legacy_player_id") WHERE ("legacy_player_id" IS NOT NULL);



CREATE INDEX "idx_player_stats_coins" ON "public"."player_stats" USING "btree" ("total_coins_earned" DESC);



CREATE INDEX "idx_player_stats_dishes" ON "public"."player_stats" USING "btree" ("dishes_plated" DESC);



CREATE INDEX "idx_tools_parent_slug" ON "public"."tools" USING "btree" ("parent_slug");



CREATE INDEX "idx_tools_slug" ON "public"."tools" USING "btree" ("slug");



CREATE INDEX "idx_tools_unlock_order" ON "public"."tools" USING "btree" ("unlock_order");



CREATE OR REPLACE TRIGGER "ingredients_updated_at" BEFORE UPDATE ON "public"."ingredients" FOR EACH ROW EXECUTE FUNCTION "public"."update_ingredients_updated_at"();



CREATE OR REPLACE TRIGGER "interactions_v2_updated_at" BEFORE UPDATE ON "public"."interactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_ingredients_updated_at"();



CREATE OR REPLACE TRIGGER "player_critic_state_updated_at" BEFORE UPDATE ON "public"."player_critic_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_profile_timestamp"();



CREATE OR REPLACE TRIGGER "player_level_progress_updated_at" BEFORE UPDATE ON "public"."player_level_progress" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_level_progress_timestamp"();



CREATE OR REPLACE TRIGGER "player_profiles_updated_at" BEFORE UPDATE ON "public"."player_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_profile_timestamp"();



CREATE OR REPLACE TRIGGER "tools_updated_at" BEFORE UPDATE ON "public"."tools" FOR EACH ROW EXECUTE FUNCTION "public"."update_tools_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_chef_level" AFTER INSERT ON "public"."player_badges" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_chef_level"();



CREATE OR REPLACE TRIGGER "update_player_chef_level_trigger" AFTER INSERT ON "public"."player_badges" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_chef_level_function"();



ALTER TABLE ONLY "public"."announcement_seen"
    ADD CONSTRAINT "announcement_seen_announcement_slug_fkey" FOREIGN KEY ("announcement_slug") REFERENCES "public"."announcements"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcement_seen"
    ADD CONSTRAINT "announcement_seen_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."badges"
    ADD CONSTRAINT "badges_level_fkey" FOREIGN KEY ("level") REFERENCES "public"."chef_levels"("level");



ALTER TABLE ONLY "public"."coin_purchases"
    ADD CONSTRAINT "coin_purchases_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."coin_packages"("id");



ALTER TABLE ONLY "public"."coin_purchases"
    ADD CONSTRAINT "coin_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."critic_reviews"
    ADD CONSTRAINT "critic_reviews_critic_id_fkey" FOREIGN KEY ("critic_id") REFERENCES "public"."critics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."critic_reviews"
    ADD CONSTRAINT "critic_reviews_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."critic_reviews"
    ADD CONSTRAINT "critic_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_reward_claims"
    ADD CONSTRAINT "daily_reward_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dish_reviews"
    ADD CONSTRAINT "dish_reviews_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "archive"."plated_dishes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dishes"
    ADD CONSTRAINT "dishes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dishes"
    ADD CONSTRAINT "dishes_user_profiles_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."player_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generated_recipes"
    ADD CONSTRAINT "generated_recipes_dish_id_fkey" FOREIGN KEY ("dish_photo_id") REFERENCES "public"."dishes"("id");



ALTER TABLE ONLY "public"."generated_recipes"
    ADD CONSTRAINT "generated_recipes_player_profiles_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."player_profiles"("id");



ALTER TABLE ONLY "public"."generated_recipes"
    ADD CONSTRAINT "generated_recipes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."levels"
    ADD CONSTRAINT "levels_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_badges"
    ADD CONSTRAINT "player_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id");



ALTER TABLE ONLY "public"."player_badges"
    ADD CONSTRAINT "player_badges_dish_id_fkey" FOREIGN KEY ("dish_photo_id") REFERENCES "public"."dishes"("id");



ALTER TABLE ONLY "public"."player_badges"
    ADD CONSTRAINT "player_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_critic_state"
    ADD CONSTRAINT "player_critic_state_last_critic_id_fkey" FOREIGN KEY ("last_critic_id") REFERENCES "public"."critics"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."player_critic_state"
    ADD CONSTRAINT "player_critic_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_level_progress"
    ADD CONSTRAINT "player_level_progress_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id");



ALTER TABLE ONLY "public"."player_level_progress"
    ADD CONSTRAINT "player_level_progress_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_menu_slots"
    ADD CONSTRAINT "player_menu_slots_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_menu_slots"
    ADD CONSTRAINT "player_menu_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_messages"
    ADD CONSTRAINT "player_messages_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."player_messages"
    ADD CONSTRAINT "player_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_stats"
    ADD CONSTRAINT "player_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_streaks"
    ADD CONSTRAINT "player_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_parent_slug_fkey" FOREIGN KEY ("parent_slug") REFERENCES "public"."tools"("slug");



CREATE POLICY "Allow public read access" ON "archive"."dish_photos" FOR SELECT USING (true);



CREATE POLICY "Service role can manage image counts" ON "archive"."daily_image_counts" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "archive"."daily_image_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "archive"."dish_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Admins can read game events" ON "public"."game_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins manage customers" ON "public"."customers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins manage restaurant_tiers" ON "public"."restaurant_tiers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins read all claims" ON "public"."daily_reward_claims" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins read all critic state" ON "public"."player_critic_state" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins read all menu slots" ON "public"."player_menu_slots" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins read all messages" ON "public"."player_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins read all reviews" ON "public"."critic_reviews" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins read all streaks" ON "public"."player_streaks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Admins write critics" ON "public"."critics" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."player_profiles"
  WHERE (("player_profiles"."id" = "auth"."uid"()) AND ("player_profiles"."is_admin" = true)))));



CREATE POLICY "Allow select access" ON "public"."feedback" FOR SELECT USING (true);



CREATE POLICY "Allow service role insert" ON "public"."feedback" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can delete their own likes" ON "public"."likes" FOR DELETE USING (true);



CREATE POLICY "Anyone can insert likes" ON "public"."likes" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can mark seen" ON "public"."announcement_seen" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read coin packages" ON "public"."coin_packages" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can read profiles for leaderboard" ON "public"."player_profiles" FOR SELECT USING (true);



CREATE POLICY "Anyone can read recipes" ON "public"."generated_recipes" FOR SELECT USING (true);



CREATE POLICY "Dish reviews are viewable by everyone" ON "public"."dish_reviews" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Ingredients are viewable by everyone" ON "public"."ingredients" FOR SELECT USING (true);



CREATE POLICY "Interactions are viewable by everyone" ON "public"."interactions" FOR SELECT USING (true);



CREATE POLICY "Players insert own progress" ON "public"."player_level_progress" FOR INSERT WITH CHECK (("auth"."uid"() = "player_id"));



CREATE POLICY "Players read own critic state" ON "public"."player_critic_state" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Players read own menu slots" ON "public"."player_menu_slots" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Players read own messages" ON "public"."player_messages" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Players read own progress" ON "public"."player_level_progress" FOR SELECT USING (("auth"."uid"() = "player_id"));



CREATE POLICY "Players read own reviews" ON "public"."critic_reviews" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Players read own reward claims" ON "public"."daily_reward_claims" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Players read own streak" ON "public"."player_streaks" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Players update own progress" ON "public"."player_level_progress" FOR UPDATE USING (("auth"."uid"() = "player_id"));



CREATE POLICY "Public read" ON "public"."player_stats" FOR SELECT USING (true);



CREATE POLICY "Public read access" ON "public"."dishes" FOR SELECT USING (true);



CREATE POLICY "Public read announcement_seen" ON "public"."announcement_seen" FOR SELECT USING (true);



CREATE POLICY "Public read announcements" ON "public"."announcements" FOR SELECT USING (true);



CREATE POLICY "Public read badges" ON "public"."badges" FOR SELECT USING (true);



CREATE POLICY "Public read chapters" ON "public"."chapters" FOR SELECT USING (true);



CREATE POLICY "Public read chef_levels" ON "public"."chef_levels" FOR SELECT USING (true);



CREATE POLICY "Public read critics" ON "public"."critics" FOR SELECT USING (true);



CREATE POLICY "Public read customers" ON "public"."customers" FOR SELECT USING (true);



CREATE POLICY "Public read levels" ON "public"."levels" FOR SELECT USING (true);



CREATE POLICY "Public read likes" ON "public"."likes" FOR SELECT USING (true);



CREATE POLICY "Public read orders_catalog" ON "public"."orders_catalog" FOR SELECT USING (true);



CREATE POLICY "Public read player_badges" ON "public"."player_badges" FOR SELECT USING (true);



CREATE POLICY "Public read progress for leaderboard" ON "public"."player_level_progress" FOR SELECT USING (true);



CREATE POLICY "Public read restaurant_tiers" ON "public"."restaurant_tiers" FOR SELECT USING (true);



CREATE POLICY "Service role all" ON "public"."player_stats" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can delete interactions" ON "public"."interactions" FOR DELETE TO "service_role" USING (true);



CREATE POLICY "Service role can insert events" ON "public"."game_events" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert interactions" ON "public"."interactions" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert recipes" ON "public"."generated_recipes" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can manage dish reviews" ON "public"."dish_reviews" TO "service_role" USING (true);



CREATE POLICY "Service role can manage ingredients" ON "public"."ingredients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can read events" ON "public"."game_events" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Service role can update interactions" ON "public"."interactions" FOR UPDATE TO "service_role" USING (true);



CREATE POLICY "Service role delete announcements" ON "public"."announcements" FOR DELETE USING (true);



CREATE POLICY "Service role full access" ON "public"."player_messages" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role full access claims" ON "public"."daily_reward_claims" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role full access critic state" ON "public"."player_critic_state" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role full access menu slots" ON "public"."player_menu_slots" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role full access reviews" ON "public"."critic_reviews" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role full access streaks" ON "public"."player_streaks" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role insert" ON "public"."dishes" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role insert announcements" ON "public"."announcements" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role manage badges" ON "public"."badges" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage chapters" ON "public"."chapters" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage chef_levels" ON "public"."chef_levels" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage customers" ON "public"."customers" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage levels" ON "public"."levels" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage orders_catalog" ON "public"."orders_catalog" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage player_badges" ON "public"."player_badges" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role manage restaurant_tiers" ON "public"."restaurant_tiers" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role update" ON "public"."dishes" FOR UPDATE USING (true);



CREATE POLICY "Service role update announcements" ON "public"."announcements" FOR UPDATE USING (true);



CREATE POLICY "Service role write critics" ON "public"."critics" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Tools are viewable by everyone" ON "public"."tools" FOR SELECT USING (true);



CREATE POLICY "Users insert own dishes" ON "public"."dishes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own generated_recipes" ON "public"."generated_recipes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own player_badges" ON "public"."player_badges" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own profile" ON "public"."player_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users manage own likes" ON "public"."likes" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own dishes" ON "public"."dishes" FOR SELECT USING (true);



CREATE POLICY "Users read own generated_recipes" ON "public"."generated_recipes" FOR SELECT USING (true);



CREATE POLICY "Users read own player_badges" ON "public"."player_badges" FOR SELECT USING (true);



CREATE POLICY "Users read own purchases" ON "public"."coin_purchases" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own profile" ON "public"."player_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."announcement_seen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chapters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chef_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coin_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coin_purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."critic_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."critics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_reward_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dish_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dishes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generated_recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingredients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_critic_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_level_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_menu_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_streaks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tools" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."add_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint, "p_dish_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint, "p_dish_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_daily_reward"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_daily_reward"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_daily_reward"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_message_coins"("p_message_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_message_coins"("p_message_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_message_coins"("p_message_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_image_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_image_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_image_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_film"("p_user_id" "uuid", "p_daily_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."consume_film"("p_user_id" "uuid", "p_daily_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_film"("p_user_id" "uuid", "p_daily_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."credit_coins_for_purchase"("p_user_id" "uuid", "p_package_id" "uuid", "p_stripe_session_id" "text", "p_stripe_event_id" "text", "p_coins" integer, "p_amount_cents" integer, "p_currency" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."credit_coins_for_purchase"("p_user_id" "uuid", "p_package_id" "uuid", "p_stripe_session_id" "text", "p_stripe_event_id" "text", "p_coins" integer, "p_amount_cents" integer, "p_currency" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."credit_coins_for_purchase"("p_user_id" "uuid", "p_package_id" "uuid", "p_stripe_session_id" "text", "p_stripe_event_id" "text", "p_coins" integer, "p_amount_cents" integer, "p_currency" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."daily_reward_for_streak_day"("p_day" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."daily_reward_for_streak_day"("p_day" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."daily_reward_for_streak_day"("p_day" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_critic_review_summary"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_critic_review_summary"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_active_users"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_active_users"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_active_users"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_game_stats"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_game_stats"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_game_stats"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_discovery_leaderboard"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_discovery_leaderboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_discovery_leaderboard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_event_breakdown"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_event_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_event_breakdown"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_film_count"("p_user_id" "uuid", "p_daily_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_film_count"("p_user_id" "uuid", "p_daily_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_film_count"("p_user_id" "uuid", "p_daily_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_image_count"("p_player_id" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_image_count"("p_player_id" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_image_count"("p_player_id" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_level_leaderboard"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_level_leaderboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_level_leaderboard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_restaurant_rank"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_restaurant_rank"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_restaurant_rank"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_player_activity_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_player_activity_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_player_activity_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rank_context"("p_user_id" "uuid", "p_neighbor_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rank_context"("p_user_id" "uuid", "p_neighbor_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rank_context"("p_user_id" "uuid", "p_neighbor_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_retention_cohorts"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_retention_cohorts"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_retention_cohorts"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_session_depth"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_session_depth"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_session_depth"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_streak"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_streak"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_streak"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tool_usage_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_tool_usage_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tool_usage_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_players"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_players"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_players"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_restaurants"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_restaurants"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_restaurants"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_traffic_sources"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_traffic_sources"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_traffic_sources"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_photographed_chefs"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_photographed_chefs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_photographed_chefs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_ingredient_discovery"("ingredient_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_ingredient_discovery"("ingredient_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_ingredient_discovery"("ingredient_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_interaction_discovery"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_interaction_discovery"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_interaction_discovery"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_player_coins"("p_user_id" "uuid", "p_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_player_coins"("p_user_id" "uuid", "p_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_player_coins"("p_user_id" "uuid", "p_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_critic_review"("p_user_id" "uuid", "p_critic_id" "uuid", "p_dish_id" "uuid", "p_stars" numeric, "p_review_text" "text", "p_rep_awarded" integer, "p_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_critic_review"("p_user_id" "uuid", "p_critic_id" "uuid", "p_dish_id" "uuid", "p_stars" numeric, "p_review_text" "text", "p_rep_awarded" integer, "p_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_reviews_read"("p_user_id" "uuid", "p_review_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_reviews_read"("p_user_id" "uuid", "p_review_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."pick_critic_review_targets"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pick_critic_review_targets"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purchase_film_pack"("p_user_id" "uuid", "p_pack_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purchase_film_pack"("p_user_id" "uuid", "p_pack_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_film_pack"("p_user_id" "uuid", "p_pack_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_film_pack"("p_user_id" "uuid", "p_pack_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_player_reputation"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_player_reputation"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_player_reputation"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_menu_slot"("p_user_id" "uuid", "p_slot_index" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_ingredients_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_ingredients_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ingredients_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_player_chef_level"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_chef_level"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_chef_level"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_player_chef_level_function"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_chef_level_function"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_chef_level_function"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_player_level_progress_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_level_progress_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_level_progress_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_player_profile_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_profile_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_profile_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_tools_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_tools_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_tools_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."ingredients" TO "anon";
GRANT ALL ON TABLE "public"."ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."ingredients" TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text", "p_tags" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text", "p_tags" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_and_increment_ingredient"("p_slug" "text", "p_name" "text", "p_emoji" "text", "p_cost" integer, "p_description" "text", "p_tags" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_player_stats"("p_user_id" "uuid", "p_action" "text", "p_amount" integer, "p_delta_level" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_player_stats"("p_user_id" "uuid", "p_action" "text", "p_amount" integer, "p_delta_level" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_player_stats"("p_user_id" "uuid", "p_action" "text", "p_amount" integer, "p_delta_level" smallint) TO "service_role";












GRANT ALL ON TABLE "archive"."daily_image_counts" TO "anon";
GRANT ALL ON TABLE "archive"."daily_image_counts" TO "authenticated";
GRANT ALL ON TABLE "archive"."daily_image_counts" TO "service_role";



GRANT ALL ON TABLE "archive"."dish_photos" TO "anon";
GRANT ALL ON TABLE "archive"."dish_photos" TO "authenticated";
GRANT ALL ON TABLE "archive"."dish_photos" TO "service_role";



GRANT ALL ON TABLE "archive"."plated_dishes" TO "anon";
GRANT ALL ON TABLE "archive"."plated_dishes" TO "authenticated";
GRANT ALL ON TABLE "archive"."plated_dishes" TO "service_role";



GRANT ALL ON TABLE "archive"."recipes" TO "anon";
GRANT ALL ON TABLE "archive"."recipes" TO "authenticated";
GRANT ALL ON TABLE "archive"."recipes" TO "service_role";









GRANT ALL ON TABLE "public"."announcement_seen" TO "anon";
GRANT ALL ON TABLE "public"."announcement_seen" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement_seen" TO "service_role";



GRANT ALL ON TABLE "public"."announcements" TO "anon";
GRANT ALL ON TABLE "public"."announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."announcements" TO "service_role";



GRANT ALL ON TABLE "public"."badges" TO "anon";
GRANT ALL ON TABLE "public"."badges" TO "authenticated";
GRANT ALL ON TABLE "public"."badges" TO "service_role";



GRANT ALL ON TABLE "public"."chapters" TO "anon";
GRANT ALL ON TABLE "public"."chapters" TO "authenticated";
GRANT ALL ON TABLE "public"."chapters" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chapters_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chapters_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chapters_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chef_levels" TO "anon";
GRANT ALL ON TABLE "public"."chef_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."chef_levels" TO "service_role";



GRANT ALL ON TABLE "public"."coin_packages" TO "anon";
GRANT ALL ON TABLE "public"."coin_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."coin_packages" TO "service_role";



GRANT ALL ON TABLE "public"."coin_purchases" TO "anon";
GRANT ALL ON TABLE "public"."coin_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."coin_purchases" TO "service_role";



GRANT ALL ON TABLE "public"."critic_reviews" TO "anon";
GRANT ALL ON TABLE "public"."critic_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."critic_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."critics" TO "anon";
GRANT ALL ON TABLE "public"."critics" TO "authenticated";
GRANT ALL ON TABLE "public"."critics" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."daily_reward_claims" TO "anon";
GRANT ALL ON TABLE "public"."daily_reward_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_reward_claims" TO "service_role";



GRANT ALL ON TABLE "public"."dish_photos_archive" TO "anon";
GRANT ALL ON TABLE "public"."dish_photos_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."dish_photos_archive" TO "service_role";



GRANT ALL ON TABLE "public"."dish_reviews" TO "anon";
GRANT ALL ON TABLE "public"."dish_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."dish_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."dishes" TO "anon";
GRANT ALL ON TABLE "public"."dishes" TO "authenticated";
GRANT ALL ON TABLE "public"."dishes" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."game_events" TO "anon";
GRANT ALL ON TABLE "public"."game_events" TO "authenticated";
GRANT ALL ON TABLE "public"."game_events" TO "service_role";



GRANT ALL ON TABLE "public"."generated_recipes" TO "anon";
GRANT ALL ON TABLE "public"."generated_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."generated_recipes" TO "service_role";



GRANT ALL ON TABLE "public"."ingredients_archive" TO "anon";
GRANT ALL ON TABLE "public"."ingredients_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."ingredients_archive" TO "service_role";



GRANT ALL ON TABLE "public"."interactions" TO "anon";
GRANT ALL ON TABLE "public"."interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."interactions" TO "service_role";



GRANT ALL ON TABLE "public"."levels" TO "anon";
GRANT ALL ON TABLE "public"."levels" TO "authenticated";
GRANT ALL ON TABLE "public"."levels" TO "service_role";



GRANT ALL ON SEQUENCE "public"."levels_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."levels_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."levels_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."likes" TO "anon";
GRANT ALL ON TABLE "public"."likes" TO "authenticated";
GRANT ALL ON TABLE "public"."likes" TO "service_role";



GRANT ALL ON TABLE "public"."orders_catalog" TO "anon";
GRANT ALL ON TABLE "public"."orders_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."orders_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."player_badges" TO "anon";
GRANT ALL ON TABLE "public"."player_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."player_badges" TO "service_role";



GRANT ALL ON TABLE "public"."player_critic_state" TO "anon";
GRANT ALL ON TABLE "public"."player_critic_state" TO "authenticated";
GRANT ALL ON TABLE "public"."player_critic_state" TO "service_role";



GRANT ALL ON TABLE "public"."player_level_progress" TO "anon";
GRANT ALL ON TABLE "public"."player_level_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."player_level_progress" TO "service_role";



GRANT ALL ON TABLE "public"."player_menu_slots" TO "anon";
GRANT ALL ON TABLE "public"."player_menu_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."player_menu_slots" TO "service_role";



GRANT ALL ON TABLE "public"."player_messages" TO "anon";
GRANT ALL ON TABLE "public"."player_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."player_messages" TO "service_role";



GRANT ALL ON TABLE "public"."player_profiles" TO "anon";
GRANT ALL ON TABLE "public"."player_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."player_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."player_stats" TO "anon";
GRANT ALL ON TABLE "public"."player_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."player_stats" TO "service_role";



GRANT ALL ON TABLE "public"."player_streaks" TO "anon";
GRANT ALL ON TABLE "public"."player_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."player_streaks" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_tiers" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."tools" TO "anon";
GRANT ALL ON TABLE "public"."tools" TO "authenticated";
GRANT ALL ON TABLE "public"."tools" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































