import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createIdentityPreview } from '../src/identity.js'

test('a live sweep releases its preference listeners on media change, finish, cancellation or unmount', async () => {
  const { window } = new JSDOM('<body></body>')
  try {
    const queries = new Map()
    window.matchMedia = query => {
      if (!queries.has(query)) queries.set(query, Object.assign(new window.EventTarget(), { matches: false }))
      return queries.get(query)
    }
    function change(query, matches) {
      const preference = window.matchMedia(query)
      preference.matches = matches
      preference.dispatchEvent(Object.assign(new window.Event('change'), { matches }))
    }
    const art = createIdentityPreview(window.document)
    window.document.body.append(art.field)
    const belt = art.field.querySelector('.aw-paper-belt')
    const animations = []
    belt.animate = () => {
      const animation = new window.EventTarget()
      animation.cancellations = 0
      animation.cancel = () => {
        animation.cancellations++
        animation.dispatchEvent(new window.Event('cancel'))
      }
      animations.push(animation)
      return animation
    }
    const reduced = '(prefers-reduced-motion: reduce)'
    const forced = '(forced-colors: active)'
    art.play()
    change(reduced, true)
    assert.equal(animations[0].cancellations, 1)
    art.play()
    assert.equal(animations.length, 1)
    change(reduced, false)
    art.play()
    animations[1].dispatchEvent(new window.Event('finish'))
    change(forced, true)
    assert.equal(animations[1].cancellations, 0)
    change(forced, false)
    art.play()
    change(forced, true)
    assert.equal(animations[2].cancellations, 1)
    change(forced, false)
    art.play()
    animations[3].cancel()
    art.play()
    assert.equal(animations[3].cancellations, 1)
    art.field.hidden = true
    await Promise.resolve()
    assert.equal(animations[4].cancellations, 1)
    art.field.hidden = false
    art.play()
    art.field.remove()
    await Promise.resolve()
    assert.equal(animations[5].cancellations, 1)
    change(reduced, true)
    assert.deepEqual(animations.map(animation => animation.cancellations), [1, 0, 1, 1, 1, 1])
  } finally {
    window.close()
  }
})
