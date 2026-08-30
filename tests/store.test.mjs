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

/* Everything one source brought in can be cleared in one go. */
Store.recordSolve({ source: 'leetcode', problemId: 'lc-1', title: 'LC One' });
Store.recordSolve({ source: 'leetcode', problemId: 'lc-2', title: 'LC Two' });
const cfBefore = Store.problemsMatching({ source: 'codeforces' }).length;
const lcCount = Store.problemsMatching({ source: 'leetcode' }).length;
check('removing a source reports the count', Store.deleteProblemsFrom('leetcode'), lcCount);
check('that source is empty',       Store.problemsMatching({ source: 'leetcode' }).length, 0);
check('other sources are untouched', Store.problemsMatching({ source: 'codeforces' }).length, cfBefore);
check('removing nothing is harmless', Store.deleteProblemsFrom('leetcode'), 0);

/* Banded levels and numeric ratings are different claims. */
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum',
                    tags: ['array'], level: 'easy', solvedAt: '2026-05-04' });
check('a level is kept',             Store.problemsMatching({ source: 'leetcode' })[0].level, 'easy');
check('and carries no fake rating',  Store.problemsMatching({ source: 'leetcode' })[0].difficulty, null);
check('an invalid level is dropped',
      Store.addProblem({ source: 'other', title: 'X', level: 'impossible' }).level, null);
check('levels are counted',          Store.problemStats().levels.easy, 1);
Store.deleteProblem(Store.problemsMatching({ source: 'other' })[0].id);

/* A solve seen again can gain a level it did not have. */
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum', level: 'medium' });
check('an existing level is not overwritten',
      Store.problemsMatching({ source: 'leetcode' })[0].level, 'easy');

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

/* --- the review cycle: what beat you is what is worth returning to --- */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'll', parentId: null, name: 'Linked Lists' }],
  tagMap: { 'linked list': 'll' },
}));

const solved = Store.recordSolve({ source: 'leetcode', problemId: 'reverse-linked-list',
  title: 'Reverse Linked List', tags: ['linked list'], level: 'easy',
  solvedAt: Store.shiftDays(Store.todayISO(), -18) }).problem;

check('a solve starts as solved',      solved.state, 'solved');
check('help is unrecorded until said', solved.independence, null);
check('nothing to revisit yet',        Store.problemsToRevisit().length, 0);

Store.updateProblem(solved.id, { independence: 'hint', attempts: 3, mistake: 'off-by-one',
                                 lesson: 'check the tail pointer' });
check('help recorded',   Store.problemsMatching()[0].independence, 'hint');
check('attempts kept',   Store.problemsMatching()[0].attempts, 3);
check('the mistake is kept', Store.problemsMatching()[0].mistake, 'off-by-one');

/* Booking a revisit puts it in the queue and flags the state. */
Store.scheduleReview(solved.id, 7);
check('a review moves it to needs-review', Store.problemsMatching()[0].state, 'review');
check('the date is set',                   Store.problemsMatching()[0].reviewOn,
                                           Store.shiftDays(Store.todayISO(), 7));
/* Booked for next week is due next week, not today. */
check('it waits for its date',             Store.problemsToRevisit().length, 0);
Store.updateProblem(solved.id, { reviewOn: Store.shiftDays(Store.todayISO(), -1) });
check('and is listed once it arrives',     Store.problemsToRevisit().length, 1);

Store.markRevisited(solved.id, { independent: true });
check('re-solving clears the queue',   Store.problemsToRevisit().length, 0);
check('and records it as re-solved',   Store.problemsMatching()[0].state, 'resolved');
Store.markRevisited(solved.id, { independent: true });
check('doing it again is mastery',     Store.problemsMatching()[0].state, 'mastered');
check('mastered never returns to the queue', Store.problemsToRevisit().length, 0);

/* A date that has come round surfaces on its own. */
const due = Store.addProblem({ source: 'other', title: 'Old One', tags: ['linked list'] });
Store.updateProblem(due.id, { reviewOn: Store.shiftDays(Store.todayISO(), -1) });
check('an overdue review surfaces', Store.problemsToRevisit().map(p => p.id), [due.id]);

/* --- evidence, and the status it would support --- */
['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((id, i) => Store.recordSolve({
  source: 'leetcode', problemId: 'p-' + id, title: 'Problem ' + id,
  tags: ['linked list'], level: i < 3 ? 'medium' : 'easy',
  independence: 'independent', solvedAt: Store.todayISO(),
}));
const ev = Store.evidenceFor('ll');
check('evidence counts the solves', ev.solved >= 8, true);
check('it counts independent ones', ev.independent, 7);
check('and reports the rate',       Math.round(ev.independenceRate * 100), 88);
check('levels are broken down',     ev.byLevel.medium, 3);
check('recent solves are listed',   ev.recent.length, 5);

const suggestion = Store.suggestedStatus('ll');
check('the evidence suggests a status', suggestion.status, 'proficient');
check('and says why',                   /without help/.test(suggestion.because), true);
Store.updateNode('ll', { status: 'mastered' });
check('it never suggests going backwards', Store.suggestedStatus('ll'), null);

/* --- typed references and prerequisites --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'conc', parentId: null, name: 'Concurrency', status: 'learning' },
    { id: 'proc', parentId: null, name: 'Processes', status: 'planned' },
    { id: 'thr',  parentId: null, name: 'Threads', status: 'practicing' },
  ],
}));
check('a link defaults to relates', Store.addLink('conc', 'thr').type, 'relates');
check('a link can be typed',        Store.addLink('conc', 'proc', '', 'requires').type, 'requires');
check('re-adding retypes it',       Store.addLink('conc', 'thr', '', 'extends').type, 'extends');
check('an unknown type falls back', Store.addLink('thr', 'proc', '', 'nonsense').type, 'relates');

const warnings = Store.prerequisiteWarnings();
check('an unmet prerequisite is flagged', warnings.length, 1);
check('it names the topic',   warnings[0].topic.id, 'conc');
check('and what is missing',  warnings[0].needed.id, 'proc');
Store.updateNode('proc', { status: 'learning' });
check('starting it clears the warning', Store.prerequisiteWarnings().length, 0);

/* --- journal and Obsidian --- */
const entry = Store.addEntry('conc', '  finally understood happens-before  ');
check('an entry is trimmed',      entry.text, 'finally understood happens-before');
check('it is filed under today',  entry.date, Store.todayISO());

/* A note written just after local midnight belongs to that local day, not to
   the previous one its UTC timestamp falls in. */
check('a UTC timestamp is read locally',
      Store.localDateOf('2026-04-10T23:30:00.000Z'),
      (() => { const d = new Date('2026-04-10T23:30:00.000Z');
               const pad = n => String(n).padStart(2, '0');
               return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })());
check('it is stamped with a time', typeof entry.at, 'string');
check('blank entries are refused', Store.addEntry('conc', '   '), null);
check('an entry for a missing topic is refused', Store.addEntry('nope', 'text'), null);
check('entries are listed',       Store.journalFor('conc').length, 1);
Store.updateEntry(entry.id, 'revised wording');
check('an entry can be edited',   Store.journalFor('conc')[0].text, 'revised wording');
Store.deleteEntry(entry.id);
check('and removed',              Store.journalFor('conc').length, 0);

Store.updateNode('conc', { obsidian: 'My Vault/CS/Concurrency' });
check('an obsidian link is built',
      Store.obsidianUrl(Store.byId('conc')),
      'obsidian://open?vault=My%20Vault&file=CS%2FConcurrency');
Store.updateNode('conc', { obsidian: 'Just A Note' });
check('a bare note opens in the current vault',
      Store.obsidianUrl(Store.byId('conc')), 'obsidian://open?file=Just%20A%20Note');
check('no note, no link', Store.obsidianUrl(Store.byId('proc')), '');

/* Entries written before the local-date field existed are converted from
   their timestamp rather than left to fall on the wrong day. */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'x', parentId: null, name: 'X' }],
  journal: [{ id: 'j', nodeId: 'x', at: '2026-04-10T23:30:00.000Z', text: 'old' }],
}));
check('an older entry is given a local date',
      Store.journalFor('x')[0].date, Store.localDateOf('2026-04-10T23:30:00.000Z'));
check('and it lands on that day',
      Store.activityOn(Store.localDateOf('2026-04-10T23:30:00.000Z')).notes.length, 1);

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

/* --- goals: a few concrete things, by a date --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'cpp', parentId: null, name: 'C++', status: 'learning' },
    { id: 'gdb', parentId: 'cpp', name: 'gdb', status: 'planned',
      items: [{ id: 'i1', text: 'breakpoints', done: true }, { id: 'i2', text: 'watchpoints', done: false }] },
  ],
  tagMap: { cpp: 'cpp' },
}));

const goal = Store.addGoal({ name: 'Comfortable with modern C++', targetDate: Store.shiftDays(Store.todayISO(), 38) });
check('a goal needs a name',        Store.addGoal({ name: '  ' }), null);
check('goal created',               Store.goals().length, 1);
check('days remaining counted',     Store.daysRemaining(goal), 38);
check('an empty goal is at zero',   Store.goalProgress(goal), { ratio: 0, done: 0, total: 0 });

/* Parts the tracker can answer are answered by it. */
const manual = Store.addGoalPart(goal.id, { kind: 'manual', text: 'Build one C++ project' });
Store.addGoalPart(goal.id, { kind: 'status', nodeId: 'cpp', status: 'proficient', text: 'C++ proficient' });
Store.addGoalPart(goal.id, { kind: 'checklist', nodeId: 'gdb', text: 'Learn gdb' });
Store.addGoalPart(goal.id, { kind: 'problems', nodeId: 'cpp', amount: 4, text: '4 problems' });
check('parts added', Store.goals()[0].parts.length, 4);

check('a manual part starts unticked', Store.partProgress(Store.goals()[0].parts[0]), 0);
check('a status part is not met yet',  Store.partProgress(Store.goals()[0].parts[1]), 0);
check('a checklist part is half done', Store.partProgress(Store.goals()[0].parts[2]), 0.5);
check('a problems part has nothing yet', Store.partProgress(Store.goals()[0].parts[3]), 0);

Store.toggleGoalPart(goal.id, manual.id);
check('ticking a manual part counts', Store.partProgress(Store.goals()[0].parts[0]), 1);

/* Real work moves the goal without anyone updating the goal. */
Store.updateNode('cpp', { status: 'proficient' });
check('reaching the status completes that part', Store.partProgress(Store.goals()[0].parts[1]), 1);
Store.recordSolve({ source: 'other', problemId: 'g1', title: 'One', tags: ['cpp'], solvedAt: Store.todayISO() });
Store.recordSolve({ source: 'other', problemId: 'g2', title: 'Two', tags: ['cpp'], solvedAt: Store.todayISO() });
check('solves feed the problems part', Store.partProgress(Store.goals()[0].parts[3]), 0.5);

const progress = Store.goalProgress(Store.goals()[0]);
check('the goal averages its parts', Math.round(progress.ratio * 100), 75);
check('and counts finished parts',   progress.done, 2);

Store.deleteGoalPart(goal.id, manual.id);
check('a part can be removed', Store.goals()[0].parts.length, 3);

/* A part pointing at a deleted topic becomes an ordinary checkbox. */
Store.deleteNode('gdb');
Store.importJSON(Store.toJSON());
const orphaned = Store.goals()[0].parts.find(p => p.text === 'Learn gdb');
check('an orphaned part survives',  !!orphaned, true);
check('and becomes manual',         orphaned.kind, 'manual');

Store.deleteGoal(goal.id);
check('a goal can be deleted', Store.goals().length, 0);

/* --- projects: what you have actually built --- */
const project = Store.addProject({ name: 'Order Book', repo: 'https://github.com/me/order-book' });
check('a project needs a name',  Store.addProject({ name: '' }), null);
check('project created',         Store.projects().length, 1);
check('no milestones, no progress', Store.projectProgress(project).ratio, 0);

Store.addMilestone(project.id, 'Matching engine');
const orderTypes = Store.addMilestone(project.id, 'Order types');
check('milestones added',        Store.projects()[0].milestones.length, 2);
check('a blank milestone is refused', Store.addMilestone(project.id, '  '), null);
Store.toggleMilestone(project.id, orderTypes.id);
check('progress follows milestones', Store.projectProgress(Store.projects()[0]).ratio, 0.5);
Store.deleteMilestone(project.id, orderTypes.id);
check('a milestone can be removed', Store.projects()[0].milestones.length, 1);

/* The point of the section: evidence that a concept was used. */
Store.linkConcept(project.id, 'cpp', 'the whole engine is C++');
check('a concept is linked',     Store.projects()[0].concepts.length, 1);
check('with its evidence',       Store.projects()[0].concepts[0].evidence, 'the whole engine is C++');
Store.linkConcept(project.id, 'cpp', 'revised wording');
check('re-linking updates rather than duplicates',
      [Store.projects()[0].concepts.length, Store.projects()[0].concepts[0].evidence],
      [1, 'revised wording']);
check('a concept for a missing topic is refused', Store.linkConcept(project.id, 'nope', 'x'), null);

const using = Store.projectsUsing('cpp');
check('the topic knows where it was used', using.length, 1);
check('and what was said about it',        using[0].evidence, ['revised wording']);
check('an unrelated topic has none',       Store.projectsUsing('nope').length, 0);

Store.unlinkConcept(project.id, 'cpp');
check('a concept can be unlinked', Store.projectsUsing('cpp').length, 0);

/* A private project stays out of the public snapshot. */
Store.updateProject(project.id, { private: true });
check('a private project is not published',
      JSON.parse(Store.toJSON()).projects.length, 0);
check('and is in the private file',
      JSON.parse(Store.toPrivateJSON()).projects.length, 1);
check('holding one counts as private data', Store.hasPrivateData(), true);
Store.updateProject(project.id, { private: false });
check('a public project is published', JSON.parse(Store.toJSON()).projects.length, 1);

/* Goals are always public: they describe learning, not people. */
Store.addGoal({ name: 'Public goal' });
check('goals are never private', JSON.parse(Store.toJSON()).goals.length, 1);
check('and absent from the private file entirely',
      JSON.parse(Store.toPrivateJSON()).goals, undefined);

/* --- activity: what a day actually held --- */
const busyDay = '2026-04-10';
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'git', parentId: null, name: 'Git' }],
  sessions: [{ id: 's1', nodeId: 'git', date: busyDay, minutes: 40, note: 'reset and reflog' }],
  focus: [
    { id: 'f1', date: busyDay, text: 'Learn git reset', done: true, nodeId: 'git' },
    { id: 'f2', date: busyDay, text: 'Unfinished thing', done: false },
  ],
  problems: [{ id: 'p1', source: 'leetcode', problemId: 'reverse-linked-list',
               title: 'Reverse Linked List', solvedAt: busyDay }],
  journal: [{ id: 'j1', nodeId: 'git', date: busyDay, at: busyDay + 'T18:20:00.000Z', text: 'reflog saved me' }],
  applications: [{ id: 'a1', company: 'Example', stage: 'applied',
                   events: [{ id: 'e1', date: busyDay, stage: 'applied' }] }],
}));

const act = Store.activityOn(busyDay);
check('study time counted',        act.minutes, 40);
check('sessions listed',           act.sessions.length, 1);
check('only completed tasks count', act.doneTasks.length, 1);
check('but all are available',     act.tasks.length, 2);
check('solves listed',             act.solves.length, 1);
check('notes listed',              act.notes.length, 1);
check('application events listed', act.applications.length, 1);

/* One unit per thing done, with time counted once so a long day is not
   flattened into a single square. */
check('units add up',              act.units, 5);
check('a busy day shades strongly',  Store.activityLevel(act), 3);
/* Long study pushes it further, so a day of nothing but hours still shows. */
check('hours deepen the shade',
      Store.activityLevel({ units: 5, minutes: 180 }), 4);
check('the scale tops out',
      Store.activityLevel({ units: 40, minutes: 600 }), 4);

const quiet = Store.activityOn('2026-04-11');
check('an empty day has nothing',  quiet.units, 0);
check('and no shade',              Store.activityLevel(quiet), 0);

/* Time alone still registers. */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'N' }],
  sessions: [{ id: 's1', nodeId: 'n', date: busyDay, minutes: 20 }],
}));
check('study alone counts as a unit', Store.activityOn(busyDay).units, 1);
check('and shades the square',        Store.activityLevel(Store.activityOn(busyDay)), 1);

/* --- applications as flows, not just counts --- */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'N' }],
  applications: [
    { id: 'a1', company: 'One', stage: 'rejected', events: [
      { id: 'e1', date: '2026-01-01', stage: 'applied' },
      { id: 'e2', date: '2026-01-10', stage: 'interview' },
      { id: 'e3', date: '2026-01-20', stage: 'rejected' }] },
    { id: 'a2', company: 'Two', stage: 'offer', events: [
      { id: 'e4', date: '2026-01-02', stage: 'applied' },
      { id: 'e5', date: '2026-01-12', stage: 'interview' },
      { id: 'e6', date: '2026-01-22', stage: 'offer' }] },
    { id: 'a3', company: 'Three', stage: 'applied', events: [
      { id: 'e7', date: '2026-01-03', stage: 'applied' }] },
  ],
}));

const flow = Store.applicationFlow();
check('every application counted',   flow.total, 3);
check('only reached stages appear',  flow.stages.map(s => s.id), ['applied', 'interview', 'offer', 'rejected']);
check('applied counts all three',    flow.stages.find(s => s.id === 'applied').count, 3);
check('interview counts two',        flow.stages.find(s => s.id === 'interview').count, 2);

check('the common path is widest',   flow.flows[0], { from: 'applied', to: 'interview', count: 2 });
check('outcomes are separate flows',
      flow.flows.filter(f => f.from === 'interview').map(f => f.to).sort(), ['offer', 'rejected']);
check('an application that never moved adds no flow',
      flow.flows.some(f => f.from === 'applied' && f.to === 'applied'), false);

/* Stages are ordered by the pipeline, not by when events were written. */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'N' }],
  applications: [{ id: 'a', company: 'Backwards', stage: 'offer', events: [
    { id: 'e1', date: '2026-02-03', stage: 'offer' },
    { id: 'e2', date: '2026-02-01', stage: 'applied' }] }],
}));
check('a path follows the pipeline order',
      Store.applicationFlow().flows, [{ from: 'applied', to: 'offer', count: 1 }]);

/* A stage set by hand that sits earlier than the events must not draw a
   ribbon running backwards through the pipeline. */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'N' }],
  applications: [{ id: 'a', company: 'Reverted', stage: 'applied', events: [
    { id: 'e1', date: '2026-02-01', stage: 'interview' }] }],
}));
check('a path never runs backwards',
      Store.applicationFlow().flows, [{ from: 'applied', to: 'interview', count: 1 }]);

check('no applications, no chart', (() => {
  Store.importJSON(JSON.stringify({ nodes: [{ id: 'n', parentId: null, name: 'N' }] }));
  const empty = Store.applicationFlow();
  return [empty.total, empty.stages.length, empty.flows.length];
})(), [0, 0, 0]);

/* --- the digest the extension reads, and the actions it can send back --- */
Store.importJSON(JSON.stringify({ nodes: [{ id: 'n', parentId: null, name: 'N' }] }));
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum',
  tags: ['array'], level: 'easy', independence: 'hint', solvedAt: '2026-03-01' });
Store.updateProblem(Store.problemsMatching()[0].id, { mistake: 'off-by-one', lesson: 'sort first', attempts: 3 });

const digest = Store.problemDigest();
check('every solve is offered',      digest.length, 1);
check('keyed by source and id',      [digest[0].source, digest[0].problemId], ['leetcode', 'two-sum']);
check('carrying how it went',        digest[0].independence, 'hint');
check('and what went wrong',         [digest[0].mistake, digest[0].lesson], ['off-by-one', 'sort first']);
check('and the attempts',            digest[0].attempts, 3);
/* Only what a panel would show: no tags, no free notes. */
check('nothing else is shared',      Object.keys(digest[0]).sort(),
      ['attempts', 'independence', 'lesson', 'level', 'mistake', 'problemId', 'reviewOn',
       'solvedAt', 'source', 'state', 'title']);

/* A page can book a revisit while handing the solve over. */
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum', reviewInDays: 7 });
check('a revisit can be booked from a page', Store.problemsMatching()[0].reviewOn,
      Store.shiftDays(Store.todayISO(), 7));
check('and it enters the queue',     Store.problemsMatching()[0].state, 'review');
check('but waits for its date',      Store.problemsToRevisit().length, 0);

/* And say it was solved again. */
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum', revisit: true });
check('a re-solve is recorded',      Store.problemsMatching()[0].state, 'resolved');
check('clearing the booking',        Store.problemsMatching()[0].reviewOn, '');
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum', revisit: true });
check('doing it twice is mastery',   Store.problemsMatching()[0].state, 'mastered');

/* Saying how it went later replaces the earlier claim. */
Store.recordSolve({ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum', independence: 'independent' });
check('the newer claim about help wins', Store.problemsMatching()[0].independence, 'independent');
check('still only one solve',        Store.problemsMatching().length, 1);

/* A brand new problem arriving with actions attached. */
Store.recordSolve({ source: 'codeforces', problemId: '1234A', title: 'New One',
                    independence: 'solution', reviewInDays: 3 });
const fresh = Store.problemsMatching({ source: 'codeforces' })[0];
check('a new solve takes its actions too', [fresh.state, fresh.independence], ['review', 'solution']);

/* --- regressions from the review: a booked revisit is due on its date --- */
Store.importJSON(JSON.stringify({ nodes: [{ id: 'n', parentId: null, name: 'N' }] }));
const rv = Store.recordSolve({ source: 'other', problemId: 'rv', title: 'RV' }).problem;

Store.scheduleReview(rv.id, 30);
check('booking flags it',            Store.problemsMatching()[0].state, 'review');
check('but it is not due today',     Store.problemsToRevisit().length, 0);

Store.scheduleReview(rv.id, 0);
check('un-booking clears the date',  Store.problemsMatching()[0].reviewOn, '');
check('and the flag with it',        Store.problemsMatching()[0].state, 'solved');
check('so it leaves the queue',      Store.problemsToRevisit().length, 0);

/* Flagged with no date means it is wanted now. */
Store.updateProblem(rv.id, { state: 'review' });
check('flagged without a date is due', Store.problemsToRevisit().length, 1);
Store.updateProblem(rv.id, { state: 'review', reviewOn: Store.shiftDays(Store.todayISO(), -1) });
check('and an overdue date is due too', Store.problemsToRevisit().length, 1);

/* --- deleting a topic takes everything that named it --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'field', parentId: null, name: 'Field', private: true },
    { id: 'kid',   parentId: 'field', name: 'Kid' },
    { id: 'other', parentId: null, name: 'Other' },
  ],
  tagMap: { dp: 'kid' },
}));
Store.addEntry('kid', 'a private thought');
Store.addLink('other', 'kid', '', 'requires');
Store.recordSolve({ source: 'other', problemId: 'q', title: 'Q', nodeId: 'kid' });
const proj = Store.addProject({ name: 'Thing' });
Store.linkConcept(proj.id, 'kid', 'used here');
const gl = Store.addGoal({ name: 'Goal' });
Store.addGoalPart(gl.id, { kind: 'status', nodeId: 'kid', status: 'proficient', text: 'Kid proficient' });

Store.deleteNode('kid');
check('its notes go with it',         Store.state.journal.length, 0);
check('references to it go too',      Store.state.links.length, 0);
check('tag mappings are cleared',     Store.nodeForTags(['dp']), null);
check('project concepts are dropped', Store.projects()[0].concepts.length, 0);
check('a goal part becomes manual',   Store.goals()[0].parts[0].kind, 'manual');
check('the solve survives, unlinked', [Store.problemsMatching().length, Store.problemsMatching()[0].nodeId], [1, null]);

/* The reason it matters: an orphaned note used to be published. */
check('nothing of it reaches the public snapshot',
      /private thought/.test(Store.toJSON()), false);

/* An entry with no topic at all is never treated as publishable. */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'a', parentId: null, name: 'A' }],
  journal: [{ id: 'j', nodeId: 'ghost', at: '2026-01-01T00:00:00.000Z', text: 'orphan' }],
}));
check('an orphaned entry is dropped on load', Store.state.journal.length, 0);

/* --- a public project must not name a private topic --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'pub',  parentId: null, name: 'Public' },
    { id: 'hush', parentId: null, name: 'Hush', private: true },
  ],
}));
const mixed = Store.addProject({ name: 'Mixed' });
Store.linkConcept(mixed.id, 'pub', 'openly');
Store.linkConcept(mixed.id, 'hush', 'quietly');
const published = JSON.parse(Store.toJSON()).projects[0];
check('the public project is published',   published.name, 'Mixed');
check('but not its private concept',       published.concepts.map(c => c.nodeId), ['pub']);
check('the private half keeps everything',
      JSON.parse(Store.toPrivateJSON()).projects.length, 0);

/* --- a goal part measured by a number needs one --- */
const g2 = Store.addGoal({ name: 'Counting' });
check('problems with no amount refused',  Store.addGoalPart(g2.id, { kind: 'problems', nodeId: 'pub' }), null);
check('hours with no amount refused',     Store.addGoalPart(g2.id, { kind: 'sessions', nodeId: 'pub' }), null);
check('an automatic part needs a topic',  Store.addGoalPart(g2.id, { kind: 'status', text: 'x' }), null);
check('with an amount it is accepted',
      !!Store.addGoalPart(g2.id, { kind: 'problems', nodeId: 'pub', amount: 5 }), true);
check('a manual part needs neither',      !!Store.addGoalPart(g2.id, { kind: 'manual', text: 'do it' }), true);

/* --- a reference reads correctly from both ends --- */
check('every type has both readings',
      Store.LINK_TYPES.every(t => t.phrase && t.inverse), true);
check('requires reads back as required by',
      Store.LINK_TYPES.find(t => t.id === 'requires').inverse, 'is required by');
check('relates does not become "is relates to"',
      Store.LINK_TYPES.find(t => t.id === 'relates').inverse, 'relates to');

/* --- a broken parent link re-roots instead of vanishing --- */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'orphan', parentId: 'does-not-exist', name: 'Orphan' }],
  sessions: [{ id: 'x', nodeId: 'ghost', date: '2026-01-01', minutes: 10 }],
}));
check('missing parent re-roots',     Store.roots().map(r => r.id), ['orphan']);
check('session for a missing node dropped', Store.state.sessions.length, 0);

/* --- connections: a branch shown inside another tree --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'math',  parentId: null,   name: 'Maths' },
    { id: 'linalg', parentId: 'math', name: 'Linear algebra' },
    { id: 'decomp', parentId: 'linalg', name: 'Decompositions' },
    { id: 'ml',    parentId: null,   name: 'Machine learning' },
    { id: 'nets',  parentId: 'ml',   name: 'Neural nets' },
  ],
}));

check('nothing connected to begin with', Store.state.connections.length, 0);
check('linear algebra shows inside ML', !!Store.addConnection('linalg', 'ml'), true);
check('the connection is readable from the host',
      Store.connectedInto('ml').map(x => x.node.id), ['linalg']);
check('and from the branch that was lent',
      Store.connectionsFor('linalg').appearsIn.map(c => c.to), ['ml']);
check('the host sees what it brings in',
      Store.connectionsFor('ml').brings.map(c => c.from), ['linalg']);
check('the branch has not moved',       Store.byId('linalg').parentId, 'math');
check('and still belongs to its field',  Store.domainOf('linalg').id, 'math');

/* the loop rules */
check('a topic cannot be shown inside itself', Store.addConnection('ml', 'ml'), null);
check('nor inside its own sub-topic',          Store.addConnection('math', 'linalg'), null);
check('nor anywhere its branch already reaches',
      Store.addConnection('ml', 'decomp'), null);
/* The reverse is not a loop, only a pointless second card for one topic. */
check('a sub-topic is not brought into its own parent',
      Store.addConnection('decomp', 'linalg'), null);
check('nor into anything it already sits under',
      Store.addConnection('decomp', 'math'), null);
check('and that is what the form asks before offering a topic',
      [Store.canConnect('decomp', 'math'), Store.canConnect('nets', 'math')], [false, true]);
check('re-connecting the same pair does not double it',
      (Store.addConnection('linalg', 'ml'), Store.state.connections.length), 1);
check('an unrelated pair is still allowed',
      !!Store.addConnection('nets', 'decomp'), true);

/* re-parenting can close a loop the connection did not have when it was made */
Store.addNode({ parentId: null, name: 'Spare' });
const spare = Store.roots().find(n => n.name === 'Spare');
Store.addConnection('nets', spare.id);
check('connected before the move',
      Store.connectedInto(spare.id).map(x => x.node.id), ['nets']);
Store.updateNode(spare.id, { parentId: 'nets' });
check('moving the host inside the branch drops that connection',
      Store.connectedInto(spare.id).length, 0);
check('the other connections survive the move',
      Store.state.connections.map(c => c.from + '->' + c.to).sort(),
      ['linalg->ml', 'nets->decomp']);

/* deleting either end takes the connection with it */
Store.deleteNode('decomp');
check('deleting an end removes the connection',
      Store.state.connections.map(c => c.from + '->' + c.to), ['linalg->ml']);

/* a file carrying a loop loads as a tree with the bad connection missing */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'a', parentId: null, name: 'A' },
    { id: 'b', parentId: 'a',  name: 'B' },
    { id: 'c', parentId: null, name: 'C' },
  ],
  connections: [
    { id: 'k1', from: 'a', to: 'c' },
    { id: 'k2', from: 'c', to: 'b' },      // closes the loop: dropped
    { id: 'k3', from: 'a', to: 'gone' },   // an end that does not exist
    { id: 'k4', from: 'a', to: 'a' },      // itself
    { id: 'k5', from: 'a', to: 'c' },      // the same pair twice
  ],
}));
check('only the connections that hold up survive',
      Store.state.connections.map(c => c.id), ['k1']);

/* privacy: a connection naming a private branch is never published */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'open',  parentId: null, name: 'Open' },
    { id: 'quiet', parentId: null, name: 'Quiet', private: true },
    { id: 'other', parentId: null, name: 'Other' },
  ],
  connections: [
    { id: 'kp', from: 'quiet', to: 'open' },
    { id: 'ko', from: 'other', to: 'open' },
  ],
}));
check('the public snapshot keeps only the public connection',
      JSON.parse(Store.toJSON()).connections.map(c => c.id), ['ko']);
check('the private file keeps the private one',
      JSON.parse(Store.toPrivateJSON()).connections.map(c => c.id), ['kp']);
check('and the public snapshot never names the private branch',
      Store.toJSON().includes('quiet'), false);

/* merging the same file twice must not double the connections */
const twice = Store.toPrivateJSON();
Store.mergeJSON(twice);
Store.mergeJSON(twice);
check('merging is idempotent for connections', Store.state.connections.length, 2);

/* --- the candidate list must agree with the rule it stands in for --- */

/* connectableInto answers for every topic at once what canConnect answers for
   one, because asking per topic rebuilt the same adjacency n times over. The
   two are checked against each other on random shapes: a disagreement would
   mean the form offering a connection the store then refuses. */
{
  let rng = 4242;
  const rand = n => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n;
  let mismatches = 0, checked = 0;

  for (let trial = 0; trial < 40; trial++) {
    const size = 6 + rand(10);
    const shape = [];
    for (let i = 0; i < size; i++) {
      shape.push({ id: 'x' + i, name: 'T' + i,
                   parentId: i === 0 || rand(3) === 0 ? null : 'x' + rand(i) });
    }
    Store.importJSON(JSON.stringify({ nodes: shape }));
    for (let c = 0; c < 5; c++) Store.addConnection('x' + rand(size), 'x' + rand(size));

    const ids = Store.state.nodes.map(n => n.id);
    ids.forEach(host => {
      const offered = new Set(Store.connectableInto(host).map(n => n.id));
      ids.forEach(from => {
        checked++;
        if (Store.canConnect(from, host) !== offered.has(from)) mismatches++;
      });
    });
  }
  check('the offered list matches the rule on every pair', mismatches, 0);
  check('and the check was not vacuous', checked > 2000, true);
}

/* --- a branch is not brought into a tree it is already drawn in --- */

/* The loop rule alone let this through: connecting a branch into a tree and
   then into one of that tree's own sub-topics is not a loop, but it draws the
   same branch twice in one picture. */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'maths', parentId: null,    name: 'Maths' },
    { id: 'la',    parentId: 'maths', name: 'Linear algebra' },
    { id: 'svd',   parentId: 'la',    name: 'SVD' },
    { id: 'ml',    parentId: null,    name: 'Machine learning' },
    { id: 'nets',  parentId: 'ml',    name: 'Neural nets' },
    { id: 'other', parentId: null,    name: 'Something else' },
  ],
}));
check('a branch connects into another tree',      !!Store.addConnection('la', 'ml'), true);
check('but not a second time, deeper in it',      Store.addConnection('la', 'nets'), null);
check('nor does anything else it brought with it', Store.addConnection('svd', 'nets'), null);
check('the form does not offer them either',
      [Store.canConnect('la', 'nets'), Store.canConnect('svd', 'nets')], [false, false]);
check('a tree it is not in is still open to it',
      !!Store.addConnection('la', 'other'), true);
check('and so is the other direction of an unrelated pair',
      !!Store.addConnection('nets', 'svd'), true);

/* --- a move that breaks a connection says so --- */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'a', parentId: null, name: 'A' },
    { id: 'b', parentId: null, name: 'B' },
    { id: 'c', parentId: 'b',  name: 'C' },
  ],
}));
Store.addConnection('a', 'c');
check('connected before the move', Store.state.connections.length, 1);
Store.updateNode('b', { parentId: 'a' });
check('the move drops the connection it broke', Store.state.connections.length, 0);
check('and says how many it dropped',           Store.lastPrunedConnections, 1);
Store.updateNode('b', { parentId: null });
check('a move that breaks nothing reports nothing', Store.lastPrunedConnections, 0);

/* --- a save that fails is remembered, not swallowed --- */

/* Browsers cap localStorage at around 5MB, and a long solve history gets
   there. Logging the failure and carrying on means everything from that point
   is lost on the next reload with nothing on screen saying so. */
check('storage is fine to begin with', Store.storageBroken, false);

const realSetItem = sandbox.localStorage.setItem;
const realWarn = console.warn;
console.warn = () => {};
sandbox.localStorage.setItem = () => {
  const err = new Error('exceeded the quota');
  err.name = 'QuotaExceededError';
  throw err;
};
Store.addNode({ parentId: null, name: 'Past the wall' });
check('a failed save is remembered',        Store.storageBroken, true);
check('and the state can be measured',      Store.storedBytes() > 0, true);

sandbox.localStorage.setItem = realSetItem;
Store.addNode({ parentId: null, name: 'Room again' });
console.warn = realWarn;
check('and forgotten once saving works again', Store.storageBroken, false);

/* --- folders: shelves for fields, and nothing to do with the trees --- */

Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'analysis', parentId: null,       name: 'Analysis' },
    { id: 'seq',      parentId: 'analysis', name: 'Sequences' },
    { id: 'pure',     parentId: null,       name: 'Pure Maths' },
    { id: 'cpp',      parentId: null,       name: 'C++' },
  ],
}));
check('no folders to begin with', Store.folders().length, 0);

const maths = Store.addFolder('Mathematics');
check('a folder can be made',            !!maths.id, true);
check('filing a field on it works',      !!Store.setNodeFolder('analysis', maths.id), true);
check('and a second',                    !!Store.setNodeFolder('pure', maths.id), true);
check('the field has not moved in the tree', Store.byId('analysis').parentId, null);
check('it is still a field',             Store.roots().map(r => r.id), ['analysis', 'pure', 'cpp']);
check('and still has its own branch',    Store.childrenOf('analysis').map(n => n.id), ['seq']);

const grouped = Store.folderTree();
check('the folder knows what is on it',
      grouped.folders.map(g => [g.folder.name, g.fields.map(f => f.id)]),
      [['Mathematics', ['analysis', 'pure']]]);
check('and the rest are loose',          grouped.fields.map(f => f.id), ['cpp']);

/* a folder is for fields; a sub-topic already has a place */
check('a sub-topic cannot be filed',     Store.setNodeFolder('seq', maths.id), null);

/* Nor can a field keep a shelf once it stops being one: it would go on
   counting towards a folder that no longer lists it, which is how a folder
   that looks empty ends up judged by a topic that is not on it. */
check('a field on a shelf', Store.byId('pure').folderId, maths.id);
Store.updateNode('pure', { parentId: 'analysis' });
check('moving it under another topic takes it off',  Store.byId('pure').folderId, null);
check('and the folder no longer counts it',
      Store.folderTree().folders[0].fields.map(f => f.id), ['analysis']);
Store.updateNode('pure', { parentId: null });
check('bringing it back does not put it back on a shelf', Store.byId('pure').folderId, null);
Store.setNodeFolder('pure', maths.id);
check('nor can a field go on a folder that is not there',
      Store.setNodeFolder('cpp', 'no-such-folder'), null);

check('a folder can be renamed',         Store.renameFolder(maths.id, 'Maths').name, 'Maths');
check('an empty name is refused',        Store.renameFolder(maths.id, '   ').name, 'Maths');

/* removing a shelf must never remove what was on it */
check('removing it frees its fields',    Store.deleteFolder(maths.id), 2);
check('the fields are all still there',  Store.roots().length, 3);
check('and back at the top level',
      Store.roots().map(r => r.folderId), [null, null, null]);
check('removing it again does nothing',  Store.deleteFolder(maths.id), 0);

/* a field whose folder is gone comes back out rather than pointing at nothing */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'x', parentId: null, name: 'X', folderId: 'ghost' },
          { id: 'y', parentId: null, name: 'Y', folderId: 'real' }],
  folders: [{ id: 'real', name: 'Real' }, { id: 'real', name: 'Duplicate' }],
}));
check('a duplicate folder is dropped',   Store.folders().map(f => f.id), ['real']);
check('a field on a missing folder comes loose', Store.byId('x').folderId, null);
check('one on a real folder stays',      Store.byId('y').folderId, 'real');

/* a folder holding only private fields is a label for private work */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'open',   parentId: null, name: 'Open',   folderId: 'shared' },
    { id: 'hidden', parentId: null, name: 'Hidden', folderId: 'quiet', private: true },
  ],
  folders: [{ id: 'shared', name: 'Shared' }, { id: 'quiet', name: 'Quiet' },
            { id: 'blank', name: 'Blank' }],
}));
check('the public file keeps the folder with a public field on it',
      JSON.parse(Store.toJSON()).folders.map(f => f.id), ['shared', 'blank']);
check('and never names the one holding only private work',
      Store.toJSON().includes('Quiet'), false);
check('the private file keeps that one',
      JSON.parse(Store.toPrivateJSON()).folders.map(f => f.id), ['quiet']);

/* merging the same file twice must not double the folders */
const twiceOver = Store.toPrivateJSON();
Store.mergeJSON(twiceOver);
Store.mergeJSON(twiceOver);
check('merging is idempotent for folders', Store.folders().length, 3);

/* --- sub-folders: a folder inside a folder --- */

Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'analysis', parentId: null, name: 'Analysis' },
    { id: 'pure',     parentId: null, name: 'Pure Maths' },
    { id: 'stats',    parentId: null, name: 'Statistics' },
    { id: 'cpp',      parentId: null, name: 'C++' },
  ],
}));
const mathsF = Store.addFolder('Mathematics');
const pureF  = Store.addFolder('Pure', mathsF.id);
const appF   = Store.addFolder('Applied', mathsF.id);

check('a folder can be made inside another', Store.folderById(pureF.id).parentId, mathsF.id);
check('the top level holds only the outer one',
      Store.childFolders(null).map(f => f.name), ['Mathematics']);
check('and the outer one holds the two inside it',
      Store.childFolders(mathsF.id).map(f => f.name), ['Pure', 'Applied']);
check('depth is how far in it sits', [Store.folderDepth(mathsF.id), Store.folderDepth(pureF.id)], [0, 1]);
check('and the chain reads outwards',
      Store.folderAncestors(pureF.id).map(f => f.name), ['Mathematics']);

Store.setNodeFolder('analysis', pureF.id);
Store.setNodeFolder('pure', pureF.id);
Store.setNodeFolder('stats', appF.id);

check('fields file onto a sub-folder',  Store.fieldsOn(pureF.id).map(f => f.id), ['analysis', 'pure']);
check('nothing is filed on the outer one directly', Store.fieldsOn(mathsF.id).length, 0);
check('but it counts everything beneath it', Store.folderFieldCount(mathsF.id), 3);
check('and a sub-folder counts its own',    Store.folderFieldCount(pureF.id), 2);
check('the loose fields are still loose',   Store.fieldsOn(null).map(f => f.id), ['cpp']);

const tree = Store.folderTree(null);
check('the tree nests', tree.folders.map(g => [g.folder.name, g.folders.map(x => x.folder.name)]),
      [['Mathematics', ['Pure', 'Applied']]]);
check('and carries the counts', tree.folders[0].count, 3);
check('with the loose fields at the top', tree.fields.map(f => f.id), ['cpp']);

/* a folder cannot contain itself, however far round the loop */
check('a folder cannot go inside itself',      Store.setFolderParent(mathsF.id, mathsF.id), null);
check('nor inside one of its own sub-folders', Store.setFolderParent(mathsF.id, pureF.id), null);
check('nor inside one that is not there',      Store.setFolderParent(mathsF.id, 'ghost'), null);
check('but it can move somewhere legitimate',
      !!Store.setFolderParent(appF.id, pureF.id), true);
check('and the counts follow it',
      [Store.folderFieldCount(pureF.id), Store.folderFieldCount(mathsF.id)], [3, 3]);
Store.setFolderParent(appF.id, mathsF.id);

/* removing a folder must never destroy what was inside it */
check('removing the outer folder frees its fields', Store.deleteFolder(mathsF.id), 0);
check('its sub-folders come out to where it was',
      Store.childFolders(null).map(f => f.name), ['Pure', 'Applied']);
check('and every field is still filed on them',
      [Store.fieldsOn(pureF.id).length, Store.fieldsOn(appF.id).length], [2, 1]);
check('nothing was lost', Store.roots().length, 4);

check('removing an inner folder brings its fields up to the one above it',
      (Store.setFolderParent(appF.id, pureF.id), Store.deleteFolder(appF.id)), 1);
check('the field moved up rather than out', Store.byId('stats').folderId, pureF.id);

/* a file with a loop in it loads as a tree missing that link */
Store.importJSON(JSON.stringify({
  nodes: [{ id: 'n', parentId: null, name: 'N', folderId: 'a' }],
  folders: [
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'nowhere' },
  ],
}));
check('a loop between folders is broken rather than kept',
      Store.folders().filter(f => f.parentId === null).length > 0, true);
check('every folder can be walked to the top without hanging',
      Store.folders().every(f => Store.folderDepth(f.id) < Store.folders().length), true);
check('a folder inside one that is missing comes to the top',
      Store.folderById('c').parentId, null);

/* privacy is judged by everything beneath, however deep */
Store.importJSON(JSON.stringify({
  nodes: [
    { id: 'shown',  parentId: null, name: 'Shown',  folderId: 'inner' },
    { id: 'hidden', parentId: null, name: 'Hidden', folderId: 'secret', private: true },
  ],
  folders: [
    { id: 'outer',  name: 'Outer' },
    { id: 'inner',  name: 'Inner',  parentId: 'outer' },
    { id: 'quiet',  name: 'Quiet' },
    { id: 'secret', name: 'Secret', parentId: 'quiet' },
  ],
}));
check('an outer folder is published for work deep inside it',
      JSON.parse(Store.toJSON()).folders.map(f => f.id).sort(), ['inner', 'outer']);
check('and one whose only work is private is not named at all',
      /Quiet|Secret/.test(Store.toJSON()), false);
check('the private file keeps that side',
      JSON.parse(Store.toPrivateJSON()).folders.map(f => f.id).sort(), ['quiet', 'secret']);

Store.importJSON(JSON.stringify({
  nodes: [{ id: 'pub', parentId: null, name: 'Pub', folderId: 'kid' }],
  folders: [{ id: 'hush', name: 'Hush' }, { id: 'kid', name: 'Kid', parentId: 'hush' }],
}));
/* Hush holds nothing itself and Kid holds public work, so Kid is published —
   but it must not point at a parent the file does not carry. */
const publishedFolders = JSON.parse(Store.toJSON()).folders;
check('a kept folder never names a parent that was not kept',
      publishedFolders.every(f => !f.parentId || publishedFolders.some(p => p.id === f.parentId)),
      true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
