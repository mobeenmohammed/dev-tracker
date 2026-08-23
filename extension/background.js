/* ============================================================
   background.js — the poller.

   Codeforces has a real API, so no page is scraped and nothing breaks when the
   site is redesigned. Solves are queued here and handed to the tracker the
   next time it is open, because the tracker has no backend to push to.
   ============================================================ */

import { statusUrl, toSolves, readResponse, newestTimestamp } from './codeforces.js';
import * as LeetCode from './leetcode.js';

const ALARM = 'codeforces-sync';
const PAGE_SIZE = 500;
const MAX_PAGES = 20;          // ~10k submissions is far past any first sync

const DEFAULTS = {
  handle: '',           // Codeforces
  lcHandle: '',         // LeetCode
  intervalMinutes: 60,
  enabled: true,
  lastSyncedAt: 0,      // unix seconds of the newest Codeforces solve already queued
  lcLastSyncedAt: 0,    // the same watermark for LeetCode
  lcStarted: false,     // whether the LeetCode watermark has been set yet
  lastRunAt: 0,
  lastError: '',
  notify: true,         // a desktop notification when new solves are found
  queue: [],            // solves waiting for the tracker to be opened
  synced: 0,            // how many have made it across, for the options page
  questionCache: {},    // titleSlug -> tags and level, so each is looked up once
  digest: {},           // source:problemId -> what the tracker knows about it
  digestAt: '',         // when the tracker last shared it
  widgetCollapsed: false,
};

const readSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(null)) });
const writeSettings = patch => chrome.storage.local.set(patch);

/* A solve is worth knowing about when it lands, not only when the tracker is
   next opened — the badge alone is easy to miss. */
async function notifySolves(solves) {
  if (!solves.length) return;
  const { notify } = await readSettings();
  if (notify === false) return;

  const first = solves[0];
  const others = solves.length - 1;
  const title = solves.length === 1 ? 'Solve recorded' : `${solves.length} solves recorded`;
  const message = solves.length === 1
    ? `${first.title}${first.tags.length ? ' — ' + first.tags.slice(0, 3).join(', ') : ''}`
    : `${first.title} and ${others} more`;

  try {
    await chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'icon.png',
      title,
      message,
      contextMessage: 'Open the tracker to store them',
      silent: true,
    });
  } catch {
    /* Notifications can be switched off at the OS level; that is not an error
       worth failing a sync over. */
  }
}

async function updateBadge(queueLength) {
  await chrome.action.setBadgeText({ text: queueLength ? String(queueLength) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#4f9dff' });
}

/* ---------------- syncing ---------------- */

async function fetchPage(handle, from) {
  const res = await fetch(statusUrl(handle, { from, count: PAGE_SIZE }));
  if (res.status === 403 || res.status === 429) {
    throw new Error('Codeforces is rate-limiting us. It will try again next time.');
  }
  if (!res.ok) throw new Error(`Codeforces replied ${res.status}.`);
  return readResponse(await res.json());
}

/* Walks back through submissions until it reaches ones already seen. The API
   returns newest first, so an incremental run stops after a single page. */
async function collectSubmissions(handle, since) {
  const all = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(handle, page * PAGE_SIZE + 1);
    all.push(...batch);

    if (batch.length < PAGE_SIZE) break;                       // reached the end
    const oldest = batch[batch.length - 1].creationTimeSeconds;
    if (since && oldest <= since) break;                        // reached known ground
  }
  return all;
}

/* ---------------- LeetCode ---------------- */

async function graphql(body) {
  const res = await fetch(LeetCode.API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error('LeetCode is rate-limiting us. It will try again next time.');
  if (!res.ok) throw new Error(`LeetCode replied ${res.status}.`);
  return res.json();
}

/* The submission list carries no tags or difficulty, so each new problem is
   looked up once and remembered. */
async function enrich(solves, cache) {
  const out = [];
  for (const solve of solves) {
    let question = cache[solve.problemId];
    if (!question) {
      try {
        const data = LeetCode.readGraphQL(await graphql(LeetCode.questionQuery(solve.problemId)));
        question = data.question || null;
        if (question) cache[solve.problemId] = question;
      } catch {
        question = null;         // a missing lookup is not worth losing the solve over
      }
      await new Promise(r => setTimeout(r, 350));   // be a polite guest
    }
    out.push(LeetCode.applyQuestion(solve, question));
  }
  return out;
}

/* Nothing solved before the extension was installed is available anyway, so
   the first run records where we are and imports nothing. `backfill` overrides
   that for someone who does want the visible window. */
async function syncLeetCode(settings, { backfill = false } = {}) {
  if (!settings.lcHandle) return { solves: [], watermark: settings.lcLastSyncedAt, started: settings.lcStarted };

  const payload = await graphql(LeetCode.recentQuery(settings.lcHandle));
  const submissions = LeetCode.readRecent(payload);
  const newest = submissions.reduce((max, s) => Math.max(max, Number(s.timestamp) || 0), 0);

  if (!settings.lcStarted && !backfill) {
    return { solves: [], watermark: newest, started: true };
  }

  const since = backfill ? 0 : settings.lcLastSyncedAt;
  const fresh = LeetCode.toSolves(submissions, { since });
  const cache = { ...settings.questionCache };
  const enriched = await enrich(fresh, cache);

  return {
    solves: enriched,
    watermark: Math.max(settings.lcLastSyncedAt, newest),
    started: true,
    cache,
  };
}

async function sync({ manual = false, backfill = false } = {}) {
  const settings = await readSettings();
  if (!settings.handle && !settings.lcHandle) {
    const error = 'No Codeforces or LeetCode username set yet.';
    await writeSettings({ lastError: error });
    return { ok: false, error };
  }
  if (!settings.enabled && !manual) return { ok: false, error: 'Syncing is paused.' };

  const patch = { lastRunAt: Math.floor(Date.now() / 1000) };
  const found = [];
  const problems = [];

  /* One source failing must not stop the other, so each is tried on its own
     and whatever went wrong is reported rather than thrown away. */
  if (settings.handle) {
    try {
      const submissions = await collectSubmissions(settings.handle, settings.lastSyncedAt);
      const solves = toSolves(submissions, { since: settings.lastSyncedAt });
      patch.lastSyncedAt = Math.max(settings.lastSyncedAt, newestTimestamp(solves));
      found.push(...solves);
    } catch (err) {
      problems.push('Codeforces: ' + err.message);
    }
  }

  if (settings.lcHandle) {
    try {
      const result = await syncLeetCode(settings, { backfill });
      patch.lcLastSyncedAt = result.watermark;
      patch.lcStarted = result.started;
      if (result.cache) patch.questionCache = result.cache;
      found.push(...result.solves);
    } catch (err) {
      problems.push('LeetCode: ' + err.message);
    }
  }

  /* Anything already queued stays queued; the tracker deduplicates again on
     its own side, so a repeat here is harmless rather than corrupting. */
  const queued = new Map(settings.queue.map(s => [s.source + ':' + s.problemId, s]));
  found.forEach(s => queued.set(s.source + ':' + s.problemId, s));
  const queue = [...queued.values()];

  patch.queue = queue;
  patch.lastError = problems.join(' · ');
  await writeSettings(patch);
  await updateBadge(queue.length);
  await notifySolves(found);

  if (problems.length && !found.length) return { ok: false, error: patch.lastError };
  return { ok: true, found: found.length, queued: queue.length, warning: patch.lastError };
}

/* ---------------- scheduling ---------------- */

async function rescheduleAlarm() {
  const { intervalMinutes, enabled } = await readSettings();
  await chrome.alarms.clear(ALARM);
  if (!enabled) return;
  chrome.alarms.create(ALARM, {
    periodInMinutes: Math.max(15, Number(intervalMinutes) || 60),
    delayInMinutes: 1,
  });
}

chrome.runtime.onInstalled.addListener(rescheduleAlarm);
chrome.runtime.onStartup.addListener(rescheduleAlarm);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) sync(); });

/* ---------------- talking to the options page and the tracker ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    switch (msg && msg.type) {
      case 'sync-now':
        respond(await sync({ manual: true }));
        break;

      /* Deliberately pulls the visible LeetCode window, for someone who wants
         the twenty most recent rather than a clean start. */
      case 'backfill-leetcode':
        respond(await sync({ manual: true, backfill: true }));
        break;

      /* Pages hand solves in directly: Project Euler because it cannot be
         polled, and the widget because it captures how a solve went while it
         is still fresh. */
      case 'log-solve': {
        const solve = msg.solve;
        if (!solve || !solve.problemId) { respond({ ok: false }); break; }

        const extra = msg.extra || {};
        const enriched = { ...solve };
        if (extra.reviewInDays) enriched.reviewInDays = extra.reviewInDays;
        if (extra.revisit) enriched.revisit = true;

        const settings = await readSettings();
        const key = enriched.source + ':' + enriched.problemId;
        const at = settings.queue.findIndex(s => s.source + ':' + s.problemId === key);

        /* Saying more about a solve already queued should refine it rather
           than being dropped as a duplicate. */
        const queue = [...settings.queue];
        const already = at >= 0;
        if (already) queue[at] = { ...queue[at], ...enriched };
        else queue.push(enriched);

        await writeSettings({ queue });
        await updateBadge(queue.length);
        if (!already) await notifySolves([enriched]);
        respond({ ok: true, already });
        break;
      }

      /* The tracker shares what it knows so a problem page can show it. */
      case 'save-digest': {
        const digest = {};
        (msg.problems || []).forEach(p => {
          if (p && p.source && p.problemId) {
            digest[p.source + ':' + String(p.problemId).toLowerCase()] = p;
          }
        });
        await writeSettings({ digest, digestAt: new Date().toISOString() });
        respond({ ok: true, count: Object.keys(digest).length });
        break;
      }

      case 'lookup-problem': {
        const settings = await readSettings();
        const id = msg.key ? msg.key.source + ':' + String(msg.key.problemId).toLowerCase() : '';
        respond({
          record: settings.digest[id] || null,
          syncedAt: settings.digestAt,
          collapsed: settings.widgetCollapsed,
        });
        break;
      }

      case 'get-state':
        respond(await readSettings());
        break;

      case 'save-settings':
        await writeSettings(msg.settings || {});
        await rescheduleAlarm();
        respond(await readSettings());
        break;

      /* The bridge asks for whatever is waiting whenever the tracker opens. */
      case 'take-queue': {
        const { queue } = await readSettings();
        respond({ queue });
        break;
      }

      /* Only what the tracker confirms it stored is dropped from the queue, so
         a page that closes mid-handover loses nothing. */
      case 'queue-delivered': {
        const settings = await readSettings();

        /* Source-qualified names where the tracker sends them, since two sites
           can number a problem the same way; the bare list is only used by an
           older tracker that does not send the qualified one. */
        const qualified = Array.isArray(msg.keys) ? new Set(msg.keys) : null;
        const bare = new Set(msg.problemIds || []);
        const wasDelivered = s => (qualified
          ? qualified.has(s.source + ':' + s.problemId)
          : bare.has(s.problemId));

        const delivered = settings.queue.filter(wasDelivered);
        const queue = settings.queue.filter(s => !wasDelivered(s));
        await writeSettings({ queue, synced: settings.synced + delivered.length });
        await updateBadge(queue.length);
        respond({ remaining: queue.length });
        break;
      }

      case 'reset-sync':
        await writeSettings({ lastSyncedAt: 0, lcLastSyncedAt: 0, lcStarted: false, queue: [], lastError: '' });
        await updateBadge(0);
        respond(await readSettings());
        break;

      default:
        respond({ ok: false, error: 'Unknown message.' });
    }
  })();
  return true;      // an async respond is coming
});
