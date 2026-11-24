/* Electrical diagram sheets and PDF (js/elecsheet.js). Run: node tests/elecsheet.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
const L = new Function(src('pdf.js') + src('elec.js').replace(/if \(typeof module[^\n]*\n?/, '') + src('elecsheet.js').replace(/if \(typeof module[^\n]*\n?/, '') +
  '\nreturn { pdfDoc, elecNewSetup, elecSheets, elecLinks, elecDraw, elecPdf, elecPathPolys, ELEC_OPTIONS };')();
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'elec', 'parts.json'), 'utf8'));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

(async () => {
  ok(JSON.stringify(L.elecPathPolys('M0 0L1 0L1 1ZM5 5L6 6')) === JSON.stringify([[0, 0, 1, 0, 1, 1, 0, 0], [5, 5, 6, 6]]), 'path data to polylines');

  /* a 6-SSC bank: two ACDPs, SSC1-3 in rack 1 with the MSM, SSC4-6 in rack 2 */
  const s = L.elecNewSetup();
  s.banks.push({ id: 'b', name: 'Bank 1', msm: { name: 'MSM-1', rack: 'Rack 1', model: 6 }, acdps: [{ name: 'ACDP1', rack: 'Rack 1' }, { name: 'ACDP2', rack: 'Rack 2' }] });
  for (let i = 1; i <= 6; i++) s.sscs.push({ id: 's' + i, name: 'SSC' + i, rack: i <= 3 ? 'Rack 1' : 'Rack 2', bank: 'b', fans: 2, modules: i === 1 ? 12 : i === 3 ? 2 : null });
  for (const o of L.ELEC_OPTIONS) s.options[o.id] = true;
  s.valves = 2; s.jbModel = 4; s.confirmed = true;

  /* what each sheet draws, recorded through a fake target */
  const calls = [];
  const rec = { pages: 1, newPage() { this.pages++; return this; }, poly(p, o) { calls.push(['poly', this.pages, o, p]); return this; }, line(x1, y1, x2, y2, o) { calls.push(['poly', this.pages, o, [x1, y1, x2, y2]]); return this; }, rect() { return this; },
    circle() { return this; }, text(t) { calls.push(['text', this.pages, t]); return this; } };
  const sheets = L.elecDraw(rec, s, lib, { title: 'S10195 Battery System Electrical Connection Diagram', docNumber: 'DWG2527', rev: '0', drawnBy: 'AYK', date: '2026.11.23' });
  ok(rec.pages === sheets.length && sheets.length === 11, 'one page per sheet (11)');
  const texts = p => calls.filter(c => c[0] === 'text' && c[1] === p).map(c => c[2]);
  const all = p => texts(p).join(' ').replace(/\s+/g, ' ');
  for (const sh of sheets) ok(texts(sh.n).includes(`Sheet ${sh.n} of 11`), `sheet ${sh.n} numbered in its title block`);
  /* sheet 1: AYK's notes, editable */
  ok(/only need to connect to the primary ports/.test(all(1)) && /Figure 1/.test(all(1)), 'sheet 1: the MSM notes and figure 1');
  ok(/Inline Connector Wiring Instructions/.test(all(2)) && /SSC_Cooling_Fan_Power/.test(all(2)), 'sheet 2: instructions and the cable legend');
  /* sheet 3: MSM with ACDP1 */
  ok(texts(3).includes('To SSC1 CommP · Sheet 4') && texts(3).includes('To SSC4 Estop · Sheet 7'), 'MSM sheet: leads name the SSC and its sheet');
  ok(!texts(3).some(t => /To SSC\d CommB/.test(t)), 'MSM sheet: no backup comm leads');
  ok(texts(3).includes('ACDP1 Back') && texts(3).includes('To SSC3 PowerP · Sheet 5'), 'MSM sheet: ACDP1 below it, feeding SSC1-3');
  ok(!texts(3).some(t => /MSM-1 Power|To ACDP1 MSM/.test(t)), 'MSM power drawn straight to ACDP1, not as labels');
  ok(texts(3).includes('Not in use') && /Valve 1/.test(all(3)) && /Client-side/.test(all(3)) && /230VAC Control Power/.test(all(3)), 'MSM sheet: Ex.FanFB not in use, valves, customer signals, AC in');
  /* no two leads on the MSM sheet cross, except PowerP/PowerB on their way to ACDP1 (as DWG2527) */
  const leads = calls.filter(c => c[0] === 'poly' && c[1] === 3 && c[2] && (c[2].w === 0.35 || c[2].w === 0.45)).map(c => c[3]);
  const segs = leads.map(p => { const r = []; for (let i = 0; i + 3 < p.length; i += 2) r.push([p[i], p[i + 1], p[i + 2], p[i + 3]]); return r; });
  const cross = (a, b) => { const v = a[0] === a[2], w = b[0] === b[2]; if (v === w) return false; const [V, H] = v ? [a, b] : [b, a];
    const x = V[0], y = H[1], e = 0.01; return x > Math.min(H[0], H[2]) + e && x < Math.max(H[0], H[2]) - e && y > Math.min(V[1], V[3]) + e && y < Math.max(V[1], V[3]) - e; };
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) for (const a of segs[i]) for (const b of segs[j]) if (cross(a, b)) crossings++;
  ok(crossings === 1, 'MSM sheet: leads never cross (one power crossing, as DWG2527); found ' + crossings);
  /* SSC backs, two per sheet */
  ok(texts(4).includes('From MSM-1 SSC1P · Sheet 3') && texts(4).includes('From ACDP1 SSC1P · Sheet 3'), 'SSC back sheet: comm from the MSM, power from ACDP1');
  ok(texts(4).includes('SSC1 Back') && texts(4).includes('SSC2 Back') && !texts(4).includes('SSC3 Back'), 'two SSC backs per sheet');
  ok(texts(4).filter(t => /^Cooling Fan \d$/.test(t)).length === 4, 'cooling fans: two for each SSC');
  ok(texts(7).includes('From ACDP2 SSC1P · Sheet 6'), 'SSC4 power from ACDP2');
  ok(!texts(4).some(t => /Ext-HVIL ·|To .* Ext-HVIL/.test(t)), 'no Ext-HVIL lead');
  ok(texts(6).includes('To SSC4 PowerP · Sheet 7'), 'ACDP2 sheet: SSC power');
  ok(texts(9).includes('Junction Box Front') && texts(10).some(t => /SSC4 Front/.test(t)), 'fronts sheets: junction box and SSC fronts');
  ok(calls.filter(c => c[0] === 'text' && c[1] === 9 && /^Bus[+-]$/.test(c[2])).length === 4, '4-connector junction box: all four Bus names drawn');
  /* the module string beside each SSC front (DWG2527 sheet 7) */
  ok(texts(9).includes('Module 12') && texts(9).includes('Modules 3 to 11') && texts(9).includes('Module n') && texts(9).filter(t => t === 'Module 1').length === 2, 'fronts: Module 1, 2 and the last one for each SSC (n when not given)');
  ok(texts(10).filter(t => t === 'Module 2').length === 2 && texts(10).filter(t => /^Module n$/.test(t)).length === 1 && texts(10).filter(t => /^Modules 3/.test(t)).length === 1, 'an SSC with two modules (SSC3) draws both and no gap');
  const crossingsOn = page => {
    const sg = calls.filter(c => c[0] === 'poly' && c[1] === page && c[2] && (c[2].w === 0.35 || c[2].w === 0.45)).map(c => c[3])
      .map(p => { const r = []; for (let i = 0; i + 3 < p.length; i += 2) r.push([p[i], p[i + 1], p[i + 2], p[i + 3]]); return r; });
    let k = 0; for (let i = 0; i < sg.length; i++) for (let j = i + 1; j < sg.length; j++) for (const a of sg[i]) for (const b of sg[j]) if (cross(a, b)) k++;
    return k;
  };
  ok(crossingsOn(9) === 0, 'fronts sheet: SSC leads, module string and Bus leads never cross; found ' + crossingsOn(9));
  ok(crossingsOn(10) === 1, 'fronts sheet with an SSC of two modules: one unavoidable crossing (S- into Module 1 over the link to Module 2); found ' + crossingsOn(10));
  const greens = calls.filter(c => c[0] === 'poly' && c[1] === 9 && c[2] && c[2].color === '#16a34a').length;
  ok(greens === 2 * (2 + 2), 'fronts: S and N to the string plus two module-to-module comm links per SSC (' + greens + ')');
  const dashed = calls.filter(c => c[0] === 'poly' && c[1] === 7 && c[2] && c[2].dash).length;
  ok(dashed > 0, 'cables between racks are dashed');
  /* an edited note prints; an emptied one is left off */
  s.notes = { comm: 'OUR OWN COMM NOTE', cloud: '' };
  calls.length = 0; rec.pages = 1;
  L.elecDraw(rec, s, lib, { title: 'x' });
  ok(texts(1).includes('OUR OWN COMM NOTE') && !/Secure Remote access/.test(all(1)), 'edited notes print; emptied notes are left off');
  delete s.notes;

  /* the real PDF */
  const pdf = await L.elecPdf(s, lib, { title: 'S10195', docNumber: 'DWG2527' });
  const raw = Buffer.from(pdf).toString('latin1');
  ok(raw.startsWith('%PDF-1.4') && /\/Count 11 /.test(raw), 'PDF with 11 pages');
  ok((raw.match(/\/Type \/Page /g) || []).length === 11, 'eleven page objects');
  const xref = raw.lastIndexOf('xref');
  const offsets = raw.slice(xref).split('\n').slice(3).filter(l => / 00000 n /.test(l)).map(l => +l.slice(0, 10));
  ok(offsets.every((o, i) => raw.startsWith((i + 1) + ' 0 obj', o)), 'xref offsets point at their objects');
  fs.mkdirSync(path.join(ROOT, 'prototype-output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'prototype-output', 'electrical-test.pdf'), pdf);
  console.log('Electrical sheet tests passed: ' + n + ' (' + (pdf.length / 1e6).toFixed(2) + ' MB)');
})().catch(e => { console.error(e); process.exit(1); });
