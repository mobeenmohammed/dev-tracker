/* Boots the page with UI state already saved, to exercise the restore path. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const seed = fs.readFileSync(path.join(ROOT, 'data/learning.json'), 'utf8');

async function boot(uiState, { deletedField = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost/',
  });
  const { window } = dom;
  window.SVGElement.prototype.getBBox = () => ({ x: -400, y: -400, width: 800, height: 800 });
  window.Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
  window.SVGElement.prototype.setPointerCapture = () => {};
  window.SVGElement.prototype.releasePointerCapture = () => {};
  window.fetch = async url => (String(url).includes('learning.json')
    ? { ok: true, json: async () => JSON.parse(seed) }
    : { ok: false, status: 404 });
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.prompt = () => null;
  window.alert = msg => errors.push('alert(): ' + msg);

  const state = JSON.parse(seed);
  if (deletedField) state.nodes = state.nodes.filter(n => n.id !== deletedField && n.parentId !== deletedField);
  window.localStorage.setItem('learning-tree/state/v1', JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
  window.localStorage.setItem('learning-tree/ui/v1', JSON.stringify(uiState));

  const bundle = ['js/store.js', 'js/tree.js', 'js/views.js', 'js/problems.js', 'js/projects.js', 'js/applications.js', 'js/app.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join(String.fromCharCode(10) + ';' + String.fromCharCode(10));
  window.eval(bundle + ';window.Store = Store; window.Tree = Tree;');
  await new Promise(r => setTimeout(r, 250));
  return { window, doc: window.document, errors };
}

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  <- ' + detail}`);
};

/* --- 1. reopens on the field and view it was left on, activity off --- */
{
  const { doc, window, errors } = await boot({ currentView: 'list', activeField: 'cpp', showActivity: false });
  const tabs = [...doc.querySelectorAll('#fieldTabs .tab')];
  check('list view restored', !doc.getElementById('view-list').hidden);
  check('list tab marked active', [...doc.querySelectorAll('.tab-fixed')].find(t => t.dataset.view === 'list').classList.contains('is-active'));
  check('field tab restored', window.Tree.rootId === 'cpp', String(window.Tree.rootId));
  check('tree rooted on that field', doc.querySelectorAll('#nodes .node').length === 1 + window.Store.descendantsOf('cpp').length);
  check('activity toggle restored off', window.Tree.showActivity === false);
  check('no relative dates drawn', doc.querySelectorAll('#nodes .sub-label').length === 0);
  check('toggle button reflects it', !doc.getElementById('activityBtn').classList.contains('is-on'));
  check('booted without errors', errors.length === 0, errors.join(' | '));
  // All, +, one per field, and the picker
  check('tabs still built', tabs.length === 7, `${tabs.length}`);
  check('and the picker knows the count',
        doc.getElementById('fieldPickerCount').textContent === '4 fields',
        doc.getElementById('fieldPickerCount').textContent);
}

/* --- 2. a field deleted since the last visit falls back to the combined tree --- */
{
  const { doc, window, errors } = await boot({ currentView: 'tree', activeField: 'cpp', showActivity: true }, { deletedField: 'cpp' });
  check('missing field falls back to All', window.Tree.rootId === null, String(window.Tree.rootId));
  check('All tab is active', [...doc.querySelectorAll('#fieldTabs .tab')][0].classList.contains('is-active'));
  check('no error on the missing field', errors.length === 0, errors.join(' | '));
}

/* --- 3. no saved UI state at all --- */
{
  const { doc, window, errors } = await boot(null);
  check('defaults to the combined tree', window.Tree.rootId === null);
  check('tree view shown by default', !doc.getElementById('view-tree').hidden);
  check('activity on by default', window.Tree.showActivity === true);
  check('clean boot', errors.length === 0, errors.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
