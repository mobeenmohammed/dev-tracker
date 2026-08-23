/* Tests for the LeetCode mapping. Pure logic, no browser and no network:
   run with  node tests/leetcode.test.mjs  */

import { toSolves, applyQuestion, readRecent, readGraphQL, recentQuery,
         questionQuery, localDateFromUnix, newestTimestamp, WINDOW_SIZE, LEVELS }
  from '../extension/leetcode.js';

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`));
}

/* Shaped like the live recentAcSubmissionList response. */
const sub = (over = {}) => ({
  id: over.id ?? '1',
  title: over.title ?? 'Two Sum',
  titleSlug: over.slug ?? 'two-sum',
  timestamp: String(over.at ?? 1_787_458_885),
});

/* --- queries --- */
check('the window is what the server allows', WINDOW_SIZE, 20);
check('recent query carries the username', recentQuery('someone').variables,
      { username: 'someone', limit: 20 });
check('the username is trimmed', recentQuery('  spaced  ').variables.username, 'spaced');
check('question query carries the slug', questionQuery('two-sum').variables, { titleSlug: 'two-sum' });

/* --- mapping --- */
const [solve] = toSolves([sub()]);
check('source is set',       solve.source, 'leetcode');
check('the slug is the identity', solve.problemId, 'two-sum');
check('title mapped',        solve.title, 'Two Sum');
check('url built',           solve.url, 'https://leetcode.com/problems/two-sum/');
check('no rating to report', solve.difficulty, null);
check('tags arrive later',   solve.tags, []);

/* Timestamps come back as strings. */
check('a string timestamp still dates it',
      toSolves([sub({ at: Date.UTC(2026, 4, 17, 12) / 1000 })])[0].solvedAt, '2026-05-17');
check('date helper agrees', localDateFromUnix(Date.UTC(2026, 4, 17, 12) / 1000), '2026-05-17');

/* --- one entry per problem, earliest attempt --- */
const repeated = toSolves([
  sub({ at: 2000 }), sub({ at: 1000 }), sub({ at: 3000 }),
]);
check('a re-solve is not a new solve', repeated.length, 1);
check('the earliest accepted attempt wins', repeated[0].solvedAtSeconds, 1000);

/* --- the rolling window is incremental, which is how nothing repeats --- */
const two = [sub({ at: 1000, slug: 'a', title: 'A' }), sub({ at: 5000, slug: 'b', title: 'B' })];
check('everything when starting fresh', toSolves(two).length, 2);
check('only what is newer than the watermark',
      toSolves(two, { since: 1000 }).map(s => s.problemId), ['b']);
check('nothing when already up to date', toSolves(two, { since: 9000 }).length, 0);
check('newest timestamp reported back', newestTimestamp(toSolves(two)), 5000);
check('a null list is safe', toSolves(null), []);
check('an entry with no slug is skipped', toSolves([{ title: 'x', timestamp: '5' }]), []);

/* --- enrichment from the question lookup --- */
const enriched = applyQuestion(toSolves([sub()])[0], {
  questionFrontendId: '1', title: 'Two Sum', difficulty: 'Easy',
  topicTags: [{ name: 'Array', slug: 'array' }, { name: 'Hash Table', slug: 'hash-table' }],
});
check('tags come from topic tags', enriched.tags, ['array', 'hash table']);
check('difficulty becomes a level', enriched.level, 'easy');
check('every level maps', [LEVELS.Easy, LEVELS.Medium, LEVELS.Hard], ['easy', 'medium', 'hard']);
check('an unknown difficulty is no level',
      applyQuestion(toSolves([sub()])[0], { difficulty: 'Impossible' }).level, null);
check('a missing lookup leaves the solve alone',
      applyQuestion(toSolves([sub()])[0], null).tags, []);

/* --- failures arrive inside a 200 response --- */
check('good data is returned', readGraphQL({ data: { ok: 1 } }), { ok: 1 });
let threw = '';
try { readGraphQL({ errors: [{ message: 'That user does not exist.' }] }); } catch (e) { threw = e.message; }
check('an error is surfaced', threw, 'That user does not exist.');
threw = '';
try { readRecent({ data: {} }); } catch (e) { threw = e.message; }
check('a missing list is explained', threw, 'No submissions returned — is the username right?');
threw = '';
try { readGraphQL(null); } catch (e) { threw = e.message; }
check('an unreadable body is rejected', threw, 'LeetCode sent an unreadable response.');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
