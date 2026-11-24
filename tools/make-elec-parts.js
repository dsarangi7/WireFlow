/* Builds the part library of the electrical diagram from AYK's part drawings:
 *   assets/elec/parts.json   one entry per part view, geometry only
 *
 *   1-9 …MSM…dxf, 1-6 …, 1-3 …  MSM backs for 9, 6 and 3 SSCs (AYK A2012203, A2012104,
 *               A2008305; 1:1 in mm). Found by their "1-9 ", "1-6 ", "1-3 " name prefix.
 *   SSC.dxf     SSC front (left view) and back (right view), in a 1:5 factory frame
 *   MODULE.dxf  module front (upper view, ports S, N, +, −); its back (lower view) is not used
 *   JUNCTION BOX2.dxf junction box with 2 Bus connectors: front (left view); back not used
 *   JUNCTION BOX4.dxf junction box with 4 Bus connectors: front only
 *   A2012504 AC_Breaker_Panel_12.DXF  ACDP panel (one view, AYK 24 Nov 2026)
 *   P1562 Inline Connector.dxf  AYK's notes sheet with nine inline connectors, drawn in
 *               paper space; all nine are the same drawing, so the leftmost one is kept
 *
 * A drawing missing from the folder keeps the part it gave last time (read back from
 * parts.json), so one absent file never drops a part from the library.
 *
 * Only layer "0" (the part itself) is kept: the frame, title block and notes are
 * dropped. Views are separated by the empty space between them. Coordinates stay in
 * drawing units, Y up; every view is moved so its lower-left corner is 0,0.
 *
 * Run from the repo root (the drawings are in this repo's "Electrical Diagram/CADS" folder):
 *   node tools/make-elec-parts.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const C = new Function(fs.readFileSync(path.join(ROOT, 'js', 'cad.js'), 'utf8') + '\nreturn { cadParseDxf, cadFlatten };')();
const DIR = process.argv[2] || path.join(ROOT, 'Electrical Diagram', 'CADS');
/* which view is which: by position on AYK's drawings */
const PARTS = [
  { id: 'msm', file: /^1-9 .*.dxf$/i, label: 'MSM, 9 SSCs', sscs: 9, views: [{ id: 'back', label: 'MSM back (9 SSCs)' }] },
  { id: 'msm6', file: /^1-6 .*.dxf$/i, label: 'MSM, 6 SSCs', sscs: 6, views: [{ id: 'back', label: 'MSM back (6 SSCs)' }] },
  { id: 'msm3', file: /^1-3 .*.dxf$/i, label: 'MSM, 3 SSCs', sscs: 3, views: [{ id: 'back', label: 'MSM back (3 SSCs)' }] },
  { id: 'ssc', file: 'SSC.dxf', label: 'SSC', order: 'x', views: [{ id: 'front', label: 'SSC front' }, { id: 'back', label: 'SSC back' }] },
  { id: 'jb2', file: 'JUNCTION BOX2.dxf', label: 'Junction box, 2 connectors', order: 'x', views: [{ id: 'front', label: 'Junction box front (2 connectors)' }, { id: 'back', label: 'Junction box back', drop: true }] },
  { id: 'jb4', file: 'JUNCTION BOX4.dxf', label: 'Junction box, 4 connectors', views: [{ id: 'front', label: 'Junction box front (4 connectors)' }] },
  { id: 'acdp', file: 'A2012504 AC_Breaker_Panel_12.DXF', label: 'ACDP (AC breaker panel)', views: [{ id: 'back', label: 'ACDP back' }] },
  { id: 'module', file: 'MODULE.dxf', label: 'Battery module', order: '-y', views: [{ id: 'front', label: 'Module front' }, { id: 'back', label: 'Module back', drop: true }] },
  { id: 'inline', file: 'P1562 Inline Connector.dxf', label: 'Inline connector', paper: true, pick: 'leftmost', views: [{ id: 'side', label: 'Inline connector' }] },
];
const DEST = path.join(ROOT, 'assets', 'elec', 'parts.json');
const before = fs.existsSync(DEST) ? JSON.parse(fs.readFileSync(DEST, 'utf8')) : { parts: [] };

function boxOf(pts) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 2) { b[0] = Math.min(b[0], pts[i]); b[1] = Math.min(b[1], pts[i + 1]); b[2] = Math.max(b[2], pts[i]); b[3] = Math.max(b[3], pts[i + 1]); }
  return b;
}
/** Groups items whose boxes come within `gap` of each other (union-find on a sweep). */
function clusters(items, gap) {
  const parent = items.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const order = items.map((_, i) => i).sort((a, b) => items[a].b[0] - items[b].b[0]);
  const active = [];
  for (const i of order) {
    const bi = items[i].b;
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k], bj = items[j].b;
      if (bj[2] + gap < bi[0]) { active.splice(k, 1); continue; }
      if (bj[1] - gap <= bi[3] && bi[1] - gap <= bj[3]) parent[find(i)] = find(j);
    }
    active.push(i);
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  return [...groups.values()];
}

let r1 = v => Math.round(v * 10) / 10;
/** Drops points within tol of the straight line between the points kept (Douglas-Peucker):
    the curves of a part come tessellated much finer than an A3 sheet can show. */
function simplify(p, tol) {
  const n = p.length / 2;
  if (n < 3) return p;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = p[2 * a], ay = p[2 * a + 1], dx = p[2 * b] - ax, dy = p[2 * b + 1] - ay, len = Math.hypot(dx, dy);
    let worst = -1, far = tol;
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs(dx * (p[2 * i + 1] - ay) - dy * (p[2 * i] - ax)) / len : Math.hypot(p[2 * i] - ax, p[2 * i + 1] - ay);
      if (d > far) { far = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}
const out = { version: 1, source: 'AYK part drawings (Electrical Diagram/CADS)', parts: [] };
/* a file given by a pattern: the one drawing in the folder whose name matches (the newest if several) */
function fileOf(P) {
  if (typeof P.file === 'string') return fs.existsSync(path.join(DIR, P.file)) ? P.file : null;
  const hits = fs.readdirSync(DIR).filter(n => P.file.test(n)).sort((a, b) => fs.statSync(path.join(DIR, b)).mtimeMs - fs.statSync(path.join(DIR, a)).mtimeMs);
  return hits[0] || null;
}
for (const P of PARTS) {
  const file = fileOf(P);
  if (!file) {
    const old = before.parts.find(p => p.id === P.id);
    if (!old) throw new Error(`${String(P.file)} is not in ${DIR} and parts.json has no ${P.id} from before.`);
    for (const v of old.views) { delete v.ports; v.circles = v.circles || []; }
    out.parts.push(old);
    console.log(String(P.file), 'not found: kept the', P.label, 'from the last build');
    continue;
  }
  let text = fs.readFileSync(path.join(DIR, file), 'utf8');
  /* a part drawn on the sheet layout (paper space): read it as if it were in the model */
  if (P.paper) text = text.replace(/\r\n/g, '\n').replace(/\n *67\n *1\n/g, '\n');
  const flat = C.cadFlatten(C.cadParseDxf(text));
  const items = [];
  for (const p of flat.polylines) if (p.layer === '0' && p.pts.length >= 4) items.push({ t: 'l', p: p.pts, closed: p.closed, b: boxOf(p.pts) });
  for (const c of flat.circles) if (c.layer === '0') items.push({ t: 'c', c: c, b: [c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r] });
  /* several copies of one part side by side (the inline connectors): keep the leftmost */
  if (P.pick === 'leftmost') {
    const b = boxOf(items.flatMap(it => [it.b[0], it.b[1], it.b[2], it.b[3]]));
    const first = clusters(items, Math.max(b[2] - b[0], b[3] - b[1]) * 0.01).sort((a, b) => Math.min(...a.map(it => it.b[0])) - Math.min(...b.map(it => it.b[0])))[0];
    items.splice(0, items.length, ...first);
  }
  const all = boxOf(items.flatMap(it => [it.b[0], it.b[1], it.b[2], it.b[3]]));
  const span = Math.max(all[2] - all[0], all[3] - all[1]);
  /* keep about 1/5000 of the part's size: 0.1 on an SSC, 0.01 on the MSM (drawn ~10x smaller) */
  const q = Math.pow(10, Math.round(Math.log10(5000 / span)));
  r1 = v => Math.round(v * q) / q;
  /* a part with one view (MSM back) keeps everything; otherwise the views are the largest groups */
  const found = (P.views.length === 1 ? [items] : clusters(items, span * 0.01)).map(g => ({ g, b: boxOf(g.flatMap(it => [it.b[0], it.b[1], it.b[2], it.b[3]])) }))
    .sort((a, b) => (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) - (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]));
  let groups = found.slice(0, P.views.length);
  /* detail floating inside a view without touching its lines (the module's RJ45 jacks and
     power sockets) belongs to that view */
  for (const o of found.slice(P.views.length)) {
    const home = groups.find(G => o.b[0] >= G.b[0] && o.b[2] <= G.b[2] && o.b[1] >= G.b[1] && o.b[3] <= G.b[3]);
    if (home) home.g = home.g.concat(o.g);
  }
  if (P.order === 'x') groups.sort((a, b) => a.b[0] - b.b[0]);
  if (P.order === '-y') groups.sort((a, b) => b.b[1] - a.b[1]);
  const part = { id: P.id, label: P.label, file: file, views: [] };
  if (P.sscs) part.sscs = P.sscs;
  groups.forEach((G, i) => {
    const [x0, y0, x1, y1] = G.b;
    let d = '';
    const circles = [];
    for (const it of G.g) {
      if (it.t === 'c') { circles.push([r1(it.c.cx - x0), r1(it.c.cy - y0), r1(it.c.r)]); continue; }
      const p = simplify(it.p, 1 / q);
      let s = 'M' + r1(p[0] - x0) + ' ' + r1(p[1] - y0);
      let lx = r1(p[0] - x0), ly = r1(p[1] - y0);
      for (let k = 2; k < p.length; k += 2) {
        const x = r1(p[k] - x0), y = r1(p[k + 1] - y0);
        if (x === lx && y === ly) continue;
        s += 'L' + x + ' ' + y; lx = x; ly = y;
      }
      if (it.closed) s += 'Z';
      d += s;
    }
    part.views.push({ id: P.views[i].id, label: P.views[i].label, w: r1(x1 - x0), h: r1(y1 - y0), at: [r1(x0), r1(y0)], d: d, circles: circles });
  });
  /* views not used on the diagram are left out (the module back, AYK 20 Nov 2026) */
  part.views = part.views.filter(v => !P.views.find(x => x.id === v.id).drop);
  out.parts.push(part);
  console.log(file, part.views.map(v => `${v.label} ${v.w} x ${v.h}, ${v.circles.length} circles, ${(v.d.length / 1024).toFixed(0)} kB`).join(' | '));
}
/* ---------- ports ----------
 * Connectors are found from their rings (circles of one size repeated across the panel)
 * and named. `sure` is true when the name follows from something certain (the connector
 * type by its pin count, the order AYK's DWG2527 shows, or a layout AYK confirmed);
 * false for a proposal by position that an engineer must confirm. Any change in a drawing that breaks a count
 * stops the build instead of naming the wrong port. */
const near = (a, b, t) => Math.abs(a - b) <= t;
function ringsOf(v, r, tol) {
  const seen = [];
  for (const c of v.circles) if (near(c[2], r, tol) && !seen.some(s => near(s[0], c[0], tol) && near(s[1], c[1], tol))) seen.push([c[0], c[1]]);
  return seen;
}
const readingOrder = (a, b) => (Math.abs(a[1] - b[1]) > 1e-6 && Math.round(b[1] * 2) !== Math.round(a[1] * 2) ? b[1] - a[1] : a[0] - b[0]);
function expect(list, n, what) { if (list.length !== n) throw new Error(`${what}: expected ${n}, found ${list.length}. Check the drawing.`); return list; }
const port = (name, at, kind, size, sure, extra) => Object.assign({ name: name, x: +at[0].toFixed(3), y: +at[1].toFixed(3), kind: kind, size: size, sure: sure }, extra || {});

/* MSM back, for 3, 6 or 9 SSCs. The old MSM.dxf was drawn at 1:10 and AYK's model drawings
 * are 1:1, so sizes are scaled by k (1 or 10).
 * RJ45 jacks: 4 + 2 per SSC. 9 and 6 SSCs: the top row is Cloud, EMS, PCS, Spare, then SSC1P,
 * SSC1B, SSC2P … row by row (confirmed 20 Nov 2026; DWG2527 shows the 6). 3 SSCs: Cloud, EMS,
 * PCS; a row of SSC1-3 P; a row of SSC1-3 B; Spare alone (AYK's MSM-1 picture).
 * Round connectors: the pin count tells the type. 3-pin PowerP, PowerB and 7-pin Valve 1, 2
 * left to right; 4-pin Estop1… in reading order and RemoteE the last 4-pin. On the 9 a 2-pin is
 * Dry Contact and a 5-pin Ex.FanFB (confirmed). The 6 has no 5-pin and the 3 no 2-pin: the one
 * 4-pin left between the E-stops and RemoteE takes the missing name. Those two names on the 3
 * and 6 differ from AYK's pictures, so they stay unconfirmed until AYK confirms them. */
function msmPorts(v, sscs) {
  const k = v.w > 100 ? 10 : 1, ports = [];
  const rjSize = 2.16 * k, rSize = 1.28 * k;
  const rows = list => { const out = []; for (const p of list.slice().sort((a, b) => b[1] - a[1])) { let r = out.find(r => near(r.y, p[1], 0.3 * k)); if (!r) out.push(r = { y: p[1], ps: [] }); r.ps.push(p); } return out.map(r => r.ps.sort((a, b) => a[0] - b[0])); };
  const rj = rows(expect(ringsOf(v, 1.08 * k, 0.006 * k), 4 + 2 * sscs, `MSM (${sscs} SSCs) Ethernet jacks`));
  if (sscs === 3) {
    if (rj.map(r => r.length).join() !== '3,3,3,1') throw new Error('MSM (3 SSCs) Ethernet jacks: expected rows of 3, 3, 3, 1. Check the drawing.');
    ['Cloud', 'EMS', 'PCS'].forEach((n, i) => ports.push(port(n, rj[0][i], 'rj45', rjSize, true)));
    for (let i = 0; i < 3; i++) ports.push(port(`SSC${i + 1}P`, rj[1][i], 'rj45', rjSize, true), port(`SSC${i + 1}B`, rj[2][i], 'rj45', rjSize, true));
    ports.push(port('Spare', rj[3][0], 'rj45', rjSize, true));
  } else {
    expect(rj[0], 4, 'MSM top row of Ethernet jacks');
    ['Cloud', 'EMS', 'PCS', 'Spare'].forEach((n, i) => ports.push(port(n, rj[0][i], 'rj45', rjSize, true)));
    rj.slice(1).flat().forEach((p, i) => ports.push(port(`SSC${(i >> 1) + 1}${i % 2 ? 'B' : 'P'}`, p, 'rj45', rjSize, true)));
  }
  const round = expect(ringsOf(v, 0.64 * k, 0.006 * k), sscs + 7, `MSM (${sscs} SSCs) round connectors`).map(p => {
    const pins = v.circles.filter(c => Math.hypot(c[0] - p[0], c[1] - p[1]) < 0.62 * k && c[2] < 0.6 * k);
    const holes = []; for (const c of pins) if (!holes.some(h => near(h[0], c[0], 0.01 * k) && near(h[1], c[1], 0.01 * k))) holes.push(c);
    return { at: p, pins: holes.length };
  });
  const reading = rows(round.map(r => r.at)).flat();
  round.sort((a, b) => reading.indexOf(a.at) - reading.indexOf(b.at));
  const of = n => round.filter(r => r.pins === n);
  expect(of(3), 2, 'MSM 3-pin (PowerP/B)'); expect(of(7), 2, 'MSM 7-pin (valves)');
  const two = of(2), five = of(5), four = of(4);
  if (two.length > 1 || five.length > 1 || four.length !== sscs + 1 + (1 - two.length) + (1 - five.length)) throw new Error(`MSM (${sscs} SSCs): unexpected pin counts. Check the drawing.`);
  const sure9 = sscs === 9;
  if (two.length) ports.push(port('Dry Contact', two[0].at, 'round', rSize, sure9, { pins: 2 }));
  if (five.length) ports.push(port('Ex.FanFB', five[0].at, 'round', rSize, sure9, { pins: 5 }));
  ['PowerP', 'PowerB'].forEach((n, i) => ports.push(port(n, of(3)[i].at, 'round', rSize, true, { pins: 3 })));
  ['Valve 1', 'Valve 2'].forEach((n, i) => ports.push(port(n, of(7)[i].at, 'round', rSize, true, { pins: 7 })));
  four.forEach((r, i) => {
    const name = i < sscs ? 'Estop' + (i + 1) : i === four.length - 1 ? 'RemoteE' : (two.length ? 'Ex.FanFB' : 'Dry Contact');
    ports.push(port(name, r.at, 'round', rSize, i < sscs || i === four.length - 1, { pins: 4 }));
  });
  const big = ringsOf(v, 3.3 * k, 0.01 * k)[0];
  if (big) ports.push(port('19-pin connector', big, 'round', 6.6 * k, true, { unused: true }));
  return ports;
}
/* ACDP panel: one row of 10 connectors, 8 small then 2 larger (AC in), named left to right
 * in the order AYK gave: SSC3B, SSC3P, SSC2B, SSC2P, SSC1B, SSC1P, MSMB, MSMP, ACPowerInB, ACPowerInP */
function acdpPorts(v) {
  const small = expect(ringsOf(v, 6.4, 0.06), 8, 'ACDP small connectors');
  const big = expect(ringsOf(v, 10.1, 0.06), 2, 'ACDP AC-in connectors');
  const row = small.concat(big).sort((a, b) => a[0] - b[0]);
  if (Math.max(...row.map(p => p[1])) - Math.min(...row.map(p => p[1])) > 1) throw new Error('ACDP connectors are not in one row. Check the drawing.');
  if (row.slice(8).some(p => !big.includes(p))) throw new Error('ACDP AC-in connectors are not at the right end. Check the drawing.');
  const names = ['SSC3B', 'SSC3P', 'SSC2B', 'SSC2P', 'SSC1B', 'SSC1P', 'MSMB', 'MSMP', 'ACPowerInB', 'ACPowerInP'];
  return row.map((p, i) => port(names[i], p, 'round', i < 8 ? 12.8 : 20.2, true));
}
/* junction box front: Bus+, Bus-, Bus+, Bus- left to right (confirmed by AYK, 20 Nov 2026) */
function jbPorts(v, n, ring) {
  const row = ringsOf(v, ring, 0.06).sort((a, b) => a[0] - b[0]);
  expect(row, n, `junction box front (${n} Bus connectors)`);
  return row.map((p, i) => port(i % 2 ? 'Bus-' : 'Bus+', p, 'round', ring * 2, true));
}
/* module front: the two power sockets (rings r7) on the right, + above − as the drawing marks
   them; the two RJ45 jacks on the left, found by their corner screws (r3, two per jack). The
   jacks carry no mark on the drawing: N above, S below, read from DWG2527 sheet 7 (S, N, −, +
   left to right there) turned onto this view the way its + and − turn. To confirm with AYK. */
function modulePorts(v) {
  const power = expect(ringsOf(v, 7, 0.05), 2, 'module power sockets').sort((a, b) => b[1] - a[1]);
  const screws = ringsOf(v, 3, 0.05).filter(p => p[0] > v.w * 0.15 && p[0] < v.w / 2).sort((a, b) => b[1] - a[1]);
  expect(screws, 4, 'module RJ45 jack screws');
  const jack = k => [(screws[2 * k][0] + screws[2 * k + 1][0]) / 2, (screws[2 * k][1] + screws[2 * k + 1][1]) / 2];
  return [port('N', jack(0), 'rj45', 26, false), port('S', jack(1), 'rj45', 26, false),
    port('+', power[0], 'round', 28, true), port('-', power[1], 'round', 28, true)];
}
/* inline connector: the two cable ends, centred on its top and bottom (one cable enters each half) */
function inlinePorts(v) {
  if (v.h < v.w * 2) throw new Error('Inline connector: expected a tall drawing (cable ends top and bottom). Check the drawing.');
  return [port('top', [v.w / 2, v.h], 'end', v.w, true), port('bottom', [v.w / 2, 0], 'end', v.w, true)];
}
function sscPorts(v, side) {
  /* the connector row at the bottom, left to right, in DWG2527's order */
  const names = side === 'back' ? ['PowerP', 'PowerB', 'CommP', 'CommB', 'Ext-HVIL', 'Cooling Fan', 'Estop'] : ['S', 'N', 'S+', 'B+', 'B-', 'S-'];
  const sizes = side === 'back' ? [[6.4, 0.06], [10.8, 0.06], [7.5, 0.06]] : [[10.8, 0.06], [14.8, 0.06]];
  let row = [];
  for (const [r, t] of sizes) row = row.concat(ringsOf(v, r, t));
  const y = Math.min(...row.map(p => p[1]));
  row = row.filter(p => near(p[1], y, 5)).sort((a, b) => a[0] - b[0]);
  expect(row, names.length, `SSC ${side} connectors`);
  const ports = row.map((p, i) => port(names[i], p, 'round', side === 'back' ? 22 : 26, true));
  if (side === 'back') { const big = ringsOf(v, 33, 0.1)[0]; if (big) ports.push(port('19-pin connector', big, 'round', 66, true, { unused: true })); }
  return ports;
}
for (const p of out.parts) for (const v of p.views) {
  if (/^msm/.test(p.id)) v.ports = msmPorts(v, p.sscs || 9);
  else if (p.id === 'ssc') v.ports = sscPorts(v, v.id);
  else if (p.id === 'acdp') v.ports = acdpPorts(v);
  else if (p.id === 'jb2') v.ports = jbPorts(v, 2, 14.8);
  else if (p.id === 'jb4') v.ports = jbPorts(v, 4, 12.5);
  else if (p.id === 'module') v.ports = modulePorts(v);
  else if (p.id === 'inline') v.ports = inlinePorts(v);
  else v.ports = [];
  console.log(v.label, 'ports:', v.ports.map(q => q.name + (q.sure ? '' : '?')).join(', ') || '(none needed)');
}

const dest = path.join(ROOT, 'assets', 'elec', 'parts.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log('->', path.relative(ROOT, dest), (fs.statSync(dest).size / 1024 / 1024).toFixed(2), 'MB');
