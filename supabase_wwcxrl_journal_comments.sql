begin;
create table if not exists public.wwcxrl_journal_comments (
  id uuid primary key,
  owner text not null check (owner in ('orange', 'pomelo')),
  date date not null,
  text text not null check (char_length(text) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index if not exists wwcxrl_journal_comments_page on public.wwcxrl_journal_comments (owner, date, id);
alter table public.wwcxrl_journal_comments enable row level security;
revoke all on public.wwcxrl_journal_comments from anon, authenticated;
grant select, insert on public.wwcxrl_journal_comments to service_role;
commit;
