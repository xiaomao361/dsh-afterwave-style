import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createReminders, nextWaiting, stickerState } from '../src/companion.js'
import { getPrefs } from '../src/prefs.js'
import { createStation } from '../src/station.js'

const states = ['idle', 'thinking', 'working', 'tool', 'waiting', 'error']
const assets = { heroImage: '/hero.webp', stateImages: Object.fromEntries(states.map(state => [state, '/' + state + '.webp'])) }
const activity = {
  phase: 'ready', sessions: [
    { id: 'z', title: '修复门锁', waiting: true },
    { id: 'a', title: '验收零件', waiting: true },
    { id: 'm', title: '切换电路', waiting: true },
  ], days: [], total: 3, today: 2, running: 1,
}

test('workspace HUD uses local art, pending metadata and live control preferences', () => {
  const { window } = new JSDOM('<main></main>', { url: 'https://example.test/' })
  const doc = window.document
  const prefs = getPrefs(window)
  const opens = []
  let trigger
  const station = createStation(doc, { assets, onOpenSession: id => opens.push(id), showControls: el => { trigger = el } })
  doc.body.append(station.element)
  try {
    const home = value => station.update({ expanded: true, activity: value })
    home(activity)
    const get = cls => station.element.querySelector('.aw-' + cls)
    assert.equal(get('mascot-art').getAttribute('src'), assets.heroImage)
    assert.match(get('home-pending').textContent, /3/)
    get('home-pending').click()
    assert.deepEqual(opens, [])
    get('result').click()
    assert.deepEqual(opens, ['z'])
    get('home-pending').click()
    get('settings').click()
    assert.equal(trigger, get('settings'))
    get('mascot-stage').click()
    assert.equal(get('hero-bubble').hidden, false)
    prefs.set('portrait', 'data:image/png;base64,cGhvdG8=')
    prefs.set('opacity', 0)
    assert.equal(get('mascot-art').getAttribute('src'), prefs.get('portrait'))
    assert.equal(get('mascot-art').style.opacity, '0')
    prefs.set('focus', true)
    assert.equal(get('mascot-stage').hidden, true)
    prefs.set('focus', false)
    prefs.remove('portrait')
    assert.equal(get('mascot-art').getAttribute('src'), assets.heroImage)
    home({ ...activity, sessions: [] })
    assert.equal(get('home-pending').hidden, true)
    get('home-pending').click()
    assert.equal(opens.length, 1)
  } finally { station.destroy(); window.close() }
})

test('six expressions map to real images and pending approvals cycle even after update reorders rows', () => {
  assert.equal(stickerState('busy'), 'working')
  assert.equal(stickerState('unknown'), 'idle')
  const { window } = new JSDOM('<main></main>', { url: 'https://example.test/' })
  const doc = window.document
  const opened = []
  const station = createStation(doc, { assets, onOpenSession: id => opened.push(id) })
  doc.body.append(station.element)
  try {
    for (const status of states) {
      station.update({ status, activity, sessionId: 'a' })
      assert.equal(doc.querySelector('.aw-monitor-image').getAttribute('src'), '/' + status + '.webp')
      assert.equal(doc.querySelector('.aw-dock-image').getAttribute('src'), '/' + status + '.webp')
      assert.match(doc.querySelector('.aw-header-pending').textContent, /2/)
    }
    for (const id of ['a', 'm', 'z']) {
      station.update({ status: 'waiting', activity: { ...activity, sessions: [...activity.sessions].reverse() }, sessionId: id })
      doc.querySelector('.aw-header-pending').click()
    }
    assert.deepEqual(opened, ['m', 'z', 'a'])
    assert.equal(nextWaiting([{ id: 'a', waiting: true }], 'a').count, 0)
    const chip = doc.querySelector('.aw-monitor')
    chip.click()
    const menu = doc.querySelector('.aw-companion-details')
    assert.equal(menu.hidden, false)
    // The header offers a way back after a deliberate dismissal.
    const restore = menu.querySelector('button')
    assert.equal(restore.hidden, true)
    getPrefs(window).set('widget', false)
    assert.equal(restore.hidden, false)
    restore.click()
    assert.equal(getPrefs(window).get('widget'), true)
    assert.equal(menu.hidden, true)
    chip.click()
    chip.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    assert.equal(menu.hidden, true)
    assert.equal(doc.activeElement, chip)
  } finally {
    station.destroy()
    assert.equal(doc.querySelector('.aw-companion-dock'), null)
    window.close()
  }
})

test('reminders require a known edge, explicit preferences, permission and user activation for sound', () => {
  const { window } = new JSDOM('', { url: 'https://example.test/' })
  const doc = window.document
  const prefs = getPrefs(window)
  let hidden = false
  Object.defineProperty(doc, 'hidden', { get: () => hidden })
  const notifications = []
  window.Notification = class {
    static permission = 'granted'
    constructor(title, data) { this.title = title; this.body = data.body; notifications.push(this) }
    close() { this.closed = true }
  }
  const tones = []
  let contexts = 0, closed = 0
  window.AudioContext = class {
    constructor() { contexts++; this.state = 'running'; this.currentTime = 0 }
    createGain() {
      return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }
    }
    createOscillator() {
      return { frequency: {}, connect() {}, start: () => tones.push(true), stop() {}, disconnect() {} }
    }
    async close() { closed++ }
  }
  const reminders = createReminders(doc, prefs)
  const notify = (prev, next) => reminders.transition(prev, next, '交接记录')
  try {
    hidden = true
    notify('working', 'waiting')
    assert.equal(notifications.length, 0)
    prefs.set('notifications', true)
    prefs.set('sound', true)
    notify(undefined, 'waiting')
    notify('unknown', 'waiting')
    notify('waiting', 'waiting')
    notify('waiting', 'idle')
    assert.equal(notifications.length, 0)
    notify('working', 'waiting')
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].body, '交接记录')
    assert.equal(contexts, 0)
    Object.defineProperty(window.navigator, 'userActivation', { value: { isActive: true } })
    window.dispatchEvent(new window.Event('aw-unlock-sound'))
    hidden = false
    notify('working', 'waiting')
    notify('working', 'idle')
    assert.equal(tones.length, 2)
    assert.equal(notifications.length, 1)
    hidden = true
    notify('working', 'idle')
    notify('tool', 'error')
    assert.equal(tones.length, 6)
    assert.equal(notifications.length, 3)
    window.Notification.permission = 'denied'
    prefs.set('sound', false)
    notify('busy', 'error')
    assert.equal(notifications.length, 3)
    assert.equal(tones.length, 6)
  } finally {
    reminders.destroy()
    assert.equal(closed, 1)
    assert.ok(notifications.every(row => row.closed))
    window.close()
  }
})

test('dock fits beside the current editor and retreats to the header when the native gutter closes', async () => {
  const { window } = new JSDOM('<main data-slot="main.conversation"><div data-phase="active"><header></header><form data-composer-card></form></div></main>', {
    pretendToBeVisual: true, url: 'https://example.test/',
  })
  const doc = window.document
  const editor = doc.querySelector('form')
  doc.querySelector('[data-phase]').getBoundingClientRect = () => ({ top: 0, bottom: 748, right: 960 })
  let right = 800
  editor.getBoundingClientRect = () => ({ top: 590, bottom: 716, left: 240, right, width: right - 240 })
  const station = createStation(doc, { assets })
  const refresh = () => new Promise(resolve => {
    window.dispatchEvent(new window.Event('resize'))
    window.requestAnimationFrame(resolve)
  })
  try {
    doc.querySelector('header').append(station.element)
    station.update({ status: 'working', sessionId: 'a' })
    await refresh()
    const dock = doc.querySelector('.aw-companion-dock')
    assert.equal(dock.hidden, false)
    assert.ok(parseInt(dock.style.left, 10) > right)
    station.update({ status: 'waiting', sessionId: 'a' })
    assert.equal(dock.querySelector('.aw-dock-bubble').hidden, false)
    right = 932
    await refresh()
    assert.equal(dock.hidden, true)
    assert.equal(doc.querySelector('.aw-monitor-label').textContent, '等待你操作')
    getPrefs(window).set('focus', true)
    right = 800
    await refresh()
    assert.equal(dock.hidden, true)
  } finally {
    station.destroy()
    window.close()
  }
})

function dockFixture() {
  const {window} = new JSDOM('<main data-phase="active"><header></header><div data-composer-card></div></main>', {
    pretendToBeVisual: true, url:'https://fixture.test/',
  })
  const doc = window.document
  doc.querySelector('main').getBoundingClientRect = () => ({top:0, right:window.innerWidth, bottom:window.innerHeight})
  doc.querySelector('[data-composer-card]').getBoundingClientRect = () => ({
    left:120, width:window.innerWidth-270, right:window.innerWidth-150,
    top:window.innerHeight-155, bottom:window.innerHeight-35,
  })
  const opened = [], settings = []
  const station = createStation(doc, {assets, onOpenSession:id => opened.push(id), showControls:el => settings.push(el)})
  doc.querySelector('header').append(station.element)
  const update = (status = 'idle', sessionId = 'a') => station.update({status, sessionId, activity})
  update()
  const frame = () => new Promise(resolve => window.requestAnimationFrame(resolve))
  const dock = doc.querySelector('.aw-companion-dock')
  const button = dock.querySelector('.aw-dock-sticker')
  const bubble = dock.querySelector('.aw-dock-bubble')
  const trigger = dock.querySelector('.aw-dock-tools')
  const menu = dock.querySelector('[role="menu"]')
  const item = id => menu.querySelector('[data-action="' + id + '"]')
  const key = (target, key) => target.dispatchEvent(new window.KeyboardEvent('keydown', {bubbles:true, key}))
  const pointer = (target, type, x, y, detail = 1) => {
    const event = new window.MouseEvent(type,{bubbles:true, button:0, clientX:x, clientY:y, detail})
    Object.defineProperty(event, 'pointerId', {value:3})
    target.dispatchEvent(event)
  }
  return {window,doc,dock,button,bubble,trigger,menu,key,pointer,item,frame,opened,settings,update,prefs:getPrefs(window),
    close() { station.destroy(); window.close() }}
}

test('sticker taps cycle per-state remarks and five real taps within five seconds unlock the bonus', async () => {
  const f = dockFixture()
  let clock = 200
  Object.defineProperty(f.window.performance,'now',{value:()=>clock})
  try {
    await f.frame()
    for (const status of [...states, 'busy', 'unknown']) {
      f.update(status, 'scope-' + status)
      const seen = new Set()
      for (let i = 0; i < 4; i++) {
        f.button.click()
        assert.equal(f.bubble.hidden,false)
        seen.add(f.bubble.textContent)
      }
      assert.equal(seen.size,4)
      assert.equal(f.dock.hidden,false)
      assert.equal(f.prefs.get('widget'),true)
      clock += 5001
      f.button.click()
      assert.doesNotMatch(f.bubble.textContent,/120%/)
      for (let i = 0; i < 4; i++) f.button.click()
      assert.match(f.bubble.textContent,/整备度 120%/)
      assert.equal(f.button.dataset.bounce,'bonus')
    }
    f.window.matchMedia = () => ({matches:true})
    f.button.dispatchEvent(new f.window.Event('animationend'))
    f.button.click()
    assert.equal(f.button.dataset.bounce,undefined)
  } finally { f.close() }
})

test('menu opens by trigger or context menu, supports keyboard, latest approvals, settings and explicit dismissal', async () => {
  const f = dockFixture()
  const {doc,menu,trigger,button,item,update,key} = f
  try {
    await f.frame()
    trigger.click()
    assert.equal(menu.hidden,false)
    assert.equal(doc.activeElement,item('waiting'))
    assert.match(item('waiting').textContent,/2/)
    key(item('waiting'),'ArrowDown')
    assert.equal(doc.activeElement,item('quip'))
    key(item('quip'),'End')
    assert.equal(doc.activeElement,item('hide'))
    key(item('hide'),'Escape')
    assert.equal(menu.hidden,true)
    assert.equal(doc.activeElement,trigger)
    trigger.click()
    item('waiting').click()
    assert.deepEqual(f.opened,['m'])
    button.dispatchEvent(new f.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}))
    item('quip').click()
    assert.equal(f.bubble.hidden,false)
    assert.equal(doc.activeElement,button)
    trigger.click()
    doc.body.dispatchEvent(new f.window.MouseEvent('pointerdown',{bubbles:true}))
    assert.equal(menu.hidden,true)
    trigger.click()
    item('settings').click()
    assert.deepEqual(f.settings,[doc.querySelector('.aw-monitor')])
    update('waiting','m')
    trigger.click()
    item('waiting').click()
    assert.deepEqual(f.opened,['m','z'])
    trigger.click()
    item('hide').click()
    assert.equal(f.prefs.get('widget'),false)
    assert.equal(f.dock.hidden,true)
    const header=doc.querySelector('.aw-monitor')
    assert.equal(doc.activeElement,header)
    header.click()
    doc.querySelector('.aw-companion-action').click()
    await f.frame()
    assert.equal(f.dock.hidden,false)
    assert.equal(f.prefs.get('widget'),true)
  } finally { f.close() }
})

test('free drag starts past six pixels, suppresses that click only, clamps, syncs and resets', async () => {
  const f = dockFixture()
  const {window,button,dock,bubble,pointer,prefs} = f
  const pos = () => [parseFloat(dock.style.left), parseFloat(dock.style.top)]
  try {
    await f.frame()
    const original = pos()
    pointer(button,'pointerdown',...original)
    pointer(window,'pointermove',original[0]-6,original[1])
    pointer(window,'pointerup',original[0]-6,original[1])
    pointer(button,'click',...original)
    assert.equal(bubble.hidden,false)
    assert.equal(prefs.get('widgetPos'),undefined)

    pointer(button,'pointerdown',...original)
    pointer(window,'pointermove',120,130)
    assert.ok(dock.hasAttribute('data-dragging'))
    pointer(window,'pointerup',120,130)
    pointer(button,'click',120,130)
    assert.equal(bubble.hidden,true)
    assert.deepEqual(pos(),[120,130])
    const saved = prefs.get('widgetPos')
    assert.equal(saved.x,(120-8)/(window.innerWidth-72))
    assert.equal(saved.y,(130-8)/(window.innerHeight-72))
    button.click()
    assert.equal(bubble.hidden,false)

    pointer(button,'pointerdown',120,130)
    pointer(window,'pointermove',-200,-200)
    assert.deepEqual(pos(),[8,8])
    pointer(window,'pointercancel',-200,-200)
    await f.frame()
    assert.deepEqual(pos(),[120,130])
    assert.deepEqual(prefs.get('widgetPos'),saved)

    f.key(button,'ArrowRight')
    assert.equal(pos()[0],144)
    pointer(button,'pointerdown',...pos())
    pointer(window,'pointerup',15,16)
    assert.deepEqual(pos(),[8,8])
    assert.deepEqual(prefs.get('widgetPos'),{x:0,y:0})
    const storageKey = 'dsh-afterwave-style.widgetPos'
    window.localStorage.setItem(storageKey, '{"x":1,"y":1}')
    window.dispatchEvent(new window.StorageEvent('storage',{key:storageKey}))
    window.innerWidth = 800
    window.dispatchEvent(new window.Event('resize'))
    await f.frame()
    assert.deepEqual(pos(),[window.innerWidth-64,window.innerHeight-64])
    f.trigger.click()
    f.item('reset').click()
    await f.frame()
    assert.equal(prefs.get('widgetPos'),undefined)
    assert.deepEqual(pos(),[window.innerWidth-64,window.innerHeight-97])
  } finally { f.close() }
})
