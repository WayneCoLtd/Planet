-- ============ 小信箱多图补丁（wwcxrl_messages.image_urls） ============
-- 用途：让一条留言 / 一条评论可以同时带多张图片（最多 9 张）。
-- 执行位置：Supabase Dashboard → SQL Editor，整段粘贴执行一次即可。
-- 可以重复执行；只会新增字段与回填历史数据，不会删除任何已有留言或图片。
--
-- 兼容说明：
--   * 新的网页代码在字段缺失时会自动退回单图模式，不会因为没执行这段 SQL 就打不开小信箱；
--     但「一条留言带多张图」必须执行完这段 SQL 才能真正保存。
--   * image_url 老字段继续保留第一张图，旧客户端、SQL 直查、导出备份都还能看到一张。

-- 1) 新增多图字段
alter table public.wwcxrl_messages
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

alter table public.wwcxrl_messages
  drop constraint if exists wwcxrl_messages_image_urls_array;
alter table public.wwcxrl_messages
  add constraint wwcxrl_messages_image_urls_array check (jsonb_typeof(image_urls) = 'array');

comment on column public.wwcxrl_messages.image_urls is '图片地址数组（最多 9 张）；image_url 保留第一张，兼容旧客户端。';

-- 2) 历史数据回填：把老的单图搬进数组，新旧混读时不会漏图
update public.wwcxrl_messages
set image_urls = to_jsonb(array[image_url])
where coalesce(image_url, '') <> ''
  and (image_urls is null or image_urls = '[]'::jsonb);

-- 3) 自检：执行后这条查询应该返回 0
-- select count(*) from public.wwcxrl_messages
-- where coalesce(image_url, '') <> '' and image_urls = '[]'::jsonb;
