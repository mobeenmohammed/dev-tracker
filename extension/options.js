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
  $('lcHandle').value = state.lcHandle || '';
  $('interval').value = state.intervalMinutes || 60;
  $('enabled').checked = state.enabled !== false;
  $('notify').checked = state.notify !== false;

  $('queued').textContent = (state.queue || []).length;
  $('synced').textContent = state.synced || 0;
  $('lastRun').textContent = fmtTime(state.lastRunAt);
  $('lastSolve').textContent = fmtTime(state.lastSyncedAt);
  $('lcLastSolve').textContent = state.lcStarted ? fmtTime(state.lcLastSyncedAt) : 'not started';

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
      lcHandle: $('lcHandle').value.trim().replace(/^@/, ''),
      intervalMinutes: Math.max(15, Number($('interval').value) || 60),
      enabled: $('enabled').checked,
      notify: $('notify').checked,
    },
  });
  paint(state);
  if (!state.lastError) setStatus('Saved.', 'good');
});

$('syncNow').addEventListener('click', async () => {
  setStatus('Checking Codeforces…');
  const result = await send({ type: 'sync-now' });
  if (result.ok) {
    const summary = result.found
      ? `Found ${result.found} new solve${result.found === 1 ? '' : 's'}.`
      : 'Nothing new.';
    setStatus(result.warning ? `${summary} (${result.warning})` : summary,
              result.warning ? 'bad' : 'good');
  } else {
    setStatus(result.error, 'bad');
  }
  await refresh();
});

$('backfill').addEventListener('click', async () => {
  setStatus('Reading your recent LeetCode solves…');
  const result = await send({ type: 'backfill-leetcode' });
  setStatus(result.ok
    ? `Pulled ${result.found} solve${result.found === 1 ? '' : 's'} from the visible window.`
    : result.error, result.ok ? 'good' : 'bad');
  await refresh();
});

$('reset').addEventListener('click', async () => {
  const warning = [
    'Reset the sync position?',
    'Nothing is deleted from the tracker.',
    'The next check reads your Codeforces history from the start again,',
    'and LeetCode begins from now.',
  ].join(' ');
  if (!confirm(warning)) return;
  paint(await send({ type: 'reset-sync' }));
  setStatus('Sync position cleared.', 'good');
});

refresh();
