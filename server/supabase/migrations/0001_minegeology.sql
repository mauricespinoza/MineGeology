-- MineGeology, stage B: attempts, their event log and their grades.
-- The browser never reads or writes these tables: every access goes through the Edge Function
-- "geomapper", which uses the service key. Row-level security is on with no policy for students,
-- so the public (anon) key cannot read anything, answer keys and other students' work included.

create table if not exists public.attempts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  folder text not null,              -- the published scenario, e.g. quebrada-los-litres-a
  seed integer not null,
  status text not null default 'open' check (status in ('open', 'submitted')),
  version integer not null default 0,
  state jsonb,                       -- notebook, map, section, column, clock, position
  observations jsonb not null default '{}'::jsonb,  -- what each outcrop showed, given at the outcrop
  lab jsonb not null default '{}'::jsonb,           -- lab answers by sample, each with the day it is due
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, folder)
);

create table if not exists public.events (
  id bigserial primary key,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  t text not null,
  kind text not null,
  data jsonb
);
create index if not exists events_attempt on public.events (attempt_id, id);

create table if not exists public.grades (
  attempt_id uuid primary key references public.attempts (id) on delete cascade,
  auto jsonb not null,               -- the automatic grade at submission: total and parts
  adjusted numeric check (adjusted between 0 and 1),
  note text,
  released boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.attempts enable row level security;
alter table public.events enable row level security;
alter table public.grades enable row level security;

-- Only institutional addresses may create an account. The domains live in a table so that the course
-- can change them without a migration; teachers outside them are listed by address.
create table if not exists public.allowed_domains (domain text primary key);
create table if not exists public.allowed_emails (email text primary key);
insert into public.allowed_domains (domain) values ('udec.cl') on conflict do nothing;
alter table public.allowed_domains enable row level security;
alter table public.allowed_emails enable row level security;

create or replace function public.check_email_domain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  host text := lower(split_part(new.email, '@', 2));
begin
  if exists (select 1 from allowed_emails where email = lower(new.email)) then return new; end if;
  if exists (select 1 from allowed_domains d where host = d.domain or host like '%.' || d.domain) then return new; end if;
  raise exception 'Solo se aceptan correos institucionales';
end $$;

drop trigger if exists minegeology_email_domain on auth.users;
create trigger minegeology_email_domain before insert on auth.users
  for each row execute function public.check_email_domain();

-- End of semester: everything of one course can be exported (select) and deleted per scenario.
-- delete from public.attempts where folder like 'quebrada-los-litres-%';
