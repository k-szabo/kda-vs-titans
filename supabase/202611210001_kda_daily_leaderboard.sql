begin;

create schema if not exists kda_private;
revoke all on schema kda_private from public, anon, authenticated;

create table if not exists kda_private.daily_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  display_name text not null check (char_length(display_name) between 3 and 16 and display_name = btrim(display_name) and display_name !~ '[^[:alnum:] _-]'),
  score integer not null check (score between 0 and 9999),
  waves integer not null check (waves between 0 and 10),
  victory boolean not null,
  leader text not null check (leader in ('ahri', 'akali', 'evelynn', 'kaisa')),
  encore integer not null check (encore between 0 and 5),
  seconds integer not null check (seconds between 1 and 86400),
  most_played text not null check (char_length(most_played) between 1 and 64),
  most_played_count integer not null check (most_played_count >= 0),
  version text not null check (version ~ '^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(_[a-f0-9]{8})?$'),
  submitted_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists kda_daily_scores_day on kda_private.daily_scores (day, score desc, seconds asc, submitted_at asc, user_id);

create table if not exists kda_private.kda_submissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_submit timestamptz not null
);
alter table kda_private.daily_scores enable row level security;
alter table kda_private.kda_submissions enable row level security;
revoke all on all tables in schema kda_private from public, anon, authenticated;

-- No user IDs or authentication records are returned to public callers.
create or replace function public.list_daily_board(p_day date)
returns table (rank bigint, display_name text, score integer, waves integer, victory boolean, leader text, encore integer, seconds integer, most_played text, most_played_count integer, submitted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select row_number() over (order by s.score desc, s.seconds asc, s.submitted_at asc, s.user_id),
    s.display_name, s.score, s.waves, s.victory, s.leader, s.encore, s.seconds, s.most_played, s.most_played_count, s.submitted_at
  from kda_private.daily_scores s
  where s.day = p_day
  order by s.score desc, s.seconds asc, s.submitted_at asc, s.user_id
  limit 100;
$$;
revoke all on function public.list_daily_board(date) from public, anon, authenticated;
grant execute on function public.list_daily_board(date) to anon, authenticated;

create or replace function public.list_period_board(p_start date, p_end date)
returns table (rank bigint, display_name text, total bigint, games integer, wins integer)
language sql stable security definer set search_path = ''
as $$
  select row_number() over (order by sum(s.score) desc, count(*) filter (where s.victory) desc, min(s.submitted_at), max(s.user_id::text)),
    (select t.display_name from kda_private.daily_scores t where t.user_id = s.user_id and t.day between p_start and p_end order by t.submitted_at desc limit 1),
    sum(s.score), count(*), count(*) filter (where s.victory)
  from kda_private.daily_scores s
  where s.day between p_start and p_end
  group by s.user_id
  order by sum(s.score) desc, count(*) filter (where s.victory) desc, min(s.submitted_at), max(s.user_id::text)
  limit 100;
$$;
revoke all on function public.list_period_board(date, date) from public, anon, authenticated;
grant execute on function public.list_period_board(date, date) to anon, authenticated;

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
    or p_version is null or p_version !~ '^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(_[a-f0-9]{8})?$' then
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
revoke all on function public.submit_daily_score(text,date,integer,integer,boolean,text,integer,integer,text,integer,text) from public, anon, authenticated;
grant execute on function public.submit_daily_score(text,date,integer,integer,boolean,text,integer,integer,text,integer,text) to authenticated;

commit;
