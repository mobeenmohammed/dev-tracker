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

/* The tab bar must never scroll as a whole. When it did, enough fields pushed
   All, the new-field button and every fixed view off the right-hand edge, and
   reaching any of them meant scrolling sideways first. */
const bar = doc.querySelector('.tabbar');
const barStyle = window.getComputedStyle(bar);
check('the bar itself does not scroll sideways',
      barStyle.overflowX !== 'auto' && barStyle.overflowX !== 'scroll',
      `overflow-x: ${barStyle.overflowX}`);
/* The wheel handler writes scrollLeft on every tick; an animated scroll would
   restart from a half-finished position each time and the strip would creep
   instead of tracking the wheel. */
check('the strip does not animate its own scrolling',
      !/\.tabs-scroll\s*\{[^}]*scroll-behavior:\s*smooth/.test(css));
check('the strip is the only thing that does',
      /\.tabs-scroll\s*\{[^}]*overflow-x:\s*auto/.test(css));
check('and the fixed views cannot be squeezed out of it',
      /\.tabs-fixed\s*\{[^}]*flex:\s*none/.test(css));
check('nor All and the new-field button',
      /\.tabs-pinned\s*\{[^}]*flex:\s*none/.test(css));

/* A folder must not read as a field, or the list stops being scannable. */
const probeRow = cls => {
  const el = doc.createElement('button');
  el.className = cls;
  doc.querySelector('#fieldPickerList').appendChild(el);
  return window.getComputedStyle(el);
};
/* Set apart by weight, colour and a caret — not by shouting the name. */
check('a folder row is set apart from a field row',
      /\.picker-folder\s+\.picker-name\s*\{[^}]*font-weight/.test(css));
/* Section headings elsewhere are uppercased on purpose, so this asks about the
   folder name itself rather than about the stylesheet as a whole. */
check('and folder names are left as they were typed',
      (() => {
        const row = doc.createElement('div');
        row.className = 'picker-row picker-folder';
        const name = doc.createElement('span');
        name.className = 'picker-name';
        row.appendChild(name);
        doc.querySelector('#fieldPickerList').appendChild(row);
        return window.getComputedStyle(name).textTransform !== 'uppercase';
      })(), 'the folder name is still uppercased');

check('and the same in the strip',
      (() => {
        const chip = doc.createElement('button');
        chip.className = 'tab tab-folder';
        doc.querySelector('#fieldTabsScroll').appendChild(chip);
        return window.getComputedStyle(chip).textTransform !== 'uppercase';
      })(), 'the folder chip is still uppercased');
/* Nesting has no depth limit, so the indent is a per-row inline style and
   only the rail that marks a nested row lives in the stylesheet. */
check('and what is inside a folder is marked as nested',
      /\.picker-row\.is-nested::before\s*\{[^}]*border-left/.test(css));
check('the indent rail can be positioned against the row',
      probeRow('picker-row').position === 'relative');

/* The edges are the content of a knowledge graph. Half-opacity hairlines over
   a dark canvas were close to invisible, which made the graph a picture of
   cards rather than of relationships. */
{
  const probe = cls => {
    const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', cls);
    doc.querySelector('#links').appendChild(p);
    return window.getComputedStyle(p);
  };
  const ref = probe('ref-link');
  const connect = probe('link is-connect');
  check('a reference line is close to opaque', Number(ref.opacity) >= 0.8, ref.opacity);
  check('and thick enough to follow', parseFloat(ref.strokeWidth) >= 2, ref.strokeWidth);
  check('a connection line too',
        Number(connect.opacity) >= 0.9 && parseFloat(connect.strokeWidth) >= 2,
        `${connect.opacity} / ${connect.strokeWidth}`);
  check('and both are laid over a casing in the canvas colour',
        /\.link-casing\s*\{[^}]*stroke:\s*var\(--bg\)/.test(css));
}

/* Every id has to be unique, or getElementById quietly hands back the wrong
   element. The stopwatch's heading and the task view's topic select were both
   called focusTopic, so the heading won and the picker was never filled —
   every task could only ever be "No topic". */
{
  const seen = new Set();
  const dupes = [];
  [...doc.querySelectorAll('[id]')].forEach(el => {
    if (seen.has(el.id)) dupes.push(el.id);
    seen.add(el.id);
  });
  check('no two elements share an id', dupes.length === 0, dupes.join(', '));
}

/* The focus screen covers the app on purpose, so it has to be genuinely out of
   the way when it is not up — and it must start that way. */
check('the focus screen starts hidden', doc.querySelector('#focusScreen').hasAttribute('hidden'));
check('and it is over everything when it is not',
      window.getComputedStyle(doc.querySelector('#focusScreen')).position === 'fixed');
check('the pill starts hidden too', doc.querySelector('#focusPill').hasAttribute('hidden'));
/* Its text changes every second, so announcing it is unusable. */
check('the pill is not a live region',
      !doc.querySelector('#focusPill').hasAttribute('aria-live'));
check('while the clock itself is announced only on demand',
      doc.querySelector('#focusElapsed').getAttribute('aria-live') === 'off');
check('the clock is set in a fixed-width face, so it does not jitter per second',
      /#focusElapsed\s*\{[^}]*font-variant-numeric:\s*tabular-nums/.test(css));

/* The picker hangs below the bar rather than taking room inside it. */
check('the picker is taken out of the flow',
      window.getComputedStyle(doc.querySelector('#fieldPicker')).position === 'absolute');
check('and starts hidden', doc.querySelector('#fieldPicker').hasAttribute('hidden'));

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
