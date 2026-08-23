/* Tests for the Codeforces mapping. Pure logic, no browser and no network:
   run with  node tests/extension.test.mjs  */

import { toSolves, problemId, problemUrl, localDateFromUnix, readResponse, newestTimestamp }
  from '../extension/codeforces.js';

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`));
}

/* Shaped exactly like the live API response. */
const sub = (over = {}) => ({
  id: over.id ?? 1,
  creationTimeSeconds: over.at ?? 1_784_221_884,
  verdict: over.verdict ?? 'OK',
  programmingLanguage: 'GNU C++20',
  problem: {
    contestId: over.contestId ?? 2245,
    index: over.index ?? 'G',
    name: over.name ?? 'NPC Challenge',
    type: 'PROGRAMMING',
    rating: over.rating ?? 3000,
    tags: over.tags ?? ['divide and conquer', 'interactive'],
  },
});

/* --- identity --- */
check('problem id joins contest and index', problemId({ contestId: 1234, index: 'A' }), '1234A');
check('a problem outside a contest uses its index', problemId({ index: 'ACMSGURU-101' }), 'ACMSGURU-101');
check('and falls back to its name', problemId({ name: 'Some Problem' }), 'Some Problem');
check('no problem, no id', problemId(null), '');
check('problem url', problemUrl({ contestId: 1234, index: 'A' }),
      'https://codeforces.com/contest/1234/problem/A');
check('no url without a contest', problemUrl({ index: 'A' }), '');

/* --- dates: midday UTC lands on the same calendar day in any sane timezone --- */
check('unix seconds to a calendar date', localDateFromUnix(Date.UTC(2026, 4, 17, 12) / 1000), '2026-05-17');

/* --- mapping --- */
const [solve] = toSolves([sub()]);
check('source is set',      solve.source, 'codeforces');
check('problem id mapped',  solve.problemId, '2245G');
check('title mapped',       solve.title, 'NPC Challenge');
check('rating becomes difficulty', solve.difficulty, 3000);
check('tags carried over',  solve.tags, ['divide and conquer', 'interactive']);
check('url built',          solve.url, 'https://codeforces.com/contest/2245/problem/G');

/* --- only accepted submissions count --- */
check('rejected verdicts ignored',
      toSolves([sub({ verdict: 'WRONG_ANSWER' }), sub({ verdict: 'TIME_LIMIT_EXCEEDED' })]).length, 0);
check('an accepted one among failures counts',
      toSolves([sub({ verdict: 'WRONG_ANSWER' }), sub({ id: 2, verdict: 'OK' })]).length, 1);

/* --- one entry per problem, earliest accepted attempt --- */
const repeated = toSolves([
  sub({ id: 1, at: 2_000 }),
  sub({ id: 2, at: 1_000 }),   // same problem, solved earlier
  sub({ id: 3, at: 3_000 }),
]);
check('a re-solve is not a new solve', repeated.length, 1);
check('the earliest accepted attempt wins', repeated[0].solvedAtSeconds, 1_000);

/* --- incremental sync --- */
const two = [sub({ id: 1, at: 1_000, index: 'A' }), sub({ id: 2, at: 5_000, index: 'B' })];
check('everything when starting fresh', toSolves(two).length, 2);
check('only what is newer than the last sync', toSolves(two, { since: 1_000 }).map(s => s.problemId), ['2245B']);
check('nothing when already up to date', toSolves(two, { since: 9_000 }).length, 0);
check('newest timestamp reported back', newestTimestamp(toSolves(two)), 5_000);

/* --- missing fields the API genuinely omits (built directly, since the
       fixture above fills in defaults) --- */
const sparse = toSolves([{
  id: 9, creationTimeSeconds: 1_784_221_884, verdict: 'OK',
  problem: { contestId: 100, index: 'A', name: 'Unrated Problem', type: 'PROGRAMMING' },
}]);
check('an unrated problem has no difficulty', sparse[0].difficulty, null);
check('a problem with no tags gets an empty list', sparse[0].tags, []);
check('submissions in flight are skipped', toSolves([sub({ verdict: 'TESTING' })]).length, 0);
check('a null submission list is safe', toSolves(null), []);

/* --- the API reports failure inside a 200 response --- */
check('a good response yields its results', readResponse({ status: 'OK', result: [1, 2] }), [1, 2]);
let threw = '';
try { readResponse({ status: 'FAILED', comment: 'handle: User not found' }); } catch (e) { threw = e.message; }
check('a failed response explains itself', threw, 'handle: User not found');
threw = '';
try { readResponse(null); } catch (e) { threw = e.message; }
check('an unreadable response is rejected', threw, 'Codeforces sent an unreadable response.');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
