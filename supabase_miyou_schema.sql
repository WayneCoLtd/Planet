-- 琛琳星球 Supabase 云端版本 schema
-- 使用方式：Supabase Dashboard -> SQL Editor -> New query -> 粘贴全部 -> Run
-- 注意：不要把 service_role / secret key 放进前端。前端只用 publishable/anon key。

create extension if not exists pgcrypto;

create table if not exists public.miyou_profiles (
  id text primary key,
  display_name text not null default '神秘访客',
  role text not null default 'guest' check (role in ('orange', 'pomelo', 'guest')),
  device_label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.miyou_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.miyou_profiles(id) on delete cascade,
  day int not null check (day between 1 and 24),
  date text not null,
  task_completed boolean not null default false,
  task_completed_at timestamptz,
  signed boolean not null default false,
  signed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.miyou_day_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.miyou_profiles(id) on delete cascade,
  day int not null check (day between 1 and 24),
  progress_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.miyou_backpack_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.miyou_profiles(id) on delete cascade,
  item_id text not null,
  count int not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create table if not exists public.miyou_photo_wall (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.miyou_profiles(id) on delete cascade,
  day int not null check (day between 1 and 24),
  owner text not null check (owner in ('orange', 'pomelo')),
  image_url text not null,
  image_path text,
  caption text,
  frame text not null default 'cream',
  source text not null default 'upload' check (source in ('upload', 'static')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day, owner)
);

create table if not exists public.miyou_energy_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.miyou_profiles(id) on delete cascade,
  event_type text not null,
  amount int not null default 0,
  total_after int,
  day int,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.miyou_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.miyou_profiles(id) on delete cascade,
  display_name text,
  role text,
  event_type text not null,
  day int,
  detail_json jsonb not null default '{}'::jsonb,
  page_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Storage bucket for cloud photo wall.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('miyou-photos', 'miyou-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- RLS: 当前是情侣暗号/私密链接型轻量站点；允许 publishable key 对这些表读写。
-- 这不是银行级鉴权，但适合今晚快速上线。之后可加 Supabase Auth / Edge Function 收紧。
alter table public.miyou_profiles enable row level security;
alter table public.miyou_checkins enable row level security;
alter table public.miyou_day_progress enable row level security;
alter table public.miyou_backpack_items enable row level security;
alter table public.miyou_photo_wall enable row level security;
alter table public.miyou_energy_events enable row level security;
alter table public.miyou_activity_logs enable row level security;

drop policy if exists "miyou_profiles_public_read" on public.miyou_profiles;
create policy "miyou_profiles_public_read" on public.miyou_profiles for select using (true);
drop policy if exists "miyou_profiles_public_insert" on public.miyou_profiles;
create policy "miyou_profiles_public_insert" on public.miyou_profiles for insert with check (true);
drop policy if exists "miyou_profiles_public_update" on public.miyou_profiles;
create policy "miyou_profiles_public_update" on public.miyou_profiles for update using (true) with check (true);

drop policy if exists "miyou_checkins_public_read" on public.miyou_checkins;
create policy "miyou_checkins_public_read" on public.miyou_checkins for select using (true);
drop policy if exists "miyou_checkins_public_insert" on public.miyou_checkins;
create policy "miyou_checkins_public_insert" on public.miyou_checkins for insert with check (true);
drop policy if exists "miyou_checkins_public_update" on public.miyou_checkins;
create policy "miyou_checkins_public_update" on public.miyou_checkins for update using (true) with check (true);

drop policy if exists "miyou_progress_public_read" on public.miyou_day_progress;
create policy "miyou_progress_public_read" on public.miyou_day_progress for select using (true);
drop policy if exists "miyou_progress_public_insert" on public.miyou_day_progress;
create policy "miyou_progress_public_insert" on public.miyou_day_progress for insert with check (true);
drop policy if exists "miyou_progress_public_update" on public.miyou_day_progress;
create policy "miyou_progress_public_update" on public.miyou_day_progress for update using (true) with check (true);

drop policy if exists "miyou_backpack_public_read" on public.miyou_backpack_items;
create policy "miyou_backpack_public_read" on public.miyou_backpack_items for select using (true);
drop policy if exists "miyou_backpack_public_insert" on public.miyou_backpack_items;
create policy "miyou_backpack_public_insert" on public.miyou_backpack_items for insert with check (true);
drop policy if exists "miyou_backpack_public_update" on public.miyou_backpack_items;
create policy "miyou_backpack_public_update" on public.miyou_backpack_items for update using (true) with check (true);
drop policy if exists "miyou_backpack_public_delete" on public.miyou_backpack_items;
create policy "miyou_backpack_public_delete" on public.miyou_backpack_items for delete using (true);

drop policy if exists "miyou_photo_wall_public_read" on public.miyou_photo_wall;
create policy "miyou_photo_wall_public_read" on public.miyou_photo_wall for select using (true);
drop policy if exists "miyou_photo_wall_public_insert" on public.miyou_photo_wall;
create policy "miyou_photo_wall_public_insert" on public.miyou_photo_wall for insert with check (true);
drop policy if exists "miyou_photo_wall_public_update" on public.miyou_photo_wall;
create policy "miyou_photo_wall_public_update" on public.miyou_photo_wall for update using (true) with check (true);
drop policy if exists "miyou_photo_wall_public_delete" on public.miyou_photo_wall;
create policy "miyou_photo_wall_public_delete" on public.miyou_photo_wall for delete using (true);

drop policy if exists "miyou_energy_public_read" on public.miyou_energy_events;
create policy "miyou_energy_public_read" on public.miyou_energy_events for select using (true);
drop policy if exists "miyou_energy_public_insert" on public.miyou_energy_events;
create policy "miyou_energy_public_insert" on public.miyou_energy_events for insert with check (true);

drop policy if exists "miyou_logs_public_read" on public.miyou_activity_logs;
create policy "miyou_logs_public_read" on public.miyou_activity_logs for select using (true);
drop policy if exists "miyou_logs_public_insert" on public.miyou_activity_logs;
create policy "miyou_logs_public_insert" on public.miyou_activity_logs for insert with check (true);

drop policy if exists "miyou_storage_public_read" on storage.objects;
create policy "miyou_storage_public_read" on storage.objects for select using (bucket_id = 'miyou-photos');
drop policy if exists "miyou_storage_public_insert" on storage.objects;
create policy "miyou_storage_public_insert" on storage.objects for insert with check (bucket_id = 'miyou-photos');
drop policy if exists "miyou_storage_public_update" on storage.objects;
create policy "miyou_storage_public_update" on storage.objects for update using (bucket_id = 'miyou-photos') with check (bucket_id = 'miyou-photos');
drop policy if exists "miyou_storage_public_delete" on storage.objects;
create policy "miyou_storage_public_delete" on storage.objects for delete using (bucket_id = 'miyou-photos');

-- You can inspect activity events in Dashboard -> Table Editor -> miyou_activity_logs.
