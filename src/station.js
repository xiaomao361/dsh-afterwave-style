import { createCompanion, createReminders } from './companion.js'
import { getPrefs } from './prefs.js'
import { playMechanicalClick } from './sound.js'
import { showPalette } from './palette.js'
import { toggleScratchpad } from './scratchpad.js'
import { getDockTimer, formatClock } from './timer.js'

const phases = {
  loading: '正在读取会话…', unavailable: '暂时无法读取会话', unselected: '请选择工作区',
}
const flagLabels = { waiting: '待处理', running: '运行中', pinned: '置顶' }
const number = new Intl.NumberFormat('zh-CN')

function node(doc, tag, className, text = '') {
  const el = doc.createElement(tag)
  el.className = className
  el.textContent = text
  return el
}

function button(doc, className, text) {
  const el = node(doc, 'button', className, text)
  el.type = 'button'
  return el
}

function makeOverview(doc, { onOpenSession: openSession, assets, prefs, showControls }) {
  const panel = node(doc, 'section', 'aw-panel')
  panel.setAttribute('aria-label', '工作区概览')
  const hardware = node(doc, 'div', 'aw-panel-hardware')
  hardware.setAttribute('aria-hidden', 'true')
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const screw = node(doc, 'i', 'aw-screw')
    screw.dataset.corner = corner
    hardware.append(screw)
  }
  const head = node(doc, 'div', 'aw-overview-head')
  const title = node(doc, 'h1', 'aw-heading', '工作区概览')
  const workspaceChip = node(doc, 'span', 'aw-ws-chip')
  workspaceChip.hidden = true
  const searchToggle = button(doc, 'aw-find', '查找会话')
  searchToggle.prepend(node(doc, 'i', 'aw-find-icon'))
  searchToggle.setAttribute('aria-expanded', 'false')
  const pending = button(doc, 'aw-pending aw-home-pending', '')
  pending.hidden = true
  const paletteBtn = button(doc, 'aw-tool-btn', 'Ctrl+K')
  paletteBtn.title = '打开四号船坞指令台（Ctrl + K）'
  paletteBtn.setAttribute('aria-label', paletteBtn.title)
  paletteBtn.addEventListener('click', () => showPalette(doc.defaultView, paletteBtn))
  const padBtn = button(doc, 'aw-tool-btn', '便签')
  padBtn.title = '打开堆叠随手便签'
  padBtn.setAttribute('aria-label', padBtn.title)
  padBtn.addEventListener('click', () => toggleScratchpad(doc.defaultView, padBtn))
  const timerBtn = button(doc, 'aw-tool-btn', '◷ 番茄')
  timerBtn.title = '打开值班番茄钟'
  timerBtn.setAttribute('aria-label', timerBtn.title)
  const dockTimer = getDockTimer(doc.defaultView)
  timerBtn.addEventListener('click', () => dockTimer.openPanel(timerBtn))
  const stopTimerSub = dockTimer.subscribe(snap => {
    timerBtn.textContent = snap.running ? `◷ ${formatClock(snap.remaining)}` : '◷ 番茄'
  })
  const settings = button(doc, 'aw-settings', '')
  settings.title = '工装设置'
  settings.setAttribute('aria-label', settings.title)
  settings.hidden = !showControls
  settings.addEventListener('click', () => { playMechanicalClick(doc.defaultView, prefs); showControls?.(settings) })
  const tools = node(doc, 'div', 'aw-head-tools')
  tools.append(paletteBtn, padBtn, timerBtn, searchToggle, settings)
  head.append(title, workspaceChip, pending, tools)

  const face = node(doc, 'div', 'aw-face')
  const metrics = node(doc, 'dl', 'aw-metrics')
  const values = ['工作区会话', '今日更新', '运行中'].map(label => {
    const cell = node(doc, 'div', 'aw-metric')
    const value = node(doc, 'dd', 'aw-readout', '—')
    cell.append(node(doc, 'dt', 'aw-measure-label', label), value)
    metrics.append(cell)
    return value
  })
  const figure = node(doc, 'figure', 'aw-trend')
  const trendHead = node(doc, 'div', 'aw-trend-head')
  const trendTitle = node(doc, 'figcaption', 'aw-trend-title', '出坞记录 · 近 12 周')
  const modeSwitch = node(doc, 'div', 'aw-trend-modes')
  modeSwitch.setAttribute('role', 'group')
  modeSwitch.setAttribute('aria-label', '热力图视图')
  let heatMode = 'sessions'
  const modeButtons = [['sessions', '会话'], ['typing', '打字']].map(([mode, text]) => {
    const btn = button(doc, 'aw-trend-mode', text)
    btn.setAttribute('aria-pressed', String(mode === heatMode))
    btn.addEventListener('click', () => {
      if (heatMode === mode) return
      heatMode = mode
      playMechanicalClick(doc.defaultView, prefs)
      for (const [m, b] of modeButtons) b.setAttribute('aria-pressed', String(m === heatMode))
      renderHeatmap()
    })
    modeSwitch.append(btn)
    return [mode, btn]
  })
  trendHead.append(trendTitle, modeSwitch)
  const heatmapGrid = node(doc, 'ol', 'aw-heatmap')
  const cells = Array.from({ length: 84 }, (_, idx) => {
    const isLast7 = idx >= 77
    const cell = node(doc, 'li', isLast7 ? 'aw-heat-cell aw-column' : 'aw-heat-cell')
    cell.dataset.level = '0'
    heatmapGrid.append(cell)
    return cell
  })
  figure.append(trendHead, heatmapGrid)
  const telemetry = node(doc, 'div', 'aw-dashboard-readings')
  telemetry.append(metrics, figure)
  const stage = button(doc, 'aw-mascot-stage', '')
  stage.setAttribute('aria-label', '听听工装伙伴的值班提示')
  const hero = node(doc, 'img', 'aw-mascot-art')
  hero.alt = ''
  hero.draggable = false
  const bubble = node(doc, 'span', 'aw-hero-bubble')
  bubble.hidden = true
  bubble.setAttribute('role', 'status')
  stage.append(hero, bubble)
  face.append(telemetry, stage)
  let hideBubble
  stage.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !bubble.hidden) { bubble.hidden = true; event.stopPropagation() }
  })
  function applyPrefs() {
    const stored = prefs.get('portrait')
    const local = typeof stored === 'string' && /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+=*$/.test(stored)
    const src = local ? stored : assets?.heroImage
    stage.hidden = Boolean(prefs.get('focus') || !src)
    if (src && hero.getAttribute('src') !== src) hero.src = src
    hero.style.opacity = String((prefs.get('opacity') ?? 100) / 100)
  }
  const unsubscribe = prefs.subscribe(key => {
    if (key === null || ['focus', 'portrait', 'opacity'].includes(key)) applyPrefs()
    if (key === null || key === 'typing.stats') renderHeatmap()
  })
  applyPrefs()
  let phraseIndex = Math.floor(Math.random() * 3)
  stage.addEventListener('click', () => {
    const count = current?.sessions?.filter(s => s.waiting).length || 0
    const hints = ['扳手就位，今天准备修哪块代码？', '图纸铺好了，开工吧！',
      count ? '有 ' + count + ' 个会话等你确认哦！' : '巡检完毕，审批单都收齐啦！']
    bubble.textContent = hints[phraseIndex++ % hints.length]
    bubble.hidden = false
    doc.defaultView.clearTimeout(hideBubble)
    hideBubble = doc.defaultView.setTimeout(() => { bubble.hidden = true }, 2500)
  })

  const foot = node(doc, 'div', 'aw-overview-foot')
  const footLabel = node(doc, 'span', 'aw-last-label', '上次会话')
  const resume = button(doc, 'aw-resume', '')
  const latestTitle = node(doc, 'span', 'aw-last-title')
  const arrow = node(doc, 'span', 'aw-arrow', '↗')
  arrow.setAttribute('aria-hidden', 'true')
  resume.append(latestTitle, arrow)
  const empty = node(doc, 'span', 'aw-last-empty')
  const stamp = node(doc, 'span', 'aw-stencil', 'DRYDOCK-04 // HULL-A2')
  stamp.setAttribute('aria-hidden', 'true')
  foot.append(footLabel, resume, empty, stamp)

  const drawer = node(doc, 'div', 'aw-session-search')
  drawer.hidden = true
  const controls = node(doc, 'div', 'aw-query-controls')
  const query = node(doc, 'input', 'aw-query')
  query.type = 'search'
  query.autocomplete = 'off'
  query.placeholder = '输入会话标题…'
  query.setAttribute('aria-label', '搜索当前工作区的会话标题')
  const select = node(doc, 'select', 'aw-scope')
  select.setAttribute('aria-label', '筛选会话')
  for (const [value, label] of [['all', '全部'], ['pinned', '已置顶'], ['waiting', '待处理'], ['running', '运行中']]) {
    const option = node(doc, 'option', '', label)
    option.value = value
    select.append(option)
  }
  const results = node(doc, 'div', 'aw-found')
  results.setAttribute('aria-label', '搜索结果')
  const notice = node(doc, 'p', 'aw-no-match')
  notice.setAttribute('role', 'status')
  controls.append(query, select)
  drawer.append(controls, results, notice)
  panel.append(hardware, head, face, foot, drawer)

  let current
  let workspace
  const ready = () => current?.phase === 'ready'
  function open(id) {
    if (panel.isConnected && ready() && current.sessions.some(session => session.id === id)) openSession?.(id)
  }
  pending.addEventListener('click', () => open(current?.sessions?.find(session => session.waiting)?.id))
  resume.addEventListener('click', () => open(current?.sessions?.[0]?.id))

  function showSearch(shown) {
    face.hidden = foot.hidden = shown
    drawer.hidden = !shown
    searchToggle.setAttribute('aria-expanded', String(shown))
    searchToggle.lastChild.textContent = shown ? '收起' : '查找会话'
    if (shown) {
      updateMatches()
      query.focus()
    }
  }
  searchToggle.addEventListener('click', () => showSearch(drawer.hidden))
  drawer.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      showSearch(false)
      searchToggle.focus()
    } else if (event.key === 'Enter' && event.target === query) {
      event.preventDefault()
      results.querySelector('button')?.click()
    }
  })

  function updateMatches() {
    const term = query.value.trim().toLocaleLowerCase()
    const filter = select.value
    const matches = (current?.sessions ?? []).filter(s =>
      (filter === 'all' || s[filter]) && s.title.toLocaleLowerCase().includes(term))
    // Searches use the full index. Keep a short, keyboard-reachable result list.
    const rows = matches.slice(0, 20)
    const old = new Map([...results.children].map(el => [el.dataset.id, el]))
    for (const [index, session] of rows.entries()) {
      const id = String(session.id)
      const row = old.get(id) ?? button(doc, 'aw-result', '')
      old.delete(id)
      if (!row.dataset.id) {
        row.dataset.id = id
        row.addEventListener('click', () => open(session.id))
        row.append(node(doc, 'span', 'aw-result-name'), node(doc, 'span', 'aw-result-flag'))
      }
      row.firstElementChild.textContent = session.title
      const flag = session.waiting ? 'waiting' : session.running ? 'running' : session.pinned ? 'pinned' : ''
      row.lastElementChild.dataset.flag = flag
      row.lastElementChild.textContent = flagLabels[flag] ?? ''
      row.lastElementChild.hidden = !flag
      if (row !== results.children[index]) results.insertBefore(row, results.children[index] ?? null)
    }
    for (const row of old.values()) row.remove()
    notice.textContent = matches.length > rows.length ? '已显示前 20 条，可输入标题缩小范围' :
      rows.length ? '' : '没有匹配的会话'
    notice.hidden = !notice.textContent
  }
  query.addEventListener('input', updateMatches)
  select.addEventListener('change', updateMatches)

  function heatLevel(count, peak) {
    if (!count || count <= 0) return '0'
    const ratio = count / Math.max(1, peak)
    if (ratio >= 0.75) return '4'
    if (ratio >= 0.45) return '3'
    if (ratio >= 0.2) return '2'
    return '1'
  }

  function buildFallbackDates() {
    const now = new Date()
    const pad = v => String(v).padStart(2, '0')
    return Array.from({ length: 84 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i - 83)
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, count: 0 }
    })
  }

  function renderHeatmap() {
    const available = ready()
    const typingRaw = prefs.get('typing.stats')
    const typingDays = typingRaw && typeof typingRaw === 'object' && typingRaw.days ? typingRaw.days : {}
    const totalTyped = typingRaw && Number.isFinite(typingRaw.total) ? typingRaw.total : 0

    let series
    if (heatMode === 'typing') {
      trendTitle.textContent = totalTyped ? `打字里程 · 累计 ${number.format(totalTyped)} 字` : '打字里程 · 近 12 周'
      const base = available && current.heatmap?.length === 84 ? current.heatmap : buildFallbackDates()
      series = base.map(item => ({ date: item.date, count: Number(typingDays[item.date] || 0) }))
    } else {
      trendTitle.textContent = '出坞记录 · 近 12 周'
      if (available && current.heatmap?.length === 84) {
        series = current.heatmap
      } else if (available && current.days?.length === 7) {
        const prefix = Array.from({ length: 77 }, () => null)
        series = [...prefix, ...current.days]
      } else {
        series = Array.from({ length: 84 }, () => null)
      }
    }

    const peak = Math.max(1, ...series.map(d => d?.count || 0))
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      const day = series[i]
      if (!day) {
        cell.dataset.level = '0'
        cell.title = '数据未就绪'
        cell.setAttribute('aria-label', '数据未就绪')
        cell.toggleAttribute('data-empty', true)
      } else {
        cell.dataset.level = heatLevel(day.count, peak)
        const desc = heatMode === 'typing'
          ? `${day.date}，输入 ${number.format(day.count)} 字`
          : `${day.date}，${day.count} 个会话最后更新`
        cell.title = desc
        cell.setAttribute('aria-label', desc)
        cell.toggleAttribute('data-empty', !day.count)
      }
    }
  }

  function update(activity) {
    const workspaceId = activity?.workspaceId ?? activity?.workspaceName
    const changedWorkspace = workspace !== workspaceId
    current = activity
    workspace = workspaceId
    const workspaceName = activity?.workspaceName
    const available = ready()
    const sessions = available ? activity.sessions : []
    if (changedWorkspace || !available || !sessions.length) {
      query.value = ''
      select.value = 'all'
      if (!drawer.hidden) showSearch(false)
    }
    if (workspaceName) title.title = workspaceName
    else title.removeAttribute('title')
    workspaceChip.textContent = workspaceName ?? ''
    workspaceChip.title = workspaceName ?? ''
    workspaceChip.hidden = !workspaceName
    for (const [index, key] of ['total', 'today', 'running'].entries()) {
      const value = available && Number.isFinite(activity[key]) ? number.format(activity[key]) : '—'
      values[index].textContent = value
      values[index].classList.toggle('aw-long-value', value.length > 4)
    }
    values[2].parentElement.dataset.active = String(available && activity.running > 0)
    renderHeatmap()
    const waiting = sessions.filter(session => session.waiting)
    pending.hidden = !waiting.length || !openSession
    pending.textContent = '待处理 · ' + waiting.length + ' ↗'
    pending.setAttribute('aria-label', '打开待处理会话，共 ' + waiting.length + ' 个')
    pending.title = waiting.length ? '打开待处理会话 · ' + waiting[0].title : ''
    const recent = sessions[0]
    searchToggle.disabled = !openSession || !sessions.length
    resume.hidden = !recent || !openSession
    empty.hidden = !resume.hidden
    empty.textContent = !available ? phases[activity?.phase] ?? phases.loading :
      recent ? recent.title : '暂无历史会话'
    latestTitle.textContent = recent?.title ?? ''
    resume.title = recent ? '继续上次会话 · ' + recent.title : ''
    resume.setAttribute('aria-label', resume.title)
    if (!drawer.hidden) updateMatches()
  }

  return {
    panel, update,
    destroy() { unsubscribe(); stopTimerSub(); doc.defaultView.clearTimeout(hideBubble); panel.remove() },
  }
}

export function createStation(doc, options = {}) {
  const prefs = options.prefs ?? getPrefs(doc.defaultView)
  const reminders = options.reminders ?? createReminders(doc, prefs)
  const config = { ...options, prefs, reminders: options.externalAlerts ? null : reminders }
  const element = node(doc, 'div', 'aw-station')
  let view
  let expanded
  let destroyed = false
  return {
    element,
    update({ expanded: next = false, status = 'unknown', activity, sessionId, sessionTitle } = {}) {
      if (destroyed) return
      element.dataset.status = status
      if (expanded !== next) {
        view?.destroy()
        expanded = next
        element.dataset.expanded = String(next)
        view = next ? makeOverview(doc, config) : createCompanion(doc, config)
        element.replaceChildren(view.panel)
      }
      view.update(next ? activity : { status, activity, sessionId, sessionTitle })
    },
    destroy() {
      destroyed = true
      view?.destroy()
      if (!options.reminders) reminders.destroy()
      element.remove()
    },
  }
}
