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

-- ============ 异地见面日历（wwcxrl_meeting_dates）：下次见面日期 + 已见面的浪漫日子 ============
-- 管理端（?admin=1）设置；彩蛋页展示倒计时和小日历并给已见面日期做标记。
create table if not exists public.wwcxrl_meeting_dates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('next', 'past')),
  date text not null,
  end_date text not null default '',
  note text not null default '',
  emoji text not null default '💕',
  created_by text not null default 'orange',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, date)
);

alter table public.wwcxrl_meeting_dates enable row level security;

drop policy if exists "wwcxrl_meeting_dates_public_read" on public.wwcxrl_meeting_dates;
create policy "wwcxrl_meeting_dates_public_read" on public.wwcxrl_meeting_dates for select using (true);
drop policy if exists "wwcxrl_meeting_dates_public_insert" on public.wwcxrl_meeting_dates;
create policy "wwcxrl_meeting_dates_public_insert" on public.wwcxrl_meeting_dates for insert with check (true);
drop policy if exists "wwcxrl_meeting_dates_public_update" on public.wwcxrl_meeting_dates;
create policy "wwcxrl_meeting_dates_public_update" on public.wwcxrl_meeting_dates for update using (true) with check (true);
drop policy if exists "wwcxrl_meeting_dates_public_delete" on public.wwcxrl_meeting_dates;
create policy "wwcxrl_meeting_dates_public_delete" on public.wwcxrl_meeting_dates for delete using (true);
-- 已上线的老库只需执行上面这一段（建表 + RLS + 策略）即可，无需重建其他表。
-- 若此前已建过该表（单日版本），补执行：
-- alter table public.wwcxrl_meeting_dates add column if not exists end_date text not null default '';

-- ============ 留言板（wwcxrl_messages）：异地想对对方说的话 ============
-- 支持文字 + 图片，记录发送人与时间；图片存到 wwcxrl-photos 存储桶。
create table if not exists public.wwcxrl_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.wwcxrl_profiles(id) on delete cascade,
  role text not null default 'pomelo' check (role in ('orange', 'pomelo', 'guest')),
  display_name text not null default '',
  content text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now()
);

alter table public.wwcxrl_messages enable row level security;

drop policy if exists "wwcxrl_messages_public_read" on public.wwcxrl_messages;
create policy "wwcxrl_messages_public_read" on public.wwcxrl_messages for select using (true);
drop policy if exists "wwcxrl_messages_public_insert" on public.wwcxrl_messages;
create policy "wwcxrl_messages_public_insert" on public.wwcxrl_messages for insert with check (true);
drop policy if exists "wwcxrl_messages_public_delete" on public.wwcxrl_messages;
create policy "wwcxrl_messages_public_delete" on public.wwcxrl_messages for delete using (true);
-- 已建表的老库执行下面两条即可（新库建表已包含）：
-- alter table public.wwcxrl_daily_tasks drop constraint if exists wwcxrl_daily_tasks_type_check;
-- alter table public.wwcxrl_daily_tasks add constraint wwcxrl_daily_tasks_type_check check (type in ('memoryPuzzle', 'letter', 'fortune', 'sticker', 'game'));
-- alter table public.wwcxrl_daily_tasks add column if not exists game_id text not null default '';
-- alter table public.wwcxrl_daily_tasks add column if not exists game_config jsonb not null default '{}'::jsonb;


-- ============ 老库迁移：从 miyou_* 品牌切换到 wwcxrl_* ============
-- 只对“已经在线上建过 miyou_* 表”的数据库执行；全新数据库直接跑上面的完整 schema 即可。
-- 顺序：① 重命名表 → ② 重命名策略/约束 → ③ 迁移角色 ID → ④ 迁移存储桶。

-- ① 重命名数据表（数据保留）
-- 注意：整段执行时顶部 create table if not exists 会先建出空的 wwcxrl_* 表，
-- 这里先删掉“旧表存在时的空 wwcxrl 表”，避免 rename 报 already exists；全新库无 miyou 表则跳过。
do $$
declare t text;
begin
  foreach t in array array['profiles','checkins','day_progress','backpack_items','photo_wall','energy_events','activity_logs','daily_tasks']
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relname = 'miyou_' || t and n.nspname = 'public'
    ) then
      execute format('drop table if exists public.wwcxrl_%I', t);
      execute format('alter table public.miyou_%I rename to wwcxrl_%I', t, t);
    end if;
  end loop;
end $$;

-- ② 重命名所有 miyou_* 策略与约束（找不到就跳过）
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname as tbl, pol.polname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where pol.polname like 'miyou_%'
  loop
    begin
      execute format('alter policy %I on %I.%I rename to %I',
        r.polname, r.nspname, r.tbl, replace(r.polname, 'miyou_', 'wwcxrl_'));
    exception when others then null;
    end;
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname as tbl, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.conname like 'miyou_%'
  loop
    begin
      execute format('alter table %I.%I rename constraint %I to %I',
        r.nspname, r.tbl, r.conname, replace(r.conname, 'miyou_', 'wwcxrl_'));
    exception when others then null;
    end;
  end loop;
end $$;

-- ③ 角色 ID 从 miyou-orange-main / miyou-pomelo-main 迁到 wwcxrl-*（子表 user_id 同步）
-- 先临时关闭子表外键触发器，避免更新中途违反外键约束
alter table public.wwcxrl_checkins disable trigger all;
alter table public.wwcxrl_day_progress disable trigger all;
alter table public.wwcxrl_backpack_items disable trigger all;
alter table public.wwcxrl_photo_wall disable trigger all;
alter table public.wwcxrl_energy_events disable trigger all;
alter table public.wwcxrl_activity_logs disable trigger all;

update public.wwcxrl_profiles set id = 'wwcxrl-orange-main' where id = 'miyou-orange-main';
update public.wwcxrl_profiles set id = 'wwcxrl-pomelo-main' where id = 'miyou-pomelo-main';
update public.wwcxrl_checkins set user_id = 'wwcxrl-orange-main' where user_id = 'miyou-orange-main';
update public.wwcxrl_checkins set user_id = 'wwcxrl-pomelo-main' where user_id = 'miyou-pomelo-main';
update public.wwcxrl_day_progress set user_id = 'wwcxrl-orange-main' where user_id = 'miyou-orange-main';
update public.wwcxrl_day_progress set user_id = 'wwcxrl-pomelo-main' where user_id = 'miyou-pomelo-main';
update public.wwcxrl_backpack_items set user_id = 'wwcxrl-orange-main' where user_id = 'miyou-orange-main';
update public.wwcxrl_backpack_items set user_id = 'wwcxrl-pomelo-main' where user_id = 'miyou-pomelo-main';
update public.wwcxrl_photo_wall set user_id = 'wwcxrl-orange-main' where user_id = 'miyou-orange-main';
update public.wwcxrl_photo_wall set user_id = 'wwcxrl-pomelo-main' where user_id = 'miyou-pomelo-main';
update public.wwcxrl_energy_events set user_id = 'wwcxrl-orange-main' where user_id = 'miyou-orange-main';
update public.wwcxrl_energy_events set user_id = 'wwcxrl-pomelo-main' where user_id = 'miyou-pomelo-main';
update public.wwcxrl_activity_logs set user_id = 'wwcxrl-orange-main' where user_id = 'miyou-orange-main';
update public.wwcxrl_activity_logs set user_id = 'wwcxrl-pomelo-main' where user_id = 'miyou-pomelo-main';

-- 恢复子表触发器
alter table public.wwcxrl_activity_logs enable trigger all;
alter table public.wwcxrl_energy_events enable trigger all;
alter table public.wwcxrl_photo_wall enable trigger all;
alter table public.wwcxrl_backpack_items enable trigger all;
alter table public.wwcxrl_day_progress enable trigger all;
alter table public.wwcxrl_checkins enable trigger all;

-- ④ 存储桶：新建 wwcxrl-photos 并把旧对象搬过去（图床 URL 不变，仍是 /storage/v1/object/public/…）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wwcxrl-photos', 'wwcxrl-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
update storage.objects set bucket_id = 'wwcxrl-photos' where bucket_id = 'miyou-photos';

-- 存储桶策略：删掉旧的 miyou 策略，重建为 wwcxrl（新库建表部分已有，这里保证老库也一致）
drop policy if exists "wwcxrl_storage_public_read" on storage.objects;
drop policy if exists "wwcxrl_storage_public_insert" on storage.objects;
drop policy if exists "wwcxrl_storage_public_update" on storage.objects;
drop policy if exists "wwcxrl_storage_public_delete" on storage.objects;
drop policy if exists "miyou_storage_public_read" on storage.objects;
drop policy if exists "miyou_storage_public_insert" on storage.objects;
drop policy if exists "miyou_storage_public_update" on storage.objects;
drop policy if exists "miyou_storage_public_delete" on storage.objects;
create policy "wwcxrl_storage_public_read" on storage.objects for select using (bucket_id = 'wwcxrl-photos');
create policy "wwcxrl_storage_public_insert" on storage.objects for insert with check (bucket_id = 'wwcxrl-photos');
create policy "wwcxrl_storage_public_update" on storage.objects for update using (bucket_id = 'wwcxrl-photos') with check (bucket_id = 'wwcxrl-photos');
create policy "wwcxrl_storage_public_delete" on storage.objects for delete using (bucket_id = 'wwcxrl-photos');
delete from storage.buckets where id = 'miyou-photos';
-- ⑤ 照片墙里存的是旧桶的绝对 URL，搬桶后把 miyou-photos 改写为 wwcxrl-photos，避免旧照片 404。
update public.wwcxrl_photo_wall
set image_url = replace(image_url, '/object/public/miyou-photos/', '/object/public/wwcxrl-photos/')
where image_url like '%/object/public/miyou-photos/%';

-- 角色 ID 变更后，image_path 里的旧角色路径同步改写（仅作记录，不影响展示 URL）。
update public.wwcxrl_photo_wall
set image_path = replace(image_path, 'miyou-orange-main', 'wwcxrl-orange-main')
where image_path like '%miyou-orange-main%';
update public.wwcxrl_photo_wall
set image_path = replace(image_path, 'miyou-pomelo-main', 'wwcxrl-pomelo-main')
where image_path like '%miyou-pomelo-main%';
