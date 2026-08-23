/* ============================================================
   projects.js — the Projects view.

   Concepts say what you have studied; problems say what you have practised.
   A project says what you have actually built, and which of those concepts it
   is evidence for — the difference between "I have studied CI/CD" and "CI
   runs on every push to this repository".
   ============================================================ */

const Projects = (() => {

  let onNavigate = () => {};
  let onChanged  = () => {};
  let expandedId = null;
  let summaryTimer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const stateLabel = id => (Store.PROJECT_STATES.find(s => s.id === id) || { label: id }).label;

  function render() {
    renderStats();
    renderList();
  }

  function renderStats() {
    const all = Store.projects();
    const open = all.filter(p => (Store.PROJECT_STATES.find(s => s.id === p.state) || {}).open).length;
    const shipped = all.filter(p => p.state === 'shipped').length;
    const concepts = new Set(all.flatMap(p => p.concepts.map(c => c.nodeId))).size;

    const cards = [
      { value: all.length, label: 'Projects', sub: `${open} in flight` },
      { value: shipped,    label: 'Shipped',  sub: shipped ? 'finished and out' : 'none yet' },
      { value: concepts,   label: 'Concepts used', sub: 'topics with real evidence' },
    ];
    document.getElementById('projectStats').innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="value">${esc(c.value)}</div>
        <div class="label">${esc(c.label)}</div>
        <div class="sub">${esc(c.sub)}</div>
      </div>`).join('');
  }

  function renderList() {
    const box = document.getElementById('projectList');
    const all = Store.projects();
    box.replaceChildren();

    if (!all.length) {
      box.innerHTML = `<p class="muted list-empty">Nothing here yet. A project is anything you have built —
        it is what turns a studied topic into a demonstrated one.</p>`;
      return;
    }

    all.forEach(project => {
      box.appendChild(projectRow(project));
      if (project.id === expandedId) box.appendChild(projectDetail(project));
    });
  }

  function projectRow(project) {
    const progress = Store.projectProgress(project);
    const row = document.createElement('div');
    row.className = 'project-row' + (project.id === expandedId ? ' is-selected' : '');

    row.innerHTML = `
      <span class="pr-name">
        <strong>${esc(project.name)}</strong>
        ${project.private ? '<span class="insp-lock">private</span>' : ''}
      </span>
      <span class="pr-bar"><i style="width:${Math.round(progress.ratio * 100)}%"></i></span>
      <span class="pr-pct">${Math.round(progress.ratio * 100)}%</span>
      <span class="pr-state state-${esc(project.state)}">${esc(stateLabel(project.state))}</span>
      <span class="pr-concepts">${project.concepts.length
        ? `${project.concepts.length} concept${project.concepts.length === 1 ? '' : 's'}` : ''}</span>`;

    row.addEventListener('click', () => {
      expandedId = project.id === expandedId ? null : project.id;
      renderList();
    });
    return row;
  }

  function projectDetail(project) {
    const panel = document.createElement('div');
    panel.className = 'project-detail';

    panel.innerHTML = `
      <div class="pd-grid">
        <label class="field"><span>State</span>
          <select id="prj-state">
            ${Store.PROJECT_STATES.map(s =>
              `<option value="${s.id}" ${s.id === project.state ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select></label>
        <label class="field"><span>Started</span>
          <input type="date" id="prj-started" value="${esc(project.startedAt)}"></label>
        <label class="field"><span>Repository</span>
          <input type="url" id="prj-repo" value="${esc(project.repo)}" placeholder="https://github.com/…"></label>
        <label class="field"><span>Technologies <span class="muted">(comma separated)</span></span>
          <input type="text" id="prj-tech" value="${esc(project.tech.join(', '))}"></label>
      </div>

      <textarea id="prj-summary" placeholder="What is it, and what was hard about it?">${esc(project.summary)}</textarea>

      <div class="prj-section">
        <span class="field-label">Milestones</span>
        <div class="prj-milestones"></div>
        <form class="prj-add">
          <input type="text" name="text" placeholder="Add a milestone" aria-label="Milestone">
          <button class="btn btn-sm" type="submit">Add</button>
        </form>
      </div>

      <div class="prj-section">
        <span class="field-label">Concepts demonstrated
          <span class="muted">— what this project proves you have used</span></span>
        <div class="prj-concepts"></div>
        <form class="prj-concept-add">
          <select name="nodeId" aria-label="Topic">
            <option value="">Pick a topic…</option>
            ${Store.state.nodes.map(n =>
              `<option value="${esc(n.id)}">${'  '.repeat(Store.depthOf(n.id))}${esc(n.name)}</option>`).join('')}
          </select>
          <input type="text" name="evidence" placeholder="How it was used here" aria-label="Evidence">
          <button class="btn btn-sm" type="submit">Link</button>
        </form>
      </div>

      <label class="privacy-toggle">
        <input type="checkbox" id="prj-private" ${project.private ? 'checked' : ''}>
        <span>Keep this project private</span>
      </label>

      <div class="pd-actions">
        ${project.repo ? `<a class="btn btn-sm" href="${esc(project.repo)}" target="_blank" rel="noopener noreferrer">Open repository</a>` : ''}
        <button class="btn btn-sm danger" id="prj-del">Delete</button>
        <span class="save-state" id="prj-save"></span>
      </div>`;

    const flash = () => {
      const state = panel.querySelector('#prj-save');
      state.textContent = 'Saved';
      setTimeout(() => { if (state.textContent === 'Saved') state.textContent = ''; }, 1500);
    };
    const save = patch => { Store.updateProject(project.id, patch); flash(); };

    panel.querySelector('#prj-started').addEventListener('change', ev => save({ startedAt: ev.target.value }));
    panel.querySelector('#prj-repo').addEventListener('change', ev => save({ repo: ev.target.value }));
    panel.querySelector('#prj-tech').addEventListener('change', ev =>
      save({ tech: ev.target.value.split(',').map(t => t.trim()).filter(Boolean) }));
    panel.querySelector('#prj-state').addEventListener('change', ev => {
      Store.updateProject(project.id, { state: ev.target.value });
      onChanged();
    });
    panel.querySelector('#prj-private').addEventListener('change', ev => {
      Store.updateProject(project.id, { private: ev.target.checked });
      onChanged();
    });

    const summary = panel.querySelector('#prj-summary');
    summary.addEventListener('input', () => {
      clearTimeout(summaryTimer);
      summaryTimer = setTimeout(() => save({ summary: summary.value }), 600);
    });
    summary.addEventListener('blur', () => {
      if (summary.value === project.summary) return;
      clearTimeout(summaryTimer);
      save({ summary: summary.value });
    });

    renderMilestones(panel, project);
    renderConcepts(panel, project);

    panel.querySelector('.prj-add').addEventListener('submit', ev => {
      ev.preventDefault();
      if (Store.addMilestone(project.id, new FormData(ev.target).get('text'))) onChanged();
    });
    panel.querySelector('.prj-concept-add').addEventListener('submit', ev => {
      ev.preventDefault();
      const data = new FormData(ev.target);
      if (Store.linkConcept(project.id, data.get('nodeId'), data.get('evidence'))) onChanged();
    });
    panel.querySelector('#prj-del').addEventListener('click', () => {
      if (!confirm(`Delete the project "${project.name}"?`)) return;
      Store.deleteProject(project.id);
      expandedId = null;
      onChanged();
    });

    return panel;
  }

  function renderMilestones(panel, project) {
    const box = panel.querySelector('.prj-milestones');
    box.replaceChildren();

    project.milestones.forEach(milestone => {
      const row = document.createElement('div');
      row.className = 'task' + (milestone.done ? ' is-done' : '');
      row.innerHTML = `
        <button class="task-check" aria-pressed="${milestone.done}">&#10003;</button>
        <span class="task-text-static"></span>
        <button class="task-del" title="Remove" aria-label="Remove milestone">&times;</button>`;
      row.querySelector('.task-text-static').textContent = milestone.text;
      row.querySelector('.task-check').addEventListener('click', () => {
        Store.toggleMilestone(project.id, milestone.id);
        onChanged();
      });
      row.querySelector('.task-del').addEventListener('click', () => {
        Store.deleteMilestone(project.id, milestone.id);
        onChanged();
      });
      box.appendChild(row);
    });
  }

  function renderConcepts(panel, project) {
    const box = panel.querySelector('.prj-concepts');
    box.replaceChildren();

    if (!project.concepts.length) {
      box.innerHTML = '<p class="muted check-empty">Nothing linked yet. Linking a topic here is what turns ' +
        '"studied" into "used".</p>';
      return;
    }

    project.concepts.forEach(concept => {
      const node = Store.byId(concept.nodeId);
      if (!node) return;
      const row = document.createElement('div');
      row.className = 'concept-row';
      row.innerHTML = `
        <button class="ref-name">${esc(node.name)}</button>
        <span class="concept-evidence"></span>
        <button class="task-del" title="Unlink" aria-label="Unlink concept">&times;</button>`;
      row.querySelector('.concept-evidence').textContent = concept.evidence;
      row.querySelector('.ref-name').addEventListener('click', () => onNavigate(concept.nodeId));
      row.querySelector('.task-del').addEventListener('click', () => {
        Store.unlinkConcept(project.id, concept.nodeId);
        onChanged();
      });
      box.appendChild(row);
    });
  }

  function submitProject() {
    const form = document.getElementById('projectForm');
    const data = new FormData(form);
    const project = Store.addProject({
      name: data.get('name'),
      repo: data.get('repo'),
      state: data.get('state'),
      startedAt: data.get('startedAt') || Store.todayISO(),
    });
    if (!project) return false;

    form.reset();
    form.querySelector('[name="startedAt"]').value = Store.todayISO();
    expandedId = project.id;
    onChanged();
    return true;
  }

  function fillForm() {
    const select = document.querySelector('#projectForm [name="state"]');
    if (select && !select.options.length) {
      select.innerHTML = Store.PROJECT_STATES
        .map(s => `<option value="${s.id}" ${s.id === 'building' ? 'selected' : ''}>${s.label}</option>`).join('');
    }
    const date = document.querySelector('#projectForm [name="startedAt"]');
    if (date && !date.value) date.value = Store.todayISO();
  }

  function init(opts) {
    onNavigate = opts.onNavigate || onNavigate;
    onChanged  = opts.onChanged  || onChanged;
  }

  return { init, render, fillForm, submitProject };
})();
