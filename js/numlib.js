/* ============================================================
 * WireFlow — numbering library: finished module numberings,
 * kept on this device and offered again for racks of the same
 * layout.
 * ------------------------------------------------------------
 * A rack is described as a grid: rack columns left to right,
 * module rows top to bottom, with every module, SSC and junction
 * box in its cell. The grid does not depend on the drawing's
 * scale or where the rack sits in the file, so the same rack type
 * drawn at 1:1 or 1:44 has the same layout key. A numbering is
 * stored by grid cell and mapped back onto the new drawing's
 * modules when it is used.
 * ============================================================ */

const NUMLIB_KEY = 'wireflow.numberings';
const NUMLIB_MAX = 60;

/** Grid cells of every module, SSC and junction box, and the rack's layout key. */
function numlibLayout(comps) {
  const mods = comps.filter(c => c.kind === 'module');
  if (!mods.length) return null;
  const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const W = med(mods.map(c => c.x1 - c.x0)), H = med(mods.map(c => c.y1 - c.y0));
  if (!(W > 0 && H > 0)) return null;
  /* rack columns: module centres within a third of a module width */
  const xs = mods.map(c => (c.x0 + c.x1) / 2).sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    const last = cols[cols.length - 1];
    if (last && x - last.x1 < W * 0.35) { last.x1 = x; last.sum += x; last.n++; } else cols.push({ x1: x, sum: x, n: 1 });
  }
  const colX = cols.map(c => c.sum / c.n);
  const colOf = x => { let best = 0; for (let i = 1; i < colX.length; i++) if (Math.abs(colX[i] - x) < Math.abs(colX[best] - x)) best = i; return best; };
  /* row pitch: the usual step between modules stacked in one column */
  const gaps = [];
  for (let i = 0; i < colX.length; i++) {
    const ys = mods.filter(m => colOf((m.x0 + m.x1) / 2) === i).map(m => (m.y0 + m.y1) / 2).sort((a, b) => b - a);
    for (let j = 1; j < ys.length; j++) if (ys[j - 1] - ys[j] > H * 0.5) gaps.push(ys[j - 1] - ys[j]);
  }
  const pitch = gaps.length ? med(gaps) : H;
  const top = Math.max(...mods.map(m => (m.y0 + m.y1) / 2));
  const rowOf = y => Math.round((top - y) / pitch * 2) / 2;   /* half rows: SSCs and boxes can sit between */
  const cell = c => (c.kind === 'module' ? 'M' : c.kind === 'ssc' ? 'S' : 'J') + colOf((c.x0 + c.x1) / 2) + ',' + rowOf((c.y0 + c.y1) / 2);
  const cells = new Map();
  for (const c of comps) if (c.kind === 'module' || c.kind === 'ssc' || c.kind === 'jb') cells.set(c.id, cell(c));
  const list = Array.from(cells.values());
  if (new Set(list).size !== list.length) return null;          /* two parts in one cell: not a clean grid */
  const key = list.slice().sort().join(' ');
  return {
    key: key, cols: colX.length, modules: mods.length,
    sscs: comps.filter(c => c.kind === 'ssc').length,
    cellOf: id => cells.get(id), idOf: cl => { for (const [id, v] of cells) if (v === cl) return id; return null; },
  };
}

/**
 * A finished numbering as a library entry.
 * @param {Array} comps the drawing's parts
 * @param {Array} sscs  [{comp, name, count, jbId, pair, tray}]
 * @param {Object} orders SSC component id -> module ids in order (M1 first)
 * @param {Object} info  {project, projectId, pair, tray, crossings}
 */
function numlibEntry(comps, sscs, orders, info) {
  const L = numlibLayout(comps);
  if (!L) return null;
  const out = {};
  for (const s of sscs) {
    const ids = orders[s.comp.id] || orders[s.key];
    if (!ids || !ids.length) return null;
    out[L.cellOf(s.comp.id)] = { name: s.name, count: s.count, modules: ids.map(L.cellOf),
      jb: s.jbId ? L.cellOf(s.jbId) : null, pair: s.pair || null, tray: s.tray || null };
  }
  if (Object.values(out).some(o => o.modules.some(m => !m))) return null;
  return { layout: L.key, modules: L.modules, sscs: L.sscs, cols: L.cols, strings: out,
    pair: info.pair || 'P1', tray: info.tray || null, crossings: info.crossings == null ? null : info.crossings,
    project: info.project || '', projectId: info.projectId == null ? null : info.projectId, saved: info.saved || new Date().toISOString() };
}

/** Same numbering? (same SSCs, same module order and junction boxes) */
function numlibSame(a, b) {
  return a.layout === b.layout && JSON.stringify(a.strings) === JSON.stringify(b.strings) && a.pair === b.pair && a.tray === b.tray;
}

/** Adds (or refreshes) an entry; the newest first, at most NUMLIB_MAX kept. */
function numlibAdd(lib, entry) {
  const rest = (lib || []).filter(e => !numlibSame(e, entry) && !(entry.projectId != null && e.projectId === entry.projectId && e.layout === entry.layout));
  return [entry].concat(rest).slice(0, NUMLIB_MAX);
}

/** Saved numberings for this drawing's layout, fewest crossings first, then newest. */
function numlibMatches(lib, comps) {
  const L = numlibLayout(comps);
  if (!L) return [];
  return (lib || []).filter(e => e.layout === L.key)
    .sort((a, b) => ((a.crossings == null ? 1e9 : a.crossings) - (b.crossings == null ? 1e9 : b.crossings)) || String(b.saved).localeCompare(String(a.saved)));
}

/**
 * An entry mapped onto this drawing.
 * @return {Object} {orders: SSC id -> module ids, sscs: SSC id -> {name, count, jbId, pair, tray}, pair, tray}
 *   or {error} when it does not fit (other layout, or the SSC module counts differ).
 */
function numlibApply(entry, comps, counts) {
  const L = numlibLayout(comps);
  if (!L || L.key !== entry.layout) return { error: 'This saved numbering is for a different rack layout.' };
  const orders = {}, sscs = {};
  const diff = [];
  for (const cl in entry.strings) {
    const st = entry.strings[cl];
    const sid = L.idOf(cl);
    if (!sid) return { error: 'An SSC of the saved numbering is missing on this drawing.' };
    const ids = st.modules.map(m => L.idOf(m));
    if (ids.some(id => !id)) return { error: 'A module of the saved numbering is missing on this drawing.' };
    if (counts && counts[sid] && counts[sid] !== ids.length) diff.push(st.name + ' has ' + counts[sid] + ' modules here, ' + ids.length + ' in the saved numbering');
    orders[sid] = ids;
    sscs[sid] = { name: st.name, count: ids.length, jbId: st.jb ? L.idOf(st.jb) : null, pair: st.pair, tray: st.tray };
  }
  if (diff.length) return { error: 'The SSC module counts differ: ' + diff.join('; ') + '.' };
  return { orders: orders, sscs: sscs, pair: entry.pair, tray: entry.tray };
}

/* ---- storage on this device (wrapped: private windows may refuse it) ---- */
function numlibLoad() {
  try { const v = JSON.parse((typeof wfStorage !== 'undefined' ? wfStorage : localStorage).getItem(NUMLIB_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function numlibStore(lib) {
  try { (typeof wfStorage !== 'undefined' ? wfStorage : localStorage).setItem(NUMLIB_KEY, JSON.stringify(lib)); return true; } catch (e) { return false; }
}
