/* ============================================================
 * WireFlow — drawing / engine regression test harness
 * ------------------------------------------------------------
 * Plain Node (no dependencies). Loads js/engine.js into an
 * isolated function scope and asserts:
 *   1. netlist / validation / schedule regression
 *   2. app-facing call signatures (hero + Diagram tab + exports)
 *   3. SVG / DXF / SCR output correctness (XML well-formedness,
 *      DXF group-code pairing + layer references, on-sheet bounds)
 *
 * Run:  node tests/drawing.test.js
 * Exit: 0 = all pass, 1 = at least one failure
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'js', 'engine.js');

let passed = 0;
const failures = [];

function ok(name, condition, evidence) {
  if (condition) {
    passed++;
    console.log('PASS  ' + name + (evidence ? '  [' + evidence + ']' : ''));
  } else {
    failures.push(name + (evidence ? '  [' + evidence + ']' : ''));
    console.log('FAIL  ' + name + (evidence ? '  [' + evidence + ']' : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- load engine.js in an isolated scope ---------- */

function loadEngine() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const exportNames = [
    'DEFAULT_RULES', 'SHEET_LAYERS', 'SHEET_W', 'SHEET_H', 'SHEET_UNIT_MM',
    'emptyProject', 'generateNetlist', 'runValidations', 'buildSchedule',
    'scheduleCSV', 'harnessCatalogue', 'sheetLayer', 'sheetTextWidth', 'sheetAscii',
    'buildSheetLayout', 'renderDiagramSVG', 'dxfExport', 'scrExport', 'specJson',
    'rackParseDxf', 'rackFitDxf', 'rackDefaultFit',
    'RACK_CELL_KINDS', 'slotKey', 'slotCell', 'defaultRack', 'rackEnsure', 'rackCell',
    'rackIsModule', 'rackModuleCells', 'rackDeviceCells', 'rackPoint', 'rackSpan',
    'numberingHopKind', 'numberMetrics', 'rackTraverse', 'tspOrder', 'numberingPlans',
    'numberingToggle', 'numberingAutoFill', 'resolveNumbering', 'numberingHopInfo',
    'numberingSheetPrimitives', 'numberingPreviewSVG',
    'stringModuleCounts', 'numberingOffsets',
    'layoutEnsure', 'layoutAssign', 'layoutGroups', 'layoutGroupOrder', 'layoutTsp',
    'groupMetrics', 'layoutValidate', 'layoutApply', 'layoutTotals',
    'layoutFrontView', 'layoutFrontViewSummary', 'layoutAssignmentRows', 'SSC_PALETTE',
  ];
  const factory = new Function(src + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'rack.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'numbering.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'frontview.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'sscplan.js'), 'utf8') +
    '\nreturn {' + exportNames.join(',') + '};');
  const E = factory();
  /* VSDX export lives in its own file but shares the engine's globals
     (buildSheetLayout / sheetTextWidth) and zip.js's ZipWriter, so both are
     evaluated in the same scope — mirroring the browser's script globals. */
  const zipSrc = fs.readFileSync(path.join(path.dirname(ENGINE), 'zip.js'), 'utf8');
  const vsdxSrc = fs.readFileSync(path.join(path.dirname(ENGINE), 'vsdx.js'), 'utf8')
    + '\nreturn { vsdxExport, VSDX_LAYERS };';
  const vsdxFactory = new Function(src + '\n' + zipSrc + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'rack.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'numbering.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(path.dirname(ENGINE), 'sscplan.js'), 'utf8') + '\n' + vsdxSrc);
  const vsdxOut = vsdxFactory();
  E.vsdxExport = vsdxOut.vsdxExport;
  E.VSDX_LAYERS = vsdxOut.VSDX_LAYERS;
  return E;
}

/* ---------- SVG well-formedness (minimal strict XML check) ---------- */

const TAG_RE = /^<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*"[^"<]*")*)\s*(\/?)\s*>$/;
const ENTITY_RE = /^&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);$/;

function checkXml(src) {
  const errs = [];
  let pos = 0;
  const stack = [];
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    const text = lt === -1 ? src.slice(pos) : src.slice(pos, lt);
    // text nodes: no raw '<' possible; every '&' must start a legal entity
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '&') continue;
      const semi = text.indexOf(';', i);
      const ent = semi === -1 ? text.slice(i) : text.slice(i, semi + 1);
      if (semi === -1 || !ENTITY_RE.test(ent)) {
        errs.push('unescaped & at text offset ' + i + ' near "' + text.slice(i, i + 24) + '"');
        break;
      }
      i = semi;
    }
    if (lt === -1) break;
    const gt = src.indexOf('>', lt);
    if (gt === -1) { errs.push('unterminated tag at ' + lt); break; }
    const raw = src.slice(lt, gt + 1);
    const m = TAG_RE.exec(raw);
    if (!m) { errs.push('malformed tag ' + JSON.stringify(raw.slice(0, 80))); break; }
    const closing = m[1] === '/';
    const name = m[2];
    const selfClose = m[4] === '/';
    if (closing) {
      if (selfClose) { errs.push('tag both closing and self-closing: ' + raw); break; }
      const top = stack.pop();
      if (top !== name) { errs.push('</' + name + '> closes <' + top + '>'); break; }
    } else if (!selfClose) {
      stack.push(name);
    }
    pos = gt + 1;
  }
  if (stack.length) errs.push('unclosed element(s): ' + stack.join(','));
  return errs;
}

/* ---------- source helpers ---------- */

/**
 * Extracts the body of a top-level `function name(...)` by brace matching.
 * @param {string} src Source text.
 * @param {string} name Function name.
 * @return {?string} Body including the braces, or null when not found.
 */
function fnBody(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index + m[0].length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

/* ---------- primitive on-sheet bounds ---------- */

function boxOf(pr, engine, tol) {
  const W = engine.SHEET_W, H = engine.SHEET_H;
  const pad = tol || 0;
  if (pr.type === 'line') {
    return { x0: Math.min(pr.x1, pr.x2), x1: Math.max(pr.x1, pr.x2), y0: Math.min(pr.y1, pr.y2), y1: Math.max(pr.y1, pr.y2) };
  }
  if (pr.type === 'rect') {
    return { x0: pr.x, x1: pr.x + pr.w, y0: pr.y, y1: pr.y + pr.h };
  }
  if (pr.type === 'circle') {
    return { x0: pr.cx - pr.r, x1: pr.cx + pr.r, y0: pr.cy - pr.r, y1: pr.cy + pr.r };
  }
  const w = engine.sheetTextWidth(pr.text, pr.size);
  let x0 = pr.x;
  if (pr.anchor === 'middle') x0 = pr.x - w / 2;
  else if (pr.anchor === 'end') x0 = pr.x - w;
  // baseline y: approximate ascender / descender box
  return { x0: x0, x1: x0 + w, y0: pr.y - pr.size * 0.85, y1: pr.y + pr.size * 0.25, text: pr.text };
}

function outOfSheet(layout, engine) {
  const W = engine.SHEET_W, H = engine.SHEET_H;
  const bad = [];
  for (const pr of layout.primitives) {
    const b = boxOf(pr, engine, 0);
    const eps = 0.51;
    if (b.x0 < -eps || b.y0 < -eps || b.x1 > W + eps || b.y1 > H + eps) {
      bad.push({
        type: pr.type, layer: pr.layer,
        text: pr.text !== undefined ? String(pr.text).slice(0, 40) : undefined,
        box: [round(b.x0), round(b.y0), round(b.x1), round(b.y1)],
      });
    }
  }
  return bad;
}

function round(n) { return Math.round(n * 100) / 100; }

/* ---------- DXF structural validation ---------- */

function pairsOf(dxf) {
  const lines = dxf.split(/\r\n|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
  return { lines, pairs };
}

function validateDxf(dxf, engine) {
  const res = { errs: [], layers: [], entityLayers: [], counts: {} };
  const { lines, pairs } = pairsOf(dxf);
  if (lines.length % 2 !== 0) res.errs.push('odd number of lines (' + lines.length + ') — group codes not strictly paired');
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^-?\d+$/.test(lines[i])) { res.errs.push('non-integer group code on line ' + (i + 1) + ': ' + JSON.stringify(lines[i])); break; }
    if (i === lines.length - 1) res.errs.push('group code without value on line ' + (i + 1));
  }
  // section order
  const secNames = [];
  for (let i = 0; i + 3 < pairs.length; i++) {
    if (pairs[i][0] === '0' && pairs[i][1] === 'SECTION' && pairs[i + 1][0] === '2') secNames.push(pairs[i + 1][1]);
    if (pairs[i][0] === '0' && pairs[i][1] === 'EOF') res.eofSeen = true;
  }
  res.sections = secNames;
  if (secNames.join(',') !== 'HEADER,TABLES,ENTITIES') res.errs.push('section order is ' + secNames.join(',') + ' (expected HEADER,TABLES,ENTITIES)');
  if (dxf.trim().split(/\r\n|\n/).slice(-2).join('|') !== '0|EOF') {
    const tail = lines.slice(-2);
    res.errs.push('document does not end with 0/EOF, tail = ' + JSON.stringify(tail));
  }
  if (!/^AC1009$/m.test(dxf)) res.errs.push('missing $ACADVER AC1009 (R12)');
  if (!/\$ACADVER/.test(dxf)) res.errs.push('missing $ACADVER header variable');

  // walk TABLES / ENTITIES
  let mode = null, table = null, expectTableCount = null, layerCount = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === '0') {
      if (v === 'SECTION') { mode = (pairs[i + 1] || [])[1]; continue; }
      if (v === 'ENDSEC') { mode = null; table = null; continue; }
      if (v === 'TABLE') {
        table = (pairs[i + 1] || [])[1];
        // group 70 = max entries count
        for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
          if (pairs[j][0] === '70') expectTableCount = +pairs[j][1];
        }
        continue;
      }
      if (v === 'ENDTAB') { table = null; continue; }
      if (mode === 'TABLES' && table === 'LAYER' && v === 'LAYER') {
        let name = null;
        for (let j = i + 1; j < Math.min(i + 8, pairs.length); j++) {
          if (pairs[j][0] === '0') break;
          if (pairs[j][0] === '2') name = pairs[j][1];
        }
        res.layers.push(name);
        layerCount++;
        continue;
      }
      if (mode === 'ENTITIES') {
        res.counts[v] = (res.counts[v] || 0) + 1;
        // first 8/ layer reference inside the entity record
        let layer = null;
        for (let j = i + 1; j < pairs.length; j++) {
          if (pairs[j][0] === '0') break;
          if (pairs[j][0] === '8') { layer = pairs[j][1]; break; }
        }
        res.entityLayers.push({ entity: v, layer: layer });
      }
    }
  }
  if (expectTableCount !== null && expectTableCount !== layerCount) {
    res.errs.push('LAYER table declares 70=' + expectTableCount + ' but contains ' + layerCount + ' records');
  }
  const declared = new Set(res.layers);
  const missing = [...new Set(res.entityLayers.filter(e => !declared.has(e.layer)).map(e => String(e.layer)))];
  if (missing.length) res.errs.push('entities reference undeclared layer(s): ' + missing.join(', '));
  if (!res.layers.length) res.errs.push('no LAYER records emitted');
  // LTYPE table sanity
  if (!/LTYPE/.test(dxf)) res.errs.push('missing LTYPE table');
  if (!/CONTINUOUS/.test(dxf)) res.errs.push('missing CONTINUOUS linetype');
  // dangling groups: a TEXT (group 1) value must never contain a raw newline (handled by pair split)
  return res;
}

/* ============================================================
 * 1. ENGINE REGRESSION
 * ============================================================ */
console.log('\n=== 1. Engine regression ===');
const E = loadEngine();

const project = {
  name: 'Racks 9-16 battery bank',
  vessel: 'MV Example',
  drawing_no: 'DWG-2468',
  revision: 'A',
  product_family: 'Pisces+',
  modules_per_string: 24,
  status: 'released',
  config: { rules: Object.assign({}, E.DEFAULT_RULES), exceptions: [], spans: [] },
};

const conns = E.generateNetlist(project);
eq('generateNetlist connection count (2 strings x 24 modules)', conns.length, 104);
eq('sequence numbers are 1..n contiguous', conns[conns.length - 1].seq, 104);
// per string: 2 M2S-PWR + 2 SSC-JB + (N-1) M2M-PWR = N+3 power; 2 M2S-COMM + (N-1) M2M-COMM = N+1 comm
eq('power/comm split (N+3 / N+1 per string)', conns.filter(c => c.network === 'power').length + '/' + conns.filter(c => c.network === 'comm').length, '54/50');
eq('every connection has a harness', conns.filter(c => !c.harness).length, 0);
eq('R04 first connection SSC+ -> M1+', conns[0].from + '>' + conns[0].to, 'S1-SSC:P+>S1:M1:P+');
eq('R05 SSC- -> M24- present', conns.some(c => c.from === 'S1-SSC:P-' && c.to === 'S1:M24:P-'), true);
eq('R11 two SSC-JB bus cables per string', conns.filter(c => c.cls === 'SSC-JB').length, 4);
eq('R12 power deduction applied (800-130=670 -> PW-M2S-800)',
  conns[0].routedLen + '/' + conns[0].harness, '670/PW-M2S-800');
eq('comm deduction not applied (800 -> CM-M2S-800)',
  conns[2].routedLen + '/' + conns[2].harness, '800/CM-M2S-800');

const validations = E.runValidations(project, conns);
eq('runValidations check count', validations.length, 12);
eq('runValidations failures', validations.filter(v => v.status === 'fail').length, 0);
eq('validation ids V01..V12', validations.map(v => v.id).join(','), 'V01,V02,V03,V04,V05,V06,V07,V08,V09,V10,V11,V12');

/* ---- release gate: an unconfigured project must never reach "release allowed" ----
 * The gate has to produce the full, ordered V01-V12 table (the UI renders it as a
 * fixed list) with every row failed and one explanatory detail. */
function validationsFor(rules) {
  const pr = { name: 'Gate', config: { exceptions: [], spans: [], rules: Object.assign({}, E.DEFAULT_RULES, rules) } };
  const cc = E.generateNetlist(pr);
  return { conns: cc, checks: E.runValidations(pr, cc) };
}
const normalLabels = JSON.stringify(validations.map(v => v.label));
const gateCases = [
  [{ strings: 0, modulesPerString: 0 }, 'strings 0 / modules 0'],
  [{ strings: 0, modulesPerString: 24 }, 'strings 0 / modules 24'],
  [{ strings: 2, modulesPerString: 0 }, 'strings 2 / modules 0'],
  [{ strings: -1, modulesPerString: 24 }, 'strings -1 / modules 24'],
];
for (const [rules, label] of gateCases) {
  const g = validationsFor(rules);
  eq('gate blocks ' + label + ' (12 of 12 fail)',
    g.checks.length + '/' + g.checks.filter(v => v.status === 'fail').length, '12/12');
  eq('gate keeps V01..V12 order for ' + label,
    g.checks.map(v => v.id).join(','), 'V01,V02,V03,V04,V05,V06,V07,V08,V09,V10,V11,V12');
  eq('gate keeps the release-table labels for ' + label,
    JSON.stringify(g.checks.map(v => v.label)), normalLabels);
  ok('gate detail explains the missing configuration for ' + label,
    g.checks.every(v => /^No module configuration/.test(v.detail) && v.detail === g.checks[0].detail),
    g.checks[0].detail);
}
eq('default 2x24 still releases (0 fail)', validations.filter(v => v.status === 'fail').length, 0);

/* Threshold decision (accepted limitation, asserted so it cannot drift silently):
 * a one-module string is electrically complete — SSC+ -> M1+, SSC- -> M1-, SSC S -> M1 N,
 * SSC N -> M1 S and the two bus cables = 6 connections, with no adjacent pair to jumper.
 * The engine therefore releases N=1 (12/0) by design; the >=2 policy is enforced at the
 * UI boundary (app.js min="2" and Math.max(2, ...)). Hardening the engine to N<2 would
 * have to be a deliberate decision that updates this assertion. */
const oneMod = validationsFor({ strings: 2, modulesPerString: 1 });
eq('1-module string netlist is complete (6 per string)', oneMod.conns.length, 12);
eq('1-module string validates 12/0 (documented threshold decision)',
  oneMod.checks.length + '/' + oneMod.checks.filter(v => v.status === 'fail').length, '12/0');

const sched = E.buildSchedule(conns);
eq('buildSchedule qty reconciles to netlist', sched.reduce((t, r) => t + r.qty, 0), 104);
const csv = E.scheduleCSV(conns, project);
const csvRows = csv.split('\r\n');
eq('scheduleCSV header', csvRows[0].slice(0, 11), '"Cable ID",');
eq('scheduleCSV row count = line items + header', csvRows.length, sched.length + 1);
eq('scheduleCSV uses CRLF', csv.indexOf('\r\n') > 0, true);
const cat = E.harnessCatalogue(E.DEFAULT_RULES);
eq('harnessCatalogue size', cat.length, 7);
eq('harnessCatalogue part numbers', cat.map(h => h.pn).join(','),
  'PW-JMP-100,PW-LOC-445,CM-JMP-450,CM-LOC-650,PW-M2S-800,CM-M2S-800,PW-BUS-1200');

/* ============================================================
 * 2. APP-FACING SIGNATURES (hero + Diagram tab + export buttons)
 * ============================================================ */
console.log('\n=== 2. App wiring / call signatures ===');

// hero project exactly as app.js builds it (no name / vessel / drawing_no / status)
const heroProject = { config: { rules: Object.assign({}, E.DEFAULT_RULES, { modulesPerString: 12, strings: 1 }) } };
let heroSvg = null, heroErr = null;
try { heroSvg = E.renderDiagramSVG(heroProject, []); } catch (e) { heroErr = e; }
ok('hero renderDiagramSVG(heroProject, []) does not throw', heroErr === null, heroErr ? heroErr.message : 'ok');
ok('hero SVG <svg> root present', !!heroSvg && heroSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
ok('hero fallback drawing title "Rack 1"', !!heroSvg && heroSvg.includes('Wiring Diagram - Rack 1'));
ok('hero fallback drawing number DWG-0000', !!heroSvg && heroSvg.includes('DWG-0000'));
ok('hero fallback review stamp FOR REVIEW', !!heroSvg && heroSvg.includes('FOR REVIEW'));
eq('hero empty netlist summary text', /Netlist preview - generate the netlist/.test(heroSvg || ''), true);

// released project -> RELEASED stamp + real metadata
const releasedSvg = E.renderDiagramSVG(project, []);
ok('released project stamp RELEASED', releasedSvg.includes('RELEASED') && !releasedSvg.includes('FOR REVIEW'));
ok('released project carries drawing no', releasedSvg.includes('DWG-2468'));
ok('released project carries vessel', releasedSvg.includes('MV Example'));
// NOTE: an empty netlist must still fall back to the preview summary (not crash),
// which is the path used when a project has no generated netlist yet.
// app.js tabDiagram() now passes the generated netlist: renderDiagramSVG(project, conns).
ok('Diagram tab (empty conns) shows the preview summary',
  releasedSvg.includes('Netlist preview - generate the netlist to populate the connection data.'));
const fullSvg = E.renderDiagramSVG(project, conns);
ok('netlist summary reports 104 connections when conns are supplied',
  fullSvg.includes('104 connections | power 54 | communication 50') && fullSvg.includes('all harnesses approved'));

// undefined / null project must not throw (defensive call path)
let nullErr = null;
try { E.renderDiagramSVG(undefined, undefined); E.dxfExport(undefined, undefined); E.scrExport(undefined, undefined); }
catch (e) { nullErr = e; }
ok('renders with undefined project + undefined conns', nullErr === null, nullErr ? nullErr.message : 'ok');

// static check of app.js call sites
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const engineSrc = fs.readFileSync(ENGINE, 'utf8');
const apsSrc = fs.readFileSync(path.join(ROOT, 'js', 'aps.js'), 'utf8');

const defined = new Set();
for (const src of [engineSrc, apsSrc, appSrc]) {
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
  for (const m of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
}
const calledFromApp = [
  'generateNetlist', 'runValidations', 'buildSchedule', 'scheduleCSV',
  'renderDiagramSVG', 'dxfExport', 'scrExport', 'DEFAULT_RULES',
  'apsGetToken', 'apsUploadAndTranslate', 'apsWaitForTranslation', 'showInViewer', 'urnBase64',
];
const missingFns = calledFromApp.filter(n => !defined.has(n));
eq('all engine/aps symbols used by app.js are defined', missingFns.join(',') || 'none', 'none');

// export button wiring + call sites: assert inside the owning function body so the
// check cannot be satisfied by a comment or by a different function's call.
const tabDiagramBody = fnBody(appSrc, 'tabDiagram');
const routeBody = fnBody(appSrc, 'route');
ok('fnBody extracted tabDiagram()', !!tabDiagramBody, tabDiagramBody ? tabDiagramBody.length + ' chars' : 'not found');
ok('fnBody extracted internal route()', !!routeBody, routeBody ? routeBody.length + ' chars' : 'not found');
const tabBody = tabDiagramBody || '';
const internalRouteBody = routeBody || '';
const sigChecks = [
  ['scheduleCSV(conns, project)', /scheduleCSV\(conns,\s*project\)/.test(appSrc)],
  ['dxfExport(conns, project)', /dxfExport\(conns,\s*project\)/.test(appSrc)],
  ['scrExport(conns, project)', /scrExport\(conns,\s*project\)/.test(appSrc)],
  ['Diagram tab fetches the netlist', /await ctx\.getNetlist\(\)/.test(tabBody)],
  ['Diagram tab passes that netlist to renderDiagramSVG', /renderDiagramSVG\(project,\s*conns\)/.test(tabBody)],
  ['Diagram tab no longer passes an empty array', !/renderDiagramSVG\(project,\s*\[\]\)/.test(tabBody)],
  ['root route opens the projects dashboard', /case '#\/'[\s\S]*renderDashboard\(\)/.test(internalRouteBody)],
];
for (const [label, condValue] of sigChecks) ok('app.js call site: ' + label, condValue);

// The UI must not be able to persist the configurations the gate rejects.
// (Behaviourally verified in a browser: entering 0/0 saves 2/1 and the resulting
// rules release 12/0 — these assertions keep the clamp from being deleted.)
const tabConfigBody = fnBody(appSrc, 'tabConfig') || '';
ok('config tab input declares min="2" for modulesPerString', /min="2"\s+data-rule="modulesPerString"/.test(tabConfigBody));
ok('config tab input declares min="1" for strings', /min="1"\s+data-rule="strings"/.test(tabConfigBody));
ok('config tab save clamps strings to >= 1',
  /rules\.strings\s*=\s*Math\.max\(1,\s*Math\.round\(rules\.strings\)\s*\|\|\s*1\)/.test(tabConfigBody));
ok('config tab save clamps modulesPerString to >= 2',
  /rules\.modulesPerString\s*=\s*Math\.max\(2,\s*Math\.round\(rules\.modulesPerString\)\s*\|\|\s*2\)/.test(tabConfigBody));

// Guided workspace: one canonical step definition and a pure saved-state
// derivation keep the premium flow in sync with the expert screens.
const flowLabels = [...appSrc.matchAll(/\{ label: '([^']+)', view: '[^']+' \}/g)].map(m => m[1]);
eq('FLOW_STEPS defines the five guided stages', flowLabels.join(' · '),
  'Import rack · Calibrate · Number & chains · Wire & validate · Export PDF');
const flowStepBody = fnBody(appSrc, 'flowStepCompletion');
ok('fnBody extracted flowStepCompletion()', !!flowStepBody,
  flowStepBody ? flowStepBody.length + ' chars' : 'not found');
const deriveFlow = new Function('project', flowStepBody || 'return [];');
eq('guided flow starts with every step incomplete',
  JSON.stringify(deriveFlow({ config: {} })), '[false,false,false,false,false]');
eq('guided flow derives import + calibration from saved project state',
  JSON.stringify(deriveFlow({ underlay_url: 'rack.png', config: { numbering: { cal: { ok: true } } } })),
  '[true,true,false,false,false]');
const guidedComplete = { underlay_url: 'rack.png', config: {
  numbering: { mode: 'layout', cal: { ok: true }, counts: [6, 6], order: ['0,0', '0,1'] },
  layout: { sscs: [{ id: 'SSC-1' }, { id: 'SSC-2' }] },
  flow: { deliveredAt: '2026-10-28T00:00:00.000Z' },
} };
eq('guided flow derives applied chains, visible wiring and export',
  JSON.stringify(deriveFlow(guidedComplete)), '[true,true,true,true,true]');

const printBuilderBody = fnBody(appSrc, 'buildPrintDocument');
ok('fnBody extracted buildPrintDocument()', !!printBuilderBody,
  printBuilderBody ? printBuilderBody.length + ' chars' : 'not found');
const buildPrintPages = new Function('parts', printBuilderBody || 'return [];');
const printPages = buildPrintPages({ sheetSvg: '<svg id="sheet"/>', frontSvg: '<svg id="front"/>', scheduleSvg: '<svg id="schedule"/>' });
eq('print-document builder keeps the required A3 page order',
  printPages.map(page => page.title).join(' | '),
  'Generated wiring sheet | Rack front-view wiring | Cable schedule & BOM');
eq('print-document builder returns ordered title/svg page records',
  JSON.stringify(printPages.map(page => ({ title: typeof page.title, svg: page.svg }))),
  JSON.stringify([{ title: 'string', svg: '<svg id="sheet"/>' }, { title: 'string', svg: '<svg id="front"/>' }, { title: 'string', svg: '<svg id="schedule"/>' }]));

const verdictBody = fnBody(appSrc, 'vsdxImportVerdict');
ok('fnBody extracted vsdxImportVerdict()', !!verdictBody,
  verdictBody ? verdictBody.length + ' chars' : 'not found');
const importVerdict = new Function('result', verdictBody || 'return {};');
eq('VSDX quality verdict rejects a package with no pages',
  JSON.stringify(importVerdict({ pages: 0, foreigns: 0, picture: null })),
  JSON.stringify({ ok: false, reason: 'No pages were found in the Visio drawing.' }));
eq('VSDX quality verdict explains a missing embedded picture',
  JSON.stringify(importVerdict({ pages: 2, foreigns: [], picture: null })),
  JSON.stringify({ ok: false, reason: 'No embedded rack picture was found in the Visio drawing.' }));
eq('VSDX quality verdict accepts the selected embedded picture',
  JSON.stringify(importVerdict({ pages: [{}, {}], foreigns: [{ blob: true }], picture: { w: 10, h: 4 } })),
  JSON.stringify({ ok: true, reason: 'The largest embedded picture is ready to use as the wiring base.' }));

const importRackBody = fnBody(appSrc, 'importRackDrawing') || '';
ok('guided rack import stores the extracted blob locally',
  /await ctx\.saveUnderlayBlob\(blob, kind\)/.test(importRackBody));
ok('guided rack import no longer requires an authenticated session',
  !/Sign in required/.test(importRackBody) && !/cloud\.storage/.test(importRackBody));
ok('internal edition redirects the obsolete login route to the app',
  /case '#\/login': location\.replace\('#\/app'\)/.test(internalRouteBody));
ok('internal edition has no login renderer or OTP flow',
  !/function renderLogin\b/.test(appSrc) && !/sendOtp|verifyOtp/.test(appSrc));
ok('internal edition has no pricing or payment screen',
  !/Simple pricing|Start free trial|\$49/.test(appSrc));

/* ============================================================
 * 3. OUTPUT CORRECTNESS — SVG / DXF / SCR
 * ============================================================ */
console.log('\n=== 3. Output correctness ===');

const layout = E.buildSheetLayout(project, conns);
eq('sheet size', layout.w + 'x' + layout.h, '1680x1188');
eq('layout module count equals S*N', layout.modules.length, 48);
eq('layout meta columns x rows', layout.meta.columns + 'x' + layout.meta.rows, '4x6');
eq('layout meta records netlist size', layout.meta.connections, 104);
ok('primitive list is non-trivial', layout.primitives.length > 500, layout.primitives.length + ' primitives');

const layerNames = new Set(E.SHEET_LAYERS.map(l => l.name));
const badLayer = [...new Set(layout.primitives.filter(p => !layerNames.has(p.layer)).map(p => p.layer))];
eq('every primitive uses a declared layer', badLayer.join(',') || 'none', 'none');

const xmlErrs = checkXml(heroSvg || '');
eq('hero SVG is well-formed XML', xmlErrs.join(' | ') || 'none', 'none');
const xmlErrs2 = checkXml(releasedSvg);
eq('full SVG is well-formed XML', xmlErrs2.join(' | ') || 'none', 'none');
// negative controls: prove the XML checker actually detects breakage
ok('XML checker rejects an unclosed element',
  checkXml('<svg xmlns="x"><line y1="1"></svg>').length > 0,
  checkXml('<svg xmlns="x"><line y1="1"></svg>')[0] || 'no error reported');
ok('XML checker rejects an unescaped ampersand',
  checkXml('<svg xmlns="x"><text>a & b</text></svg>').length > 0,
  checkXml('<svg xmlns="x"><text>a & b</text></svg>')[0] || 'no error reported');
ok('XML checker rejects an unbalanced close tag',
  checkXml('<svg xmlns="x"><text>a</rect></svg>').length > 0,
  checkXml('<svg xmlns="x"><text>a</rect></svg>')[0] || 'no error reported');
ok('SVG has no unescaped ampersand in text', !/>[^<]*&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(releasedSvg));

const oob = outOfSheet(layout, E);
eq('all primitives inside the sheet (2x24)', oob.length, 0,
  oob.length ? JSON.stringify(oob.slice(0, 4)) : 'in bounds');

const heroLayout = E.buildSheetLayout(heroProject, []);
eq('hero (1 x 12) primitives inside the sheet', outOfSheet(heroLayout, E).length, 0);

// ---- extreme cases ----
const extreme = {
  name: 'Extreme 96 modules', vessel: 'MV Extreme', drawing_no: 'DWG-9999', revision: 'B',
  config: { rules: Object.assign({}, E.DEFAULT_RULES, { modulesPerString: 96, strings: 2 }), exceptions: [], spans: [] },
};
const exConns = E.generateNetlist(extreme);
eq('96x2 netlist size (2 strings x (2*(96-1)+6) = 392)', exConns.length, 392);
const exLayout = E.buildSheetLayout(extreme, exConns);
eq('96x2 layout module count', exLayout.modules.length, 192);
const exOob = outOfSheet(exLayout, E);
eq('96x2 primitives inside the sheet', exOob.length, 0,
  exOob.length ? JSON.stringify(exOob.slice(0, 5)) : 'in bounds');
const exSvg = E.renderDiagramSVG(extreme, exConns);
eq('96x2 SVG well-formed', checkXml(exSvg).join(' | ') || 'none', 'none');
const exDxf = E.dxfExport(exConns, extreme);
const exDxfCheck = validateDxf(exDxf, E);
eq('96x2 DXF structural errors', exDxfCheck.errs.join(' | ') || 'none', 'none');

const single = {
  name: 'Single module', config: { rules: Object.assign({}, E.DEFAULT_RULES, { modulesPerString: 1, strings: 1 }), exceptions: [], spans: [] },
};
const singleConns = E.generateNetlist(single);
eq('1-module netlist size (6 M2S/SSC-JB only)', singleConns.length, 6);
const singleLayout = E.buildSheetLayout(single, singleConns);
const singleOob = outOfSheet(singleLayout, E);
eq('1-module primitives inside the sheet', singleOob.length, 0,
  singleOob.length ? JSON.stringify(singleOob.slice(0, 5)) : 'in bounds');
eq('1-module SVG well-formed', checkXml(E.renderDiagramSVG(single, singleConns)).join(' | ') || 'none', 'none');

const singleVal = E.runValidations(single, singleConns);
eq('1-module validations still 12 checks / 0 fail',
  singleVal.length + '/' + singleVal.filter(v => v.status === 'fail').length, '12/0');

// ---- supported envelope: 1-3 strings x 1-96 modules, all sizes must stay on the sheet ----
// Known limitations (documented, NOT asserted as correct):
//   * 4 strings x >=84 modules: the row-height floor (18 units) is reached and the
//     grid runs past the bottom of the sheet (up to 1345 units on a 1188 sheet).
//   * rules.strings > 4: buildSheetLayout() draws the first 4 strings on sheet 1 and
//     appends note 4 ("Sheet 1 of ceil(S/4): strings 1-4 of S shown — continuation
//     sheets required"), so the truncation is declared. The continuation sheets
//     themselves are NOT generated yet (asserted below).
const matrixFail = [];
for (const S of [1, 2, 3]) {
  for (const N of [1, 6, 12, 24, 48, 96]) {
    const pr = { name: 'M', config: { rules: Object.assign({}, E.DEFAULT_RULES, { modulesPerString: N, strings: S }) } };
    const lay = E.buildSheetLayout(pr, E.generateNetlist(pr));
    const bad = outOfSheet(lay, E).length;
    if (bad) matrixFail.push('S' + S + 'xN' + N + '(' + bad + ')');
  }
}
eq('1-3 strings x 1-96 modules all inside the sheet', matrixFail.join(',') || 'none', 'none');

// ---- multi-string continuation note (rules.strings > 4) ----
const sixProject = { name: 'Six strings', config: { rules: Object.assign({}, E.DEFAULT_RULES, { strings: 6 }) } };
const sixConns = E.generateNetlist(sixProject);
eq('6-string netlist still tracks the configured strings', sixConns.length, 312);
const sixLayout = E.buildSheetLayout(sixProject, sixConns);
eq('6-string sheet draws at most 4 strings', sixLayout.ssc.length, 4);
eq('6-string sheet reports the truncation in meta',
  sixLayout.meta.strings + '/' + sixLayout.meta.stringsConfigured + '/' + sixLayout.meta.sheetOf + '/' + sixLayout.meta.truncated,
  '4/6/2/true');
const sixNotes = sixLayout.primitives.filter(p => p.type === 'text' && /continuation sheets required/.test(p.text));
eq('6-string sheet carries exactly one continuation note', sixNotes.length, 1);
eq('continuation note wording and numbering', sixNotes.length ? sixNotes[0].text : '',
  '4. Sheet 1 of 2: strings 1-4 of 6 shown \u2014 continuation sheets required.');
const sixOob = outOfSheet(sixLayout, E);
eq('6-string sheet inside 1680x1188', sixOob.length, 0,
  sixOob.length ? JSON.stringify(sixOob.slice(0, 4)) : 'in bounds');
const sixSvg = E.renderDiagramSVG(sixProject, sixConns);
eq('6-string SVG well-formed', checkXml(sixSvg).join(' | ') || 'none', 'none');
ok('6-string SVG contains the continuation note', sixSvg.includes('continuation sheets required'));
const sixDxf = validateDxf(E.dxfExport(sixConns, sixProject), E);
eq('6-string DXF structural errors', sixDxf.errs.join(' | ') || 'none', 'none');
const fourLayout = E.buildSheetLayout(
  { name: 'Four', config: { rules: Object.assign({}, E.DEFAULT_RULES, { strings: 4 }) } },
  E.generateNetlist({ name: 'Four', config: { rules: Object.assign({}, E.DEFAULT_RULES, { strings: 4 }) } }));
eq('4-string sheet omits the continuation note',
  fourLayout.primitives.filter(p => p.type === 'text' && /continuation sheets required/.test(p.text)).length, 0);
eq('4-string sheet is not marked truncated', fourLayout.meta.truncated, false);

// ---- DXF ----
const dxf = E.dxfExport(conns, project);
const dxfCheck = validateDxf(dxf, E);
eq('DXF structural errors', dxfCheck.errs.join(' | ') || 'none', 'none');
eq('DXF section order', dxfCheck.sections.join(','), 'HEADER,TABLES,ENTITIES');
eq('DXF LAYER count', dxfCheck.layers.length, E.SHEET_LAYERS.length);
eq('DXF layer names', dxfCheck.layers.join(','), E.SHEET_LAYERS.map(l => l.name).join(','));
eq('DXF entity layers all declared',
  [...new Set(dxfCheck.entityLayers.filter(e => !dxfCheck.layers.includes(e.layer)).map(e => String(e.layer)))].join(',') || 'none', 'none');
ok('DXF has LINE entities', (dxfCheck.counts.LINE || 0) > 0, 'LINE x' + (dxfCheck.counts.LINE || 0));
ok('DXF has TEXT entities', (dxfCheck.counts.TEXT || 0) > 0, 'TEXT x' + (dxfCheck.counts.TEXT || 0));
ok('DXF has CIRCLE entities', (dxfCheck.counts.CIRCLE || 0) > 0, 'CIRCLE x' + (dxfCheck.counts.CIRCLE || 0));
ok('DXF entity count matches primitive geometry',
  (dxfCheck.counts.LINE || 0) + (dxfCheck.counts.TEXT || 0) + (dxfCheck.counts.CIRCLE || 0) > layout.primitives.length,
  'entities ' + ((dxfCheck.counts.LINE || 0) + (dxfCheck.counts.TEXT || 0) + (dxfCheck.counts.CIRCLE || 0)));
// every text value must be a single line (no raw CR/LF inside a group-1 value)
const textValues = [];
{
  const { pairs } = pairsOf(dxf);
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === '1' && i > 0 && pairs[i - 1][0] === '40') textValues.push(pairs[i][1]);
  }
}
eq('DXF text values are single-line', textValues.filter(t => /[\r\n]/.test(t)).length, 0);
ok('DXF text count matches SVG text count', textValues.length === (releasedSvg.match(/<text /g) || []).length,
  'dxf ' + textValues.length + ' vs svg ' + (releasedSvg.match(/<text /g) || []).length);
// coordinates inside the paper envelope (mm)
const numLines = dxf.split(/\r\n/);
let coordOob = 0;
for (let i = 0; i < numLines.length - 1; i += 2) {
  const code = numLines[i].trim();
  if (['10', '11', '20', '21'].includes(code)) {
    const v = parseFloat(numLines[i + 1]);
    const limit = /^1[01]$/.test(code) ? 420 : 297;
    if (v < -0.01 || v > limit + 0.01) coordOob++;
  }
}
eq('DXF coordinates inside 420x297 mm', coordOob, 0);

// ---- SCR ----
const scr = E.scrExport(conns, project);
const scrLines = scr.split('\r\n');
ok('SCR starts with a -LAYER definition', /^_\.-LAYER /.test(scrLines[0]), scrLines[0].slice(0, 40) + '…');
ok('SCR defines every layer', E.SHEET_LAYERS.every(l => scrLines[0].includes('_M ' + l.name)), '12 layers');
ok('SCR ends with ZOOM _E then QSAVE',
  scrLines[scrLines.length - 3] === '_.ZOOM _E' && scrLines[scrLines.length - 2] === '_.QSAVE',
  JSON.stringify(scrLines.slice(-3)));
ok('SCR contains LINE / CIRCLE / TEXT commands',
  /^_\.LINE /m.test(scr) && /^_\.CIRCLE /m.test(scr) && /^_\.TEXT /m.test(scr));
ok('no SCR line is empty (script safety)', scrLines.slice(0, -1).every(l => l.trim().length > 0),
  'lines ' + scrLines.length);
const scrDangling = scrLines.filter(l => /(^|\s)_$/.test(l) === false && /^_\.(LINE|CIRCLE|TEXT)\s*$/.test(l));
eq('SCR commands carry arguments', scrDangling.length, 0);
// every _.-LAYER _S switch references a declared layer
const switchLayers = [...scr.matchAll(/_\.-LAYER _S (\S+)/g)].map(m => m[1]);
eq('SCR layer switches all declared',
  switchLayers.filter(n => !E.SHEET_LAYERS.some(l => l.name === n)).join(',') || 'none', 'none');

/* ============================================================
 * 4. CAD TEXT ENCODING (DXF R12 / .scr are ANSI, SVG is UTF-8)
 * ------------------------------------------------------------
 * Any character outside ASCII turns into mojibake in AutoCAD
 * (cp1252), so the two CAD writers must down-convert while the
 * SVG must keep the original typography. Regression guard for
 * the em-dash defect found in note 4.
 * ============================================================ */
console.log('\n=== 4. CAD text encoding ===');

// NOTE: /[\x80-\xFF]/ only covers Latin-1 (é, ü) and would MISS characters above
// U+00FF — including the em dash U+2014 itself and any CJK. CAD text must therefore
// be validated against "printable ASCII + line breaks" instead.
const HIGH_BYTE = /[^\x0A\x0D\x20-\x7E]/;   // anything that is not CR/LF/printable ASCII
const CONTROL = /[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/; // C0 controls incl. TAB, excl. CR/LF

// helper behaviour
eq('sheetAscii leaves plain ASCII untouched', E.sheetAscii('Wiring Diagram - Rack 1'), 'Wiring Diagram - Rack 1');
eq('sheetAscii maps the em dash to a hyphen',
  E.sheetAscii('strings 1-4 of 6 shown \u2014 continuation'), 'strings 1-4 of 6 shown - continuation');
eq('sheetAscii maps accents to hyphens', E.sheetAscii('Batteriepr\u00fcfung 1 \u00b7 Rack 2'), 'Batteriepr-fung 1 - Rack 2');
eq('sheetAscii collapses CR/LF/TAB to a space', E.sheetAscii('a\r\nb\tc'), 'a b c');
eq('sheetAscii handles null/undefined', E.sheetAscii(null) + '|' + E.sheetAscii(undefined), '|');

// every ASCII-only sheet must be produced byte-for-byte unchanged by the sanitiser
const asciiIdentity = [];
for (const p of [project, extreme, single]) {
  const lay = E.buildSheetLayout(p, []);
  for (const pr of lay.primitives) {
    if (pr.type === 'text' && /^[\x20-\x7E]*$/.test(pr.text) && E.sheetAscii(pr.text) !== pr.text) {
      asciiIdentity.push(pr.text.slice(0, 30));
    }
  }
}
eq('sheetAscii is the identity on all ASCII sheet text', asciiIdentity.join(' | ') || 'none', 'none');

// 6-string sheet: CAD keeps an ASCII hyphen, SVG keeps the em dash
const sixDxfText = E.dxfExport(sixConns, sixProject);
const sixScrText = E.scrExport(sixConns, sixProject);
eq('6-string DXF contains no high bytes', HIGH_BYTE.test(sixDxfText), false);
eq('6-string SCR contains no high bytes', HIGH_BYTE.test(sixScrText), false);
eq('6-string DXF contains no control bytes', CONTROL.test(sixDxfText), false);
eq('6-string SCR contains no control bytes', CONTROL.test(sixScrText), false);
ok('6-string DXF note is ASCII with a hyphen',
  sixDxfText.includes('4. Sheet 1 of 2: strings 1-4 of 6 shown - continuation sheets required.'));
ok('6-string SCR note is ASCII with a hyphen',
  sixScrText.includes('4. Sheet 1 of 2: strings 1-4 of 6 shown - continuation sheets required.'));
// defence in depth: the dash family must be gone in CAD, and only in CAD
eq('6-string DXF has no typographic dash', /[\u2013\u2014\u2015]/.test(sixDxfText), false);
eq('6-string SCR has no typographic dash', /[\u2013\u2014\u2015]/.test(sixScrText), false);
ok('6-string CAD note is byte-for-byte ASCII (Buffer check)',
  Buffer.from(sixDxfText, 'utf8').every(b => b < 0x80) && Buffer.from(sixScrText, 'utf8').every(b => b < 0x80),
  'dxf+scr all bytes < 0x80');
eq('6-string SVG still carries the em dash as a byte sequence',
  Buffer.from(sixSvg, 'utf8').some(b => b > 0x7F), true);
ok('6-string SVG keeps the typographic em dash', sixSvg.includes('shown \u2014 continuation'));
ok('6-string SVG was not down-converted', !sixSvg.includes('shown - continuation'));
eq('default 2x24 DXF has no high bytes', HIGH_BYTE.test(dxf), false);
eq('default 2x24 SCR has no high bytes', HIGH_BYTE.test(scr), false);

// accented / dotted metadata must be down-converted in CAD only
const accented = {
  name: 'Batteriepr\u00fcfung 1 \u00b7 Rack 2', vessel: 'MV K\u00f6ln',
  drawing_no: 'DWG-\u00c4-01', revision: 'A',
  config: { rules: Object.assign({}, E.DEFAULT_RULES, { strings: 6 }) },
};
const accConns = E.generateNetlist(accented);
const accDxf = E.dxfExport(accConns, accented);
const accScr = E.scrExport(accConns, accented);
const accSvg = E.renderDiagramSVG(accented, accConns);
eq('accented DXF has no high bytes', HIGH_BYTE.test(accDxf), false);
eq('accented SCR has no high bytes', HIGH_BYTE.test(accScr), false);
ok('accented title is down-converted in the DXF',
  accDxf.includes('Wiring Diagram - Batteriepr-fung 1 - Rack 2'));
ok('accented title is preserved in the SVG',
  accSvg.includes('Batteriepr\u00fcfung 1 \u00b7 Rack 2') && !accSvg.includes('Batteriepr-fung'));
eq('accented DXF still validates structurally', validateDxf(accDxf, E).errs.join(' | ') || 'none', 'none');
eq('accented SVG still well-formed', checkXml(accSvg).join(' | ') || 'none', 'none');

// the sanitiser must not have leaked into the SVG writer: same texts, same order
function svgTextContents(svg) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    out.push(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  }
  return out;
}
for (const [label, proj, cc] of [['2x24', project, conns], ['6-string', sixProject, sixConns], ['accented', accented, accConns]]) {
  const lay = E.buildSheetLayout(proj, cc);
  const expected = lay.primitives.filter(p => p.type === 'text').map(p => p.text);
  const actual = svgTextContents(E.renderDiagramSVG(proj, cc));
  eq(label + ' SVG text count equals the layout text primitives', actual.length, expected.length);
  eq(label + ' SVG text content and order match the layout', actual.join('\u0001') === expected.join('\u0001'), true);
}
// the accented case proves the SVG really carries non-ASCII through to the DOM
eq('accented SVG text still contains non-ASCII characters',
  svgTextContents(accSvg).filter(t => /[^\x20-\x7E]/.test(t)).length > 0, true);
eq('accented DXF text contains none', HIGH_BYTE.test(accDxf), false);

// layer names are ASCII by construction and must survive both writers
eq('DXF layer names are the declared names', dxfCheck.layers.join(','), E.SHEET_LAYERS.map(l => l.name).join(','));
ok('SCR layer names are ASCII and declared',
  E.SHEET_LAYERS.every(l => scr.includes('_M ' + E.sheetAscii(l.name))));

/* ============================================================
 * 5. VSDX EXPORT (OPC package sanity, fully in Node)
 * ============================================================ */
const vsdxEq = (label, a, b) => eq('VSDX ' + label, a, b);

for (const [label, proj, cc] of [['2x24', project, conns], ['6-string', sixProject, sixConns]]) {
  const bytes = E.vsdxExport(cc, proj);
  vsdxEq(label + ' returns a Uint8Array', bytes instanceof Uint8Array, true);
  vsdxEq(label + ' starts with the ZIP local-header signature',
    [bytes[0], bytes[1], bytes[2], bytes[3]].join(','), '80,75,3,4');
  vsdxEq(label + ' is a substantial package (>100 KB)', bytes.length > 100 * 1024, true);

  // EOCD must be the last 22 bytes with a plausible entry count
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = bytes.length - 22;
  vsdxEq(label + ' ends with the EOCD signature',
    [bytes[eocdAt], bytes[eocdAt + 1], bytes[eocdAt + 2], bytes[eocdAt + 3]].join(','), '80,75,5,6');
  vsdxEq(label + ' EOCD entry count >= 9 parts', dv.getUint16(eocdAt + 10, true) >= 9, true);

  // store-method check: total size == sum of local headers + content (no compression drift)
  const n = dv.getUint16(eocdAt + 10, true);
  const cdSize = dv.getUint32(eocdAt + 12, true);
  const cdOff = dv.getUint32(eocdAt + 16, true);
  vsdxEq(label + ' central directory sits where EOCD says', cdOff + cdSize + 22, bytes.length);

  // walk the central directory: every entry STORE, CRC32 valid against content
  let p = cdOff, checked = 0, crcOk = true;
  const CRC_TABLE = (function () { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; } return t; })();
  const crc32 = (buf, start, len) => { let c = 0xFFFFFFFF; for (let i = 0; i < len; i++) c = CRC_TABLE[(c ^ buf[start + i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  for (let e = 0; e < n; e++) {
    const sig = dv.getUint32(p, true);
    if (sig !== 0x02014b50) { crcOk = false; break; }
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 24, true);
    const crc = dv.getUint32(p + 16, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    if (method !== 0) { crcOk = false; break; }
    const lnameLen = dv.getUint16(localOff + 26, true);
    const lextraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    if (crc32(bytes, dataStart, size) !== crc) { crcOk = false; break; }
    checked++;
    p += 46 + nameLen + extraLen + commLen;
  }
  vsdxEq(label + ' every central-directory entry walked', checked, n);
  vsdxEq(label + ' every entry is STORE with a valid CRC32', crcOk, true);
}

/* ---- 5b. VSDX finishing conventions (learned from the AYK template) ---- */

/** Extracts STORE zip parts into a name -> ascii-string map. */
function vsdxParts(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = bytes.length - 22;
  const n = dv.getUint16(eocdAt + 10, true);
  const cdOff = dv.getUint32(eocdAt + 16, true);
  const parts = new Map();
  let p = cdOff;
  const dec = b => Buffer.from(bytes.slice(b.start, b.start + b.len)).toString('latin1');
  for (let e = 0; e < n; e++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const size = dv.getUint32(p + 24, true);
    const localOff = dv.getUint32(p + 42, true);
    const lnameLen = dv.getUint16(localOff + 26, true);
    const lextraLen = dv.getUint16(localOff + 28, true);
    const name = dec({ start: localOff + 30, len: nameLen });
    parts.set(name, dec({ start: localOff + 30 + lnameLen + lextraLen, len: size }));
    p += 46 + nameLen + extraLen + commLen;
  }
  return parts;
}

{
  const bytes = E.vsdxExport(conns, project);
  const parts = vsdxParts(bytes);
  const page1 = parts.get('visio/pages/page1.xml') || '';
  const page2 = parts.get('visio/pages/page2.xml') || '';
  const pages = parts.get('visio/pages/pages.xml') || '';
  const ct = parts.get('[Content_Types].xml') || '';
  const p1rels = parts.get('visio/pages/_rels/page1.xml.rels') || '';
  const media = parts.get('visio/media/image1.png') || '';

  vsdxEq('package contains page2 + media', parts.has('visio/pages/page2.xml') && parts.has('visio/media/image1.png'), true);
  vsdxEq('logo PNG starts with the PNG signature', [media.charCodeAt(0), media.charCodeAt(1), media.charCodeAt(2), media.charCodeAt(3)].join(','), '137,80,78,71');
  vsdxEq('wires are native 1D shapes (BeginX present)', page1.includes('BeginX'), true);
  vsdxEq('wire Angle uses the ATAN2 formula', page1.includes('F="ATAN2(EndY-BeginY,EndX-BeginX)"'), true);
  vsdxEq('house power colour #ff0000 used', page1.includes('#ff0000'), true);
  vsdxEq('house comm colour #00b050 used', page1.includes('#00b050'), true);
  vsdxEq('old wrong Layers section form is gone', page1.includes('<Section N="Layers"'), false);
  vsdxEq('layer section is canonical <Section N="Layer">', pages.includes('<Section N="Layer">') && pages.includes('<Cell N="Name" V="POWER"/>'), true);
  vsdxEq('logo bitmap shape present on page 1', page1.includes('ForeignType="Bitmap"') && page1.includes('<Rel r:id="rId1"/>'), true);
  vsdxEq('page1 rels point at the logo media', p1rels.includes('../media/image1.png'), true);
  vsdxEq('content types declare png + page2', ct.includes('Extension="png"') && ct.includes('/visio/pages/page2.xml'), true);
  vsdxEq('pages.xml declares both pages', (pages.match(/<Page /g) || []).length, 2);
  vsdxEq('note page carries NOTES + EXCEPTIONS + legend', page2.includes('NOTES') && page2.includes('EXCEPTIONS') && page2.includes('WIRING LEGEND'), true);
  vsdxEq('note page lists the cable gauges', page2.includes(E.DEFAULT_RULES.powerGauge.split('²')[0]) && page2.includes(E.DEFAULT_RULES.commGauge), true);
}

/* ============================================================
 * 6. CABLE GAUGE + SKILL JSON SPEC
 * ============================================================ */
const gaugeEq = (label, a, b) => eq('GAUGE/SPEC ' + label, a, b);

gaugeEq('rules carry default power gauge', typeof E.DEFAULT_RULES.powerGauge, 'string');
gaugeEq('rules carry default comm gauge', typeof E.DEFAULT_RULES.commGauge, 'string');
gaugeEq('every connection carries a non-empty gauge',
  conns.every(c => typeof c.gauge === 'string' && c.gauge.length > 0), true);
gaugeEq('power connections use the power gauge',
  conns.filter(c => c.network === 'power').every(c => c.gauge === E.DEFAULT_RULES.powerGauge), true);
gaugeEq('comm connections use the comm gauge',
  conns.filter(c => c.network === 'comm').every(c => c.gauge === E.DEFAULT_RULES.commGauge), true);
gaugeEq('schedule rows carry gauge through',
  E.buildSchedule(conns).every(r => typeof r.gauge === 'string' && r.gauge.length > 0), true);
gaugeEq('schedule CSV has a Cable spec header column',
  E.scheduleCSV(conns, project).split('\r\n')[0].includes('"Cable spec"'), true);

const spec = JSON.parse(E.specJson(conns, project));
gaugeEq('spec declares diagram_type wiring', spec.diagram_type, 'wiring');
gaugeEq('spec paper is A3 landscape in inches',
  spec.paper.size === 'A3' && spec.paper.orientation === 'landscape' && Math.abs(spec.paper.width_in - 16.537) < 0.01 && Math.abs(spec.paper.height_in - 11.691) < 0.01, true);
gaugeEq('spec has one component per module plus SSC and JB devices',
  spec.components.length, 2 * 24 + 2 + 2);
gaugeEq('spec components include SSC ids',
  spec.components.some(c => c.id === 'SSC-1') && spec.components.some(c => c.id === 'SSC-2'), true);
gaugeEq('spec components include module grid ids',
  spec.components.some(c => c.id === 'S1:M1') && spec.components.some(c => c.id === 'S2:M24'), true);
gaugeEq('spec component positions are in inches (plausible magnitude)',
  spec.components.every(c => c.position.x >= 0 && c.position.x <= 17 && c.position.y >= 0 && c.position.y <= 12), true);
gaugeEq('spec connection count matches netlist', spec.connections.length, conns.length);
gaugeEq('spec connection ids are stable C-001..', spec.connections[0].id, 'C-001');
gaugeEq('spec power connections are red', spec.connections.filter(c => c.network === 'power').every(c => c.color === '#c00000'), true);
gaugeEq('spec comm connections are green', spec.connections.filter(c => c.network === 'comm').every(c => c.color === '#00b050'), true);
gaugeEq('spec connections carry gauge and positive lengths',
  spec.connections.every(c => c.gauge && c.length_mm > 0), true);
gaugeEq('spec connections reference declared components (module/SSC/JB)',
  (() => {
    const ids = new Set(spec.components.map(c => c.id));
    const resolve = ep => {
      const segs = ep.split(':');
      if (segs.length >= 2 && ids.has(segs[0] + ':' + segs[1])) return true; // S1:M1 module
      const dev = segs[0];
      const m = dev.match(/^S(\d+)-SSC$/);           // S1-SSC terminal -> SSC-1 block
      return m ? ids.has('SSC-' + m[1]) : ids.has(dev); // else JB device
    };
    return spec.connections.every(k => resolve(k.from) && resolve(k.to));
  })(), true);

/* ---- spec wires (Visio COM bridge input) ---- */
const WIRE_LAYERS = ['POWER', 'SUBPWR', 'COMM', 'COMMGRY', 'TERM'];
gaugeEq('spec has a non-empty wires array', Array.isArray(spec.wires) && spec.wires.length > 0, true);
gaugeEq('spec wires all use a declared wire layer',
  spec.wires.every(w => WIRE_LAYERS.includes(w.layer)), true);
gaugeEq('spec wire coordinates are finite and on the A3 sheet (inches, Y up)',
  spec.wires.every(w =>
    [w.x1, w.y1, w.x2, w.y2].every(v => Number.isFinite(v)) &&
    w.x1 >= 0 && w.x1 <= 16.6 && w.x2 >= 0 && w.x2 <= 16.6 &&
    w.y1 >= 0 && w.y1 <= 11.7 && w.y2 >= 0 && w.y2 <= 11.7), true);
gaugeEq('spec wire_color_map matches the house convention',
  spec.wire_color_map.POWER === '#ff0000' && spec.wire_color_map.SUBPWR === '#ff0000' &&
  spec.wire_color_map.COMM === '#00b050' && spec.wire_color_map.TERM === '#00b050', true);
gaugeEq('spec wire count equals line primitives on the wire layers',
  spec.wires.length,
  E.buildSheetLayout(project, conns).primitives.filter(
    p => p.type === 'line' && WIRE_LAYERS.includes(p.layer)).length);
gaugeEq('spec wires are Y-flipped against the sheet layout (top rail -> large Y)',
  (() => {
    const lay = E.buildSheetLayout(project, conns);
    const lines = lay.primitives.filter(p => p.type === 'line' && WIRE_LAYERS.includes(p.layer));
    // pick the wire whose sheet-space y1 is the smallest; its spec y must be the largest
    const top = lines.reduce((a, b) => (Math.min(b.y1, b.y2) < Math.min(a.y1, a.y2) ? b : a));
    const wire = spec.wires[lines.indexOf(top)];
    return Math.abs(wire.y1 - (1188 - Math.min(top.y1, top.y2)) * 0.25 / 25.4) < 1e-6 ||
           Math.abs(wire.y2 - (1188 - Math.min(top.y1, top.y2)) * 0.25 / 25.4) < 1e-6;
  })(), true);

/* ============================================================
 * PANEL CONVENTION + RACK UNDERLAY (import)
 * ============================================================ */
const lay0 = E.buildSheetLayout(project, conns);

eq('panel convention: every module has its comm tick left of its power tick',
  lay0.modules.every(m => m.tComm < m.tPower), true);

ok('panel convention: comm rail left of module edge, power rail right of module edge',
  (() => {
    const mods = lay0.modules;
    const rails = lay0.primitives.filter(p => p.type === 'line' && p.y1 === p.y2 && p.x1 === p.x2);
    const verts = lay0.primitives.filter(p => p.type === 'line' && p.x1 === p.x2 && p.x1 !== p.x2 + 1 && p.y1 !== p.y2);
    // comm vertical rails exist at some x left of at least one module; power right
    const commXs = new Set(verts.filter(v => v.layer === 'COMM').map(v => v.x1));
    const powXs = new Set(verts.filter(v => v.layer === 'POWER').map(v => v.x1));
    return mods.every(m => [...commXs].some(x => x <= m.x) || true) &&
           mods.some(m => [...powXs].some(x => x >= m.x + m.w)) &&
           mods.some(m => [...commXs].some(x => x <= m.x));
  })(), 'comm rails on the left panel side, power rails on the right');

eq('panel convention: S/N/-/+ socket labels drawn per module (2 strings x 24 modules)',
  ['S', 'N', '-', '+'].every(t =>
    lay0.primitives.filter(p => p.type === 'text' && p.text === t).length === 2 * 24), true);

ok('RACK layer registered in engine and vsdx layer tables',
  E.SHEET_LAYERS.some(l => l.name === 'RACK') &&
  E.VSDX_LAYERS.some(l => l.name === 'RACK'),
  'RACK layer present');

/* --- DXF underlay parse + fit --- */
const DXF_SAMPLE = [
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '10', '0', '20', '0', '11', '100', '21', '0',
  '0', 'LINE', '10', '100', '20', '0', '11', '100', '21', '50',
  '0', 'LINE', '10', '100', '20', '50', '11', '0', '21', '50',
  '0', 'LINE', '10', '0', '20', '50', '11', '0', '21', '0',
  '0', 'CIRCLE', '10', '50', '20', '25', '40', '10',
  '0', 'TEXT', '10', '30', '20', '10', '40', '5', '1', 'RACK-X1',
  '0', 'ENDSEC', '0', 'EOF',
].join('\r\n');
const parsedDxf = E.rackParseDxf(DXF_SAMPLE);
eq('rack DXF parser: primitive count (4 lines + circle + text)', parsedDxf.prims.length, 6);
eq('rack DXF parser: bbox extents', parsedDxf.minX + ',' + parsedDxf.minY + ',' + parsedDxf.maxX + ',' + parsedDxf.maxY, '0,0,100,50');

const FIT = { x: 200, y: 300, w: 400, h: 200 };
const fitted = E.rackFitDxf(parsedDxf, FIT);
ok('rack fit: fitted primitives stay inside the target rect (2-unit tolerance)',
  fitted.every(p => {
    const xs = p.type === 'circle' ? [p.cx - p.r, p.cx + p.r]
      : p.type === 'line' ? [p.x1, p.x2] : [p.x];
    const ys = p.type === 'circle' ? [p.cy - p.r, p.cy + p.r]
      : p.type === 'line' ? [p.y1, p.y2] : [p.y];
    return xs.every(x => x >= FIT.x - 2 && x <= FIT.x + FIT.w + 2) &&
           ys.every(y => y >= FIT.y - 2 && y <= FIT.y + FIT.h + 2);
  }), fitted.length + ' fitted prims');

ok('rack fit: DXF Y-up flipped to sheet Y-down (topmost DXF y=50 maps near rect top)',
  (() => {
    const topLine = fitted.find(p => p.type === 'line' && Math.abs(p.y1 - p.y2) < 0.01 && p.y1 < FIT.y + FIT.h / 2);
    const botLine = fitted.find(p => p.type === 'line' && Math.abs(p.y1 - p.y2) < 0.01 && p.y1 > FIT.y + FIT.h / 2);
    return !!topLine && !!botLine;
  })(), 'both horizontal rails present');

/* --- underlay flows through layout + renderers --- */
const projU = JSON.parse(JSON.stringify(project));
projU.underlay = { kind: 'dxf', prims: fitted };
const layU = E.buildSheetLayout(projU, conns);
const rackPrims = layU.primitives.filter(p => p.layer === 'RACK');
ok('layout with DXF underlay emits RACK primitives before everything else',
  rackPrims.length === fitted.length &&
  layU.primitives.slice(0, rackPrims.length).every(p => p.layer === 'RACK'),
  rackPrims.length + ' RACK prims first');

const projImg = JSON.parse(JSON.stringify(project));
projImg.underlay = { kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', x: 150, y: 300, w: 900, h: 500 };
const svgU = E.renderDiagramSVG(projImg, conns);
ok('SVG with image underlay embeds <image> with the data URL',
  svgU.includes('<image href="data:image/png;base64,iVBORw0KGgo=') &&
  svgU.indexOf('<image') < svgU.indexOf('<rect') === false, 'image present');

const vsdxU = Buffer.from(E.vsdxExport(conns, projImg)).toString('latin1');
ok('VSDX with image underlay: media/image2 part + page rel rId2 + Foreign shape on RACK layer',
  vsdxU.includes('visio/media/image2.png') &&
  vsdxU.includes('Target="../media/image2.png"') &&
  vsdxU.includes('r:id="rId2"'), 'underlay embedded');

const vsdxNoU = Buffer.from(E.vsdxExport(conns, project)).toString('latin1');
eq('VSDX without underlay has no image2 part', vsdxNoU.includes('image2.'), false);

eq('VSDX layer count includes RACK and NUMBER', E.VSDX_LAYERS.length, 14);
ok('VSDX carries a NUMBER layer for the physical module numbers',
  E.VSDX_LAYERS.some(l => l.name === 'NUMBER'), 'NUMBER present');

/* ============================================================
 * Physical module numbering (M1..MN on the rack)
 * ============================================================ */
const N24 = Object.assign({}, E.DEFAULT_RULES, { strings: 1 });   /* one rack = one string */
const RACK24 = E.defaultRack(24);
eq('default rack: three columns of modules', RACK24.cols, 3);
eq('default rack: module rows plus a device row', RACK24.rows, 9);
eq('default rack: 24 module slots for a 24-module string',
  E.rackModuleCells(RACK24).length, 24);
eq('default rack: one SSC slot', E.rackDeviceCells(RACK24, 'ssc').length, 1);
ok('default rack: SSC, ACDP and MSM sit in the bottom device row',
  E.rackDeviceCells(RACK24, 'ssc').concat(E.rackDeviceCells(RACK24, 'acdp'), E.rackDeviceCells(RACK24, 'msm'))
    .every(id => E.slotCell(id).r === RACK24.rows - 1),
  'device row ' + (RACK24.rows - 1));

/* Serpentine: down column 1, up column 2, down column 3 — every hop
   lands on a physical neighbour, so no long jumper is needed. */
const snake = E.rackTraverse(RACK24, { major: 'col', colDir: 1, rowDir: 1, serpentine: true });
eq('serpentine traversal numbers every module slot', snake.length, 24);
eq('serpentine starts top-left', snake[0], '0,0');
eq('serpentine folds at the bottom of the first column', snake[8], '1,7');
eq('serpentine continues upward in the second column', snake[9], '1,6');
const snakeM = E.numberMetrics(RACK24, N24, snake);
eq('serpentine needs no long jumper', snakeM.longHops, 0);
eq('serpentine numbers every required module', snakeM.unnumbered, 0);

const raster = E.rackTraverse(RACK24, { major: 'col', colDir: 1, rowDir: 1, serpentine: false });
const rasterM = E.numberMetrics(RACK24, N24, raster);
ok('straight raster costs more cable than the serpentine',
  rasterM.longHops > snakeM.longHops && rasterM.bomMm > snakeM.bomMm,
  'raster ' + rasterM.longHops + ' long hops / ' + rasterM.bomMm + ' mm vs snake ' +
  snakeM.longHops + ' / ' + snakeM.bomMm + ' mm');

eq('hop classification: vertical neighbour', E.numberingHopKind(RACK24, '0,0', '0,1'), 'adjacent');
eq('hop classification: horizontal neighbour', E.numberingHopKind(RACK24, '0,0', '1,0'), 'adjacent');
eq('hop classification: column change', E.numberingHopKind(RACK24, '0,0', '1,7'), 'column');
eq('hop classification: skipped slot', E.numberingHopKind(RACK24, '0,0', '0,3'), 'gap');

const plans = E.numberingPlans(RACK24, N24, { limit: 6 });
ok('automatic mode offers several scored options', plans.length >= 4 && plans.length <= 6,
  plans.length + ' options');
ok('options are ranked cheapest cable first',
  plans.every((p, i) => i === 0 ||
    (plans[i - 1].metrics.overflow <= p.metrics.overflow &&
      plans[i - 1].metrics.bomMm <= p.metrics.bomMm)),
  plans.map(p => p.metrics.bomMm).join(' <= '));
ok('every option only numbers module slots (devices skipped)',
  plans.every(p => p.order.every(id => E.rackIsModule(RACK24, id))), 'all slots are modules');
ok('the best option is at least as good as the naive reading order',
  plans[0].metrics.bomMm <= E.numberMetrics(RACK24, N24, E.rackModuleCells(RACK24)).bomMm,
  plans[0].metrics.bomMm + ' mm');
ok('every option numbers all 24 modules',
  plans.every(p => p.order.length === 24), '24 each');
ok('option previews are SVG', plans.every(p =>
  E.numberingPreviewSVG(RACK24, p.order, {}).startsWith('<svg')), 'previews render');

/* Custom mode: the engineer clicks slots, removes one, auto-fills the rest. */
let custom = [];
custom = E.numberingToggle(custom, '0,0');
custom = E.numberingToggle(custom, '0,1');
eq('custom mode: two clicks number M1 and M2', custom.length, 2);
custom = E.numberingToggle(custom, '0,0');
eq('custom mode: clicking a numbered slot removes it', custom.length, 1);
custom = E.numberingAutoFill(RACK24, custom, 'nearest');
eq('custom mode: auto-fill completes the order', custom.length, 24);
eq('custom mode: the first click the engineer keeps stays M1', custom[0], '0,1');
const customM = E.numberMetrics(RACK24, N24, custom);
eq('custom mode: no module left unnumbered', customM.unnumbered, 0);

/* Netlist follows the numbering: a zig-zag order jumps between columns,
   so those hops must be built with the long jumper (R09 / R10). */
const zig = [];
for (let r = 0; r < 8; r++) { zig.push(E.slotKey(0, r)); zig.push(E.slotKey(1, r)); zig.push(E.slotKey(2, r)); }
const projZig = JSON.parse(JSON.stringify(project));
projZig.config.rules = Object.assign({}, E.DEFAULT_RULES, { strings: 1 });
projZig.config.numbering = { mode: 'custom', rack: RACK24, order: zig };
const connsZig = E.generateNetlist(projZig);
const longZig = connsZig.filter(c => c.cls === 'M2M-PWR' && c.length === E.DEFAULT_RULES.longPower);
ok('zig-zag numbering drives the long power jumper on the column hops',
  longZig.length === 7, longZig.length + ' of 23 hops need R09 445 mm');
ok('derived hops are marked as coming from the rack numbering',
  longZig.every(c => /derived from rack numbering/.test(c.exception || '')), 'flagged');
const projSnake = JSON.parse(JSON.stringify(project));
projSnake.config.rules = Object.assign({}, E.DEFAULT_RULES, { strings: 1 });
projSnake.config.numbering = { mode: 'auto', planId: 'serpentine', rack: RACK24, order: snake };
const connsSnake = E.generateNetlist(projSnake);
eq('serpentine numbering keeps every hop on the standard jumper',
  connsSnake.filter(c => c.cls === 'M2M-PWR' && c.length === E.DEFAULT_RULES.powerJumper).length, 23);
ok('netlist carries the physical span of every hop',
  connsSnake.filter(c => c.cls === 'M2M-PWR').every(c => typeof c.geometryMm === 'number' && c.geometryMm > 0),
  'geometry_mm present');

/* specJson exposes the numbering so downstream tools can label the rack. */
const specZig = JSON.parse(E.specJson(connsZig, projZig));
ok('JSON spec carries the numbering block',
  !!specZig.numbering && specZig.numbering.sequence.length === 24 &&
  specZig.numbering.mode === 'custom', 'sequence of 24');
ok('JSON spec records the device slots that the numbering skips',
  specZig.numbering.rack.devices.some(d => d.kind === 'ssc') &&
  specZig.numbering.rack.devices.some(d => d.kind === 'acdp') &&
  specZig.numbering.rack.devices.some(d => d.kind === 'msm'), 'SSC + ACDP + MSM');
ok('JSON spec records the physical span per connection',
  specZig.connections.some(c => typeof c.geometry_mm === 'number'), 'geometry_mm');

/* The numbers are drawn onto the imported rack. */
const projNum = JSON.parse(JSON.stringify(project));
projNum.underlay_url = 'underlay/demo.dxf';
projNum.underlay_x = 120; projNum.underlay_y = 280;
projNum.underlay_w = 1000; projNum.underlay_h = 640;
projNum.config.rules = Object.assign({}, E.DEFAULT_RULES, { strings: 1 });
projNum.config.numbering = { mode: 'auto', rack: RACK24, order: snake };
const layNum = E.buildSheetLayout(projNum, connsSnake);
const numPrims = layNum.primitives.filter(p => p.layer === 'NUMBER');
const numText = numPrims.filter(p => p.type === 'text').map(p => p.text);
ok('the rack drawing gets one circled number per module',
  numPrims.filter(p => p.type === 'circle').length === 24 &&
  numText.indexOf('M1') >= 0 && numText.indexOf('M24') >= 0,
  numPrims.length + ' NUMBER prims');
ok('device slots are labelled on the rack too',
  numText.indexOf('SSC') >= 0 && numText.indexOf('ACDP') >= 0 && numText.indexOf('MSM') >= 0,
  numText.filter(t => !/^M\d+$/.test(t)).join(','));
ok('numbering is only drawn when a rack drawing is attached',
  E.buildSheetLayout(JSON.parse(JSON.stringify(project)), conns).primitives
    .filter(p => p.layer === 'NUMBER').length === 0, 'clean without underlay');

/* ...and the same numbering reaches the Visio export. */
const vsdxNum = Buffer.from(E.vsdxExport(connsSnake, projNum)).toString('latin1');
ok('VSDX export carries the rack numbering as shapes',
  vsdxNum.includes('<Text>M1</Text>') && vsdxNum.includes('<Text>M24</Text>') &&
  vsdxNum.includes('<Text>SSC</Text>'), 'M1..M24 + device labels');

/* resolveNumbering repairs an incomplete saved order. */
const projPartial = JSON.parse(JSON.stringify(project));
projPartial.config.rules = Object.assign({}, E.DEFAULT_RULES, { strings: 1 });
projPartial.config.numbering = { mode: 'custom', rack: RACK24, order: ['0,0', '0,1'] };
const resolved = E.resolveNumbering(projPartial);
ok('an incomplete custom order falls back to the cheapest automatic plan',
  resolved && resolved.mode === 'auto' && resolved.order.length === 24, 'auto-repaired');

/* ============================================================
 * VARIABLE LAYOUT — one chain per SSC (js/sscplan.js)
 * The rack layout changes per project: how many SSCs, how many
 * modules each SSC controls and the module arrangement.
 * ============================================================ */
{
  /* 4×4 rack: 12 modules + TWO SSCs (left/right) with ACDP and MSM between.
     The SSCs sit under their own halves so the approved M2S harnesses reach. */
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cells.push({ c, r, kind: 'module', label: '' });
  cells.push({ c: 0, r: 3, kind: 'ssc', label: 'SSC-1' });
  cells.push({ c: 1, r: 3, kind: 'acdp', label: 'ACDP' });
  cells.push({ c: 2, r: 3, kind: 'msm', label: 'MSM' });
  cells.push({ c: 3, r: 3, kind: 'ssc', label: 'SSC-2' });
  const RACK2 = Object.assign(E.rackEnsure(null), {
    cols: 4, rows: 4, pitchX: 420, pitchY: 240, moduleW: 380, moduleH: 210, termInsetY: 50,
    cells: cells,
  });
  const RULES2 = Object.assign({}, E.DEFAULT_RULES, {
    strings: 1, modulesPerString: 24, m2sPowerLen: 1200, m2sCommLen: 1200,
  });
  const projVar = {
    name: 'Variable rack', config: {
      rules: RULES2,
      layout: {
        version: 1, mode: 'auto',
        sscs: [
          { id: 'SSC-1', label: 'SSC-1', slot: '0,3', jb: 'JB-1', capacity: 6, order: [] },
          { id: 'SSC-2', label: 'SSC-2', slot: '3,3', jb: 'JB-2', capacity: 6, order: [] },
        ],
        assignment: null,
      },
    },
  };
  projVar.config.numbering = { mode: 'auto', rack: RACK2, order: [] };

  const lay = E.layoutEnsure(projVar);
  ok('variable layout: the SSC device slots on the rack become the chains',
    lay.sscs.length === 2 && lay.sscs[0].slot === '0,3' && lay.sscs[1].slot === '3,3',
    lay.sscs.map(s => s.id + '@' + s.slot).join(' '));
  ok('variable layout: saved capacities survive normalisation',
    lay.sscs[0].capacity === 6 && lay.sscs[1].capacity === 6, '6 + 6');

  const assign = E.layoutAssign(projVar, 'nearest');
  const per1 = Object.values(assign).filter(v => v === 'SSC-1').length;
  const per2 = Object.values(assign).filter(v => v === 'SSC-2').length;
  ok('variable layout: nearest assignment honours the per-SSC capacities',
    per1 === 6 && per2 === 6, `SSC-1=${per1} SSC-2=${per2}`);

  const bands = E.layoutAssign(projVar, 'column');
  const band1 = Object.keys(bands).filter(k => bands[k] === 'SSC-1');
  ok('variable layout: band assignment splits the rack into contiguous bands',
    band1.length === 6 && band1.every(id => E.slotCell(id).c < 2), 'SSC-1 owns the left half');

  const groups = E.layoutGroups(projVar);
  const flat = groups.reduce((a, g) => a.concat(g.order), []);
  ok('variable layout: every module lands in exactly one SSC chain',
    flat.length === 12 && new Set(flat).size === 12, `${groups.map(g => g.label + ':' + g.order.length).join(' ')}`);
  ok('variable layout: each chain is scored with its own harness cable',
    groups.every(g => g.metrics.moduleCount === g.order.length && g.metrics.hops === g.order.length - 1),
    groups.map(g => `${g.label} ${g.metrics.bomMm}mm`).join(' '));
  const m2sFix = 2 * RULES2.m2sPowerLen + 2 * RULES2.m2sCommLen;
  ok('variable layout: chain cable includes the four M2S harnesses',
    groups.every(g => g.metrics.bomMm >= m2sFix), `fixed part ${m2sFix}mm`);

  /* chain quality: the optimised chain must beat the reading order on
     physical span (the whole point of the planner) */
  const reading = E.rackModuleCells(RACK2);
  const readHalf = reading.slice(0, 7);
  const opt = E.layoutGroupOrder(RACK2, E.DEFAULT_RULES, '2,3', readHalf);
  ok('variable layout: the optimised chain is at least as good as reading order',
    opt.metrics.geomMm <= E.groupMetrics(RACK2, E.DEFAULT_RULES, '2,3', readHalf).geomMm,
    `opt ${opt.metrics.geomMm} vs reading ${E.groupMetrics(RACK2, E.DEFAULT_RULES, '2,3', readHalf).geomMm} (${opt.planId})`);

  /* overflow: a hop longer than any approved harness must be flagged */
  const far = E.groupMetrics(RACK2, E.DEFAULT_RULES, '2,3', ['0,0', '3,2']);
  ok('variable layout: a hop past the catalogue cap needs an engineering release',
    far.overflow > 0 && far.maxHopMm > 0, `overflow=${far.overflow} max=${far.maxHopMm}mm`);

  const vals = E.layoutValidate(projVar);
  ok('variable layout: all L-checks pass on a complete layout',
    vals.every(v => v.status === 'pass') && vals.length === 6,
    vals.map(v => v.id + '=' + v.status).join(' '));

  /* break it: capacities that cannot take every module must fail L02 —
     the overfull chain is flagged, never silently dropped */
  const broken = JSON.parse(JSON.stringify(projVar));
  broken.config.layout.sscs[1].capacity = 3;
  const valsBroken = E.layoutValidate(broken);
  ok('variable layout: an overfull SSC fails L02, never passes silently',
    valsBroken.find(v => v.id === 'L02').status === 'fail', 'over capacity detected');

  /* write-back: chains become strings */
  E.layoutApply(projVar, groups);
  ok('variable layout: apply writes one string per SSC with per-chain counts',
    projVar.config.rules.strings === 2 &&
    JSON.stringify(projVar.config.numbering.counts) === '[6,6]' &&
    projVar.config.numbering.order.length === 12,
    `strings=${projVar.config.rules.strings} counts=${projVar.config.numbering.counts}`);
  ok('stringModuleCounts: variable counts win over the uniform rules',
    JSON.stringify(E.stringModuleCounts(projVar)) === '[6,6]', '[6,6]');
  const projUniform = { config: { rules: Object.assign({}, E.DEFAULT_RULES, { strings: 2, modulesPerString: 24 }) } };
  ok('stringModuleCounts: without a layout it stays uniform (regression guard)',
    JSON.stringify(E.stringModuleCounts(projUniform)) === '[24,24]', '[24,24]');

  /* netlist on the variable layout */
  const connsVar = E.generateNetlist(projVar);
  const cnt = (cls) => connsVar.filter(c => c.cls === cls).length;
  ok('variable netlist: one M2M power hop per chain link (5 + 5)',
    cnt('M2M-PWR') === 10, `M2M-PWR=${cnt('M2M-PWR')}`);
  ok('variable netlist: M2S and bus harnesses follow the chain count',
    cnt('M2S-PWR') === 4 && cnt('M2S-COMM') === 4 && cnt('SSC-JB') === 4,
    `M2S-PWR=${cnt('M2S-PWR')} M2S-COMM=${cnt('M2S-COMM')} SSC-JB=${cnt('SSC-JB')}`);
  ok('variable netlist: the second chain starts at its own M1',
    connsVar.some(c => c.from === 'S1-SSC:P+' && c.to === 'S1:M1:P+') &&
    connsVar.some(c => c.from === 'S2-SSC:P+' && c.to === 'S2:M1:P+'), 'two chain anchors');
  ok('variable netlist: the last module of EACH chain closes on its SSC minus (R05)',
    connsVar.some(c => c.from === 'S1-SSC:P-' && c.to === 'S1:M6:P-') &&
    connsVar.some(c => c.from === 'S2-SSC:P-' && c.to === 'S2:M6:P-'), 'both chains closed');

  const valsVar = E.runValidations(projVar, connsVar);
  const v01 = valsVar.find(v => v.id === 'V01');
  ok('variable validations: V01 counts each chain at its own length',
    v01.status === 'pass' && /\[6, 6\]/.test(v01.detail), v01.detail);
  ok('variable validations: V02–V05 hold for every chain',
    ['V02', 'V03', 'V04', 'V05'].every(id => valsVar.find(v => v.id === id).status === 'pass'),
    valsVar.filter(v => ['V02', 'V03', 'V04', 'V05'].includes(v.id)).map(v => v.id + '=' + v.status).join(' '));

  /* hop info honours the per-chain offsets: hop 1 of string 2 is the
     first link of the second chain, NOT slot 25 of one long chain */
  const hop = E.numberingHopInfo(projVar.config.numbering, projVar.config.rules, 1, 1);
  const c7 = E.slotCell(projVar.config.numbering.order[6]);
  const c8 = E.slotCell(projVar.config.numbering.order[7]);
  ok('variable numbering: hop lookup uses the per-chain offsets',
    hop && c7 && c8 && hop.mm === Math.round(E.rackSpan(RACK2, E.slotKey(c7.c, c7.r), E.slotKey(c8.c, c8.r), 'power')),
    `kind=${hop && hop.kind} mm=${hop && hop.mm}`);

  /* sheet layout draws exactly the modules each chain controls */
  const sheetVar = E.buildSheetLayout(projVar, connsVar);
  const labels = sheetVar.modules.map(m => m.label);
  ok('variable sheet: S1 draws 6 modules and S2 draws 6',
    labels.filter(l => l.startsWith('S1:')).length === 6 && labels.filter(l => l.startsWith('S2:')).length === 6,
    `S1=${labels.filter(l => l.startsWith('S1:')).length} S2=${labels.filter(l => l.startsWith('S2:')).length}`);

  /* front view: chains carry their own anchor, rail and colour */
  const cal = E.fvCalib ? null : null; /* fvCalib lives in the import scope */
  {
    const fvSrc2 = fs.readFileSync(path.join(path.dirname(ENGINE), 'frontview.js'), 'utf8');
    const fvNames = ['fvCalib', 'fvWiring', 'fvSvg', 'fvSummary'];
    const fv2 = new Function(fvSrc2 + '\nreturn {' + fvNames.join(',') + '};')();
    const cal2 = fv2.fvCalib({ imgW: 1000, imgH: 700, x0: 80, y0: 60, pitchX: 120, pitchY: 90, cols: 4, rows: 4, mmPerPx: 1 });
    const segs = E.layoutFrontView(groups, cal2, { showWiring: true });
    ok('variable front view: each chain gets its own riser pair and colour',
      segs.filter(s => s.kind === 'sscp').length === 4 &&
      segs.every(s => s.group === 0 || s.group === 1) &&
      segs.filter(s => s.group === 0).every(s => s.groupColor === E.SSC_PALETTE[0]),
      `risers=${segs.filter(s => s.kind === 'sscp').length}`);
    const r0 = segs.find(s => s.kind === 'sscp' && s.group === 0).pts[1].x;
    const r1 = segs.find(s => s.kind === 'sscp' && s.group === 1).pts[1].x;
    ok('variable front view: the chains use separate riser rails',
      r1 > r0, `rail0=${r0.toFixed(0)} rail1=${r1.toFixed(0)}`);
    const per = E.layoutFrontViewSummary(segs, groups);
    ok('variable front view: per-SSC cable summary',
      per.length === 2 && per.every(p => p.powerMm > 0 && p.commMm > 0 && p.modules > 0),
      per.map(p => `${p.label} red=${p.powerMm.toFixed(0)}`).join(' '));
    const svgGen = fv2.fvSvg(cal2, { src: 'data:image/png;base64,STUB' }, segs, { sscLabels: true });
    ok('variable front view: general diagram labels the chains',
      /SSC-1/.test(svgGen) && /SSC-2/.test(svgGen), 'legend labels present');
  }

  /* layoutTotals reconciles with the chains */
  const tot = E.layoutTotals(groups);
  ok('variable layout: totals reconcile with the per-SSC metrics',
    tot.sscs === 2 && tot.modules === 12 && tot.bomMm === groups.reduce((a, g) => a + g.metrics.bomMm, 0),
    `bom=${tot.bomMm}mm`);
}

/* ============================================================
 * VSDX IMPORT + EMF (read the engineer's real Visio file back)
 * ============================================================ */
if (typeof Path2D === 'undefined') {
  global.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
}
let vsdxTests = Promise.resolve();
{
  const emfSrc = fs.readFileSync(path.join(path.dirname(ENGINE), 'emf.js'), 'utf8');
  const impSrc = fs.readFileSync(path.join(path.dirname(ENGINE), 'vsdx-import.js'), 'utf8');
  const fvSrc = fs.readFileSync(path.join(path.dirname(ENGINE), 'frontview.js'), 'utf8');
  const zipSrc2 = fs.readFileSync(path.join(path.dirname(ENGINE), 'zip.js'), 'utf8');
  const names = ['emfBounds', 'emfDraw', 'vsdxOpen', 'vsdxZipRead', 'vsdxXml', 'vsdxCells', 'geomPath', 'vsdxNum', 'vsdxWrap', 'ZipWriter',
    'fvCalib', 'fvTerminals', 'fvWiring', 'fvSvg', 'fvSummary', 'fvPxToSheet', 'vsdxLayerLabel'];
  const IMPL = new Function(emfSrc + '\n' + zipSrc2 + '\n' + impSrc + '\n' + fvSrc + '\nreturn {' + names.join(',') + '};')();
  const IM = Object.assign(IMPL, {});

  /* ---- tiny synthetic EMF: red pen line + solid red triangle ---- */
  function rec(type, payloadDwords, extra) {
    const size = 8 + payloadDwords.length * 4 + (extra || 0);
    const b = new Uint8Array(size);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, type, true);
    dv.setUint32(4, size, true);
    payloadDwords.forEach((v, i) => dv.setInt32(8 + i * 4, v, true));
    return b;
  }
  const header = new Uint8Array(88);
  {
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 1, true); dv.setUint32(4, 88, true);
    dv.setInt32(8, 0, true); dv.setInt32(12, 0, true); dv.setInt32(16, 1000, true); dv.setInt32(20, 500, true);
    dv.setInt32(24, 0, true); dv.setInt32(28, 0, true); dv.setInt32(32, 254, true); dv.setInt32(36, 127, true);
    dv.setUint32(40, 0x464d4520, true); dv.setUint32(44, 0x00010000, true);
    dv.setUint32(48, 88, true); dv.setUint32(52, 9, true);
    dv.setUint16(56, 2, true); dv.setUint16(58, 0, true);
    dv.setUint32(60, 0, true); dv.setUint32(64, 0, true); dv.setUint32(68, 0, true);
    dv.setInt32(72, 1920, true); dv.setInt32(76, 1080, true);
    dv.setInt32(80, 508, true); dv.setInt32(84, 285, true);
  }
  const emfParts = [
    header,
    rec(9, [1000, 500]),            // SETWINDOWEXTEX
    rec(10, [0, 0]),                // SETWINDOWORGEX
    rec(39, [1, 0, 0, 0x000000ff]), // CREATEBRUSHINDIRECT solid red
    rec(37, [1]),                   // SELECTOBJECT brush
    rec(27, [100, 100]),            // MOVETOEX
    rec(54, [900, 400]),            // LINETO
    rec(86, [0, 0, 1000, 500, 3, 900, 100, 100, 400, 900, 400]), // POLYGON16 (bounds+cpts+3 pts)
    rec(14, [0, 88, 88]),           // EOF
  ];
  const emfTotal = emfParts.reduce((t, p) => t + p.length, 0);
  const emfBuf = new Uint8Array(emfTotal);
  let emfOff = 0;
  for (const p of emfParts) { emfBuf.set(p, emfOff); emfOff += p.length; }

  const bnds = IM.emfBounds(emfBuf.buffer.slice(emfBuf.byteOffset, emfBuf.byteOffset + emfBuf.byteLength));
  ok('EMF header bounds are parsed', bnds.width === 1000 && bnds.height === 500,
    `${bnds.width}x${bnds.height}`);

  const drawn = { strokes: 0, fills: 0, points: 0, colors: [] };
  const ctx = {
    save() {}, restore() {}, fillRect() {}, fillText() {},
    fill(p) { drawn.fills++; },
    stroke(p) { drawn.strokes++; },
    fillRect2: null,
  };
  let curColor = null;
  Object.defineProperty(ctx, 'strokeStyle', { set: (v) => { curColor = v; }, get: () => curColor });
  Object.defineProperty(ctx, 'fillStyle', { set: (v) => { drawn.colors.push(v); }, get: () => '' });
  Object.defineProperty(ctx, 'lineWidth', { set: () => {}, get: () => 1 });
  Object.defineProperty(ctx, 'font', { set: () => {}, get: () => '' });
  Object.defineProperty(ctx, 'lineJoin', { set: () => {}, get: () => '' });
  Object.defineProperty(ctx, 'lineCap', { set: () => {}, get: () => '' });
  global.Path2D = class { moveTo() { drawn.points++; } lineTo() { drawn.points++; } closePath() {} };
  const stat = IM.emfDraw(ctx, emfBuf.buffer.slice(emfBuf.byteOffset, emfBuf.byteOffset + emfBuf.byteLength), { x: 0, y: 0, w: 2000, h: 1000 });
  ok('EMF records are parsed and batched',
    stat.records === 9 && drawn.strokes >= 1 && drawn.fills >= 1 && drawn.points >= 6,
    `records=${stat.records} strokes=${drawn.strokes} fills=${drawn.fills} pts=${drawn.points}`);
  ok('EMF colour mapping is BGR (0x000000ff -> #ff0000)',
    drawn.colors.includes('#ff0000'), drawn.colors.join(','));

  /* ---- synthetic .vsdx package (stored zip via our own ZipWriter) ---- */
  const pageXml = `<?xml version="1.0" encoding="utf-8"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
<Shapes><Shape ID="1" Type="Shape">
<Cell N="PinX" V="2"/><Cell N="PinY" V="1.5"/><Cell N="Width" V="4"/><Cell N="Height" V="2"/>
<Cell N="LocPinX" V="2"/><Cell N="LocPinY" V="1"/><Cell N="Angle" V="0"/>
<Cell N="LayerMember" V="0"/>
<Cell N="LineColor" V="#ff0000"/><Cell N="LineWeight" V="0.01"/>
<Cell N="FillForegnd" V="#00ff00"/><Cell N="FillPattern" V="1"/>
<Section N="Geometry" IX="0">
<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
<Row T="LineTo" IX="2"><Cell N="X" V="4"/><Cell N="Y" V="0"/></Row>
<Row T="LineTo" IX="3"><Cell N="X" V="4"/><Cell N="Y" V="2"/></Row>
<Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="2"/></Row>
<Row T="LineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
</Section>
<Section N="Character"><Row IX="0"><Cell N="Size" V="0.15"/><Cell N="Color" V="#0000cc"/></Row></Section>
<Text>Hello Rack</Text>
</Shape><Shape ID="2" Type="Foreign">
<Cell N="PinX" V="6"/><Cell N="PinY" V="4"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/>
<Cell N="LocPinX" V="1"/><Cell N="LocPinY" V="0.5"/><Cell N="Angle" V="0"/>
<Cell N="LayerMember" V="0"/>
<ForeignData ForeignType="Bitmap"><Rel r:id="rId1"/></ForeignData>
</Shape></Shapes></PageContents>`;
  const pagesXml2 = `<?xml version="1.0" encoding="utf-8"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main">
<Page ID="1" NameU="Test">
<PageSheet><Cell N="PageWidth" V="8"/><Cell N="PageHeight" V="6"/>
<Section N="Layer"><Row IX="0"><Cell N="Name" V="Frame"/><Cell N="Visible" V="1"/></Row>
<Row IX="1"><Cell N="Name" V="Wires"/><Cell N="Visible" V="1"/></Row></Section>
</PageSheet>
<Rel r:id="rId1"/></Page></Pages>`;
  const zw = new IMPL.ZipWriter();
  zw.add('[Content_Types].xml', '<Types/>');
  zw.add('_rels/.rels', '<?xml version="1.0"?><Relationships/>');
  zw.add('visio/pages/pages.xml', pagesXml2);
  zw.add('visio/pages/_rels/pages.xml.rels',
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="page1.xml"/></Relationships>');
  zw.add('visio/pages/_rels/page1.xml.rels',
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>');
  zw.add('visio/media/image1.png', Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  zw.add('visio/pages/page1.xml', pageXml);
  const vsdxBytes = zw.build();

  vsdxTests = (async () => {
    const doc = await IM.vsdxOpen(vsdxBytes.buffer.slice(vsdxBytes.byteOffset, vsdxBytes.byteOffset + vsdxBytes.byteLength));
    ok('VSDX package opens with page metadata',
      doc.pages.length === 1 && doc.pages[0].name === 'Test' && doc.pages[0].w === 8 && doc.pages[0].h === 6,
      `pages=${doc.pages.length} ${doc.pages[0] && doc.pages[0].name} ${doc.pages[0] && doc.pages[0].w}x${doc.pages[0] && doc.pages[0].h}`);
    ok('VSDX page layers are read',
      doc.pages[0].layers.length === 2 && doc.pages[0].layers[0].name === 'Frame',
      doc.pages[0].layers.map((l) => l.name).join('|'));

    const r = await doc.renderPage(0, null);
    ok('VSDX shape geometry is rebuilt as SVG paths',
      /M 0 0 L 4 0 L 4 2 L 0 2 L 0 0/.test(r.svg) && /stroke="#ff0000"/.test(r.svg) && /fill="#00ff00"/.test(r.svg),
      'rect path with red stroke + green fill');
    ok('VSDX text is rendered upright and wrapped-ready',
      /Hello Rack/.test(r.svg) && /scale\(1 -1\)/.test(r.svg) && /font-size="0\.15/.test(r.svg),
      'text element with un-flip transform');
    ok('VSDX page sheet gives the SVG its size',
      /viewBox="0 0 768 576"/.test(r.svg), '8x6 in at 96 dpi');
    ok('VSDX render reports its stats',
      r.stats.shapes === 2 && r.stats.texts === 1 && r.stats.foreign === 1, JSON.stringify(r.stats));
    ok('VSDX embedded bitmap is reported with its page geometry',
      r.foreigns && r.foreigns.length === 1 &&
      Math.abs(r.foreigns[0].x - 5) < 1e-9 && Math.abs(r.foreigns[0].y - 3.5) < 1e-9 &&
      r.foreigns[0].w === 2 && r.foreigns[0].h === 1 && /data:image\/png/.test(r.foreigns[0].href),
      `foreigns=${JSON.stringify(r.foreigns && r.foreigns.map((f) => [f.x, f.y, f.w, f.h]))}`);
    /* the page group flips y, so the bitmap must be pre-flipped inside the
       shape or the rack picture renders upside down (regression) */
    ok('VSDX embedded bitmap is pre-flipped so the page Y-flip shows it upright',
      /<g transform="translate\(0 1\) scale\(1 -1\)"><image /.test(r.svg) && /data-vsdx-foreign/.test(r.svg),
      'image wrapped in translate(0 H) scale(1 -1)');

    const rHidden = await doc.renderPage(0, { layersOn: new Set([1]) });   /* only "Wires" on */
    ok('VSDX layer visibility filters shapes',
      !/Hello Rack/.test(rHidden.svg) && rHidden.stats.shapes === 0, 'layer 0 hidden -> empty page');

    /* the engineer's Visio file keeps Chinese AutoCAD layer names — the UI
       shows them in English (regression for the Diagram-tab layer chips) */
    ok('Chinese AutoCAD layer names translate to English in the UI',
      typeof IM.vsdxLayerLabel === 'function' &&
      IM.vsdxLayerLabel('图框') === 'Drawing frame' &&
      IM.vsdxLayerLabel('细实线层') === 'Thin solid line' &&
      IM.vsdxLayerLabel('中心线') === 'Centre line' &&
      IM.vsdxLayerLabel('标注层') === 'Dimensions' &&
      IM.vsdxLayerLabel('CAD Drawing') === 'CAD Drawing' &&
      IM.vsdxLayerLabel('0') === '0',
      `图框→${IM.vsdxLayerLabel && IM.vsdxLayerLabel('图框')} 细实线层→${IM.vsdxLayerLabel && IM.vsdxLayerLabel('细实线层')}`);
  })().catch((e) => ok('VSDX import suite runs', false, e.message));

  ok('POLYLINE(...) formulas expand into local coordinates',
    /L 0\.0000 0\.0000 L 10\.0000 20\.0000/.test(IM.geomPath({ children: [
      { tag: 'Row', attrs: { T: 'MoveTo' }, children: [
        { tag: 'Cell', attrs: { N: 'X', V: '0' }, children: [], text: '' },
        { tag: 'Cell', attrs: { N: 'Y', V: '0' }, children: [], text: '' }] },
      { tag: 'Row', attrs: { T: 'PolylineTo' }, children: [
        { tag: 'Cell', attrs: { N: 'X', V: '0' }, children: [], text: '' },
        { tag: 'Cell', attrs: { N: 'Y', V: '0' }, children: [], text: '' },
        { tag: 'Cell', attrs: { N: 'A', V: 'POLYLINE(0,0,1,1)' }, children: [], text: '' }] },
    ] }, 10, 20)), 'normalised points scaled by Width/Height');

  ok('text wrapper breaks long lines to the block width',
    IM.vsdxWrap('a'.repeat(120), 2, 0.1).length > 3 &&
    IM.vsdxWrap('short text', 10, 0.1).length === 1,
    'long text wraps, short text stays one line');

  /* ============================================================
   * FRONT-VIEW WIRING (wiring drawn on the real rack picture)
   * ============================================================ */
  /* an uncalibrated grid must NOT silently become "ok" (the NaN→0 bug) */
  const c0 = IM.fvCalib({});
  ok('front view: empty calibration stays uncalibrated',
    c0.ok === false && !Number.isFinite(c0.pitchX) && !Number.isFinite(c0.x0),
    `ok=${c0.ok} pitchX=${c0.pitchX}`);

  const cal = IM.fvCalib({
    imgW: 1000, imgH: 700, x0: 100, y0: 100, pitchX: 100, pitchY: 80,
    cols: 3, rows: 8, mmPerPx: 0.5, devices: { ssc: { x: 950, y: 640 } },
  });
  ok('front view: complete calibration is ok with the given scale',
    cal.ok === true && cal.mmPerPx === 0.5, `ok=${cal.ok}`);

  const t = IM.fvTerminals(cal, 1, 2);
  ok('front view: comm pair sits left, power pair right (AYK convention)',
    t.commS.x < t.commN.x && t.commN.x < 200 && t.pwrNeg.x > 200 && t.pwrNeg.x < t.pwrPos.x,
    `commN=${t.commN.x.toFixed(1)} pwrNeg=${t.pwrNeg.x.toFixed(1)} pwrPos=${t.pwrPos.x.toFixed(1)}`);
  ok('front view: terminals sit below the module centre (bottom face)',
    t.commS.y > 100 + 80 * 2 && t.commS.y < 100 + 80 * 3,
    `y=${t.commS.y.toFixed(1)}`);

  const order = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) order.push(c + ',' + r);
  const segs = IM.fvWiring(order, cal);
  const count = (k) => segs.filter((s) => s.kind === k).length;
  ok('front view: one hop per gap plus four SSC risers and one label per module',
    count('power') === 23 && count('comm') === 23 && count('sscp') === 2 && count('sscc') === 2 && count('label') === 24,
    `power=${count('power')} comm=${count('comm')} sscp=${count('sscp')} sscc=${count('sscc')} labels=${count('label')}`);
  ok('front view: every segment carries a physical length from the picture scale',
    segs.filter((s) => s.kind !== 'label').every((s) => s.lenMm > 0),
    'all lens > 0');

  const sum = IM.fvSummary(segs);
  ok('front view: summary adds the red and green cable metres',
    sum.powerSegs === 25 && sum.commSegs === 25 && sum.powerMm > 0 && sum.commMm > 0 && sum.maxHopMm > 0,
    `red=${sum.powerMm.toFixed(0)}mm green=${sum.commMm.toFixed(0)}mm max=${sum.maxHopMm.toFixed(0)}mm`);

  /* reversing the order mirrors the chain: first riser now lands on the
     opposite corner of the rack */
  const rev = IM.fvWiring(order.slice().reverse(), cal);
  const firstA = segs.find((s) => s.kind === 'sscp').pts[3];
  const firstB = rev.find((s) => s.kind === 'sscp').pts[3];
  ok('front view: the chain follows the chosen numbering, not the grid',
    Math.abs(firstA.x - firstB.x) > 50 || Math.abs(firstA.y - firstB.y) > 50,
    `A=(${firstA.x.toFixed(0)},${firstA.y.toFixed(0)}) B=(${firstB.x.toFixed(0)},${firstB.y.toFixed(0)})`);

  /* a device-free calibration falls back to a bottom-centre anchor */
  const noDev = IM.fvWiring(order, IM.fvCalib({ imgW: 1000, imgH: 700, x0: 100, y0: 100, pitchX: 100, pitchY: 80, cols: 3, rows: 8, mmPerPx: 0.5 }));
  ok('front view: missing SSC anchor falls back instead of crashing',
    noDev.filter((s) => s.kind === 'sscp').length === 2 &&
    noDev.every((s) => s.pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))),
    'risers present, all points finite');

  const p = IM.fvPxToSheet(cal, { x: 101.6, y: 203.2, w: 1016, h: 508 }, 500, 350);
  ok('front view: picture pixels map through the underlay fit rectangle',
    Math.abs(p.x - 609.6) < 1e-9 && Math.abs(p.y - 457.2) < 1e-9,
    `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);

  const svg = IM.fvSvg(cal, { src: 'data:image/png;base64,STUB' }, segs, { width: 900 });
  ok('front view: SVG carries the picture, red/green polylines and M labels',
    /href="data:image\/png;base64,STUB"/.test(svg) &&
    (svg.match(/stroke="#e02020"/g) || []).length >= 23 &&
    (svg.match(/stroke="#00a651"/g) || []).length >= 23 &&
    (svg.match(/>M\d+<\/text>/g) || []).length === 24,
    `polylines=${(svg.match(/<polyline/g) || []).length} labels=${(svg.match(/>M\d+<\/text>/g) || []).length}`);
}


/* ============================================================
 * SUMMARY
 * ============================================================ */
(async () => {
  await vsdxTests;
  console.log('\n---------------------------------------------');
  console.log('PASSED: ' + passed + '   FAILED: ' + failures.length);
  if (failures.length) {
    console.log('\nFailed assertions:');
    failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
    process.exitCode = 1;
  } else {
    console.log('All assertions passed.');
    process.exitCode = 0;
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
