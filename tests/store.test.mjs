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
  console, URL, URLSearchParams,
  localStorage: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: k => mem.delete(k),
  },
  /* Only the public seed exists here; data/private.json is absent, which is
     the normal case for a published site. */
  fetch: async url => (String(url).includes('learning.json')
    ? { ok: true, json: async () => seed }
    : { ok: false, status: 404 }),
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
/* OpenMP carries a checklist, so it scores that instead of its status. */
check('checklist beats status on a leaf', Store.progressOf('hpc-openmp'), 1);
check('parent rolls up children',   +Store.progressOf('hpc-parallel').toFixed(4),
                                    +((1 + 0.25 + 0) / 3).toFixed(4));

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

/* --- per-topic checklists --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'a', parentId: null, name: 'Field' },
    { id: 'b', parentId: 'a', name: 'Topic', status: 'mastered' },
  ],
}));
check('a leaf with no checklist uses status', Store.progressOf('b'), 1);

const i1 = Store.addItem('b', { text: 'read chapter 1' });
Store.addItem('b', { text: 'do the exercises', url: 'https://example.com/ex' });
check('items added',                 Store.checklistOf('b'), { total: 2, done: 0, ratio: 0 });
check('blank items refused',         Store.addItem('b', { text: '  ' }), null);

/* Progress takes whichever claim is strongest, so adding an empty checklist
   never demotes something already marked mastered. */
check('status still counts with an untouched checklist', Store.progressOf('b'), 1);

Store.updateNode('b', { status: 'learning' });
check('a weaker status yields to the checklist', Store.progressOf('b'), 0.25);
Store.toggleItem('b', i1.id);
check('ticking one item',            Store.checklistOf('b'), { total: 2, done: 1, ratio: 0.5 });
check('progress follows the checklist', Store.progressOf('b'), 0.5);
check('the parent rolls it up',      Store.progressOf('a'), 0.5);

/* Finishing the checklist is a claim the topic is done, so the status follows. */
const second = Store.byId('b').items[1];
const toggled = Store.toggleItem('b', second.id);
check('finishing the list promotes the status', Store.byId('b').status, 'mastered');
check('and reports that it did',     toggled.promoted, true);
check('progress is complete',        Store.progressOf('b'), 1);

Store.toggleItem('b', second.id);
check('un-ticking does not demote',  Store.byId('b').status, 'mastered');
check('but progress reflects the status floor', Store.progressOf('b'), 1);
Store.toggleItem('b', second.id);

Store.updateItem('b', i1.id, { text: '  renamed  ' });
check('item text trimmed on edit',   Store.byId('b').items[0].text, 'renamed');
Store.deleteItem('b', i1.id);
check('item removed',                Store.checklistOf('b').total, 1);

/* Old files stored these as `resources` with a label, and notes as `notes`. */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'legacy', parentId: null, name: 'Legacy', notes: 'old note',
            resources: [{ label: 'A book', url: 'https://example.com' }] }],
}));
check('notes migrate to description', Store.byId('legacy').description, 'old note');
check('resources migrate to items',   Store.byId('legacy').items.length, 1);
check('the label becomes the text',   Store.byId('legacy').items[0].text, 'A book');
check('the url is kept',              Store.byId('legacy').items[0].url, 'https://example.com');
check('migrated items start unticked', Store.byId('legacy').items[0].done, false);

/* --- solved problems --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'algos', parentId: null, name: 'Algorithms' },
    { id: 'dp',    parentId: 'algos', name: 'Dynamic Programming' },
    { id: 'graphs',parentId: 'algos', name: 'Graphs' },
  ],
}));

Store.recordSolve({ source: 'codeforces', problemId: '1234A', title: 'Cool Problem',
                    tags: ['dp', 'greedy'], difficulty: 1600, solvedAt: '2026-05-01', minutes: 25 });
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum',
                    tags: ['array'], solvedAt: '2026-05-02' });
check('solves recorded',             Store.problemsMatching().length, 2);
check('tags are normalised',         Store.problemsMatching()[0].tags, ['dp', 'greedy']);

/* The same solve arriving twice is one solve, however it is spelled. */
const again = Store.recordSolve({ source: 'codeforces', problemId: '1234a', title: 'Cool Problem',
                                  tags: ['implementation'], solvedAt: '2026-04-28' });
check('a repeat solve is not duplicated', Store.problemsMatching().length, 2);
check('it is reported as an update',  again.created, false);
check('new tags are folded in',       Store.problemsMatching()[0].tags.includes('implementation'), true);
check('the earliest solve date wins', Store.problemsMatching()[0].solvedAt, '2026-04-28');

check('filter by source',            Store.problemsMatching({ source: 'leetcode' }).length, 1);
check('filter by tag',               Store.problemsMatching({ tag: 'dp' }).length, 1);

const bulk = Store.recordSolves([
  { source: 'codeforces', problemId: '99B', title: 'Another', tags: ['graphs'], solvedAt: '2026-05-03' },
  { source: 'codeforces', problemId: '1234A', title: 'Cool Problem', tags: [], solvedAt: '2026-05-01' },
]);
check('bulk import counts new and known', bulk, { added: 1, updated: 1 });

/* Tags only become evidence about a topic once they are mapped onto it. */
check('unmapped tags point nowhere',  Store.nodeForTags(['dp']), null);
Store.setTagMapping('dp', 'dp');
Store.setTagMapping('graphs', 'graphs');
check('a mapped tag resolves',        Store.nodeForTags(['dp']), 'dp');
check('problems count towards a topic', Store.problemsForNode('dp').length, 1);
check('a parent counts the whole branch', Store.problemsForNode('algos').length, 2);
check('the tag index reports counts',
      Store.tagIndex().find(t => t.tag === 'dp'), { tag: 'dp', count: 1, nodeId: 'dp' });
Store.setTagMapping('dp', null);
check('a mapping can be cleared',     Store.nodeForTags(['dp']), null);
Store.setTagMapping('dp', 'dp');

const pstats = Store.problemStats();
check('stats count solves',           pstats.total, 3);
check('stats find the hardest rating', pstats.hardest, 1600);
check('stats count what is unmapped', pstats.unmapped, 1);

/* A target turns solves into progress. */
check('no target means no effect',    Store.progressOf('dp'), 0);
Store.updateNode('dp', { problemTarget: 4 });
check('one of four solved',           Store.progressOf('dp'), 0.25);
Store.updateNode('dp', { problemTarget: 1 });
check('a met target does not exceed 1', Store.progressOf('dp'), 1);

/* A mapping to a deleted topic is dropped rather than left dangling. */
Store.importJSON(Store.toJSON());
Store.deleteNode('dp');
Store.importJSON(Store.toJSON());
check('mapping to a deleted topic dropped', Store.nodeForTags(['dp']), null);

/* --- job applications are always private --- */
Store.importJSON(JSON.stringify({ nodes: [{ id: 'pub', parentId: null, name: 'Public' }] }));
const app = Store.addApplication({ company: 'Example Corp', role: 'SWE Intern', stage: 'applied' });
check('application added',           Store.applications().length, 1);
check('it starts with a timeline',   app.events.length, 1);
check('a company name is required',  Store.addApplication({ company: '  ' }), null);

Store.updateApplication(app.id, { stage: 'interview' });
check('stage change is recorded',    Store.applications()[0].events.length, 2);
check('the new stage is current',    Store.applications()[0].stage, 'interview');

Store.addApplicationEvent(app.id, { date: '2026-06-01', stage: 'offer', note: 'verbal' });
check('events can be added by hand', Store.applications()[0].events.length, 3);
check('events stay in date order',
      Store.applications()[0].events.every((e, i, a) => i === 0 || a[i - 1].date <= e.date), true);

const astats = Store.applicationStats();
check('stats count open applications', astats.open, 1);
check('stats count interviews',       astats.interviews, 1);

/* The guarantee that matters: nothing about an application in the public file. */
check('nothing public marked private', Store.privateNodeIds().size, 0);
check('applications never reach the public snapshot',
      JSON.parse(Store.toJSON()).applications, undefined);
check('the public file mentions no company',
      /Example Corp/.test(Store.toJSON()), false);
check('they are in the private file',
      JSON.parse(Store.toPrivateJSON()).applications.length, 1);
check('holding an application counts as private data', Store.hasPrivateData(), true);

Store.deleteApplication(app.id);
check('application deleted',         Store.applications().length, 0);

/* --- private branches stay out of the public snapshot --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'pub',   parentId: null,  name: 'Learning' },
    { id: 'pubk',  parentId: 'pub', name: 'A topic' },
    { id: 'apps',  parentId: null,  name: 'Applications', private: true },
    { id: 'appk',  parentId: 'apps', name: 'Some company' },
  ],
  sessions: [
    { id: 's-pub', nodeId: 'pubk', date: '2026-05-01', minutes: 30 },
    { id: 's-app', nodeId: 'appk', date: '2026-05-01', minutes: 15 },
  ],
  focus: [
    { id: 'f-pub',  date: '2026-05-01', text: 'study', nodeId: 'pubk' },
    { id: 'f-app',  date: '2026-05-01', text: 'follow up', nodeId: 'appk' },
    { id: 'f-none', date: '2026-05-01', text: 'unlinked task' },
  ],
}));
check('a marked node is private',       Store.isPrivate('apps'), true);
check('privacy is inherited by children', Store.isPrivate('appk'), true);
check('public branches stay public',    Store.isPrivate('pubk'), false);
check('the tracker knows it holds private data', Store.hasPrivateData(), true);

const pub = JSON.parse(Store.toJSON());
check('public export drops private nodes', pub.nodes.map(n => n.id), ['pub', 'pubk']);
check('public export drops their sessions', pub.sessions.map(x => x.id), ['s-pub']);
check('public export drops their tasks',    pub.focus.map(x => x.id), ['f-pub', 'f-none']);

const secret = JSON.parse(Store.toPrivateJSON());
check('private export keeps only private nodes', secret.nodes.map(n => n.id), ['apps', 'appk']);
check('private export carries their sessions',   secret.sessions.map(x => x.id), ['s-app']);
check('private export carries their tasks',      secret.focus.map(x => x.id), ['f-app']);
check('the two halves account for every node',
      pub.nodes.length + secret.nodes.length, 4);

/* Loading the public file then merging the private one restores everything. */
Store.importJSON(JSON.stringify(pub));
check('public-only load',            Store.state.nodes.length, 2);
check('merge reports what it added', Store.mergeJSON(JSON.stringify(secret)), 2);
check('everything is back',          Store.state.nodes.length, 4);
check('sessions came with it',       Store.state.sessions.length, 2);
check('merging again adds nothing',  Store.mergeJSON(JSON.stringify(secret)), 0);
check('and does not duplicate time', Store.state.sessions.length, 2);
check('nor duplicate tasks',         Store.state.focus.length, 3);

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

/* --- a mis-clicked stage must leave no trace in the tallies --- */
Store.importJSON(JSON.stringify({ nodes: [{ id: 'n', parentId: null, name: 'N' }] }));
const mis = Store.addApplication({ company: 'Mistake Ltd', stage: 'applied' });
check('starts with no interview',      Store.applicationStats().interviews, 0);

Store.updateApplication(mis.id, { stage: 'interview' });
check('an interview counts',           Store.applicationStats().interviews, 1);

/* Putting it straight back must undo it, not record that it ever happened. */
Store.updateApplication(mis.id, { stage: 'applied' });
check('correcting it undoes the tally', Store.applicationStats().interviews, 0);
check('and leaves no stray event',      Store.applications()[0].events.length, 1);

/* A genuine progression, corrected later, still leaves the real history. */
Store.updateApplication(mis.id, { stage: 'screen' });
Store.addApplicationEvent(mis.id, { date: Store.todayISO(), stage: 'interview', note: 'phone screen went well' });
check('a hand-written event is kept',   Store.applications()[0].events.length, 3);
Store.updateApplication(mis.id, { stage: 'rejected' });
check('an annotated interview still counts', Store.applicationStats().interviews, 1);
check('rejection recorded',             Store.applications()[0].stage, 'rejected');

/* Deleting the event that claimed it removes the claim. */
const interviewEvent = Store.applications()[0].events.find(e => e.stage === 'interview');
Store.deleteApplicationEvent(mis.id, interviewEvent.id);
check('removing the event removes the tally', Store.applicationStats().interviews, 0);

/* --- reading a posting URL, without asking the network anything --- */
check('greenhouse',  Store.parsePosting('https://boards.greenhouse.io/stripe/jobs/12345'),
      { company: 'Stripe', source: 'Greenhouse', domain: 'boards.greenhouse.io' });
check('greenhouse job-boards host', Store.parsePosting('https://job-boards.greenhouse.io/acme/jobs/9').source, 'Greenhouse');
check('lever',       Store.parsePosting('https://jobs.lever.co/two-sigma/abc').company, 'Two Sigma');
check('workday',     Store.parsePosting('https://acme.wd3.myworkdayjobs.com/en-US/careers/job/x'),
      { company: 'Acme', source: 'Workday', domain: 'acme.wd3.myworkdayjobs.com' });
check('ashby',       Store.parsePosting('https://jobs.ashbyhq.com/openai/123').source, 'Ashby');
check('linkedin has no company in the url',
      Store.parsePosting('https://www.linkedin.com/jobs/view/4012').source, 'LinkedIn');
check('a company site',  Store.parsePosting('https://careers.google.com/jobs/results/1').company, 'Google');
check('a bare domain works too', Store.parsePosting('jane-street.com/join/1').company, 'Jane Street');
check('nonsense is refused',  Store.parsePosting('not a url at all'), null);
check('nothing is refused',   Store.parsePosting(''), null);

/* --- a broken parent link re-roots instead of vanishing --- */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'orphan', parentId: 'does-not-exist', name: 'Orphan' }],
  sessions: [{ id: 'x', nodeId: 'ghost', date: '2026-01-01', minutes: 10 }],
}));
check('missing parent re-roots',     Store.roots().map(r => r.id), ['orphan']);
check('session for a missing node dropped', Store.state.sessions.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
