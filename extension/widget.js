/* ============================================================
   widget.js — what you already know about the problem in front of you.

   The tracker holds the history, and it lives on a different origin, so the
   extension cannot read it directly. Instead the tracker hands over a compact
   digest whenever it is open, and this reads that. Anything shown here is
   therefore as fresh as the last time the tracker was opened, which the panel
   says out loud rather than pretending otherwise.
   ============================================================ */

(() => {
  const PANEL_ID = 'dev-tracker-panel';
  const COLLAPSE_KEY = 'widgetCollapsed';

  let currentKey = null;

  const css = `
    #${PANEL_ID} {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      width: 268px; max-width: calc(100vw - 32px);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #e6edf3; background: #151b23;
      border: 1px solid #2b3542; border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
      overflow: hidden;
    }
    #${PANEL_ID} .dt-head {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 11px; cursor: pointer; background: #1c232d;
    }
    #${PANEL_ID} .dt-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7887; flex: none; }
    #${PANEL_ID} .dt-title { flex: 1; font-weight: 600; font-size: 12.5px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${PANEL_ID} .dt-chev { color: #9aa7b6; font-size: 10px; }
    #${PANEL_ID} .dt-body { padding: 11px; display: grid; gap: 9px; }
    #${PANEL_ID}.is-collapsed .dt-body { display: none; }
    #${PANEL_ID} .dt-line { font-size: 12px; color: #9aa7b6; }
    #${PANEL_ID} .dt-line strong { color: #e6edf3; font-weight: 600; }
    #${PANEL_ID} .dt-note { font-size: 12px; color: #c8d3de; border-left: 2px solid #35404f; padding-left: 8px; }
    #${PANEL_ID} .dt-row { display: flex; gap: 6px; flex-wrap: wrap; }
    #${PANEL_ID} button.dt-btn {
      font: inherit; font-size: 11.5px; padding: 5px 9px; cursor: pointer;
      color: #e6edf3; background: #1c232d; border: 1px solid #2b3542; border-radius: 6px;
    }
    #${PANEL_ID} button.dt-btn:hover { border-color: #4f9dff; color: #4f9dff; }
    #${PANEL_ID} button.dt-btn.dt-primary { background: #4f9dff; border-color: #4f9dff; color: #fff; }
    #${PANEL_ID} .dt-stale { font-size: 10.5px; color: #6b7887; }
    #${PANEL_ID} .dt-flag { color: #e3a008; }
  `;

  const STATUS_COLOUR = {
    solved: '#38bdf8', review: '#e3a008', resolved: '#a78bfa', mastered: '#34d399',
  };

  /* "Today" is the local day, matching the tracker. Reading it out of a UTC
     timestamp would put anything logged after local midnight a day out. */
  function todayLocal() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function relativeDay(iso) {
    if (!iso) return null;
    const days = Math.round((Date.parse(todayLocal() + 'T00:00:00Z')
                            - Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 31) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="dt-head">
        <span class="dt-dot"></span>
        <span class="dt-title">Dev Tracker</span>
        <span class="dt-chev">&#9660;</span>
      </div>
      <div class="dt-body"></div>`;

    panel.querySelector('.dt-head').addEventListener('click', async () => {
      panel.classList.toggle('is-collapsed');
      try {
        await chrome.storage.local.set({ [COLLAPSE_KEY]: panel.classList.contains('is-collapsed') });
      } catch { /* storage can be unavailable while the worker restarts */ }
    });

    document.body.appendChild(panel);
    return panel;
  }

  function line(html) {
    const el = document.createElement('div');
    el.className = 'dt-line';
    el.innerHTML = html;
    return el;
  }

  function button(label, primary, onClick) {
    const el = document.createElement('button');
    el.className = 'dt-btn' + (primary ? ' dt-primary' : '');
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  /* What the tracker knows about this problem, if it has told us. */
  async function lookup(key) {
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'lookup-problem', key });
      return reply || {};
    } catch {
      return {};
    }
  }

  async function queue(solve, extra) {
    try {
      return await chrome.runtime.sendMessage({ type: 'log-solve', solve, extra });
    } catch {
      return null;
    }
  }

  function renderKnown(body, record, key) {
    const colour = STATUS_COLOUR[record.state] || STATUS_COLOUR.solved;
    document.querySelector(`#${PANEL_ID} .dt-dot`).style.background = colour;

    const solved = relativeDay(record.solvedAt);
    body.appendChild(line(`Solved <strong>${solved}</strong>${
      record.independence === 'independent' ? ' on your own'
      : record.independence === 'hint' ? ' with a hint'
      : record.independence === 'solution' ? ' after reading the solution' : ''}`));

    if (record.state && record.state !== 'solved') {
      body.appendChild(line(`State: <strong>${record.state}</strong>`));
    }
    if (record.attempts > 1) body.appendChild(line(`Took <strong>${record.attempts}</strong> attempts`));
    if (record.reviewOn) {
      body.appendChild(line(`<span class="dt-flag">Booked for a revisit on ${record.reviewOn}</span>`));
    }

    if (record.mistake) {
      const el = document.createElement('div');
      el.className = 'dt-note';
      el.textContent = 'Last time: ' + record.mistake;
      body.appendChild(el);
    }
    if (record.lesson) {
      const el = document.createElement('div');
      el.className = 'dt-note';
      el.textContent = record.lesson;
      body.appendChild(el);
    }

    const row = document.createElement('div');
    row.className = 'dt-row';
    row.appendChild(button('Re-solved', true, async () => {
      await queue({ ...baseSolve(key), state: 'resolved' }, { revisit: true });
      body.replaceChildren(line('Marked as re-solved. It will reach the tracker next time you open it.'));
    }));
    row.appendChild(button('Revisit in 7 days', false, async () => {
      await queue(baseSolve(key), { reviewInDays: 7 });
      body.replaceChildren(line('Booked for a revisit in 7 days.'));
    }));
    body.appendChild(row);
  }

  function renderUnknown(body, key) {
    document.querySelector(`#${PANEL_ID} .dt-dot`).style.background = '#6b7887';
    body.appendChild(line('Not recorded yet.'));

    /* Codeforces and LeetCode are polled anyway, so logging by hand is only
       worth offering where it is the only route, or to capture how it went
       while it is still fresh. */
    const prompt = document.createElement('div');
    prompt.className = 'dt-line';
    prompt.textContent = 'Solved it? Say how it went:';
    body.appendChild(prompt);

    const row = document.createElement('div');
    row.className = 'dt-row';
    [['On my own', 'independent'], ['With a hint', 'hint'], ['Read solution', 'solution']]
      .forEach(([label, independence]) => {
        row.appendChild(button(label, independence === 'independent', async () => {
          await queue({ ...baseSolve(key), independence });
          body.replaceChildren(line('Recorded. It will reach the tracker next time you open it.'));
        }));
      });
    body.appendChild(row);
  }

  function baseSolve(key) {
    return {
      source: key.source,
      problemId: key.problemId,
      title: document.title.replace(/\s*[-|]\s*(LeetCode|Codeforces).*$/i, '').trim() || key.label,
      url: location.href.split('?')[0],
      tags: [],
      solvedAt: todayLocal(),
      minutes: 0,
    };
  }

  async function show(key) {
    const panel = ensurePanel();
    const body = panel.querySelector('.dt-body');
    panel.querySelector('.dt-title').textContent = key.label;
    body.replaceChildren(line('Checking…'));

    const { record, syncedAt, collapsed } = await lookup(key);
    if (collapsed) panel.classList.add('is-collapsed');

    body.replaceChildren();
    record ? renderKnown(body, record, key) : renderUnknown(body, key);

    const stale = document.createElement('div');
    stale.className = 'dt-stale';
    stale.textContent = syncedAt
      ? `From the tracker, last opened ${relativeDay(String(syncedAt).slice(0, 10))}.`
      : 'Open the tracker once so it can share your history.';
    body.appendChild(stale);
  }

  function sync() {
    const key = PageKey.forUrl(location.href);
    const id = PageKey.digestKey(key);
    if (id === currentKey) return;

    currentKey = id;
    const panel = document.getElementById(PANEL_ID);
    if (!key) { if (panel) panel.remove(); return; }
    show(key);
  }

  /* LeetCode navigates without reloading, so the URL is watched rather than
     relying on a load event that will not come again. */
  sync();
  setInterval(sync, 1200);
})();
