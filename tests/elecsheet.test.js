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
  for (let i = 1; i <= 6; i++) s.sscs.push({ id: 's' + i, name: 'SSC' + i, rack: i <= 3 ? 'Rack 1' : 'Rack 2', bank: 'b', fans: 2 });
  for (const o of L.ELEC_OPTIONS) s.options[o.id] = true;
  s.valves = 2; s.jbModel = 4; s.confirmed = true;

  /* what each sheet draws, recorded through a fake target */
  const calls = [];
  const rec = { pages: 1, newPage() { this.pages++; return this; }, poly(p, o) { calls.push(['poly', this.pages, o]); return this; }, line() { return this; }, rect() { return this; },
    circle() { return this; }, text(t) { calls.push(['text', this.pages, t]); return this; } };
  const sheets = L.elecDraw(rec, s, lib, { title: 'S10195 Battery System Electrical Connection Diagram', docNumber: 'DWG2527', rev: '0', drawnBy: 'AYK', date: '2026.11.23' });
  ok(rec.pages === sheets.length && sheets.length === 9, 'one page per sheet (9)');
  const texts = p => calls.filter(c => c[0] === 'text' && c[1] === p).map(c => c[2]);
  for (const sh of sheets) ok(texts(sh.n).includes(`Sheet ${sh.n} of 9`), `sheet ${sh.n} numbered in its title block`);
  ok(texts(3).includes('To SSC1 CommP · Sheet 4') && texts(3).includes('To SSC4 Estop · Sheet 5'), 'MSM sheet: leads name the SSC and its sheet');
  ok(!texts(3).some(t => /To SSC\d CommB/.test(t)), 'MSM sheet: no backup comm leads');
  ok(texts(4).includes('To MSM-1 SSC1P · Sheet 3') && texts(4).includes('To ACDP1 SSC1P · Sheet 6'), 'SSC back sheet: comm from the MSM, power from ACDP1');
  ok(texts(5).includes('To ACDP2 SSC1P · Sheet 7'), 'SSC4 power from ACDP2');
  ok(!texts(4).some(t => /Ext-HVIL ·|To .* Ext-HVIL/.test(t)), 'no Ext-HVIL lead');
  ok(texts(7).includes('To SSC4 PowerP · Sheet 5') && texts(6).includes('To MSM-1 PowerP · Sheet 3'), 'ACDP sheets: SSC and MSM power');
  ok(texts(8).includes('Junction Box Front') && texts(9).some(t => /SSC4 Front/.test(t)), 'fronts sheets: junction box and SSC fronts');
  ok(calls.filter(c => c[0] === 'text' && c[1] === 8 && /^Bus[+-]$/.test(c[2])).length === 4, '4-connector junction box: all four Bus names drawn');
  const dashed = calls.filter(c => c[0] === 'poly' && c[1] === 5 && c[2] && c[2].dash).length;
  ok(dashed > 0, 'cables between racks are dashed');

  /* the real PDF */
  const pdf = await L.elecPdf(s, lib, { title: 'S10195', docNumber: 'DWG2527' });
  const raw = Buffer.from(pdf).toString('latin1');
  ok(raw.startsWith('%PDF-1.4') && /\/Count 9 /.test(raw), 'PDF with 9 pages');
  ok((raw.match(/\/Type \/Page /g) || []).length === 9, 'nine page objects');
  const xref = raw.lastIndexOf('xref');
  const offsets = raw.slice(xref).split('\n').slice(3).filter(l => / 00000 n /.test(l)).map(l => +l.slice(0, 10));
  ok(offsets.every((o, i) => raw.startsWith((i + 1) + ' 0 obj', o)), 'xref offsets point at their objects');
  fs.mkdirSync(path.join(ROOT, 'prototype-output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'prototype-output', 'electrical-test.pdf'), pdf);
  console.log('Electrical sheet tests passed: ' + n + ' (' + (pdf.length / 1e6).toFixed(2) + ' MB)');
})().catch(e => { console.error(e); process.exit(1); });
