# 本地运行、Supabase 与 Cloudflare Pages 部署

## 本地运行

### 最简单：macOS 双击

双击仓库根目录：

```text
启动本地样品.command
```

默认打开：

```text
http://127.0.0.1:5173/?planet=1&preview=1&owner=1
```

### 命令行 / 检查者

```bash
bash scripts/review-local.sh
```

脚本会安装依赖、运行 `npm run check`、自动找可用端口并输出本地预览链接；停止服务：

```bash
bash scripts/stop-review.sh
```


## local-only 模式

这是默认模式：不需要账号、不需要网络数据库。

- 签到、背包和小游戏状态存在当前浏览器 localStorage；
- 适合单人、原型、私有单设备演示；
- 换浏览器/换域名不会自动同步状态。

## 可选 Supabase 云端同步

### 配置

```bash
cp .env.example .env.local
```

填入自己的项目：

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

在 Supabase Dashboard -> SQL Editor 执行：

```text
supabase_wwcxrl_schema.sql
```

这会创建：

- profiles
- checkins
- day progress
- backpack items
- photo wall
- activity logs
- `wwcxrl-photos` Storage bucket

### 安全提醒

当前 schema 延续私密双人样品的宽松 RLS，便于最小配置快速跑起来，但**不适合公开多人网站或敏感内容**。

如果要公开使用：

1. 开启 Supabase Auth；
2. 所有表加入 `owner_id uuid references auth.users(id)`；
3. 用 `auth.uid() = owner_id` 编写 select/insert/update/delete policy；
4. 对共享相册增加独立 project/couple membership 表；
5. 永远不要把 `service_role` key 放进 Vite 前端。

## Cloudflare Pages

### Git 连接部署

在 Cloudflare Pages 创建项目后：

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 或更高 |

如使用 Supabase，在 Cloudflare Pages 的环境变量中添加：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

### Wrangler 部署

```bash
npm run build
npx wrangler pages deploy dist --project-name your-project-name --branch production
```

`public/_redirects` 已有 SPA fallback，`public/_headers` 已有基础 headers。

## 发布前清单

```bash
npm run check
```

并确认：

- `.env.local` 没有进入 Git；
- 没有照片墙私密媒体、1013 礼物图、原始视频或部署历史；
- Day1/2/3/8 保留的互动参考图片已经获得公开发布授权；
- 没有 `node_modules/`、`dist/`、`deploy/`；
- 五个样品日和 Day05 主题切换都已实际测试；
- `README.md` 中的本地启动方式可用；
- GitHub Actions CI 通过。

## 新表的 Data API 权限（2026-10-30）

Supabase 从 2026-10-30 起不再自动为现有项目的 `public` 新表授予 Data API 权限，既有表保留原授权。新增记录不等于新建表。官方说明：https://github.com/orgs/supabase/discussions/45329

三个脚本 `supabase_wwcxrl_schema.sql`、`supabase_wwcxrl_reset.sql`、`supabase_wwcxrl_music_patch.sql` 的末尾现在有独立的「Data API 显式授权」段。完整初始化时必须执行到末尾；单独复制某张表的建表段时，也要带上对应 GRANT、RLS 和策略。主脚本的授权位于旧表重命名之后，避免授权落在随后被替换的表上。

当前最小新增权限如下（表名均带 `wwcxrl_` 前缀）：

| 表 | anon | service_role | 用途 |
| --- | --- | --- | --- |
| profiles、checkins、day_progress、wishes | SELECT、INSERT、UPDATE | SELECT | 前端查询 / upsert；服务端备份 |
| backpack_items | SELECT、INSERT、DELETE | SELECT | 背包采用删除再插入，无 UPDATE 调用 |
| photo_wall、daily_tasks、messages | SELECT、INSERT、UPDATE、DELETE | SELECT | 现有前端完整读写；留言支持编辑 |
| meeting_dates、changelog、feedback | SELECT、INSERT、DELETE | SELECT | 日历与日志全量替换；建议箱新增、查看、删除 |
| activity_logs | INSERT | SELECT | 前端仅追加事件；后台备份读取 |
| energy_events | 无新增授权 | SELECT | 当前无前端调用，保留历史数据备份读取 |
| music_tracks | 无新增授权 | SELECT、INSERT、UPDATE、DELETE | 仅服务端曲库管理与播放查询 |
| music_requests | 无新增授权 | SELECT、INSERT、DELETE | 仅服务端点歌列表、新增、删除；无 UPDATE 接口 |

依据为 `src/cloud.js`、`src/main.jsx`、`api/music.js`、`api/music-requests.js` 以及备份工具的读取路径。当前未使用 Supabase Auth 登录，所以不为 `authenticated` 新增授权；站点口令与 orange/pomelo 身份不是 Supabase Auth 数据库角色。未来接入 Auth 时需重新设计授权和 RLS。

这些是**增量 GRANT**，可重复执行，不会撤销旧项目的宽泛默认权限；因此不代表旧库最终权限已收紧。新增授权不含 ALL、TRUNCATE、REFERENCES、TRIGGER 或 WITH GRANT OPTION，也不修改整个 schema 的默认权限。当前主键是 UUID/text，不需要序列授权。音乐表继续依赖 RLS 无客户端策略及服务端会话校验。日记和生活相册独立 SQL 不在这次调整范围内。

GRANT 控制表操作，RLS 控制允许访问的行，两者都必须满足。现有公开表策略仍较宽松，本次并未改造成按用户隔离。重置脚本补齐了与主脚本一致的留言 UPDATE 策略，以支持现有留言编辑功能。

**不要为了补权限在已有数据库重跑整个主脚本或重置脚本**：其中包含历史数据迁移 / 删旧表逻辑。后续若要应用线上，应先核对实际表与角色，只执行目标表的授权语句；这次变更只准备本地文件，不执行线上 SQL。若要收紧旧授权，应另行审查实际 ACL、继承权限及其他调用方后准备 REVOKE 迁移。

本地权限回归使用开发依赖 PGlite（不需要数据库连接字符串、不读取 `.env`）；`npm ci` 后可直接运行：

```powershell
node scripts/sql-grants.test.mjs
```

如需使用已有的外部 PGlite 安装，可通过 `PLANET_PGLITE_MODULE` 指定模块绝对路径。默认 CI 无需此变量。

该检查模拟 Supabase 角色与 Storage 表、使用无默认授权的内存 PostgreSQL，执行三个 SQL 文件两遍，检查允许 / 禁止的权限及关键写入。测试替身不覆盖真实 Supabase Storage / PostgREST、线上已有 ACL 或历史 miyou 数据迁移；上线前仍需在隔离的 Supabase 测试项目验证。
