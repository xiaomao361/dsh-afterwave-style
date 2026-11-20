import { playMechanicalClick } from './sound.js'
import { toggleScratchpad } from './scratchpad.js'
import { showPalette } from './palette.js'
import { getDockTimer, formatClock } from './timer.js'

const statusDetails = {
  idle: ['待机', '待命中，随时开干！'],
  thinking: ['正在思考', '戴上护目镜看图纸中…'],
  working: ['正在输出', '全速敲代码中！'],
  busy: ['任务进行中', '全速敲代码中！'],
  tool: ['正在调用工具', '抡起扳手调工具中…'],
  waiting: ['等待你操作', '审批单在这儿，等你确认！'],
  error: ['任务出错', '冒烟啦，来看看报错信息！'],
  unknown: ['状态未知', '正在接入会话状态…'],
}
const activeStates = new Set(['thinking', 'working', 'busy', 'tool'])
const alertNames = { waiting: '等待你操作', idle: '任务完成', error: '任务出错' }
const pitches = { waiting: [640, 820], idle: [460, 610], error: [490, 340] }

export function stickerState(status) {
  if (status === 'busy') return 'working'
  return Object.hasOwn(statusDetails, status) && status !== 'unknown' ? status : 'idle'
}

export function alertTransition(previous, next, hidden) {
  if (!previous || previous === 'unknown' || previous === next) return false
  return next === 'waiting' || (hidden && activeStates.has(previous) && (next === 'idle' || next === 'error'))
}

// One unlocked context per window, including gestures on the new-session page.
export function createReminders(doc, prefs) {
  const win = doc.defaultView
  const notifications = new Set()
  let audio
  let destroyed = false
  function unlock(event) {
    if (destroyed || audio?.state === 'running' || (!event.isTrusted && !(event.type === 'aw-unlock-sound' && win.navigator.userActivation?.isActive)) || !prefs.get('sound')) return
    const Audio = win.AudioContext ?? win.webkitAudioContext
    if (!Audio) return
    try {
      audio ??= new Audio()
      if (audio.state !== 'running') audio.resume().catch(() => {})
    } catch { /* Audio output can be unavailable on headless hosts. */ }
  }
  function sound(status) {
    if (!prefs.get('sound') || audio?.state !== 'running') return
    for (const [index, hz] of pitches[status].entries()) {
      const start = audio.currentTime + index * .13
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = hz
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(.037, start + .012)
      gain.gain.exponentialRampToValueAtTime(.0001, start + .095)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      oscillator.start(start)
      oscillator.stop(start + .1)
    }
  }
  win.addEventListener('aw-unlock-sound', unlock)
  doc.addEventListener('click', unlock)
  doc.addEventListener('keydown', unlock)
  function disconnectAudio() {
    audio?.close().catch(() => {})
    audio = undefined
  }
  const stop = prefs.subscribe(key => {
    if ((key === null || key === 'sound') && !prefs.get('sound')) disconnectAudio()
  })
  return {
    transition(previous, next, sessionTitle, coarse = false) {
      if (destroyed || !alertTransition(previous, next, doc.hidden)) return
      try { sound(next) } catch { /* Unsupported audio must not interrupt chat. */ }
      if (!doc.hidden || !prefs.get('notifications') || win.Notification?.permission !== 'granted') return
      try {
        const headline = coarse && next === 'idle' ? '任务已结束' : alertNames[next]
        const notice = new win.Notification('工作台 · ' + headline, { body: sessionTitle || '当前会话', silent: true })
        notifications.add(notice)
        notice.onclose = () => notifications.delete(notice)
      } catch { /* Some webviews expose Notification without a usable constructor. */ }
    },
    destroy() {
      destroyed = true
      win.removeEventListener('aw-unlock-sound', unlock)
      doc.removeEventListener('click', unlock)
      doc.removeEventListener('keydown', unlock)
      stop()
      disconnectAudio()
      for (const notice of notifications) notice.close()
      notifications.clear()
    },
  }
}

function control(doc, className, text = '') {
  const el = doc.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = text
  return el
}

function picture(doc, className) {
  const el = doc.createElement('img')
  el.className = className
  el.alt = ''
  el.draggable = false
  return el
}

const remarks = {
  idle: ['船坞整备完毕，随时可以出航！', '螺丝都拧紧了，今天准备修哪块代码？', '别戳我护目镜啦，会留指纹的！', '要不要顺手检查下上下文燃料表？', '呆毛雷达扫描中…一切正常！'],
  thinking: ['护目镜拉下来了，正在读图纸…', '别急，齿轮正在全速咬合！', '方案推演中，等我算完这步。', '图纸先别收，我在核对尺寸。'],
  working: ['键盘敲冒烟了，全力输出中！', '焊花四溅，别靠太近哦！', '正在把代码一块块铆上去！', '焊缝还热着，马上就好。'],
  tool: ['32 号扳手上场，正在拧工具管道！', '正在调用外部机具，稳住别晃！', '工具箱全开，马上搞定！', '工具已接到动力接口，等返回读数。'],
  waiting: ['审批单在这儿，等你盖章才能继续！', '机甲卡在确认闸口啦，快来看看！', '黄灯闪起来了，需要你拍板！', '我把扳手放下了，等你的指令。'],
  error: ['冒烟啦！快拉电闸看日志！', '别慌，先拿扳手查第一行报错！', '装甲受损，需要人工介入排查！', '红灯亮了，看看刚才那条报错。'],
  unknown: ['仪表还在接线，等一个读数。', '正在接入会话状态…', '护目镜已戴好，信号还没到。', '状态线还没接通，再等一下。'],
}
const stickerSize = 56
const margin = 8
const clamp = (n, low, high) => Math.min(Math.max(n, low), Math.max(low, high))

function dockRange(win) {
  return {x: Math.max(1, win.innerWidth - stickerSize - 2 * margin), y: Math.max(1, win.innerHeight - stickerSize - 2 * margin)}
}
function savedPoint(win, prefs) {
  const pos = prefs.get('widgetPos')
  if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) return null
  const range = dockRange(win)
  return {x: margin + clamp(pos.x, 0, 1) * range.x, y: margin + clamp(pos.y, 0, 1) * range.y}
}

// The pointer stays captured while crossing siblings or moving beyond the viewport.
// Persist only the released position. Canceled gestures leave the saved dock intact.
function attachDockDrag(win, sticker, dock, prefs, move, refresh, closeTools, signal) {
  let gesture
  let suppressClick = false
  function remember(point) {
    const range = dockRange(win)
    prefs.set('widgetPos', {x: (point.x - margin) / range.x, y: (point.y - margin) / range.y})
  }
  function release(commit) {
    if (!gesture) return
    const {id, point, dragging} = gesture
    gesture = undefined
    delete dock.dataset.dragging
    if (sticker.hasPointerCapture?.(id)) sticker.releasePointerCapture(id)
    if (dragging) {
      suppressClick = true
      if (commit) {
        const range = dockRange(win)
        const snap = (at, span) => at <= margin + 12 ? margin : at >= margin + span - 12 ? margin + span : at
        remember(move(snap(point.x, range.x), snap(point.y, range.y)))
      } else refresh()
    }
  }
  sticker.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.isPrimary === false || gesture) return
    suppressClick = false
    const x = parseFloat(dock.style.left)
    const y = parseFloat(dock.style.top)
    gesture = {id:e.pointerId, x, y, clientX:e.clientX, clientY:e.clientY, point:{x,y}, dragging:false}
    if (e.isTrusted) sticker.setPointerCapture?.(e.pointerId)
  }, {signal})
  function advance(e) {
    if (!gesture || gesture.id !== e.pointerId) return
    const dx = e.clientX - gesture.clientX
    const dy = e.clientY - gesture.clientY
    if (!gesture.dragging) {
      if (Math.hypot(dx, dy) <= 6) return
      gesture.dragging = true
      dock.dataset.dragging = ''
      closeTools()
    }
    gesture.point = move(gesture.x + dx, gesture.y + dy)
  }
  win.addEventListener('pointermove', advance, {signal})
  win.addEventListener('pointerup', e => {
    if (gesture?.id !== e.pointerId) return
    advance(e)
    release(true)
  }, {signal})
  for (const type of ['pointercancel', 'lostpointercapture']) {
    win.addEventListener(type, e => { if (gesture?.id === e.pointerId) release(false) }, {signal})
  }
  win.addEventListener('blur', () => release(false), {signal})
  sticker.addEventListener('keydown', e => {
    // Keyboard users can reposition the sticker without starting a drag.
    const step = 24
    const directions = {ArrowUp:[0,-step], ArrowDown:[0,step], ArrowLeft:[-step,0], ArrowRight:[step,0]}
    if (!Object.hasOwn(directions, e.key) || e.altKey || e.ctrlKey || e.metaKey) return
    const [dx, dy] = directions[e.key]
    e.preventDefault()
    remember(move(parseFloat(dock.style.left) + dx, parseFloat(dock.style.top) + dy))
  }, {signal})
  return {
    get moving() { return Boolean(gesture?.dragging) },
    cancel() { release(false) },
    consumed(event) {
      const consumed = suppressClick && (event.detail > 0 || Boolean(event.pointerType))
      suppressClick = false
      return consumed
    },
  }
}

let menuSequence = 0
function createDockMenu(doc, dock, sticker, actions, position, signal) {
  const trigger = control(doc, 'aw-dock-tools')
  trigger.title = '挂件工具盘'
  trigger.setAttribute('aria-label', trigger.title)
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  const menu = doc.createElement('div')
  menu.className = 'aw-dock-menu'
  menu.id = 'aw-dock-menu-' + ++menuSequence
  menu.hidden = true
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', trigger.title)
  trigger.setAttribute('aria-controls', menu.id)
  const buttons = new Map()
  for (const [id, label, icon] of [
    ['waiting', '待审批会话', '↗'], ['quip', '换一句台词', '✦'],
    ['scratchpad', '堆叠便签', '▤'], ['timer', '值班番茄钟', '◷'], ['palette', '指令台 Ctrl+K', '⌘'],
    ['settings', '工装设置', '⚙'], ['reset', '复位位置', '↶'], ['hide', '收起挂件', '−'],
  ]) {
    const item = control(doc, 'aw-dock-menu-item')
    item.dataset.action = id
    item.setAttribute('role', 'menuitem')
    item.tabIndex = -1
    const glyph = doc.createElement('span')
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = icon
    item.append(glyph, doc.createTextNode(label))
    item.addEventListener('click', () => {
      close(true)
      actions[id]()
    }, {signal})
    menu.append(item)
    buttons.set(id, item)
  }
  if (!actions.settings) buttons.get('settings').hidden = true
  dock.append(trigger, menu)
  let returnTo
  const enabled = () => [...buttons.values()].filter(el => !el.disabled && !el.hidden)
  function open(target, last = false) {
    returnTo = target
    menu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    position(menu)
    enabled().at(last ? -1 : 0)?.focus({preventScroll:true})
  }
  function close(restore) {
    if (menu.hidden) return
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (restore) returnTo?.focus({preventScroll:true})
  }
  trigger.addEventListener('click', () => menu.hidden ? open(trigger) : close(true), {signal})
  trigger.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      open(trigger, e.key === 'ArrowUp')
    }
  }, {signal})
  sticker.addEventListener('contextmenu', e => {
    e.preventDefault()
    open(sticker)
  }, {signal})
  menu.addEventListener('keydown', e => {
    const items = enabled()
    const index = items.indexOf(doc.activeElement)
    let next
    if (e.key === 'ArrowDown') next = (index + 1) % items.length
    else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Tab') { close(true); return }
    else return
    e.preventDefault()
    items[next]?.focus({preventScroll:true})
  }, {signal})
  doc.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) {
      e.stopPropagation()
      e.preventDefault()
      close(true)
    }
  }, {signal, capture:true})
  function dismiss(e) { if (!dock.contains(e.target)) close(false) }
  doc.addEventListener('pointerdown', dismiss, {signal, capture:true})
  doc.addEventListener('focusin', dismiss, {signal})
  return {
    menu, close,
    update(count, moved) {
      const waiting = buttons.get('waiting')
      waiting.disabled = !actions.waiting || !count
      waiting.lastChild.textContent = count ? '待审批会话 · ' + count : '暂无待审批会话'
      buttons.get('reset').disabled = !moved
      if (!menu.hidden && doc.activeElement?.disabled && menu.contains(doc.activeElement)) enabled()[0]?.focus()
    },
  }
}

function createDock(doc, holder, chip, prefs, onOpenSession, showControls) {
  const win = doc.defaultView
  const controller = new win.AbortController()
  const signal = controller.signal
  const dock = doc.createElement('div')
  dock.className = 'aw-companion-dock'
  dock.hidden = true
  const sticker = control(doc, 'aw-dock-sticker')
  sticker.title = '摸摸鲸鱼娘 · 拖动可移位'
  sticker.setAttribute('aria-label', '摸摸鲸鱼娘')
  sticker.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight')
  const image = picture(doc, 'aw-dock-image')
  sticker.append(image)
  const bubble = doc.createElement('span')
  bubble.className = 'aw-dock-bubble'
  bubble.setAttribute('role', 'status')
  bubble.hidden = true
  dock.append(sticker, bubble)
  let current = 'unknown', phraseIndex = 0, taps = []
  let waiting = {count:0}, timer, frame, region, card
  const resize = win.ResizeObserver && new win.ResizeObserver(schedule)
  const mutations = win.MutationObserver && new win.MutationObserver(() => {
    if (!card?.isConnected) schedule()
  })
  const tools = createDockMenu(doc, dock, sticker, {
    waiting: onOpenSession && (() => { if (waiting.next && holder.isConnected) onOpenSession(waiting.next.id) }),
    quip: () => { playMechanicalClick(win, prefs); pet(false) },
    scratchpad: () => toggleScratchpad(win, sticker),
    timer: () => getDockTimer(win).openPanel(sticker),
    palette: () => showPalette(win, sticker),
    settings: showControls && (() => showControls(chip)),
    reset: () => prefs.remove('widgetPos'),
    hide: () => { prefs.set('widget', false); chip.focus({preventScroll:true}) },
  }, positionOverlay, signal)
  win.addEventListener('aw-timer-done', event => {
    const { label, task, isBreak } = event?.detail || {}
    const msg = isBreak
      ? '短休结束啦，回船坞继续开工！'
      : (task ? `「${task}」到点啦，起来喝口水歇歇眼！` : `${label || '值班专注'}到点啦！起来喝口水活动下颈椎！`)
    speak(msg, 5000)
  }, {signal})
  const drag = attachDockDrag(win, sticker, dock, prefs, place, schedule, () => {
    tools.close(false)
    bubble.hidden = true
  }, signal)

  function positionOverlay(el) {
    if (el.hidden || dock.hidden) return
    const x = parseFloat(dock.style.left), y = parseFloat(dock.style.top)
    const width = el.offsetWidth, height = el.offsetHeight
    const left = clamp(x + stickerSize - width, margin, win.innerWidth - width - margin)
    const above = y - height - 6
    const top = above >= margin ? above : clamp(y + stickerSize + 6, margin, win.innerHeight - height - margin)
    el.style.left = (left - x) + 'px'
    el.style.top = (top - y) + 'px'
  }
  function place(left, top) {
    const range = dockRange(win)
    const x = clamp(left, margin, margin + range.x), y = clamp(top, margin, margin + range.y)
    dock.style.left = x + 'px'
    dock.style.top = y + 'px'
    positionOverlay(tools.menu)
    positionOverlay(bubble)
    return {x, y}
  }
  function retract() {
    if (dock.contains(doc.activeElement) && chip.isConnected) chip.focus({preventScroll:true})
    drag.cancel()
    tools.close(false)
    dock.hidden = true
    bubble.hidden = true
  }
  function measure() {
    frame = undefined
    const main = holder.closest('[data-phase]') ?? holder.closest('[data-slot="main.conversation"]')
    if (!holder.isConnected || !main || !prefs.get('widget') || prefs.get('focus')) { retract(); return }
    if (region !== main) {
      region = main
      mutations?.disconnect()
      mutations?.observe(region, { childList: true, subtree: true })
      resize?.disconnect()
      resize?.observe(main)
      card = undefined
    }
    const next = card?.isConnected && region.contains(card) ? card : [...region.querySelectorAll('[data-composer-card]')].find(el => !el.closest('[data-conversation-content]')?.parentElement.closest('[data-conversation-content]'))
    if (card !== next) { if (card) resize?.unobserve(card); card = next; if (card) resize?.observe(card) }
    if (!card) { retract(); return }
    const rect = main.getBoundingClientRect(), editor = card.getBoundingClientRect()
    const edge = Math.min(rect.right, win.innerWidth)
    const top = Math.min(editor.bottom, rect.bottom, win.innerHeight) - 62
    // On compact layouts the header keeps the same state visible and leaves
    // the native editor, approval pane and transcript fully usable.
    if (edge - editor.right < 76 || editor.width < 1 || top < Math.max(editor.top, rect.top)) { retract(); return }
    dock.hidden = false
    if (drag.moving) return
    const pos = savedPoint(win, prefs)
    dock.style.setProperty('--aw-bubble-width', (pos ? 185 : Math.min(185, edge - editor.right - 12)) + 'px')
    place(pos?.x ?? edge - 64, pos?.y ?? top)
  }
  function schedule() {
    if (!signal.aborted && frame === undefined) frame = win.requestAnimationFrame ? win.requestAnimationFrame(measure) : win.setTimeout(measure, 0)
  }
  function speak(text, delay) {
    if (dock.hidden || !tools.menu.hidden || drag.moving) return
    bubble.textContent = text
    bubble.hidden = false
    positionOverlay(bubble)
    win.clearTimeout(timer)
    timer = win.setTimeout(() => { bubble.hidden = true }, delay)
  }
  function pet(countTap) {
    if (dock.hidden || drag.moving) return
    tools.close(false)
    const pool = remarks[current === 'busy' ? 'working' : current]
    const now = win.performance.now()
    taps = taps.filter(stamp => now - stamp <= 5000)
    if (countTap) taps.push(now)
    const bonus = countTap && taps.length >= 5
    if (bonus) taps = []
    speak(bonus ? '整备度 120%！再点要收加班费了哦！' : pool[phraseIndex++ % pool.length], 3200)
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // Rewind an in-flight bounce. A completed one drops its data attribute
    // in animationend, so a later tap starts a fresh animation.
    sticker.dataset.bounce = bonus ? 'bonus' : 'normal'
    const name = bonus ? 'aw-dock-bonus' : 'aw-dock-bounce'
    const animation = sticker.getAnimations?.().find(item => item.animationName === name)
    if (animation) animation.currentTime = 0
  }
  sticker.addEventListener('animationend', event => {
    if (event.target === sticker) delete sticker.dataset.bounce
  }, {signal})
  sticker.addEventListener('click', event => { if (!drag.consumed(event)) pet(true) }, {signal})
  sticker.addEventListener('pointerenter', () => speak(statusDetails[current][1], 2500), {signal})
  sticker.addEventListener('focus', () => speak(statusDetails[current][1], 2500), {signal})
  doc.body.append(dock)
  win.addEventListener('resize', schedule, {signal})
  return {
    update(status, src, changed, nextWaiting, sessionChanged) {
      if (current !== status || sessionChanged) {
        const pool = remarks[status === 'busy' ? 'working' : status]
        phraseIndex = Math.floor(Math.random() * pool.length)
      }
      if (sessionChanged) { taps = []; tools.close(false); bubble.hidden = true; drag.cancel() }
      current = status
      waiting = nextWaiting
      dock.dataset.status = status
      if (image.getAttribute('src') !== (src || null)) {
        if (src) image.src = src
        else image.removeAttribute('src')
      }
      tools.update(waiting.count, Boolean(savedPoint(win, prefs)))
      if (changed) speak(statusDetails[status][1], 2500)
      schedule()
    },
    refresh() {
      if (!prefs.get('widget') || prefs.get('focus')) retract()
      tools.update(waiting.count, Boolean(savedPoint(win, prefs)))
      schedule()
    },
    destroy() {
      controller.abort()
      drag.cancel()
      mutations?.disconnect()
      resize?.disconnect()
      if (frame !== undefined) {
        if (win.cancelAnimationFrame) win.cancelAnimationFrame(frame)
        else win.clearTimeout(frame)
      }
      win.clearTimeout(timer)
      dock.remove()
    },
  }
}

export function nextWaiting(sessions, currentId) {
  const waiting = sessions.filter(row => row.waiting && row.id !== currentId)
  // IDs are stable as sessions change status or get new update timestamps.
  waiting.sort((a, b) => a.id.localeCompare(b.id))
  return { count: waiting.length, next: waiting.find(row => currentId && row.id.localeCompare(currentId) > 0) ?? waiting[0] }
}

export function createCompanion(doc, { assets, prefs, onOpenSession, showControls, reminders }) {
  const panel = doc.createElement('span')
  panel.className = 'aw-companion'
  const chip = control(doc, 'aw-monitor')
  chip.setAttribute('aria-expanded', 'false')
  const image = picture(doc, 'aw-monitor-image')
  const lamp = doc.createElement('i')
  lamp.className = 'aw-monitor-lamp'
  const label = doc.createElement('span')
  label.className = 'aw-monitor-label'
  chip.append(image, label, lamp)
  const pending = control(doc, 'aw-pending aw-header-pending')
  const details = doc.createElement('span')
  details.className = 'aw-companion-details'
  details.hidden = true
  const detailText = doc.createElement('span')
  const widget = control(doc, 'aw-companion-action')
  const settings = control(doc, 'aw-companion-action', '提醒设置')
  settings.hidden = !showControls
  settings.setAttribute('aria-label', '打开离开提醒设置')
  details.append(detailText, widget, settings)
  panel.append(chip, pending, details)
  const dock = createDock(doc, panel, chip, prefs, onOpenSession, showControls)
  let previous, previousId, jump
  function setOpen(open) {
    details.hidden = !open
    chip.setAttribute('aria-expanded', String(open))
  }
  function dismiss(event) {
    if (!panel.contains(event.target)) setOpen(false)
  }
  function escape(event) {
    if (event.key === 'Escape' && !details.hidden) { setOpen(false); chip.focus(); event.stopPropagation() }
  }
  function sync() {
    widget.hidden = Boolean(prefs.get('widget'))
    widget.textContent = '显示角落挂件'
    widget.setAttribute('aria-label', widget.textContent)
    widget.disabled = Boolean(prefs.get('focus'))
    dock.refresh()
  }
  const stop = prefs.subscribe(key => { if (key === null || key === 'widget' || key === 'focus' || key === 'widgetPos') sync() })
  sync()
  doc.addEventListener('pointerdown', dismiss, true)
  panel.addEventListener('keydown', escape)
  chip.addEventListener('click', () => setOpen(details.hidden))
  widget.addEventListener('click', () => {
    prefs.set('widget', true)
    setOpen(false)
    chip.focus({preventScroll:true})
  })
  settings.addEventListener('click', () => { setOpen(false); showControls?.(chip) })
  pending.addEventListener('click', () => { if (jump && panel.isConnected) onOpenSession?.(jump.id) })
  return {
    panel,
    update({ status, activity, sessionId, sessionTitle }) {
      if (!Object.hasOwn(statusDetails, status)) status = 'unknown'
      if (previousId !== sessionId) { previous = undefined; setOpen(false) }
      const changed = Boolean(previous && previous !== status)
      const [text, phrase] = statusDetails[status]
      panel.dataset.status = status
      chip.title = '会话状态 · ' + text
      chip.setAttribute('aria-label', chip.title)
      label.textContent = text
      detailText.textContent = phrase
      const src = assets?.stateImages?.[stickerState(status)]
      if (src && image.getAttribute('src') !== src) image.src = src
      const waiting = nextWaiting(activity?.sessions ?? [], sessionId)
      dock.update(status, src, changed, waiting, previousId !== sessionId)
      const { count, next } = waiting
      jump = next
      pending.textContent = '待审批 ' + count
      pending.setAttribute('aria-label', '跳转至下一条待处理会话，共 ' + count + ' 个')
      pending.hidden = !count || !onOpenSession
      if (jump) pending.title = '下一条待处理会话 · ' + jump.title
      reminders?.transition(previous, status, sessionTitle)
      previous = status
      previousId = sessionId
    },
    destroy() {
      stop()
      doc.removeEventListener('pointerdown', dismiss, true)
      dock.destroy()
      panel.remove()
    },
  }
}
