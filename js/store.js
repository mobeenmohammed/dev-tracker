/* ============================================================
   store.js — data model, persistence, derived metrics.

   The repo file data/learning.json is the versioned snapshot and
   the seed. localStorage holds the live working copy. Export the
   working copy back over data/learning.json and commit it to make
   the state permanent and visible from any device.
   ============================================================ */

const Store = (() => {

  const LS_KEY      = 'learning-tree/state/v1';
  const SEED_URL    = 'data/learning.json';
  /* Optional, git-ignored, and only ever present on your own machine. */
  const PRIVATE_URL = 'data/private.json';

  const STATUSES = [
    { id: 'planned',    label: 'Planned',    weight: 0.00, cssVar: '--st-planned'    },
    { id: 'learning',   label: 'Learning',   weight: 0.25, cssVar: '--st-learning'   },
    { id: 'practicing', label: 'Practicing', weight: 0.55, cssVar: '--st-practicing' },
    { id: 'proficient', label: 'Proficient', weight: 0.80, cssVar: '--st-proficient' },
    { id: 'mastered',   label: 'Mastered',   weight: 1.00, cssVar: '--st-mastered'   },
  ];

  const STATUS_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]));

  /* Used only when there is no saved state and the seed file cannot be
     fetched (e.g. opening index.html straight off disk in some browsers). */
  const MINIMAL_SEED = {
    version: 1,
    profile: { name: 'My Learning Tree', subtitle: 'Add your fields to begin' },
    nodes: [
      { id: 'field-1', parentId: null, name: 'First Field', status: 'planned', tags: [], notes: '', resources: [] },
    ],
    sessions: [],
  };

  let state    = null;
  let seedMeta = null;              // { updatedAt } of the repo file, for the "newer version" banner
  const listeners = [];

  /* ---------------- helpers ---------------- */

  /* Calendar dates are handled as plain YYYY-MM-DD strings. "Today" is the
     user's local date, but all day arithmetic runs in UTC, because reading a
     local-midnight Date back through toISOString() lands a day early in any
     timezone ahead of UTC. */
  function todayISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function shiftDays(iso, delta) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  /* 0 = Sunday, matching the heatmap column layout. */
  const dayOfWeek = iso => new Date(iso + 'T00:00:00Z').getUTCDay();

  const nowISO = () => new Date().toISOString();

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  /* Checklist entries double as resources: anything with a URL renders as a
     link, everything else as a plain task. */
  function normalizeItems(list) {
    if (!Array.isArray(list)) return [];
    return list.map(it => ({
      id:   String(it.id || uid('i')),
      text: String(it.text || it.label || it.url || '').trim(),
      url:  it.url ? String(it.url) : '',
      done: !!it.done,
    })).filter(it => it.text);
  }

  function normalizeNode(n) {
    return {
      id:       String(n.id),
      parentId: n.parentId == null ? null : String(n.parentId),
      name:     String(n.name || 'Untitled'),
      status:   STATUS_BY_ID[n.status] ? n.status : 'planned',
      tags:     Array.isArray(n.tags) ? n.tags.map(String) : [],
      /* `notes` was the old name for this field. */
      description: typeof n.description === 'string' ? n.description
                 : typeof n.notes === 'string' ? n.notes : '',
      /* `resources` was the old name, before entries could be ticked off. */
      items:     normalizeItems(n.items && n.items.length ? n.items : n.resources),
      private:   !!n.private,
      createdAt: n.createdAt || todayISO(),
      updatedAt: n.updatedAt || n.createdAt || todayISO(),
    };
  }

  function normalizeSession(s) {
    return {
      id:      String(s.id || uid('s')),
      nodeId:  String(s.nodeId),
      date:    String(s.date || todayISO()).slice(0, 10),
      minutes: Math.max(0, Number(s.minutes) || 0),
      note:    typeof s.note === 'string' ? s.note : '',
    };
  }

  function normalizeTask(t) {
    return {
      id:     String(t.id || uid('f')),
      date:   String(t.date || todayISO()).slice(0, 10),
      text:   String(t.text || '').trim(),
      done:   !!t.done,
      doneAt: t.doneAt || null,
      nodeId: t.nodeId ? String(t.nodeId) : null,
    };
  }

  function normalize(raw) {
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map(normalizeNode);
    const ids   = new Set(nodes.map(n => n.id));

    /* Re-root anything whose parent went missing, so no branch is orphaned. */
    nodes.forEach(n => { if (n.parentId && !ids.has(n.parentId)) n.parentId = null; });

    const sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
      .map(normalizeSession)
      .filter(s => ids.has(s.nodeId));

    /* A focus task outlives the topic it pointed at — the intention still
       counts, so the link is dropped rather than the task. */
    const focus = (Array.isArray(raw.focus) ? raw.focus : [])
      .map(normalizeTask)
      .filter(t => t.text)
      .map(t => (t.nodeId && !ids.has(t.nodeId) ? { ...t, nodeId: null } : t));

    return {
      version:   raw.version || 1,
      updatedAt: raw.updatedAt || nowISO(),
      profile: {
        name:     (raw.profile && raw.profile.name)     || 'My Learning Tree',
        subtitle: (raw.profile && raw.profile.subtitle) || '',
      },
      nodes,
      sessions,
      focus,
    };
  }

  function emit() { listeners.forEach(fn => fn(state)); }

  function persist() {
    state.updatedAt = nowISO();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not write to localStorage:', err);
    }
    emit();
  }

  /* ---------------- loading ---------------- */

  async function fetchJSON(url, quiet = false) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (!quiet) console.info(url + ' unavailable (' + err.message + '); using local state only.');
      return null;
    }
  }

  const fetchSeed = () => fetchJSON(SEED_URL);
  /* A missing private file is the normal case on a published site. */
  const fetchPrivate = () => fetchJSON(PRIVATE_URL, true);

  async function init() {
    const seed  = await fetchSeed();
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
      catch { return null; }
    })();

    if (saved && saved.nodes && saved.nodes.length) {
      state = normalize(saved);
      /* Flag it when the committed file is newer than what is in this browser. */
      if (seed && seed.updatedAt && new Date(seed.updatedAt) > new Date(saved.updatedAt || 0)) {
        seedMeta = { updatedAt: seed.updatedAt, data: seed };
      }
    } else {
      state = normalize(seed || MINIMAL_SEED);
      persist();
    }

    /* Fold in any local private file that is not already represented. */
    const priv = await fetchPrivate();
    if (priv && mergeJSON(priv) > 0) persist();

    return state;
  }

  /* ---------------- tree queries ---------------- */

  const byId       = id => state.nodes.find(n => n.id === id) || null;
  const roots      = ()  => state.nodes.filter(n => n.parentId === null);
  const childrenOf = id  => state.nodes.filter(n => n.parentId === id);

  function ancestorsOf(id) {
    const chain = [];
    let node = byId(id);
    while (node && node.parentId) {
      node = byId(node.parentId);
      if (!node || chain.includes(node)) break;   // guard against a cycle
      chain.unshift(node);
    }
    return chain;
  }

  function descendantsOf(id) {
    const out = [];
    const walk = pid => childrenOf(pid).forEach(c => { out.push(c); walk(c.id); });
    walk(id);
    return out;
  }

  function domainOf(id) {
    const chain = ancestorsOf(id);
    return chain.length ? chain[0] : byId(id);
  }

  function depthOf(id) { return ancestorsOf(id).length; }

  /* Would attaching `id` under `newParentId` create a cycle? */
  function wouldCycle(id, newParentId) {
    if (!newParentId) return false;
    if (id === newParentId) return true;
    return descendantsOf(id).some(d => d.id === newParentId);
  }

  /* ---------------- derived metrics ---------------- */

  /* A leaf scores its checklist if it has one, because ticking items off is
     the most concrete signal of progress; without a checklist it falls back to
     the weight of its status. A parent averages its children, so a field's
     progress reflects the whole branch beneath it. */
  function progressOf(id, seen = new Set()) {
    if (seen.has(id)) return 0;
    seen.add(id);

    const kids = childrenOf(id);
    if (kids.length) {
      return kids.reduce((sum, k) => sum + progressOf(k.id, seen), 0) / kids.length;
    }

    const node = byId(id);
    if (!node) return 0;
    if (node.items.length) return node.items.filter(i => i.done).length / node.items.length;
    return STATUS_BY_ID[node.status].weight;
  }

  function checklistOf(id) {
    const node = byId(id);
    if (!node) return { total: 0, done: 0, ratio: 0 };
    const done = node.items.filter(i => i.done).length;
    return { total: node.items.length, done, ratio: node.items.length ? done / node.items.length : 0 };
  }

  function minutesFor(id, includeDescendants = true) {
    const ids = new Set([id, ...(includeDescendants ? descendantsOf(id).map(n => n.id) : [])]);
    return state.sessions.reduce((sum, s) => sum + (ids.has(s.nodeId) ? s.minutes : 0), 0);
  }

  function sessionsFor(id, includeDescendants = false) {
    const ids = new Set([id, ...(includeDescendants ? descendantsOf(id).map(n => n.id) : [])]);
    return state.sessions
      .filter(s => ids.has(s.nodeId))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function statusCounts(nodeIds = null) {
    const counts = Object.fromEntries(STATUSES.map(s => [s.id, 0]));
    state.nodes.forEach(n => {
      if (nodeIds && !nodeIds.has(n.id)) return;
      counts[n.status]++;
    });
    return counts;
  }

  /* The most recent day any session was logged against this node, or anywhere
     in the branch beneath it. Returns null when nothing has been logged. */
  function lastWorked(id, includeDescendants = true) {
    const ids = new Set([id, ...(includeDescendants ? descendantsOf(id).map(n => n.id) : [])]);
    let latest = null;
    state.sessions.forEach(s => {
      if (ids.has(s.nodeId) && (!latest || s.date > latest)) latest = s.date;
    });
    return latest;
  }

  const daysBetween = (fromISO, toISO) =>
    Math.round((Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / 864e5);

  /* "3d ago" style wording for a calendar date, used on tree labels and rows. */
  function relativeDay(iso) {
    if (!iso) return null;
    const days = daysBetween(iso, todayISO());
    if (days < 0)  return 'scheduled';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7)   return days + 'd ago';
    if (days < 31)  return Math.round(days / 7) + 'w ago';
    if (days < 365) return Math.round(days / 30) + 'mo ago';
    return Math.round(days / 365) + 'y ago';
  }

  /* Consecutive days with at least one logged session, counting back from
     today (or yesterday, so an evening of study is not lost at midnight). */
  function currentStreak() {
    const days = new Set(state.sessions.map(s => s.date));
    if (!days.size) return 0;

    let cursor = todayISO();
    if (!days.has(cursor)) cursor = shiftDays(cursor, -1);

    let streak = 0;
    while (days.has(cursor)) {
      streak++;
      cursor = shiftDays(cursor, -1);
    }
    return streak;
  }

  /* ---------------- mutations ---------------- */

  function addNode({ parentId = null, name = 'New topic', status = 'planned' } = {}) {
    const node = normalizeNode({ id: uid('n'), parentId, name, status, createdAt: todayISO() });
    state.nodes.push(node);
    persist();
    return node;
  }

  function updateNode(id, patch) {
    const node = byId(id);
    if (!node) return null;

    if ('parentId' in patch && wouldCycle(id, patch.parentId)) {
      throw new Error('That move would put the branch inside itself.');
    }
    Object.assign(node, patch, { updatedAt: todayISO() });
    persist();
    return node;
  }

  /* Removes the node, everything under it, and their logged sessions. */
  function deleteNode(id) {
    const doomed = new Set([id, ...descendantsOf(id).map(n => n.id)]);
    state.nodes    = state.nodes.filter(n => !doomed.has(n.id));
    state.sessions = state.sessions.filter(s => !doomed.has(s.nodeId));
    persist();
    return doomed.size;
  }

  function addSession({ nodeId, date, minutes, note }) {
    const session = normalizeSession({ id: uid('s'), nodeId, date, minutes, note });
    state.sessions.push(session);

    /* Logging time against something untouched means it is underway now. */
    const node = byId(nodeId);
    if (node && node.status === 'planned') node.status = 'learning';
    if (node) node.updatedAt = todayISO();

    persist();
    return session;
  }

  function deleteSession(id) {
    state.sessions = state.sessions.filter(s => s.id !== id);
    persist();
  }

  function updateProfile(patch) {
    Object.assign(state.profile, patch);
    persist();
  }

  /* ---------------- checklist items ---------------- */

  function addItem(nodeId, { text, url = '' }) {
    const node = byId(nodeId);
    const clean = String(text || '').trim();
    if (!node || !clean) return null;
    const item = { id: uid('i'), text: clean, url: String(url || '').trim(), done: false };
    node.items.push(item);
    node.updatedAt = todayISO();
    persist();
    return item;
  }

  function toggleItem(nodeId, itemId) {
    const node = byId(nodeId);
    const item = node && node.items.find(i => i.id === itemId);
    if (!item) return null;
    item.done = !item.done;
    node.updatedAt = todayISO();
    persist();
    return item;
  }

  function updateItem(nodeId, itemId, patch) {
    const node = byId(nodeId);
    const item = node && node.items.find(i => i.id === itemId);
    if (!item) return null;
    Object.assign(item, patch);
    item.text = String(item.text || '').trim();
    node.updatedAt = todayISO();
    persist();
    return item;
  }

  function deleteItem(nodeId, itemId) {
    const node = byId(nodeId);
    if (!node) return;
    node.items = node.items.filter(i => i.id !== itemId);
    node.updatedAt = todayISO();
    persist();
  }

  /* ---------------- private branches ---------------- */

  /* Marking a node private takes its whole branch with it, so a private field
     cannot leak through a child that was added later. */
  function isPrivate(id) {
    const node = byId(id);
    if (!node) return false;
    return node.private || ancestorsOf(id).some(a => a.private);
  }

  function privateNodeIds() {
    return new Set(state.nodes.filter(n => isPrivate(n.id)).map(n => n.id));
  }

  /* ---------------- daily focus ---------------- */

  /* A checklist per day: what you meant to work on, kept as history once the
     day is over so the record of intentions survives. */
  const focusFor = date => state.focus.filter(t => t.date === date);

  /* Every day that has tasks, most recent first. */
  const focusDates = () =>
    [...new Set(state.focus.map(t => t.date))].sort((a, b) => b.localeCompare(a));

  function addTask({ text, date = todayISO(), nodeId = null }) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const task = normalizeTask({ id: uid('f'), date, text: clean, nodeId });
    state.focus.push(task);
    persist();
    return task;
  }

  function toggleTask(id) {
    const task = state.focus.find(t => t.id === id);
    if (!task) return null;
    task.done = !task.done;
    task.doneAt = task.done ? nowISO() : null;
    persist();
    return task;
  }

  function updateTask(id, patch) {
    const task = state.focus.find(t => t.id === id);
    if (!task) return null;
    Object.assign(task, patch);
    if (typeof task.text === 'string') task.text = task.text.trim();
    persist();
    return task;
  }

  function deleteTask(id) {
    state.focus = state.focus.filter(t => t.id !== id);
    persist();
  }

  /* Unfinished work from the most recent earlier day, moved to today. */
  function carryOverTo(date = todayISO()) {
    const earlier = focusDates().filter(d => d < date);
    if (!earlier.length) return 0;

    const source = earlier[0];
    const pending = focusFor(source).filter(t => !t.done);
    const alreadyHere = new Set(focusFor(date).map(t => t.text.toLowerCase()));

    let moved = 0;
    pending.forEach(t => {
      if (alreadyHere.has(t.text.toLowerCase())) return;
      state.focus.push(normalizeTask({ id: uid('f'), date, text: t.text, nodeId: t.nodeId }));
      moved++;
    });
    if (moved) persist();
    return moved;
  }

  function focusSummary(date) {
    const tasks = focusFor(date);
    const done = tasks.filter(t => t.done).length;
    return { total: tasks.length, done, ratio: tasks.length ? done / tasks.length : 0 };
  }

  /* ---------------- import / export ---------------- */

  /* The state is split in two on the way out: the public snapshot is what gets
     committed, and everything under a private branch goes to a file that is
     git-ignored and never leaves the machine. */
  function partition(wantPrivate) {
    const priv = privateNodeIds();
    const keep = n => priv.has(n.id) === wantPrivate;

    const nodes = state.nodes.filter(keep);
    const ids = new Set(nodes.map(n => n.id));

    return {
      nodes,
      sessions: state.sessions
        .filter(s => ids.has(s.nodeId))
        .sort((a, b) => a.date.localeCompare(b.date)),
      /* A task with no topic is public: it says nothing about a private branch. */
      focus: state.focus
        .filter(t => (t.nodeId ? priv.has(t.nodeId) === wantPrivate : !wantPrivate))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  function toJSON() {
    const { nodes, sessions, focus } = partition(false);
    return JSON.stringify({
      version: state.version, updatedAt: state.updatedAt, profile: state.profile,
      nodes, sessions, focus,
    }, null, 2);
  }

  function toPrivateJSON() {
    const { nodes, sessions, focus } = partition(true);
    return JSON.stringify({
      version: state.version, updatedAt: state.updatedAt, private: true,
      nodes, sessions, focus,
    }, null, 2);
  }

  const hasPrivateData = () => state.nodes.some(n => isPrivate(n.id));

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.nodes)) {
      throw new Error('That file has no "nodes" array — is it a tracker export?');
    }
    state = normalize(parsed);
    persist();
    return state;
  }

  /* Folds a private file into whatever is already loaded, without disturbing
     the public half. Anything already present by id wins, so importing twice
     is harmless. */
  function mergeJSON(text) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!parsed || !Array.isArray(parsed.nodes)) return 0;

    /* Every collection is deduplicated by id, or merging the same file twice
       would double the logged time and the checklists. */
    const haveSessions = new Set(state.sessions.map(x => x.id));
    const haveFocus    = new Set(state.focus.map(x => x.id));

    const merged = normalize({
      version:  state.version,
      profile:  state.profile,
      nodes:    [...state.nodes, ...parsed.nodes.filter(n => !byId(String(n.id)))],
      sessions: [...state.sessions, ...(parsed.sessions || []).filter(x => !haveSessions.has(String(x.id)))],
      focus:    [...state.focus, ...(parsed.focus || []).filter(x => !haveFocus.has(String(x.id)))],
    });

    const added = merged.nodes.length - state.nodes.length;
    state = merged;
    return added;
  }

  function adoptSeed() {
    if (!seedMeta) return false;
    state = normalize(seedMeta.data);
    seedMeta = null;
    persist();
    return true;
  }

  async function resetToSeed() {
    const seed = await fetchSeed();
    state = normalize(seed || MINIMAL_SEED);
    persist();
    return state;
  }

  /* ---------------- public API ---------------- */

  return {
    STATUSES, STATUS_BY_ID,
    init,
    get state()    { return state; },
    get pendingSeed() { return seedMeta; },
    onChange(fn)   { listeners.push(fn); },
    byId, roots, childrenOf, ancestorsOf, descendantsOf, domainOf, depthOf, wouldCycle,
    progressOf, minutesFor, sessionsFor, statusCounts, currentStreak,
    lastWorked, daysBetween, relativeDay,
    focusFor, focusDates, focusSummary, addTask, toggleTask, updateTask, deleteTask, carryOverTo,
    addNode, updateNode, deleteNode, addSession, deleteSession, updateProfile,
    addItem, toggleItem, updateItem, deleteItem, checklistOf,
    isPrivate, privateNodeIds,
    toJSON, toPrivateJSON, hasPrivateData, importJSON, mergeJSON, adoptSeed, resetToSeed,
    todayISO, shiftDays, dayOfWeek, uid,
  };
})();
