/* ============================================================
 * WireFlow — automatic rack wiring on a recognised DXF drawing
 * ------------------------------------------------------------
 * AYK rules (confirmed 18 Nov 2026):
 *   - one SSC = one string = one junction box (top of its column) +
 *     the modules the engineer enters for it;
 *   - power, series:  SSC S- -> M1 -,  Mk + -> Mk+1 -,  last + -> SSC S+;
 *   - communication:  SSC N -> M1 S,   Mk N -> Mk+1 S,  last N -> SSC S;
 *   - bus:            SSC B+ -> JB +,  SSC B- -> JB -  (pair P1 or P2,
 *                     chosen once by the engineer, same on every JB);
 *   - power cables never cross each other anywhere in the rack; power and
 *     communication may cross.
 * Drawing style (AYK marked-up rack): short jumps between neighbouring
 * modules, long cables run along the riser channel beside the SSC column,
 * modules labelled S<ssc>-M<k>, a group outline around each SSC's modules.
 *
 * Coordinates are drawing millimetres, Y up (as in the DXF).
 * Pure functions, no DOM. Loaded after cad.js.
 * ============================================================ */

const CADW_LANE = 10;      // spacing between cables in a riser, mm
const CADW_STUB = 22;      // first stub out of a terminal, mm
const CADW_STUB_STEP = 9;  // extra stub per lane, so horizontals never overlap

function cadwTerm(c, role) { return (c.terminals || []).find(t => t.role === role) || null; }
function cadwLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
function cadwClean(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    out.push([p[0], p[1]]);
  }
  /* drop middle points of straight runs */
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6) out.splice(i, 1);
  }
  return out;
}

/* ---------- crossing test ---------- */
function cadwSegCross(p, q, r, s) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(r, s, p), d2 = o(r, s, q), d3 = o(p, q, r), d4 = o(p, q, s);
  const e = 1e-6;
  if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return true;
  /* collinear overlap of two parallel runs also counts: two cables on top of each other */
  if (Math.abs(d1) <= e && Math.abs(d2) <= e) {
    const ax = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? 0 : 1;
    const lo1 = Math.min(p[ax], q[ax]), hi1 = Math.max(p[ax], q[ax]);
    const lo2 = Math.min(r[ax], s[ax]), hi2 = Math.max(r[ax], s[ax]);
    return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 1;
  }
  return false;
}
function cadwBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
/** Number of crossings between two polylines. */
function cadwCrossings(a, b) {
  const A = a.box || (a.box = cadwBox(a.pts)), B = b.box || (b.box = cadwBox(b.pts));
  if (A[2] < B[0] - 1 || B[2] < A[0] - 1 || A[3] < B[1] - 1 || B[3] < A[1] - 1) return 0;
  let n = 0;
  for (let i = 1; i < a.pts.length; i++)
    for (let j = 1; j < b.pts.length; j++)
      if (cadwSegCross(a.pts[i - 1], a.pts[i], b.pts[j - 1], b.pts[j])) n++;
  return n;
}
/** Every pair of crossing power cables in a list of cables. */
function cadwPowerCrossings(cables) {
  const p = cables.filter(c => c.kind === 'power');
  const out = [];
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      const n = cadwCrossings(p[i], p[j]);
      if (n) out.push({ a: p[i].id, b: p[j].id, n: n });
    }
  return out;
}

/* ---------- rack columns ---------- */
/** Groups modules (and SSCs / JBs) into rack columns by their centre x. */
function cadwColumns(comps) {
  const mods = comps.filter(c => c.kind === 'module');
  if (!mods.length) return [];
  const widths = mods.map(c => c.x1 - c.x0).sort((a, b) => a - b);
  const tol = widths[widths.length >> 1] * 0.35;
  const cols = [];
  for (const c of comps.filter(c => c.kind === 'module' || c.kind === 'ssc' || c.kind === 'jb')
    .sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1))) {
    const cx = (c.x0 + c.x1) / 2;
    let col = cols.find(k => Math.abs(k.cx - cx) <= tol);
    if (!col) { col = { cx: cx, items: [] }; cols.push(col); }
    col.items.push(c);
  }
  cols.sort((a, b) => a.cx - b.cx);
  cols.forEach((k, i) => {
    k.index = i;
    /* column edges from modules and SSCs (junction boxes overhang the column) */
    const body = k.items.filter(c => c.kind !== 'jb');
    const edge = body.length ? body : k.items;
    k.x0 = Math.min(...edge.map(c => c.x0));
    k.x1 = Math.max(...edge.map(c => c.x1));
    k.modules = k.items.filter(c => c.kind === 'module').sort((a, b) => b.y0 - a.y0); // top first
    k.sscs = k.items.filter(c => c.kind === 'ssc');
    k.jbs = k.items.filter(c => c.kind === 'jb');
    for (const c of k.items) c._col = i;
  });
  /* riser channel = middle of the gap to the neighbouring column */
  cols.forEach((k, i) => {
    const l = cols[i - 1], r = cols[i + 1];
    k.riserL = l ? (l.x1 + k.x0) / 2 : k.x0 - 45;
    k.riserR = r ? (k.x1 + r.x0) / 2 : k.x1 + 45;
    k.gapL = l ? k.x0 - l.x1 : 90;
    k.gapR = r ? r.x0 - k.x1 : 90;
  });
  return cols;
}

/* ---------- routes ---------- */
/** Riser route: out of a, along the riser at lane x, into b. stubA/stubB are signed y offsets. */
function cadwRiserRoute(a, b, laneX, stubA, stubB) {
  return cadwClean([[a.x, a.y], [a.x, a.y + stubA], [laneX, a.y + stubA], [laneX, b.y + stubB], [b.x, b.y + stubB], [b.x, b.y]]);
}
/** Direct route inside one column: down/up from a, across, into b. */
function cadwDirectRoute(a, b, midY) {
  return cadwClean([[a.x, a.y], [a.x, midY], [b.x, midY], [b.x, b.y]]);
}

/** Jump between consecutive modules in the string (power + -> -, or comm N -> S). */
function cadwJump(m1, m2, t1, t2, cols) {
  const sameCol = m1._col === m2._col;
  if (sameCol) return [[[t1.x, t1.y], [t2.x, t2.y]]];
  /* across columns: round the modules (above or below) when they sit side by side ... */
  const below = Math.min(m1.y0, m2.y0) - 14, above = Math.max(m1.y1, m2.y1) + 14;
  const out = [above, below].map(y => cadwClean([[t1.x, t1.y], [t1.x, y], [t2.x, y], [t2.x, t2.y]]));
  /* ... or through the riser channel between the two columns (outer lanes) */
  if (cols && Math.abs(m1._col - m2._col) === 1) {
    const l = cols[Math.min(m1._col, m2._col)], r = cols[Math.max(m1._col, m2._col)];
    const gx = (l.x1 + r.x0) / 2, step = Math.min(CADW_LANE, Math.max(4, (r.x0 - l.x1 - 12) / 9));
    for (const slot of [-4, 4, -3, 3]) for (const s1 of [-CADW_STUB, CADW_STUB]) for (const s2 of [-CADW_STUB, CADW_STUB])
      out.push(cadwRiserRoute(t1, t2, gx + slot * step, s1, s2));
  }
  return out;
}

/* ---------- planning ---------- */
/**
 * Plans the wiring of the whole rack.
 * @param {Array<Object>} comps Recognised components {id, kind, x0,y0,x1,y1, terminals:[{role,x,y}]}.
 * @param {Array<Object>} sscs  [{comp, name, count}] — confirmed SSCs with module counts.
 * @param {Object} opts {pair: 'P1'|'P2'}.
 * @return {Object} {ok, errors, warnings, strings:[...], cables:[...], crossings:[...], outline:[...]}
 */
function cadWirePlan(comps, sscs, opts) {
  opts = opts || {};
  const pair = opts.pair === 'P2' ? 'P2' : 'P1';
  const errors = [], warnings = [];
  const modules = comps.filter(c => c.kind === 'module');
  const need = { module: ['comm-S', 'comm-N', 'power-', 'power+'], ssc: ['S', 'N', 'S+', 'B+', 'B-', 'S-'], jb: [pair + '+', pair + '-'] };
  if (!modules.length) errors.push('No battery modules recognised.');
  if (!sscs.length) errors.push('No confirmed SSCs.');
  const total = sscs.reduce((s, x) => s + (x.count || 0), 0);
  if (sscs.some(x => !(x.count >= 1))) errors.push('Every SSC needs its number of modules.');
  else if (total !== modules.length) errors.push(`The SSC module counts add up to ${total}, but ${modules.length} modules are on the drawing.`);
  if (modules.some(m => need.module.some(r => !cadwTerm(m, r)))) errors.push('Module terminals are missing: teach the battery module with its four terminals.');
  if (sscs.some(s => need.ssc.some(r => !cadwTerm(s.comp, r)))) errors.push('SSC terminals are missing: teach the SSC and click its six connectors (S, N, S+, B+, B−, S−).');
  const cols = cadwColumns(comps);
  const jbFor = new Map();
  for (const s of sscs) {
    const col = cols[s.comp._col];
    const jb = col && col.jbs.filter(j => j.y0 >= s.comp.y1 - 1).sort((a, b) => a.y0 - b.y0)[0];
    if (!jb) errors.push(`${s.name}: no junction box found at the top of its column.`);
    else if (need.jb.some(r => !cadwTerm(jb, r))) errors.push(`${s.name}: the junction box has no ${pair} terminals. Teach the junction box and click its four connectors (+, −, +, −).`);
    else jbFor.set(s, jb);
  }
  if (errors.length) return { ok: false, errors: errors, warnings: warnings, strings: [], cables: [], crossings: [], outline: [] };

  let best = null;
  const seen = new Set();
  for (const lr of [1, -1]) for (const td of [1, -1]) {
    /* traversals that give the same groups of modules are planned once */
    const groups = cadwGroups(cols, sscs, lr, td);
    if (!groups || seen.has(groups)) continue;
    seen.add(groups);
    const plan = cadwTryVariant(cols, sscs, jbFor, pair, lr, td);
    if (!plan) continue;
    if (!best || plan.score < best.score) best = plan;
  }
  if (!best) {
    return { ok: false, errors: ['Could not split the modules into one connected group per SSC with these counts. Check the module count of each SSC.'], warnings: warnings, strings: [], cables: [], crossings: [], outline: [] };
  }
  const crossings = cadwPowerCrossings(best.cables);
  if (crossings.length) warnings.push(`${crossings.length} power cable crossing${crossings.length === 1 ? '' : 's'} could not be avoided: check the highlighted cables.`);
  for (const st of best.strings) if (st.far) warnings.push(`${st.name} is not next to its modules; its long cables may be impractical.`);
  return { ok: true, errors: [], warnings: warnings, pair: pair, strings: best.strings, cables: best.cables, crossings: crossings,
    outline: best.strings.map(st => ({ ssc: st.name, segs: cadwOutline(st.modules.concat([st.ssc])) })) };
}

/** Key of the module groups a traversal gives (null when the counts do not fit). */
function cadwGroups(cols, sscs, lr, td) {
  const colOrder = lr > 0 ? cols.slice() : cols.slice().reverse();
  const seq = [];
  for (const k of colOrder) for (const m of (td > 0 ? k.modules : k.modules.slice().reverse())) seq.push(m);
  const sOrder = sscs.slice().sort((a, b) => lr * (a.comp._col - b.comp._col) || td * (b.comp.y0 - a.comp.y0));
  let at = 0;
  const parts = [];
  for (const s of sOrder) {
    const mods = seq.slice(at, at + s.count); at += s.count;
    if (mods.length !== s.count) return null;
    parts.push(s.name + ':' + mods.map(m => m.id).sort().join(','));
  }
  return parts.sort().join('|');
}

/** One global traversal: columns left->right (lr=1) or right->left, modules top->bottom (td=1) or bottom->top. */
function cadwTryVariant(cols, sscs, jbFor, pair, lr, td) {
  const colOrder = lr > 0 ? cols.slice() : cols.slice().reverse();
  const seq = [];
  for (const k of colOrder) for (const m of (td > 0 ? k.modules : k.modules.slice().reverse())) seq.push(m);
  const sOrder = sscs.slice().sort((a, b) => lr * (a.comp._col - b.comp._col) || td * (b.comp.y0 - a.comp.y0));
  const strings = [];
  let at = 0;
  for (const s of sOrder) {
    const mods = seq.slice(at, at + s.count);
    at += s.count;
    if (mods.length !== s.count) return null;
    const colsUsed = Array.from(new Set(mods.map(m => m._col)));
    const dist = Math.min(...colsUsed.map(c => Math.abs(c - s.comp._col)));
    strings.push({ s: s, mods: mods, far: dist > 1 });
  }
  const placed = [];
  const gapUse = new Map();
  const out = [];
  let score = 0;
  for (const st of strings) {
    const r = cadwPlanString(st, cols, jbFor.get(st.s), pair, placed, gapUse);
    if (!r) return null;
    for (const c of r.cables) placed.push(c);
    out.push(r.string);
    score += r.score + (st.far ? 1e7 : 0);
  }
  return { score: score, strings: out, cables: placed };
}

/** Candidate module orders inside one string: columns in either order, each
    column run upwards or downwards (snake and same-direction runs). */
function cadwOrders(mods) {
  const byCol = new Map();
  for (const m of mods) { if (!byCol.has(m._col)) byCol.set(m._col, []); byCol.get(m._col).push(m); }
  const keys = Array.from(byCol.keys()).sort((a, b) => a - b);
  for (const k of keys) byCol.get(k).sort((a, b) => b.y0 - a.y0);
  const orders = [];
  const n = Math.min(keys.length, 5);
  for (const ks of keys.length > 1 ? [keys, keys.slice().reverse()] : [keys]) {
    for (let mask = 0; mask < (1 << n); mask++) {
      const o = [];
      ks.forEach((k, i) => {
        const down = i < n ? !!(mask & (1 << i)) : (i % 2 === 0);
        const list = byCol.get(k);
        for (const m of (down ? list : list.slice().reverse())) o.push(m);
      });
      orders.push(o);
    }
  }
  return orders;
}

function cadwPermutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => { for (const p of cadwPermutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([x].concat(p)); });
  return out;
}

/** Wires one SSC string; returns the cheapest layout found. */
function cadwPlanString(st, cols, jb, pair, placed, gapUse) {
  const ssc = st.s.comp;
  const col = cols[ssc._col];
  const num = (String(st.s.name).match(/\d+/) || [''])[0];
  const tag = 'S' + num;
  let best = null;
  for (const order of cadwOrders(st.mods)) {
    const label = new Map(order.map((m, i) => [m, `${tag}-M${i + 1}`]));
    /* jumps between neighbouring modules */
    const jumps = [];
    const prePlaced = placed.slice();
    for (let i = 0; i + 1 < order.length; i++) {
      const a = order[i], b = order[i + 1];
      for (const [kind, ra, rb] of [['power', 'power+', 'power-'], ['comm', 'comm-N', 'comm-S']]) {
        const opts = cadwJump(a, b, cadwTerm(a, ra), cadwTerm(b, rb), cols);
        let pick = null;
        for (const pts of opts) {
          const cab = { kind: kind, pts: pts };
          const x = kind === 'power' ? prePlaced.filter(c => c.kind === 'power').reduce((n, c) => n + cadwCrossings(cab, c), 0) : 0;
          const v = x * 1e6 + cadwLen(pts);
          if (!pick || v < pick.v) pick = { v: v, pts: pts };
        }
        const cab = { id: `${tag} ${label.get(a)}→${label.get(b)} ${kind}`, ssc: st.s.name, kind: kind,
          from: `${label.get(a)} ${ra === 'power+' ? '+' : 'N'}`, to: `${label.get(b)} ${rb === 'power-' ? '−' : 'S'}`, pts: pick.pts, opts: opts };
        jumps.push(cab); prePlaced.push(cab);
      }
    }
    /* second pass: a column-change jump re-picks its route now that the later jumps are known */
    for (const j of jumps) {
      if (j.opts.length < 2) continue;
      const others = prePlaced.filter(c => c !== j && c.kind === j.kind);
      let pick = null;
      for (const pts of j.opts) {
        const cab = { kind: j.kind, pts: pts };
        const v = others.reduce((n, c) => n + cadwCrossings(cab, c), 0) * 1e6 + cadwLen(pts);
        if (!pick || v < pick.v) pick = { v: v, pts: pts };
      }
      j.pts = pick.pts; j.box = null;
    }
    for (const j of jumps) delete j.opts;
    const first = order[0], last = order[order.length - 1];
    const longPower = [
      { key: 'S-', from: [ssc, 'S-'], to: [first, 'power-'], name: `${tag} S− → ${label.get(first)} −` },
      { key: 'S+', from: [ssc, 'S+'], to: [last, 'power+'], name: `${tag} ${label.get(last)} + → S+` },
      { key: 'B+', from: [ssc, 'B+'], to: [jb, pair + '+'], name: `${tag} B+ → JB ${pair}+` },
      { key: 'B-', from: [ssc, 'B-'], to: [jb, pair + '-'], name: `${tag} B− → JB ${pair}−` },
    ];
    const longComm = [
      { key: 'N', from: [ssc, 'N'], to: [first, 'comm-S'], name: `${tag} N → ${label.get(first)} S` },
      { key: 'S', from: [ssc, 'S'], to: [last, 'comm-N'], name: `${tag} ${label.get(last)} N → S` },
    ];
    const risers = [{ x: col.riserL, gap: col.gapL }, { x: col.riserR, gap: col.gapR }];
    const SLOTS = [0, -1, 1, -2, 2, -3, 3, -4, 4];
    const laneX = (r, slot) => r.x + slot * Math.min(CADW_LANE, Math.max(4, (r.gap - 12) / 9));
    for (const perm of cadwPermutations(longPower)) {
      const cables = [];
      let crossings = 0;
      /* lanes taken in each riser (by earlier strings too) */
      const lanesUsed = new Map(Array.from(gapUse, ([x, set]) => [x, new Set(set)]));
      let k = 0;                           // stub depth index at the SSC strip
      const place = (spec, kind) => {
        const a = cadwTerm(spec.from[0], spec.from[1]), b = cadwTerm(spec.to[0], spec.to[1]);
        const toJb = spec.to[0].kind === 'jb';
        /* SSC connectors may leave up (across the SSC face) or down; junction box
           connectors are entered from below; module connectors from above or below */
        const s0 = CADW_STUB + k * CADW_STUB_STEP;
        const far = [];
        for (let j = 0; j < 4; j++) {
          const s = CADW_STUB + j * CADW_STUB_STEP;
          far.push(-s); if (!toJb) far.push(s);
        }
        const cands = [];
        for (const r of risers) {
          const used = lanesUsed.get(r.x) || new Set();
          const free = SLOTS.filter(x => !used.has(x)).slice(0, 3);
          for (const slot of free) for (const stubA of [-s0, s0]) for (const stubB of far)
            cands.push({ pts: cadwRiserRoute(a, b, laneX(r, slot), stubA, stubB), riser: r.x, slot: slot });
        }
        if (!toJb && b.x >= ssc.x0 - 1 && b.x <= ssc.x1 + 1 && b.y < a.y) {
          /* module directly under the SSC: short direct cable */
          cands.push({ pts: cadwDirectRoute(a, b, a.y - s0), riser: null });
        }
        const pool = prePlaced.concat(cables).filter(z => z.kind === kind);
        let pick = null;
        for (const c of cands) {
          const cab = { kind: kind, pts: c.pts };
          const x = pool.reduce((n, z) => n + cadwCrossings(cab, z), 0);
          const v = x * 1e6 + cadwLen(c.pts);
          if (!pick || v < pick.v) pick = { v: v, x: x, c: c };
        }
        if (pick.c.riser !== null) { if (!lanesUsed.has(pick.c.riser)) lanesUsed.set(pick.c.riser, new Set()); lanesUsed.get(pick.c.riser).add(pick.c.slot); }
        k++;
        if (kind === 'power') crossings += pick.x;
        cables.push({ id: spec.name, ssc: st.s.name, kind: kind, from: spec.name.split(' → ')[0].replace(tag + ' ', ''), to: spec.name.split(' → ')[1], pts: pick.c.pts });
      };
      for (const spec of perm) place(spec, 'power');
      for (const spec of longComm) place(spec, 'comm');
      const all = jumps.concat(cables);
      const powerLen = all.filter(c => c.kind === 'power').reduce((s, c) => s + cadwLen(c.pts), 0);
      const totalLen = all.reduce((s, c) => s + cadwLen(c.pts), 0);
      const pool = placed.filter(c => c.kind === 'power');
      const jumpX = jumps.filter(c => c.kind === 'power').reduce((n, c) => n + pool.reduce((m, z) => m + cadwCrossings(c, z), 0), 0);
      const score = (crossings + jumpX) * 1e6 + powerLen + totalLen * 0.01;
      if (!best || score < best.score) best = { score: score, cables: all, order: order, label: label, lanes: lanesUsed };
    }
  }
  if (!best) return null;
  for (const [x, n] of best.lanes) gapUse.set(x, n);
  const string = {
    name: st.s.name, tag: tag, ssc: ssc, jb: jb, far: st.far,
    modules: best.order,
    labels: best.order.map((m, i) => ({ id: m.id, text: `${tag}-M${i + 1}`, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 + (m.y1 - m.y0) * 0.12 })),
  };
  return { score: best.score, string: string, cables: best.cables };
}

/* ---------- group outline (union of boxes, as line segments) ---------- */
function cadwOutline(boxes) {
  const PADX = 40, PADY = 8;
  const rects = boxes.map(b => [b.x0 - PADX, b.y0 - PADY, b.x1 + PADX, b.y1 + PADY]);
  const xs = Array.from(new Set(rects.flatMap(r => [r[0], r[2]]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(rects.flatMap(r => [r[1], r[3]]))).sort((a, b) => a - b);
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some(r => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  };
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    if (!inside(i, j)) continue;
    if (!inside(i, j - 1)) segs.push([[xs[i], ys[j]], [xs[i + 1], ys[j]]]);
    if (!inside(i, j + 1)) segs.push([[xs[i], ys[j + 1]], [xs[i + 1], ys[j + 1]]]);
    if (!inside(i - 1, j)) segs.push([[xs[i], ys[j]], [xs[i], ys[j + 1]]]);
    if (!inside(i + 1, j)) segs.push([[xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]]);
  }
  /* merge collinear touching pieces */
  const merged = [];
  for (const horiz of [true, false]) {
    const list = segs.filter(s => (s[0][1] === s[1][1]) === horiz)
      .sort((a, b) => horiz ? (a[0][1] - b[0][1] || a[0][0] - b[0][0]) : (a[0][0] - b[0][0] || a[0][1] - b[0][1]));
    for (const s of list) {
      const m = merged[merged.length - 1];
      if (m && horiz && m[0][1] === s[0][1] && m[1][1] === s[0][1] && Math.abs(m[1][0] - s[0][0]) < 1e-6) { m[1] = s[1]; continue; }
      if (m && !horiz && m[0][0] === s[0][0] && m[1][0] === s[0][0] && Math.abs(m[1][1] - s[0][1]) < 1e-6) { m[1] = s[1]; continue; }
      merged.push([s[0].slice(), s[1].slice()]);
    }
  }
  return merged;
}

/* ---------- exports ---------- */
/** Cable list as CSV (one row per cable, lengths in mm along the drawn route). */
function cadWireCsv(plan) {
  const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const rows = [['SSC', 'Type', 'From', 'To', 'Drawn length (mm)']];
  for (const c of plan.cables) rows.push([c.ssc, c.kind === 'power' ? 'Power' : 'Communication', c.from, c.to, Math.round(cadwLen(c.pts))]);
  return rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}

/**
 * Wiring as an AutoCAD DXF (R12, millimetres) in the SAME coordinates as the
 * imported drawing: copy it and PASTEORIG into the rack drawing. Layers:
 * WF-POWER (red), WF-COMM (green), WF-NUMBER (magenta labels), WF-GROUP (yellow outlines).
 */
function cadWireDxf(plan, opts) {
  opts = opts || {};
  const text = opts.textHeight || 40;
  const out = [];
  const g = (code, v) => { out.push(String(code)); out.push(String(v)); };
  const f = v => (Math.round(v * 1000) / 1000).toString();
  const layers = [['WF-POWER', 1], ['WF-COMM', 3], ['WF-NUMBER', 6], ['WF-GROUP', 2]];
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const [name, color] of layers) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (layer, a, b) => { g(0, 'LINE'); g(8, layer); g(10, f(a[0])); g(20, f(a[1])); g(30, 0); g(11, f(b[0])); g(21, f(b[1])); g(31, 0); };
  for (const c of plan.cables) for (let i = 1; i < c.pts.length; i++) line(c.kind === 'power' ? 'WF-POWER' : 'WF-COMM', c.pts[i - 1], c.pts[i]);
  for (const o of plan.outline || []) for (const s of o.segs) line('WF-GROUP', s[0], s[1]);
  for (const st of plan.strings) {
    for (const l of st.labels) {
      g(0, 'TEXT'); g(8, 'WF-NUMBER'); g(10, f(l.x)); g(20, f(l.y)); g(30, 0); g(40, text); g(1, l.text);
      g(72, 1); g(73, 2); g(11, f(l.x)); g(21, f(l.y)); g(31, 0);
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** Plain, storable copy of a plan (no component objects), as kept with the drawing. */
function cadWireSave(plan, key) {
  const r = v => Math.round(v * 100) / 100;
  return {
    key: key, pair: plan.pair, generated: new Date().toISOString(),
    crossings: plan.crossings.slice(), warnings: plan.warnings.slice(),
    cables: plan.cables.map(c => ({ id: c.id, ssc: c.ssc, kind: c.kind, from: c.from, to: c.to, pts: c.pts.map(p => [r(p[0]), r(p[1])]) })),
    strings: plan.strings.map(st => ({ name: st.name, tag: st.tag, modules: st.modules.map(m => m.id),
      labels: st.labels.map(l => ({ id: l.id, text: l.text, x: r(l.x), y: r(l.y) })) })),
    outline: plan.outline.map(o => ({ ssc: o.ssc, segs: o.segs.map(sg => sg.map(p => [r(p[0]), r(p[1])])) })),
  };
}
