/* Tests for the Project Euler page reading. No browser and no network:
   run with  node tests/euler.test.mjs

   Project Euler blocks non-browser requests, so its markup cannot be checked
   from here. That is exactly why the parsing leans on the URL and degrades
   through fallbacks — these tests pin that behaviour down. */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
const Euler = vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'extension/euler.js'), 'utf8') + ';Euler;', sandbox);

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`));
}

/* The problem number comes from the URL, which is the stable part. */
check('a problem url',        Euler.problemNumber('https://projecteuler.net/problem=42'), '42');
check('with other params',    Euler.problemNumber('https://projecteuler.net/index.php?section=problems&problem=7'), '7');
check('a multi-digit number', Euler.problemNumber('https://projecteuler.net/problem=1000'), '1000');
check('the archives page',    Euler.problemNumber('https://projecteuler.net/archives'), null);
check('nothing at all',       Euler.problemNumber(''), null);

/* The title degrades rather than failing. */
const docWith = (heading, title) => ({
  title: title || '',
  querySelector: sel => (sel === 'h2' && heading ? { textContent: heading } : null),
});
check('the heading is preferred',
      Euler.problemTitle(docWith('Multiples of 3 or 5', 'x'), '1'), 'Multiples of 3 or 5');
check('the document title is the fallback',
      Euler.problemTitle(docWith(null, 'Even Fibonacci numbers - Project Euler'), '2'),
      'Even Fibonacci numbers');
check('a bare site title is not a problem title',
      Euler.problemTitle(docWith(null, 'Project Euler'), '3'), 'Problem 3');
check('and with no page at all',
      Euler.problemTitle(null, '4'), 'Problem 4');

/* Detecting success is best effort, and the button never depends on it. */
check('a success message is recognised',
      Euler.looksSolved('Congratulations, the answer you gave to problem 42 is correct.'), true);
check('case does not matter',
      Euler.looksSolved('CONGRATULATIONS! The answer is correct'), true);
check('an ordinary page is not a success',
      Euler.looksSolved('Problem 42: some description of the problem'), false);
check('empty text is not a success', Euler.looksSolved(''), false);

/* The solve handed to the tracker. */
const solve = Euler.solveFor('https://projecteuler.net/problem=42',
                             docWith('Coded triangle numbers', ''), { solvedAt: '2026-05-01' });
check('source is set',      solve.source, 'projecteuler');
check('the number is the id', solve.problemId, '42');
check('the title is carried', solve.title, 'Coded triangle numbers');
check('a canonical url is built', solve.url, 'https://projecteuler.net/problem=42');
check('no rating is invented', solve.difficulty, null);
check('the date is used',   solve.solvedAt, '2026-05-01');
check('a non-problem page yields nothing',
      Euler.solveFor('https://projecteuler.net/about', docWith(null, '')), null);
check('todays date is the default',
      /^\d{4}-\d{2}-\d{2}$/.test(Euler.solveFor('https://projecteuler.net/problem=1', docWith('X', '')).solvedAt), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
