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

  const LOGO_KEY = 'learning-tree/app-logos';
  const logosEnabled = () => {
    try { return localStorage.getItem(LOGO_KEY) === 'on'; } catch { return false; }
  };

  /* Initials on a colour derived from the name: recognisable at a glance, and
     it asks nothing of the network. Fetching a real logo would tell whoever
     serves it which companies you are applying to, so that stays opt-in. */
  function monogram(app) {
    const letters = app.company.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(w => w[0].toUpperCase()).join('') || '?';

    let hash = 0;
    for (const ch of app.company) hash = (hash * 31 + ch.charCodeAt(0)) % 360;

    const el = document.createElement('span');
    el.className = 'app-logo';
    el.style.background = `hsl(${hash} 45% 32%)`;
    el.textContent = letters;

    if (logosEnabled() && app.url) {
      const domain = (Store.parsePosting(app.url) || {}).domain;
      if (domain) {
        const img = document.createElement('img');
        img.src = `https://${domain}/favicon.ico`;
        img.alt = '';
        img.loading = 'lazy';
        /* If the company has no favicon, the monogram simply stays. */
        img.addEventListener('load', () => { el.textContent = ''; el.style.background = 'transparent'; el.appendChild(img); });
        img.addEventListener('error', () => {});
      }
    }
    return el;
  }

  let view = 'board';      // 'board' | 'flow'

  function render() {
    wireLogoToggle();
    wireViewToggle();
    renderStats();
    renderDue();

    document.getElementById('appBoard').hidden = view !== 'board';
    document.getElementById('appFlow').hidden = view !== 'flow';
    view === 'flow' ? renderFlow() : renderBoard();
  }

  function wireViewToggle() {
    document.querySelectorAll('[data-app-view]').forEach(btn => {
      btn.classList.toggle('is-on', btn.dataset.appView === view);
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        view = btn.dataset.appView;
        render();
      });
    });
  }

  /* A pipeline read as flows rather than a table: each band is a stage, each
     ribbon an application moving between them. Easier to take in than counts,
     and it makes where things stop obvious. */
  function renderFlow() {
    const box = document.getElementById('appFlow');
    const { stages, flows, total } = Store.applicationFlow();
    box.replaceChildren();

    if (!total) {
      box.innerHTML = '<p class="muted list-empty">Nothing to chart yet.</p>';
      return;
    }

    const WIDTH = 720, ROW = 78, PAD = 26;
    const height = stages.length * ROW + PAD;
    const max = Math.max(...stages.map(s => s.count), 1);
    const barWidth = count => Math.max(28, (count / max) * (WIDTH - 200));

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${height}`);
    svg.setAttribute('class', 'flow-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Applications by stage');

    const y = {};
    stages.forEach((stage, i) => { y[stage.id] = PAD / 2 + i * ROW; });

    /* Ribbons first, so the bands sit on top of them. */
    flows.forEach(flow => {
      if (y[flow.from] === undefined || y[flow.to] === undefined) return;

      const fromStage = stages.find(s => s.id === flow.from);
      const y1 = y[flow.from] + 26;
      const y2 = y[flow.to];
      const mid = (y1 + y2) / 2;
      const x1 = 150 + barWidth(fromStage.count) * 0.35;
      const x2 = 150 + barWidth(stages.find(s => s.id === flow.to).count) * 0.35;
      const thickness = Math.max(3, (flow.count / max) * 34);

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M${x1},${y1}C${x1},${mid} ${x2},${mid} ${x2},${y2}`);
      path.setAttribute('class', 'flow-ribbon');
      path.setAttribute('stroke-width', thickness);
      path.appendChild(titleFor(svgNS,
        `${Store.STAGE_BY_ID[flow.from].label} to ${Store.STAGE_BY_ID[flow.to].label}: ${flow.count}`));
      svg.appendChild(path);
    });

    stages.forEach(stage => {
      const width = barWidth(stage.count);

      const bar = document.createElementNS(svgNS, 'rect');
      bar.setAttribute('x', 150);
      bar.setAttribute('y', y[stage.id]);
      bar.setAttribute('width', width);
      bar.setAttribute('height', 26);
      bar.setAttribute('rx', 5);
      bar.setAttribute('class', `flow-bar flow-${stage.id}`);
      bar.appendChild(titleFor(svgNS, `${stage.label}: ${stage.count}`));
      svg.appendChild(bar);

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', 140);
      label.setAttribute('y', y[stage.id] + 18);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'flow-label');
      label.textContent = stage.label;
      svg.appendChild(label);

      const count = document.createElementNS(svgNS, 'text');
      count.setAttribute('x', 158 + width);
      count.setAttribute('y', y[stage.id] + 18);
      count.setAttribute('class', 'flow-count');
      count.textContent = stage.count;
      svg.appendChild(count);
    });

    box.appendChild(svg);
  }

  function titleFor(ns, text) {
    const title = document.createElementNS(ns, 'title');
    title.textContent = text;
    return title;
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
      <div class="due-row stage-of-${esc(a.stage)} ${a.nextDue < today ? 'is-late' : ''}">
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

      /* The stage's colour is set once on the group and inherited by the rows,
         the heading and the panel below, so a card's colour and the band it is
         filed under can never disagree. */
      const group = document.createElement('div');
      group.className = `app-group stage-of-${stage.id}`;
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
    row.className = `app-row stage-of-${app.stage}`
                  + (app.id === expandedId ? ' is-selected' : '');
    row.innerHTML = `
      <span class="app-company">
        <span class="logo-slot"></span>
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

    row.querySelector('.logo-slot').replaceWith(monogram(app));
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
    panel.className = `app-detail stage-of-${app.stage}`;

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

    /* A posting URL already contains the employer and the board it came from,
       so pasting one fills in what it can without asking anything of anyone. */
    panel.querySelector('#ad-url').addEventListener('change', ev => {
      const parsed = Store.parsePosting(ev.target.value);
      if (!parsed) return;

      const patch = { url: ev.target.value };
      if (!app.source && parsed.source) patch.source = parsed.source;
      if (parsed.company && (!app.company || app.company === 'Unknown')) patch.company = parsed.company;

      Store.updateApplication(app.id, patch);
      if (patch.source) panel.querySelector('#ad-source').value = patch.source;
      flash();
      onChanged();
    });

    const bind = (sel, key) => panel.querySelector(sel)
      .addEventListener('change', ev => save({ [key]: ev.target.value }));
    bind('#ad-role', 'role');
    bind('#ad-loc', 'location');
    bind('#ad-applied', 'appliedAt');
    bind('#ad-source', 'source');
    bind('#ad-next', 'nextAction');
    bind('#ad-due', 'nextDue');

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

    /* Company or a link: either is enough to start, and a link fills in the
       rest of what it knows. */
    const typed = String(data.get('company') || '').trim();
    const fromUrl = Store.parsePosting(typed) || Store.parsePosting(data.get('url'));
    const looksLikeUrl = /[./]/.test(typed) && Store.parsePosting(typed);

    const app = Store.addApplication({
      company:  looksLikeUrl ? (fromUrl.company || typed) : typed,
      role:     data.get('role'),
      location: data.get('location'),
      stage:    data.get('stage'),
      source:   fromUrl ? fromUrl.source : '',
      url:      looksLikeUrl ? typed : String(data.get('url') || ''),
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

  function wireLogoToggle() {
    const box = document.getElementById('appLogos');
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    box.checked = logosEnabled();
    box.addEventListener('change', () => {
      try { localStorage.setItem(LOGO_KEY, box.checked ? 'on' : 'off'); } catch { /* private mode */ }
      render();
    });
  }

  function init(opts) { onChanged = opts.onChanged || onChanged; }

  return { init, render, fillForm, submitApplication };
})();
