/* WireFlow — PDF writer and A3 wiring sheet tests (js/pdf.js, js/sheet.js).
 * Run: node tests/sheet.test.js   (set WIREFLOW_DXF=path/to/rack-111.dxf to also build the full rack PDF)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
const L = new Function(src('pdf.js') + src('sheet.js') + src('cadwire.js') + src('cad.js') +
  '\nreturn { sheetMergeRacks, sheetUnit, pdfDoc, pdfTextWidth, sheetSettings, sheetDraw, sheetPdf, sheetSvgTarget, sheetPlace, sheetGroundPoint, cadWirePlan, cadWireSave, cadParseDxf, cadFlatten };')();

let passed = 0; const failed = [];
function ok(name, cond, info) { if (cond) passed++; else failed.push(name + (info ? '  [' + info + ']' : '')); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info ? '  [' + info + ']' : '')); }

/* rack 111 geometry (same as tests/cadwire.test.js) */
const t = fs.readFileSync(path.join(__dirname, 'cadwire.test.js'), 'utf8');
const R = new Function(t.slice(t.indexOf('function rack111'), t.indexOf('/* ---------- geometry helpers')) + ';return {rack111,sscList};')();

function checkPdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const issues = [];
  if (!s.startsWith('%PDF-1.4')) issues.push('header');
  if (!/%%EOF\n$/.test(s)) issues.push('eof');
  const sx = +s.match(/startxref\n(\d+)\n%%EOF/)[1];
  if (!s.startsWith('xref', sx)) issues.push('startxref');
  const rows = s.slice(sx).split('\n');
  const n = +rows[1].split(' ')[1];
  for (let i = 1; i < n; i++) {
    const off = +rows[2 + i].slice(0, 10);
    if (!s.startsWith(i + ' 0 obj', off)) issues.push('xref ' + i);
  }
  const m = s.match(/4 0 obj\n<< (\/Filter \/FlateDecode )?\/Length (\d+) >>\nstream\n/);
  const start = m.index + m[0].length, len = +m[2];
  if (s.slice(start + len, start + len + 10) !== '\nendstream') issues.push('length');
  let content = Buffer.from(bytes.slice(start, start + len));
  if (m[1]) content = zlib.inflateSync(content);
  return { issues: issues, content: content.toString('latin1') };
}

(async () => {
  /* ---------- pdf writer ---------- */
  const d = L.pdfDoc({ w: 420, h: 297 });
  d.line(0, 0, 10, 10, { color: '#ff0000', w: 0.5 }).circle(50, 50, 5).text('Grounding Point ±0.5° 95mm² (x)', 20, 20, { size: 3, align: 'center' });
  const one = await d.bytes();
  const c1 = checkPdf(one);
  ok('PDF: header, xref offsets, stream length and EOF are valid', !c1.issues.length, c1.issues.join(','));
  ok('PDF: A3 landscape media box (1190.551 x 841.89 pt)', /MediaBox \[0 0 1190.551 841.89\]/.test(Buffer.from(one).toString('latin1')));
  ok('PDF: content is compressed', /FlateDecode/.test(Buffer.from(one).toString('latin1')));
  ok('PDF: special characters encoded for WinAnsi (±, °, ², escaped brackets)', c1.content.includes('\\261') && c1.content.includes('\\260') && c1.content.includes('\\262') && c1.content.includes('\\(x\\)'));
  ok('PDF: millimetre scaling set once at the start', c1.content.startsWith('2.835 0 0 2.835 0 0 cm'));
  ok('text width: Helvetica "AYK" at 10 mm', Math.abs(L.pdfTextWidth('AYK', 10) - (667 + 667 + 667) / 100) < 1e-9);

  /* ---------- sheet on rack 111 ---------- */
  const comps = R.rack111();
  const plan = L.cadWirePlan(comps, R.sscList(comps), { pair: 'P1' });
  const wiring = L.cadWireSave(plan, 'k');
  const jbs = comps.filter(c => c.kind === 'jb');
  const bounds = { minX: 2736.23, minY: 107.16, maxX: 7879.83, maxY: 2013.16 };
  const st = L.sheetSettings({ fields: { docNumber: 'DWG2396', designNumber: 'S10164', designName: '8x10_1MSM5SSC12A96AA', bankSize: '576 kWh', bankWeight: '5675 kg' } }, 'rack-111');
  const P = L.sheetPlace(bounds, jbs, st);
  ok('sheet: scale chosen from standard scales so the rack fits', [10, 15, 20, 25, 30].includes(P.scale), '1:' + P.scale);
  ok('sheet: rack inside the drawing area', P.X(bounds.minX) > 14 && P.X(bounds.maxX) < 406 && P.Y(bounds.minY) > 80, [P.X(bounds.minX), P.X(bounds.maxX), P.Y(bounds.minY)].map(v => v.toFixed(1)).join(' '));
  const svg = L.sheetSvgTarget();
  const parts = comps.filter(c => c.kind === 'ssc').map((c, i) => ({ id: 'part:' + c.id, text: 'SSC' + (i + 1), x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }))
    .concat([{ id: 'part:msm', text: 'MSM1', x: 7500, y: 1500 }]);
  L.sheetDraw(svg, { bounds: bounds, jbs: jbs, parts: parts, wiring: wiring, settings: st, interactive: true });
  const out = svg.svg();
  ok('sheet SVG: 140 cables, each with its id for editing', (out.match(/class="sh-cable"/g) || []).length === 140);
  ok('sheet SVG: 60 module labels S1-M1 …', (out.match(/>S\d-M\d+</g) || []).length === 60);
  ok('sheet SVG: blue and yellow plug leads on all 5 junction boxes', (out.match(/stroke="#0ea5e9"/g) || []).length >= 5 && (out.match(/stroke="#f2b600"/g) || []).length >= 5);
  ok('sheet SVG: plug leads labelled "Note 2" only (no Power PlugA / PlugB)', />Note 2</.test(out) && !/Power Plug/.test(out));
  ok('sheet SVG: SSC and MSM names on the sheet', ['SSC1', 'SSC5', 'MSM1'].every(t => out.includes('>' + t + '<')));
  ok('sheet SVG: scale is NTS', out.includes('SCALE: NTS'));
  ok('sheet SVG: grounding point with Note1', /Grounding Point/.test(out) && /\(Note1\)/.test(out));
  ok('sheet SVG: title block fields filled', ['DWG2396', 'S10164', '576 kWh', '5675 kg', 'Wiring Diagram', 'SCALE: NTS', 'SHEET 1 OF 1', 'AYK POWER LTD.'].every(v => out.includes(v)));
  ok('sheet SVG: fixed notes, legend and string note', /This Rack has 5 strings/.test(out) && /Cat6 Ethernet/.test(out) && /M6_L16_Button Screw/.test(out) && /DO NOT SCALE DRAWING/.test(out));

  const noPlug = L.sheetSettings({ plugs: false }, 'x');
  const svg2 = L.sheetSvgTarget();
  L.sheetDraw(svg2, { bounds: bounds, jbs: jbs, wiring: wiring, settings: noPlug, interactive: true });
  const out2 = svg2.svg();
  ok('plugs switched off: no blue/yellow leads, labels or customer legend', !/#0ea5e9|#f2b600/.test(out2) && !/Note 2/.test(out2) && !/Customer Side/.test(out2));

  /* edits move a cable and a label */
  const cab = wiring.cables.find(c => c.pts.length > 3 && !c.curve);
  const moved = cab.pts.map(p => [p[0] + 50, p[1]]);
  const st3 = L.sheetSettings({ edits: { cables: { [cab.id]: moved }, labels: { [wiring.strings[0].labels[0].id]: [3000, 1000] } } }, 'x');
  const svg3 = L.sheetSvgTarget();
  const P3 = L.sheetDraw(svg3, { bounds: bounds, jbs: jbs, wiring: wiring, settings: st3, interactive: true });
  const firstX = P3.X(moved[0][0]).toFixed(3).replace(/\.?0+$/, '');
  ok('edits: an edited cable is drawn on its new route', svg3.svg().includes(`points="${firstX},`), firstX);

  /* full PDF without the rack linework (fast) */
  const pdf = await L.sheetPdf({ bounds: bounds, jbs: jbs, wiring: wiring, settings: st, flat: { polylines: [], circles: [], texts: [] } });
  const c2 = checkPdf(pdf);
  ok('sheet PDF: valid structure', !c2.issues.length, c2.issues.join(','));
  const raw2 = Buffer.from(pdf).toString('latin1');
  ok('sheet PDF: all text in Arial / Arial Bold (no Helvetica)', /\/BaseFont \/Arial /.test(raw2) && /\/BaseFont \/Arial,Bold /.test(raw2) && !/Helvetica/.test(raw2) && (raw2.match(/\/Type \/FontDescriptor/g) || []).length === 2);
  ok('sheet PDF: wiring colours present (red, green, blue, yellow)', ['0.882 0.114 0.114 RG', '0.086 0.639 0.29 RG', '0.055 0.647 0.914 RG', '0.949 0.714 0 RG'].every(x => c2.content.includes(x)));
  ok('sheet PDF: title block text present', /\(DWG2396\) Tj/.test(c2.content) && /\(AYK POWER LTD\.\) Tj/.test(c2.content));
  /* the logo goes into the PDF as the JPEG bytes, in proportion */
  const jpg = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'logo.jpg')));
  const withLogo = await L.sheetPdf({ bounds: bounds, jbs: jbs, wiring: wiring, settings: st, flat: { polylines: [], circles: [], texts: [] }, logo: { bytes: jpg, w: 313, h: 400, src: 'x.png' } });
  const raw = Buffer.from(withLogo).toString('latin1');
  const im = raw.match(/\/Subtype \/Image \/Width 313 \/Height 400 .*?\/Length (\d+) >>\nstream\n/);
  ok('sheet PDF: logo embedded as the real JPEG (313 x 400 px)', im && +im[1] === jpg.length && raw.charCodeAt(im.index + im[0].length) === 0xFF && raw.charCodeAt(im.index + im[0].length + 1) === 0xD8);
  const draw = checkPdf(withLogo).content.match(/q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm \/Im1 Do Q/);
  ok('sheet PDF: logo keeps its proportions and fits the 10 mm company cell', draw && Math.abs(draw[1] / draw[2] - 313 / 400) < 0.01 && +draw[2] <= 9.5, draw && draw.slice(1).join(' x '));

  /* several sheets of one rack (AYK DWG2586): each wires its own strings, the rest are fenced */
  const names = wiring.strings.map(s => s.name).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const multi = L.sheetSettings({ fields: { sheet: '3 OF 14' }, pages: { count: 3, of: { [names[3]]: 2, [names[4]]: 3 } } }, 'x');
  const sheetSvg = page => { const t = L.sheetSvgTarget(); L.sheetDraw(t, { bounds: bounds, jbs: jbs, parts: parts, wiring: wiring, settings: multi, interactive: true, page: page }); return t.svg(); };
  const s1 = sheetSvg(1), s2 = sheetSvg(2), s3 = sheetSvg(3);
  const cablesOf = name => wiring.cables.filter(c => c.ssc === name).length;
  const count = o => (o.match(/class="sh-cable"/g) || []).length;
  ok('sheets: each sheet draws only the cables of its own strings', count(s1) === cablesOf(names[0]) + cablesOf(names[1]) + cablesOf(names[2]) && count(s2) === cablesOf(names[3]) && count(s3) === cablesOf(names[4]), [count(s1), count(s2), count(s3)].join(' / '));
  ok('sheets: module labels only for the strings wired there', (s2.match(/>S\d-M\d+</g) || []).length === wiring.strings[3].labels.length);
  ok('sheets: numbered on from the title block (3, 4, 5 OF 14)', s1.includes('SHEET 3 OF 14') && s2.includes('SHEET 4 OF 14') && s3.includes('SHEET 5 OF 14'));
  ok('sheets: strings wired elsewhere are fenced with "Please see sheet N"', s1.includes(`Please see sheet 4, ${names[3]}, for wiring connections.`) && s1.includes(`Please see sheet 5, ${names[4]}, for wiring connections.`) &&
    s2.includes(`Please see sheet 3, ${names[0]} &amp; ${names[1]} &amp; ${names[2]}, for wiring connections.`));
  ok('sheets: the fence is purple', /class="sh-away"><polyline[^>]*stroke="#7c3aed"/.test(s1));
  ok('sheets: one sheet only = no fence and no "see sheet" note', !/Please see sheet/.test(svg.svg()) && !/sh-away/.test(svg.svg()));
  const multiNote = L.sheetSettings({ pages: { count: 2, of: { [names[4]]: 2 }, notes: { '1:2': 'SSC5: see the next sheet' } } }, 'x');
  const tn = L.sheetSvgTarget(); L.sheetDraw(tn, { bounds: bounds, jbs: jbs, wiring: wiring, settings: multiNote, page: 1 });
  ok('sheets: the engineer can change the note\'s words', tn.svg().includes('SSC5: see the next sheet') && !tn.svg().includes('Please see sheet'));
  const pdf3 = await L.sheetPdf({ bounds: bounds, jbs: jbs, wiring: wiring, settings: multi, flat: { polylines: [], circles: [], texts: [] } });
  const raw3 = Buffer.from(pdf3).toString('latin1');
  ok('sheets: the PDF has one page per sheet', /\/Count 3 /.test(raw3) && (raw3.match(/\/Type \/Page /g) || []).length === 3);

  /* two racks of one project on one sheet (DWG2586 sheet 2): the second sits to the right */
  const flatA = { polylines: [{ pts: [bounds.minX, bounds.minY, bounds.maxX, bounds.minY, bounds.maxX, bounds.maxY, bounds.minX, bounds.maxY], closed: true, layer: '0' }], circles: [], texts: [], bounds: bounds };
  const rackOf = (key, name, unit) => ({ key: key, name: name, flat: flatA, wiring: wiring, components: comps, parts: parts, jbs: jbs, unit: unit });
  const M = L.sheetMergeRacks([rackOf('r1', 'Rack 2', 1), rackOf('r2', 'Rack 3', 1)], 600);
  ok('two racks: both racks\' cables, the second\'s with its own ids', M.wiring.cables.length === 2 * wiring.cables.length && M.wiring.cables.filter(c => c.id.startsWith('r2:')).length === wiring.cables.length);
  ok('two racks: side by side, 600 mm apart, bottoms level', Math.abs(M.racks[1].bounds.minX - (bounds.maxX + 600)) < 1e-6 && Math.abs(M.racks[1].bounds.minY - bounds.minY) < 1e-6 && M.flat.bounds.maxX > bounds.maxX * 1.5);
  ok('two racks: an SSC name both have gets the rack\'s name', M.wiring.strings.some(st => st.name === 'Rack 3 SSC1') && new Set(M.wiring.strings.map(st => st.name)).size === 10);
  ok('two racks: each rack keeps its own grounding point', M.grounds.length === 1 && M.ground0.x < bounds.maxX && M.grounds[0].x > bounds.maxX + 600);
  const half = L.sheetMergeRacks([rackOf('r1', 'Rack 2', 1), rackOf('r2', 'Rack 3', 0.5)], 600);
  ok('two racks: a rack drawn at another scale is brought to the first rack\'s units', Math.abs((half.racks[1].bounds.maxX - half.racks[1].bounds.minX) - 2 * (bounds.maxX - bounds.minX)) < 1e-6);
  const svgM = L.sheetSvgTarget();
  L.sheetDraw(svgM, { bounds: M.flat.bounds, jbs: M.jbs, parts: M.parts, wiring: M.wiring, settings: L.sheetSettings({}, 'x'), components: M.components, grounds: M.grounds, ground0: M.ground0, interactive: true });
  const outM = svgM.svg();
  ok('two racks: drawn on one sheet, every cable, two grounding points', (outM.match(/class="sh-cable"/g) || []).length === 280 && (outM.match(/>Grounding Point</g) || []).length === 2);
  const stM = L.sheetSettings({ pages: { count: 2, of: Object.fromEntries(M.wiring.strings.filter(st => /^Rack 3/.test(st.name)).map(st => [st.name, 2])) } }, 'x');
  const svgM2 = L.sheetSvgTarget();
  L.sheetDraw(svgM2, { bounds: M.flat.bounds, jbs: M.jbs, parts: M.parts, wiring: M.wiring, settings: stM, components: M.components, grounds: M.grounds, page: 1 });
  ok('two racks over two sheets: the second rack fenced on sheet 1', (svgM2.svg().match(/class="sh-cable"/g) || []).length === 0 && /Please see sheet 2, Rack 3 SSC1 &amp;/.test(svgM2.svg()));
  fs.mkdirSync(path.join(ROOT, 'prototype-output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'prototype-output', 'sheet-test.pdf'), pdf);

  /* ---------- a rack drawn at about 1:44 (rack "1111"): the sheet works in real mm ---------- */
  {
    const { rack1111, sscs1111 } = require('./fixtures/rack-1111.js');
    const rc = rack1111();
    const p11 = L.cadWirePlan(rc, sscs1111(rc), { pair: 'P1' });
    const w11 = L.cadWireSave(p11, 'k');
    const u = L.sheetUnit(rc);
    ok('1:44 rack: drawing units per mm from the module width', Math.abs(u - 9 / 400.45) < 1e-3, u.toFixed(4));
    const b = { minX: Math.min(...rc.map(c => c.x0)), minY: Math.min(...rc.map(c => c.y0)), maxX: Math.max(...rc.map(c => c.x1)), maxY: Math.max(...rc.map(c => c.y1)) };
    const st11 = L.sheetSettings({}, 'rack-1111');
    const svg11 = L.sheetSvgTarget();
    const P11 = L.sheetDraw(svg11, { bounds: b, jbs: rc.filter(c => c.kind === 'jb'), wiring: w11, settings: st11, unit: u, interactive: true });
    const rackW = (b.maxX - b.minX) * P11.k;
    ok('1:44 rack: the rack fills the A3 frame (not a small blob)', rackW > 200 && rackW < 392, rackW.toFixed(0) + ' mm wide at 1:' + P11.scale);
    ok('1:44 rack: plug leads stay inside the drawing area', P11.Y(P11.plugTop) <= 283.01, P11.Y(P11.plugTop).toFixed(1));
    const labs = w11.strings.flatMap(s => s.labels).map(l => [P11.X(l.x), P11.Y(l.y)]);
    let close = 0;
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++)
      if (Math.abs(labs[i][0] - labs[j][0]) < 12 && Math.abs(labs[i][1] - labs[j][1]) < 2.6) close++;
    ok('1:44 rack: no two module labels on top of each other', labs.length > 100 && close === 0, labs.length + ' labels, ' + close + ' overlapping');
    const pw = w11.cables.filter(c => c.kind === 'power');
    /* the long cables from each SSC (S+, S−, B+, B−) can always go another way */
    const long = pw.filter(c => /^(S−|B\+|B−)$/.test(c.from) || /S\+$/.test(c.to));
    ok('1:44 rack: every long SSC power cable carries other ways for the engineer', long.length === 36 && long.every(c => c.ways && c.ways.length >= 2), long.filter(c => c.ways && c.ways.length >= 2).length + ' of ' + long.length);
    ok('1:44 rack: the other ways join the same two terminals', pw.every(c => !c.ways || c.ways.every(w => {
      const a = w.pts[0], z = w.pts[w.pts.length - 1], a0 = c.pts[0], z0 = c.pts[c.pts.length - 1];
      return Math.hypot(a[0] - a0[0], a[1] - a0[1]) < 0.05 && Math.hypot(z[0] - z0[0], z[1] - z0[1]) < 0.05;
    })));
  }

  /* the real drawing, when available */
  const dxf = process.env.WIREFLOW_DXF;
  if (dxf && fs.existsSync(dxf)) {
    const flat = L.cadFlatten(L.cadParseDxf(fs.readFileSync(dxf, 'utf8')));
    const gp = L.sheetGroundPoint(flat, flat.bounds);
    ok('real 111: grounding point on the upper hole of the lowest bolt pair, right upright', Math.abs(gp.x - 7788.3) < 0.2 && Math.abs(gp.y - 152.2) < 0.2, gp.x.toFixed(1) + ',' + gp.y.toFixed(1));
    const t0 = Date.now();
    const full = await L.sheetPdf({ bounds: flat.bounds, jbs: jbs, wiring: wiring, settings: st, flat: flat });
    const c3 = checkPdf(full);
    ok('real 111 PDF: valid, with the full rack linework', !c3.issues.length && full.length > 300000, (full.length / 1e6).toFixed(2) + ' MB, ' + (Date.now() - t0) + ' ms');
    fs.writeFileSync(path.join(ROOT, 'prototype-output', 'rack-111-wiring.pdf'), full);
  }

  console.log('\n' + (failed.length ? 'FAILED ' + failed.length + ':\n  ' + failed.join('\n  ') : 'Sheet/PDF tests passed: ' + passed));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e); process.exit(1); });
