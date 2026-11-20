import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountTypewriterPreview } from '../src/typewriter.js'
import { getPrefs } from '../src/prefs.js'

function fixture(t, init) {
  const dom = new JSDOM('<div data-composer-card><textarea data-composer-input></textarea><span class="seat"></span></div>', {
    url: 'https://input.local', pretendToBeVisual: true,
  })
  const win = dom.window, doc = win.document
  const q = selector => doc.querySelector(selector)
  const prefs = getPrefs(win)
  init?.(win, prefs)
  const editor = q('[data-composer-input]')
  const tools = mountTypewriterPreview(q('.seat'), editor, 'first')
  t.after(() => { tools.destroy(); win.close() })
  function write(text) {
    editor.value = text
    editor.dispatchEvent(new win.Event('input', { bubbles: true }))
  }
  function switchTo(id, value = '') {
    editor.value = value
    tools.setSession(id)
  }
  return { prefs, q, editor, write, tools, win, doc, switchTo,
    tabs: () => [...doc.querySelectorAll('[role="tab"]')], open: () => q('.aw-tw-launch').click() }
}

test('wrapping the selected plain text handles fenced content, multiline quotes, emoji and empty scaffold', t => {
  const { q, editor, write, open } = fixture(t)
  const tick = String.fromCharCode(96)
  const original = '前🌊\n含' + tick.repeat(3) + '后'
  for (const [label, expected] of [
    ['包裹为代码块', tick.repeat(4) + '\n🌊\n含' + tick.repeat(3) + '\n' + tick.repeat(4)],
    ['包裹为引用块', '> 🌊\n> 含' + tick.repeat(3)],
    ['包裹为行内代码', tick.repeat(4) + ' 🌊\n含' + tick.repeat(3) + ' ' + tick.repeat(4)],
    ['包裹为上下文标签', '<context>\n🌊\n含' + tick.repeat(3) + '\n</context>'],
  ]) {
    write(original)
    editor.setSelectionRange(1, original.length - 1)
    open()
    q('[aria-label="' + label + '"]').click()
    assert.equal(editor.value, '前' + expected + '后')
  }
  write('before after')
  editor.setSelectionRange(6, 6)
  open()
  q('[aria-label="包裹为代码块"]').click()
  assert.equal(editor.value, 'before' + tick.repeat(3) + '\n\n' + tick.repeat(3) + ' after')
})

test('legacy preferences, built-in tabs and valid-only JSON merges survive synchronous and cross-window reads', async t => {
  const { q, tabs, open, win, prefs } = fixture(t, win => {
    win.localStorage.setItem('dsh-afterwave-style.typing.sound', 'on')
    win.localStorage.setItem('dsh-afterwave-style.typing.phrases', JSON.stringify(['原有短语']))
  })
  open()
  assert.equal(q('.aw-tw-audio').getAttribute('aria-pressed'), 'true')
  assert.deepEqual([...win.document.querySelectorAll('.aw-tw-pick')].map(b => b.textContent),
    ['代码审查', '定位修 Bug', '补单元测试', '解释这段代码'])
  tabs()[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  assert.equal(tabs()[2].getAttribute('aria-selected'), 'true')
  assert.equal(q('.aw-tw-pick').textContent, '原有短语')
  q('.aw-tw-import').click()
  for (const bad of ['[0,"新短语"]', '[" "]', '{}', '{']) {
    q('.aw-tw-json').value = bad
    q('.aw-tw-confirm').click()
    assert.match(q('.aw-tw-note').textContent, /JSON/)
    assert.deepEqual(prefs.get('typing.phrases'), ['原有短语'])
  }
  q('.aw-tw-json').value = '["新短语","原有短语","新短语"]'
  q('.aw-tw-confirm').click()
  assert.deepEqual(prefs.get('typing.phrases'), ['原有短语', '新短语'])
  let copied
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async text => { copied = text } } })
  q('.aw-tw-export').click()
  await Promise.resolve()
  assert.deepEqual(JSON.parse(copied), prefs.get('typing.phrases'))
  win.navigator.clipboard.writeText = async () => { throw new Error('denied') }
  q('.aw-tw-export').click()
  await Promise.resolve()
  assert.match(q('.aw-tw-note').textContent, /剪贴板不可用/)
  assert.deepEqual(JSON.parse(q('.aw-tw-copy').value), prefs.get('typing.phrases'))
  const key = 'dsh-afterwave-style.typing.phrases'
  win.localStorage.setItem(key, '["来自另一窗口"]')
  win.dispatchEvent(new win.StorageEvent('storage', { key, storageArea: win.localStorage }))
  assert.equal(q('.aw-tw-pick').textContent, '来自另一窗口')
})

test('drafts debounce by session, preserve earlier sessions on switches, and clear only after accepted send / removal', async t => {
  const { prefs, q, write, tools, editor, switchTo } = fixture(t)
  write('水面🌊')
  assert.equal(prefs.get('typing.draft.first'), undefined)
  await new Promise(resolve => setTimeout(resolve, 535))
  assert.equal(prefs.get('typing.draft.first').text, '水面🌊')
  write('最新🌊')
  switchTo('second')
  assert.equal(prefs.get('typing.draft.first').text, '最新🌊')
  assert.equal(q('.aw-tw-recover').hidden, true)
  write('第二份')
  switchTo('first')
  assert.equal(q('.aw-tw-recover').textContent, '恢复草稿（3 字）')
  q('.aw-tw-recover').click()
  assert.equal(editor.value, '最新🌊')
  tools.sent()
  write('')
  assert.equal(prefs.get('typing.draft.first'), undefined)
  assert.equal(q('.aw-tw-recover').hidden, true)
  switchTo('second', '宿主已恢复的草稿')
  assert.equal(q('.aw-tw-recover').hidden, true)
  assert.equal(editor.value, '宿主已恢复的草稿')
  write('')
  assert.equal(prefs.get('typing.draft.second'), undefined)
  write('清空前的输入尚在防抖')
  write('')
  switchTo('third')
  assert.equal(prefs.get('typing.draft.second'), undefined)
})

test('uncommitted composition is excluded and a stale pending write cannot replace a newer cross-window backup', async t => {
  const { editor, win, q, prefs, write, open } = fixture(t)
  editor.dispatchEvent(new win.CompositionEvent('compositionstart'))
  write('ni')
  open()
  assert.equal(q('.aw-tw-panel').hidden, true)
  await new Promise(resolve => setTimeout(resolve, 510))
  assert.equal(prefs.get('typing.draft.first'), undefined)
  write('你')
  editor.dispatchEvent(new win.CompositionEvent('compositionend', { data: '你' }))
  win.dispatchEvent(new win.Event('pagehide'))
  assert.equal(prefs.get('typing.draft.first').text, '你')
  write('本地输入')
  const key = 'dsh-afterwave-style.typing.draft.first'
  win.localStorage.setItem(key, JSON.stringify({ at: Date.now() + 10, text: '另一窗口的新草稿' }))
  win.dispatchEvent(new win.StorageEvent('storage', { key, storageArea: win.localStorage }))
  win.dispatchEvent(new win.Event('pagehide'))
  assert.equal(prefs.get('typing.draft.first').text, '另一窗口的新草稿')
  assert.equal(editor.value, '本地输入')
  assert.match(q('.aw-tw-backup-note').textContent, /另一窗口/)
})

test('automatic eviction retains the 20 most recently saved sessions and counts the 20 KiB limit in UTF-8', t => {
  const { prefs, write, switchTo, q, win } = fixture(t)
  for (let i = 0; i <= 20; i++) { switchTo('session-' + i); write('草稿 ' + i) }
  switchTo('limit')
  assert.equal(prefs.keys('typing.draft.').length, 20)
  assert.equal(prefs.get('typing.draft.session-0'), undefined)
  assert.equal(prefs.get('typing.draft.session-20').text, '草稿 20')
  const exactly = '界'.repeat(6826) + 'ab'
  write(exactly)
  win.dispatchEvent(new win.Event('pagehide'))
  assert.equal(prefs.get('typing.draft.limit').text, exactly)
  write(exactly + 'c')
  win.dispatchEvent(new win.Event('pagehide'))
  assert.match(q('.aw-tw-backup-note').textContent, /超过 20 KB/)
  assert.equal(prefs.get('typing.draft.limit').text, exactly)
  assert.equal(prefs.keys('typing.draft.').length, 20)
})

test('quota rejection preserves recoverable text in this window and surfaces the storage limitation', t => {
  const { win, prefs, write, q, editor, switchTo } = fixture(t, win => {
    win.Storage.prototype.setItem = () => { throw new win.DOMException('quota', 'QuotaExceededError') }
  })
  write('本窗口草稿')
  win.dispatchEvent(new win.Event('pagehide'))
  assert.match(q('.aw-tw-backup-note').textContent, /仅暂存在当前窗口/)
  assert.equal(prefs.get('typing.draft.first').text, '本窗口草稿')
  switchTo('next')
  switchTo('first')
  q('.aw-tw-recover').click()
  assert.equal(editor.value, '本窗口草稿')
})
