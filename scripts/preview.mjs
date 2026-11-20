import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const options = { absWorkingDir: project, bundle: true, loader: { '.webp': 'dataurl', '.png': 'dataurl' }, target: 'es2022', write: false, legalComments: 'none' }

// The fixture supplies host geometry and synthetic session metadata. The tools,
// identity, activity calculation and styles are the same modules as the plugin.
function mountPreview({ applyTheme, createIdentityPreview, createStation, workspaceActivity, mountTypewriterPreview, attachCopyReadings, mountControls, showControls, mountChatToolsPreview, assets }, css) {
  const get = id => document.getElementById(id)
  const query = selector => document.querySelector(selector)
  const theme = {
    overrideTokens(_name, tokens) {
      const sheet = document.createElement('style')
      const declarations = mode => Object.entries(tokens).map(([name, pair]) => name + ':' + pair[mode]).join(';')
      sheet.textContent = 'body{' + declarations('light') + '} body[data-ds-dark-theme]{' + declarations('dark') + '}'
      document.head.append(sheet)
      return () => sheet.remove()
    },
  }
  applyTheme({ effect: install => install(), theme }, window, css)
  mountControls(window)
  const workspaces = [
    {workspaceId: 'lab', title: '沿岸观测站'},
    {workspaceId: 'notes', title: '个人草稿'},
  ]
  const seed = [
    ['tide', 'lab', '潮位记录整理', 0, 'idle', true],
    ['reading', 'lab', '读数格式校对', 0, 'waiting', false, '这份记录的单位已经统一。请确认是否采用米作为表头单位。'],
    ['runbook', 'lab', '值班流程修订', 1, 'working', true, '对照交班登记表，将夜间巡查和设备复核拆成两个步骤。'],
    ['archive', 'lab', '旧档案目录', 2, 'waiting', false, '目录按照日期排列。图片和当班记录关联到同一个编号。'],
    ['sampling', 'lab', '水样登记', 2, 'idle', false, '三个采样位置均有记录。下次补录时请使用同一套站点简称。'],
    ['compare', 'lab', '仪表复测', 4, 'idle', false, '整理完两次复测的差异后，已经把异常读数单独标记。'],
    ['schedule', 'lab', '周末排班', 6, 'idle', false, '周末轮值名单已整理，周日午间交接。'],
    ['outline', 'notes', '本周复盘', 1, 'idle', true, '草稿包含本周完成事项、遇到的问题和下周的三个重点。'],
    ['reading-list', 'notes', '待读资料', 3, 'idle', false, '待阅读的资料按工程、设计和项目记录分类。'],
  ]
  const state = new Map()
  const drafts = new Map()
  let group = 'lab'
  let current = null
  let serial = 0
  const stamp = new Date()
  for (const [index, [id, workspace, title, ago, status, pinned, description]] of seed.entries()) {
    const date = new Date(stamp)
    date.setDate(date.getDate() - ago)
    if (ago) date.setHours(12, index, 0, 0)
    else {
      const midnight = new Date(stamp).setHours(0, 0, 0, 0)
      date.setTime(stamp.getTime() - Math.min(index * 1800000, (stamp - midnight) / 2))
    }
    state.set(id, {id, workspace, title, updatedAt: date.getTime(), status, pinned, description, messages: []})
  }
  const editor = get('draft')
  const typing = mountTypewriterPreview(get('typing-seat'), editor)
  const identity = createIdentityPreview(document, assets.brandImage, assets.fastenerImage)
  get('brand-mark').append(identity.mark)
  get('brand-name').append(identity.name)
  get('frame').prepend(identity.field, identity.fastener)
  get('frame').addEventListener('click', event => {
    if (current === null) identity.play(event)
  })
  const station = createStation(document, {assets, showControls, onOpenSession: id => { if (state.get(id)?.workspace === group) showPage(id) }})
  attachCopyReadings(get('reading-tools'))
  const chatTools = mountChatToolsPreview(get('meter-seat'), get('thread'))

  const draftKey = () => current ?? 'blank-' + group
  const isRunning = value => ['thinking', 'working', 'busy', 'tool'].includes(value)
  const enableSend = () => { get('send').disabled = !editor.value.trim() }
  function activity() {
    const rows = [...state.values()]
    const blank = {id: 'blank', blank: true, retainedBy: {mainView: 1}}
    const list = {phase: 'ready', ids: ['blank', ...state.keys()], byId: {blank}}
    const statuses = new Map()
    for (const row of rows) {
      list.byId[row.id] = {...row, blank: false, retainedBy: {}, running: isRunning(row.status)}
      statuses.set(row.id, {running: isRunning(row.status), pendingInteraction: row.status === 'waiting' ? {kind: 'question'} : undefined})
    }
    const items = workspaces.map(space => {
      const sessionIds = rows.filter(row => row.workspace === space.workspaceId).map(row => row.id)
      if (space.workspaceId === group) sessionIds.push(blank.id)
      return {...space, sessionIds}
    })
    return workspaceActivity(list, {
      phase: 'ready', state: 'idle', items, archivedSessionIds: [], pinnedSessionIds: rows.filter(row => row.pinned).map(row => row.id),
    }, statuses, Date.now())
  }

  function renderSidebar(model) {
    get('rail-workspace').textContent = model.workspaceName
    const list = get('session-list')
    list.replaceChildren()
    for (const {id, title} of model.sessions) {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'treeitem')
      item.setAttribute('aria-selected', String(current === id))
      item.dataset.rowKey = 'session:' + id
      item.textContent = item.title = title
      item.addEventListener('click', () => showPage(id))
      list.append(item)
    }
  }

  function appendParagraph(article, text, cls) {
    const paragraph = document.createElement('p')
    if (cls) paragraph.className = cls
    paragraph.textContent = text
    article.append(paragraph)
  }
  function renderThread(row) {
    const article = query('#thread article')
    article.replaceChildren()
    if (row.id === 'tide') article.append(get('tidal-report').content.cloneNode(true))
    else if (row.description) appendParagraph(article, row.description)
    for (const message of row.messages) appendParagraph(article, message, 'user-message')
  }
  function renderReadings(row) {
    // These are labelled fixture values. Newly typed local drafts never run a
    // model and therefore have no execution telemetry.
    const dock = get('readings')
    dock.hidden = !row || row.description === undefined && row.id !== 'tide'
    if (dock.hidden) return
    const long = row.id === 'tide'
    for (const [id, reading] of [
      ['count', long ? '5 轮 15 步' : '1 轮 3 步'],
      ['usage', long ? '12.4K tok' : '2.6K tok'],
      ['context', get('fuel').value + '%'],
    ]) {
      const b = get(id + '-reading')
      b.setAttribute('aria-label', id === 'context' ? '上下文已用 ' + reading : reading)
      b.lastElementChild.textContent = reading
    }
  }
  function showPage(next, nextGroup = group) {
    const returningHome = next === null && current !== null
    drafts.set(draftKey(), editor.value)
    group = nextGroup
    current = next
    const home = current === null
    const row = home ? undefined : state.get(current)
    const model = activity()
    get('workspace-picker').value = group
    get('panel').dataset.phase = home ? 'hero' : 'active'
    get('frame').dataset.contentPhase = get('panel').dataset.phase
    for (const id of ['chat-header', 'thread', 'task-label', 'fuel-label']) get(id).hidden = home
    for (const id of ['workspace', 'home-seat']) get(id).hidden = !home
    identity.field.hidden = !home
    identity.fastener.hidden = !home
    if (home) get('home').setAttribute('aria-current', 'page')
    else {
      get('home').removeAttribute('aria-current')
      get('chat-title').textContent = row.title
      get('signal').value = row.status
      renderThread(row)
    }
    renderReadings(row)
    editor.placeholder = home ? '描述你想要构建的内容…' : '发消息或创建任务…'
    editor.value = drafts.get(draftKey()) ?? ''
    typing.setSession(draftKey())
    typing.refresh()
    chatTools.update(!home)
    enableSend()
    station.update({expanded: home, status: row?.status ?? 'idle', activity: model, sessionId: current, sessionTitle: row?.title})
    get(home ? 'home-seat' : 'meter-seat').append(station.element)
    renderSidebar(model)
    if (returningHome) identity.play()
    if (!home) get('thread').scrollTop = get('thread').scrollHeight
  }
  get('home').addEventListener('click', () => showPage(null))
  get('workspace-picker').addEventListener('change', e => showPage(null, e.target.value))
  editor.addEventListener('input', enableSend)
  get('signal').addEventListener('change', e => {
    if (current === null) return
    state.get(current).status = e.target.value
    station.update({expanded: false, status: e.target.value, activity: activity(), sessionId: current, sessionTitle: state.get(current).title})
  })
  get('fuel').addEventListener('change', () => { if (current) renderReadings(state.get(current)) })
  get('composer').addEventListener('submit', e => {
    e.preventDefault()
    const message = editor.value.trim()
    if (!message) return
    typing.sent()
    editor.value = ''
    const id = current ?? 'draft-' + (++serial)
    if (!state.has(id)) state.set(id, {id, workspace: group, title: [...message].slice(0, 20).join(''), pinned: false, status: 'idle', messages: []})
    const row = state.get(id)
    row.messages.push(message)
    row.updatedAt = Date.now()
    showPage(id)
    editor.focus()
  })
  const details = get('reading-details')
  for (const [id, label, text] of [
    ['count', '会话活动', '轮数和执行步数来自此离线样例。'],
    ['usage', 'Token 用量', '此读数为离线样例的模拟用量。'],
    ['context', '上下文', '此百分比为离线样例的模拟上下文占用。'],
  ]) {
    const button = get(id + '-reading')
    button.addEventListener('click', () => {
      get('reading-heading').textContent = label
      get('reading-body').textContent = button.getAttribute('aria-label') + '。' + text
      details.showModal()
    })
  }
  const appearance = get('appearance')
  appearance.value = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const updateAppearance = () => document.body.toggleAttribute('data-ds-dark-theme', appearance.value === 'dark')
  appearance.addEventListener('change', updateAppearance)
  updateAppearance()
  showPage(null)
  identity.start()
}

const [css, shell, hostCss] = await Promise.all([
  build({ ...options, entryPoints: ['src/style.css'] }),
  readFile(new URL('preview-host.html', import.meta.url), 'utf8'),
  readFile(new URL('preview-host.css', import.meta.url), 'utf8'),
])
const js = await build({
  ...options,
  stdin: {
    resolveDir: project,
    contents: `import {applyTheme} from './src/theme.js';
      import {createStation} from './src/station.js';
      import {workspaceActivity} from './src/activity.js';
      import {createIdentityPreview} from './src/identity.js';
      import {mountTypewriterPreview} from './src/typewriter.js';
      import {attachCopyReadings} from './src/readings.js';
      import * as assets from './src/assets.js';
      import {mountControls, showControls} from './src/controls.js';
      import {mountChatToolsPreview} from './src/chat-tools.js';
      (${mountPreview.toString()})({applyTheme, createIdentityPreview, createStation, workspaceActivity, mountTypewriterPreview, attachCopyReadings, mountControls, showControls, mountChatToolsPreview, assets}, ${JSON.stringify(css.outputFiles[0].text)});`,
  },
  format: 'iife',
})
const html = shell
  .replace('<!-- host-style -->', () => `<style>${hostCss}</style>`)
  .replace('<!-- client-script -->', () => `<script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`)
const outputDir = new URL('../dist/', import.meta.url)
await mkdir(outputDir, { recursive: true })
await writeFile(new URL('preview.html', outputDir), html)
console.log('dist/preview.html')
