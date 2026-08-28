/* Regression test for the overlay bug: anything carrying the hidden attribute
   must compute to display:none once the real stylesheet is applied. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css  = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="css/styles.css">', `<style>${css}</style>`);

const dom = new JSDOM(html, { url: 'http://localhost/' });
const { window } = dom;
const doc = window.document;

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  <- ' + detail}`);
};

const display = el => window.getComputedStyle(el).display;

/* These carry the hidden attribute in the markup and also have a class that
   sets display, which is exactly the combination that broke. */
for (const [label, sel] of [
  ['seed banner',   '#banner'],
  ['focus view',    '#view-focus'],
  ['list view',     '#view-list'],
  ['stats view',    '#view-stats'],
  ['toast',         '#toast'],
  ['inspector body','#inspectorBody'],
]) {
  const el = doc.querySelector(sel);
  check(`${label} is hidden while [hidden] is set`, el.hasAttribute('hidden') && display(el) === 'none',
        `hidden=${el.hasAttribute('hidden')} display=${display(el)}`);
}

/* ...and become visible again when the attribute comes off. */
const banner = doc.querySelector('#banner');
banner.hidden = false;
check('banner shows when un-hidden', display(banner) === 'flex', display(banner));
banner.hidden = true;
check('and hides again', display(banner) === 'none', display(banner));

/* Nothing absolutely positioned may sit over the canvas while hidden. */
const overlays = [...doc.querySelectorAll('[hidden]')].filter(el => display(el) !== 'none');
check('no hidden element is still displayed', overlays.length === 0,
      overlays.map(el => el.id || el.className).join(', '));

/* A borrowed card has to be obviously not native to the tree it is drawn in,
   so the difference has to survive into the computed style rather than living
   only in the class name. */
const probe = (cls) => {
  const el = doc.createElement('div');
  el.className = cls;
  doc.body.appendChild(el);
  const s = window.getComputedStyle(el);
  return { border: s.borderStyle || s.borderTopStyle, background: s.backgroundColor || s.background };
};
const plain = probe('card');
const lent  = probe('card is-borrowed');
check('a borrowed card is outlined differently from a native one',
      lent.border !== plain.border, `${plain.border} vs ${lent.border}`);
/* jsdom resolves neither var() nor color-mix, so the tint is checked in the
   stylesheet rather than in a computed colour that would always come back
   transparent here. */
check('and tinted in the connection colour',
      /\.card\.is-borrowed\s*\{[^}]*background:[^}]*--connect/.test(css));

/* The connection colour must exist in both themes, or one of them draws the
   edges and the tint in nothing at all. */
const themed = css.split('html[data-theme="light"]');
check('connections have a colour in the dark theme', /--connect:\s*#/.test(themed[0]));
check('and in the light theme', /--connect:\s*#/.test(themed[1] || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
