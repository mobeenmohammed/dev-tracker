/* Which problem a page is showing, worked out from the URL alone.
   Run with  node tests/pagekey.test.mjs  */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { module: { exports: {} }, URL };
vm.createContext(sandbox);
const PageKey = vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'extension/pagekey.js'), 'utf8') + ';PageKey;', sandbox);

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`));
}
const id = url => { const k = PageKey.forUrl(url); return k && `${k.source}:${k.problemId}`; };

/* --- LeetCode: the slug is what the tracker stores --- */
check('a problem page',        id('https://leetcode.com/problems/two-sum/'), 'leetcode:two-sum');
check('with a sub-page',       id('https://leetcode.com/problems/two-sum/description/'), 'leetcode:two-sum');
check('with a query string',   id('https://leetcode.com/problems/two-sum/?envType=daily'), 'leetcode:two-sum');
/* leetcode.cn is deliberately not claimed: the extension has no permission
   for it and the sync reads leetcode.com. */
check('the regional domain is not claimed', id('https://leetcode.cn/problems/two-sum/'), null);
check('the problem list is not a problem', id('https://leetcode.com/problemset/all/'), null);
check('the home page is not either',       id('https://leetcode.com/'), null);

/* --- Codeforces names the same problem three ways --- */
check('a contest url',   id('https://codeforces.com/contest/1234/problem/A'), 'codeforces:1234A');
check('a problemset url', id('https://codeforces.com/problemset/problem/1234/A'), 'codeforces:1234A');
check('a gym url',       id('https://codeforces.com/gym/102253/problem/B'), 'codeforces:102253B');
check('a lowercase index is normalised',
      id('https://codeforces.com/contest/1234/problem/a'), 'codeforces:1234A');
check('a multi-letter index',
      id('https://codeforces.com/contest/1234/problem/A1'), 'codeforces:1234A1');
check('the contest page is not a problem', id('https://codeforces.com/contest/1234'), null);
check('the standings page is not either', id('https://codeforces.com/contest/1234/standings'), null);
check('a non-numeric contest is refused', id('https://codeforces.com/contest/abc/problem/A'), null);

/* --- Project Euler --- */
check('a euler problem', id('https://projecteuler.net/problem=42'), 'projecteuler:42');
check('the archives are not', id('https://projecteuler.net/archives'), null);

/* --- anything else --- */
check('an unrelated site', PageKey.forUrl('https://example.com/problems/two-sum'), null);
check('nonsense',          PageKey.forUrl('not a url'), null);
check('nothing',           PageKey.forUrl(''), null);

/* --- labels, for showing something before the tracker replies --- */
check('a slug becomes a title', PageKey.titleFromSlug('reverse-linked-list'), 'Reverse Linked List');
check('a codeforces label is its id',
      PageKey.forUrl('https://codeforces.com/contest/1/problem/A').label, '1A');

/* --- both sides key the digest the same way --- */
check('a digest key',  PageKey.digestKey({ source: 'leetcode', problemId: 'Two-Sum' }), 'leetcode:two-sum');
check('case does not matter',
      PageKey.digestKey(PageKey.forUrl('https://codeforces.com/contest/1234/problem/a')), 'codeforces:1234a');
check('no key without a problem', PageKey.digestKey(null), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
