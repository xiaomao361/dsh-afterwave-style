import { mountExport, exportMarkdown } from './exporter.js'
import { mountNavigator } from './navigator.js'
import { attachCodeTools } from './code-tools.js'

const slot = 'conversation.session.header.utilities'

function mountCodeDrawer(root, codeTools, win) {
  const doc = root.ownerDocument
  const trigger = doc.createElement('button')
  trigger.type = 'button'
  trigger.className = 'aw-export-trigger'
  trigger.textContent = '</>'
  trigger.title = '本会话代码清单'
  trigger.setAttribute('aria-label', '本会话代码清单')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.style.font = '700 11px/1 ui-monospace, monospace'
  root.append(trigger)

  const drawer = doc.createElement('section')
  drawer.className = 'aw-code-drawer'
  drawer.hidden = true
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-label', '本会话代码清单')

  const head = doc.createElement('div')
  head.className = 'aw-code-drawer-head'
  const title = doc.createElement('strong')
  title.textContent = '本会话代码清单'
  const closeBtn = doc.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = '×'
  closeBtn.setAttribute('aria-label', '关闭代码清单')
  closeBtn.style.cssText = 'border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px;'
  head.append(title, closeBtn)

  const list = doc.createElement('div')
  list.className = 'aw-code-drawer-list'
  drawer.append(head, list)
  doc.body.append(drawer)

  function render() {
    const blocks = codeTools.list()
    list.replaceChildren()
    if (!blocks.length) {
      const empty = doc.createElement('p')
      empty.textContent = '当前对话暂无代码块'
      empty.style.cssText = 'margin:8px 0;opacity:.7;text-align:center;'
      list.append(empty)
      return
    }
    for (const block of blocks) {
      const row = doc.createElement('div')
      row.className = 'aw-code-item'
      const go = doc.createElement('button')
      go.type = 'button'
      go.className = 'aw-code-item-go'
      const meta = doc.createElement('span')
      meta.className = 'aw-code-item-meta'
      meta.textContent = `${block.lang} · ${block.lineCount} 行`
      const prev = doc.createElement('span')
      prev.className = 'aw-code-item-preview'
      prev.textContent = block.preview
      go.append(meta, prev)
      go.addEventListener('click', () => {
        block.pre.removeAttribute('data-aw-folded')
        block.pre.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
        close()
      })
      const copy = doc.createElement('button')
      copy.type = 'button'
      copy.className = 'aw-code-item-copy'
      copy.textContent = '复制'
      copy.addEventListener('click', async () => {
        try {
          await win.navigator.clipboard.writeText(block.text)
          copy.textContent = '已复制'
          win.setTimeout(() => { copy.textContent = '复制' }, 1400)
        } catch {
          copy.textContent = '失败'
        }
      })
      row.append(go, copy)
      list.append(row)
    }
  }

  function outside(event) {
    if (!drawer.hidden && !drawer.contains(event.target) && !trigger.contains(event.target)) close()
  }
  function onKey(event) {
    if (event.key === 'Escape' && !drawer.hidden) { event.preventDefault(); close(); trigger.focus() }
  }
  function open() {
    render()
    drawer.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    doc.addEventListener('pointerdown', outside, true)
    doc.addEventListener('keydown', onKey, true)
  }
  function close() {
    if (drawer.hidden) return
    drawer.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('keydown', onKey, true)
  }
  trigger.addEventListener('click', () => { drawer.hidden ? open() : close() })
  closeBtn.addEventListener('click', close)

  return {
    open, close,
    destroy() { close(); drawer.remove(); trigger.remove() },
  }
}

function mountTools(seat, content, scroll, source) {
  const win = seat.ownerDocument.defaultView
  const root = seat.ownerDocument.createElement('span')
  root.className = 'aw-chat-tools'
  seat.append(root)
  const navigation = mountNavigator(root, content, scroll)
  const codeTools = attachCodeTools(scroll || content, win)
  const codeDrawer = mountCodeDrawer(root, codeTools, win)
  const closeExport = mountExport(root, () => exportMarkdown(content, source?.()))
  const onOpenCodeList = () => { if (!root.hidden) codeDrawer.open() }
  win.addEventListener('aw-open-code-list', onOpenCodeList)
  return {
    update(active = true) { root.hidden = !active; if (!active) codeDrawer.close(); navigation.update(active) },
    destroy() {
      win.removeEventListener('aw-open-code-list', onOpenCodeList)
      codeDrawer.destroy()
      codeTools.destroy()
      closeExport()
      navigation.destroy()
      root.remove()
    },
  }
}

export function mountChatToolsPreview(seat, content, scroll = content) {
  return mountTools(seat, content, scroll)
}

export function applyChatTools(ctx, React, win) {
  const live = new Set()
  let active = true
  const selectLegacy = chat => chat?.legacy
  const noChat = () => undefined
  function HeaderTools({ sessionId, useChat }) {
    const seat = React.useRef(null)
    const latest = React.useRef(null)
    const legacy = useChat(selectLegacy)
    React.useLayoutEffect(() => { latest.current = legacy }, [legacy])
    React.useLayoutEffect(() => {
      const header = seat.current.closest('[data-slot="conversation.header"]')
      const panel = header?.closest('[data-slot="main.conversation"]')
      if (!active || !panel || header.closest('[data-conversation-content]')) return
      let attached, content, visible
      function refresh() {
        const belongs = el => el?.dataset.conversationSession === sessionId && !el.parentElement.closest('[data-conversation-content]')
        if (!content?.isConnected || !belongs(content)) {
          attached?.destroy()
          attached = undefined
          visible = undefined
          content = Array.from(panel.querySelectorAll('[data-conversation-content]')).find(belongs)
          if (content) attached = mountTools(seat.current, content, undefined, () => latest.current)
        }
        const next = !!content && (!content.dataset.contentPhase || content.dataset.contentPhase === 'active')
        if (visible !== next) { attached?.update(next); visible = next }
      }
      const observer = new win.MutationObserver(refresh)
      observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session', 'data-content-phase'] })
      refresh()
      function dispose() {
        if (!live.delete(dispose)) return
        observer.disconnect()
        attached?.destroy()
      }
      live.add(dispose)
      return dispose
    }, [sessionId])
    return React.createElement('span', { ref: seat, style: { display: 'contents' } })
  }
  function Utility(props) {
    const hasChat = typeof props.useChat === 'function'
    if (!props.sessionId) return null
    return React.createElement(HeaderTools, {
      key: (hasChat ? 'chat:' : 'session:') + props.sessionId,
      sessionId: props.sessionId, useChat: hasChat ? props.useChat : noChat,
    })
  }
  ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id: 'whaleworks.chat-tools', order: 70 }, Utility))
  ctx.effect(() => () => {
    active = false
    for (const dispose of live) dispose()
  })
}
