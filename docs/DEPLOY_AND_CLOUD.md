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
