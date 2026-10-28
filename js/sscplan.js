/* =====================================================================
 * AYK WireFlow — sscplan.js
 * VARIABLE LAYOUT PLANNER.
 *
 * Nothing about the rack is fixed: the module arrangement changes with
 * every rack layout diagram, the number of SSCs changes, and how many
 * modules each SSC controls changes. This planner reads the rack layout
 * (painted by the engineer or imported from the Visio/DWG rack picture)
 * and produces, for EVERY SSC independently:
 *
 *   • which modules that SSC controls (assignment, auto or hand-placed)
 *   • the shortest-cable chain M1…Mn anchored at THAT SSC
 *   • the cable that chain really needs (scored against the approved
 *     harness catalogue — same rules as the single-string engine)
 *
 * The per-SSC chains are then written back into the project as strings,
 * so the netlist, the cable schedule, the validations and the general
 * diagram all follow the variable layout without any duplicated logic.
 *
 * Exports:
 *   layoutEnsure, layoutAssign, layoutGroups, layoutGroupOrder, layoutTsp,
 *   groupMetrics, layoutValidate, layoutApply, layoutTotals,
 *   layoutFrontView, layoutFrontViewSummary, layoutAssignmentRows
 * ===================================================================== */

'use strict';

const LAYOUT_VERSION = 1;

/* Accent colours used to tell the SSC chains apart on the general diagram. */
const SSC_PALETTE = [
  '#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#0891b2', '#4d7c0f', '#9333ea',
];

function layoutNum(v, d) {
  const n = parseFloat(v);
  if (Number.isFinite(n)) return n;
  return d === undefined ? 0 : d;
}

/* ---------------------------------------------------------------------
 * Rack of the project — the layout planner works on the same rack model
 * the numbering tab paints (or that came in with the imported drawing).
 * ------------------------------------------------------------------- */
function layoutRackOf(project) {
  const cfg = (project && project.config) || {};
  const rules = Object.assign({}, DEFAULT_RULES, cfg.rules || {});
  const num = cfg.numbering || null;
  return rackEnsure(num && num.rack ? num.rack : defaultRack(rules.modulesPerString));
}

function layoutCapacity(project) {
  const rules = Object.assign({}, DEFAULT_RULES, ((project && project.config) || {}).rules || {});
  return Math.max(1, Math.round(layoutNum(rules.modulesPerString, 24)));
}

/* ---------------------------------------------------------------------
 * Normalisation — fills in what the saved layout leaves out.
 * ------------------------------------------------------------------- */
function layoutEnsure(project) {
  const cfg = (project && project.config) || {};
  const raw = cfg.layout && typeof cfg.layout === 'object' ? cfg.layout : {};
  const rack = layoutRackOf(project);
  const cap = layoutCapacity(project);
  const deviceSlots = rackDeviceCells(rack, 'ssc');

  let sscs = Array.isArray(raw.sscs) && raw.sscs.length ? raw.sscs : null;
  if (!sscs) {
    /* Variable factor #1: how many SSCs there are is whatever the rack
       layout carries — one chain per SSC device slot on the rack. */
    const slots = deviceSlots.length ? deviceSlots : ['0,' + (rack.rows - 1)];
    sscs = slots.map((slot, i) => ({
      id: 'SSC-' + (i + 1), label: 'SSC-' + (i + 1), slot: slot,
      jb: 'JB-' + (i + 1), capacity: cap, order: [],
    }));
  }
  sscs = sscs.map((s, i) => ({
    id: String(s.id || ('SSC-' + (i + 1))),
    label: String(s.label || s.id || ('SSC-' + (i + 1))),
    slot: s.slot || deviceSlots[i] || deviceSlots[0] || ('0,' + (rack.rows - 1)),
    jb: String(s.jb || ('JB-' + (i + 1))),
    capacity: Math.max(1, Math.round(layoutNum(s.capacity, cap))),
    order: Array.isArray(s.order) ? s.order.slice() : [],
  }));

  const modules = rackModuleCells(rack);
  const assignment = {};
  const rawA = raw.assignment && typeof raw.assignment === 'object' ? raw.assignment : null;
  for (const id of modules) {
    let v = rawA ? rawA[id] : null;
    if (!v || !sscs.some((s) => s.id === v)) {
      const gi = sscs.findIndex((s) => s.order.indexOf(id) >= 0);
      v = gi >= 0 ? sscs[gi].id : null;
    }
    if (v) assignment[id] = v;
  }
  /* Variable factor #2: which modules belong to which SSC. When nothing is
     saved the modules are shared out over the SSCs by cable distance. */
  if (Object.keys(assignment).length !== modules.length) {
    Object.assign(assignment, layoutAssignNearest(rack, sscs, modules, assignment));
  }
  return {
    version: LAYOUT_VERSION,
    mode: raw.mode === 'manual' ? 'manual' : 'auto',
    sscs: sscs, assignment: assignment, rack: rack,
  };
}

/* ---------------------------------------------------------------------
 * Assignment — cable-length driven sharing of the modules over the SSCs.
 * ------------------------------------------------------------------- */

/** Capacity-constrained nearest-SSC assignment.
 *  @param {Object} rack Rack model.
 *  @param {Array} sscs Normalised SSC records.
 *  @param {Array<string>} modules Module slot keys.
 *  @param {Object} [keep] Existing assignments to preserve.
 *  @return {Object} slot -> ssc id. */
function layoutAssignNearest(rack, sscs, modules, keep) {
  const out = Object.assign({}, keep || {});
  const free = new Map();
  sscs.forEach((s) => free.set(s.id, s.capacity));
  for (const id of Object.keys(out)) {
    if (free.has(out[id])) free.set(out[id], free.get(out[id]) - 1);
  }
  const open = modules.filter((id) => !out[id]);
  const pairs = [];
  for (const id of open) {
    for (const s of sscs) {
      const d = rackDist(rackPoint(rack, id, 'power'), rackPoint(rack, s.slot, 'power'));
      pairs.push({ id: id, ssc: s.id, d: d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const p of pairs) {
    if (out[p.id] || (free.get(p.ssc) || 0) <= 0) continue;
    out[p.id] = p.ssc;
    free.set(p.ssc, free.get(p.ssc) - 1);
  }
  /* Anything the capacities could not take goes to the SSC with the most
     room left — layoutValidate flags the overflow, never silently drops it. */
  for (const id of open) {
    if (out[id]) continue;
    let best = sscs[0].id, bv = -Infinity;
    sscs.forEach((s) => { const f = free.get(s.id) || 0; if (f > bv) { bv = f; best = s.id; } });
    out[id] = best;
    free.set(best, (free.get(best) || 0) - 1);
  }
  return out;
}

/** Band assignment: SSC k owns a contiguous band of columns (or rows).
 *  @param {Object} rack Rack model.
 *  @param {Array} sscs Normalised SSC records.
 *  @param {Array<string>} modules Module slot keys.
 *  @param {string} how 'column' | 'row'.
 *  @return {Object} slot -> ssc id. */
function layoutAssignBands(rack, sscs, modules, how) {
  const n = Math.max(1, sscs.length);
  const out = {};
  for (const id of modules) {
    const cell = slotCell(id);
    if (!cell) continue;
    const t = how === 'row'
      ? cell.r / Math.max(1, rack.rows)
      : cell.c / Math.max(1, rack.cols);
    out[id] = sscs[Math.min(n - 1, Math.floor(t * n))].id;
  }
  return out;
}

/** Assign modules to SSCs. `how`: 'nearest' | 'column' | 'row'.
 *  @param {Object} project Project record.
 *  @param {string} how Strategy.
 *  @return {Object} slot -> ssc id. */
function layoutAssign(project, how) {
  const lay = layoutEnsure(project);
  const modules = rackModuleCells(lay.rack);
  if (how === 'column' || how === 'row') return layoutAssignBands(lay.rack, lay.sscs, modules, how);
  return layoutAssignNearest(lay.rack, lay.sscs, modules, null);
}

/* ---------------------------------------------------------------------
 * Per-SSC chain ordering — the shortest cable the catalogue can build.
 * ------------------------------------------------------------------- */

/** Nearest-neighbour tour over a SUBSET of the rack, refined with 2-opt.
 *  @param {Object} rack Rack model.
 *  @param {Array<string>} slots Module slots of this SSC only.
 *  @param {Object} seed {anchor: slotKey} or {point:{x,y}}.
 *  @return {Array<string>} Ordered slots. */
function layoutTsp(rack, slots, seed) {
  const pool = (slots || []).slice();
  if (pool.length < 3) return pool.slice();
  const s = seed || {};
  const d0 = (id) => {
    if (s.anchor) return rackHopCost(rack, s.anchor, id);
    if (s.point) return rackDist(rackPoint(rack, id, 'power'), s.point);
    return 0;
  };
  let start = 0, bd = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const d = d0(pool[i]);
    if (d < bd) { bd = d; start = i; }
  }
  const order = [pool.splice(start, 1)[0]];
  while (pool.length) {
    let bi = 0, bv = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = rackHopCost(rack, order[order.length - 1], pool[i]);
      if (d < bv) { bv = d; bi = i; }
    }
    order.push(pool.splice(bi, 1)[0]);
  }
  return twoOptOrder(rack, order, s.anchor || null);
}

/** Scores one SSC chain with the approved harness catalogue.
 *  Same arithmetic as numberMetrics, but for one open chain that starts
 *  and ends at its own SSC.
 *  @param {Object} rack Rack model.
 *  @param {Object} rules Engine rules.
 *  @param {string} sscSlot Slot key of the SSC (anchor).
 *  @param {Array<string>} order Ordered module slots.
 *  @return {Object} Metrics record. */
function groupMetrics(rack, rules, sscSlot, order) {
  const r = Object.assign({}, DEFAULT_RULES, rules || {});
  const cat = harnessCatalogue(r);
  const ids = (order || []).filter((id) => rackIsModule(rack, id));
  const capP = cat.reduce((m, h) => (h.network === 'power' ? Math.max(m, h.length) : m), 0);
  const capC = cat.reduce((m, h) => (h.network === 'comm' ? Math.max(m, h.length) : m), 0);
  let bomMm = 0, geomMm = 0, longHops = 0, shortMm = 0, maxHopMm = 0, overflow = 0;

  if (sscSlot && ids.length) {
    const first = ids[0], last = ids[ids.length - 1];
    const spans = [
      rackSpan(rack, sscSlot, first, 'power'), rackSpan(rack, sscSlot, last, 'power'),
      rackSpan(rack, sscSlot, first, 'comm'), rackSpan(rack, sscSlot, last, 'comm'),
    ];
    geomMm += spans.reduce((a, b) => a + b, 0);
    bomMm += 2 * (+r.m2sPowerLen || 0) + 2 * (+r.m2sCommLen || 0);
    if (Math.max.apply(null, spans) > Math.max(+r.m2sPowerLen || 0, +r.m2sCommLen || 0)) overflow++;
  }
  for (let k = 0; k + 1 < ids.length; k++) {
    const a = ids[k], b = ids[k + 1];
    const kind = numberingHopKind(rack, a, b);
    const routedP = applyDeduction(kind === 'adjacent' ? r.powerJumper : r.longPower, 'power', r);
    const routedC = applyDeduction(kind === 'adjacent' ? r.commJumper : r.longComm, 'comm', r);
    const hp = pickHarness(cat, 'power', routedP, r);
    const hc = pickHarness(cat, 'comm', routedC, r);
    const lenP = hp ? hp.length : routedP, lenC = hc ? hc.length : routedC;
    bomMm += lenP + lenC;
    if (kind === 'adjacent') shortMm += lenP + lenC; else longHops++;
    if (!hp || !hc) overflow++;
    const sp = rackSpan(rack, a, b, 'power'), sc = rackSpan(rack, a, b, 'comm');
    geomMm += sp + sc;
    maxHopMm = Math.max(maxHopMm, sp, sc);
    if (sp > capP || sc > capC) overflow++;
  }
  return {
    moduleCount: ids.length,
    hops: Math.max(0, ids.length - 1),
    longHops: longHops,
    shortMm: Math.round(shortMm),
    bomMm: Math.round(bomMm),
    geomMm: Math.round(geomMm),
    maxHopMm: Math.round(maxHopMm),
    overflow: overflow,
  };
}

function groupPlanCompare(a, b) {
  if (a.metrics.overflow !== b.metrics.overflow) return a.metrics.overflow - b.metrics.overflow;
  if (a.metrics.bomMm !== b.metrics.bomMm) return a.metrics.bomMm - b.metrics.bomMm;
  if (a.metrics.longHops !== b.metrics.longHops) return a.metrics.longHops - b.metrics.longHops;
  return a.metrics.geomMm - b.metrics.geomMm;
}

/** Best chain for one SSC across the traversal patterns + optimised tours.
 *  @param {Object} rack Rack model.
 *  @param {Object} rules Engine rules.
 *  @param {string} sscSlot Slot key of the SSC.
 *  @param {Array<string>} slots Module slots owned by this SSC.
 *  @return {Object} {order, metrics, planId, planTitle, candidates}. */
function layoutGroupOrder(rack, rules, sscSlot, slots) {
  const set = new Set(slots || []);
  const only = (o) => o.filter((id) => set.has(id));
  const cands = [];
  const seen = new Set();
  const add = (planId, planTitle, order) => {
    if (!order || order.length < 1) return;
    const sig = order.join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    cands.push({ planId: planId, planTitle: planTitle, order: order.slice(), metrics: groupMetrics(rack, rules, sscSlot, order) });
  };

  const corners = [['top-left', 1, 1], ['bottom-left', 1, -1], ['top-right', -1, 1], ['bottom-right', -1, -1]];
  for (const major of ['col', 'row']) {
    for (const c of corners) {
      for (const serp of [true, false]) {
        add(
          `${serp ? 'serpentine' : 'raster'}-${major}-${c[0]}`,
          `${serp ? 'Serpentine' : 'Raster'} · ${major === 'col' ? 'column' : 'row'} by ${major === 'col' ? 'column' : 'row'} · start ${c[0]}`,
          only(rackTraverse(rack, { major: major, colDir: c[1], rowDir: c[2], serpentine: serp })));
      }
    }
  }
  const seeds = [];
  if (sscSlot) seeds.push({ id: 'ssc', anchor: sscSlot, title: 'Shortest path · optimised from this SSC' });
  for (const c of corners) {
    seeds.push({
      id: 'corner-' + c[0], point: {
        x: c[1] > 0 ? 0 : (rack.cols - 1) * rack.pitchX,
        y: c[2] > 0 ? 0 : (rack.rows - 1) * rack.pitchY,
      }, title: 'Shortest path · start ' + c[0],
    });
  }
  for (const s of seeds) {
    add('tsp-' + s.id, s.title, layoutTsp(rack, slots || [], s));
  }
  cands.sort(groupPlanCompare);
  return cands.length ? cands[0] : { order: (slots || []).slice(), metrics: groupMetrics(rack, rules, sscSlot, slots || []), planId: 'reading', planTitle: 'Reading order', candidates: cands };
}

/* ---------------------------------------------------------------------
 * Groups — one record per SSC with its modules and its chain.
 * ------------------------------------------------------------------- */

/** @param {Object} project Project record.
 *  @param {Object} [opt] {recompute:true} forces a fresh optimisation.
 *  @return {Array<Object>} Groups: {id,label,slot,jb,capacity,modules,order,mode,metrics,planId,planTitle}. */
function layoutGroups(project, opt) {
  const o = opt || {};
  const lay = layoutEnsure(project);
  const rules = Object.assign({}, DEFAULT_RULES, ((project && project.config) || {}).rules || {});
  const cap = layoutCapacity(project);
  const rack = lay.rack;
  const used = new Set();
  const groups = [];

  for (const s of lay.sscs) {
    const slots = rackModuleCells(rack).filter((id) => lay.assignment[id] === s.id);
    let order = (s.order || []).filter((id) => slots.indexOf(id) >= 0 && !used.has(id));
    let mode = 'auto', planId = null, planTitle = null;
    if (lay.mode === 'manual' && order.length === slots.length && slots.length) {
      mode = 'manual';
    } else {
      const best = layoutGroupOrder(rack, rules, s.slot, slots);
      order = best.order; planId = best.planId; planTitle = best.planTitle;
    }
    for (const id of order) used.add(id);
    /* safety net: nothing a module can do to fall out of every chain */
    for (const id of slots) {
      if (!used.has(id)) { used.add(id); order.push(id); }
    }
    groups.push({
      id: s.id, label: s.label, slot: s.slot, jb: s.jb,
      capacity: Math.max(1, Math.min(cap, Math.round(layoutNum(s.capacity, cap)))),
      modules: slots, order: order, mode: mode,
      planId: planId, planTitle: planTitle,
      metrics: groupMetrics(rack, rules, s.slot, order),
    });
  }
  return groups;
}

/** Per-SSC rows for the assignment table.
 *  @param {Object} project Project record.
 *  @return {Array<Object>} {group, color, moduleCount, capacity, metrics}. */
function layoutAssignmentRows(project) {
  const groups = layoutGroups(project);
  return groups.map((g, i) => ({
    group: g, color: SSC_PALETTE[i % SSC_PALETTE.length],
    moduleCount: g.modules.length, capacity: g.capacity, metrics: g.metrics,
  }));
}

/** Sum of the per-SSC metrics.
 *  @param {Array<Object>} groups Groups from layoutGroups.
 *  @return {Object} {sscs, modules, bomMm, geomMm, longHops, hops, overflow, maxHopMm}. */
function layoutTotals(groups) {
  const t = { sscs: 0, modules: 0, bomMm: 0, geomMm: 0, longHops: 0, hops: 0, overflow: 0, maxHopMm: 0 };
  for (const g of groups || []) {
    t.sscs++;
    t.modules += g.metrics.moduleCount;
    t.bomMm += g.metrics.bomMm;
    t.geomMm += g.metrics.geomMm;
    t.longHops += g.metrics.longHops;
    t.hops += g.metrics.hops;
    t.overflow += g.metrics.overflow;
    t.maxHopMm = Math.max(t.maxHopMm, g.metrics.maxHopMm);
  }
  return t;
}

/* ---------------------------------------------------------------------
 * Validation — the variable factors can never pass silently.
 * ------------------------------------------------------------------- */
const LAYOUT_VALIDATION_SPEC = [
  { id: 'L01', label: 'Every battery module belongs to exactly one SSC chain' },
  { id: 'L02', label: 'No SSC controls more modules than the approved string length' },
  { id: 'L03', label: 'Every SSC has a junction box with both bus polarities' },
  { id: 'L04', label: 'Every SSC chain closes on at least two modules' },
  { id: 'L05', label: 'Every hop in every chain is buildable from the approved harness catalogue' },
  { id: 'L06', label: 'The rack layout carries the SSC, ACDP and MSM devices' },
];

function layoutValidationLabel(id) {
  for (const v of LAYOUT_VALIDATION_SPEC) if (v.id === id) return v.label;
  return id;
}

/** @param {Object} project Project record.
 *  @return {Array<Object>} Rows {id,label,status,detail}. */
function layoutValidate(project) {
  const lay = layoutEnsure(project);
  const groups = layoutGroups(project);
  const rack = lay.rack;
  const cap = layoutCapacity(project);
  const all = rackModuleCells(rack);
  const seen = new Map();
  groups.forEach((g) => g.order.forEach((id) => seen.set(id, (seen.get(id) || 0) + 1)));
  const orphans = all.filter((id) => !seen.has(id));
  const dupes = [...seen.entries()].filter((e) => e[1] > 1).map((e) => e[0]);
  const over = groups.filter((g) => g.modules.length > Math.min(cap, g.capacity));
  const tiny = groups.filter((g) => g.modules.length < 2);
  const overflow = groups.filter((g) => g.metrics.overflow > 0);
  const acdp = rackDeviceCells(rack, 'acdp').length;
  const msm = rackDeviceCells(rack, 'msm').length;
  const sscN = rackDeviceCells(rack, 'ssc').length;
  const noJb = groups.filter((g) => !g.jb);

  const rows = [];
  const add = (id, ok, detail) => rows.push({ id: id, label: layoutValidationLabel(id), status: ok ? 'pass' : 'fail', detail: detail });
  add('L01', orphans.length === 0 && dupes.length === 0,
    orphans.length ? `${orphans.length} module(s) in no chain: ${orphans.slice(0, 4).join(', ')}` :
    dupes.length ? `${dupes.length} module(s) in two chains: ${dupes.slice(0, 4).join(', ')}` :
    `${all.length} modules over ${groups.length} SSC chain(s), no overlap`);
  add('L02', over.length === 0,
    over.length ? over.map((g) => `${g.label} holds ${g.modules.length} > ${Math.min(cap, g.capacity)}`).join('; ')
      : `largest chain ${groups.reduce((m, g) => Math.max(m, g.modules.length), 0)} of ${cap} approved`);
  add('L03', !!(groups.length && noJb.length === 0),
    noJb.length ? `${noJb.map((g) => g.label).join(', ')} has no junction box for the BUS+/BUS− pair` : `BUS+/BUS− pair scheduled per SSC (${groups.length} pairs)`);
  add('L04', tiny.length === 0,
    tiny.length ? `${tiny.map((g) => g.label).join(', ')} has fewer than 2 modules` : 'all chains closed');
  add('L05', overflow.length === 0,
    overflow.length ? `${overflow.map((g) => g.label).join(', ')}: ${overflow.reduce((m, g) => m + g.metrics.overflow, 0)} hop(s) need an engineering release` : 'every hop covered by released harnesses');
  add('L06', !!(sscN > 0 && acdp > 0 && msm > 0),
    `SSC ×${sscN}, ACDP ×${acdp}, MSM ×${msm}` + (sscN === 0 || acdp === 0 || msm === 0 ? ' — paint the missing devices on the rack' : ''));
  return rows;
}

/* ---------------------------------------------------------------------
 * Write-back — the chains become the engine's strings.
 * ------------------------------------------------------------------- */

/** Applies the variable layout to the project:
 *  rules.strings = number of SSCs, numbering.order = the chains end to end,
 *  numbering.counts = modules per chain (drives the variable netlist).
 *  @param {Object} project Project record (mutated).
 *  @param {Array<Object>} [groups] Pre-computed groups (default recomputed).
 *  @return {Object} The updated config object. */
function layoutApply(project, groups) {
  const cfg = project.config || (project.config = {});
  const lay = layoutEnsure(project);
  const g = Array.isArray(groups) && groups.length ? groups : layoutGroups(project);
  const rules = Object.assign({}, DEFAULT_RULES, cfg.rules || {});
  rules.strings = Math.max(1, g.length);
  rules.modulesPerString = Math.max.apply(null, g.map((x) => Math.max(1, x.modules.length)).concat([2]));
  const order = [];
  const counts = [];
  for (const x of g) { order.push.apply(order, x.order); counts.push(x.order.length); }
  cfg.rules = rules;
  cfg.layout = {
    version: LAYOUT_VERSION,
    mode: lay.mode,
    sscs: g.map((x) => ({ id: x.id, label: x.label, slot: x.slot, jb: x.jb, capacity: x.capacity, order: x.order.slice() })),
    assignment: Object.assign({}, lay.assignment),
  };
  cfg.numbering = Object.assign({}, cfg.numbering || {}, {
    mode: 'layout',
    planId: 'ssc-layout',
    planTitle: g.map((x) => x.label + ' ×' + x.order.length).join(' · '),
    rack: lay.rack,
    order: order,
    counts: counts,
    savedAt: new Date().toISOString(),
  });
  project.modules_per_string = rules.modulesPerString;
  return cfg;
}

/* ---------------------------------------------------------------------
 * Front view — every chain drawn on the real rack picture.
 * ------------------------------------------------------------------- */

/** Draws all SSC chains over the calibrated rack picture. Each chain keeps
 *  the house colours (red power / green communication) but gets its own
 *  riser rail and its own accent on the M labels.
 *  @param {Array<Object>} groups Groups from layoutGroups.
 *  @param {Object} cal Calibration from fvCalib.
 *  @param {Object} [opts] {showWiring, sscLabels}.
 *  @return {Array<Object>} Segments (fvWiring records + group fields). */
function layoutFrontView(groups, cal, opts) {
  const o = opts || {};
  if (!o.showWiring) return [];
  const out = [];
  (groups || []).forEach((g, gi) => {
    if (!g.order.length) return;
    const segs = fvWiring(g.order, cal, {
      sscSlot: g.slot,           /* this chain anchors at ITS OWN SSC */
      railOffset: gi,            /* separate riser rails per chain */
      group: gi,
      groupLabel: g.label,
      groupColor: SSC_PALETTE[gi % SSC_PALETTE.length],
    });
    for (const s of segs) out.push(s);
  });
  return out;
}

/** Splits a front-view summary per SSC.
 *  @param {Array<Object>} segs Segments from layoutFrontView.
 *  @param {Array<Object>} groups The groups (for labels/colours).
 *  @return {Array<Object>} {label,color,powerMm,commMm,maxHopMm,modules}. */
function layoutFrontViewSummary(segs, groups) {
  return (groups || []).map((g, gi) => {
    const mine = (segs || []).filter((s) => s.group === gi);
    const s = typeof fvSummary === 'function' ? fvSummary(mine) : { powerMm: 0, commMm: 0, maxHopMm: 0 };
    return {
      label: g.label, color: SSC_PALETTE[gi % SSC_PALETTE.length],
      powerMm: s.powerMm, commMm: s.commMm, maxHopMm: s.maxHopMm,
      modules: g.order.length,
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  try { module.exports = { layoutEnsure, layoutAssign, layoutGroups, layoutGroupOrder, layoutTsp, groupMetrics, layoutValidate, layoutApply, layoutTotals, layoutFrontView, layoutFrontViewSummary, layoutAssignmentRows }; } catch (e) { /* browser */ }
}
