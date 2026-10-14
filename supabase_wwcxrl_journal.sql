-- Additive: does not modify historical checkins, photos, energy or wishes.
begin;
create table if not exists public.wwcxrl_journal_entries (
  owner text not null check (owner in ('orange', 'pomelo')),
  date date not null,
  content jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (owner, date)
);
create table if not exists public.wwcxrl_journal_goals (
  owner text not null check (owner in ('orange', 'pomelo')),
  week_start date not null,
  nights integer not null check (nights between 1 and 7),
  before_time text not null,
  version integer not null default 1 check (version > 0),
  primary key (owner, week_start)
);
alter table public.wwcxrl_journal_entries enable row level security;
alter table public.wwcxrl_journal_goals enable row level security;
revoke all on public.wwcxrl_journal_entries, public.wwcxrl_journal_goals from anon, authenticated;
grant all on public.wwcxrl_journal_entries, public.wwcxrl_journal_goals to service_role;
-- Sleep screenshots are private. Access is signed by the password-protected API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wwcxrl-journal', 'wwcxrl-journal', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
commit;
