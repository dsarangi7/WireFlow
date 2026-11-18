/* Unit tests for js/cad.js (native DXF reader).
 * Run: node tests/cad.test.js
 * Optional real-drawing check: WIREFLOW_DXF=path\to\rack.dxf node tests/cad.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../js/cad.js'), 'utf8');
const C = new Function(src + '\nreturn { cadParseDxf, cadFlatten, cadToSvg, cadSummary, cadBulgePts, cadSplinePts, cadArcSegments,' +
  ' cadFeatures, cadFeatureIndex, cadTeachSignature, cadRefineSignature, cadFindMatches, cadRecognise, cadProposeNumbers };')();

let passed = 0;
function check(name, fn) { fn(); passed++; }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), `${msg || ''} expected ${b}, got ${a}`);

/** Builds a minimal ASCII DXF from [code, value] pairs per entity. */
function dxf(entities, opts) {
  const o = opts || {};
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(o.units == null ? 4 : o.units), '0', 'ENDSEC'];
  if (o.layers) {
    out.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER');
    for (const L of o.layers) out.push('0', 'LAYER', '2', L.name, '70', String(L.flags || 0), '62', String(L.color == null ? 7 : L.color));
    out.push('0', 'ENDTAB', '0', 'ENDSEC');
  }
  if (o.blocks) {
    out.push('0', 'SECTION', '2', 'BLOCKS');
    for (const b of o.blocks) {
      out.push('0', 'BLOCK', '8', '0', '2', b.name, '10', String(b.base[0]), '20', String(b.base[1]));
      for (const e of b.entities) { out.push('0', e[0]); for (let i = 1; i < e.length; i += 2) out.push(String(e[i]), String(e[i + 1])); }
      out.push('0', 'ENDBLK');
    }
    out.push('0', 'ENDSEC');
  }
  out.push('0', 'SECTION', '2', 'ENTITIES');
  for (const e of entities) { out.push('0', e[0]); for (let i = 1; i < e.length; i += 2) out.push(String(e[i]), String(e[i + 1])); }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n');
}
const load = (ents, opts, fopts) => { const m = C.cadParseDxf(dxf(ents, opts)); return { m, f: C.cadFlatten(m, fopts) }; };

check('units and LINE are kept in drawing mm', () => {
  const { m, f } = load([['LINE', 8, 'A', 10, 100, 20, 50, 11, 300, 21, 50]]);
  assert.strictEqual(m.units, 'mm');
  assert.strictEqual(m.mmPerUnit, 1);
  assert.deepStrictEqual(f.polylines[0].pts, [100, 50, 300, 50]);
  assert.strictEqual(f.polylines[0].layer, 'A');
  assert.deepStrictEqual(f.bounds, { minX: 100, minY: 50, maxX: 300, maxY: 50 });
});

check('inch drawings report their unit', () => {
  const { m } = load([['LINE', 10, 0, 20, 0, 11, 1, 21, 0]], { units: 1 });
  assert.strictEqual(m.units, 'in');
  assert.strictEqual(m.mmPerUnit, 25.4);
});

check('CIRCLE stays an exact circle', () => {
  const { f } = load([['CIRCLE', 10, 50, 20, 60, 40, 8.9]]);
  assert.strictEqual(f.circles.length, 1);
  assert.deepStrictEqual(f.circles[0], { cx: 50, cy: 60, r: 8.9, layer: '0' });
  near(f.bounds.minX, 41.1); near(f.bounds.maxY, 68.9);
});

check('CIRCLE with extrusion -Z mirrors X', () => {
  const { f } = load([['CIRCLE', 10, 50, 20, 60, 40, 5, 210, 0, 220, 0, 230, -1]]);
  near(f.circles[0].cx, -50); near(f.circles[0].cy, 60);
});

check('ARC runs CCW from start to end angle', () => {
  const { f } = load([['ARC', 10, 0, 20, 0, 40, 10, 50, 0, 51, 90]]);
  const p = f.polylines[0].pts;
  near(p[0], 10); near(p[1], 0);
  near(p[p.length - 2], 0, 1e-9); near(p[p.length - 1], 10);
  for (let i = 0; i < p.length; i += 2) near(Math.hypot(p[i], p[i + 1]), 10, 1e-9, 'on radius');
});

check('ARC crossing 0 degrees wraps (350 -> 10)', () => {
  const { f } = load([['ARC', 10, 0, 20, 0, 40, 10, 50, 350, 51, 10]]);
  const p = f.polylines[0].pts;
  /* every point has x > 9 (short 20-degree sweep, not the long way round) */
  for (let i = 0; i < p.length; i += 2) assert.ok(p[i] > 9.8, 'short sweep');
});

check('ARC chord error stays within tolerance', () => {
  const r = 100, tol = 0.05;
  const n = C.cadArcSegments(r, Math.PI / 2, tol);
  const sag = r * (1 - Math.cos(Math.PI / 2 / n / 2));
  assert.ok(sag <= tol + 1e-12, 'sagitta ' + sag);
});

check('ARC with extrusion -Z mirrors (SolidWorks-style export)', () => {
  const { f } = load([['ARC', 10, 10, 20, 0, 40, 5, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1]]);
  const p = f.polylines[0].pts;
  near(p[0], -15); near(p[1], 0);                 /* OCS (15,0) -> WCS (-15,0) */
  near(p[p.length - 2], -10, 1e-9); near(p[p.length - 1], 5);
});

check('LWPOLYLINE closed rectangle', () => {
  const { f } = load([['LWPOLYLINE', 90, 4, 70, 1, 10, 0, 20, 0, 10, 438, 20, 0, 10, 438, 20, 169, 10, 0, 20, 169]]);
  const pl = f.polylines[0];
  assert.strictEqual(pl.closed, true);
  assert.deepStrictEqual(pl.pts.slice(0, 2), [0, 0]);
  assert.deepStrictEqual(pl.pts.slice(-2), [0, 0]);   /* closing segment back to start */
  assert.deepStrictEqual(f.bounds, { minX: 0, minY: 0, maxX: 438, maxY: 169 });
});

check('LWPOLYLINE bulge 1 is a CCW semicircle', () => {
  const pts = C.cadBulgePts([{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 0 }], false, 0.01);
  /* centre (5,0) radius 5; positive bulge = CCW from (0,0) to (10,0) passes below */
  for (const q of pts) near(Math.hypot(q[0] - 5, q[1]), 5, 1e-9, 'on circle');
  const mid = pts[Math.floor(pts.length / 2)];
  assert.ok(mid[1] < -4.9, 'goes through (5,-5): ' + mid);
  assert.deepStrictEqual(pts[pts.length - 1], [10, 0]);
});

check('LWPOLYLINE negative bulge goes the other way', () => {
  const pts = C.cadBulgePts([{ x: 0, y: 0, bulge: -1 }, { x: 10, y: 0, bulge: 0 }], false, 0.01);
  const mid = pts[Math.floor(pts.length / 2)];
  assert.ok(mid[1] > 4.9, 'goes through (5,5)');
});

check('LWPOLYLINE quarter-arc bulge keeps the right radius', () => {
  const b = Math.tan(Math.PI / 8); /* 90 degrees */
  const pts = C.cadBulgePts([{ x: 10, y: 0, bulge: b }, { x: 0, y: 10, bulge: 0 }], false, 0.01);
  for (const q of pts) near(Math.hypot(q[0], q[1]), 10, 1e-9, 'centre at origin');
});

check('POLYLINE / VERTEX / SEQEND (old style)', () => {
  const { f } = load([
    ['POLYLINE', 66, 1, 70, 1, 10, 0, 20, 0],
    ['VERTEX', 10, 0, 20, 0], ['VERTEX', 10, 5, 20, 0], ['VERTEX', 10, 5, 20, 5],
    ['SEQEND'],
    ['LINE', 10, 100, 20, 100, 11, 101, 21, 100],
  ]);
  assert.strictEqual(f.polylines.length, 2);
  assert.strictEqual(f.polylines[0].pts.length, 8);  /* 3 vertices + closing point */
  assert.strictEqual(f.polylines[0].closed, true);
});

check('SPLINE clamped cubic hits its end control points', () => {
  const ents = [['SPLINE', 70, 8, 71, 3, 72, 8, 73, 4,
    40, 0, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 40, 1,
    10, 0, 20, 0, 10, 10, 20, 20, 10, 30, 20, 20, 10, 40, 20, 0]];
  const { f } = load(ents);
  const p = f.polylines[0].pts;
  near(p[0], 0); near(p[1], 0);
  near(p[p.length - 2], 40); near(p[p.length - 1], 0);
  /* Bezier midpoint: (0 + 3*10 + 3*30 + 40)/8 = 20, (0 + 60 + 60 + 0)/8 = 15 */
  let best = Infinity;
  for (let i = 0; i < p.length; i += 2) best = Math.min(best, Math.hypot(p[i] - 20, p[i + 1] - 15));
  assert.ok(best < 0.5, 'passes near the curve midpoint, off by ' + best);
});

check('SPLINE rational quarter circle (weights)', () => {
  const w = Math.SQRT1_2;
  const sp = { degree: 2, flags: 0, knots: [0, 0, 0, 1, 1, 1], weights: [1, w, 1], ctrl: [[10, 0], [10, 10], [0, 10]], fit: [] };
  for (const q of C.cadSplinePts(sp, 0.01)) near(Math.hypot(q[0], q[1]), 10, 1e-9, 'exact circle');
});

check('SPLINE with only fit points falls back to them', () => {
  const sp = { degree: 3, flags: 0, knots: [], weights: [], ctrl: [], fit: [[0, 0], [5, 5], [10, 0]] };
  assert.deepStrictEqual(C.cadSplinePts(sp, 0.05), [[0, 0], [5, 5], [10, 0]]);
});

check('ELLIPSE full and partial', () => {
  const { f } = load([['ELLIPSE', 10, 0, 20, 0, 11, 10, 21, 0, 40, 0.5, 41, 0, 42, Math.PI / 2]]);
  const p = f.polylines[0].pts;
  near(p[0], 10); near(p[1], 0);
  near(p[p.length - 2], 0, 1e-9); near(p[p.length - 1], 5);
});

check('ELLIPSE with extrusion -Z flips the minor axis', () => {
  const { f } = load([['ELLIPSE', 10, 0, 20, 0, 11, 10, 21, 0, 40, 0.5, 41, 0, 42, Math.PI / 2, 210, 0, 220, 0, 230, -1]]);
  const p = f.polylines[0].pts;
  near(p[p.length - 1], -5);
});

check('INSERT places, rotates and scales a block', () => {
  const { f } = load([['INSERT', 8, 'MOD', 2, 'B', 10, 100, 20, 200, 41, 2, 42, 2, 50, 90]], {
    blocks: [{ name: 'B', base: [1, 0], entities: [['LINE', 8, '0', 10, 1, 20, 0, 11, 11, 21, 0], ['CIRCLE', 8, '0', 10, 1, 20, 0, 40, 3]] }],
  });
  const p = f.polylines[0].pts;
  near(p[0], 100); near(p[1], 200);
  near(p[2], 100, 1e-9); near(p[3], 220);          /* 10 long, x2, rotated 90 */
  assert.strictEqual(f.polylines[0].layer, 'MOD'); /* layer 0 inherits the insert layer */
  near(f.circles[0].r, 6);
});

check('INSERT arrays and nested blocks', () => {
  const { f } = load([['INSERT', 2, 'OUTER', 10, 0, 20, 0, 70, 3, 71, 2, 44, 500, 45, 210]], {
    blocks: [
      { name: 'INNER', base: [0, 0], entities: [['CIRCLE', 10, 0, 20, 0, 40, 8.9]] },
      { name: 'OUTER', base: [0, 0], entities: [['INSERT', 2, 'INNER', 10, 30, 20, 10]] },
    ],
  });
  assert.strictEqual(f.circles.length, 6);
  const xs = [...new Set(f.circles.map(c => c.cx))].sort((a, b) => a - b);
  const ys = [...new Set(f.circles.map(c => c.cy))].sort((a, b) => a - b);
  assert.deepStrictEqual(xs, [30, 530, 1030]);
  assert.deepStrictEqual(ys, [10, 220]);
});

check('frozen and off layers are skipped, paper space ignored', () => {
  const { f } = load([
    ['LINE', 8, 'HIDDEN', 10, 0, 20, 0, 11, 1, 21, 0],
    ['LINE', 8, 'OFF', 10, 0, 20, 0, 11, 1, 21, 0],
    ['LINE', 8, 'A', 67, 1, 10, 0, 20, 0, 11, 1, 21, 0],
    ['LINE', 8, 'A', 10, 0, 20, 0, 11, 1, 21, 0],
  ], { layers: [{ name: 'HIDDEN', flags: 1 }, { name: 'OFF', color: -7 }, { name: 'A' }] });
  assert.strictEqual(f.polylines.length, 1);
});

check('unsupported entities are counted, not guessed', () => {
  const { m } = load([['HATCH', 8, '0'], ['LINE', 10, 0, 20, 0, 11, 1, 21, 0], ['3DFACE', 8, '0']]);
  assert.deepStrictEqual(m.unsupported, { HATCH: 1, '3DFACE': 1 });
  assert.strictEqual(m.counts.LINE, 1);
});

check('TEXT and MTEXT are read', () => {
  const { f } = load([['TEXT', 10, 5, 20, 6, 40, 3, 1, 'SSC-1'], ['MTEXT', 10, 0, 20, 0, 40, 2, 1, '{\\fArial;M1}\\PM2']]);
  assert.deepStrictEqual(f.texts.map(t => t.text), ['SSC-1', 'M1\nM2']);
});

check('DWG and binary DXF are rejected with a clear message', () => {
  assert.throws(() => C.cadParseDxf('AC1015\u0000\u0000'), /DWG/);
  assert.throws(() => C.cadParseDxf('AutoCAD Binary DXF\r\n\u001a\u0000'), /Binary DXF/);
  assert.throws(() => C.cadParseDxf('hello world'), /No DXF entities/);
});

check('SVG output uses one user unit per mm and flips Y', () => {
  const { f } = load([['LINE', 10, 0, 20, 0, 11, 100, 21, 50]]);
  const svg = C.cadToSvg(f, { margin: 0, unit: 'mm' });
  assert.ok(svg.includes('viewBox="0 0 100 50"'), svg);
  assert.ok(svg.includes('width="100mm" height="50mm"'));
  assert.ok(svg.includes('M0 50L100 0'), 'Y is flipped');
});

check('LF line endings and stray blank lines are tolerated', () => {
  const text = dxf([['LINE', 10, 1, 20, 2, 11, 3, 21, 4]]).replace(/\r\n/g, '\n');
  const m = C.cadParseDxf(text);
  assert.strictEqual(m.entities.length, 1);
});

/* ---------------- Phase 2: teach once, find every copy ---------------- */

/** A synthetic "module": outline, inner panel, a bulged handle and 4 terminals. */
function modulePart(ox, oy, mirror) {
  const X = (x) => mirror ? ox + 400 - x : ox + x;
  const pts = (arr) => arr.flatMap(([x, y]) => [10, X(x), 20, oy + y]);
  const ents = [
    ['LWPOLYLINE', 90, 4, 70, 1, ...pts([[0, 0], [400, 0], [400, 170], [0, 170]])],
    ['LWPOLYLINE', 90, 4, 70, 1, ...pts([[20, 100], [380, 100], [380, 160], [20, 160]])],
    ['LINE', 10, X(150), 20, oy + 20, 11, X(250), 21, oy + 20],
    ['LINE', 10, X(150), 20, oy + 40, 11, X(250), 21, oy + 40],
    ['ARC', 10, X(200), 20, oy + 70, 40, 12, 50, 0, 51, 180],
  ];
  for (const tx of [25, 85, 300, 350]) ents.push(['CIRCLE', 10, X(tx), 20, oy + 60, 40, 8.9], ['CIRCLE', 10, X(tx), 20, oy + 60, 40, 4]);
  return ents;
}
/** A synthetic SSC: a big panel with its own circles; it contains nothing module-like. */
function sscPart(ox, oy) {
  return [
    ['LWPOLYLINE', 90, 4, 70, 1, 10, ox, 20, oy, 10, ox + 400, 20, oy, 10, ox + 400, 20, oy + 380, 10, ox, 20, oy + 380],
    ['LWPOLYLINE', 90, 4, 70, 1, 10, ox + 50, 20, oy + 50, 10, ox + 350, 20, oy + 50, 10, ox + 350, 20, oy + 330, 10, ox + 50, 20, oy + 330],
    ['CIRCLE', 10, ox + 200, 20, oy + 190, 40, 30],
    ['CIRCLE', 10, ox + 100, 20, oy + 20, 40, 6], ['CIRCLE', 10, ox + 300, 20, oy + 20, 40, 6],
  ];
}
/** 3 columns x 3 rows of modules (500 x 210 pitch), a bottom rail through row 0, two SSCs. */
function rackDrawing(opts) {
  const o = opts || {};
  const ents = [];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) ents.push(...modulePart(c * 500, r * 210, o.mirrorCol === c));
  /* rail pieces only in the bottom row, crossing each module box */
  for (let c = 0; c < 3; c++) {
    ents.push(['LINE', 10, c * 500 + 5, 20, 5, 11, c * 500 + 395, 21, 5], ['LINE', 10, c * 500 + 5, 20, 9, 11, c * 500 + 395, 21, 9]);
    for (let k = 0; k < 6; k++) ents.push(['CIRCLE', 10, c * 500 + 30 + k * 60, 20, 7, 40, 1.5]);
  }
  ents.push(...sscPart(1500, 0), ...sscPart(2000, 0));
  ents.push(['LINE', 10, -100, 20, -50, 11, 2600, 21, -50]); /* frame */
  const m = C.cadParseDxf(dxf(ents));
  const f = C.cadFlatten(m);
  return { f, index: C.cadFeatureIndex(C.cadFeatures(f), 1) };
}
const terminalsAt = (ox, oy) => [25, 85, 300, 350].map((x, i) => ({ role: ['comm-S', 'comm-N', 'power-', 'power+'][i], x: ox + x, y: oy + 60 }));

check('teach on a clean copy finds every module', () => {
  const { index } = rackDrawing();
  const sig = C.cadTeachSignature(index, { x0: 495, y0: 415, x1: 905, y1: 595 }, { kind: 'module', terminals: terminalsAt(500, 420) });
  const hits = C.cadFindMatches(index, C.cadRefineSignature(index, sig));
  assert.strictEqual(hits.length, 9);
  const xs = [...new Set(hits.map(h => Math.round(h.x0 + 5)))].sort((a, b) => a - b);
  assert.deepStrictEqual(xs, [0, 500, 1000]);
});

check('terminals taught once are placed on every copy', () => {
  const { index } = rackDrawing();
  const sig = C.cadTeachSignature(index, { x0: 495, y0: 415, x1: 905, y1: 595 }, { kind: 'module', terminals: terminalsAt(500, 420) });
  const hits = C.cadFindMatches(index, sig);
  const t = hits.find(h => Math.abs(h.x0 + 5) < 1e-6 && Math.abs(h.y0 + 5) < 1e-6).terminals;
  assert.deepStrictEqual(t.map(q => q.role), ['comm-S', 'comm-N', 'power-', 'power+']);
  near(t[0].x, 25); near(t[0].y, 60); near(t[3].x, 350);
  assert.strictEqual(hits.flatMap(h => h.terminals).length, 36);
});

check('teaching on a bottom-row copy with a rail through it still finds all', () => {
  const { index } = rackDrawing();
  const raw = C.cadTeachSignature(index, { x0: -5, y0: -5, x1: 405, y1: 175 }, { kind: 'module' });
  assert.ok(C.cadFindMatches(index, raw).length < 9, 'the rail makes the raw example unique to row 0');
  const sig = C.cadRefineSignature(index, raw);
  assert.ok(sig.features.length < raw.features.length, 'rail features dropped');
  assert.strictEqual(C.cadFindMatches(index, sig).length, 9);
});

check('mirrored copies are found only when mirror is allowed', () => {
  const { index } = rackDrawing({ mirrorCol: 2 });
  const sig = C.cadTeachSignature(index, { x0: 495, y0: 415, x1: 905, y1: 595 }, { kind: 'module', terminals: terminalsAt(500, 420) });
  assert.strictEqual(C.cadFindMatches(index, sig).length, 6);
  const both = C.cadFindMatches(index, sig, { mirror: true });
  assert.strictEqual(both.length, 9);
  const m = both.filter(h => h.mirrored);
  assert.strictEqual(m.length, 3);
  /* mirrored comm-S terminal sits at the right-hand end */
  near(m[0].terminals[0].x, 1000 + 400 - 25);
});

check('recognise reports each kind once and numbers them left to right', () => {
  const { index } = rackDrawing();
  const sigs = [
    C.cadTeachSignature(index, { x0: 495, y0: 415, x1: 905, y1: 595 }, { kind: 'module' }),
    C.cadTeachSignature(index, { x0: 1495, y0: -5, x1: 1905, y1: 385 }, { kind: 'ssc' }),
  ];
  const comps = C.cadRecognise(index, sigs);
  assert.strictEqual(comps.filter(c => c.kind === 'module').length, 9);
  assert.deepStrictEqual(comps.filter(c => c.kind === 'ssc').map(c => c.id), ['ssc-1', 'ssc-2']);
  near(comps.find(c => c.id === 'ssc-2').x0, 1995);
});

check('a box with almost nothing in it is refused', () => {
  const { index } = rackDrawing();
  assert.throws(() => C.cadTeachSignature(index, { x0: 450, y0: 300, x1: 480, y1: 310 }, { kind: 'module' }), /too little geometry/);
});

check('a part that occurs once is kept whole by refinement', () => {
  const { index } = rackDrawing();
  const raw = C.cadTeachSignature(index, { x0: 1495, y0: -5, x1: 1905, y1: 385 }, { kind: 'ssc' });
  const sig = C.cadRefineSignature(index, raw);
  assert.strictEqual(sig.features.length, raw.features.length);
});

check('a sub-pattern shared with another part does not take over the signature', () => {
  /* JB = long box with 2 connectors; a separate strip elsewhere has 6 identical connectors */
  const conn = (x, y) => [
    ['LWPOLYLINE', 90, 4, 70, 1, 10, x, 20, y, 10, x + 20, 20, y, 10, x + 20, 20, y + 20, 10, x, 20, y + 20],
    ['CIRCLE', 10, x + 10, 20, y + 10, 40, 6], ['CIRCLE', 10, x + 3, 20, y + 3, 40, 1.2], ['CIRCLE', 10, x + 17, 20, y + 17, 40, 1.2],
  ];
  const jb = (x, y) => [
    ['LWPOLYLINE', 90, 4, 70, 1, 10, x, 20, y, 10, x + 400, 20, y, 10, x + 400, 20, y + 90, 10, x, 20, y + 90],
    ['LINE', 10, x + 10, 20, y + 80, 11, x + 390, 21, y + 80],
    ['CIRCLE', 10, x + 70, 20, y + 45, 40, 15], ['CIRCLE', 10, x + 130, 20, y + 45, 40, 15],
    ...conn(x + 200, y + 35), ...conn(x + 270, y + 35),
  ];
  const ents = [];
  for (let c = 0; c < 3; c++) {
    ents.push(...jb(c * 1000, 1000));
    for (let k = 0; k < 6; k++) ents.push(...conn(c * 1000 + 20 + k * 60, 200)); /* connector strip */
  }
  const f = C.cadFlatten(C.cadParseDxf(dxf(ents)));
  const index = C.cadFeatureIndex(C.cadFeatures(f), 1);
  const sig = C.cadRefineSignature(index, C.cadTeachSignature(index, { x0: -5, y0: 995, x1: 405, y1: 1095 }, { kind: 'jb' }));
  const hits = C.cadFindMatches(index, sig);
  assert.deepStrictEqual(hits.map(h => Math.round(h.y0)), [995, 995, 995]);
});

check('ACDP1 is the ACDP closest to the MSM, then the next closest', () => {
  const box = (kind, x, y, w, h) => ({ kind, x0: x, y0: y, x1: x + w, y1: y + h });
  /* 111-like: ACDPs above SSC-2 and directly under the MSM in the last column */
  const msm = box('msm', 7300, 1612, 428, 286);
  const farLeft = box('acdp', 1290, 1492, 470, 180);
  const left = box('acdp', 4290, 1492, 470, 180);
  const underMsm = box('acdp', 7290, 1439, 470, 180);
  const n = C.cadProposeNumbers([farLeft, left, msm, underMsm]);
  assert.strictEqual(n.get(underMsm), 1);
  assert.strictEqual(n.get(left), 2);
  assert.strictEqual(n.get(farLeft), 3);
  assert.strictEqual(n.get(msm), 1);
});

check('without an MSM, ACDPs and MSMs are numbered left to right', () => {
  const a = { kind: 'acdp', x0: 900, y0: 0, x1: 1000, y1: 100 }, b = { kind: 'acdp', x0: 100, y0: 0, x1: 200, y1: 100 };
  const n = C.cadProposeNumbers([a, b]);
  assert.strictEqual(n.get(b), 1);
  assert.strictEqual(n.get(a), 2);
  const m1 = { kind: 'msm', x0: 500, y0: 0, x1: 600, y1: 100 }, m2 = { kind: 'msm', x0: 50, y0: 0, x1: 150, y1: 100 };
  const nm = C.cadProposeNumbers([m1, m2]);
  assert.strictEqual(nm.get(m2), 1);
  assert.strictEqual(nm.get(m1), 2);
});

check('SSC1 is the SSC closest to the MSM, then the next closest', () => {
  /* 111 layout: five SSCs, MSM above the last one */
  const msm = { kind: 'msm', x0: 7300, y0: 1612, x1: 7728, y1: 1898 };
  const sscs = [3360, 4360, 5360, 6360, 7360].map(x => ({ kind: 'ssc', x0: x, y0: x === 7360 ? 1052 : 1098, x1: x + 340, y1: (x === 7360 ? 1052 : 1098) + 392 }));
  const n = C.cadProposeNumbers([...sscs, msm]);
  assert.deepStrictEqual(sscs.map(s => n.get(s)), [5, 4, 3, 2, 1]);
  /* no MSM: left to right */
  const n2 = C.cadProposeNumbers(sscs);
  assert.deepStrictEqual(sscs.map(s => n2.get(s)), [1, 2, 3, 4, 5]);
});

/* Optional: real rack drawing. Extents must equal AutoCAD's $EXTMIN/$EXTMAX. */
const real = process.env.WIREFLOW_DXF;
if (real) {
  check('real drawing: extents match AutoCAD and nothing is skipped', () => {
    const m = C.cadParseDxf(fs.readFileSync(real, 'utf8'));
    const f = C.cadFlatten(m);
    const s = C.cadSummary(m, f);
    assert.ok(m.extMin && m.extMax, 'header extents present');
    near(s.bounds.minX, m.extMin.x, 0.01, 'minX'); near(s.bounds.minY, m.extMin.y, 0.01, 'minY');
    near(s.bounds.maxX, m.extMax.x, 0.01, 'maxX'); near(s.bounds.maxY, m.extMax.y, 0.01, 'maxY');
    assert.strictEqual(s.skipped, 0, JSON.stringify(s.unsupported));
    console.log(`  ${path.basename(real)}: ${s.entities} entities, ${s.width.toFixed(1)} x ${s.height.toFixed(1)} ${s.units}`);
  });
}

console.log(`CAD reader tests passed: ${passed}${real ? '' : ' (set WIREFLOW_DXF to also check a real drawing)'}`);
