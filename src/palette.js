import { getPrefs } from './prefs.js'
import { playMechanicalClick } from './sound.js'

const instances = new WeakMap()

function node(doc, tag, className, text = '') {
  const el = doc.createElement(tag)
  el.className = className
  if (text) el.textContent = text
  if (tag === 'button') el.type = 'button'
  return el
}

export function mountPalette(win) {
  if (instances.has(win)) return instances.get(win)
  const doc = win.document
  const prefs = getPrefs(win)

  const backdrop = node(doc, 'div', 'aw-palette-backdrop')
  backdrop.hidden = true

  const dialog = node(doc, 'section', 'aw-palette')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', '四号船坞指令台')

  const head = node(doc, 'div', 'aw-pal-head')
  const badge = node(doc, 'span', 'aw-pal-badge', 'Ctrl+K')
  const input = node(doc, 'input', 'aw-pal-input')
  input.type = 'search'
  input.autocomplete = 'off'
  input.placeholder = '搜索会话或船坞指令…（↑↓ 选择，Enter 执行，Esc 关闭）'
  input.setAttribute('aria-label', '搜索会话或船坞指令')
  head.append(badge, input)

  const list = node(doc, 'div', 'aw-pal-list')
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', '指令与会话列表')

  const empty = node(doc, 'p', 'aw-pal-empty', '没有匹配的会话或指令')
  empty.hidden = true

  dialog.append(head, list, empty)
  backdrop.append(dialog)
  doc.body.append(backdrop)

  let providers = { commands: () => [], sessions: () => [], openSession: null }
  let activeIndex = 0
  let renderedItems = []
  let returnFocus = null

  function allItems() {
    const term = input.value.trim().toLocaleLowerCase()
    const cmds = (providers.commands?.() ?? []).filter(c => !c.hidden)
    const sessions = (providers.sessions?.() ?? []).slice()
    sessions.sort((a, b) => Number(Boolean(b.waiting)) - Number(Boolean(a.waiting)) || (b.updatedAt || 0) - (a.updatedAt || 0))

    const sessionItems = sessions.map(s => ({
      id: 'session:' + s.id,
      group: '会话',
      title: s.title || '未命名会话',
      tag: s.waiting ? '待处理' : s.running ? '运行中' : s.pinned ? '置顶' : '',
      tagKind: s.waiting ? 'waiting' : s.running ? 'running' : s.pinned ? 'pinned' : '',
      keywords: (s.title || '') + ' ' + (s.waiting ? '待处理 审批 waiting' : ''),
      run() { providers.openSession?.(s.id) },
    }))

    const cmdItems = cmds.map(c => ({
      id: 'cmd:' + c.id,
      group: '指令',
      title: c.title,
      tag: c.hint || '',
      tagKind: c.kind || '',
      keywords: `${c.title} ${c.keywords || ''}`,
      run: c.run,
    }))

    const combined = [...cmdItems, ...sessionItems]
    if (!term) return [...cmdItems.slice(0, 8), ...sessionItems.slice(0, 12)]
    return combined.filter(item =>
      item.title.toLocaleLowerCase().includes(term) ||
      item.keywords.toLocaleLowerCase().includes(term)
    ).slice(0, 24)
  }

  function highlight(index) {
    const rows = [...list.children]
    if (!rows.length) { activeIndex = 0; return }
    activeIndex = (index + rows.length) % rows.length
    for (const [i, row] of rows.entries()) {
      row.setAttribute('aria-selected', String(i === activeIndex))
      if (i === activeIndex) row.scrollIntoView?.({ block: 'nearest' })
    }
  }

  function execute(item) {
    if (!item) return
    close(false)
    playMechanicalClick(win, prefs)
    item.run?.()
  }

  function render() {
    renderedItems = allItems()
    list.replaceChildren()
    for (const [i, item] of renderedItems.entries()) {
      const row = node(doc, 'button', 'aw-pal-item')
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(i === 0))
      const grp = node(doc, 'span', 'aw-pal-group', item.group)
      const label = node(doc, 'span', 'aw-pal-label', item.title)
      row.append(grp, label)
      if (item.tag) {
        const tag = node(doc, 'span', 'aw-pal-tag', item.tag)
        if (item.tagKind) tag.dataset.kind = item.tagKind
        row.append(tag)
      }
      row.addEventListener('pointerenter', () => highlight(i))
      row.addEventListener('click', () => execute(item))
      list.append(row)
    }
    activeIndex = 0
    empty.hidden = renderedItems.length > 0
  }

  input.addEventListener('input', render)

  dialog.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      highlight(activeIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      highlight(activeIndex - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute(renderedItems[activeIndex])
    }
  })

  backdrop.addEventListener('pointerdown', event => {
    if (event.target === backdrop) close(true)
  })

  function onGlobalKey(event) {
    if (event.isComposing || event.keyCode === 229) return
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      event.stopPropagation()
      if (backdrop.hidden) open()
      else close(true)
    }
  }

  function open(anchor) {
    if (!backdrop.hidden) return
    returnFocus = anchor || doc.activeElement
    input.value = ''
    render()
    backdrop.hidden = false
    playMechanicalClick(win, prefs)
    input.focus({ preventScroll: true })
  }

  function close(restore = true) {
    if (backdrop.hidden) return
    backdrop.hidden = true
    if (restore && returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true })
    }
    returnFocus = null
  }

  doc.addEventListener('keydown', onGlobalKey, true)

  const api = {
    open, close,
    configure(next) { providers = { ...providers, ...next } },
    isOpen: () => !backdrop.hidden,
    destroy() {
      doc.removeEventListener('keydown', onGlobalKey, true)
      backdrop.remove()
      instances.delete(win)
    },
  }
  instances.set(win, api)
  return api
}

export function showPalette(win, anchor) {
  mountPalette(win).open(anchor)
}
