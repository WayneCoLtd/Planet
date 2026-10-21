-- 小信箱编辑：仅在确认缺少 anon/public 的 UPDATE/ALL 策略后使用。
-- 延续本项目现有私密双人站点的 anon 直接写入模型，不适用于按用户隔离的网站。
-- 不删表、不改留言、不关闭 RLS；发现现有编辑策略时保持原样，避免覆盖限制。
begin;
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'wwcxrl_messages'
      and cmd in ('UPDATE', 'ALL')
      and roles && array['anon', 'public']::name[]
  ) then
    raise notice '已有 anon/public 编辑策略，未作更改；请检查现有策略条件和实际角色。';
  else
    grant select, update on table public.wwcxrl_messages to anon;
    create policy "wwcxrl_messages_anon_update"
      on public.wwcxrl_messages
      for update to anon
      using (true) with check (true);
  end if;
end $$;
commit;
