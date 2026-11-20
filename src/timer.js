import { getPrefs } from './prefs.js'
import { playMechanicalClick } from './sound.js'

const STATS_KEY = 'timer.stats'
const timers = new WeakMap()

export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

function todayKey() {
  const d = new Date()
  const p = v => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function node(doc, tag, className, text = '') {
  const el = doc.createElement(tag)
  el.className = className
  if (text) el.textContent = text
  if (tag === 'button') el.type = 'button'
  return el
}

export function getDockTimer(win) {
  if (timers.has(win)) return timers.get(win)
  const doc = win.document
  const prefs = getPrefs(win)
  const listeners = new Set()

  let state = {
    running: false,
    duration: 25 * 60,
    remaining: 25 * 60,
    endAt: 0,
    label: '值班专注',
    task: '',
    autoBreak: true,
    isBreak: false,
  }
  let interval = null

  function readStats() {
    const raw = prefs.get(STATS_KEY)
    const today = todayKey()
    if (raw && typeof raw === 'object' && raw.day === today) {
      return {
        day: today,
        count: Number(raw.count || 0),
        minutes: Number(raw.minutes || 0),
      }
    }
    return { day: today, count: 0, minutes: 0 }
  }

  function recordCompleted(minutes) {
    const cur = readStats()
    cur.count += 1
    cur.minutes += Math.max(1, Math.round(minutes))
    prefs.set(STATS_KEY, cur)
    return cur
  }

  function snapshot() {
    const remaining = state.running ? Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000)) : state.remaining
    const stats = readStats()
    return { ...state, remaining, todayCount: stats.count, todayMinutes: stats.minutes }
  }

  function emit(done = false) {
    const snap = snapshot()
    for (const fn of listeners) fn(snap, done)
  }

  function stopTick() {
    if (interval !== null) {
      win.clearInterval(interval)
      interval = null
    }
  }

  function notifyFinished(completedLabel, taskText, isBreak) {
    playMechanicalClick(win, prefs)
    const body = isBreak
      ? '短休结束，准备回船坞继续开工！'
      : (taskText ? `「${taskText}」班次到点，起来喝口水活动下颈椎！` : `${completedLabel}已完成，起来喝口水活动下颈椎！`)
    try {
      if (prefs.get('notifications') && win.Notification?.permission === 'granted') {
        new win.Notification('四号船坞 · 番茄钟到点', { body })
      }
    } catch {}
    win.dispatchEvent(new win.CustomEvent('aw-timer-done', { detail: { label: completedLabel, task: taskText, isBreak } }))
  }

  function tick() {
    const left = Math.ceil((state.endAt - Date.now()) / 1000)
    if (left <= 0) {
      const wasBreak = state.isBreak
      const finishedLabel = state.label
      const finishedTask = state.task
      const finishedMinutes = state.duration / 60
      stopTick()
      if (!wasBreak) recordCompleted(finishedMinutes)
      state = { ...state, running: false, remaining: 0, endAt: 0 }
      notifyFinished(finishedLabel, finishedTask, wasBreak)
      if (!wasBreak && state.autoBreak) {
        start(5, '短休整备', true)
        return
      }
      emit(true)
      return
    }
    state.remaining = left
    emit(false)
  }

  function start(minutes = 25, label = minutes <= 10 ? '短休整备' : '值班专注', isBreak = minutes <= 10) {
    const sec = Math.max(60, Math.round(minutes * 60))
    stopTick()
    state = { ...state, running: true, duration: sec, remaining: sec, endAt: Date.now() + sec * 1000, label, isBreak }
    interval = win.setInterval(tick, 1000)
    playMechanicalClick(win, prefs)
    emit(false)
  }

  function togglePause() {
    if (state.running) {
      const left = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000))
      stopTick()
      state = { ...state, running: false, remaining: left, endAt: 0 }
      playMechanicalClick(win, prefs)
      emit(false)
    } else if (state.remaining > 0) {
      state = { ...state, running: true, endAt: Date.now() + state.remaining * 1000 }
      interval = win.setInterval(tick, 1000)
      playMechanicalClick(win, prefs)
      emit(false)
    } else {
      start(Math.round(state.duration / 60), state.label, state.isBreak)
    }
  }

  function reset() {
    stopTick()
    state = { ...state, running: false, remaining: state.duration, endAt: 0 }
    emit(false)
  }

  function setTask(text) {
    state.task = String(text || '').slice(0, 60)
    emit(false)
  }

  function setAutoBreak(yes) {
    state.autoBreak = Boolean(yes)
    emit(false)
  }

  // Build visual mechanical shipyard timer panel + compact running pill
  const pill = node(doc, 'button', 'aw-timer-pill')
  pill.hidden = true
  pill.setAttribute('aria-label', '打开值班番茄钟')
  const pillText = node(doc, 'span', 'aw-timer-pill-text', '25:00')
  const pillBar = node(doc, 'i', 'aw-timer-pill-bar')
  pill.append(node(doc, 'span', 'aw-timer-pill-dot'), pillText, pillBar)

  const panel = node(doc, 'section', 'aw-timer-panel')
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', '四号船坞值班番茄钟')

  const head = node(doc, 'div', 'aw-tm-head')
  const titleEl = node(doc, 'strong', 'aw-tm-title', '值班番茄钟')
  const modeTag = node(doc, 'span', 'aw-tm-mode', '值班专注')
  const closeBtn = node(doc, 'button', 'aw-tm-close', '×')
  closeBtn.setAttribute('aria-label', '关闭番茄钟面板')
  head.append(titleEl, modeTag, closeBtn)

  const dial = node(doc, 'div', 'aw-tm-dial')
  const clockEl = node(doc, 'div', 'aw-tm-clock', '25:00')
  const track = node(doc, 'div', 'aw-tm-track')
  const fill = node(doc, 'i', 'aw-tm-fill')
  track.append(fill)
  dial.append(clockEl, track)

  const taskInput = node(doc, 'input', 'aw-tm-task')
  taskInput.type = 'text'
  taskInput.placeholder = '当前值班目标（选填，到点会提醒）…'
  taskInput.setAttribute('aria-label', '当前值班目标')
  taskInput.addEventListener('input', () => setTask(taskInput.value))

  const presetsRow = node(doc, 'div', 'aw-tm-presets')
  for (const [mins, label, isBreak] of [
    [15, '15m 速修', false],
    [25, '25m 专注', false],
    [45, '45m 深度', false],
    [5, '5m 短休', true],
  ]) {
    const btn = node(doc, 'button', 'aw-tm-preset', label)
    btn.addEventListener('click', () => start(mins, label.slice(label.indexOf(' ') + 1), isBreak))
    presetsRow.append(btn)
  }

  const customRow = node(doc, 'div', 'aw-tm-custom')
  const customInput = node(doc, 'input', 'aw-tm-minutes')
  customInput.type = 'number'
  customInput.min = '1'
  customInput.max = '180'
  customInput.value = '25'
  customInput.setAttribute('aria-label', '自定义分钟数')
  const customStart = node(doc, 'button', 'aw-tm-btn', '按此分钟启动')
  customStart.addEventListener('click', () => {
    const m = Math.min(180, Math.max(1, Number(customInput.value) || 25))
    customInput.value = String(m)
    start(m, `${m}分钟值班`, false)
  })
  customRow.append(customInput, node(doc, 'span', 'aw-tm-unit', '分钟'), customStart)

  const controlsRow = node(doc, 'div', 'aw-tm-controls')
  const playBtn = node(doc, 'button', 'aw-tm-btn aw-tm-primary', '开始值班')
  const resetBtn = node(doc, 'button', 'aw-tm-btn', '重置')
  const autoWrap = node(doc, 'label', 'aw-tm-auto')
  const autoCheck = node(doc, 'input', '')
  autoCheck.type = 'checkbox'
  autoCheck.checked = true
  autoCheck.addEventListener('change', () => setAutoBreak(autoCheck.checked))
  autoWrap.append(autoCheck, doc.createTextNode('结束后自动短休'))
  playBtn.addEventListener('click', togglePause)
  resetBtn.addEventListener('click', reset)
  controlsRow.append(playBtn, resetBtn, autoWrap)

  const statsEl = node(doc, 'div', 'aw-tm-stats', '今日完成 0 轮 · 累计专注 0 分钟')

  panel.append(head, dial, taskInput, presetsRow, customRow, controlsRow, statsEl)
  doc.body.append(pill, panel)

  let returnFocus = null

  function renderUI(snap) {
    const text = formatClock(snap.remaining)
    const ratio = snap.duration > 0 ? Math.max(0, Math.min(1, 1 - snap.remaining / snap.duration)) : 0
    clockEl.textContent = text
    pillText.textContent = text
    fill.style.width = (ratio * 100).toFixed(1) + '%'
    pillBar.style.width = (ratio * 100).toFixed(1) + '%'
    modeTag.textContent = snap.label
    modeTag.dataset.break = String(Boolean(snap.isBreak))
    playBtn.textContent = snap.running ? '暂停' : (snap.remaining < snap.duration && snap.remaining > 0 ? '继续' : '开始值班')
    statsEl.textContent = `今日完成 ${snap.todayCount} 轮 · 累计专注 ${snap.todayMinutes} 分钟`
    const showPill = snap.running || (snap.remaining > 0 && snap.remaining < snap.duration)
    pill.hidden = !showPill
    pill.dataset.running = String(snap.running)
    pill.title = `${snap.label} · 剩余 ${text}（点击打开番茄钟）`
  }

  listeners.add(renderUI)
  renderUI(snapshot())

  function onKey(event) {
    if (event.key === 'Escape' && !event.isComposing && !panel.hidden) {
      event.preventDefault()
      event.stopPropagation()
      closePanel()
    }
  }
  function outside(event) {
    if (!panel.hidden && !panel.contains(event.target) && !pill.contains(event.target) && event.target !== returnFocus) closePanel()
  }

  function openPanel(anchor) {
    if (!panel.hidden) { closePanel(); return }
    returnFocus = anchor || doc.activeElement
    renderUI(snapshot())
    panel.hidden = false
    playMechanicalClick(win, prefs)
    doc.addEventListener('keydown', onKey, true)
    doc.addEventListener('pointerdown', outside, true)
    playBtn.focus({ preventScroll: true })
  }

  function closePanel() {
    if (panel.hidden) return
    panel.hidden = true
    doc.removeEventListener('keydown', onKey, true)
    doc.removeEventListener('pointerdown', outside, true)
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true })
    }
    returnFocus = null
  }

  pill.addEventListener('click', () => openPanel(pill))
  closeBtn.addEventListener('click', closePanel)

  const api = {
    start, togglePause, reset, snapshot, setTask, setAutoBreak,
    openPanel, closePanel,
    isPanelOpen: () => !panel.hidden,
    subscribe(fn) {
      listeners.add(fn)
      fn(snapshot(), false)
      return () => listeners.delete(fn)
    },
    destroy() {
      closePanel()
      stopTick()
      listeners.clear()
      pill.remove()
      panel.remove()
      timers.delete(win)
    },
  }
  timers.set(win, api)
  return api
}
