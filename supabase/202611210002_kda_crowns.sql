-- Crown check for board champions. Returns whether the caller won the last
-- *completed* week/month (mid-period rank 1 grants nothing). Re-run safe.
create or replace function public.check_crowns()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  last_week_start date := date_trunc('week', current_date)::date - 7;
  last_week_end date := date_trunc('week', current_date)::date - 1;
  last_month_start date := (date_trunc('month', current_date) - interval '1 month')::date;
  last_month_end date := (date_trunc('month', current_date) - interval '1 day')::date;
  weekly_winner uuid;
  monthly_winner uuid;
begin
  if caller is null or auth.role() is distinct from 'authenticated' then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select s.user_id into weekly_winner
  from kda_private.daily_scores s
  where s.day between last_week_start and last_week_end
  group by s.user_id
  order by sum(s.score) desc, count(*) filter (where s.victory) desc, min(s.submitted_at), max(s.user_id::text)
  limit 1;

  select s.user_id into monthly_winner
  from kda_private.daily_scores s
  where s.day between last_month_start and last_month_end
  group by s.user_id
  order by sum(s.score) desc, count(*) filter (where s.victory) desc, min(s.submitted_at), max(s.user_id::text)
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'weekly', case when weekly_winner is null then null else jsonb_build_object('start', last_week_start, 'won', weekly_winner = caller) end,
    'monthly', case when monthly_winner is null then null else jsonb_build_object('start', last_month_start, 'won', monthly_winner = caller) end
  );
end;
$$;
revoke all on function public.check_crowns() from public, anon, authenticated;
grant execute on function public.check_crowns() to authenticated;
