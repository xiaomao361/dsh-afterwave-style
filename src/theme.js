const SOURCE = 'dsh-afterwave-style'
const BODY_ATTRIBUTE = 'data-dsh-afterwave-style'
const SHEET_ID = 'dsh-afterwave-style-sheet'

const pair = (light, dark) => ({ light, dark })
const fog = pair('#dcd6cb', '#141619')
const raised = pair('#eee9e0', '#1d2025')
const elevated = pair('#e5dfd4', '#262a31')
const inset = pair('#cfc8bb', '#0e1013')
const selected = pair('#c8d5e2', '#2b251b')
const ink = pair('#1c1f24', '#e8e3da')
const secondary = pair('#383733', '#c2bcb2')
const muted = pair('#4a4843', '#a09b91')
const signal = pair('#1b528c', '#f0a42b')
const signalHover = pair('#154170', '#f7b955')
const onSignal = pair('#f7f4ee', '#171410')
const rail = pair('#1c1f23', '#0e1013')
const borderL1 = pair('#cbc3b5', '#23272e')
const borderL2 = pair('#b5ac9d', '#31363f')
const line = pair('#8f8779', '#454b56')
const borderL4 = pair('#6b6459', '#616875')

const tokens = {
  '--dsw-alias-bg-base': fog,
  '--dsw-alias-bg-layer-1': fog,
  '--dsw-alias-bg-layer-2': raised,
  '--dsw-alias-bg-layer-3': elevated,
  '--dsw-alias-bg-module-platform': inset,
  '--dsw-alias-bg-overlay': raised,
  '--dsw-alias-card-fill': raised,
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
  '--dsw-alias-button-info-fill': pair('#9e4819', '#1f5f9e'),
  '--dsw-alias-button-info-hover': pair('#7f3812', '#184d82'),
  '--dsw-alias-label-on-color': pair('#f8f5ef', '#f8f5ef'),
  '--dsw-alias-button-elevated-fill': raised,
  '--dsw-alias-button-floating-fill': raised,
  '--dsw-alias-button-floating-hover': selected,
  '--dsw-alias-button-ghost-active-fill': selected,
  '--dsw-alias-button-ghost-active-hover': selected,
  '--dsw-alias-interactive-bg-hover': pair('rgb(28 31 36 / 7%)', 'rgb(240 164 43 / 10%)'),
  '--dsw-alias-interactive-bg-active': pair('rgb(28 31 36 / 13%)', 'rgb(240 164 43 / 16%)'),
  '--dsw-alias-interactive-bg-hover-solid': selected,
  '--dsw-alias-border-l1': borderL1,
  '--dsw-alias-border-l2': borderL2,
  '--dsw-alias-border-l3': line,
  '--dsw-alias-border-l4': borderL4,
  '--dsw-alias-border-selected': signal,
  '--dsw-alias-link': signal,
  '--dsw-focus-ring-color': signal,
  '--dsw-alias-markdown-code-block': inset,
  '--dsw-alias-markdown-code-block-banner': pair('#c5bdb0', '#191c21'),
  '--dsw-alias-markdown-inline-code': inset,
  '--dsw-alias-markdown-code-segment-selected': raised,
  '--dsw-alias-markdown-code-segment-unselected': inset,
  '--dsw-specific-input-major': raised,
  '--dsw-specific-bubble': pair('#d5dde5', '#212730'),
  '--dsw-specific-bubble-highlight': selected,
  // The macOS frame paints five layers outside the sidebar slot. Its fallback
  // fill is scoped to the sidebar column in shell.css (also used by drawers).
  '--dsw-specific-sidebar-fill': inset,
  '--dsw-specific-sidebar-tint': rail,
  '--dsw-specific-sidebar-wash-top': pair('rgb(232 156 40 / 9%)', 'rgb(232 156 40 / 8%)'),
  '--dsw-specific-sidebar-wash-top-clear': pair('rgb(232 156 40 / 0%)', 'rgb(232 156 40 / 0%)'),
  '--dsw-specific-sidebar-wash-bottom-clear': pair('rgb(8 9 11 / 0%)', 'rgb(8 9 11 / 0%)'),
  '--dsw-specific-sidebar-wash-bottom': pair('rgb(8 9 11 / 42%)', 'rgb(8 9 11 / 48%)'),
  '--dsw-specific-sidebar-nav-item-active': selected,
  '--dsw-specific-sidebar-nav-item-active-accent': selected,
  '--dsw-menu-surface-fill': raised,
  '--dsw-specific-menu': raised,
  '--dsw-alias-menu-group-header-fill': raised,
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
