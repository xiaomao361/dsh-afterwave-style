import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { createStation } from '../src/station.js'
import { applyIdentity, createIdentityPreview } from '../src/identity.js'

const sessions = [
  { id: 'c', title: '晚班交接', pinned: false, waiting: true },
  { id: 'b', title: '校准记录', pinned: true, running: true },
  { id: 'a', title: '上午交接', pinned: false },
]
const activity = {
  phase: 'ready', workspaceName: '一号工位', total: 3, today: 1, running: 1, sessions,
  days: Array.from({ length: 7 }, (_, i) => ({ date: '2026-11-' + (14 + i), count: i % 3 === 0 ? 1 : 0 })),
}

function fixture() {
  const dom = new JSDOM('<textarea>未发送的草稿</textarea>', { pretendToBeVisual: true })
  const doc = dom.window.document
  const opened = []
  const station = createStation(doc, { onOpenSession: id => opened.push(id) })
  doc.body.prepend(station.element)
  const home = data => station.update({ expanded: true, activity: data })
  return { dom, doc, home, opened, station, close() { station.destroy(); dom.window.close() } }
}

test('overview displays sourced values, seven local days, and resumes the latest session', () => {
  const { home, station, doc, opened, close } = fixture()
  try {
    home({ phase: 'loading' })
    assert.deepEqual([...doc.querySelectorAll('.aw-readout')].map(n => n.textContent), ['—', '—', '—'])
    assert.equal(doc.querySelector('.aw-resume').hidden, true)
    home(activity)
    const draft = doc.querySelector('textarea')
    draft.focus()
    assert.deepEqual([...doc.querySelectorAll('h1')].map(n => n.textContent), ['工作区概览'])
    assert.deepEqual([...doc.querySelectorAll('.aw-readout')].map(n => n.textContent), ['3', '1', '1'])
    assert.equal(doc.querySelectorAll('.aw-column').length, 7)
    assert.match(doc.querySelector('.aw-column:last-child').title, /2026-11-20，1 个/)
    doc.querySelector('.aw-resume').click()
    assert.deepEqual(opened, ['c'])
    station.update({ expanded: false, status: 'waiting' })
    assert.equal(doc.querySelector('.aw-panel'), null)
    assert.equal(doc.querySelector('.aw-monitor').getAttribute('aria-label'), '会话状态 · 等待你操作')
    assert.equal(doc.activeElement, draft)
    assert.equal(draft.value, '未发送的草稿')
    assert.doesNotMatch(doc.body.textContent, /余波|收音机|FM|试听/)
    home({ ...activity, total: 0, today: 0, running: 0, sessions: [] })
    assert.equal(doc.querySelector('.aw-find').disabled, true)
    assert.equal(doc.querySelector('.aw-last-empty').textContent, '暂无历史会话')
  } finally { close() }
})

test('search filters the actual index, keeps IME Enter local, and resets stale workspace results', () => {
  const { dom, doc, home, opened, close } = fixture()
  try {
    home(activity)
    const toggle = doc.querySelector('.aw-find')
    toggle.click()
    const input = doc.querySelector('.aw-query')
    const scope = doc.querySelector('.aw-scope')
    assert.equal(doc.activeElement, input)
    scope.value = 'pinned'
    scope.dispatchEvent(new dom.window.Event('change'))
    assert.equal(doc.querySelector('.aw-result-name').textContent, '校准记录')
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    assert.deepEqual(opened, [])
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert.deepEqual(opened, ['b'])
    scope.value = 'waiting'
    scope.dispatchEvent(new dom.window.Event('change'))
    assert.equal(doc.querySelector('.aw-result-name').textContent, '晚班交接')
    scope.value = 'all'
    input.value = '交接'
    input.dispatchEvent(new dom.window.Event('input'))
    assert.equal(doc.querySelectorAll('.aw-result').length, 2)
    const old = doc.querySelector('.aw-result')
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal(doc.activeElement, toggle)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    toggle.click()
    home({ ...activity, workspaceName: '二号工位', sessions: [{ id: 'd', title: '打样' }] })
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    old.click()
    assert.deepEqual(opened, ['b'])
    toggle.click()
    assert.equal(input.value, '')
    assert.equal(doc.querySelector('.aw-result-name').textContent, '打样')
  } finally { close() }
})

test('the overview places its session actions first and opens a filtered list for multiple pending sessions', () => {
  const { dom, doc, home, opened, close } = fixture()
  try {
    home(activity)
    const pending = doc.querySelector('.aw-home-pending')
    const resume = doc.querySelector('.aw-resume')
    const face = doc.querySelector('.aw-face')
    for (const action of [pending, resume]) {
      assert.ok(action.compareDocumentPosition(face) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
    }
    assert.match(doc.querySelector('.aw-trend-title').textContent, /会话最近更新时间分布/)
    pending.click()
    assert.deepEqual(opened, ['c'])

    home({ ...activity, sessions: sessions.map(row => row.id === 'a' ? { ...row, waiting: true } : row) })
    doc.querySelector('.aw-find').click()
    const input = doc.querySelector('.aw-query')
    input.value = '旧查询'
    pending.click()
    assert.equal(input.value, '')
    assert.equal(doc.querySelector('.aw-scope').value, 'waiting')
    assert.equal(pending.getAttribute('aria-expanded'), 'true')
    assert.deepEqual([...doc.querySelectorAll('.aw-result-name')].map(row => row.textContent), ['晚班交接', '上午交接'])
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal(doc.activeElement, pending)
    doc.querySelector('.aw-find').click()
    assert.equal(doc.querySelector('.aw-scope').value, 'all')
    assert.deepEqual(opened, ['c'])
  } finally { close() }
})

test('theme takes the official whale frame cell and local brand seats; startup timers cleanly unload', () => {
  const { dom, doc, close } = fixture()
  try {
    const cells = new Map([
      ['sidebar.brand.mark', new Map([[0, 'stock mark']])],
      ['sidebar.brand.name', new Map([[0, 'stock name']])],
      ['conversation.hero.frame/pixel-whale', new Map([[0, 'stock whale']])],
    ])
    const disposers = []
    const ctx = {
      slots: {
        inject(_name, init) { disposers.push(init()) },
        register({ name, id, priority = 0 }, component) {
          const cell = cells.get(id ? name + '/' + id : name)
          assert.ok(cell)
          assert.ok(!cell.has(priority), 'DSH forbids occupied priority in the same cell')
          cell.set(priority, component)
          return () => cell.delete(priority)
        },
      },
      effect(fn) { disposers.push(fn()) },
    }
    applyIdentity(ctx, { createElement() {} }, dom.window)
    const elected = () => [...cells.values()].map(cell => cell.get(Math.min(...cell.keys())))
    assert.ok(elected().every(component => typeof component === 'function'))
    assert.equal(doc.body.hasAttribute('data-aw-power-on'), true)
    disposers.reverse().forEach(fn => fn())
    assert.deepEqual(elected(), ['stock mark', 'stock name', 'stock whale'])
    assert.equal(doc.body.hasAttribute('data-aw-power-on'), false)

    const art = createIdentityPreview(doc)
    doc.body.prepend(art.field)
    const belt = art.field.querySelector('.aw-paper-belt')
    let scans = 0
    dom.window.matchMedia = () => ({ matches: false })
    belt.getAnimations = () => []
    belt.animate = () => { scans++ }
    art.play({ button: 0, currentTarget: doc.body, target: doc.querySelector('textarea') })
    assert.equal(scans, 0)
    const off = art.start()
    assert.equal(scans, 1)
    art.play({ button: 0, currentTarget: doc.body, target: doc.body })
    assert.equal(scans, 2)
    dom.window.matchMedia = () => ({ matches: true })
    art.play()
    assert.equal(scans, 2)
    off()
    assert.equal(art.name.textContent, '四号船坞')
  } finally { close() }
})

test('workspace chip, active readout and search flags track data changes without stale indicators', () => {
  const { doc, home, close } = fixture()
  try {
    const phaseText = {
      loading: '正在读取会话…',
      unselected: '请选择工作区',
      unavailable: '暂时无法读取会话',
    }
    for (const [phase, message] of Object.entries(phaseText)) {
      home({ phase })
      assert.equal(doc.querySelector('.aw-ws-chip').hidden, true)
      assert.equal(doc.querySelector('.aw-last-empty').textContent, message)
      assert.equal(doc.querySelector('.aw-metric:last-child').dataset.active, 'false')
    }
    home(activity)
    const chip = doc.querySelector('.aw-ws-chip')
    assert.equal(chip.hidden, false)
    assert.equal(chip.textContent, activity.workspaceName)
    assert.equal(chip.title, activity.workspaceName)
    assert.equal(doc.querySelector('.aw-metric:last-child').dataset.active, 'true')

    const find = doc.querySelector('.aw-find')
    find.click()
    const flags = () => [...doc.querySelectorAll('.aw-result-flag')].map(flag => [flag.dataset.flag, flag.hidden])
    assert.deepEqual(flags(), [['waiting', false], ['running', false], ['', true]])
    home({ ...activity, running: 0, sessions: sessions.map(session => ({ ...session, running: false, waiting: false })) })
    assert.deepEqual(flags(), [['', true], ['pinned', false], ['', true]])
    assert.equal(doc.querySelector('.aw-metric:last-child').dataset.active, 'false')
  } finally { close() }
})

test('the overview uses the host appearance and keeps decorative metalwork out of focus mode and the reading order', () => {
  const { dom, doc, home, close } = fixture()
  try {
    const sheet = doc.createElement('style')
    sheet.textContent = readFileSync(new URL('../src/station.css', import.meta.url), 'utf8').replace(/^@import.*$/gm, '')
    doc.head.append(sheet)
    home(activity)
    const panel = doc.querySelector('.aw-panel')
    const hardware = panel.querySelector('.aw-panel-hardware')
    const stencil = panel.querySelector('.aw-stencil')
    const style = element => dom.window.getComputedStyle(element)
    assert.deepEqual([...hardware.querySelectorAll('.aw-screw')].map(el => el.dataset.corner), ['nw', 'ne', 'sw', 'se'])
    assert.equal(hardware.getAttribute('aria-hidden'), 'true')
    assert.equal(stencil.getAttribute('aria-hidden'), 'true')
    assert.equal(hardware.querySelector('button,[tabindex],a,input'), null)
    assert.equal(style(hardware).pointerEvents, 'none')
    assert.match(style(panel).getPropertyValue('--aw-case'), /#d7d0c3/)
    assert.equal(style(panel).getPropertyValue('--aw-ink'), '#1c1f24')
    assert.match(style(panel.querySelector('.aw-trend')).backgroundImage, /#132030|rgb\(19, 32, 48\)/)
    doc.body.setAttribute('data-ds-dark-theme', '')
    assert.match(style(panel).getPropertyValue('--aw-case'), /#24282f/)
    assert.equal(style(panel).getPropertyValue('--aw-ink'), '#e8e3da')
    doc.documentElement.dataset.awFocus = 'on'
    assert.equal(style(hardware).display, 'none')
    assert.equal(style(stencil).display, 'none')
    assert.equal(panel.querySelector('.aw-find').disabled, false)
    delete doc.documentElement.dataset.awFocus
    assert.notEqual(style(hardware).display, 'none')
  } finally { close() }
})
