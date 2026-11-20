import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { attachCopyReadings, readingSummary } from '../src/readings.js'

test('the dock copies only native readings for the current session, including static compact readings', async () => {
  const { window } = new JSDOM(`<div data-composer-dock>
    <span data-composer-stat="activity"><button aria-label="3 轮 15 步 · 185 tok/s">3 轮…</button></span>
    <span data-composer-stat="usage"><span>缓存命中 97%</span></span>
    <span style="anchor-name:--dsh-context-9"><button aria-haspopup="dialog" aria-label="上下文已用 3%">3%</button></span>
    <span class="tools"></span></div>
    <div data-composer-dock><span data-composer-stat="usage">别的会话</span></div>`)
  const dock = window.document.querySelector('[data-composer-dock]')
  const seat = dock.querySelector('.tools')
  const rows = ['会话活动  3 轮 15 步 · 185 tok/s', 'Token 用量  缓存命中 97%', '上下文已用 3%']
  assert.equal(readingSummary(dock), rows.join('\n'))
  let clipboard
  window.navigator.clipboard = { writeText(text) { clipboard = text; return Promise.resolve() } }
  const cleanup = attachCopyReadings(seat)
  seat.querySelector('button').click()
  await Promise.resolve()
  assert.equal(clipboard, rows.join('\n'))
  assert.equal(seat.querySelector('[role=status]').textContent, '统计已复制')
  cleanup()
  assert.equal(seat.childElementCount, 0)
  window.close()
})
