const COLLAPSE_THRESHOLD = 25

function detectLang(codeEl) {
  const cls = `${codeEl.className || ''} ${codeEl.parentElement?.className || ''}`
  const m = cls.match(/language-([a-z0-9_+#.-]+)/i)
  return m ? m[1] : 'code'
}

export function listCodeBlocks(root) {
  if (!root) return []
  return [...root.querySelectorAll('pre > code')].map((code, index) => {
    const text = code.textContent || ''
    const lines = text.replace(/\n$/, '').split('\n')
    const first = (lines.find(l => l.trim()) || '').trim().slice(0, 60)
    return {
      index,
      pre: code.parentElement,
      code,
      lang: detectLang(code),
      lineCount: lines.length,
      preview: first || '(空代码块)',
      text,
    }
  })
}

export function attachCodeTools(scrollRoot, win) {
  if (!scrollRoot) return { list: () => [], destroy() {} }
  const doc = scrollRoot.ownerDocument

  function decorate() {
    for (const item of listCodeBlocks(scrollRoot)) {
      if (item.lineCount < COLLAPSE_THRESHOLD) continue
      if (item.pre.dataset.awFoldBound) continue
      item.pre.dataset.awFoldBound = '1'
      const bar = doc.createElement('button')
      bar.type = 'button'
      bar.className = 'aw-code-fold-bar'
      bar.setAttribute('aria-expanded', 'true')
      const updateLabel = collapsed => {
        bar.textContent = collapsed
          ? `▸ 展开代码块 · ${item.lang} · ${item.lineCount} 行`
          : `▾ 折叠代码块 · ${item.lang} · ${item.lineCount} 行`
        bar.setAttribute('aria-expanded', String(!collapsed))
      }
      updateLabel(false)
      bar.addEventListener('click', () => {
        const next = !item.pre.hasAttribute('data-aw-folded')
        item.pre.toggleAttribute('data-aw-folded', next)
        updateLabel(next)
      })
      item.pre.prepend(bar)
    }
  }

  let frame
  const schedule = () => {
    if (frame !== undefined) return
    frame = (win.requestAnimationFrame || win.setTimeout)(() => {
      frame = undefined
      decorate()
    }, 120)
  }

  const observer = win.MutationObserver ? new win.MutationObserver(schedule) : null
  observer?.observe(scrollRoot, { childList: true, subtree: true })
  decorate()

  return {
    list: () => listCodeBlocks(scrollRoot),
    destroy() {
      observer?.disconnect()
      if (frame !== undefined) (win.cancelAnimationFrame || win.clearTimeout)(frame)
      for (const pre of scrollRoot.querySelectorAll('pre[data-aw-fold-bound]')) {
        delete pre.dataset.awFoldBound
        pre.removeAttribute('data-aw-folded')
        pre.querySelector('.aw-code-fold-bar')?.remove()
      }
    },
  }
}
