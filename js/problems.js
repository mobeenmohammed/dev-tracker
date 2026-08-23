/* ============================================================
   problems.js — the Problems view.

   Solved problems are evidence in a way self-reported status is not:
   "proficient at DP" is a guess, "solved 15 DP problems, hardest 1900" is a
   record. This view counts them, groups them by tag, and lets those tags be
   mapped onto topics in the tree so the evidence reaches the learning metric.
   ============================================================ */

const Problems = (() => {

  let onNavigate = () => {};
  let onChanged  = () => {};

  let filter = { source: '', tag: '' };
  let expandedId = null;
  let notesTimer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FELT = ['', 'trivial', 'easy', 'fair', 'hard', 'brutal'];

  function render() {
    renderStats();
    renderSources();
    renderTags();
    renderList();
    renderMapping();
  }

  /* --- headline numbers --- */
  function renderStats() {
    const s = Store.problemStats(filter);
    const cards = [
      { value: s.total,    label: 'Problems solved', sub: `${s.thisWeek} in the last 7 days` },
      { value: s.hardest ?? '—', label: 'Hardest rating', sub: s.hardest ? 'by source rating' : 'no ratings yet' },
      { value: s.avgFelt ? s.avgFelt.toFixed(1) + '/5' : '—', label: 'Average difficulty', sub: 'how hard they felt' },
      { value: s.unmapped, label: 'Unmapped', sub: s.unmapped ? 'tags with no topic yet' : 'every solve counts' },
    ];
    document.getElementById('problemStats').innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="value">${esc(c.value)}</div>
        <div class="label">${esc(c.label)}</div>
        <div class="sub">${esc(c.sub)}</div>
      </div>`).join('');
  }

  /* --- the platform you are looking at --- */
  function renderSources() {
    const box = document.getElementById('problemSources');
    const counts = new Map();
    Store.problemsMatching().forEach(p => counts.set(p.source, (counts.get(p.source) || 0) + 1));

    box.replaceChildren();

    const chip = (id, label, count) => {
      const btn = document.createElement('button');
      btn.className = 'chip-btn' + (filter.source === id ? ' is-on' : '');
      btn.innerHTML = `${esc(label)}${count != null ? ` <span class="chip-count">${count}</span>` : ''}`;
      btn.addEventListener('click', () => {
        filter.source = filter.source === id ? '' : id;
        render();
      });
      return btn;
    };

    const all = document.createElement('button');
    all.className = 'chip-btn' + (filter.source ? '' : ' is-on');
    all.innerHTML = `All <span class="chip-count">${Store.problemsMatching().length}</span>`;
    all.addEventListener('click', () => { filter.source = ''; render(); });
    box.appendChild(all);

    Store.allSources().forEach(src => box.appendChild(chip(src.id, src.label, counts.get(src.id) || 0)));

    const add = document.createElement('button');
    add.className = 'chip-btn chip-add';
    add.textContent = '+ Platform';
    add.title = 'Add a platform of your own';
    add.addEventListener('click', () => {
      const label = prompt('Name the platform (e.g. "Advent of Code"):');
      if (!label) return;
      if (!Store.addSource(label)) return;
      onChanged();
    });
    box.appendChild(add);
  }

  /* --- what you have actually been practising --- */
  function renderTags() {
    const box = document.getElementById('problemTags');
    const tags = Store.tagIndex({ source: filter.source });
    box.replaceChildren();

    if (!tags.length) {
      box.innerHTML = '<p class="muted">No tags yet. Add a solve, or import from a platform.</p>';
      return;
    }

    const max = tags[0].count;
    tags.forEach(({ tag, count, nodeId }) => {
      const row = document.createElement('div');
      row.className = 'tag-row' + (filter.tag === tag ? ' is-on' : '');
      const node = nodeId ? Store.byId(nodeId) : null;
      row.innerHTML = `
        <button class="tag-name">${esc(tag)}</button>
        <span class="tag-bar"><i style="width:${Math.round((count / max) * 100)}%"></i></span>
        <span class="tag-count">${count}</span>
        <span class="tag-target ${node ? '' : 'is-unmapped'}">${node ? esc(node.name) : 'unmapped'}</span>`;
      row.querySelector('.tag-name').addEventListener('click', () => {
        filter.tag = filter.tag === tag ? '' : tag;
        render();
      });
      if (node) {
        row.querySelector('.tag-target').addEventListener('click', () => onNavigate(node.id));
      }
      box.appendChild(row);
    });
  }

  /* --- recent solves, each expandable for notes and difficulty --- */
  function renderList() {
    const box = document.getElementById('problemList');
    const list = Store.problemsMatching(filter)
      .sort((a, b) => b.solvedAt.localeCompare(a.solvedAt));

    box.replaceChildren();
    document.getElementById('problemCount').textContent =
      `${list.length} problem${list.length === 1 ? '' : 's'}` +
      (filter.tag ? ` tagged ${filter.tag}` : '');

    if (!list.length) {
      box.innerHTML = '<p class="muted list-empty">Nothing here yet. Add a solve below.</p>';
      return;
    }

    list.forEach(p => {
      box.appendChild(problemRow(p));
      if (p.id === expandedId) box.appendChild(problemDetail(p));
    });
  }

  function problemRow(p) {
    const row = document.createElement('div');
    row.className = 'problem-row' + (p.id === expandedId ? ' is-selected' : '');
    const mapped = p.nodeId || Store.nodeForTags(p.tags);
    const node = mapped ? Store.byId(mapped) : null;

    row.innerHTML = `
      <span class="p-title">
        <span class="p-source">${esc(Store.sourceLabel(p.source))}</span>
        <strong>${esc(p.title)}</strong>
        ${p.notes ? '<span class="note-flag" title="Has notes">&#9998;</span>' : ''}
      </span>
      <span class="p-tags">${p.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="muted">no tags</span>'}</span>
      <span class="p-rating">${p.difficulty ? esc(p.difficulty) : '—'}</span>
      <span class="p-felt" title="How hard it felt">${p.perceived ? '&#9679;'.repeat(p.perceived) : '—'}</span>
      <span class="p-node ${node ? '' : 'is-unmapped'}">${node ? esc(node.name) : 'unmapped'}</span>
      <span class="p-date">${esc(Store.relativeDay(p.solvedAt))}</span>`;

    row.addEventListener('click', ev => {
      if (ev.target.closest('a')) return;
      expandedId = p.id === expandedId ? null : p.id;
      renderList();
    });
    return row;
  }

  function problemDetail(p) {
    const panel = document.createElement('div');
    panel.className = 'problem-detail';

    panel.innerHTML = `
      <div class="pd-grid">
        <label class="field">
          <span>Solved on</span>
          <input type="date" id="pd-date" value="${esc(p.solvedAt)}">
        </label>
        <label class="field">
          <span>Minutes</span>
          <input type="number" id="pd-mins" min="0" step="5" value="${p.minutes || ''}">
        </label>
        <label class="field">
          <span>Rating <span class="muted">(from the site)</span></span>
          <input type="number" id="pd-rating" min="0" step="100" value="${p.difficulty || ''}">
        </label>
        <label class="field">
          <span>Counts towards</span>
          <select id="pd-node">
            <option value="">— by tag, or unmapped —</option>
            ${Store.state.nodes.map(n =>
              `<option value="${esc(n.id)}" ${n.id === p.nodeId ? 'selected' : ''}>${'  '.repeat(Store.depthOf(n.id))}${esc(n.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="field">
        <span class="field-label">How hard did it feel?</span>
        <div class="felt-picker">
          ${[1, 2, 3, 4, 5].map(v =>
            `<button class="felt-opt ${p.perceived === v ? 'is-on' : ''}" data-felt="${v}">${v} <small>${FELT[v]}</small></button>`).join('')}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Tags <span class="muted">(comma separated)</span></span>
        <input type="text" id="pd-tags" value="${esc(p.tags.join(', '))}">
      </div>

      <textarea id="pd-notes" placeholder="What was the idea? What did you miss the first time?">${esc(p.notes)}</textarea>

      <div class="pd-actions">
        ${p.url ? `<a class="btn btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open problem</a>` : ''}
        <button class="btn btn-sm danger" id="pd-del">Delete</button>
        <span class="save-state" id="pd-save"></span>
      </div>`;

    const save = patch => {
      Store.updateProblem(p.id, patch);
      const state = panel.querySelector('#pd-save');
      state.textContent = 'Saved';
      setTimeout(() => { if (state.textContent === 'Saved') state.textContent = ''; }, 1500);
    };

    panel.querySelectorAll('[data-felt]').forEach(btn =>
      btn.addEventListener('click', () => {
        const value = Number(btn.dataset.felt);
        Store.updateProblem(p.id, { perceived: p.perceived === value ? null : value });
        onChanged();
      }));

    panel.querySelector('#pd-date').addEventListener('change', ev => save({ solvedAt: ev.target.value }));
    panel.querySelector('#pd-mins').addEventListener('change', ev => save({ minutes: ev.target.value }));
    panel.querySelector('#pd-rating').addEventListener('change', ev => save({ difficulty: ev.target.value }));
    panel.querySelector('#pd-node').addEventListener('change', ev => {
      Store.updateProblem(p.id, { nodeId: ev.target.value || null });
      onChanged();
    });
    panel.querySelector('#pd-tags').addEventListener('blur', ev => {
      Store.updateProblem(p.id, { tags: ev.target.value.split(',').map(t => t.trim()).filter(Boolean) });
      onChanged();
    });

    /* Notes autosave, and the list is not rebuilt so the cursor survives. */
    const notes = panel.querySelector('#pd-notes');
    notes.addEventListener('input', () => {
      panel.querySelector('#pd-save').textContent = 'Saving…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => save({ notes: notes.value }), 600);
    });
    notes.addEventListener('blur', () => {
      if (notes.value === p.notes) return;
      clearTimeout(notesTimer);
      save({ notes: notes.value });
    });

    panel.querySelector('#pd-del').addEventListener('click', () => {
      if (!confirm(`Delete "${p.title}"?`)) return;
      Store.deleteProblem(p.id);
      expandedId = null;
      onChanged();
    });

    return panel;
  }

  /* --- the mapping table: tags in, topics out --- */
  function renderMapping() {
    const box = document.getElementById('tagMapping');
    const tags = Store.tagIndex();
    box.replaceChildren();

    if (!tags.length) {
      box.innerHTML = '<p class="muted">Tags appear here once you have logged a solve.</p>';
      return;
    }

    tags.forEach(({ tag, count, nodeId }) => {
      const row = document.createElement('div');
      row.className = 'map-row';
      row.innerHTML = `
        <span class="map-tag">${esc(tag)} <span class="muted">(${count})</span></span>
        <select data-map="${esc(tag)}">
          <option value="">— unmapped —</option>
          ${Store.state.nodes.map(n =>
            `<option value="${esc(n.id)}" ${n.id === nodeId ? 'selected' : ''}>${'  '.repeat(Store.depthOf(n.id))}${esc(n.name)}</option>`).join('')}
        </select>`;
      row.querySelector('select').addEventListener('change', ev => {
        Store.setTagMapping(tag, ev.target.value || null);
        onChanged();
      });
      box.appendChild(row);
    });
  }

  /* --- adding a solve by hand --- */
  function submitProblem() {
    const form = document.getElementById('problemForm');
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim();
    if (!title) return false;

    const { problem } = Store.recordSolve({
      source:    data.get('source') || 'other',
      problemId: data.get('problemId'),
      title,
      url:       data.get('url'),
      tags:      String(data.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean),
      difficulty: data.get('difficulty'),
      solvedAt:  data.get('solvedAt') || Store.todayISO(),
      minutes:   data.get('minutes'),
    });

    form.reset();
    form.querySelector('[name="solvedAt"]').value = Store.todayISO();
    expandedId = problem ? problem.id : null;
    onChanged();
    form.querySelector('[name="title"]').focus();
    return true;
  }

  function fillForm() {
    const select = document.querySelector('#problemForm [name="source"]');
    const keep = select.value;
    select.innerHTML = Store.allSources()
      .map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
    select.value = keep || 'leetcode';

    const date = document.querySelector('#problemForm [name="solvedAt"]');
    if (!date.value) date.value = Store.todayISO();
  }

  /* --- bulk import, the path a browser extension will eventually write --- */
  function importSolves(text) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.problems;
    if (!Array.isArray(list)) throw new Error('Expected an array of solves, or an object with a "problems" array.');
    const result = Store.recordSolves(list);
    onChanged();
    return result;
  }

  function init(opts) {
    onNavigate = opts.onNavigate || onNavigate;
    onChanged  = opts.onChanged  || onChanged;
  }

  return { init, render, fillForm, submitProblem, importSolves,
           get filter() { return filter; } };
})();
