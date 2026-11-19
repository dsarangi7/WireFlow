/* ============================================================
 * WireFlow — automatic rack wiring on a recognised DXF drawing
 * ------------------------------------------------------------
 * AYK rules (confirmed 18 Nov 2026):
 *   - one SSC = one string = one junction box (top of its column) +
 *     the modules the engineer enters for it;
 *   - power, series:  SSC S- -> M1 -,  Mk + -> Mk+1 -,  last + -> SSC S+;
 *   - communication:  SSC S -> M1 N,   Mk S -> Mk+1 N,  last S -> SSC N
 *                     (user-confirmed 19 Nov 2026; matches engine.js, frontview.js,
 *                     simple-wiring.js and the R03/R06 specification);
 *   - bus:            SSC B+ -> JB +,  SSC B- -> JB -  (pair P1 or P2,
 *                     chosen once by the engineer, same on every JB);
 *   - power cables never cross each other anywhere in the rack; power and
 *     communication may cross.
 * Drawing style (AYK marked-up rack): short jumps between neighbouring
 * modules, long cables run in the cable trays (the channels between module
 * columns) and across the rails (the gaps between rows) - never over a part,
 * modules labelled S<ssc>-M<k>, a group outline around each SSC's modules.
 *
 * Coordinates are drawing millimetres, Y up (as in the DXF).
 * Pure functions, no DOM. Loaded after cad.js.
 * ============================================================ */

const CADW_LANE = 10;      // spacing between cables in a riser, mm
const CADW_STUB = 22;      // first stub out of a terminal, mm
const CADW_STUB_STEP = 9;  // extra stub per lane, so horizontals never overlap
const CADW_RACK_MARGIN = 50; // mm beyond the outermost parts still counted as inside the rack
/* All distances above are millimetres on an AYK module drawn 400 mm wide. Drawings come at
   other scales (one rack is drawn about 1:44, a module 9 units wide), so every distance is
   multiplied by CADW_K = module width / 400, set when the columns are found. */
const CADW_MODULE_MM = 400.45;
let CADW_K = 1;
function cadwU(mm) { return mm * CADW_K; }

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
    return Math.min(hi1, hi2) - Math.max(lo1, lo2) > cadwU(1);
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
  CADW_K = widths[widths.length >> 1] / CADW_MODULE_MM;
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
  /* the rack outline: every recognised part, plus a margin for the outer uprights.
     No cable may leave it (the junction box plug leads are drawn on the sheet, not here). */
  const all = comps.filter(c => isFinite(c.x0) && isFinite(c.y0));
  cols.bounds = {
    x0: Math.min(...all.map(c => c.x0)) - cadwU(CADW_RACK_MARGIN), x1: Math.max(...all.map(c => c.x1)) + cadwU(CADW_RACK_MARGIN),
    y0: Math.min(...all.map(c => c.y0)) - cadwU(CADW_RACK_MARGIN), y1: Math.max(...all.map(c => c.y1)) + cadwU(CADW_RACK_MARGIN)
  };
  /* riser channel = middle of the gap to the neighbouring column */
  cols.forEach((k, i) => {
    const l = cols[i - 1], r = cols[i + 1];
    k.riserL = l ? (l.x1 + k.x0) / 2 : k.x0 - cadwU(45);
    k.riserR = r ? (k.x1 + r.x0) / 2 : k.x1 + cadwU(45);
    k.gapL = l ? k.x0 - l.x1 : cadwU(90);
    k.gapR = r ? r.x0 - k.x1 : cadwU(90);
    /* the cable trays on either side of the column: CL (column left), CR (column right).
       Neighbouring columns share a tray, so lanes are kept per tray x. */
    k.trayL = { x: k.riserL, gap: k.gapL, side: 'CL' };
    k.trayR = { x: k.riserR, gap: k.gapR, side: 'CR' };
  });
  /* every part a cable must not run across: modules, SSCs, junction boxes, MSMs */
  cols.bodies = all.filter(c => c.kind === 'module' || c.kind === 'ssc' || c.kind === 'jb' || c.kind === 'msm');
  return cols;
}

/* ---------- routes ---------- */
/** True when every point of the route is inside the rack outline. */
function cadwInside(pts, b) {
  if (!b) return true;
  return pts.every(p => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1);
}
/** Routes that stay inside the rack. A detour outside never wins over a crossing:
    when nothing fits, the shortest route is kept and its crossing is reported. */
function cadwKeepInside(routes, b, len) {
  const inside = routes.filter(r => cadwInside(len ? r.pts : r, b));
  if (inside.length) return inside;
  const L = r => cadwLen(len ? r.pts : r);
  return routes.length ? [routes.reduce((m, r) => (L(r) < L(m) ? r : m))] : routes;
}
/** Rails: horizontal channels between two trays, i.e. the bands of height free of every
    part between them (the gaps between module rows, and above / below the rack). */
function cadwRails(cols, xa, xb) {
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb), b = cols.bounds;
  const key = lo.toFixed(1) + '|' + hi.toFixed(1);
  cols._rails = cols._rails || new Map();
  if (cols._rails.has(key)) return cols._rails.get(key);
  const iv = (cols.bodies || []).filter(c => c.x1 > lo && c.x0 < hi).map(c => [c.y0, c.y1]).sort((p, q) => p[0] - q[0]);
  const out = [];
  let y = b.y0;
  for (const [y0, y1] of iv) { if (y0 - y >= cadwU(12)) out.push([y, y0]); y = Math.max(y, y1); }
  if (b.y1 - y >= cadwU(12)) out.push([y, b.y1]);
  const rails = out.map(g => ({ y: (g[0] + g[1]) / 2, h: g[1] - g[0], key: 'rail:' + key + ':' + ((g[0] + g[1]) / 2).toFixed(1) }));
  cols._rails.set(key, rails);
  return rails;
}
const CADW_SLOTS = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8];
function cadwLaneX(t, slot) { return t.x + slot * Math.min(cadwU(CADW_LANE), Math.max(cadwU(1.5), (t.gap - cadwU(8)) / 17)); }
function cadwLaneY(r, slot) { return r.y + slot * Math.min(cadwU(CADW_LANE), Math.max(cadwU(1.5), (r.h - cadwU(6)) / 17)); }
/** Long cable routes the AYK way: out of a into a tray beside its column, along the tray,
    across a rail (only when the other end is in another column), down the tray beside
    b's column and into b. used: lanes already taken (tray x / rail key -> Set of slots). */
function cadwTrayRoutes(a, b, traysA, traysB, cols, stubsA, stubsB, used, nearB) {
  const out = [];
  const free = (key, n) => CADW_SLOTS.filter(s => !(used && used.has(key) && used.get(key).has(s))).slice(0, n);
  for (const ta of traysA) for (const tb of traysB) {
    if (Math.abs(ta.x - tb.x) < cadwU(1)) {
      for (const slot of free(ta.x, 3)) for (const sa of stubsA) for (const sb of stubsB)
        out.push({ pts: cadwRiserRoute(a, b, cadwLaneX(ta, slot), sa, sb), lanes: [[ta.x, slot]] });
      continue;
    }
    const mid = (a.y + b.y) / 2;
    /* to a junction box: across the rail next to the box (over the top of the rack),
       never through the middle of the modules */
    const rails = nearB ? cadwRails(cols, ta.x, tb.x).slice().sort((p, q) => Math.abs(p.y - b.y) - Math.abs(q.y - b.y)).slice(0, 1)
      : cadwRails(cols, ta.x, tb.x).slice().sort((p, q) => (Math.abs(p.y - a.y) + Math.abs(p.y - b.y)) - (Math.abs(q.y - a.y) + Math.abs(q.y - b.y)) || Math.abs(p.y - mid) - Math.abs(q.y - mid)).slice(0, 3);
    const [sA] = free(ta.x, 1), [sB] = free(tb.x, 1);
    if (sA === undefined || sB === undefined) continue;
    const xA = cadwLaneX(ta, sA), xB = cadwLaneX(tb, sB);
    for (const rail of rails) for (const rs of free(rail.key, 2)) {
      const y = cadwLaneY(rail, rs);
      for (const sa of stubsA) for (const sb of stubsB)
        out.push({ pts: cadwClean([[a.x, a.y], [a.x, a.y + sa], [xA, a.y + sa], [xA, y], [xB, y], [xB, b.y + sb], [b.x, b.y + sb], [b.x, b.y]]),
          lanes: [[ta.x, sA], [tb.x, sB], [rail.key, rs]] });
    }
  }
  return out;
}
/** True when no straight run of the route passes over a part other than its own two ends. */
function cadwClear(pts, cols, own) {
  const bodies = (cols && cols.bodies) || [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
    for (const c of bodies) {
      if (own.indexOf(c) >= 0) continue;
      const e = cadwU(1);
      if (x1 > c.x0 + e && x0 < c.x1 - e && y1 > c.y0 + e && y0 < c.y1 - e) return false;
    }
  }
  return true;
}
/** Riser route: out of a, along the riser at lane x, into b. stubA/stubB are signed y offsets. */
function cadwRiserRoute(a, b, laneX, stubA, stubB) {
  return cadwClean([[a.x, a.y], [a.x, a.y + stubA], [laneX, a.y + stubA], [laneX, b.y + stubB], [b.x, b.y + stubB], [b.x, b.y]]);
}
/** Direct route inside one column: down/up from a, across, into b. */
function cadwDirectRoute(a, b, midY) {
  return cadwClean([[a.x, a.y], [a.x, midY], [b.x, midY], [b.x, b.y]]);
}

/** Jump between consecutive modules in the string (power + -> -, or comm S -> N). */
/** Slight C-shaped curve between two terminals, sagging below (dir -1) or bowing above (dir +1). */
function cadwCurve(t1, t2, sag, dir) {
  const pts = [];
  const span = t2.x - t1.x;
  const c1 = [t1.x + span * 0.18, t1.y + dir * sag * 1.33], c2 = [t2.x - span * 0.18, t2.y + dir * sag * 1.33];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, u = 1 - t;
    pts.push([u * u * u * t1.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * t2.x,
      u * u * u * t1.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * t2.y]);
  }
  pts.curve = true;
  return pts;
}

/** Jump between consecutive modules in the string (power + -> -, or comm S -> N). */
function cadwJump(m1, m2, t1, t2, cols, kind) {
  const sameCol = m1._col === m2._col;
  const straight = [[t1.x, t1.y], [t2.x, t2.y]];
  if (sameCol && (!cols || !cols.bodies || cadwClear(straight, cols, [m1, m2]))) return [straight];
  return cadwKeepInside(cadwJumpRoutes(m1, m2, t1, t2, cols, kind), cols && cols.bounds);
}
function cadwJumpRoutes(m1, m2, t1, t2, cols, kind) {
  const sideBySide = m1._col !== m2._col && Math.abs(m1._col - m2._col) === 1 && Math.abs(m1.y0 - m2.y0) < (m1.y1 - m1.y0) * 0.5;
  if (sideBySide) {
    /* AYK drawing style: a slight C curve under (or over) the modules, power sagging deeper than comm */
    const sags = (kind === 'power' ? [130, 80, 45] : [55, 35]).map(cadwU);
    const out = [];
    for (const sag of sags) out.push(cadwCurve(t1, t2, sag, -1), cadwCurve(t1, t2, sag, 1));
    /* the deepest curve that stays inside the rack, in either direction */
    const inside = out.filter(r => cadwInside(r, cols && cols.bounds));
    return inside.length ? inside.filter(r => r === inside[0] || r === inside.find(q => q !== inside[0] && Math.sign(q[10][1] - t1.y) !== Math.sign(inside[0][10][1] - t1.y))) : out;
  }
  /* other column changes: round the modules (only where no other part is in the way),
     or along the trays and rails like a long cable */
  const below = Math.min(m1.y0, m2.y0) - cadwU(14), above = Math.max(m1.y1, m2.y1) + cadwU(14);
  const out = [above, below].map(y => cadwClean([[t1.x, t1.y], [t1.x, y], [t2.x, y], [t2.x, t2.y]]))
    .filter(r => !cols || !cols.bodies || cadwClear(r, cols, [m1, m2]));
  if (cols && cols[m1._col] && cols[m2._col] && cols[m1._col].trayL) {
    const k1 = cols[m1._col], k2 = cols[m2._col];
    const stubs = [-cadwU(CADW_STUB), cadwU(CADW_STUB)];
    /* jumps keep to the outer lanes of a tray; the middle lanes are for the long cables */
    const used = new Map([k1.trayL, k1.trayR, k2.trayL, k2.trayR].map(t => [t.x, new Set([0, -1, 1, -2, 2])]));
    for (const r of cadwTrayRoutes(t1, t2, [k1.trayL, k1.trayR], [k2.trayL, k2.trayR], cols, stubs, stubs, used)) out.push(r.pts);
  }
  return out;
}

/** Junction boxes named JB1, JB2 … left to right (top first in a column). */
function cadJbNames(comps) {
  const jbs = comps.filter(c => c.kind === 'jb').sort((a, b) => (a.x0 - b.x0) || (b.y0 - a.y0));
  return new Map(jbs.map((j, i) => [j.id, 'JB' + (i + 1)]));
}

/** The junction box of an SSC's own column (top or bottom), or null. */
function cadAutoJb(comps, ssc) {
  const cols = cadwColumns(comps);
  const col = cols[ssc._col];
  const cy = (ssc.y0 + ssc.y1) / 2;
  return (col && col.jbs.slice().sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - cy) - Math.abs((b.y0 + b.y1) / 2 - cy))[0]) || null;
}

/* ---------- planning ---------- */
/**
 * Plans the wiring of the whole rack.
 * @param {Array<Object>} comps Recognised components {id, kind, x0,y0,x1,y1, terminals:[{role,x,y}]}.
 * @param {Array<Object>} sscs  [{comp, name, count}] — confirmed SSCs with module counts.
 * @param {Object} opts {pair: 'P1'|'P2'}.
 * @return {Object} {ok, errors, warnings, strings:[...], cables:[...], crossings:[...], outline:[...]}
 */
/** Battery modules found with two (or more) box sizes are the same module taught twice with
    different boxes. For wiring, every module gets the box of the most common size, placed
    by its terminals, so columns, rows and trays line up. The drawing itself is not changed. */
function cadwSameModules(comps) {
  const mods = comps.filter(c => c.kind === 'module' && (c.terminals || []).length);
  if (mods.length < 2) return comps;
  const sizeKey = c => (c.x1 - c.x0).toPrecision(3) + 'x' + (c.y1 - c.y0).toPrecision(3);
  const bySize = new Map();
  for (const m of mods) { const k = sizeKey(m); if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(m); }
  if (bySize.size < 2) return comps;
  const common = Array.from(bySize.values()).sort((a, b) => b.length - a.length)[0];
  const mid = c => { const t = c.terminals; return [t.reduce((s, p) => s + p.x, 0) / t.length, t.reduce((s, p) => s + p.y, 0) / t.length]; };
  const W = common[0].x1 - common[0].x0, H = common[0].y1 - common[0].y0;
  const off = common.reduce((s, c) => { const q = mid(c); return [s[0] + q[0] - c.x0, s[1] + q[1] - c.y0]; }, [0, 0]).map(v => v / common.length);
  const same = new Set(common);
  return comps.map(c => {
    if (c.kind !== 'module' || same.has(c) || !(c.terminals || []).length) return c;
    const q = mid(c), x0 = q[0] - off[0], y0 = q[1] - off[1];
    return Object.assign({}, c, { x0: x0, y0: y0, x1: x0 + W, y1: y0 + H });
  });
}

/** Help while the engineer numbers the modules: which modules make a good next click.
 *  next(sscKey, pickedIds, takenIds) -> { ids: modules next to the last one (or next to the
 *  SSC for M1) that keep power cables apart, suggested: the suggested numbering's next module
 *  while the engineer is following it }. */
function cadWireGuide(comps, sscs, opts) {
  opts = opts || {};
  comps = cadwSameModules(comps);
  const cols = cadwColumns(comps);
  const g = cadwGrid(cols, comps);
  const byId = new Map(g.mods.map(m => [m.id, m]));
  const jbs = comps.filter(c => c.kind === 'jb');
  /* rows where a B+ / B- runs up a tray: no side-by-side jump there */
  const blocked = new Set();
  for (const s of sscs) {
    const c = s.comp;
    if (!c || c._col == null) continue;
    const jb = (s.jbId && jbs.find(j => j.id === s.jbId)) || (cols[c._col] && cols[c._col].jbs[0]);
    if (!jb) continue;
    const tray = s.tray === 'CL' || s.tray === 'CR' ? s.tray : (opts.tray === 'CL' ? 'CL' : 'CR');
    const gp = tray === 'CL' ? c._col - 1 : c._col;
    const ya = (c.y0 + c.y1) / 2, yb = (jb.y0 + jb.y1) / 2;
    g.rowsY.forEach((y, r) => { if (y > Math.min(ya, yb) && y < Math.max(ya, yb) && (y > c.y1 || y < c.y0)) blocked.add(gp + ',' + r); });
  }
  const nbrs = m => {
    const out = [];
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const q = g.at(m._col + dc, m._row + dr);
      if (q && (!dc || !blocked.has(Math.min(m._col, q._col) + ',' + m._row))) out.push(q);
    }
    if (g.around.has(m)) out.push(g.around.get(m));
    return out;
  };
  let suggested = null;
  if (opts.suggest !== false) {
    try {
      const plan = cadWirePlan(comps, sscs, { pair: opts.pair, tray: opts.tray, budget: opts.budget || 40000, suggestOnly: true });
      suggested = plan && plan.suggested ? plan.suggested : null;
    } catch (e) { suggested = null; }
  }
  return {
    suggested: suggested,
    next(sscKey, picked, taken) {
      const s = sscs.find(x => x.key === sscKey);
      if (!s || !s.comp) return { ids: [], suggested: null };
      const used = new Set(taken || []);
      const free = m => m && !used.has(m.id);
      let ids;
      if (!picked.length) {
        /* M1: a free module beside the SSC, nearest first */
        const sy = (s.comp.y0 + s.comp.y1) / 2;
        ids = g.mods.filter(m => free(m) && Math.abs(m._col - s.comp._col) <= 1)
          .sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - sy) - Math.abs((b.y0 + b.y1) / 2 - sy)).slice(0, 4).map(m => m.id);
      } else {
        const last = byId.get(picked[picked.length - 1]);
        ids = last ? nbrs(last).filter(free).map(m => m.id) : [];
      }
      /* the suggested numbering, while the engineer's clicks so far match it */
      let sug = null;
      const order = suggested && suggested[sscKey];
      if (order && picked.every((id, i) => order[i] === id) && order[picked.length] && !used.has(order[picked.length])) sug = order[picked.length];
      return { ids: ids, suggested: sug };
    },
  };
}

function cadWirePlan(comps, sscs, opts) {
  opts = opts || {};
  comps = cadwSameModules(comps);
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
  const jbNames = cadJbNames(comps);
  const allJbs = comps.filter(c => c.kind === 'jb');
  const jbFor = new Map();
  const needJb = [];
  const usedPair = new Map();
  for (const s of sscs) {
    /* the engineer's choice (s.jbId, s.pair), else the junction box of the SSC's own
       column (usually at the top, on some racks at the bottom) with the rack's pair */
    let jb = s.jbId ? allJbs.find(j => j.id === s.jbId) : null;
    if (!jb) {
      const col = cols[s.comp._col];
      const cy = (s.comp.y0 + s.comp.y1) / 2;
      jb = col && col.jbs.slice().sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - cy) - Math.abs((b.y0 + b.y1) / 2 - cy))[0];
    }
    const pr = s.pair === 'P1' || s.pair === 'P2' ? s.pair : pair;
    if (!jb) { needJb.push(s.key); errors.push(`${s.name}: no junction box in its column. Choose one for it in "Junction boxes per SSC" in the Wiring card (for example the left or right pair of a neighbouring junction box).`); continue; }
    if (!cadwTerm(jb, pr + '+') || !cadwTerm(jb, pr + '-')) { errors.push(`${s.name}: ${jbNames.get(jb.id)} has no ${pr} terminals. Teach the junction box and click its four connectors (+, −, +, −).`); continue; }
    const k = jb.id + '|' + pr;
    if (usedPair.has(k)) { errors.push(`${jbNames.get(jb.id)} ${pr === 'P1' ? 'left' : 'right'} pair is given to both ${usedPair.get(k)} and ${s.name}. Give one of them the other pair or another junction box.`); continue; }
    usedPair.set(k, s.name);
    /* cable tray for B+ / B- up to the junction box: CL = column left, CR = column right
       (the engineer's choice; without one either tray may be used) */
    const tray = s.tray === 'CL' || s.tray === 'CR' ? s.tray : (opts.tray === 'CL' || opts.tray === 'CR' ? opts.tray : null);
    jbFor.set(s, { jb: jb, pair: pr, name: jbNames.get(jb.id), tray: tray });
  }
  if (errors.length) return { ok: false, errors: errors, needJb: needJb, warnings: warnings, strings: [], cables: [], crossings: [], outline: [] };

  /* only the suggested numbering (the guide while the engineer numbers) */
  if (opts.suggestOnly) {
    const orders = cadwSuggestOrders(cols, comps, sscs, jbFor, { budget: opts.budget });
    return { ok: !!orders, errors: [], warnings: warnings, suggested: orders };
  }
  let best = null;
  /* the engineer's own numbering (opts.orders: SSC key -> module ids in order) */
  if (opts.orders) {
    const fixed = cadwFixedStrings(comps, sscs, opts.orders);
    if (fixed) best = cadwRunStrings(fixed, cols, jbFor, pair);
    else warnings.push('The edited numbering no longer matches the modules or SSC counts, so the suggested numbering is used.');
  }
  /* the suggested numbering: one block per SSC, power never crossing */
  if (!best) {
    const trays = {};
    const orders = cadwSuggestOrders(cols, comps, sscs, jbFor, { budget: opts.budget, log: opts.log, allow: opts.allow, chooseTray: opts.chooseTray, tries: opts.tries, trays: trays });
    /* trays the search picked (only when the engineer let it choose) */
    if (orders && opts.chooseTray) for (const s of sscs) if (trays[s.key] && jbFor.get(s)) jbFor.get(s).tray = trays[s.key];
    const fixed = orders && cadwFixedStrings(comps, sscs, orders);
    if (fixed) { best = cadwRunStrings(fixed, cols, jbFor, pair); if (best) { best.custom = false; best.suggested = orders; best.trays = opts.chooseTray ? trays : null; } }
  }
  const seen = new Set();
  if (!best || (!best.custom && cadwPowerCrossings(best.cables).length)) for (const lr of [1, -1]) for (const td of [1, -1]) {
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
  if (crossings.length) warnings.push(`${crossings.length} power cable crossing${crossings.length === 1 ? '' : 's'}${best.custom ? ' with this numbering' : ' could not be avoided'}: check the highlighted cables.`);
  for (const st of best.strings) if (st.far) warnings.push(`${st.name} is not next to its modules; its long cables may be impractical.`);
  return { ok: true, errors: [], warnings: warnings, pair: pair, custom: !!best.custom, suggested: best.suggested || null, strings: best.strings, cables: best.cables, crossings: crossings,
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

/** Strings in the engineer's order, or null when the order does not fit the drawing. */
function cadwFixedStrings(comps, sscs, orders) {
  const byId = new Map(comps.filter(c => c.kind === 'module').map(m => [m.id, m]));
  const used = new Set();
  const out = [];
  for (const s of sscs) {
    const ids = orders[s.key];
    if (!Array.isArray(ids) || ids.length !== s.count) return null;
    const mods = ids.map(id => byId.get(id));
    if (mods.some(m => !m || used.has(m.id))) return null;
    mods.forEach(m => used.add(m.id));
    const dist = Math.min(...mods.map(m => Math.abs(m._col - s.comp._col)));
    out.push({ s: s, mods: mods, far: dist > 1, fixed: true });
  }
  return used.size === byId.size ? out : null;
}
/** Routes a set of strings (left to right) and sums their cost. */
function cadwRunStrings(strings, cols, jbFor, pair) {
  const placed = [], gapUse = new Map(), out = [];
  let score = 0;
  for (const st of strings.slice().sort((a, b) => a.s.comp._col - b.s.comp._col)) {
    const j = jbFor.get(st.s);
    const r = cadwPlanString(st, cols, j.jb, j.pair, placed, gapUse, j.name, j.tray);
    if (!r) return null;
    for (const c of r.cables) placed.push(c);
    out.push(r.string);
    score += r.score;
  }
  return { score: score, strings: out, cables: placed, custom: true };
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
    const j = jbFor.get(st.s);
    const r = cadwPlanString(st, cols, j.jb, j.pair, placed, gapUse, j.name, j.tray);
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
function cadwPlanString(st, cols, jb, pair, placed, gapUse, jbName, tray) {
  jbName = jbName || 'JB';
  const ssc = st.s.comp;
  const col = cols[ssc._col];
  const num = (String(st.s.name).match(/\d+/) || [''])[0];
  const tag = 'S' + num;
  let best = null;
  for (const order of (st.fixed ? [st.mods] : cadwOrders(st.mods))) {
    const label = new Map(order.map((m, i) => [m, `${tag}-M${i + 1}`]));
    /* jumps between neighbouring modules */
    const jumps = [];
    const prePlaced = placed.slice();
    for (let i = 0; i + 1 < order.length; i++) {
      const a = order[i], b = order[i + 1];
      for (const [kind, ra, rb] of [['power', 'power+', 'power-'], ['comm', 'comm-S', 'comm-N']]) {
        const opts = cadwJump(a, b, cadwTerm(a, ra), cadwTerm(b, rb), cols, kind);
        let pick = null;
        for (const pts of opts) {
          const cab = { kind: kind, pts: pts };
          const x = kind === 'power' ? prePlaced.filter(c => c.kind === 'power').reduce((n, c) => n + cadwCrossings(cab, c), 0) : 0;
          const v = x * 1e6 + cadwLen(pts);
          if (!pick || v < pick.v) pick = { v: v, pts: pts };
        }
        const cab = { id: `${tag} ${label.get(a)}→${label.get(b)} ${kind}`, ssc: st.s.name, kind: kind,
          from: `${label.get(a)} ${ra === 'power+' ? '+' : 'S'}`, to: `${label.get(b)} ${rb === 'power-' ? '−' : 'N'}`, pts: pick.pts, curve: !!pick.pts.curve, opts: opts };
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
      j.pts = pick.pts; j.curve = !!pick.pts.curve; j.box = null;
    }
    for (const j of jumps) delete j.opts;
    const first = order[0], last = order[order.length - 1];
    const longPower = [
      { key: 'S-', from: [ssc, 'S-'], to: [first, 'power-'], name: `${tag} S− → ${label.get(first)} −` },
      { key: 'S+', from: [ssc, 'S+'], to: [last, 'power+'], name: `${tag} ${label.get(last)} + → S+` },
      { key: 'B+', from: [ssc, 'B+'], to: [jb, pair + '+'], name: `${tag} B+ → ${jbName} ${pair}+` },
      { key: 'B-', from: [ssc, 'B-'], to: [jb, pair + '-'], name: `${tag} B− → ${jbName} ${pair}−` },
    ];
    const longComm = [
      { key: 'S', from: [ssc, 'S'], to: [first, 'comm-N'], name: `${tag} S → ${label.get(first)} N` },
      { key: 'N', from: [ssc, 'N'], to: [last, 'comm-S'], name: `${tag} ${label.get(last)} S → N` },
    ];
    const risers = [col.trayL, col.trayR];
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
        const s0 = cadwU(CADW_STUB + k * CADW_STUB_STEP);
        const far = [];
        for (let j = 0; j < 4; j++) {
          const s = cadwU(CADW_STUB + j * CADW_STUB_STEP);
          far.push(-s); if (!toJb) far.push(s);
        }
        /* out of the SSC into a tray beside its column (B+ / B- only in the tray the
           engineer chose), across a rail if the other end is in another column, then
           down the tray beside that column */
        const trays = toJb && tray ? risers.filter(r => r.side === tray) : risers;
        const bc = cols[spec.to[0]._col];
        let traysB = bc ? [bc.trayL, bc.trayR] : trays;
        if (toJb && tray && traysB.some(t => trays.some(r => Math.abs(r.x - t.x) < cadwU(1)))) traysB = traysB.filter(t => trays.some(r => Math.abs(r.x - t.x) < cadwU(1)));
        const cands = cadwTrayRoutes(a, b, trays, traysB, cols, [-s0, s0], far, lanesUsed, toJb);
        if (!toJb && b.x >= ssc.x0 - cadwU(1) && b.x <= ssc.x1 + cadwU(1) && b.y < a.y) {
          /* module directly under the SSC: short direct cable */
          cands.push({ pts: cadwDirectRoute(a, b, a.y - s0), lanes: [] });
        }
        const pool = prePlaced.concat(cables).filter(z => z.kind === kind);
        let pick = null;
        /* shortest first: once a route is free of crossings, no longer one can beat it */
        const inside = cadwKeepInside(cands, cols.bounds, true).map(c => ({ c: c, len: cadwLen(c.pts) })).sort((p, q) => p.len - q.len);
        for (const { c, len } of inside) {
          if (pick && pick.v <= len) break;
          const cab = { kind: kind, pts: c.pts };
          const x = pool.reduce((n, z) => n + cadwCrossings(cab, z), 0);
          const v = x * 1e6 + len;
          if (!pick || v < pick.v) pick = { v: v, x: x, c: c };
        }
        for (const [key, slot] of pick.c.lanes) { if (!lanesUsed.has(key)) lanesUsed.set(key, new Set()); lanesUsed.get(key).add(slot); }
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
    name: st.s.name, tag: tag, ssc: ssc, jb: jb, jbName: jbName, pair: pair, far: st.far,
    modules: best.order,
    labels: best.order.map((m, i) => ({ id: m.id, text: `${tag}-M${i + 1}`, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 + (m.y1 - m.y0) * 0.12 })),
  };
  return { score: best.score, string: string, cables: best.cables };
}

/* ---------- suggested numbering: one block of modules per SSC, power never crossing ----------
 * The rack is a grid of module cells (column, row). Each SSC gets a connected block of
 * exactly its module count, wired as one path: M1 and the last module sit in the SSC's
 * column or a column beside it (S- and S+ run there along the tray), and every jump goes
 * to the module above / below or side by side. Blocks never overlap, so a string's jumps
 * stay inside its block, and no side-by-side jump may cross a tray where a B+ / B-, S- or
 * S+ cable runs. The engineer still clicks every module: this is only the guide. */
function cadwGrid(cols, comps) {
  const mods = comps.filter(c => c.kind === 'module');
  const hs = mods.map(c => c.y1 - c.y0).sort((a, b) => a - b);
  const tol = (hs[hs.length >> 1] || 1) * 0.4;
  const rowsY = [];
  for (const m of mods.slice().sort((a, b) => (b.y0 + b.y1) - (a.y0 + a.y1))) {
    const cy = (m.y0 + m.y1) / 2;
    let r = rowsY.findIndex(y => Math.abs(y - cy) <= tol);
    if (r < 0) { rowsY.push(cy); r = rowsY.length - 1; }
    m._row = r;
  }
  const cell = new Map();
  for (const m of mods) cell.set(m._col + ',' + m._row, m);
  /* round an SSC (or another part) in the column: the module above it and the module
     below it are joined along the tray beside it */
  const around = new Map();
  for (const k of cols) {
    const ms = k.modules.slice().sort((a, b) => a._row - b._row);
    for (let i = 1; i < ms.length; i++) if (ms[i]._row - ms[i - 1]._row > 1 && ms[i]._row - ms[i - 1]._row <= 6) {
      around.set(ms[i - 1], ms[i]); around.set(ms[i], ms[i - 1]);
    }
  }
  return { mods: mods, rowsY: rowsY, at: (c, r) => cell.get(c + ',' + r) || null, around: around };
}
function cadwSuggestOrders(cols, comps, sscs, jbFor, opts) {
  opts = opts || {};
  const g = cadwGrid(cols, comps);
  const budget = { n: opts.budget || 40000 };
  const R = g.rowsY.length;
  /* trays: gap g lies between column g and g+1. blocks: "gap,row" -> number of long cables
     running there; placed: "gap,row" -> number of side-by-side jumps across it */
  const blocks = new Map(), placed = new Map();
  const inc = (map, k, d) => { const v = (map.get(k) || 0) + d; if (v) map.set(k, v); else map.delete(k); };
  const sideGap = (s, side) => side === 'CL' ? s.comp._col - 1 : s.comp._col;
  /* chosen: the tray picked for an SSC's B+ / B- while searching (opts.chooseTray) */
  const chosen = new Map();
  const trayOf = s => { if (chosen.has(s)) return chosen.get(s); const j = jbFor.get(s); return (j && j.tray) || 'CR'; };
  /* rows a long cable passes in a tray, from the SSC to a row (or to the junction box) */
  const runRows = (s, y) => {
    const a = s.comp.y0, b = s.comp.y1, out = [];
    g.rowsY.forEach((ry, r) => { if ((ry > b && ry <= Math.max(y, b)) || (ry < a && ry >= Math.min(y, a))) out.push(r); });
    return out;
  };
  /* B+ / B- run up the tray from the SSC to its junction box */
  const busRun = (s, side) => { const j = jbFor.get(s); return j ? runRows(s, (j.jb.y0 + j.jb.y1) / 2).map(r => sideGap(s, side) + ',' + r) : []; };
  if (!opts.chooseTray) for (const s of sscs) for (const k of busRun(s, trayOf(s))) inc(blocks, k, 1);
  /* the tray an S- / S+ cable uses to reach module m, and the rows it passes */
  const endRun = (s, m) => {
    const c = s.comp._col;
    const gp = m._col === c + 1 ? c : m._col === c - 1 ? c - 1 : sideGap(s, trayOf(s));
    return runRows(s, (m.y0 + m.y1) / 2).map(r => gp + ',' + r);
  };
  const runCost = keys => keys.reduce((n, k) => n + (placed.get(k) || 0), 0);
  const taken = new Set();
  const free = m => !taken.has(m);
  /* seeded random numbers for tie-breaking between attempts */
  let seed = 12345, jitter = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  /* allow: power crossings the search may still spend (0 first, more only if needed) */
  let allow = 0, spent = 0;
  const cross = (m, q) => q._col === m._col ? 0 : (blocks.get(Math.min(m._col, q._col) + ',' + m._row) || 0);
  const edgeOk = (m, q) => allow > 0 || cross(m, q) === 0;
  const nbrs = m => {
    const out = [];
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const q = g.at(m._col + dc, m._row + dr);
      if (q && edgeOk(m, q)) out.push(q);
    }
    if (g.around.has(m)) out.push(g.around.get(m));
    return out;
  };
  const freeDeg = (m, extra) => nbrs(m).filter(free).length + (extra || 0);
  const isEnd = (s, m) => Math.abs(m._col - s.comp._col) <= 1;
  let pending = [];
  const anyEnd = m => pending.some(s => isEnd(s, m));
  /* free modules split into areas; each must be filled exactly by SSCs that can end in it */
  /* head / need: the string being drawn still needs `need` modules, reached from `head` */
  const feasible = (head, need) => {
    const comp = new Map(), sizes = [];
    for (const m of g.mods) {
      if (!free(m) || comp.has(m)) continue;
      const id = sizes.length; let n = 0; const st = [m]; comp.set(m, id);
      while (st.length) { const x = st.pop(); n++; for (const z of nbrs(x)) if (free(z) && !comp.has(z)) { comp.set(z, id); st.push(z); } }
      sizes.push(n);
    }
    const opt = pending.map(s => {
      const c = new Map();
      for (const m of g.mods) if (free(m) && isEnd(s, m)) c.set(comp.get(m), (c.get(comp.get(m)) || 0) + 1);
      return Array.from(c).filter(([, n]) => n >= (s.count > 1 ? 2 : 1)).map(([id]) => id);
    });
    const left = sizes.slice();
    if (head && need > 0) {
      const ids = Array.from(new Set(nbrs(head).filter(free).map(z => comp.get(z))));
      const pend = pending, opt0 = opt;
      let ok = false;
      for (const id of ids) {
        if (left[id] < need) continue;
        left[id] -= need;
        const fit2 = i => {
          if (i === pend.length) return left.every(n => n === 0);
          for (const j of opt0[i]) if (left[j] >= pend[i].count) { left[j] -= pend[i].count; if (fit2(i + 1)) return true; left[j] += pend[i].count; }
          return false;
        };
        ok = fit2(0);
        left[id] += need;
        if (ok) break;
      }
      return ok;
    }
    const fit = i => {
      if (i === pending.length) return left.every(n => n === 0);
      for (const id of opt[i]) if (left[id] >= pending[i].count) { left[id] -= pending[i].count; if (fit(i + 1)) return true; left[id] += pending[i].count; }
      return false;
    };
    return fit(0);
  };
  const result = new Map();
  /* with opts.chooseTray each SSC's bus tray is picked here: the engineer's first, then the other */
  const solve = (si, order) => {
    if (si === order.length || !opts.chooseTray) return solveString(si, order);
    const s = order[si], pref = trayOf(s);
    for (const side of [pref, pref === 'CL' ? 'CR' : 'CL']) {
      const run = busRun(s, side), rc = runCost(run);
      if (spent + rc > allow) continue;
      chosen.set(s, side);
      for (const k of run) inc(blocks, k, 1);
      spent += rc;
      if (solveString(si, order)) return true;
      for (const k of run) inc(blocks, k, -1);
      spent -= rc;
      chosen.delete(s);
      if (budget.n < 0) break;
    }
    return false;
  };
  const solveString = (si, order) => {
    if (si === order.length) return true;
    const s = order[si], n = s.count, rest = order.slice(si + 1);
    const path = [];
    const step = (m) => {
      if (--budget.n < 0) return false;
      const prev = path[path.length - 1];
      path.push(m); taken.add(m);
      const hk = prev && prev._col !== m._col ? Math.min(prev._col, m._col) + ',' + m._row : null;
      if (hk) inc(placed, hk, 1);
      const paid = prev ? cross(prev, m) : 0;
      spent += paid;
      let ok = false;
      if (path.length === n) {
        const run = endRun(s, m), rc = runCost(run);
        if (isEnd(s, m) && (n === 1 || m !== path[0]) && spent + rc <= allow) {
          for (const k of run) inc(blocks, k, 1);
          spent += rc;
          pending = rest;
          if (feasible()) { result.set(s, path.slice()); ok = solve(si + 1, order); }
          if (!ok) { result.delete(s); for (const k of run) inc(blocks, k, -1); spent -= rc; }
        }
      } else {
        const left = n - path.length;
        const cand = nbrs(m).filter(free).filter(q => {
          if (spent + cross(m, q) > allow) return false;
          /* the path must still be able to end beside the SSC */
          return Math.max(0, Math.abs(q._col - s.comp._col) - 1) <= left - 1;
        });
        const key = new Map(cand.map(q => [q, (q._col !== m._col ? 1 : 0) + freeDeg(q) + jitter * rnd()]));
        cand.sort((a, b) => key.get(a) - key.get(b));
        pending = rest;
        for (const q of cand) {
          /* modules next to m (other than q) lose m: they must stay usable */
          pending = rest.concat([s]);
          const okNb = nbrs(m).every(z => !free(z) || z === q || (() => { const d = freeDeg(z, nbrs(q).includes(z) ? 1 : 0); return d >= 2 || (d >= 1 && anyEnd(z)); })());
          if (!okNb) continue;
          /* the rest of the rack must still split into whole strings */
          pending = rest;
          taken.add(q);
          const fits = feasible(q, n - path.length - 1);
          taken.delete(q);
          if (!fits) continue;
          if (step(q)) { ok = true; break; }
          if (budget.n < 0) break;
        }
      }
      if (!ok) { path.pop(); taken.delete(m); if (hk) inc(placed, hk, -1); spent -= paid; }
      return ok;
    };
    /* M1: a free module beside the SSC whose S- run is clear, nearest first */
    const sy = (s.comp.y0 + s.comp.y1) / 2;
    const h = g.mods.length ? (g.mods[0].y1 - g.mods[0].y0) : 1;
    const skey = new Map(g.mods.filter(m => free(m) && isEnd(s, m)).map(m => [m, Math.abs((m.y0 + m.y1) / 2 - sy) / h + freeDeg(m) * 0.1 + jitter * rnd()]));
    const starts = Array.from(skey.keys()).sort((a, b) => skey.get(a) - skey.get(b));
    pending = rest.concat([s]);
    for (const d of starts) {
      const run = endRun(s, d), rc = runCost(run);
      if (spent + rc > allow) continue;
      for (const k of run) inc(blocks, k, 1);
      spent += rc;
      const ok = step(d);
      if (ok) return true;
      for (const k of run) inc(blocks, k, -1);
      spent -= rc;
      if (budget.n < 0) return false;
    }
    return false;
  };
  /* try a few SSC orders: the most boxed-in SSC first, then from either edge of the rack */
  const edge = s => Math.min(s.comp._col, cols.length - 1 - s.comp._col);
  const room = s => g.mods.filter(m => isEnd(s, m)).length;
  const orders = opts.order ? [opts.order] : [
    sscs.slice().sort((a, b) => edge(a) - edge(b) || room(a) - room(b)),
    sscs.slice().sort((a, b) => room(a) - room(b) || edge(a) - edge(b)),
    sscs.slice().sort((a, b) => a.comp._col - b.comp._col || b.comp.y0 - a.comp.y0),
    sscs.slice().sort((a, b) => b.comp._col - a.comp._col || b.comp.y0 - a.comp.y0)];
  const allows = opts.allow != null ? [opts.allow] : [0];
  /* many short attempts beat one long one: the first few follow the orders above exactly,
     the rest shuffle neighbouring SSCs and break ties at random (seeded, so repeatable) */
  const tries = opts.tries || 12;
  const share = Math.max(1500, Math.floor(budget.n / tries / allows.length));
  const attempts = [];
  for (const a of allows) for (let t = 0; t < tries; t++) attempts.push([a, t]);
  for (const [a, t] of attempts) {
    let order = orders[t % orders.length].slice();
    jitter = t < orders.length ? 0 : 3;
    if (t >= orders.length) for (let i = 0; i + 1 < order.length; i++) if (rnd() < 0.3) { const x = order[i]; order[i] = order[i + 1]; order[i + 1] = x; }
    budget.n = share; allow = a; spent = 0;
    pending = order.slice();
    if (feasible() && solve(0, order)) {
      if (opts.log) opts.log('suggestion found, allowing', a, 'crossings, try', t, 'order', order.map(s => s.name).join(','), 'steps left', budget.n);
      const out = { };
      for (const s of sscs) out[s.key] = result.get(s).map(m => m.id);
      if (opts.trays) for (const s of sscs) opts.trays[s.key] = trayOf(s);
      return out;
    }
    if (opts.log && t < orders.length) opts.log('allow', a, 'order failed', order.map(s => s.name).join(','), 'steps left', budget.n);
    taken.clear(); placed.clear(); result.clear(); chosen.clear();
  }
  return null;
}

/* ---------- group outline (union of boxes, as line segments) ---------- */
function cadwOutline(boxes) {
  const PADX = cadwU(40), PADY = cadwU(8);
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

/** Plain, storable copy of a plan (no component objects), as kept with the drawing. */
function cadWireSave(plan, key) {
  const r = v => Math.round(v * 100) / 100;
  return {
    key: key, pair: plan.pair, custom: !!plan.custom, generated: new Date().toISOString(),
    crossings: plan.crossings.slice(), warnings: plan.warnings.slice(),
    cables: plan.cables.map(c => ({ id: c.id, ssc: c.ssc, kind: c.kind, from: c.from, to: c.to, curve: !!c.curve, pts: c.pts.map(p => [r(p[0]), r(p[1])]) })),
    strings: plan.strings.map(st => ({ name: st.name, tag: st.tag, modules: st.modules.map(m => m.id),
      labels: st.labels.map(l => ({ id: l.id, text: l.text, x: r(l.x), y: r(l.y) })) })),
    outline: plan.outline.map(o => ({ ssc: o.ssc, segs: o.segs.map(sg => sg.map(p => [r(p[0]), r(p[1])])) })),
  };
}
