/* Store unit tests. No dependencies — run with:  node tests/store.test.mjs
   Loads js/store.js into a VM sandbox with a stub localStorage and fetch. */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/learning.json'), 'utf8'));

const mem = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: k => mem.delete(k),
  },
  fetch: async () => ({ ok: true, json: async () => seed }),
};
vm.createContext(sandbox);

/* `const Store` is a lexical binding rather than a property of the sandbox
   global, so the script completion value is used to get a handle on it. */
const src = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
const Store = vm.runInContext(src + ';Store;', sandbox);

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`));
}

await Store.init();

/* --- shape of the seed --- */
check('seed nodes load',            Store.state.nodes.length, seed.nodes.length);
check('top-level fields',           Store.roots().map(r => r.id), ['hpc', 'math', 'cpp', 'swe']);
check('direct children',            Store.childrenOf('hpc').length, 3);
check('whole branch',               Store.descendantsOf('hpc').length, 11);
check('ancestor chain',             Store.ancestorsOf('hpc-openmp').map(a => a.id), ['hpc', 'hpc-parallel']);
check('field a topic belongs to',   Store.domainOf('hpc-openmp').id, 'hpc');
check('depth',                      Store.depthOf('hpc-openmp'), 2);

/* --- progress: a leaf uses its own status, a parent averages its children --- */
check('leaf progress (planned)',    Store.progressOf('hpc-cuda'), 0);
check('leaf progress (proficient)', Store.progressOf('hpc-cache'), 0.8);
check('parent rolls up children',   +Store.progressOf('hpc-parallel').toFixed(4),
                                    +((0.55 + 0.25 + 0) / 3).toFixed(4));

/* --- logged time --- */
check('minutes logged directly',    Store.minutesFor('hpc', false), 0);
check('minutes including branch',   Store.minutesFor('hpc', true), 455);
check('minutes on one topic',       Store.minutesFor('cpp-move', false), 105);

/* --- last worked, which drives the tree halos and the list column --- */
check('last worked on a topic',      Store.lastWorked('hpc-openmp', false), '2026-07-28');
check('last worked across a branch', Store.lastWorked('hpc', true), '2026-08-21');
check('nothing logged yet',          Store.lastWorked('math-measure', false), null);
check('a parent with no sessions of its own', Store.lastWorked('hpc-perf', false), null);
check('but reports its branch',      Store.lastWorked('hpc-perf', true), '2026-08-21');

check('days between two dates',      Store.daysBetween('2026-08-01', '2026-08-21'), 20);
check('days across a month end',     Store.daysBetween('2026-02-27', '2026-03-02'), 3);
check('relative wording: today',     Store.relativeDay(Store.todayISO()), 'today');
check('relative wording: yesterday', Store.relativeDay(Store.shiftDays(Store.todayISO(), -1)), 'yesterday');
check('relative wording: days',      Store.relativeDay(Store.shiftDays(Store.todayISO(), -3)), '3d ago');
check('relative wording: weeks',     Store.relativeDay(Store.shiftDays(Store.todayISO(), -14)), '2w ago');
check('relative wording: months',    Store.relativeDay(Store.shiftDays(Store.todayISO(), -60)), '2mo ago');
check('no date, no wording',         Store.relativeDay(null), null);

/* --- a branch can never be moved inside itself --- */
check('cycle detected',             Store.wouldCycle('hpc', 'hpc-openmp'), true);
check('unrelated move is fine',     Store.wouldCycle('hpc', 'math'), false);
let threw = false;
try { Store.updateNode('hpc', { parentId: 'hpc-openmp' }); } catch { threw = true; }
check('cyclic move rejected',       threw, true);

/* --- sessions --- */
Store.addSession({ nodeId: 'hpc-cuda', date: Store.todayISO(), minutes: 30, note: 'first kernel' });
check('logging promotes planned',   Store.byId('hpc-cuda').status, 'learning');
check('minutes recorded',           Store.minutesFor('hpc-cuda', false), 30);

/* --- deleting takes the branch and its sessions with it --- */
const branchIds = new Set(['hpc-parallel', ...Store.descendantsOf('hpc-parallel').map(n => n.id)]);
const sessionsBefore = Store.state.sessions.length;
const branchSessions = Store.state.sessions.filter(s => branchIds.has(s.nodeId)).length;
check('delete returns branch size', Store.deleteNode('hpc-parallel'), 4);
check('orphan sessions removed',    Store.state.sessions.length, sessionsBefore - branchSessions);
check('parent loses the child',     Store.childrenOf('hpc').length, 2);

/* --- export / import round-trip --- */
const snapshot = Store.toJSON();
const nodeCount = Store.state.nodes.length;
Store.importJSON(snapshot);
check('round-trips through JSON',   Store.state.nodes.length, nodeCount);

/* --- streaks, on a controlled set of days so the seed and the calendar
       cannot shift the answer --- */
const day = n => Store.shiftDays(Store.todayISO(), n);
const streakState = days => JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'Topic' }],
  sessions: days.map((d, i) => ({ id: 's' + i, nodeId: 'n', date: day(d), minutes: 30 })),
});

Store.importJSON(streakState([0, -1, -2]));
check('streak counts consecutive days', Store.currentStreak(), 3);

Store.importJSON(streakState([0, -1, -3]));
check('a gap ends the streak',       Store.currentStreak(), 2);

Store.importJSON(streakState([-1, -2]));
check('yesterday still counts',      Store.currentStreak(), 2);

Store.importJSON(streakState([-2, -3]));
check('an older run does not count', Store.currentStreak(), 0);

Store.importJSON(streakState([]));
check('no sessions means no streak', Store.currentStreak(), 0);

/* Date arithmetic must not drift with the timezone or across a DST boundary. */
check('day shift is symmetric',      Store.shiftDays(Store.shiftDays('2026-03-29', 1), -1), '2026-03-29');
check('shift crosses a month end',   Store.shiftDays('2026-02-28', 1), '2026-03-01');
check('shift crosses a year end',    Store.shiftDays('2026-12-31', 1), '2027-01-01');

/* --- the daily focus checklist --- */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'Topic' }],
  sessions: [],
  focus: [
    { id: 'a', date: '2026-05-01', text: 'read chapter 1', done: true },
    { id: 'b', date: '2026-05-01', text: 'exercises',      done: false },
    { id: 'c', date: '2026-05-02', text: 'review notes',   done: false, nodeId: 'n' },
    { id: 'd', date: '2026-05-02', text: '',               done: false },
    { id: 'e', date: '2026-05-02', text: 'linked to a ghost', done: false, nodeId: 'gone' },
  ],
}));
check('empty task text dropped',     Store.focusFor('2026-05-02').length, 2);
check('tasks for one day',           Store.focusFor('2026-05-01').map(t => t.id), ['a', 'b']);
check('days newest first',           Store.focusDates(), ['2026-05-02', '2026-05-01']);
check('day summary',                 Store.focusSummary('2026-05-01'), { total: 2, done: 1, ratio: 0.5 });
check('a day with nothing planned',  Store.focusSummary('2026-04-01'), { total: 0, done: 0, ratio: 0 });
check('task kept when its topic is gone',
      Store.focusFor('2026-05-02').find(t => t.text === 'linked to a ghost').nodeId, null);

const added = Store.addTask({ text: '  trailing space  ', date: '2026-05-03' });
check('new task is trimmed',         added.text, 'trailing space');
check('blank task refused',          Store.addTask({ text: '   ', date: '2026-05-03' }), null);

Store.toggleTask(added.id);
check('toggling marks it done',      Store.focusFor('2026-05-03')[0].done, true);
check('and records when',            typeof Store.focusFor('2026-05-03')[0].doneAt, 'string');
Store.toggleTask(added.id);
check('toggling back clears it',     Store.focusFor('2026-05-03')[0].doneAt, null);

Store.updateTask(added.id, { text: 'renamed task' });
check('task text can be edited',     Store.focusFor('2026-05-03')[0].text, 'renamed task');

/* Carrying over pulls only unfinished work, and only from the latest earlier day. */
check('carry over moves the unfinished', Store.carryOverTo('2026-05-04'), 1);
check('it arrives on the new day',   Store.focusFor('2026-05-04').map(t => t.text), ['renamed task']);
check('carrying twice is a no-op',   Store.carryOverTo('2026-05-04'), 0);
check('the source day is untouched', Store.focusFor('2026-05-03').length, 1);

Store.deleteTask(added.id);
check('task deleted',                Store.focusFor('2026-05-03').length, 0);
check('focus survives export',       JSON.parse(Store.toJSON()).focus.length, Store.state.focus.length);

/* Older files have no focus array at all. */
Store.importJSON(JSON.stringify({ nodes: [{ id: 'x', parentId: null, name: 'X' }] }));
check('missing focus array defaults', Store.state.focus, []);
check('and a day still summarises',   Store.focusSummary(Store.todayISO()), { total: 0, done: 0, ratio: 0 });

/* --- a broken parent link re-roots instead of vanishing --- */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'orphan', parentId: 'does-not-exist', name: 'Orphan' }],
  sessions: [{ id: 'x', nodeId: 'ghost', date: '2026-01-01', minutes: 10 }],
}));
check('missing parent re-roots',     Store.roots().map(r => r.id), ['orphan']);
check('session for a missing node dropped', Store.state.sessions.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
