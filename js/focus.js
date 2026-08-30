/* ============================================================
   focus.js — the stopwatch.

   A timer you set counts down whether or not you are at the desk. This counts
   up while you are, pauses when something takes you away, and logs what
   actually happened. Being interrupted is recorded rather than hidden: how
   often you were pulled away is the part worth knowing.

   Nothing is stored here. This draws the store's stopwatch and asks the store
   to change it, so a reload picks a session back up mid-flight.
   ============================================================ */

const Focus = (() => {

  let onChanged = () => {};
  let onNavigate = () => {};
  let ticker = null;
  let returnFocusTo = null;     // what had the keyboard before the screen took it
  let baseTitle = document.title;

  /* ---------------- formatting ---------------- */

  /* h:mm:ss once there is an hour to show, m:ss before that — the shape of a
     stopwatch rather than of a duration. */
  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function awayText(timer, pausedMs) {
    if (!timer.interruptions) return '';
    const away = Math.round(pausedMs / 60000);
    return `Pulled away ${plural(timer.interruptions, 'time')}` +
           (away ? ` · ${away}m of it` : '');
  }

  /* ---------------- the screen ---------------- */

  const $ = id => document.getElementById(id);
  const isOpen = () => !$('focusScreen').hidden;
  const running = () => {
    const t = Store.activeFocus();
    return !!t && t.startedAt != null;
  };

  function open(nodeId) {
    const timer = Store.activeFocus();

    if (!timer) {
      if (!Store.startFocus(nodeId)) return false;
    } else if (nodeId && timer.nodeId !== nodeId) {
      /* Something is already being timed. Switching would quietly throw away
         what is on the clock, so it is asked for rather than assumed. */
      const current = Store.byId(timer.nodeId);
      const next = Store.byId(nodeId);
      const ok = window.confirm(
        `You are timing ${current ? current.name : 'another topic'}.\n\n` +
        `Stop that and log ${clock(Store.focusElapsedMs())}, then start on ` +
        `${next ? next.name : 'this topic'}?`);
      if (!ok) { show(); return true; }
      stop({ quiet: true });
      if (!Store.startFocus(nodeId)) return false;
    }

    show();
    const intent = $('focusIntent');
    intent.value = (Store.activeFocus() || {}).intent || '';
    if (!intent.value) intent.focus();
    onChanged();
    return true;
  }

  function show() {
    const screen = $('focusScreen');
    if (screen.hidden && !screen.contains(document.activeElement)) {
      returnFocusTo = document.activeElement;
    }
    screen.hidden = false;
    render();
    startTicking();
  }

  /* Closing the screen is not stopping the clock: the pill in the header is
     how you get back to it, and the tab title keeps counting.

     Focus has to come back out with it. Left inside a panel that is now
     display:none, every keyboard shortcut in the app reads as "they are
     typing" and does nothing until something is clicked. */
  function close() {
    const screen = $('focusScreen');
    const inside = screen.contains(document.activeElement);
    screen.hidden = true;
    if (inside) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (returnFocusTo && document.contains(returnFocusTo) && returnFocusTo.focus) {
        returnFocusTo.focus();
      }
    }
    returnFocusTo = null;
    render();
  }

  function render() {
    const timer = Store.activeFocus();
    const screen = $('focusScreen');

    if (!timer) {
      screen.hidden = true;
      stopTicking();
      $('focusPill').hidden = true;
      document.title = baseTitle;
      return;
    }

    const node = Store.byId(timer.nodeId);
    const elapsed = Store.focusElapsedMs();
    const live = timer.startedAt != null;

    /* The pill is the way back in from anywhere, so it is hidden only while
       the screen it leads to is already up. */
    const pill = $('focusPill');
    pill.hidden = isOpen();
    pill.className = 'focus-pill' + (live ? ' is-running' : ' is-paused');
    pill.textContent = `${live ? '\u25CF' : '\u23F8'} ${clock(elapsed)}`;
    pill.title = `${live ? 'Focusing on' : 'Paused on'} ${node ? node.name : 'a topic'}` +
                 ' — click to go back to it';

    /* Whatever is in front, the tab says what is happening, so a stopwatch is
       never left running out of sight. */
    document.title = `${live ? '\u25CF' : '\u23F8'} ${clock(elapsed)} · ${node ? node.name : ''}`;

    if (screen.hidden) return;
    paint(timer, node, elapsed, live);
  }

  function paint(timer, node, elapsed, live) {
    $('focusTopic').textContent = node ? node.name : 'a topic that is gone';
    const field = node ? Store.domainOf(node.id) : null;
    $('focusWhere').textContent = field && field.id !== timer.nodeId ? `in ${field.name}` : '';

    $('focusElapsed').textContent = clock(elapsed);
    $('focusElapsed').classList.toggle('is-paused', !live);
    $('focusState').textContent = live ? 'running' : 'paused';

    const notice = $('focusNotice');
    notice.hidden = !timer.abandoned;
    if (timer.abandoned) {
      notice.textContent = 'This was still running when you came back, so the ' +
        'stretch since you left has not been counted. Carry on when you are ready.';
    }

    $('focusAway').textContent = awayText(timer, Store.focusPausedMs());

    const toggleBtn = $('focusToggle');
    toggleBtn.textContent = live ? 'Pause' : (elapsed ? 'Resume' : 'Start');
    toggleBtn.title = live ? 'Something came up (Space)' : 'Back to it (Space)';

    const minutes = Math.round(elapsed / 60000);
    $('focusStop').disabled = minutes < 1;
    $('focusStop').title = minutes < 1
      ? 'Nothing to log yet — a session rounds to the nearest minute'
      : `Log ${minutes} minute${minutes === 1 ? '' : 's'} against this topic`;

    renderTotals(node);
  }

  /* Somewhere to see it adding up, which is the point of logging it at all. */
  function renderTotals(node) {
    const box = $('focusTotals');
    if (!node) { box.replaceChildren(); return; }

    const today = Store.activityOn(Store.todayISO()).minutes;
    const onTopic = Store.minutesFor(node.id, true);
    const stat = (label, value) =>
      `<div><span class="ft-value">${value}</span><span class="ft-label">${label}</span></div>`;

    box.innerHTML =
      stat('logged today', Views.formatHours(today)) +
      stat('on this topic', Views.formatHours(onTopic));
  }

  /* ---------------- the clock ---------------- */

  /* One interval for the whole app, running only while there is something to
     show, and redrawing the clock rather than the page. */
  function startTicking() {
    if (ticker) return;
    ticker = setInterval(() => {
      if (!Store.activeFocus()) { stopTicking(); render(); return; }
      render();
    }, 1000);
  }

  function stopTicking() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
  }

  /* ---------------- what the buttons do ---------------- */

  function toggle() {
    const timer = Store.activeFocus();
    if (!timer) return;
    if (timer.startedAt != null) Store.pauseFocus();
    else Store.resumeFocus();
    render();
  }

  function stop({ quiet = false } = {}) {
    if (!Store.activeFocus()) return null;

    Store.setFocusIntent($('focusIntent').value);
    const done = Store.stopFocus();
    close();
    stopTicking();
    render();
    onChanged(done, { quiet });
    return done;
  }

  function discard() {
    if (!Store.activeFocus()) return false;
    const elapsed = Store.focusElapsedMs();
    if (Math.round(elapsed / 60000) >= 1 &&
        !window.confirm(`Throw away ${clock(elapsed)} without logging it?`)) return false;
    Store.discardFocus();
    close();
    stopTicking();
    render();
    onChanged();
    return true;
  }

  /* ---------------- wiring ---------------- */

  function init(opts = {}) {
    onChanged = opts.onChanged || onChanged;
    onNavigate = opts.onNavigate || onNavigate;
    baseTitle = document.title;

    $('focusToggle').addEventListener('click', toggle);
    $('focusStop').addEventListener('click', () => stop());
    $('focusDiscard').addEventListener('click', discard);
    $('focusClose').addEventListener('click', close);
    $('focusPill').addEventListener('click', () => {
      const timer = Store.activeFocus();
      if (!timer) return;
      show();
      onNavigate(timer.nodeId);
      render();
    });

    /* Saved as it is typed, so a reload mid-session does not lose the note. */
    let typing;
    $('focusIntent').addEventListener('input', () => {
      clearTimeout(typing);
      const value = $('focusIntent').value;
      typing = setTimeout(() => Store.setFocusIntent(value), 400);
    });
    $('focusIntent').addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Escape') {
        ev.preventDefault();
        $('focusIntent').blur();
      }
    });

    /* Clicking the backdrop leaves it running, as the close button does. */
    $('focusScreen').addEventListener('click', ev => {
      if (ev.target === $('focusScreen')) close();
    });

    document.addEventListener('keydown', ev => {
      if (!isOpen()) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
      if (ev.key === ' ')      { ev.preventDefault(); ev.stopPropagation(); toggle(); }
    }, true);

    /* A session that was already running when the page loaded. */
    if (Store.activeFocus()) { startTicking(); render(); }
  }

  return {
    init, open, close, render, clock,
    get isOpen()    { return isOpen(); },
    get isRunning() { return running(); },
  };
})();
