# 管理页与未来签到任务（维护手册）

本文档说明如何在小琛的站点上布置「未来连续多日的签到任务」，以及数据如何存储与同步。
适用对象：**小琛（管理方）**；小琳只看到已发布的任务并完成签到。

## 1. 进入管理页

- 打开网站并在地址栏加 `?admin=1`，例如 `https://www.wangwenchen.cn/?admin=1`。
- 输入管理密码（默认 `wwcxrl-admin-2026`，可用环境变量 `VITE_ADMIN_PASSWORD` 覆盖后重新部署）。
- 密码只在当前浏览器会话内记住（sessionStorage），关闭页面后需重新输入。

## 2. 可以布置的任务类型

| 类型 | 她看到的效果 | 需要填的内容 |
| --- | --- | --- |
| 谜语签到（推荐） | 输入谜底答案，答对自动点亮签到 | 谜面 prompt、谜底 answer、配图可选 |
| 一封信 | 拆开信封 → 读信 → 点「我读完啦」 | 信的内容 secret |
| 今日抽签 | 点一下签筒摇一摇，出签即完成 | 出签文案 secret |
| 贴纸 / 心愿 | 点一下揭下贴纸，看到背后的话 | 背后的话 secret |
| 小游戏 | 玩完小游戏自动点亮签到 | 选择游戏模板 + 参数 |

### 小游戏模板与参数

| 模板 | 参数 |
| --- | --- |
| 🗺️ 迷宫 | 迷宫地图：轻松 9×9 / 中等 13×13 / 经典 21×19 |
| 🧡 接爱心 | 需要接住的数量 3–30；下落速度 慢 / 中 / 快 |
| 🫧 戳泡泡 | 需要戳破的数量 3–30 |
| 🃏 翻牌记忆 | 卡片对数 4 / 6 / 8 |
| 🧩 滑块拼图 | 拼图大小 3×3 / 4×4 |

游戏进度会保存在本地（localStorage）并同步到云端，完成即点亮签到按钮；玩到一半关掉再打开会继续。

> 小游戏模板在 `src/main.jsx` 的 `MINI_GAMES` 注册表里集中维护（`src/main.jsx:4681` 附近）。
> 以后想加新模板，只需在注册表加一条 `{ id, label, icon, hint, defaults, fields }` 并在 `DailyInteraction` 的 game 分支加一行渲染即可。

## 3. 数据怎么存

- 任务表：Supabase `wwcxrl_daily_tasks`（管理页新建 / 编辑 / 删除）。
- 加载顺序：**云端已发布任务优先，代码 `src/data/loveData.js` 作为兜底**，按 day 去重合并。

## 4. 异地见面日历（彩蛋页倒计时）

管理页底部「💌 异地见面日历」可设置：

- **下次见面日期**：一个日期，彩蛋页会显示「距离下次见面还有 X 天」，并自动翻到那个月份、用 🎀 圈出当天。
- **已见面的浪漫日子**：可添加多段**时间范围**（开始日期 ~ 结束日期），每段可点开标记图案选择器（💗💕🌷🌸🦄🍓🎀 等 18 个预设，选中后自动收起）并填写备注。彩蛋页小日历会把整段范围涂上爱心：起点/终点显示所选图案、中间日子显示 ♡，下方以「图案 + 日期范围 + 备注」的贴纸展示。

存储：Supabase 表 `wwcxrl_meeting_dates`（kind = `next` / `past`），未连接云端时回退到本地 `localStorage['wwcxrl-meeting-dates']`。

> 已上线的老库需要先执行一次建表 SQL（见 `supabase_wwcxrl_schema.sql` 末尾「异地见面日历」段落）；若之前已建过单日版本的表，需补执行：
> `alter table public.wwcxrl_meeting_dates add column if not exists end_date text not null default '';`

## 5. 留言板与能量管理

- **小信箱（留言板）**：站点导航「💬 小信箱」，小琛和小琳在发送前可切换发送身份（🍊 小琛 / 🍑 小琳），可以发文字 + 图片，带详细时间，自动同步到 Supabase（表 `wwcxrl_messages`，图片存 `wwcxrl-photos` 存储桶的 `message-images/` 目录）；未连接云端时回退本地存储。每个人只能删除自己的留言。
- **能量管理**：管理页底部新增「⚡ 能量管理」，当剩余抽奖次数异常偏多时，可一键清零（能量与印章保留，历史已计过的日子不会重复发放）。
- **更新日志管理**：管理页底部新增「📜 更新日志管理」，可增删改版本记录（版本号/日期/标题/每行一条说明），保存后站点页脚「更新日志」弹窗即时展示（云端优先，本地兜底，内置数据兜底）。

> 已上线的老库需要先执行一次建表 SQL（见 `supabase_wwcxrl_schema.sql` 末尾「留言板」和「更新日志」两段）才能使用留言板与更新日志的云端同步。
  - 想长期保留的「内置」任务留在代码里即可；想随时改的任务放管理页。
- 配图上传：管理页上传的图片会压缩到 1200px 后存入 Supabase 存储桶 `wwcxrl-photos`，URL 写入任务记录的 image 字段。

## 4. 上线 / 迁移步骤（老库）

部署新版本前，先在 Supabase SQL Editor 对老库执行：

```sql
alter table public.wwcxrl_daily_tasks drop constraint if exists wwcxrl_daily_tasks_type_check;
alter table public.wwcxrl_daily_tasks add constraint wwcxrl_daily_tasks_type_check check (type in ('memoryPuzzle', 'letter', 'fortune', 'sticker', 'game'));
alter table public.wwcxrl_daily_tasks add column if not exists game_id text not null default '';
alter table public.wwcxrl_daily_tasks add column if not exists game_config jsonb not null default '{}'::jsonb;
```

新库直接执行 `supabase_wwcxrl_schema.sql` 即可（建表已包含这些列）。

## 5. 常用维护清单

- 改任务：`?admin=1` → 列表点「编辑」→ 改完保存或发布。
- 删任务：`?admin=1` → 列表点「删除」（会同时从云端删除，无法恢复）。
- 只预览不生效：保存为「草稿」，草稿不会出现在小琳的签到星图里。
- 配图上传失败：检查 Supabase 存储桶 `wwcxrl-photos` 是否存在，以及 RLS 策略是否允许 insert。
- 本地调试：不配置 `VITE_SUPABASE_URL` 时是纯本地模式，管理页只显示代码内置任务，不会写线上数据。
