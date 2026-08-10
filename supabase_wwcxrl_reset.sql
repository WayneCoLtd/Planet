-- ============ 琛琳星球 · 一键重置：恢复到 Day 300 全新状态 ============
-- 用途：上线新版本（wwcxrl_* 表）前，删掉旧版 miyou_* 测试表与存储桶（删表即删数据），
--       然后创建新版 wwcxrl_* 空表（含 RLS 策略与 wwcxrl-photos 存储桶）。
-- 执行：Supabase Dashboard -> SQL Editor -> 粘贴全部 -> Run（幂等，可重复执行）。
-- 警告：会删除旧版所有签到/照片/背包/进度/日志数据，不可恢复；请确认已不再需要。

-- ① 删除旧 miyou_* 表（子表先删，最后删 profiles；表不存在时自动跳过）
drop table if exists public.miyou_activity_logs;
drop table if exists public.miyou_energy_events;
drop table if exists public.miyou_photo_wall;
drop table if exists public.miyou_backpack_items;
drop table if exists public.miyou_day_progress;
drop table if exists public.miyou_checkins;
drop table if exists public.miyou_profiles;

-- ② 删除旧存储桶与其中的照片
delete from storage.objects where bucket_id = 'miyou-photos';
delete from storage.buckets where id = 'miyou-photos';

-- ③ 创建新版 wwcxrl_* 表与策略（与 supabase_wwcxrl_schema.sql 建表部分一致）

-- 琛琳星球 Supabase 云端版本 schema
-- 使用方式：Supabase Dashboard -> SQL Editor -> New query -> 粘贴全部 -> Run
-- 注意：不要把 service_role / secret key 放进前端。前端只用 publishable/anon key。

create extension if not exists pgcrypto;

create table if not exists public.wwcxrl_profiles (
  id text primary key,
  display_name text not null default '神秘访客',
  role text not null default 'guest' check (role in ('orange', 'pomelo', 'guest')),
  device_label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.wwcxrl_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  day int not null check (day between 1 and 999),
  date text not null,
  task_completed boolean not null default false,
  task_completed_at timestamptz,
  signed boolean not null default false,
  signed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.wwcxrl_day_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  day int not null check (day between 1 and 999),
  progress_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.wwcxrl_backpack_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  item_id text not null,
  count int not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create table if not exists public.wwcxrl_photo_wall (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  day int not null check (day between 1 and 999),
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

create table if not exists public.wwcxrl_energy_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  event_type text not null,
  amount int not null default 0,
  total_after int,
  day int,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.wwcxrl_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
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
values ('wwcxrl-photos', 'wwcxrl-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- RLS: 当前是情侣暗号/私密链接型轻量站点；允许 publishable key 对这些表读写。
-- 这不是银行级鉴权，但适合今晚快速上线。之后可加 Supabase Auth / Edge Function 收紧。
alter table public.wwcxrl_profiles enable row level security;
alter table public.wwcxrl_checkins enable row level security;
alter table public.wwcxrl_day_progress enable row level security;
alter table public.wwcxrl_backpack_items enable row level security;
alter table public.wwcxrl_photo_wall enable row level security;
alter table public.wwcxrl_energy_events enable row level security;
alter table public.wwcxrl_activity_logs enable row level security;

drop policy if exists "wwcxrl_profiles_public_read" on public.wwcxrl_profiles;
create policy "wwcxrl_profiles_public_read" on public.wwcxrl_profiles for select using (true);
drop policy if exists "wwcxrl_profiles_public_insert" on public.wwcxrl_profiles;
create policy "wwcxrl_profiles_public_insert" on public.wwcxrl_profiles for insert with check (true);
drop policy if exists "wwcxrl_profiles_public_update" on public.wwcxrl_profiles;
create policy "wwcxrl_profiles_public_update" on public.wwcxrl_profiles for update using (true) with check (true);

drop policy if exists "wwcxrl_checkins_public_read" on public.wwcxrl_checkins;
create policy "wwcxrl_checkins_public_read" on public.wwcxrl_checkins for select using (true);
drop policy if exists "wwcxrl_checkins_public_insert" on public.wwcxrl_checkins;
create policy "wwcxrl_checkins_public_insert" on public.wwcxrl_checkins for insert with check (true);
drop policy if exists "wwcxrl_checkins_public_update" on public.wwcxrl_checkins;
create policy "wwcxrl_checkins_public_update" on public.wwcxrl_checkins for update using (true) with check (true);

drop policy if exists "wwcxrl_progress_public_read" on public.wwcxrl_day_progress;
create policy "wwcxrl_progress_public_read" on public.wwcxrl_day_progress for select using (true);
drop policy if exists "wwcxrl_progress_public_insert" on public.wwcxrl_day_progress;
create policy "wwcxrl_progress_public_insert" on public.wwcxrl_day_progress for insert with check (true);
drop policy if exists "wwcxrl_progress_public_update" on public.wwcxrl_day_progress;
create policy "wwcxrl_progress_public_update" on public.wwcxrl_day_progress for update using (true) with check (true);

drop policy if exists "wwcxrl_backpack_public_read" on public.wwcxrl_backpack_items;
create policy "wwcxrl_backpack_public_read" on public.wwcxrl_backpack_items for select using (true);
drop policy if exists "wwcxrl_backpack_public_insert" on public.wwcxrl_backpack_items;
create policy "wwcxrl_backpack_public_insert" on public.wwcxrl_backpack_items for insert with check (true);
drop policy if exists "wwcxrl_backpack_public_update" on public.wwcxrl_backpack_items;
create policy "wwcxrl_backpack_public_update" on public.wwcxrl_backpack_items for update using (true) with check (true);
drop policy if exists "wwcxrl_backpack_public_delete" on public.wwcxrl_backpack_items;
create policy "wwcxrl_backpack_public_delete" on public.wwcxrl_backpack_items for delete using (true);

drop policy if exists "wwcxrl_photo_wall_public_read" on public.wwcxrl_photo_wall;
create policy "wwcxrl_photo_wall_public_read" on public.wwcxrl_photo_wall for select using (true);
drop policy if exists "wwcxrl_photo_wall_public_insert" on public.wwcxrl_photo_wall;
create policy "wwcxrl_photo_wall_public_insert" on public.wwcxrl_photo_wall for insert with check (true);
drop policy if exists "wwcxrl_photo_wall_public_update" on public.wwcxrl_photo_wall;
create policy "wwcxrl_photo_wall_public_update" on public.wwcxrl_photo_wall for update using (true) with check (true);
drop policy if exists "wwcxrl_photo_wall_public_delete" on public.wwcxrl_photo_wall;
create policy "wwcxrl_photo_wall_public_delete" on public.wwcxrl_photo_wall for delete using (true);

drop policy if exists "wwcxrl_energy_public_read" on public.wwcxrl_energy_events;
create policy "wwcxrl_energy_public_read" on public.wwcxrl_energy_events for select using (true);
drop policy if exists "wwcxrl_energy_public_insert" on public.wwcxrl_energy_events;
create policy "wwcxrl_energy_public_insert" on public.wwcxrl_energy_events for insert with check (true);

drop policy if exists "wwcxrl_logs_public_read" on public.wwcxrl_activity_logs;
create policy "wwcxrl_logs_public_read" on public.wwcxrl_activity_logs for select using (true);
drop policy if exists "wwcxrl_logs_public_insert" on public.wwcxrl_activity_logs;
create policy "wwcxrl_logs_public_insert" on public.wwcxrl_activity_logs for insert with check (true);

drop policy if exists "wwcxrl_storage_public_read" on storage.objects;
create policy "wwcxrl_storage_public_read" on storage.objects for select using (bucket_id = 'wwcxrl-photos');
drop policy if exists "wwcxrl_storage_public_insert" on storage.objects;
create policy "wwcxrl_storage_public_insert" on storage.objects for insert with check (bucket_id = 'wwcxrl-photos');
drop policy if exists "wwcxrl_storage_public_update" on storage.objects;
create policy "wwcxrl_storage_public_update" on storage.objects for update using (bucket_id = 'wwcxrl-photos') with check (bucket_id = 'wwcxrl-photos');
drop policy if exists "wwcxrl_storage_public_delete" on storage.objects;
create policy "wwcxrl_storage_public_delete" on storage.objects for delete using (bucket_id = 'wwcxrl-photos');

-- You can inspect activity events in Dashboard -> Table Editor -> wwcxrl_activity_logs.

-- ============ 管理页：未来签到任务（wwcxrl_daily_tasks） ============
-- 由小琛在管理页（?admin=1）布置未来连续多日的签到任务；
-- 站点加载时“云端已发布任务优先，代码 dailyAdventures 作为兜底”，按 day 合并去重。
create table if not exists public.wwcxrl_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  day int not null unique check (day between 1 and 999),
  date text not null,
  title text not null,
  icon text not null default '✨',
  type text not null default 'memoryPuzzle' check (type in ('memoryPuzzle', 'letter', 'fortune', 'sticker', 'game')),
  theme text not null default '',
  reward text not null default '',
  prompt text not null default '',
  secret text not null default '',
  answer text not null default '',
  image text not null default '',
  memory_title text not null default '',
  memory_caption text not null default '',
  chat_messages jsonb not null default '[]'::jsonb,
  game_id text not null default '',
  game_config jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by text not null default 'orange',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.wwcxrl_daily_tasks enable row level security;

drop policy if exists "wwcxrl_daily_tasks_public_read" on public.wwcxrl_daily_tasks;
create policy "wwcxrl_daily_tasks_public_read" on public.wwcxrl_daily_tasks for select using (true);
drop policy if exists "wwcxrl_daily_tasks_public_insert" on public.wwcxrl_daily_tasks;
create policy "wwcxrl_daily_tasks_public_insert" on public.wwcxrl_daily_tasks for insert with check (true);
drop policy if exists "wwcxrl_daily_tasks_public_update" on public.wwcxrl_daily_tasks;
create policy "wwcxrl_daily_tasks_public_update" on public.wwcxrl_daily_tasks for update using (true) with check (true);
drop policy if exists "wwcxrl_daily_tasks_public_delete" on public.wwcxrl_daily_tasks;
create policy "wwcxrl_daily_tasks_public_delete" on public.wwcxrl_daily_tasks for delete using (true);


-- ============ 贴纸心愿（wwcxrl_wishes）：小琳写心愿，双方可见 ============
create table if not exists public.wwcxrl_wishes (
  id uuid primary key default gen_random_uuid(),
  day int not null check (day between 1 and 999),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  wish_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, user_id)
);

alter table public.wwcxrl_wishes enable row level security;

drop policy if exists "wwcxrl_wishes_public_read" on public.wwcxrl_wishes;
create policy "wwcxrl_wishes_public_read" on public.wwcxrl_wishes for select using (true);
drop policy if exists "wwcxrl_wishes_public_insert" on public.wwcxrl_wishes;
create policy "wwcxrl_wishes_public_insert" on public.wwcxrl_wishes for insert with check (true);
drop policy if exists "wwcxrl_wishes_public_update" on public.wwcxrl_wishes;
create policy "wwcxrl_wishes_public_update" on public.wwcxrl_wishes for update using (true) with check (true);
drop policy if exists "wwcxrl_wishes_public_delete" on public.wwcxrl_wishes;
create policy "wwcxrl_wishes_public_delete" on public.wwcxrl_wishes for delete using (true);
-- 已建表的老库执行下面两条即可（新库建表已包含）：
-- alter table public.wwcxrl_daily_tasks drop constraint if exists wwcxrl_daily_tasks_type_check;
-- alter table public.wwcxrl_daily_tasks add constraint wwcxrl_daily_tasks_type_check check (type in ('memoryPuzzle', 'letter', 'fortune', 'sticker', 'game'));
-- alter table public.wwcxrl_daily_tasks add column if not exists game_id text not null default '';
-- alter table public.wwcxrl_daily_tasks add column if not exists game_config jsonb not null default '{}'::jsonb;
