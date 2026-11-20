const PREFIX = 'dsh-afterwave-style.'
const defaults = {focus: false, widget: true, sound: false, notifications: false, glass: true, opacity: 100, portrait: ''}
const stores = new WeakMap()

export function getPrefs(win) {
  if (stores.has(win)) return stores.get(win)
  // Keep only writes rejected by storage here. Reading successful writes back
  // from storage also picks up other windows' changes between subscriptions.
  const transient = new Map()
  const removed = Symbol('removed')
  const listeners = new Set()
  const decode = raw => {
    try { return JSON.parse(raw) } catch { return raw }
  }
  function get(key, fallback = Object.hasOwn(defaults, key) ? defaults[key] : undefined) {
    if (transient.has(key)) return transient.get(key) === removed ? fallback : transient.get(key)
    try {
      const raw = win.localStorage.getItem(PREFIX + key)
      return raw == null ? fallback : decode(raw)
    } catch { return fallback }
  }
  function notify(key) {
    const value = key === null ? undefined : get(key)
    for (const listener of listeners) listener(key, value)
  }
  function write(key, value) {
    let saved = true
    try {
      if (value === removed) win.localStorage.removeItem(PREFIX + key)
      else win.localStorage.setItem(PREFIX + key, JSON.stringify(value))
      transient.delete(key)
    } catch {
      transient.set(key, value)
      saved = false
    }
    notify(key)
    return saved
  }
  function storage(event) {
    try { if (event.storageArea && event.storageArea !== win.localStorage) return } catch { return }
    if (event.key === null) { transient.clear(); notify(null); return }
    if (!event.key.startsWith(PREFIX)) return
    const key = event.key.slice(PREFIX.length)
    transient.delete(key)
    notify(key)
  }
  const store = {
    get, set: write, remove: key => write(key, removed),
    keys(prefix = '') {
      const result = new Set()
      try {
        const storage = win.localStorage
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (key?.startsWith(PREFIX + prefix)) result.add(key.slice(PREFIX.length))
        }
      } catch {}
      for (const [key, value] of transient) {
        if (key.startsWith(prefix)) value === removed ? result.delete(key) : result.add(key)
      }
      return [...result]
    },
    subscribe(listener) {
      if (!listeners.size) win.addEventListener('storage', storage)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) win.removeEventListener('storage', storage)
      }
    },
  }
  stores.set(win, store)
  return store
}
