/* ============================================================
   bridge.js — hands queued solves to the tracker page.

   A content script runs in an isolated world and cannot see the page's own
   window.DevTracker, so the handover goes through postMessage: this script
   offers the solves, the page stores them and acknowledges, and only then is
   the queue cleared.
   ============================================================ */

const OFFER = 'dev-tracker/solves';
const ACK   = 'dev-tracker/solves-ack';

/* The page answers on the same window, so anything from elsewhere is ignored. */
function waitForAck(timeoutMs = 4000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== ACK) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data);
    }
    window.addEventListener('message', onMessage);
  });
}

async function handover() {
  let queue = [];
  try {
    ({ queue = [] } = await chrome.runtime.sendMessage({ type: 'take-queue' }) || {});
  } catch {
    return;                       // the service worker is asleep or reloading
  }
  if (!queue.length) return;

  const ack = waitForAck();
  window.postMessage({ type: OFFER, solves: queue }, window.location.origin);
  const result = await ack;

  /* No answer means an older tracker without the bridge, or a page that closed
     mid-handover. The queue is left alone and offered again next time. */
  if (!result || !Array.isArray(result.problemIds)) return;

  await chrome.runtime.sendMessage({ type: 'queue-delivered', problemIds: result.problemIds });
}

/* The tracker also offers a digest of what it knows, so a problem page can
   show your history with the problem in front of you. */
function listenForDigest() {
  window.addEventListener('message', async event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'dev-tracker/digest' || !Array.isArray(data.problems)) return;
    try {
      await chrome.runtime.sendMessage({ type: 'save-digest', problems: data.problems });
    } catch { /* the worker is asleep; the tracker offers it again next time */ }
  });
}

listenForDigest();

/* The page defines its bridge as it boots, so wait for the load to settle. */
if (document.readyState === 'complete') handover();
else window.addEventListener('load', () => setTimeout(handover, 300));
