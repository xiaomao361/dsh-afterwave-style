function localDay(date) {
  const pad = value => String(value).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

function emptyActivity(phase) {
  return { phase, workspaceName: '', total: 0, today: 0, running: 0, days: [], heatmap: [], sessions: [] };
}

export function workspaceRows(list, workspaces, sessionId) {
  if (!list || !workspaces || workspaces.state === 'error') return { phase: 'unavailable' };
  if (list.phase !== 'ready' || workspaces.phase !== 'ready') return { phase: 'loading' };

  // mainView is the same reference the native workspace browser uses to mark
  // the selected session. The hero slot itself is root-scoped.
  const current = sessionId ? list.byId[sessionId] : Object.values(list.byId).find(row => row.retainedBy?.mainView > 0);
  if (!current) return { phase: 'unselected' };
  const owner = workspaces.items.find(workspace => workspace.sessionIds.includes(current.id));
  // Unassigned is a real sidebar group. A session is unassigned only when no
  // registered workspace owns it, regardless of coincident working directories.
  const members = new Set(owner ? owner.sessionIds : workspaces.items.flatMap(row => row.sessionIds));
  const archived = new Set(workspaces.archivedSessionIds);
  // byId contains retained fallbacks as well. Only catalog IDs can be opened.
  const rows = list.ids.map(id => list.byId[id]).filter(row =>
    row && !row.blank && row.origin !== 'subagent' && !archived.has(row.id) &&
    (owner ? members.has(row.id) : !members.has(row.id)));
  return { phase: 'ready', owner, current, rows };
}

// The catalog exposes a latest update per session, not a daily event history.
export function workspaceActivity(list, workspaces, statuses, now, sessionId) {
  const { phase, owner, current, rows } = workspaceRows(list, workspaces, sessionId);
  if (phase !== 'ready') return emptyActivity(phase);
  const pinned = new Set(workspaces.pinnedSessionIds);
  const today = new Date(now);
  const heatmap = Array.from({ length: 140 }, (_, index) => ({
    date: localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + index - 139)),
    count: 0,
  }));
  const days = heatmap.slice(-7);
  const byDate = new Map(heatmap.map(day => [day.date, day]));
  const sessions = [];
  let running = 0;
  for (const row of rows) {
    const id = row.id;
    if (id === current.id) continue;
    const status = statuses?.get(id);
    const active = status?.running ?? row.running;
    if (active) running++;
    const updatedAt = Number.isFinite(row.updatedAt) && row.updatedAt > 0 ? row.updatedAt : 0;
    const day = updatedAt ? byDate.get(localDay(new Date(updatedAt))) : undefined;
    if (day) day.count++;
    sessions.push({
      id, title: row.title?.trim() || '未命名会话', updatedAt, pinned: pinned.has(id),
      running: active, waiting: Boolean(status?.pendingInteraction),
    });
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const workspaceName = owner?.title === 'default-workspace' ? '默认工作区' : owner?.title || '未分组';
  return { phase: 'ready', workspaceId: owner?.workspaceId ?? (owner ? workspaceName : null), workspaceName, total: sessions.length, today: days[6].count, running, days, heatmap, sessions };
}
