create extension if not exists pgcrypto;

create table if not exists public.couple_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.couple_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  side text not null check (side in ('male', 'female')),
  nickname text not null,
  client_token text not null,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (room_id, side)
);

alter table public.couple_participants
  add column if not exists submitted_at timestamptz;

create table if not exists public.couple_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  participant_id uuid not null references public.couple_participants(id) on delete cascade,
  side text not null check (side in ('male', 'female')),
  question_id integer not null check (question_id between 1 and 50),
  value integer not null check (value between 1 and 5),
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (participant_id, question_id)
);

create table if not exists public.couple_reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  provider text not null,
  model text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists couple_participants_updated_at on public.couple_participants;
create trigger couple_participants_updated_at
before update on public.couple_participants
for each row execute function public.set_updated_at();

drop trigger if exists couple_answers_updated_at on public.couple_answers;
create trigger couple_answers_updated_at
before update on public.couple_answers
for each row execute function public.set_updated_at();

alter table public.couple_rooms enable row level security;
alter table public.couple_participants enable row level security;
alter table public.couple_answers enable row level security;
alter table public.couple_reports enable row level security;

drop policy if exists "anon can read rooms" on public.couple_rooms;
create policy "anon can read rooms" on public.couple_rooms for select to anon using (true);
drop policy if exists "anon can create rooms" on public.couple_rooms;
create policy "anon can create rooms" on public.couple_rooms for insert to anon with check (true);

drop policy if exists "anon can read participants" on public.couple_participants;
create policy "anon can read participants" on public.couple_participants for select to anon using (true);
drop policy if exists "anon can write participants" on public.couple_participants;
create policy "anon can write participants" on public.couple_participants for insert to anon with check (true);
drop policy if exists "anon can update participants" on public.couple_participants;
create policy "anon can update participants" on public.couple_participants for update to anon using (true) with check (true);

drop policy if exists "anon can read answers" on public.couple_answers;
create policy "anon can read answers" on public.couple_answers for select to anon using (true);
drop policy if exists "anon can write answers" on public.couple_answers;
create policy "anon can write answers" on public.couple_answers for insert to anon with check (true);
drop policy if exists "anon can update answers" on public.couple_answers;
create policy "anon can update answers" on public.couple_answers for update to anon using (true) with check (true);

drop policy if exists "anon can read reports" on public.couple_reports;
create policy "anon can read reports" on public.couple_reports for select to anon using (true);
drop policy if exists "anon can create reports" on public.couple_reports;
create policy "anon can create reports" on public.couple_reports for insert to anon with check (true);

do $$
begin
  alter publication supabase_realtime add table public.couple_participants;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.couple_answers;
exception
  when duplicate_object then null;
end $$;
