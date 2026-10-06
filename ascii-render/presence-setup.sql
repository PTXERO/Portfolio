-- PTXERO//SOCIAL — presence table (RF-as-entry P3: who's ON AIR / LISTENING)
-- Run once in Supabase → SQL Editor. Only the Worker's SERVICE_KEY touches this
-- table (RLS on, no anon policies), so presence can't be spoofed or scraped raw.

create table if not exists presence (
  uid        text primary key,          -- handle suffix (e.g. CB6C), matches profiles.uid
  handle     text,                      -- full display handle (PREFIX-SUFFIX)
  state      text,                      -- 'on_air' | 'listening'
  label      text,                      -- station name / freq readout
  freq       double precision,          -- tuned/TX frequency (MHz), optional
  lat        double precision,          -- listener location (for CONNECT / listen-along)
  lon        double precision,
  privacy    text default 'public',     -- 'public' | 'followers'  ('off' rows are deleted, never stored)
  updated_at timestamptz default now()
);

-- Additive (safe to re-run) — brings an already-created presence table up to date.
alter table presence add column if not exists lat double precision;
alter table presence add column if not exists lon double precision;

create index if not exists presence_updated_idx on presence (updated_at desc);

alter table presence enable row level security;
-- Intentionally NO policies: anon/publishable key gets nothing. The Worker uses
-- the service_role key (bypasses RLS) for every read/write, applying the
-- off/followers/public visibility rules itself in GET /presence.
