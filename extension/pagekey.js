/* ============================================================
   pagekey.js — working out which problem a page is showing.

   Everything here comes from the URL, never the markup, so a redesign of
   either site cannot break it. A classic script rather than a module, because
   content scripts are not modules; kept separate so it can be tested outside
   a browser.
   ============================================================ */

const PageKey = {
  /* The identity used by the tracker: source plus the id it stores. */
  forUrl(href) {
    const raw = String(href || '');
    let url;
    try { url = new URL(raw); } catch { return null; }

    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);

    /* leetcode.com/problems/two-sum/ — the slug is what the tracker stores. */
    if (host.endsWith('leetcode.com')) {
      const at = parts.indexOf('problems');
      const slug = at >= 0 ? parts[at + 1] : null;
      return slug ? { source: 'leetcode', problemId: slug, label: PageKey.titleFromSlug(slug) } : null;
    }

    if (host.endsWith('codeforces.com')) {
      /* /contest/1234/problem/A, /gym/1234/problem/A and
         /problemset/problem/1234/A all name the same thing differently. */
      const contestAt = parts.findIndex(p => p === 'contest' || p === 'gym');
      if (contestAt >= 0 && parts[contestAt + 2] === 'problem' && parts[contestAt + 3]) {
        return PageKey.codeforces(parts[contestAt + 1], parts[contestAt + 3]);
      }
      const setAt = parts.indexOf('problemset');
      if (setAt >= 0 && parts[setAt + 1] === 'problem' && parts[setAt + 2] && parts[setAt + 3]) {
        return PageKey.codeforces(parts[setAt + 2], parts[setAt + 3]);
      }
      return null;
    }

    /* projecteuler.net/problem=42 */
    if (host.endsWith('projecteuler.net')) {
      const match = raw.match(/[?&]?problem=(\d+)/);
      return match ? { source: 'projecteuler', problemId: match[1], label: 'Problem ' + match[1] } : null;
    }

    return null;
  },

  codeforces(contestId, index) {
    if (!/^\d+$/.test(String(contestId))) return null;
    const id = String(contestId) + String(index).toUpperCase();
    return { source: 'codeforces', problemId: id, label: id };
  },

  /* "reverse-linked-list" -> "Reverse Linked List", for showing before the
     tracker has told us the real title. */
  titleFromSlug(slug) {
    return String(slug).split('-').filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  },

  /* The tracker's digest is keyed the same way on both sides. */
  digestKey(key) {
    return key ? `${key.source}:${String(key.problemId).toLowerCase()}` : '';
  },
};

if (typeof module !== 'undefined') module.exports = PageKey;
