import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createFastener } from '../src/fastener.js'
import { createIdentityPreview } from '../src/identity.js'
import { getPrefs } from '../src/prefs.js'

test('drydock home renders paired working parts, unique SVG paints and noninteractive draft marks', () => {
  const { window } = new JSDOM('', {pretendToBeVisual: true})
  try {
    const doc = window.document
    const first = createIdentityPreview(doc)
    const second = createIdentityPreview(doc)
    doc.body.append(first.field, first.fastener, second.fastener)
    const marks = first.field.querySelector('.aw-draft-mark')
    assert.equal(first.field.getAttribute('aria-hidden'), 'true')
    assert.deepEqual([...marks.children].map(row => row.textContent), ['12M', '10M', '08M', '06M'])
    const button = first.fastener.querySelector('[aria-label="拧紧船坞螺母"]')
    assert.equal(button.type, 'button')
    assert.equal(button.closest('[aria-hidden]'), null)
    assert.equal(button.querySelectorAll('svg .aw-fastener-main, svg .aw-fastener-brass').length, 2)
    const paints = [...doc.querySelectorAll('linearGradient[id]')].map(g => g.id)
    assert.equal(new Set(paints).size, 4)
    const off = first.start()
    button.click()
    button.click()
    assert.equal(button.style.getPropertyValue('--aw-fastener-turns'), '2')
    assert.equal(second.fastener.querySelector('button').style.getPropertyValue('--aw-fastener-turns'), '')
    off()
    button.click()
    assert.equal(button.isConnected, false)
    assert.equal(button.style.getPropertyValue('--aw-fastener-turns'), '2')
  } finally { window.close() }
})

test('ratchet produces a short metallic impact only when one of the two sound preferences is on', () => {
  const { window } = new JSDOM('', {url:'https://workbench.test', pretendToBeVisual: true})
  const devices = []
  class AudioStub {
    sampleRate = 44100
    state = 'running'
    sources = []
    constructor() { devices.push(this) }
    createBuffer(channels, size) {
      assert.equal(channels, 1)
      const signal = new Float32Array(size)
      return {getChannelData: () => signal}
    }
    createBufferSource() {
      const node = {connect(){}, disconnect(){}, stop(){}, start() {this.started = true}}
      this.sources.push(node)
      return node
    }
    async close() { this.state = 'closed' }
  }
  window.AudioContext = AudioStub
  const hardware = createFastener(window.document)
  const button = hardware.element.querySelector('button')
  const prefs = getPrefs(window)
  try {
    button.click()
    assert.equal(devices.length, 0)
    prefs.set('typing.sound','on')
    button.click()
    button.click()
    assert.equal(devices.length, 1)
    const [one, two] = devices[0].sources
    const samples = one.buffer.getChannelData(0)
    assert.equal(one.started && two.started, true)
    assert.equal(one.buffer, two.buffer)
    assert.ok(samples.length / 44100 < .08 && samples.some(v => Math.abs(v) > .01))
    one.onended()
    assert.equal(devices[0].state, 'running')
    two.onended()
    assert.equal(devices[0].state, 'closed')
    prefs.set('typing.sound','off')
    button.click()
    assert.equal(devices.length, 1)
    prefs.set('sound', true)
    button.click()
    assert.equal(devices.length, 2)
    hardware.destroy()
    assert.equal(devices[1].state, 'closed')
    assert.equal(devices[1].sources[0].onended, null)
  } finally { window.close() }
})

test('hardware yields its entire hit target when the composer grows into the lower corner', async () => {
  const { window } = new JSDOM('<main data-conversation-content><form data-composer-card></form></main>')
  let observeSize, released = false
  window.ResizeObserver = class {
    constructor(fn) { observeSize = fn }
    observe() {}
    disconnect() { released = true }
  }
  const doc = window.document
  try {
    const hardware = createFastener(doc)
    const card = doc.querySelector('form')
    const rect = (left, top) => ({left, top, width:78, right:left + 78, bottom:top + 66})
    hardware.element.querySelector('button').getBoundingClientRect = () => rect(22, 700)
    card.getBoundingClientRect = () => rect(50, 730)
    doc.querySelector('main').prepend(hardware.element)
    await Promise.resolve()
    assert.equal(hardware.element.hasAttribute('data-covered'), true)
    card.getBoundingClientRect = () => rect(130, 600)
    observeSize()
    assert.equal(hardware.element.hasAttribute('data-covered'), false)
    released = false
    hardware.destroy()
    assert.equal(released, true)
  } finally { window.close() }
})
