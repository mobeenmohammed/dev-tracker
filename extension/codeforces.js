/* ============================================================
   codeforces.js — turning Codeforces submissions into solves.

   Deliberately pure and free of any Chrome API, so the part most likely to be
   wrong can be tested outside a browser.

   The public API needs no key and no account:
     https://codeforces.com/api/user.status?handle=<handle>&from=1&count=500
   It returns submissions newest first. Codeforces asks for at most one request
   every two seconds, which is far more than a poller needs.
   ============================================================ */

export const API = 'https://codeforces.com/api/user.status';

/* Codeforces returns 403 when called too often, so requests are spaced out. */
export const MIN_REQUEST_GAP_MS = 2100;

export function statusUrl(handle, { from = 1, count = 500 } = {}) {
  const params = new URLSearchParams({ handle: String(handle).trim(), from: String(from), count: String(count) });
  return `${API}?${params}`;
}

/* "1234" + "A" -> "1234A". Problems outside a contest have no contestId, so
   the index alone identifies them. */
export function problemId(problem) {
  if (!problem) return '';
  const index = String(problem.index || '').trim();
  return problem.contestId ? `${problem.contestId}${index}` : index || String(problem.name || '').trim();
}

export function problemUrl(problem) {
  if (!problem || !problem.contestId) return '';
  return `https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`;
}

/* The calendar date the solve happened on where the person actually is, not
   in UTC, so an evening solve is not filed under tomorrow. */
export function localDateFromUnix(seconds, now = date => date) {
  const d = now(new Date(seconds * 1000));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* Accepted submissions only, one entry per problem, keeping the earliest
   accepted attempt — re-solving something later does not make it new. */
export function toSolves(submissions, { since = 0 } = {}) {
  const byProblem = new Map();

  (submissions || []).forEach(sub => {
    if (!sub || sub.verdict !== 'OK') return;
    if (sub.creationTimeSeconds <= since) return;
    /* Practice, contest and virtual submissions all count; a gym problem
       without a name does not. */
    const id = problemId(sub.problem);
    if (!id) return;

    const existing = byProblem.get(id);
    if (existing && existing.creationTimeSeconds <= sub.creationTimeSeconds) return;
    byProblem.set(id, sub);
  });

  return [...byProblem.values()]
    .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds)
    .map(sub => ({
      source:     'codeforces',
      problemId:  problemId(sub.problem),
      title:      String(sub.problem.name || problemId(sub.problem)),
      url:        problemUrl(sub.problem),
      tags:       Array.isArray(sub.problem.tags) ? sub.problem.tags.slice() : [],
      difficulty: Number(sub.problem.rating) || null,
      solvedAt:   localDateFromUnix(sub.creationTimeSeconds),
      /* The API knows when it was submitted, not how long it took. */
      minutes:    0,
      solvedAtSeconds: sub.creationTimeSeconds,
    }));
}

/* The API answers with its own status field, so an HTTP 200 is not enough. */
export function readResponse(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Codeforces sent an unreadable response.');
  if (payload.status !== 'OK') {
    throw new Error(payload.comment || 'Codeforces refused the request.');
  }
  if (!Array.isArray(payload.result)) throw new Error('Codeforces sent no submissions.');
  return payload.result;
}

export const newestTimestamp = solves =>
  solves.reduce((max, s) => Math.max(max, s.solvedAtSeconds || 0), 0);
