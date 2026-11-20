import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { getPrefs } from '../src/prefs.js'
import { mountControls, showControls } from '../src/controls.js'

function fixture() {
  const {window} = new JSDOM('<body><button id="open">设置</button></body>', {url:'https://workbench.test'})
  const doc = window.document
  const trigger = doc.querySelector('button')
  return {window, doc, trigger, prefs: getPrefs(window)}
}

test('control preferences update live, including remote changes, and late cleanup preserves the active mount', () => {
  const {window, doc, prefs, trigger} = fixture()
  const first = mountControls(window)
  const last = mountControls(window)
  first()
  showControls(trigger)
  const control = name => doc.querySelector('[aria-label="' + name + '"]')
  const resetDock = doc.querySelector('.aw-ctrl-reset-dock')
  assert.equal(resetDock.hidden, true)
  prefs.set('widgetPos', {x:0.6, y:0.2})
  assert.equal(resetDock.hidden, false)
  resetDock.click()
  assert.equal(prefs.get('widgetPos'), undefined)
  assert.equal(resetDock.hidden, true)
  assert.equal(doc.activeElement, control('会话角落挂件'))
  control('专注模式').click()
  assert.equal(doc.documentElement.dataset.awFocus, 'on')
  const slider = control('首页立绘透明度')
  slider.value = '0'
  slider.dispatchEvent(new window.Event('input'))
  assert.equal(doc.documentElement.style.getPropertyValue('--aw-portrait-opacity'), '0')
  prefs.set('portrait', 'data:image/png;base64,fixture')
  const reset = [...doc.querySelectorAll('button')].find(el => el.textContent === '恢复默认立绘')
  reset.click()
  assert.equal(prefs.get('portrait'), '')
  window.localStorage.setItem('dsh-afterwave-style.glass','false')
  window.dispatchEvent(new window.StorageEvent('storage',{key:'dsh-afterwave-style.glass', newValue:'false'}))
  assert.equal(doc.documentElement.dataset.awGlass, 'off')
  assert.equal(control('毛玻璃效果').checked, false)
  control('工装设置').dispatchEvent(new window.KeyboardEvent('keydown', {key:'Escape',bubbles:true}))
  assert.equal(doc.activeElement, trigger)
  assert.equal(doc.querySelector('.aw-controls'), null)
  showControls(trigger)
  last()
  assert.equal(doc.querySelector('.aw-controls'), null)
  assert.equal(doc.documentElement.dataset.awFocus, undefined)
  assert.equal(doc.documentElement.style.getPropertyValue('--aw-portrait-opacity'),'')
  window.close()
})

test('notification permission is only requested by the switch, failures leave the control off', async () => {
  const {window, doc, prefs, trigger} = fixture()
  let requests = 0
  window.Notification = {permission:'default', async requestPermission() { requests++; return 'denied' }}
  showControls(trigger)
  assert.equal(requests, 0)
  const checkbox = doc.querySelector('[aria-label="桌面通知"]')
  checkbox.click()
  await Promise.resolve()
  assert.equal(requests, 1)
  assert.equal(prefs.get('notifications'), false)
  assert.match(doc.querySelector('[role="status"]').textContent, /拒绝/)
  showControls(trigger)
  prefs.set('notifications', true)
  window.Notification.permission = 'denied'
  showControls(trigger)
  assert.equal(requests, 1)
  assert.equal(prefs.get('notifications'), false)
  assert.match(doc.querySelector('[role="status"]').textContent, /授权已失效/)
  delete window.Notification
  const unsupported = doc.querySelector('[aria-label="桌面通知"]')
  unsupported.click()
  assert.equal(unsupported.checked, false)
  assert.match(doc.querySelector('[role="status"]').textContent, /不支持/)
  showControls(trigger)
  window.close()
})

test('quota failures retain the current preference and draft keys in this window until removal', () => {
  const {window, prefs} = fixture()
  const prototype = Object.getPrototypeOf(window.localStorage)
  prototype.setItem = () => { throw new window.DOMException('Full','QuotaExceededError') }
  assert.equal(prefs.set('typing.draft.a', {text:'草稿'}), false)
  assert.deepEqual(prefs.keys('typing.draft.'), ['typing.draft.a'])
  assert.equal(prefs.get('typing.draft.a').text, '草稿')
  assert.equal(prefs.remove('typing.draft.a'), true)
  assert.deepEqual(prefs.keys('typing.draft.'), [])
  window.close()
})
