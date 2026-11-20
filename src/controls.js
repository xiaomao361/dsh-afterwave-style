import { getPrefs } from './prefs.js'

const openPanels = new WeakMap()
const mounts = new WeakMap()
const switches = [
  ['focus', '专注模式'], ['widget', '会话角落挂件'], ['glass', '毛玻璃效果'],
  ['sound', '离开声音提醒'], ['notifications', '桌面通知'],
]

export function mountControls(win) {
  const prefs = getPrefs(win)
  const root = win.document.documentElement
  const owner = {}
  mounts.set(win, owner)
  function paint(key) {
    if (mounts.get(win) !== owner) return
    if (!key || key === 'focus') root.dataset.awFocus = prefs.get('focus') ? 'on' : 'off'
    if (!key || key === 'glass') root.dataset.awGlass = prefs.get('glass') ? 'on' : 'off'
    if (!key || key === 'opacity') root.style.setProperty('--aw-portrait-opacity', Math.min(100, Math.max(0, Number(prefs.get('opacity')) || 0)) / 100)
  }
  paint()
  const unsubscribe = prefs.subscribe(paint)
  return () => {
    unsubscribe()
    if (mounts.get(win) !== owner) return
    mounts.delete(win)
    openPanels.get(win)?.close(false)
    delete root.dataset.awFocus
    delete root.dataset.awGlass
    root.style.removeProperty('--aw-portrait-opacity')
  }
}

export function applyControls(ctx, win) {
  return ctx.effect(() => mountControls(win))
}

export async function compressPortrait(file, win) {
  if (!file || !file.type.startsWith('image/')) throw Error('请选择本地图片文件。')
  const url = win.URL.createObjectURL(file)
  try {
    const image = new win.Image()
    image.src = url
    await image.decode()
    if (!(image.naturalWidth && image.naturalHeight)) throw Error()
    const scale = Math.min(1, 420 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = win.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/webp', .86)
    if (!/^data:image\/(png|webp);base64,.+/.test(result)) throw Error()
    return result
  } catch { throw Error('这张图片无法解码，请选择 PNG、JPEG 或 WebP 图片。') }
  finally { win.URL.revokeObjectURL(url) }
}

export function showControls(anchor) {
  if (!anchor?.isConnected) return
  const doc = anchor.ownerDocument
  const win = doc.defaultView
  const prefs = getPrefs(win)
  const previous = openPanels.get(win)
  if (previous) {
    previous.close(previous.anchor === anchor)
    if (previous.anchor === anchor) return
  }
  const controller = new win.AbortController()
  const listen = (node, type, fn, extra) => node.addEventListener(type, fn, {signal: controller.signal, ...extra})
  function el(tag, className, text) {
    const node = doc.createElement(tag)
    node.className = className
    if (text) node.textContent = text
    if (tag === 'button') node.type = 'button'
    return node
  }
  const panel = el('section', 'aw-controls')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', '工装设置')
  const head = el('header', 'aw-controls-head')
  const closeButton = el('button', 'aw-ctrl-close', '×')
  closeButton.setAttribute('aria-label', '关闭工装设置')
  head.append(el('h2', '', '工装设置'), closeButton)
  const note = el('p', 'aw-controls-note')
  note.setAttribute('role', 'status')
  panel.append(head)
  const inputs = new Map()
  const resetDock = el('button', 'aw-ctrl-reset-dock', '复位挂件位置')
  listen(resetDock, 'click', () => {
    const durable = prefs.remove('widgetPos')
    note.textContent = durable ? '挂件已回到默认位置。' : '此窗口已复位挂件位置，本机存储不可用。'
    inputs.get('widget').focus({preventScroll:true})
  })
  function save(key, value) {
    const persist = prefs.set(key, value)
    note.textContent = persist ? '' : '本机存储不可用，设置仅在此窗口生效。'
    return persist
  }
  for (const [key, label] of switches) {
    const row = el('label', 'aw-ctrl-row')
    const input = el('input', 'aw-ctrl-toggle')
    input.type = 'checkbox'
    input.setAttribute('role', 'switch')
    input.setAttribute('aria-label', label)
    inputs.set(key, input)
    row.append(el('span', '', label), input)
    panel.append(row)
    if (key === 'widget') panel.append(resetDock)
    listen(input, 'change', async () => {
      const enabled = input.checked
      if (key === 'notifications' && enabled) {
        const api = win.Notification
        let grant = api?.permission
        if (grant === 'default' && typeof api.requestPermission === 'function') {
          input.disabled = true
          try { grant = await api.requestPermission() } catch { grant = 'unavailable' }
          if (controller.signal.aborted) return
          input.disabled = false
        }
        if (grant !== 'granted') {
          save(key, false)
          note.textContent = grant === 'denied' ? '通知权限已被拒绝，可在浏览器或系统设置中修改。'
            : grant === 'default' ? '未授予通知权限，桌面通知已关闭。' : '当前环境不支持桌面通知。'
          return
        }
      }
      save(key, enabled)
      if (key === 'sound' && enabled) win.dispatchEvent(new win.Event('aw-unlock-sound'))
    })
  }
  const opacity = el('label', 'aw-ctrl-opacity')
  const opacityText = el('output', '')
  const slider = el('input', '')
  slider.type = 'range'; slider.min = '0'; slider.max = '100'
  slider.setAttribute('aria-label', '首页立绘透明度')
  opacity.append(el('span', '', '首页立绘透明度'), opacityText, slider)
  const art = el('div', 'aw-ctrl-art')
  const file = el('input', '')
  file.type = 'file'; file.accept = 'image/*'; file.hidden = true
  file.setAttribute('aria-label', '选择本地立绘')
  const upload = el('button', '', '更换立绘')
  const reset = el('button', '', '恢复默认立绘')
  art.append(upload, reset, file)
  panel.append(opacity, art, note)
  doc.body.append(panel)
  anchor.setAttribute('aria-expanded', 'true')
  let generation = 0
  function refresh(key) {
    if (!key || key === 'widgetPos') resetDock.hidden = !prefs.get('widgetPos')
    if (!key || inputs.has(key)) for (const [name, input] of inputs) input.checked = Boolean(prefs.get(name))
    if (!key || key === 'opacity') {
      slider.value = String(prefs.get('opacity'))
      opacityText.textContent = slider.value + '%'
    }
    if (!key || key === 'portrait') {
      generation++
      reset.disabled = !prefs.get('portrait')
    }
  }
  if (prefs.get('notifications') && win.Notification?.permission !== 'granted') {
    prefs.set('notifications', false)
    note.textContent = win.Notification ? '桌面通知授权已失效，提醒已关闭。' : '当前环境不支持桌面通知。'
  }
  refresh()
  const unsubscribe = prefs.subscribe(refresh)
  listen(slider, 'input', () => save('opacity', Number(slider.value)))
  listen(upload, 'click', () => file.click())
  listen(file, 'change', async () => {
    const selected = file.files?.[0]
    file.value = ''
    if (!selected) return
    const request = ++generation
    try {
      const data = await compressPortrait(selected, win)
      if (request !== generation || controller.signal.aborted) return
      note.textContent = save('portrait', data) ? '已更换首页立绘。' : '图片过大无法持久化，已仅在本次会话生效。'
    } catch (error) { if (request === generation && !controller.signal.aborted) note.textContent = error.message }
  })
  listen(reset, 'click', () => {
    note.textContent = prefs.remove('portrait') ? '已恢复默认立绘。' : '此窗口已恢复默认立绘，本机存储不可用。'
  })
  function position() {
    if (!anchor.isConnected) { close(false); return }
    const box = anchor.getBoundingClientRect()
    const roomBelow = win.innerHeight - box.bottom - 8
    const top = roomBelow >= panel.offsetHeight || roomBelow > box.top ? box.bottom + 6 : box.top - panel.offsetHeight - 6
    panel.style.left = Math.max(8, Math.min(win.innerWidth - panel.offsetWidth - 8, box.right - panel.offsetWidth)) + 'px'
    panel.style.top = Math.max(8, Math.min(win.innerHeight - panel.offsetHeight - 8, top)) + 'px'
  }
  const observer = new win.MutationObserver(() => { if (!anchor.isConnected) close(false) })
  observer.observe(doc.body, {subtree:true, childList:true})
  function close(restore) {
    if (controller.signal.aborted) return
    controller.abort()
    observer.disconnect()
    resize?.disconnect()
    unsubscribe()
    panel.remove()
    anchor.setAttribute('aria-expanded', 'false')
    openPanels.delete(win)
    if (restore && anchor.isConnected) anchor.focus({preventScroll:true})
  }
  const resize = win.ResizeObserver ? new win.ResizeObserver(position) : null
  resize?.observe(panel)
  listen(closeButton, 'click', () => close(true))
  listen(doc, 'pointerdown', e => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(false) }, {capture:true})
  listen(doc, 'keydown', e => {
    if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); close(true) }
  }, {capture:true})
  listen(win, 'resize', position)
  listen(doc, 'scroll', position, {capture:true, passive:true})
  openPanels.set(win, {anchor, close})
  position()
  closeButton.focus({preventScroll:true})
}
