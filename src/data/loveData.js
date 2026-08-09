export const timeline = [
  {
    date: 'Day 01 / 02 / 03',
    title: '连续交互案例',
    tag: 'Reference',
    text: '文字谜题、道具链和 Canvas 绘制审核：三个完整的本地状态互动案例。'
  },
  {
    date: 'Day 05',
    title: '黑暗迷宫 → 星际主题',
    tag: 'Theme switch',
    text: '通过迷宫木门后切换整个站点的视觉主题，是全局状态与叙事转场的案例。'
  },
  {
    date: 'Day 08',
    title: '1 光年的信号',
    tag: 'Post-switch game',
    text: '在星际主题下清开云朵、收集星光，作为转场后的独立小游戏案例。'
  }
]

export const loveNotes = [
  '从一个小任务开始，让你的小星球慢慢长出来。',
  '每一格日历都可以换成自己的故事、颜色和互动。',
  '先让它跑起来，再一点一点改成你的样子。',
  '不用一开始就完美，真诚的交互会慢慢发光。',
  '愿你写下的下一天，刚好成为想被记住的一天。'
]

export const gallery = [
  { title: '你的相册第 1 页', caption: '公开模板不包含私人相册图片。请在自己的私有部署中添加。', color: 'lemon' },
  { title: '你的相册第 2 页', caption: '这里可以放属于你的照片、插画或创作记录。', color: 'pink' },
  { title: '你的相册第 3 页', caption: '把想留住的瞬间慢慢放进来。', color: 'mint' }
]

export const wishes = [
  '替换成自己的角色和色彩',
  '从空白日期开始写一个小游戏',
  '把小星球更新很多很多天'
]

// Public template reference calendar.
// 当前站点只保留第一个可执行签到，用作“第一天猜谜语签到”的入口。
export const dailyAdventures = [
  {
    day: 300,
    date: '2026-08-09',
    title: '300Days · 谜语签到',
    icon: '🧭',
    type: 'memoryPuzzle',
    theme: '从第一次一起散步开始',
    reward: '打开属于你我的第 300 天纪念日签到',
    prompt: '你还记得我们第一次走过这片会发光的地方吗？它是我们第一次约会的地方',
    secret: '这是我们在日子里慢慢留下的第一个记号。',
    answer: '郑州二砂文化创意园',
    image: '/images/二砂.jpg',
    memoryTitle: '第一次一起散步',
    memoryCaption: '那天我们从记忆里走出来，开始把未来也一起记住。',
    chatMessages: [
      { side: 'me', text: '你还记得那天我们一起散步吗？' },
      { side: 'her', text: '记得呀，那个地方像一段我们都还没有翻完的故事。' },
      { side: 'me', text: '我想把它先写成今天的谜语。' },
      { side: 'me', text: '今天开始，我们把日子慢慢记下来。' }
    ]
  }
]
