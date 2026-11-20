/* WireFlow — numbering library tests (js/numlib.js).
 * Run: node tests/numlib.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const N = new Function(fs.readFileSync(path.join(ROOT, 'js', 'numlib.js'), 'utf8') +
  '\nreturn { numlibLayout, numlibEntry, numlibAdd, numlibMatches, numlibApply, numlibSame };')();
const { rack1111, sscs1111 } = require('./fixtures/rack-1111.js');

let passed = 0; const failed = [];
function ok(name, cond, info) { if (cond) passed++; else failed.push(name + (info ? '  [' + info + ']' : '')); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info ? '  [' + info + ']' : '')); }

/* the same rack drawn at another scale and place, with its parts listed in another order and new ids */
function moved(comps, k, dx, dy) {
  return comps.slice().reverse().map((c, i) => Object.assign({}, c, { id: c.kind + '-x' + i, x0: c.x0 * k + dx, x1: c.x1 * k + dx, y0: c.y0 * k + dy, y1: c.y1 * k + dy }));
}
/* a simple numbering: each SSC takes its modules in the order of the module list */
function someOrders(comps, sscs) {
  const mods = comps.filter(c => c.kind === 'module');
  const o = {}; let at = 0;
  for (const s of sscs) { o[s.key] = mods.slice(at, at + s.count).map(m => m.id); at += s.count; }
  return o;
}

const rc = rack1111(), ss = sscs1111(rc);
const L1 = N.numlibLayout(rc);
ok('layout: every module, SSC and junction box gets its own cell', L1 && L1.modules === rc.filter(c => c.kind === 'module').length && L1.sscs === 9, L1 && L1.modules + ' modules');
const big = moved(rc, 44.4, 2500, -300);
const L2 = N.numlibLayout(big);
ok('layout: the same rack at 1:1 instead of 1:44, moved, gives the same layout key', L2 && L2.key === L1.key);

const orders = someOrders(rc, ss);
const entry = N.numlibEntry(rc, ss, orders, { project: 'Rack A', projectId: 1, pair: 'P1', tray: 'CR', crossings: 3 });
ok('entry: stored by grid cell, with the SSC names, junction boxes and pairs', entry && Object.keys(entry.strings).length === 9 && Object.values(entry.strings).every(s => s.jb && s.pair));

/* used on the moved copy: every SSC gets the modules in the same places, in the same order */
const ss2 = big.filter(c => c.kind === 'ssc');
const counts = {}; for (const s of ss2) counts[s.id] = null;
const ap = N.numlibApply(entry, big, null);
const byPlace = (comps, id) => { const c = comps.find(x => x.id === id); return Math.round(c.x0) + ',' + Math.round(c.y0); };
let same = !ap.error;
for (const s of ss) {
  const twin = ss2.find(t => Math.abs(t.x0 - (s.comp.x0 * 44.4 + 2500)) < 0.01 && Math.abs(t.y0 - (s.comp.y0 * 44.4 - 300)) < 0.01);
  const got = ap.orders && ap.orders[twin.id];
  const want = orders[s.key].map(id => { const c = rc.find(x => x.id === id); return Math.round(c.x0 * 44.4 + 2500) + ',' + Math.round(c.y0 * 44.4 - 300); });
  if (!got || got.map(id => byPlace(big, id)).join(' ') !== want.join(' ')) same = false;
}
ok('apply: the numbering lands on the same modules of the other drawing, in order', same, ap.error);
ok('apply: junction boxes and pairs come along', ap.sscs && Object.values(ap.sscs).every(s => s.jbId && s.pair));

/* module counts that differ are refused */
const twin0 = ss2[0].id;
const bad = N.numlibApply(entry, big, { [twin0]: 99 });
ok('apply: refused when an SSC module count differs', !!bad.error && /counts differ/.test(bad.error), bad.error);

/* a different layout: no match */
const other = rc.filter(c => !(c.kind === 'module' && c === rc.filter(x => x.kind === 'module')[5]));
ok('matches: a rack with one module fewer is not offered', N.numlibMatches([entry], other).length === 0);
ok('matches: the same layout is offered', N.numlibMatches([entry], big).length === 1);
ok('apply: refused on a different layout', !!N.numlibApply(entry, other, null).error);

/* library: the same numbering is kept once; a project keeps one entry per layout */
let lib = N.numlibAdd([], entry);
lib = N.numlibAdd(lib, Object.assign({}, entry, { saved: '2026-11-21T00:00:00Z' }));
ok('library: the same numbering is stored once', lib.length === 1);
const e2 = Object.assign({}, entry, { projectId: 2, project: 'Rack B', crossings: 0, strings: JSON.parse(JSON.stringify(entry.strings)) });
const first = Object.keys(e2.strings)[0]; e2.strings[first].modules.reverse();
lib = N.numlibAdd(lib, e2);
ok('library: numberings from two projects are both kept', lib.length === 2);
ok('matches: fewest crossings first', N.numlibMatches(lib, rc)[0].project === 'Rack B');
const e3 = Object.assign({}, e2, { crossings: 1, strings: JSON.parse(JSON.stringify(entry.strings)) });
e3.strings[Object.keys(e3.strings)[1]].modules.reverse();
lib = N.numlibAdd(lib, e3);
ok('library: a project re-numbered keeps only its newest numbering for the layout', lib.length === 2 && lib.filter(e => e.projectId === 2).length === 1 && lib[0].crossings === 1);

console.log('\n' + (failed.length ? 'FAILED ' + failed.length + ':\n  ' + failed.join('\n  ') : 'Numbering library tests passed: ' + passed));
process.exitCode = failed.length ? 1 : 0;
