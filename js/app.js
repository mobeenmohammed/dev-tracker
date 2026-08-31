/* ============================================================
   app.js — bootstrap, tab bar, view switching, data import/export,
   theme, and keyboard shortcuts.
   ============================================================ */

(() => {

  const THEME_KEY = 'learning-tree/theme';
  const UI_KEY    = 'learning-tree/ui/v1';

  let currentView = 'tree';   // one of VIEWS
  let activeField = null;     // null = every field in one tree
  let selectedId  = null;
  let showActivity = true;    // applied to the tree once it has been initialised
  let showRefs = true;
  let inspectorWidth = 340;   // px, dragged by the divider and remembered

  const VIEWS = ['tree', 'focus', 'problems', 'projects', 'apps', 'list', 'stats'];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- ui state ---------------- */

  function persistUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        currentView, activeField,
        showActivity: Tree.showActivity,
        showRefs: Tree.showRefs,
        inspectorWidth,
        shutFolders: [...shutFolders],
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
    showRefs = saved.showRefs !== false;
    if (Number.isFinite(saved.inspectorWidth)) inspectorWidth = saved.inspectorWidth;
    if (Array.isArray(saved.shutFolders)) shutFolders = new Set(saved.shutFolders.map(String));
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

  /* ---------------- storage ---------------- */

  /* A failed save is not a log line: from that point the tracker is a
     read-only view of stale data and nothing else would say so. */
  function syncStorageWarning() {
    const bar = document.getElementById('storageWarning');
    if (!bar) return;

    if (!Store.storageBroken) { bar.hidden = true; return; }

    const mb = (Store.storedBytes() / 1048576).toFixed(1);
    document.getElementById('storageWarningText').textContent =
      `Changes are no longer being saved — this browser will not store ${mb} MB. ` +
      `Export your data now; anything since the last successful save is lost on reload.`;
    bar.hidden = false;
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
    syncStorageWarning();

    const p = Store.state.profile;
    document.getElementById('profileName').textContent = p.name || 'Learning Tree';
    document.getElementById('profileSubtitle').textContent = p.subtitle || '';
    /* While a stopwatch is running the title is the clock, and the two must
       not fight over it a second at a time. */
    if (!Store.activeFocus()) document.title = p.name || 'Learning Tree';

    Tree.render();
    renderTabs();
    Views.renderLegend();
    Views.fillListFilters();
    Views.renderInspector(selectedId);
    if (currentView === 'list')  Views.renderList(selectedId);
    if (currentView === 'stats') Views.renderStats();
    if (currentView === 'focus') Views.renderFocus();
    if (currentView === 'problems') { Problems.fillForm(); Problems.render(); }
    if (currentView === 'apps') { Applications.fillForm(); Applications.render(); }
    if (currentView === 'projects') { Projects.fillForm(); Projects.render(); }
  }

  function showView(view) {
    currentView = view;
    VIEWS.forEach(v => document.getElementById('view-' + v).hidden = v !== view);

    if (view === 'list')  { Views.fillListFilters(); Views.renderList(selectedId); }
    if (view === 'stats') Views.renderStats();
    if (view === 'focus') Views.renderFocus();
    if (view === 'problems') { Problems.fillForm(); Problems.render(); }
    if (view === 'apps') { Applications.fillForm(); Applications.render(); }
    if (view === 'projects') { Projects.fillForm(); Projects.render(); }
    /* Through the tree's queue rather than a raw frame, so that centring on a
       topic in the same gesture cancels it. Opening a topic in another field
       used to land on it and be pulled straight back out to the whole tree by
       this fit, one frame later. */
    if (view === 'tree')  Tree.queueFit();
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

  /* The tab bar carries one tab per field plus "All", and the fixed views.
     activeField is remembered so the app reopens where it was left.

     Only the field tabs scroll. "All", the new-field button and the picker are
     pinned either side of them, and the fixed views are pinned at the far end,
     so no amount of fields can push any of them off the screen — which is what
     used to happen once there were more fields than the bar was wide. */
  let scrolledTo;                 // the field the strip was last scrolled to

  /* A field can vanish while it is open — deleted from the inspector, or
     replaced wholesale by an import. Every route that does it redraws the bar,
     so the fallback to All lives here rather than in each of them. */
  function forgetMissingField() {
    if (!activeField || Store.byId(activeField)) return;
    activeField = null;
    Tree.setRoot(null);
    /* The canvas is a graph now, and has to say so: the grab cursor, the hint
       and the Re-layout button all follow the mode rather than the tree. */
    syncCanvasMode();
    persistUi();
  }

  function renderTabs() {
    forgetMissingField();
    const lead   = document.getElementById('fieldTabsLead');
    const strip  = document.getElementById('fieldTabsScroll');
    lead.replaceChildren();
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

    /* A folder in the strip is a chip, not a tab: it opens nothing itself, it
       drops its fields below it to be chosen from — the same gesture the
       fields button uses, for the same reason. It carries the underline when
       the field you are on is filed on it, so you can still see where you are
       without its fields being on screen. */
    const folderTab = (folder, count) => {
      /* The underline follows the field you are on however deep inside the
         folder it sits, or a sub-folder would swallow the only sign of it. */
      const here = currentView === 'tree' && activeField && Store.byId(activeField);
      const holdsActive = !!here && !!here.folderId
        && (here.folderId === folder.id
            || Store.folderAncestors(here.folderId).some(f => f.id === folder.id));

      const btn = document.createElement('button');
      btn.className = 'tab tab-folder' + (holdsActive ? ' is-active' : '');
      btn.dataset.folder = folder.id;
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-controls', 'folderMenu');
      btn.setAttribute('aria-expanded', String(openFolderMenu === folder.id));
      btn.innerHTML =
        `<span class="tab-folder-icon">&#128193;</span>` +
        `<span>${escapeHtml(folder.name)}</span>` +
        `<span class="tab-pct">${count}</span>` +
        `<span class="tab-caret">&#8964;</span>`;
      const holding = count === 1 ? '1 field' : count + ' fields';
      btn.title = holdsActive
        ? `${folder.name} — ${holding}, showing ${here.name}`
        : `${folder.name} — ${holding}`;

      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (openFolderMenu === folder.id) closeFolderMenu();
        else openFolderMenuFor(folder, btn);
      });
      return btn;
    };

    lead.appendChild(tab('All', { isAll: true }));

    const add = document.createElement('button');
    add.className = 'tab tab-add';
    add.id = 'addFieldTab';
    add.textContent = '+';
    add.title = 'Start a new field (N)';
    add.setAttribute('aria-label', 'Start a new field');
    add.addEventListener('click', startNewField);
    lead.appendChild(add);

    /* A folder is one chip however much is filed on it, and its fields drop
       below it when it is opened rather than unrolling along the strip. That
       is what makes folders worth having here: twenty fields in four folders
       take four slots, not twenty. Loose fields are still tabs of their own. */
    const top = Store.folderTree(null);
    top.folders.forEach(({ folder, count }) => strip.appendChild(folderTab(folder, count)));
    top.fields.forEach(field => strip.appendChild(tab(field.name, { fieldId: field.id })));

    const fields = Store.roots();

    /* A rebuilt chip picks its own expanded state up from openFolderMenu, but
       nothing rebuilds a chip for a folder that has just been deleted — so a
       panel left hanging over one is put away here. */
    if (openFolderMenu && !strip.querySelector(`.tab-folder[data-folder="${openFolderMenu}"]`)) {
      closeFolderMenu();
    }

    const count = document.getElementById('fieldPickerCount');
    if (count) count.textContent = fields.length === 1 ? '1 field' : fields.length + ' fields';

    document.querySelectorAll('.tab-fixed').forEach(t => {
      const active = t.dataset.view === currentView;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });

    /* Whichever field is open has to be visible without hunting for it, even
       when it sits well off the right of the strip — but only when it has just
       changed. Every refresh doing this would drag the strip back under anyone
       who had scrolled it to look at something else. */
    const current = strip.querySelector('.tab.is-active');
    if (current && activeField !== scrolledTo && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    scrolledTo = activeField;
    syncStripOverflow();
  }

  /* The strip fades at whichever end has more tabs beyond it, so it is clear
     there is more to see without a scrollbar sitting under the bar. */
  function syncStripOverflow() {
    const strip = document.getElementById('fieldTabsScroll');
    const frame = document.getElementById('fieldStrip');
    if (!strip || !frame) return;
    const max = strip.scrollWidth - strip.clientWidth;
    frame.classList.toggle('has-more-left',  strip.scrollLeft > 2);
    frame.classList.toggle('has-more-right', strip.scrollLeft < max - 2);
  }

  /* ---------------- a folder's own drop-down ---------------- */

  /* The strip scrolls sideways and clips what it holds, so the panel cannot
     live inside it. One shared panel is positioned under whichever chip was
     clicked instead, which also means only one can ever be open. */
  let openFolderMenu = null;
  let folderMenuIndex = 0;

  function closeFolderMenu() {
    const menu = document.getElementById('folderMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    openFolderMenu = null;
    document.querySelectorAll('.tab-folder[aria-expanded="true"]')
      .forEach(chip => chip.setAttribute('aria-expanded', 'false'));
  }

  function openFolderMenuFor(folder, chip) {
    const menu = document.getElementById('folderMenu');
    closeFieldPicker();
    hideDataMenu();

    openFolderMenu = folder.id;
    /* The sub-folder holding the field you are on is opened, or it would not
       be in the list to start the cursor on. */
    if (activeField) {
      const field = Store.byId(activeField);
      if (field && field.folderId) {
        shutFolders.delete(field.folderId);
        Store.folderAncestors(field.folderId).forEach(f => shutFolders.delete(f.id));
      }
    }
    folderMenuIndex = Math.max(0, folderMenuRows()
      .findIndex(r => r.kind === 'field' && r.id === activeField));

    renderFolderMenu();
    menu.hidden = false;
    chip.setAttribute('aria-expanded', 'true');

    /* Fixed to the viewport, under the chip and aligned to its left edge,
       pulled back in if that would run it off the right of the window. */
    const box = chip.getBoundingClientRect();
    const width = Math.min(300, Math.max(200, window.innerWidth - 24));
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    menu.style.top = Math.round(box.bottom + 4) + 'px';
    menu.style.left = Math.round(left) + 'px';
    menu.style.width = width + 'px';
  }

  /* What a chip's panel shows: everything inside that one folder, nested the
     same way the picker nests it. */
  const folderMenuRows = () => folderRows(openFolderMenu, 0, '');

  function renderFolderMenu() {
    const menu = document.getElementById('folderMenu');
    const folder = Store.folderById(openFolderMenu);
    if (!folder) { closeFolderMenu(); return; }

    const rows = folderMenuRows();
    menu.replaceChildren();
    menu.setAttribute('aria-label', folder.name);

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted picker-empty';
      empty.textContent = 'Nothing filed here yet. A field is filed from its Details panel.';
      menu.appendChild(empty);
      return;
    }

    folderMenuIndex = Math.max(0, Math.min(folderMenuIndex, rows.length - 1));

    rows.forEach((entry, i) => menu.appendChild(entryRow(entry, {
      cursor:  i === folderMenuIndex,
      manage:  false,
      onHover: () => {
        if (folderMenuIndex === i) return;
        folderMenuIndex = i;
        [...menu.children].forEach((el, j) => el.classList.toggle('is-cursor', j === i));
      },
      onFolder: id => { toggleFolder(id); folderMenuIndex = i; renderFolderMenu(); },
      onField:  id => { closeFolderMenu(); openField(id); },
    })));

    /* The panel scrolls once a folder holds more than fits, so arrowing down
       has to bring the cursor with it or Enter opens something unseen. */
    const cursor = menu.querySelector('.is-cursor');
    if (cursor && typeof cursor.scrollIntoView === 'function') {
      cursor.scrollIntoView({ block: 'nearest' });
    }
  }

  const folderMenuIsOpen = () => !document.getElementById('folderMenu').hidden;

  function wireFolderMenu() {
    const menu = document.getElementById('folderMenu');
    menu.addEventListener('click', ev => ev.stopPropagation());
    document.addEventListener('click', closeFolderMenu);
    window.addEventListener('resize', closeFolderMenu);

    /* The chip keeps focus, so the keys are read at the document while the
       panel is up rather than from inside it. */
    document.addEventListener('keydown', ev => {
      if (!folderMenuIsOpen()) return;

      /* Focus has moved into something being typed into, so the panel is no
         longer what the keyboard is aimed at. Taking Enter here would swallow
         the search box's own Enter and open a field instead of running the
         search. The panel gets out of the way rather than intercepting. */
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        closeFolderMenu();
        return;
      }

      const rows = folderMenuRows();
      const entry = rows[folderMenuIndex];

      if (ev.key === 'Escape') {
        ev.preventDefault(); ev.stopPropagation();
        closeFolderMenu();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!rows.length) return;
        ev.preventDefault(); ev.stopPropagation();
        folderMenuIndex = (folderMenuIndex + (ev.key === 'ArrowDown' ? 1 : rows.length - 1))
          % rows.length;
        renderFolderMenu();
      } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        /* The same disclosure gesture the picker uses, on the sub-folders. */
        if (!entry || entry.kind !== 'folder') return;
        if (entry.open === (ev.key === 'ArrowRight')) return;
        ev.preventDefault(); ev.stopPropagation();
        toggleFolder(entry.id);
        renderFolderMenu();
      } else if (ev.key === 'Enter') {
        if (!entry) return;
        ev.preventDefault(); ev.stopPropagation();
        if (entry.kind === 'folder') { toggleFolder(entry.id); renderFolderMenu(); return; }
        closeFolderMenu();
        openField(entry.id);
      }
    }, true);
  }

  /* ---------------- the field picker ---------------- */

  /* With a handful of fields the strip is enough. With thirty it is not, and
     scrolling sideways hunting for one is the worst way to navigate. The
     picker answers that: every field in one list, filterable, keyboard-driven,
     and dropped below the bar so it never covers the views pinned beside it. */
  let pickerIndex = 0;
  /* Folders the person has collapsed in the picker, rather than the ones they
     have opened: stored this way round, a folder nobody has touched is open,
     so filing a field never makes it disappear from the list. The strip does
     not use this — there a folder is always one chip, and its fields are in
     the panel it drops. */
  let shutFolders = new Set();
  const folderOpen = id => !shutFolders.has(id);

  /* One flat list of what is actually on screen: a folder, then what is inside
     it when it is open — sub-folders first, each with their own contents, then
     the fields filed on it. Flattening the nesting here is what lets the
     keyboard walk it without knowing anything about the shape, and what lets
     the picker and a single folder's panel share every row.

     Each row carries its depth, which is the only thing the drawing needs to
     know about how deep it sits. */
  /* Walks a tree the store built once, rather than asking for the subtree
     again at every level — which built the whole thing below it each time. */
  function rowsFromTree(tree, depth, q) {
    const rows = [];
    const hit = name => !q || name.toLowerCase().includes(q);

    tree.folders.forEach(group => {
      /* A folder whose own name matches shows everything inside it; otherwise
         it shows only what matched, and drops out if nothing did. A search
         opens folders, because a closed one hiding the only hit would look
         like no hit at all. */
      const named = q && hit(group.folder.name);
      const inside = rowsFromTree(group, depth + 1, named ? '' : q);
      if (q && !named && !inside.length) return;

      const open = q ? true : folderOpen(group.folder.id);
      rows.push({ kind: 'folder', id: group.folder.id, name: group.folder.name,
                  count: group.count, open, depth });
      if (open) rows.push(...inside);
    });

    tree.fields.filter(f => hit(f.name)).forEach(f =>
      rows.push({ kind: 'field', id: f.id, name: f.name, status: f.status, depth }));

    return rows;
  }

  const folderRows = (parentId, depth, q) =>
    rowsFromTree(Store.folderTree(parentId), depth, q);

  function pickerRows() {
    const box = document.getElementById('fieldPickerSearch');
    const q = (box.value || '').trim().toLowerCase();

    const rows = [];
    if (!q || 'all'.includes(q)) rows.push({ kind: 'all', id: null, name: 'All', depth: 0 });
    return rows.concat(folderRows(null, 0, q));
  }

  function toggleFolder(id) {
    /* While the picker is filtering, every folder is shown open regardless, so
       folding one there would change nothing on screen and then surprise the
       person once they cleared the box. The chip panels do not filter, so the
       guard must not reach them — a query left behind in a closed picker used
       to freeze folders everywhere. */
    if (pickerIsOpen() && document.getElementById('fieldPickerSearch').value.trim()) return;
    if (shutFolders.has(id)) shutFolders.delete(id); else shutFolders.add(id);
    persistUi();
    renderPickerList();
  }

  /* One row, drawn the same way wherever it appears: the picker and a chip's
     panel show the same nesting, so they share the drawing and differ only in
     whether the folder controls are on offer. `manage` is what the picker has
     and the panel does not — the panel is for going somewhere, not for
     rearranging. */
  function entryRow(entry, { cursor, manage, onHover, onFolder, onField }) {
    const row = document.createElement('button');
    row.className = 'picker-row picker-' + entry.kind;
    row.setAttribute('role', 'option');
    row.dataset.field = entry.kind === 'field' ? entry.id : '';
    if (entry.kind === 'folder') row.dataset.folder = entry.id;
    if (entry.depth) row.classList.add('is-nested');
    if (cursor) row.classList.add('is-cursor');
    /* Indent is set here rather than by a class per level, because the nesting
       has no depth limit. */
    if (entry.depth) row.style.paddingLeft = (8 + entry.depth * 15) + 'px';

    const isOpen = entry.kind !== 'folder'
      && currentView === 'tree' && (entry.id || null) === activeField;
    row.classList.toggle('is-open', isOpen);
    row.setAttribute('aria-selected', String(isOpen));

    if (entry.kind === 'all') {
      row.innerHTML = '<span class="glyph">&#9678;</span><span class="picker-name">All</span>' +
        '<span class="picker-meta">' + Store.roots().length + ' fields</span>';
    } else if (entry.kind === 'folder') {
      row.classList.toggle('is-expanded', entry.open);
      row.setAttribute('aria-expanded', String(entry.open));
      row.innerHTML =
        '<span class="picker-caret">' + (entry.open ? '&#9662;' : '&#9656;') + '</span>' +
        '<span class="picker-name">' + escapeHtml(entry.name) + '</span>' +
        '<span class="picker-meta">' +
          (entry.count === 1 ? '1 field' : entry.count + ' fields') + '</span>' +
        (manage
          ? '<span class="picker-add" role="button" tabindex="-1" ' +
              'title="New folder inside this one">+</span>' +
            '<span class="picker-edit" role="button" tabindex="-1" ' +
              'title="Rename or move this folder">\u270E</span>' +
            '<span class="picker-del" role="button" tabindex="-1" ' +
              'title="Remove this folder — what is in it stays">&times;</span>'
          : '');
      row.title = 'Show or hide what is in ' + entry.name;

      if (manage) {
        row.querySelector('.picker-add').addEventListener('click', ev => {
          ev.stopPropagation();
          startNewFolder(entry.id);
        });
        row.querySelector('.picker-edit').addEventListener('click', ev => {
          ev.stopPropagation();
          editFolderInline(row, entry);
        });
        row.querySelector('.picker-del').addEventListener('click', ev => {
          ev.stopPropagation();
          removeFolder(entry);
        });
      }
    } else {
      row.innerHTML =
        '<span class="dot" style="background:var(' + Store.STATUS_BY_ID[entry.status].cssVar + ')"></span>' +
        '<span class="picker-name">' + escapeHtml(entry.name) + '</span>' +
        '<span class="picker-meta">' + Store.descendantsOf(entry.id).length + ' topics</span>' +
        '<span class="picker-pct">' + Math.round(Store.progressOf(entry.id) * 100) + '%</span>';
    }

    row.addEventListener('click', ev => {
      ev.stopPropagation();
      if (entry.kind === 'folder') onFolder(entry.id);
      else onField(entry.id);
    });
    row.addEventListener('mousemove', onHover);
    return row;
  }

  function renderPickerList() {
    const list = document.getElementById('fieldPickerList');
    const rows = pickerRows();
    list.replaceChildren();

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted picker-empty';
      empty.textContent = 'Nothing by that name.';
      list.appendChild(empty);
      return;
    }

    pickerIndex = Math.max(0, Math.min(pickerIndex, rows.length - 1));

    rows.forEach((entry, i) => list.appendChild(entryRow(entry, {
      cursor:  i === pickerIndex,
      manage:  true,
      onHover: () => {
        if (pickerIndex === i) return;
        pickerIndex = i;
        [...list.children].forEach((el, j) => el.classList.toggle('is-cursor', j === i));
      },
      onFolder: id => { pickerIndex = i; toggleFolder(id); },
      onField:  id => { closeFieldPicker(); openField(id); },
    })));

    const cursor = list.querySelector('.is-cursor');
    if (cursor && typeof cursor.scrollIntoView === 'function') {
      cursor.scrollIntoView({ block: 'nearest' });
    }
  }

  /* Renaming happens over the row itself rather than in a prompt, the same way
     renaming a card does. */
  /* Renaming and moving are one gesture, because both answer "where does this
     belong": a name box and, once there is somewhere to move it to, a list of
     the folders it could sit inside. Only folders that would not make the tree
     contain itself are offered. */
  function editFolderInline(row, entry) {
    const label = row.querySelector('.picker-name');
    if (!label) return;

    const editor = document.createElement('span');
    editor.className = 'picker-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'picker-rename';
    input.value = entry.name;
    input.setAttribute('aria-label', 'Folder name');
    editor.appendChild(input);

    const targets = Store.foldersInOrder()
      .filter(f => f.id !== entry.id && !Store.folderWouldCycle(entry.id, f.id));
    let move = null;
    if (targets.length) {
      move = document.createElement('select');
      move.className = 'picker-move';
      move.setAttribute('aria-label', 'Folder it sits inside');
      const own = Store.folderById(entry.id);
      move.innerHTML = '<option value="">— top level —</option>' +
        targets.map(f => `<option value="${escapeHtml(f.id)}"${f.id === (own && own.parentId) ? ' selected' : ''}>` +
          '\u00a0\u00a0'.repeat(Store.folderDepth(f.id)) + escapeHtml(f.name) + '</option>').join('');
      editor.appendChild(move);
    }

    label.replaceWith(editor);
    input.focus();
    input.select();

    let settled = false;
    const finish = commit => {
      if (settled) return;
      settled = true;
      if (commit) {
        Store.renameFolder(entry.id, input.value);
        if (move) Store.setFolderParent(entry.id, move.value || null);
      }
      renderPickerList();
      renderTabs();
    };
    const stop = ev => ev.stopPropagation();
    [input, move].filter(Boolean).forEach(el => {
      el.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter')  { ev.preventDefault(); finish(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      });
      el.addEventListener('click', stop);
      el.addEventListener('dblclick', stop);
    });
    /* Blur only settles it once focus has left the editor entirely, or moving
       from the name to the list would close it. */
    editor.addEventListener('focusout', () => {
      setTimeout(() => { if (!editor.contains(document.activeElement)) finish(true); }, 0);
    });
  }

  function removeFolder(entry) {
    const freed = Store.deleteFolder(entry.id);
    shutFolders.delete(entry.id);
    persistUi();
    renderPickerList();
    renderTabs();
    /* An open Details panel is still offering the folder that has just gone;
       rebuilding it drops the choice rather than letting someone pick
       something the store will quietly refuse. */
    Views.renderInspector(selectedId);
    toast(freed
      ? `Folder removed — ${freed === 1 ? 'its field is' : 'its ' + freed + ' fields are'} back where it was.`
      : 'Folder removed.');
  }

  /* A new folder starts open and named, ready to have fields put on it. */
  /* A new folder is named where it will live, so it is obvious what it is
     going inside. Given a parent it starts as a sub-folder of it. */
  function startNewFolder(parentId = null) {
    const list = document.getElementById('fieldPickerList');
    if (parentId) shutFolders.delete(parentId);
    renderPickerList();

    const depth = parentId ? Store.folderDepth(parentId) + 1 : 0;
    const row = document.createElement('div');
    row.className = 'picker-row picker-folder';
    if (depth) row.style.paddingLeft = (8 + depth * 15) + 'px';
    row.innerHTML = '<span class="picker-caret">&#9662;</span>';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'picker-rename';
    input.placeholder = parentId
      ? 'Folder inside ' + (Store.folderById(parentId) || {}).name
      : 'Folder name, e.g. Mathematics';
    input.setAttribute('aria-label', 'Name of the new folder');
    row.appendChild(input);

    /* Straight after the folder it belongs to, or at the end when it is a new
       top-level one, so it appears where it is going to end up. */
    const after = parentId
      ? [...list.children].filter(el => el.dataset && el.dataset.folder === parentId).pop()
      : null;
    if (after && after.nextSibling) list.insertBefore(row, after.nextSibling);
    else if (after) list.appendChild(row);
    else list.appendChild(row);
    input.focus();

    let settled = false;
    const finish = commit => {
      if (settled) return;
      settled = true;
      const name = input.value.trim();
      if (commit && name) {
        const folder = Store.addFolder(name, parentId);
        shutFolders.delete(folder.id);
        persistUi();
        renderTabs();
        toast(parentId
          ? `Made "${folder.name}" inside ${(Store.folderById(parentId) || {}).name}.`
          : `Made "${folder.name}" — put a field on it from its Details panel.`);
      }
      renderPickerList();
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter')  { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', ev => ev.stopPropagation());
  }

  function openFieldPicker() {
    const panel  = document.getElementById('fieldPicker');
    const search = document.getElementById('fieldPickerSearch');
    /* They all close on a click anywhere, but the click that opens one is
       stopped before it gets there — so the others are closed by hand. */
    hideDataMenu();
    closeFolderMenu();

    panel.hidden = false;
    document.getElementById('fieldPickerBtn').setAttribute('aria-expanded', 'true');
    search.value = '';
    /* The folder holding the open field is opened, or it would not be there
       to start on. */
    /* Every folder above it, not just the one it sits in — with an outer one
       still folded the field has no row at all, and the cursor lands on "All"
       instead of on where you already are. */
    const current = activeField && Store.byId(activeField);
    if (current && current.folderId) {
      shutFolders.delete(current.folderId);
      Store.folderAncestors(current.folderId).forEach(f => shutFolders.delete(f.id));
    }

    /* Start on the field already open, so Enter on its own changes nothing. */
    pickerIndex = Math.max(0, pickerRows()
      .findIndex(r => r.kind !== 'folder' && (r.id || null) === activeField));
    renderPickerList();
    search.focus();
  }

  function closeFieldPicker() {
    const panel = document.getElementById('fieldPicker');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    /* Nothing should be left filtering behind a closed panel. */
    document.getElementById('fieldPickerSearch').value = '';
    document.getElementById('fieldPickerBtn').setAttribute('aria-expanded', 'false');
  }

  const pickerIsOpen = () => !document.getElementById('fieldPicker').hidden;

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

  function wireFieldPicker() {
    const btn    = document.getElementById('fieldPickerBtn');
    const panel  = document.getElementById('fieldPicker');
    const search = document.getElementById('fieldPickerSearch');
    const strip  = document.getElementById('fieldTabsScroll');

    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (pickerIsOpen()) closeFieldPicker(); else openFieldPicker();
    });

    search.addEventListener('input', () => { pickerIndex = 0; renderPickerList(); });

    /* Delegated, because the first click of a double-click toggles the folder
       and rebuilds the list — a handler bound to the row would be listening
       from an element that is no longer in the document by the time the
       second click lands. */
    document.getElementById('fieldPickerList').addEventListener('dblclick', ev => {
      const row = ev.target.closest('.picker-folder');
      if (!row || !row.dataset.folder) return;
      const folder = Store.folderById(row.dataset.folder);
      if (!folder) return;
      ev.stopPropagation();
      editFolderInline(row, folder);
    });

    search.addEventListener('keydown', ev => {
      const rows = pickerRows();
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!rows.length) return;
        pickerIndex = (pickerIndex + (ev.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
        renderPickerList();
      } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        /* Right opens a folder, left closes it — the one gesture everything
           with a disclosure triangle uses. On a field they do nothing, so
           the caret keeps working inside the search box. */
        const entry = rows[pickerIndex];
        if (!entry || entry.kind !== 'folder') return;
        if (entry.open === (ev.key === 'ArrowRight')) return;
        ev.preventDefault();
        toggleFolder(entry.id);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const entry = rows[pickerIndex];
        if (!entry) return;
        if (entry.kind === 'folder') { toggleFolder(entry.id); return; }
        closeFieldPicker();
        openField(entry.id);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        /* Or the document handler sees a closed picker and goes on to clear
           the selection, which is not what closing a picker means. */
        ev.stopPropagation();
        closeFieldPicker();
        btn.focus();
      }
    });

    document.getElementById('fieldPickerNew').addEventListener('click', () => {
      closeFieldPicker();
      startNewField();
    });

    /* Naming a folder happens in the list, so the picker stays open for it. */
    document.getElementById('fieldPickerNewFolder').addEventListener('click', ev => {
      ev.stopPropagation();
      startNewFolder();
    });

    panel.addEventListener('click', ev => ev.stopPropagation());
    document.addEventListener('click', closeFieldPicker);

    /* A wheel over the strip moves it sideways: it is a horizontal list, and a
       vertical wheel is the only gesture most mice have. */
    strip.addEventListener('wheel', ev => {
      if (ev.deltaY === 0 || ev.shiftKey) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      ev.preventDefault();
      strip.scrollLeft += ev.deltaY;
    }, { passive: false });

    strip.addEventListener('scroll', () => {
      syncStripOverflow();
      /* A panel fixed to the viewport cannot follow a chip that is sliding
         out from under it, so it is put away rather than left pointing at
         nothing in particular. */
      closeFolderMenu();
    });
    window.addEventListener('resize', syncStripOverflow);
  }

  function openField(fieldId) {
    activeField = fieldId || null;
    currentView = 'tree';
    persistUi();
    showView('tree');
    Tree.setRoot(activeField);
    renderTabs();
    syncCanvasMode();
  }

  /* The All view is a graph and behaves differently enough to say so. */
  function syncCanvasMode() {
    const wrap = document.querySelector('.canvas-wrap');
    const hint = document.getElementById('canvasHint');
    if (!wrap || !hint) return;

    wrap.classList.toggle('is-graph', Tree.isGraph);
    hint.textContent = Tree.isGraph
      ? (Tree.showsEveryTopic
          ? 'Every topic at once · ⊕ goes back to one field at a time'
          : 'Select a field to open it · purple arrows are references, pink ones connections · ⊕ shows everything')
      : (Tree.showsEveryTopic
          ? 'Every topic at once · ⊕ goes back to one branch at a time'
          : 'Select a topic to open its branch · purple arcs are references · ⊕ shows the whole tree');
    document.getElementById('relayoutBtn').disabled = !Tree.isGraph;

    const expand = document.getElementById('expandAllBtn');
    expand.classList.toggle('is-on', Tree.showsEveryTopic);
    expand.title = Tree.showsEveryTopic
      ? 'Back to one branch at a time'
      : (Tree.isGraph ? 'Show every topic at once' : 'Open the whole tree');
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

      case 'import-solves':
        document.getElementById('importSolvesFile').click();
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

  /* Three things can hang under the bar and only one of them at a time, so
     each of them can put the others away. */
  function hideDataMenu() {
    const menu = document.getElementById('dataMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    document.getElementById('dataMenuBtn').setAttribute('aria-expanded', 'false');
  }

  function wireDataMenu() {
    const btn  = document.getElementById('dataMenuBtn');
    const menu = document.getElementById('dataMenu');

    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      closeFieldPicker();
      closeFolderMenu();
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
        if (pickerIsOpen()) { closeFieldPicker(); return; }
        if (typing) { document.activeElement.blur(); return; }
        selectNode(null);
        return;
      }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      /* The focus screen is modal. Switching view or adding a topic behind it
         from a stray keystroke is exactly what modal is meant to prevent. */
      if (Focus.isOpen) return;

      if (ev.key === '/') {
        ev.preventDefault();
        /* Typing somewhere else is leaving the panel, so it goes away. */
        closeFolderMenu();
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
      } else if (ev.key === 'p') {
        openFixedView('problems');
      } else if (ev.key === 'a') {
        openFixedView('apps');
      } else if (ev.key === 'j') {
        openFixedView('projects');
      } else if (ev.key === 'l') {
        openFixedView('list');
      } else if (ev.key === 's') {
        openFixedView('stats');
      } else if (ev.key === 't') {
        openField(activeField);
      } else if (ev.key === 'g') {
        ev.preventDefault();
        openFieldPicker();
      } else if (ev.key === 'w') {
        /* Whatever is selected, or back to whatever is already running. */
        const timer = Store.activeFocus();
        const target = selectedId || (timer && timer.nodeId);
        if (target) { ev.preventDefault(); Focus.open(target); }
        else toast('Select a topic first, then press w to focus on it.');
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

    /* Every keystroke redraws every card. On a small tree that is free; on a
       few hundred topics it makes typing feel like wading, so the redraw waits
       until the typing pauses. Short enough to read as instant. */
    let typing;
    input.addEventListener('input', () => {
      clearTimeout(typing);
      typing = setTimeout(() => {
        Tree.setQuery(input.value);
        if (currentView === 'list') Views.renderList(selectedId);
      }, 110);
    });
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      /* Enter is not going to wait for a pause it just interrupted, so the
         pending redraw is cancelled and done now instead of dropped. */
      clearTimeout(typing);
      Tree.setQuery(input.value);
      if (currentView === 'list') Views.renderList(selectedId);

      const q = input.value.trim().toLowerCase();
      const hit = Store.state.nodes.find(n => n.name.toLowerCase().includes(q));
      if (!hit) return;
      if (currentView === 'tree') selectNode(hit.id, { center: true });
      else selectNode(hit.id);
    });
  }

  /* ---------------- the extension handshake ---------------- */

  /* The extension cannot read this page's storage, so what it needs is offered
     to it: a compact digest of every solve, so a problem page can show your
     history with that problem. Sent on load and after anything changes, which
     is the only moment it can be — nothing can be pushed to a static page. */
  function shareDigest() {
    const send = () => {
      try {
        window.postMessage({ type: 'dev-tracker/digest', problems: Store.problemDigest() },
                           location.origin === 'null' ? '*' : location.origin);
      } catch { /* nothing is listening, which is the normal case */ }
    };

    /* The extension's listener is injected when the document settles, which
       may be after this runs. Rather than rely on the timing, it can ask —
       and the offer is repeated briefly in case it was not listening yet. */
    window.addEventListener('message', ev => {
      if (ev.source !== window) return;
      if (ev.origin !== location.origin && ev.origin !== 'null') return;
      if (!ev.data || ev.data.type !== 'dev-tracker/digest-request') return;
      send();
    });

    send();
    setTimeout(send, 1200);

    let pending = null;
    Store.onChange(() => {
      clearTimeout(pending);
      pending = setTimeout(send, 800);
    });
  }


  /* A content script runs in its own world and cannot call window.DevTracker
     directly, so the browser extension offers solves by postMessage and this
     acknowledges exactly what was stored. Only same-window, same-origin
     messages are accepted, and the payload is additive data — never code. */
  function wireSolveBridge() {
    window.addEventListener('message', ev => {
      if (ev.source !== window) return;
      if (ev.origin !== location.origin && ev.origin !== 'null') return;

      const data = ev.data;
      if (!data || data.type !== 'dev-tracker/solves' || !Array.isArray(data.solves)) return;

      const result = Store.recordSolves(data.solves);
      refresh();

      /* Naming what was stored lets the extension clear only those, so a page
         closed mid-handover loses nothing. The names are qualified by source,
         because two sites can number a problem the same way and clearing the
         wrong one would lose a solve that was never stored. */
      const keys = data.solves
        .filter(s => s && s.problemId)
        .map(s => `${s.source}:${s.problemId}`);

      window.postMessage({
        type: 'dev-tracker/solves-ack',
        keys,
        /* The unqualified list is kept for an older extension. */
        problemIds: data.solves.map(s => s && s.problemId).filter(Boolean),
        added: result.added,
        updated: result.updated,
      }, location.origin === 'null' ? '*' : location.origin);

      if (result.added) {
        /* Name the sources that actually arrived, rather than assuming one. */
        const from = [...new Set(data.solves.map(s => s && s.source).filter(Boolean))]
          .map(Store.sourceLabel).join(' and ');
        toast(`${result.added} new solve${result.added === 1 ? '' : 's'}` + (from ? ` from ${from}.` : '.'));
      }
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
      onFocus: id => Focus.open(id),
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
        /* A borrowed card is a window onto a topic in another tree; this
           opens that tree at it, which is the one thing the window is for. */
        if (act === 'origin') {
          const field = Store.domainOf(nodeId);
          if (field) openField(field.id);
          selectNode(nodeId, { center: true });
          refresh();
          return;
        }
        if (act === 'disconnected') {
          refresh();
          toast('Connection removed — the topic still lives where it was.');
          return;
        }
        if (act === 'child') {
          const child = Store.addNode({ parentId: nodeId, name: 'New topic' });
          refresh();
          selectNode(child.id);
          Tree.startRename(child.id);
          return;
        }
        /* The card's clock starts the stopwatch rather than jumping to a form
           to guess at a number afterwards. */
        if (act === 'log') {
          Focus.open(nodeId);
          return;
        }
        refresh();     // 'advance' and 'renamed' just need everything redrawn
      },
    });

    Tree.setShowActivity(showActivity);
    Tree.setShowRefs(showRefs);
    Tree.setRoot(activeField);
    syncCanvasMode();

    document.querySelectorAll('.tab-fixed').forEach(tab =>
      tab.addEventListener('click', () => openFixedView(tab.dataset.view)));

    document.querySelectorAll('[data-zoom]').forEach(btn =>
      btn.addEventListener('click', () => {
        const mode = btn.dataset.zoom;
        if (mode === 'fit') Tree.fit();
        else Tree.zoom(mode === 'in' ? 1.25 : 0.8);
      }));

    document.getElementById('expandAllBtn').addEventListener('click', () => {
      Tree.expandAll();
      syncCanvasMode();
    });

    const refsBtn = document.getElementById('refsBtn');
    refsBtn.classList.toggle('is-on', Tree.showRefs);
    refsBtn.addEventListener('click', () => {
      Tree.setShowRefs(!Tree.showRefs);
      refsBtn.classList.toggle('is-on', Tree.showRefs);
      persistUi();
    });

    document.getElementById('relayoutBtn').addEventListener('click', () => {
      Tree.relayoutGraph();
      toast(Tree.isGraph ? 'Graph laid out again.' : 'Only the All view is a graph.');
    });

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

    /* Choosing a field offers its parts; choosing another field offers that
       one's instead, rather than leaving a part from the last one behind. */
    document.getElementById('focusTopic').addEventListener('change', ev => {
      Views.renderTopicPick(ev.target.value || null);
    });

    document.getElementById('goalForm').addEventListener('submit', ev => {
      ev.preventDefault();
      Views.submitGoal();
    });

    Problems.init({
      onNotice: toast,
      onNavigate: id => {
        const field = Store.domainOf(id);
        if (field && activeField) activeField = field.id;
        Tree.setRoot(activeField);
        showView('tree');
        renderTabs();
        selectNode(id, { center: true });
      },
      onChanged: refresh,
    });

    Applications.init({ onChanged: refresh });

    Projects.init({
      onChanged: refresh,
      onNavigate: id => {
        const field = Store.domainOf(id);
        if (field && activeField) activeField = field.id;
        Tree.setRoot(activeField);
        showView('tree');
        renderTabs();
        selectNode(id, { center: true });
      },
    });

    document.getElementById('projectForm').addEventListener('submit', ev => {
      ev.preventDefault();
      Projects.submitProject();
    });

    document.getElementById('problemForm').addEventListener('submit', ev => {
      ev.preventDefault();
      Problems.submitProblem();
    });

    document.getElementById('appForm').addEventListener('submit', ev => {
      ev.preventDefault();
      Applications.submitApplication();
    });

    document.getElementById('importSolvesFile').addEventListener('change', ev => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const { added, updated } = Problems.importSolves(String(reader.result));
          toast(`Imported ${added} new solve${added === 1 ? '' : 's'}` +
                (updated ? `, ${updated} already known.` : '.'));
        } catch (err) {
          alert('Could not import those solves: ' + err.message);
        }
      };
      reader.readAsText(file);
      ev.target.value = '';
    });

    /* The surface a browser extension writes through: it can hand solves to
       the page without knowing anything about the internals. */
    window.DevTracker = {
      recordSolves(list) {
        const result = Store.recordSolves(list);
        refresh();
        return result;
      },
      get version() { return Store.state.version; },
    };

    wireSolveBridge();
    shareDigest();

    applyInspectorWidth();
    wireInspectorResizer();
    document.getElementById('storageExport').addEventListener('click', () => {
      handleDataAction('export');
      if (Store.hasPrivateData()) handleDataAction('export-private');
    });
    Store.onChange(syncStorageWarning);

    Focus.init({
      /* Stopping banks a session, which every total and the heatmap read, so
         everything on screen has to be redrawn. */
      onChanged: (done, opts = {}) => {
        refresh();
        if (!done || opts.quiet) return;
        if (!done.minutes) {
          toast('Too short to log — nothing was recorded.');
          return;
        }
        const node = Store.byId(done.nodeId);
        const away = done.interruptions
          ? `, pulled away ${done.interruptions} time${done.interruptions === 1 ? '' : 's'}`
          : '';
        toast(`Logged ${done.minutes}m on ${node ? node.name : 'that topic'}${away}.`);
      },
      onNavigate: id => selectNode(id, { center: currentView === 'tree' }),
    });

    wireDataMenu();
    wireFieldPicker();
    wireFolderMenu();
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
