# 小信箱编辑与冲突检查

留言与评论都经 `updateCloudMessage` 更新原行，保留 ID、回复关系和创建时间。
写入时原子比较开始编辑时的正文、单图字段和多图字段；真正的新内容不得被自动覆盖。

## 为什么旧提示可能误报

旧代码将 UPDATE 返回零行统一解释成「另一台设备修改或删除」。但 RLS 没有匹配的 UPDATE 策略也可能返回零行，GRANT 并不代替 RLS。旧版重置脚本曾缺留言 UPDATE 策略；修改本地 SQL 或重新部署前端不会自动修复现有数据库。

修复后的处理：

- 返回零行后重新读取该留言。若内容已等于本次提交，则视为上次保存已经成功，避免响应丢失后的重复保存误报。
- 只有最新正文或照片内容与编辑基线不同才报告内容冲突。
- 正文与照片内容未变，仅原始图片字段格式改变（例如 null 变成空数组、代理 URL 变成原始 URL）时，使用新原始值重试一次；第二次仍保留完整比较条件。
- 原始值也没变化却写不进去时，提示可能是编辑权限未生效，不断言另一台设备修改过。
- 读失败与读不到原留言单独提示；保留编辑草稿，不自动删除重建留言。
- 仅明确的缺少 image_urls 列错误允许退回旧单图模式。权限错误或其他字段缺失不得触发降级。

## 线上只读检查

在当前项目 SQL Editor 查询：

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'wwcxrl_messages'
  and cmd in ('UPDATE', 'ALL');
```

结果为空，或没有适用于 anon/public 的策略时，需确认该库沿用本项目的匿名直接读写模型，再使用 `supabase_wwcxrl_message_edit_patch.sql`。
该补丁只在缺少编辑策略时补齐，发现已有策略则提示并跳过，不替换现有安全条件。该模型允许持有公开密钥的 anon 角色更新可读留言；前端署名不等于 Supabase Auth 身份。已有用户隔离策略的项目应修正自己的策略，不能套用此补丁。

如果已有策略，应继续核对其 USING / WITH CHECK、调用角色和 SELECT 可见性，而不是重复添加宽松策略。不要为了修复执行主 schema、重置脚本或关闭 RLS。

## 本地检查

`node --test scripts/message-edit.test.mjs` 使用真实 supabase-js 查询构造器和纯内存 HTTP 响应，验证原子条件、RLS 零行、真实并发、图片字段迁移、重试期间并发、重复保存及缺列兼容；不读取密钥或访问线上服务。构建和依赖检查使用 `npm run check`。

参考：[Supabase 行级安全](https://supabase.com/docs/guides/database/postgres/row-level-security)、[PostgREST 错误代码](https://docs.postgrest.org/en/v14/references/errors.html)。

验证结果：12 项客户端回归通过；PGlite 中复现「有 SELECT/UPDATE GRANT、无 UPDATE policy 时返回零行」，验证补丁可恢复编辑、重复运行安全且不会替换已有受限策略。浏览器使用独立本地模拟 REST 服务验证编辑失败时保留正文并显示权限提示，无线上读写。生产构建通过；完整检查仍被现有 Vite 高危依赖审计阻断。补丁与前端修复尚未提交、部署或在线上执行。


## 发布前验证（2026-10-21）

上文预览阶段记录的依赖审计阻断已处理：Vite 更新到 6.4.4，`npm run check` 通过，审计 0 个漏洞。完整本地回归通过。SQL 测试使用开发依赖 PGlite，CI 可直接运行；测试素材和模拟服务不进入提交。数据库补丁仅保存为文件，前端部署不会执行 SQL。
