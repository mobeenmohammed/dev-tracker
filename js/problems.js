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
  let onNotice   = () => {};

  let filter = { source: '', tag: '' };
  let expandedId = null;
  let notesTimer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FELT = ['', 'trivial', 'easy', 'fair', 'hard', 'brutal'];

  function render() {
    renderStats();
    renderRevisit();
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
      { value: `${s.levels.easy}/${s.levels.medium}/${s.levels.hard}`,
        label: 'Easy / Medium / Hard', sub: 'where the source bands them' },
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

  /* --- what is worth going back to --- */

  /* Counting solved problems rewards volume. Coming back to the ones that beat
     you is what actually moves the needle, so they get their own place. */
  function renderRevisit() {
    const box = document.getElementById('revisitList');
    const block = document.getElementById('revisitBlock');
    const due = Store.problemsToRevisit();

    block.hidden = due.length === 0;
    if (!due.length) return;

    document.getElementById('revisitCount').textContent =
      `${due.length} problem${due.length === 1 ? '' : 's'}`;

    box.replaceChildren();
    due.slice(0, 12).forEach(p => {
      const row = document.createElement('div');
      row.className = 'revisit-row';
      const help = p.independence ? Store.INDEPENDENCE.find(i => i.id === p.independence) : null;

      row.innerHTML = `
        <span class="rv-title">${esc(p.title)}</span>
        <span class="rv-why">${esc(Store.sourceLabel(p.source))}${
          help && help.id !== 'independent' ? ' · ' + esc(help.label.toLowerCase()) : ''}${
          p.mistake ? ' · ' + esc(p.mistake) : ''}</span>
        <span class="rv-when">solved ${esc(Store.relativeDay(p.solvedAt))}</span>
        <button class="btn btn-sm" data-act="open">Open</button>
        <button class="btn btn-sm btn-primary" data-act="done">Re-solved</button>`;

      row.querySelector('[data-act="open"]').addEventListener('click', () => {
        filter.source = '';
        filter.tag = '';
        expandedId = p.id;
        render();
        document.getElementById('problemList').scrollIntoView({ block: 'nearest' });
      });
      row.querySelector('[data-act="done"]').addEventListener('click', () => {
        Store.markRevisited(p.id, { independent: true });
        onChanged();
      });
      box.appendChild(row);
    });
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

    /* Removing a whole source in one go is only offered while that source is
       the one being looked at, so it cannot be hit by accident. */
    const purge = document.getElementById('purgeSource');
    const fromSource = filter.source ? Store.problemsMatching({ source: filter.source }) : [];
    purge.hidden = !filter.source || fromSource.length === 0;
    if (!purge.hidden) {
      const label = Store.sourceLabel(filter.source);
      purge.textContent = `Remove all ${fromSource.length} from ${label}`;
      purge.onclick = () => {
        if (!confirm(`Delete all ${fromSource.length} problems from ${label}?

` +
                     'This only clears them here. If the extension syncs that account again ' +
                     'it will not re-add them, unless you also reset its sync position.')) return;
        const removed = Store.deleteProblemsFrom(filter.source);
        filter.source = '';
        onChanged();
        onNotice(`Removed ${removed} problem${removed === 1 ? '' : 's'}.`);
      };
    }

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
      <span class="p-rating">${p.difficulty ? esc(p.difficulty)
        : p.level ? `<span class="level level-${esc(p.level)}">${esc(p.level)}</span>` : '—'}</span>
      <span class="p-felt" title="How hard it felt">${p.perceived ? '&#9679;'.repeat(p.perceived) : '—'}</span>
      <span class="p-state state-${esc(p.state)}" title="${esc(p.independence || 'help not recorded')}">${
        esc((Store.PROBLEM_STATES.find(st => st.id === p.state) || {}).label || p.state)}</span>
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
          <span>Rating <span class="muted">(numeric, e.g. Codeforces)</span></span>
          <input type="number" id="pd-rating" min="0" step="100" value="${p.difficulty || ''}">
        </label>
        <label class="field">
          <span>Level <span class="muted">(banded, e.g. LeetCode)</span></span>
          <select id="pd-level">
            <option value="">—</option>
            ${Store.LEVELS.map(l =>
              `<option value="${l}" ${l === p.level ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}
          </select>
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
        <span class="field-label">Tags <span class="muted">(comma separated, suggestions as you type)</span></span>
        <input type="text" id="pd-tags" list="tagOptions" value="${esc(p.tags.join(', '))}">
      </div>

      <div class="debrief">
        <div class="field">
          <span class="field-label">Did you get there on your own?</span>
          <div class="felt-picker">
            ${Store.INDEPENDENCE.map(i =>
              `<button class="felt-opt ${p.independence === i.id ? 'is-on' : ''}" data-help="${i.id}">${esc(i.label)}</button>`).join('')}
          </div>
        </div>

        <div class="pd-grid">
          <label class="field"><span>Attempts</span>
            <input type="number" id="pd-attempts" min="0" step="1" value="${p.attempts || ''}"></label>
          <label class="field"><span>State</span>
            <select id="pd-state">
              ${Store.PROBLEM_STATES.map(st =>
                `<option value="${st.id}" ${st.id === p.state ? 'selected' : ''}>${st.label}</option>`).join('')}
            </select></label>
          <label class="field"><span>Revisit in</span>
            <select id="pd-review">
              <option value="">not scheduled</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">2 weeks</option>
              <option value="30">a month</option>
            </select></label>
        </div>

        <div class="field">
          <span class="field-label">Where it went wrong <span class="muted">(off-by-one, wrong data structure…)</span></span>
          <input type="text" id="pd-mistake" value="${esc(p.mistake)}">
        </div>
        <div class="field">
          <span class="field-label">What you took from it</span>
          <input type="text" id="pd-lesson" value="${esc(p.lesson)}" placeholder="Prefix sums avoid repeated work">
        </div>
        ${p.reviewOn ? `<p class="muted review-when">Booked for a revisit on ${esc(p.reviewOn)}.</p>` : ''}
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
    panel.querySelector('#pd-level').addEventListener('change', ev => {
      Store.updateProblem(p.id, { level: ev.target.value || null });
      onChanged();
    });
    panel.querySelector('#pd-node').addEventListener('change', ev => {
      Store.updateProblem(p.id, { nodeId: ev.target.value || null });
      onChanged();
    });
    panel.querySelectorAll('[data-help]').forEach(btn =>
      btn.addEventListener('click', () => {
        const value = btn.dataset.help;
        Store.updateProblem(p.id, { independence: p.independence === value ? null : value });
        onChanged();
      }));

    panel.querySelector('#pd-attempts').addEventListener('change', ev => save({ attempts: ev.target.value }));
    panel.querySelector('#pd-mistake').addEventListener('change', ev => save({ mistake: ev.target.value }));
    panel.querySelector('#pd-lesson').addEventListener('change', ev => save({ lesson: ev.target.value }));
    panel.querySelector('#pd-state').addEventListener('change', ev => {
      Store.updateProblem(p.id, { state: ev.target.value });
      onChanged();
    });
    panel.querySelector('#pd-review').addEventListener('change', ev => {
      Store.scheduleReview(p.id, Number(ev.target.value) || 0);
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

  /* The catalogue is a starting vocabulary, not a whitelist: it feeds the
     suggestion list, and anything typed that is not in it still works. */
  function fillTagOptions() {
    const list = document.getElementById('tagOptions');
    if (!list) return;
    list.innerHTML = Store.knownTags().map(t => `<option value="${esc(t)}"></option>`).join('');
  }

  function fillForm() {
    fillTagOptions();
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
    onNotice   = opts.onNotice   || onNotice;
  }

  return { init, render, fillForm, fillTagOptions, submitProblem, importSolves,
           get filter() { return filter; } };
})();
