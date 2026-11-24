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

test('overview displays sourced values, seven local days, and opens the latest session directly', () => {
  const { home, station, doc, opened, close } = fixture()
  try {
    home({ phase: 'loading' })
    assert.deepEqual([...doc.querySelectorAll('.aw-readout')].map(n => n.textContent), ['—', '—', '—'])
    assert.equal(doc.querySelector('.aw-list').hidden, true)
    home(activity)
    const draft = doc.querySelector('textarea')
    draft.focus()
    assert.deepEqual([...doc.querySelectorAll('h1')].map(n => n.textContent), ['工作区概览'])
    assert.deepEqual([...doc.querySelectorAll('.aw-readout')].map(n => n.textContent), ['3', '1', '1'])
    assert.equal(doc.querySelectorAll('.aw-column').length, 7)
    assert.match(doc.querySelector('.aw-column:last-child').title, /2026-11-20，1 个/)
    const firstRow = doc.querySelector('.aw-row')
    assert.equal(firstRow.querySelector('.aw-row-time').textContent, '上次')
    firstRow.click()
    assert.deepEqual(opened, ['c'])
    station.update({ expanded: false, status: 'waiting' })
    assert.equal(doc.querySelector('.aw-panel'), null)
    assert.equal(doc.querySelector('.aw-monitor').getAttribute('aria-label'), '会话状态 · 等待你操作')
    assert.equal(doc.activeElement, draft)
    assert.equal(draft.value, '未发送的草稿')
    assert.doesNotMatch(doc.body.textContent, /余波|收音机|FM|试听/)
    home({ ...activity, total: 0, today: 0, running: 0, sessions: [] })
    assert.equal(doc.querySelector('.aw-query').disabled, true)
    assert.equal(doc.querySelector('.aw-list-note').textContent, '暂无历史会话')
  } finally { close() }
})

test('live filter and scope chips narrow the index, keep IME Enter local, support arrow keys, and reset on workspace change', () => {
  const { dom, doc, home, opened, close } = fixture()
  try {
    home(activity)
    const input = doc.querySelector('.aw-query')
    const scope = key => doc.querySelector(`.aw-scope[data-scope="${key}"]`)
    scope('pinned').click()
    assert.equal(scope('pinned').getAttribute('aria-pressed'), 'true')
    assert.equal(doc.querySelector('.aw-row-title').textContent, '校准记录')
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    assert.deepEqual(opened, [])
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert.deepEqual(opened, ['b'])
    scope('waiting').click()
    assert.equal(doc.querySelector('.aw-row-title').textContent, '晚班交接')
    scope('all').click()
    input.value = '交接'
    input.dispatchEvent(new dom.window.Event('input'))
    assert.equal(doc.querySelectorAll('.aw-row').length, 2)
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    assert.equal(doc.activeElement, doc.querySelector('.aw-row'))
    doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    assert.equal(doc.activeElement, doc.querySelectorAll('.aw-row')[1])
    doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal(doc.activeElement, input)
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal(input.value, '')
    assert.equal(doc.querySelectorAll('.aw-row').length, 3)

    const old = doc.querySelector('.aw-row')
    home({ ...activity, workspaceName: '二号工位', sessions: [{ id: 'd', title: '打样' }] })
    assert.equal(scope('all').getAttribute('aria-pressed'), 'true')
    old.click()
    assert.deepEqual(opened, ['b'])
    assert.equal(doc.querySelector('.aw-row-title').textContent, '打样')
  } finally { close() }
})

test('waiting sessions lead the full list and update the live crew summary', () => {
  const { doc, home, close } = fixture()
  try {
    const reordered = [
      { id: 'a', title: '上午交接', pinned: false },
      { id: 'b', title: '校准记录', pinned: true, running: true },
      { id: 'c', title: '晚班交接', pinned: false, waiting: true },
    ]
    home({ ...activity, sessions: reordered })
    assert.deepEqual([...doc.querySelectorAll('.aw-row-title')].map(el => el.textContent), ['晚班交接', '上午交接', '校准记录'])
    assert.equal(doc.querySelector('.aw-panel').dataset.attention, 'true')
    assert.match(doc.querySelector('.aw-speech').textContent, /1 个会话等你确认/)
    assert.match(doc.querySelector('.aw-trend-title').textContent, /会话最近更新时间分布/)

    home({ ...activity, sessions: sessions.map(row => row.id === 'a' ? { ...row, waiting: true } : row) })
    doc.querySelector('.aw-scope[data-scope="waiting"]').click()
    assert.deepEqual([...doc.querySelectorAll('.aw-row-title')].map(el => el.textContent), ['晚班交接', '上午交接'])
    assert.match(doc.querySelector('.aw-speech').textContent, /2 个会话等你确认/)
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

test('workspace chip, active readout and row flags track data changes without stale indicators', () => {
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
      assert.equal(doc.querySelector('.aw-list-note').textContent, message)
      assert.equal(doc.querySelector('.aw-metric:last-child').dataset.active, 'false')
    }
    home(activity)
    const chip = doc.querySelector('.aw-ws-chip')
    assert.equal(chip.hidden, false)
    assert.equal(chip.textContent, activity.workspaceName)
    assert.equal(chip.title, activity.workspaceName)
    assert.equal(doc.querySelector('.aw-metric:last-child').dataset.active, 'true')

    const flags = () => [...doc.querySelectorAll('.aw-row-flag')].map(flag => [flag.dataset.flag, flag.hidden])
    assert.deepEqual(flags(), [['waiting', false], ['running', false], ['', true]])
    home({ ...activity, running: 0, sessions: sessions.map(session => ({ ...session, running: false, waiting: false })) })
    assert.deepEqual(flags(), [['', true], ['pinned', false], ['', true]])
    assert.equal(doc.querySelector('.aw-metric:last-child').dataset.active, 'false')
  } finally { close() }
})

test('the overview follows host light/dark tokens and hides decorative elements in focus mode', () => {
  const { dom, doc, home, close } = fixture()
  try {
    const sheet = doc.createElement('style')
    sheet.textContent =
      readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8') + '\n' +
      readFileSync(new URL('../src/station.css', import.meta.url), 'utf8').replace(/^@import.*$/gm, '')
    doc.head.append(sheet)
    home(activity)
    const panel = doc.querySelector('.aw-panel')
    const kicker = panel.querySelector('.aw-kicker')
    const style = element => dom.window.getComputedStyle(element)
    assert.equal(kicker.getAttribute('aria-hidden'), 'true')
    assert.equal(style(doc.body).getPropertyValue('--aw-paper').trim(), '#f6f1e8')
    assert.equal(style(doc.body).getPropertyValue('--aw-signal').trim(), '#1f4f86')
    doc.body.setAttribute('data-ds-dark-theme', '')
    assert.equal(style(doc.body).getPropertyValue('--aw-paper').trim(), '#1f2125')
    assert.equal(style(doc.body).getPropertyValue('--aw-signal').trim(), '#86b4e8')
    doc.documentElement.dataset.awFocus = 'on'
    assert.equal(style(kicker).display, 'none')
    assert.equal(panel.querySelector('.aw-query').disabled, false)
    delete doc.documentElement.dataset.awFocus
    assert.notEqual(style(kicker).display, 'none')
  } finally { close() }
})
