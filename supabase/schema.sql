create extension if not exists pgcrypto;

create table if not exists public.votes (
  date date not null,
  voter_key text not null,
  voter text not null,
  can_play boolean not null,
  ranges jsonb not null default '[]'::jsonb,
  comment text not null default '',
  updated_at timestamptz not null,
  primary key (date, voter_key),
  constraint votes_known_voter check (voter_key in ('misha', 'leku', 'sepia', 'ichitbo')),
  constraint votes_ranges_is_array check (jsonb_typeof(ranges) = 'array')
);

create index if not exists votes_date_idx on public.votes (date);

alter table public.votes
add column if not exists comment text not null default '';

alter table public.votes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'votes' and policyname = 'Public can read votes'
  ) then
    create policy "Public can read votes"
    on public.votes
    for select
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'votes' and policyname = 'Public can upsert votes'
  ) then
    create policy "Public can upsert votes"
    on public.votes
    for insert
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'votes' and policyname = 'Public can update votes'
  ) then
    create policy "Public can update votes"
    on public.votes
    for update
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'votes' and policyname = 'Public can delete votes'
  ) then
    create policy "Public can delete votes"
    on public.votes
    for delete
    using (true);
  end if;
end $$;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_name_not_blank check (length(trim(name)) > 0),
  constraint games_known_creator check (created_by is null or created_by in ('misha', 'leku', 'sepia', 'ichitbo'))
);

create unique index if not exists games_name_unique_idx on public.games (lower(trim(name)));
create index if not exists games_updated_at_idx on public.games (updated_at desc);

alter table public.games enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'Public can read games'
  ) then
    create policy "Public can read games"
    on public.games
    for select
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'Public can insert games'
  ) then
    create policy "Public can insert games"
    on public.games
    for insert
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'Public can update games'
  ) then
    create policy "Public can update games"
    on public.games
    for update
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'Public can delete games'
  ) then
    create policy "Public can delete games"
    on public.games
    for delete
    using (true);
  end if;
end $$;

create table if not exists public.game_votes (
  game_id uuid not null references public.games (id) on delete cascade,
  voter_key text not null,
  voter text not null,
  created_at timestamptz not null default now(),
  primary key (game_id, voter_key),
  constraint game_votes_known_voter check (voter_key in ('misha', 'leku', 'sepia', 'ichitbo'))
);

create index if not exists game_votes_voter_key_idx on public.game_votes (voter_key);

alter table public.game_votes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'game_votes' and policyname = 'Public can read game votes'
  ) then
    create policy "Public can read game votes"
    on public.game_votes
    for select
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'game_votes' and policyname = 'Public can insert game votes'
  ) then
    create policy "Public can insert game votes"
    on public.game_votes
    for insert
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'game_votes' and policyname = 'Public can delete game votes'
  ) then
    create policy "Public can delete game votes"
    on public.game_votes
    for delete
    using (true);
  end if;
end $$;
