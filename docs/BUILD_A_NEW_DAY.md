# 从空白日期开始添加你的任务

公开样品只在日历中提供 Day 01、02、03、05、08 五个非连续参考日。Day 04、06、07、09+ 都是你可以自由使用的空白位置。

## 1. 添加最简单的一天

在 `dailyAdventures` 数组中按日期顺序加入一个对象。比如补上 Day 04：

```js
{
  day: 4,
  date: '2026-05-23',
  title: '我的第四天',
  icon: '✨',
  type: 'letter',
  theme: '星光小信',
  reward: '打开一封新信',
  prompt: '写下今天的任务说明。',
  secret: '完成后显示的隐藏文字。'
}
```

运行检查者一键脚本：

```bash
bash scripts/review-local.sh
```

它会安装依赖、检查构建并输出本地链接；打开链接后加 `?planet=1&preview=1`，就可以不等待真实日期直接看到新日历格。

## 2. 可直接复用的基础 type

在 `DailyInteraction` 组件中已经有这些通用类型：

| type | 用途 |
| --- | --- |
| `letter` | 一封文字信 / 直接完成 |
| `puzzle` | 输入答案的小谜题 |
| `tap` | 点击累积型小游戏 |
| `fortune` | 抽签 / 扭蛋感结果 |
| `sticker` | 贴纸或小奖励 |
| `album` | 相册主题日 |
| `capsule` | 时间胶囊、说明书、阅读内容 |

新任务优先从这些基础 type 开始。它们不依赖私有照片或云端配置。

## 3. 阅读五个复杂案例

想做多阶段任务时，可以阅读但不要直接覆盖：

- Day 01：`MemoryPuzzle`
- Day 02：`SerialRiddleFirework`
- Day 03：`FoamDrawingReview`
- Day 05：`DarkMazeTransition`
- Day 08：`OneLightYearSignalQuest` / `OneLightYearSignalGame`

建议流程：

1. 在 `dailyAdventures` 中先加新的一天；
2. 设置新的 `type`，例如 `myNewQuest`；
3. 在 `DailyInteraction` 中增加分支：

```jsx
if (item.type === 'myNewQuest') {
  return <MyNewQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
}
```

4. 在 `main.jsx` 中写 `MyNewQuest` 组件；
5. 在 `styles.css` 最后增加局部样式；
6. 完成时调用：

```js
onTaskComplete(item.day)
```

签到按钮会自动变为可用。

## 4. 让任务改变全站主题

Day 05 的核心是：任务完成时写入一个全局状态，应用根节点根据该状态添加 class。

可参考：

```js
setVoyageThemeLocal(true, 'my-day5-theme', { cloud: true })
```

然后在 CSS 中写：

```css
.interstellar-voyage-theme {
  /* 你的全局新主题 */
}
```

更推荐为新主题新增一个独立状态字段和 class，而不是全部复用 `interstellar-voyage-theme`。

Day 08 是“转场后的游戏”示例：可以让后续日读取主题状态，在新的视觉空间中启动一个独立 modal 小游戏。

## 5. 图片与发布边界

当前包特意保留了 Day1/2/3/8 的互动参考图片，**不包含照片墙素材**。你新增任务时：

- 自己拥有版权或明确发布授权的素材才放进 `public/images/`；
- 相册、聊天截图、真人照片、礼物图和原始视频优先使用私有部署，不要默认提交；
- 使用图片前检查其中是否有可识别个人信息、通知栏、聊天昵称或第三方版权内容；
- 发布前更新 README 中的素材说明。

## 6. 不要忘记验证

每次增加任务后：

```bash
npm run build
npm audit --audit-level=moderate
```

浏览器至少检查：

- 新 Day 是否出现在日历；
- 未完成时签到按钮是否禁用；
- 完成任务后是否可以签到；
- 刷新页面后 localStorage 状态是否保持；
- 窄屏下是否出现横向溢出；
- 控制台是否有 JS 错误。
