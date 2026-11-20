import { getPrefs } from './prefs.js'

const slot = 'conversation.input.left'
const templates = {
  '开发': [
    ['代码审查', '请审查这段代码，按影响程度列出问题、触发条件和建议的修改。'],
    ['定位修 Bug', '请根据复现步骤和日志定位原因，给出最小修复并说明如何验证。'],
    ['补单元测试', '请为这段逻辑补单元测试，覆盖正常输入、边界值和失败路径。'],
    ['解释这段代码', '请解释这段代码的输入、输出和执行过程，并用一个例子说明。'],
  ],
  '协作': [
    ['整理要点', '请整理当前讨论的要点，列出结论和仍待确认的问题。'],
    ['检查改动', '请检查当前改动，优先列出可能影响使用的问题。'],
    ['写份交接', '请写一份简短交接，包含已完成的工作、待办和下一步。'],
    ['生成 Commit Message', '请根据当前更改写一条简洁的 Commit Message，说明改动的目的。'],
  ],
  '自定义': [],
}
const tick = '`'
const wrappers = [
  [tick.repeat(3), '包裹为代码块', text => {
    const runs = text.match(/`+/g) || []
    const fence = tick.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3))
    return fence + '\n' + text + '\n' + fence
  }],
  [tick, '包裹为行内代码', text => {
    const runs = text.match(/`+/g) || []
    const fence = tick.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 1))
    const padded = text.startsWith(tick) || text.endsWith(tick)
      || (text.startsWith(' ') && text.endsWith(' ') && text.trim())
    return fence + (padded ? ' ' + text + ' ' : text) + fence
  }],
  ['>', '包裹为引用块', text => text.split('\n').map(line => '> ' + line).join('\n')],
  ['<context>', '包裹为上下文标签', text => '<context>\n' + text + '\n</context>'],
]
const draftPrefix = 'typing.draft.'
const lastPhrases = 'typing.phrases'
const lastSound = 'typing.sound'
const atomSelector = '[data-composer-chip], [data-composer-command], [data-composer-quote]'
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

function characterCount(text) {
  if (!text) return 0
  if (!segmenter) return Array.from(text).length
  let n = 0
  for (const _ of segmenter.segment(text)) n++
  return n
}

function readPhrases(prefs) {
  const phrases = prefs.get(lastPhrases)
  return Array.isArray(phrases) ? phrases.filter(text => typeof text === 'string' && text.trim()) : []
}

function soundEnabled(prefs) {
  const value = prefs.get(lastSound)
  return value === true || value === 'on' // Raw v0.4 storage used on/off.
}

function readDraft(prefs, key) {
  const draft = key && prefs.get(key)
  return typeof draft?.text === 'string' && Number.isFinite(draft.at) ? draft : null
}

function trimDrafts(prefs) {
  const drafts = prefs.keys(draftPrefix).map(key => ({ key, at: readDraft(prefs, key)?.at ?? 0 }))
  drafts.sort((a, b) => b.at - a.at || b.key.localeCompare(a.key))
  for (const entry of drafts.slice(20)) prefs.remove(entry.key)
}

function selectedText(editor, span, draft) {
  if (span.start === span.end) return ''
  // The host counts a reference, command or quote as one offset, while its
  // public draft expands it to plain text. A crossing edit would erase that chip.
  if (!editor.querySelector(atomSelector)) return draft.slice(span.start, span.end)
  const selection = editor.ownerDocument.defaultView.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null
  const range = selection.getRangeAt(0)
  if ([...editor.querySelectorAll(atomSelector)].some(node => range.intersectsNode(node))) return null
  const selected = selection.toString()
  return selected || null
}

function draftBackup(win, prefs, sessionId, report) {
  const key = sessionId ? draftPrefix + sessionId : null
  let lastText, pending, baseline, timer
  function cancel() {
    win.clearTimeout(timer)
    pending = undefined
  }
  function clear() {
    cancel()
    if (key && readDraft(prefs, key) && !prefs.remove(key)) report('本机存储不可用，暂存草稿仅在此窗口清除。')
  }
  function flush() {
    if (pending === undefined) return
    const text = pending
    cancel()
    const other = readDraft(prefs, key)
    if (other?.at !== baseline?.at || other?.text !== baseline?.text) {
      report('另一窗口已更改暂存草稿。本窗口的文字仍在输入框中。')
      return
    }
    if (new win.Blob([text]).size > 20 * 1024) {
      report('草稿超过 20 KB，本次改动未暂存。')
      return
    }
    const at = win.performance.timeOrigin + win.performance.now()
    const durable = prefs.set(key, { text, at })
    trimDrafts(prefs)
    report(durable ? '' : '本机存储不可用，此草稿仅暂存在当前窗口。')
  }
  function update(text) {
    const before = lastText
    lastText = text
    if (!key || before === undefined || before === text) return
    if (!text) { report(''); clear(); return }
    if (pending === undefined) baseline = readDraft(prefs, key)
    pending = text
    win.clearTimeout(timer)
    timer = win.setTimeout(flush, 500)
  }
  return { key, read: () => readDraft(prefs, key)?.text || '', update, flush, clear }
}

// A short felt-damped impact, synthesized once per audio device. All strokes
// share the same quiet output level and are triggered only by editing gestures.
function keySound(win) {
  let ctx, buffer, last = -Infinity
  function close() {
    const old = ctx
    ctx = buffer = undefined
    last = -Infinity
    if (old && old.state !== 'closed') Promise.resolve(old.close()).catch(() => {})
  }
  function unlock() {
    try {
      const Audio = win.AudioContext || win.webkitAudioContext
      if (!Audio) return false
      if (!ctx || ctx.state === 'closed') {
        ctx = new Audio()
        const rate = ctx.sampleRate
        buffer = ctx.createBuffer(1, Math.ceil(rate * 0.046), rate)
        const samples = buffer.getChannelData(0)
        let previous = 0
        for (let i = 0; i < samples.length; i++) {
          const t = i / rate
          const noise = Math.random() * 2 - 1
          const envelope = Math.min(t * 2200, 1) * Math.exp(-180 * t)
          samples[i] = envelope * (0.061 * (noise - previous) + 0.043 * Math.sin(t * 2960))
            + 0.021 * Math.sin(t * 1260) * Math.min(t * 900, 1) * Math.exp(-120 * t)
          previous = noise
        }
      }
      if (ctx.state === 'suspended') Promise.resolve(ctx.resume()).catch(() => {})
      return true
    } catch { close(); return false }
  }
  function hit() {
    if (!unlock() || ctx.state !== 'running' || ctx.currentTime - last < 0.035) return
    last = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => source.disconnect()
    source.start()
  }
  return { unlock, hit, close }
}

export function redactSecrets(text) {
  if (!text) return { text: '', hits: 0 }
  let hits = 0
  const rules = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi,
    /((?:api[_-]?key|token|secret|password|passwd|cookie)\s*[:=]\s*["']?)([^\s"',;]{6,})(["']?)/gi,
    /\b1[3-9]\d{9}\b/g,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  ]
  let out = text
  out = out.replace(rules[0], () => { hits++; return '[REDACTED_KEY]' })
  out = out.replace(rules[1], () => { hits++; return '[REDACTED_TOKEN]' })
  out = out.replace(rules[2], () => { hits++; return '[REDACTED_AWS_KEY]' })
  out = out.replace(rules[3], (_, p1) => { hits++; return p1 + '[REDACTED]' })
  out = out.replace(rules[4], (_, p1, _v, p3) => { hits++; return p1 + '[REDACTED]' + p3 })
  out = out.replace(rules[5], () => { hits++; return '[REDACTED_PHONE]' })
  out = out.replace(rules[6], () => { hits++; return '[REDACTED_EMAIL]' })
  return { text: out, hits }
}

export function cleanTerminalLog(text) {
  if (!text) return { text: '', changed: false }
  const out = text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: out, changed: out !== text }
}

function element(doc, tag, className, text) {
  const el = doc.createElement(tag)
  el.className = className
  if (text) el.textContent = text
  if (tag === 'button') el.type = 'button'
  return el
}

let panelId = 0

function mountTools(anchor, editor, actions, prefs, sessionId) {
  const doc = anchor.ownerDocument
  const win = doc.defaultView
  const card = editor.closest('[data-composer-card]')
  const button = element(doc, 'button', 'aw-tw-launch')
  const glyph = element(doc, 'span', 'aw-tw-key')
  glyph.setAttribute('aria-hidden', 'true')
  const count = element(doc, 'span', 'aw-tw-count')
  button.append(glyph, count)
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-expanded', 'false')
  anchor.append(button)
  const ink = element(doc, 'i', 'aw-tw-ink')
  ink.setAttribute('aria-hidden', 'true')
  card.append(ink)

  const panel = element(doc, 'section', 'aw-tw-panel')
  panel.id = 'aw-input-tools-' + ++panelId
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', '输入工具')
  button.setAttribute('aria-controls', panel.id)
  // Keep the panel out of the editor's mouse/keyboard event plane and out of
  // clipping ancestors in the sticky composer. Its limits follow the viewport.
  doc.body.append(panel)
  const heading = element(doc, 'div', 'aw-tw-title')
  heading.append(element(doc, 'strong', '', '输入工具'))
  const toggle = element(doc, 'button', 'aw-tw-audio', '键声')
  toggle.setAttribute('aria-label', '打字机键声')
  heading.append(toggle)
  const recover = element(doc, 'button', 'aw-tw-recover')
  recover.hidden = true
  anchor.append(recover)
  const backupNotice = element(doc, 'span', 'aw-tw-backup-note')
  backupNotice.setAttribute('role', 'status')
  backupNotice.hidden = true
  anchor.append(backupNotice)
  const backup = draftBackup(win, prefs, sessionId, message => {
    backupNotice.textContent = message
    backupNotice.hidden = !message
  })
  const format = element(doc, 'div', 'aw-tw-format')
  format.setAttribute('role', 'group')
  format.setAttribute('aria-label', '快捷包裹')
  for (const [symbol, name, wrap] of wrappers) {
    const action = element(doc, 'button', 'aw-tw-wrap', symbol)
    action.title = name
    action.setAttribute('aria-label', name)
    action.addEventListener('click', () => {
      if (selectionText == null) { feedback.textContent = '请选中普通文字，引用和命令标签须保留。'; return }
      insert(wrap(selectionText))
    })
    format.append(action)
  }
  const redactBtn = element(doc, 'button', 'aw-tw-wrap', '脱敏')
  redactBtn.title = '一键脱敏选中文本中的密钥、Token、手机号与邮箱'
  redactBtn.setAttribute('aria-label', redactBtn.title)
  redactBtn.addEventListener('click', () => {
    if (!selectionText) { feedback.textContent = '请先在输入框中选中需要脱敏的文本。'; return }
    const { text: cleaned, hits } = redactSecrets(selectionText)
    if (!hits) { feedback.textContent = '未在选中文本中发现敏感凭据。'; return }
    insert(cleaned)
  })
  const cleanBtn = element(doc, 'button', 'aw-tw-wrap', '洗日志')
  cleanBtn.title = '清除选中日志中的 ANSI 终端色码与多余空行'
  cleanBtn.setAttribute('aria-label', cleanBtn.title)
  cleanBtn.addEventListener('click', () => {
    if (!selectionText) { feedback.textContent = '请先在输入框中选中需要清洗的日志文本。'; return }
    const { text: cleaned, changed } = cleanTerminalLog(selectionText)
    if (!changed) { feedback.textContent = '选中文本已经很干净，无需清洗。'; return }
    insert(cleaned)
  })
  format.append(redactBtn, cleanBtn)
  const tabBar = element(doc, 'div', 'aw-tw-tabs')
  tabBar.setAttribute('role', 'tablist')
  tabBar.setAttribute('aria-label', '提示词分类')
  let category = '开发'
  const pane = element(doc, 'div', 'aw-tw-tabpanel')
  pane.id = panel.id + '-templates'
  pane.setAttribute('role', 'tabpanel')
  for (const [i, name] of Object.keys(templates).entries()) {
    const tab = element(doc, 'button', 'aw-tw-tab', name)
    tab.id = panel.id + '-category-' + i
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', pane.id)
    tab.addEventListener('click', () => { selectCategory(name); position() })
    tab.addEventListener('keydown', event => {
      const tabs = [...tabBar.children]
      const next = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]
      if (next === undefined) return
      event.preventDefault()
      tabs[next].click()
      tabs[next].focus()
    })
    tabBar.append(tab)
  }
  const items = element(doc, 'div', 'aw-tw-list')
  const custom = element(doc, 'div', 'aw-tw-custom')
  const add = element(doc, 'div', 'aw-tw-add')
  const field = element(doc, 'textarea', 'aw-tw-field')
  field.rows = 2
  field.placeholder = '写一条常用短语…'
  field.setAttribute('aria-label', '自定义常用短语')
  const save = element(doc, 'button', 'aw-tw-save', '保存短语')
  save.disabled = true
  add.append(field, save)
  const transfer = element(doc, 'div', 'aw-tw-transfer')
  const exportJson = element(doc, 'button', 'aw-tw-export', '复制 JSON')
  const importJson = element(doc, 'button', 'aw-tw-import', '导入 JSON')
  transfer.append(exportJson, importJson)
  const entry = element(doc, 'div', 'aw-tw-json-entry')
  entry.id = panel.id + '-json'
  entry.hidden = true
  importJson.setAttribute('aria-controls', entry.id)
  importJson.setAttribute('aria-expanded', 'false')
  const json = element(doc, 'textarea', 'aw-tw-field aw-tw-json')
  json.placeholder = '["短语一", "短语二"]'
  json.setAttribute('aria-label', '短语 JSON 数组')
  const confirm = element(doc, 'button', 'aw-tw-confirm', '合并短语')
  entry.append(json, confirm)
  custom.append(add, transfer, entry)
  pane.append(items, custom)
  const odometer = element(doc, 'div', 'aw-tw-odometer')
  const odoTodayCell = element(doc, 'div', 'aw-tw-odo-cell')
  const odoTodayVal = element(doc, 'span', 'aw-tw-odo-val', '0')
  odoTodayCell.append(element(doc, 'span', 'aw-tw-odo-label', '今日打字'), odoTodayVal)
  const odoTotalCell = element(doc, 'div', 'aw-tw-odo-cell')
  const odoTotalVal = element(doc, 'span', 'aw-tw-odo-val', '0')
  odoTotalCell.append(element(doc, 'span', 'aw-tw-odo-label', '历史累计'), odoTotalVal)
  odometer.append(odoTodayCell, odoTotalCell)

  const feedback = element(doc, 'div', 'aw-tw-note')
  feedback.setAttribute('role', 'status')
  panel.append(heading, odometer, format, tabBar, pane, feedback)

  const numFmt = new Intl.NumberFormat('zh-CN')
  const todayKey = () => {
    const d = new Date()
    const p = v => String(v).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  function readStats() {
    const raw = prefs.get('typing.stats')
    if (raw && typeof raw === 'object') {
      const total = Number.isFinite(raw.total) && raw.total >= 0 ? Math.floor(raw.total) : 0
      const days = raw.days && typeof raw.days === 'object' ? { ...raw.days } : {}
      return { total, days }
    }
    return { total: 0, days: {} }
  }
  function refreshOdometer() {
    const stats = readStats()
    const dayCount = Number(stats.days[todayKey()] || 0)
    odoTodayVal.textContent = numFmt.format(dayCount)
    odoTotalVal.textContent = numFmt.format(stats.total)
    return { today: dayCount, total: stats.total }
  }
  function recordTyped(added) {
    if (!added || added <= 0) return
    const stats = readStats()
    const key = todayKey()
    stats.total += added
    stats.days[key] = (Number(stats.days[key]) || 0) + added
    const keys = Object.keys(stats.days).sort()
    while (keys.length > 90) delete stats.days[keys.shift()]
    prefs.set('typing.stats', stats)
    refreshOdometer()
    refreshCount()
  }

  const audio = keySound(win)
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  let composing = false, imeTail = '', tailTimer, caretFrame, flashTimer, countTimer, draft = '', locked = false
  let captured = null, selectionText = null, draftRevision, disposed = false
  function capture() {
    captured = actions.captureInsertion()
    selectionText = captured ? selectedText(editor, captured, draft) : null
  }
  function updateRecovery() {
    const text = !draft && !locked && !composing && backup.read()
    recover.hidden = !text
    if (text) {
      recover.textContent = '恢复草稿（' + characterCount(text) + ' 字）'
      recover.title = '将此会话的暂存文字恢复到输入框'
    }
  }
  function refreshCount() {
    const n = characterCount(draft)
    const { today, total } = refreshOdometer()
    count.hidden = n === 0 && total === 0
    count.textContent = n ? String(n) : (total ? numFmt.format(total) : '')
    button.title = total
      ? `输入工具 · 草稿 ${n} 字（今日 ${numFmt.format(today)} / 累计 ${numFmt.format(total)}）`
      : '输入工具 · ' + n + ' 字'
    button.setAttribute('aria-label', button.title)
  }
  function update(text, frozen, revision) {
    draftRevision = revision
    if (locked && !frozen && !text) backup.clear()
    if (draft !== text) {
      draft = text
      win.clearTimeout(countTimer)
      countTimer = win.setTimeout(refreshCount, 65)
    }
    if (!composing) backup.update(draft)
    locked = Boolean(frozen)
    updateRecovery()
    button.disabled = locked || composing
    if (locked && !panel.hidden) close()
  }
  function showCaretStrike() {
    if (!editor.isContentEditable || !editor.isConnected || doc.activeElement !== editor) return
    const selection = win.getSelection()
    if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return
    const at = selection.getRangeAt(0).getClientRects?.()[0]
    if (!at || !at.height) return
    const box = card.getBoundingClientRect()
    const area = editor.getBoundingClientRect()
    if (at.bottom > Math.min(box.bottom, area.bottom) + 1 || at.top < Math.max(box.top, area.top) - 1) return
    ink.style.left = (at.left - box.left) + 'px'
    ink.style.top = (at.bottom - box.top - 1) + 'px'
    ink.setAttribute('data-hit', '')
  }
  function strike() {
    if (locked || doc.hidden) return
    if (soundEnabled(prefs)) audio.hit()
    if (reduced?.matches) return
    glyph.setAttribute('data-hit', '')
    if (caretFrame !== undefined) win.cancelAnimationFrame?.(caretFrame)
    caretFrame = win.requestAnimationFrame?.(showCaretStrike)
    win.clearTimeout(flashTimer)
    flashTimer = win.setTimeout(() => {
      glyph.removeAttribute('data-hit')
      ink.removeAttribute('data-hit')
    }, 80)
  }
  function onBefore(event) {
    if (composing || event.isComposing || event.inputType !== 'insertText' || !event.data) return
    if (imeTail && imeTail === event.data) { imeTail = ''; return }
    strike()
    recordTyped(characterCount(event.data))
  }
  function onCompositionStart() {
    composing = true
    imeTail = ''
    button.disabled = true
    recover.hidden = true
    if (!panel.hidden) close()
  }
  function onCompositionEnd(event) {
    composing = false
    button.disabled = locked
    backup.update(draft)
    updateRecovery()
    if (!event.data) return
    strike()
    recordTyped(characterCount(event.data))
    imeTail = event.data
    win.clearTimeout(tailTimer)
    tailTimer = win.setTimeout(() => { imeTail = '' }, 0)
  }
  editor.addEventListener('beforeinput', onBefore, true)
  editor.addEventListener('compositionstart', onCompositionStart)
  editor.addEventListener('compositionend', onCompositionEnd)

  function position() {
    if (panel.hidden) return
    const a = button.getBoundingClientRect()
    const w = win.innerWidth, h = win.innerHeight
    const margin = 8
    const topSpace = a.top - 2 * margin
    const downSpace = h - a.bottom - 2 * margin
    const above = topSpace >= Math.min(330, downSpace)
    panel.style.maxHeight = Math.max(50, above ? topSpace : downSpace) + 'px'
    panel.style.left = Math.max(margin, Math.min(a.left, w - panel.offsetWidth - margin)) + 'px'
    panel.style.top = (above ? Math.max(margin, a.top - panel.offsetHeight - margin) : a.bottom + margin) + 'px'
  }
  function outside(event) { if (!panel.contains(event.target) && !button.contains(event.target)) close() }
  function onKey(event) {
    if (event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    close()
    button.focus({ preventScroll: true })
  }
  function close() {
    panel.hidden = true
    button.setAttribute('aria-expanded', 'false')
    captured = null
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('focusin', outside, true)
    doc.removeEventListener('keydown', onKey, true)
    win.removeEventListener('resize', position)
  }
  function open() {
    if (!panel.hidden) { close(); return }
    if (locked || composing) return
    if (!captured) capture()
    panel.hidden = false
    button.setAttribute('aria-expanded', 'true')
    selectCategory(category)
    position()
    doc.addEventListener('pointerdown', outside, true)
    doc.addEventListener('focusin', outside, true)
    doc.addEventListener('keydown', onKey, true)
    win.addEventListener('resize', position)
    format.firstElementChild.focus({ preventScroll: true })
  }
  button.addEventListener('pointerdown', () => {
    if (panel.hidden && !locked && !composing) capture()
  })
  button.addEventListener('click', open)
  function insert(text) {
    if (captured && selectionText == null) {
      feedback.textContent = '请选中普通文字，引用和命令标签须保留。'
      return
    }
    if (locked || composing || !captured || (draftRevision != null && captured.draftRev !== draftRevision)
      || !actions.insertText(text, captured)) {
      feedback.textContent = '草稿已变动，请重新打开输入工具。'
      return
    }
    close()
    editor.focus({ preventScroll: true })
  }
  function row(label, text, custom) {
    const line = element(doc, 'div', 'aw-tw-row')
    const pick = element(doc, 'button', 'aw-tw-pick', label)
    pick.title = text
    pick.addEventListener('click', () => insert(text))
    line.append(pick)
    if (custom) {
      const remove = element(doc, 'button', 'aw-tw-remove', '×')
      remove.setAttribute('aria-label', '移除短语：' + text)
      remove.addEventListener('click', () => {
        const durable = prefs.set(lastPhrases, readPhrases(prefs).filter(s => s !== text))
        feedback.textContent = durable ? '已移除短语。' : '本机存储不可用，仅在此窗口移除短语。'
        field.focus()
      })
      line.append(remove)
    }
    return line
  }
  function renderItems() {
    const rows = category === '自定义'
      ? readPhrases(prefs).map(text => row(text, text, true))
      : templates[category].map(([label, text]) => row(label, text, false))
    items.replaceChildren(...rows)
  }
  function selectCategory(name) {
    category = name
    for (const tab of tabBar.children) {
      const selected = tab.textContent === name
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      if (selected) pane.setAttribute('aria-labelledby', tab.id)
    }
    custom.hidden = name !== '自定义'
    feedback.textContent = ''
    renderItems()
  }
  function openJson() {
    entry.hidden = false
    importJson.setAttribute('aria-expanded', 'true')
    position()
    json.focus()
  }
  importJson.addEventListener('click', () => {
    if (entry.hidden) openJson()
    else { entry.hidden = true; importJson.setAttribute('aria-expanded', 'false'); position() }
  })
  confirm.addEventListener('click', () => {
    let imported
    try { imported = JSON.parse(json.value) } catch { feedback.textContent = 'JSON 语法错误，请检查引号和逗号。'; return }
    if (!Array.isArray(imported) || !imported.every(x => typeof x === 'string' && x.trim())) {
      feedback.textContent = '请输入由非空字符串组成的 JSON 数组。'
      return
    }
    const existing = readPhrases(prefs)
    const merged = [...new Set([...existing, ...imported.map(x => x.trim())])]
    const delta = merged.length - existing.length
    if (!delta) { feedback.textContent = '没有需要添加的新短语。'; return }
    const durable = prefs.set(lastPhrases, merged)
    json.value = ''
    entry.hidden = true
    importJson.setAttribute('aria-expanded', 'false')
    feedback.textContent = '已合并 ' + delta + ' 条短语。' + (durable ? '' : '本机存储不可用，仅在此窗口生效。')
    importJson.focus()
    position()
  })
  exportJson.addEventListener('click', async () => {
    const content = JSON.stringify(readPhrases(prefs), null, 2)
    try {
      await win.navigator.clipboard.writeText(content)
      if (!disposed) feedback.textContent = '短语 JSON 已复制。'
    } catch {
      if (disposed) return
      // Keep any unsubmitted JSON in the import field intact on export failure.
      feedback.textContent = '剪贴板不可用，请复制下方 JSON。'
      const copy = element(doc, 'textarea', 'aw-tw-field aw-tw-copy')
      copy.readOnly = true
      copy.setAttribute('aria-label', '导出的短语 JSON')
      copy.value = content
      feedback.append(copy)
      position()
      copy.focus()
      copy.select()
    }
  })
  let enabled = soundEnabled(prefs)
  function sync(key) {
    if (key == null || key === lastSound) {
      const sound = soundEnabled(prefs)
      toggle.setAttribute('aria-pressed', String(sound))
      if (!sound && enabled) audio.close()
      enabled = sound
    }
    if (!panel.hidden && category === '自定义' && (key == null || key === lastPhrases)) { renderItems(); position() }
    if (key == null || key === backup.key) updateRecovery()
  }
  const unsubscribe = prefs.subscribe(sync)
  toggle.addEventListener('click', () => {
    const sound = soundEnabled(prefs)
    if (!sound && !audio.unlock()) { feedback.textContent = '当前设备无法播放键声。'; return }
    if (!prefs.set(lastSound, !sound)) feedback.textContent = '本机存储不可用，键声设置仅在此窗口生效。'
  })
  recover.addEventListener('click', () => {
    if (locked || composing || draft) return
    const text = backup.read()
    if (!text) { updateRecovery(); return }
    const at = actions.captureInsertion()
    if (at && at.start === 0 && at.end === 0 && (draftRevision == null || at.draftRev === draftRevision)
      && actions.insertText(text, at)) {
      editor.focus({ preventScroll: true })
    } else {
      backupNotice.hidden = false
      backupNotice.textContent = '输入内容已变动，暂存草稿仍在。'
    }
  })
  field.addEventListener('input', () => { save.disabled = !field.value.trim() })
  save.addEventListener('click', () => {
    const text = field.value.trim()
    if (!text) return
    const existing = readPhrases(prefs)
    if (existing.includes(text)) { feedback.textContent = '这条短语已经保存。'; return }
    const stored = prefs.set(lastPhrases, [...existing, text])
    field.value = ''; save.disabled = true
    feedback.textContent = stored ? '已保存到本机。' : '已暂存至本次窗口关闭。'
    field.focus()
    position()
  })
  function hide() { if (doc.hidden) { close(); audio.close(); backup.flush() } }
  win.addEventListener('pagehide', backup.flush)
  doc.addEventListener('visibilitychange', hide)
  sync()
  refreshCount()
  function destroy() {
    disposed = true
    close()
    unsubscribe()
    backup.flush()
    win.removeEventListener('pagehide', backup.flush)
    audio.close()
    doc.removeEventListener('visibilitychange', hide)
    editor.removeEventListener('beforeinput', onBefore, true)
    editor.removeEventListener('compositionstart', onCompositionStart)
    editor.removeEventListener('compositionend', onCompositionEnd)
    for (const timer of [tailTimer, flashTimer, countTimer]) win.clearTimeout(timer)
    if (caretFrame !== undefined) win.cancelAnimationFrame?.(caretFrame)
    panel.remove(); ink.remove(); button.remove(); recover.remove(); backupNotice.remove()
  }
  return { update, close, destroy, sent: backup.clear }
}

export function applyTypewriter(ctx, React, win) {
  const prefs = getPrefs(win)
  const active = new Set()
  let disposed = false
  function Toolbar({ useInput, inputActions, sessionId }) {
    const seat = React.useRef(null)
    const tools = React.useRef(null)
    const draft = useInput(s => s?.draft)
    const revision = useInput(s => s?.draftRev)
    const frozen = useInput(s => !['plain', 'claimed'].includes(s?.phase))
    React.useLayoutEffect(() => {
      if (disposed || !inputActions?.captureInsertion || !inputActions.insertText) return
      const editor = seat.current.closest('[data-composer-card]')?.querySelector('[data-composer-input]')
      if (!editor) return
      const instance = mountTools(seat.current, editor, inputActions, prefs, sessionId)
      active.add(instance)
      tools.current = instance
      return () => {
        if (active.delete(instance)) instance.destroy()
        tools.current = null
      }
    }, [inputActions, sessionId])
    React.useLayoutEffect(() => {
      tools.current?.update(draft ?? '', frozen, revision)
    }, [draft, frozen, revision, inputActions, sessionId])
    return React.createElement('span', { className: 'aw-tw-seat', ref: seat })
  }
  ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id: 'typing-tools' }, Toolbar))
  ctx.effect(() => () => {
    disposed = true
    for (const item of active) item.destroy()
    active.clear()
  })
}

export function mountTypewriterPreview(anchor, editor, initialSessionId) {
  const win = editor.ownerDocument.defaultView
  const prefs = getPrefs(win)
  let sessionId = initialSessionId
  let revision = 0
  function captureInsertion() {
    return { start: editor.selectionStart, end: editor.selectionEnd, draftRev: revision }
  }
  function insertText(text, span) {
    if (span.draftRev !== revision || editor.disabled) return false
    editor.setRangeText(text, span.start, span.end, 'end')
    editor.dispatchEvent(new win.Event('input', { bubbles: true }))
    return true
  }
  let tools = mountTools(anchor, editor, { captureInsertion, insertText }, prefs, sessionId)
  function update() { revision++; tools.update(editor.value, editor.disabled, revision) }
  editor.addEventListener('input', update)
  update()
  return {
    refresh() { tools.close(); update() },
    setSession(id) {
      if (id !== sessionId) {
        tools.destroy()
        sessionId = id
        tools = mountTools(anchor, editor, { captureInsertion, insertText }, prefs, id)
      }
      tools.close()
      update()
    },
    sent() { tools.sent() },
    destroy() { editor.removeEventListener('input', update); tools.destroy() },
  }
}
