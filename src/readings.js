const dockSlot = 'conversation.composer.dock'
const contextRoot = '[style*="--dsh-context-"]:not([role="dialog"])'
const contextButton = contextRoot + ' button[aria-haspopup="dialog"]'
const fuelOwners = new WeakMap()
const fuelHints = { warn: '上下文占用偏高，注意适时整理', critical: '上下文即将满载，建议压缩或开启新会话' }

export function fuelLevel(value) {
  const found = String(value ?? '').match(/(-?\d+(?:\.\d+)?)\s*[%％]/)
  if (!found) return null
  const percent = Number(found[1])
  return percent >= 88 ? 'critical' : percent >= 75 ? 'warn' : null
}

function watchFuel(seat) {
  const dock = seat.closest('[data-composer-dock]')
  if (!dock) return () => {}
  const lamp = seat.ownerDocument.createElement('span')
  lamp.className = 'aw-fuel-lamp'
  lamp.setAttribute('role', 'img')
  lamp.hidden = true
  seat.append(lamp)
  fuelOwners.set(dock, lamp)
  let previous
  function refresh() {
    if (fuelOwners.get(dock) !== lamp) return
    const meter = dock.querySelector(contextRoot)
    const trigger = meter?.querySelector('button[aria-haspopup="dialog"]') || meter
    const label = trigger?.getAttribute('aria-label') || ''
    const level = fuelLevel(/[%％]/.test(label) ? label : trigger?.textContent)
    if (level === previous) return
    previous = level
    lamp.hidden = !level
    if (level) {
      dock.dataset.fuel = level
      lamp.tabIndex = 0
      lamp.title = fuelHints[level]
      lamp.setAttribute('aria-label', fuelHints[level])
    } else {
      delete dock.dataset.fuel
      lamp.removeAttribute('aria-label')
      lamp.removeAttribute('tabindex')
      lamp.removeAttribute('title')
    }
  }
  const observer = new seat.ownerDocument.defaultView.MutationObserver(records => {
    if (records.some(record => !seat.contains(record.target))) refresh()
  })
  observer.observe(dock, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'style'] })
  refresh()
  return () => {
    observer.disconnect()
    lamp.remove()
    if (fuelOwners.get(dock) === lamp) { fuelOwners.delete(dock); delete dock.dataset.fuel }
  }
}


function reading(container) {
  if (!container) return ''
  const button = container.querySelector('button[aria-label]')
  return (button?.getAttribute('aria-label') || container.textContent || '').trim().replace(/\s*·\s*/g, ' · ')
}

// Only export readings the host chose to show in this conversation and display mode.
export function readingSummary(dock) {
  const activity = reading(dock.querySelector('[data-composer-stat="activity"]'))
  const usage = reading(dock.querySelector('[data-composer-stat="usage"]'))
  const context = dock.querySelector(contextButton)?.getAttribute('aria-label')
  return [activity && '会话活动  ' + activity, usage && 'Token 用量  ' + usage, context].filter(Boolean).join('\n')
}

export function attachCopyReadings(seat) {
  const doc = seat.ownerDocument
  const win = doc.defaultView
  const button = doc.createElement('button')
  button.className = 'aw-copy-readings'
  button.type = 'button'
  button.title = '复制当前统计'
  button.setAttribute('aria-label', button.title)
  const status = doc.createElement('span')
  status.className = 'aw-reading-feedback'
  status.setAttribute('role', 'status')
  seat.append(button, status)
  const stopFuel = watchFuel(seat)
  let alive = true
  let reset

  async function copy() {
    const dock = seat.closest('[data-composer-dock]')
    const summary = dock && readingSummary(dock)
    if (!summary) return
    let result
    try {
      await win.navigator.clipboard.writeText(summary)
      result = '统计已复制'
    } catch {
      result = '剪贴板不可用'
    }
    if (!alive) return
    status.textContent = result
    button.dataset.feedback = result
    button.title = result
    win.clearTimeout(reset)
    reset = win.setTimeout(() => {
      button.title = '复制当前统计'
      delete button.dataset.feedback
      status.textContent = ''
    }, 1750)
  }
  button.addEventListener('click', copy)
  return () => {
    alive = false
    win.clearTimeout(reset)
    button.removeEventListener('click', copy)
    button.remove()
    status.remove()
    stopFuel()
  }
}

export function applyReadings(ctx, React) {
  function CopyReadings() {
    const seat = React.useRef(null)
    React.useLayoutEffect(() => attachCopyReadings(seat.current), [])
    return React.createElement('span', { ref: seat, className: 'aw-reading-tools' })
  }
  ctx.slots.inject(dockSlot, () => ctx.slots.register({ name: dockSlot, id: 'workbench.copy-readings', order: 90 }, CopyReadings))
}
