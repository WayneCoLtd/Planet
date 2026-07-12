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
// The five retained cases are intentionally non-contiguous: 01, 02, 03, 05, and 08.
// Every other day is deliberately left empty for the next creator to develop.
export const dailyAdventures = [
  {
    day: 1,
    date: '2026-05-20',
    title: '00:00的谜题',
    icon: '🍊',
    type: 'memoryPuzzle',
    theme: '午夜剧场',
    reward: '答对后打开那一晚的聊天小窗',
    prompt: '',
    secret: '苦尽柑来遇见你',
    answer: '苦尽柑来遇见你',
    image: '/images/20250520.jpg',
    memoryTitle: '2025.05.20 · 00:00 · 线上一起看剧',
    memoryCaption: '那一秒刚好落在 520，像剧情偷偷替我们按下了甜甜的暂停键。',
    chatMessages: [
      { side: 'me', text: '好绝的打光!' },
      { side: 'her', text: '甜死了' },
      { side: 'her', text: '你居然在刚到 520 看到这里' },
      { side: 'her', text: '羡慕' },
      { side: 'me', text: '什么 注定的救赎感' },
      { side: 'me', text: '!' },
      { side: 'me', text: '哦莫' }
    ]
  },
  {
    day: 2,
    date: '2026-05-21',
    title: '521 连续谜题',
    icon: '🎆',
    type: 'serialRiddleFirework',
    theme: '卡通解谜 · 专属烟花',
    reward: '通关后燃放“小翟521快乐”烟花',
    prompt: '连续解开三张谜题卡，收集烟花、火柴盒和火柴，最后亲手点燃专属烟花。',
    secret: '小翟521快乐',
    image: '/images/day2-riddle-20250521.jpg'
  },
  {
    day: 3,
    date: '2026-05-22',
    title: '522 奶泡心情馆',
    icon: '☕',
    type: 'foamDrawingReview',
    theme: '卡布奇诺涂鸦',
    reward: '通过后会留下新的小道具',
    prompt: '那天它本来只是一杯卡布奇诺。',
    secret: '奶泡小钥匙',
    originalImage: '/images/day3-cappuccino-original-20250522.jpg',
    smileReference: '/images/day3-cappuccino-smile-20250522.jpg',
    heartReference: '/images/day3-cappuccino-heart-20250522.jpg'
  },
  {
    day: 5,
    date: '2026-05-24',
    title: '524 小柚子的黑暗迷宫',
    icon: '🕯️',
    type: 'darkMazeTransition',
    theme: '黑暗迷宫 · 星际转场',
    reward: '打开通往星际旅行的新门',
    prompt: '带上 521 的火柴与 522 的钥匙，点亮火把，走出迷宫。',
    secret: '木门后的银河会把米柚星球切换到新的星际主题。'
  },
  {
    day: 8,
    date: '2026-05-27',
    title: '527 来自 1 光年的信号',
    icon: '✨',
    type: 'oneLightYearSignal',
    theme: '一束走了一年的微光',
    reward: '获得 5.09 点星光',
    prompt: '在星际主题下打开观测窗口，清开烦恼云，找回 5 颗星星和最后 0.09 点自己的光。',
    secret: '去年今天发出的光，走了一整年，刚好抵达这里。'
  }
]
