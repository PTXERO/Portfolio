-- DEAD//AIR play data: run this once in the Supabase SQL editor.
--
-- The game posts one row per event to this table using the project's public ("anon") key.
-- That key may only INSERT here. It cannot read, change or delete anything, so publishing
-- it in the page is safe. You read the data from the Supabase dashboard, which uses your login.
--
-- kind:  start    a run begins            (contestant, heat, starting wheel, device, career so far)
--        episode  an episode is finished  (setup, every round and every buzz, wheel spins, offers, booking)
--        end      a run is over           (won / cancelled / quit, final build, money earned)
--        leave    the page was closed in the middle of a run
--        buy      something bought between runs (Contract, Prize Vault, wardrobe)

create table if not exists public.deadair_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player     text  not null check (char_length(player) between 8 and 64),   -- a random ID made on the player's device
  run        text           check (run is null or char_length(run) <= 32),
  kind       text  not null check (kind in ('start', 'episode', 'end', 'leave', 'buy')),
  build      text           check (build is null or char_length(build) <= 16),
  ep         int            check (ep is null or ep between 0 and 999),
  data       jsonb not null check (pg_column_size(data) < 32000)             -- keeps junk and abuse small
);

create index if not exists deadair_events_run    on public.deadair_events (run);
create index if not exists deadair_events_player on public.deadair_events (player, created_at);
create index if not exists deadair_events_kind   on public.deadair_events (kind, created_at);

alter table public.deadair_events enable row level security;

drop policy if exists "game can add events" on public.deadair_events;
create policy "game can add events" on public.deadair_events
  for insert to anon with check (true);
-- No select / update / delete policy for anon: the public key can add rows and nothing else.


-- ── Views for research ─────────────────────────────────────────────────────────────

-- One row per run: who, how far, how it ended.
create or replace view public.deadair_runs as
select s.run, s.player, s.created_at as started, s.build,
       s.data->>'who' as contestant, (s.data->>'heat')::int as heat, s.data->>'code' as code,
       (s.data->'meta'->>'runs')::int as career_runs, (s.data->'meta'->>'wins')::int as career_wins,
       s.data->'device'->>'view' as screen, (s.data->'device'->>'touch')::int as touch,
       e.data->>'won' as won, e.data->>'quit' as quit, e.ep as last_episode,
       (e.data->>'t')::int as seconds_on_air, (e.data->>'wall')::int as seconds_total, (e.data->>'money')::bigint as money
from public.deadair_events s
left join public.deadair_events e on e.run = s.run and e.kind = 'end'
where s.kind = 'start';

-- One row per episode.
create or replace view public.deadair_episodes as
select run, player, created_at, build, ep,
       data->>'fmt' as show, data->>'sp' as special, data->>'boss' as boss, data->>'res' as result,
       (data->>'tgt')::int as target, (data->>'total')::bigint as total, jsonb_array_length(data->'rounds') as rounds_played,
       (data->>'dur')::int as seconds_on_air, (data->>'offerSecs')::numeric as offer_secs, (data->>'pickSecs')::numeric as booking_secs,
       data->'opts' as bookings_offered, data->>'pick' as booking_taken, data->'offers' as wedges_offered, data->>'offer' as wedge_taken,
       data->'kit' as kit, data->'fix' as machinery, (data->>'fps')::int as fps
from public.deadair_events where kind = 'episode';

-- One row per round.
create or replace view public.deadair_rounds as
select e.run, e.player, e.ep, r.ord as round, e.data->>'fmt' as show,
       (r.j->>'s')::bigint as score, r.j->>'how' as ended_by, (r.j->>'bz')::int as buzzes, (r.j->>'pf')::int as perfects, (r.j->>'miss')::int as dead_air_hits,
       (r.j->>'aim')::int as aim_error_ms, (r.j->>'bias')::int as early_late_ms, (r.j->>'gap')::numeric as secs_between_buzzes,
       (r.j->>'first')::numeric as secs_to_first_buzz, (r.j->>'peak')::bigint as peak_pot, (r.j->>'lostPot')::bigint as pot_lost, (r.j->>'dark')::int as dark_podiums_at_end
from public.deadair_events e, jsonb_array_elements(e.data->'rounds') with ordinality as r(j, ord)
where e.kind = 'episode';

-- One row per buzz: [seconds into the round, ms off the middle (negative = early), 0 dead air / 1 hit / 2 PERFECT, what was there, light speed]
create or replace view public.deadair_buzzes as
select e.run, e.player, e.ep, r.ord as round, b.ord as buzz,
       (b.j->>0)::numeric as at_secs, (b.j->>1)::int as offset_ms, (b.j->>2)::int as outcome, b.j->>3 as landed_on, (b.j->>4)::numeric as light_speed
from public.deadair_events e,
     jsonb_array_elements(e.data->'rounds') with ordinality as r(j, ord),
     jsonb_array_elements(r.j->'buzzes') with ordinality as b(j, ord)
where e.kind = 'episode';


-- ── Questions worth asking ─────────────────────────────────────────────────────────

-- Where do runs end?
--   select last_episode, count(*) from deadair_runs where won is distinct from '1' group by 1 order by 1;
-- Which shows cancel the most runs?
--   select show, count(*) as played, round(100.0 * count(*) filter (where result = 'over') / count(*)) as cancelled_pct from deadair_episodes group by 1 order by 3 desc;
-- How accurate are players, and does it change with light speed?
--   select round(light_speed) as speed, count(*), round(avg(abs(offset_ms))) as avg_error_ms, round(100.0 * avg((outcome = 0)::int)) as dead_air_pct from deadair_buzzes group by 1 order by 1;
-- Which wedge do people take when offered a choice?
--   select wedge_taken, count(*) from deadair_episodes where wedge_taken <> '' group by 1 order by 2 desc;
-- Win rate by contestant:
--   select contestant, count(*) as runs, round(100.0 * count(*) filter (where won = '1') / count(*)) as win_pct from deadair_runs group by 1 order by 2 desc;
