# 项目结构与状态模型

## 先读这三个文件

| 文件 | 作用 | 什么时候改 |
| --- | --- | --- |
| `src/data/loveData.js` | 日历数据、标题、日期、任务类型、文案 | 新增/编辑空白日期时先改这里 |
| `src/main.jsx` | React 组件、任务状态、页面路由、背包、主题、可选云端调用 | 需要新游戏或修改交互规则时 |
| `src/styles.css` | 全部视觉样式与响应式规则 | 调整页面视觉、主题、动画时 |

## 当前公开样品结构

```text
Day 01  memoryPuzzle            原始互动图 + 基础文字谜题
Day 02  serialRiddleFirework    原始谜题卡 + 多阶段道具与烟花
Day 03  foamDrawingReview       三张原始奶泡参考图 + Canvas 审核
Day 05  darkMazeTransition      直接迷宫入口 + 全站主题切换
Day 08  oneLightYearSignal      深空主题下的清云找星小游戏 + 解锁参考图
other   <empty>                 由使用者自己添加
```

其他复杂组件仍保留在 `main.jsx`，可以作为源码阅读材料；但它们不在 `dailyAdventures` 数组里，因此不会出现在公开样品日历中。

## 本地状态

默认不配置 Supabase 时，状态会保存在浏览器 localStorage：

- 已完成任务：`wwcxrl-completed-days:<role>`
- 已签到日：`wwcxrl-signed-days:<role>`
- Day 02 道具/烟花：`wwcxrl-day2-firework-state:<role>`
- Day 03 绘制审核：`wwcxrl-day3-foam-progress:<role>`
- Day 05 迷宫：`wwcxrl-day4-dark-maze-state:<role>`（历史 key 名保留，实际对应 Day 05）
- Day 08 信号：`wwcxrl-day8-one-lightyear-signal-state:<role>`
- 背包：`wwcxrl-backpack-v1:<role>`

公开样品启动时会过滤非 Day 01/02/03/05/08 的旧进度，避免旧版本地状态污染当前案例集。

## Day 05 的主题切换机制

Day 05 打开即进入迷宫，不再有“画面崩溃 / 拉绳”入口。完成后，`DarkMazeTransition` 会调用：

```js
setVoyageThemeLocal(true, 'day4-stargate', { cloud: true })
```

它会保存全局主题状态并触发 `wwcxrl-theme-updated` 事件。`PlanetApp` 监听该事件，为最外层 `<main>` 添加：

```text
interstellar-voyage-theme
```

`styles.css` 中的 `.interstellar-voyage-theme ...` 规则负责将经典奶油风切换成星际旅行配色。Day 08 以这个深空视觉空间作为独立小游戏案例。

这套模式适合继续扩展：例如完成 Day 10 后解锁冬季主题、完成某个任务后切换夜间模式、进入特殊章节后改变导航和背景。

## 页面导航

`PlanetApp` 使用一个轻量 React state 控制页面：

```js
const [current, setCurrent] = useState('home')
```

关键页面 id：

- `home`：首页
- `guide`：网页说明书
- `checkin`：五个参考日历
- `album`：相册墙模板（不含照片墙私密媒体）
- `backpack`：背包
- `capsule`：能量彩蛋

如果后续游戏特别复杂，建议继续沿用现有的 `createPortal(..., document.body)` 模式，让游戏在独立 modal 中运行，而不是压缩在签到卡片内。

## 媒体约定

`public/images/` 中保留了作者明确选择的 Day1/2/3/8 互动参考图片；它们不是照片墙批量素材。没有恢复：

- 照片墙/相册页的私人照片
- 1013 礼物图、原始视频
- 部署历史、带路径的 manifest

fork 或公开部署前请复核所有图片、电影截图、聊天界面截图和第三方素材是否可被公开发布；不确定时替换为自己的素材。
