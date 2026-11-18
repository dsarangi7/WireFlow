/* WireFlow — automatic wiring planner tests (js/cadwire.js).
 * Rack 111 is rebuilt from the measured DXF geometry (positions in mm):
 * 10 columns at 500 mm pitch; SSC columns hold 4 modules under the SSC,
 * the others 8; a junction box on top of every SSC column.
 * Run: node tests/cadwire.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const W = new Function(fs.readFileSync(path.join(ROOT, 'js', 'cadwire.js'), 'utf8') +
  '\nreturn { cadWirePlan, cadwColumns, cadwSegCross, cadwPowerCrossings, cadwLen };')();

let passed = 0; const failed = [];
function ok(name, cond, info) { if (cond) passed++; else failed.push(name + (info ? '  [' + info + ']' : '')); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info ? '  [' + info + ']' : '')); }

/* ---------- rack 111 geometry (from the DXF) ---------- */
function rack111() {
  const comps = [];
  let n = 0;
  const rows = [220.62, 430.62, 640.62, 850.62, 1060.62, 1270.62, 1480.62, 1690.62];
  const mod = (x0, y0) => ({ id: 'module-' + (++n), kind: 'module', x0: x0, y0: y0, x1: x0 + 400.45, y1: y0 + 200.22,
    terminals: [['comm-S', 39.53], ['comm-N', 99.53], ['power-', 314.53], ['power+', 364.53]].map(([r, dx]) => ({ role: r, x: x0 + dx, y: y0 + 59.99 })) });
  for (let c = 0; c < 10; c++) {
    const x0 = 2830.3 + 500 * c;
    const sscCol = c % 2 === 1;
    for (const y of sscCol ? rows.slice(0, 4) : rows) comps.push(mod(x0, y));
    if (sscCol) {
      const sx = x0 + 32.51, sy = c === 9 ? 1051.11 : 1096.87;
      comps.push({ id: 'ssc-' + ((c + 1) / 2), kind: 'ssc', x0: sx, y0: sy, x1: sx + 338.15, y1: sy + 396,
        terminals: [['S', 54.27], ['N', 99.27], ['S+', 138.77], ['B+', 185.27], ['B-', 231.77], ['S-', 278.27]].map(([r, dx]) => ({ role: r, x: sx + dx, y: sy + 55.04 })) });
      const jx = x0 - 7.77;
      comps.push({ id: 'jb-' + ((c + 1) / 2), kind: 'jb', x0: jx, y0: 1904.7, x1: jx + 418.62, y1: 2006.88,
        terminals: [['P1+', 102.27], ['P1-', 172.27], ['P2+', 242.27], ['P2-', 312.27]].map(([r, dx]) => ({ role: r, x: jx + dx, y: 1945.2 })) });
    }
  }
  return comps;
}
/* SSC names as on 111: SSC1 is the rightmost (closest to the MSM) */
function sscList(comps, counts) {
  const s = comps.filter(c => c.kind === 'ssc').sort((a, b) => b.x0 - a.x0);
  return s.map((c, i) => ({ comp: c, name: 'SSC' + (i + 1), count: counts ? counts[i] : 12 }));
}

/* ---------- geometry helpers ---------- */
ok('segments: X crossing detected', W.cadwSegCross([0, 0], [10, 10], [0, 10], [10, 0]));
ok('segments: touching end is not a crossing', !W.cadwSegCross([0, 0], [10, 0], [10, 0], [10, 10]));
ok('segments: two cables on top of each other count', W.cadwSegCross([0, 0], [10, 0], [5, 0], [20, 0]));
const cols = W.cadwColumns(rack111());
ok('111: 10 columns found', cols.length === 10, cols.length);
ok('111: riser in the 100 mm gap between columns', Math.abs(cols[1].riserL - 3280.5) < 0.5 && Math.abs(cols[1].gapL - 99.55) < 0.1, cols[1].riserL.toFixed(2));

/* ---------- full plan on rack 111 ---------- */
const comps = rack111();
const t0 = Date.now();
const plan = W.cadWirePlan(comps, sscList(comps), { pair: 'P1' });
const ms = Date.now() - t0;
ok('111: plan is complete', plan.ok, plan.errors.join(' | '));
ok('111: planned quickly', ms < 3000, ms + ' ms');
ok('111: 5 strings of 12 modules', plan.strings.length === 5 && plan.strings.every(s => s.modules.length === 12));
ok('111: every module used exactly once', new Set(plan.strings.flatMap(s => s.modules.map(m => m.id))).size === 60);
ok('111: NO power cable crossings anywhere in the rack', plan.crossings.length === 0, JSON.stringify(plan.crossings.slice(0, 3)));
const power = plan.cables.filter(c => c.kind === 'power'), comm = plan.cables.filter(c => c.kind === 'comm');
/* per string: 11 jumps + S-, S+, B+, B- = 15 power; 11 jumps + N, S = 13 comm */
ok('111: 15 power and 13 communication cables per SSC', power.length === 75 && comm.length === 65, power.length + ' / ' + comm.length);
const s1 = plan.strings.find(s => s.name === 'SSC1');
ok('111: labels S1-M1 … S1-M12', s1.labels.map(l => l.text).join() === Array.from({ length: 12 }, (_, i) => 'S1-M' + (i + 1)).join());
ok('111: each SSC wires the modules of its own and the neighbouring column',
  plan.strings.every(s => s.modules.every(m => Math.abs(m._col - s.ssc._col) <= 1)));
/* consecutive modules are neighbours (no long series jumps) */
const jumpOk = plan.strings.every(s => s.modules.every((m, i) => i === 0 ||
  Math.abs(((m.x0 + m.x1) - (s.modules[i - 1].x0 + s.modules[i - 1].x1)) / 2) <= 501 &&
  Math.abs(((m.y0 + m.y1) - (s.modules[i - 1].y0 + s.modules[i - 1].y1)) / 2) <= 211));
ok('111: every series jump goes to a neighbouring module', jumpOk);
/* cable endpoints are exactly on the right terminals */
const tp = (c, r) => c.terminals.find(t => t.role === r);
const ends = (cab) => [cab.pts[0], cab.pts[cab.pts.length - 1]];
const near = (p, t) => Math.hypot(p[0] - t.x, p[1] - t.y) < 1e-6;
const has = (a, b) => plan.cables.some(c => { const [p, q] = ends(c); return (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)); });
ok('111: SSC1 S− → M1 −', has(tp(s1.ssc, 'S-'), tp(s1.modules[0], 'power-')));
ok('111: SSC1 M12 + → S+', has(tp(s1.ssc, 'S+'), tp(s1.modules[11], 'power+')));
ok('111: SSC1 N → M1 S', has(tp(s1.ssc, 'N'), tp(s1.modules[0], 'comm-S')));
ok('111: SSC1 M12 N → S', has(tp(s1.ssc, 'S'), tp(s1.modules[11], 'comm-N')));
ok('111: SSC1 B+ → JB P1+, B− → JB P1−', has(tp(s1.ssc, 'B+'), tp(s1.jb, 'P1+')) && has(tp(s1.ssc, 'B-'), tp(s1.jb, 'P1-')));
ok('111: series chain M1 + → M2 − … M11 + → M12 −',
  s1.modules.every((m, i) => i === 11 || has(tp(m, 'power+'), tp(s1.modules[i + 1], 'power-'))));
ok('111: comm chain M1 N → M2 S …', s1.modules.every((m, i) => i === 11 || has(tp(m, 'comm-N'), tp(s1.modules[i + 1], 'comm-S'))));
ok('111: long cables are horizontal/vertical runs (riser style)',
  plan.cables.filter(c => c.pts.length > 2 && !c.curve).every(c => c.pts.every((p, i) => i === 0 || p[0] === c.pts[i - 1][0] || p[1] === c.pts[i - 1][1])));
const curves = plan.cables.filter(c => c.curve);
ok('111: side-by-side modules in adjacent columns are joined by a C curve (power and comm)',
  curves.some(c => c.kind === 'power') && curves.some(c => c.kind === 'comm') &&
  curves.every(c => c.pts.length > 10), curves.length + ' curves');
const sagOf = c => { const ys = c.pts.map(p => p[1]); const ends = Math.min(c.pts[0][1], c.pts[c.pts.length - 1][1]); return Math.max(ends - Math.min(...ys), Math.max(...ys) - Math.max(c.pts[0][1], c.pts[c.pts.length - 1][1])); };
ok('111: power curves sag deeper than comm curves',
  Math.min(...curves.filter(c => c.kind === 'power').map(sagOf)) > Math.max(...curves.filter(c => c.kind === 'comm').map(sagOf)));
ok('111: one group outline per SSC', plan.outline.length === 5 && plan.outline.every(o => o.segs.length >= 4));

/* pair P2 uses the right-hand JB connectors on every junction box */
const p2 = W.cadWirePlan(comps, sscList(comps), { pair: 'P2' });
const has2 = (a, b) => p2.cables.some(c => { const [p, q] = ends(c); return (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)); });
ok('JB pair P2 applied to every junction box', p2.ok && p2.strings.every(s =>
  has2(tp(s.ssc, 'B+'), tp(s.jb, 'P2+')) && has2(tp(s.ssc, 'B-'), tp(s.jb, 'P2-')) && !has2(tp(s.ssc, 'B+'), tp(s.jb, 'P1+'))));
ok('JB pair P2: still no power crossings', p2.crossings.length === 0, p2.crossings.length);

/* uneven counts still give contiguous groups and no crossings */
const uneven = W.cadWirePlan(comps, sscList(comps, [10, 14, 12, 12, 12]), { pair: 'P1' });
ok('uneven counts 10/14/12/12/12 planned', uneven.ok, uneven.errors.join(' | '));
ok('uneven counts: no power crossings', uneven.crossings.length === 0, uneven.crossings.length);

/* refusals: wrong total, missing JB terminals */
const bad = W.cadWirePlan(comps, sscList(comps, [12, 12, 12, 12, 11]), {});
ok('refused: counts do not add up to the modules', !bad.ok && /add up to 59/.test(bad.errors[0]), bad.errors[0]);
const noJb = rack111().map(c => c.kind === 'jb' ? Object.assign({}, c, { terminals: [] }) : c);
const nj = W.cadWirePlan(noJb, sscList(noJb), {});
ok('refused: junction box terminals not taught', !nj.ok && /junction box has no P1 terminals/.test(nj.errors.join()), nj.errors[0]);

console.log('\n' + (failed.length ? 'FAILED ' + failed.length + ':\n  ' + failed.join('\n  ') : 'Wiring tests passed: ' + passed));
process.exitCode = failed.length ? 1 : 0;
