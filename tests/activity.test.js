import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceActivity } from '../src/activity.js';

const noon = (date, hours = 12) => new Date(2026, 0, date, hours).getTime();
const row = (id, date, extra) => ({
  id, title: id, updatedAt: noon(date), blank: false, running: false, retainedBy: {}, ...extra,
});
function fixtures() {
  const rows = [
    row('blank', 3, { blank: false, retainedBy: { mainView: 1 } }), row('today', 3),
    row('previous', 2), row('older', -12, { running: true }), row('fork', 2, { parentId: 'previous' }),
    row('archived', 2), row('agent', 2, { origin: 'subagent' }), row('outside', 3), row('loose', 2),
  ];
  const list = { phase: 'ready', ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) };
  list.byId.retained = row('retained', 3);
  const workspaces = {
    phase: 'ready', state: 'idle', pinnedSessionIds: ['previous'], archivedSessionIds: ['archived'],
    items: [
      { workspaceId: 'a', title: '码头', sessionIds: ['blank', 'today', 'previous', 'older', 'fork', 'archived', 'agent', 'retained'] },
      { workspaceId: 'b', title: 'default-workspace', sessionIds: ['outside'] },
    ],
  };
  return { list, workspaces };
}

test('counts eligible native catalog members and buckets each latest update in local calendar days', () => {
  const { list, workspaces } = fixtures();
  const statuses = new Map([['previous', { running: true, pendingInteraction: { kind: 'question' } }]]);
  const result = workspaceActivity(list, workspaces, statuses, noon(3));
  assert.equal(result.phase, 'ready');
  assert.equal(result.workspaceName, '码头');
  assert.equal(result.total, 4);
  assert.equal(result.running, 2);
  assert.equal(result.today, 1);
  assert.deepEqual(result.days.map(day => day.count), [0, 0, 0, 0, 0, 2, 1]);
  assert.equal(result.days[0].date, '2025-12-28');
  assert.deepEqual(result.sessions.map(row => row.id), ['today', 'fork', 'previous', 'older']);
  assert.deepEqual(result.sessions[2], { id: 'previous', title: 'previous', updatedAt: noon(2), pinned: true, running: true, waiting: true });
  const nextDay = workspaceActivity(list, workspaces, statuses, noon(4, 0));
  assert.equal(nextDay.today, 0);
  assert.equal(nextDay.days[5].count, 1);
});

test('tracks the selected group and distinguishes pending data, missing providers and a real empty group', () => {
  const { list, workspaces } = fixtures();
  const query = () => workspaceActivity(list, workspaces, undefined, noon(3));
  assert.equal(workspaceActivity(undefined, workspaces, undefined, noon(3)).phase, 'unavailable');
  workspaces.phase = 'pending';
  assert.equal(query().phase, 'loading');
  workspaces.phase = 'ready';
  workspaces.state = 'error';
  assert.equal(query().phase, 'unavailable');
  workspaces.state = 'idle';
  list.byId.blank.retainedBy = {};
  assert.equal(query().phase, 'unselected');
  list.byId.outside.retainedBy.mainView = 1;
  assert.equal(query().workspaceName, '默认工作区');
  list.byId.outside.blank = true;
  assert.equal(query().total, 0);
  assert.equal(query().phase, 'ready');
  list.byId.outside.retainedBy = {};
  list.byId.loose.retainedBy.mainView = 1;
  list.byId['ungrouped-log'] = row('ungrouped-log', 2);
  list.ids.push('ungrouped-log');
  assert.equal(query().workspaceName, '未分组');
  assert.deepEqual(query().sessions.map(row => row.id), ['ungrouped-log']);
});

test('header resolves its scoped session even when a retained main view points elsewhere', () => {
  const { list, workspaces } = fixtures();
  const statuses = new Map(['blank', 'today', 'outside', 'archived', 'fork', 'agent', 'loose'].map(id =>
    [id, { pendingInteraction: { kind: 'approval' } }]));
  const sameGroup = workspaceActivity(list, workspaces, statuses, noon(3), 'today');
  assert.deepEqual(sameGroup.sessions.filter(row => row.waiting).map(row => row.id), ['blank', 'fork']);
  const otherGroup = workspaceActivity(list, workspaces, statuses, noon(3), 'outside');
  assert.equal(otherGroup.workspaceName, '默认工作区');
  assert.deepEqual(otherGroup.sessions, []);
  assert.equal(workspaceActivity(list, workspaces, statuses, noon(3), 'deleted').phase, 'unselected');
});
