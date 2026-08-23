/* ============================================================
   projecteuler.js — a button on the problem page.

   Project Euler cannot be polled, so this is the one place the extension
   touches a page. It deliberately does not try to be clever: detecting a
   correct answer is attempted, but the button is always there and always
   works, so a redesign costs you a click rather than your data.
   ============================================================ */

(() => {
  const BUTTON_ID = 'dev-tracker-log';

  const number = Euler.problemNumber(location.href);
  if (!number) return;                       // not a problem page

  function toast(text, good = true) {
    const existing = document.getElementById(BUTTON_ID + '-toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = BUTTON_ID + '-toast';
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed', right: '16px', bottom: '68px', zIndex: 2147483647,
      background: good ? '#34d399' : '#f2545b', color: '#0d1117',
      font: '500 13px/1.4 system-ui, sans-serif', padding: '8px 12px',
      borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,.35)',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function logSolve() {
    const solve = Euler.solveFor(location.href, document);
    if (!solve) return;

    try {
      const result = await chrome.runtime.sendMessage({ type: 'log-solve', solve });
      if (result && result.ok) {
        toast(result.already
          ? `Problem ${number} was already recorded.`
          : `Problem ${number} queued for the tracker.`);
      } else {
        toast('Could not reach the extension.', false);
      }
    } catch {
      toast('Could not reach the extension.', false);
    }
  }

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = `Log problem ${number}`;
  button.title = 'Record this problem as solved in your Dev Tracker';
  Object.assign(button.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647,
    background: '#4f9dff', color: '#fff', border: '0', borderRadius: '8px',
    font: '500 13px/1 system-ui, sans-serif', padding: '10px 14px',
    cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.35)',
  });
  button.addEventListener('click', logSolve);
  document.body.appendChild(button);

  /* If the page happens to say the answer was right, say so on the button —
     but never act without being asked. */
  if (Euler.looksSolved(document.body.innerText)) {
    button.textContent = `Solved — log problem ${number}`;
    button.style.background = '#34d399';
    button.style.color = '#0d1117';
  }
})();
