import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const seed = fs.readFileSync(path.join(ROOT, 'data/learning.json'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost/',
});
const { window } = dom;

// jsdom has no layout engine: stub the geometry the tree renderer reads.
window.SVGElement.prototype.getBBox = () => ({ x: -400, y: -400, width: 800, height: 800 });
window.Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
window.SVGElement.prototype.setPointerCapture = () => {};
window.SVGElement.prototype.releasePointerCapture = () => {};
window.fetch = async url => (String(url).includes('learning.json')
  ? { ok: true, json: async () => JSON.parse(seed) }
  : { ok: false, status: 404 });
window.confirm = () => true;
window.prompt = () => 'Advent of Code';
window.alert = msg => errors.push('alert(): ' + msg);
window.matchMedia = () => ({ matches: false, addEventListener() {} });

const bundle = ['js/store.js', 'js/tree.js', 'js/views.js', 'js/problems.js', 'js/projects.js', 'js/applications.js', 'js/app.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
  .join(String.fromCharCode(10) + ';' + String.fromCharCode(10));
window.eval(bundle + ';window.Store = Store; window.Tree = Tree; window.Views = Views;' +
  'window.Problems = Problems; window.Applications = Applications; window.Projects = Projects;');

await new Promise(r => setTimeout(r, 300));

const doc = window.document;
const $  = sel => doc.querySelector(sel);
const $$ = sel => [...doc.querySelectorAll(sel)];
const Store = window.Store;
const Tree  = window.Tree;

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  <- ' + detail}`);
};
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const fire  = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const tick  = () => new Promise(r => setTimeout(r, 0));
const key   = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const treeNodes = () => $$('#nodes .node');
// works in both layouts: cards use .card-title, the radial map uses <text>
const nodeLabel = el => {
  const t = el.querySelector('.card-title') || el.querySelector('text');
  return t ? t.textContent.trim() : '';
};
const nodeNamed = name => treeNodes().find(el => nodeLabel(el).startsWith(name));
// a card handles clicks on its own div; a radial node handles them on the <g>
const clickNode = name => {
  const n = nodeNamed(name);
  if (!n) throw new Error('no node named ' + name);
  click(n.querySelector('.card') || n);
};
const fieldTabs = () => $$('#fieldTabs .tab');
const tabNamed  = name => fieldTabs().find(t => t.textContent.includes(name));

/* ---------- 1. tab bar ---------- */
check('tab per field plus All and +', fieldTabs().length === 6, `${fieldTabs().length} tabs`);
check('All tab present', !!tabNamed('All'));
check('C++ tab present', !!tabNamed('C++'));
check('field tab shows progress', /\d+%/.test(tabNamed('C++').textContent), tabNamed('C++').textContent);
check('All tab active on boot', tabNamed('All').classList.contains('is-active'));
// All is a graph of every node, with no synthetic centre invented for it.
check('the All view graphs every node', treeNodes().length === Store.state.nodes.length,
      `${treeNodes().length} cards vs ${Store.state.nodes.length} nodes`);
check('All is in graph mode', Tree.isGraph === true);

/* ---------- 2. focusing one field ---------- */
click(tabNamed('C++'));
const cppCount = 1 + Store.descendantsOf('cpp').length;
check('C++ tab becomes active', tabNamed('C++').classList.contains('is-active'));
check('tree re-roots on C++', treeNodes().length === cppCount, `${treeNodes().length} vs ${cppCount}`);
check('other fields are gone', !nodeNamed('Mathematics'));
check('C++ is the centre', !!nodeNamed('C++'));
check('centre node is selectable', !!Store.byId(Tree.rootId), Tree.rootId);

// adding a topic inside the focused field
clickNode('Tooling');
check('selected a node inside the field', $('.insp-title').textContent.trim() === 'Tooling');
const before = Store.state.nodes.length;
click($('#addChildBtn'));
check('sub-topic added inside the field', Store.state.nodes.length === before + 1);
check('it lands under the right parent', Store.byId(Tree.selectedId).parentId === 'cpp-tooling');
check('tree grew', treeNodes().length === cppCount + 1);
click($('#deleteBtn'));
check('and can be removed again', Store.state.nodes.length === before);

/* ---------- 3. cards ---------- */
check('each node is a card', $$('#nodes .node-card .card').length === treeNodes().length);
check('cards show a status', $$('#nodes .card-status').length > 0);
check('cards show a colour bar', $$('#nodes .card-bar').length === treeNodes().length);
check('parents show branch progress', $$('#nodes .card-progress').length > 0);
check('cards carry action buttons', $$('#nodes .card-btn').length > 0);
check('cards do not overlap',
      (() => {
        const boxes = $$('#nodes foreignObject').map(f => ({
          x: +f.getAttribute('x'), y: +f.getAttribute('y'),
          w: +f.getAttribute('width'), h: +f.getAttribute('height'),
        }));
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return false;
          }
        return true;
      })(), 'two cards share space');

/* card actions */
const cppCard = nodeNamed('CMake');
const advance = [...cppCard.querySelectorAll('.card-btn')].find(b => b.dataset.act === 'advance');
const statusBefore = Store.byId('cpp-cmake').status;
click(advance);
check('the card advances status', Store.byId('cpp-cmake').status !== statusBefore,
      `${statusBefore} -> ${Store.byId('cpp-cmake').status}`);

const addBtn = [...nodeNamed('CMake').querySelectorAll('.card-btn')].find(b => b.dataset.act === 'child');
const kidsBefore = Store.childrenOf('cpp-cmake').length;
click(addBtn);
await tick();     // the inline editor opens on a microtask, as it does in the browser
check('the card adds a sub-topic', Store.childrenOf('cpp-cmake').length === kidsBefore + 1);
check('the new card opens for renaming', !!$('#nodes .card-input'));
const renameInput = $('#nodes .card-input');
renameInput.value = 'Toolchain files';
key(renameInput, 'Enter');
check('inline rename saved', Store.childrenOf('cpp-cmake')[0].name === 'Toolchain files',
      Store.childrenOf('cpp-cmake')[0].name);
Store.deleteNode(Store.childrenOf('cpp-cmake')[0].id);
window.Views.renderList();

/* ---------- 3b. last-worked cues ---------- */
click(tabNamed('All'));           // OpenMP lives under HPC, not the C++ tab
clickNode('OpenMP');
check('inspector reports last worked', /last worked/.test($('#inspectorBody').textContent),
      $('#inspectorBody').textContent.slice(0, 80));

/* ---------- 3d. the inspector reads top to bottom in the right order ---------- */
const headings = $$('#inspectorBody .insp-section h3').map(h => h.textContent.replace(/\s*\(.*/, ''));
check('inspector section order', headings.join(' > ') ===
      'What this is > Status > Resources & tasks > References > Progress > Time > Journal > Details > Actions',
      headings.join(' > '));
check('title comes first', $('#inspectorBody').firstElementChild.classList.contains('insp-head'));

// description autosaves
const desc = $('#f-description');
desc.value = 'Shared-memory parallelism with compiler directives.';
fire(desc, 'blur');
check('description saved', Store.byId('hpc-openmp').description.startsWith('Shared-memory'),
      Store.byId('hpc-openmp').description);

// the checklist
const checkCount = Store.byId('hpc-openmp').items.length;
$('.check-add [name="text"]').value = 'Work through the tasking chapter';
$('.check-add [name="url"]').value = 'https://example.com/tasking';
$('.check-add').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('checklist item added', Store.byId('hpc-openmp').items.length === checkCount + 1);
check('item row rendered', $$('#inspectorBody .check-row').length === checkCount + 1);
check('a link is offered', !!$('#inspectorBody .check-link'));

const rows = $$('#inspectorBody .check-row');
const lastRow = rows[rows.length - 1];
click(lastRow.querySelector('.task-check'));
check('ticking an item sticks', Store.byId('hpc-openmp').items.slice(-1)[0].done === true);
check('finishing the checklist promotes the status', Store.byId('hpc-openmp').status === 'mastered',
      Store.byId('hpc-openmp').status);

// progress takes the strongest claim available
const done = Store.checklistOf('hpc-openmp');
check('a finished checklist reads 100%', Store.progressOf('hpc-openmp') === 1,
      `${Store.progressOf('hpc-openmp')} vs ${done.done}/${done.total}`);
check('progress explains itself',
      /checklist \(/.test($('.progress-source').textContent), $('.progress-source')?.textContent);
check('the card shows the checklist count', !!nodeNamed('OpenMP').querySelector('.card-check'));

click($$('#inspectorBody .check-row .task-del').slice(-1)[0]);
check('checklist item removed', Store.byId('hpc-openmp').items.length === checkCount);

/* ---------- 3e. privacy ---------- */
clickNode('C++');
$('#f-private').checked = true;
fire($('#f-private'), 'change');
check('branch marked private', Store.isPrivate('cpp') === true);
check('children inherit it', Store.isPrivate('cpp-core') === true);
check('the card shows a lock', nodeNamed('C++').querySelector('.card').classList.contains('is-private'));
check('the inspector shows a lock badge', !!$('.insp-lock'));

clickNode('Core Language');
check('an inherited child cannot untick it', $('#f-private').disabled === true);
check('and says why', /because a parent is/.test($('.privacy-hint').textContent), $('.privacy-hint')?.textContent);

const publicSnapshot = JSON.parse(Store.toJSON());
check('public export excludes the private branch',
      publicSnapshot.nodes.every(n => !n.id.startsWith('cpp')), 'cpp leaked into the public snapshot');
check('private export carries it',
      JSON.parse(Store.toPrivateJSON()).nodes.some(n => n.id === 'cpp'));

clickNode('C++');
$('#f-private').checked = false;
fire($('#f-private'), 'change');
check('privacy can be lifted again', Store.isPrivate('cpp') === false);

/* ---------- 3f. the inspector can be dragged wider ---------- */
const startWidth = parseInt(window.getComputedStyle(doc.documentElement).getPropertyValue('--inspector-w'), 10);
const resizer = $('#inspectorResizer');
check('a resize handle exists', !!resizer);
key(resizer, 'ArrowLeft');
const grown = parseInt(window.getComputedStyle(doc.documentElement).getPropertyValue('--inspector-w'), 10);
check('the inspector grows', grown > startWidth, `${startWidth} -> ${grown}`);
key(resizer, 'ArrowRight');
check('and shrinks back', parseInt(window.getComputedStyle(doc.documentElement).getPropertyValue('--inspector-w'), 10) === startWidth);
for (let i = 0; i < 30; i++) key(resizer, 'ArrowRight');
check('it stops at a minimum',
      parseInt(window.getComputedStyle(doc.documentElement).getPropertyValue('--inspector-w'), 10) >= 280);
check('cards show when last worked', $$('#nodes .card-when').length > 0);
check('recent work highlighted on cards', $$('#nodes .card-when.is-fresh').length > 0);
click($('#activityBtn'));
check('activity toggle hides card dates', $$('#nodes .card-when').length === 0);
click($('#activityBtn'));
check('and brings them back', $$('#nodes .card-when').length > 0);

/* ---------- 3g. references and the graph ---------- */
click(tabNamed('All'));
check('All renders as a graph', Tree.isGraph === true);
check('the canvas says so', $('.canvas-wrap').classList.contains('is-graph'));
// The layout must not reshuffle every time something is repainted, or the
// picture would be unreadable as a map.
const positionsNow = () => $$('#nodes foreignObject')
  .map(f => `${f.getAttribute('x')},${f.getAttribute('y')}`).join('|');
const firstLayout = positionsNow();
Tree.render();
check('the graph is stable across renders', positionsNow() === firstLayout,
      'positions moved on a repaint');
check('the graph is spread out, not stacked',
      new Set($$('#nodes foreignObject').map(f => f.getAttribute('x'))).size > 5);

check('graph cards do not overlap', (() => {
  const boxes = $$('#nodes foreignObject').map(f => ({
    x: +f.getAttribute('x'), y: +f.getAttribute('y'),
    w: +f.getAttribute('width'), h: +f.getAttribute('height'),
  }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return false;
    }
  return true;
})(), 'two graph cards share space');

// a reference between two topics in different fields
clickNode('Probability & Statistics');
check('references section present', /References/.test($('#inspectorBody').textContent));
const refForm = $('.ref-add');
refForm.querySelector('[name="target"]').value = 'hpc-roofline';
refForm.querySelector('[name="label"]').value = 'used for modelling';
refForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('reference created', Store.linksFor('math-prob').out.length === 1);
check('it points where told', Store.linksFor('math-prob').out[0].to === 'hpc-roofline');
check('the label is kept', Store.linksFor('math-prob').out[0].label === 'used for modelling');
check('a dotted arrow is drawn', $$('#links .ref-link').length >= 1);
check('the arrow is marked', !!$('#links .ref-link').getAttribute('marker-end'));
check('the label shows for the selection', $$('#links .ref-label').length === 1);

// it shows from the other end too
clickNode('Roofline Model');
check('the far end lists it', Store.linksFor('hpc-roofline').in.length === 1);
check('shown as incoming', /References \(1\)/.test($('#inspectorBody').textContent));

// no self-references, no duplicates
check('a topic cannot reference itself', Store.addLink('math-prob', 'math-prob') === null);
check('re-linking the same pair does not duplicate',
      Store.addLink('math-prob', 'hpc-roofline', 'again') && Store.state.links.length === 1);
check('but it relabels', Store.linksFor('math-prob').out[0].label === 'again');

// toggling them off
click($('#refsBtn'));
check('references can be hidden', $$('#links .ref-link').length === 0);
click($('#refsBtn'));
check('and shown again', $$('#links .ref-link').length === 1);

// deleting the topic at one end removes the reference
const linkCount = Store.state.links.length;
Store.addLink('math-prob', 'hpc-cuda', 'temporary');
check('second reference added', Store.state.links.length === linkCount + 1);
Store.deleteNode('hpc-cuda');
Store.importJSON(Store.toJSON());
check('a reference to a deleted topic is dropped', Store.state.links.length === linkCount);

/* ---------- 3h. references survive the public/private split ---------- */
Store.updateNode('math', { private: true });
check('a reference into a private branch goes private',
      JSON.parse(Store.toJSON()).links.length === 0, 'a private reference leaked');
check('and is in the private file',
      JSON.parse(Store.toPrivateJSON()).links.length === 1);
Store.updateNode('math', { private: false });
Tree.render();

/* ---------- 4. starting a brand new field ---------- */
click($('#addFieldTab'));
const nameInput = $('.tab-input');
check('the + tab opens an inline name box', !!nameInput);
nameInput.value = 'Operating Systems';
key(nameInput, 'Enter');
check('new field created', Store.roots().some(r => r.name === 'Operating Systems'));
check('a tab appeared for it', !!tabNamed('Operating Systems'));
check('and it is the active tab', tabNamed('Operating Systems').classList.contains('is-active'));
check('a new field shows as a single card', treeNodes().length === 1, `${treeNodes().length}`);
check('the field card is still navigable', !!nodeNamed('Operating Systems'));
check('no empty-state overlay exists', $('#canvasEmpty') === null);

// grow it from its own card, the same way as any other topic
const osAdd = [...nodeNamed('Operating Systems').querySelectorAll('.card-btn')].find(b => b.dataset.act === 'child');
click(osAdd);
await tick();
key($('#nodes .card-input'), 'Escape');
check('first topic added from the field card', treeNodes().length === 2);
const newFieldId = Store.roots().find(r => r.name === 'Operating Systems').id;
check('the topic belongs to the new field', Store.childrenOf(newFieldId).length === 1);

// cancelling instead of committing
click($('#addFieldTab'));
key($('.tab-input'), 'Escape');
check('Escape cancels a new field', !$('.tab-input') && Store.roots().length === 5,
      `${Store.roots().length} fields`);

/* ---------- 5. list view ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'list'));
check('list view shown', !$('#view-list').hidden && $('#view-tree').hidden);
check('list tab marked active', $$('.tab-fixed').find(t => t.dataset.view === 'list').classList.contains('is-active'));
check('every topic listed', $$('#view-list .list-row').length === Store.state.nodes.length,
      `${$$('#view-list .list-row').length} rows vs ${Store.state.nodes.length} nodes`);
check('grouped by field', $$('#view-list .list-domain').length === 5);
check('rows show when last worked', $$('#view-list .when').some(w => /ago|today|yesterday/.test(w.textContent)));
check('recent work highlighted', $$('#view-list .when.is-fresh').length > 0);

// selecting a row must NOT jump to the tree
const rowFor = id => $$('#view-list .list-row').find(r => r.querySelector(`[data-status-for="${id}"]`));
click(rowFor('math-bayes').querySelector('.title'));
check('row selection stays in the list', !$('#view-list').hidden && $('#view-tree').hidden);
check('row marked selected', rowFor('math-bayes').classList.contains('is-selected'));
check('inspector followed the selection', $('.insp-title').textContent.trim() === 'Bayesian Inference',
      $('.insp-title').textContent);
check('inline editor opened', !!$('.list-detail'));
check('editor shows the breadcrumb', $('.list-detail .crumb').textContent.includes('Mathematics'));

/* ---------- 6. notes written from the list ---------- */
const notes = $('#ld-notes');
notes.value = 'Started the conjugate priors chapter.';
fire(notes, 'blur');
check('description saved from the list', Store.byId('math-bayes').description === 'Started the conjugate priors chapter.',
      Store.byId('math-bayes').description);
check('inspector picked the description up', $('#f-description').value.includes('conjugate priors'));

// quick time logging from the same panel
const minsBefore = Store.minutesFor('math-bayes', false);
$('#ld-mins').value = '25';
click($('#ld-log'));
check('time logged from the list', Store.minutesFor('math-bayes', false) === minsBefore + 25);
check('logging promoted the status', Store.byId('math-bayes').status !== 'planned', Store.byId('math-bayes').status);
check('row flags that it has a description', !!rowFor('math-bayes').querySelector('.note-flag'));

/* ---------- 7. list sorting and folding ---------- */
const sortSel = $('#listSort');
sortSel.value = 'recent';
fire(sortSel, 'change');
// The list stays grouped by field, so "last worked" orders within each group.
const firstGroupDates = (() => {
  const out = [];
  for (const el of $$('#listBody > *')) {
    if (el.classList.contains('list-domain') && out.length) break;
    if (el.classList.contains('list-row')) {
      const id = el.querySelector('[data-status-for]').dataset.statusFor;
      out.push(Store.lastWorked(id) || '');
    }
  }
  return out;
})();
check('last-worked sort orders each group', firstGroupDates.every((d, i, a) => i === 0 || a[i - 1] >= d),
      firstGroupDates.slice(0, 4).join(' | '));
sortSel.value = 'name';
fire(sortSel, 'change');
check('sorting by name works', $$('#view-list .list-row').length === Store.state.nodes.length);
sortSel.value = 'tree';
fire(sortSel, 'change');

click($('#view-list .list-domain'));
check('clicking a field header folds it', $$('#view-list .list-row').length < Store.state.nodes.length);
click($('#view-list .list-domain'));
check('and unfolds it again', $$('#view-list .list-row').length === Store.state.nodes.length);

click($('#listCollapseAll'));
check('collapse all folds every group', $$('#view-list .list-row').length === 0);
check('button offers to expand again', $('#listCollapseAll').textContent === 'Expand all');
click($('#listCollapseAll'));
check('expand all restores the rows', $$('#view-list .list-row').length === Store.state.nodes.length);

/* ---------- 7b. daily focus checklist ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'focus'));
check('focus view shown', !$('#view-focus').hidden && $('#view-list').hidden);
check('focus tab marked active', $$('.tab-fixed').find(t => t.dataset.view === 'focus').classList.contains('is-active'));
check('today starts empty', $('#focusList .focus-empty') !== null);
check('history shows earlier days', $$('#focusHistory .day-group').length === 2,
      `${$$('#focusHistory .day-group').length} days`);
check('a past day shows its score', $('#focusHistory .day-score').textContent === '1/2',
      $('#focusHistory .day-score').textContent);

// add a task for today, linked to a topic
$('#focusText').value = 'Finish the MPI collectives exercises';
$('#focusTopic').value = 'hpc-mpi';
$('#focusForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('task added for today', Store.focusFor(Store.todayISO()).length === 1);
check('task row rendered', $$('#focusList .task').length === 1);
check('linked topic shown as a chip', $('#focusList .task-topic').textContent === 'MPI',
      $('#focusList .task-topic')?.textContent);
check('input cleared for the next one', $('#focusText').value === '');

// an empty submission is ignored
$('#focusText').value = '   ';
$('#focusForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('blank tasks are ignored', Store.focusFor(Store.todayISO()).length === 1);

// tick it off
click($('#focusList .task-check'));
const todays = Store.focusFor(Store.todayISO());
check('ticking marks it done', todays[0].done === true);
check('and stamps when', !!todays[0].doneAt);
check('row shows as done', $('#focusList .task').classList.contains('is-done'));
check('day summary updated', $('#focusSummary').textContent === '1 of 1 done', $('#focusSummary').textContent);
click($('#focusList .task-check'));
check('ticking again undoes it', Store.focusFor(Store.todayISO())[0].done === false);

// edit the text in place
const taskText = $('#focusList .task-text');
taskText.value = 'MPI collectives: reduce and allreduce';
fire(taskText, 'blur');
check('task text edited in place', Store.focusFor(Store.todayISO())[0].text === 'MPI collectives: reduce and allreduce');

// carry unfinished work forward
check('carry-over offered', !$('#focusCarry').hidden, 'button hidden');
check('carry-over names the day', /Carry over 1 unfinished/.test($('#focusCarry').textContent),
      $('#focusCarry').textContent);
click($('#focusCarry'));
check('unfinished task carried to today', Store.focusFor(Store.todayISO()).length === 2);
check('the carried task keeps its text',
      Store.focusFor(Store.todayISO()).some(t => t.text === 'Review the MPI collectives notes'));
check('the original day is untouched', Store.focusFor('2026-08-22').length === 2);
click($('#focusCarry'));
check('carrying twice does not duplicate', Store.focusFor(Store.todayISO()).length === 2);

// history folds open
click($('#focusHistory .day-head'));
check('history day expands', $$('#focusHistory .day-tasks .task').length > 0);
click($('#focusHistory .day-head'));
check('and folds again', $$('#focusHistory .day-tasks').length === 0);

// delete a task
const countBeforeDelete = Store.focusFor(Store.todayISO()).length;
click($('#focusList .task-del'));
check('task deleted', Store.focusFor(Store.todayISO()).length === countBeforeDelete - 1);

// focus tasks survive an export/import round-trip
check('focus included in export', JSON.parse(Store.toJSON()).focus.length === Store.state.focus.length);

/* ---------- 7c. problems ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'problems'));
check('problems view shown', !$('#view-problems').hidden);
check('platform chips offered', $$('#problemSources .chip-btn').length >= 6,
      `${$$('#problemSources .chip-btn').length} chips`);
check('LeetCode is there by default', /LeetCode/.test($('#problemSources').textContent));
check('Codeforces is there by default', /Codeforces/.test($('#problemSources').textContent));
check('Project Euler is there by default', /Project Euler/.test($('#problemSources').textContent));
check('starts with nothing solved', $('#problemList .list-empty') !== null);

// add a solve by hand
const pform = $('#problemForm');
pform.querySelector('[name="source"]').value = 'codeforces';
pform.querySelector('[name="problemId"]').value = '1234A';
pform.querySelector('[name="title"]').value = 'Knapsack Variant';
pform.querySelector('[name="tags"]').value = 'dp, greedy';
pform.querySelector('[name="difficulty"]').value = '1600';
pform.querySelector('[name="solvedAt"]').value = Store.todayISO();
pform.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('solve recorded', Store.problemsMatching().length === 1);
check('row rendered', $$('#problemList .problem-row').length === 1);
check('tags shown on the row', /dp/.test($('#problemList .p-tags').textContent));
check('it opens for editing straight away', !!$('.problem-detail'));

// how hard it felt
click($$('.problem-detail [data-felt]')[3]);
check('perceived difficulty saved', Store.problemsMatching()[0].perceived === 4,
      String(Store.problemsMatching()[0].perceived));

// notes per problem
const pnotes = $('#pd-notes');
pnotes.value = 'Sort by weight first, then classic knapsack.';
fire(pnotes, 'blur');
check('problem notes saved', /knapsack/.test(Store.problemsMatching()[0].notes));

// tag counts
check('tag breakdown rendered', $$('#problemTags .tag-row').length === 2,
      `${$$('#problemTags .tag-row').length} tags`);
check('a tag starts unmapped', /unmapped/.test($('#problemTags').textContent));

// map a tag onto a topic so the solve becomes evidence
const mapSelect = $('#tagMapping [data-map="dp"]');
check('mapping table lists the tag', !!mapSelect);
mapSelect.value = 'cpp-algorithms';
fire(mapSelect, 'change');
check('tag mapped to a topic', Store.nodeForTags(['dp']) === 'cpp-algorithms');
check('the solve now counts for that topic', Store.problemsForNode('cpp-algorithms').length === 1);
check('and for its parent', Store.problemsForNode('cpp').length === 1);

// filter by platform
click($$('#problemSources .chip-btn').find(b => /LeetCode/.test(b.textContent)));
check('filtering by platform empties the list', $$('#problemList .problem-row').length === 0);
click($$('#problemSources .chip-btn').find(b => /^All/.test(b.textContent)));
check('clearing the filter restores it', $$('#problemList .problem-row').length === 1);

// a new platform of your own
click($('#problemSources .chip-add'));
check('a custom platform can be added', Store.allSources().some(s => s.label === 'Advent of Code'));

// bulk import, the path the extension will use
const beforeImport = Store.problemsMatching().length;
const importResult = window.Problems.importSolves(JSON.stringify([
  { source: 'codeforces', problemId: '9B', title: 'Graph Walk', tags: ['graphs'], solvedAt: Store.todayISO() },
  { source: 'codeforces', problemId: '1234A', title: 'Knapsack Variant', tags: ['dp'], solvedAt: Store.todayISO() },
]));
check('import adds what is new', importResult.added === 1, JSON.stringify(importResult));
check('and skips what is known', importResult.updated === 1, JSON.stringify(importResult));
check('no duplicate created', Store.problemsMatching().length === beforeImport + 1);

// the extension-facing bridge
check('a solve bridge is exposed', typeof window.DevTracker.recordSolves === 'function');
window.DevTracker.recordSolves([{ source: 'leetcode', problemId: 'two-sum', title: 'Two Sum', tags: ['array'] }]);
check('the bridge records solves', Store.problemsMatching({ source: 'leetcode' }).length === 1);

// problems feed the learning metric through a target
click(tabNamed('All'));          // the tree was last rooted on a single field
clickNode('Algorithms');
check('inspector offers a problem target', !!$('#f-target'));
$('#f-target').value = '4';
fire($('#f-target'), 'change');
check('target saved', Store.byId('cpp-algorithms').problemTarget === 4);
check('progress counts the solves', Store.progressOf('cpp-algorithms') >= 0.25,
      String(Store.progressOf('cpp-algorithms')));
check('the inspector cites the evidence', /problem/.test($('.progress-evidence').textContent),
      $('.progress-evidence')?.textContent);

/* ---------- 7c-bis. the extension handshake ---------- */
/* Stands in for the content script. jsdom leaves `source` null on a real
   postMessage, where a browser sets it to the sending window, so the event is
   constructed the way a browser delivers it — the page's guard stays strict. */
const postToPage = data => window.dispatchEvent(new window.MessageEvent('message', {
  data, source: window, origin: window.location.origin,
}));

const offerSolves = solves => new Promise(resolve => {
  const onMessage = ev => {
    if (!ev.data || ev.data.type !== 'dev-tracker/solves-ack') return;
    window.removeEventListener('message', onMessage);
    resolve(ev.data);
  };
  window.addEventListener('message', onMessage);
  postToPage({ type: 'dev-tracker/solves', solves });
  setTimeout(() => { window.removeEventListener('message', onMessage); resolve(null); }, 500);
});

const beforeBridge = Store.problemsMatching().length;
const ack = await offerSolves([
  { source: 'codeforces', problemId: '1700C', title: 'Helping the Nature',
    tags: ['greedy'], difficulty: 1500, solvedAt: Store.todayISO() },
]);
check('the page acknowledges the handover', !!ack, 'no acknowledgement arrived');
check('it names what it stored', ack && ack.problemIds, ['1700C']);
check('it reports one added', ack && ack.added === 1, JSON.stringify(ack));
check('the solve is stored', Store.problemsMatching().length === beforeBridge + 1);

// Offering the same solve again must not duplicate it, but must still ack, or
// the extension would never clear its queue.
const second = await offerSolves([
  { source: 'codeforces', problemId: '1700C', title: 'Helping the Nature',
    tags: ['greedy'], difficulty: 1500, solvedAt: Store.todayISO() },
]);
check('a repeat handover is acknowledged too', !!second && second.problemIds.length === 1);
check('and adds nothing', second.added === 0, JSON.stringify(second));
check('no duplicate stored', Store.problemsMatching().length === beforeBridge + 1);

// Messages that are not a solve offer are ignored.
await offerSolves([]);
check('an empty offer is harmless', Store.problemsMatching().length === beforeBridge + 1);
postToPage({ type: 'something-else', solves: [{ source: 'x', problemId: 'y', title: 'z' }] });
await tick();
check('unrelated messages are ignored', Store.problemsMatching().length === beforeBridge + 1);

// The guard must actually reject what it claims to reject.
const spoof = { type: 'dev-tracker/solves', solves: [{ source: 'codeforces', problemId: 'SPOOF', title: 'Injected' }] };
window.dispatchEvent(new window.MessageEvent('message', {
  data: spoof, source: null, origin: window.location.origin,
}));
await tick();
check('a message from another window is refused',
      !Store.problemsMatching().some(p => p.problemId === 'SPOOF'), 'a foreign window got through');

window.dispatchEvent(new window.MessageEvent('message', {
  data: spoof, source: window, origin: 'https://somewhere-else.example',
}));
await tick();
check('a message from another origin is refused',
      !Store.problemsMatching().some(p => p.problemId === 'SPOOF'), 'a foreign origin got through');

/* ---------- 7d. applications, and their privacy ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'apps'));
check('applications view shown', !$('#view-apps').hidden);
check('it states that it is private', /never/.test($('.private-note').textContent));
check('starts empty', $('#appBoard .list-empty') !== null);

const aform = $('#appForm');
aform.querySelector('[name="company"]').value = 'Example Corp';
aform.querySelector('[name="role"]').value = 'Software Engineer Intern';
aform.querySelector('[name="location"]').value = 'London';
aform.querySelector('[name="appliedAt"]').value = Store.todayISO();
aform.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('application added', Store.applications().length === 1);
check('row rendered under its stage', $$('#appBoard .app-row').length === 1);
check('grouped by stage', /Applied/.test($('#appBoard .app-stage-head').textContent));
check('it opens for editing', !!$('.app-detail'));
check('a timeline starts immediately', $$('.app-detail .tl-row').length === 1);

// move it through the pipeline
const stageSel = $('#appBoard .app-stage');
stageSel.value = 'interview';
fire(stageSel, 'change');
check('stage change applied', Store.applications()[0].stage === 'interview');
check('and recorded on the timeline', Store.applications()[0].events.length === 2);

// a next action that is overdue surfaces at the top
const appId = Store.applications()[0].id;
Store.updateApplication(appId, { nextAction: 'Send follow-up', nextDue: Store.shiftDays(Store.todayISO(), -1) });
window.Applications.render();
check('overdue work is surfaced', !$('#appDue').hidden);
check('and marked late', !!$('#appDue .due-row.is-late'));

// notes — the panel is already open from adding it, so only open if it is not
if (!$('#ad-notes')) click($$('#appBoard .app-row')[0]);
const anotes = $('#ad-notes');
anotes.value = 'Spoke to the recruiter, assessment next week.';
fire(anotes, 'blur');
check('application notes saved', /recruiter/.test(Store.applications()[0].notes));

// pasting a posting URL fills in what it knows
const urlForm = $('#appForm');
urlForm.querySelector('[name="company"]').value = 'https://jobs.lever.co/two-sigma/abc-123';
urlForm.querySelector('[name="appliedAt"]').value = Store.todayISO();
urlForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const fromUrl = Store.applications().find(a => a.company === 'Two Sigma');
check('a pasted URL becomes a company', !!fromUrl, Store.applications().map(a => a.company).join(', '));
check('the board is recognised', fromUrl && fromUrl.source === 'Lever', fromUrl && fromUrl.source);
check('the link is kept', fromUrl && /lever\.co/.test(fromUrl.url));

// logos are initials by default and ask nothing of the network
check('a monogram is drawn', $$('#appBoard .app-logo').length > 0);
check('no image is loaded by default', $$('#appBoard .app-logo img').length === 0);
check('the toggle is off', $('#appLogos').checked === false);
check('and explains the trade-off', /tells that company/.test($('.logo-toggle').textContent));

// mis-clicking a stage must not leave a mark on the tally
const misRow = $$('#appBoard .app-row').find(r => /Example Corp/.test(r.textContent));
const misSel = misRow.querySelector('.app-stage');
const interviewsBefore = Store.applicationStats().interviews;
misSel.value = 'offer';
fire(misSel, 'change');
misSel.value = 'interview';
fire(misSel, 'change');
misSel.value = 'applied';
fire(misSel, 'change');
check('stepping back through stages clears the interview tally',
      Store.applicationStats().interviews === interviewsBefore - 1,
      `${Store.applicationStats().interviews} vs ${interviewsBefore}`);
check('and the stage is back', Store.applications().find(a => a.company === 'Example Corp').stage === 'applied');

Store.deleteApplication(fromUrl.id);
window.Applications.render();

// THE guarantee
const publicJson = Store.toJSON();
check('no company name in the public snapshot', !/Example Corp/.test(publicJson));
check('no applications key in the public snapshot', JSON.parse(publicJson).applications === undefined);
check('no notes leak either', !/recruiter/.test(publicJson));
check('they are in the private export', JSON.parse(Store.toPrivateJSON()).applications.length === 1);
check('holding one counts as private data', Store.hasPrivateData() === true);
check('the public export still carries the solves', JSON.parse(publicJson).problems.length > 0);

/* ---------- 7e. the problem debrief and the revisit queue ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'problems'));
/* A panel may already be open from an earlier step, and clicking a row
   toggles, so open the first row deterministically. */
const openFirstProblem = () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = $$('#problemList .problem-row')[0];
    const next = row && row.nextElementSibling;
    if (next && next.classList.contains('problem-detail')) return;
    if (row) click(row.querySelector('.p-title'));
  }
};
openFirstProblem();
check('the debrief is offered', !!$('.debrief'));
check('it asks how much help was needed', $$('.debrief [data-help]').length === 3);

click($$('.debrief [data-help]').find(b => b.dataset.help === 'hint'));
const debriefed = Store.problemsMatching()[0];
check('help recorded from the panel', debriefed.independence === 'hint', String(debriefed.independence));

$('#pd-mistake').value = 'off-by-one on the tail';
fire($('#pd-mistake'), 'change');
check('the mistake is saved', /off-by-one/.test(Store.problemsMatching()[0].mistake));
$('#pd-lesson').value = 'prefix sums avoid repeated work';
fire($('#pd-lesson'), 'change');
check('the lesson is saved', /prefix sums/.test(Store.problemsMatching()[0].lesson));
$('#pd-attempts').value = '3';
fire($('#pd-attempts'), 'change');
check('attempts are saved', Store.problemsMatching()[0].attempts === 3);

$('#pd-review').value = '7';
fire($('#pd-review'), 'change');
check('a revisit can be booked', Store.problemsMatching()[0].state === 'review');
check('the revisit block appears', !$('#revisitBlock').hidden);
check('and lists it', $$('#revisitList .revisit-row').length === 1);
check('saying why it is there', /hint|off-by-one/.test($('#revisitList .rv-why').textContent),
      $('#revisitList .rv-why').textContent);
check('the row shows its state', /Needs review/.test($('#problemList .p-state').textContent));

click($('#revisitList [data-act="done"]'));
check('re-solving clears it', $('#revisitBlock').hidden);
check('and records the re-solve', Store.problemsMatching()[0].state === 'resolved');

/* ---------- 7f. evidence in the inspector ---------- */
Store.setTagMapping('dp', 'cpp-algorithms');
Store.recordSolve({ source: 'leetcode', problemId: 'ev-1', title: 'Evidence One',
  tags: ['dp'], level: 'medium', independence: 'independent', solvedAt: Store.todayISO() });
Store.recordSolve({ source: 'leetcode', problemId: 'ev-2', title: 'Evidence Two',
  tags: ['dp'], level: 'hard', independence: 'independent', solvedAt: Store.todayISO() });

click(tabNamed('All'));
clickNode('Algorithms');
check('the inspector shows evidence', !!$('.evidence-facts'));
check('it counts the solves', /problem/.test($('.evidence-facts').textContent));
check('it lists recent ones', $$('.evidence-recent .er-row').length > 0);
check('and flags independent solves', /without help/.test($('.evidence-facts').textContent));

/* ---------- 7g. typed references and prerequisites ---------- */
clickNode('Templates & Concepts');
const typeSel = $('.ref-add [name="type"]');
check('a reference can be typed', !!typeSel);
typeSel.value = 'requires';
$('.ref-add [name="target"]').value = 'cpp-move';
$('.ref-add').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('the type is stored', Store.linksFor('cpp-templates').out[0].type === 'requires');
check('the row reads as a sentence', /requires/.test($('.ref-row').textContent),
      $('.ref-row')?.textContent);

// a prerequisite nobody has started is called out
Store.updateNode('cpp-templates', { status: 'learning' });
Store.updateNode('cpp-move', { status: 'planned' });
clickNode('Templates & Concepts');
check('an unmet prerequisite is surfaced', !!$('.prereq-warning'));
check('and names it', /Move Semantics/.test($('.prereq-warning').textContent),
      $('.prereq-warning')?.textContent);

/* ---------- 7h. journal and Obsidian ---------- */
const jForm = $('.journal-add');
jForm.querySelector('[name="text"]').value = 'Concepts replaced SFINAE for me today';
jForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('a journal entry is stored', Store.journalFor('cpp-templates').length === 1);
check('and rendered', $$('.journal-list .journal-row').length === 1);
check('with its date', !!$('.journal-row .j-when').textContent.trim());

$('#f-obsidian').value = 'My Vault/CS/Templates';
fire($('#f-obsidian'), 'change');
check('an obsidian path is saved', Store.byId('cpp-templates').obsidian === 'My Vault/CS/Templates');
const openLink = $('.obsidian-row a');
check('an open link appears', !!openLink);
check('pointing at the vault', /^obsidian:\/\/open\?vault=My%20Vault/.test(openLink.getAttribute('href')),
      openLink && openLink.getAttribute('href'));

/* ---------- 7i. goals ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'focus'));
check('goals live with today', !!$('#goalList'));
check('and start empty', /No goals yet/.test($('#goalList').textContent));

const gForm = $('#goalForm');
gForm.querySelector('[name="name"]').value = 'Comfortable with modern C++';
gForm.querySelector('[name="targetDate"]').value = Store.shiftDays(Store.todayISO(), 30);
gForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('goal created', Store.goals().length === 1);
check('card rendered', $$('#goalList .goal-card').length === 1);
check('days remaining shown', /30 days remaining/.test($('.goal-when').textContent), $('.goal-when').textContent);
check('it opens straight away', !!$('.goal-parts'));

// a part the tracker answers for itself
const partForm = $('.goal-part-add');
partForm.querySelector('[name="kind"]').value = 'status';
fire(partForm.querySelector('[name="kind"]'), 'change');
check('picking a topic is offered', !partForm.querySelector('[name="nodeId"]').hidden);
check('and which status', !partForm.querySelector('[name="status"]').hidden);
partForm.querySelector('[name="nodeId"]').value = 'cpp-cmake';
partForm.querySelector('[name="status"]').value = 'proficient';
partForm.querySelector('[name="text"]').value = 'CMake proficient';
partForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('an automatic part is added', Store.goals()[0].parts.length === 1);
check('it reports progress rather than a checkbox', !!$('.goal-part .part-auto'));
check('and says where it comes from', /CMake/.test($('.part-source').textContent), $('.part-source')?.textContent);

// doing the real work moves the goal
Store.updateNode('cpp-cmake', { status: 'proficient' });
window.Views.renderGoals();
check('real progress reaches the goal', /100%/.test($('.goal-pct').textContent), $('.goal-pct').textContent);

// a manual part still gets a checkbox
const partForm2 = $('.goal-part-add');
partForm2.querySelector('[name="kind"]').value = 'manual';
fire(partForm2.querySelector('[name="kind"]'), 'change');
check('a topic is not asked for', partForm2.querySelector('[name="nodeId"]').hidden);
partForm2.querySelector('[name="text"]').value = 'Build one C++ project';
partForm2.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('a manual part is added', Store.goals()[0].parts.length === 2);
check('with a checkbox', $$('.goal-part .task-check').length === 1);
click($('.goal-part .task-check'));
check('ticking it counts', Store.goals()[0].parts[1].done === true);

/* ---------- 7j. projects ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'projects'));
check('projects view shown', !$('#view-projects').hidden);
check('starts empty', !!$('#projectList .list-empty'));

const pjForm = $('#projectForm');
pjForm.querySelector('[name="name"]').value = 'Order Book';
pjForm.querySelector('[name="repo"]').value = 'https://github.com/me/order-book';
pjForm.querySelector('[name="startedAt"]').value = Store.todayISO();
pjForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('project created', Store.projects().length === 1);
check('row rendered', $$('#projectList .project-row').length === 1);
check('it opens for editing', !!$('.project-detail'));

// milestones drive its progress
const msForm = $('.prj-add');
msForm.querySelector('[name="text"]').value = 'Matching engine';
msForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('milestone added', Store.projects()[0].milestones.length === 1);
click($('.prj-milestones .task-check'));
check('progress follows milestones', Store.projectProgress(Store.projects()[0]).ratio === 1);
check('and shows on the row', /100%/.test($('.pr-pct').textContent));

// the part that matters: evidence a concept was used
const cForm = $('.prj-concept-add');
cForm.querySelector('[name="nodeId"]').value = 'cpp';
cForm.querySelector('[name="evidence"]').value = 'the whole engine is C++';
cForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('concept linked', Store.projects()[0].concepts.length === 1);
check('shown with its evidence', /whole engine/.test($('.concept-evidence').textContent));

// and the topic can see it from its own side
click(tabNamed('All'));
clickNode('C++');
check('the topic says where it was used', !!$('.evidence-built'));
check('naming the project', /Order Book/.test($('.evidence-built').textContent),
      $('.evidence-built')?.textContent);

/* ---------- 8. stats still fine ---------- */
click($$('.tab-fixed').find(t => t.dataset.view === 'stats'));
check('stats view shown', !$('#view-stats').hidden);
check('stat cards rendered', $$('#statCards .stat-card').length === 6);
check('heatmap rendered', $$('#heatmap .hm-cell').length === 26 * 7 + 7);
check('progress bar per field', $$('#domainProgress .dp-row').length === 5);

/* ---------- 9. ui state remembered ---------- */
const ui = JSON.parse(window.localStorage.getItem('learning-tree/ui/v1'));
check('active view persisted', ui.currentView === 'stats', JSON.stringify(ui));
// What is persisted always matches what the tree is actually showing.
check('active field matches the tree root', ui.activeField === Tree.rootId, JSON.stringify(ui));
check('inspector width persisted', Number.isFinite(ui.inspectorWidth), JSON.stringify(ui));
check('the new field still exists', !!Store.byId(newFieldId));

if (errors.length) {
  console.log('--- runtime errors ---');
  errors.forEach(e => console.log('  ' + e));
  fail += errors.length;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
