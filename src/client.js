import { applyRuntime } from './runtime.js'
import { applyTheme } from './theme.js'
import { createStation } from './station.js'
import { applyIdentity } from './identity.js'
import { applyReadings } from './readings.js'
import { applyTypewriter } from './typewriter.js'

import { heroImage, stateImages, brandImage, fastenerImage } from './assets.js'
import { applyControls, showControls } from './controls.js'
import { applyChatTools } from './chat-tools.js'
import { mountScratchpad, toggleScratchpad } from './scratchpad.js'
import { mountPalette } from './palette.js'
import { getDockTimer, formatClock } from './timer.js'
import { getPrefs } from './prefs.js'

window.__ModuleLoader__.load({
  id: 'dsh-afterwave-style',
  factory(require) {
    const React = require('react')
    return {
      name: 'dsh-afterwave-style',
      inject: ['slots', 'theme', 'uiWorkspace'],
      apply(ctx) {
        applyTheme(ctx, window, __AFTERWAVE_CSS__)
        applyControls(ctx, window)
        const prefs = getPrefs(window)
        const pad = mountScratchpad(window)
        const timer = getDockTimer(window)
        const palette = mountPalette(window)
        palette.configure({
          commands: () => {
            const snap = timer.snapshot()
            return [
              { id: 'scratchpad', title: '打开 / 关闭船坞堆叠便签', hint: '便签', keywords: 'note scratchpad 备忘', run: () => toggleScratchpad(window) },
              { id: 'timer-panel', title: snap.running ? `打开值班番茄钟（剩余 ${formatClock(snap.remaining)}）` : '打开值班番茄钟面板', hint: '番茄钟', keywords: 'timer pomodoro 专注 倒计时', run: () => timer.openPanel() },
              { id: 'timer-25', title: snap.running ? '暂停 / 继续当前番茄钟' : '快速启动 25 分钟值班番茄钟', hint: '25m', keywords: 'timer start pause', run: () => snap.running ? timer.togglePause() : timer.start(25, '值班专注') },
              { id: 'code-list', title: '查看本会话代码清单', hint: '</>', keywords: 'code snippet 代码块', run: () => window.dispatchEvent(new window.CustomEvent('aw-open-code-list')) },
              { id: 'focus', title: prefs.get('focus') ? '退出极简专注模式' : '开启极简专注模式', hint: '专注', keywords: 'focus mode', run: () => prefs.set('focus', !prefs.get('focus')) },
              { id: 'settings', title: '打开四号船坞工装设置', hint: '设置', keywords: 'controls theme 控制台', run: () => showControls(window) },
            ]
          },
        })
        ctx.effect(() => () => {
          palette.destroy()
          pad.destroy()
          timer.destroy()
        })
        applyIdentity(ctx, React, window, brandImage, fastenerImage)
        applyRuntime(ctx, React, window, createStation, {assets: {heroImage, stateImages}, showControls})
        applyChatTools(ctx, React, window)
        applyReadings(ctx, React)
        applyTypewriter(ctx, React, window)
      },
    }
  },
})
