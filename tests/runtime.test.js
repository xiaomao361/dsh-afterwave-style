import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {applyRuntime, createSessionAlerts} from '../src/runtime.js';

const h = React.createElement;
const frameSlot = 'conversation.hero.frame';
const utilitySlot = 'conversation.session.header.utilities';
const slot = (name, ...children) => h('div', {'data-slot': name, style: {display: 'contents'}}, ...children);

// EmptyHero.tsx in 0.2.2-rc.5. Only the brand outlet is public. An
// unrecognized surrounding headline must keep the original title visible.
function Home({recognized}) {
  return h('div', null, h('div', null,
    h('div', {className: 'native-headline'},
      h(recognized ? 'span' : 'i', null, slot('conversation.hero.brand.mark', h('svg'))),
      h('span', null, h('span', null, '探索未至之境'), h('span', null, '预览版'))),
    h('div')));
}

function signals({sessionId, running = false, pending, activity, retry, ending, hasChat = true}) {
  const chat = {
    legacy: {
      runningCalls: activity === 'tool' ? [{}] : [],
      partial: {blocks: activity ? [{kind: activity}] : []},
    },
    timeline: {turnOrder: [1], turns: new Map([[1, {end: {data: {reason: ending}}}]])},
  };
  return {
    sessionId,
    useSession: select => select({running, openState: 'open'}),
    useSessionStatus: select => select(new Map([[sessionId, {pendingInteraction: pending}]])),
    useProjection: (_, select) => select(retry ? 23 : null),
    useChat: hasChat ? select => select(chat) : undefined,
  };
}

test('the dashboard follows native workspace data while the active status stays outside the transcript and composer', async () => {
  const dom = new JSDOM('<body data-dsh-afterwave-style><main></main></body>', {pretendToBeVisual: true});
  const win = dom.window;
  const doc = win.document;
  const originals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true});
  const style = doc.createElement('style');
  style.textContent = await readFile(new URL('../src/shell.css', import.meta.url), 'utf8');
  doc.head.append(style);
  const {createRoot} = await import('react-dom/client');
  const slots = new Map();
  const cleanups = [];
  const destroyed = new Set();
  const opened = [];
  const ctx = {
    get: key => key === 'uiWorkspace' ? {openSession: id => opened.push(id)} : undefined,
    slots: {
      inject: (_, install) => cleanups.push(install()),
      register({name}, component) {
        slots.set(name, component);
        return () => slots.delete(name);
      },
    },
    effect: install => cleanups.push(install()),
  };
  let failMount = false;
  applyRuntime(ctx, React, win, (doc, options) => {
    if (failMount) throw new Error('station unavailable');
    const element = doc.createElement('section');
    element.className = 'station';
    return {
      element,
      update({expanded, status, activity}) {
        Object.assign(element.dataset, {expanded, status});
        element.textContent = expanded ? activity?.workspaceName : status;
        element.dashboard = activity;
        element.openListed = options?.onOpenSession;
      },
      destroy() { destroyed.add(element); element.remove(); },
    };
  });
  const Frame = slots.get(frameSlot);
  const Utility = slots.get(utilitySlot);
  const root = createRoot(doc.querySelector('main'));

  // ConversationContent reuses the textarea between phases. Native approval
  // hides the fallback stack and inserts its own interactive sibling in the seat.
  function Content({phase, sessionId, pending, embedded = false, recognized = true, sources}) {
    const hero = phase === 'hero';
    const nestedSurface = embedded ? null : h(Content, {phase: 'hero', sessionId: 'embedded', embedded: true});
    const controls = h('div', null,
      h('button', {className: 'workspace'}, '工作区'),
      slot('conversation.hero.workspace'), slot('conversation.hero.agentPreset'),
      slot('conversation.hero.options', h('button', null, '选项')));
    return h('div', {'data-conversation-content': '', 'data-content-phase': phase, 'data-conversation-session': sessionId},
      slot(frameSlot, h(Frame, {hero: hero && !embedded, ...sources},
        h('div', {'data-conversation-scroll': ''},
          h('div', null, nestedSurface, hero ? null : h('p', null, '最后一条消息')),
          h('div', {'data-composer-seat': ''},
            h('div', {'data-chain-overlay-fallback': 'conversation.composer', style: {display: pending ? 'none' : 'contents'}},
              h('div', null,
                hero ? h(Home, {recognized}) : null,
                hero ? controls : null,
                slot('conversation.composer.bar', h('textarea')))),
            pending ? h('button', {className: 'approval'}, '批准') : null)))));
  }

  function Panel({phase, ...props}) {
    return slot('main.conversation', h('div', {'data-phase': phase},
      slot('conversation.header', h('header', {'data-window-drag': ''},
        phase === 'active' ? slot('conversation.session.header',
          slot(utilitySlot, h(Utility, signals(props)))) : null)),
      h(Content, {phase, ...props})));
  }
  const render = props => act(async () => root.render(h(React.StrictMode, null, h(Panel, props))));
  const active = {phase: 'active', sessionId: 'archive-A'};
  const catalog = {
    phase: 'ready', ids: ['home', 'last'],
    byId: {
      home: {id: 'home', blank: true, retainedBy: {mainView: 1}},
      last: {id: 'last', title: '周报', updatedAt: Date.now(), running: false, blank: false},
    },
  };
  let group = {
    phase: 'ready', items: [{title: '工作台', sessionIds: ['home', 'last']}],
    pinnedSessionIds: [], archivedSessionIds: [],
  };
  const home = {
    phase: 'hero', sessionId: 'home',
    sources: {useSessions: fn => fn(catalog), useWorkspaces: fn => fn(group), useSessionStatus: fn => fn(new Map())},
  };
  const el = selector => doc.querySelector(selector);
  const current = () => el('.station');
  const originalHome = () => el('[data-conversation-session="home"] > [data-slot] > [data-conversation-scroll] > [data-composer-seat] .native-headline');
  const editor = () => el('[data-phase] > [data-conversation-content] > [data-slot] > [data-conversation-scroll] > [data-composer-seat] textarea');
  try {
    assert.deepEqual([...slots.keys()].sort(), [frameSlot, utilitySlot].sort());
    await render(home);
    assert.equal(doc.querySelectorAll('.station').length, 1);
    assert.equal(current().nextElementSibling, originalHome());
    assert.equal(win.getComputedStyle(originalHome()).display, 'none');
    assert.equal(current().dataset.expanded, 'true');
    assert.equal(current().dashboard.total, 1);
    const openListed = current().openListed;
    openListed('not-listed');
    openListed('last');
    assert.deepEqual(opened, ['last']);
    group = {...group, archivedSessionIds: ['last']};
    await render(home);
    assert.equal(current().dashboard.total, 0);
    openListed('last');
    assert.deepEqual(opened, ['last']);
    assert.notEqual(win.getComputedStyle(el('[data-conversation-session="embedded"] .native-headline')).display, 'none');
    assert.ok(el('[data-slot="conversation.hero.options"] button'));
    const homeStation = current();
    const input = editor();
    input.value = '尚未发送的草稿';
    input.focus();
    await render({...active, phase: 'settling'});
    assert.equal(current(), null);
    assert.ok(destroyed.has(homeStation));
    await render(active);
    assert.equal(editor(), input);
    assert.equal(doc.activeElement, input);
    assert.equal(input.value, '尚未发送的草稿');

    const receiver = current();
    assert.equal(receiver.dataset.expanded, 'false');
    assert.ok(receiver.closest('[data-slot="conversation.session.header.utilities"]'));
    assert.equal(el('[data-conversation-scroll] .station'), null);
    assert.equal(el('[data-composer-seat] .station'), null);
    for (const [props, expected] of [
      [{}, 'idle'], [{running: true}, 'busy'],
      [{running: true, activity: 'reasoning'}, 'thinking'],
      [{running: true, activity: 'text'}, 'working'],
      [{running: true, activity: 'tool'}, 'tool'],
      [{retry: true}, 'error'], [{ending: {kind: 'error'}}, 'error'],
      [{ending: {kind: 'aborted', reason: {kind: 'user'}}}, 'idle'],
      [{ending: {kind: 'interrupted'}}, 'error'],
      [{pending: {kind: 'approval'}, running: true, activity: 'tool'}, 'waiting'],
    ]) {
      await render({...active, ...props});
      assert.equal(current(), receiver);
      assert.equal(receiver.dataset.status, expected);
    }
    assert.equal(win.getComputedStyle(el('.approval')).display, 'inline-block');
    assert.equal(el('.approval').closest('[data-chain-overlay-fallback]'), null);
    assert.equal(receiver.closest('[data-chain-overlay-fallback]'), null);
    assert.equal(doc.querySelectorAll('.station').length, 1);
    await render({...active, sessionId: 'archive-B', hasChat: false, running: true});
    assert.ok(destroyed.has(receiver));
    assert.equal(current().dataset.status, 'busy');

    await render({...home, recognized: false});
    assert.equal(current(), null);
    assert.notEqual(win.getComputedStyle(originalHome()).display, 'none');
    await render(active);
    failMount = true;
    win.console.warn = () => {};
    await render(home);
    assert.equal(current(), null);
    assert.notEqual(win.getComputedStyle(originalHome()).display, 'none');
    failMount = false;
    await render(active);
    await render(home);
    assert.equal(win.getComputedStyle(originalHome()).display, 'none');
    for (const dispose of cleanups.splice(0).reverse()) dispose();
    assert.equal(current(), null);
    assert.notEqual(win.getComputedStyle(originalHome()).display, 'none');
    assert.equal(doc.activeElement, input);
    assert.equal(slots.size, 0);
  } finally {
    await act(async () => root.unmount());
    for (const dispose of cleanups.reverse()) dispose();
    dom.window.close();
    for (const [key, previous] of originals) {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    }
  }
});

function source(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    listeners, getSnapshot: () => value,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const listener of listeners) listener(); },
  };
}
function sources() {
  const make = (id, main = false) => ({ id, title: '工单 ' + id, running: false, retainedBy: main ? {mainView: 1} : {} });
  const byId = { a: make('a', true), b: make('b'), c: make('c'), outside: make('outside') };
  return {
    catalog: source({ phase: 'ready', ids: Object.keys(byId), byId }),
    workspaces: source({ phase: 'ready', items: [
      { workspaceId: 'one', sessionIds: ['a','b','c'] }, { workspaceId: 'two', sessionIds: ['outside'] },
    ], archivedSessionIds: [], pinnedSessionIds: [] }),
    statuses: source(new Map(Object.values(byId).map(row => [row.id, { running: false }]))),
  };
}
test('optional root service watches approval and completion after switching away, unregistering all sources on unload', async () => {
  const { window: win } = new JSDOM('', {url:'https://example.test/'});
  Object.defineProperty(win.document, 'hidden', { get: () => true });
  win.localStorage.setItem('dsh-afterwave-style.notifications', 'true');
  const notices = [];
  win.Notification = class {
    static permission = 'granted';
    constructor(name, data) { notices.push([name, data.body]); }
    close() {}
  };
  const { catalog, workspaces, statuses } = sources();
  const services = { sessions:{list:catalog}, workspaces:{list:workspaces}, uiSession:{sessionStatus:statuses} };
  const cleanups = [];
  const ctx = {
    get: name => services[name],
    slots: {inject() {}},
    effect: fn => cleanups.push(fn()),
    inject(names, register) { assert.ok(names.every(name => services[name])); register(this); },
  };
  const send = async (id, status) => { statuses.set(new Map(statuses.getSnapshot()).set(id, status)); await Promise.resolve(); };
  try {
    applyRuntime(ctx, React, win, () => { throw Error('No header is mounted'); });
    await send('a', {running:true});
    const list = catalog.getSnapshot();
    catalog.set({...list, byId: {...list.byId, a:{...list.byId.a,retainedBy:{}}, b:{...list.byId.b,retainedBy:{mainView:1}}}});
    await send('a', {running:true,pendingInteraction:{kind:'approval'}});
    await send('outside', {running:true,pendingInteraction:{kind:'question'}});
    await send('a', {running:true,pendingInteraction:{kind:'approval'}});
    assert.deepEqual(notices, [['工作台 · 等待你操作','工单 a']]);
    await send('a', {running:true});
    await send('a', {running:false});
    await new Promise(resolve => win.setTimeout(resolve,200));
    assert.deepEqual(notices.at(-1), ['工作台 · 任务已结束', '工单 a']);
    await send('b', {running:true});
    await send('b', {running:false});
    for (const release of cleanups.splice(0).reverse()) release();
    assert.ok([catalog, workspaces, statuses].every(face => face.listeners.size === 0));
    await new Promise(resolve => win.setTimeout(resolve,200));
    assert.equal(notices.length,2);
  } finally {
    for (const release of cleanups.reverse()) release();
    win.close();
  }
});

test('header remounts and duplicate widgets share an edge and a late failure replaces a provisional stop', async () => {
  const {window:win} = new JSDOM('');
  Object.defineProperty(win.document,'hidden',{get:() => true});
  const meaningful = [];
  const {catalog,workspaces,statuses} = sources();
  const tracker = createSessionAlerts(win, {
    transition(prev,next,title) {
      if (prev && prev !== next && ['idle','error','waiting'].includes(next)) meaningful.push([prev,next,title]);
    },
  });
  const detach = tracker.subscribe(catalog,workspaces,statuses);
  try {
    const first = tracker.header('a');
    first.update('working','A');
    const second = tracker.header('a');
    second.update('waiting','A');
    first.update('working','A');
    second.update('waiting','A');
    second.release();
    first.release();
    const third = tracker.header('a');
    third.update('waiting','A');
    assert.deepEqual(meaningful,[['working','waiting','A']]);
    third.update('working','A');
    third.update('idle','A');
    third.update('error','A');
    third.update('error','A');
    await new Promise(resolve => win.setTimeout(resolve,200));
    assert.deepEqual(meaningful.at(-1),['working','error','A']);
    assert.equal(meaningful.length,2);
    third.release();
  } finally { detach(); tracker.destroy(); win.close(); }
});
