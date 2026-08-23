/* ============================================================
   leetcode.js — turning LeetCode submissions into solves.

   Pure and free of any Chrome API, so it can be tested outside a browser.

   LeetCode's public GraphQL endpoint needs no account and no key, but it
   answers with a rolling window of roughly the twenty most recent accepted
   submissions — asking for more still returns twenty. That is enough to stay
   current, and is why history from before the extension was installed is not
   available here.

   The submission list carries no tags and no difficulty, so anything new is
   looked up once per problem and cached.
   ============================================================ */

export const API = 'https://leetcode.com/graphql';

/* The server caps this regardless of what is asked for. */
export const WINDOW_SIZE = 20;

export const LEVELS = { Easy: 'easy', Medium: 'medium', Hard: 'hard' };

export function recentQuery(username, limit = WINDOW_SIZE) {
  return {
    query: `query recentAc($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id title titleSlug timestamp
      }
    }`,
    variables: { username: String(username).trim(), limit },
  };
}

export function questionQuery(titleSlug) {
  return {
    query: `query question($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId title difficulty topicTags { name slug }
      }
    }`,
    variables: { titleSlug: String(titleSlug) },
  };
}

/* GraphQL reports failure inside a 200 response, so the body must be read. */
export function readGraphQL(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('LeetCode sent an unreadable response.');
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(payload.errors[0].message || 'LeetCode refused the request.');
  }
  if (!payload.data) throw new Error('LeetCode sent no data.');
  return payload.data;
}

export function readRecent(payload) {
  const data = readGraphQL(payload);
  const list = data.recentAcSubmissionList;
  if (!Array.isArray(list)) throw new Error('No submissions returned — is the username right?');
  return list;
}

/* The calendar date where the person actually is, not in UTC. */
export function localDateFromUnix(seconds) {
  const d = new Date(seconds * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* The list is already accepted submissions only, but a problem can appear more
   than once in the window, and only the first solve counts. */
export function toSolves(submissions, { since = 0 } = {}) {
  const byProblem = new Map();

  (submissions || []).forEach(sub => {
    if (!sub || !sub.titleSlug) return;
    const at = Number(sub.timestamp) || 0;
    if (at <= since) return;

    const existing = byProblem.get(sub.titleSlug);
    if (existing && Number(existing.timestamp) <= at) return;
    byProblem.set(sub.titleSlug, sub);
  });

  return [...byProblem.values()]
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .map(sub => ({
      source:    'leetcode',
      problemId: sub.titleSlug,
      title:     String(sub.title || sub.titleSlug),
      url:       `https://leetcode.com/problems/${sub.titleSlug}/`,
      tags:      [],
      level:     null,
      difficulty: null,
      solvedAt:  localDateFromUnix(Number(sub.timestamp)),
      minutes:   0,
      solvedAtSeconds: Number(sub.timestamp) || 0,
    }));
}

/* Tags and difficulty arrive from a second lookup, one per problem, cached by
   whoever calls this so the same question is never asked twice. */
export function applyQuestion(solve, question) {
  if (!question) return solve;
  return {
    ...solve,
    title: question.title || solve.title,
    level: LEVELS[question.difficulty] || null,
    tags: Array.isArray(question.topicTags)
      ? question.topicTags.map(t => String(t.name || t.slug).toLowerCase())
      : solve.tags,
  };
}

export const newestTimestamp = solves =>
  solves.reduce((max, s) => Math.max(max, s.solvedAtSeconds || 0), 0);
