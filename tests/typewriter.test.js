import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { applyTypewriter, mountTypewriterPreview } from '../src/typewriter.js'

function fixture() {
  const dom = new JSDOM('<main data-composer-card><textarea data-composer-input></textarea><span class="seat"></span></main>', {
    url: 'https://preview.local/', pretendToBeVisual: true,
  })
  const win = dom.window
  const doc = win.document
  const editor = doc.querySelector('textarea')
  const anchor = doc.querySelector('.seat')
  return { dom, win, doc, editor, anchor, mount: () => mountTypewriterPreview(anchor, editor) }
}

test('the input tools insert at a captured selection, reject a stale draft and persist only explicit phrases', async () => {
  const { dom, win, doc, editor, mount } = fixture()
  const tools = mount()
  editor.value = '先看🌊再继续'
  editor.dispatchEvent(new win.Event('input'))
  await new Promise(resolve => setTimeout(resolve, 90))
  const launch = doc.querySelector('.aw-tw-launch')
  assert.match(launch.getAttribute('aria-label'), /6 字/)
  assert.equal(win.localStorage.length, 0)
  editor.setSelectionRange(2, 4)
  launch.click()
  doc.querySelectorAll('[role="tab"]')[2].click()
  const field = doc.querySelector('.aw-tw-field')
  field.value = '配置清单'
  field.dispatchEvent(new win.Event('input'))
  doc.querySelector('.aw-tw-save').click()
  const pick = [...doc.querySelectorAll('.aw-tw-pick')].find(b => b.textContent === '配置清单')
  pick.click()
  assert.equal(editor.value, '先看配置清单再继续')
  assert.equal(doc.activeElement, editor)
  assert.equal(launch.getAttribute('aria-expanded'), 'false')
  launch.click()
  editor.value += '。'
  editor.dispatchEvent(new win.Event('input'))
  doc.querySelector('.aw-tw-pick').click()
  assert.equal(editor.value, '先看配置清单再继续。')
  assert.match(doc.querySelector('.aw-tw-note').textContent, /草稿已变动/)
  tools.destroy()
  assert.equal(doc.querySelector('.aw-tw-panel'), null)
  const next = mount()
  doc.querySelector('.aw-tw-launch').click()
  doc.querySelectorAll('[role="tab"]')[2].click()
  assert.ok([...doc.querySelectorAll('.aw-tw-pick')].some(b => b.textContent === '配置清单'))
  doc.querySelector('.aw-tw-remove').click()
  assert.equal(doc.querySelectorAll('.aw-tw-pick').length, 0)
  doc.querySelectorAll('[role="tab"]')[1].click()
  assert.deepEqual([...doc.querySelectorAll('.aw-tw-pick')].map(b => b.textContent), ['整理要点', '检查改动', '写份交接', '生成 Commit Message'])
  next.destroy()
  dom.window.close()
})

test('one committed IME edit makes one stroke while preedit, paste, navigation and reduced-motion visual feedback stay quiet', () => {
  const { dom, win, doc, editor, mount } = fixture()
  let presses = 0, contexts = 0, closed = 0, now = 1
  win.matchMedia = () => ({ matches: true })
  win.AudioContext = class {
    sampleRate = 48000
    state = 'running'
    destination = {}
    get currentTime() { return now++ }
    constructor() { contexts++ }
    close() { closed++; this.state = 'closed' }
    createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) } }
    createBufferSource() { return { connect() {}, start() { presses++ } } }
  }
  const tools = mount()
  const input = (inputType, data, isComposing = false) => editor.dispatchEvent(new win.InputEvent('beforeinput', { inputType, data, isComposing }))
  input('insertText', 'a')
  assert.equal(contexts, 0)
  doc.querySelector('.aw-tw-launch').click()
  doc.querySelector('.aw-tw-audio').click()
  assert.equal(contexts, 1)
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(presses, 0)
  editor.dispatchEvent(new win.CompositionEvent('compositionstart'))
  input('insertCompositionText', 'sh', true)
  editor.dispatchEvent(new win.CompositionEvent('compositionend', { data: '试' }))
  input('insertText', '试')
  input('insertFromPaste', '粘贴')
  editor.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight' }))
  assert.equal(presses, 1)
  input('insertText', 'A')
  assert.equal(presses, 2)
  assert.equal(doc.querySelector('[data-hit]'), null)
  tools.destroy()
  assert.equal(closed, 1)
  input('insertText', 'Z')
  assert.equal(presses, 2)
  dom.window.close()
})

test('the DSH toolbar invokes the public revision-guarded insert action, follows locking and unmounts cleanly', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://native.local/', pretendToBeVisual: true })
  const win = dom.window
  const existing = ['window', 'document','IS_REACT_ACT_ENVIRONMENT'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  Object.assign(globalThis, { window: win, document: win.document, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(win.document.querySelector('#root'))
  let Component
  const cleanups = []
  const state = { phase: 'plain', draft: '包含 @引用' }
  const span = { start: 1, end: 2, draftRev: 4 }
  const inserts = []
  const inputActions = { captureInsertion: () => span, insertText: (text, at) => { inserts.push({ text, at }); return true } }
  const ctx = { slots: {
    inject(name, reg) { assert.equal(name, 'conversation.input.left'); reg() },
    register(_, comp) { Component = comp },
  }, effect(fn) { cleanups.push(fn()) } }
  const render = () => root.render(React.createElement('div', { 'data-composer-card': '' },
    React.createElement('div', { 'data-composer-input': '', contentEditable: true }),
    React.createElement(Component, { useInput: fn => fn(state), inputActions, sessionId: 'session' })))
  try {
    applyTypewriter(ctx, React, win)
    await act(async () => render())
    const q = selector => win.document.querySelector(selector)
    q('.aw-tw-launch').click()
    q('.aw-tw-pick').click()
    assert.equal(inserts.length, 1)
    assert.equal(inserts[0].at, span)
    assert.equal(state.draft, '包含 @引用')
    q('.aw-tw-launch').click()
    state.phase = 'sending'
    await act(async () => render())
    assert.equal(q('.aw-tw-launch').disabled, true)
    assert.equal(q('.aw-tw-panel').hidden, true)
    cleanups.forEach(f => f())
    assert.equal(q('.aw-tw-panel'), null)
  } finally {
    await act(async () => root.unmount())
    for (const [k, d] of existing) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k] }
    dom.window.close()
  }
})
