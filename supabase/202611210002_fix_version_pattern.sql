-- Fix: game versions carry a leading "v" (e.g. v1.18.1_abcdef01).
-- The original pattern rejected them, blocking every real submission.
-- Re-run this file (or just this statement) in SQL Editor after 202611210001.

create or replace function public.submit_daily_score(
  p_name text, p_day date, p_score integer, p_waves integer, p_victory boolean,
  p_leader text, p_encore integer, p_seconds integer,
  p_most_played text, p_most_played_count integer, p_version text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  prior_time timestamptz;
  prior kda_private.daily_scores%rowtype;
  improved boolean;
begin
  if caller is null or auth.role() is distinct from 'authenticated' then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if p_name is null or char_length(p_name) not between 3 and 16
    or p_name <> btrim(p_name) or p_name ~ '[^[:alnum:] _-]' then
    return jsonb_build_object('error', 'invalid_name');
  end if;
  if p_day is null or p_day < current_date - 1 or p_day > current_date + 1
    or p_score is null or p_score < 0 or p_score > 9999
    or p_waves is null or p_waves < 0 or p_waves > 10
    or p_victory is null
    or p_leader is null or p_leader not in ('ahri', 'akali', 'evelynn', 'kaisa')
    or p_encore is null or p_encore < 0 or p_encore > 5
    or p_seconds is null or p_seconds < 1 or p_seconds > 86400
    or p_most_played is null or char_length(p_most_played) < 1 or char_length(p_most_played) > 64
    or p_most_played_count is null or p_most_played_count < 0
    or p_version is null or p_version !~ '^v?[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(_[a-f0-9]{8})?$' then
    return jsonb_build_object('error', 'invalid_score');
  end if;

  -- The lock covers first submissions, when there is no row to lock yet.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select last_submit into prior_time from kda_private.kda_submissions where user_id = caller;
  if prior_time is not null and clock_timestamp() - prior_time < interval '60 seconds' then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  insert into kda_private.kda_submissions(user_id, last_submit)
    values (caller, clock_timestamp())
    on conflict (user_id) do update set last_submit = excluded.last_submit;

  select * into prior from kda_private.daily_scores where user_id = caller and day = p_day;
  improved := prior.user_id is null or p_score > prior.score
    or p_score = prior.score and p_seconds < prior.seconds;
  if improved then
    insert into kda_private.daily_scores(user_id, day, display_name, score, waves, victory, leader, encore, seconds, most_played, most_played_count, version)
      values (caller, p_day, p_name, p_score, p_waves, p_victory, p_leader, p_encore, p_seconds, p_most_played, p_most_played_count, p_version)
      on conflict (user_id, day) do update set display_name = excluded.display_name,
        score = excluded.score, waves = excluded.waves, victory = excluded.victory,
        leader = excluded.leader, encore = excluded.encore, seconds = excluded.seconds,
        most_played = excluded.most_played, most_played_count = excluded.most_played_count,
        version = excluded.version, submitted_at = clock_timestamp();
  else
    update kda_private.daily_scores set display_name = p_name where user_id = caller and day = p_day;
  end if;
  return jsonb_build_object('ok', true, 'improved', improved);
end;
$$;
