/* ============================================================
   app.js — bootstrap, tab bar, view switching, data import/export,
   theme, and keyboard shortcuts.
   ============================================================ */

(() => {

  const THEME_KEY = 'learning-tree/theme';
  const UI_KEY    = 'learning-tree/ui/v1';

  let currentView = 'tree';   // 'tree' | 'focus' | 'list' | 'stats'
  let activeField = null;     // null = every field in one tree
  let selectedId  = null;
  let showActivity = true;    // applied to the tree once it has been initialised
  let inspectorWidth = 340;   // px, dragged by the divider and remembered

  const VIEWS = ['tree', 'focus', 'list', 'stats'];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- ui state ---------------- */

  function persistUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        currentView, activeField,
        showActivity: Tree.showActivity,
        inspectorWidth,
      }));
    } catch { /* private mode */ }
  }

  /* Restoring runs before Tree.init(), so the flag is held here and applied
     once the tree has something to draw into. */

  function restoreUi() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch { /* ignore */ }
    if (!saved) return;

    currentView = VIEWS.includes(saved.currentView) ? saved.currentView : 'tree';
    /* A field deleted since last visit falls back to the combined tree. */
    activeField = saved.activeField && Store.byId(saved.activeField) ? saved.activeField : null;
    showActivity = saved.showActivity !== false;
    if (Number.isFinite(saved.inspectorWidth)) inspectorWidth = saved.inspectorWidth;
  }

  /* ---------------- resizable inspector ---------------- */

  const MIN_INSPECTOR = 280;
  const MAX_INSPECTOR = 720;

  function applyInspectorWidth() {
    const max = Math.min(MAX_INSPECTOR, Math.round(window.innerWidth * 0.6));
    inspectorWidth = Math.max(MIN_INSPECTOR, Math.min(max, Math.round(inspectorWidth)));
    document.documentElement.style.setProperty('--inspector-w', inspectorWidth + 'px');
  }

  /* Dragging the divider grows the inspector leftwards; the tree refits so
     nothing ends up hidden behind the panel. */
  function wireInspectorResizer() {
    const handle = document.getElementById('inspectorResizer');
    let dragging = false;

    const move = ev => {
      if (!dragging) return;
      inspectorWidth = window.innerWidth - ev.clientX;
      applyInspectorWidth();
    };

    const stop = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      persistUi();
      if (currentView === 'tree') Tree.fit();
    };

    handle.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      dragging = true;
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
    });

    /* keyboard-reachable, since a drag handle otherwise is not */
    handle.addEventListener('keydown', ev => {
      const step = ev.shiftKey ? 60 : 20;
      if (ev.key === 'ArrowLeft')  { inspectorWidth += step; }
      else if (ev.key === 'ArrowRight') { inspectorWidth -= step; }
      else return;
      ev.preventDefault();
      applyInspectorWidth();
      persistUi();
      if (currentView === 'tree') Tree.fit();
    });

    window.addEventListener('resize', applyInspectorWidth);
  }

  /* ---------------- toast ---------------- */

  let toastTimer;
  function toast(message) {
    const box = document.getElementById('toast');
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
  }

  /* ---------------- rendering ---------------- */

  function refresh() {
    const p = Store.state.profile;
    document.getElementById('profileName').textContent = p.name || 'Learning Tree';
    document.getElementById('profileSubtitle').textContent = p.subtitle || '';
    document.title = p.name || 'Learning Tree';

    Tree.render();
    renderTabs();
    Views.renderLegend();
    Views.fillListFilters();
    Views.renderInspector(selectedId);
    if (currentView === 'list')  Views.renderList(selectedId);
    if (currentView === 'stats') Views.renderStats();
    if (currentView === 'focus') Views.renderFocus();
  }

  function showView(view) {
    currentView = view;
    VIEWS.forEach(v => document.getElementById('view-' + v).hidden = v !== view);

    if (view === 'list')  { Views.fillListFilters(); Views.renderList(selectedId); }
    if (view === 'stats') Views.renderStats();
    if (view === 'focus') Views.renderFocus();
    if (view === 'tree')  requestAnimationFrame(() => Tree.fit());
    persistUi();
  }

  function openFixedView(view) {
    showView(view);
    renderTabs();
  }

  /* Select a node, keeping the tree, list and inspector in agreement. */
  function selectNode(id, { center = false } = {}) {
    selectedId = id || null;

    /* While one field is in focus, following a node into another field moves
       the tab with it rather than leaving an empty-looking tree behind. */
    if (selectedId && activeField) {
      const field = Store.domainOf(selectedId);
      if (field && field.id !== activeField) {
        activeField = field.id;
        Tree.setRoot(activeField);
        renderTabs();
        persistUi();
      }
    }

    Tree.select(selectedId);
    if (center && selectedId) Tree.centerOn(selectedId);
  }

  /* ---------------- tab bar ---------------- */

  /* The tab bar carries one tab per field plus "All", and the two fixed views.
     activeField is remembered so the app reopens where it was left. */
  function renderTabs() {
    const strip = document.getElementById('fieldTabs');
    strip.replaceChildren();

    const tab = (label, { fieldId = null, isAll = false } = {}) => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (isAll ? ' tab-all' : '');
      btn.setAttribute('role', 'tab');
      btn.dataset.field = fieldId || '';

      const active = currentView === 'tree' && (fieldId || null) === activeField;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));

      if (isAll) {
        btn.innerHTML = `<span class="glyph">&#9678;</span> All`;
        btn.title = 'Every field in one tree';
      } else {
        const field = Store.byId(fieldId);
        btn.innerHTML =
          `<span class="dot" style="background:var(${Store.STATUS_BY_ID[field.status].cssVar})"></span>` +
          `<span>${escapeHtml(field.name)}</span>` +
          `<span class="tab-pct">${Math.round(Store.progressOf(fieldId) * 100)}%</span>`;
        btn.title = `${field.name} — ${Store.descendantsOf(fieldId).length} topics, ${Views.formatHours(Store.minutesFor(fieldId))} logged`;
      }

      btn.addEventListener('click', () => openField(fieldId));
      return btn;
    };

    strip.appendChild(tab('All', { isAll: true }));
    Store.roots().forEach(field => strip.appendChild(tab(field.name, { fieldId: field.id })));

    const add = document.createElement('button');
    add.className = 'tab tab-add';
    add.id = 'addFieldTab';
    add.textContent = '+';
    add.title = 'Start a new field (n)';
    add.addEventListener('click', startNewField);
    strip.appendChild(add);

    document.querySelectorAll('.tab-fixed').forEach(t => {
      const active = t.dataset.view === currentView;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
  }

  /* Naming a new field happens inline in the tab strip rather than in a
     browser prompt, so starting a new subject is a single gesture. */
  function startNewField() {
    const add = document.getElementById('addFieldTab');
    if (!add) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-input';
    input.placeholder = 'New field, e.g. Operating Systems';
    input.setAttribute('aria-label', 'Name of the new field');

    let settled = false;
    const cancel = () => { if (!settled) { settled = true; renderTabs(); } };
    const commit = () => {
      if (settled) return;
      const name = input.value.trim();
      if (!name) return cancel();
      settled = true;
      const field = Store.addNode({ parentId: null, name });
      activeField = field.id;
      currentView = 'tree';
      refresh();
      Tree.setRoot(activeField);
      selectNode(field.id);
      toast(`Started "${field.name}" — add the first topic to grow it.`);
    };

    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);

    add.replaceWith(input);
    input.focus();
  }

  function openField(fieldId) {
    activeField = fieldId || null;
    currentView = 'tree';
    persistUi();
    showView('tree');
    Tree.setRoot(activeField);
    renderTabs();
  }

  /* ---------------- data menu ---------------- */

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDataAction(action) {
    switch (action) {
      case 'export':
        download('learning.json', Store.toJSON());
        toast(Store.hasPrivateData()
          ? 'Public snapshot exported — private branches were left out.'
          : 'Exported — drop it into data/learning.json and commit.');
        break;

      case 'export-private':
        if (!Store.hasPrivateData()) {
          toast('Nothing is marked private yet.');
          return;
        }
        download('private.json', Store.toPrivateJSON());
        toast('Private data exported — save as data/private.json (git-ignored).');
        break;

      case 'copy':
        try {
          await navigator.clipboard.writeText(Store.toJSON());
          toast('JSON copied to clipboard.');
        } catch {
          toast('Clipboard blocked — use Export instead.');
        }
        break;

      case 'import':
        document.getElementById('importFile').click();
        break;

      case 'reload':
        if (!confirm('Replace what is in this browser with the committed data/learning.json?')) return;
        await Store.resetToSeed();
        afterDataSwap('Reloaded from the repo file.');
        break;

      case 'reset':
        if (!confirm('Discard local changes and start again from the seed data?')) return;
        await Store.resetToSeed();
        afterDataSwap('Reset to seed data.');
        break;
    }
  }

  /* Wholesale data replacement invalidates the selection and the active tab. */
  function afterDataSwap(message) {
    selectedId = null;
    activeField = null;
    Views.setListSelection(null);
    Tree.setRoot(null);
    refresh();
    persistUi();
    toast(message);
  }

  function wireDataMenu() {
    const btn  = document.getElementById('dataMenuBtn');
    const menu = document.getElementById('dataMenu');

    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });

    document.addEventListener('click', () => {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });

    menu.addEventListener('click', ev => {
      const action = ev.target.dataset && ev.target.dataset.action;
      if (!action) return;
      menu.hidden = true;
      handleDataAction(action);
    });

    document.getElementById('importFile').addEventListener('change', ev => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Store.importJSON(String(reader.result));
          afterDataSwap('Imported ' + file.name + '.');
        } catch (err) {
          alert('Could not import that file.\n\n' + err.message);
        }
      };
      reader.readAsText(file);
      ev.target.value = '';
    });
  }

  /* ---------------- theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
    /* Node fills are read from CSS variables, so the tree must be redrawn. */
    Tree.render();
  }

  function wireTheme() {
    const saved = (() => {
      try { return localStorage.getItem(THEME_KEY); } catch { return null; }
    })();
    const preferred = saved
      || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = preferred;

    document.getElementById('themeBtn').addEventListener('click', () =>
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  }

  /* ---------------- seed banner ---------------- */

  function maybeShowSeedBanner() {
    const pending = Store.pendingSeed;
    if (!pending) return;

    const banner = document.getElementById('banner');
    document.getElementById('bannerText').textContent =
      'The committed data/learning.json is newer than the copy in this browser.';
    banner.hidden = false;

    document.getElementById('bannerAccept').addEventListener('click', () => {
      Store.adoptSeed();
      banner.hidden = true;
      afterDataSwap('Loaded the committed version.');
    });
    document.getElementById('bannerDismiss').addEventListener('click', () => {
      banner.hidden = true;
    });
  }

  /* ---------------- keyboard ---------------- */

  function wireKeyboard() {
    document.addEventListener('keydown', ev => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

      if (ev.key === 'Escape') {
        if (typing) { document.activeElement.blur(); return; }
        selectNode(null);
        return;
      }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;

      if (ev.key === '/') {
        ev.preventDefault();
        document.getElementById('search').focus();
      } else if (ev.key === 'N') {
        ev.preventDefault();
        startNewField();
      } else if (ev.key === 'n') {
        addTopicUnderSelection();
      } else if (ev.key === 'f') {
        Tree.fit();
      } else if (ev.key === 'd') {
        openFixedView('focus');
      } else if (ev.key === 'l') {
        openFixedView('list');
      } else if (ev.key === 's') {
        openFixedView('stats');
      } else if (ev.key === 't') {
        openField(activeField);
      }
    });
  }

  /* A new topic hangs off the selection, or off the field in focus, or starts
     a brand new field when the combined tree is showing. */
  function addTopicUnderSelection() {
    const parentId = selectedId || activeField;
    if (!parentId) { startNewField(); return; }
    const child = Store.addNode({ parentId, name: 'New topic' });
    refresh();
    selectNode(child.id, { center: true });
    toast('Added a topic — rename it in the panel on the right.');
  }

  /* ---------------- search ---------------- */

  function wireSearch() {
    const input = document.getElementById('search');
    input.addEventListener('input', () => {
      Tree.setQuery(input.value);
      if (currentView === 'list') Views.renderList(selectedId);
    });
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      const q = input.value.trim().toLowerCase();
      const hit = Store.state.nodes.find(n => n.name.toLowerCase().includes(q));
      if (!hit) return;
      if (currentView === 'tree') selectNode(hit.id, { center: true });
      else selectNode(hit.id);
    });
  }

  /* ---------------- boot ---------------- */

  async function main() {
    wireTheme();
    await Store.init();
    restoreUi();

    Views.init({
      /* From the stats feed or the list's "Open in tree": go and show it. */
      onNavigate: id => {
        if (id && activeField) {
          const field = Store.domainOf(id);
          if (field) activeField = field.id;
        }
        Tree.setRoot(activeField);
        showView('tree');
        renderTabs();
        selectNode(id, { center: true });
      },
      /* From a list row: select it without leaving the list. */
      onSelect: id => selectNode(id),
      onChanged: refresh,
      /* A description or checklist edit saves without rebuilding the panel the
         user is typing into; only the tree and secondary views need redrawing. */
      onQuietChange: () => {
        Tree.render();
        if (currentView === 'list') Views.renderList(selectedId);
      },
    });

    Tree.init({
      onSelect: id => {
        selectedId = id;
        Views.setListSelection(id);
        Views.renderInspector(id);
      },
      /* Buttons on a card ask the app to do the work, so the tree stays a
         renderer and everything lands in one place. */
      onAction: (act, nodeId) => {
        if (act === 'child') {
          const child = Store.addNode({ parentId: nodeId, name: 'New topic' });
          refresh();
          selectNode(child.id);
          Tree.startRename(child.id);
          return;
        }
        if (act === 'log') {
          refresh();
          const mins = document.querySelector('#sessionForm [name="minutes"]');
          if (mins) { mins.focus(); mins.select(); }
          toast('Set the minutes and press Log time.');
          return;
        }
        refresh();     // 'advance' and 'renamed' just need everything redrawn
      },
    });

    Tree.setShowActivity(showActivity);
    Tree.setRoot(activeField);

    document.querySelectorAll('.tab-fixed').forEach(tab =>
      tab.addEventListener('click', () => openFixedView(tab.dataset.view)));

    document.querySelectorAll('[data-zoom]').forEach(btn =>
      btn.addEventListener('click', () => {
        const mode = btn.dataset.zoom;
        if (mode === 'fit') Tree.fit();
        else Tree.zoom(mode === 'in' ? 1.25 : 0.8);
      }));

    document.getElementById('expandAllBtn').addEventListener('click', () => Tree.expandAll());

    const activityBtn = document.getElementById('activityBtn');
    activityBtn.classList.toggle('is-on', Tree.showActivity);
    activityBtn.addEventListener('click', () => {
      Tree.setShowActivity(!Tree.showActivity);
      activityBtn.classList.toggle('is-on', Tree.showActivity);
      persistUi();
    });

    document.getElementById('addDomainBtn').addEventListener('click', startNewField);

    document.getElementById('listStatusFilter').addEventListener('change', () => Views.renderList(selectedId));
    document.getElementById('listDomainFilter').addEventListener('change', () => Views.renderList(selectedId));
    document.getElementById('listSort').addEventListener('change', () => Views.renderList(selectedId));
    document.getElementById('listCollapseAll').addEventListener('click', ev => {
      const folded = Views.collapseAllGroups();
      ev.target.textContent = folded ? 'Expand all' : 'Collapse all';
    });

    document.getElementById('focusForm').addEventListener('submit', ev => {
      ev.preventDefault();
      Views.submitFocusTask();
    });

    applyInspectorWidth();
    wireInspectorResizer();
    wireDataMenu();
    wireSearch();
    wireKeyboard();
    maybeShowSeedBanner();

    refresh();
    showView(currentView);
  }

  main().catch(err => {
    console.error(err);
    alert('The tracker failed to start:\n\n' + err.message);
  });

})();
