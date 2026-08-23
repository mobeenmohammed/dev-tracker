/* ============================================================
   applications.js — the Applications view.

   This data never reaches the published site. Applications live only in the
   private half of the state, so the repository can stay public without
   putting where you applied, and who turned you down, on the internet.
   ============================================================ */

const Applications = (() => {

  let onChanged = () => {};
  let expandedId = null;
  let notesTimer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const stageLabel = id => (Store.STAGE_BY_ID[id] || { label: id }).label;

  function render() {
    renderStats();
    renderDue();
    renderBoard();
  }

  function renderStats() {
    const s = Store.applicationStats();
    const cards = [
      { value: s.total,  label: 'Applications', sub: `${s.open} still open` },
      { value: s.interviews, label: 'Reached interview', sub: s.total ? Math.round((s.interviews / s.total) * 100) + '% of all' : 'none yet' },
      { value: s.offers, label: 'Offers', sub: `${s.rejected} rejected` },
      { value: Math.round(s.responseRate * 100) + '%', label: 'Heard back', sub: 'moved past applied' },
    ];
    document.getElementById('appStats').innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="value">${esc(c.value)}</div>
        <div class="label">${esc(c.label)}</div>
        <div class="sub">${esc(c.sub)}</div>
      </div>`).join('');
  }

  /* Anything with a date that has arrived, or is about to. */
  function renderDue() {
    const box = document.getElementById('appDue');
    const due = Store.applicationStats().dueSoon;
    box.replaceChildren();
    box.hidden = due.length === 0;
    if (!due.length) return;

    const today = Store.todayISO();
    box.innerHTML = `<h3>Needs attention</h3>` + due.map(a => `
      <div class="due-row ${a.nextDue < today ? 'is-late' : ''}">
        <strong>${esc(a.company)}</strong>
        <span>${esc(a.nextAction || 'follow up')}</span>
        <span class="due-when">${esc(Store.relativeDay(a.nextDue))}</span>
      </div>`).join('');
  }

  /* Grouped by stage, so the shape of the search is visible at a glance. */
  function renderBoard() {
    const box = document.getElementById('appBoard');
    const all = Store.applications();
    box.replaceChildren();

    if (!all.length) {
      box.innerHTML = `<p class="muted list-empty">No applications yet. Add the first one below —
        it stays on this machine and is never published.</p>`;
      return;
    }

    Store.APP_STAGES.forEach(stage => {
      const inStage = all.filter(a => a.stage === stage.id);
      if (!inStage.length) return;

      const group = document.createElement('div');
      group.className = 'app-group';
      group.innerHTML = `<h3 class="app-stage-head">
          <span class="stage-dot stage-${esc(stage.id)}"></span>
          ${esc(stage.label)} <span class="muted">${inStage.length}</span>
        </h3>`;

      inStage.forEach(app => {
        group.appendChild(appRow(app));
        if (app.id === expandedId) group.appendChild(appDetail(app));
      });
      box.appendChild(group);
    });
  }

  function appRow(app) {
    const row = document.createElement('div');
    row.className = 'app-row' + (app.id === expandedId ? ' is-selected' : '');
    row.innerHTML = `
      <span class="app-company">
        <strong>${esc(app.company)}</strong>
        ${app.notes ? '<span class="note-flag" title="Has notes">&#9998;</span>' : ''}
      </span>
      <span class="app-role">${esc(app.role) || '<span class="muted">no role</span>'}</span>
      <span class="app-loc muted">${esc(app.location)}</span>
      <select class="app-stage" aria-label="Stage for ${esc(app.company)}">
        ${Store.APP_STAGES.map(s =>
          `<option value="${s.id}" ${s.id === app.stage ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
      <span class="app-date">${esc(Store.relativeDay(app.appliedAt))}</span>`;

    row.querySelector('.app-stage').addEventListener('click', ev => ev.stopPropagation());
    row.querySelector('.app-stage').addEventListener('change', ev => {
      Store.updateApplication(app.id, { stage: ev.target.value });
      onChanged();
    });
    row.addEventListener('click', () => {
      expandedId = app.id === expandedId ? null : app.id;
      renderBoard();
    });
    return row;
  }

  function appDetail(app) {
    const panel = document.createElement('div');
    panel.className = 'app-detail';

    panel.innerHTML = `
      <div class="pd-grid">
        <label class="field"><span>Role</span><input type="text" id="ad-role" value="${esc(app.role)}"></label>
        <label class="field"><span>Location</span><input type="text" id="ad-loc" value="${esc(app.location)}"></label>
        <label class="field"><span>Applied on</span><input type="date" id="ad-applied" value="${esc(app.appliedAt)}"></label>
        <label class="field"><span>Where from</span><input type="text" id="ad-source" value="${esc(app.source)}" placeholder="referral, careers page…"></label>
        <label class="field"><span>Next action</span><input type="text" id="ad-next" value="${esc(app.nextAction)}" placeholder="follow up, prepare for OA…"></label>
        <label class="field"><span>Due</span><input type="date" id="ad-due" value="${esc(app.nextDue)}"></label>
      </div>

      <div class="field">
        <span class="field-label">Link</span>
        <input type="url" id="ad-url" value="${esc(app.url)}" placeholder="https://…">
      </div>

      <textarea id="ad-notes" placeholder="Who you spoke to, what they asked, what to prepare next.">${esc(app.notes)}</textarea>

      <div class="app-timeline">
        <span class="field-label">Timeline</span>
        ${app.events.map(e => `
          <div class="tl-row" data-event="${esc(e.id)}">
            <span class="tl-date">${esc(e.date)}</span>
            <span class="stage-dot stage-${esc(e.stage)}"></span>
            <span class="tl-stage">${esc(stageLabel(e.stage))}</span>
            <span class="tl-note">${esc(e.note)}</span>
            <button class="task-del" title="Remove this event" aria-label="Remove event">&times;</button>
          </div>`).join('')}
        <form class="tl-add">
          <input type="date" name="date" value="${Store.todayISO()}" aria-label="Event date">
          <select name="stage" aria-label="Event stage">
            ${Store.APP_STAGES.map(s => `<option value="${s.id}" ${s.id === app.stage ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
          <input type="text" name="note" placeholder="What happened?" aria-label="Event note">
          <button class="btn btn-sm" type="submit">Add</button>
        </form>
      </div>

      <div class="pd-actions">
        ${app.url ? `<a class="btn btn-sm" href="${esc(app.url)}" target="_blank" rel="noopener noreferrer">Open posting</a>` : ''}
        <button class="btn btn-sm danger" id="ad-del">Delete</button>
        <span class="save-state" id="ad-save"></span>
      </div>`;

    const flash = () => {
      const state = panel.querySelector('#ad-save');
      state.textContent = 'Saved';
      setTimeout(() => { if (state.textContent === 'Saved') state.textContent = ''; }, 1500);
    };
    const save = patch => { Store.updateApplication(app.id, patch); flash(); };

    const bind = (sel, key) => panel.querySelector(sel)
      .addEventListener('change', ev => save({ [key]: ev.target.value }));
    bind('#ad-role', 'role');
    bind('#ad-loc', 'location');
    bind('#ad-applied', 'appliedAt');
    bind('#ad-source', 'source');
    bind('#ad-next', 'nextAction');
    bind('#ad-due', 'nextDue');
    bind('#ad-url', 'url');

    const notes = panel.querySelector('#ad-notes');
    notes.addEventListener('input', () => {
      panel.querySelector('#ad-save').textContent = 'Saving…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => save({ notes: notes.value }), 600);
    });
    notes.addEventListener('blur', () => {
      if (notes.value === app.notes) return;
      clearTimeout(notesTimer);
      save({ notes: notes.value });
    });

    panel.querySelectorAll('.tl-row .task-del').forEach(btn =>
      btn.addEventListener('click', () => {
        Store.deleteApplicationEvent(app.id, btn.closest('.tl-row').dataset.event);
        onChanged();
      }));

    panel.querySelector('.tl-add').addEventListener('submit', ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      Store.addApplicationEvent(app.id, {
        date: f.get('date'), stage: f.get('stage'), note: f.get('note'),
      });
      onChanged();
    });

    panel.querySelector('#ad-del').addEventListener('click', () => {
      if (!confirm(`Delete the application to ${app.company}?`)) return;
      Store.deleteApplication(app.id);
      expandedId = null;
      onChanged();
    });

    return panel;
  }

  function submitApplication() {
    const form = document.getElementById('appForm');
    const data = new FormData(form);
    const app = Store.addApplication({
      company:  data.get('company'),
      role:     data.get('role'),
      location: data.get('location'),
      stage:    data.get('stage'),
      appliedAt: data.get('appliedAt') || Store.todayISO(),
    });
    if (!app) return false;

    form.reset();
    form.querySelector('[name="appliedAt"]').value = Store.todayISO();
    expandedId = app.id;
    onChanged();
    form.querySelector('[name="company"]').focus();
    return true;
  }

  function fillForm() {
    const select = document.querySelector('#appForm [name="stage"]');
    if (select && !select.options.length) {
      select.innerHTML = Store.APP_STAGES
        .map(s => `<option value="${s.id}" ${s.id === 'applied' ? 'selected' : ''}>${s.label}</option>`).join('');
    }
    const date = document.querySelector('#appForm [name="appliedAt"]');
    if (date && !date.value) date.value = Store.todayISO();
  }

  function init(opts) { onChanged = opts.onChanged || onChanged; }

  return { init, render, fillForm, submitApplication };
})();
