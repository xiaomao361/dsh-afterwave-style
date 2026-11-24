const SOURCE = 'dsh-afterwave-style'
const BODY_ATTRIBUTE = 'data-dsh-afterwave-style'
const SHEET_ID = 'dsh-afterwave-style-sheet'

const pair = (light, dark) => ({ light, dark })
const bg = pair('#e4ddd0', '#131417')
const paper = pair('#f6f1e8', '#1f2125')
const paper3 = pair('#e2dbcd', '#26292e')
const inset = pair('#ece6da', '#18191c')
const selected = pair('#d6e0ec', '#222d3a')
const ink = pair('#1f1d1a', '#ece6db')
const secondary = pair('#47423b', '#c4bdb1')
const muted = pair('#5d574d', '#9b9488')
const signal = pair('#1f4f86', '#86b4e8')
const signalHover = pair('#173e6b', '#9ec4ee')
const onSignal = pair('#f7f3ec', '#10151c')
const rail = pair('#1b1d21', '#0f1114')
const borderL1 = pair('#d8d0c2', '#26282e')
const borderL2 = pair('#c5bcac', '#33363e')
const line = pair('#a69d8e', '#464a54')
const borderL4 = pair('#7c7468', '#626774')

const tokens = {
  '--dsw-alias-bg-base': bg,
  '--dsw-alias-bg-layer-1': bg,
  '--dsw-alias-bg-layer-2': paper,
  '--dsw-alias-bg-layer-3': paper3,
  '--dsw-alias-bg-module-platform': inset,
  '--dsw-alias-bg-overlay': paper,
  '--dsw-alias-card-fill': paper,
  '--dsw-alias-card-fill-hover': selected,
  '--dsw-alias-label-primary': ink,
  '--dsw-alias-label-primary-dimmed': ink,
  '--dsw-alias-label-primary-bluish': ink,
  '--dsw-alias-label-secondary': secondary,
  '--dsw-alias-label-caption': muted,
  '--dsw-alias-label-tertiary': muted,
  '--dsw-alias-label-dimmed': muted,
  '--dsw-alias-brand-primary': signal,
  '--dsw-alias-brand-text': signal,
  '--dsw-alias-brand-primary-new-colorprimary-new-color': signal,
  '--dsw-alias-state-business-primary': signal,
  '--dsw-alias-state-business-tertiary': selected,
  '--dsw-alias-button-primary-fill': signal,
  '--dsw-alias-button-primary-hover': signalHover,
  '--dsw-alias-label-primary-foreground': onSignal,
  '--dsw-alias-label-primary-inverted': onSignal,
  '--dsw-alias-button-info-fill': signal,
  '--dsw-alias-button-info-hover': signalHover,
  '--dsw-alias-label-on-color': onSignal,
  '--dsw-alias-button-elevated-fill': paper,
  '--dsw-alias-button-floating-fill': paper,
  '--dsw-alias-button-floating-hover': selected,
  '--dsw-alias-button-ghost-active-fill': selected,
  '--dsw-alias-button-ghost-active-hover': selected,
  '--dsw-alias-interactive-bg-hover': pair('rgb(31 29 26 / 6%)', 'rgb(236 230 219 / 6%)'),
  '--dsw-alias-interactive-bg-active': pair('rgb(31 29 26 / 11%)', 'rgb(236 230 219 / 11%)'),
  '--dsw-alias-interactive-bg-hover-solid': selected,
  '--dsw-alias-border-l1': borderL1,
  '--dsw-alias-border-l2': borderL2,
  '--dsw-alias-border-l3': line,
  '--dsw-alias-border-l4': borderL4,
  '--dsw-alias-border-selected': signal,
  '--dsw-alias-link': signal,
  '--dsw-focus-ring-color': signal,
  '--dsw-alias-markdown-code-block': inset,
  '--dsw-alias-markdown-code-block-banner': pair('#e2dbcd', '#1d1f24'),
  '--dsw-alias-markdown-inline-code': inset,
  '--dsw-alias-markdown-code-segment-selected': paper,
  '--dsw-alias-markdown-code-segment-unselected': inset,
  '--dsw-specific-input-major': paper,
  '--dsw-specific-bubble': pair('#dde5ee', '#222832'),
  '--dsw-specific-bubble-highlight': selected,
  // The macOS frame paints five layers outside the sidebar slot. Its fallback
  // fill is scoped to the sidebar column in shell.css (also used by drawers).
  '--dsw-specific-sidebar-fill': inset,
  '--dsw-specific-sidebar-tint': rail,
  '--dsw-specific-sidebar-wash-top': pair('rgb(212 164 90 / 6%)', 'rgb(212 164 90 / 5%)'),
  '--dsw-specific-sidebar-wash-top-clear': pair('rgb(212 164 90 / 0%)', 'rgb(212 164 90 / 0%)'),
  '--dsw-specific-sidebar-wash-bottom-clear': pair('rgb(8 9 11 / 0%)', 'rgb(8 9 11 / 0%)'),
  '--dsw-specific-sidebar-wash-bottom': pair('rgb(8 9 11 / 36%)', 'rgb(8 9 11 / 42%)'),
  '--dsw-specific-sidebar-nav-item-active': selected,
  '--dsw-specific-sidebar-nav-item-active-accent': selected,
  '--dsw-menu-surface-fill': paper,
  '--dsw-specific-menu': paper,
  '--dsw-alias-menu-group-header-fill': paper,
  '--shiki-foreground': ink,
  '--shiki-background': inset,
  '--shiki-token-constant': pair('#0c4a6e', '#7dd3fc'),
  '--shiki-token-string': pair('#0f514b', '#5eead4'),
  '--shiki-token-string-expression': pair('#0e4f63', '#67e8f9'),
  '--shiki-token-comment': muted,
  '--shiki-token-keyword': pair('#5b218a', '#c084fc'),
  '--shiki-token-parameter': pair('#7c3408', '#fbbf24'),
  '--shiki-token-function': pair('#183f8c', '#60a5fa'),
  '--shiki-token-punctuation': secondary,
  '--shiki-token-link': signal,
}

export function applyTheme(ctx, win, cssString) {
  const { document } = win
  return ctx.effect(() => {
    const previous = document.getElementById(SHEET_ID)
    const sheet = document.createElement('style')
    sheet.id = SHEET_ID
    sheet.textContent = cssString
    const releaseTokens = ctx.theme.overrideTokens(SOURCE, tokens)
    try {
      document.head.append(sheet)
      document.body.setAttribute(BODY_ATTRIBUTE, '')
      previous?.remove()
    } catch (error) {
      sheet.remove()
      releaseTokens()
      throw error
    }
    return () => {
      // A late disposer from a replaced client must leave the new mount intact.
      if (document.getElementById(SHEET_ID) === sheet) document.body.removeAttribute(BODY_ATTRIBUTE)
      sheet.remove()
      releaseTokens()
    }
  }, 'afterwave: station stylesheet and theme tokens')
}
