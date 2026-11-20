import { getPrefs } from './prefs.js'
import { playMechanicalClick } from './sound.js'

const KEY = 'scratchpad'
const MAX_NOTES = 12
const MAX_CHARS = 12000
const COLORS = [
  ['paper', '米黄工单'],
  ['amber', '警戒琥珀'],
  ['blueprint', '蓝图浅蓝'],
  ['rust', '防锈陶红'],
]
const instances = new WeakMap()

function node(doc, tag, className, text = '') {
  const el = doc.createElement(tag)
  el.className = className
  if (text) el.textContent = text
  if (tag === 'button') el.type = 'button'
  return el
}

function makeNote(text = '', color = 'paper') {
  return {
    id: 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    text,
    color,
    updatedAt: Date.now(),
  }
}

function noteLabel(note, index) {
  const first = (note.text || '').split('\n').map(l => l.trim()).find(Boolean)
  return first ? (first.length > 8 ? first.slice(0, 8) + '…' : first) : `便签 #${index + 1}`
}

function normalizeStore(raw) {
  if (typeof raw === 'string') {
    const note = makeNote(raw, 'paper')
    return { activeId: note.id, notes: [note] }
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.notes) && raw.notes.length) {
    const notes = raw.notes
      .filter(n => n && typeof n === 'object' && typeof n.id === 'string')
      .slice(0, MAX_NOTES)
      .map(n => ({
        id: n.id,
        text: typeof n.text === 'string' ? n.text.slice(0, MAX_CHARS) : '',
        color: COLORS.some(([c]) => c === n.color) ? n.color : 'paper',
        updatedAt: Number.isFinite(n.updatedAt) ? n.updatedAt : Date.now(),
      }))
    if (notes.length) {
      const activeId = notes.some(n => n.id === raw.activeId) ? raw.activeId : notes[0].id
      return { activeId, notes }
    }
  }
  const initial = makeNote('', 'paper')
  return { activeId: initial.id, notes: [initial] }
}

export function mountScratchpad(win) {
  if (instances.has(win)) return instances.get(win)
  const doc = win.document
  const prefs = getPrefs(win)

  const wrap = node(doc, 'section', 'aw-scratchpad-stack')
  wrap.hidden = true
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-label', '船坞堆叠便签')

  // Visual stacked sheets peeking out beneath the active card; clicking cycles the stack.
  const backTwo = node(doc, 'button', 'aw-sp-sheet aw-sp-sheet-2')
  backTwo.setAttribute('aria-label', '翻到下一张便签')
  backTwo.title = '点击翻下一张便签'
  const backOne = node(doc, 'button', 'aw-sp-sheet aw-sp-sheet-1')
  backOne.setAttribute('aria-label', '翻到下一张便签')
  backOne.title = '点击翻下一张便签'

  const panel = node(doc, 'div', 'aw-scratchpad')

  const head = node(doc, 'div', 'aw-sp-head')
  const title = node(doc, 'strong', 'aw-sp-title', '船坞便签堆')
  const countBadge = node(doc, 'span', 'aw-sp-count', '1/1')
  const cycleBtn = node(doc, 'button', 'aw-sp-icon-btn', '↻')
  cycleBtn.title = '翻到下一张便签'
  cycleBtn.setAttribute('aria-label', '翻到下一张便签')
  const addBtn = node(doc, 'button', 'aw-sp-icon-btn', '＋')
  addBtn.title = '新建一张便签'
  addBtn.setAttribute('aria-label', '新建一张便签')
  const closeBtn = node(doc, 'button', 'aw-sp-close', '×')
  closeBtn.setAttribute('aria-label', '关闭随手便签')
  head.append(title, countBadge, cycleBtn, addBtn, closeBtn)

  const tabs = node(doc, 'div', 'aw-sp-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', '便签列表')

  const area = node(doc, 'textarea', 'aw-sp-area')
  area.placeholder = '记下临时 trace_id、排查结论或下一轮要追问的清单…'
  area.setAttribute('aria-label', '当前便签内容')

  const toolbar = node(doc, 'div', 'aw-sp-toolbar')
  const swatches = node(doc, 'div', 'aw-sp-swatches')
  swatches.setAttribute('role', 'group')
  swatches.setAttribute('aria-label', '便签纸色')
  const swatchBtns = COLORS.map(([color, label]) => {
    const btn = node(doc, 'button', 'aw-sp-swatch')
    btn.dataset.color = color
    btn.title = label
    btn.setAttribute('aria-label', '切换为' + label)
    btn.addEventListener('click', () => {
      const cur = activeNote()
      if (!cur || cur.color === color) return
      cur.color = color
      cur.updatedAt = Date.now()
      playMechanicalClick(win, prefs)
      persistNow()
      renderStack()
    })
    swatches.append(btn)
    return [color, btn]
  })
  const meta = node(doc, 'span', 'aw-sp-meta', '0 字')
  toolbar.append(swatches, meta)

  const actions = node(doc, 'div', 'aw-sp-actions')
  const copyBtn = node(doc, 'button', 'aw-sp-btn', '复制')
  const insertBtn = node(doc, 'button', 'aw-sp-btn', '填入输入框')
  const undoBtn = node(doc, 'button', 'aw-sp-btn', '撤销清空')
  undoBtn.hidden = true
  const clearBtn = node(doc, 'button', 'aw-sp-btn aw-sp-danger', '清空')
  const deleteBtn = node(doc, 'button', 'aw-sp-btn', '删此张')
  actions.append(copyBtn, insertBtn, undoBtn, clearBtn, deleteBtn)

  const status = node(doc, 'div', 'aw-sp-status')
  status.setAttribute('role', 'status')

  panel.append(head, tabs, area, toolbar, actions, status)
  wrap.append(backTwo, backOne, panel)
  doc.body.append(wrap)

  let data = normalizeStore(prefs.get(KEY))
  let returnFocus = null
  let lastCleared = ''
  let lastClearedId = ''
  let saveTimer
  let statusTimer
  let externalInserter = null

  const activeIndex = () => Math.max(0, data.notes.findIndex(n => n.id === data.activeId))
  const activeNote = () => data.notes[activeIndex()] ?? data.notes[0]

  function setStatus(msg) {
    status.textContent = msg
    win.clearTimeout(statusTimer)
    if (msg) statusTimer = win.setTimeout(() => { status.textContent = '' }, 2200)
  }

  function persistNow() {
    win.clearTimeout(saveTimer)
    const ok = prefs.set(KEY, data)
    if (!ok) setStatus('本机存储空间不足，仅在本次窗口内保留。')
  }

  function syncMeta() {
    const text = area.value
    meta.textContent = `${text.length} 字`
    copyBtn.disabled = !text.trim()
    insertBtn.disabled = !text.trim()
    clearBtn.disabled = !text
  }

  function renderStack() {
    const idx = activeIndex()
    const cur = activeNote()
    const total = data.notes.length
    panel.dataset.color = cur.color
    wrap.dataset.depth = String(Math.min(total, 3))
    countBadge.textContent = `${idx + 1}/${total}`
    cycleBtn.disabled = total < 2
    addBtn.disabled = total >= MAX_NOTES
    deleteBtn.hidden = total < 2

    const next1 = data.notes[(idx + 1) % total]
    const next2 = data.notes[(idx + 2) % total]
    backOne.hidden = total < 2
    backTwo.hidden = total < 3
    if (next1) backOne.dataset.color = next1.color
    if (next2) backTwo.dataset.color = next2.color

    for (const [color, btn] of swatchBtns) {
      btn.setAttribute('aria-pressed', String(color === cur.color))
    }

    tabs.replaceChildren()
    for (const [i, item] of data.notes.entries()) {
      const tab = node(doc, 'button', 'aw-sp-tab', noteLabel(item, i))
      tab.dataset.color = item.color
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(item.id === cur.id))
      tab.addEventListener('click', () => selectNote(item.id))
      tabs.append(tab)
    }

    if (area.value !== cur.text) area.value = cur.text
    undoBtn.hidden = !(lastCleared && lastClearedId === cur.id)
    syncMeta()
  }

  function selectNote(id) {
    if (data.activeId === id) return
    persistNow()
    data.activeId = id
    playMechanicalClick(win, prefs)
    persistNow()
    renderStack()
    area.focus({ preventScroll: true })
  }

  function cycleNext() {
    if (data.notes.length < 2) return
    const next = data.notes[(activeIndex() + 1) % data.notes.length]
    selectNote(next.id)
  }

  function addNote() {
    if (data.notes.length >= MAX_NOTES) {
      setStatus(`最多同时堆叠 ${MAX_NOTES} 张便签`)
      return
    }
    persistNow()
    const nextColor = COLORS[data.notes.length % COLORS.length][0]
    const created = makeNote('', nextColor)
    data.notes.push(created)
    data.activeId = created.id
    playMechanicalClick(win, prefs)
    persistNow()
    renderStack()
    area.focus({ preventScroll: true })
  }

  function deleteCurrent() {
    if (data.notes.length < 2) return
    const idx = activeIndex()
    data.notes.splice(idx, 1)
    data.activeId = data.notes[Math.min(idx, data.notes.length - 1)].id
    lastCleared = ''
    lastClearedId = ''
    playMechanicalClick(win, prefs)
    persistNow()
    renderStack()
    setStatus('已移除该张便签')
  }

  backOne.addEventListener('click', cycleNext)
  backTwo.addEventListener('click', cycleNext)
  cycleBtn.addEventListener('click', cycleNext)
  addBtn.addEventListener('click', addNote)
  deleteBtn.addEventListener('click', deleteCurrent)

  area.addEventListener('input', () => {
    const cur = activeNote()
    cur.text = area.value.slice(0, MAX_CHARS)
    cur.updatedAt = Date.now()
    lastCleared = ''
    lastClearedId = ''
    undoBtn.hidden = true
    const activeTab = tabs.children[activeIndex()]
    if (activeTab) activeTab.textContent = noteLabel(cur, activeIndex())
    syncMeta()
    win.clearTimeout(saveTimer)
    saveTimer = win.setTimeout(persistNow, 260)
  })

  copyBtn.addEventListener('click', async () => {
    if (!area.value.trim()) return
    try {
      await win.navigator.clipboard.writeText(area.value)
      setStatus('已复制到剪贴板')
    } catch {
      setStatus('剪贴板不可用')
    }
  })

  insertBtn.addEventListener('click', () => {
    const text = area.value.trim()
    if (!text) return
    if (externalInserter?.(text)) {
      playMechanicalClick(win, prefs)
      setStatus('已填入输入框')
      close()
      return
    }
    const editor = doc.querySelector('[data-composer-input]')
    if (!editor) { setStatus('当前页面没有可填入的输入框'); return }
    if (editor.localName === 'textarea' || editor.localName === 'input') {
      const start = editor.selectionStart ?? editor.value.length
      const end = editor.selectionEnd ?? editor.value.length
      editor.setRangeText(text, start, end, 'end')
      editor.dispatchEvent(new win.Event('input', { bubbles: true }))
      editor.focus({ preventScroll: true })
      setStatus('已填入输入框')
      close()
      return
    }
    try {
      editor.focus({ preventScroll: true })
      if (doc.execCommand?.('insertText', false, text)) {
        setStatus('已填入输入框')
        close()
      } else {
        setStatus('无法直接填入，请先点击复制')
      }
    } catch {
      setStatus('无法直接填入，请先点击复制')
    }
  })

  clearBtn.addEventListener('click', () => {
    if (!area.value) return
    const cur = activeNote()
    lastCleared = cur.text
    lastClearedId = cur.id
    cur.text = ''
    cur.updatedAt = Date.now()
    area.value = ''
    persistNow()
    renderStack()
    setStatus('已清空（可点击撤销）')
  })

  undoBtn.addEventListener('click', () => {
    const cur = activeNote()
    if (!lastCleared || lastClearedId !== cur.id) return
    cur.text = lastCleared
    cur.updatedAt = Date.now()
    lastCleared = ''
    lastClearedId = ''
    persistNow()
    renderStack()
    setStatus('已恢复便签内容')
  })

  function onKey(event) {
    if (event.key === 'Escape' && !event.isComposing && !wrap.hidden) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  function outside(event) {
    if (!wrap.hidden && !wrap.contains(event.target) && event.target !== returnFocus) close()
  }

  function open(anchor) {
    if (!wrap.hidden) { close(); return }
    returnFocus = anchor || doc.activeElement
    data = normalizeStore(prefs.get(KEY))
    renderStack()
    wrap.hidden = false
    playMechanicalClick(win, prefs)
    doc.addEventListener('keydown', onKey, true)
    doc.addEventListener('pointerdown', outside, true)
    area.focus({ preventScroll: true })
  }

  function close() {
    if (wrap.hidden) return
    persistNow()
    wrap.hidden = true
    doc.removeEventListener('keydown', onKey, true)
    doc.removeEventListener('pointerdown', outside, true)
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true })
    }
    returnFocus = null
  }

  closeBtn.addEventListener('click', close)
  const unsub = prefs.subscribe(key => {
    if ((key === null || key === KEY) && doc.activeElement !== area) {
      data = normalizeStore(prefs.get(KEY))
      renderStack()
    }
  })
  renderStack()

  const api = {
    open, close, addNote, cycleNext,
    toggle(anchor) { wrap.hidden ? open(anchor) : close() },
    setInserter(fn) { externalInserter = fn },
    isOpen: () => !wrap.hidden,
    noteCount: () => data.notes.length,
    destroy() {
      close()
      unsub()
      win.clearTimeout(saveTimer)
      win.clearTimeout(statusTimer)
      wrap.remove()
      instances.delete(win)
    },
  }
  instances.set(win, api)
  return api
}

export function showScratchpad(win, anchor) {
  mountScratchpad(win).open(anchor)
}

export function toggleScratchpad(win, anchor) {
  mountScratchpad(win).toggle(anchor)
}
