import { getPrefs } from './prefs.js'

function soundOn(prefs) {
  const key = prefs.get('typing.sound')
  return prefs.get('sound') === true || key === true || key === 'on'
}

// Short damped mechanical toggle-switch click, synthesized on demand and closed immediately.
export function playMechanicalClick(win, prefs = getPrefs(win)) {
  if (!win || win.document?.hidden || !soundOn(prefs)) return false
  const Audio = win.AudioContext || win.webkitAudioContext
  if (!Audio) return false
  let ctx
  try {
    ctx = new Audio()
    const rate = ctx.sampleRate || 44100
    const len = Math.max(1, Math.ceil(rate * 0.024))
    const buffer = ctx.createBuffer(1, len, rate)
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) {
      const t = i / rate
      const env = Math.min(1, t / 0.0005) * Math.exp(-t * 280)
      ch[i] = env * (0.036 * Math.sin(2 * Math.PI * 2150 * t) + 0.02 * (Math.random() * 2 - 1))
    }
    if (ctx.state === 'suspended') Promise.resolve(ctx.resume()).catch(() => {})
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.onended = () => {
      src.disconnect()
      if (ctx && ctx.state !== 'closed') Promise.resolve(ctx.close()).catch(() => {})
    }
    src.start()
    return true
  } catch {
    if (ctx && ctx.state !== 'closed') Promise.resolve(ctx.close()).catch(() => {})
    return false
  }
}
