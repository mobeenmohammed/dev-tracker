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

const bundle = ['js/store.js', 'js/tree.js', 'js/views.js', 'js/problems.js', 'js/projects.js', 'js/applications.js', 'js/focus.js', 'js/app.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
  .join(String.fromCharCode(10) + ';' + String.fromCharCode(10));
window.eval(bundle + ';window.Store = Store; window.Tree = Tree; window.Views = Views;' +
  'window.Problems = Problems; window.Applications = Applications; window.Projects = Projects; window.Focus = Focus;');

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
/* Both views open only the branch being worked down, so reaching a sub-topic
   means drilling to it — which is what a person does, and what the checks
   below exercise explicitly where that is the point. */
const clickNode = name => {
  let n = nodeNamed(name);
  if (!n) {
    const target = Store.state.nodes.find(x => x.name.startsWith(name));
    if (target) {
      Store.ancestorsOf(target.id).forEach(ancestor => {
        const card = nodeNamed(ancestor.name);
        if (card) click(card.querySelector('.card') || card);
      });
      n = nodeNamed(name);
    }
  }
  if (!n) throw new Error('no node named ' + name);
  click(n.querySelector('.card') || n);
};
// a folder chip is not a field tab, so it never answers to a field's name
const fieldTabs = () => $$('#fieldTabs .tab:not(.tab-folder)');
const tabNamed  = name => fieldTabs().find(t => t.textContent.includes(name));

/* ---------- 1. tab bar ---------- */
// All, +, one per field, and the picker
check('tab per field plus All, + and the picker', fieldTabs().length === 7, `${fieldTabs().length} tabs`);
check('All tab present', !!tabNamed('All'));
check('C++ tab present', !!tabNamed('C++'));
check('field tab shows progress', /\d+%/.test(tabNamed('C++').textContent), tabNamed('C++').textContent);
check('All tab active on boot', tabNamed('All').classList.contains('is-active'));
/* All draws the fields, with no synthetic centre invented for it, and opens
   whichever one you are looking at rather than everything at once. */
check('the All view graphs the fields', treeNodes().length === Store.roots().length,
      `${treeNodes().length} cards vs ${Store.roots().length} fields`);
check('All is in graph mode', Tree.isGraph === true);

/* ---------- 2. focusing one field ---------- */
click(tabNamed('C++'));
/* A tree opens the field and its own branches, and below that only what is
   being worked down — a field with four deep branches is otherwise a wall. */
const cppCount = 1 + Store.childrenOf('cpp').length;
check('C++ tab becomes active', tabNamed('C++').classList.contains('is-active'));
check('tree re-roots on C++', treeNodes().length === cppCount, `${treeNodes().length} vs ${cppCount}`);
check('and starts with its own branches, not everything under them',
      cppCount < 1 + Store.descendantsOf('cpp').length);
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
/* Selecting Tooling opened it, so the tree is the field, its branches, and
   what is inside the one being worked down. */
const drilled = 1 + Store.childrenOf('cpp').length + Store.childrenOf('cpp-tooling').length;
check('tree grew', treeNodes().length === drilled, `${treeNodes().length} vs ${drilled}`);
check('and the branch being worked down is the one that opened',
      !!nodeNamed('CMake') && !nodeNamed('RAII'),
      treeNodes().map(nodeLabel).join(' | '));
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
check('the graph starts with the fields alone', !nodeNamed('OpenMP'),
      'a sub-topic is drawn before its field was opened');
clickNode('High Performance Computing');   // selecting a field opens it
check('selecting a field opens it', !!nodeNamed('OpenMP'),
      'the field did not unfold');
clickNode('OpenMP');
check('inspector reports last worked', /last worked/.test($('#inspectorBody').textContent),
      $('#inspectorBody').textContent.slice(0, 80));

/* ---------- 3d. the inspector reads top to bottom in the right order ---------- */
const headings = $$('#inspectorBody .insp-section h3').map(h => h.textContent.replace(/\s*\(.*/, ''));
check('inspector section order', headings.join(' > ') ===
      'What this is > Status > Resources & tasks > References > Connections > Progress > Time > Journal > Details > Actions',
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

/* "Fresh" means worked on within a week, so asserting it against the seed's
   own dates makes the suite fail on a calendar rather than on a change — it
   did, eight days after the newest seeded session. The work is logged here
   and taken away again, so the check is about the rule and not about how long
   ago the seed was written. */
const freshSession = Store.addSession({ nodeId: 'hpc-openmp', date: Store.todayISO(), minutes: 20 });
Tree.render();
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
clickNode('Mathematics');                   // opens the field it is in
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
clickNode('High Performance Computing');    // opens the field the far end is in
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
Store.deleteSession(freshSession.id);
window.Views.renderList();

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

// add a task for today, linked to a topic — the field first, then the part
$('#focusText').value = 'Finish the MPI collectives exercises';
check('the field list is grouped, not one long tree',
      $$('#focusTopic option').every(o => !o.value || Store.byId(o.value).parentId === null),
      $$('#focusTopic option').map(o => o.value).join(','));
check('the second step waits for a field', $('#focusSubTopic').hidden);

$('#focusTopic').value = 'hpc';
fire($('#focusTopic'), 'change');
check('picking a field offers its parts', !$('#focusSubTopic').hidden);
check('starting with the field as a whole',
      $('#focusSubTopic').value === '' && /Anywhere in/.test($('#focusSubTopic').options[0].textContent),
      $('#focusSubTopic').options[0].textContent);
$('#focusSubTopic').value = 'hpc-mpi';
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
/* Qualified by source, so two sites numbering a problem the same way cannot
   clear each other from the extension's queue. */
check('and qualifies them by source', ack && ack.keys, ['codeforces:1700C']);
check('it reports one added', ack && ack.added === 1, JSON.stringify(ack));
check('the solve is stored', Store.problemsMatching().length === beforeBridge + 1);

// Offering the same solve again must not duplicate it, but must still ack, or
// the extension would never clear its queue.
const second = await offerSolves([
  { source: 'codeforces', problemId: '1700C', title: 'Helping the Nature',
    tags: ['greedy'], difficulty: 1500, solvedAt: Store.todayISO() },
]);
check('a repeat handover is acknowledged too', !!second && second.keys.length === 1);
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

/* ---------- 7c-ter. the digest offered to the extension ---------- */
// Stand in for the bridge: listen for what the page broadcasts.
const nextDigest = (timeout = 1500) => new Promise(resolve => {
  const onMessage = ev => {
    if (!ev.data || ev.data.type !== 'dev-tracker/digest') return;
    window.removeEventListener('message', onMessage);
    resolve(ev.data);
  };
  window.addEventListener('message', onMessage);
  setTimeout(() => { window.removeEventListener('message', onMessage); resolve(null); }, timeout);
});

// A change to a solve should be offered again, so the panel on a problem page
// is not left showing something stale.
const digestPromise = nextDigest();
const known = Store.problemsMatching()[0];
Store.updateProblem(known.id, { mistake: 'forgot the base case' });
const shared = await digestPromise;

check('the tracker offers a digest', !!shared, 'nothing was broadcast');

/* And it can be asked for, so a listener that started late is not stranded. */
const askedFor = await (async () => {
  const wait = nextDigest();
  postToPage({ type: 'dev-tracker/digest-request' });
  return wait;
})();
check('a digest can be requested', !!askedFor, 'no answer to a request');
check('covering every solve', shared && shared.problems.length === Store.problemsMatching().length,
      shared && `${shared.problems.length} vs ${Store.problemsMatching().length}`);
check('carrying what went wrong',
      shared.problems.some(p => p.mistake === 'forgot the base case'));
check('and how much help was needed',
      shared.problems.every(p => 'independence' in p));
check('but not the free-text notes',
      shared.problems.every(p => !('notes' in p)), 'notes leaked into the digest');
check('nor the tags',
      shared.problems.every(p => !('tags' in p)));

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

// the same pipeline, drawn as flows. A ribbon needs an application that
// actually moved, so give one a real progression first.
const moved = Store.addApplication({ company: 'Moved On', stage: 'applied' });
Store.addApplicationEvent(moved.id, { date: Store.todayISO(), stage: 'interview', note: 'phone screen' });
Store.updateApplication(moved.id, { stage: 'interview' });
window.Applications.render();

click($$('[data-app-view]').find(b => b.dataset.appView === 'flow'));
check('the flow view opens', !$('#appFlow').hidden && $('#appBoard').hidden);
check('a chart is drawn', !!$('#appFlow .flow-chart'));
check('with a band per reached stage', $$('#appFlow .flow-bar').length > 0);
check('each band is labelled', $$('#appFlow .flow-label').length === $$('#appFlow .flow-bar').length);
check('and carries a hover title', !!$('#appFlow .flow-bar title'));
check('ribbons join the stages', $$('#appFlow .flow-ribbon').length > 0);
click($$('[data-app-view]').find(b => b.dataset.appView === 'board'));
check('and the list comes back', !$('#appBoard').hidden && $('#appFlow').hidden);
Store.deleteApplication(moved.id);
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
const booked = Store.problemsMatching()[0];
check('a revisit can be booked', booked.state === 'review');
check('the date is a week out', booked.reviewOn === Store.shiftDays(Store.todayISO(), 7));
/* Booked for next week means due next week, not the moment it was booked. */
check('it is not due yet', $('#revisitBlock').hidden, 'a future revisit surfaced immediately');
check('the row shows its state', /Needs review/.test($('#problemList .p-state').textContent));

/* Un-booking has to undo the flag too, or it could never leave the queue. */
$('#pd-review').value = '';
fire($('#pd-review'), 'change');
check('un-booking clears the flag', Store.problemsMatching()[0].state === 'solved');
check('and the date', Store.problemsMatching()[0].reviewOn === '');

/* Once the date arrives it surfaces, saying why it is there. */
Store.updateProblem(booked.id, { state: 'review', reviewOn: Store.shiftDays(Store.todayISO(), -1) });
window.Problems.render();
check('an overdue revisit appears', !$('#revisitBlock').hidden);
check('and lists it', $$('#revisitList .revisit-row').length === 1);
check('saying why it is there', /hint|off-by-one/.test($('#revisitList .rv-why').textContent),
      $('#revisitList .rv-why').textContent);

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

/* ---------- 8b. the heatmap is a way into the history ---------- */
const todayCell = $$('#heatmap .hm-cell').find(c => c.dataset.date === Store.todayISO());
check('every square knows its date', !!todayCell);
check('past squares are clickable', todayCell.getAttribute('role') === 'button');
check('future squares are not',
      $$('#heatmap .hm-cell.is-future').every(c => c.getAttribute('role') !== 'button'));

/* The hover says what the day held, in the tracker's own words. */
check('the tooltip names the day', /\d/.test(todayCell.title), todayCell.title);
check('and counts activities', /activit/.test(todayCell.title), todayCell.title);
check('listing what was done',
      /solved|studied|task|note|application/.test(todayCell.title) || /no activities/.test(todayCell.title),
      todayCell.title);

click(todayCell);
check('clicking opens the day', !$('#dayDetail').hidden);
check('the square is marked open', todayCell.classList.contains('is-open') ||
      !!$('#heatmap .hm-cell.is-open'));
check('the day is named in full', /\w+day|\d/.test($('.day-detail-head h3').textContent),
      $('.day-detail-head h3').textContent);
check('todays solves are listed', /Problems/.test($('#dayDetail').textContent),
      $('#dayDetail').textContent.slice(0, 120));

click($('#closeDay'));
check('and it closes again', $('#dayDetail').hidden);

/* A day with nothing on it says so rather than showing an empty box. */
/* The grid spans about 188 days, so -200 fell outside it and this quietly
   never ran. */
const emptyCell = $$('#heatmap .hm-cell').find(c => c.dataset.date === Store.shiftDays(Store.todayISO(), -150));
check('a day well in the past is on the grid', !!emptyCell, 'no cell at -150 days');
click(emptyCell);
check('a quiet day says so', /Nothing recorded/.test($('#dayDetail').textContent),
      $('#dayDetail').textContent.slice(0, 80));
click($('#closeDay'));

/* GitHub's word for this is contributions; ours is activity, so the two can
   never be confused with commits. */
check('nothing calls these contributions',
      !/contribution/i.test($('#view-stats').textContent), 'the word contributions appeared');

/* ---------- 9. ui state remembered ---------- */
const ui = JSON.parse(window.localStorage.getItem('learning-tree/ui/v1'));
check('active view persisted', ui.currentView === 'stats', JSON.stringify(ui));
// What is persisted always matches what the tree is actually showing.
check('active field matches the tree root', ui.activeField === Tree.rootId, JSON.stringify(ui));
check('inspector width persisted', Number.isFinite(ui.inspectorWidth), JSON.stringify(ui));
check('the new field still exists', !!Store.byId(newFieldId));

/* ---------- 10. connections: a branch drawn inside another tree ---------- */

/* Linear algebra lives under Maths. Connecting it into C++ should draw the
   whole branch inside the C++ tree without moving it out of Maths. */
Store.addConnection('math-linalg', 'cpp');
click(tabNamed('C++'));

const graftRoot = $$('#nodes .card.is-graft-root');
const connectEdges = () => $$('#links .link.is-connect');
const linalgBranch = 1 + Store.descendantsOf('math-linalg').length;

check('the connected branch arrives as a branch of this tree',
      $$('#nodes .node.is-borrowed').length === 1,
      `${$$('#nodes .node.is-borrowed').length} borrowed`);
/* And opens like any other branch when it is the one being worked down. */
clickNode('Linear Algebra');
const borrowed = $$('#nodes .node.is-borrowed');
check('opening it brings what is inside with it',
      borrowed.length === linalgBranch, `${borrowed.length} borrowed vs ${linalgBranch} in the branch`);
check('its sub-topics came with it', !!nodeNamed('Matrix Decompositions'));
check('the branch head is marked as the connection',
      graftRoot.length === 1, `${graftRoot.length} graft roots`);
check('and says where it came from',
      /from Mathematics/.test($('#nodes .card-origin').textContent),
      $('#nodes .card-origin') ? $('#nodes .card-origin').textContent : 'no origin line');
check('the connection edge is drawn in its own style',
      connectEdges().length === 1, `${connectEdges().length} connect edges`);
check('the tree grew by exactly the borrowed branch',
      treeNodes().length === 1 + Store.childrenOf('cpp').length + linalgBranch,
      `${treeNodes().length} cards`);

/* The head of a borrowed branch is a taller card, so the row it sits in has to
   make room for it rather than letting it run into the row below. */
check('a grafted tree still has no overlapping cards',
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
check('and the borrowed head is the taller card',
      (() => {
        const head = nodeNamed('Linear Algebra').querySelector('foreignObject');
        const kid  = nodeNamed('Matrix Decompositions').querySelector('foreignObject');
        return +head.getAttribute('height') > +kid.getAttribute('height');
      })());

/* References carry arrowheads too, and had the same too-short inset. */
Store.addLink('cpp-move', 'hpc-openmp', '', 'relates');
click(tabNamed('All'));
check('a reference arrow also stops outside its target card',
      (() => {
        const edge = $('#links .ref-link');
        if (!edge) return false;
        const [, x2, y2] = edge.getAttribute('d').match(/ (-?[\d.]+),(-?[\d.]+)$/);
        return ![...$$('#nodes foreignObject')].some(f => {
          const x = +f.getAttribute('x'), y = +f.getAttribute('y');
          return +x2 > x && +x2 < x + +f.getAttribute('width')
              && +y2 > y && +y2 < y + +f.getAttribute('height');
        });
      })(), $('#links .ref-link') ? $('#links .ref-link').getAttribute('d') : 'no reference drawn');

/* The All graph is not a hierarchy, so a connection is an edge there rather
   than a nesting — but still drawn as a connection, not as parentage. */
click(tabNamed('All'));
check('the graph draws the connection as its own kind of edge',
      connectEdges().length === 1, `${connectEdges().length} connect edges in the graph`);
check('and no card is borrowed in the graph, where each is drawn once',
      $$('#nodes .node.is-borrowed').length === 0);
/* The cards are painted over the links, so an arrow that ran to the centre of
   its target would have its head hidden underneath it. A card is a wide
   rectangle, so stopping at a single radius was not far enough either. */
check('the connection arrow stops short of the card it points at',
      (() => {
        const edge = $('#links .link.is-connect');
        const [, x2, y2] = edge.getAttribute('d').match(/L(-?[\d.]+),(-?[\d.]+)/);
        const target = [...$$('#nodes foreignObject')].find(f => {
          const x = +f.getAttribute('x'), y = +f.getAttribute('y');
          const w = +f.getAttribute('width'), h = +f.getAttribute('height');
          return +x2 > x && +x2 < x + w && +y2 > y && +y2 < y + h;
        });
        return !target;                     // the end must not land inside a card
      })(), $('#links .link.is-connect').getAttribute('d'));
check('the graph draws every card exactly once',
      treeNodes().length === new Set(treeNodes().map(nodeLabel)).size,
      `${treeNodes().length} cards, ${new Set(treeNodes().map(nodeLabel)).size} distinct`);
click(tabNamed('C++'));

/* Borrowed cards are a window, not a second copy: they do not offer to rename
   or grow the topic, only to go to where it lives. */
const borrowedActs = [...nodeNamed('Matrix Decompositions').querySelectorAll('.card-btn')]
  .map(b => b.dataset.act);
check('a borrowed card offers no rename', !borrowedActs.includes('rename'), borrowedActs.join(','));
check('nor a sub-topic',                  !borrowedActs.includes('child'),  borrowedActs.join(','));
check('but does offer its origin',        borrowedActs.includes('origin'),  borrowedActs.join(','));

/* And the branch is still in its own tree, unchanged. */
click(tabNamed('Mathematics'));
check('the branch is still in its own tree', !!nodeNamed('Linear Algebra'));
check('drawn there as its own, not borrowed',
      !nodeNamed('Linear Algebra').classList.contains('is-borrowed'));
check('its parent never changed', Store.byId('math-linalg').parentId === 'math',
      String(Store.byId('math-linalg').parentId));

/* Following a borrowed card lands on the topic in the tree it belongs to. */
click(tabNamed('C++'));
const originBtn = [...nodeNamed('Linear Algebra').querySelectorAll('.card-btn')]
  .find(b => b.dataset.act === 'origin');
click(originBtn);
check('the origin button opens the field it lives in',
      tabNamed('Mathematics').classList.contains('is-active'));
check('with that topic selected', Tree.selectedId === 'math-linalg', String(Tree.selectedId));

/* The inspector can make and break connections from either end. */
window.Views.renderInspector('math-linalg');
const connSection = $$('#inspectorBody .insp-section')
  .find(s => /^Connections/.test(s.querySelector('h3').textContent));
check('the inspector has a connections section', !!connSection);
check('it reports where this branch is shown',
      /is shown under/.test(connSection.textContent), connSection.textContent.slice(0, 120));
check('a topic cannot offer to connect into itself',
      ![...connSection.querySelectorAll('option')].some(o => o.value === 'math-linalg'));
check('nor anything already drawn below it',
      ![...connSection.querySelectorAll('option')].some(o => o.value === 'math-decomp'));

click(connSection.querySelector('.task-del'));
check('removing it from the inspector works', Store.state.connections.length === 0);
check('and the topic is untouched', !!Store.byId('math-linalg'));

click(tabNamed('C++'));
check('the C++ tree is its own size again',
      treeNodes().length === 1 + Store.childrenOf('cpp').length, `${treeNodes().length} cards`);
check('and no connection edge is left behind', connectEdges().length === 0);

/* ---------- 11. many fields stay navigable ---------- */

/* The complaint this answers: with enough fields the bar scrolled as a whole,
   so All, + and every fixed view were pushed off the right and reaching any of
   them meant scrolling sideways first. */
const manyBefore = Store.roots().length;
'abcdefghijklmnop'.split('').forEach(n => Store.addNode({ parentId: null, name: 'Field ' + n }));
click(tabNamed('All'));                       // re-renders the bar

check('the fields really did grow', Store.roots().length === manyBefore + 16,
      String(Store.roots().length));

const scroller = $('#fieldTabsScroll');

/* Only loose fields and folder chips scroll; everything else is pinned. A
   folder is one slot however much is filed on it. */
check('only the loose fields and the folder chips sit in the scrolling strip',
      scroller.querySelectorAll('.tab').length ===
        Store.roots().filter(r => !r.folderId).length + Store.folders().length,
      `${scroller.querySelectorAll('.tab').length} in the strip vs ` +
      `${Store.roots().filter(r => !r.folderId).length} loose fields and ` +
      `${Store.folders().length} folders`);
check('All is pinned outside it',      !scroller.contains(tabNamed('All')));
check('the new-field button too',      !scroller.contains($('#addFieldTab')));
check('and the picker',                !scroller.contains($('#fieldPickerBtn')));
check('the fixed views are outside it entirely',
      $$('.tabs-fixed .tab').every(t => !scroller.contains(t)));
check('the picker says how many fields there are',
      $('#fieldPickerCount').textContent === Store.roots().length + ' fields',
      $('#fieldPickerCount').textContent);

/* The picker reaches any field without scrolling anything. */
click($('#fieldPickerBtn'));
check('the picker opens', !$('#fieldPicker').hidden);
check('it lists every field plus All',
      $$('#fieldPickerList .picker-row').length === Store.roots().length + 1,
      `${$$('#fieldPickerList .picker-row').length} rows`);
check('it drops below the bar rather than over the fixed views',
      !$('.tabs-fixed').contains($('#fieldPicker')));
check('at most one row reads as the field in focus',
      $$('#fieldPickerList .picker-row.is-open').length <= 1);

const pickerSearch = $('#fieldPickerSearch');
pickerSearch.value = 'Field k';
fire(pickerSearch, 'input');
check('typing filters it down',
      $$('#fieldPickerList .picker-row').length === 1,
      `${$$('#fieldPickerList .picker-row').length} rows for "Field k"`);
check('to the one that matches',
      /Field k/.test($('#fieldPickerList .picker-row').textContent),
      $('#fieldPickerList .picker-row').textContent);

key(pickerSearch, 'Enter');
check('Enter opens it', Tree.rootId === Store.roots().find(f => f.name === 'Field k').id,
      String(Tree.rootId));
check('and the picker closes behind it', $('#fieldPicker').hidden);
check('its tab is the active one', tabNamed('Field k').classList.contains('is-active'));

/* Arrow keys move a cursor through the list. */
click($('#fieldPickerBtn'));
const firstCursor = $('#fieldPickerList .picker-row.is-cursor').textContent;
key($('#fieldPickerSearch'), 'ArrowDown');
check('arrow keys move the cursor',
      $('#fieldPickerList .picker-row.is-cursor').textContent !== firstCursor, firstCursor);
key($('#fieldPickerSearch'), 'Escape');
check('Escape closes it', $('#fieldPicker').hidden);

/* A new field can be started from the picker as well as from the bar. */
click($('#fieldPickerBtn'));
click($('#fieldPickerNew'));
check('the picker closes to name a new field', $('#fieldPicker').hidden);
check('and hands over the inline name box', !!$('.tab-input'));
key($('.tab-input'), 'Escape');

/* Clicking a field far along the strip still opens it. */
const lastField = Store.roots()[Store.roots().length - 1];
click(tabNamed(lastField.name));
check('a field at the far end of the strip opens',
      Tree.rootId === lastField.id, String(Tree.rootId));
check('and its tab is marked active',
      tabNamed(lastField.name).classList.contains('is-active'));

/* ---------- 12. deleting the field you are looking at ---------- */

/* This used to strand the canvas on a made-up "My Learning Tree" card: the
   tab and the tree stayed rooted on a field that no longer existed, and the
   only thing left to draw was a stand-in for it. */
const doomed = Store.addNode({ parentId: null, name: 'Temporary Field' });
click(tabNamed('All'));                       // rebuild the bar so its tab exists
click(tabNamed('Temporary Field'));
check('the temporary field opens', Tree.rootId === doomed.id, String(Tree.rootId));

clickNode('Temporary Field');
click($('#deleteBtn'));

check('the field is gone', !Store.byId(doomed.id));
check('the tree falls back to All', Tree.rootId === null, String(Tree.rootId));
check('which is the graph, not a tree of nothing', Tree.isGraph === true);
check('the All tab is the active one', tabNamed('All').classList.contains('is-active'));
check('no tab is left for the deleted field', !tabNamed('Temporary Field'));
check('and nothing persisted points at it',
      JSON.parse(window.localStorage.getItem('learning-tree/ui/v1')).activeField === null,
      window.localStorage.getItem('learning-tree/ui/v1'));

/* Nothing anywhere invents a card that is not a topic. */
const profileName = Store.state.profile.name;
check('no card stands in for the whole tree',
      treeNodes().every(el => nodeLabel(el) !== profileName), profileName);
check('every card drawn is a real topic',
      treeNodes().every(el => !!Store.state.nodes.find(n => n.name === nodeLabel(el))),
      treeNodes().map(nodeLabel).filter(l => !Store.state.nodes.some(n => n.name === l)).join(','));

/* ---------- 13. searching does not redraw on every keystroke ---------- */

click(tabNamed('C++'));
Tree.setQuery('');
const searchBox = $('#search');
const lit = () => $$('#nodes .node.is-match').length;

searchBox.value = 'cma';
fire(searchBox, 'input');
searchBox.value = 'cmak';
fire(searchBox, 'input');
searchBox.value = 'cmake';
fire(searchBox, 'input');
check('typing has not redrawn the tree yet', lit() === 0, `${lit()} lit already`);

await new Promise(r => setTimeout(r, 200));
check('the redraw lands once the typing pauses', lit() >= 1, `${lit()} lit`);

/* Enter must not wait for a pause it has just interrupted. */
searchBox.value = 'sanitiz';
fire(searchBox, 'input');
key(searchBox, 'Enter');
check('Enter applies the search straight away',
      $$('#nodes .node.is-match').length >= 1 && lit() > 0 &&
      /Sanitiz/.test([...$$('#nodes .node.is-match')].map(nodeLabel).join(' ')),
      [...$$('#nodes .node.is-match')].map(nodeLabel).join(','));
check('and jumps to the match', /Sanitiz/.test(Store.byId(Tree.selectedId).name),
      Store.byId(Tree.selectedId).name);

searchBox.value = '';
Tree.setQuery('');

/* ---------- 14. what the review turned up ---------- */

/* A leaf with a branch connected into it counts that branch, so its badge
   offers to open it — folding used to count real sub-topics only, and the
   badge did nothing when clicked. */
Store.addConnection('math-linalg', 'cpp-raii');     // RAII has no sub-topics
click(tabNamed('C++'));
clickNode('Core Language');                          // open the branch it is in
const closedCount = treeNodes().length;
const raiiFold = nodeNamed('RAII').querySelector('.card-badge');
check('a leaf with a branch connected in says there is something inside',
      !!raiiFold && raiiFold.style.display !== 'none' && /^\+/.test(raiiFold.textContent),
      raiiFold ? raiiFold.textContent : 'no badge');
click(raiiFold);
check('and its badge opens that branch',
      treeNodes().length > closedCount, `${treeNodes().length} vs ${closedCount}`);
check('which is what got selected', Tree.selectedId === 'cpp-raii', String(Tree.selectedId));

/* Following a borrowed card must land on the topic, not be dragged back out
   to the whole tree by the fit that changing view schedules a frame later. */
const borrowedHead = [...nodeNamed('Linear Algebra').querySelectorAll('.card-btn')]
  .find(b => b.dataset.act === 'origin');
click(borrowedHead);
const landed = $('#viewport').getAttribute('transform');
await new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r)));
check('the view stays where following the connection put it',
      $('#viewport').getAttribute('transform') === landed,
      `${landed} became ${$('#viewport').getAttribute('transform')}`);
Store.state.connections.slice().forEach(c => Store.deleteConnection(c.id));

/* Escape closes the picker. It must not also clear what was selected. */
click(tabNamed('C++'));
clickNode('RAII');
check('something is selected', Tree.selectedId === 'cpp-raii', String(Tree.selectedId));
click($('#fieldPickerBtn'));
key($('#fieldPickerSearch'), 'Escape');
check('Escape closes the picker', $('#fieldPicker').hidden);
check('and leaves the selection alone', Tree.selectedId === 'cpp-raii', String(Tree.selectedId));

/* Falling back to All has to tell the canvas it is a graph now. */
const throwaway = Store.addNode({ parentId: null, name: 'Throwaway' });
click(tabNamed('All'));
click(tabNamed('Throwaway'));
clickNode('Throwaway');
click($('#deleteBtn'));
check('the canvas knows it is a graph again',
      $('.canvas-wrap').classList.contains('is-graph'));
check('the re-layout button works again', !$('#relayoutBtn').disabled);
check('and the hint describes the graph', /Select a field/.test($('#canvasHint').textContent),
      $('#canvasHint').textContent);

/* ---------- 15. a failed save is put in front of you ---------- */

/* Silently losing everything typed after the quota is reached is the worst
   thing this could do, so it says so and offers the way out. */
check('no warning while saving works', $('#storageWarning').hidden);

/* jsdom's Storage is a proxy that turns an assignment into a stored key, so
   the failure has to be injected on the prototype. */
const realSetItem = window.Storage.prototype.setItem;
window.Storage.prototype.setItem = () => {
  const err = new Error('exceeded the quota');
  err.name = 'QuotaExceededError';
  throw err;
};
Store.addNode({ parentId: null, name: 'One too many' });

check('a failed save raises a warning', !$('#storageWarning').hidden);
check('it says changes are not being saved',
      /no longer being saved/.test($('#storageWarningText').textContent),
      $('#storageWarningText').textContent);
check('and it says how big the state is',
      /\d+(\.\d+)? MB/.test($('#storageWarningText').textContent),
      $('#storageWarningText').textContent);
check('with a way to rescue the data', !!$('#storageExport'));

window.Storage.prototype.setItem = realSetItem;
Store.updateNode(Store.roots()[0].id, { name: Store.roots()[0].name });
check('and it clears once saving works again', $('#storageWarning').hidden);

/* ---------- 16. folders in the picker ---------- */

/* Fields are separate trees, so a folder cannot be a node: it is a shelf you
   find them on, and it lives in the picker rather than on the canvas. */
const shelf = Store.addFolder('Number Shelf');
Store.setNodeFolder('math', shelf.id);
Store.setNodeFolder('hpc', shelf.id);
click(tabNamed('All'));
click($('#fieldPickerBtn'));

const pickerRow = sel => $$('#fieldPickerList ' + sel);
const rowNames = () => pickerRow('.picker-row').map(r => r.querySelector('.picker-name').textContent);

check('the folder is listed', rowNames().includes('Number Shelf'), rowNames().join(' | '));
check('and it is a folder, not a field',
      pickerRow('.picker-folder').length === 1, `${pickerRow('.picker-folder').length}`);
check('it says how many are on it',
      /2 fields/.test($('#fieldPickerList .picker-folder .picker-meta').textContent),
      $('#fieldPickerList .picker-folder .picker-meta').textContent);
/* A folder nobody has touched is open, so filing a field never makes it
   vanish from anywhere. */
check('its fields are shown from the start',
      rowNames().includes('High Performance Computing'), rowNames().join(' | '));
check('they are drawn as belonging to it',
      pickerRow('.picker-row.is-nested').length === 2,
      `${pickerRow('.picker-row.is-nested').length}`);
check('and the caret says it is open',
      $('#fieldPickerList .picker-folder').classList.contains('is-expanded'));
check('the loose fields are there too', rowNames().includes('C++'), rowNames().join(' | '));

/* folding it away hides them */
click($('#fieldPickerList .picker-folder'));
check('folding it hides its fields', pickerRow('.picker-row.is-nested').length === 0,
      `${pickerRow('.picker-row.is-nested').length} still shown`);
check('but the folder itself stays', rowNames().includes('Number Shelf'), rowNames().join(' | '));

check('but the strip is unaffected: a folder is one chip there either way',
      $$('#fieldTabsScroll .tab').filter(t => t.dataset.folder === shelf.id).length === 1,
      $$('#fieldTabsScroll .tab').map(t => t.dataset.field || t.dataset.folder).join(','));

click($('#fieldPickerList .picker-folder'));
check('unfolding brings them back in the picker',
      pickerRow('.picker-row.is-nested').length === 2,
      `${pickerRow('.picker-row.is-nested').length} in the picker`);

/* and they open like any other field */
const shelved = pickerRow('.picker-row.is-nested').find(r => r.dataset.field === 'hpc');
click(shelved);
check('a field opens from inside a folder', Tree.rootId === 'hpc', String(Tree.rootId));
check('the picker closed behind it', $('#fieldPicker').hidden);
click($('#fieldPickerBtn'));

/* searching must not let a closed folder hide the only match */
const box = $('#fieldPickerSearch');
box.value = 'High Perf';
fire(box, 'input');
check('a search opens the folder holding the match',
      rowNames().includes('High Performance Computing'), rowNames().join(' | '));
check('and the folder is shown above it',
      rowNames()[0] === 'Number Shelf', rowNames().join(' | '));
box.value = '';
fire(box, 'input');

/* keyboard: right opens, left closes, Enter toggles */
pickerRow('.picker-folder')[0].dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
key(box, 'ArrowRight');
check('right opens a folder', pickerRow('.picker-row.is-nested').length === 2,
      `${pickerRow('.picker-row.is-nested').length}`);
key(box, 'ArrowLeft');
check('left closes it', pickerRow('.picker-row.is-nested').length === 0,
      `${pickerRow('.picker-row.is-nested').length}`);
key(box, 'Enter');
check('Enter on a folder opens it rather than jumping anywhere',
      pickerRow('.picker-row.is-nested').length === 2 && !$('#fieldPicker').hidden,
      `${pickerRow('.picker-row.is-nested').length} shelved, hidden=${$('#fieldPicker').hidden}`);

/* a new folder is named in the list, so the picker stays open for it */
click($('#fieldPickerNewFolder'));
check('naming a new folder happens in the list', !!$('#fieldPickerList .picker-rename'));
check('and the picker stayed open', !$('#fieldPicker').hidden);
const nameBox = $('#fieldPickerList .picker-rename');
nameBox.value = 'Systems';
key(nameBox, 'Enter');
check('the folder is made', Store.folders().map(f => f.name).includes('Systems'),
      Store.folders().map(f => f.name).join(','));
check('and it starts open', rowNames().includes('Systems'), rowNames().join(' | '));

/* removing a shelf never removes what was on it */
const fieldsBefore = Store.roots().length;
const mathsRow = pickerRow('.picker-folder').find(r => /Number Shelf/.test(r.textContent));
click(mathsRow.querySelector('.picker-del'));
check('removing the folder keeps every field', Store.roots().length === fieldsBefore,
      `${Store.roots().length} vs ${fieldsBefore}`);
check('and puts them back at the top level',
      Store.byId('hpc').folderId === null, String(Store.byId('hpc').folderId));
check('the folder is gone from the list', !rowNames().includes('Number Shelf'),
      rowNames().join(' | '));
click(doc.body);

/* A field is filed from its own Details panel, where everything else about
   where a topic sits is edited. */
const filing = Store.addFolder('Filing');
window.Views.renderInspector('cpp');
const folderSelect = $('#f-folder');
check('a field can be filed from its details', !!folderSelect);
check('the folders are offered',
      [...folderSelect.options].some(o => o.textContent === 'Filing'),
      [...folderSelect.options].map(o => o.textContent).join(','));
folderSelect.value = filing.id;
$('#detailsForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
check('choosing one files it', Store.byId('cpp').folderId === filing.id,
      String(Store.byId('cpp').folderId));
check('without moving it in the tree', Store.byId('cpp').parentId === null,
      String(Store.byId('cpp').parentId));

/* A sub-topic already has a place, so it is not offered one. */
window.Views.renderInspector('cpp-move');
check('a sub-topic is not offered a folder', !$('#f-folder'));

/* The strip announces each folder and puts its fields straight after it. */
click(tabNamed('All'));
const stripEls = $$('#fieldTabsScroll .tab');
const chipAt = stripEls.findIndex(t => t.dataset.folder === filing.id);
const filed = Store.roots().filter(r => r.folderId === filing.id).map(r => r.id);

check('the folder has a chip in the strip', chipAt >= 0,
      stripEls.map(t => t.dataset.folder || t.dataset.field).join(','));
check('the chip is named', /Filing/.test(stripEls[chipAt].textContent),
      stripEls[chipAt].textContent);
check('a filed field is not a tab of its own',
      !$$('#fieldTabsScroll .tab').some(t => filed.includes(t.dataset.field)),
      $$('#fieldTabsScroll .tab').map(t => t.dataset.field).join(','));
check('the chip says how many it holds',
      $(`#fieldTabsScroll .tab[data-folder="${filing.id}"] .tab-pct`).textContent
        === String(filed.length),
      $(`#fieldTabsScroll .tab[data-folder="${filing.id}"] .tab-pct`).textContent);

/* Clicking the chip drops its fields below it, the way the fields button
   drops every field below itself. */
check('the panel starts closed', $('#folderMenu').hidden);
click($(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`));
check('clicking the chip opens a panel below it', !$('#folderMenu').hidden);
check('it lists exactly what is filed there',
      $$('#folderMenu .picker-row').map(r => r.dataset.field).sort().join() === filed.slice().sort().join(),
      $$('#folderMenu .picker-row').map(r => r.dataset.field).join(','));
check('the panel is outside the strip, which would clip it',
      !$('#fieldTabsScroll').contains($('#folderMenu')));
check('and outside the bar, so it covers nothing pinned there',
      !$('.tabbar').contains($('#folderMenu')));

/* And a field is chosen from it, which is the whole point. */
click($$('#folderMenu .picker-row').find(r => r.dataset.field === 'cpp'));
check('choosing a field from the panel opens it', Tree.rootId === 'cpp', String(Tree.rootId));
check('and the panel closes behind it', $('#folderMenu').hidden);
check('the chip carries the underline for the field inside it',
      $(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`).classList.contains('is-active'));

/* It behaves like the other panels: keyboard, and a click anywhere closes. */
click($(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`));
check('it reopens', !$('#folderMenu').hidden);
key(doc.body, 'ArrowDown');
check('arrow keys move a cursor through it',
      $$('#folderMenu .picker-row.is-cursor').length === 1);
key(doc.body, 'Escape');
check('Escape closes it', $('#folderMenu').hidden);

click($(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`));
click(doc.body);
check('and so does a click anywhere else', $('#folderMenu').hidden);

/* Opening one panel puts the others away. */
click($(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`));
click($('#fieldPickerBtn'));
check('opening the fields picker closes a folder panel', $('#folderMenu').hidden);
check('and the picker is the one showing', !$('#fieldPicker').hidden);
click($(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`));
check('and the other way round', $('#fieldPicker').hidden && !$('#folderMenu').hidden,
      `picker hidden=${$('#fieldPicker').hidden} menu hidden=${$('#folderMenu').hidden}`);
click(doc.body);

Store.deleteFolder(filing.id);
click(tabNamed('All'));
check('removing the folder takes its chip with it',
      !$(`#fieldTabsScroll .tab[data-folder="${filing.id}"]`));
check('but not its fields',
      $$('#fieldTabsScroll .tab').some(t => t.dataset.field === 'cpp'));

/* A panel fixed to the viewport cannot follow its chip, so scrolling the strip
   must put it away rather than leave it hanging over nothing. */
const anchored = Store.addFolder('Anchored');
Store.setNodeFolder('cpp', anchored.id);
click(tabNamed('All'));
click($(`#fieldTabsScroll .tab[data-folder="${anchored.id}"]`));
check('the panel is up', !$('#folderMenu').hidden);
fire($('#fieldTabsScroll'), 'scroll');
check('scrolling the strip closes it', $('#folderMenu').hidden);

/* The extension delivering a solve rebuilds the bar with no click involved,
   which is the one way the strip can change underneath an open panel. */
click($(`#fieldTabsScroll .tab[data-folder="${anchored.id}"]`));
const staleChip = $(`#fieldTabsScroll .tab[data-folder="${anchored.id}"]`);
await offerSolves([
  { source: 'codeforces', problemId: 'FOLDER1', title: 'Arrived while open',
    tags: [], solvedAt: Store.todayISO() },
]);
const freshChip = $(`#fieldTabsScroll .tab[data-folder="${anchored.id}"]`);
check('the strip really was rebuilt', !doc.contains(staleChip));
check('the fresh chip still says it is open',
      freshChip && freshChip.getAttribute('aria-expanded') === 'true',
      freshChip && freshChip.getAttribute('aria-expanded'));
check('and it is still showing', !$('#folderMenu').hidden);

/* If the folder itself goes, the panel goes with it. */
Store.deleteFolder(anchored.id);
await offerSolves([
  { source: 'codeforces', problemId: 'FOLDER2', title: 'And another',
    tags: [], solvedAt: Store.todayISO() },
]);
check('a panel for a folder that no longer exists is put away', $('#folderMenu').hidden);

/* Folding a folder while a search is on would change nothing you can see and
   then surprise you once the box was cleared. */
click($('#fieldPickerBtn'));
const searchable = Store.folders()[0];
const openBefore = $$('#fieldPickerList .picker-row.is-nested').length;
const pbox = $('#fieldPickerSearch');
pbox.value = 'Field';
fire(pbox, 'input');
const headerWhileSearching = $('#fieldPickerList .picker-folder');
if (headerWhileSearching) click(headerWhileSearching);
pbox.value = '';
fire(pbox, 'input');
check('folding while searching is not done behind your back',
      $$('#fieldPickerList .picker-row.is-nested').length === openBefore,
      `${$$('#fieldPickerList .picker-row.is-nested').length} vs ${openBefore}`);
click(doc.body);

/* ---------- 17. what the second review turned up ---------- */

const named = Store.addFolder('Needs A Name');
Store.setNodeFolder('swe', named.id);
click(tabNamed('All'));
click($('#fieldPickerBtn'));
const namedRow = () => $$('#fieldPickerList .picker-folder')
  .find(r => r.dataset.folder === named.id);

/* Renaming a folder was advertised on the row but unreachable: the first click
   of the double-click toggled the folder and rebuilt the list, so the second
   landed on an element that was no longer in the document. */
check('a folder offers a rename control', !!namedRow().querySelector('.picker-edit'));
click(namedRow().querySelector('.picker-edit'));
check('it opens a rename box', !!$('#fieldPickerList .picker-rename'));
const renameBox = $('#fieldPickerList .picker-rename');
renameBox.value = 'Engineering';
key(renameBox, 'Enter');
check('and the new name sticks',
      Store.folders().find(f => f.id === named.id).name === 'Engineering',
      Store.folders().find(f => f.id === named.id).name);

/* Double-click still works, because the handler is on the list rather than on
   a row that the first click throws away. */
click(namedRow());
namedRow().dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
check('double-clicking a folder still opens the box too',
      !!$('#fieldPickerList .picker-rename'));
key($('#fieldPickerList .picker-rename'), 'Escape');
click(doc.body);

/* The folder panel took every keystroke while it was open, including ones
   meant for something being typed into. */
click($(`#fieldTabsScroll .tab[data-folder="${named.id}"]`));
check('the panel is open', !$('#folderMenu').hidden);
const searchEl = $('#search');
searchEl.focus();
searchEl.value = 'CUDA';
const enterEv = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
searchEl.dispatchEvent(enterEv);
check('Enter in the search box is not swallowed by the panel', !enterEv.defaultPrevented);
check('it did not open a field behind your back', Tree.rootId !== 'swe', String(Tree.rootId));
check('and the panel got out of the way', $('#folderMenu').hidden);
searchEl.value = '';
Tree.setQuery('');

/* Deleting a folder must not leave an open Details panel offering it. */
window.Views.renderInspector('swe');
check('the field can be filed', !!$('#f-folder'));
check('and its folder is offered',
      [...$('#f-folder').options].some(o => o.value === named.id));
click($('#fieldPickerBtn'));
click(namedRow().querySelector('.picker-del'));
click(doc.body);
check('deleting it takes it out of the open Details panel',
      !$('#f-folder') || ![...$('#f-folder').options].some(o => o.value === named.id),
      $('#f-folder') ? [...$('#f-folder').options].map(o => o.value).join(',') : 'no select');

/* ---------- 18. sub-folders ---------- */

const outer = Store.addFolder('Broad Subject');
const inner = Store.addFolder('One Part', outer.id);
Store.setNodeFolder('math', inner.id);
Store.setNodeFolder('hpc', outer.id);
click(tabNamed('All'));

const chipFor = id => $(`#fieldTabsScroll .tab[data-folder="${id}"]`);
const menuRows = () => $$('#folderMenu .picker-row');
const namesIn = els => els.map(r => r.querySelector('.picker-name').textContent);

/* Only the outermost folder is a chip; what is inside it is inside its panel. */
check('a sub-folder gets no chip of its own', !chipFor(inner.id));
check('the outer folder does', !!chipFor(outer.id));
check('and it counts everything beneath it, however deep',
      chipFor(outer.id).querySelector('.tab-pct').textContent === '2',
      chipFor(outer.id).querySelector('.tab-pct').textContent);

/* Its panel nests: the sub-folder is a row you can open, with the fields on
   the outer folder alongside it. */
click(chipFor(outer.id));
check('the panel lists the sub-folder',
      namesIn(menuRows()).includes('One Part'), namesIn(menuRows()).join(' | '));
check('and the fields filed directly on the outer one',
      namesIn(menuRows()).includes('High Performance Computing'), namesIn(menuRows()).join(' | '));
const innerRow = () => menuRows().find(r => r.dataset.folder === inner.id);
check('the sub-folder is drawn as a folder', !!innerRow());
check('what is inside it is indented',
      $$('#folderMenu .picker-row.is-nested').length >= 1,
      `${$$('#folderMenu .picker-row.is-nested').length} nested rows`);
check('and its field is reachable from there',
      namesIn(menuRows()).includes('Mathematics'), namesIn(menuRows()).join(' | '));

/* Collapsing the sub-folder hides its field but not the folder. */
click(innerRow());
check('collapsing the sub-folder hides what is in it',
      !namesIn(menuRows()).includes('Mathematics'), namesIn(menuRows()).join(' | '));
check('but the sub-folder is still there', !!innerRow());
click(innerRow());
check('and opening it brings the field back',
      namesIn(menuRows()).includes('Mathematics'), namesIn(menuRows()).join(' | '));

/* Choosing a field from inside a sub-folder opens it, and the outer chip
   carries the underline even though the field is two levels down. */
click(menuRows().find(r => r.dataset.field === 'math'));
check('a field deep inside a folder opens', Tree.rootId === 'math', String(Tree.rootId));
check('and the panel closed', $('#folderMenu').hidden);
check('the outermost chip shows where you are',
      chipFor(outer.id).classList.contains('is-active'));

/* The picker nests the same way. */
click($('#fieldPickerBtn'));
const pickerNames = () => $$('#fieldPickerList .picker-row').map(r => r.querySelector('.picker-name').textContent);
check('the picker shows the outer folder', pickerNames().includes('Broad Subject'));
check('and the sub-folder inside it', pickerNames().includes('One Part'));
check('the sub-folder is drawn deeper than its parent',
      (() => {
        const rows = $$('#fieldPickerList .picker-row');
        const o = rows.find(r => r.dataset.folder === outer.id);
        const i = rows.find(r => r.dataset.folder === inner.id);
        return parseInt(i.style.paddingLeft || '0', 10) > parseInt(o.style.paddingLeft || '0', 10);
      })(), 'the sub-folder is not indented past its parent');

/* A sub-folder is made from the folder it goes inside. */
const outerRow = () => $$('#fieldPickerList .picker-row').find(r => r.dataset.folder === outer.id);
check('a folder offers to make one inside it', !!outerRow().querySelector('.picker-add'));
click(outerRow().querySelector('.picker-add'));
check('naming it happens in the list', !!$('#fieldPickerList .picker-rename'));
const subBox = $('#fieldPickerList .picker-rename');
subBox.value = 'Another Part';
key(subBox, 'Enter');
const made = Store.folders().find(f => f.name === 'Another Part');
check('the sub-folder is made', !!made);
check('and it is made inside the folder it was started from',
      made && made.parentId === outer.id, made && made.parentId);

/* Renaming and moving are the same control. */
click(outerRow().querySelector('.picker-edit'));
check('the editor offers a name', !!$('#fieldPickerList .picker-rename'));
check('and somewhere to move it to', !!$('#fieldPickerList .picker-move'));
check('it never offers to move a folder inside its own sub-folder',
      ![...$('#fieldPickerList .picker-move').options].some(o => o.value === inner.id),
      [...$('#fieldPickerList .picker-move').options].map(o => o.value).join(','));
const moveTo = $('#fieldPickerList .picker-move');
const nameIn = $('#fieldPickerList .picker-rename');
nameIn.value = 'Broad Subject';
key(nameIn, 'Enter');

/* Removing an outer folder brings what was inside it out, not down. */
const beforeRemoval = Store.roots().length;
click($$('#fieldPickerList .picker-row').find(r => r.dataset.folder === outer.id).querySelector('.picker-del'));
check('removing it keeps every field', Store.roots().length === beforeRemoval);
check('and its sub-folder comes out to the top level',
      Store.folderById(inner.id).parentId === null,
      String(Store.folderById(inner.id).parentId));
check('the field inside the sub-folder never moved',
      Store.byId('math').folderId === inner.id, String(Store.byId('math').folderId));
check('and the sub-folder now has a chip of its own',
      !!chipFor(inner.id));
click(doc.body);
Store.deleteFolder(inner.id);
Store.folders().slice().forEach(f => Store.deleteFolder(f.id));
click(tabNamed('All'));

/* ---------- 19. the focus stopwatch ---------- */

const Focus = window.Focus;
const rewindClock = ms => {
  const t = Store.activeFocus();
  if (t.startedAt != null) t.startedAt -= ms; else t.pausedAt -= ms;
};

click(tabNamed('C++'));
clickNode('CMake');
check('the inspector offers the stopwatch first', !!$('#focusBtn'),
      'no focus button in the Time section');
check('and logging by hand is tucked underneath', !!$('.insp-manual'));
check('the manual form is still there for backfilling', !!$('#sessionForm'));

/* Starting from the inspector opens the screen. */
click($('#focusBtn'));
check('the focus screen opens', !$('#focusScreen').hidden);
check('it names the topic', $('#focusSessionTopic').textContent === 'CMake',
      $('#focusSessionTopic').textContent);
check('the clock is running', !!Store.activeFocus() && Store.activeFocus().startedAt !== null);
check('and it says so', $('#focusState').textContent === 'running', $('#focusState').textContent);
check('the button offers to pause', $('#focusToggle').textContent === 'Pause',
      $('#focusToggle').textContent);
check('there is nothing to log yet', $('#focusStop').disabled);

/* Pausing is the whole point: being interrupted is recorded, not hidden. */
rewindClock(12 * 60000);
Focus.render();
check('the clock shows the time that has run', $('#focusElapsed').textContent === '12:00',
      $('#focusElapsed').textContent);
check('and stopping is now worth doing', !$('#focusStop').disabled);

click($('#focusToggle'));
check('pausing says so', $('#focusState').textContent === 'paused', $('#focusState').textContent);
check('the button offers to resume', $('#focusToggle').textContent === 'Resume');
check('and the interruption is reported',
      /Pulled away 1 time/.test($('#focusAway').textContent), $('#focusAway').textContent);
rewindClock(4 * 60000);
Focus.render();
check('time away does not count towards the session',
      $('#focusElapsed').textContent === '12:00', $('#focusElapsed').textContent);
check('but it is named', /4m of it/.test($('#focusAway').textContent), $('#focusAway').textContent);

click($('#focusToggle'));
check('resuming starts it again', $('#focusState').textContent === 'running');

/* What you are doing becomes the note on the session. */
const intent = $('#focusIntent');
intent.value = 'Toolchain files, chapter 3';
fire(intent, 'input');
await new Promise(r => setTimeout(r, 450));
check('what you are doing is saved as you type',
      Store.activeFocus().intent === 'Toolchain files, chapter 3', Store.activeFocus().intent);

/* Closing leaves it running, and the pill is the way back. */
click($('#focusClose'));
check('closing the screen does not stop the clock', !!Store.activeFocus());
check('the screen is put away', $('#focusScreen').hidden);
check('and a pill appears to get back to it', !$('#focusPill').hidden);
check('the pill shows the time', /12:/.test($('#focusPill').textContent), $('#focusPill').textContent);
check('the tab title says what is happening', /12:/.test(doc.title), doc.title);

click($('#focusPill'));
check('the pill brings the screen back', !$('#focusScreen').hidden);
check('and the pill steps aside while it is up', $('#focusPill').hidden);

/* Stopping logs it. */
const minutesBefore = Store.minutesFor('cpp-cmake', false);
const sessionsBefore = Store.state.sessions.length;
click($('#focusStop'));
check('stopping closes the screen', $('#focusScreen').hidden);
check('the clock is cleared', Store.activeFocus() === null);
check('the pill goes with it', $('#focusPill').hidden);
check('the tab title goes back to normal', !/\d+:\d\d/.test(doc.title), doc.title);
check('a session was logged', Store.state.sessions.length === sessionsBefore + 1);
check('for the time that actually ran',
      Store.minutesFor('cpp-cmake', false) === minutesBefore + 12,
      `${Store.minutesFor('cpp-cmake', false)} vs ${minutesBefore + 12}`);
check('carrying what you were doing',
      Store.sessionsFor('cpp-cmake', false)[0].note === 'Toolchain files, chapter 3',
      Store.sessionsFor('cpp-cmake', false)[0].note);
check('and the day counts it',
      Store.activityOn(Store.todayISO()).minutes >= 12);

/* The card's clock starts the stopwatch rather than jumping to a form. */
const clockBtn = [...nodeNamed('CMake').querySelectorAll('.card-btn')]
  .find(b => b.dataset.act === 'log');
check('a card offers to focus on its topic', !!clockBtn);
check('and says so', /Focus on this topic/.test(clockBtn.title), clockBtn.title);
click(clockBtn);
check('clicking it starts the clock on that topic',
      Store.activeFocus() && Store.activeFocus().nodeId === 'cpp-cmake',
      Store.activeFocus() && Store.activeFocus().nodeId);

/* Space pauses without touching the mouse; Escape leaves it running. Both
   stay out of the way while the note has the keyboard, or a space would be a
   space and Escape would only be leaving the field. */
check('the note takes the keyboard on opening', doc.activeElement === $('#focusIntent'),
      doc.activeElement.tagName);
key($('#focusIntent'), ' ');
check('Space in the note does not pause', Store.activeFocus().startedAt !== null);
key($('#focusIntent'), 'Escape');
check('Escape in the note leaves the field, not the screen',
      !$('#focusScreen').hidden && doc.activeElement !== $('#focusIntent'),
      doc.activeElement.tagName);

key(doc.body, ' ');
check('Space pauses', Store.activeFocus().startedAt === null);
key(doc.body, ' ');
check('and resumes', Store.activeFocus().startedAt !== null);
key(doc.body, 'Escape');
check('Escape puts the screen away', $('#focusScreen').hidden);
check('but leaves the clock running', !!Store.activeFocus());

/* Starting on a different topic asks before throwing the first one away. */
rewindClock(9 * 60000);
const cmakeBefore = Store.minutesFor('cpp-cmake', false);
window.confirm = () => false;
Focus.open('cpp-gdb');
check('declining leaves the first one alone',
      Store.activeFocus().nodeId === 'cpp-cmake', Store.activeFocus().nodeId);
check('and shows it rather than doing nothing', !$('#focusScreen').hidden);

window.confirm = () => true;
Focus.open('cpp-gdb');
check('agreeing logs the first before starting the second',
      Store.minutesFor('cpp-cmake', false) === cmakeBefore + 9,
      `${Store.minutesFor('cpp-cmake', false)} vs ${cmakeBefore + 9}`);
check('and the clock is now on the new topic',
      Store.activeFocus().nodeId === 'cpp-gdb', Store.activeFocus().nodeId);

/* Discarding throws the time away instead of logging it. */
rewindClock(6 * 60000);
const gdbBefore = Store.minutesFor('cpp-gdb', false);
const sessionCount = Store.state.sessions.length;
click($('#focusDiscard'));
check('discarding clears the clock', Store.activeFocus() === null);
check('and logs nothing', Store.state.sessions.length === sessionCount,
      `${Store.state.sessions.length} vs ${sessionCount}`);
check('the topic is unchanged', Store.minutesFor('cpp-gdb', false) === gdbBefore);
check('and the screen is closed', $('#focusScreen').hidden);

/* The keyboard shortcut works on whatever is selected. */
clickNode('CMake');
key(doc.body, 'w');
check('w focuses on the selected topic',
      Store.activeFocus() && Store.activeFocus().nodeId === 'cpp-cmake',
      Store.activeFocus() && Store.activeFocus().nodeId);
check('and opens the screen', !$('#focusScreen').hidden);

/* A stopwatch left running is picked back up, and says the stretch nobody was
   there for was not counted. */
Store.activeFocus().startedAt = Date.now() - 11 * 3600 * 1000;
Store.setFocusIntent(Store.activeFocus().intent);
const carried = JSON.parse(window.localStorage.getItem('learning-tree/state/v1'));
Store.importJSON(JSON.stringify(carried));
Focus.render();
check('a stopwatch left running comes back paused',
      Store.activeFocus() && Store.activeFocus().startedAt === null);
check('and the screen explains itself', !$('#focusNotice').hidden);
check('saying the lost stretch was not counted',
      /has not been counted/.test($('#focusNotice').textContent),
      $('#focusNotice').textContent);
click($('#focusDiscard'));
click(tabNamed('All'));

/* ---------- 20. the stopwatch follows the store ---------- */

/* The screen is a drawing of the store, so anything that changes the store has
   to be able to change the screen — including things several layers away that
   have no idea a stopwatch exists. */
click(tabNamed('C++'));
window.Views.renderInspector('cpp-sanitizers');
click($('#focusBtn'));
check('a stopwatch is running on a topic', !$('#focusScreen').hidden);

window.Views.renderInspector('cpp-sanitizers');
click($('#deleteBtn'));
check('deleting the topic being timed stops the clock', Store.activeFocus() === null);
check('and takes the screen down with it', $('#focusScreen').hidden,
      'a screen left counting for a topic that is gone');
check('and the pill too', $('#focusPill').hidden);
check('and the keyboard came back out with it',
      !$('#focusScreen').contains(doc.activeElement), doc.activeElement.tagName);

/* The title belongs to one of them at a time. */
Focus.open('cpp-cmake');
rewindClock(3 * 60000);
Focus.render();
check('the clock owns the title while it runs', /3:/.test(doc.title), doc.title);
window.Views.renderInspector('cpp-cmake');
click($('#f-name'));            // anything that triggers a refresh
Store.updateNode('cpp-cmake', { name: 'CMake' });
check('a redraw does not take the title back', /3:/.test(doc.title) || /\d:\d\d/.test(doc.title),
      doc.title);
click($('#focusDiscard'));
check('and it comes back to the profile once the clock is gone',
      doc.title === Store.state.profile.name, doc.title);

/* A note still waiting to be written must not land on the next session. */
Focus.open('cpp-cmake');
const noteBox = $('#focusIntent');
noteBox.value = 'belongs to the first one';
fire(noteBox, 'input');
click($('#focusDiscard'));                 // before the note has been written
Focus.open('cpp-gdb');
await new Promise(r => setTimeout(r, 450)); // long enough for the old write to fire
check('a note left over from a discarded session does not land on the next',
      (Store.activeFocus() || {}).intent === '',
      JSON.stringify((Store.activeFocus() || {}).intent));
click($('#focusDiscard'));

/* ---------- 21. what the third review turned up ---------- */

/* Coming back to a running session through the pill showed an empty note box,
   and stopping then wrote that emptiness over what had been typed. */
click(tabNamed('C++'));
Store.startFocus('cpp-tooling', 'Move semantics, chapter 3');
rewindClock(14 * 60000);
Focus.render();
check('the store is holding the note',
      Store.activeFocus().intent === 'Move semantics, chapter 3');
click($('#focusPill'));
check('coming back through the pill shows it again',
      $('#focusIntent').value === 'Move semantics, chapter 3', $('#focusIntent').value);
click($('#focusStop'));
check('and stopping logs it rather than wiping it',
      Store.sessionsFor('cpp-tooling', false)[0].note === 'Move semantics, chapter 3',
      Store.sessionsFor('cpp-tooling', false)[0].note);

/* The focus screen is modal, so the app's own shortcuts must not act behind it. */
Focus.open('cpp-tooling');
$('#focusIntent').blur();
const viewBefore = !$('#view-tree').hidden;
key(doc.body, 'l');
check('a shortcut does not switch the view behind the modal',
      !$('#view-tree').hidden === viewBefore, 'the view changed underneath it');
key(doc.body, 'g');
check('nor open the field picker under it', $('#fieldPicker').hidden);
const nodesBefore = Store.state.nodes.length;
key(doc.body, 'n');
check('nor add a topic you cannot see', Store.state.nodes.length === nodesBefore);
check('the modal is still up', !$('#focusScreen').hidden);
click($('#focusDiscard'));

/* A query left behind in a closed picker used to freeze folders everywhere. */
const shelfF = Store.addFolder('Outer Shelf');
const innerF = Store.addFolder('Inner Shelf', shelfF.id);
Store.setNodeFolder('math', innerF.id);
click(tabNamed('All'));

click($('#fieldPickerBtn'));
const pbox2 = $('#fieldPickerSearch');
pbox2.value = 'zzz-nothing-matches';
fire(pbox2, 'input');
key(pbox2, 'Escape');
check('the picker closed', $('#fieldPicker').hidden);
check('and nothing is left filtering behind it', pbox2.value === '', pbox2.value);

click($(`#fieldTabsScroll .tab[data-folder="${shelfF.id}"]`));
const innerInPanel = () => $$('#folderMenu .picker-row').find(r => r.dataset.folder === innerF.id);
const wasOpen = innerInPanel().classList.contains('is-expanded');
click(innerInPanel());
check('a sub-folder in a chip panel still folds',
      innerInPanel().classList.contains('is-expanded') !== wasOpen,
      'the folder would not move');
click(doc.body);

/* The picker opens every folder above the field you are on, not just one. */
click(tabNamed('All'));
/* With the outer folder folded away, a field two levels down has no row at
   all, so the cursor landed on "All" rather than on where you already are. */

/* Open that field, which is only reachable through the chip's panel now. */
click($(`#fieldTabsScroll .tab[data-folder="${shelfF.id}"]`));
/* The sub-folder was folded by the check above, so open it again first. */
if (!$$('#folderMenu .picker-row').some(r => r.dataset.field === 'math')) {
  click($$('#folderMenu .picker-row').find(r => r.dataset.folder === innerF.id));
}
const deepRow = $$('#folderMenu .picker-row').find(r => r.dataset.field === 'math');
check('the field is reachable two levels down', !!deepRow,
      $$('#folderMenu .picker-row').map(r => r.dataset.field || r.dataset.folder).join(','));
click(deepRow);
check('and it is the field in focus', Tree.rootId === 'math', String(Tree.rootId));

/* Now fold the outer folder away and come back to the picker. */
click($('#fieldPickerBtn'));
click($$('#fieldPickerList .picker-row').find(r => r.dataset.folder === shelfF.id));
check('the outer folder folds',
      !$$('#fieldPickerList .picker-row').some(r => r.dataset.folder === innerF.id));
click(doc.body);

click($('#fieldPickerBtn'));
const cursorRow = $('#fieldPickerList .picker-row.is-cursor');
check('opening the picker unfolds every folder above the field you are on',
      !!cursorRow && cursorRow.dataset.field === 'math',
      cursorRow ? cursorRow.textContent.trim() : 'no cursor row');
click(doc.body);

Store.deleteFolder(innerF.id);
Store.deleteFolder(shelfF.id);
click(tabNamed('All'));

/* ---------- 22. picking a topic for a task, in two steps ---------- */

click($$('.tab-fixed').find(t => t.dataset.view === 'focus'));
check('the picker lists the fields',
      $$('#focusTopic option').length > 1,
      `${$$('#focusTopic option').length} options`);

/* Folders group the fields, the way they do everywhere else. */
const taskFolder = Store.addFolder('Sciences');
const taskInner = Store.addFolder('Physical', taskFolder.id);
Store.setNodeFolder('hpc', taskInner.id);
window.Views.renderFocus();

const groupLabels = () => $$('#focusTopic optgroup').map(g => g.getAttribute('label'));
check('a folder becomes a group', groupLabels().includes('Sciences / Physical'),
      groupLabels().join(' | '));
check('written as a path rather than nested, which a select cannot do',
      groupLabels().every(l => !/^\s/.test(l)), groupLabels().join(' | '));
check('the field is inside its group',
      $('#focusTopic optgroup[label="Sciences / Physical"] option').value === 'hpc',
      $('#focusTopic optgroup[label="Sciences / Physical"] option').value);
check('fields on no folder are still listed',
      $$('#focusTopic > option').some(o => o.value === 'cpp'),
      $$('#focusTopic > option').map(o => o.value).join(','));

/* A field with no parts shows one control, not two. */
const bare = Store.addNode({ parentId: null, name: 'Bare Field' });
window.Views.renderFocus();
$('#focusTopic').value = bare.id;
fire($('#focusTopic'), 'change');
check('a field with nothing under it offers no second step',
      $('#focusSubTopic').hidden);

/* Switching field replaces the parts rather than leaving the old ones. */
$('#focusTopic').value = 'hpc';
fire($('#focusTopic'), 'change');
const partsFor = () => $$('#focusSubTopic option').map(o => o.value).filter(Boolean);
check('the parts are the ones in that field',
      partsFor().every(id => Store.domainOf(id).id === 'hpc'), partsFor().join(','));
$('#focusTopic').value = 'cpp';
fire($('#focusTopic'), 'change');
check('switching field swaps them out',
      partsFor().every(id => Store.domainOf(id).id === 'cpp'), partsFor().join(','));
check('and falls back to the field as a whole', $('#focusSubTopic').value === '');

/* Choosing only a field files the task against the field itself. */
$('#focusText').value = 'Read around C++ generally';
$('#focusForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const wholeField = Store.focusFor(Store.todayISO()).find(t => /Read around/.test(t.text));
check('a task can be filed against a whole field', wholeField && wholeField.nodeId === 'cpp',
      wholeField && wholeField.nodeId);

/* And a task about nothing in particular still needs no topic at all. */
$('#focusText').value = 'Career coach meeting';
$('#focusTopic').value = '';
fire($('#focusTopic'), 'change');
check('no topic is still the first choice', $('#focusSubTopic').hidden);
$('#focusForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const noTopic = Store.focusFor(Store.todayISO()).find(t => /Career coach/.test(t.text));
check('a task with no topic is fine', noTopic && noTopic.nodeId === null,
      noTopic && noTopic.nodeId);

Store.deleteNode(bare.id);
Store.deleteFolder(taskInner.id);
Store.deleteFolder(taskFolder.id);

/* ---------- 23. the All graph opens one field at a time ---------- */

click(tabNamed('All'));
Tree.select(null);
Store.state.links.slice().forEach(l => Store.deleteLink(l.id));
Store.state.connections.slice().forEach(c => Store.deleteConnection(c.id));
Tree.render();

const cardNames = () => treeNodes().map(nodeLabel);
check('it starts as the fields alone',
      cardNames().sort().join() === Store.roots().map(r => r.name).sort().join(),
      cardNames().join(' | '));

/* Selecting a field unfolds it; selecting another folds the first away. */
clickNode('High Performance Computing');
check('selecting a field shows what is in it',
      cardNames().includes('OpenMP'), cardNames().join(' | '));
check('and leaves the other fields folded',
      !cardNames().includes('Random Variables'), cardNames().join(' | '));

clickNode('Mathematics');
check('selecting another folds the first back up',
      !cardNames().includes('OpenMP'), cardNames().join(' | '));
check('and opens the new one', cardNames().includes('Random Variables'), cardNames().join(' | '));

Tree.select(null);
check('deselecting folds everything back to the fields',
      cardNames().sort().join() === Store.roots().map(r => r.name).sort().join(),
      cardNames().join(' | '));

/* A relationship into a folded field is not lost: it is drawn to the field. */
Store.addLink('math-prob', 'hpc-roofline', 'used for modelling');
Tree.render();
const refEnds = () => $$('#links .ref-link').length;
check('a reference between two folded fields is still drawn', refEnds() === 1,
      `${refEnds()} reference lines`);

clickNode('Mathematics');
check('opening one end keeps it drawn', refEnds() === 1, `${refEnds()} lines`);
check('and the topic it really starts from is now on screen',
      cardNames().includes('Probability & Statistics'), cardNames().join(' | '));

/* Several relationships into one folded field become one line with a count. */
/* Built from whatever topics are still alive at this point, so the check is
   about folding rather than about which fixtures earlier sections left. */
const mathSide = Store.descendantsOf('math').filter(n => !Store.linksFor(n.id).out.length);
const hpcSide  = Store.descendantsOf('hpc');
Store.addLink(mathSide[0].id, hpcSide[0].id);
Store.addLink(mathSide[1].id, hpcSide[1].id);
const foldedLinks = Store.state.links.length;
check('three separate relationships between the two fields', foldedLinks === 3,
      `${foldedLinks} links: ` + Store.state.links.map(l => l.from + '>' + l.to).join(','));

Tree.select(null);
Tree.render();
check('they fold into one line while both fields are folded',
      refEnds() === 1, `${refEnds()} lines`);
check('and it says how many', $('#links .edge-count text').textContent === String(foldedLinks),
      $('#links .edge-count') ? $('#links .edge-count text').textContent : 'no count drawn');

clickNode('High Performance Computing');
check('opening a field resolves them into separate lines', refEnds() === foldedLinks,
      `${refEnds()} lines`);
check('so the count is no longer needed', !$('#links .edge-count'));

/* Every line is laid over a casing, or crossings read as a smudge. */
check('the lines are drawn over a casing so they stay readable when they cross',
      $$('#links .link-casing').length >= refEnds(),
      `${$$('#links .link-casing').length} casings for ${refEnds()} lines`);

/* And there is a way to see the lot at once. */
click($('#expandAllBtn'));
check('the expand button shows every topic', treeNodes().length === Store.state.nodes.length,
      `${treeNodes().length} vs ${Store.state.nodes.length}`);
check('and says it is on', $('#expandAllBtn').classList.contains('is-on'));
check('the hint says so too', /Every topic at once/.test($('#canvasHint').textContent),
      $('#canvasHint').textContent);
click($('#expandAllBtn'));
check('pressing it again goes back to one field at a time',
      treeNodes().length < Store.state.nodes.length, `${treeNodes().length} cards`);

Store.state.links.slice().forEach(l => Store.deleteLink(l.id));
Tree.render();

/* ---------- 24. a tree opens the branch you are working down ---------- */

click(tabNamed('C++'));
Tree.select(null);
Tree.setQuery('');
const shown = () => treeNodes().map(nodeLabel);

check('it starts as the field and its own branches',
      shown().length === 1 + Store.childrenOf('cpp').length, shown().join(' | '));
check('nothing deeper than that', !shown().includes('RAII & Smart Pointers'),
      shown().join(' | '));

clickNode('Core Language');
check('selecting a branch opens it', shown().includes('RAII & Smart Pointers'),
      shown().join(' | '));
check('and the other branches stay shut', !shown().includes('CMake'), shown().join(' | '));

clickNode('Tooling');
check('selecting another closes the first', !shown().includes('RAII & Smart Pointers'),
      shown().join(' | '));
check('and opens the new one', shown().includes('CMake'), shown().join(' | '));

Tree.select(null);
check('deselecting closes back to the branches',
      shown().length === 1 + Store.childrenOf('cpp').length, shown().join(' | '));

/* The badge says what is inside a closed branch, and opens it. */
const toolingBadge = () => nodeNamed('Tooling').querySelector('.card-badge');
check('a closed branch says how much is inside',
      /^\+\d/.test(toolingBadge().textContent), toolingBadge().textContent);
click(toolingBadge());
check('and its badge opens it', shown().includes('CMake'), shown().join(' | '));
check('an open branch offers no fold-by-hand here',
      nodeNamed('Tooling').querySelector('.card-badge').style.display === 'none',
      nodeNamed('Tooling').querySelector('.card-badge').textContent);

/* Searching opens whatever branch the match is in. */
Tree.select(null);
/* Whatever is still alive two levels down at this point, so the check is
   about searching rather than about which fixtures earlier sections left. */
const deepOne = Store.childrenOf('cpp-tooling')[0];
Tree.setQuery(deepOne.name.slice(0, 5).toLowerCase());
check('a search opens the branch holding the match',
      shown().includes(deepOne.name), `${deepOne.name} — ` + shown().join(' | '));
check('and leaves the branches with no match shut',
      !shown().includes('RAII & Smart Pointers'), shown().join(' | '));
Tree.setQuery('');

/* And everything at once is still one button away. */
click($('#expandAllBtn'));
check('the expand button opens the whole tree',
      treeNodes().length === 1 + Store.descendantsOf('cpp').length,
      `${treeNodes().length} cards`);
click($('#expandAllBtn'));
check('and closes it back down',
      treeNodes().length === 1 + Store.childrenOf('cpp').length,
      `${treeNodes().length} cards`);

/* A reference between two cards on the same row has to be followable, not
   hidden behind whatever sits between them. */
Store.state.links.slice().forEach(l => Store.deleteLink(l.id));
Store.addLink('cpp-core', 'cpp-tooling', 'both needed');
Tree.render();
const arc = $('#links .ref-link');
check('a reference in a tree is drawn', !!arc);
check('it arcs clear of the row rather than running behind it',
      (() => {
        const d = arc.getAttribute('d');
        const ys = [...d.matchAll(/-?[\d.]+,(-?[\d.]+)/g)].map(m => Number(m[1]));
        const cards = $$('#nodes foreignObject')
          .map(f => ({ y: +f.getAttribute('y'), h: +f.getAttribute('height') }));
        const rowTop = Math.min(...cards.filter(c => c.y > 0).map(c => c.y));
        /* Its highest point must be above the top of the row it spans. */
        return Math.min(...ys) < rowTop;
      })(), arc.getAttribute('d'));
check('and it is laid over a casing', $$('#links .link-casing.is-ref').length >= 1);
Store.state.links.slice().forEach(l => Store.deleteLink(l.id));
Tree.render();

if (errors.length) {
  console.log('--- runtime errors ---');
  errors.forEach(e => console.log('  ' + e));
  fail += errors.length;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
