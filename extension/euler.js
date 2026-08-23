/* ============================================================
   euler.js — reading a Project Euler problem page.

   Project Euler has no API, and solved status exists only behind your login,
   so this is the one source that has to read the page. It is written to lean
   on the URL, which is stable, rather than on markup, which is not: the
   problem number always comes from `?problem=N`, and everything else degrades
   to something usable if the page is redesigned.

   A classic script rather than a module, because content scripts are not
   modules; the parsing lives here so it can be tested outside a browser.
   ============================================================ */

const Euler = {
  /* https://projecteuler.net/problem=42 -> "42" */
  problemNumber(href) {
    const match = String(href || '').match(/[?&]?problem=(\d+)/);
    return match ? match[1] : null;
  },

  /* The heading is the nice answer; the document title is the fallback; the
     problem number always works. */
  problemTitle(doc, number) {
    const heading = doc && doc.querySelector('h2');
    const fromHeading = heading && heading.textContent.trim();
    if (fromHeading) return fromHeading;

    const title = (doc && doc.title) || '';
    const cleaned = title.replace(/\s*[-|]\s*Project Euler\s*$/i, '').trim();
    if (cleaned && !/^project euler$/i.test(cleaned)) return cleaned;

    return `Problem ${number}`;
  },

  /* Best effort only: the button never depends on this being right. */
  looksSolved(text) {
    return /congratulations[\s\S]{0,120}correct/i.test(String(text || ''));
  },

  solveFor(href, doc, { solvedAt } = {}) {
    const number = Euler.problemNumber(href);
    if (!number) return null;
    return {
      source: 'projecteuler',
      problemId: number,
      title: Euler.problemTitle(doc, number),
      url: `https://projecteuler.net/problem=${number}`,
      tags: [],
      difficulty: null,
      level: null,
      solvedAt: solvedAt || Euler.today(),
      minutes: 0,
      solvedAtSeconds: Math.floor(Date.now() / 1000),
    };
  },

  today() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
};

/* Available to the tests, harmless in the browser. */
if (typeof module !== 'undefined') module.exports = Euler;
