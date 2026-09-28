-- 「今日最佳」原生任务类型 + 专用媒体桶（可选升级）。
-- 当前应用对旧约束已有兼容处理；此文件可重复执行，媒体桶也会由服务端自动创建/更新。

alter table public.wwcxrl_daily_tasks
  drop constraint if exists wwcxrl_daily_tasks_type_check;

alter table public.wwcxrl_daily_tasks
  add constraint wwcxrl_daily_tasks_type_check
  check (type in ('memoryPuzzle', 'dailyLight', 'dailyBest', 'nightReading', 'letter', 'fortune', 'sticker', 'game'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wwcxrl-task-media',
  'wwcxrl-task-media',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = excluded.allowed_mime_types;
