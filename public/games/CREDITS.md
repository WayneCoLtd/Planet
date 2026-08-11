# 嵌入小游戏来源与版权说明

本目录下的小游戏均来自公开的开源仓库，本网站仅用于学习与娱乐（非商用）。请遵守各仓库作者声明的使用要求，保留署名信息。

## 近年爆火 / 中文语境游戏（本次新增）

| 目录 | 游戏 | 来源仓库 | 许可证 / 作者声明 |
| --- | --- | --- | --- |
| `yulegeyu/` | 鱼了个鱼（羊了个羊低配版） | https://github.com/liyupi/yulegeyu | 仓库未附 LICENSE 文件；README 声明项目完全开源、供学习娱乐。构建时已设置相对路径 base，并移除原版 51.la 统计脚本。 |
| `life-restart/` | 人生重开模拟器（Laya 重构版） | https://github.com/VickScarlet/lifeRestart | ✅ MIT License。构建自 master（v2.1.0）；修复了仓库中字体文件名乱码导致加载失败的问题。 |
| `gobang/` | 五子棋人机对战 | https://github.com/mumuy/gobang | ✅ MIT License。已去除原页面的站点跳转逻辑与外部 CDN 引用，仅保留纯游戏页面。 |

## 原有嵌入游戏（game-space）

| 目录 | 来源 |
| --- | --- |
| `dress-up/`、`gold-miner/`、`balloon-paradise/`、`fruit-pie/`、`brick-break/`、`fruit-snake/`、`panda-run/`、`christmas-balloon/`、`smile-game/`、`bouncy-ball/` | https://github.com/chengzuopeng/game-space （Construct 2 示例游戏，仅供学习） |

> 已下线：`crazy-runner/`（疯狂跑步者）、`bubble-professor/`（泡泡教授）、`easter-memory/`（复活节记忆）三款因画面/体验问题从站内移除，来源仍为 game-space。

## 构建说明（仅存档）

- `yulegeyu/`：在仓库根目录给 `vite.config.ts` 增加 `base: './'`，然后执行 `npm install && npm run build`，将 `dist/` 复制到 `public/games/yulegeyu/`；复制后删除 `dist/index.html` 中的 51.la 统计脚本（本目录内的版本已处理）。
- `life-restart/`：在仓库根目录先执行 `npm run xlsx2json`（把 `data/**/*.xlsx` 生成到 `public/data/*.json`），再执行 `npm install && npm run build`（`vite.config.js` 已内置 `base: './'`、输出到 `template/public/`），将产物复制到 `public/games/life-restart/`；并把 `fonts/` 下乱码命名的字体文件改名为 `方正像素12.ttf`（本目录内的版本已处理）。
- `gobang/`：为静态单页，仅保留 `index.html + static/style/index.css + dist/gobang.min.js`；已移除原页面的站点跳转逻辑与外部 CDN 引用。针对站内使用修复了画布缩放后的点击坐标换算（AI 保持原版难度）。
