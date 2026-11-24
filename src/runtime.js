import { createReminders } from './companion.js';
import { getPrefs } from './prefs.js';
import { workspaceActivity, workspaceRows } from './activity.js';
import { mountPalette } from './palette.js';

const FRAME = 'conversation.hero.frame';
const UTILITIES = 'conversation.session.header.utilities';
const CONTENT = '[data-conversation-content]';
const BRAND = '[data-slot="conversation.hero.brand.mark"]';

function selectActivity(chat) {
  const live = chat?.legacy;
  if (live?.runningCalls?.length) return 'tool';
  const kind = live?.partial?.blocks?.at(-1)?.kind;
  if (kind === 'reasoning') return 'thinking';
  if (kind === 'tool-call') return 'tool';
  if (kind === 'text' || kind === 'image') return 'working';
  return 'busy';
}

function selectFailedEnding(chat) {
  // The host continuation projection only covers failures eligible for retry.
  // Consult the current turn's terminal reason for the other native errors.
  const timeline = chat?.timeline;
  const turn = timeline?.turnOrder?.at?.(-1);
  const reason = timeline?.turns?.get?.(turn)?.end?.data?.reason;
  return reason?.kind === 'error' || reason?.kind === 'interrupted' ||
    (reason?.kind === 'aborted' && reason.reason?.kind === 'hook' &&
      reason.reason.reason === 'deepseek-account/signed-out');
}

function selectSessionState(session) {
  if (session?.promptError || session?.openState === 'error') return 'error';
  if (session?.running === true) return 'busy';
  if (session?.openState === 'open' && session?.running === false) return 'idle';
  return 'unknown';
}

// EmptyHero.tsx places the stable brand slot in the first span of the headline.
// Its sibling span holds the title and preview badge. Workspace controls and the
// editor are in a separate row. Leave an unfamiliar host structure alone.
function findHeadline(marker) {
  const content = marker.closest(CONTENT);
  if (!content) return null;
  for (const mark of content.querySelectorAll(`[data-composer-seat] ${BRAND}`)) {
    if (mark.closest(CONTENT) !== content) continue;
    const hitbox = mark.parentElement;
    const headline = hitbox?.parentElement;
    if (hitbox?.localName === 'span' && headline?.localName === 'div' &&
        headline.firstElementChild === hitbox && hitbox.nextElementSibling?.localName === 'span') {
      return headline;
    }
  }
  return null;
}

// LEDs are local to each mounted header. Notification history belongs to the
// window, so switching sessions or remounting a widget cannot replay an edge.
export function createSessionAlerts(win, reminders) {
  const previous = new Map();
  const headers = new Map();
  const settling = new Map();
  let destroyed = false;
  function cancel(id) {
    const ending = settling.get(id);
    if (ending) win.clearTimeout(ending.timer);
    settling.delete(id);
  }
  function observe(id, state, title, coarse = false) {
    if (destroyed || state === 'unknown') return;
    const before = previous.get(id);
    const ending = settling.get(id);
    if (before === state && !ending) return;
    previous.set(id, state);
    const terminal = state === 'idle' || state === 'error';
    if (terminal && (ending || ['working', 'busy', 'thinking', 'tool'].includes(before)) && win.document.hidden) {
      // Running and the terminal timeline/projection arrive as separate host
      // events. Give a nearby failure reason precedence over a coarse stop.
      if (ending && ending.state === state && ending.coarse === coarse) return;
      cancel(id);
      const prior = ending?.prior ?? before;
      const timer = win.setTimeout(() => {
        settling.delete(id);
        reminders.transition(prior, state, title, coarse);
      }, 160);
      settling.set(id, { state, prior, coarse, timer });
      return;
    }
    cancel(id);
    reminders.transition(before, state, title, coarse);
  }
  return {
    header(id) {
      const owners = headers.get(id) ?? new Set();
      const token = {};
      owners.add(token);
      headers.set(id, owners);
      return {
        update(state, title) { if ([...owners].at(-1) === token) observe(id, state, title); },
        release() {
          owners.delete(token);
          if (!owners.size) headers.delete(id);
        },
      };
    },
    subscribe(catalog, groups, statuses) {
      let enabled = true;
      let queued = false;
      let lastMain;
      function update() {
        queued = false;
        if (destroyed || !enabled) return;
        const list = catalog.getSnapshot();
        const workspaces = groups.getSnapshot();
        const map = statuses.getSnapshot();
        if (!map) return;
        let group = workspaceRows(list, workspaces);
        if (group.phase === 'unselected' && lastMain) group = workspaceRows(list, workspaces, lastMain);
        if (group.phase !== 'ready') return;
        lastMain = group.current.id;
        const observed = new Set();
        for (const row of group.rows) {
          const id = row.id;
          observed.add(id);
          if (headers.has(id)) continue;
          const live = map.get(id);
          const failed = list.projectionsBySession?.[id]?.values?.conversationContinuation != null;
          const state = live?.pendingInteraction ? 'waiting' : (live?.running ?? row.running) ? 'busy' : failed ? 'error' : 'idle';
          observe(id, state, row.title || row.displayTitle, true);
        }
        for (const id of previous.keys()) if (!observed.has(id) && !headers.has(id)) {
          cancel(id);
          previous.delete(id);
        }
      }
      function schedule() {
        if (queued) return;
        queued = true;
        win.queueMicrotask(update);
      }
      const releases = [catalog, groups, statuses].map(source => source.subscribe(schedule));
      update();
      return () => {
        enabled = false;
        for (const release of releases) release();
        for (const id of previous.keys()) if (!headers.has(id)) { cancel(id); previous.delete(id); }
      };
    },
    destroy() {
      destroyed = true;
      for (const id of settling.keys()) cancel(id);
      previous.clear();
      headers.clear();
    },
  };
}

export function applyRuntime(ctx, React, win, stationFactory, config = {}) {
  const prefs = config.prefs ?? getPrefs(win);
  const reminders = createReminders(win.document, prefs);
  const alerts = createSessionAlerts(win, reminders);
  const live = new Set();
  const navigation = ctx.get?.('uiWorkspace');
  let active = true;

  function mount(expanded, insert, options, activity) {
    if (!active) return null;
    let station;
    try {
      station = stationFactory(win.document, { ...config, ...options, prefs, reminders, externalAlerts: true });
      station.update({ expanded, status: expanded ? 'idle' : 'unknown', activity });
      if (expanded) station.element.setAttribute('data-aw-hero-replacement', '');
      insert(station.element);
    } catch (error) {
      station?.destroy();
      win.console.warn('Afterwave could not mount its station.', error);
      return null;
    }
    const dispose = () => {
      if (live.delete(dispose)) station.destroy();
    };
    live.add(dispose);
    return { station, dispose };
  }

  const snapshot = value => value;
  const absent = () => undefined;

  function Home({ useSessions, useWorkspaces, useSessionStatus }) {
    const marker = React.useRef(null);
    const mounted = React.useRef(null);
    const latest = React.useRef(null);
    const list = useSessions(snapshot);
    const workspaces = useWorkspaces(snapshot);
    const statuses = useSessionStatus(snapshot);
    // Rebucket unchanged metadata at local midnight, including after sleep or
    // a timezone change. A conversation does not need to be opened to count it.
    const localMidnight = () => new Date().setHours(0, 0, 0, 0);
    const [day, setDay] = React.useState(localMidnight);
    React.useEffect(() => {
      let timer;
      function refresh() {
        const next = new Date();
        next.setHours(24, 0, 0, 0);
        setDay(localMidnight());
        win.clearTimeout(timer);
        timer = win.setTimeout(refresh, Math.max(1, next.getTime() - Date.now()));
      }
      refresh();
      win.addEventListener('focus', refresh);
      win.document.addEventListener('visibilitychange', refresh);
      return () => {
        win.clearTimeout(timer);
        win.removeEventListener('focus', refresh);
        win.document.removeEventListener('visibilitychange', refresh);
      };
    }, []);
    const activity = React.useMemo(() => workspaceActivity(list, workspaces, statuses, day),
      [list, workspaces, statuses, day]);
    React.useLayoutEffect(() => {
      latest.current = activity;
      if (active) {
        if (activity?.workspaceId) win.document.body.dataset.awWorkspaceId = String(activity.workspaceId);
        mounted.current?.station.update({ expanded: true, status: 'idle', activity });
        mountPalette(win).configure({
          sessions: () => latest.current?.sessions ?? [],
          openSession: id => navigation?.openSession?.(id),
        });
      }
    }, [activity]);
    React.useLayoutEffect(() => {
      const headline = findHeadline(marker.current);
      if (!headline) return;
      const onOpenSession = navigation?.openSession && (id => {
        if (active && mounted.current && latest.current.sessions.some(row => row.id === id)) {
          navigation.openSession(id);
        }
      });
      mounted.current = mount(true, element => headline.before(element), { onOpenSession }, latest.current);
      return () => {
        mounted.current?.dispose();
        mounted.current = null;
      };
    }, []);
    return React.createElement('span', { hidden: true, ref: marker });
  }

  function Frame({ hero, children, useSessions, useWorkspaces, useSessionStatus }) {
    // No subscriptions on active chats or embedded views. Keep the host child
    // at the same React position so a changing hero cannot remount the editor.
    const ready = Boolean(useSessions && useWorkspaces && useSessionStatus);
    return React.createElement(React.Fragment, null,
      hero ? React.createElement(Home, {
        key: ready ? 'bound' : 'absent', useSessions: ready ? useSessions : absent,
        useWorkspaces: ready ? useWorkspaces : absent, useSessionStatus: ready ? useSessionStatus : absent,
      }) : null, children);
  }

  function HeaderSignal({ sessionId, useSession, useSessions, useWorkspaces, useSessionStatus, useChat, useProjection }) {
    const anchor = React.useRef(null);
    const mounted = React.useRef(null);
    const alertOwner = React.useRef(null);
    const state = useSession(selectSessionState) ?? 'unknown';
    const catalog = useSessions(snapshot);
    const workspaces = useWorkspaces(snapshot);
    const statuses = useSessionStatus(snapshot);
    const waiting = Boolean(statuses?.get(sessionId)?.pendingInteraction);
    const workspace = React.useMemo(() => workspaceActivity(catalog, workspaces, statuses, Date.now(), sessionId),
      [catalog, workspaces, statuses, sessionId]);
    const row = catalog?.byId?.[sessionId];
    const title = row?.title || row?.displayTitle;
    const latest = React.useRef(null);
    const activity = useChat(selectActivity) ?? 'busy';
    const endedInError = useChat(selectFailedEnding);
    const canRetry = useProjection('conversationContinuation', value => value != null);
    const status = waiting ? 'waiting' : state === 'busy' ? activity :
      endedInError || canRetry ? 'error' : state;

    React.useLayoutEffect(() => {
      // Utilities renders in the main session header, outside both the scroll
      // body and the sticky composer. It stays visible under native approvals.
      const header = anchor.current.closest('[data-slot="conversation.header"]');
      if (!header?.closest('[data-slot="main.conversation"]') || header.closest(CONTENT)) return;
      const onOpenSession = navigation?.openSession && (id => {
        if (active && mounted.current && latest.current?.sessions.some(row => row.id === id && row.waiting)) {
          navigation.openSession(id);
        }
      });
      alertOwner.current = alerts.header(sessionId);
      mounted.current = mount(false, element => anchor.current.append(element), { onOpenSession });
      return () => {
        alertOwner.current?.release();
        alertOwner.current = null;
        mounted.current?.dispose();
        mounted.current = null;
      };
    }, []);
    React.useLayoutEffect(() => {
      latest.current = workspace;
      if (active && workspace?.workspaceId) win.document.body.dataset.awWorkspaceId = String(workspace.workspaceId);
      if (active) alertOwner.current?.update(status, title);
      if (active) mounted.current?.station.update({
        expanded: false, status, activity: workspace, sessionId, sessionTitle: title,
      });
    }, [status, workspace, sessionId, title]);
    return React.createElement('span', { ref: anchor, style: { display: 'contents' } });
  }

  const noChat = select => select(undefined);
  function Utility(props) {
    // A custom host can unload the Chat provider. Keep the hook sequence
    // constant for each lifetime and detach the old meter on session change.
    const hasChat = typeof props.useChat === 'function';
    const hasCatalog = Boolean(props.useSessions && props.useWorkspaces);
    return React.createElement(HeaderSignal, {
      ...props, key: `${hasChat}:${hasCatalog}:${props.sessionId}`, useChat: hasChat ? props.useChat : noChat,
      useSessions: hasCatalog ? props.useSessions : absent, useWorkspaces: hasCatalog ? props.useWorkspaces : absent,
    });
  }

  ctx.inject?.(['uiSession', 'sessions', 'workspaces'], scope => {
    scope.effect(() => alerts.subscribe(scope.get('sessions').list,
      scope.get('workspaces').list, scope.get('uiSession').sessionStatus));
  });
  ctx.slots.inject(FRAME, () => ctx.slots.register({ name: FRAME, id: 'afterwave-home' }, Frame));
  ctx.slots.inject(UTILITIES, () => ctx.slots.register({ name: UTILITIES, id: 'afterwave-signal' }, Utility));
  ctx.effect(() => () => {
    active = false;
    delete win.document.body.dataset.awWorkspaceId;
    for (const dispose of live) dispose();
    alerts.destroy();
    reminders.destroy();
  });
}
