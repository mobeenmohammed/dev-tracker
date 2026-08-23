/* ============================================================
   views.js — inspector panel, list view, stats view.
   Each renderer rebuilds its own subtree from the store.
   ============================================================ */

const Views = (() => {

  let onNavigate = () => {};   // select a node AND reveal it in the tree
  let onSelect   = () => {};   // select a node without leaving the current view
  let onChanged  = () => {};   // tell the app something in the store changed
  let onQuietChange = () => {};// saved, but do not rebuild the panel being typed in

  /* ---------------- small helpers ---------------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const statusColor = status =>
    `var(${(Store.STATUS_BY_ID[status] || Store.STATUS_BY_ID.planned).cssVar})`;

  const pct = v => Math.round(v * 100) + '%';

  function formatHours(minutes) {
    if (!minutes) return '0h';
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (!h) return m + 'm';
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ---------------- inspector ---------------- */

  /* Order matters here: what the topic is, then where it stands, then the
     concrete things to do, then how far that has got, then the plumbing. */
  function renderInspector(id) {
    const empty = document.getElementById('inspectorEmpty');
    const body  = document.getElementById('inspectorBody');
    const node  = id ? Store.byId(id) : null;

    if (!node) {
      empty.hidden = false;
      body.hidden = true;
      body.replaceChildren();
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    body.replaceChildren();

    body.appendChild(inspHead(node));
    body.appendChild(inspDescription(node));
    body.appendChild(inspStatus(node));
    body.appendChild(inspChecklist(node));
    body.appendChild(inspReferences(node));
    body.appendChild(inspProgress(node));
    body.appendChild(inspTime(node));
    body.appendChild(inspDetails(node));
    body.appendChild(inspActions(node));
  }

  function section(heading) {
    const sec = document.createElement('div');
    sec.className = 'insp-section';
    if (heading) {
      const h = document.createElement('h3');
      h.textContent = heading;
      sec.appendChild(h);
    }
    return sec;
  }

  /* --- 1. title --- */
  function inspHead(node) {
    const head = document.createElement('div');
    head.className = 'insp-head';

    const chain = Store.ancestorsOf(node.id);
    const crumbs = document.createElement('div');
    crumbs.className = 'insp-breadcrumb';
    if (chain.length) {
      chain.forEach((a, i) => {
        const link = document.createElement('span');
        link.textContent = a.name;
        link.addEventListener('click', () => onNavigate(a.id));
        crumbs.appendChild(link);
        crumbs.appendChild(document.createTextNode(i < chain.length - 1 ? ' / ' : ' / '));
      });
    } else {
      crumbs.innerHTML = '<em>field</em>';
    }
    head.appendChild(crumbs);

    const title = document.createElement('div');
    title.className = 'insp-title';
    title.textContent = node.name;
    if (Store.isPrivate(node.id)) {
      const lock = document.createElement('span');
      lock.className = 'insp-lock';
      lock.textContent = 'private';
      lock.title = 'This branch is kept out of the public snapshot.';
      title.appendChild(lock);
    }
    head.appendChild(title);
    return head;
  }

  /* --- 2. description --- */
  function inspDescription(node) {
    const sec = section('What this is');

    const area = document.createElement('textarea');
    area.id = 'f-description';
    area.value = node.description;
    area.placeholder = 'What is this topic, and what would understanding it let you do?';
    area.setAttribute('aria-label', 'Description');
    sec.appendChild(area);

    const state = document.createElement('span');
    state.className = 'save-state';
    sec.appendChild(state);

    /* Autosaves while typing; the inspector is not rebuilt on save, so the
       cursor stays where it is. */
    let timer = null;
    const save = () => {
      if (area.value === node.description) return;
      Store.updateNode(node.id, { description: area.value });
      state.textContent = 'Saved';
      setTimeout(() => { if (state.textContent === 'Saved') state.textContent = ''; }, 1600);
      onQuietChange();
    };
    area.addEventListener('input', () => {
      state.textContent = 'Saving…';
      clearTimeout(timer);
      timer = setTimeout(save, 600);
    });
    area.addEventListener('blur', () => { clearTimeout(timer); save(); });
    return sec;
  }

  /* --- 3. status --- */
  function inspStatus(node) {
    const sec = section('Status');
    const picker = document.createElement('div');
    picker.className = 'status-picker';

    Store.STATUSES.forEach(s => {
      const label = document.createElement('label');
      label.className = 'status-opt' + (s.id === node.status ? ' is-on' : '');
      label.style.color = `var(${s.cssVar})`;
      label.innerHTML = `<input type="radio" name="status" value="${s.id}" hidden ${s.id === node.status ? 'checked' : ''}>
        <i class="dot"></i><span>${s.label}</span>`;
      label.querySelector('input').addEventListener('change', () => {
        Store.updateNode(node.id, { status: s.id });
        onChanged();
      });
      picker.appendChild(label);
    });
    sec.appendChild(picker);
    return sec;
  }

  /* --- 4. checklist: the things to read, build or practise --- */
  function inspChecklist(node) {
    const list = Store.checklistOf(node.id);
    const sec = section(`Resources & tasks${list.total ? ` (${list.done}/${list.total})` : ''}`);

    const items = document.createElement('div');
    items.className = 'check-list';

    node.items.forEach(item => items.appendChild(checkRow(node, item)));

    if (!node.items.length) {
      const hint = document.createElement('p');
      hint.className = 'muted check-empty';
      hint.textContent = 'Add a book, a course, an exercise — anything you can tick off.';
      items.appendChild(hint);
    }
    sec.appendChild(items);

    const form = document.createElement('form');
    form.className = 'check-add';
    form.innerHTML = `
      <input type="text" name="text" placeholder="Add a resource or task" aria-label="New checklist item" autocomplete="off">
      <input type="url" name="url" placeholder="Link (optional)" aria-label="Link">
      <button class="btn btn-sm btn-primary" type="submit">Add</button>`;
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const data = new FormData(form);
      if (Store.addItem(node.id, { text: data.get('text'), url: data.get('url') })) onChanged();
    });
    sec.appendChild(form);
    return sec;
  }

  function checkRow(node, item) {
    const row = document.createElement('div');
    row.className = 'check-row' + (item.done ? ' is-done' : '');
    row.dataset.itemId = item.id;

    const box = document.createElement('button');
    box.className = 'task-check';
    box.textContent = '\u2713';
    box.title = item.done ? 'Mark as not done' : 'Mark as done';
    box.setAttribute('aria-pressed', String(item.done));
    box.addEventListener('click', () => {
      Store.toggleItem(node.id, item.id);
      onChanged();
    });
    row.appendChild(box);

    const text = document.createElement('input');
    text.className = 'check-text';
    text.value = item.text;
    text.setAttribute('aria-label', 'Checklist item');
    text.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); text.blur(); }
      if (ev.key === 'Escape') { text.value = item.text; text.blur(); }
    });
    text.addEventListener('blur', () => {
      const next = text.value.trim();
      if (!next) { text.value = item.text; return; }
      if (next === item.text) return;
      Store.updateItem(node.id, item.id, { text: next });
      onQuietChange();
    });
    row.appendChild(text);

    if (item.url) {
      const link = document.createElement('a');
      link.className = 'check-link';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '\u2197';
      link.title = item.url;
      row.appendChild(link);
    }

    const del = document.createElement('button');
    del.className = 'task-del';
    del.textContent = '\u00d7';
    del.title = 'Remove this item';
    del.setAttribute('aria-label', 'Remove item');
    del.addEventListener('click', () => {
      Store.deleteItem(node.id, item.id);
      onChanged();
    });
    row.appendChild(del);
    return row;
  }


  /* --- references: what this topic relates to, across the tree --- */
  function inspReferences(node) {
    const { out, in: incoming } = Store.linksFor(node.id);
    const sec = section(`References${out.length + incoming.length ? ` (${out.length + incoming.length})` : ''}`);

    const list = document.createElement('div');
    list.className = 'ref-list';

    const row = (link, direction) => {
      const otherId = direction === 'out' ? link.to : link.from;
      const other = Store.byId(otherId);
      if (!other) return null;

      const el = document.createElement('div');
      el.className = 'ref-row';
      el.innerHTML = `
        <span class="ref-dir" title="${direction === 'out' ? 'points at' : 'points here'}">${direction === 'out' ? '&rarr;' : '&larr;'}</span>
        <button class="ref-name">${esc(other.name)}</button>
        <span class="ref-label-text">${esc(link.label)}</span>
        <button class="task-del" title="Remove this reference" aria-label="Remove reference">&times;</button>`;
      el.querySelector('.ref-name').addEventListener('click', () => onNavigate(otherId));
      el.querySelector('.task-del').addEventListener('click', () => {
        Store.deleteLink(link.id);
        onChanged();
      });
      return el;
    };

    out.forEach(l => { const r = row(l, 'out'); if (r) list.appendChild(r); });
    incoming.forEach(l => { const r = row(l, 'in'); if (r) list.appendChild(r); });

    if (!out.length && !incoming.length) {
      const hint = document.createElement('p');
      hint.className = 'muted check-empty';
      hint.textContent = 'Nothing linked yet. A reference says two topics relate without either owning the other.';
      list.appendChild(hint);
    }
    sec.appendChild(list);

    /* Anything but itself is fair game — references cut across the hierarchy,
       which is the whole point of having them. */
    const form = document.createElement('form');
    form.className = 'ref-add';
    form.innerHTML = `
      <select name="target" aria-label="Topic to reference">
        <option value="">Link to…</option>
        ${Store.state.nodes.filter(n => n.id !== node.id).map(n =>
          `<option value="${esc(n.id)}">${'\u00a0\u00a0'.repeat(Store.depthOf(n.id))}${esc(n.name)}</option>`).join('')}
      </select>
      <input type="text" name="label" placeholder="How they relate (optional)" aria-label="Label">
      <button class="btn btn-sm btn-primary" type="submit">Link</button>`;

    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const data = new FormData(form);
      if (Store.addLink(node.id, data.get('target'), data.get('label'))) onChanged();
    });
    sec.appendChild(form);
    return sec;
  }

  /* --- 5. progress, driven by whatever the checklist says --- */
  function inspProgress(node) {
    const sec = section('Progress');
    const kids = Store.childrenOf(node.id);
    const list = Store.checklistOf(node.id);
    const progress = Store.progressOf(node.id);

    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.innerHTML = `<i style="width:${pct(progress)};background:${statusColor(node.status)}"></i>`;
    sec.appendChild(bar);

    const line = document.createElement('div');
    line.className = 'progress-line';
    line.innerHTML = `<strong>${pct(progress)}</strong> <span class="muted">complete</span>`;
    sec.appendChild(line);

    /* Say where the number came from, so it never looks arbitrary. */
    const solved = Store.problemsForNode(node.id).length;
    const source = document.createElement('p');
    source.className = 'muted progress-source';

    if (kids.length) {
      source.textContent = `Averaged across ${kids.length} sub-topic${kids.length === 1 ? '' : 's'}.`;
    } else {
      const claims = [`status (${Store.STATUS_BY_ID[node.status].label})`];
      if (list.total) claims.push(`checklist (${list.done}/${list.total})`);
      if (node.problemTarget > 0) claims.push(`problems (${solved}/${node.problemTarget})`);
      source.textContent = claims.length > 1
        ? `The strongest of: ${claims.join(', ')}.`
        : 'From the status alone. A checklist or a problem target will take over when it claims more.';
    }
    sec.appendChild(source);

    if (!kids.length) {
      const goal = document.createElement('label');
      goal.className = 'field-inline problem-goal';
      goal.innerHTML = `<span>Counts as known after</span>
        <input type="number" id="f-target" min="0" step="1" value="${node.problemTarget || ''}" placeholder="—" style="width:70px">
        <span>problems solved</span>`;
      goal.querySelector('input').addEventListener('change', ev => {
        Store.updateNode(node.id, { problemTarget: Number(ev.target.value) || 0 });
        onChanged();
      });
      sec.appendChild(goal);
    }

    if (solved) {
      const evidence = document.createElement('p');
      evidence.className = 'progress-evidence';
      const hardest = Store.problemsForNode(node.id)
        .reduce((max, p) => Math.max(max, p.difficulty || 0), 0);
      evidence.textContent = `${solved} problem${solved === 1 ? '' : 's'} solved`
        + (hardest ? `, hardest rated ${hardest}.` : '.');
      sec.appendChild(evidence);
    }
    return sec;
  }

  /* --- 6. time logged, and the sessions behind it --- */
  function inspTime(node) {
    const sec = section('Time');
    const own = Store.minutesFor(node.id, false);
    const total = Store.minutesFor(node.id, true);
    const worked = Store.lastWorked(node.id, true);
    const fresh = worked && Store.daysBetween(worked, Store.todayISO()) <= 7;

    const summary = document.createElement('div');
    summary.className = 'insp-facts';
    summary.innerHTML = `
      <span>${formatHours(total)}${own !== total ? ` <span class="muted">(${formatHours(own)} here)</span>` : ''}</span>
      <span class="${fresh ? 'is-fresh' : 'muted'}">${worked ? 'last worked ' + esc(Store.relativeDay(worked)) : 'not started'}</span>`;
    sec.appendChild(summary);

    const form = document.createElement('form');
    form.id = 'sessionForm';
    form.innerHTML = `
      <div class="field-row">
        <input type="date" name="date" value="${Store.todayISO()}" required aria-label="Date">
        <input type="number" name="minutes" min="1" step="5" value="45" required aria-label="Minutes">
      </div>
      <div class="field" style="margin-top:8px">
        <input type="text" name="note" placeholder="What did you cover?" aria-label="Note">
      </div>
      <button class="btn btn-primary btn-sm" type="submit">Log time</button>`;
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const f = new FormData(form);
      Store.addSession({
        nodeId: node.id, date: f.get('date'),
        minutes: Number(f.get('minutes')), note: f.get('note'),
      });
      onChanged();
    });
    sec.appendChild(form);

    const sessions = Store.sessionsFor(node.id, false);
    if (sessions.length) {
      const log = document.createElement('div');
      log.className = 'session-log';
      sessions.slice(0, 10).forEach(s => {
        const row = document.createElement('div');
        row.className = 'session-row';
        row.innerHTML = `
          <span class="date">${esc(formatDate(s.date))}</span>
          <span class="note">${esc(s.note) || '<em class="muted">no note</em>'}</span>
          <span><span class="mins">${s.minutes}m</span> <button class="del" title="Delete this session">&times;</button></span>`;
        row.querySelector('.del').addEventListener('click', () => {
          Store.deleteSession(s.id);
          onChanged();
        });
        log.appendChild(row);
      });
      sec.appendChild(log);
    }
    return sec;
  }

  /* --- 7. details: the plumbing --- */
  function inspDetails(node) {
    const sec = section('Details');
    const moveOpts = [{ id: '', name: '\u2014 top level (its own field) \u2014' }]
      .concat(Store.state.nodes
        .filter(n => n.id !== node.id && !Store.wouldCycle(node.id, n.id))
        .map(n => ({ id: n.id, name: '\u00a0\u00a0'.repeat(Store.depthOf(n.id)) + n.name })));

    const form = document.createElement('form');
    form.id = 'detailsForm';
    form.innerHTML = `
      <div class="field">
        <label for="f-name">Name</label>
        <input id="f-name" name="name" type="text" value="${esc(node.name)}" required>
      </div>
      <div class="field">
        <label for="f-parent">Sits under</label>
        <select id="f-parent" name="parentId">
          ${moveOpts.map(o =>
            `<option value="${esc(o.id)}" ${o.id === (node.parentId || '') ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f-tags">Tags <span class="muted">(comma separated)</span></label>
        <input id="f-tags" name="tags" type="text" value="${esc(node.tags.join(', '))}">
      </div>
      <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
      <span id="saveHint" class="muted save-state"></span>`;

    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const f = new FormData(form);
      try {
        Store.updateNode(node.id, {
          name:     String(f.get('name')).trim() || node.name,
          parentId: f.get('parentId') || null,
          tags:     String(f.get('tags')).split(',').map(t => t.trim()).filter(Boolean),
        });
        onChanged();
      } catch (err) {
        const hint = form.querySelector('#saveHint');
        hint.textContent = err.message;
        hint.style.color = 'var(--danger)';
      }
    });
    sec.appendChild(form);

    /* Privacy belongs to the branch, so it lives with the plumbing. */
    const inherited = !node.private && Store.isPrivate(node.id);
    const privacy = document.createElement('label');
    privacy.className = 'privacy-toggle';
    privacy.innerHTML = `
      <input type="checkbox" id="f-private" ${node.private ? 'checked' : ''} ${inherited ? 'disabled' : ''}>
      <span>Keep this branch private</span>`;
    privacy.querySelector('input').addEventListener('change', ev => {
      Store.updateNode(node.id, { private: ev.target.checked });
      onChanged();
    });
    sec.appendChild(privacy);

    const hint = document.createElement('p');
    hint.className = 'muted privacy-hint';
    hint.textContent = inherited
      ? 'Already private, because a parent is.'
      : 'Private branches go to data/private.json, which is git-ignored and never published.';
    sec.appendChild(hint);

    const stamps = document.createElement('p');
    stamps.className = 'muted insp-stamps';
    stamps.textContent = `Created ${formatDate(node.createdAt)} \u00b7 updated ${formatDate(node.updatedAt)}`;
    sec.appendChild(stamps);
    return sec;
  }

  function inspActions(node) {
    const sec = section('Actions');
    const kids = Store.childrenOf(node.id);
    const extra = Store.descendantsOf(node.id).length;

    const row = document.createElement('div');
    row.className = 'insp-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm';
    addBtn.id = 'addChildBtn';
    addBtn.textContent = '+ Add sub-topic';
    addBtn.addEventListener('click', () => {
      const child = Store.addNode({ parentId: node.id, name: 'New topic' });
      onNavigate(child.id);
    });
    row.appendChild(addBtn);

    if (kids.length) {
      const fold = document.createElement('button');
      fold.className = 'btn btn-sm';
      fold.id = 'collapseBtn';
      fold.textContent = 'Collapse branch';
      fold.addEventListener('click', () => Tree.toggleCollapse(node.id));
      row.appendChild(fold);
    }

    const del = document.createElement('button');
    del.className = 'btn btn-sm danger';
    del.id = 'deleteBtn';
    del.textContent = 'Delete' + (extra ? ` (+${extra})` : '');
    del.addEventListener('click', () => {
      const msg = extra
        ? `Delete "${node.name}" and the ${extra} topic(s) beneath it? This cannot be undone.`
        : `Delete "${node.name}"? This cannot be undone.`;
      if (!confirm(msg)) return;
      const parentId = node.parentId;
      Store.deleteNode(node.id);
      onNavigate(parentId);
    });
    row.appendChild(del);

    sec.appendChild(row);
    return sec;
  }

  /* ---------------- list view ---------------- */

  /* Which branches are folded away in the list, kept separate from the tree's
     own collapse state so folding one does not disturb the other. */
  const listCollapsed = new Set();
  let listSelectedId = null;
  let notesTimer = null;

  const isFresh = iso => iso && Store.daysBetween(iso, Store.todayISO()) <= 7;

  function collectRows(field, { statusFilter, search, sort }) {
    const rows = [];

    if (sort === 'tree') {
      (function walk(node, depth) {
        const hit = (!statusFilter || node.status === statusFilter)
                 && (!search || node.name.toLowerCase().includes(search));
        if (hit) rows.push({ node, depth, foldable: Store.childrenOf(node.id).length > 0 });
        if (!listCollapsed.has(node.id)) Store.childrenOf(node.id).forEach(c => walk(c, depth + 1));
      })(field, 0);
      return rows;
    }

    /* Any other ordering breaks the parent/child shape, so the branch is
       flattened and the indent dropped. */
    const flat = [field, ...Store.descendantsOf(field.id)].filter(node =>
      (!statusFilter || node.status === statusFilter) &&
      (!search || node.name.toLowerCase().includes(search)));

    const compare = {
      recent: (a, b) => (Store.lastWorked(b.id) || '').localeCompare(Store.lastWorked(a.id) || ''),
      time:   (a, b) => Store.minutesFor(b.id) - Store.minutesFor(a.id),
      name:   (a, b) => a.name.localeCompare(b.name),
    }[sort];

    return flat.sort(compare).map(node => ({ node, depth: 0, foldable: false }));
  }

  function renderList(selectedId) {
    if (selectedId !== undefined) listSelectedId = selectedId;

    const statusFilter = document.getElementById('listStatusFilter').value;
    const domainFilter = document.getElementById('listDomainFilter').value;
    const sort         = document.getElementById('listSort').value;
    const search       = document.getElementById('search').value.trim().toLowerCase();
    const container    = document.getElementById('listBody');

    container.replaceChildren();
    let shown = 0;

    Store.roots()
      .filter(field => !domainFilter || field.id === domainFilter)
      .forEach(field => {
        const rows = collectRows(field, { statusFilter, search, sort });
        if (!rows.length) return;
        shown += rows.length;

        const folded = listCollapsed.has('group:' + field.id);
        container.appendChild(fieldHeader(field, rows.length, folded));
        if (folded) return;

        rows.forEach(row => {
          container.appendChild(listRow(row));
          if (row.node.id === listSelectedId) container.appendChild(detailPanel(row.node));
        });
      });

    if (!shown) {
      container.innerHTML = '<p class="muted list-empty">Nothing matches those filters.</p>';
    }
    document.getElementById('listCount').textContent = `${shown} topic${shown === 1 ? '' : 's'}`;
  }

  function fieldHeader(field, count, folded) {
    const head = document.createElement('div');
    head.className = 'list-domain';
    head.innerHTML = `
      <span class="chev ${folded ? 'is-collapsed' : ''}">&#9660;</span>
      <h2>${esc(field.name)}</h2>
      <span class="meta">${count} shown &middot; ${formatHours(Store.minutesFor(field.id))} &middot; ${pct(Store.progressOf(field.id))}</span>
      <span class="mini-bar"><i style="width:${pct(Store.progressOf(field.id))};background:${statusColor(field.status)}"></i></span>`;
    head.addEventListener('click', () => {
      const key = 'group:' + field.id;
      listCollapsed.has(key) ? listCollapsed.delete(key) : listCollapsed.add(key);
      renderList();
    });
    return head;
  }

  function listRow({ node, depth, foldable }) {
    const row = document.createElement('div');
    row.className = 'list-row' + (node.id === listSelectedId ? ' is-selected' : '');

    const worked = Store.lastWorked(node.id);
    const folded = listCollapsed.has(node.id);

    row.innerHTML = `
      <span class="name">
        <span class="indent" style="width:${depth * 15}px"></span>
        <span class="chev ${foldable ? '' : 'is-leaf'} ${folded ? 'is-collapsed' : ''}">&#9660;</span>
        <span class="dot" style="background:${statusColor(node.status)}"></span>
        <span class="title" title="${esc(node.name)}">${esc(node.name)}</span>
        ${node.description ? '<span class="note-flag" title="Has a description">&#9998;</span>' : ''}
      </span>
      <select data-status-for="${esc(node.id)}" aria-label="Status for ${esc(node.name)}">
        ${Store.STATUSES.map(s =>
          `<option value="${s.id}" ${s.id === node.status ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
      <span class="when ${isFresh(worked) ? 'is-fresh' : ''}">${worked ? esc(Store.relativeDay(worked)) : '&mdash;'}</span>
      <span class="hours">${formatHours(Store.minutesFor(node.id))}</span>`;

    row.addEventListener('click', ev => {
      if (ev.target.closest('select')) return;
      if (ev.target.closest('.chev') && foldable) {
        folded ? listCollapsed.delete(node.id) : listCollapsed.add(node.id);
        renderList();
        return;
      }
      /* Selecting in the list stays in the list — it must not jump to the tree. */
      listSelectedId = node.id === listSelectedId ? null : node.id;
      renderList();
      onSelect(listSelectedId);
    });

    row.querySelector('select').addEventListener('change', ev => {
      Store.updateNode(node.id, { status: ev.target.value });
      onChanged();
    });

    return row;
  }

  /* The inline editor that opens under the selected row: notes, a quick time
     log, and the actions that would otherwise need the tree. */
  function detailPanel(node) {
    const panel = document.createElement('div');
    panel.className = 'list-detail';

    const chain = Store.ancestorsOf(node.id).map(a => a.name).join(' / ');
    const worked = Store.lastWorked(node.id);

    panel.innerHTML = `
      <div class="ld-head">
        ${chain ? `<span class="crumb">${esc(chain)} /</span>` : ''}
        <strong>${esc(node.name)}</strong>
        <span>${worked ? 'last worked ' + esc(Store.relativeDay(worked)) : 'not started yet'}</span>
        <span>${formatHours(Store.minutesFor(node.id))} logged</span>
        <span>${pct(Store.progressOf(node.id))} complete</span>
      </div>
      <textarea id="ld-notes" placeholder="What is this topic, and where have you got to?">${esc(node.description)}</textarea>
      <div class="ld-actions">
        <input type="number" id="ld-mins" min="1" step="5" value="30" style="width:70px" aria-label="Minutes">
        <button class="btn btn-sm btn-primary" id="ld-log">Log time today</button>
        <button class="btn btn-sm" id="ld-child">+ Sub-topic</button>
        <button class="btn btn-sm" id="ld-tree">Open in tree</button>
        <span class="save-state" id="ld-save"></span>
      </div>`;

    const notes = panel.querySelector('#ld-notes');
    const saveState = panel.querySelector('#ld-save');

    /* Notes autosave while typing. The list is deliberately not re-rendered
       here — that would tear the textarea out from under the cursor. */
    const saveNotes = () => {
      Store.updateNode(node.id, { description: notes.value });
      saveState.textContent = 'Saved';
      renderInspector(node.id);
      setTimeout(() => { if (saveState.textContent === 'Saved') saveState.textContent = ''; }, 1800);
    };
    notes.addEventListener('input', () => {
      saveState.textContent = 'Saving…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(saveNotes, 600);
    });
    notes.addEventListener('blur', () => {
      if (notes.value === node.description) return;
      clearTimeout(notesTimer);
      saveNotes();
    });

    panel.querySelector('#ld-log').addEventListener('click', () => {
      const minutes = Number(panel.querySelector('#ld-mins').value) || 0;
      if (minutes <= 0) return;
      if (notes.value !== node.description) { clearTimeout(notesTimer); saveNotes(); }
      Store.addSession({ nodeId: node.id, date: Store.todayISO(), minutes, note: '' });
      onChanged();
    });

    panel.querySelector('#ld-child').addEventListener('click', () => {
      const child = Store.addNode({ parentId: node.id, name: 'New topic' });
      listCollapsed.delete(node.id);
      listSelectedId = child.id;
      onChanged();
      onSelect(child.id);
    });

    panel.querySelector('#ld-tree').addEventListener('click', () => onNavigate(node.id));

    return panel;
  }

  function fillListFilters() {
    const statusSel = document.getElementById('listStatusFilter');
    const domainSel = document.getElementById('listDomainFilter');
    const keepStatus = statusSel.value, keepDomain = domainSel.value;

    statusSel.innerHTML = '<option value="">All</option>' +
      Store.STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
    domainSel.innerHTML = '<option value="">All</option>' +
      Store.roots().map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');

    statusSel.value = keepStatus;
    /* A field that was deleted falls back to showing everything. */
    domainSel.value = Store.byId(keepDomain) ? keepDomain : '';
  }

  function collapseAllGroups() {
    const allFolded = Store.roots().every(f => listCollapsed.has('group:' + f.id));
    Store.roots().forEach(f => {
      const key = 'group:' + f.id;
      allFolded ? listCollapsed.delete(key) : listCollapsed.add(key);
    });
    renderList();
    return !allFolded;
  }

  /* ---------------- stats view ---------------- */

  const HEATMAP_WEEKS = 26;

  function renderStats() {
    const nodes    = Store.state.nodes;
    const sessions = Store.state.sessions;
    const counts   = Store.statusCounts();
    const minutes  = sessions.reduce((sum, s) => sum + s.minutes, 0);
    const leaves   = nodes.filter(n => !Store.childrenOf(n.id).length);
    const overall  = Store.roots().length
      ? Store.roots().reduce((sum, d) => sum + Store.progressOf(d.id), 0) / Store.roots().length
      : 0;

    const cutoff = Store.shiftDays(Store.todayISO(), -30);
    const last30 = sessions
      .filter(s => s.date >= cutoff)
      .reduce((sum, s) => sum + s.minutes, 0);

    const cards = [
      { value: pct(overall),          label: 'Overall progress', sub: `across ${Store.roots().length} fields` },
      { value: nodes.length,          label: 'Topics tracked',   sub: `${leaves.length} leaf skills` },
      { value: formatHours(minutes),  label: 'Time logged',      sub: `${formatHours(last30)} in the last 30 days` },
      { value: Store.currentStreak(), label: 'Day streak',       sub: `${sessions.length} sessions total` },
      { value: counts.mastered + counts.proficient, label: 'Solid or better', sub: `${counts.learning + counts.practicing} in progress` },
      { value: Store.problemStats().total, label: 'Problems solved',
        sub: `${Store.problemStats().thisWeek} in the last 7 days` },
    ];

    document.getElementById('statCards').innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="value">${esc(c.value)}</div>
        <div class="label">${esc(c.label)}</div>
        <div class="sub">${esc(c.sub)}</div>
      </div>`).join('');

    renderHeatmap(sessions);
    renderDomainProgress();
    renderRecentSolves();
    renderRecentSessions(sessions);
  }

  /* Solved problems are evidence, so they belong beside the self-reported
     numbers rather than hidden away in their own tab. */
  function renderRecentSolves() {
    const box = document.getElementById('recentSolves');
    const recent = Store.recentProblems(8);
    const block = document.getElementById('solvesBlock');

    block.hidden = Store.problemStats().total === 0;
    if (block.hidden) return;

    box.innerHTML = recent.map(p => {
      const mapped = p.nodeId || Store.nodeForTags(p.tags);
      const node = mapped ? Store.byId(mapped) : null;
      return `
        <div class="sf-row">
          <span class="date">${esc(formatDate(p.solvedAt))}</span>
          <span class="what">
            ${esc(p.title)}
            <small>${esc(Store.sourceLabel(p.source))}${node ? ' · ' + esc(node.name) : ''}${p.tags.length ? ' · ' + esc(p.tags.join(', ')) : ''}</small>
          </span>
          <span class="mins">${p.difficulty ? esc(p.difficulty) : ''}</span>
        </div>`;
    }).join('');
  }

  function renderHeatmap(sessions) {
    const byDay = new Map();
    sessions.forEach(s => byDay.set(s.date, (byDay.get(s.date) || 0) + s.minutes));

    /* Start on the Sunday of the week containing (today - 26 weeks), so the
       grid lines up in clean week columns. */
    const today = Store.todayISO();
    let start = Store.shiftDays(today, -HEATMAP_WEEKS * 7);
    start = Store.shiftDays(start, -Store.dayOfWeek(start));

    const cells = [];

    for (let i = 0; i < HEATMAP_WEEKS * 7 + 7; i++) {
      const iso = Store.shiftDays(start, i);
      const mins = byDay.get(iso) || 0;

      const level = mins === 0 ? 0 : mins < 30 ? 1 : mins < 60 ? 2 : mins < 120 ? 3 : 4;
      const future = iso > today;
      cells.push(`<span class="hm-cell l${level}${future ? ' is-future' : ''}" title="${iso}: ${mins ? formatHours(mins) : 'nothing logged'}"></span>`);
    }
    document.getElementById('heatmap').innerHTML = cells.join('');
  }

  function renderDomainProgress() {
    document.getElementById('domainProgress').innerHTML = Store.roots().map(domain => {
      const ids = new Set([domain.id, ...Store.descendantsOf(domain.id).map(n => n.id)]);
      const counts = Store.statusCounts(ids);
      const total = ids.size;

      const stack = Store.STATUSES.map(s => {
        const share = (counts[s.id] / total) * 100;
        return share ? `<i style="width:${share}%;background:var(${s.cssVar})" title="${counts[s.id]} ${s.label}"></i>` : '';
      }).join('');

      return `
        <div class="dp-row">
          <div class="dp-head">
            <strong>${esc(domain.name)}</strong>
            <span class="meta">${total} topics · ${formatHours(Store.minutesFor(domain.id))}</span>
            <span class="pct">${pct(Store.progressOf(domain.id))}</span>
          </div>
          <div class="dp-stack">${stack}</div>
        </div>`;
    }).join('') || '<p class="muted">No fields yet.</p>';
  }

  function renderRecentSessions(sessions) {
    const recent = sessions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
    const feed = document.getElementById('recentSessions');

    if (!recent.length) {
      feed.innerHTML = '<p class="muted">No sessions logged yet. Pick a topic in the tree and log some time.</p>';
      return;
    }

    feed.innerHTML = recent.map(s => {
      const node = Store.byId(s.nodeId);
      const domain = node ? Store.domainOf(s.nodeId) : null;
      return `
        <div class="sf-row">
          <span class="date">${formatDate(s.date)}</span>
          <span class="what">
            <button data-goto="${esc(s.nodeId)}" style="font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left">
              ${esc(node ? node.name : 'deleted topic')}
            </button>
            <small>${domain && domain.id !== s.nodeId ? esc(domain.name) + ' · ' : ''}${esc(s.note)}</small>
          </span>
          <span class="mins">${s.minutes}m</span>
        </div>`;
    }).join('');

    feed.querySelectorAll('[data-goto]').forEach(btn =>
      btn.addEventListener('click', () => onNavigate(btn.dataset.goto)));
  }


  /* ---------------- focus view ---------------- */

  /* Which past days are expanded in the history. */
  const openDays = new Set();

  function formatDayName(iso) {
    const today = Store.todayISO();
    if (iso === today) return 'Today';
    if (iso === Store.shiftDays(today, -1)) return 'Yesterday';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function renderFocus() {
    const today = Store.todayISO();
    const summary = Store.focusSummary(today);

    document.getElementById('focusDateLabel').textContent =
      new Date(today + 'T00:00:00').toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' });

    document.getElementById('focusSummary').textContent = summary.total
      ? `${summary.done} of ${summary.total} done`
      : 'Nothing planned yet — add the first thing you want to focus on.';

    const ring = document.getElementById('focusRing');
    ring.style.setProperty('--pct', Math.round(summary.ratio * 100));
    ring.innerHTML = `<span>${summary.total ? Math.round(summary.ratio * 100) + '%' : '&mdash;'}</span>`;

    /* the topic picker mirrors the tree, indented so the shape is visible */
    const picker = document.getElementById('focusTopic');
    const keep = picker.value;
    picker.innerHTML = '<option value="">No topic</option>' +
      Store.state.nodes.map(n =>
        `<option value="${esc(n.id)}">${'&nbsp;&nbsp;'.repeat(Store.depthOf(n.id))}${esc(n.name)}</option>`).join('');
    picker.value = Store.byId(keep) ? keep : '';

    const list = document.getElementById('focusList');
    const tasks = Store.focusFor(today);
    list.replaceChildren();

    if (!tasks.length) {
      list.innerHTML = '<p class="focus-empty">No tasks for today yet. What is the one thing worth finishing?</p>';
    } else {
      tasks.forEach(t => list.appendChild(taskRow(t)));
    }

    /* offer to pull forward whatever was left unfinished */
    const carry = document.getElementById('focusCarry');
    const earlier = Store.focusDates().filter(d => d < today);
    const pending = earlier.length ? Store.focusFor(earlier[0]).filter(t => !t.done).length : 0;
    carry.hidden = pending === 0;
    if (pending) {
      carry.textContent = `Carry over ${pending} unfinished from ${formatDayName(earlier[0])}`;
      carry.onclick = () => {
        Store.carryOverTo(today);
        renderFocus();
        onChanged();
      };
    }

    renderFocusHistory(today);
  }

  function taskRow(task) {
    const row = document.createElement('div');
    row.className = 'task' + (task.done ? ' is-done' : '');
    row.dataset.taskId = task.id;

    const check = document.createElement('button');
    check.className = 'task-check';
    check.textContent = '\u2713';
    check.title = task.done ? 'Mark as not done' : 'Mark as done';
    check.setAttribute('aria-pressed', String(task.done));
    check.addEventListener('click', () => {
      Store.toggleTask(task.id);
      renderFocus();
      onChanged();
    });
    row.appendChild(check);

    /* The text stays editable in place, so fixing a task is not a delete
       and retype. */
    const text = document.createElement('input');
    text.className = 'task-text';
    text.value = task.text;
    text.setAttribute('aria-label', 'Task');
    text.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); text.blur(); }
      if (ev.key === 'Escape') { text.value = task.text; text.blur(); }
    });
    text.addEventListener('blur', () => {
      const next = text.value.trim();
      if (!next) { text.value = task.text; return; }
      if (next === task.text) return;
      Store.updateTask(task.id, { text: next });
      onChanged();
    });
    row.appendChild(text);

    const node = task.nodeId ? Store.byId(task.nodeId) : null;
    if (node) {
      const chip = document.createElement('button');
      chip.className = 'task-topic';
      chip.textContent = node.name;
      chip.title = 'Open ' + node.name + ' in the tree';
      chip.addEventListener('click', () => onNavigate(task.nodeId));
      row.appendChild(chip);
    }

    const del = document.createElement('button');
    del.className = 'task-del';
    del.textContent = '\u00d7';
    del.title = 'Remove this task';
    del.setAttribute('aria-label', 'Remove task');
    del.addEventListener('click', () => {
      Store.deleteTask(task.id);
      renderFocus();
      onChanged();
    });
    row.appendChild(del);

    return row;
  }

  /* Every earlier day is kept, so the checklists build into a record of what
     you actually set out to do. */
  function renderFocusHistory(today) {
    const box = document.getElementById('focusHistory');
    const days = Store.focusDates().filter(d => d !== today);
    box.replaceChildren();

    if (!days.length) {
      box.innerHTML = '<p class="focus-empty">Past days collect here once you have planned a few.</p>';
      return;
    }

    days.forEach(date => {
      const summary = Store.focusSummary(date);
      const open = openDays.has(date);

      const group = document.createElement('div');
      group.className = 'day-group';

      const head = document.createElement('div');
      head.className = 'day-head';
      head.innerHTML = `
        <span class="chev ${open ? '' : 'is-collapsed'}">&#9660;</span>
        <span class="day-name">${esc(formatDayName(date))}</span>
        <span class="day-bar"><i style="width:${Math.round(summary.ratio * 100)}%"></i></span>
        <span class="day-score">${summary.done}/${summary.total}</span>`;
      head.addEventListener('click', () => {
        open ? openDays.delete(date) : openDays.add(date);
        renderFocus();
      });
      group.appendChild(head);

      if (open) {
        const tasks = document.createElement('div');
        tasks.className = 'day-tasks';
        Store.focusFor(date).forEach(t => tasks.appendChild(taskRow(t)));
        group.appendChild(tasks);
      }
      box.appendChild(group);
    });
  }

  function submitFocusTask() {
    const input = document.getElementById('focusText');
    const topic = document.getElementById('focusTopic');
    const task = Store.addTask({ text: input.value, nodeId: topic.value || null });
    if (!task) return false;
    input.value = '';
    renderFocus();
    onChanged();
    input.focus();
    return true;
  }

  /* ---------------- legend ---------------- */

  function renderLegend() {
    const counts = Store.statusCounts();
    document.getElementById('legend').innerHTML = Store.STATUSES.map(s => `
      <li>
        <i class="dot" style="background:var(${s.cssVar})"></i>
        <span>${s.label}</span>
        <span class="count">${counts[s.id]}</span>
      </li>`).join('');
  }

  function init(opts) {
    onNavigate = opts.onNavigate || onNavigate;
    onSelect   = opts.onSelect   || onSelect;
    onChanged  = opts.onChanged  || onChanged;
    onQuietChange = opts.onQuietChange || onQuietChange;
  }

  return {
    init, renderInspector, renderList, renderStats, renderLegend, renderFocus,
    fillListFilters, collapseAllGroups, submitFocusTask, formatHours,
    setListSelection(id) { listSelectedId = id; },
  };
})();
