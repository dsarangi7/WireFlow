/* ============================================================
 * WireFlow — A3 wiring sheet in AYK's DWG2396 format
 * ------------------------------------------------------------
 * One layout, two outputs: the on-screen sheet editor (SVG) and
 * the PDF (js/pdf.js). Sheet coordinates are millimetres on an
 * A3 landscape page, origin bottom-left, Y up.
 * Only the title-block fields are editable; everything else in
 * the format is fixed.
 * A rack can take several sheets (AYK DWG2586): every sheet draws the
 * whole rack, the wiring of the SSC strings given to it, and a purple
 * outline round the strings wired on another sheet ("Please see
 * sheet 3, SSC6 & SSC7, for wiring connections.").
 * ============================================================ */

const A3_W = 420, A3_H = 297;
const SHEET_SCALES = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
const SHEET_COLORS = { power: '#e11d1d', comm: '#16a34a', plugA: '#0ea5e9', plugB: '#f2b600', label: '#7c3aed', rack: '#1f2937' };
const SHEET_AREA = { x0: 14, y0: 80, x1: 406, y1: 283 };   // drawing area above the bottom strip
const SHEET_PT = 25.4 / 72;                                   // one typographic point in mm

/** Splits a paragraph into lines no wider than `width` mm at font size `size` mm. */
function sheetWrap(text, size, width, bold) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && pdfTextWidth(next, size, bold) > width) { out.push(line); line = word; }
    else line = next;
  }
  if (line) out.push(line);
  return out;
}

function sheetDefaults(name) {
  const d = new Date();
  const date = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  return {
    docNumber: '', docType: 'Wiring Diagram', designNumber: '', designName: name || '',
    bankSize: '', bankWeight: '', scale: 'auto', sheet: '1 OF 1',
    revs: [{ rev: '0', date: date, desn: '', dran: '', chkd: '', states: '', notes: 'Initial Released' }],
  };
}
/** Settings with defaults filled in (fields, plugs, labels, edits). */
function sheetSettings(saved, name) {
  const s = saved || {};
  const f = Object.assign(sheetDefaults(name), s.fields || {});
  if (!Array.isArray(f.revs) || !f.revs.length) f.revs = sheetDefaults(name).revs;
  return { fields: f, plugs: s.plugs !== false, edits: Object.assign({ cables: {}, labels: {}, kinds: {}, ground: null, plugLabel: null }, s.edits || {}),
    pages: Object.assign({ count: 1, of: {}, notes: {} }, s.pages || {}),
    racks: Array.isArray(s.racks) ? s.racks.slice() : [] };
}

/* ---------------- several racks on one sheet ---------------- */
/**
 * Racks of one project drawn side by side on one sheet (AYK DWG2586 sheet 2: Rack 2 and Rack 3).
 * racks: [{ key, name, flat, wiring, components, parts, jbs, unit }], the sheet's own rack first.
 * Every further rack is scaled to the first rack's drawing units and set gapMm (real mm) to the
 * right of the one before, bottoms level; its ids get the rack's key, so its edits stay its own,
 * and an SSC name another rack already has is given the rack's name ("Rack 3 SSC1").
 * Returns one model: { flat, jbs, parts, wiring, components, ground0, grounds, racks }.
 */
function sheetMergeRacks(racks, gapMm) {
  const u0 = racks[0].unit > 0 ? racks[0].unit : 1;
  const out = { flat: { polylines: [], circles: [], texts: [], bounds: null }, jbs: [], parts: [], components: [], grounds: [], racks: [],
    wiring: { cables: [], strings: [], outline: [], crossings: [], portHits: [], warnings: [] } };
  const names = new Set(), linkNames = new Map(), ends = [];
  let right = null, floor = null, anyWiring = false;
  racks.forEach((r, i) => {
    const B = r.flat.bounds, k = u0 / (r.unit > 0 ? r.unit : 1);
    const dx = i ? right + gapMm * u0 - B.minX * k : 0, dy = i ? floor - B.minY * k : 0;
    const X = x => x * (i ? k : 1) + dx, Y = y => y * (i ? k : 1) + dy, sc = i ? k : 1;
    const pt = p => [X(p[0]), Y(p[1])];
    const pre = i ? r.key + ':' : '';
    const box = c => Object.assign({}, c, { id: pre + c.id, x0: X(c.x0), y0: Y(c.y0), x1: X(c.x1), y1: Y(c.y1) });
    for (const p of r.flat.polylines) { const a = p.pts, q = new Array(a.length); for (let j = 0; j < a.length; j += 2) { q[j] = X(a[j]); q[j + 1] = Y(a[j + 1]); } out.flat.polylines.push(Object.assign({}, p, { pts: q })); }
    for (const c of r.flat.circles) out.flat.circles.push(Object.assign({}, c, { cx: X(c.cx), cy: Y(c.cy), r: c.r * sc }));
    for (const t of r.flat.texts || []) out.flat.texts.push(Object.assign({}, t, { x: X(t.x), y: Y(t.y), h: (t.h || 0) * sc }));
    const b = { minX: X(B.minX), minY: Y(B.minY), maxX: X(B.maxX), maxY: Y(B.maxY) };
    const ob = out.flat.bounds;
    out.flat.bounds = ob ? { minX: Math.min(ob.minX, b.minX), minY: Math.min(ob.minY, b.minY), maxX: Math.max(ob.maxX, b.maxX), maxY: Math.max(ob.maxY, b.maxY) } : b;
    if (i === 0) floor = b.minY;
    right = b.maxX;
    out.racks.push({ key: r.key, name: r.name, bounds: b });
    for (const j of r.jbs || []) out.jbs.push(box(j));
    for (const c of r.components || []) out.components.push(box(c));
    for (const p of r.parts || []) out.parts.push(Object.assign({}, p, { id: pre + p.id, x: X(p.x), y: Y(p.y) }));
    /* every rack's own grounding point (the sheet's rack keeps the draggable one) */
    const g = sheetGroundPoint(r.flat, B, r.unit), gp = { x: X(g.x), y: Y(g.y), r: g.r * sc };
    if (i) out.grounds.push(gp); else out.ground0 = gp;
    const W = r.wiring;
    if (!W) return;
    anyWiring = true;
    const rename = new Map();
    /* a string across racks (its SSC here, its modules there, or the other way) keeps its name */
    const linkOf = name => { const c = W.cables.find(k => k.ssc === name && k.link); return c ? c.link.key : null; };
    for (const st of W.strings) {
      let n = st.name;
      const lk = linkOf(st.name);
      if (names.has(n) && !(lk && linkNames.get(lk) === n)) n = (r.name || r.key) + ' ' + n;
      names.add(n); rename.set(st.name, n);
      if (lk) linkNames.set(lk, n);
    }
    const nm = n => rename.get(n) || n;
    /* each lead to the ceiling: its end there (the SSC rack's lead ends at the ceiling, the module
       rack's starts at it) */
    for (const c of W.cables) if (c.link) { const p = c.to === 'ceiling' ? c.pts[c.pts.length - 1] : c.pts[0]; ends.push({ key: c.link.key, role: c.link.role, kind: c.kind, id: pre + c.id, ssc: nm(c.ssc), at: pt(p) }); }
    for (const c of W.cables) out.wiring.cables.push(Object.assign({}, c, { id: pre + c.id, ssc: nm(c.ssc), pts: c.pts.map(pt),
      ways: c.ways ? c.ways.map(w => Object.assign({}, w, { pts: w.pts.map(pt) })) : undefined }));
    for (const st of W.strings) out.wiring.strings.push(Object.assign({}, st, { name: nm(st.name), modules: (st.modules || []).map(m => pre + m),
      labels: st.labels.map(l => Object.assign({}, l, { id: pre + l.id, x: X(l.x), y: Y(l.y) })) }));
    for (const o of W.outline || []) out.wiring.outline.push({ ssc: nm(o.ssc), segs: o.segs.map(g => g.map(pt)) });
    for (const x of W.crossings || []) out.wiring.crossings.push(Object.assign({}, x, x.a ? { a: pre + x.a, b: pre + x.b } : {}));
    if (i === 0) Object.assign(out.wiring, { key: W.key, pair: W.pair, custom: W.custom, generated: W.generated });
  });
  if (!anyWiring) out.wiring = null;
  else {
    /* the two ends of each lead across racks, joined over the top of both racks */
    out.wiring.links = [];
    const used = new Set();
    for (const e of ends) {
      if (used.has(e)) continue;
      const o = ends.find(x => x !== e && !used.has(x) && x.key === e.key && x.role === e.role);
      if (!o) continue;
      used.add(e); used.add(o);
      out.wiring.links.push({ key: e.key, role: e.role, kind: e.kind, ssc: e.ssc, a: e.at, b: o.at, ids: [e.id, o.id] });
    }
  }
  return out;
}

/* ---------------- sheets of one rack ---------------- */
/** How many sheets, and which sheet each SSC string is wired on (1 unless given). */
function sheetPagesOf(st, W) {
  const pg = st.pages || { count: 1, of: {} };
  const count = Math.max(1, Math.round(+pg.count || 1));
  const of = {};
  for (const s of (W && W.strings) || []) { const n = Math.round(+((pg.of || {})[s.name])) || 1; of[s.name] = Math.min(count, Math.max(1, n)); }
  return { count: count, of: of };
}
/** One outline round a set of rectangles [x0, y0, x1, y1] (drawing units), each padded by
    padX / padY so neighbours across a cable tray join into one area: the area's boundary as
    merged straight segments. */
function sheetFence(rects, padX, padY) {
  const R = rects.map(r => [r[0] - padX, r[1] - padY, r[2] + padX, r[3] + padY]);
  if (!R.length) return [];
  const xs = Array.from(new Set(R.flatMap(r => [r[0], r[2]]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(R.flatMap(r => [r[1], r[3]]))).sort((a, b) => a - b);
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return R.some(r => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  };
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    if (!inside(i, j)) continue;
    if (!inside(i, j - 1)) segs.push([[xs[i], ys[j]], [xs[i + 1], ys[j]]]);
    if (!inside(i, j + 1)) segs.push([[xs[i], ys[j + 1]], [xs[i + 1], ys[j + 1]]]);
    if (!inside(i - 1, j)) segs.push([[xs[i], ys[j]], [xs[i], ys[j + 1]]]);
    if (!inside(i + 1, j)) segs.push([[xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]]);
  }
  const merged = [];
  for (const horiz of [true, false]) {
    const list = segs.filter(g => (g[0][1] === g[1][1]) === horiz).sort((a, b) => horiz ? (a[0][1] - b[0][1] || a[0][0] - b[0][0]) : (a[0][0] - b[0][0] || a[0][1] - b[0][1]));
    for (const g of list) {
      const m = merged[merged.length - 1];
      if (m && horiz && m[0][1] === g[0][1] && m[1][1] === g[0][1] && m[1][0] === g[0][0]) { m[1] = g[1]; continue; }
      if (m && !horiz && m[0][0] === g[0][0] && m[1][0] === g[0][0] && m[1][1] === g[0][1]) { m[1] = g[1]; continue; }
      merged.push([g[0].slice(), g[1].slice()]);
    }
  }
  return merged;
}
/** The rectangles a string covers: its modules and SSC from the drawing's parts when given,
    else the boxes of its saved dotted outline. */
function sheetStringRects(W, s, comps) {
  const outline = (W.outline || []).find(o => o.ssc === s.name);
  const box = segs => { const xs = segs.flatMap(g => [g[0][0], g[1][0]]), ys = segs.flatMap(g => [g[0][1], g[1][1]]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  if (comps && comps.length) {
    const byId = new Map(comps.map(c => [c.id, c]));
    const rects = (s.modules || []).map(id => byId.get(id)).filter(Boolean).map(c => [c.x0, c.y0, c.x1, c.y1]);
    if (outline && outline.segs.length) {
      const b = box(outline.segs);
      for (const c of comps) if (c.kind === 'ssc' && c.x0 >= b[0] && c.x1 <= b[2] && c.y0 >= b[1] && c.y1 <= b[3]) rects.push([c.x0, c.y0, c.x1, c.y1]);
    }
    if (rects.length) return rects;
  }
  return outline && outline.segs.length ? [box(outline.segs)] : [];
}
/** The SHEET field of sheet k (1-based): the title block's "1 OF 14" is the first sheet;
    the next sheets count on from it. */
function sheetNumber(F, k, count) {
  const m = String(F.sheet || '').match(/(\d+)\s*OF\s*(\d+)/i);
  const first = m ? +m[1] : 1, total = Math.max(m ? +m[2] : 1, first + count - 1);
  return { n: first + k - 1, text: `${first + k - 1} OF ${total}` };
}

/* ---------------- geometry: drawing mm -> sheet mm ---------------- */
/**
 * Places the rack on the sheet.
 * @param {Object} bounds {minX,minY,maxX,maxY} of the rack drawing.
 * @param {Array} jbs junction boxes {x0,y0,x1,y1}.
 * @param {Object} st settings from sheetSettings.
 */
function sheetPlace(bounds, jbs, st, u) {
  u = u > 0 ? u : 1;                                      // drawing units per real millimetre
  const plugTop = st.plugs && jbs.length ? Math.max(...jbs.map(j => j.y1)) + 330 * u : bounds.maxY;
  const top = Math.max(bounds.maxY, plugTop);
  const bottom = bounds.minY - 420 * u;                   // room for the grounding-point arrow and label
  const w = (bounds.maxX - bounds.minX) / u + 160, h = (top - bottom) / u;
  const aw = SHEET_AREA.x1 - SHEET_AREA.x0, ah = SHEET_AREA.y1 - SHEET_AREA.y0;
  /* scale in real millimetres (1:20 = 20 mm of rack per sheet mm), whatever the drawing's own scale */
  let scale = +st.fields.scale;
  if (!(scale > 0)) scale = SHEET_SCALES.find(sc => w / sc <= aw && h / sc <= ah) || Math.ceil(Math.max(w / aw, h / ah));
  const k = 1 / (scale * u);
  const ox = (SHEET_AREA.x0 + SHEET_AREA.x1) / 2 - ((bounds.minX + bounds.maxX) / 2) * k;
  const oy = (SHEET_AREA.y0 + SHEET_AREA.y1) / 2 - ((bottom + top) / 2) * k;
  return { scale: scale, u: u, k: k, plugTop: plugTop, X: x => ox + x * k, Y: y => oy + y * k, pt: p => [ox + p[0] * k, oy + p[1] * k] };
}

/** Power plug leads (customer side, Note 2) from the RIGHT end of every junction box. */
function sheetPlugLeads(jbs, plugTop, u) {
  u = u > 0 ? u : 1;
  return jbs.map(j => ({
    jb: j,
    a: [[j.x1 - 46 * u, j.y0 + 18 * u], [j.x1 - 14 * u, j.y1 + 42 * u], [j.x1 - 14 * u, plugTop]],
    b: [[j.x1 - 26 * u, j.y0 + 18 * u], [j.x1 + 6 * u, j.y1 + 42 * u], [j.x1 + 6 * u, plugTop]],
  }));
}

/** Grounding point: the upper hole of the lowest bolt pair on the rack's right-most
    upright (as on AYK drawings); falls back to the bottom-right corner. */
function sheetGroundPoint(flat, B, u) {
  u = u > 0 ? u : 1;
  const holes = ((flat && flat.circles) || []).filter(c => c.cx > B.maxX - 400 * u && c.cy < B.minY + 260 * u && c.r > 2 * u && c.r < 12 * u);
  if (!holes.length) return { x: B.maxX - 25 * u, y: B.minY + 12 * u, r: 0 };
  const maxX = Math.max(...holes.map(c => c.cx));
  const col = holes.filter(c => c.cx > maxX - u);
  const ys = Array.from(new Set(col.map(c => Math.round(c.cy / u * 10) / 10 * u))).sort((a, b) => a - b);
  const y = ys.length > 1 && ys[1] - ys[0] < 30 * u ? ys[1] : ys[0];
  const r = Math.max(...col.filter(c => Math.abs(c.cy - y) < 0.2 * u).map(c => c.r));
  return { x: maxX, y: y, r: r };
}

/* ---------------- SVG target with the same API as pdfDoc ---------------- */
function sheetSvgTarget() {
  const parts = [];
  const n = v => (Math.round(v * 1000) / 1000);
  const attrs = o => (o && o.id ? ` data-id="${o.id}"` : '') + (o && o.cls ? ` class="${o.cls}"` : '') + (o && o.data ? Object.keys(o.data).map(k => ` data-${k}="${String(o.data[k]).replace(/"/g, '&quot;')}"`).join('') : '');
  const strokeAttrs = o => ` fill="none" stroke="${o.color || '#000'}" stroke-width="${n(o.w == null ? 0.25 : o.w)}"${o.dash ? ` stroke-dasharray="${o.dash.map(n).join(' ')}"` : ''} stroke-linecap="round" stroke-linejoin="round"`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const api = {
    poly(pts, o) {
      o = o || {};
      const flat = Array.isArray(pts[0]) ? pts.flat() : pts;
      let d = '';
      for (let i = 0; i < flat.length; i += 2) d += (i ? ' ' : '') + n(flat[i]) + ',' + n(flat[i + 1]);
      const tag = o.close ? 'polygon' : 'polyline';
      const fill = o.fill ? ` fill="${o.fill}"` : '';
      parts.push(`<${tag} points="${d}"${o.stroke === false ? ` fill="${o.fill}" stroke="none"` : strokeAttrs(o).replace(' fill="none"', fill || ' fill="none"')}${attrs(o)}/>`);
      /* wide invisible twin so thin cables are easy to grab in the editor */
      if (o.hit) parts.push(`<${tag} points="${d}" fill="none" stroke="transparent" stroke-width="2.4" class="sh-hit" data-id="${o.id}"/>`);
      return api;
    },
    line(x1, y1, x2, y2, o) { return api.poly([x1, y1, x2, y2], o); },
    rect(x, y, w, h, o) {
      o = o || {};
      parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.stroke === false ? ` fill="${o.fill}" stroke="none"` : strokeAttrs(o).replace(' fill="none"', o.fill ? ` fill="${o.fill}"` : ' fill="none"')}${attrs(o)}/>`);
      return api;
    },
    circle(cx, cy, r, o) {
      o = o || {};
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${o.fill && o.stroke === false ? ` fill="${o.fill}" stroke="none"` : strokeAttrs(o).replace(' fill="none"', o.fill ? ` fill="${o.fill}"` : ' fill="none"')}${attrs(o)}/>`);
      return api;
    },
    text(str, x, y, o) {
      o = o || {};
      const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
      const rot = o.rot ? ` rotate(${-o.rot})` : '';
      parts.push(`<text transform="translate(${n(x)} ${n(y)}) scale(1 -1)${rot}" font-family="Arial, Helvetica, sans-serif" font-size="${n(o.size || 2.5)}"${o.bold ? ' font-weight="700"' : ''} fill="${o.color || '#000'}" text-anchor="${anchor}"${attrs(o)}>${esc(pdfNorm(str))}</text>`);
      return api;
    },
    image(src, pxW, pxH, x, y, w, h) {
      parts.push(`<image href="${src}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" transform="translate(0 ${n(2 * y + h)}) scale(1 -1)" preserveAspectRatio="xMidYMid meet"/>`);
      return api;
    },
    group(open, o) { parts.push(open ? `<g${attrs(o)}>` : '</g>'); return api; },
    svg() { return parts.join(''); },
  };
  return api;
}

/* ---------------- the fixed format (frame, notes, legend, title block) ---------------- */
function sheetFrame(doc, st, nStrings, logo) {
  const F = st.fields;
  const thin = { w: 0.18 }, med = { w: 0.35 }, bold = { w: 0.6 };
  /* border and zone marks: 8 columns (8 … 1 from left), 6 rows (A … F from bottom) */
  doc.rect(5, 5, 410, 287, med).rect(10, 10, 400, 277, bold);
  for (let i = 0; i < 8; i++) {
    const x = 10 + i * 50;
    if (i) { doc.line(x, 5, x, 10, thin); doc.line(x, 287, x, 292, thin); }
    doc.text(String(8 - i), x + 25, 6.6, { size: 2.6, align: 'center' });
    doc.text(String(8 - i), x + 25, 288.6, { size: 2.6, align: 'center' });
  }
  const rh = 277 / 6;
  for (let i = 0; i < 6; i++) {
    const y = 10 + i * rh;
    if (i) { doc.line(5, y, 10, y, thin); doc.line(410, y, 415, y, thin); }
    const L = 'ABCDEF'[i];
    doc.text(L, 7.5, y + rh / 2 - 1, { size: 2.6, align: 'center' });
    doc.text(L, 412.5, y + rh / 2 - 1, { size: 2.6, align: 'center' });
  }

  /* bottom strip */
  const y0 = 10, y1 = 55;
  doc.line(10, y1, 410, y1, med);
  doc.line(112, y0, 112, y1, med).line(198, y0, 198, y1, med).line(250, y0, 250, y1, med);
  /* notes (fixed) */
  /* 9 pt bold, wrapped to the 100 mm notes box (1 pt = 0.3528 mm) */
  const NOTE = 9 * SHEET_PT, step = NOTE * 1.3;
  const notes = ['Note:'];
  for (const para of [
    "1. Customer can chose a single point to connect a wiring by using a M6_L16_Button Screw, and let this wiring connect to the customer's grounding point.",
    '2. This cable is made by customer. Power Cable: 1*95mm², 0.6kV/1kV, Flame retardant properties according to IEC 60332. Please refer to TN0088 Junction Box Installation and Wiring Instructions for connection requirements.',
  ]) notes.push(...sheetWrap(para, NOTE, 98, true));
  notes.forEach((t, i) => doc.text(t, 12, 51 - NOTE * 0.75 - i * step, { size: NOTE, bold: true }));
  /* confidentiality (fixed) */
  ['UNLESS OTHERWISE NOTED, THIS DOCUMENT', 'CONTAINS AYK POWER LTD. CONFIDENTIAL', 'INFORMATION. REPRODUCTION, USE, DISCLOSURE OR',
    'TRANSMITTAL OF ALL OR ANY PORTION OF THIS', 'DOCUMENT IS PROHIBITED, EXCEPT TO THE EXTENT', 'APPROVED BY AYK POWER LTD.. AYK POWER LTD.',
    'EXPRESSLY RESERVES ALL RIGHTS UNDER PATENTS,', 'TRADEMARKS, COPYRIGHTS AND TRADE SECRETS.', 'COPYRIGHT (C) 2023, AYK POWER LTD.']
    .forEach((t, i) => doc.text(t, 114, 50 - i * 4.3, { size: 2.05 }));
  /* tolerances (fixed) */
  doc.text('UNLESS OTHERWISE SPECIFIED', 200, 51, { size: 2.1 });
  doc.line(198, 48.5, 250, 48.5, thin);
  ['DIMENSIONS ARE IN MM', 'TOLERANCES:', 'ANGULAR: ±0.5°', 'LINEAR', 'X        = ±0.5', 'X.X     = ±0.1', 'X.XX   = ±0.05']
    .forEach((t, i) => doc.text(t, 200, 45 - i * 3.9, { size: 2.1 }));
  doc.line(198, 17, 250, 17, thin);
  doc.text('DO NOT SCALE DRAWING', 224, 12.4, { size: 2.2, align: 'center' });

  /* title block: the editable part (revision rows + document fields) */
  const tb = { x0: 250, x1: 410, mid: 355 };
  doc.line(tb.mid, y0, tb.mid, y1, med);
  const cols = [250, 259, 276, 291, 306, 321, 334, 355];
  const heads = ['REV.', 'DATE', 'DESN BY', 'DRAN BY', 'CHKD BY', 'STATES', 'NOTES'];
  const rowY = [55, 49.5, 44, 38.5, 33, 27.5];
  rowY.slice(1).forEach(y => doc.line(250, y, 355, y, thin));
  cols.slice(1, -1).forEach(x => doc.line(x, 27.5, x, 55, thin));
  heads.forEach((h, i) => doc.text(h, (cols[i] + cols[i + 1]) / 2, 51.3, { size: 1.75, bold: true, align: 'center' }));
  (F.revs || []).slice(0, 4).forEach((r, ri) => {
    const vals = [r.rev, r.date, r.desn, r.dran, r.chkd, r.states, r.notes];
    vals.forEach((v, i) => { if (v) doc.text(v, (cols[i] + cols[i + 1]) / 2, rowY[ri + 2] + 1.9, { size: 1.75, align: 'center' }); });
  });
  doc.line(250, 27.5, 355, 27.5, med);
  /* projection symbol, sheet size, bank size / weight, scale, sheet */
  doc.line(276, 10, 276, 27.5, thin).line(291, 10, 291, 27.5, thin).line(323, 10, 323, 27.5, thin);
  doc.line(291, 18.5, 355, 18.5, thin);
  doc.circle(259.5, 18.75, 3.6, thin).circle(259.5, 18.75, 1.6, thin);
  doc.line(254.5, 18.75, 264.5, 18.75, { w: 0.12 }).line(259.5, 13.75, 259.5, 23.75, { w: 0.12 });
  doc.poly([[266, 16.6], [266, 20.9], [274, 22.8], [274, 14.7]], { w: 0.18, close: true });
  doc.text('A3', 283.5, 17.6, { size: 3, align: 'center' });
  doc.text('Rack Size:', 292.5, 24.2, { size: 6 * SHEET_PT });
  doc.text(F.bankSize || '', 307, 20.2, { size: 2.3, align: 'center', cls: 'tb-val' });
  doc.text('Rack Weight:', 324.5, 24.2, { size: 6 * SHEET_PT });
  doc.text(F.bankWeight || '', 339, 20.2, { size: 2.3, align: 'center' });
  doc.text('SCALE: ' + (F.scaleText || ''), 292.5, 13, { size: 2.3 });
  doc.text('SHEET ' + (F.sheetText || F.sheet || ''), 324.5, 13, { size: 2.3 });
  /* company block (fixed logo + name) and document fields */
  doc.line(355, 45, 410, 45, thin).line(355, 37, 410, 37, thin).line(355, 29, 410, 29, thin).line(355, 21, 410, 21, thin);
  /* logo kept in proportion, as tall as the company cell allows */
  if (logo) {
    const lh = 8.4, lw = lh * logo.w / logo.h;
    doc.image(typeof doc.svg === 'function' ? logo.src : logo.bytes, logo.w, logo.h, 357.2, 45.8, lw, lh);
  }
  doc.text('AYK POWER LTD.', 366.2, 48.4, { size: 3.3, color: '#1f2937' });
  const field = (label, value, y) => { doc.text(label, 356.5, y, { size: 2.1 }); doc.text(value || '', 382.5, y - 4, { size: 2.6, align: 'center' }); };
  field('Document Number:', F.docNumber, 42.6);
  field('Document Type:', F.docType, 34.6);
  field('Design Number:', F.designNumber, 26.6);
  field('Design Name:', F.designName, 18.6);

  /* legend (fixed) */
  const legend = [['comm', 'Comm. Line: Cat6 Ethernet cable or higher grade, 23AWG'], ['power', 'Main Power Line: 0.6kV/1kV 1*95mm², OD:18.5mm Max']];
  if (st.plugs) legend.push(['plugB', 'Customer Side Power Line: 0.6kV/1kV, 1*95mm²'], ['plugA', 'Customer Side Power Line: 0.6kV/1kV, 1*95mm²']);
  /* boxed, bold, sitting on top of the title block (as on DWG2396) */
  const lh = 4.5, boxH = legend.length * lh + 2.6, bx = 276;
  doc.rect(bx, 55, 410 - bx, boxH, { w: 0.35 });
  legend.forEach((l, i) => {
    const y = 55 + boxH - 4.1 - i * lh;
    doc.line(bx + 3, y + 0.9, bx + 10, y + 0.9, { w: 0.55, color: SHEET_COLORS[l[0]] });
    doc.text(l[1], bx + 12, y, { size: 2.55, bold: true });
  });
  /* drawing notes (fixed wording, string count from the plan) */
  doc.text(`This Rack has ${nStrings} string${nStrings === 1 ? '' : 's'}. The dashed box encloses other string with same wiring layout and harness numbers.`, 14, 69, { size: 2.3 });
  doc.text('The harness numbers for cables will be added after length measurement.', 14, 64.5, { size: 2.3 });
}

/* ---------------- the rack, wiring and annotations ---------------- */
/**
 * Draws the whole sheet onto `doc` (pdfDoc or sheetSvgTarget).
 * model: {flat, bounds, jbs, wiring, settings, logo, rack:boolean, interactive:boolean,
 *         unit: drawing units per real mm (1 for mm drawings, ~0.0225 for a 1:44 rack),
 *         page: which sheet of the rack (1 when not given),
 *         components: the drawing's parts (so a fence follows the modules exactly),
 *         ground0 / grounds: the sheet's rack's grounding point and the further racks' (sheetMergeRacks)}
 * Returns the placement (scale, transform) used.
 */
function sheetDraw(doc, model) {
  const st = model.settings;
  const u = model.unit > 0 ? model.unit : 1;
  const P = sheetPlace(model.bounds, model.jbs, st, u);
  /* AYK sheets are never to scale */
  st.fields.scaleText = 'NTS';
  const W = model.wiring;
  const E = st.edits;
  const ia = !!model.interactive;
  /* this sheet of the rack: its strings are wired here, the others are fenced */
  const pages = sheetPagesOf(st, W), page = Math.min(pages.count, Math.max(1, model.page || 1));
  const here = name => (pages.of[name] || 1) === page;
  st.fields.sheetText = sheetNumber(st.fields, page, pages.count).text;
  sheetFrame(doc, st, W ? W.strings.length : 0, model.logo);
  delete st.fields.sheetText;

  /* rack linework (PDF only; the editor paints it on a canvas underneath) */
  if (model.rack && model.flat) {
    const o = { w: 0.07, color: SHEET_COLORS.rack };
    for (const p of model.flat.polylines) {
      const a = p.pts, q = new Array(a.length);
      for (let i = 0; i < a.length; i += 2) { q[i] = P.X(a[i]); q[i + 1] = P.Y(a[i + 1]); }
      if (p.closed) q.push(q[0], q[1]);
      doc.poly(q, o);
    }
    for (const c of model.flat.circles) doc.circle(P.X(c.cx), P.Y(c.cy), c.r * P.k, o);
    for (const t of model.flat.texts || []) if (t.text) doc.text(t.text, P.X(t.x), P.Y(t.y), { size: Math.max(0.8, t.h * P.k), rot: t.rot || 0 });
  }
  if (!W) return P;

  /* dotted box around each string */
  if (ia) doc.group(true, { cls: 'sh-outline' });
  for (const o of W.outline || []) if (here(o.ssc)) for (const sg of o.segs) doc.line(P.X(sg[0][0]), P.Y(sg[0][1]), P.X(sg[1][0]), P.Y(sg[1][1]), { w: 0.5, dash: [0.01, 1.3] });
  if (ia) doc.group(false);

  /* customer power plugs (Note 2) */
  if (st.plugs) {
    const leads = sheetPlugLeads(model.jbs, P.plugTop, u);
    if (ia) doc.group(true, { cls: 'sh-plugs' });
    for (const l of leads) {
      doc.poly(l.a.map(P.pt), { w: 0.35, color: SHEET_COLORS.plugA });
      doc.poly(l.b.map(P.pt), { w: 0.35, color: SHEET_COLORS.plugB });
    }
    const right = leads.slice().sort((a, b) => b.jb.x1 - a.jb.x1)[0];
    if (right) {
      const off = E.plugLabel || [-30, -2];
      const ta = P.pt(right.a[2]), tb = P.pt(right.b[2]);
      const yB = tb[1] + off[1], yA = yB - 8;
      const xr = ta[0] + off[0];
      const arrow = (x1, y1, x2, y2, color) => {
        doc.line(x1, y1, x2, y2, { w: 0.2, color: '#111' });
        const ang = Math.atan2(y2 - y1, x2 - x1), L = 1.6;
        doc.poly([[x2, y2], [x2 - L * Math.cos(ang - 0.35), y2 - L * Math.sin(ang - 0.35)], [x2 - L * Math.cos(ang + 0.35), y2 - L * Math.sin(ang + 0.35)]], { close: true, fill: '#111', stroke: false });
      };
      const g = { cls: 'sh-drag', data: { drag: 'plug' } };
      if (ia) doc.group(true, g);
      /* one "Note 2" label with an arrow to each lead (no plug names on the sheet) */
      doc.text('Note 2', xr, yB, { size: 3.4, align: 'right' });
      if (ia) doc.group(false);
      arrow(xr + 1, yB + 0.8, tb[0], tb[1] - 9, SHEET_COLORS.plugB);
      arrow(xr + 1, yB - 0.6, ta[0], ta[1] - 15, SHEET_COLORS.plugA);
    }
    if (ia) doc.group(false);
  }

  /* cables: communication under power */
  for (const kind of ['comm', 'power']) {
    for (const c of W.cables) {
      if (c.kind !== kind || (c.ssc && !here(c.ssc))) continue;
      const pts = (E.cables && E.cables[c.id]) || c.pts;
      doc.poly(pts.map(P.pt), { w: kind === 'power' ? 0.32 : 0.26, color: SHEET_COLORS[kind], id: ia ? c.id : null, cls: ia ? 'sh-cable' : null, hit: ia });
    }
  }

  /* leads across racks (an SSC in one rack, its modules in another): dashed over the top of
     both racks, each lead at its own height (S-, S+, S, N); a lead whose other rack is not on
     this sheet ends with the rack's name */
  const ROLE_ORDER = { 'S-': 0, 'S+': 1, 'S': 2, 'N': 3 };
  const paired = new Set();
  for (const l of W.links || []) {
    if (!here(l.ssc)) continue;
    l.ids.forEach(i => paired.add(i));
    const top = Math.max(model.bounds.maxY, l.a[1], l.b[1]) + (60 + (ROLE_ORDER[l.role] || 0) * 30) * u;
    const pts = [l.a, [l.a[0], top], [l.b[0], top], l.b].map(P.pt);
    doc.poly(pts, { w: l.kind === 'power' ? 0.32 : 0.26, color: SHEET_COLORS[l.kind], dash: [1.6, 1.1] });
  }
  for (const c of W.cables) {
    if (!c.link || paired.has(c.id) || (c.ssc && !here(c.ssc))) continue;
    const pts = (E.cables && E.cables[c.id]) || c.pts;
    const p = P.pt(c.to === 'ceiling' ? pts[pts.length - 1] : pts[0]);
    const role = c.link.role.replace('-', '−');
    doc.text(`${role} ${c.to === 'ceiling' ? 'to' : 'from'} ${c.link.rack || 'the other rack'}`, p[0] + (c.to === 'ceiling' ? 1 : 0), p[1] + 1.2, { size: 1.8, color: SHEET_COLORS[c.kind], align: c.to === 'ceiling' ? 'left' : 'center' });
  }

  /* module labels S1-M1 … */
  for (const s of W.strings) if (here(s.name)) for (const l of s.labels) {
    const p = (E.labels && E.labels[l.id]) || [l.x, l.y];
    doc.text(l.text, P.X(p[0]), P.Y(p[1]) - 0.9, { size: 2.6, bold: true, color: SHEET_COLORS.label, align: 'center', cls: ia ? 'sh-drag' : null, data: ia ? { drag: 'label', id: l.id } : null });
  }

  /* the strings wired on other sheets: one purple outline per sheet they are on, and the note
     "Please see sheet N, SSC6 & SSC7, for wiring connections." over it (DWG2586) */
  if (pages.count > 1) {
    for (let other = 1; other <= pages.count; other++) {
      if (other === page) continue;
      const away = W.strings.filter(s => (pages.of[s.name] || 1) === other)
        .sort((x, y) => String(x.name).localeCompare(String(y.name), undefined, { numeric: true }));
      if (!away.length) continue;
      /* padded 60 mm sideways (bridges the 100 mm cable tray between module columns) and 12 mm up and down */
      const segs = sheetFence(away.flatMap(s => sheetStringRects(W, s, model.components)), 60 * u, 12 * u);
      if (!segs.length) continue;
      if (ia) doc.group(true, { cls: 'sh-away' });
      for (const sg of segs) doc.line(P.X(sg[0][0]), P.Y(sg[0][1]), P.X(sg[1][0]), P.Y(sg[1][1]), { w: 0.35, color: SHEET_COLORS.label });
      if (ia) doc.group(false);
      const top = Math.max(...segs.map(sg => Math.max(sg[0][1], sg[1][1]))), xs = segs.flatMap(sg => [sg[0][0], sg[1][0]]);
      const key = page + ':' + other, id = 'see:' + key;
      const note = (st.pages.notes || {})[key] ||
        `Please see sheet ${sheetNumber(st.fields, other, pages.count).n}, ${away.map(s => s.name).join(' & ')}, for wiring connections.`;
      const at = (E.labels && E.labels[id]) || [(Math.min(...xs) + Math.max(...xs)) / 2, top];
      doc.text(note, P.X(at[0]), P.Y(at[1]) + 2.2, { size: 2.6, bold: true, align: 'center', cls: ia ? 'sh-drag' : null, data: ia ? { drag: 'label', id: id, see: key, x: at[0], y: at[1] } : null });
    }
  }

  /* SSC / MSM names on their parts (SSC1 …, MSM1), as on the drawing */
  for (const l of model.parts || []) {
    const p = (E.labels && E.labels[l.id]) || [l.x, l.y];
    doc.text(l.text, P.X(p[0]), P.Y(p[1]) - 1.2, { size: l.size || 3.4, bold: l.bold !== false, color: l.color || SHEET_COLORS.label, align: 'center', cls: ia ? 'sh-drag' : null, data: ia ? { drag: 'label', id: l.id } : null });
  }

  /* grounding point (Note 1): arrow up to the bolt hole on the rack's bottom-right upright */
  const gp = model.ground0 || sheetGroundPoint(model.flat, model.bounds, u);
  const tip = P.pt([gp.x, gp.y - gp.r]);
  const goff = E.ground || [0, 0];
  const base = [tip[0] + goff[0], tip[1] - 19 + goff[1]];
  doc.line(base[0], base[1], tip[0], tip[1] - 2.4, { w: 0.6, color: '#111' });
  doc.poly([[tip[0], tip[1]], [tip[0] - 1.1, tip[1] - 2.8], [tip[0] + 1.1, tip[1] - 2.8]], { close: true, fill: '#111', stroke: false });
  if (ia) doc.group(true, { cls: 'sh-drag', data: { drag: 'ground' } });
  doc.text('Grounding Point', base[0], base[1] - 4.6, { size: 3.4, align: 'center' });
  doc.text('(Note1)', base[0] + pdfTextWidth('Grounding Point', 3.4) / 2 - 0.5, base[1] - 1.6, { size: 1.8 });
  if (ia) doc.group(false);
  /* the other racks on this sheet each have their own grounding point */
  for (const g of model.grounds || []) {
    const t2 = P.pt([g.x, g.y - g.r]), b2 = [t2[0], t2[1] - 19];
    doc.line(b2[0], b2[1], t2[0], t2[1] - 2.4, { w: 0.6, color: '#111' });
    doc.poly([[t2[0], t2[1]], [t2[0] - 1.1, t2[1] - 2.8], [t2[0] + 1.1, t2[1] - 2.8]], { close: true, fill: '#111', stroke: false });
    doc.text('Grounding Point', b2[0], b2[1] - 4.6, { size: 3.4, align: 'center' });
    doc.text('(Note1)', b2[0] + pdfTextWidth('Grounding Point', 3.4) / 2 - 0.5, b2[1] - 1.6, { size: 1.8 });
  }
  return P;
}

/**
 * Builds the PDF of the wiring sheet.
 * @return {Promise<Uint8Array>}
 */
async function sheetPdf(model) {
  const doc = pdfDoc({ w: A3_W, h: A3_H, title: (model.settings.fields.docNumber || 'Wiring Diagram') + ' ' + (model.settings.fields.designName || '') });
  const n = sheetPagesOf(model.settings, model.wiring).count;
  for (let k = 1; k <= n; k++) {
    if (k > 1) doc.newPage();
    sheetDraw(doc, Object.assign({}, model, { rack: true, interactive: false, page: k }));
  }
  return doc.bytes();
}

/** Drawing units per real millimetre, from the battery module width (400.45 mm). */
function sheetUnit(components) {
  const ws = (components || []).filter(c => c.kind === 'module').map(c => c.x1 - c.x0).sort((a, b) => a - b);
  const k = ws.length ? ws[ws.length >> 1] / 400.45 : 1;
  return k > 0 ? k : 1;
}
