/* ============================================================
 * AYK WireFlow — physical module numbering (M1 … MN)
 * ------------------------------------------------------------
 * The numbering is a PHYSICAL property of the rack, not a
 * logical one. It decides how much cable the job needs:
 *
 *   - the chain must start and end next to the SSC, because
 *     M1 and MN are the two module-to-SSC harness ends;
 *   - device slots (SSC, ACDP, MSM, junction box) are not
 *     battery modules and are skipped by the chain;
 *   - every hop between two module slots that are NOT physical
 *     neighbours needs the long jumper (R09 / R10) instead of
 *     the approved short jumper (R07 / R08).
 *
 * So the numbering has to be chosen — not assumed. Two modes:
 *
 *   AUTO    the engine enumerates traversal patterns (serpentine,
 *           straight raster, nearest-neighbour + 2-opt from the
 *           SSC or from any corner), scores each one with the
 *           real cable it produces and ranks them, so the
 *           engineer picks the shortest.
 *   CUSTOM  the engineer clicks the module slots on the imported
 *           rack drawing in the order he wants, then edits it.
 *
 * Depends on engine.js (DEFAULT_RULES, harnessCatalogue,
 * pickHarness, applyDeduction) — same script scope in the browser
 * and concatenated ahead of this file in the Node test harness.
 * ============================================================ */

/* Slot contents. Only `module` cells take a number. */
const RACK_CELL_KINDS = [
  { key: 'module', label: 'Battery module',      numbered: true,  color: '#e2e8f0', short: '' },
  { key: 'ssc',    label: 'SSC (string control)', numbered: false, color: '#c7d2fe', short: 'SSC' },
  { key: 'acdp',   label: 'ACDP (AC distribution)', numbered: false, color: '#bae6fd', short: 'ACDP' },
  { key: 'msm',    label: 'MSM (main switch)',   numbered: false, color: '#fde68a', short: 'MSM' },
  { key: 'jb',     label: 'Junction box',         numbered: false, color: '#ddd6fe', short: 'JB' },
  { key: 'empty',  label: 'Empty / spare slot',   numbered: false, color: '#f8fafc', short: '' },
];

/** @param {string} key Cell kind. @return {Object} Kind record (module fallback). */
function rackKind(key) {
  for (let i = 0; i < RACK_CELL_KINDS.length; i++) {
    if (RACK_CELL_KINDS[i].key === key) return RACK_CELL_KINDS[i];
  }
  return RACK_CELL_KINDS[0];
}

/** @param {*} v Value. @param {number} d Fallback. @return {number} Finite number. */
function rackNum(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}

/** @param {number} c Column. @param {number} r Row. @return {string} Slot key. */
function slotKey(c, r) { return String(c) + ',' + String(r); }

/**
 * Parses a slot key.
 * @param {string} id Slot key "c,r".
 * @return {Object|null} {c, r} or null when malformed.
 */
function slotCell(id) {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(id == null ? '' : id));
  if (!m) return null;
  return { c: +m[1], r: +m[2] };
}

/* ---------------- rack model ---------------- */

/**
 * Builds a starting rack: three columns of modules plus a bottom
 * device row (ACDP · MSM · SSC, left to right) — the arrangement
 * seen on the AYK rack front views.
 * @param {number} modulesPerString Module count to accommodate.
 * @return {Object} Rack model.
 */
function defaultRack(modulesPerString) {
  const need = Math.max(1, Math.round(rackNum(modulesPerString, 24)) || 24);
  const cols = 3;
  const moduleRows = Math.ceil(need / cols);
  const rows = moduleRows + 1;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const last = r === rows - 1;
      const idx = r * cols + c;
      let kind = 'module';
      let label = '';
      if (last) {
        kind = c === 0 ? 'acdp' : (c === 1 ? 'msm' : 'ssc');
        label = rackKind(kind).short;
      } else if (idx >= need) {
        kind = 'empty';
      }
      cells.push({ c: c, r: r, kind: kind, label: label });
    }
  }
  return {
    cols: cols, rows: rows,
    /* Physical geometry in millimetres — used for span estimates and
       for the shortest-path search. Editable per project; the defaults
       are a rack whose neighbours the approved jumpers still reach. */
    pitchX: 420, pitchY: 240,
    moduleW: 380, moduleH: 210,
    termInsetY: 50,
    /* Terminal panel positions as a fraction of the module face:
       communication pair on the LEFT, power pair on the RIGHT. */
    commFrac: 0.23, powerFrac: 0.77,
    cells: cells,
  };
}

/**
 * Normalises a rack record (clamps sizes, fills the cell grid).
 * @param {Object} rack Raw rack (may be null).
 * @return {Object} Usable rack model.
 */
function rackEnsure(rack) {
  const r0 = rack || {};
  const cols = Math.min(12, Math.max(1, Math.round(rackNum(r0.cols, 3))));
  const rows = Math.min(24, Math.max(1, Math.round(rackNum(r0.rows, 9))));
  const src = Array.isArray(r0.cells) ? r0.cells : [];
  const byIdx = new Map();
  for (let i = 0; i < src.length; i++) {
    const cell = src[i];
    if (!cell) continue;
    const c = Math.round(rackNum(cell.c, -1)), r = Math.round(rackNum(cell.r, -1));
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    byIdx.set(r * cols + c, {
      c: c, r: r,
      kind: rackKind(cell.kind).key,
      label: String(cell.label == null ? rackKind(cell.kind).short : cell.label),
    });
  }
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(byIdx.get(r * cols + c) || { c: c, r: r, kind: 'module', label: '' });
    }
  }
  return {
    cols: cols, rows: rows,
    pitchX: Math.max(50, rackNum(r0.pitchX, 420)),
    pitchY: Math.max(50, rackNum(r0.pitchY, 240)),
    moduleW: Math.max(30, rackNum(r0.moduleW, 380)),
    moduleH: Math.max(30, rackNum(r0.moduleH, 210)),
    termInsetY: Math.max(0, rackNum(r0.termInsetY, 50)),
    commFrac: Math.min(0.9, Math.max(0.05, rackNum(r0.commFrac, 0.23))),
    powerFrac: Math.min(0.95, Math.max(0.1, rackNum(r0.powerFrac, 0.77))),
    cells: cells,
  };
}

/**
 * Reads one cell.
 * @param {Object} rack Rack model.
 * @param {number} c Column.
 * @param {number} r Row.
 * @return {Object|null} Cell record or null when outside the rack.
 */
function rackCell(rack, c, r) {
  if (!rack || !Array.isArray(rack.cells)) return null;
  const cols = rack.cols || 1;
  if (c < 0 || r < 0 || c >= cols) return null;
  const i = r * cols + c;
  const cell = rack.cells[i];
  if (cell && cell.c === c && cell.r === r) return cell;
  for (let k = 0; k < rack.cells.length; k++) {
    if (rack.cells[k] && rack.cells[k].c === c && rack.cells[k].r === r) return rack.cells[k];
  }
  return null;
}

/** @param {Object} rack Rack. @param {string} id Slot key. @return {boolean} True when the slot holds a battery module. */
function rackIsModule(rack, id) {
  const cell = slotCell(id);
  if (!cell) return false;
  const rec = rackCell(rack, cell.c, cell.r);
  return !!rec && rec.kind === 'module';
}

/**
 * All module slots in reading order (row by row, left to right).
 * @param {Object} rack Rack model.
 * @return {Array<string>} Slot keys.
 */
function rackModuleCells(rack) {
  const out = [];
  if (!rack || !Array.isArray(rack.cells)) return out;
  for (let i = 0; i < rack.cells.length; i++) {
    const cell = rack.cells[i];
    if (cell && cell.kind === 'module') out.push(slotKey(cell.c, cell.r));
  }
  return out;
}

/**
 * All slots holding a given device kind.
 * @param {Object} rack Rack model.
 * @param {string} kind Device kind key.
 * @return {Array<string>} Slot keys.
 */
function rackDeviceCells(rack, kind) {
  const out = [];
  if (!rack || !Array.isArray(rack.cells)) return out;
  for (let i = 0; i < rack.cells.length; i++) {
    const cell = rack.cells[i];
    if (cell && cell.kind === kind) out.push(slotKey(cell.c, cell.r));
  }
  return out;
}

/* ---------------- geometry (millimetres) ---------------- */

/**
 * Terminal / centre point of a slot in rack millimetres.
 * @param {Object} rack Rack model.
 * @param {string} id Slot key.
 * @param {string} which 'power' | 'comm' | anything else = slot centre.
 * @return {Object} {x, y} in mm.
 */
function rackPoint(rack, id, which) {
  const cell = slotCell(id);
  if (!cell) return { x: 0, y: 0 };
  const pitchX = rackNum(rack && rack.pitchX, 420);
  const pitchY = rackNum(rack && rack.pitchY, 240);
  const mw = rackNum(rack && rack.moduleW, 380);
  const mh = rackNum(rack && rack.moduleH, 210);
  const x0 = cell.c * pitchX, y0 = cell.r * pitchY;
  const rec = rackCell(rack, cell.c, cell.r);
  if (!rec || rec.kind !== 'module') return { x: x0 + mw / 2, y: y0 + mh / 2 };
  const inset = Math.min(mh * 0.5, rackNum(rack && rack.termInsetY, 50));
  const frac = which === 'power'
    ? rackNum(rack && rack.powerFrac, 0.77)
    : rackNum(rack && rack.commFrac, 0.23);
  return { x: x0 + mw * frac, y: y0 + mh - inset };
}

/** @param {Object} a Point. @param {Object} b Point. @return {number} Distance in mm. */
function rackDist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

/**
 * Straight span between two slots for one network.
 * @param {Object} rack Rack model.
 * @param {string} a Slot key.
 * @param {string} b Slot key.
 * @param {string} network 'power' | 'comm'.
 * @return {number} Millimetres.
 */
function rackSpan(rack, a, b, network) {
  return rackDist(rackPoint(rack, a, network), rackPoint(rack, b, network));
}

/**
 * Cable cost of one hop: the power jumper plus the communication
 * jumper that physically have to span it.
 * @param {Object} rack Rack model.
 * @param {string} a Slot key.
 * @param {string} b Slot key.
 * @return {number} Millimetres of cable.
 */
function rackHopCost(rack, a, b) {
  return rackSpan(rack, a, b, 'power') + rackSpan(rack, a, b, 'comm');
}

/**
 * Classifies the hop between two numbered slots.
 * @param {Object} rack Rack model.
 * @param {string} a Slot key.
 * @param {string} b Slot key.
 * @return {string} 'adjacent' | 'column' | 'gap'.
 */
function numberingHopKind(rack, a, b) {
  const ca = slotCell(a), cb = slotCell(b);
  if (!ca || !cb) return 'gap';
  const dc = Math.abs(ca.c - cb.c), dr = Math.abs(ca.r - cb.r);
  if (dc + dr === 1) return 'adjacent';
  if (dc >= 1) return 'column';
  return 'gap';
}

/* ---------------- scoring ---------------- */

/**
 * Scores one numbering order with the cable it actually produces.
 *
 * routed lengths follow the approved rules (short jumper when the
 * two slots are physical neighbours, long jumper otherwise), the
 * manufactured lengths come from the approved catalogue, and the
 * geometric span is reported alongside so a layout that fits the
 * catalogue but wastes copper can be spotted.
 *
 * @param {Object} rack Rack model.
 * @param {Object} rules Engine rules.
 * @param {Array<string>} order Numbered slot keys (M1 first).
 * @return {Object} Metrics record.
 */
function numberMetrics(rack, rules, order) {
  const r = Object.assign({}, DEFAULT_RULES, rules || {});
  const N = Math.max(1, Math.round(rackNum(r.modulesPerString, 24)));
  const S = Math.max(1, Math.round(rackNum(r.strings, 1)));
  const cat = harnessCatalogue(r);
  const ids = (Array.isArray(order) ? order : []).filter(id => rackIsModule(rack, id));
  const sscCells = rackDeviceCells(rack, 'ssc');
  /* Longest approved harness per network — a hop that spans more than this
     cannot be built from the catalogue at all. */
  const capP = cat.reduce((m, h) => h.network === 'power' ? Math.max(m, h.length) : m, 0);
  const capC = cat.reduce((m, h) => h.network === 'comm' ? Math.max(m, h.length) : m, 0);

  let bomMm = 0, geomMm = 0, longHops = 0, maxHopMm = 0, hops = 0, shortMm = 0;
  let overflow = 0, unnumbered = 0;

  for (let s = 0; s < S; s++) {
    const block = ids.slice(s * N, (s + 1) * N);
    if (block.length < N) unnumbered += N - block.length;
    const ssc = sscCells[s] || sscCells[0] || null;

    /* Module-to-SSC harnesses: two power + two communication per string.
       They are approved fixed lengths, so they cost the same in every
       plan — but their physical span does not, and that span decides
       whether the approved harness reaches at all. */
    if (ssc && block.length) {
      const first = block[0], last = block[block.length - 1];
      const span = rackSpan(rack, ssc, first, 'power') + rackSpan(rack, ssc, last, 'power') +
        rackSpan(rack, ssc, first, 'comm') + rackSpan(rack, ssc, last, 'comm');
      geomMm += span;
      bomMm += 2 * (+(r.m2sPowerLen) || 0) + 2 * (+(r.m2sCommLen) || 0);
      const longest = Math.max(
        rackSpan(rack, ssc, first, 'power'), rackSpan(rack, ssc, last, 'power'),
        rackSpan(rack, ssc, first, 'comm'), rackSpan(rack, ssc, last, 'comm'));
      if (longest > Math.max(+(r.m2sPowerLen) || 0, +(r.m2sCommLen) || 0)) overflow++;
    }

    for (let k = 0; k + 1 < block.length; k++) {
      const a = block[k], b = block[k + 1];
      const kind = numberingHopKind(rack, a, b);
      const routedP = applyDeduction(kind === 'adjacent' ? r.powerJumper : r.longPower, 'power', r);
      const routedC = applyDeduction(kind === 'adjacent' ? r.commJumper : r.longComm, 'comm', r);
      const hp = pickHarness(cat, 'power', routedP, r);
      const hc = pickHarness(cat, 'comm', routedC, r);
      const lenP = hp ? hp.length : routedP;
      const lenC = hc ? hc.length : routedC;
      bomMm += lenP + lenC;
      if (kind === 'adjacent') shortMm += lenP + lenC; else longHops++;
      if (!hp || !hc) overflow++;
      const spanP = rackSpan(rack, a, b, 'power'), spanC = rackSpan(rack, a, b, 'comm');
      geomMm += spanP + spanC;
      maxHopMm = Math.max(maxHopMm, spanP, spanC);
      /* A hop that spans further than the longest approved harness of its
         network can never be built from the catalogue — it needs an
         engineering release, and that outweighs a few metres of cable. */
      if (spanP > capP || spanC > capC) overflow++;
      hops++;
    }
  }

  return {
    moduleCount: ids.length,
    required: N * S,
    unnumbered: unnumbered,
    hops: hops,
    longHops: longHops,
    shortMm: Math.round(shortMm),
    bomMm: Math.round(bomMm),
    geomMm: Math.round(geomMm),
    maxHopMm: Math.round(maxHopMm),
    overflow: overflow,
  };
}

/**
 * Compares two scored plans: no unreleased cable first, then the
 * cheapest BOM, then the shortest physical span.
 * @param {Object} a Plan. @param {Object} b Plan. @return {number} Sort order.
 */
function numberPlanCompare(a, b) {
  const ma = a.metrics, mb = b.metrics;
  if (ma.overflow !== mb.overflow) return ma.overflow - mb.overflow;
  if (ma.bomMm !== mb.bomMm) return ma.bomMm - mb.bomMm;
  return ma.geomMm - mb.geomMm;
}

/* ---------------- traversal patterns ---------------- */

/**
 * Walks the rack in a fixed pattern and returns the module slots in
 * that order.
 * @param {Object} rack Rack model.
 * @param {Object} opt {major:'col'|'row', colDir, rowDir, serpentine}.
 * @return {Array<string>} Module slot keys.
 */
function rackTraverse(rack, opt) {
  const o = opt || {};
  const cols = Math.max(1, Math.round(rackNum(rack && rack.cols, 3)));
  const rows = Math.max(1, Math.round(rackNum(rack && rack.rows, 9)));
  const major = o.major === 'row' ? 'row' : 'col';
  const colDir = o.colDir < 0 ? -1 : 1;
  const rowDir = o.rowDir < 0 ? -1 : 1;
  const serpentine = o.serpentine !== false;
  const majorN = major === 'col' ? cols : rows;
  const minorN = major === 'col' ? rows : cols;
  const majorDir = major === 'col' ? colDir : rowDir;
  const minorDir = major === 'col' ? rowDir : colDir;
  const out = [];
  for (let i = 0; i < majorN; i++) {
    const mi = majorDir > 0 ? i : majorN - 1 - i;
    const flip = serpentine && i % 2 === 1;
    const dir = flip ? -minorDir : minorDir;
    for (let j = 0; j < minorN; j++) {
      const mj = dir > 0 ? j : minorN - 1 - j;
      const c = major === 'col' ? mi : mj;
      const r = major === 'col' ? mj : mi;
      const id = slotKey(c, r);
      if (rackIsModule(rack, id)) out.push(id);
    }
  }
  return out;
}

/**
 * Greedy nearest-neighbour tour through every module slot, refined
 * with 2-opt on the closed tour anchor → M1 … MN → anchor.
 * @param {Object} rack Rack model.
 * @param {Object} rules Engine rules (unused, kept for signature symmetry).
 * @param {Object} seed {anchor: slotKey} or {point: {x,y}} start preference.
 * @return {Array<string>} Module slot keys.
 */
function tspOrder(rack, rules, seed) {
  const mods = rackModuleCells(rack);
  if (mods.length < 3) return mods.slice();
  const s = seed || {};

  let start = 0, bestD = Infinity;
  for (let i = 0; i < mods.length; i++) {
    const cell = slotCell(mods[i]);
    let d;
    if (s.anchor) d = rackHopCost(rack, s.anchor, mods[i]);
    else if (s.point) d = rackDist({ x: cell.c * rack.pitchX, y: cell.r * rack.pitchY }, s.point);
    else d = 0;
    if (d < bestD) { bestD = d; start = i; }
  }

  const used = new Array(mods.length).fill(false);
  const order = [mods[start]];
  used[start] = true;
  let cur = mods[start];
  for (let k = 1; k < mods.length; k++) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < mods.length; i++) {
      if (used[i]) continue;
      const d = rackHopCost(rack, cur, mods[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    used[bi] = true;
    cur = mods[bi];
    order.push(cur);
  }
  return twoOptOrder(rack, order, s.anchor || null);
}

/**
 * 2-opt improvement of an open tour whose two ends both return to
 * the anchor (the SSC), evaluated with O(1) segment deltas.
 * @param {Object} rack Rack model.
 * @param {Array<string>} order Module slot keys.
 * @param {string|null} anchor Anchor slot key (SSC) or null.
 * @param {number} maxPasses Iteration cap.
 * @return {Array<string>} Improved order.
 */
function twoOptOrder(rack, order, anchor, maxPasses) {
  const n = order.length;
  if (n < 4) return order.slice();
  const e = (a, b) => rackHopCost(rack, a, b);
  let best = order.slice();
  let improved = true;
  let pass = 0;
  const cap = maxPasses || 120;
  while (improved && pass < cap) {
    improved = false;
    pass++;
    for (let i = 1; i < n - 1 && !improved; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = best[i - 1], b = best[i], c = best[k], d = best[k + 1];
        let delta = 0;
        delta += e(a, c) - e(a, b);
        if (d) delta += e(b, d) - e(c, d);
        if (i === 1 && anchor) delta += e(anchor, c) - e(anchor, b);
        if (k === n - 1 && anchor) delta += e(anchor, b) - e(anchor, c);
        if (delta < -0.5) {
          const seg = best.slice(i, k + 1).reverse();
          best = best.slice(0, i).concat(seg, best.slice(k + 1));
          improved = true;
          break;
        }
      }
    }
  }
  return best;
}

/* ---------------- automatic options ---------------- */

/**
 * Enumerates candidate numberings, scores them and returns the best
 * ones first. The first entry is the cheapest layout the engine can
 * find for this rack.
 * @param {Object} rack Rack model.
 * @param {Object} rules Engine rules.
 * @param {Object} opt {limit}.
 * @return {Array<Object>} Plans: {id, title, note, order, metrics}.
 */
function numberingPlans(rack, rules, opt) {
  const o = opt || {};
  const limit = Math.max(1, Math.round(rackNum(o.limit, 6)));
  const out = [];
  const seen = new Set();

  const add = (id, title, note, order) => {
    if (!order || order.length < 2) return;
    const sig = order.join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ id: id, title: title, note: note, order: order.slice(), metrics: numberMetrics(rack, rules, order) });
  };

  const corners = [
    ['top-left', 1, 1], ['bottom-left', 1, -1], ['top-right', -1, 1], ['bottom-right', -1, -1],
  ];
  for (let mi = 0; mi < 2; mi++) {
    const major = mi === 0 ? 'col' : 'row';
    for (let ci = 0; ci < corners.length; ci++) {
      for (let si = 0; si < 2; si++) {
        const serpentine = si === 0;
        const order = rackTraverse(rack, { major: major, colDir: corners[ci][1], rowDir: corners[ci][2], serpentine: serpentine });
        add(
          `${serpentine ? 'serpentine' : 'raster'}-${major}-${corners[ci][0]}`,
          `${serpentine ? 'Serpentine' : 'Straight raster'} · ${major === 'col' ? 'column by column' : 'row by row'} · start ${corners[ci][0]}`,
          serpentine ? 'Folds at the end of every ' + (major === 'col' ? 'column' : 'row') + ' — no long return run'
            : 'Restarts at the top of every ' + (major === 'col' ? 'column' : 'row') + ' — one long return run each time',
          order);
      }
    }
  }

  const sscCells = rackDeviceCells(rack, 'ssc');
  const seeds = [];
  if (sscCells.length) {
    seeds.push({ id: 'ssc', anchor: sscCells[0], title: 'Shortest path · optimised from the SSC' });
  }
  for (let ci = 0; ci < corners.length; ci++) {
    const cd = corners[ci][1], rd = corners[ci][2];
    const pt = {
      x: (cd > 0 ? 0 : (rack.cols - 1) * rack.pitchX),
      y: (rd > 0 ? 0 : (rack.rows - 1) * rack.pitchY),
    };
    seeds.push({ id: 'corner-' + corners[ci][0], point: pt, title: 'Shortest path · start ' + corners[ci][0] });
  }
  for (let i = 0; i < seeds.length; i++) {
    const order = tspOrder(rack, rules, seeds[i]);
    add('tsp-' + seeds[i].id, seeds[i].title,
      'Nearest-neighbour + 2-opt — least long-jumper count', order);
  }

  out.sort(numberPlanCompare);
  return out.slice(0, limit);
}

/* ---------------- custom (engineer-clicked) order ---------------- */

/**
 * Appends or removes a slot in a custom click order.
 * @param {Array<string>} order Current order.
 * @param {string} id Slot key.
 * @return {Array<string>} New order (a copy).
 */
function numberingToggle(order, id) {
  const out = (Array.isArray(order) ? order : []).slice();
  const at = out.indexOf(id);
  if (at >= 0) out.splice(at, 1); else out.push(id);
  return out;
}

/**
 * Completes a partial custom order: walks the remaining module slots
 * from the last numbered one, either by nearest distance or with a
 * serpentine sweep.
 * @param {Object} rack Rack model.
 * @param {Array<string>} order Partial order.
 * @param {string} how 'nearest' | 'serpentine'.
 * @return {Array<string>} Completed order.
 */
function numberingAutoFill(rack, order, how) {
  const out = (Array.isArray(order) ? order : []).filter(id => rackIsModule(rack, id));
  const rest = rackModuleCells(rack).filter(id => out.indexOf(id) < 0);
  if (!rest.length) return out;
  if (how === 'serpentine') {
    const base = rackTraverse(rack, { major: 'col', colDir: 1, rowDir: 1, serpentine: true });
    const tail = base.filter(id => out.indexOf(id) < 0);
    return out.concat(tail);
  }
  let cur = out.length ? out[out.length - 1] : rest[0];
  while (rest.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = rackHopCost(rack, cur, rest[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    cur = rest.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

/**
 * Resolves the numbering to use for a project: the saved order when
 * it is complete, otherwise the cheapest automatic plan.
 * @param {Object} project Project record.
 * @return {Object|null} {order, mode, planId, planTitle, metrics} or null.
 */
function resolveNumbering(project) {
  const cfg = (project && project.config) || {};
  const num = cfg.numbering;
  const rules = Object.assign({}, DEFAULT_RULES, cfg.rules || {});
  if (!num || !num.rack) return null;
  const rack = rackEnsure(num.rack);
  const stored = (Array.isArray(num.order) ? num.order : []).filter(id => rackIsModule(rack, id));
  const metrics = numberMetrics(rack, rules, stored);
  if (stored.length && !metrics.unnumbered) {
    return { order: stored, mode: num.mode || 'custom', planId: num.planId || null, planTitle: num.planTitle || null, metrics: metrics, rack: rack };
  }
  const plans = numberingPlans(rack, rules, { limit: 1 });
  if (!plans.length) return null;
  return {
    order: plans[0].order, mode: 'auto', planId: plans[0].id,
    planTitle: plans[0].title, metrics: plans[0].metrics, rack: rack,
  };
}

/**
 * Per-hop information for the netlist: is the hop between two
 * physical neighbours, and how long is it?
 * @param {Object} num Saved numbering block (may be null).
 * @param {Object} rules Engine rules.
 * @param {number} s String index (0-based).
 * @param {number} m Hop index (1-based: the hop M(m) → M(m+1)).
 * @return {Object|null} {kind, mm} or null when no numbering is set.
 */
function numberingHopInfo(num, rules, s, m) {
  if (!num || !num.rack || !Array.isArray(num.order) || !num.order.length) return null;
  const N = Math.max(1, Math.round(rackNum(rules && rules.modulesPerString, 24)));
  const a = num.order[s * N + (m - 1)];
  const b = num.order[s * N + m];
  if (!a || !b) return null;
  return { kind: numberingHopKind(num.rack, a, b), mm: rackSpan(num.rack, a, b, 'power') };
}

/* ---------------- sheet overlay ---------------- */

/**
 * Drawing primitives that put the physical numbering onto the
 * imported rack: a circled M-number on every module slot and a
 * label on every device slot.
 * @param {Object} project Project record.
 * @param {Object} fit Fit rectangle in sheet units {x, y, w, h}.
 * @return {Array<Object>} Sheet primitives on the NUMBER layer.
 */
function numberingSheetPrimitives(project, fit) {
  const num = project && project.config && project.config.numbering;
  if (!num || !num.rack || !Array.isArray(num.order) || !num.order.length) return [];
  const rack = rackEnsure(num.rack);
  const f = fit || {};
  const fx = rackNum(f.x, 120), fy = rackNum(f.y, 280);
  const fw = Math.max(10, rackNum(f.w, 1000)), fh = Math.max(10, rackNum(f.h, 640));
  const cw = fw / rack.cols, ch = fh / rack.rows;
  const font = Math.max(5, Math.min(18, Math.min(cw, ch) * 0.30));
  const out = [];

  for (let i = 0; i < num.order.length; i++) {
    const cell = slotCell(num.order[i]);
    if (!cell || cell.c >= rack.cols || cell.r >= rack.rows) continue;
    const cx = fx + (cell.c + 0.5) * cw;
    const cy = fy + (cell.r + 0.5) * ch;
    out.push({ type: 'circle', layer: 'NUMBER', cx: cx, cy: cy, r: Math.max(5.5, font * 0.78), fill: '#ffffff', width: 1.1 });
    out.push({ type: 'text', layer: 'NUMBER', x: cx, y: cy + font * 0.36, size: font, text: 'M' + (i + 1), anchor: 'middle', bold: true });
  }
  for (let k = 0; k < rack.cells.length; k++) {
    const cell = rack.cells[k];
    if (!cell || cell.kind === 'module' || cell.kind === 'empty') continue;
    const cx = fx + (cell.c + 0.5) * cw;
    const cy = fy + (cell.r + 0.5) * ch;
    out.push({
      type: 'text', layer: 'NUMBER', x: cx, y: cy + font * 0.3, size: font * 0.9,
      text: cell.label || rackKind(cell.kind).short, anchor: 'middle', bold: true,
    });
  }
  return out;
}

/* ---------------- preview ---------------- */

/**
 * Small SVG of a rack with one numbering drawn on it — used for the
 * option list so the engineer can see the pattern, not just read a
 * number.
 * @param {Object} rack Rack model.
 * @param {Array<string>} order Numbered slot keys.
 * @param {Object} opt {width, height, showChain}.
 * @return {string} SVG markup.
 */
function numberingPreviewSVG(rack, order, opt) {
  const o = opt || {};
  const w = rackNum(o.width, 220), h = rackNum(o.height, 150);
  const pad = 8;
  const g = rackEnsure(rack);
  const cw = (w - pad * 2) / g.cols, ch = (h - pad * 2) / g.rows;
  const font = Math.max(5, Math.min(12, Math.min(cw, ch) * 0.36));
  const rank = new Map();
  (Array.isArray(order) ? order : []).forEach((id, i) => rank.set(id, i + 1));
  const parts = [];
  parts.push('<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" ' +
    'font-family="Helvetica, Arial, sans-serif" style="width:100%;height:auto;display:block">');
  parts.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#f8fafc" stroke="#cbd5e1"/>');

  const centre = id => {
    const cell = slotCell(id);
    return { x: pad + (cell.c + 0.5) * cw, y: pad + (cell.r + 0.5) * ch };
  };
  if (o.showChain !== false && Array.isArray(order) && order.length > 1) {
    const pts = order.map(centre);
    parts.push('<polyline points="' + pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') +
      '" fill="none" stroke="#f97316" stroke-width="1.4" stroke-linejoin="round"/>');
  }
  for (let k = 0; k < g.cells.length; k++) {
    const cell = g.cells[k];
    const x = pad + cell.c * cw, y = pad + cell.r * ch;
    const id = slotKey(cell.c, cell.r);
    const fill = rackKind(cell.kind).color;
    parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (cw - 1.5).toFixed(1) +
      '" height="' + (ch - 1.5).toFixed(1) + '" rx="2" fill="' + fill + '" stroke="#94a3b8" stroke-width="0.6"/>');
    const n = rank.get(id);
    if (n) {
      parts.push('<text x="' + (x + cw / 2 - 0.75).toFixed(1) + '" y="' + (y + ch / 2 + font * 0.36).toFixed(1) +
        '" text-anchor="middle" style="font-size:' + font.toFixed(1) + 'px;font-weight:700" fill="#0f172a">' + n + '</text>');
    } else if (cell.kind !== 'module') {
      const t = cell.label || rackKind(cell.kind).short;
      if (t) {
        parts.push('<text x="' + (x + cw / 2 - 0.75).toFixed(1) + '" y="' + (y + ch / 2 + font * 0.36).toFixed(1) +
          '" text-anchor="middle" style="font-size:' + (font * 0.86).toFixed(1) + 'px;font-weight:700" fill="#334155">' +
          String(t).replace(/[<>&]/g, '') + '</text>');
      }
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
