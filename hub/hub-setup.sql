-- PTXERO HUB — one-time Supabase setup. Run the whole file in Supabase → SQL Editor.
-- Safe to re-run (everything is "if not exists" / additive), on a brand-new project or an existing one.
--
-- Part 1 · the apps' tables (Social, ASCII//RENDER view & share, RF presence). Public reads use the
--          anon/publishable key through RLS "read" policies; every write goes through the hub Worker's
--          service key, which is how the PTXERO ID signature is enforced.
-- Part 2 · the hub's own tables:
--   profiles.pubkey      the public key an anonymous PTXERO ID proves itself with
--   hub_users            one row per identity: when first/last seen, pinned (never auto-deleted)
--   hub_usage            per identity per day counters (calls, writes, bytes) → fair-use limits
--   hub_blobs            per identity per app key/value store (SearchNet backups, settings, …)
--   hub_touch()          atomic "count one call" used by the Worker on every request
-- Part 3 · the storage bucket "renders" (public read) that holds images, avatars and audio.

-- ═══════════════ Part 1 · app tables ═══════════════
create table if not exists profiles (
  uid         text primary key,            -- the 4-character suffix of a handle (e.g. AB12)
  prefix      text,                        -- the display prefix (e.g. RF)
  bio         text,
  theme       jsonb,
  featured    jsonb,
  secret_hash text,                        -- legacy device secret (pre-key profiles); unused once a key is bound
  pubkey      text,                        -- the PTXERO ID public key (added by the hub on first signed request)
  updated_at  timestamptz default now()
);
create table if not exists renders (
  slug        text primary key,
  handle      text,
  title       text,
  description text,
  settings    jsonb,
  has_source  boolean default false,
  allow_remix boolean default false,
  media       text default 'image',        -- 'image' | 'webm'
  del_token   text,                        -- sha-256 of the creator's delete token
  created_at  timestamptz default now()
);
create table if not exists posts (
  id          text primary key,
  uid         text,
  handle      text,
  body        text,
  kind        text default 'text',         -- 'text' | 'station' | …
  data        jsonb,
  created_at  timestamptz default now()
);
create table if not exists likes (
  slug        text not null,
  uid         text not null,
  created_at  timestamptz default now(),
  primary key (slug, uid)
);
create table if not exists comments (
  id          bigserial primary key,
  slug        text not null,
  uid         text,
  body        text,
  created_at  timestamptz default now()
);
create index if not exists comments_slug_idx on comments (slug);
create table if not exists follows (
  follower    text not null,
  followee    text not null,
  created_at  timestamptz default now(),
  primary key (follower, followee)
);
create table if not exists reposts (
  uid         text not null,
  target      text not null,
  kind        text,                        -- 'render' | 'post'
  created_at  timestamptz default now(),
  primary key (uid, target)
);
create table if not exists notifications (
  id          bigserial primary key,
  recipient   text not null,
  actor       text,
  type        text,                        -- 'like' | 'comment' | 'follow' | 'repost' | …
  slug        text,
  read        boolean default false,
  created_at  timestamptz default now()
);
create index if not exists notifications_recipient_idx on notifications (recipient, read);
create table if not exists reports (
  id          bigserial primary key,
  target      text not null,
  kind        text,
  reporter    text,
  reason      text,
  resolved    boolean default false,
  created_at  timestamptz default now()
);
create table if not exists presence (
  uid        text primary key,
  handle     text,
  state      text,                         -- 'on_air' | 'listening'
  label      text,
  freq       double precision,
  lat        double precision,
  lon        double precision,
  privacy    text default 'public',
  updated_at timestamptz default now()
);
create index if not exists presence_updated_idx on presence (updated_at desc);

-- the pages read these with the anon key: allow SELECT only. All writes come through the Worker (service key).
alter table profiles      enable row level security;
alter table renders       enable row level security;
alter table posts         enable row level security;
alter table likes         enable row level security;
alter table comments      enable row level security;
alter table follows       enable row level security;
alter table reposts       enable row level security;
alter table notifications enable row level security;
alter table reports       enable row level security;
alter table presence      enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'public read') then
    create policy "public read" on profiles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'renders' and policyname = 'public read') then
    create policy "public read" on renders for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'posts' and policyname = 'public read') then
    create policy "public read" on posts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'likes' and policyname = 'public read') then
    create policy "public read" on likes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'comments' and policyname = 'public read') then
    create policy "public read" on comments for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'follows' and policyname = 'public read') then
    create policy "public read" on follows for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'reposts' and policyname = 'public read') then
    create policy "public read" on reposts for select using (true);
  end if;
end $$;
-- notifications, reports and presence are served by the Worker only (no anon policies on purpose).
-- NOTE: secret_hash and pubkey are readable through "public read" on profiles; neither is secret
--       (the hash is of a per-device random id; the public key is public by definition).

-- ═══════════════ Part 2 · hub tables ═══════════════

create table if not exists hub_users (
  uid        text primary key,
  pubkey     text,
  created_at timestamptz default now(),
  last_seen  timestamptz default now(),
  bytes      bigint default 0,
  pinned     boolean default false,           -- true = never auto-deleted (the owner, or by request)
  note       text
);

create table if not exists hub_usage (
  k      text not null,                        -- 'uid:ABCD' or 'ip:1.2.3.4'
  day    date not null default (now() at time zone 'utc')::date,
  calls  integer default 0,
  writes integer default 0,
  bytes  bigint default 0,
  primary key (k, day)
);
create index if not exists hub_usage_day_idx on hub_usage (day);

create table if not exists hub_blobs (
  uid        text not null,
  app        text not null,                    -- 'searchnet' | 'ascii' | 'social' | 'gallery' | …
  key        text not null,
  data       jsonb,
  bytes      integer default 0,
  updated_at timestamptz default now(),
  primary key (uid, app, key)
);
create index if not exists hub_blobs_uid_idx on hub_blobs (uid, app);

-- bring an older profiles table up to date (the first signed request binds the key; afterwards only that key may write)
alter table profiles add column if not exists pubkey text;
alter table profiles add column if not exists featured jsonb;
alter table renders  add column if not exists media text default 'image';
alter table posts    add column if not exists kind text default 'text';
alter table posts    add column if not exists data jsonb;
alter table presence add column if not exists lat double precision;
alter table presence add column if not exists lon double precision;

-- count one request atomically and return today's totals for the caller
create or replace function hub_touch(p_k text, p_calls integer default 1, p_writes integer default 0, p_bytes bigint default 0)
returns table (calls integer, writes integer, bytes bigint) language plpgsql security definer as $$
begin
  insert into hub_usage (k, day, calls, writes, bytes)
  values (p_k, (now() at time zone 'utc')::date, p_calls, p_writes, p_bytes)
  on conflict (k, day) do update
    set calls  = hub_usage.calls  + excluded.calls,
        writes = hub_usage.writes + excluded.writes,
        bytes  = hub_usage.bytes  + excluded.bytes;
  return query select u.calls, u.writes, u.bytes from hub_usage u
    where u.k = p_k and u.day = (now() at time zone 'utc')::date;
end $$;

-- housekeeping: usage rows older than a month are worthless
create or replace function hub_prune_usage() returns void language sql security definer as $$
  delete from hub_usage where day < (now() at time zone 'utc')::date - 35;
$$;

alter table hub_users  enable row level security;
alter table hub_usage  enable row level security;
alter table hub_blobs  enable row level security;
-- Intentionally NO policies: the anon/publishable key gets nothing. The Worker uses the service key.

-- ═══════════════ Part 3 · storage ═══════════════
-- Images, avatars, banners and station audio live in one PUBLIC-READ bucket; the Worker writes with the service key.
insert into storage.buckets (id, name, public) values ('renders', 'renders', true) on conflict (id) do update set public = true;
