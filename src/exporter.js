const emptyMessage = '当前没有可导出的对话内容'
const blockTags = new Set(['ARTICLE', 'DIV', 'SECTION', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'HR'])

function fence(text, minimum) {
  const runs = text.match(/`+/g) || []
  return '`'.repeat(runs.reduce((n, run) => Math.max(n, run.length + 1), minimum))
}

function childMarkdown(node) {
  let out = ''
  for (const child of node.childNodes) {
    const value = toMarkdown(child)
    if (!value) continue
    out += child.nodeType === 1 && blockTags.has(child.tagName) ? '\n\n' + value + '\n\n' : value
  }
  return out
}

function toMarkdown(node) {
  if (node.nodeType === 3) return node.data.replace(/[\t\r\n ]+/g, ' ')
  if (node.nodeType !== 1) return ''
  const tag = node.tagName
  if (tag === 'PRE') {
    const code = node.querySelector('code') || node
    const value = code.textContent.replace(/\n$/, '')
    const ticks = fence(value, 3)
    const lang = (code.className + ' ' + node.className).match(/\blanguage-([\w.+#-]+)/)?.[1] || ''
    return ticks + lang + '\n' + value + '\n' + ticks
  }
  if (tag === 'CODE') {
    const value = node.textContent
    const ticks = fence(value, 1)
    const padding = /^[` ]|[` ]$/.test(value) ? ' ' : ''
    return ticks + padding + value + padding + ticks
  }
  if (tag === 'TABLE') {
    const rows = Array.from(node.rows, row => Array.from(row.cells, cell =>
      childMarkdown(cell).trim().replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, '<br>')))
    if (!rows.length) return ''
    const columns = Math.max(...rows.map(row => row.length))
    if (!columns) return ''
    if (!node.rows[0].querySelector('th')) rows.unshift([])
    rows.splice(1, 0, Array(columns).fill('---'))
    return rows.map(row => '| ' + Array.from({ length: columns }, (_, i) => row[i] || '').join(' | ') + ' |').join('\n')
  }
  if (tag === 'UL' || tag === 'OL') {
    return Array.from(node.children).filter(e => e.tagName === 'LI').map((li, i) => {
      const marker = tag === 'OL' ? (node.start + i) + '. ' : '- '
      return marker + childMarkdown(li).trim().replace(/\n/g, '\n' + ' '.repeat(marker.length))
    }).join('\n')
  }
  if (tag === 'BR') return '  \n'
  if (tag === 'HR') return '---'
  if (tag === 'IMG') return '[' + (node.getAttribute('alt') || '图片') + ']'
  const inner = childMarkdown(node)
  if (/^H[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + inner.trim()
  if (tag === 'BLOCKQUOTE') return inner.trim().split('\n').map(line => '> ' + line).join('\n')
  if (tag === 'STRONG' || tag === 'B') return '**' + inner + '**'
  if (tag === 'EM' || tag === 'I') return '*' + inner + '*'
  if (tag === 'DEL' || tag === 'S') return '~~' + inner + '~~'
  if (tag === 'A' && node.hasAttribute('href')) return '[' + inner + '](<' + node.getAttribute('href').replace(/[<>\r\n]/g, encodeURIComponent) + '>)'
  return inner
}

function renderedMarkdown(element) {
  const clone = element.cloneNode(true)
  const excluded = 'button, svg, script, style, [hidden], [aria-hidden="true"], [role="toolbar"], [role="button"]'
  if (clone.matches(excluded) || Array.from(clone.classList).some(cls => cls.startsWith('aw-'))) return ''
  for (const child of clone.querySelectorAll(excluded + ', [class]')) {
    if (child.matches(excluded) || Array.from(child.classList).some(cls => cls.startsWith('aw-'))) child.remove()
  }
  return toMarkdown(clone).trim()
}

function renderedRows(content) {
  const rows = []
  const nodes = content.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant"]')
  for (const node of nodes) {
    if (node.closest('[hidden], [aria-hidden="true"]') || node.dataset.chatGroupPart === 'process') continue
    if (node.closest('[data-conversation-content]') !== content.closest('[data-conversation-content]')) continue
    rows.push({ role: node.dataset.chatFlowKind === 'assistant' ? '助手' : '用户', text: renderedMarkdown(node) })
  }
  if (nodes.length) return rows
  const article = content.matches('article') ? content : content.querySelector('article')
  if (!article) return rows
  for (const element of article.children) {
    const text = renderedMarkdown(element)
    if (!text) continue
    if (element.matches('.user-message')) rows.push({ role: '用户', text })
    else if (rows.at(-1)?.role === '助手') rows.at(-1).text += '\n\n' + text
    else rows.push({ role: '助手', text })
  }
  return rows
}

function messageText(blocks) {
  return (blocks || []).map(block => {
    const type = block.kind || block.type
    if (type === 'text' && typeof block.text === 'string') return block.text
    if (type === 'image') return '[图片]'
    if (type === 'file') return '[文件' + (block.attachment?.name ? '：' + block.attachment.name : '') + ']'
    return ''
  }).filter(Boolean).join('\n\n')
}

export function exportMarkdown(content, legacy) {
  let rows = []
  if (Array.isArray(legacy?.nodes)) {
    for (const node of legacy.nodes) {
      if (node.kind === 'user' || node.kind === 'steering') rows.push({ role: '用户', text: messageText(node.content) })
      else if (node.kind === 'assistant') rows.push({ role: '助手', text: messageText(node.blocks) })
    }
    const partial = legacy.partial
    if (partial && !legacy.nodes.some(n => n.kind === 'assistant' && n.turn === partial.turn && n.step === partial.step)) {
      rows.push({ role: '助手', text: messageText(partial.blocks) })
    }
  } else if (content) rows = renderedRows(content)
  return rows.filter(row => row.text.trim()).map(row => '## ' + row.role + '\n\n' + row.text).join('\n\n')
}

export function mountExport(seat, collect) {
  const doc = seat.ownerDocument
  const win = doc.defaultView
  const root = doc.createElement('span')
  root.className = 'aw-export'
  root.innerHTML = '<button type="button" class="aw-export-trigger" title="导出已加载对话" aria-label="导出已加载对话" aria-expanded="false"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4M3 12v4.5h14V12"/></svg></button><span class="aw-export-menu" hidden><small>本会话已加载的消息正文</small><button type="button" data-action="copy">复制 Markdown</button><button type="button" data-action="download">下载 .md</button></span><span class="aw-export-feedback" role="status"></span>'
  seat.append(root)
  const trigger = root.firstElementChild
  const menu = trigger.nextElementSibling
  const status = menu.nextElementSibling
  let alive = true
  let reset
  const floating = typeof menu.showPopover === 'function'
  if (floating) {
    // The host title row establishes a stacking context under the tabs.
    // Use the native top layer while keeping focus and event ownership here.
    menu.popover = status.popover = 'manual'
  }
  function position(box) {
    const rect = trigger.getBoundingClientRect()
    box.style.left = Math.max(5, Math.min(rect.right - box.offsetWidth, win.innerWidth - box.offsetWidth - 5)) + 'px'
    const below = rect.bottom + 5
    box.style.top = (below + box.offsetHeight <= win.innerHeight ? below : Math.max(5, rect.top - box.offsetHeight - 5)) + 'px'
  }
  function placeVisible() {
    if (!floating) return
    if (!menu.hidden) position(menu)
    if (status.textContent) position(status)
  }
  function clearReport() {
    if (floating && status.matches(':popover-open')) status.hidePopover()
    status.textContent = ''
  }
  function toggle(open, refocus) {
    if (open) clearReport()
    if (floating && !open && !menu.hidden) menu.hidePopover()
    menu.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    if (open) {
      if (floating) { menu.showPopover(); position(menu) }
      menu.querySelector('button').focus()
    }
    else if (refocus) trigger.focus()
  }
  function report(message) {
    if (!alive) return
    status.textContent = message
    win.clearTimeout(reset)
    if (floating) { status.showPopover(); position(status) }
    reset = win.setTimeout(clearReport, 3200)
  }
  async function run(e) {
    const action = e.target.closest('button')?.dataset.action
    if (!action) return
    toggle(false, true)
    const markdown = collect()
    if (!markdown) return report(emptyMessage)
    if (action === 'copy') {
      try {
        await win.navigator.clipboard.writeText(markdown)
        report('Markdown 已复制')
      } catch { report('剪贴板不可用，可改用下载 .md') }
      return
    }
    try {
      const href = win.URL.createObjectURL(new win.Blob([markdown + '\n'], { type: 'text/markdown;charset=utf-8' }))
      try {
        const link = doc.createElement('a')
        link.href = href
        link.download = '对话-' + new Date().toISOString().replace(/[:.]/g, '-') + '.md'
        link.click()
      } finally { win.setTimeout(() => win.URL.revokeObjectURL(href), 1000) }
      report('已生成 Markdown 文件')
    } catch { report('下载不可用，可改用复制 Markdown') }
  }
  function outside(e) { if (!menu.hidden && !root.contains(e.target)) toggle(false, false) }
  function escape(e) {
    if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); toggle(false, true) }
  }
  trigger.addEventListener('click', () => toggle(menu.hidden, false))
  menu.addEventListener('click', run)
  root.addEventListener('keydown', escape)
  doc.addEventListener('pointerdown', outside)
  doc.addEventListener('focusin', outside)
  win.addEventListener('resize', placeVisible)
  return () => {
    alive = false
    win.clearTimeout(reset)
    win.removeEventListener('resize', placeVisible)
    doc.removeEventListener('pointerdown', outside)
    doc.removeEventListener('focusin', outside)
    root.remove()
  }
}
