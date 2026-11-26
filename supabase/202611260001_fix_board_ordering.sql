begin;

-- Scoring rebalance (#53): W0 defeat = 0, waves-dominant formula
-- (waves*1000 + victory 2000 + peak<=300 + speed<=300, max ~12600).
-- Raise the score cap 9999 -> 99999 and rank the daily board waves-first
-- so old-version (~1800s) and new-version (~12000s) scores mix fairly.
alter table kda_private.daily_scores drop constraint if exists daily_scores_score_check;
alter table kda_private.daily_scores
  add constraint daily_scores_score_check check (score between 0 and 99999);

create or replace function public.list_daily_board(p_day date)
returns table (rank bigint, display_name text, score integer, waves integer, victory boolean, leader text, encore integer, seconds integer, most_played text, most_played_count integer, submitted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select row_number() over (order by s.waves desc, s.victory desc, s.score desc, s.seconds asc, s.submitted_at asc, s.user_id),
    s.display_name, s.score, s.waves, s.victory, s.leader, s.encore, s.seconds, s.most_played, s.most_played_count, s.submitted_at
  from kda_private.daily_scores s
  where s.day = p_day
  order by s.waves desc, s.victory desc, s.score desc, s.seconds asc, s.submitted_at asc, s.user_id
  limit 100;
$$;
revoke all on function public.list_daily_board(date) from public, anon, authenticated;
grant execute on function public.list_daily_board(date) to anon, authenticated;

create index if not exists kda_daily_scores_day_waves on kda_private.daily_scores (day, waves desc, victory desc, score desc, seconds asc);

-- Same cap raise in the submit validator; waves-first personal-best logic unchanged.
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
    or p_score is null or p_score < 0 or p_score > 99999
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

  -- Serialize per-user calls before checking time or updating the personal best.
  -- The lock also covers first submissions, when there is no row to lock yet.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select last_submit into prior_time from kda_private.kda_submissions where user_id = caller;
  if prior_time is not null and clock_timestamp() - prior_time < interval '60 seconds' then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  insert into kda_private.kda_submissions(user_id, last_submit)
    values (caller, clock_timestamp())
    on conflict (user_id) do update set last_submit = excluded.last_submit;

  select * into prior from kda_private.daily_scores where user_id = caller and day = p_day;
  -- Waves cleared dominate: a shorter run can never overwrite a longer one.
  -- Victory breaks wave ties, then score, then speed.
  improved := prior.user_id is null
    or p_waves > prior.waves
    or (p_waves = prior.waves and (
      (p_victory and not prior.victory)
      or (p_victory = prior.victory and (
        p_score > prior.score
        or (p_score = prior.score and p_seconds < prior.seconds)))));
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
revoke all on function public.submit_daily_score(text,date,integer,integer,boolean,text,integer,integer,text,integer,text) from public, anon, authenticated;
grant execute on function public.submit_daily_score(text,date,integer,integer,boolean,text,integer,integer,text,integer,text) to authenticated;

commit;
