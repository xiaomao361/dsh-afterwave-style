const NS = 'http://www.w3.org/2000/svg'

const PATHS = {
  search: [['circle', { cx: '7', cy: '7', r: '4.4' }], ['path', { d: 'm10.4 10.4 3.2 3.2' }]],
  command: [['path', { d: 'M5.5 5.5V4a1.8 1.8 0 1 0-1.8 1.8h8.6A1.8 1.8 0 1 0 10.5 4v8a1.8 1.8 0 1 0 1.8-1.8H3.7A1.8 1.8 0 1 0 5.5 12V5.5Z' }]],
  notes: [['rect', { x: '3.2', y: '2.5', width: '9.6', height: '11', rx: '1.6' }], ['path', { d: 'M5.8 6h4.4M5.8 8.8h4.4M5.8 11.4h2.6' }]],
  timer: [['circle', { cx: '8', cy: '8.8', r: '5.2' }], ['path', { d: 'M6.2 2h3.6M8 6.1v2.9l1.9 1.3' }]],
  wrench: [['path', { d: 'M9.8 4.2a3.8 3.8 0 0 0-4.9 4.9l-2.6 2.6a1.3 1.3 0 0 0 1.8 1.8l2.6-2.6a3.8 3.8 0 0 0 4.9-4.9l-2 2-1.8-1.8 2-2Z' }]],
  jump: [['path', { d: 'M4.5 11.5 11.5 4.5M6.2 4.5h5.3v5.3' }]],
  spark: [['path', { d: 'M8 2.2 9.4 6.6 13.8 8 9.4 9.4 8 13.8 6.6 9.4 2.2 8 6.6 6.6Z' }]],
  reset: [['path', { d: 'M3.2 7.5a5 5 0 1 1 1.4 3.8M3.2 4v3.5h3.5' }]],
  minus: [['path', { d: 'M3.5 8h9' }]],
  cycle: [['path', { d: 'M12.6 6.2A4.8 4.8 0 0 0 4.1 5M3.4 9.8A4.8 4.8 0 0 0 11.9 11M12.8 3.3v3h-3M3.2 12.7v-3h3' }]],
  plus: [['path', { d: 'M8 3.4v9.2M3.4 8h9.2' }]],
  close: [['path', { d: 'm4.5 4.5 7 7M11.5 4.5l-7 7' }]],
  code: [['path', { d: 'M5.4 4.8 2.3 8l3.1 3.2M10.6 4.8 13.7 8l-3.1 3.2M8.9 3.6 7.1 12.4' }]],
  typewriter: [
    ['path', { d: 'M4.5 2.5h7v3.3h-7z' }],
    ['rect', { x: '2', y: '5.8', width: '12', height: '7.7', rx: '1.6' }],
    ['path', { d: 'M4.6 8.5h1.1M7.4 8.5h1.2M10.3 8.5h1.1M5.2 11h5.6' }],
  ],
}

export function icon(doc, name, size = 14) {
  const svg = doc.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('aw-icon')
  for (const [tag, attrs] of PATHS[name] || []) {
    const el = doc.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}
