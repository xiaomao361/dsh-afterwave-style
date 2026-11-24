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
const scopes = [['all', '全部'], ['waiting', '待处理'], ['running', '运行中'], ['pinned', '置顶']]
const number = new Intl.NumberFormat('zh-CN')
const VISIBLE_LIMIT = 20
const quips = ['扳手就位，今天准备修哪块代码？', '图纸铺好了，开工吧！', '螺丝都拧紧了，随时可以出航。', '别戳护目镜啦，会留指纹的！']

function node(doc, tag, className, text = '') {
  const el = doc.createElement(tag)
  if (className) el.className = className
  el.textContent = text
  return el
}

function button(doc, className, text) {
  const el = node(doc, 'button', className, text)
  el.type = 'button'
  return el
}

// Relative times read faster than dates in a short work list. Older entries
// fall back to a calendar day so the label never grows unbounded.
export function relativeTime(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return ''
  const diff = Math.max(0, now - at)
  const minute = 60000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return Math.floor(diff / minute) + ' 分钟前'
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (at >= today) return Math.floor(diff / (60 * minute)) + ' 小时前'
  const days = Math.ceil((today - at) / 86400000)
  if (days <= 1) return '昨天'
  if (days < 7) return days + ' 天前'
  const date = new Date(at)
  return (date.getMonth() + 1) + '月' + date.getDate() + '日'
}

// Waiting sessions need a decision, so they lead the full list. The rest
// keep the catalog's recency order.
function rank(sessions, scope) {
  const rows = sessions.filter(row => scope === 'all' || row[scope])
  if (scope !== 'all') return rows
  return [...rows.filter(row => row.waiting), ...rows.filter(row => !row.waiting)]
}

export function crewLine(activity) {
  if (activity?.phase !== 'ready') return phases[activity?.phase] ?? phases.loading
  const waiting = activity.sessions.filter(row => row.waiting).length
  if (waiting) return `有 ${waiting} 个会话等你确认，黄条那几条先看。`
  if (activity.running) return `${activity.running} 个会话正在运转，我盯着呢。`
  if (activity.today) return `今天动过 ${activity.today} 个会话，手感不错。`
  if (activity.sessions.length) return '船坞整备完毕，接着上次的活儿？'
  return '船坞空着，开个新会话吧。'
}

function makeOverview(doc, { onOpenSession: openSession, assets, prefs, showControls }) {
  const win = doc.defaultView
  const panel = node(doc, 'section', 'aw-panel')
  panel.setAttribute('aria-label', '工作区概览')

  // Header: identity on the left, one toolbar for every workbench tool.
  const head = node(doc, 'header', 'aw-head')
  const titles = node(doc, 'div', 'aw-titles')
  const kicker = node(doc, 'span', 'aw-kicker', 'No.04 · 船坞调度台')
  kicker.setAttribute('aria-hidden', 'true')
  const titleRow = node(doc, 'div', 'aw-title-row')
  const title = node(doc, 'h1', 'aw-heading', '工作区概览')
  const workspaceChip = node(doc, 'span', 'aw-ws-chip')
  workspaceChip.hidden = true
  titleRow.append(title, workspaceChip)
  titles.append(kicker, titleRow)

  const isMac = /Mac|iPhone|iPad/i.test(win?.navigator?.platform || '')
  const shortcut = isMac ? '⌘K' : 'Ctrl+K'
  const toolbar = node(doc, 'div', 'aw-toolbar')
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', '船坞工具')
  function tool(name, text, label) {
    const el = button(doc, 'aw-tool', '')
    const caption = node(doc, 'span', 'aw-tool-text', text)
    el.append(icon(doc, name, 14), caption)
    el.title = label
    el.setAttribute('aria-label', label)
    toolbar.append(el)
    return { el, caption }
  }
  const palette = tool('command', shortcut, `打开指令台（${shortcut}）`)
  palette.caption.classList.add('aw-kbd')
  palette.el.addEventListener('click', () => showPalette(win, palette.el))
  const pad = tool('notes', '便签', '打开堆叠便签')
  pad.el.addEventListener('click', () => toggleScratchpad(win, pad.el))
  const timer = tool('timer', '番茄', '打开值班番茄钟')
  const dockTimer = getDockTimer(win)
  timer.el.addEventListener('click', () => dockTimer.openPanel(timer.el))
  const stopTimerSub = dockTimer.subscribe(snap => {
    timer.caption.textContent = snap.running ? formatClock(snap.remaining) : '番茄'
    timer.caption.classList.toggle('aw-kbd', Boolean(snap.running))
    timer.el.dataset.running = String(Boolean(snap.running))
  })
  const settings = button(doc, 'aw-tool aw-settings', '')
  settings.append(icon(doc, 'wrench', 14))
  settings.title = '工装设置'
  settings.setAttribute('aria-label', settings.title)
  settings.hidden = !showControls
  settings.addEventListener('click', () => { playMechanicalClick(win, prefs); showControls?.(settings) })
  toolbar.append(settings)
  head.append(titles, toolbar)

  // Work orders: an always-visible filter over the workspace index.
  const body = node(doc, 'div', 'aw-body')
  const orders = node(doc, 'div', 'aw-orders')
  const filterRow = node(doc, 'div', 'aw-filter')
  const queryWrap = node(doc, 'label', 'aw-query-wrap')
  const query = node(doc, 'input', 'aw-query')
  query.type = 'search'
  query.autocomplete = 'off'
  query.spellcheck = false
  query.placeholder = '筛选会话标题…'
  query.setAttribute('aria-label', '筛选当前工作区的会话标题')
  queryWrap.append(icon(doc, 'search', 14), query)
  const scopeBar = node(doc, 'div', 'aw-scopes')
  scopeBar.setAttribute('role', 'group')
  scopeBar.setAttribute('aria-label', '会话范围')
  let scope = 'all'
  const scopeButtons = new Map(scopes.map(([value, label]) => {
    const el = button(doc, 'aw-scope', '')
    el.dataset.scope = value
    const name = node(doc, 'span', '', label)
    const count = node(doc, 'span', 'aw-scope-count', '0')
    el.append(name, count)
    el.setAttribute('aria-pressed', String(value === scope))
    el.addEventListener('click', () => setScope(value === scope && value !== 'all' ? 'all' : value))
    scopeBar.append(el)
    return [value, { el, count, label }]
  }))
  filterRow.append(queryWrap, scopeBar)

  const list = node(doc, 'ol', 'aw-list')
  list.setAttribute('aria-label', '会话列表')
  const notice = node(doc, 'p', 'aw-list-note')
  notice.setAttribute('role', 'status')
  orders.append(filterRow, list, notice)

  // Crew corner: the mascot carries the workspace summary in words.
  const crew = node(doc, 'aside', 'aw-crew')
  crew.setAttribute('aria-label', '值班概况')
  const stage = button(doc, 'aw-mascot-stage', '')
  stage.setAttribute('aria-label', '换一句值班台词')
  const hero = node(doc, 'img', 'aw-mascot-art')
  hero.alt = ''
  hero.draggable = false
  stage.append(hero)
  const speech = node(doc, 'p', 'aw-speech')
  speech.setAttribute('aria-live', 'polite')
  const metrics = node(doc, 'dl', 'aw-metrics')
  const values = ['会话', '今日更新', '运行中'].map(label => {
    const cell = node(doc, 'div', 'aw-metric')
    const value = node(doc, 'dd', 'aw-readout', '—')
    cell.append(node(doc, 'dt', 'aw-measure-label', label), value)
    metrics.append(cell)
    return value
  })
  crew.append(stage, speech, metrics)
  body.append(orders, crew)

  // Logbook: the activity heatmap spans the bottom edge.
  const figure = node(doc, 'figure', 'aw-trend')
  const trendHead = node(doc, 'div', 'aw-trend-head')
  const trendTitle = node(doc, 'figcaption', 'aw-trend-title', '航行日志 · 会话更新 · 近 20 周')
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
      playMechanicalClick(win, prefs)
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
    const cell = node(doc, 'li', idx >= 133 ? 'aw-heat-cell aw-column' : 'aw-heat-cell')
    cell.dataset.level = '0'
    heatmapGrid.append(cell)
    return cell
  })
  heatBody.append(weekdays, heatmapGrid)
  const heatFoot = node(doc, 'div', 'aw-heat-foot')
  const heatSummary = node(doc, 'span', 'aw-heat-summary', '')
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
  let defaultSummary = ''
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
        heatTip.style.left = Math.max(8, Math.min(cx, figRect.width - 8)) + 'px'
        heatTip.style.top = Math.max(4, cellRect.top - figRect.top - 28) + 'px'
      }
    })
  }
  heatmapGrid.addEventListener('pointerleave', () => {
    heatTip.hidden = true
    heatSummary.textContent = defaultSummary
  })

  panel.append(head, body, figure)

  // ---- State ------------------------------------------------------------
  let current
  let workspace
  let quipIndex = -1
  let quipTimer
  const ready = () => current?.phase === 'ready'
  function open(id) {
    if (panel.isConnected && ready() && current.sessions.some(session => session.id === id)) openSession?.(id)
  }

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

  stage.addEventListener('click', () => {
    quipIndex = (quipIndex + 1) % quips.length
    speech.textContent = quips[quipIndex]
    speech.dataset.quip = 'true'
    win.clearTimeout(quipTimer)
    // A quip yields back to the live summary; the summary is the real content.
    quipTimer = win.setTimeout(() => { delete speech.dataset.quip; speech.textContent = crewLine(current) }, 4000)
  })

  function setScope(value) {
    scope = value
    for (const [key, { el }] of scopeButtons) el.setAttribute('aria-pressed', String(key === scope))
    renderList()
  }

  function rows() { return [...list.querySelectorAll('.aw-row')] }
  function focusRow(index) {
    const all = rows()
    if (!all.length) return
    const target = all[Math.max(0, Math.min(index, all.length - 1))]
    for (const row of all) row.tabIndex = row === target ? 0 : -1
    target.focus()
  }

  query.addEventListener('input', renderList)
  query.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      list.querySelector('.aw-row')?.click()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(0)
    } else if (event.key === 'Escape' && (query.value || scope !== 'all')) {
      event.preventDefault()
      event.stopPropagation()
      query.value = ''
      setScope('all')
    }
  })
  list.addEventListener('keydown', event => {
    const all = rows()
    const index = all.indexOf(doc.activeElement)
    if (index < 0) return
    let next
    if (event.key === 'ArrowDown') next = index + 1
    else if (event.key === 'ArrowUp') next = index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = all.length - 1
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); query.focus(); return }
    else return
    event.preventDefault()
    if (next < 0) { query.focus(); return }
    focusRow(next)
  })

  function renderList() {
    const available = ready()
    const sessions = available ? current.sessions : []
    const latestId = sessions[0]?.id
    const now = Date.now()
    for (const [key, { el, count, label }] of scopeButtons) {
      const n = key === 'all' ? sessions.length : sessions.filter(row => row[key]).length
      count.textContent = number.format(n)
      el.dataset.count = String(n)
      el.disabled = !available || (key !== 'all' && !n && scope !== key)
      el.setAttribute('aria-label', `${label}，${n} 个`)
    }
    const term = query.value.trim().toLocaleLowerCase()
    const matches = rank(sessions, scope).filter(row => row.title.toLocaleLowerCase().includes(term))
    const shown = matches.slice(0, VISIBLE_LIMIT)
    const old = new Map([...list.children].map(el => [el.dataset.id, el]))
    const focusedId = list.contains(doc.activeElement) ? doc.activeElement.dataset.id : undefined
    for (const [index, session] of shown.entries()) {
      const id = String(session.id)
      let item = old.get(id)
      old.delete(id)
      if (!item) {
        item = node(doc, 'li', 'aw-item')
        item.dataset.id = id
        const row = button(doc, 'aw-row', '')
        row.dataset.id = id
        row.addEventListener('click', () => open(session.id))
        row.append(node(doc, 'span', 'aw-row-lamp'), node(doc, 'span', 'aw-row-title'),
          node(doc, 'span', 'aw-row-flag'), node(doc, 'span', 'aw-row-time'))
        item.append(row)
      }
      const row = item.firstElementChild
      const [, name, flagEl, timeEl] = row.children
      const flag = session.waiting ? 'waiting' : session.running ? 'running' : session.pinned ? 'pinned' : ''
      row.dataset.flag = flag
      name.textContent = session.title
      name.title = session.title
      flagEl.dataset.flag = flag
      flagEl.textContent = flagLabels[flag] ?? ''
      flagEl.hidden = !flag
      const when = id === String(latestId) ? '上次' : relativeTime(session.updatedAt, now)
      timeEl.textContent = when
      timeEl.dataset.latest = String(id === String(latestId))
      row.setAttribute('aria-label', [session.title, flagLabels[flag], when].filter(Boolean).join('，'))
      row.tabIndex = -1
      if (item !== list.children[index]) list.insertBefore(item, list.children[index] ?? null)
    }
    for (const item of old.values()) item.remove()
    const first = list.querySelector('.aw-row')
    const keep = focusedId && list.querySelector(`.aw-row[data-id="${CSS.escape?.(focusedId) ?? focusedId}"]`)
    if (keep) keep.tabIndex = 0
    else if (first) first.tabIndex = 0
    if (focusedId && !keep && doc.activeElement === doc.body) query.focus()

    let text = ''
    if (!available) text = phases[current?.phase] ?? phases.loading
    else if (!sessions.length) text = '暂无历史会话'
    else if (!matches.length) text = term ? '没有匹配的会话' : `没有${scopeButtons.get(scope).label}的会话`
    else if (matches.length > shown.length) text = `已显示前 ${VISIBLE_LIMIT} 条，输入标题缩小范围`
    notice.textContent = text
    notice.hidden = !text
    notice.dataset.kind = !available ? 'phase' : !sessions.length ? 'empty' : !matches.length ? 'none' : 'more'
    list.hidden = !shown.length
    query.disabled = !available || !sessions.length || !openSession
  }

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

    const base = () => available && current.heatmap?.length === 140 ? current.heatmap : buildFallbackDates()
    let series
    if (heatMode === 'typing-ws') {
      trendTitle.textContent = '航行日志 · 本区打字 · 近 20 周'
      defaultSummary = `本区累计 ${number.format(totalWs)} 字`
      series = base().map(item => ({ date: item.date, count: Number(wsDays[item.date] || 0) }))
    } else if (heatMode === 'typing-all') {
      trendTitle.textContent = '航行日志 · 全局打字 · 近 20 周'
      defaultSummary = `全船坞累计 ${number.format(totalGlobal)} 字`
      series = base().map(item => ({ date: item.date, count: Number(globalDays[item.date] || 0) }))
    } else if (heatMode === 'tokens') {
      trendTitle.textContent = '航行日志 · Token 消耗 · 近 20 周'
      defaultSummary = tokenGlobalTotal ? `已记录累计 ${formatTokens(tokenGlobalTotal)} tok（本区 ${formatTokens(tokenWsTotal)}）` : '暂未记录到新增 Token 消耗'
      series = base().map(item => ({ date: item.date, count: Number(tokenGlobalDays[item.date] || 0) }))
    } else {
      trendTitle.textContent = '航行日志 · 会话最近更新时间分布 · 近 20 周'
      const activeDays = available && current.heatmap ? current.heatmap.filter(d => d.count > 0).length : 0
      defaultSummary = available
        ? (tokenWsTotal ? `近 20 周活跃 ${activeDays} 天 · 本区已记录 ${formatTokens(tokenWsTotal)} tok` : `近 20 周活跃 ${activeDays} 天`)
        : '数据未就绪'
      if (available && current.heatmap?.length === 140) series = current.heatmap
      else if (available && current.days?.length === 7) series = [...Array.from({ length: 133 }, () => null), ...current.days]
      else series = Array.from({ length: 140 }, () => null)
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
        continue
      }
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

  function update(activity) {
    const workspaceId = activity?.workspaceId ?? activity?.workspaceName
    const changedWorkspace = workspace !== workspaceId
    current = activity
    workspace = workspaceId
    const available = ready()
    if (changedWorkspace || !available || !activity.sessions.length) {
      query.value = ''
      scope = 'all'
      for (const [key, { el }] of scopeButtons) el.setAttribute('aria-pressed', String(key === 'all'))
    }
    const workspaceName = activity?.workspaceName
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
    const waiting = available ? activity.sessions.filter(row => row.waiting).length : 0
    panel.dataset.attention = String(waiting > 0)
    if (!speech.dataset.quip) speech.textContent = crewLine(activity)
    renderList()
    renderHeatmap()
  }

  return {
    panel, update,
    destroy() { unsubscribe(); stopTimerSub(); win.clearTimeout(quipTimer); panel.remove() },
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
