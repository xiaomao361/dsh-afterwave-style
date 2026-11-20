import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { redactSecrets, cleanTerminalLog } from '../src/typewriter.js'
import { mountScratchpad } from '../src/scratchpad.js'
import { mountPalette } from '../src/palette.js'
import { attachCodeTools } from '../src/code-tools.js'
import { getDockTimer, formatClock } from '../src/timer.js'

test('redactSecrets masks keys, tokens, phones and emails while cleanTerminalLog strips ANSI and excess blanks', () => {
  const sample = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc\nkey=sk-1234567890abcdef1234\nphone 13800138000 mail a@b.com'
  const redacted = redactSecrets(sample)
  assert.ok(redacted.hits >= 4)
  assert.doesNotMatch(redacted.text, /sk-123456|13800138000|a@b\.com|eyJhbGci/)

  const noisy = '\x1b[31mERROR\x1b[0m   \r\n\r\n\r\nline 2  '
  const cleaned = cleanTerminalLog(noisy)
  assert.equal(cleaned.changed, true)
  assert.equal(cleaned.text, 'ERROR\n\nline 2')
})

test('scratchpad supports multiple stacked notes, cycling, color switching, clear with undo, and cleanup', () => {
  const { window } = new JSDOM('<textarea data-composer-input></textarea>', { url: 'https://dock.test' })
  try {
    const pad = mountScratchpad(window)
    pad.open()
    assert.equal(pad.isOpen(), true)
    assert.equal(pad.noteCount(), 1)
    const area = window.document.querySelector('.aw-sp-area')
    area.value = 'trace_id=abc123'
    area.dispatchEvent(new window.Event('input'))
    pad.addNote()
    assert.equal(pad.noteCount(), 2)
    assert.equal(window.document.querySelector('.aw-sp-sheet-1').hidden, false)
    area.value = '第二张工单便签'
    area.dispatchEvent(new window.Event('input'))
    pad.cycleNext()
    assert.equal(area.value, 'trace_id=abc123')
    window.document.querySelector('.aw-sp-danger').click()
    assert.equal(area.value, '')
    window.document.querySelectorAll('.aw-sp-btn')[2].click()
    assert.equal(area.value, 'trace_id=abc123')
    pad.destroy()
    assert.equal(window.document.querySelector('.aw-scratchpad-stack'), null)
  } finally { window.close() }
})

test('command palette opens with Cmd/Ctrl+K, filters sessions and commands, and executes selection', () => {
  const { window } = new JSDOM('<body><button id="host">focus</button></body>', { url: 'https://dock.test' })
  try {
    const ran = []
    const palette = mountPalette(window)
    palette.configure({
      commands: () => [{ id: 'pad', title: '打开随手便签', keywords: 'note', run: () => ran.push('pad') }],
      sessions: () => [
        { id: 's1', title: '普通会话', updatedAt: 200 },
        { id: 's2', title: '审批工单', waiting: true, updatedAt: 100 },
      ],
      openSession: id => ran.push('open:' + id),
    })
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    assert.equal(palette.isOpen(), true)
    const input = window.document.querySelector('.aw-pal-input')
    input.value = '审批'
    input.dispatchEvent(new window.Event('input'))
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert.deepEqual(ran, ['open:s2'])
    assert.equal(palette.isOpen(), false)
    palette.destroy()
  } finally { window.close() }
})

test('code tools fold long code blocks (>=25 lines) and list all blocks cleanly', () => {
  const longCode = Array.from({ length: 30 }, (_, i) => `const line${i} = ${i}`).join('\n')
  const { window } = new JSDOM(`<div id="scroll"><pre><code class="language-js">${longCode}</code></pre><pre><code>short</code></pre></div>`)
  try {
    const scroll = window.document.getElementById('scroll')
    const tools = attachCodeTools(scroll, window)
    assert.equal(tools.list().length, 2)
    const bar = scroll.querySelector('.aw-code-fold-bar')
    assert.ok(bar)
    bar.click()
    assert.equal(scroll.querySelector('pre').hasAttribute('data-aw-folded'), true)
    tools.destroy()
    assert.equal(scroll.querySelector('.aw-code-fold-bar'), null)
  } finally { window.close() }
})

test('dock timer formats clock and supports start, pause and reset', () => {
  const { window } = new JSDOM('', { url: 'https://dock.test' })
  try {
    assert.equal(formatClock(1500), '25:00')
    assert.equal(formatClock(65), '01:05')
    const timer = getDockTimer(window)
    timer.start(25, '值班专注')
    assert.equal(timer.snapshot().running, true)
    timer.togglePause()
    assert.equal(timer.snapshot().running, false)
    timer.reset()
    assert.equal(timer.snapshot().remaining, 1500)
    timer.destroy()
  } finally { window.close() }
})
