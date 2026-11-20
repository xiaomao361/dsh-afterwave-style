import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { applyChatTools, mountChatToolsPreview } from '../src/chat-tools.js'
import { exportMarkdown, mountExport } from '../src/exporter.js'
import { attachCopyReadings, fuelLevel } from '../src/readings.js'

test('fuel thresholds accept native labels and follow the current dock through rerenders', async () => {
  assert.deepEqual(['74%', '75%', '87.9％', '88%', '92%', '未知'].map(fuelLevel), [null, 'warn', 'warn', 'critical', 'critical', null])
  const { window } = new JSDOM('<div data-composer-dock><div style="anchor-name: --dsh-context-1"><button aria-haspopup="dialog">74%</button></div><span></span></div>')
  const dock = window.document.body.firstElementChild
  const meter = dock.querySelector('button')
  const cleanup = attachCopyReadings(dock.lastElementChild)
  meter.textContent = '75%'
  await Promise.resolve()
  assert.equal(dock.dataset.fuel, 'warn')
  assert.equal(dock.querySelector('.aw-fuel-lamp').title, '上下文占用偏高，注意适时整理')
  meter.setAttribute('aria-label', '上下文已用 88%')
  await Promise.resolve()
  assert.equal(dock.dataset.fuel, 'critical')
  assert.equal(dock.querySelector('.aw-fuel-lamp').title, '上下文即将满载，建议压缩或开启新会话')
  meter.parentElement.remove()
  await Promise.resolve()
  assert.equal(dock.dataset.fuel, undefined)
  assert.equal(dock.querySelector('.aw-fuel-lamp').hidden, true)
  cleanup()
  window.close()
})

test('Markdown export reads native loaded source, including the current streaming reply and attachment marks', () => {
  const answer = '### 表格\n\n| a | b |\n|---|---|\n|x|y|\n\n```js\nconst tabs = "\\t"\n\n\n```'
  const source = {
    nodes: [
      { kind: 'user', content: [{ type: 'text', text: '请检查' }, { type: 'file', attachment: { name: 'a.js' } }] },
      { kind: 'context', content: [{ type: 'text', text: '隐式上下文' }] },
      { kind: 'assistant', turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: '内部过程' }, { kind: 'text', text: answer }] },
      { kind: 'steering', content: [{ type: 'text', text: '补充' }] },
    ],
    partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: '还在生成' }] },
  }
  assert.equal(exportMarkdown(null, source), '## 用户\n\n请检查\n\n[文件：a.js]\n\n## 助手\n\n' + answer + '\n\n## 用户\n\n补充\n\n## 助手\n\n还在生成')
  source.partial = { ...source.partial, turn: 1 }
  assert.doesNotMatch(exportMarkdown(null, source), /还在生成/)
  assert.equal(exportMarkdown(null, { nodes: [] }), '')
})

test('DOM export keeps lists, tables, inline code and fenced code without host actions', () => {
  const { window } = new JSDOM('<main data-conversation-content><article><p class="user-message">检查</p><h3>结果</h3><ol start="2"><li>有 <code>x</code></li><li>第二项</li></ol><table><tr><th>项目</th><th>值</th></tr><tr><td>正文</td><td>a|b</td></tr></table><pre><button>复制</button><code class="language-js">x = "```";\n\n\nnext()\n</code></pre><div class="aw-junk">噪声</div><div aria-hidden="true">装饰</div></article></main>')
  const markdown = exportMarkdown(window.document.querySelector('main'))
  assert.match(markdown, /## 用户\n\n检查\n\n## 助手\n\n### 结果/)
  assert.match(markdown, /2\. 有 `x`\n3\. 第二项/)
  assert.match(markdown, /\| 项目 \| 值 \|\n\| --- \| --- \|\n\| 正文 \| a\\\|b \|/)
  assert.ok(markdown.includes('````js\nx = "```";\n\n\nnext()\n````'))
  assert.doesNotMatch(markdown, /复制|噪声|装饰/)
  window.close()
})

test('export menu handles keyboard dismissal, unavailable clipboard, download and empty content', async () => {
  const { window } = new JSDOM('<span id="seat"></span>')
  const doc = window.document
  const seat = doc.querySelector('#seat')
  let markdown = ''
  const dispose = mountExport(seat, () => markdown)
  const trigger = seat.querySelector('.aw-export-trigger')
  const status = seat.querySelector('[role=status]')
  trigger.click()
  assert.equal(doc.activeElement.dataset.action, 'copy')
  doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(doc.activeElement, trigger)
  trigger.click()
  doc.activeElement.click()
  assert.equal(status.textContent, '当前没有可导出的对话内容')
  markdown = '## 用户\n\n你好'
  trigger.click()
  doc.activeElement.click()
  await Promise.resolve()
  assert.equal(status.textContent, '剪贴板不可用，可改用下载 .md')
  let exported
  window.navigator.clipboard = { writeText(value) { exported = value } }
  trigger.click()
  doc.activeElement.click()
  await Promise.resolve()
  assert.equal(exported, markdown)
  let blob, downloaded
  window.URL.createObjectURL = value => { blob = value; return 'blob:test' }
  window.URL.revokeObjectURL = () => {}
  window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download }
  trigger.click()
  seat.querySelector('[data-action=download]').click()
  assert.match(downloaded, /\.md$/)
  assert.equal(blob.type, 'text/markdown;charset=utf-8')
  dispose()
  assert.ok(!seat.children.length)
  window.close()
})

test('rail stays outside the chat column, has accurate user-message targets and collapses in narrow views', () => {
  const { window } = new JSDOM('<span id="seat"></span><main data-conversation-scroll><article><p class="user-message">A</p><p class="user-message">B</p></article></main>')
  const doc = window.document
  window.matchMedia = () => ({ matches: true })
  const scroll = doc.querySelector('main')
  const article = doc.querySelector('article')
  let height = 560, edge = 700, last
  Object.defineProperties(scroll, { clientHeight: { get: () => 400 }, scrollHeight: { get: () => height } })
  scroll.getBoundingClientRect = () => ({ top: 100, right: 840, height: 400 })
  article.getBoundingClientRect = () => ({ right: edge })
  scroll.scrollTo = args => { last = args; scroll.scrollTop = args.top }
  Array.from(article.children).forEach((el, i) => { el.getBoundingClientRect = () => ({ top: 100 + [50, 640][i] - scroll.scrollTop }) })
  const chat = mountChatToolsPreview(doc.querySelector('#seat'), scroll)
  const nav = doc.querySelector('nav')
  const compact = doc.querySelector('.aw-chat-nav-compact')
  assert.equal(nav.hidden, true) // Exactly 1.4 times viewport height.
  height = 1200
  chat.update()
  assert.equal(nav.hidden, false)
  assert.equal(compact.hidden, true)
  assert.equal(nav.querySelector('[data-go="previous"]').disabled, true)
  nav.querySelector('[data-go="next"]').click()
  assert.deepEqual(last, { top: 38, behavior: 'auto' })
  chat.update()
  nav.querySelector('[data-go="next"]').click()
  assert.equal(last.top, 628)
  chat.update()
  nav.querySelector('[data-go="previous"]').click()
  assert.equal(last.top, 38)
  edge = 835
  chat.update()
  assert.equal(nav.hidden, true)
  assert.equal(compact.hidden, false)
  const select = compact.querySelector('select')
  select.value = 'bottom'
  select.dispatchEvent(new window.Event('change'))
  assert.equal(last.top, 800)
  chat.update(false)
  assert.ok(compact.hidden && nav.hidden)
  assert.equal(doc.querySelector('.aw-chat-tools').hidden, true)
  chat.destroy()
  assert.equal(doc.querySelector('nav, .aw-chat-tools'), null)
  window.close()
})

test('DSH header slot exports only its session, follows a replaced content pane and cleans portals on disable', async () => {
  const { window } = new JSDOM('<main data-slot="main.conversation"><div data-slot="conversation.header"><div id="seat"></div></div><div data-conversation-content data-conversation-session="another"></div></main>')
  const original = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const doc = window.document
  const main = doc.querySelector('main')
  const root = createRoot(doc.querySelector('#seat'))
  let Utility, stop, copied
  window.navigator.clipboard = { writeText(value) { copied = value } }
  const ctx = {
    slots: {
      inject(name, install) { assert.equal(name, 'conversation.session.header.utilities'); install() },
      register(_, component) { Utility = component },
    },
    effect(start) { stop = start() },
  }
  try {
    applyChatTools(ctx, React, window)
    const native = { legacy: { nodes: [{ kind: 'user', content: [{ type: 'text', text: '当前会话原文' }] }] } }
    await act(() => root.render(React.createElement(Utility, { sessionId: 'mine', useChat: select => select(native) })))
    assert.equal(doc.querySelector('.aw-export'), null)
    const section = doc.createElement('section')
    section.dataset.conversationContent = ''
    section.dataset.conversationSession = 'mine'
    section.dataset.contentPhase = 'active'
    section.innerHTML = '<div data-conversation-scroll><div data-chat-flow><div data-chat-flow-kind="user">兜底正文</div></div></div>'
    main.append(section)
    await Promise.resolve()
    assert.equal(doc.querySelectorAll('.aw-export').length, 1)
    doc.querySelector('.aw-export-trigger').click()
    doc.querySelector('[data-action=copy]').click()
    await Promise.resolve()
    assert.equal(copied, '## 用户\n\n当前会话原文')
    section.dataset.contentPhase = 'hero'
    await Promise.resolve()
    assert.equal(doc.querySelector('.aw-chat-tools').hidden, true)
    section.remove()
    await Promise.resolve()
    assert.equal(doc.querySelector('.aw-export, nav'), null)
    main.append(section)
    await Promise.resolve()
    assert.equal(doc.querySelectorAll('.aw-export').length, 1)
    stop()
    assert.equal(doc.querySelector('.aw-export, nav'), null)
  } finally {
    await act(() => root.unmount())
    for (const [key, originalValue] of original) {
      if (originalValue) Object.defineProperty(globalThis, key, originalValue)
      else delete globalThis[key]
    }
    window.close()
  }
})
