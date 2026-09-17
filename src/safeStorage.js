// 存储安全层。
//
// 背景：Safari（阻止 Cookie、旧版无痕模式）以及浏览器存储写满时，
// localStorage / sessionStorage 的读写会直接抛异常。站点里有上百处直接
// 使用这两个接口的地方，一旦其中任意一处抛异常，整个 React 渲染就会崩掉，
// 表现就是白屏或“数据一直加载不出来”。
//
// 这里做两件事：
// 1) installStorageGuard()：给 Storage 原型包一层保护，任何读写失败都退化成
//    “没读到 / 没写进去”，只影响那次读写，绝不影响页面继续运行。
// 2) 导出显式助手，供新代码表达意图；助手连属性访问本身也做了保护。
//
// 正常情况下这一层完全无感：读写成功时行为和原来一模一样。

let guardInstalled = false

const STORAGE_KINDS = ['localStorage', 'sessionStorage']

// 存储完全不可用时的兜底：本次会话照常读写，只是关掉页面就没了。
// 比“点了没反应 / 直接白屏”要好得多。
function createMemoryStorage() {
  const map = new Map()
  return {
    get length() { return map.size },
    key(index) { return Array.from(map.keys())[index] ?? null },
    getItem(key) { const name = String(key); return map.has(name) ? map.get(name) : null },
    setItem(key, value) { map.set(String(key), String(value)) },
    removeItem(key) { map.delete(String(key)) },
    clear() { map.clear() }
  }
}

function getStorage(kind) {
  if (typeof window === 'undefined') return null
  try {
    const storage = window[kind]
    if (storage) return storage
  } catch {}
  // 访问 window.localStorage 本身就会抛异常（Safari 阻止所有 Cookie 时的行为），
  // 这时换成内存版实现，让页面继续可用。
  const shim = createMemoryStorage()
  try {
    Object.defineProperty(window, kind, { configurable: true, get: () => shim })
    return shim
  } catch {}
  return null
}

export function installStorageGuard() {
  if (guardInstalled || typeof window === 'undefined') return
  guardInstalled = true
  const patchedPrototypes = new Set()
  for (const kind of STORAGE_KINDS) {
    const storage = getStorage(kind)
    if (!storage) continue
    let proto
    try {
      proto = Object.getPrototypeOf(storage)
    } catch {
      continue
    }
    // 内存兜底对象的原型是 Object.prototype，绝不能去改写它。
    if (!proto || proto === Object.prototype || patchedPrototypes.has(proto)) continue
    patchedPrototypes.add(proto)
    // 读方法失败时返回 null，写方法失败时静默放弃，语义和“存储不可用”一致。
    const methodFallbacks = [['getItem', null], ['setItem', undefined], ['removeItem', undefined], ['clear', undefined], ['key', null]]
    for (const [method, fallback] of methodFallbacks) {
      const original = proto[method]
      if (typeof original !== 'function') continue
      try {
        Object.defineProperty(proto, method, {
          configurable: true,
          writable: true,
          value: function guardedStorageMethod(...args) {
            try {
              return original.apply(this, args)
            } catch {
              return fallback
            }
          }
        })
      } catch {
        // 个别环境不允许改写原型，忽略即可。
      }
    }
  }
}

export function safeGetItem(key, fallback = null, kind = 'localStorage') {
  const storage = getStorage(kind)
  if (!storage) return fallback
  try {
    const value = storage.getItem(key)
    return value === null || value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

export function safeSetItem(key, value, kind = 'localStorage') {
  const storage = getStorage(kind)
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemoveItem(key, kind = 'localStorage') {
  const storage = getStorage(kind)
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
