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

  /* The local calendar day an instant falls on. A note written at 00:30 in a
     timezone ahead of UTC is stored as the previous day in UTC, and filing it
     under yesterday would be wrong on every screen that shows it. */
  function localDateOf(instant) {
    const d = new Date(instant);
    if (Number.isNaN(d.getTime())) return todayISO();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

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
      /* Optional: how many solved problems count as knowing this topic. */
      problemTarget: Number(n.problemTarget) > 0 ? Number(n.problemTarget) : 0,
      /* A vault note this topic corresponds to, opened through obsidian://. */
      obsidian:  typeof n.obsidian === 'string' ? n.obsidian.trim() : '',
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

    const problems = (Array.isArray(raw.problems) ? raw.problems : []).map(normalizeProblem);

    const projects = (Array.isArray(raw.projects) ? raw.projects : [])
      .map(normalizeProject)
      .filter(p => p.name)
      /* A concept pointing at a deleted topic is dropped; the project stays. */
      .map(p => ({ ...p, concepts: p.concepts.filter(c => ids.has(c.nodeId)) }));

    const goals = (Array.isArray(raw.goals) ? raw.goals : [])
      .map(normalizeGoal)
      .filter(g => g.name)
      /* A part pointing at a deleted topic becomes a plain checkbox rather
         than vanishing: the intention was real. */
      .map(g => ({ ...g, parts: g.parts.map(p =>
        (p.nodeId && !ids.has(p.nodeId) ? { ...p, kind: 'manual', nodeId: null } : p)) }));

    const journal = (Array.isArray(raw.journal) ? raw.journal : [])
      .map(normalizeEntry)
      .filter(e => e.text && ids.has(e.nodeId));

    /* A reference to a topic that no longer exists is dropped, as is one that
       points at itself, and a pair is only kept once per direction. */
    const seenLinks = new Set();
    const links = (Array.isArray(raw.links) ? raw.links : [])
      .map(normalizeLink)
      .filter(l => {
        const key = l.from + '->' + l.to;
        if (l.from === l.to || !ids.has(l.from) || !ids.has(l.to) || seenLinks.has(key)) return false;
        seenLinks.add(key);
        return true;
      });
    /* Connections are admitted one at a time and each is checked against the
       ones already accepted, so a file carrying a loop loads as a tree with
       the offending connection missing rather than as a tree that hangs. */
    const connections = [];
    const seenConnections = new Set();
    (Array.isArray(raw.connections) ? raw.connections : [])
      .map(normalizeConnection)
      .forEach(c => {
        const key = c.from + '->' + c.to;
        if (c.from === c.to || !ids.has(c.from) || !ids.has(c.to)) return;
        if (seenConnections.has(key)) return;
        if (graftReaches(nodes, connections, c.from, c.to)) return;
        seenConnections.add(key);
        connections.push(c);
      });

    const applications = (Array.isArray(raw.applications) ? raw.applications : [])
      .map(normalizeApplication)
      .filter(a => a.company);

    /* A tag mapping that points at a topic which no longer exists is dropped,
       so the tag falls back to unmapped rather than pointing into nothing. */
    const tagMap = {};
    Object.entries(raw.tagMap || {}).forEach(([tag, nodeId]) => {
      if (ids.has(String(nodeId))) tagMap[String(tag).toLowerCase()] = String(nodeId);
    });

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
      problems,
      applications,
      links,
      connections,
      journal,
      goals,
      projects,
      tagMap,
      sources: (Array.isArray(raw.sources) ? raw.sources : [])
        .filter(x => x && x.id && x.label)
        .map(x => ({ id: String(x.id), label: String(x.label) })),
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

    /* Whichever piece of evidence claims the most: the status you set, the
       checklist you ticked, or the problems you solved against a target. */
    const claims = [STATUS_BY_ID[node.status].weight];
    if (node.items.length) claims.push(node.items.filter(i => i.done).length / node.items.length);
    if (node.problemTarget > 0) {
      claims.push(Math.min(1, problemsForNode(node.id).length / node.problemTarget));
    }
    return Math.max(...claims);
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
    /* Moving a branch can put a connected topic inside the very branch it was
       borrowing, which the tree cannot draw. The offending connection is
       dropped rather than the move being refused: the person moved the topic
       deliberately, and a connection is the cheaper thing to make again. */
    if ('parentId' in patch) pruneLoopingConnections();
    persist();
    return node;
  }

  /* Removes the node, everything under it, and everything that pointed at it.

     Leaving references behind is not merely untidy: a journal entry whose
     topic is gone can no longer be seen as private, so it would be written
     into the public snapshot. Anything naming a deleted topic goes with it. */
  function deleteNode(id) {
    const doomed = new Set([id, ...descendantsOf(id).map(n => n.id)]);

    state.nodes    = state.nodes.filter(n => !doomed.has(n.id));
    state.sessions = state.sessions.filter(s => !doomed.has(s.nodeId));
    state.journal  = state.journal.filter(e => !doomed.has(e.nodeId));
    state.links    = state.links.filter(l => !doomed.has(l.from) && !doomed.has(l.to));
    state.connections = state.connections.filter(c => !doomed.has(c.from) && !doomed.has(c.to));

    /* These outlive the topic, so they lose the link rather than the record. */
    state.problems.forEach(p => { if (doomed.has(p.nodeId)) p.nodeId = null; });
    state.focus.forEach(t => { if (doomed.has(t.nodeId)) t.nodeId = null; });
    state.projects.forEach(pr => {
      pr.concepts = pr.concepts.filter(c => !doomed.has(c.nodeId));
    });
    state.goals.forEach(g => {
      g.parts = g.parts.map(part => (doomed.has(part.nodeId)
        ? { ...part, kind: 'manual', nodeId: null } : part));
    });
    Object.keys(state.tagMap).forEach(tag => {
      if (doomed.has(state.tagMap[tag])) delete state.tagMap[tag];
    });

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

  /* Ticking the last item is a claim that the topic is done, so the status
     follows. Un-ticking never demotes: the status is yours to lower. */
  function toggleItem(nodeId, itemId) {
    const node = byId(nodeId);
    const item = node && node.items.find(i => i.id === itemId);
    if (!item) return null;

    item.done = !item.done;
    node.updatedAt = todayISO();

    const complete = node.items.length > 0 && node.items.every(i => i.done);
    const promoted = complete && node.status !== 'mastered';
    if (promoted) node.status = 'mastered';

    persist();
    return { item, promoted };
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

  /* ---------------- activity ---------------- */

  /* Deliberately not called contributions: this counts work units of the
     tracker's own — study time, tasks, solves, notes, applications — and
     borrowing GitHub's word would eventually get them confused with commits.

     Everything a day contains, so the heatmap can be a way into the history
     rather than only a picture of it. */
  function activityOn(date) {
    const sessions = state.sessions.filter(s => s.date === date);
    const tasks    = state.focus.filter(t => t.date === date);
    const solves   = state.problems.filter(p => p.solvedAt === date);
    const notes    = state.journal.filter(e => e.date === date);
    const applied  = state.applications.filter(a => a.events.some(e => e.date === date));

    const minutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
    const doneTasks = tasks.filter(t => t.done);

    return {
      date,
      minutes,
      sessions,
      tasks,
      doneTasks,
      solves,
      notes,
      applications: applied,
      /* One unit per thing done, with time counted separately so a long day
         of study is not flattened to a single square. */
      units: doneTasks.length + solves.length + notes.length + applied.length + (minutes > 0 ? 1 : 0),
    };
  }

  /* A day's intensity, which is what the square's shade shows. */
  function activityLevel(activity) {
    const score = activity.units + Math.floor(activity.minutes / 45);
    if (!score) return 0;
    if (score <= 1) return 1;
    if (score <= 3) return 2;
    if (score <= 5) return 3;
    return 4;
  }

  /* ---------------- journal ---------------- */

  /* Short, dated notes against a topic. Not a replacement for a real notes
     app — somewhere to put "finally understood why this works" at the moment
     it happens, so the thought is attached to the topic and the date. */
  function normalizeEntry(e) {
    const at = e.at || nowISO();
    return {
      id:     String(e.id || uid('j')),
      nodeId: String(e.nodeId),
      at,
      /* The calendar day it belongs to, worked out locally. Older entries
         predate this field and are converted from their timestamp. */
      date:   e.date ? String(e.date).slice(0, 10) : localDateOf(at),
      text:   String(e.text || '').trim(),
    };
  }

  function addEntry(nodeId, text) {
    const now = nowISO();
    const entry = normalizeEntry({ id: uid('j'), nodeId, text, at: now, date: localDateOf(now) });
    if (!entry.text || !byId(nodeId)) return null;
    state.journal.push(entry);
    persist();
    return entry;
  }

  function updateEntry(id, text) {
    const entry = state.journal.find(e => e.id === id);
    if (!entry) return null;
    entry.text = String(text || '').trim();
    persist();
    return entry;
  }

  function deleteEntry(id) {
    state.journal = state.journal.filter(e => e.id !== id);
    persist();
  }

  /* Newest first, and a parent shows what was written anywhere beneath it. */
  function journalFor(nodeId, includeDescendants = false) {
    const ids = new Set([nodeId, ...(includeDescendants ? descendantsOf(nodeId).map(n => n.id) : [])]);
    return state.journal
      .filter(e => ids.has(e.nodeId))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  /* Obsidian opens a note from a link, which is all the integration needed:
     the vault stays the source of truth and the tracker just points at it. */
  function obsidianUrl(node) {
    if (!node || !node.obsidian) return '';
    const raw = node.obsidian.trim();
    if (raw.startsWith('obsidian://')) return raw;

    /* "Vault/Some/Note" -> vault plus file; a bare path opens in whichever
       vault is current. */
    const slash = raw.indexOf('/');
    if (slash > 0) {
      const vault = raw.slice(0, slash);
      const file = raw.slice(slash + 1);
      return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
    }
    return `obsidian://open?file=${encodeURIComponent(raw)}`;
  }

  /* ---------------- references between topics ---------------- */

  /* The tree says where a topic sits; references say what it relates to.
     Probability relates to Randomised Algorithms without either owning the
     other, and only a graph can express that. */
  /* An edge that says how two topics relate carries far more than one that
     only says they do. "Concurrency requires Processes" is checkable; "these
     are related" is not. */
  /* `phrase` reads from the topic the reference was added to; `inverse` reads
     from the other end, which is not always the same sentence turned around. */
  const LINK_TYPES = [
    { id: 'relates',  label: 'relates to', phrase: 'relates to', inverse: 'relates to'  },
    { id: 'requires', label: 'requires',   phrase: 'requires',   inverse: 'is required by' },
    { id: 'part-of',  label: 'is part of', phrase: 'is part of', inverse: 'contains'    },
    { id: 'extends',  label: 'extends',    phrase: 'extends',    inverse: 'is extended by' },
    { id: 'used-by',  label: 'is used by', phrase: 'is used by', inverse: 'uses'        },
  ];
  const LINK_TYPE_IDS = LINK_TYPES.map(t => t.id);

  function normalizeLink(l) {
    return {
      id:    String(l.id || uid('l')),
      from:  String(l.from),
      to:    String(l.to),
      type:  LINK_TYPE_IDS.includes(l.type) ? l.type : 'relates',
      label: typeof l.label === 'string' ? l.label.trim() : '',
    };
  }

  function addLink(from, to, label = '', type = 'relates') {
    if (!from || !to || from === to) return null;
    if (!byId(from) || !byId(to)) return null;
    /* One reference per pair per direction; re-adding updates it. */
    const existing = state.links.find(l => l.from === from && l.to === to);
    if (existing) {
      if (label) existing.label = label.trim();
      if (LINK_TYPE_IDS.includes(type)) existing.type = type;
      persist();
      return existing;
    }
    const link = normalizeLink({ id: uid('l'), from, to, label, type });
    state.links.push(link);
    persist();
    return link;
  }

  function updateLink(id, patch) {
    const link = state.links.find(l => l.id === id);
    if (!link) return null;
    Object.assign(link, patch);
    link.label = String(link.label || '').trim();
    persist();
    return link;
  }

  function deleteLink(id) {
    state.links = state.links.filter(l => l.id !== id);
    persist();
  }

  /* Both directions, because a reference is worth seeing from either end. */
  const linksFor = nodeId => ({
    out: state.links.filter(l => l.from === nodeId),
    in:  state.links.filter(l => l.to === nodeId),
  });

  const relatedTo = nodeId => {
    const { out, incoming } = { out: state.links.filter(l => l.from === nodeId),
                                incoming: state.links.filter(l => l.to === nodeId) };
    return [...new Set([...out.map(l => l.to), ...incoming.map(l => l.from)])];
  };

  /* ---------------- connections: one branch shown inside another ----------

     A reference says two topics relate. A connection is stronger: it says
     "wherever you look at B, this whole branch A belongs there too". A is
     drawn inside B's tree, with its own sub-topics, while still living where
     it really is. Nothing is copied and nothing moves — the same topic is
     simply visible in two places, which is what makes it possible to keep
     one tree per field and still see the parts that genuinely span them. */

  function normalizeConnection(c) {
    return {
      id:    String(c.id || uid('c')),
      from:  String(c.from),          // the branch being shown
      to:    String(c.to),            // the topic it is shown under
      label: typeof c.label === 'string' ? c.label.trim() : '',
    };
  }

  /* Expanding a topic follows its real children *and* the branches connected
     into it, so a connection can close a loop that parentage alone never
     could. This walks that combined shape and answers "can I get from here to
     there", which is exactly the question a new connection has to pass. */
  function graftReaches(nodes, connections, startId, targetId) {
    const kids = new Map();
    nodes.forEach(n => {
      if (!n.parentId) return;
      if (!kids.has(n.parentId)) kids.set(n.parentId, []);
      kids.get(n.parentId).push(n.id);
    });
    const brought = new Map();
    connections.forEach(c => {
      if (!brought.has(c.to)) brought.set(c.to, []);
      brought.get(c.to).push(c.from);
    });

    const seen = new Set();
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      (kids.get(id) || []).forEach(x => stack.push(x));
      (brought.get(id) || []).forEach(x => stack.push(x));
    }
    return false;
  }

  /* True when showing `from` under `to` would make the tree contain itself. */
  const wouldLoop = (from, to) =>
    from === to || graftReaches(state.nodes, state.connections, from, to);

  /* True when `from` is already drawn somewhere below `to` — as a real
     sub-topic or through a connection already made. Bringing it in again
     would put two cards for one topic in the same tree and say nothing new. */
  const alreadyShownIn = (from, to) =>
    from !== to && graftReaches(state.nodes, state.connections, to, from);

  /* The one question the inspector and the store both need to ask. */
  const canConnect = (from, to) =>
    !!from && !!to && from !== to && !wouldLoop(from, to) && !alreadyShownIn(from, to);

  function addConnection(from, to, label = '') {
    if (!from || !to || from === to) return null;
    if (!byId(from) || !byId(to)) return null;
    /* Re-connecting an existing pair updates its note rather than doubling. */
    const existing = state.connections.find(c => c.from === from && c.to === to);
    if (existing) {
      if (label) existing.label = String(label).trim();
      persist();
      return existing;
    }
    if (!canConnect(from, to)) return null;

    const conn = normalizeConnection({ id: uid('c'), from, to, label });
    state.connections.push(conn);
    persist();
    return conn;
  }

  function deleteConnection(id) {
    state.connections = state.connections.filter(c => c.id !== id);
    persist();
  }

  /* Re-parenting can close a loop that a connection did not have when it was
     made, so they are re-checked whenever the shape of the tree moves. The
     ones that survive are kept in order, so an older connection outlives a
     newer one that conflicts with it. */
  function pruneLoopingConnections() {
    const kept = [];
    state.connections.forEach(c => {
      if (!byId(c.from) || !byId(c.to) || c.from === c.to) return;
      if (graftReaches(state.nodes, kept, c.from, c.to)) return;
      kept.push(c);
    });
    const dropped = state.connections.length - kept.length;
    state.connections = kept;
    return dropped;
  }

  /* Read from one topic's side: what it borrows, and where it is lent out. */
  const connectionsFor = nodeId => ({
    brings:    state.connections.filter(c => c.to === nodeId),
    appearsIn: state.connections.filter(c => c.from === nodeId),
  });

  /* The branches to draw underneath this topic, in the order they were added. */
  const connectedInto = nodeId =>
    state.connections
      .filter(c => c.to === nodeId)
      .map(c => ({ connection: c, node: byId(c.from) }))
      .filter(x => x.node);

  /* Something being learned whose prerequisites have not been started is
     worth saying out loud — it is the most common way study goes sideways. */
  function prerequisiteWarnings() {
    const inProgress = new Set(['learning', 'practicing']);
    const notStarted = 'planned';
    const out = [];

    state.links.filter(l => l.type === 'requires').forEach(link => {
      const topic = byId(link.from);
      const needed = byId(link.to);
      if (!topic || !needed) return;
      if (!inProgress.has(topic.status)) return;
      if (needed.status !== notStarted) return;
      out.push({ topic, needed, linkId: link.id });
    });
    return out;
  }

  /* ---------------- tag catalogue ---------------- */

  /* A starting vocabulary so tagging is picking rather than inventing. Typing
     anything else still works — this is a suggestion list, not a whitelist. */
  const TAG_CATALOGUE = {
    'Algorithms': [
      'two pointers', 'sliding window', 'binary search', 'sorting', 'greedy',
      'dynamic programming', 'divide and conquer', 'backtracking', 'recursion',
      'bit manipulation', 'simulation', 'prefix sums', 'meet in the middle',
    ],
    'Data structures': [
      'arrays', 'strings', 'hash table', 'stack', 'queue', 'heap', 'linked list',
      'trees', 'binary search tree', 'trie', 'segment tree', 'fenwick tree',
      'union find', 'matrix',
    ],
    'Graphs': [
      'graphs', 'bfs', 'dfs', 'shortest paths', 'topological sort',
      'minimum spanning tree', 'strongly connected components', 'flows', 'matching',
    ],
    'Mathematics': [
      'number theory', 'combinatorics', 'probability', 'statistics', 'geometry',
      'linear algebra', 'calculus', 'real analysis', 'complex analysis',
      'differential equations', 'abstract algebra', 'group theory', 'topology',
      'measure theory', 'set theory', 'logic', 'proof techniques', 'optimisation',
      'numerical methods', 'graph theory',
    ],
    'Systems': [
      'concurrency', 'parallelism', 'memory', 'caching', 'operating systems',
      'networking', 'databases', 'compilers', 'distributed systems',
    ],
  };

  const catalogueTags = () => Object.values(TAG_CATALOGUE).flat();

  /* Every tag in play: the catalogue plus anything invented on a solve. */
  const knownTags = () =>
    [...new Set([...catalogueTags(), ...state.problems.flatMap(p => p.tags)])].sort();

  /* ---------------- solved problems ---------------- */

  /* Where a problem came from — a site, a course, a book, anything. */
  const LEVELS = ['easy', 'medium', 'hard'];

  /* How much help it took. The point of recording this is that "solved" and
     "solved after reading the answer" are not the same claim. */
  const INDEPENDENCE = [
    { id: 'independent', label: 'On my own', weight: 1.0 },
    { id: 'hint',        label: 'With a hint', weight: 0.5 },
    { id: 'solution',    label: 'Read the solution', weight: 0.0 },
  ];
  const INDEPENDENCE_BY_ID = Object.fromEntries(INDEPENDENCE.map(i => [i.id, i]));

  /* Where a problem sits in the revisit cycle. */
  const PROBLEM_STATES = [
    { id: 'solved',   label: 'Solved'       },
    { id: 'review',   label: 'Needs review' },
    { id: 'resolved', label: 'Re-solved'    },
    { id: 'mastered', label: 'Mastered'     },
  ];
  const PROBLEM_STATE_IDS = PROBLEM_STATES.map(s => s.id);

  const PROBLEM_SOURCES = [
    { id: 'leetcode',     label: 'LeetCode'            },
    { id: 'codeforces',   label: 'Codeforces'          },
    { id: 'projecteuler', label: 'Project Euler'     },
    { id: 'cses',         label: 'CSES'                },
    { id: 'atcoder',      label: 'AtCoder'             },
    { id: 'university',   label: 'University problem set' },
    { id: 'textbook',     label: 'Textbook'            },
    { id: 'interview',    label: 'Interview prep'      },
    { id: 'other',        label: 'Other'               },
  ];

  /* A solve is a discrete event with an identity, not just time spent, which
     is why it is kept apart from sessions: it can be counted and grouped. */
  function normalizeProblem(p) {
    const perceived = Number(p.perceived);
    const difficulty = Number(p.difficulty);
    return {
      id:        String(p.id || uid('p')),
      source:    String(p.source || 'other'),
      problemId: String(p.problemId || '').trim(),
      title:     String(p.title || p.problemId || 'Untitled problem').trim(),
      url:       p.url ? String(p.url) : '',
      tags:      Array.isArray(p.tags) ? [...new Set(p.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean))] : [],
      difficulty: Number.isFinite(difficulty) && difficulty > 0 ? difficulty : null,
      /* Some sites band problems instead of rating them; "Medium" and a
         Codeforces 1600 are not the same claim, so they are kept apart. */
      level:     LEVELS.includes(p.level) ? p.level : null,
      /* How hard it felt, 1 (easy) to 5 (brutal) — independent of any rating. */
      perceived: perceived >= 1 && perceived <= 5 ? Math.round(perceived) : null,
      solvedAt:  String(p.solvedAt || todayISO()).slice(0, 10),
      minutes:   Math.max(0, Number(p.minutes) || 0),
      notes:     typeof p.notes === 'string' ? p.notes : '',
      nodeId:    p.nodeId ? String(p.nodeId) : null,

      /* --- what actually happened when you solved it --- */
      independence: INDEPENDENCE_BY_ID[p.independence] ? p.independence : null,
      attempts:  Math.max(0, Number(p.attempts) || 0),
      mistake:   typeof p.mistake === 'string' ? p.mistake : '',
      lesson:    typeof p.lesson === 'string' ? p.lesson : '',
      state:     PROBLEM_STATE_IDS.includes(p.state) ? p.state : 'solved',
      reviewOn:  p.reviewOn ? String(p.reviewOn).slice(0, 10) : '',
      reviewedAt: p.reviewedAt ? String(p.reviewedAt).slice(0, 10) : '',
    };
  }

  /* Identity across imports: the same problem on the same site is one solve. */
  const problemKey = p => `${p.source}:${String(p.problemId || p.title).toLowerCase()}`;

  const sourceLabel = id =>
    (PROBLEM_SOURCES.find(s => s.id === id) || {}).label ||
    (state.sources.find(s => s.id === id) || {}).label || id;

  const allSources = () => [...PROBLEM_SOURCES, ...state.sources];

  function addSource(label) {
    const clean = String(label || '').trim();
    if (!clean) return null;
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || allSources().some(s => s.id === id)) return null;
    const source = { id, label: clean };
    state.sources.push(source);
    persist();
    return source;
  }

  function addProblem(data) {
    const problem = normalizeProblem({ ...data, id: uid('p') });
    if (!problem.title) return null;
    state.problems.push(problem);
    persist();
    return problem;
  }

  function updateProblem(id, patch) {
    const problem = state.problems.find(p => p.id === id);
    if (!problem) return null;
    Object.assign(problem, normalizeProblem({ ...problem, ...patch, id: problem.id }));
    persist();
    return problem;
  }

  function deleteProblem(id) {
    state.problems = state.problems.filter(p => p.id !== id);
    persist();
  }

  /* Clearing out everything one source contributed, for when a sync brought in
     the wrong account or a fresh start is wanted. */
  function deleteProblemsFrom(source) {
    const before = state.problems.length;
    state.problems = state.problems.filter(p => p.source !== source);
    const removed = before - state.problems.length;
    if (removed) persist();
    return removed;
  }

  /* The entry point an importer or browser extension writes through: the same
     solve arriving twice updates rather than duplicates. */
  function recordSolve(data) {
    const incoming = normalizeProblem({ ...data, id: uid('p') });
    if (!incoming.problemId && !incoming.title) return { problem: null, created: false };

    const existing = state.problems.find(p => problemKey(p) === problemKey(incoming));
    if (existing) {
      /* Keep whatever the person wrote themselves. */
      existing.tags = [...new Set([...existing.tags, ...incoming.tags])];
      if (incoming.difficulty && !existing.difficulty) existing.difficulty = incoming.difficulty;
      if (incoming.level && !existing.level) existing.level = incoming.level;
      if (incoming.url && !existing.url) existing.url = incoming.url;
      if (incoming.solvedAt < existing.solvedAt) existing.solvedAt = incoming.solvedAt;
      /* Whatever the person said about it this time is the newer claim. */
      if (incoming.independence) existing.independence = incoming.independence;
      applySolveActions(existing, data);
      persist();
      return { problem: existing, created: false };
    }

    if (!incoming.nodeId) incoming.nodeId = nodeForTags(incoming.tags);
    state.problems.push(incoming);
    applySolveActions(incoming, data);
    persist();
    return { problem: incoming, created: true };
  }

  /* The extension's problem panel can say more than "solved": book a revisit,
     or record that a problem was solved again. Those arrive alongside the
     solve rather than as separate calls, because the page may only get one
     chance to hand anything over. */
  function applySolveActions(problem, data) {
    if (!data) return;
    if (Number(data.reviewInDays) > 0) {
      problem.reviewOn = shiftDays(todayISO(), Number(data.reviewInDays));
      if (problem.state === 'solved') problem.state = 'review';
    }
    if (data.revisit) {
      problem.reviewedAt = todayISO();
      problem.reviewOn = '';
      problem.state = problem.state === 'resolved' ? 'mastered' : 'resolved';
    }
  }

  function recordSolves(list) {
    if (!Array.isArray(list)) return { added: 0, updated: 0 };
    let added = 0, updated = 0;
    list.forEach(item => {
      const { problem, created } = recordSolve(item);
      if (!problem) return;
      created ? added++ : updated++;
    });
    return { added, updated };
  }

  /* ---------------- tag to topic mapping ---------------- */

  /* Solving problems is evidence about a topic, but only once the site's tags
     are mapped onto the tree. The mapping is deliberately manual: automatic
     guesses are never quite right. */
  function setTagMapping(tag, nodeId) {
    const key = String(tag || '').trim().toLowerCase();
    if (!key) return;
    if (nodeId) state.tagMap[key] = String(nodeId);
    else delete state.tagMap[key];
    persist();
  }

  const nodeForTags = tags =>
    (tags || []).map(t => state.tagMap[t]).find(id => id && byId(id)) || null;

  /* Every tag seen on a solve, with how often and where it points. */
  function tagIndex(filter = {}) {
    const counts = new Map();
    problemsMatching(filter).forEach(p => {
      p.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    });
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count, nodeId: state.tagMap[tag] || null }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  function problemsMatching({ source = '', tag = '', since = '' } = {}) {
    return state.problems.filter(p =>
      (!source || p.source === source) &&
      (!tag || p.tags.includes(tag)) &&
      (!since || p.solvedAt >= since));
  }

  /* Problems that count towards a topic: mapped directly, or by one of their
     tags, and anything solved under a child topic counts for the parent too. */
  function problemsForNode(nodeId, includeDescendants = true) {
    const ids = new Set([nodeId, ...(includeDescendants ? descendantsOf(nodeId).map(n => n.id) : [])]);
    return state.problems.filter(p => {
      const mapped = p.nodeId || nodeForTags(p.tags);
      return mapped && ids.has(mapped);
    });
  }

  /* What the solved problems actually say about a topic. This is the
     difference between "I think I am proficient at linked lists" and
     "12 solved, 4 medium, 2 hard, 90% without help". */
  function evidenceFor(nodeId) {
    const list = problemsForNode(nodeId);
    const rated = list.filter(p => p.independence);
    const independent = list.filter(p => p.independence === 'independent').length;

    const byLevel = LEVELS.reduce((acc, l) => ({ ...acc, [l]: list.filter(p => p.level === l).length }), {});
    const hardest = list.reduce((max, p) => Math.max(max, p.difficulty || 0), 0);

    return {
      solved: list.length,
      independent,
      /* Only counts problems where you said how much help you took. */
      independenceRate: rated.length ? independent / rated.length : null,
      rated: rated.length,
      byLevel,
      hardest: hardest || null,
      lastSolvedAt: list.reduce((max, p) => (p.solvedAt > max ? p.solvedAt : max), ''),
      needsRevisit: list.filter(p => p.state === 'review').length,
      recent: list.slice().sort((a, b) => b.solvedAt.localeCompare(a.solvedAt)).slice(0, 5),
    };
  }

  /* A status the evidence would support, offered as a suggestion rather than
     imposed: the person still decides, but they decide against a number.

     Solving problems without help is the strongest signal there is, so it
     leads; a finished checklist counts for less on its own, because reading
     something is not the same as being able to use it. */
  function suggestedStatus(nodeId) {
    const node = byId(nodeId);
    if (!node) return null;

    const evidence = evidenceFor(nodeId);
    const list = checklistOf(nodeId);
    const rate = evidence.independenceRate;
    const solid = evidence.byLevel.medium + evidence.byLevel.hard;

    let suggestion = null;
    let because = '';

    if (evidence.solved >= 12 && rate !== null && rate >= 0.85 && solid >= 4) {
      suggestion = 'mastered';
      because = `${evidence.solved} problems solved, ${Math.round(rate * 100)}% without help`;
    } else if (evidence.solved >= 6 && rate !== null && rate >= 0.6) {
      suggestion = 'proficient';
      because = `${evidence.solved} problems solved, ${Math.round(rate * 100)}% without help`;
    } else if (evidence.solved >= 2) {
      suggestion = 'practicing';
      because = `${evidence.solved} problems solved`;
    } else if (list.total && list.done === list.total) {
      suggestion = 'practicing';
      because = 'the checklist is finished, but no problems solved yet';
    } else if (list.done > 0 || minutesFor(nodeId, false) > 0) {
      suggestion = 'learning';
      because = 'there is time logged against it';
    }

    if (!suggestion) return null;

    const order = STATUSES.map(s => s.id);
    /* Never suggest going backwards: the person may know something the
       problem log does not. */
    if (order.indexOf(suggestion) <= order.indexOf(node.status)) return null;

    return { status: suggestion, label: STATUS_BY_ID[suggestion].label, because };
  }

  function problemStats(filter = {}) {
    const list = problemsMatching(filter);
    const rated = list.filter(p => p.difficulty);
    const felt  = list.filter(p => p.perceived);
    const week  = shiftDays(todayISO(), -7);

    return {
      total:     list.length,
      thisWeek:  list.filter(p => p.solvedAt >= week).length,
      sources:   [...new Set(list.map(p => p.source))].length,
      hardest:   rated.length ? Math.max(...rated.map(p => p.difficulty)) : null,
      avgFelt:   felt.length ? felt.reduce((sum, p) => sum + p.perceived, 0) / felt.length : null,
      minutes:   list.reduce((sum, p) => sum + p.minutes, 0),
      unmapped:  list.filter(p => !(p.nodeId || nodeForTags(p.tags))).length,
      levels:    LEVELS.reduce((acc, l) => ({ ...acc, [l]: list.filter(p => p.level === l).length }), {}),
    };
  }

  /* Anything explicitly flagged, or whose review date has come round. A
     problem you needed the solution for is worth seeing again even if you
     never set a date. */
  function problemsToRevisit() {
    const today = todayISO();
    return state.problems
      .filter(p => {
        if (p.state === 'mastered') return false;
        /* A booked revisit is due on its date, not the moment it is booked;
           without a date, needing review means needing it now. */
        if (p.reviewOn) return p.reviewOn <= today;
        return p.state === 'review';
      })
      .sort((a, b) => (a.reviewOn || a.solvedAt).localeCompare(b.reviewOn || b.solvedAt));
  }

  /* Booking a revisit is the whole point of noticing you struggled. */
  function scheduleReview(id, days) {
    const problem = state.problems.find(p => p.id === id);
    if (!problem) return null;

    if (Number(days) > 0) {
      problem.reviewOn = shiftDays(todayISO(), Number(days));
      if (problem.state === 'solved') problem.state = 'review';
    } else {
      /* Un-booking has to undo the flag as well, or the problem would sit in
         the revisit list with no way back out. */
      problem.reviewOn = '';
      if (problem.state === 'review') problem.state = 'solved';
    }
    persist();
    return problem;
  }

  /* Coming back and solving it again is a different, stronger claim. */
  function markRevisited(id, { independent = true } = {}) {
    const problem = state.problems.find(p => p.id === id);
    if (!problem) return null;
    problem.reviewedAt = todayISO();
    problem.reviewOn = '';
    problem.state = independent && problem.state === 'resolved' ? 'mastered' : 'resolved';
    persist();
    return problem;
  }

  /* A compact view of every solve, for the browser extension to show on the
     problem page you are looking at. Only what a panel would display: no
     notes, no tags, nothing the page does not need. */
  const problemDigest = () => state.problems.map(p => ({
    source: p.source,
    problemId: p.problemId,
    title: p.title,
    solvedAt: p.solvedAt,
    state: p.state,
    independence: p.independence,
    attempts: p.attempts,
    mistake: p.mistake,
    lesson: p.lesson,
    reviewOn: p.reviewOn,
    level: p.level,
  }));

  const recentProblems = (limit = 10) =>
    state.problems.slice().sort((a, b) => b.solvedAt.localeCompare(a.solvedAt)).slice(0, limit);

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

  /* ---------------- goals ---------------- */

  /* Fields are open-ended by nature — you never finish Mathematics. A goal is
     the opposite: a few concrete things, by a date. Its parts are checked off
     by hand or answered by the tracker itself, so progress is not a second
     thing to maintain. */
  const GOAL_TARGETS = [
    { id: 'manual',    label: 'Something I tick off myself' },
    { id: 'status',    label: 'A topic reaches a status'    },
    { id: 'checklist', label: 'A topic’s checklist is done' },
    { id: 'problems',  label: 'Solve N problems in a topic' },
    { id: 'sessions',  label: 'Log N hours on a topic'      },
  ];

  function normalizeGoalPart(part) {
    return {
      id:     String(part.id || uid('gp')),
      kind:   GOAL_TARGETS.some(t => t.id === part.kind) ? part.kind : 'manual',
      text:   String(part.text || '').trim(),
      nodeId: part.nodeId ? String(part.nodeId) : null,
      /* How many problems, how many hours, or which status to reach. */
      amount: Math.max(0, Number(part.amount) || 0),
      status: STATUS_BY_ID[part.status] ? part.status : 'proficient',
      done:   !!part.done,
    };
  }

  function normalizeGoal(g) {
    return {
      id:        String(g.id || uid('g')),
      name:      String(g.name || '').trim(),
      targetDate: g.targetDate ? String(g.targetDate).slice(0, 10) : '',
      createdAt: g.createdAt || todayISO(),
      archived:  !!g.archived,
      parts:     Array.isArray(g.parts) ? g.parts.map(normalizeGoalPart).filter(p => p.text || p.nodeId) : [],
    };
  }

  /* What a single part is worth right now, between 0 and 1. */
  function partProgress(part) {
    if (part.kind === 'manual') return part.done ? 1 : 0;

    const node = part.nodeId ? byId(part.nodeId) : null;
    if (!node) return part.done ? 1 : 0;

    if (part.kind === 'status') {
      const order = STATUSES.map(s => s.id);
      return order.indexOf(node.status) >= order.indexOf(part.status) ? 1 : 0;
    }
    if (part.kind === 'checklist') {
      const list = checklistOf(node.id);
      return list.total ? list.done / list.total : 0;
    }
    if (part.kind === 'problems') {
      if (!part.amount) return 0;
      return Math.min(1, problemsForNode(node.id).length / part.amount);
    }
    if (part.kind === 'sessions') {
      if (!part.amount) return 0;
      return Math.min(1, minutesFor(node.id, true) / (part.amount * 60));
    }
    return 0;
  }

  function goalProgress(goal) {
    if (!goal.parts.length) return { ratio: 0, done: 0, total: 0 };
    const values = goal.parts.map(partProgress);
    const ratio = values.reduce((sum, v) => sum + v, 0) / values.length;
    return { ratio, done: values.filter(v => v >= 1).length, total: values.length };
  }

  /* Days left, which is the half of a goal that a percentage cannot express. */
  const daysRemaining = goal =>
    goal.targetDate ? daysBetween(todayISO(), goal.targetDate) : null;

  const goals = () => state.goals
    .filter(g => !g.archived)
    .sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));

  function addGoal({ name, targetDate }) {
    const goal = normalizeGoal({ id: uid('g'), name, targetDate });
    if (!goal.name) return null;
    state.goals.push(goal);
    persist();
    return goal;
  }

  function updateGoal(id, patch) {
    const goal = state.goals.find(g => g.id === id);
    if (!goal) return null;
    Object.assign(goal, normalizeGoal({ ...goal, ...patch, id: goal.id }));
    persist();
    return goal;
  }

  function deleteGoal(id) {
    state.goals = state.goals.filter(g => g.id !== id);
    persist();
  }

  const COUNTED_PARTS = ['problems', 'sessions'];

  function addGoalPart(goalId, part) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return null;
    const built = normalizeGoalPart({ ...part, id: uid('gp') });
    if (!built.text && !built.nodeId) return null;
    /* "Solve N problems" with no N can never complete, and would cap the
       goal's average forever. */
    if (COUNTED_PARTS.includes(built.kind) && built.amount < 1) return null;
    if (built.kind !== 'manual' && !built.nodeId) return null;
    goal.parts.push(built);
    persist();
    return built;
  }

  function toggleGoalPart(goalId, partId) {
    const goal = state.goals.find(g => g.id === goalId);
    const part = goal && goal.parts.find(p => p.id === partId);
    if (!part) return null;
    part.done = !part.done;
    persist();
    return part;
  }

  function deleteGoalPart(goalId, partId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    goal.parts = goal.parts.filter(p => p.id !== partId);
    persist();
  }

  /* ---------------- projects ---------------- */

  /* Concepts and problems say what you have studied and practised. A project
     says what you have actually built with it, which is a different and often
     more convincing claim: "I have studied CI/CD" against "CI runs on every
     push to this repository". */
  const PROJECT_STATES = [
    { id: 'idea',     label: 'Idea',     open: true  },
    { id: 'building', label: 'Building', open: true  },
    { id: 'paused',   label: 'Paused',   open: true  },
    { id: 'shipped',  label: 'Shipped',  open: false },
    { id: 'archived', label: 'Archived', open: false },
  ];
  const PROJECT_STATE_IDS = PROJECT_STATES.map(s => s.id);

  function normalizeProject(p) {
    return {
      id:        String(p.id || uid('pr')),
      name:      String(p.name || '').trim(),
      summary:   typeof p.summary === 'string' ? p.summary : '',
      repo:      p.repo ? String(p.repo).trim() : '',
      state:     PROJECT_STATE_IDS.includes(p.state) ? p.state : 'building',
      tech:      Array.isArray(p.tech) ? [...new Set(p.tech.map(t => String(t).trim()).filter(Boolean))] : [],
      startedAt: String(p.startedAt || todayISO()).slice(0, 10),
      private:   !!p.private,
      milestones: Array.isArray(p.milestones) ? p.milestones.map(m => ({
        id:   String(m.id || uid('pm')),
        text: String(m.text || '').trim(),
        done: !!m.done,
      })).filter(m => m.text) : [],
      /* The interesting part: which topics this project is evidence for. */
      concepts: Array.isArray(p.concepts) ? p.concepts.map(c => ({
        nodeId:   String(c.nodeId),
        evidence: typeof c.evidence === 'string' ? c.evidence.trim() : '',
      })).filter(c => c.nodeId) : [],
    };
  }

  const projects = () => state.projects.slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  function projectProgress(project) {
    if (!project.milestones.length) return { ratio: project.state === 'shipped' ? 1 : 0, done: 0, total: 0 };
    const done = project.milestones.filter(m => m.done).length;
    return { ratio: done / project.milestones.length, done, total: project.milestones.length };
  }

  function addProject(data) {
    const project = normalizeProject({ ...data, id: uid('pr') });
    if (!project.name) return null;
    state.projects.push(project);
    persist();
    return project;
  }

  function updateProject(id, patch) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return null;
    Object.assign(project, normalizeProject({ ...project, ...patch, id: project.id }));
    persist();
    return project;
  }

  function deleteProject(id) {
    state.projects = state.projects.filter(p => p.id !== id);
    persist();
  }

  function addMilestone(projectId, text) {
    const project = state.projects.find(p => p.id === projectId);
    const clean = String(text || '').trim();
    if (!project || !clean) return null;
    const milestone = { id: uid('pm'), text: clean, done: false };
    project.milestones.push(milestone);
    persist();
    return milestone;
  }

  function toggleMilestone(projectId, milestoneId) {
    const project = state.projects.find(p => p.id === projectId);
    const milestone = project && project.milestones.find(m => m.id === milestoneId);
    if (!milestone) return null;
    milestone.done = !milestone.done;
    persist();
    return milestone;
  }

  function deleteMilestone(projectId, milestoneId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    project.milestones = project.milestones.filter(m => m.id !== milestoneId);
    persist();
  }

  /* Claiming a topic was used here, with a sentence saying how. */
  function linkConcept(projectId, nodeId, evidence = '') {
    const project = state.projects.find(p => p.id === projectId);
    if (!project || !byId(nodeId)) return null;

    const existing = project.concepts.find(c => c.nodeId === nodeId);
    if (existing) {
      if (evidence) existing.evidence = String(evidence).trim();
      persist();
      return existing;
    }
    const concept = { nodeId: String(nodeId), evidence: String(evidence || '').trim() };
    project.concepts.push(concept);
    persist();
    return concept;
  }

  function unlinkConcept(projectId, nodeId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    project.concepts = project.concepts.filter(c => c.nodeId !== nodeId);
    persist();
  }

  /* Read from the topic's side: where has this actually been used? A parent
     counts anything used by a topic beneath it. */
  function projectsUsing(nodeId, includeDescendants = true) {
    const ids = new Set([nodeId, ...(includeDescendants ? descendantsOf(nodeId).map(n => n.id) : [])]);
    return state.projects
      .filter(p => p.concepts.some(c => ids.has(c.nodeId)))
      .map(p => ({
        project: p,
        evidence: p.concepts.filter(c => ids.has(c.nodeId)).map(c => c.evidence).filter(Boolean),
      }));
  }

  /* ---------------- job applications ---------------- */

  /* Applications are ALWAYS private. They are never written to the public
     snapshot, whatever else is marked private — losing control of where you
     applied and who rejected you is not a mistake worth making possible. */
  const APP_STAGES = [
    { id: 'wishlist',   label: 'Wishlist',   open: true  },
    { id: 'applied',    label: 'Applied',    open: true  },
    { id: 'screen',     label: 'Screening',  open: true  },
    { id: 'assessment', label: 'Assessment', open: true  },
    { id: 'interview',  label: 'Interview',  open: true  },
    { id: 'offer',      label: 'Offer',      open: false },
    { id: 'rejected',   label: 'Rejected',   open: false },
    { id: 'withdrawn',  label: 'Withdrawn',  open: false },
  ];
  const STAGE_BY_ID = Object.fromEntries(APP_STAGES.map(s => [s.id, s]));

  function normalizeApplication(a) {
    return {
      id:       String(a.id || uid('a')),
      company:  String(a.company || '').trim(),
      role:     String(a.role || '').trim(),
      location: String(a.location || '').trim(),
      url:      a.url ? String(a.url) : '',
      source:   String(a.source || '').trim(),
      stage:    STAGE_BY_ID[a.stage] ? a.stage : 'applied',
      appliedAt: String(a.appliedAt || todayISO()).slice(0, 10),
      deadline: a.deadline ? String(a.deadline).slice(0, 10) : '',
      nextAction: String(a.nextAction || '').trim(),
      nextDue:  a.nextDue ? String(a.nextDue).slice(0, 10) : '',
      notes:    typeof a.notes === 'string' ? a.notes : '',
      events:   Array.isArray(a.events) ? a.events.map(e => ({
        id:    String(e.id || uid('e')),
        date:  String(e.date || todayISO()).slice(0, 10),
        stage: STAGE_BY_ID[e.stage] ? e.stage : 'applied',
        note:  typeof e.note === 'string' ? e.note : '',
        /* Auto events come from changing the stage; a mis-click can undo one,
           while anything written by hand is left alone. */
        auto:  e.auto === true,
      })).sort((x, y) => x.date.localeCompare(y.date)) : [],
      updatedAt: a.updatedAt || todayISO(),
    };
  }

  const applications = () => state.applications.slice()
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));

  function addApplication(data) {
    const app = normalizeApplication({ ...data, id: uid('a') });
    if (!app.company) return null;
    if (!app.events.length) {
      app.events.push({ id: uid('e'), date: app.appliedAt, stage: app.stage, note: '', auto: false });
    }
    state.applications.push(app);
    persist();
    return app;
  }

  /* A stage change is worth remembering as a dated event, because the shape of
     a search is in its timeline, not just its current state.

     Correcting a mis-click must leave no trace, though: picking the wrong
     stage and putting it back should not leave "reached interview" true
     forever. So a change made the same day, on top of an automatic event
     nobody has annotated, rewrites that event instead of stacking another —
     and if it lands back where it already was, the event goes away. */
  function updateApplication(id, patch) {
    const app = state.applications.find(a => a.id === id);
    if (!app) return null;

    const before = app.stage;
    Object.assign(app, normalizeApplication({ ...app, ...patch, id: app.id }));

    if (patch.stage && patch.stage !== before) {
      const last = app.events[app.events.length - 1];
      const correcting = last && last.auto && !last.note && last.date === todayISO();
      if (correcting) app.events.pop();

      const current = app.events[app.events.length - 1];
      if (!current || current.stage !== patch.stage) {
        app.events.push({ id: uid('e'), date: todayISO(), stage: patch.stage, note: '', auto: true });
      }
    }
    app.updatedAt = todayISO();
    persist();
    return app;
  }

  function deleteApplication(id) {
    state.applications = state.applications.filter(a => a.id !== id);
    persist();
  }

  function addApplicationEvent(id, { date, stage, note }) {
    const app = state.applications.find(a => a.id === id);
    if (!app) return null;
    const event = {
      id: uid('e'),
      date: String(date || todayISO()).slice(0, 10),
      stage: STAGE_BY_ID[stage] ? stage : app.stage,
      note: String(note || ''),
      auto: false,          // added deliberately, so never rewritten
    };
    app.events.push(event);
    app.events.sort((x, y) => x.date.localeCompare(y.date));
    persist();
    return event;
  }

  function deleteApplicationEvent(appId, eventId) {
    const app = state.applications.find(a => a.id === appId);
    if (!app) return;
    app.events = app.events.filter(e => e.id !== eventId);
    persist();
  }

  /* Reaching an interview is a fact about the timeline, not about where an
     application happens to sit now. */
  const reachedInterview = app =>
    app.stage === 'interview' || app.events.some(e => e.stage === 'interview');

  /* Job boards put the employer in the URL, so pasting a posting link can fill
     in most of an application without asking anything of the network. Nothing
     here makes a request: it is all pattern-matching on the URL itself. */
  const ATS_PATTERNS = [
    { board: 'Greenhouse',      host: /(^|\.)(job-)?boards\.greenhouse\.io$/, slug: p => p[0] },
    { board: 'Lever',           host: /(^|\.)jobs\.lever\.co$/,               slug: p => p[0] },
    { board: 'Ashby',           host: /(^|\.)jobs\.ashbyhq\.com$/,            slug: p => p[0] },
    { board: 'SmartRecruiters', host: /(^|\.)smartrecruiters\.com$/,          slug: p => p[0] },
    { board: 'Workable',        host: /(^|\.)workable\.com$/,                 slug: p => p[0] },
    { board: 'Teamtailor',      host: /(^|\.)teamtailor\.com$/,               slug: () => '' },
    { board: 'LinkedIn',        host: /(^|\.)linkedin\.com$/,                 slug: () => '' },
    { board: 'Indeed',          host: /(^|\.)indeed\.(com|co\.uk)$/,          slug: () => '' },
    { board: 'Glassdoor',       host: /(^|\.)glassdoor\.(com|co\.uk)$/,       slug: () => '' },
  ];

  const titleCase = slug => String(slug || '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

  function parsePosting(rawUrl) {
    const text = String(rawUrl || '').trim();
    if (!text) return null;

    let url;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
    } catch {
      return null;
    }

    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);

    const ats = ATS_PATTERNS.find(a => a.host.test(host));
    if (ats) {
      return { company: titleCase(ats.slug(parts)), source: ats.board, domain: host };
    }

    /* Workday puts the employer in the subdomain: acme.wd3.myworkdayjobs.com */
    if (/myworkdayjobs\.com$/.test(host)) {
      return { company: titleCase(host.split('.')[0]), source: 'Workday', domain: host };
    }

    /* Otherwise it is the employer's own site, so the domain is the company:
       careers.acme.com -> Acme. */
    const labels = host.split('.');
    const generic = new Set(['careers', 'jobs', 'apply', 'work', 'boards', 'join', 'talent']);
    const meaningful = labels.filter(l => !generic.has(l));
    const name = meaningful.length > 1 ? meaningful[meaningful.length - 2] : meaningful[0];

    return { company: titleCase(name), source: 'Company site', domain: host };
  }

  /* Where applications actually went, as flows between stages rather than a
     table of counts. Each application contributes one path through the stages
     it reached, in the order it reached them, which is what makes the shape of
     a search visible at a glance. */
  function applicationFlow() {
    const order = APP_STAGES.map(s => s.id);
    const flows = new Map();
    const totals = new Map();

    state.applications.forEach(app => {
      /* The timeline is the truth; the current stage catches anything that
         never generated an event. */
      const seen = [...new Set([...app.events.map(e => e.stage), app.stage])]
        /* Sorted by the pipeline, not by when anything was written, so a stage
           set by hand cannot produce a ribbon running backwards. */
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));

      seen.forEach(stage => totals.set(stage, (totals.get(stage) || 0) + 1));

      for (let i = 0; i < seen.length - 1; i++) {
        const key = seen[i] + '>' + seen[i + 1];
        flows.set(key, (flows.get(key) || 0) + 1);
      }
    });

    return {
      stages: order
        .map(id => ({ id, label: STAGE_BY_ID[id].label, count: totals.get(id) || 0 }))
        .filter(s => s.count > 0),
      flows: [...flows.entries()]
        .map(([key, count]) => ({ from: key.split('>')[0], to: key.split('>')[1], count }))
        .sort((a, b) => b.count - a.count),
      total: state.applications.length,
    };
  }

  function applicationStats() {
    const all = state.applications;
    const inStage = id => all.filter(a => a.stage === id).length;
    const responded = all.filter(a => a.stage !== 'applied' && a.stage !== 'wishlist').length;
    const sent = all.filter(a => a.stage !== 'wishlist').length;

    return {
      total:     all.length,
      open:      all.filter(a => STAGE_BY_ID[a.stage].open).length,
      offers:    inStage('offer'),
      rejected:  inStage('rejected'),
      interviews: all.filter(reachedInterview).length,
      responseRate: sent ? responded / sent : 0,
      /* Anything with a date that has arrived, or is about to. */
      dueSoon: all.filter(a => a.nextDue && a.nextDue <= shiftDays(todayISO(), 3)
                            && STAGE_BY_ID[a.stage].open)
                  .sort((a, b) => a.nextDue.localeCompare(b.nextDue)),
    };
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
      /* A solve follows the topic it counts towards. */
      problems: state.problems
        .filter(p => {
          const mapped = p.nodeId || nodeForTags(p.tags);
          return (mapped ? priv.has(mapped) : false) === wantPrivate;
        })
        .sort((a, b) => a.solvedAt.localeCompare(b.solvedAt)),
      /* A project follows its own private flag, like a branch does — but a
         public one must not name a private topic in its concepts. */
      projects: state.projects
        .filter(p => !!p.private === wantPrivate)
        .map(p => (wantPrivate ? p
          : { ...p, concepts: p.concepts.filter(c => !priv.has(c.nodeId)) })),
      /* Goals are public: they are about learning, not about anyone. */
      goals: wantPrivate ? [] : state.goals,
      /* A journal entry follows the topic it was written against. */
      /* An entry can only be judged public or private through its topic, so
         one whose topic is missing is never treated as publishable. */
      journal: state.journal.filter(e =>
        byId(e.nodeId) && priv.has(e.nodeId) === wantPrivate),
      /* A reference is only public when both ends are. */
      links: state.links.filter(l =>
        (priv.has(l.from) || priv.has(l.to)) === wantPrivate),
      /* And so is a connection: publishing one would name a private branch
         and say where it is shown, which is the same leak by another route. */
      connections: state.connections.filter(c =>
        (priv.has(c.from) || priv.has(c.to)) === wantPrivate),
      /* Applications only ever exist in the private half. */
      applications: wantPrivate ? state.applications : [],
    };
  }

  function toJSON() {
    const { nodes, sessions, focus, problems, links, connections, journal, goals, projects } = partition(false);
    return JSON.stringify({
      version: state.version, updatedAt: state.updatedAt, profile: state.profile,
      nodes, links, connections, sessions, focus, problems, journal, goals, projects,
      tagMap: state.tagMap, sources: state.sources,
    }, null, 2);
  }

  function toPrivateJSON() {
    const { nodes, sessions, focus, problems, applications, links, connections, journal, projects } = partition(true);
    return JSON.stringify({
      version: state.version, updatedAt: state.updatedAt, private: true,
      nodes, links, connections, sessions, focus, problems, journal, projects, applications,
    }, null, 2);
  }

  const hasPrivateData = () =>
    state.nodes.some(n => isPrivate(n.id)) ||
    state.applications.length > 0 ||
    state.projects.some(p => p.private);

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
    if (!parsed) return 0;
    if (!Array.isArray(parsed.nodes)) parsed.nodes = [];

    /* Every collection is deduplicated by id, or merging the same file twice
       would double the logged time and the checklists. */
    const haveSessions = new Set(state.sessions.map(x => x.id));
    const haveFocus    = new Set(state.focus.map(x => x.id));
    const haveProblems = new Set(state.problems.map(x => x.id));
    const haveApps     = new Set(state.applications.map(x => x.id));
    const haveLinks    = new Set(state.links.map(x => x.id));
    const haveConns    = new Set(state.connections.map(x => x.id));
    const haveJournal  = new Set(state.journal.map(x => x.id));
    const haveGoals    = new Set(state.goals.map(x => x.id));
    const haveProjects = new Set(state.projects.map(x => x.id));

    const merged = normalize({
      version:  state.version,
      profile:  state.profile,
      nodes:    [...state.nodes, ...parsed.nodes.filter(n => !byId(String(n.id)))],
      sessions: [...state.sessions, ...(parsed.sessions || []).filter(x => !haveSessions.has(String(x.id)))],
      focus:    [...state.focus, ...(parsed.focus || []).filter(x => !haveFocus.has(String(x.id)))],
      problems: [...state.problems, ...(parsed.problems || []).filter(x => !haveProblems.has(String(x.id)))],
      applications: [...state.applications, ...(parsed.applications || []).filter(x => !haveApps.has(String(x.id)))],
      links:    [...state.links, ...(parsed.links || []).filter(x => !haveLinks.has(String(x.id)))],
      connections: [...state.connections,
        ...(parsed.connections || []).filter(x => !haveConns.has(String(x.id)))],
      journal:  [...state.journal, ...(parsed.journal || []).filter(x => !haveJournal.has(String(x.id)))],
      goals:    [...state.goals, ...(parsed.goals || []).filter(x => !haveGoals.has(String(x.id)))],
      projects: [...state.projects, ...(parsed.projects || []).filter(x => !haveProjects.has(String(x.id)))],
      tagMap:   { ...(parsed.tagMap || {}), ...state.tagMap },
      sources:  state.sources,
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
    addEntry, updateEntry, deleteEntry, journalFor, obsidianUrl,
    activityOn, activityLevel, localDateOf,
    PROJECT_STATES, projects, addProject, updateProject, deleteProject, projectProgress,
    addMilestone, toggleMilestone, deleteMilestone, linkConcept, unlinkConcept, projectsUsing,
    GOAL_TARGETS, goals, addGoal, updateGoal, deleteGoal,
    addGoalPart, toggleGoalPart, deleteGoalPart, goalProgress, partProgress, daysRemaining,
    PROBLEM_SOURCES, LEVELS, INDEPENDENCE, PROBLEM_STATES, allSources, addSource, sourceLabel,
    problemsToRevisit, scheduleReview, markRevisited,
    addProblem, updateProblem, deleteProblem, deleteProblemsFrom, recordSolve, recordSolves,
    problemsMatching, problemsForNode, problemStats, recentProblems, problemDigest,
    evidenceFor, suggestedStatus,
    tagIndex, setTagMapping, nodeForTags,
    isPrivate, privateNodeIds,
    addLink, updateLink, deleteLink, linksFor, relatedTo, LINK_TYPES, prerequisiteWarnings,
    addConnection, deleteConnection, connectionsFor, connectedInto, canConnect,
    TAG_CATALOGUE, catalogueTags, knownTags,
    APP_STAGES, STAGE_BY_ID, applications, addApplication, updateApplication,
    deleteApplication, addApplicationEvent, deleteApplicationEvent, applicationStats, applicationFlow,
    parsePosting,
    toJSON, toPrivateJSON, hasPrivateData, importJSON, mergeJSON, adoptSeed, resetToSeed,
    todayISO, shiftDays, dayOfWeek, uid,
  };
})();
