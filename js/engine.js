/* ============================================================
 * WireFlow deterministic wiring engine
 * Encodes the engineering rules from the Wiring Diagram Tool
 * Engineering Rules & Input Specification (R01–R12, V01–V12,
 * connection templates, cable classes, cross-rack length model).
 * ============================================================ */

const CABLE_CLASSES = [
  { key: 'M2M-PWR',  label: 'M2M power',             network: 'power' },
  { key: 'M2M-COMM', label: 'M2M communication',     network: 'comm' },
  { key: 'M2S-PWR',  label: 'M2S power',             network: 'power' },
  { key: 'M2S-COMM', label: 'M2S communication',     network: 'comm' },
  { key: 'SSC-JB',   label: 'SSC-to-JB power',       network: 'power' },
];

const DEFAULT_RULES = {
  modulesPerString: 24,
  strings: 2,
  powerJumper: 100,        // R07: standard short power jumper 100 mm AB
  commJumper: 450,         // R08: standard short communication jumper 450 mm
  longPower: 445,          // R09: longer local power jumper (575 - 130)
  longComm: 650,           // R10: longer local communication jumper
  powerDeduction: 130,     // R12: power measurement deduction, mm (0 disables)
  applyDeductionToComm: false,
  crossRackAllowance: 500, // installation allowance on cross-rack totals
  m2sPowerLen: 800,        // approved M2S power harness length
  m2sCommLen: 800,         // approved M2S communication harness length
  busPowerLen: 1200,       // approved SSC-to-JB bus power length
  powerGauge: '63A/125V, 150 mm²',  // cable spec printed on the schedule / JSON
  commGauge: 'Cat5, 25 AWG',        // cable spec for communication harnesses
  overTopSpans: [],        // [{fromRack, toRack, network, spanMm}]
  roundingStep: 0,         // 0 = exact mm; else round manufactured length up
};

const DEFAULT_EXCEPTIONS = []; // {type:'gap'|'column'|'crossrack'|'remote-ssc', string, between:[a,b] | fromRack,toRack, approvalRef}

function emptyProject() {
  return {
    name: '', vessel: '', drawing_no: '', revision: 'A',
    product_family: 'Pisces+', modules_per_string: 24,
    config: { rules: { ...DEFAULT_RULES }, exceptions: [], spans: [] },
  };
}

/* ---------- harness catalogue (derived from approved rules) ---------- */
function harnessCatalogue(rules) {
  const r = rules || DEFAULT_RULES;
  return [
    { pn: `PW-JMP-${fmtLen(r.powerJumper)}`,  cls: 'M2M-PWR',  network: 'power', length: r.powerJumper, gauge: r.powerGauge, desc: `Standard short power jumper ${r.powerJumper} mm AB` },
    { pn: `PW-LOC-${fmtLen(r.longPower)}`,    cls: 'M2M-PWR',  network: 'power', length: r.longPower,   gauge: r.powerGauge, desc: `Longer local power jumper ${r.longPower} mm` },
    { pn: `CM-JMP-${fmtLen(r.commJumper)}`,   cls: 'M2M-COMM', network: 'comm',  length: r.commJumper,  gauge: r.commGauge,  desc: `Standard short communication jumper ${r.commJumper} mm` },
    { pn: `CM-LOC-${fmtLen(r.longComm)}`,     cls: 'M2M-COMM', network: 'comm',  length: r.longComm,    gauge: r.commGauge,  desc: `Longer local communication jumper ${r.longComm} mm` },
    { pn: `PW-M2S-${fmtLen(r.m2sPowerLen)}`,  cls: 'M2S-PWR',  network: 'power', length: r.m2sPowerLen, gauge: r.powerGauge, desc: 'Module-to-SSC power harness' },
    { pn: `CM-M2S-${fmtLen(r.m2sCommLen)}`,   cls: 'M2S-COMM', network: 'comm',  length: r.m2sCommLen,  gauge: r.commGauge,  desc: 'Module-to-SSC communication harness' },
    { pn: `PW-BUS-${fmtLen(r.busPowerLen)}`,  cls: 'SSC-JB',   network: 'power', length: r.busPowerLen, gauge: r.powerGauge, desc: 'SSC Bus to junction box power cable' },
  ];
}
function fmtLen(n) { return String(Math.round(n)).padStart(3, '0'); }

function pickHarness(catalogue, network, routedLen, rules) {
  const cands = catalogue.filter(h => h.network === network && h.length >= routedLen);
  if (!cands.length) return null;
  return cands.sort((a, b) => a.length - b.length)[0];
}

/* ---------- exception helpers ---------- */
function isGapBetween(exceptions, stringIdx, a, b) {
  return exceptions.some(x =>
    (x.type === 'gap' || x.type === 'column') &&
    (x.string === 0 || x.string === stringIdx) &&
    ((x.between[0] === a && x.between[1] === b) || (x.between[0] === b && x.between[1] === a)));
}

/* ---------- netlist generation (deterministic) ---------- */
function generateNetlist(project) {
  const cfg = project.config || {};
  const rules = { ...DEFAULT_RULES, ...(cfg.rules || {}) };
  const exceptions = cfg.exceptions || [];
  const spans = cfg.spans || [];
  const N = rules.modulesPerString;
  const S = rules.strings;
  const cat = harnessCatalogue(rules);
  const conns = [];
  let seq = 1;
  const push = c => conns.push({ seq: seq++, ...c });

  for (let s = 0; s < S; s++) {
    const sid = `S${s + 1}`;
    // R04: SSC String plus -> M1 plus (M2S power)
    push({ network: 'power', cls: 'M2S-PWR', from: `${sid}-SSC:P+`, to: `${sid}:M1:P+`, routedLen: rules.m2sPowerLen });
    // R05: SSC String minus -> M24 minus (M2S power)
    push({ network: 'power', cls: 'M2S-PWR', from: `${sid}-SSC:P-`, to: `${sid}:M${N}:P-`, routedLen: rules.m2sPowerLen });
    // R06: SSC S -> M1 N ; SSC N -> M24 S (M2S communication)
    push({ network: 'comm', cls: 'M2S-COMM', from: `${sid}-SSC:S`, to: `${sid}:M1:N`, routedLen: rules.m2sCommLen });
    push({ network: 'comm', cls: 'M2S-COMM', from: `${sid}-SSC:N`, to: `${sid}:M${N}:S`, routedLen: rules.m2sCommLen });
    // R11: SSC Bus +/- -> junction box (one positive and one negative per SSC)
    push({ network: 'power', cls: 'SSC-JB', from: `${sid}-SSC:BUS+`, to: `${sid}-JB:BUS+`, routedLen: rules.busPowerLen });
    push({ network: 'power', cls: 'SSC-JB', from: `${sid}-SSC:BUS-`, to: `${sid}-JB:BUS-`, routedLen: rules.busPowerLen });
    // R02: Mx negative -> Mx+1 positive
    for (let m = 1; m < N; m++) {
      const gap = isGapBetween(exceptions, s, m, m + 1);
      push({
        network: 'power', cls: 'M2M-PWR',
        from: `${sid}:M${m}:P-`, to: `${sid}:M${m + 1}:P+`,
        routedLen: gap ? rules.longPower : rules.powerJumper,
        exception: gap ? 'in-rack gap / column transition' : null,
      });
    }
    // R03: Mx S -> Mx+1 N
    for (let m = 1; m < N; m++) {
      const gap = isGapBetween(exceptions, s, m, m + 1);
      push({
        network: 'comm', cls: 'M2M-COMM',
        from: `${sid}:M${m}:S`, to: `${sid}:M${m + 1}:N`,
        routedLen: gap ? rules.longComm : rules.commJumper,
        exception: gap ? 'in-rack gap / column transition' : null,
      });
    }
  }

  // Resolve harness selection + manufactured length
  for (const c of conns) {
    c.routedLen = applyDeduction(c.routedLen, c.network, rules);
    const h = pickHarness(cat, c.network, c.routedLen, rules);
    if (h) {
      c.harness = h.pn; c.length = h.length; c.desc = h.desc; c.gauge = h.gauge;
    } else {
      c.harness = null; c.length = c.routedLen;
      c.desc = 'No approved harness fits — engineering release required';
      c.gauge = c.network === 'power' ? rules.powerGauge : rules.commGauge;
    }
  }

  // Cross-rack transitions declared as exceptions with segmented model
  for (const x of exceptions.filter(e => e.type === 'crossrack')) {
    const spanRow = spans.find(sp => +sp.fromRack === +x.fromRack && +sp.toRack === +x.toRack && (sp.network === x.network || !sp.network));
    const topSpan = spanRow ? +spanRow.spanMm : 0;
    const total = (+x.sourceLen || 0) + topSpan + (+x.destLen || 0) + rules.crossRackAllowance;
    const routed = applyDeduction(total, x.network, rules);
    const h = pickHarness(cat, x.network, routed, rules);
    conns.push({
      seq: seq++, network: x.network, cls: x.network === 'power' ? 'M2M-PWR' : 'M2M-COMM',
      from: x.from, to: x.to,
      segments: { sourceLen: +x.sourceLen || 0, topSpan, destLen: +x.destLen || 0, allowance: rules.crossRackAllowance },
      routedLen: routed, harness: h ? h.pn : null, length: h ? h.length : routed,
      desc: h ? h.desc : 'No approved harness fits — engineering release required',
      exception: `Cross-rack R${x.fromRack}→R${x.toRack}`,
      approvalRef: x.approvalRef || null,
    });
  }
  return conns;
}

function applyDeduction(lenMm, network, rules) {
  const isPower = network === 'power';
  const deduct = isPower || rules.applyDeductionToComm ? rules.powerDeduction : 0;
  let v = lenMm - deduct;
  if (rules.roundingStep > 0) v = Math.ceil(v / rules.roundingStep) * rules.roundingStep;
  return Math.max(v, 0);
}

/* ---------- validations V01–V12 ---------- */

/* Catalogue of the release-gate checks. Ids and labels live here exactly once so
 * the normal path and the "no module configuration" early return always produce
 * the same rows in the same order (the UI table must stay stable). */
const VALIDATION_SPEC = [
  { id: 'V01', label: 'Each string contains the configured number of unique modules' },
  { id: 'V02', label: 'Every module has the expected power degree (no open / short circuit)' },
  { id: 'V03', label: 'String polarity follows the approved sequence and endpoint rule' },
  { id: 'V04', label: 'Every communication node has the expected predecessor and successor' },
  { id: 'V05', label: 'Required communication termination is present only at approved endpoints' },
  { id: 'V06', label: 'Every connection resolves to two valid, compatible terminals' },
  { id: 'V07', label: 'Selected harness connectors and orientations match both endpoints' },
  { id: 'V08', label: 'Selected harness length is not shorter than the approved routed requirement' },
  { id: 'V09', label: 'Power and communication routes comply with channel and separation rules' },
  { id: 'V10', label: 'Every drawn cable appears once in the cable schedule and BOM' },
  { id: 'V11', label: 'Cable quantities reconcile with the generated netlists' },
  { id: 'V12', label: 'All exceptions carry an engineering approval reference' },
];

/** @param {string} id Validation id. @return {string} Approved label. */
function validationLabel(id) {
  for (let i = 0; i < VALIDATION_SPEC.length; i++) {
    if (VALIDATION_SPEC[i].id === id) return VALIDATION_SPEC[i].label;
  }
  return id;
}

const NO_CONFIG_DETAIL = 'No module configuration — set strings (≥1) and modules per string (≥2)';

function runValidations(project, conns) {
  const cfg = project.config || {};
  const rules = { ...DEFAULT_RULES, ...(cfg.rules || {}) };
  const exceptions = cfg.exceptions || [];
  const N = rules.modulesPerString, S = rules.strings;
  const out = [];
  const add = (id, ok, detail) => out.push({ id, label: validationLabel(id), status: ok ? 'pass' : 'fail', detail });

  /* Hard gate: an unconfigured project produces an empty netlist, and an empty
     netlist used to satisfy every check trivially. Bail out before V01 so the
     release gate can never be passed by a project with no modules. */
  if (!(Number(S) >= 1) || !(Number(N) >= 1)) {
    return VALIDATION_SPEC.map(v => ({ id: v.id, label: v.label, status: 'fail', detail: NO_CONFIG_DETAIL }));
  }

  // V01 each string has configured unique modules
  const modRefs = new Set();
  conns.forEach(c => {
    modRefs.add(c.from.split(':').slice(0, 2).join(':'));
    modRefs.add(c.to.split(':').slice(0, 2).join(':'));
  });
  let v01ok = true, v01detail = [];
  for (let s = 0; s < S; s++) {
    for (let m = 1; m <= N; m++) if (!modRefs.has(`S${s + 1}:M${m}`)) { v01ok = false; v01detail.push(`S${s + 1}:M${m} unconnected`); }
  }
  add('V01', v01ok, v01ok ? `${S} strings × ${N} modules present` : v01detail.join(', '));

  // V02 power degree: every module exactly one in + one out (power)
  const pIn = {}, pOut = {};
  conns.filter(c => c.network === 'power').forEach(c => { pOut[c.from] = (pOut[c.from] || 0) + 1; pIn[c.to] = (pIn[c.to] || 0) + 1; });
  let v02bad = [];
  for (let s = 0; s < S; s++) for (let m = 1; m <= N; m++) {
    const pin = pIn[`S${s + 1}:M${m}:P+`] || 0;
    // interior modules feed the next module's plus; the last module's minus receives from SSC minus (R05)
    const pout = m < N ? (pOut[`S${s + 1}:M${m}:P-`] || 0) : (pIn[`S${s + 1}:M${N}:P-`] || 0);
    if (pin !== 1 || pout !== 1) v02bad.push(`S${s + 1}:M${m}`);
  }
  add('V02', v02bad.length === 0, v02bad.length ? `Degree mismatch: ${v02bad.join(', ')}` : 'All modules have exactly one power in and one power out');

  // V03 polarity sequence: Mx- -> Mx+1+ exists for every adjacent pair
  let v03missing = [];
  for (let s = 0; s < S; s++) for (let m = 1; m < N; m++) {
    const ok = conns.some(c => c.network === 'power' && c.cls === 'M2M-PWR' && c.from === `S${s + 1}:M${m}:P-` && c.to === `S${s + 1}:M${m + 1}:P+`);
    if (!ok) v03missing.push(`S${s + 1}:M${m}→M${m + 1}`);
  }
  add('V03', v03missing.length === 0, v03missing.length ? `Missing links: ${v03missing.slice(0, 4).join(', ')}${v03missing.length > 4 ? '…' : ''}` : 'SSC+ → M1+ … M24− → SSC− verified');
  function num(ref) { const m = ref.match(/M(\d+)/); return m ? +m[1] : 0; }

  // V04 communication predecessor/successor
  const cOut = {}, cIn = {};
  conns.filter(c => c.network === 'comm').forEach(c => { cOut[c.from] = (cOut[c.from] || 0) + 1; cIn[c.to] = (cIn[c.to] || 0) + 1; });
  let v04bad = [];
  for (let s = 0; s < S; s++) {
    for (let m = 1; m < N; m++) {
      const din = cIn[`S${s + 1}:M${m}:N`] || 0, dout = cOut[`S${s + 1}:M${m}:S`] || 0;
      if (din !== 1 || dout !== 1) v04bad.push(`S${s + 1}:M${m}`);
    }
    // endpoint module: receives on N (from M(N-1)) and on S (from SSC N) — both must be present
    const dinEnd = cIn[`S${s + 1}:M${N}:N`] || 0, dinTerm = cIn[`S${s + 1}:M${N}:S`] || 0;
    if (dinEnd !== 1 || dinTerm !== 1) v04bad.push(`S${s + 1}:M${N}`);
  }
  add('V04', v04bad.length === 0, v04bad.length ? `Chain broken at: ${v04bad.join(', ')}` : 'Daisy chain closed from SSC S to SSC N');

  // V05 termination only at endpoints (approximated: SSC S and SSC N are endpoints)
  const termBad = [];
  for (let s = 0; s < S; s++) {
    if (!(cOut[`S${s + 1}-SSC:S`] === 1)) termBad.push(`S${s + 1}-SSC:S missing chain start`);
    if (!(cOut[`S${s + 1}-SSC:N`] === 1)) termBad.push(`S${s + 1}-SSC:N missing chain end`);
  }
  add('V05', termBad.length === 0, termBad.length ? termBad.join('; ') : 'Terminations at SSC S / SSC N only');

  // V06 every connection resolves to two valid terminals
  const termRe = /^[^:]+:[PN][+-]?S?$|^.*:(P[+-]|BUS[+-]|S|N)$/;
  const badTerm = conns.filter(c => !termRe.test(c.from) || !termRe.test(c.to));
  add('V06', badTerm.length === 0, badTerm.length ? `Malformed terminal on ${badTerm.length} connection(s)` : 'All endpoints well-formed');

  // V07/V08 harness connector + length
  const noHarness = conns.filter(c => !c.harness);
  add('V07', noHarness.length === 0, noHarness.length ? `${noHarness.length} connection(s) without approved harness: ${noHarness.slice(0, 3).map(c => c.from).join(', ')}${noHarness.length > 3 ? '…' : ''}` : 'All connections mapped to approved part numbers');
  const tooShort = conns.filter(c => c.harness && c.length < c.routedLen);
  add('V08', tooShort.length === 0, tooShort.length ? `${tooShort.length} harness(es) shorter than routed length` : 'All harnesses cover the routed length');

  // V09 routes comply (channel rules declared per exception type)
  const unapproved = exceptions.filter(e => e.type === 'column' && !e.approvalRef);
  add('V09', unapproved.length === 0, unapproved.length ? 'Column transition without approved route reference' : 'All routes inside approved channels (power / comm separated)');

  // V10/V11 schedule + quantity reconciliation
  const sched = buildSchedule(conns);
  const totalConns = conns.length;
  const schedTotal = sched.reduce((t, r) => t + r.qty, 0);
  add('V10', schedTotal === totalConns, `${schedTotal} of ${totalConns} cables scheduled`);
  add('V11', schedTotal === totalConns, schedTotal === totalConns ? 'Quantities match netlist' : 'Quantity mismatch — regenerate schedule');

  // V12 exceptions carry approval reference
  const noRef = exceptions.filter(e => !e.approvalRef);
  add('V12', exceptions.length === 0 || noRef.length === 0, noRef.length ? `${noRef.length} exception(s) missing approval reference` : (exceptions.length ? 'All exceptions approved' : 'No exceptions declared'));
  return out;
}

/* ---------- cable schedule / BOM ---------- */
function buildSchedule(conns) {
  const map = new Map();
  for (const c of conns) {
    const key = `${c.harness || 'UNRELEASED'}|${c.cls}|${c.from}→${c.to}`;
    if (!map.has(key)) map.set(key, { harness: c.harness || '— UNRELEASED —', cls: c.cls, network: c.network, from: c.from, to: c.to, length: c.length, routedLen: c.routedLen, qty: 0, desc: c.desc || '', gauge: c.gauge || '' });
    map.get(key).qty++;
  }
  return [...map.values()];
}

function scheduleCSV(conns, project) {
  const rows = [['Cable ID', 'Network', 'Class', 'From', 'To', 'Harness P/N', 'Cable spec', 'Manufactured length (mm)', 'Routed length (mm)', 'Qty', 'Description']];
  buildSchedule(conns).forEach((r, i) => rows.push([`C-${String(i + 1).padStart(3, '0')}`, r.network, r.cls, r.from, r.to, r.harness, r.gauge, r.length, r.routedLen, r.qty, r.desc]));
  return rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

/* ---------- skill-compatible JSON layout spec ----------
 * Machine-readable layout contract matching the wiring-diagram
 * skill format: components in inches, connections with colour,
 * gauge and length. Downstream tools (Visio skills, custom
 * generators) can consume this without knowing the engine.
 */
function specJson(conns, project) {
  const L = buildSheetLayout(project, conns);
  const unitsPerMm = 4; // 1 sheet unit = 0.25 mm
  const toIn = u => Math.round((u / unitsPerMm / 25.4) * 1000) / 1000;
  const components = L.modules.map(m => ({
    id: m.label,
    type: 'module',
    string: m.s + 1,
    position: { x: toIn(m.x), y: toIn(m.y) },
    size: { width: toIn(m.w), height: toIn(m.h) },
    power_terminal: { x: toIn(m.tPower), y: toIn(m.ty) },
    comm_terminal: { x: toIn(m.tComm), y: toIn(m.ty) },
  }));
  for (const s of (L.ssc || [])) {
    components.push({
      id: s.label,
      type: 'ssc',
      position: { x: toIn(s.x), y: toIn(s.y) },
      size: { width: toIn(s.w), height: toIn(s.h) },
    });
  }
  // Junction boxes are netlist endpoints (S<n>-JB) but are only labelled on
  // the sheet; derive them here so the JSON spec is fully self-consistent.
  const jbSeen = new Set();
  for (const c of conns) {
    for (const ep of [c.from, c.to]) {
      const m = ep.match(/^(S(\d+))-JB:/);
      if (!m || jbSeen.has(m[1])) continue;
      jbSeen.add(m[1]);
      const ssc = (L.ssc || []).find(x => x.s === +m[2] - 1) || { x: 120, y: 240, w: 180 };
      components.push({
        id: m[1] + '-JB',
        type: 'junction_box',
        position: { x: toIn(ssc.x), y: toIn(ssc.y - 40) },
        size: { width: toIn(ssc.w), height: toIn(30) },
      });
    }
  }
  const connections = conns.map(c => ({
    id: 'C-' + String(c.seq).padStart(3, '0'),
    from: c.from,
    to: c.to,
    network: c.network,
    class: c.cls,
    color: c.network === 'power' ? '#c00000' : '#00b050',
    label: c.harness || 'UNRELEASED',
    gauge: c.gauge || '',
    length_mm: c.length ?? c.routedLen ?? null,
  }));
  return JSON.stringify({
    diagram_type: 'wiring',
    paper: { size: 'A3', orientation: 'landscape', width_in: toIn(L.w), height_in: toIn(L.h) },
    title: `${project.name || 'Wiring'} — Rack wiring diagram`,
    components,
    connections,
  }, null, 2);
}

/* ============================================================
 * Engineering sheet layout (single source of geometry)
 * ------------------------------------------------------------
 * One A3 landscape sheet described in sheet units:
 *   1680 x 1188 units, 1 unit = 0.25 mm  ->  420 x 297 mm paper.
 *
 * buildSheetLayout() emits ONE flat list of drawing primitives
 * (line / rect / circle / text) that are tagged with a drawing
 * layer. The SVG, DXF and SCR renderers only translate that
 * primitive list, therefore the three outputs can never drift
 * apart and the layout logic exists exactly once.
 *
 * Sheet content, from the outside in:
 *   double frame + zone ticks (A-F / 1-8)
 *   title + review stamp (top-left)
 *   module grid, 4 columns x ceil(N/4) rows, column-major M1..MN
 *   connector / device strip (right of the grid)
 *   SSC-1..SSC-S blocks (top of column 1, one per string)
 *   power rail (red, left/top) + communication rail (green, right/bottom)
 *   callouts (power plugs, grounding point)
 *   legend table + title block (bottom-right), notes (bottom-left)
 * ============================================================ */

const SHEET_LAYERS = [
  { name: 'FRAME',   dxf: 7,  stroke: '#0f172a', width: 2.0 },
  { name: 'TITLE',   dxf: 7,  stroke: '#0f172a', width: 1.1 },
  { name: 'LEGEND',  dxf: 7,  stroke: '#475569', width: 0.9 },
  { name: 'POWER',   dxf: 1,  stroke: '#dc2626', width: 2.4 },
  { name: 'SUBPWR',  dxf: 30, stroke: '#f59e0b', width: 2.4 },
  { name: 'COMM',    dxf: 3,  stroke: '#16a34a', width: 2.0 },
  { name: 'COMMGRY', dxf: 8,  stroke: '#64748b', width: 2.0 },
  { name: 'TEXT',    dxf: 7,  stroke: '#0f172a', width: 0.9 },
  { name: 'MOD',     dxf: 8,  stroke: '#94a3b8', width: 1.0 },
  { name: 'DEVICE',  dxf: 8,  stroke: '#94a3b8', width: 1.0 },
  { name: 'SSC',     dxf: 5,  stroke: '#4f46e5', width: 1.4 },
  { name: 'TERM',    dxf: 3,  stroke: '#16a34a', width: 1.4 },
];

const SHEET_W = 1680;          /* sheet width  in units (420 mm) */
const SHEET_H = 1188;          /* sheet height in units (297 mm) */
const SHEET_UNIT_MM = 0.25;    /* paper millimetres per sheet unit */

/**
 * Looks up the layer definition for a layer name.
 * @param {string} name Layer name.
 * @return {Object} Layer record (falls back to the first layer).
 */
function sheetLayer(name) {
  for (let i = 0; i < SHEET_LAYERS.length; i++) {
    if (SHEET_LAYERS[i].name === name) return SHEET_LAYERS[i];
  }
  return SHEET_LAYERS[0];
}

/**
 * Clamps a value to an integer range with a safe fallback.
 * @param {*} v Raw value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @return {number} Clamped integer.
 */
function sheetClampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Clamps a value to a float range with a safe fallback.
 * @param {*} v Raw value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @return {number} Clamped number.
 */
function sheetClampNum(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** @param {number} v Value. @return {number} Rounded to 2 decimals. */
function sheetNum(v) { return Math.round(Number(v) * 100) / 100; }

/** @param {number} v Sheet x in units. @return {string} Millimetres. */
function sheetMx(v) { return (Number(v) * SHEET_UNIT_MM).toFixed(3); }

/** @param {number} v Sheet y in units (y grows downwards). @return {string} Millimetres with the y axis flipped up. */
function sheetMy(v) { return ((SHEET_H - Number(v)) * SHEET_UNIT_MM).toFixed(3); }

/**
 * Escapes a string for XML/HTML attribute and text content.
 * @param {*} s Raw value.
 * @return {string} Escaped string.
 */
function sheetEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Rough advance width of a text run, used to emulate text anchoring in
 * DXF and SCR where alignment must be resolved manually.
 * @param {string} str Text.
 * @param {number} size Cap height in sheet units.
 * @return {number} Approximate width in sheet units.
 */
function sheetTextWidth(str, size) {
  return String(str === null || str === undefined ? '' : str).length * size * 0.58;
}

/**
 * Sanitises a string for the ANSI (cp1252) CAD boundary.
 *
 * DXF R12 and .scr carry no encoding declaration, so bytes >= 0x80 are read as
 * cp1252 by AutoCAD/ezdxf and a UTF-8 em dash (E2 80 94) turns into mojibake.
 * The SVG keeps the typographic characters (it is UTF-8 XML); the CAD writers
 * replace every non-printable-ASCII character with an ASCII hyphen. Control
 * characters (including any stray CR/LF) are dropped outright so a DXF text
 * value can never break group-code pairing.
 *
 * @param {*} s Raw text.
 * @return {string} Printable ASCII only.
 */
function sheetAscii(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '-');
}

/**
 * Legend rows for the sheet (line sample colour + description).
 * @return {Array<Object>} Legend rows.
 */
function sheetLegendRows() {
  return [
    { layer: 'COMM',    text: 'Corner Line (Cat5 ethernet cable or higher grade, 25AW) Max 5m' },
    { layer: 'POWER',   text: 'Main Power Line (63A/125V, CD 150mm2) Max 3m' },
    { layer: 'SUBPWR',  text: 'Sub Power Line (12V/24V, CD 2.5mm2) Max 3m' },
    { layer: 'COMMGRY', text: 'Communication (Cat5) Max 5m' },
  ];
}

/**
 * Builds the complete engineering sheet geometry.
 * @param {Object} project Project record (fields may be missing).
 * @param {Array<Object>} conns Generated netlist (may be empty).
 * @return {Object} Sheet layout: size, primitive list and metadata.
 */
function buildSheetLayout(project, conns) {
  const p = project || {};
  const cfg = p.config || {};
  const rules = Object.assign({}, DEFAULT_RULES, cfg.rules || {});
  const N = sheetClampInt(rules.modulesPerString, 1, 96);
  const stringsConfigured = sheetClampInt(rules.strings, 1, 96);
  /* One sheet carries at most 4 strings; longer configurations need continuation
     sheets and must say so on the drawing instead of silently dropping strings. */
  const S = Math.min(stringsConfigured, 4);
  const sheetOf = Math.ceil(stringsConfigured / 4);
  const netlist = Array.isArray(conns) ? conns : [];
  const isoDate = new Date().toISOString().slice(0, 10);

  /* ---------------- primitive builders ---------------- */
  const primitives = [];

  function addLine(layer, x1, y1, x2, y2, opt) {
    primitives.push({
      type: 'line', layer: layer,
      x1: x1, y1: y1, x2: x2, y2: y2,
      dash: (opt && opt.dash) || null,
      width: (opt && opt.width) || null,
    });
  }

  function addPoly(layer, pts, opt) {
    for (let i = 0; i < pts.length - 1; i++) {
      addLine(layer, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], opt);
    }
  }

  function addRect(layer, x, y, w, h, opt) {
    primitives.push({
      type: 'rect', layer: layer,
      x: x, y: y, w: w, h: h,
      fill: (opt && opt.fill) || 'none',
      dash: (opt && opt.dash) || null,
      width: (opt && opt.width) || null,
    });
  }

  function addCircle(layer, cx, cy, r, opt) {
    primitives.push({
      type: 'circle', layer: layer,
      cx: cx, cy: cy, r: r,
      fill: (opt && opt.fill) || 'none',
      width: (opt && opt.width) || null,
    });
  }

  function addText(layer, x, y, size, str, opt) {
    primitives.push({
      type: 'text', layer: layer,
      x: x, y: y, size: size,
      text: String(str === null || str === undefined ? '' : str),
      anchor: (opt && opt.anchor) || 'start',
      bold: !!(opt && opt.bold),
      cls: (opt && opt.cls) || null,
    });
  }

  /* ---------------- sheet frames + zones ---------------- */
  const OUT = { x: 16, y: 16, w: SHEET_W - 32, h: SHEET_H - 32 };
  const IN = { x: 42, y: 42, w: SHEET_W - 84, h: SHEET_H - 88 };
  addRect('FRAME', OUT.x, OUT.y, OUT.w, OUT.h, { width: 2.4 });
  addRect('FRAME', IN.x, IN.y, IN.w, IN.h, { width: 1.6 });

  const zoneCols = ['A', 'B', 'C', 'D', 'E', 'F'];
  const zoneRows = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const zoneColW = IN.w / zoneCols.length;
  const zoneRowH = IN.h / zoneRows.length;
  for (let i = 0; i <= zoneCols.length; i++) {
    const zx = IN.x + i * zoneColW;
    addLine('FRAME', zx, IN.y - 18, zx, IN.y, { width: 0.9 });
    addLine('FRAME', zx, IN.y + IN.h, zx, IN.y + IN.h + 18, { width: 0.9 });
  }
  for (let i = 0; i < zoneCols.length; i++) {
    const zc = IN.x + i * zoneColW + zoneColW / 2;
    addText('TEXT', zc, IN.y - 6, 10, zoneCols[i], { anchor: 'middle' });
    addText('TEXT', zc, IN.y + IN.h + 14, 10, zoneCols[i], { anchor: 'middle' });
  }
  for (let i = 0; i <= zoneRows.length; i++) {
    const zy = IN.y + i * zoneRowH;
    addLine('FRAME', IN.x - 18, zy, IN.x, zy, { width: 0.9 });
    addLine('FRAME', IN.x + IN.w, zy, IN.x + IN.w + 18, zy, { width: 0.9 });
  }
  for (let i = 0; i < zoneRows.length; i++) {
    const zr = IN.y + i * zoneRowH + zoneRowH / 2 + 3.5;
    addText('TEXT', IN.x - 9, zr, 10, zoneRows[i], { anchor: 'middle' });
    addText('TEXT', IN.x + IN.w + 9, zr, 10, zoneRows[i], { anchor: 'middle' });
  }

  /* ---------------- drawing title + review stamp ---------------- */
  const docTitle = 'Wiring Diagram - ' + (p.name || p.rack || 'Rack 1');
  addText('TITLE', IN.x + 24, IN.y + 44, 30, docTitle, { bold: true });
  addLine('TITLE', IN.x + 24, IN.y + 52, IN.x + 24 + Math.min(560, sheetTextWidth(docTitle, 30)), IN.y + 52, { width: 1.4 });

  const released = String(p.status || '').toLowerCase() === 'released';
  const stampText = released ? 'RELEASED' : 'FOR REVIEW';
  const stampX = IN.x + 24;
  const stampY = IN.y + 62;
  const stampW = 200;
  const stampH = 52;
  addRect('TITLE', stampX, stampY, stampW, stampH, { dash: '7 5', width: 1.4 });
  addText('TITLE', stampX + stampW / 2, stampY + 34, 20, stampText, { anchor: 'middle', bold: true });

  /* ---------------- grid memory (computed once) ---------------- */
  const gridX = 120;
  const gridTop = 290;
  const gridBottomLimit = 846;
  const gridMaxW = 862;
  const blockGap = S > 1 ? 40 : 0;
  const availH = gridBottomLimit - gridTop;
  const minRowH = 21;

  /* Pick the column count that still fits the sheet at a readable row height.
     Four columns is the engineering default; very long strings widen the grid
     instead of pushing the drawing off the sheet. */
  let COLS = 4;
  while (COLS < 8 && S * Math.ceil(N / COLS) * minRowH > availH) COLS++;
  const rows = Math.ceil(N / COLS);
  const colGap = COLS > 4 ? 18 : 34;
  const colW = Math.floor((gridMaxW - (COLS - 1) * colGap) / COLS);
  const gridW = COLS * colW + (COLS - 1) * colGap;
  const rowH = sheetClampNum(
    Math.floor((availH - (S - 1) * blockGap) / (S * rows)), 18, 100);
  const rowGap = sheetClampNum(Math.round(rowH * 0.16), 4, 14);
  const modH = rowH - rowGap;
  const termR = sheetClampNum(modH * 0.055, 2.4, 5);
  const modFont = sheetClampNum(modH * 0.30, 8, 13);
  const termInset = Math.max(7, modH * 0.22);
  const contentH = S * rows * rowH + (S - 1) * blockGap;

  const blocks = [];
  const mods = [];
  for (let s = 0; s < S; s++) {
    const blockY = gridTop + s * (rows * rowH + blockGap);
    blocks.push({
      s: s,
      x: gridX, y: blockY, w: gridW, h: rows * rowH,
      powerTrunkY: blockY - 12,
      commTrunkY: blockY + rows * rowH + 10,
    });
    for (let c = 0; c < COLS; c++) {
      const colX = gridX + c * (colW + colGap);
      for (let r = 0; r < rows; r++) {
        const m = c * rows + r + 1;
        if (m > N) continue;
        const my = blockY + r * rowH;
        mods.push({
          s: s, c: c, r: r, m: m,
          x: colX, y: my, w: colW, h: modH,
          ty: my + modH - termInset,
          tPower: colX + colW * 0.12,
          tComm: colX + colW * 0.88,
          label: 'S' + (s + 1) + ':M' + m,
        });
      }
    }
  }

  const sscY = 172;
  const sscH = 68;
  const sscGap = 20;
  const sscW = Math.min(180, Math.floor((gridW - (S - 1) * sscGap) / S));
  const sscList = [];
  for (let s = 0; s < S; s++) {
    const bx = 120 + s * (sscW + sscGap);
    sscList.push({
      s: s, label: 'SSC-' + (s + 1),
      x: bx, y: sscY, w: sscW, h: sscH,
      powerX: bx + Math.round(sscW * 0.25),
      commX: bx + sscW,
      commY: sscY + 18 + 12 * s,
      busX: bx + Math.round(sscW * 0.6),
    });
  }

  /* ---------------- rack outline + module blocks ---------------- */
  for (const b of blocks) {
    addRect('FRAME', b.x - 26, b.y - 20, b.w + 52, b.h + 38, { width: 1.2 });
  }
  for (const mo of mods) {
    addRect('MOD', mo.x, mo.y, mo.w, mo.h, { fill: '#ffffff', width: 1.0 });
  }

  /* ---------------- cable rails (power left/top, comm right/bottom) ---------------- */
  const powerTrunkStart = gridX - 8;
  const powerTrunkEnd = gridX + (COLS - 1) * (colW + colGap) - 8;
  const commTrunkStart = gridX + colW + 8;

  for (const b of blocks) {
    const ssc = sscList[b.s];
    const chX = Math.max(IN.x + 12, 100 - 14 * b.s);
    const trunkX = b.s === 0 ? powerTrunkStart : chX;
    /* Each string elbows out of the SSC on its own horizontal so that
       multi-string sheets never overprint two nets on the same line. */
    const elbowY = ssc.y + ssc.h + 6 + 8 * (b.s - 1);

    /* power: SSC -> top trunk -> column rails -> ticks */
    const powerPts = [[ssc.powerX, ssc.y + ssc.h]];
    if (b.s > 0) {
      powerPts.push([ssc.powerX, elbowY]);
      powerPts.push([chX, elbowY]);
      powerPts.push([chX, b.powerTrunkY]);
    } else {
      powerPts.push([ssc.powerX, b.powerTrunkY]);
    }
    addPoly('POWER', powerPts);
    addPoly('POWER', [[trunkX, b.powerTrunkY], [powerTrunkEnd, b.powerTrunkY]]);

    /* comm: SSC -> right channel -> bottom trunk -> column rails -> ticks */
    const commDropX = 1002 + 10 * b.s;
    addPoly('COMM', [
      [ssc.commX, ssc.commY],
      [commDropX, ssc.commY],
      [commDropX, b.commTrunkY],
      [commTrunkStart, b.commTrunkY],
    ]);

    for (let c = 0; c < COLS; c++) {
      const colX = gridX + c * (colW + colGap);
      const railPowerX = colX - 8;
      const railCommX = colX + colW + 8;
      const colMods = mods.filter(function (mo) { return mo.s === b.s && mo.c === c; });
      if (!colMods.length) continue;
      const firstTy = colMods[0].ty;
      const lastTy = colMods[colMods.length - 1].ty;
      addLine('POWER', railPowerX, b.powerTrunkY, railPowerX, lastTy, null);
      addLine('COMM', railCommX, firstTy, railCommX, b.commTrunkY, null);
      for (const mo of colMods) {
        addLine('POWER', railPowerX, mo.ty, mo.tPower, mo.ty, null);
        addLine('COMM', railCommX, mo.ty, mo.tComm, mo.ty, null);
      }
    }
  }

  /* ---------------- module terminals + labels ---------------- */
  for (const mo of mods) {
    const fractions = [0.12, 0.34, 0.66, 0.88];
    for (let t = 0; t < fractions.length; t++) {
      addCircle('TERM', mo.x + mo.w * fractions[t], mo.ty, termR, { fill: '#ffffff' });
    }
    addText('TEXT', mo.x + mo.w / 2, mo.y + modH / 2 + modFont * 0.36, modFont, mo.label,
      { anchor: 'middle', bold: true, cls: 'svg-mod' });
  }

  /* ---------------- SSC blocks ---------------- */
  for (const ssc of sscList) {
    addRect('SSC', ssc.x, ssc.y, ssc.w, ssc.h, { fill: '#eef2ff', width: 1.4 });
    addText('TEXT', ssc.x + ssc.w / 2, ssc.y + 28, 14, ssc.label,
      { anchor: 'middle', bold: true, cls: 'svg-dev' });
    addText('TEXT', ssc.x + ssc.w / 2, ssc.y + 46, 8.5, 'STRING ' + (ssc.s + 1) + ' / ' + N + ' MODULES',
      { anchor: 'middle' });
    addCircle('TERM', ssc.powerX, ssc.y + ssc.h, 4, { fill: '#ffffff' });
    addCircle('TERM', ssc.busX, ssc.y + ssc.h, 4, { fill: '#ffffff' });
    addCircle('TERM', ssc.commX, ssc.commY, 4, { fill: '#ffffff' });
  }

  /* ---------------- connector / device strip ---------------- */
  const stripX = Math.min(1040, 1004 + 12 * S);
  const stripW = 34;
  const stripCell = sheetClampNum((contentH - 9 * 10) / 10, 20, 34);
  const stripH = 10 * stripCell + 9 * 10;
  const stripY = gridTop + Math.max(0, (contentH - stripH) / 2);
  addText('TEXT', stripX + stripW / 2, stripY - 8, 8, 'DEVICE', { anchor: 'middle' });
  for (let i = 0; i < 10; i++) {
    addRect('DEVICE', stripX, stripY + i * (stripCell + 10), stripW, stripCell, { fill: '#f8fafc', width: 0.9 });
  }
  addLine('DEVICE', stripX + stripW / 2, stripY - 4, stripX + stripW / 2, stripY, { width: 0.9 });

  /* ---------------- callouts ---------------- */
  addText('TEXT', 620, 104, 12, 'Power Plugs, Input 1', { anchor: 'start', bold: true });
  addPoly('LEGEND', [[616, 100], [520, 100], [240, sscY]]);
  addText('TEXT', 620, 140, 12, 'Power Plugs, Input 2', { anchor: 'start', bold: true });
  addPoly('LEGEND', [[616, 136], [548, 136], [280, sscY]]);

  const rackBottom = blocks[blocks.length - 1].y + blocks[blocks.length - 1].h + 18;
  const groundX = gridX + gridW / 2;
  addLine('LEGEND', groundX, rackBottom - 18, groundX, rackBottom + 16, { width: 1.2 });
  addLine('LEGEND', groundX - 18, rackBottom + 16, groundX + 18, rackBottom + 16, { width: 1.6 });
  addLine('LEGEND', groundX - 12, rackBottom + 23, groundX + 12, rackBottom + 23, { width: 1.4 });
  addLine('LEGEND', groundX - 6, rackBottom + 30, groundX + 6, rackBottom + 30, { width: 1.2 });
  addText('TEXT', groundX, rackBottom + 50, 12, 'Grounding Point', { anchor: 'middle', bold: true });

  /* ---------------- legend table (bottom-right, above the title block) ---------------- */
  const legend = { x: 1078, y: 850, w: 560, h: 132 };
  addRect('LEGEND', legend.x, legend.y, legend.w, legend.h, { width: 1.2 });
  addLine('LEGEND', legend.x, legend.y + 28, legend.x + legend.w, legend.y + 28, { width: 1.0 });
  addText('TEXT', legend.x + 14, legend.y + 19, 12, 'LEGEND', { bold: true });
  addText('TEXT', legend.x + legend.w - 14, legend.y + 18, 8, 'NETWORK / CABLE', { anchor: 'end' });
  const legendRows = sheetLegendRows();
  for (let i = 0; i < legendRows.length; i++) {
    const ry = legend.y + 28 + i * 26;
    addLine('LEGEND', legend.x, ry, legend.x + legend.w, ry, { width: 0.5 });
    addLine(legendRows[i].layer, legend.x + 12, ry + 13, legend.x + 52, ry + 13, { width: 3.2 });
    addText('TEXT', legend.x + 64, ry + 17, 10.5, legendRows[i].text);
  }
  addLine('LEGEND', legend.x, legend.y + legend.h, legend.x + legend.w, legend.y + legend.h, { width: 1.2 });

  /* ---------------- title block (bottom-right corner) ---------------- */
  const tb = { x: 1078, y: 990, w: 560, h: 156 };
  addRect('TITLE', tb.x, tb.y, tb.w, tb.h, { width: 1.6 });
  addLine('TITLE', tb.x, tb.y + 28, tb.x + tb.w, tb.y + 28, { width: 1.0 });
  addLine('TITLE', tb.x, tb.y + 68, tb.x + tb.w, tb.y + 68, { width: 1.0 });
  addLine('TITLE', tb.x, tb.y + 100, tb.x + tb.w, tb.y + 100, { width: 1.0 });
  addLine('TITLE', tb.x, tb.y + 100, tb.x, tb.y + tb.h, { width: 1.0 });

  addText('TEXT', tb.x + 14, tb.y + 20, 12.5, (p.vessel || 'WIREFLOW ENGINEERING LTD'), { bold: true });
  addText('TEXT', tb.x + tb.w - 64, tb.y + 19, 8.5, 'MARINE BATTERY WIRING SYSTEM', { anchor: 'end' });

  addText('TEXT', tb.x + 14, tb.y + 44, 8, 'DRAWING TITLE');
  addText('TEXT', tb.x + 14, tb.y + 62, 15, (p.name || p.rack || 'Rack 1'), { bold: true });

  addText('TEXT', tb.x + 14, tb.y + 80, 8, 'DRAWING NO');
  addText('TEXT', tb.x + 14, tb.y + 96, 13, (p.drawing_no || 'DWG-0000'), { bold: true });
  addLine('TITLE', tb.x + 370, tb.y + 68, tb.x + 370, tb.y + 100, { width: 1.0 });
  addText('TEXT', tb.x + 384, tb.y + 80, 8, 'REV');
  addText('TEXT', tb.x + 384, tb.y + 96, 13, (p.revision || 'A'), { bold: true });

  const fields = [
    { label: 'SCALE', value: '1:20', w: 100 },
    { label: 'SIZE', value: 'A3', w: 90 },
    { label: 'SHEET', value: '1/1', w: 90 },
    { label: 'DATE', value: isoDate, w: 130 },
    { label: 'DRAWN BY', value: 'WireFlow Generator', w: 150 },
  ];
  let fx = tb.x;
  for (const f of fields) {
    addText('TEXT', fx + 10, tb.y + 118, 8, f.label);
    addText('TEXT', fx + 10, tb.y + 142, 11, f.value, { bold: true });
    fx += f.w;
    if (fx < tb.x + tb.w) addLine('TITLE', fx, tb.y + 100, fx, tb.y + tb.h, { width: 1.0 });
  }

  /* ---------------- notes (bottom-left) ---------------- */
  const notesX = IN.x + 24;
  const notesList = [
    '1. All cables are routed to a single collection point (Point A) with cable ties at 300 mm spacing.',
    '2. Power and communication networks are separated and run on dedicated rails (R01).',
    '3. All harnesses are selected from the approved catalogue; unreleased items require engineering release.',
  ];
  if (stringsConfigured > 4) {
    notesList.push('4. Sheet 1 of ' + sheetOf + ': strings 1-4 of ' + stringsConfigured +
      ' shown \u2014 continuation sheets required.');
  }
  /* The block is laid out from the top down; a fourth line shifts it up so the
     summary still ends inside the frame (bottom edge 1146). */
  const notesTop = notesList.length > 3 ? 1010 : 1030;
  const noteStep = 22;
  addText('TEXT', notesX, notesTop, 13, 'NOTES:', { bold: true });
  for (let i = 0; i < notesList.length; i++) {
    addText('TEXT', notesX, notesTop + 26 + i * noteStep, 11, notesList[i]);
  }
  const nPow = netlist.filter(function (c) { return c && c.network === 'power'; }).length;
  const nComm = netlist.filter(function (c) { return c && c.network === 'comm'; }).length;
  const nOpen = netlist.filter(function (c) { return c && !c.harness; }).length;
  const summary = netlist.length
    ? (netlist.length + ' connections | power ' + nPow + ' | communication ' + nComm +
      (nOpen ? ' | ' + nOpen + ' unreleased' : ' | all harnesses approved'))
    : 'Netlist preview - generate the netlist to populate the connection data.';
  addText('TEXT', notesX, notesTop + 26 + notesList.length * noteStep + 2, 10.5, summary);

  return {
    w: SHEET_W,
    h: SHEET_H,
    paper: { x: 8, y: 8, w: SHEET_W - 16, h: SHEET_H - 16 },
    frame: { outer: OUT, inner: IN },
    modules: mods,
    blocks: blocks,
    ssc: sscList,
    meta: {
      title: docTitle,
      drawingNo: p.drawing_no || 'DWG-0000',
      revision: p.revision || 'A',
      status: released ? 'released' : 'for-review',
      stamp: stampText,
      date: isoDate,
      modulesPerString: N,
      strings: S,
      stringsConfigured: stringsConfigured,
      sheetOf: sheetOf,
      truncated: stringsConfigured > S,
      rows: rows,
      columns: COLS,
      connections: netlist.length,
    },
    primitives: primitives,
  };
}

/* ---------- SVG renderer (built on the shared primitive list) ---------- */

/**
 * Translates one sheet primitive into SVG markup.
 * @param {Object} pr Primitive record.
 * @return {string} SVG element markup.
 */
function sheetSvgPrimitive(pr) {
  const st = sheetLayer(pr.layer);
  const w = pr.width || st.width;
  if (pr.type === 'line') {
    let s = '<line x1="' + sheetNum(pr.x1) + '" y1="' + sheetNum(pr.y1) +
      '" x2="' + sheetNum(pr.x2) + '" y2="' + sheetNum(pr.y2) +
      '" stroke="' + st.stroke + '" stroke-width="' + w + '" stroke-linecap="round"';
    if (pr.dash) s += ' stroke-dasharray="' + pr.dash + '"';
    return s + '/>';
  }
  if (pr.type === 'rect') {
    let s = '<rect x="' + sheetNum(pr.x) + '" y="' + sheetNum(pr.y) +
      '" width="' + sheetNum(pr.w) + '" height="' + sheetNum(pr.h) +
      '" fill="' + pr.fill + '" stroke="' + st.stroke + '" stroke-width="' + w + '"';
    if (pr.dash) s += ' stroke-dasharray="' + pr.dash + '"';
    return s + '/>';
  }
  if (pr.type === 'circle') {
    return '<circle cx="' + sheetNum(pr.cx) + '" cy="' + sheetNum(pr.cy) +
      '" r="' + sheetNum(pr.r) + '" fill="' + pr.fill + '" stroke="' + st.stroke +
      '" stroke-width="' + w + '"/>';
  }
  let t = '<text x="' + sheetNum(pr.x) + '" y="' + sheetNum(pr.y) +
    '" fill="' + st.stroke + '" style="font-size:' + sheetNum(pr.size) +
    'px;font-weight:' + (pr.bold ? '700' : '400') + '"';
  if (pr.anchor !== 'start') t += ' text-anchor="' + pr.anchor + '"';
  if (pr.cls) t += ' class="' + pr.cls + '"';
  return t + '>' + sheetEsc(pr.text) + '</text>';
}

/**
 * Renders the engineering sheet as an inline SVG drawing.
 * @param {Object} project Project record (fields may be missing).
 * @param {Array<Object>} conns Generated netlist (may be empty).
 * @return {string} SVG markup.
 */
function renderDiagramSVG(project, conns) {
  const L = buildSheetLayout(project, conns);
  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.w + ' ' + L.h +
    '" preserveAspectRatio="xMidYMid meet" font-family="Helvetica, Arial, sans-serif"' +
    ' role="img" aria-label="' + sheetEsc(L.meta.title) + '"' +
    ' style="width:100%;height:auto;display:block;background:#e7ecf3">');
  parts.push('<rect x="0" y="0" width="' + L.w + '" height="' + L.h + '" fill="#e7ecf3"/>');
  parts.push('<rect x="' + L.paper.x + '" y="' + L.paper.y + '" width="' + L.paper.w +
    '" height="' + L.paper.h + '" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>');
  for (let i = 0; i < L.primitives.length; i++) {
    parts.push(sheetSvgPrimitive(L.primitives[i]));
  }
  parts.push('</svg>');
  return parts.join('');
}

/* ---------- DXF export (R12 / AC1009, opens in AutoCAD) ---------- */

/**
 * Appends the DXF entities for one primitive.
 * @param {Object} pr Primitive record.
 * @param {Array<*>} out Output buffer of group-code / value pairs.
 */
function sheetDxfPrimitive(pr, out) {
  if (pr.type === 'line') {
    out.push(0, 'LINE', 8, sheetAscii(pr.layer),
      10, sheetMx(pr.x1), 20, sheetMy(pr.y1), 30, '0.000',
      11, sheetMx(pr.x2), 21, sheetMy(pr.y2), 31, '0.000');
    return;
  }
  if (pr.type === 'rect') {
    const pts = [
      [pr.x, pr.y], [pr.x + pr.w, pr.y],
      [pr.x + pr.w, pr.y + pr.h], [pr.x, pr.y + pr.h], [pr.x, pr.y],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      out.push(0, 'LINE', 8, sheetAscii(pr.layer),
        10, sheetMx(pts[i][0]), 20, sheetMy(pts[i][1]), 30, '0.000',
        11, sheetMx(pts[i + 1][0]), 21, sheetMy(pts[i + 1][1]), 31, '0.000');
    }
    return;
  }
  if (pr.type === 'circle') {
    out.push(0, 'CIRCLE', 8, sheetAscii(pr.layer),
      10, sheetMx(pr.cx), 20, sheetMy(pr.cy), 30, '0.000',
      40, sheetMx(pr.r));
    return;
  }
  const width = sheetTextWidth(pr.text, pr.size);
  let x = pr.x;
  if (pr.anchor === 'middle') x = pr.x - width / 2;
  else if (pr.anchor === 'end') x = pr.x - width;
  out.push(0, 'TEXT', 8, sheetAscii(pr.layer),
    10, sheetMx(x), 20, sheetMy(pr.y), 30, '0.000',
    40, sheetMx(pr.size), 1, sheetAscii(pr.text));
}

/**
 * Exports the engineering sheet as an AutoCAD R12 DXF file.
 * @param {Array<Object>} conns Generated netlist.
 * @param {Object} project Project record.
 * @return {string} DXF document.
 */
function dxfExport(conns, project) {
  const L = buildSheetLayout(project, conns);
  const out = [];
  out.push(0, 'SECTION', 2, 'HEADER',
    9, '$ACADVER', 1, 'AC1009',
    9, '$INSBASE', 10, '0.000', 20, '0.000', 30, '0.000',
    9, '$EXTMIN', 10, '0.000', 20, '0.000', 30, '0.000',
    9, '$EXTMAX', 10, sheetMx(SHEET_W), 20, sheetMy(0), 30, '0.000',
    9, '$LIMMIN', 10, '0.000', 20, '0.000',
    9, '$LIMMAX', 10, sheetMx(SHEET_W), 20, sheetMy(0),
    0, 'ENDSEC');
  out.push(0, 'SECTION', 2, 'TABLES',
    0, 'TABLE', 2, 'LTYPE', 70, 1,
    0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, '0.000',
    0, 'ENDTAB',
    0, 'TABLE', 2, 'LAYER', 70, SHEET_LAYERS.length);
  for (const l of SHEET_LAYERS) {
    out.push(0, 'LAYER', 2, sheetAscii(l.name), 70, 0, 62, l.dxf, 6, 'CONTINUOUS');
  }
  out.push(0, 'ENDTAB', 0, 'ENDSEC');
  out.push(0, 'SECTION', 2, 'ENTITIES');
  for (let i = 0; i < L.primitives.length; i++) {
    sheetDxfPrimitive(L.primitives[i], out);
  }
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/* ---------- AutoCAD script (.scr) - Design Automation / manual run ---------- */

/**
 * Formats a sheet point as an AutoCAD script coordinate pair.
 * @param {number} x Sheet x in units.
 * @param {number} y Sheet y in units.
 * @return {string} "x,y" in paper millimetres.
 */
function sheetScrPoint(x, y) { return sheetMx(x) + ',' + sheetMy(y); }

/**
 * Exports the engineering sheet as an AutoCAD script drawing the same content.
 * @param {Array<Object>} conns Generated netlist.
 * @param {Object} project Project record.
 * @return {string} AutoCAD script.
 */
function scrExport(conns, project) {
  const L = buildSheetLayout(project, conns);
  const lines = [];
  const layerTokens = [];
  for (const l of SHEET_LAYERS) {
    const name = sheetAscii(l.name);
    layerTokens.push('_M', name, '_C', String(l.dxf), name);
  }
  lines.push('_.-LAYER ' + layerTokens.join(' ') + ' _');
  lines.push('_.OSMODE 0');
  lines.push('_.INSUNITS 4');
  let current = null;
  for (let i = 0; i < L.primitives.length; i++) {
    const pr = L.primitives[i];
    const layer = sheetAscii(pr.layer);
    if (layer !== current) {
      lines.push('_.-LAYER _S ' + layer + ' _');
      current = layer;
    }
    if (pr.type === 'line') {
      lines.push('_.LINE ' + sheetScrPoint(pr.x1, pr.y1) + ' ' + sheetScrPoint(pr.x2, pr.y2));
    } else if (pr.type === 'rect') {
      const pts = [
        [pr.x, pr.y], [pr.x + pr.w, pr.y],
        [pr.x + pr.w, pr.y + pr.h], [pr.x, pr.y + pr.h], [pr.x, pr.y],
      ];
      for (let k = 0; k < pts.length - 1; k++) {
        lines.push('_.LINE ' + sheetScrPoint(pts[k][0], pts[k][1]) + ' ' + sheetScrPoint(pts[k + 1][0], pts[k + 1][1]));
      }
    } else if (pr.type === 'circle') {
      lines.push('_.CIRCLE ' + sheetScrPoint(pr.cx, pr.cy) + ' ' + sheetMx(pr.r));
    } else {
      const width = sheetTextWidth(pr.text, pr.size);
      let x = pr.x;
      if (pr.anchor === 'middle') x = pr.x - width / 2;
      else if (pr.anchor === 'end') x = pr.x - width;
      lines.push('_.TEXT ' + sheetScrPoint(x, pr.y) + ' ' + sheetMx(pr.size) + ' 0 ' +
        sheetAscii(pr.text));
    }
  }
  lines.push('_.ZOOM _E');
  lines.push('_.QSAVE');
  return lines.join('\r\n') + '\r\n';
}
