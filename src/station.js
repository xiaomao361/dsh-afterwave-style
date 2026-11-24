import { createCompanion, createReminders } from './companion.js'
import { getPrefs } from './prefs.js'
import { playMechanicalClick } from './sound.js'
import { showPalette } from './palette.js'
import { toggleScratchpad } from './scratchpad.js'
import { getDockTimer, formatClock } from './timer.js'
import { formatTokens } from './readings.js'
import { icon } from './icons.js'

const phases = {
  loading: '正在读取会话…', unavailable: '暂时无法读取会话', unselected: '请选择工作区',
}
const flagLabels = { waiting: '待处理', running: '运行中', pinned: '置顶' }
const number = new Intl.NumberFormat('zh-CN')
const sessionTrendTitle = '会话最近更新时间分布 · 近 12 周'
let searchPanelId = 0

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
  searchToggle.prepend(icon(doc, 'search', 13))
  searchToggle.setAttribute('aria-expanded', 'false')
  const pending = button(doc, 'aw-pending aw-home-pending', '')
  pending.hidden = true
  const isMac = /Mac|iPhone|iPad/i.test(doc.defaultView?.navigator?.platform || '')
  const paletteBtn = button(doc, 'aw-tool-btn', '')
  paletteBtn.append(icon(doc, 'command', 13), node(doc, 'span', 'aw-btn-kbd', isMac ? '⌘K' : 'Ctrl+K'))
  paletteBtn.title = `打开四号船坞指令台（${isMac ? '⌘K' : 'Ctrl+K'}）`
  paletteBtn.setAttribute('aria-label', paletteBtn.title)
  paletteBtn.addEventListener('click', () => showPalette(doc.defaultView, paletteBtn))
  const padBtn = button(doc, 'aw-tool-btn', '')
  padBtn.append(icon(doc, 'notes', 13), node(doc, 'span', '', '便签'))
  padBtn.title = '打开堆叠随手便签'
  padBtn.setAttribute('aria-label', padBtn.title)
  padBtn.addEventListener('click', () => toggleScratchpad(doc.defaultView, padBtn))
  const timerBtn = button(doc, 'aw-tool-btn', '')
  const timerLabel = node(doc, 'span', '', '番茄')
  timerBtn.append(icon(doc, 'timer', 13), timerLabel)
  timerBtn.title = '打开值班番茄钟'
  timerBtn.setAttribute('aria-label', timerBtn.title)
  const dockTimer = getDockTimer(doc.defaultView)
  timerBtn.addEventListener('click', () => dockTimer.openPanel(timerBtn))
  const stopTimerSub = dockTimer.subscribe(snap => {
    timerLabel.textContent = snap.running ? formatClock(snap.remaining) : '番茄'
  })
  const settings = button(doc, 'aw-settings', '')
  settings.append(icon(doc, 'wrench', 14))
  settings.title = '工装设置'
  settings.setAttribute('aria-label', settings.title)
  settings.hidden = !showControls
  settings.addEventListener('click', () => { playMechanicalClick(doc.defaultView, prefs); showControls?.(settings) })
  const toolWell = node(doc, 'div', 'aw-tool-well')
  toolWell.append(paletteBtn, padBtn, timerBtn)
  const tools = node(doc, 'div', 'aw-head-tools')
  tools.append(toolWell, searchToggle, settings)
  head.append(title, workspaceChip, tools)

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
  const trendTitle = node(doc, 'figcaption', 'aw-trend-title', '会话最近更新时间分布 · 近 20 周')
  const modeSwitch = node(doc, 'div', 'aw-trend-modes')
  modeSwitch.setAttribute('role', 'group')
  modeSwitch.setAttribute('aria-label', '热力图视图')
  let heatMode = 'sessions'
  const modeButtons = [
    ['sessions', '会话'],
    ['typing-ws', '本区打字'],
    ['typing-all', '全局打字'],
    ['tokens', 'Token'],
  ].map(([mode, text]) => {
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
  const heatBody = node(doc, 'div', 'aw-heat-body')
  const weekdays = node(doc, 'div', 'aw-heat-axis')
  weekdays.setAttribute('aria-hidden', 'true')
  for (const label of ['一', '', '三', '', '五', '', '日']) weekdays.append(node(doc, 'span', '', label))
  const heatmapGrid = node(doc, 'ol', 'aw-heatmap')
  const cells = Array.from({ length: 140 }, (_, idx) => {
    const isLast7 = idx >= 133
    const cell = node(doc, 'li', isLast7 ? 'aw-heat-cell aw-column' : 'aw-heat-cell')
    cell.dataset.level = '0'
    heatmapGrid.append(cell)
    return cell
  })
  heatBody.append(weekdays, heatmapGrid)
  const heatFoot = node(doc, 'div', 'aw-heat-foot')
  const heatSummary = node(doc, 'span', 'aw-heat-summary', 'BLUEPRINT // 20W')
  const heatTip = node(doc, 'div', 'aw-heat-tip')
  heatTip.hidden = true
  heatTip.setAttribute('aria-hidden', 'true')
  const legend = node(doc, 'div', 'aw-heat-legend')
  legend.setAttribute('aria-hidden', 'true')
  legend.append(node(doc, 'span', '', '少'))
  for (const lvl of ['0', '1', '2', '3', '4']) {
    const swatch = node(doc, 'i', 'aw-heat-swatch')
    swatch.dataset.level = lvl
    legend.append(swatch)
  }
  legend.append(node(doc, 'span', '', '多'))
  heatFoot.append(heatSummary, legend)
  figure.append(trendHead, heatBody, heatFoot, heatTip)
  let defaultSummary = 'BLUEPRINT // 20W'
  for (const cell of cells) {
    cell.addEventListener('pointerenter', () => {
      const text = cell.dataset.tip || cell.title
      if (!text) return
      heatSummary.textContent = text
      heatTip.textContent = text
      heatTip.hidden = false
      const figRect = figure.getBoundingClientRect()
      const cellRect = cell.getBoundingClientRect()
      if (figRect.width > 0 && cellRect.width > 0) {
        const cx = cellRect.left - figRect.left + cellRect.width / 2
        const top = cellRect.top - figRect.top - 26
        heatTip.style.left = Math.max(8, Math.min(cx, figRect.width - 8)) + 'px'
        heatTip.style.top = Math.max(4, top) + 'px'
      }
    })
  }
  heatmapGrid.addEventListener('pointerleave', () => {
    heatTip.hidden = true
    heatSummary.textContent = defaultSummary
  })
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
    if (key === null || key === 'typing.stats' || key === 'token.stats') renderHeatmap()
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
  foot.append(pending, footLabel, resume, empty, stamp)

  const drawer = node(doc, 'div', 'aw-session-search')
  drawer.id = `aw-session-search-${++searchPanelId}`
  drawer.hidden = true
  for (const trigger of [searchToggle, pending]) trigger.setAttribute('aria-controls', drawer.id)
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
  panel.append(hardware, head, foot, drawer, face)

  let current
  let workspace
  let waiting = []
  let searchAnchor
  const ready = () => current?.phase === 'ready'
  function open(id) {
    if (panel.isConnected && ready() && current.sessions.some(session => session.id === id)) openSession?.(id)
  }
  pending.addEventListener('click', () => {
    if (waiting.length === 1) open(waiting[0].id)
    else if (waiting.length > 1) showSearch(searchAnchor === pending ? undefined : pending)
  })
  resume.addEventListener('click', () => open(current?.sessions?.[0]?.id))

  function syncSearchTriggers() {
    searchToggle.setAttribute('aria-expanded', String(searchAnchor === searchToggle))
    searchToggle.lastChild.textContent = searchAnchor === searchToggle ? '收起' : '查找会话'
    if (waiting.length > 1 || searchAnchor === pending) {
      pending.setAttribute('aria-expanded', String(searchAnchor === pending))
    } else pending.removeAttribute('aria-expanded')
  }

  function showSearch(anchor) {
    if (anchor === pending || searchAnchor === pending) {
      query.value = ''
      select.value = anchor === pending ? 'waiting' : 'all'
    }
    searchAnchor = anchor
    face.hidden = Boolean(anchor)
    drawer.hidden = !anchor
    syncSearchTriggers()
    if (anchor) {
      updateMatches()
      query.focus()
    }
  }
  searchToggle.addEventListener('click', () => showSearch(searchAnchor === searchToggle ? undefined : searchToggle))
  drawer.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      const trigger = searchAnchor?.hidden ? searchToggle : searchAnchor
      showSearch()
      trigger?.focus()
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
    return Array.from({ length: 140 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i - 139)
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, count: 0 }
    })
  }

  function renderHeatmap() {
    const available = ready()
    const typingRaw = prefs.get('typing.stats')
    const globalDays = typingRaw && typeof typingRaw === 'object' && typingRaw.days ? typingRaw.days : {}
    const totalGlobal = typingRaw && Number.isFinite(typingRaw.total) ? typingRaw.total : 0
    const wsKey = current?.workspaceId ? String(current.workspaceId) : 'default'
    const wsEntry = typingRaw && typeof typingRaw === 'object' && typingRaw.workspaces ? typingRaw.workspaces[wsKey] : null
    const wsDays = wsEntry && typeof wsEntry.days === 'object' ? wsEntry.days : {}
    const totalWs = wsEntry && Number.isFinite(wsEntry.total) ? wsEntry.total : 0

    const tokenRaw = prefs.get('token.stats')
    const tokenGlobalDays = tokenRaw && typeof tokenRaw === 'object' && tokenRaw.days ? tokenRaw.days : {}
    const tokenGlobalTotal = tokenRaw && Number.isFinite(tokenRaw.total) ? tokenRaw.total : 0
    const tokenWsEntry = tokenRaw && typeof tokenRaw === 'object' && tokenRaw.workspaces ? tokenRaw.workspaces[wsKey] : null
    const tokenWsDays = tokenWsEntry && typeof tokenWsEntry.days === 'object' ? tokenWsEntry.days : {}
    const tokenWsTotal = tokenWsEntry && Number.isFinite(tokenWsEntry.total) ? tokenWsEntry.total : 0

    let series
    if (heatMode === 'typing-ws') {
      trendTitle.textContent = '本区打字里程 · 近 20 周'
      defaultSummary = `本区累计 ${number.format(totalWs)} 字`
      const base = available && current.heatmap?.length === 140 ? current.heatmap : buildFallbackDates()
      series = base.map(item => ({ date: item.date, count: Number(wsDays[item.date] || 0) }))
    } else if (heatMode === 'typing-all') {
      trendTitle.textContent = '全局打字里程 · 近 20 周'
      defaultSummary = `全船坞累计 ${number.format(totalGlobal)} 字`
      const base = available && current.heatmap?.length === 140 ? current.heatmap : buildFallbackDates()
      series = base.map(item => ({ date: item.date, count: Number(globalDays[item.date] || 0) }))
    } else if (heatMode === 'tokens') {
      trendTitle.textContent = 'Token 消耗分布 · 近 20 周'
      defaultSummary = tokenGlobalTotal ? `已记录累计 ${formatTokens(tokenGlobalTotal)} tok（本区 ${formatTokens(tokenWsTotal)}）` : '暂未记录到新增 Token 消耗'
      const base = available && current.heatmap?.length === 140 ? current.heatmap : buildFallbackDates()
      series = base.map(item => ({ date: item.date, count: Number(tokenGlobalDays[item.date] || 0) }))
    } else {
      trendTitle.textContent = '会话最近更新时间分布 · 近 20 周'
      const activeDays = available && current.heatmap ? current.heatmap.filter(d => d.count > 0).length : 0
      defaultSummary = available
        ? (tokenWsTotal ? `近 20 周活跃 ${activeDays} 天 · 本区已记录 ${formatTokens(tokenWsTotal)} tok` : `近 20 周活跃 ${activeDays} 天`)
        : 'BLUEPRINT // 20W'
      if (available && current.heatmap?.length === 140) {
        series = current.heatmap
      } else if (available && current.days?.length === 7) {
        const prefix = Array.from({ length: 133 }, () => null)
        series = [...prefix, ...current.days]
      } else {
        series = Array.from({ length: 140 }, () => null)
      }
    }
    if (heatTip.hidden) heatSummary.textContent = defaultSummary

    const peak = Math.max(1, ...series.map(d => d?.count || 0))
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      const day = series[i]
      if (!day) {
        cell.dataset.level = '0'
        cell.title = '数据未就绪'
        cell.dataset.tip = '数据未就绪'
        cell.setAttribute('aria-label', '数据未就绪')
        cell.toggleAttribute('data-empty', true)
      } else {
        cell.dataset.level = heatLevel(day.count, peak)
        const tokCount = heatMode === 'typing-all' || heatMode === 'tokens'
          ? Number(tokenGlobalDays[day.date] || 0)
          : Number(tokenWsDays[day.date] || tokenGlobalDays[day.date] || 0)
        const tokLabel = tokCount > 0 ? `${formatTokens(tokCount)} tok` : '暂无 Token 记录'
        const desc = heatMode === 'tokens'
          ? `${day.date} · 消耗 ${tokLabel}`
          : heatMode === 'sessions'
            ? `${day.date}，${day.count} 个会话最后更新 · ${tokLabel}`
            : `${day.date}，输入 ${number.format(day.count)} 字 · ${tokLabel}`
        cell.title = desc
        cell.dataset.tip = desc
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
      if (searchAnchor) showSearch()
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
    waiting = sessions.filter(session => session.waiting)
    pending.hidden = !waiting.length || !openSession
    const multiple = waiting.length > 1
    pending.textContent = '待处理 · ' + waiting.length + (multiple ? ' ▾' : ' ↗')
    pending.setAttribute('aria-label', (multiple ? '查看待处理会话列表，共 ' : '打开待处理会话，共 ') + waiting.length + ' 个')
    pending.title = multiple ? '查看待处理会话列表' : (waiting[0]?.title ?? '')
    syncSearchTriggers()
    const recent = sessions[0]
    searchToggle.disabled = !openSession || !sessions.length
    resume.hidden = !recent || !openSession
    empty.hidden = !resume.hidden
    empty.textContent = !available ? phases[activity?.phase] ?? phases.loading :
      recent ? recent.title : '暂无历史会话'
    footLabel.textContent = resume.hidden ? '上次会话' : '继续上次会话'
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
