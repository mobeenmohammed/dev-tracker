/* Options page: settings, a manual sync, and what the poller is holding. */

const $ = id => document.getElementById(id);

const send = message => chrome.runtime.sendMessage(message);

function fmtTime(seconds) {
  if (!seconds) return 'never';
  return new Date(seconds * 1000).toLocaleString();
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + kind;
}

function paint(state) {
  $('handle').value = state.handle || '';
  $('interval').value = state.intervalMinutes || 60;
  $('enabled').checked = state.enabled !== false;

  $('queued').textContent = (state.queue || []).length;
  $('synced').textContent = state.synced || 0;
  $('lastRun').textContent = fmtTime(state.lastRunAt);
  $('lastSolve').textContent = fmtTime(state.lastSyncedAt);

  if (state.lastError) setStatus(state.lastError, 'bad');
}

async function refresh() {
  paint(await send({ type: 'get-state' }));
}

$('save').addEventListener('click', async () => {
  const state = await send({
    type: 'save-settings',
    settings: {
      handle: $('handle').value.trim(),
      intervalMinutes: Math.max(15, Number($('interval').value) || 60),
      enabled: $('enabled').checked,
    },
  });
  paint(state);
  if (!state.lastError) setStatus('Saved.', 'good');
});

$('syncNow').addEventListener('click', async () => {
  setStatus('Checking Codeforces…');
  const result = await send({ type: 'sync-now' });
  if (result.ok) {
    setStatus(result.found
      ? `Found ${result.found} new solve${result.found === 1 ? '' : 's'}.`
      : 'Nothing new.', 'good');
  } else {
    setStatus(result.error, 'bad');
  }
  await refresh();
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Forget the sync position? The next check will read your whole history again.')) return;
  paint(await send({ type: 'reset-sync' }));
  setStatus('Sync position cleared.', 'good');
});

refresh();
