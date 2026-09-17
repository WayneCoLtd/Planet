-- ============================================================
-- 音乐室：私有曲库补丁
-- 在【现有线上库】的 Supabase SQL Editor 里执行一次即可。
-- ============================================================
--
-- 设计要点（这是「私密」能成立的关键）：
--   1. 音频放在【私有】存储桶 wwcxrl-music：不建任何匿名策略。
--      因为 wwcxrl-photos 那条策略写死了 bucket_id = 'wwcxrl-photos'，
--      不会波及这个新桶；没有策略 = 匿名密钥拿不到任何东西。
--   2. 因此任何人即使从网页里拿到 publishable key，也签不出链接、更下载不到文件。
--   3. 播放链接由站点自己的服务端接口临时签名（带 service_role 密钥，永不下发到浏览器），
--      链接有时效，过期作废。
--   4. 两张表同样不开放匿名读写，全部经服务端接口。

-- ① 私有存储桶（public = false 是重点）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wwcxrl-music',
  'wwcxrl-music',
  false,
  31457280,
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 31457280,
      allowed_mime_types = array['audio/mpeg', 'audio/mp4', 'audio/wav', 'image/jpeg', 'image/png', 'image/webp'];

-- ② 故意不为 wwcxrl-music 建任何 storage.objects 策略。
--    下面这条是清理：如果之前有人手滑建过针对这个桶的匿名策略，一并删掉。
drop policy if exists "wwcxrl_music_public_read" on storage.objects;
drop policy if exists "wwcxrl_music_public_insert" on storage.objects;
drop policy if exists "wwcxrl_music_public_update" on storage.objects;
drop policy if exists "wwcxrl_music_public_delete" on storage.objects;

-- ③ 曲目表
create table if not exists public.wwcxrl_music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  artist text not null default '',
  mood text not null default '',
  audio_path text not null default '',
  cover_path text not null default '',
  duration_seconds numeric not null default 0,
  sort int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by text not null default 'pomelo',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.wwcxrl_music_tracks enable row level security;
-- 不建匿名策略：只有服务端（service_role）可以读写。

-- ④ 点歌留言表（与网站建议箱、小信箱相互独立）
create table if not exists public.wwcxrl_music_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default '',
  role text not null default 'pomelo' check (role in ('orange', 'pomelo', 'guest')),
  display_name text not null default '',
  content text not null default '',
  track_id uuid,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

alter table public.wwcxrl_music_requests enable row level security;

-- ⑤ 自检（结果应为 0 行）
--    如果这里查出了任何一行，说明音乐桶上还挂着匿名策略，需要删掉再继续。
select policyname, cmd, qual
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and coalesce(qual, '') like '%wwcxrl-music%';
