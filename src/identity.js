import { createFastener } from './fastener.js'

// Both renderers use the same graphic elements. The host owns the React tree;
// the self-contained offline preview uses ordinary DOM nodes.
function artwork(make, brandImage) {
  return {
    mark: size => make('span', { className: 'aw-brand-mark', style: { '--aw-mark-size': size + 'px' }, 'aria-hidden': true },
      make('img', { src: brandImage, alt: '', draggable: false })),
    name: () => make('span', { className: 'aw-brand-name' }, '四号船坞'),
    field: () => make('div', { className: 'aw-paper-field', 'aria-hidden': true },
      make('div', { className: 'aw-draft-mark' },
        ...['12M', '10M', '08M', '06M'].map(label => make('span', { key: label }, label))),
      make('div', { className: 'aw-paper-track' },
        make('div', { className: 'aw-paper-belt' }, make('i', { className: 'aw-tape-holes' })),
        make('i', { className: 'aw-tape-head' }))),
  }
}

const sweeps = new WeakMap()
function feed(belt) {
  sweeps.get(belt)?.()
  if (!belt?.isConnected || !belt.animate) return
  const win = belt.ownerDocument.defaultView
  if (win.document.documentElement.dataset.awFocus === 'on') return
  const preferences = ['(prefers-reduced-motion: reduce)', '(forced-colors: active)']
    .map(query => win.matchMedia?.(query)).filter(Boolean)
  if (preferences.some(preference => preference.matches)) return
  const animation = belt.animate([{ transform: 'translateX(-36px)' }, { transform: 'translateX(0)' }],
    { duration: 700, easing: 'cubic-bezier(.2,.72,.2,1)' })
  if (!animation) return

  const controller = new win.AbortController()
  const options = { signal: controller.signal }
  const field = belt.closest('.aw-paper-field')
  // The native frame unmounts on navigation. The offline preview hides it.
  // Watch only this node's ancestry, and only for the lifetime of the sweep.
  const observer = new win.MutationObserver(() => {
    if (!belt.isConnected || field?.hidden || win.document.documentElement.dataset.awFocus === 'on') cancel()
  })
  function release() {
    controller.abort()
    observer.disconnect()
    sweeps.delete(belt)
  }
  function cancel() {
    release()
    animation.cancel()
  }
  sweeps.set(belt, cancel)
  for (let node = belt.parentNode; node; node = node.parentNode) {
    observer.observe(node, node === field
      ? { childList: true, attributeFilter: ['hidden'] }
      : node === win.document.documentElement ? { childList: true, attributeFilter: ['data-aw-focus'] } : { childList: true })
  }
  for (const preference of preferences) {
    preference.addEventListener?.('change', event => { if (event.matches) cancel() }, options)
  }
  animation.addEventListener('finish', release, options)
  animation.addEventListener('cancel', release, options)
}

function isBlank(event) {
  if (!event) return true
  const target = event.target
  if (event.button !== 0 || !event.currentTarget.contains(target) || !target.closest) return false
  if (target.closest('button,a,input,select,textarea,label,[contenteditable],[role="button"],[role="dialog"],[role="menu"],[data-composer-card],.aw-station')) return false
  const selection = target.ownerDocument.getSelection()
  return !selection || selection.isCollapsed || !event.currentTarget.contains(selection.anchorNode)
}

const powerCleanups = new WeakMap()
function powerOn(win, brandImage) {
  const doc = win.document
  const { body } = doc
  powerCleanups.get(body)?.()
  body.setAttribute('data-aw-power-on', '')

  let curtain = null
  let observer = null
  let leaveTimer
  let hardTimer
  let removeTimer
  let scanTimer
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  function removeCurtain() {
    observer?.disconnect()
    observer = null
    win.clearTimeout(leaveTimer)
    win.clearTimeout(hardTimer)
    win.clearTimeout(removeTimer)
    curtain?.remove()
    curtain = null
  }

  function dismissCurtain() {
    if (!curtain || curtain.dataset.leaving) return
    observer?.disconnect()
    observer = null
    win.clearTimeout(leaveTimer)
    win.clearTimeout(hardTimer)
    curtain.dataset.leaving = 'true'
    removeTimer = win.setTimeout(removeCurtain, 320)
  }

  const clear = () => {
    if (powerCleanups.get(body) !== clear) return
    powerCleanups.delete(body)
    win.clearTimeout(scanTimer)
    body.removeAttribute('data-aw-power-on')
    removeCurtain()
  }

  // Only show the drydock boot curtain when the host is still hydrating
  // settings/layout (before the sidebar mounts) so normal reloads stay crisp.
  const hostReady = () => Boolean(doc.querySelector('[data-slot="sidebar"]'))
  if (!reduced && !hostReady() && doc.documentElement.dataset.awFocus !== 'on') {
    const startedAt = Date.now()
    curtain = doc.createElement('div')
    curtain.className = 'aw-boot-curtain'
    curtain.setAttribute('aria-hidden', 'true')
    const plate = doc.createElement('div')
    plate.className = 'aw-boot-plate'
    if (brandImage) {
      const img = doc.createElement('img')
      img.className = 'aw-boot-emblem'
      img.src = brandImage
      img.alt = ''
      img.draggable = false
      plate.append(img)
    }
    const title = doc.createElement('div')
    title.className = 'aw-boot-title'
    title.textContent = '四号船坞'
    const meter = doc.createElement('div')
    meter.className = 'aw-boot-bar'
    meter.append(doc.createElement('i'))
    const sub = doc.createElement('div')
    sub.className = 'aw-boot-sub'
    sub.textContent = 'DRYDOCK-04 · 正在接入船坞控制台…'
    plate.append(title, meter, sub)
    curtain.append(plate)
    body.append(curtain)

    const checkReady = () => {
      if (!hostReady()) return
      observer?.disconnect()
      observer = null
      const wait = Math.max(0, 360 - (Date.now() - startedAt))
      leaveTimer = win.setTimeout(dismissCurtain, wait)
    }
    if (win.MutationObserver) {
      observer = new win.MutationObserver(checkReady)
      observer.observe(body, { childList: true, subtree: true })
    }
    hardTimer = win.setTimeout(dismissCurtain, 2200)
  }

  scanTimer = win.setTimeout(() => {
    body.removeAttribute('data-aw-power-on')
  }, 900)
  powerCleanups.set(body, clear)
  return clear
}

export function createIdentityPreview(doc, brandImage, fastenerImage) {
  const draw = artwork((tag, props = {}, ...children) => {
    const el = doc.createElement(tag)
    for (const [key, value] of Object.entries(props)) {
      if (key === 'style') {
        for (const [css, v] of Object.entries(value)) el.style.setProperty(css, v)
      } else if (key === 'key') continue
      else if (key === 'className') el.className = value
      else el.setAttribute(key, String(value))
    }
    el.append(...children)
    return el
  }, brandImage)
  const field = draw.field()
  const fastener = createFastener(doc, fastenerImage)
  const play = event => { if (!field.hidden && isBlank(event)) feed(field.querySelector('.aw-paper-belt')) }
  return {
    mark: draw.mark(24), name: draw.name(), field, fastener: fastener.element, play,
    start() {
      play()
      const stopScan = powerOn(doc.defaultView, brandImage)
      return () => { stopScan(); fastener.destroy() }
    },
  }
}

// The frame id is the cell occupied by the official home whale. Shadowing that
// seat suspends the native canvas and restores it when the theme is unloaded.
export function applyIdentity(ctx, React, win, brandImage, fastenerImage) {
  const h = React.createElement
  const draw = artwork(h, brandImage)
  let sawFirstHome = false
  function DockHardware() {
    const seat = React.useRef(null)
    React.useLayoutEffect(() => {
      const hardware = createFastener(win.document, fastenerImage)
      seat.current.append(hardware.element)
      return hardware.destroy
    }, [])
    return h('span', { ref: seat, className: 'aw-fastener-seat' })
  }
  function SpectrumFrame({ hero, children }) {
    const frame = React.useRef(null)
    const play = event => {
      if (hero && isBlank(event)) feed(frame.current?.querySelector('.aw-paper-belt'))
    }
    React.useLayoutEffect(() => {
      if (!hero) return
      play()
      // A restored chat can finish booting before the first home is mounted.
      // Start its instrument when the frame becomes visible in that case.
      if (sawFirstHome) return
      sawFirstHome = true
      const host = frame.current
      host.setAttribute('data-aw-first-home', '')
      return () => host.removeAttribute('data-aw-first-home')
    }, [hero])
    return h('div', { className: 'aw-home-frame', ref: frame, onClick: play }, hero && draw.field(), hero && h(DockHardware), children)
  }

  for (const [name, id, Component] of [
    ['sidebar.brand.mark', undefined, ({ size = 24 }) => draw.mark(size)],
    ['sidebar.brand.name', undefined, draw.name],
    ['conversation.hero.frame', 'pixel-whale', SpectrumFrame],
  ]) {
    // Stock occupants use priority 0. DSH rejects equal-priority occupants
    // in the same cell, and chooses the lowest number among survivors.
    const options = id ? { name, id, priority: -1 } : { name, priority: -1 }
    ctx.slots.inject(name, () => ctx.slots.register(options, Component))
  }

  ctx.effect(() => powerOn(win, brandImage))
}
