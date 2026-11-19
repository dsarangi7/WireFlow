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
  '\nreturn { cadWirePlan, cadwColumns, cadwSegCross, cadwPowerCrossings, cadwLen, cadWireGuide };')();

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
  return s.map((c, i) => ({ comp: c, key: c.id, name: 'SSC' + (i + 1), count: counts ? counts[i] : 12 }));
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
/* per string: 11 jumps + S-, S+, B+, B- = 15 power; 11 jumps + S, N = 13 comm */
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
ok('111: SSC1 S → M1 N', has(tp(s1.ssc, 'S'), tp(s1.modules[0], 'comm-N')));
ok('111: SSC1 M12 S → N', has(tp(s1.ssc, 'N'), tp(s1.modules[11], 'comm-S')));
ok('111: SSC1 B+ → JB P1+, B− → JB P1−', has(tp(s1.ssc, 'B+'), tp(s1.jb, 'P1+')) && has(tp(s1.ssc, 'B-'), tp(s1.jb, 'P1-')));
ok('111: series chain M1 + → M2 − … M11 + → M12 −',
  s1.modules.every((m, i) => i === 11 || has(tp(m, 'power+'), tp(s1.modules[i + 1], 'power-'))));
ok('111: comm chain M1 S → M2 N …', s1.modules.every((m, i) => i === 11 || has(tp(m, 'comm-S'), tp(s1.modules[i + 1], 'comm-N'))));
ok('111: no reversed comm (SSC N → M1 S or Mk N → Mk+1 S)', !has(tp(s1.ssc, 'N'), tp(s1.modules[0], 'comm-S')) &&
  s1.modules.every((m, i) => i === 11 || !has(tp(m, 'comm-N'), tp(s1.modules[i + 1], 'comm-S'))));
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

/* the engineer's own numbering: swap two modules inside SSC1, and one across SSC1 / SSC2 */
{
  const orders = {};
  plan.strings.forEach(st => { orders[st.ssc.id] = st.modules.map(m => m.id); });
  const o1 = orders[s1.ssc.id];
  [o1[1], o1[4]] = [o1[4], o1[1]];                                   // S1-M2 <-> S1-M5
  const s2 = plan.strings.find(s => s.name === 'SSC2');
  const o2 = orders[s2.ssc.id];
  [o1[11], o2[0]] = [o2[0], o1[11]];                                 // S1-M12 <-> S2-M1
  const ep = W.cadWirePlan(comps, sscList(comps), { pair: 'P1', orders: orders });
  const e1 = ep.strings.find(s => s.name === 'SSC1');
  ok('edited numbering: plan follows the engineer order', ep.ok && ep.custom && e1.modules.map(m => m.id).join() === o1.join());
  const hasE = (a, b) => ep.cables.some(c => { const [p, q] = ends(c); return (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)); });
  ok('edited numbering: series chain re-wired in the new order',
    e1.modules.every((m, i) => i === 11 || hasE(tp(m, 'power+'), tp(e1.modules[i + 1], 'power-'))) &&
    hasE(tp(e1.ssc, 'S-'), tp(e1.modules[0], 'power-')) && hasE(tp(e1.ssc, 'S+'), tp(e1.modules[11], 'power+')));
  ok('edited numbering: labels follow (S1-M2 is now the module that was S1-M5)', e1.labels[1].id === plan.strings.find(s => s.name === 'SSC1').modules[4].id && e1.labels[1].text === 'S1-M2');
  ok('edited numbering: a module moved to another SSC keeps the counts', ep.strings.every(s => s.modules.length === 12));
  const badOrders = Object.assign({}, orders, { [s1.ssc.id]: o1.slice(0, 11) });
  const fb = W.cadWirePlan(comps, sscList(comps), { pair: 'P1', orders: badOrders });
  ok('edited numbering that no longer fits falls back to the suggestion, with a warning', fb.ok && !fb.custom && /no longer matches/.test(fb.warnings.join()));
}

/* a junction box at the BOTTOM of an SSC column is used too */
const low = rack111().map(c => c.kind === 'jb' && c.id === 'jb-3' ? Object.assign({}, c, { y0: 120, y1: 222.18, terminals: c.terminals.map(t => Object.assign({}, t, { y: 160.5 })) }) : c);
const lowRows = low.filter(c => !(c.kind === 'module' && c._dummy));
const lp = W.cadWirePlan(lowRows, sscList(lowRows), { pair: 'P1' });
const s3 = lp.ok && lp.strings.find(s => s.ssc.id === 'ssc-3');
ok('junction box at the bottom of its column is found', lp.ok && s3 && s3.jb.id === 'jb-3', lp.errors.join(' | '));

/* an SSC without a junction box in its column: the engineer maps it to a pair of a neighbour's JB */
{
  const noJb = rack111().filter(c => c.id !== 'jb-1');            // the left-most SSC column loses its JB
  const list = sscList(noJb);                                      // SSC5 = left-most SSC (x 3363)
  const s5 = list.find(s => s.comp.id === 'ssc-1'), s4 = list.find(s => s.comp.id === 'ssc-2');
  const miss = W.cadWirePlan(noJb, list, { pair: 'P1' });
  ok('SSC without a junction box in its column asks for a choice', !miss.ok && miss.needJb.includes(s5.key) && /Choose one/.test(miss.errors[0]), miss.errors[0]);
  s5.jbId = 'jb-2'; s5.pair = 'P1'; s4.jbId = 'jb-2'; s4.pair = 'P2';   // shared JB: left pair for one, right for the other
  const shared = W.cadWirePlan(noJb, list, { pair: 'P1' });
  const jb2 = noJb.find(c => c.id === 'jb-2');
  const st5 = shared.ok && shared.strings.find(x => x.ssc.id === 'ssc-1'), st4 = shared.ok && shared.strings.find(x => x.ssc.id === 'ssc-2');
  const hasS = (a, b) => shared.cables.some(c => { const [p, q] = ends(c); return (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)); });
  ok('two SSCs share one junction box: left pair and right pair', shared.ok && hasS(tp(st5.ssc, 'B+'), tp(jb2, 'P1+')) && hasS(tp(st5.ssc, 'B-'), tp(jb2, 'P1-')) &&
    hasS(tp(st4.ssc, 'B+'), tp(jb2, 'P2+')) && hasS(tp(st4.ssc, 'B-'), tp(jb2, 'P2-')), shared.errors.join(' | '));
  ok('shared junction box: cable names say which JB and pair', shared.ok && shared.cables.some(c => /JB\d P2\+/.test(c.to)));
  s4.pair = 'P1';
  const dup = W.cadWirePlan(noJb, list, { pair: 'P1' });
  ok('the same pair of one junction box cannot go to two SSCs', !dup.ok && /given to both/.test(dup.errors.join()), dup.errors[0]);
}

/* refusals: wrong total, missing JB terminals */
const bad = W.cadWirePlan(comps, sscList(comps, [12, 12, 12, 12, 11]), {});
ok('refused: counts do not add up to the modules', !bad.ok && /add up to 59/.test(bad.errors[0]), bad.errors[0]);
const noJb = rack111().map(c => c.kind === 'jb' ? Object.assign({}, c, { terminals: [] }) : c);
const nj = W.cadWirePlan(noJb, sscList(noJb), {});
ok('refused: junction box terminals not taught', !nj.ok && /has no P1 terminals/.test(nj.errors.join()), nj.errors[0]);

/* ---------- no cable ever leaves the rack ---------- */
{
  const rc = rack111();
  const b = { x0: Math.min(...rc.map(c => c.x0)) - 50, x1: Math.max(...rc.map(c => c.x1)) + 50, y0: Math.min(...rc.map(c => c.y0)) - 50, y1: Math.max(...rc.map(c => c.y1)) + 50 };
  const outside = pl => pl.cables.filter(c => c.pts.some(p => p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1));
  const auto = W.cadWirePlan(rc, sscList(rc), { pair: 'P1' });
  ok('rack outline: every cable of the suggested wiring stays inside', outside(auto).length === 0, outside(auto).map(c => c.id).slice(0, 3).join(', '));
  /* an awkward engineer numbering: each SSC's modules picked zig-zag across its two columns */
  const ss = sscList(rc), orders = {};
  for (const st of auto.strings) {
    const s = ss.find(x => x.name === st.name);
    const m = st.modules.slice();
    const zig = [];
    while (m.length) { zig.push(m.shift()); if (m.length) zig.push(m.pop()); }
    orders[s.key] = zig.map(x => x.id);
  }
  const messy = W.cadWirePlan(rc, ss, { pair: 'P1', orders: orders });
  ok('awkward numbering: plan still made', messy.ok && messy.custom, messy.errors.join(' | '));
  ok('awkward numbering: no detours outside the rack (crossings are reported instead)', outside(messy).length === 0, outside(messy).map(c => c.id).slice(0, 3).join(', '));
}

/* ---------- long cables run in the trays and rails, never over a part ---------- */
{
  const rc = rack111();
  const bodies = rc.filter(c => ['module', 'ssc', 'jb', 'msm'].includes(c.kind));
  const inBox = (p, c) => p[0] >= c.x0 - 0.5 && p[0] <= c.x1 + 0.5 && p[1] >= c.y0 - 0.5 && p[1] <= c.y1 + 0.5;
  const over = pl => pl.cables.filter(c => / → /.test(c.id)).filter(c => {
    const own = bodies.filter(o => inBox(c.pts[0], o) || inBox(c.pts[c.pts.length - 1], o));
    for (let i = 1; i < c.pts.length; i++) {
      const p = c.pts[i - 1], q = c.pts[i];
      const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
      if (bodies.some(o => !own.includes(o) && x1 > o.x0 + 1 && x0 < o.x1 - 1 && y1 > o.y0 + 1 && y0 < o.y1 - 1)) return true;
    }
    return false;
  });
  const auto = W.cadWirePlan(rc, sscList(rc), { pair: 'P1', tray: 'CR' });
  ok('trays: no long cable of the suggested wiring runs over a part', auto.ok && over(auto).length === 0, over(auto).map(c => c.id).slice(0, 3).join(', '));
  /* the engineer gives SSC1 the modules of a string two columns away: its long cables must
     go up a tray, across a rail between the rows and down the tray of the far column */
  const ss = sscList(rc), orders = {};
  const byName = n => auto.strings.find(s => s.name === n);
  const far = ss.slice().sort((a, b) => a.comp._col - b.comp._col);
  const A = far[0], B = far.find(s => s.comp._col >= A.comp._col + 2 && s.count === A.count);
  for (const s of ss) orders[s.key] = byName(s.name).modules.map(m => m.id);
  if (B) { const t = orders[A.key]; orders[A.key] = orders[B.key]; orders[B.key] = t; }
  const swap = W.cadWirePlan(rc, ss, { pair: 'P1', tray: 'CR', orders: orders });
  ok('trays: a string two columns away is still planned', !!B && swap.ok && swap.custom, swap.errors.join(' | '));
  ok('trays: its long cables never run over a part', over(swap).length === 0, over(swap).map(c => c.id).slice(0, 3).join(', '));
  const lenient = swap.cables.filter(c => c.ssc === A.name && / → /.test(c.id) && !/JB/.test(c.id));
  const horiz = c => c.pts.slice(1).some((q, i) => Math.abs(q[1] - c.pts[i][1]) < 0.01 && Math.abs(q[0] - c.pts[i][0]) > 300);
  ok('trays: the far string\'s cables cross over on a rail', lenient.length === 4 && lenient.every(horiz));
}

/* ---------- a rack drawn at 1:44 (rack 1111): distances follow the module size ---------- */
{
  const { rack1111, sscs1111 } = require('./fixtures/rack-1111.js');
  const rc = rack1111(), ss = sscs1111(rc);
  /* a plain engineer numbering: column by column, top to bottom, cut by the SSC counts */
  const mods = rc.filter(c => c.kind === 'module').sort((a, b) => (a.x0 - b.x0) || (b.y0 - a.y0));
  const orders = {};
  let at = 0;
  for (const s of ss.slice().sort((a, b) => a.comp.x0 - b.comp.x0 || b.comp.y0 - a.comp.y0)) { orders[s.key] = mods.slice(at, at + s.count).map(m => m.id); at += s.count; }
  const t0 = Date.now();
  const pl = W.cadWirePlan(rc, ss, { pair: 'P1', tray: 'CR', orders: orders });
  const ms = Date.now() - t0;
  ok('1:44 rack: planned with the engineer numbering', pl.ok && pl.custom, pl.errors.join(' | '));
  ok('1:44 rack: planned quickly', ms < 6000, ms + ' ms');
  const k = 9 / 400.45, x0 = Math.min(...rc.map(c => c.x0)), x1 = Math.max(...rc.map(c => c.x1)), y0 = Math.min(...rc.map(c => c.y0)), y1 = Math.max(...rc.map(c => c.y1));
  const out = pl.cables.filter(c => c.pts.some(p => p[0] < x0 - 50 * k || p[0] > x1 + 50 * k || p[1] < y0 - 50 * k || p[1] > y1 + 50 * k));
  ok('1:44 rack: no cable leaves the rack (no giant loops)', out.length === 0, out.map(c => c.id).slice(0, 3).join(', '));
  const curves = pl.cables.filter(c => c.curve);
  const sag = c => Math.max(...c.pts.map(p => Math.abs(p[1] - c.pts[0][1])));
  ok('1:44 rack: jumps sag at most one module height', curves.every(c => sag(c) <= 4.2), Math.max(0, ...curves.map(sag)).toFixed(2));
  /* the guide while numbering */
  const gd = W.cadWireGuide(rc, ss, { pair: 'P1', tray: 'CR', suggest: false });
  const first = gd.next(ss[0].key, [], []);
  const ssc = ss[0].comp;
  ok('guide: M1 is offered next to the SSC', first.ids.length > 0 && first.ids.every(id => { const m = rc.find(c => c.id === id); return Math.abs((m.x0 + m.x1) / 2 - (ssc.x0 + ssc.x1) / 2) < 11; }));
  const m1 = rc.find(c => c.id === first.ids[0]);
  const nx = gd.next(ss[0].key, [m1.id], [m1.id]);
  ok('guide: next modules are beside or above / below the last one', nx.ids.length > 0 && nx.ids.every(id => { const m = rc.find(c => c.id === id); return Math.abs(m.x0 - m1.x0) < 11 && Math.abs(m.y0 - m1.y0) < 13; }));
}

/* ---------- two module sizes (the same module taught with two different boxes) ---------- */
{
  const rc = rack111();
  let i = 0;
  const two = rc.map(c => c.kind === 'module' && (i++ % 2) ? Object.assign({}, c, { x1: c.x1 + 60, y1: c.y1 + 30 }) : c);
  const a = W.cadWirePlan(rc, sscList(rc), { pair: 'P1' }), b = W.cadWirePlan(two, sscList(two), { pair: 'P1' });
  ok('two module sizes: still 10 columns', W.cadwColumns(two).length === 10);
  ok('two module sizes: planned like one size', b.ok && b.crossings.length === a.crossings.length && b.strings.length === a.strings.length, b.errors.join(' | '));
}

/* ---------- suggested numbering: one block per SSC, no power crossings ---------- */
{
  const rc = rack111();
  const pl = W.cadWirePlan(rc, sscList(rc), { pair: 'P1', tray: 'CR' });
  ok('suggestion: found for rack 111', !!pl.suggested);
  ok('suggestion: no power crossings', pl.ok && pl.crossings.length === 0, pl.crossings.length);
  const byId = new Map(rc.map(c => [c.id, c]));
  const adj = (p, q) => { const a = byId.get(p), b = byId.get(q); const dx = Math.abs(a.x0 - b.x0), dy = Math.abs(a.y0 - b.y0); return dx < 1 || (dy < 1 && dx < 510); };
  ok('suggestion: every jump stays in the column or goes to the module beside', !!pl.suggested && Object.values(pl.suggested).every(o => o.every((id, n) => !n || adj(o[n - 1], id))));
}

/* ---------- cable tray for B+ / B- (CL / CR) ---------- */
{
  const rc = rack111();
  const cl = W.cadWirePlan(rc, sscList(rc), { pair: 'P1', tray: 'CL' });
  const cr = W.cadWirePlan(rc, sscList(rc), { pair: 'P1', tray: 'CR' });
  const cols = W.cadwColumns(rc);
  /* the vertical run of a bus cable is the longest vertical segment */
  const riserX = c => { let best = null; for (let i = 1; i < c.pts.length; i++) { const a = c.pts[i - 1], b = c.pts[i]; if (Math.abs(a[0] - b[0]) < 0.01 && (!best || Math.abs(a[1] - b[1]) > best.l)) best = { x: a[0], l: Math.abs(a[1] - b[1]) }; } return best && best.x; };
  const side = (pl, want) => pl.cables.filter(c => /B[+−-] →/.test(c.id)).every(c => {
    const st = pl.strings.find(s => s.name === c.ssc), col = cols[st.ssc._col], x = riserX(c);
    return want === 'CL' ? x < col.x0 : x > col.x1;
  });
  ok('tray CL: every B+ / B− cable runs in the tray left of the SSC column', cl.ok && side(cl, 'CL'));
  ok('tray CR: every B+ / B− cable runs in the tray right of the SSC column', cr.ok && side(cr, 'CR'));
  const ss = sscList(rc); ss[0].tray = 'CL';
  const mix = W.cadWirePlan(rc, ss, { pair: 'P1', tray: 'CR' });
  const c0 = mix.cables.filter(c => c.ssc === ss[0].name && /B[+−-] →/.test(c.id));
  ok('tray per SSC overrides the rack tray', mix.ok && c0.length === 2 && c0.every(c => riserX(c) < cols[ss[0].comp._col].x0));
}

console.log('\n' + (failed.length ? 'FAILED ' + failed.length + ':\n  ' + failed.join('\n  ') : 'Wiring tests passed: ' + passed));
process.exitCode = failed.length ? 1 : 0;
