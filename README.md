# Chenlin Planet Template

> 一个可直接运行、可继续扩展的互动纪念日 / 小星球网站模板。
>
> **5 个非连续完整案例（Day 01 / 02 / 03 / 05 / 08）+ 其余日期自由续写 + 本地优先 + 可选 Supabase 云端同步。**

![Vite](https://img.shields.io/badge/Vite-6.4.3-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)

## 这是什么？

Chenlin Planet Template 是一个 Vite + React 静态网站样品：把“每天打开一格”的仪式感做成可扩展的互动星球。

本仓库保留 5 个可运行的互动日，而不是连续日历：

| Day | 参考内容 | 可学习点 |
| --- | --- | --- |
| Day 01 | 午夜谜题与聊天小窗 | 基础文字谜题、状态解锁、原始互动参考图 |
| Day 02 | 连续谜题、道具链与烟花 | 多阶段任务、背包状态、奖励弹窗、原始谜题卡 |
| Day 03 | 奶泡绘制与审核 | Canvas 输入、local/cloud 状态、阶段审核、三张绘制参考图 |
| Day 05 | 直接进入黑暗迷宫与星际皮肤 | 键盘迷宫、跨天道具、丝滑的全站主题转场 |
| Day 08 | 来自 1 光年的信号 | 深空主题下的独立小游戏、清云找星、故事解码与奖励 |

**Day 04、06、07、09+ 都没有预置日历内容。** 请从 `src/data/loveData.js` 添加你自己的日期、主题、任务和故事。

## 保留素材与隐私边界

本发布包按作者授权保留了上述互动日运行所需的 6 张原始参考图片：

```text
20250520.jpg
day2-riddle-20250521.jpg
day3-cappuccino-original-20250522.jpg
day3-cappuccino-smile-20250522.jpg
day3-cappuccino-heart-20250522.jpg
day8-one-lightyear-signal-20250527.jpg
```

它们只服务于 Day1/2/3/8 的谜题、绘制或游戏解锁；**不包含照片墙/相册页素材、1013 礼物图、原始视频或部署历史。**

如果你 fork 或公开部署自己的版本，请先确认这些参考图片、电影截图、聊天界面截图和其他第三方/个人素材具有可公开发布的授权；不确定时请替换为自己的素材。

## 最快启动：macOS 双击运行

直接双击仓库根目录的：

```text
启动本地样品.command
```

脚本会：

1. 检查 Node.js / npm；
2. 首次自动执行 `npm install`；
3. 启动 Vite 本地服务器；
4. 自动打开浏览器中的五个参考日预览；
5. 以 `preview=1&owner=1` 打开，方便单人演示 Day 03 的审核流程。

终端窗口保持打开时，样品站持续运行；关闭该窗口即可停止。

## 命令行启动（检查者 / 非 macOS）

如果不能直接双击 `.command` 文件，使用仓库自带的一键检查脚本：

```bash
bash scripts/review-local.sh
```

它会安装依赖、运行构建与安全检查、自动选择可用端口并打印本地预览链接。停止服务：

```bash
bash scripts/stop-review.sh
```

打开脚本输出的地址即可进入检查页面。常用查询参数：

- `?planet=1`：跳过邀请信入口，直接进入星球内部；
- `?preview=1`：解锁全部五个参考日，不受实际日期限制；
- `&showGuide=1`：重新显示首次运行说明书和祝福弹窗。

## Day 05：直接迷宫与主题切换

Day 05 已移除旧的“画面崩溃 / 拉绳”入口。打开当天即处于迷宫入口：

1. 完成 Day 02，获得火柴盒和火柴；
2. 完成 Day 03，获得奇怪的钥匙；
3. Day 05 点亮火把；
4. 用方向键 / WASD / 页面方向按钮走到出口；
5. 用钥匙打开木门；
6. 全站切换为深空星际主题；
7. Day 08 的 1 光年信号小游戏在该主题下作为后续案例运行。

网页说明书里的 **“⚡ 快速进入 Day 05 演示”** 只会写入当前浏览器 localStorage 的样品进度与三种前置道具，不访问云端。

## 项目结构

```text
Chenlin_Planet_Template_v0.1/
├── 启动本地样品.command       # macOS 双击启动本地样品
├── scripts/
│   ├── review-local.sh         # 检查者一键安装、构建、部署
│   └── stop-review.sh          # 停止检查者本地服务
├── AGENTS.md                     # Codex / 通用 AI 项目协作规则
├── CLAUDE.md                     # Claude Code 项目记忆入口
├── src/
│   ├── main.jsx               # 交互、任务组件、状态与页面入口
│   ├── styles.css             # 视觉样式与响应式规则
│   ├── cloud.js               # 可选 Supabase 同步层
│   └── data/loveData.js       # Day01/02/03/05/08 日历数据；其余日期从这里添加
├── public/
│   ├── images/                # 指定互动日参考图片与非私密占位资源
│   ├── videos/                # 非私密占位 MP4
│   ├── _headers               # Cloudflare Pages headers
│   └── _redirects             # SPA fallback
├── docs/
│   ├── PROJECT_STRUCTURE.md
│   ├── BUILD_A_NEW_DAY.md
│   ├── AI_VIBE_CODING.md
│   └── DEPLOY_AND_CLOUD.md
├── supabase_wwcxrl_schema.sql  # 可选 Supabase 表 / Storage schema
├── .env.example
└── .github/workflows/ci.yml   # GitHub Actions build + audit
```

更多说明：

- [项目结构与状态模型](docs/PROJECT_STRUCTURE.md)
- [从空白日期开始添加自己的任务](docs/BUILD_A_NEW_DAY.md)
- [用 Vibe Coding 与 AI 协作](docs/AI_VIBE_CODING.md)
- [本地、Supabase 与 Cloudflare Pages 部署](docs/DEPLOY_AND_CLOUD.md)
- [管理页布置未来签到任务（维护手册）](docs/ADMIN_TASKS.md)

## 检查者一键本地部署

拿到源码包后，不需要手动分别安装依赖、构建和启动服务。进入项目根目录，执行：

```bash
bash scripts/review-local.sh
```

脚本会自动完成：

1. 检查 Node.js 18+ 与 npm；
2. 执行 `npm install`；
3. 执行 `npm run check`（生产构建 + npm audit）；
4. 自动选择可用端口并启动本地 preview 服务；
5. 等待服务就绪并打印可直接打开的检查链接。

终端会输出类似：

```text
部署完成，可以打开检查：

  http://127.0.0.1:4173/?planet=1&preview=1&showGuide=1
```

复制这个链接到浏览器即可查看网站效果。`showGuide=1` 会让首次运行说明书和祝福弹窗重新出现，方便检查者从小白入口开始。也可以设置 `WWCXRL_OPEN=1 bash scripts/review-local.sh`，在 macOS 上自动打开浏览器。

停止本地服务：

```bash
bash scripts/stop-review.sh
```

服务日志保存在项目根目录的 `.wwcxrl-review-preview.log`，运行中的 PID 保存在 `.wwcxrl-review-preview.pid`；这两个临时文件不会加入源码包。

## 小白试玩与重置

打开网站后按页面内的“第一次怎么玩 / 现在玩这里”提示即可：邀请信先点击票根与五处发光名字；进入样品后从 Day 01 开始，完成任务再签到；Day 05 的木门会切换深空主题，Day 08 在新主题里继续。

任意时刻可在 **每日签到** 页或站内 **说明书** 点击“↺ 重置整个样品”。二次确认后会**立即刷新**：Day 01/02/03/05/08 的签到、任务、火柴、钥匙、背包、迷宫、信号与主题都会回到初始状态，但不会删除源代码。单独点击 Day5 的“重置524”会恢复可玩 checkpoint（火柴盒 × 1、火柴 × 2、钥匙 × 1）。

完全不会编程也可以：把 [`docs/AI_VIBE_CODING.md`](docs/AI_VIBE_CODING.md) 中的第一条提示完整交给 AI，让它先学习这份项目、和你讨论 idea，再小步实现。

## 从空白日期开始开发

打开：

```text
src/data/loveData.js
```

例如把 Day 04 作为你的第一天扩展：

```js
{
  day: 4,
  date: '2026-05-23',
  title: '你的第四天',
  icon: '✨',
  type: 'letter',
  theme: '你的主题',
  reward: '你的奖励',
  prompt: '任务说明',
  secret: '完成后显示的内容'
}
```

`letter`、`puzzle`、`tap`、`sticker`、`fortune`、`album` 等基础类型可直接使用；复杂交互可参考 Day 01、02、03、05、08 已实现的组件。详细步骤见 [BUILD_A_NEW_DAY.md](docs/BUILD_A_NEW_DAY.md)。

## 本地模式与可选云端

不创建 `.env.local` 时，项目完全可运行：签到、任务和背包保存在浏览器 localStorage。

如果想在设备间同步，复制：

```bash
cp .env.example .env.local
```

然后填写：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

按 `supabase_wwcxrl_schema.sql` 创建表和 Storage bucket。**不要**在前端、GitHub、聊天记录或 `.env.local` 中放入 `service_role` key。

> 当前 schema 的宽松 RLS 策略只适合可信的私密链接样品。若要公开多人使用或储存敏感内容，请先改为 Supabase Auth + `auth.uid()` 级别的 RLS。

## 构建与检查

```bash
npm run build
npm audit --audit-level=moderate
```

或者一条命令：

```bash
npm run check
```

## 部署到 Cloudflare Pages

- Framework preset：`Vite`
- Build command：`npm run build`
- Output directory：`dist`
- 可选环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`

详见 [DEPLOY_AND_CLOUD.md](docs/DEPLOY_AND_CLOUD.md)。

## 许可证

代码以 [MIT License](LICENSE) 发布。请在复用时自行确认上传的照片、音乐、字体和第三方素材具有授权。
