-- Additive migration. Old photo wall, checkins and energy are untouched.
begin;
create table if not exists public.wwcxrl_life_photos (
  id uuid primary key,
  owner text not null check (owner in ('orange', 'pomelo')),
  taken_on date not null,
  caption text not null default '',
  image_path text not null,
  thumb_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists wwcxrl_life_photos_order on public.wwcxrl_life_photos (taken_on desc, id desc) where deleted_at is null;
alter table public.wwcxrl_life_photos enable row level security;
-- No anonymous policies: access through the existing password-protected server API.
revoke all on public.wwcxrl_life_photos from anon, authenticated;
grant all on public.wwcxrl_life_photos to service_role;
commit;
