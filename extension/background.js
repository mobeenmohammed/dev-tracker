/* ============================================================
   background.js — the poller.

   Codeforces has a real API, so no page is scraped and nothing breaks when the
   site is redesigned. Solves are queued here and handed to the tracker the
   next time it is open, because the tracker has no backend to push to.
   ============================================================ */

import { statusUrl, toSolves, readResponse, newestTimestamp } from './codeforces.js';

const ALARM = 'codeforces-sync';
const PAGE_SIZE = 500;
const MAX_PAGES = 20;          // ~10k submissions is far past any first sync

const DEFAULTS = {
  handle: '',
  intervalMinutes: 60,
  enabled: true,
  lastSyncedAt: 0,      // unix seconds of the newest solve already queued
  lastRunAt: 0,
  lastError: '',
  queue: [],            // solves waiting for the tracker to be opened
  synced: 0,            // how many have made it across, for the options page
};

const readSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(null)) });
const writeSettings = patch => chrome.storage.local.set(patch);

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

async function sync({ manual = false } = {}) {
  const settings = await readSettings();
  if (!settings.handle) {
    await writeSettings({ lastError: 'No Codeforces handle set yet.' });
    return { ok: false, error: 'No Codeforces handle set yet.' };
  }
  if (!settings.enabled && !manual) return { ok: false, error: 'Syncing is paused.' };

  try {
    const submissions = await collectSubmissions(settings.handle, settings.lastSyncedAt);
    const solves = toSolves(submissions, { since: settings.lastSyncedAt });

    /* Anything already queued stays queued; the tracker deduplicates again on
       its own side, so a repeat here is harmless rather than corrupting. */
    const queued = new Map(settings.queue.map(s => [s.problemId, s]));
    solves.forEach(s => queued.set(s.problemId, s));
    const queue = [...queued.values()];

    await writeSettings({
      queue,
      lastSyncedAt: Math.max(settings.lastSyncedAt, newestTimestamp(solves)),
      lastRunAt: Math.floor(Date.now() / 1000),
      lastError: '',
    });
    await updateBadge(queue.length);
    return { ok: true, found: solves.length, queued: queue.length };
  } catch (err) {
    await writeSettings({ lastError: err.message, lastRunAt: Math.floor(Date.now() / 1000) });
    return { ok: false, error: err.message };
  }
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
        const delivered = new Set(msg.problemIds || []);
        const settings = await readSettings();
        const queue = settings.queue.filter(s => !delivered.has(s.problemId));
        await writeSettings({ queue, synced: settings.synced + delivered.size });
        await updateBadge(queue.length);
        respond({ remaining: queue.length });
        break;
      }

      case 'reset-sync':
        await writeSettings({ lastSyncedAt: 0, queue: [], lastError: '' });
        await updateBadge(0);
        respond(await readSettings());
        break;

      default:
        respond({ ok: false, error: 'Unknown message.' });
    }
  })();
  return true;      // an async respond is coming
});
