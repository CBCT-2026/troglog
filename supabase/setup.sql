-- Troglog private sync: run once in Supabase → SQL Editor → New query → Run.
-- One row per account holds the journal; photos go in a private storage bucket.
-- Row-level security means each signed-in account can only see its own data.

create table if not exists public.journal (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.journal enable row level security;

drop policy if exists "own journal" on public.journal;
create policy "own journal" on public.journal
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
