create table if not exists public.votes (
  date date not null,
  voter_key text not null,
  voter text not null,
  can_play boolean not null,
  ranges jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null,
  primary key (date, voter_key),
  constraint votes_known_voter check (voter_key in ('misha', 'leku', 'sepia', 'ichitbo')),
  constraint votes_ranges_is_array check (jsonb_typeof(ranges) = 'array')
);

create index if not exists votes_date_idx on public.votes (date);

alter table public.votes enable row level security;

create policy "Public can read votes"
on public.votes
for select
using (true);

create policy "Public can upsert votes"
on public.votes
for insert
with check (true);

create policy "Public can update votes"
on public.votes
for update
using (true)
with check (true);

create policy "Public can delete votes"
on public.votes
for delete
using (true);
