const userRow = '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], .user-message'
const actions = [
  ['top', '回到顶部', '↑'], ['previous', '上一条用户消息', '‹'],
  ['next', '下一条用户消息', '›'], ['bottom', '回到底部', '↓'],
]

function chatColumn(outer) {
  const scope = outer.closest('[data-conversation-content]')
  for (const column of outer.querySelectorAll('[data-chat-flow], article')) {
    if (column.closest('[data-conversation-content]') === scope) return column
  }
  return null
}

function scrollingElement(content, preferred, flow) {
  const outer = preferred || content.querySelector('[data-conversation-scroll]') || content
  // Some hosts give the viewport to the parent of the chat column.
  for (let el = flow?.parentElement; el && outer.contains(el) && el !== outer; el = el.parentElement) {
    if (el.clientHeight && /^(auto|scroll|overlay)$/.test(el.ownerDocument.defaultView.getComputedStyle(el).overflowY)) return el
  }
  return outer
}

export function mountNavigator(seat, content, preferred) {
  const doc = seat.ownerDocument
  const win = doc.defaultView
  const rail = doc.createElement('nav')
  rail.className = 'aw-chat-nav'
  rail.setAttribute('aria-label', '长对话快速导航')
  const compact = doc.createElement('label')
  compact.className = 'aw-chat-nav-compact'
  compact.title = '长对话快速导航'
  const symbol = doc.createElement('span')
  symbol.textContent = '↕'
  symbol.setAttribute('aria-hidden', 'true')
  const select = doc.createElement('select')
  select.setAttribute('aria-label', compact.title)
  const placeholder = doc.createElement('option')
  placeholder.textContent = '快速导航'
  placeholder.value = ''
  placeholder.disabled = true
  select.append(placeholder)
  compact.append(symbol, select)
  for (const [id, label, icon] of actions) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.dataset.go = id
    button.setAttribute('aria-label', label)
    button.title = label
    button.textContent = icon
    rail.append(button)
    const option = doc.createElement('option')
    option.value = id
    option.textContent = label
    select.append(option)
  }
  select.value = ''
  // The native header is an inline-size container. Portal viewport coordinates
  // outside it so the rail lines up with the scroll body after pane resizes.
  doc.body.append(rail)
  seat.append(compact)

  let active = true
  let scroller, column
  let anchors = []
  let measure = true
  let frame
  const request = win.requestAnimationFrame?.bind(win) || (fn => win.setTimeout(fn, 16))
  const cancel = win.cancelAnimationFrame?.bind(win) || win.clearTimeout.bind(win)
  function schedule() {
    if (active && frame == null) frame = request(() => { frame = null; paint() })
  }
  const resize = win.ResizeObserver && new win.ResizeObserver(schedule)
  function updateElements() {
    const nextColumn = column && content.contains(column) ? column : chatColumn(preferred || content)
    const next = scrollingElement(content, preferred, nextColumn)
    if (next !== scroller || column !== nextColumn) {
      resize?.disconnect()
      scroller?.removeEventListener('scroll', schedule)
      scroller = next
      column = nextColumn
      scroller.addEventListener('scroll', schedule, { passive: true })
      resize?.observe(scroller)
      if (column) resize?.observe(column)
      measure = true
    }
    if (measure) {
      anchors = Array.from((column || scroller).querySelectorAll(userRow)).filter(el =>
        !el.closest('[hidden], [aria-hidden="true"], [data-turn-process-hidden="true"]') &&
        el.closest('[data-conversation-content]') === content.closest('[data-conversation-content]') &&
        !el.parentElement?.closest(userRow))
      measure = false
    }
  }
  function neighbors() {
    const y = scroller.getBoundingClientRect().top + 12
    // Anchor order follows document order. Skip the current anchor with a small tolerance.
    function firstAfter(limit) {
      let low = 0, high = anchors.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (anchors[mid].getBoundingClientRect().top <= limit) low = mid + 1
        else high = mid
      }
      return low
    }
    return { previous: anchors[firstAfter(y - 3) - 1], next: anchors[firstAfter(y + 3)] }
  }
  function paint() {
    if (active) updateElements()
    const tall = active && column && scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight * 1.4
    if (!tall) { rail.hidden = compact.hidden = true; return }
    const rect = scroller.getBoundingClientRect()
    const edge = column?.getBoundingClientRect().right
    // Leave the outermost 50px for the native turn rail and scrollbar. A narrow
    // conversation gets a native picker in the header instead of an overlay.
    const left = rect.right - 86
    const spacious = edge != null && left >= edge + 8 && rect.height >= 200
    rail.hidden = !spacious
    compact.hidden = spacious
    if (spacious) {
      rail.style.left = Math.round(left) + 'px'
      rail.style.top = Math.round(rect.top + rect.height * 0.45) + 'px'
    }
    const nearby = neighbors()
    const top = scroller.scrollTop <= 1
    const bottom = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2
    const disabled = [top, top || !nearby.previous, bottom || !nearby.next, bottom]
    for (let i = 0; i < disabled.length; i++) {
      rail.children[i].disabled = disabled[i]
      select.options[i + 1].disabled = disabled[i]
    }
  }
  function go(action) {
    if (!active || !action) return
    updateElements()
    let top
    if (action === 'top') top = 0
    else if (action === 'bottom') top = scroller.scrollHeight - scroller.clientHeight
    else {
      const target = neighbors()[action]
      if (!target) return
      top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    }
    const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (scroller.scrollTo) scroller.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
    else scroller.scrollTop = top
    schedule()
  }
  rail.addEventListener('click', e => go(e.target.closest('button')?.dataset.go))
  select.addEventListener('change', () => { go(select.value); select.value = '' })
  const observer = new win.MutationObserver(records => {
    if (!active) return
    for (const record of records) {
      if (record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(userRow) || node.querySelector(userRow)))) {
        measure = true
        break
      }
    }
    schedule()
  })
  observer.observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-turn-process-hidden', 'data-chat-flow-kind'] })
  win.addEventListener('resize', schedule)
  paint()
  return {
    update(enabled = true) { active = enabled; measure = true; paint() },
    destroy() {
      active = false
      if (frame != null) cancel(frame)
      observer.disconnect()
      resize?.disconnect()
      scroller?.removeEventListener('scroll', schedule)
      win.removeEventListener('resize', schedule)
      rail.remove()
      compact.remove()
    },
  }
}
