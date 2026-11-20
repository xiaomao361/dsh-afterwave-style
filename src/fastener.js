import { getPrefs } from './prefs.js'

let serial = 0

// Six separately lit bevels around the milled face. Off-centre witness marks
// make each sixth-turn visible even though a hex itself is rotationally symmetric.
function fastenerSVG(id) {
  const faces = [
    '0,-22 19,-11 15.6,-9 0,-18',
    '19,-11 19,11 15.6,9 15.6,-9',
    '19,11 0,22 0,18 15.6,9',
    '0,22 -19,11 -15.6,9 0,18',
    '-19,11 -19,-11 -15.6,-9 -15.6,9',
    '-19,-11 0,-22 0,-18 -15.6,-9',
  ]
  return `<svg viewBox="0 0 78 66" width="78" height="66" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${id}-steel" x1=".1" x2=".83" y1="0" y2="1">
        <stop stop-color="var(--aw-alloy-glint)"/><stop offset=".3" stop-color="var(--aw-alloy-mid)"/>
        <stop offset=".44" stop-color="var(--aw-alloy-glint)"/><stop offset=".64" stop-color="var(--aw-alloy-mid)"/>
        <stop offset="1" stop-color="var(--aw-alloy-edge)"/>
      </linearGradient>
      <linearGradient id="${id}-brass" x1=".1" x2=".88" y1=".1" y2=".94">
        <stop stop-color="var(--aw-brass-glint)"/><stop offset=".4" stop-color="var(--aw-brass-mid)"/>
        <stop offset="1" stop-color="var(--aw-brass-edge)"/>
      </linearGradient>
    </defs>
    <g transform="translate(48 29)" stroke-linejoin="round">
      <circle cy="1.4" r="27" fill="var(--aw-alloy-edge)" />
      <circle r="26.5" fill="url(#${id}-steel)" stroke="var(--aw-alloy-edge)" stroke-width="1"/>
      <circle r="24.25" fill="none" stroke="var(--aw-alloy-glint)" stroke-width=".75"/>
      <circle r="22" fill="var(--aw-alloy-slot)"/>
      <g class="aw-fastener-main">
        <polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11" fill="url(#${id}-steel)"/>
        ${faces.map((points, i) => `<polygon points="${points}" fill="${['#fff','#233043','#091321','#293848','#fff','#fff'][i]}" fill-opacity="${[.38,.2,.48,.22,.13,.52][i]}"/>`).join('')}
        <path d="M-15.5 -9 0 -18 15.5 -9" fill="none" stroke="var(--aw-alloy-glint)" stroke-width=".85"/>
        <g stroke="var(--aw-alloy-edge)" stroke-width=".5" opacity=".7">
          <path d="M-9 -11 -2 -15 M7 11 13 7 M6 13 12 9 M-13 6 -10 5"/>
        </g>
        <circle r="13.1" fill="var(--aw-alloy-slot)" stroke="var(--aw-alloy-glint)" stroke-width="1"/>
        <circle r="11.8" fill="none" stroke="var(--aw-alloy-mid)" stroke-width=".7" stroke-dasharray="1 1.65"/>
        <circle r="10" fill="url(#${id}-steel)" stroke="var(--aw-alloy-edge)" stroke-width=".8"/>
        <path d="M0 -5.5 4.8 -2.75V2.75L0 5.5 -4.8 2.75V-2.75Z" fill="var(--aw-alloy-slot)" stroke="var(--aw-alloy-edge)" stroke-width=".6"/>
        <path d="M-4.8 2.75 0 5.5 4.8 2.75" fill="none" stroke="var(--aw-alloy-glint)" stroke-width=".8"/>
        <path d="M-3 -17.1 -.6 -18.5" fill="none" stroke="var(--aw-brass-mid)" stroke-width="2"/>
      </g>
    </g>
    <g transform="translate(13 52)">
      <g class="aw-fastener-brass">
        <path d="M0 -10.5 9.1 -5.25V5.25L0 10.5 -9.1 5.25V-5.25Z M0 -4.4a4.4 4.4 0 1 0 .01 0Z"
          fill="url(#${id}-brass)" fill-rule="evenodd" stroke="var(--aw-brass-edge)" stroke-width="1"/>
        <path d="M-7.6 -4.5 0 -9 7.6 -4.5 M-7.6 -4.5v7" fill="none" stroke="var(--aw-brass-glint)" stroke-width=".8"/>
        <circle r="5.3" fill="none" stroke="var(--aw-brass-edge)" stroke-width=".8"/>
        <path d="M1 8.5 6.5 5.3" stroke="var(--aw-brass-edge)" stroke-width="1"/>
      </g>
    </g>
  </svg>`
}

function ratchetBuffer(context) {
  const duration = .065
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) {
    const time = i / context.sampleRate
    // A pawl strikes the next tooth, followed by a quieter contact as it seats.
    const impact = time < .019 ? time : time - .019
    const env = Math.min(1, impact / .0007) * Math.exp(-impact * 225) * (time < .019 ? 1 : .55)
    const ring = Math.sin(2 * Math.PI * 1700 * time) + .4 * Math.sin(2 * Math.PI * 2840 * time)
    samples[i] = env * (.04 * ring + .025 * (Math.random() * 2 - 1))
  }
  return buffer
}

export function createFastener(doc, fastenerImage) {
  const win = doc.defaultView
  const prefs = getPrefs(win)
  const zone = doc.createElement('div')
  zone.className = 'aw-fastener-zone'
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'aw-dock-fastener'
  button.setAttribute('aria-label', '拧紧船坞螺母')
  button.title = '咔哒 · 拧紧船坞螺栓'
  if (fastenerImage) {
    const img = doc.createElement('img')
    img.className = 'aw-fastener-art'
    img.src = fastenerImage
    img.alt = ''
    img.draggable = false
    img.setAttribute('aria-hidden', 'true')
    button.append(img)
  } else {
    // SVG ids are document-global, even across separately mounted host frames.
    let id
    do { id = 'aw-bolt-' + ++serial } while (doc.getElementById(id + '-steel'))
    button.innerHTML = fastenerSVG(id)
  }
  zone.append(button)

  // A wide window can still have a narrow chat column or an unusually tall
  // composer. Yield the ornament's hit target wherever the two would meet.
  let alive = true, content, safety, resize
  function measureClearance() {
    if (zone.hidden) return
    const target = button.getBoundingClientRect()
    const overlap = target.width > 0 && [...content.querySelectorAll('[data-composer-card], .aw-panel')].some(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && target.left < r.right && target.right > r.left && target.top < r.bottom && target.bottom > r.top
    })
    zone.toggleAttribute('data-covered', overlap)
  }
  function observeLayout() {
    resize.disconnect()
    resize.observe(content)
    for (const el of content.querySelectorAll('[data-composer-seat], [data-composer-card], .aw-panel')) resize.observe(el)
    measureClearance()
  }
  win.queueMicrotask(() => {
    if (!alive || !win.ResizeObserver) return
    content = zone.closest('[data-conversation-content]')
    if (!content) return
    resize = new win.ResizeObserver(measureClearance)
    const tracked = '[data-composer-seat], [data-composer-card], .aw-panel'
    safety = new win.MutationObserver(records => {
      if (zone.hidden) return
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(tracked) || node.querySelector(tracked))))) observeLayout()
    })
    safety.observe(content, {subtree:true, childList:true})
    content.addEventListener('scroll', measureClearance, {capture:true, passive:true})
    observeLayout()
  })
  let turns = 0
  let audio, buffer
  const sources = new Set()
  function stop() {
    const active = audio
    audio = buffer = undefined
    for (const source of sources) {
      source.onended = null
      try { source.stop() } catch {}
      source.disconnect()
    }
    sources.clear()
    if (active && active.state !== 'closed') active.close().catch(() => {})
  }
  function click() {
    turns++
    button.style.setProperty('--aw-fastener-turns', String(turns))
    const keyboardSound = prefs.get('typing.sound')
    if (doc.hidden || !(prefs.get('sound') === true || keyboardSound === true || keyboardSound === 'on')) return
    const Audio = win.AudioContext || win.webkitAudioContext
    if (!Audio) return
    try {
      const context = audio ??= new Audio()
      if (context.state !== 'running') context.resume().catch(() => { if (audio === context) stop() })
      const source = context.createBufferSource()
      buffer ??= ratchetBuffer(context)
      source.buffer = buffer
      source.connect(context.destination)
      sources.add(source)
      source.onended = () => {
        source.disconnect()
        sources.delete(source)
        if (!sources.size) stop()
      }
      source.start()
    } catch { stop() }
  }
  button.addEventListener('click', click)
  return {
    element: zone,
    destroy() {
      alive = false
      safety?.disconnect()
      resize?.disconnect()
      content?.removeEventListener('scroll', measureClearance, true)
      button.removeEventListener('click', click)
      stop()
      zone.remove()
    },
  }
}
