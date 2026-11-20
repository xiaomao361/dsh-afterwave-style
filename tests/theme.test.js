import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { applyTheme } from '../src/theme.js'

test('the package registers a single client and uses host React without bundling a second copy', () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' })
  const { window } = dom
  let loaded
  window.__ModuleLoader__ = { load: entry => { loaded = entry } }
  window.eval(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
  assert.equal(loaded.id, 'dsh-afterwave-style')
  const entry = loaded.factory(id => { assert.equal(id, 'react'); return {} })
  assert.equal(typeof entry.apply, 'function')
  assert.deepEqual(Array.from(entry.inject), ['slots', 'theme', 'uiWorkspace'])
  dom.window.close()
})

test('removing a superseded theme generation keeps the current style and clears only owned attributes', () => {
  const { window } = new JSDOM('<body data-ds-dark-theme data-another-skin></body>')
  const { document } = window
  const layers = new Map()
  const mock = {
    effect: install => install(),
    theme: {
      overrideTokens(id, data) {
        const layer = { data }
        layers.set(id, layer)
        return () => { if (layers.get(id) === layer) layers.delete(id) }
      },
    },
  }
  const first = applyTheme(mock, window, '.old{}')
  const second = applyTheme(mock, window, '.new{}')
  first()
  assert.equal(layers.size, 1)
  assert.ok(document.body.hasAttribute('data-dsh-afterwave-style'))
  assert.equal(document.querySelectorAll('style').length, 1)
  second()
  assert.equal(layers.size, 0)
  assert.equal(document.querySelectorAll('style').length, 0)
  assert.ok(document.body.hasAttribute('data-ds-dark-theme'))
  assert.ok(document.body.hasAttribute('data-another-skin'))
  assert.equal(document.body.hasAttribute('data-dsh-afterwave-style'), false)
  window.close()
})

const shellCSS = readFileSync(new URL('../src/shell.css', import.meta.url), 'utf8')

function mountShell(window) {
  const layers = new Map()
  const dispose = applyTheme({
    effect: install => install(),
    theme: {
      overrideTokens(id, palette) {
        layers.set(id, palette)
        return () => layers.delete(id)
      },
    },
  }, window, shellCSS)
  return { palette: layers.get('dsh-afterwave-style'), dispose }
}

function contrastRatio(foreground, background) {
  const luminance = color => {
    const channels = color.slice(1).match(/../g).map(hex => {
      const value = parseInt(hex, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('mode pairs cover the macOS frame wash, native conversation accent, send button and readable surfaces', () => {
  const { window } = new JSDOM('<body/>')
  const { palette } = mountShell(window)
  const token = name => palette['--dsw-' + name]
  const surface = token('alias-bg-base')
  assert.deepEqual(surface, { light: '#dcd6cb', dark: '#141619' })
  assert.deepEqual(token('specific-sidebar-tint'), { light: '#1c1f23', dark: '#0e1013' })
  assert.deepEqual(token('alias-brand-primary'), { light: '#1b528c', dark: '#f0a42b' })
  for (const mode of ['light', 'dark']) {
    for (const layer of ['top', 'top-clear', 'bottom-clear', 'bottom']) {
      assert.ok(token('specific-sidebar-wash-' + layer)[mode])
    }
    assert.match(token('specific-sidebar-tint')[mode], /^#[0-9a-f]{6}$/, 'opaque backing replaces native blue translucency')
    for (const [fg, bg] of [
      ['alias-label-primary', 'alias-bg-base'],
      ['alias-label-caption', 'alias-bg-base'],
      ['alias-label-caption', 'specific-input-major'],
      ['alias-state-business-primary', 'alias-bg-base'],
      ['alias-label-primary-foreground', 'alias-button-primary-fill'],
      ['alias-label-on-color', 'alias-button-info-fill'],
      ['alias-label-on-color', 'alias-button-info-hover'],
    ]) {
      assert.ok(contrastRatio(token(fg)[mode], token(bg)[mode]) >= 4.5, mode + ' ' + fg + ' on ' + bg)
    }
    for (const [name, value] of Object.entries(palette)) {
      if (name.startsWith('--shiki-token-')) {
        assert.ok(contrastRatio(value[mode], palette['--shiki-background'][mode]) >= 4.5, mode + ' ' + name)
      }
    }
  }
  window.close()
})

test('the rc.5 slot tree receives control styles while the main area, collapsed controls and other panels remain independent', () => {
  // AppFrame, SidebarRoot, WorkspaceBrowser/Rows, ConversationHeader and InputBar.
  const { window } = new JSDOM(`<html data-platform="darwin"><body>
    <div><div id="column"><div data-slot="sidebar" style="display:contents"><div>
      <div data-window-drag><button data-sidebar-toggle>折叠</button></div>
      <div data-window-drag><span><span data-slot="sidebar.brand.name">DeepSeek</span></span></div>
      <div><div data-slot="sidebar.session.action"><button aria-label="新会话">新会话</button></div></div>
      <div><div data-sidebar-scrollport>
        <nav><div><button aria-current="page">插件</button></div></nav>
        <div data-slot="sidebar.workspaces"><div><div data-sidebar-workspace-header><span>工作区</span></div>
          <div data-sidebar-list-area role="tree">
            <div role="treeitem" data-row-key="workspace:w" aria-expanded="true">项目</div>
            <div role="treeitem" data-row-key="session:a" aria-selected="true">会话一</div>
            <div role="treeitem" data-row-key="session:b" aria-selected="false">会话二</div>
          </div></div></div>
      </div></div>
      <div><div><div data-slot="sidebar.settings"><button>账户</button></div></div></div>
    </div></div></div>
    <main><header data-window-drag><div data-conversation-header-leading></div><div><div data-conversation-tabs role="tablist"><button role="tab" aria-selected="true">对话</button></div></div></header>
    <div data-conversation-content><section data-turn-trigger><button aria-expanded="false">后台任务状态更新 <time>17:06</time></button></section>
    <div data-composer-seat><div data-composer-card><button aria-busy="false">发送</button></div></div></div></main></div>
    </body></html>`)
  const { document } = window
  const { palette, dispose } = mountShell(window)
  const node = sel => document.querySelector(sel)
  const style = sel => window.getComputedStyle(node(sel))
  const rail = style('[data-slot="sidebar"]')
  const selected = rail.getPropertyValue('--aw-rail-selected')
  const railMuted = rail.getPropertyValue('--aw-rail-muted')
  for (const background of [
    palette['--dsw-specific-sidebar-tint'].light,
    palette['--dsw-specific-sidebar-tint'].dark,
    selected,
  ]) {
    assert.ok(contrastRatio(railMuted, background) >= 4.5)
  }
  assert.equal(style('main').getPropertyValue('--aw-rail-ink'), '')
  assert.match(style('#column').getPropertyValue('--dsw-specific-sidebar-fill'), /sidebar-tint/)
  assert.equal(style('[data-slot="sidebar.session.action"] button').borderRadius, '7px')
  assert.match(style('[data-row-key="session:a"]').backgroundImage, /aw-rail-lamp/)
  assert.doesNotMatch(style('[data-row-key="session:b"]').backgroundImage, /aw-rail-lamp/)
  assert.equal(style('[data-conversation-tabs] button').fontWeight, '650')
  assert.equal(style('[data-turn-trigger]').borderRadius, '7px')
  assert.equal(style('[data-composer-card]').getPropertyValue('--dsw-radius-panel'), '9px')
  assert.equal(style('[data-composer-card] button').borderRadius, '7px')
  document.body.setAttribute('data-ds-dark-theme', '')
  const darkRail = style('[data-slot="sidebar"]')
  assert.equal(darkRail.getPropertyValue('--aw-rail-slot'), '#0e1013')
  assert.ok(contrastRatio(railMuted, darkRail.getPropertyValue('--aw-rail-selected')) >= 4.5)
  const darkSend = style('[data-composer-card] button')
  assert.equal(darkSend.getPropertyValue('--dsw-alias-button-info-fill'), '#f0a42b')
  assert.ok(contrastRatio(darkSend.getPropertyValue('--dsw-alias-label-on-color'), darkSend.getPropertyValue('--dsw-alias-button-info-fill')) >= 4.5)

  node('[data-sidebar-scrollport]').removeAttribute('data-sidebar-scrollport')
  assert.notEqual(style('[data-slot="sidebar.session.action"] button').borderRadius, '7px')
  assert.equal(node('[data-window-drag] button').disabled, false)
  dispose()
  assert.equal(style('[data-slot="sidebar"]').getPropertyValue('--aw-rail-ink'), '')
  assert.doesNotMatch(style('[data-row-key="session:a"]').backgroundImage, /aw-rail-lamp/)
  window.close()
})
