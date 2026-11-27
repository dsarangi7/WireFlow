/* ============================================================
 * WireFlow — electrical diagram sheets (AYK DWG2527 format) and PDF
 * ------------------------------------------------------------
 * Draws the sheets elecSheets() lists, from a confirmed setup and the
 * part library (assets/elec/parts.json), onto any target with the pdfDoc
 * API (poly, line, rect, circle, text). A3 landscape, millimetres, Y up.
 *
 * Laid out as DWG2527-00 (S10195, AYK 19 Nov 2026):
 *  - sheet 1: the MSM back with AYK's notes pointing at its ports;
 *    sheet 2: the inline connectors, the cable legend and the wiring instructions;
 *  - per bank: the MSM back with the first ACDP below it. Comm cables leave the MSM
 *    to the left, E-stop cables over the top to the right, the MSM power runs down to
 *    the ACDP, valves through their LP16-7 connectors, dry contact and remote E-stop
 *    through an inline connector to the customer; leads never cross each other.
 *  - SSC backs, at most two per sheet, with their cooling fans; further ACDPs;
 *    the junction box with the SSC fronts.
 * Every lead that leaves its sheet ends at a connector with a label saying where it
 * goes and on which sheet. Dashed = between racks (inline connector, customer cable).
 * The notes are the project's (elecNote): AYK's text unless the engineer edited it.
 * Needs elec.js (and pdf.js for the PDF).
 * ============================================================ */

const ELEC_A3 = { w: 420, h: 297 };
const ELEC_FRAME = 10;                                  /* border margin, mm */
const ELEC_TB = { x: 196, y: 10, w: 214, h: 42 };       /* title block, bottom right */
const ELEC_CYAN = '#00ffff', ELEC_TAG = '#ffd966', ELEC_INK = '#111827';

/* cable colours and sizes (DWG2527 legend, sheet 2) */
const ELEC_CABLES = {
  'ac-in-P': { color: '#e11d1d', label: '220-230VAC ACDP Primary Power Line: 0.3/0.5kV 3*2.5' },
  'ac-in-B': { color: '#0ea5e9', label: '220-230VAC ACDP Backup Power Line: 0.3/0.5kV 3*2.5' },
  'power-P': { color: '#e11d1d', label: '220-230VAC SSC/MSM Primary Power Line: 0.3/0.5kV 3*1.5' },
  'power-B': { color: '#0ea5e9', label: '220-230VAC SSC/MSM Backup Power Line: 0.3/0.5kV 3*1.5' },
  comm: { color: '#16a34a', label: 'Comm. Line: Cat6A Ethernet cable or higher grade, OD 8mm' },
  valve: { color: '#f2b600', label: 'Master Valve Fire Fighting Line: 0.3/0.5kV 5*0.3, OD 8mm' },
  bus: { color: '#e11d1d', label: 'Main Power Line: 0.6/1kV 1*95mm², OD 18.5mm Max' },
  'remote-estop': { color: '#7c3aed', label: 'Remote Estop: 0.3/0.5kV 4*0.518mm², OD 5-9 mm' },
  'dry-contact': { color: '#7c3aed', label: 'Dry Contact: 0.3/0.5kV 2*0.518mm², OD 5-9 mm' },
  estop: { color: '#7c3aed', label: 'MSM_SSC Estop: 0.3/0.5kV 4*0.518mm², OD 5-9 mm' },
  fan: { color: '#9a3412', label: 'SSC_Cooling_Fan_Power: 0.3/0.5kV 3*0.823mm², OD 5-9mm' },
};

/* line styles: dashed = between racks, through an inline connector; dotted = the customer's
   own cable (customer side of an inline connector, AC power in, the main power cables) */
const ELEC_DASH = [1.6, 1.1], ELEC_DOT = [0, 0.9];
/* AYK feedback (27 Nov 2026): every AYK harness lead is solid, also between racks; the
   customer's side of an inline connector is dashed (part numbers go on those lines later) */
const ELEC_CUST = ELEC_DASH;
/* the name written on each inline connector, as on sheet 2 (AYK's P1562) */
function elecPlugName(e) {
  const c = e.cable || '', pb = c.slice(-1);
  if (/^power-/.test(c)) return [e.port && e.port.startsWith('Power') ? (e.link && e.link.to.part === 'msm' ? 'MSM' : 'SSC') : (e.other && e.other.part === 'msm' ? 'MSM' : 'SSC'), 'POWER', pb];
  if (/^ac-in-/.test(c)) return ['ACDP', 'POWER', pb];
  return { comm: ['SSC', 'Com.P'], estop: ['Estop'], valve: ['Master', 'Valve'], 'dry-contact': ['Dry', 'Contact'], 'remote-estop': ['Remote', 'Estop'] }[c] || [];
}
/* every inline connector on the sheets is one size, drawn from AYK's P1562 (11.18 x 34.56) */
const ELEC_PLUG = { w: 5.2, h: 14 };   /* a bit larger than P1562's scale (AYK feedback, 27 Nov 2026) */
/* every part's name tag is one size, centred on its part */
const ELEC_TAG_SIZE = 3.4;
let elecInlineView = null;   /* the P1562 inline connector drawing, set by elecDraw */

/* ---------- editing ----------
 * The sheet editor and the PDF draw through the same edit target, so the PDF is exactly what
 * the engineer saw. setup.edits[elecSheetKey(sheet)] = {
 *   move: { id: [dx, dy] }   an item moved (mm)
 *   hide: { id: true }       an item deleted
 *   path: { id: [x, y, …] }  a lead re-routed (its whole polyline)
 *   text: { id: text }       an item's words changed (AYK notes change setup.notes instead)
 *   add:  [{ id, kind: 'note' | 'tag' | 'text', text, x, y, w }
 *          | { id, kind: 'box', x, y, w, h, style, color } | { id, kind: 'line', pts, style, color }]
 *         items the engineer added (style: 'dashed' (default), 'dotted' or 'solid') }
 * Items are drawn between doc.begin(id, kind, text) and doc.end() (elecItem); a lead carries
 * its id in its style ({ id, end: the id of the label at its far end }). */
function elecSheetKey(sh) { return [sh.kind, sh.bank || '', (sh.items || []).join(','), sh.kind === 'notes' ? sh.n : ''].join('|'); }

/** Draws one editable item: draw(text) gets the item's text (edited or not). */
function elecItem(doc, id, kind, text, draw, same) {
  const t = doc.begin ? doc.begin(id, kind, text, same) : text;
  try { return draw(t == null ? text : t, doc.lastId || id); } finally { if (doc.end) doc.end(); }
}

/** Wraps a drawing target (pdfDoc, or the editor's SVG target) with one sheet's edits. */
function elecEditTarget(inner, ed, interactive) {
  ed = ed || {};
  const mv = ed.move || {}, hide = ed.hide || {}, path = ed.path || {}, txt = ed.text || {};
  const seen = {}, stack = [];
  let dx = 0, dy = 0, hidden = 0;
  const flat = p => (Array.isArray(p[0]) ? p.flat() : p.slice());
  const api = {
    lastId: null,
    begin(id, kind, text, same) {
      /* the same words twice on a sheet (two "EW-P25, 4 Pin" tags) get their own ids */
      if (!same) { seen[id] = (seen[id] || 0) + 1; if (seen[id] > 1) id = id + '#' + seen[id]; }
      api.lastId = id;
      const open = interactive && inner.group && !hidden && !hide[id];
      stack.push([dx, dy, hidden, open]);
      const o = mv[id];
      if (o) { dx += o[0]; dy += o[1]; }
      if (hide[id]) hidden++;
      const shown = Object.prototype.hasOwnProperty.call(txt, id) ? txt[id] : text;
      if (open) inner.group(true, { cls: 'el-item', data: { id: id, kind: kind, text: shown == null ? '' : shown } });
      return shown;
    },
    end() { const s = stack.pop(); if (s[3]) inner.group(false); dx = s[0]; dy = s[1]; hidden = s[2]; },
    poly(p, o) {
      if (hidden) return api;
      o = o || {};
      let q = flat(p);
      if (o.id) {
        if (hide[o.id]) return api;
        if (path[o.id]) q = path[o.id].slice();
        else if (o.end && mv[o.end]) {
          /* its label was moved: the last leg follows */
          const e = mv[o.end], n = q.length;
          if (n >= 4 && Math.abs(q[n - 4] - q[n - 2]) < 1e-6) q[n - 4] += e[0];
          q[n - 2] += e[0]; q[n - 1] += e[1];
        }
        if (interactive) o = Object.assign({}, o, { cls: 'el-lead', data: { id: o.id, kind: 'lead', end: o.end || '' }, hit: true });
      } else if (o.pin) { q[0] += dx; q[1] += dy; }       /* a leader: its far end stays on the port */
      else for (let i = 0; i < q.length; i += 2) { q[i] += dx; q[i + 1] += dy; }
      inner.poly(q, o);
      return api;
    },
    line(x1, y1, x2, y2, o) { return api.poly([x1, y1, x2, y2], o); },
    rect(x, y, w, h, o) { if (!hidden) inner.rect(x + dx, y + dy, w, h, o); return api; },
    circle(cx, cy, r, o) { if (!hidden) inner.circle(o && o.pin ? cx : cx + dx, o && o.pin ? cy : cy + dy, r, o); return api; },
    text(t, x, y, o) { if (!hidden) inner.text(t, x + dx, y + dy, o); return api; },
    image(src, pw, ph, x, y, w, h) { if (!hidden) inner.image(src, pw, ph, x + dx, y + dy, w, h); return api; },
  };
  if (typeof inner.svg === 'function') api.svg = () => inner.svg();
  if (inner.group) api.group = (open, o) => { inner.group(open, o); return api; };
  return api;
}

/** The items the engineer added to a sheet. */
function elecAdded(doc, ed) {
  for (const a of (ed && ed.add) || []) {
    elecItem(doc, a.id, 'added-' + a.kind, a.text, t => {
      if (a.kind === 'tag') elecTag(doc, t, a.x, a.y, ELEC_TAG_SIZE, true);
      else if (a.kind === 'text') doc.text(t, a.x, a.y, { size: a.size || 2.4, color: ELEC_INK });
      else if (a.kind === 'box' || a.kind === 'line') {
        const st = { color: a.color || ELEC_CABLES['remote-estop'].color, w: a.w2 || 0.35, dash: a.style === 'solid' ? null : a.style === 'dotted' ? ELEC_DOT : ELEC_DASH };
        if (a.kind === 'box') doc.rect(a.x, a.y, a.w, a.h, st); else doc.poly(a.pts, st);
        /* on screen only: a wide invisible edge, so a thin outline is easy to grab */
        if (typeof doc.svg === 'function') {
          const grab = { color: 'rgba(0,0,0,0)', w: 2.4 };
          if (a.kind === 'box') doc.rect(a.x, a.y, a.w, a.h, grab); else doc.poly(a.pts, grab);
        }
      }
      else elecNoteBox(doc, t, a.x, a.y, a.w || 60, { size: a.size || 2.2, raw: true });
    }, true);
  }
}

/** SVG path data of a part view ("M x y L x y … Z") as polylines. */
function elecPathPolys(d) {
  const polys = [];
  let cur = null;
  const re = /([MLZ])([^MLZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === 'M') { cur = [n[0], n[1]]; polys.push(cur); }
    else if (m[1] === 'L' && cur) cur.push(n[0], n[1]);
    else if (m[1] === 'Z' && cur && cur.length >= 4) cur.push(cur[0], cur[1]);
  }
  return polys.filter(p => p.length >= 4);
}

/** Draws a part view scaled into box [x, y, w, h]; returns where its ports landed. */
function elecDrawPart(doc, view, box, o) {
  o = o || {};
  const s = Math.min(box[2] / view.w, box[3] / view.h);
  const ox = box[0] + (box[2] - view.w * s) / 2, oy = box[1] + (box[3] - view.h * s) / 2;
  const X = x => ox + x * s, Y = y => oy + y * s;
  const lw = o.lw || 0.13;
  for (const p of elecPathPolys(view.d)) {
    const q = [];
    for (let i = 0; i < p.length; i += 2) q.push(X(p[i]), Y(p[i + 1]));
    doc.poly(q, { color: '#1f2937', w: lw });
  }
  for (const c of view.circles) doc.circle(X(c[0]), Y(c[1]), c[2] * s, { color: '#1f2937', w: lw });
  const ports = {}, list = [];
  for (const p of view.ports || []) {
    const q = { x: X(p.x), y: Y(p.y), r: p.size / 2 * s, top: Y(p.top != null ? p.top : p.y + p.size / 2), name: p.name, unused: !!p.unused };
    list.push(q);
    if (!ports[p.name]) ports[p.name] = q;      /* a junction box repeats Bus+ / Bus- */
  }
  if (o.portNames !== false) for (const p of list) {
    /* above the connector's housing (its flange), not across it, on a white ground so lines
       of the part behind it (a jack's tail from the row above) never run through the words */
    const size = o.nameSize || 1.8, tw = pdfTextWidth(p.name, size, false);
    doc.rect(p.x - tw / 2 - 0.3, p.top + 0.4, tw + 0.6, size * 0.95, { fill: '#ffffff', stroke: false });
    doc.text(p.name, p.x, p.top + 0.7, { size: size, align: 'center', color: p.unused ? '#94a3b8' : ELEC_INK });
  }
  return { ports: ports, list: list, box: [ox, oy, view.w * s, view.h * s], scale: s };
}

/** Yellow name tag (bottom-left at x, y); returns its width. */
function elecTag(doc, text, x, y, size, raw) {
  size = size || ELEC_TAG_SIZE;
  const draw = t => {
    const w = pdfTextWidth(t, size, true) + 4, h = size + 2.4;
    doc.rect(x, y, w, h, { fill: ELEC_TAG, stroke: false });
    doc.text(t, x + 2, y + 1.3, { size: size, bold: true, color: ELEC_INK });
    return w;
  };
  return raw ? draw(text) : elecItem(doc, 'tag:' + text, 'tag', text, draw);
}

/** A part's name tag, centred over the part as drawn (box from elecDrawPart), 2.5 mm clear of
    it; slid sideways, nearest first, off any lead that drops into the part at avoidX. */
function elecPartTag(doc, text, box, below, avoidX) {
  const w = pdfTextWidth(text, ELEC_TAG_SIZE, true) + 4, h = ELEC_TAG_SIZE + 2.4;
  const y = below ? box[1] - 2.5 - h : box[1] + box[3] + 2.5;
  const free = x => !(avoidX || []).some(a => a > x - 1.5 && a < x + w + 1.5);
  let x = box[0] + box[2] / 2 - w / 2;
  for (let k = 1; !free(x) && k <= 2 * (box[2] + w); k++) {
    const t = box[0] + box[2] / 2 - w / 2 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.5;
    if (free(t)) { x = t; break; }
  }
  elecTag(doc, text, x, y, ELEC_TAG_SIZE);
  return { x: x, y: y, w: w, h: h };
}

/** Text broken into lines that fit `width` mm (keeps the author's line breaks). */
function elecWrap(text, width, size, bold) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    const indent = (para.match(/^\s*/) || [''])[0];
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = indent;
    for (const w of words) {
      const next = line.trim() ? line + ' ' + w : indent + w;
      if (line.trim() && pdfTextWidth(next, size, bold) > width) { out.push(line); line = indent + '  ' + w; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

/** A note box (cyan by default) with its top-left corner at x, top; returns its box. */
function elecNoteBox(doc, text, x, top, w, o) {
  o = o || {};
  const draw = (text, id) => {
    const size = o.size || 2.2, lh = size * 1.32, pad = 1.2;
    const lines = elecWrap(text, w - 2 * pad, size, o.bold);
    const h = lines.length * lh + 2 * pad - (lh - size) + 0.6;
    if (o.fill !== false) doc.rect(x, top - h, w, h, { fill: o.fill || ELEC_CYAN, stroke: false });
    if (o.frame) doc.rect(x, top - h, w, h, { color: o.frame, w: 0.3 });
    lines.forEach((l, i) => doc.text(l, o.align === 'center' ? x + w / 2 : x + pad, top - pad - size - i * lh + 0.3, { size: size, color: ELEC_INK, bold: o.bold, align: o.align }));
    return { x: x, y: top - h, w: w, h: h, top: top, id: id };
  };
  /* an AYK note (o.id "note:…") is edited in the project's notes; any other box keeps its own words */
  return o.raw ? draw(text, null) : elecItem(doc, o.id || 'box:' + String(text).slice(0, 60), o.id ? 'note' : 'box', text, draw);
}

/** Thin leader from a note box to a point (from the box side nearest the point). */
function elecLeader(doc, box, px, py, color) {
  const cx = Math.max(box.x, Math.min(box.x + box.w, px)), cy = Math.max(box.y, Math.min(box.y + box.h, py));
  /* drawn with its box (moves and goes with it); the end on the port stays put */
  const draw = () => {
    doc.line(cx, cy, px, py, { color: color || '#22d3ee', w: 0.2, pin: true });
    doc.circle(px, py, 0.5, { fill: color || '#22d3ee', stroke: false, pin: true });
  };
  if (box.id && doc.begin) elecItem(doc, box.id, 'leader', null, draw, true); else draw();
}

/** Thin leaders from one box to several points, moved and deleted with the box. */
function elecLeaders(doc, box, pts, color) {
  const draw = () => pts.forEach(([px, py]) => {
    const cx = Math.max(box.x, Math.min(box.x + box.w, px)), cy = Math.max(box.y, Math.min(box.y + box.h, py));
    doc.line(cx, cy, px, py, { color: color || '#22d3ee', w: 0.2, pin: true });
    doc.circle(px, py, 0.5, { fill: color || '#22d3ee', stroke: false, pin: true });
  });
  if (box.id && doc.begin) elecItem(doc, box.id, 'leader', null, draw, true); else draw();
}

/** Inline connector, centred on x, top at y: AYK's P1562 drawing, the same size on every
    sheet (ELEC_PLUG); two halves in a box when the library has no drawing. Optional label
    lines are written across its middle on a white ground. */
function elecPlug(doc, x, top, lines) {
  const { w, h } = ELEC_PLUG;
  if (elecInlineView) elecDrawPart(doc, elecInlineView, [x - w / 2, top - h, w, h], { portNames: false, lw: 0.08 });
  else {
    doc.rect(x - w / 2, top - h, w, h, { color: '#334155', w: 0.25 });
    doc.line(x - w / 2, top - h / 2, x + w / 2, top - h / 2, { color: '#334155', w: 0.25 });
  }
  (lines || []).forEach((t, i, all) => {
    const size = 1.2, y = top - h / 2 + (all.length - 1) * 0.85 - i * 1.7 - 0.45;
    const tw = pdfTextWidth(t, size, true);
    doc.rect(x - tw / 2 - 0.3, y - 0.3, tw + 0.6, size + 0.5, { fill: '#ffffff', stroke: false });
    doc.text(t, x, y, { size: size, bold: true, align: 'center', color: ELEC_INK });
  });
  return h;
}

/** Cable break (customer side): a short zigzag in a vertical lead at x around y. */
function elecBreak(doc, x, y, color, dash) {
  doc.poly([x, y + 3, x, y + 1.2, x - 1.4, y + 0.4, x + 1.4, y - 0.4, x, y - 1.2, x, y - 3], { color: color, w: 0.35, dash: dash === undefined ? ELEC_CUST : dash });
}

/** The end of a lead that leaves the sheet: its inline connector, and under it the label (reading upwards). */
function elecEnd(doc, x, y, color, text, e) {
  /* the connector (with its name) and its words are two items, so the engineer can move the words
     alone; under the connector a dashed stub: the customer's cable (AYK feedback, 27 Nov 2026) */
  const stub = 4;
  const plugH = elecItem(doc, 'end:' + text, 'end', null, () => {
    const h = elecPlug(doc, x, y, e ? elecPlugName(e) : []);
    doc.line(x, y - h, x, y - h - stub, { color: color, w: 0.35, dash: ELEC_CUST });
    return h;
  });
  return elecItem(doc, 'label:' + text, 'label', text, t => {
    /* under the connector, reading upwards, centred on the lead (DWG2527) */
    const w = pdfTextWidth(t, 2, false), top = y - plugH - stub - 1;
    doc.text(t, x + 0.7, top - w, { size: 2, rot: 90, color: ELEC_INK });
    return top - w;
  });
}

/** The frame, header, "For Review" and AYK's title block of one sheet. */
function elecFrame(doc, sheet, info) {
  const { w, h } = ELEC_A3, m = ELEC_FRAME;
  doc.rect(m, m, w - 2 * m, h - 2 * m, { color: ELEC_INK, w: 0.5 });
  const head = sheet.kind === 'notes' ? 'Electrical Diagram - Notes' : 'Electrical Diagram - ' + (sheet.bankName || '');
  doc.text(head, m + 5, h - m - 10, { size: 6, color: ELEC_INK });
  doc.rect(m + 5, h - m - 24, pdfTextWidth('For Review', 7) + 6, 11, { color: '#cbd5e1', w: 0.3 });
  doc.text('For Review', m + 8, h - m - 21.4, { size: 7, color: ELEC_INK });
  doc.text(sheet.title, m + 5, h - m - 29, { size: 2.2, color: '#475569' });
  /* title block: confidential legend | revision table | company, title, doc no, sheet */
  const t = ELEC_TB, legendW = 58, tableW = 90, right = t.x + legendW + tableW;
  doc.rect(t.x, t.y, t.w, t.h, { color: ELEC_INK, w: 0.35 });
  doc.line(t.x + legendW, t.y, t.x + legendW, t.y + t.h, { color: ELEC_INK, w: 0.25 });
  doc.line(right, t.y, right, t.y + t.h, { color: ELEC_INK, w: 0.25 });
  doc.text('Confidential Legend', t.x + legendW / 2, t.y + t.h - 3, { size: 1.5, align: 'center' });
  doc.text('Important Notice: Read first', t.x + legendW / 2, t.y + t.h - 5.2, { size: 1.5, align: 'center' });
  const legal = 'This document is part of information made available to recipients under obligations of confidentiality on Proprietary Property owned by Shenzhen Anyikong Power Technology Co., Ltd. (AYK), and all ownership, patent, design, manufacturing, reproduction, use and sole rights regarding the same are expressly retained by AYK. This document contains AYK\'s confidential information and is submitted by AYK under a confidential relationship for an agreed purpose, and by accepting or reviewing the document, the recipient agrees to maintain this document in strict confidence, not to supply or disclose this document or any information contained therein to any employee of recipient who is not authorised by AYK, and not otherwise use, disclose, or reproduce this document without AYK\'s written authorisation. This document and all copies shall be returned to AYK on request.';
  elecWrap(legal, legendW - 3, 1.15).forEach((l, i) => doc.text(l, t.x + legendW / 2, t.y + t.h - 8.4 - i * 1.5, { size: 1.15, align: 'center', color: '#334155' }));
  /* revision table: 6 columns, header and first row, empty rows under it */
  const cols = ['REV', 'DRAWN', 'CHECKED', 'DATE', 'STATE', 'NOTE'], cw = [9, 13, 15, 15, 19, 19];
  const vals = [info.rev || '0', info.drawnBy || '', info.checkedBy || '', info.date || '', info.state || 'Issued for Review', info.note || 'Initial Released'];
  const rowH = 5.25;
  let x = t.x + legendW;
  cols.forEach((c, i) => {
    doc.text(c, x + cw[i] / 2, t.y + t.h - 3.6, { size: 1.6, align: 'center' });
    doc.text(vals[i], x + cw[i] / 2, t.y + t.h - 3.6 - rowH, { size: vals[i].length > 14 ? 1.3 : 1.6, align: 'center' });
    x += cw[i];
    if (i < cols.length - 1) doc.line(x, t.y, x, t.y + t.h, { color: ELEC_INK, w: 0.15 });
  });
  for (let k = 1; k * rowH < t.h; k++) doc.line(t.x + legendW, t.y + t.h - k * rowH, right, t.y + t.h - k * rowH, { color: ELEC_INK, w: 0.15 });
  /* right: company, title, doc no + rev, size + sheet + rev */
  const rw = t.x + t.w - right;
  doc.line(right, t.y + 30, t.x + t.w, t.y + 30, { color: ELEC_INK, w: 0.2 });
  doc.line(right, t.y + 12, t.x + t.w, t.y + 12, { color: ELEC_INK, w: 0.2 });
  doc.line(right, t.y + 6, t.x + t.w, t.y + 6, { color: ELEC_INK, w: 0.2 });
  doc.line(t.x + t.w - 9, t.y, t.x + t.w - 9, t.y + 12, { color: ELEC_INK, w: 0.2 });
  doc.line(right + 22, t.y, right + 22, t.y + 6, { color: ELEC_INK, w: 0.2 });
  /* company cell: AYK logo at the left, the name beside it */
  let nameX = right + rw / 2;
  if (info.logo) {
    const lh = 9.6, lw = lh * info.logo.w / info.logo.h;
    doc.image(typeof doc.svg === 'function' ? info.logo.src : info.logo.bytes, info.logo.w, info.logo.h, right + 2.5, t.y + 31.2, lw, lh);
    nameX = right + 2.5 + lw + (rw - 2.5 - lw) / 2;
  }
  doc.text('Shenzhen Anyikong Power', nameX, t.y + 37.2, { size: 2, align: 'center' });
  doc.text('Technology Co., Ltd.', nameX, t.y + 34.4, { size: 2, align: 'center' });
  doc.text('TITLE', right + 1.5, t.y + 27, { size: 1.8 });
  elecWrap(info.title || '', rw - 6, 2.2).slice(0, 3).forEach((l, i) => doc.text(l, right + rw / 2, t.y + 22.8 - i * 2.9, { size: 2.2, align: 'center' }));
  doc.text('Doc No: ' + (info.docNumber || '-'), right + 1.5, t.y + 8, { size: 2 });
  doc.text('Rev', t.x + t.w - 4.5, t.y + 8, { size: 1.8, align: 'center' });
  doc.text('SIZE    A3', right + 1.5, t.y + 2, { size: 1.8 });
  doc.text(`Sheet ${sheet.n} of ${sheet.of}`, right + 22 + (rw - 31) / 2, t.y + 2, { size: 2, bold: true, align: 'center' });
  doc.text(info.rev || '0', t.x + t.w - 4.5, t.y + 2, { size: 2, align: 'center' });
  doc.text('Drawn with WireFlow from the confirmed setup. Check before release.', m + 5, m + 2.5, { size: 1.6, color: '#94a3b8' });
}

/** Which sheet a part instance is drawn on (the first ACDP is on its bank's MSM sheet). */
function elecSheetOf(sheets) {
  const at = new Map();
  const put = (k, n) => { if (!at.has(k)) at.set(k, n); };
  for (const s of sheets) {
    if (s.kind === 'msm') { for (const it of s.items) put('msm:' + it, s.n); if (s.acdp) put('acdp:' + s.acdp, s.n); }
    else if (s.kind === 'acdp') for (const it of s.items) put('acdp:' + it, s.n);
    else if (s.kind === 'ssc-back') for (const it of s.items) put('ssc:' + it, s.n);
  }
  return (part, name) => at.get(part + ':' + name) || null;
}

/**
 * Each confirmed connection end of one part on this sheet:
 * [{ port, x, y, r, color, dash, cable, other, text }] (text: "To/From <far end> · Sheet n").
 */
function elecEndsOn(links, sheetOf, part, name, ports, word) {
  const ends = [];
  for (const l of links) {
    for (const [me, other] of [[l.from, l.to], [l.to, l.from]]) {
      if (me.part !== part || me.name !== name) continue;
      if (elecPortBlocked(me.part, me.port)) continue;
      const p = ports[me.port];
      if (!p) continue;
      const sh = sheetOf(other.part, other.name);
      const cab = ELEC_CABLES[l.cable] || { color: ELEC_INK };
      const far = other.part === 'customer' || other.part === 'valve' ? other.name : `${other.name} ${other.port}`;
      ends.push({ port: me.port, x: p.x, y: p.y, r: p.r, color: cab.color, dash: l.link === 'inline', cable: l.cable, other: other, link: l,
        text: `${word || 'To'} ${far}${sh ? ' · Sheet ' + sh : ''}` });
    }
  }
  return ends;
}
const elecDashOf = () => null;   /* AYK side: always solid */

/** Leads straight down from each port to a connector and its label at endY. */
function elecDropLeads(doc, ends, endY) {
  for (const e of ends) {
    e.endY = endY;
    doc.poly([e.x, e.y - e.r, e.x, endY], { color: e.color, w: 0.35, dash: elecDashOf(e), id: 'lead:' + e.text, end: 'end:' + e.text });
    elecEnd(doc, e.x, endY, e.color, e.text, e);
  }
}

/** Groups ports into rows (same height) in reading order: top row first, left to right. */
function elecRows(ends) {
  const rows = [];
  for (const e of ends.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r[0].y - e.y) < 0.5);
    if (row) row.push(e); else rows.push([e]);
  }
  rows.forEach(r => r.sort((a, b) => a.x - b.x));
  return rows;
}

/**
 * Nested routing, as DWG2527 draws it: each port steps to its own lane next to its row,
 * runs sideways out of the part to its own column, then down to the label line. The first
 * port in reading order gets the outermost column and the lane its row-mates never reach,
 * so no two leads cross. side: 'left' (lanes under the row) or 'right' (lanes over the row).
 */
function elecNestedLeads(doc, ends, side, col0, step, endY, laneGap) {
  let i = 0;
  for (const row of elecRows(ends)) {
    row.forEach((e, k) => {
      /* the lead that crosses over its row-mates runs on the lane farthest from the row */
      const lane = side === 'left' ? e.y - e.r - 1.4 - k * laneGap : e.y + e.r + 1.4 + (row.length - 1 - k) * laneGap;
      const col = side === 'left' ? col0 + i * step : col0 - i * step;
      doc.poly([e.x, side === 'left' ? e.y - e.r : e.y + e.r, e.x, lane, col, lane, col, endY], { color: e.color, w: 0.35, dash: elecDashOf(e), id: 'lead:' + e.text, end: 'end:' + e.text });
      elecEnd(doc, col, endY, e.color, e.text, e);
      i++;
    });
  }
}

/** ACDP AC power in: down through the inline connectors, a break, to the customer tag. */
function elecAcIn(doc, ends, boxTop, setup) {
  const ac = ends.filter(e => /^ac-in/.test(e.cable)).sort((a, b) => a.x - b.x);
  if (!ac.length) return null;
  const x0 = ac[0].x - 6, x1 = ac[ac.length - 1].x + 6, boxH = ELEC_PLUG.h + 3;
  doc.rect(x0, boxTop - boxH, x1 - x0, boxH, { color: '#e11d1d', w: 0.35 });
  for (const e of ac) {
    doc.poly([e.x, e.y - e.r, e.x, boxTop - 1.5], { color: e.color, w: 0.35 });
    elecPlug(doc, e.x, boxTop - 1.5, ['ACDP', 'POWER', e.port.slice(-1)]);
    doc.poly([e.x, boxTop - boxH + 1.5, e.x, boxTop - boxH - 6], { color: e.color, w: 0.35, dash: ELEC_CUST });
    elecBreak(doc, e.x, boxTop - boxH - 9, e.color);
    doc.line(e.x, boxTop - boxH - 12, e.x, boxTop - boxH - 15, { color: e.color, w: 0.35, dash: ELEC_CUST });
  }
  const tagTop = boxTop - boxH - 15, mid = (x0 + x1) / 2;
  const tag = elecNoteBox(doc, '230VAC Control Power Inlet For Battery Servicing', mid - 17, tagTop, 34, { fill: ELEC_TAG, size: 2.3, align: 'center' });
  return { box: [x0, boxTop - boxH, x1 - x0, boxH], tag: tag, plugs: ac.map(e => [e.x + ELEC_PLUG.w / 2, boxTop - 1.5 - ELEC_PLUG.h / 2]) };
}

/** The panel callout: TN0089 note and the rack's signal inter-connection panel. */
function elecPanelNote(doc, setup, rack, x, top, w, plugs, size) {
  size = size || 1.9;
  const n = elecNote(setup, 'panel');
  const b = n.trim() ? elecNoteBox(doc, n, x, top, w, { size: size, align: 'center', id: 'note:panel' }) : { x: x, y: top, w: w, h: 0 };
  const name = (rack ? rack + ' ' : '') + 'Signal Inter Connection Panel';
  const t = elecNoteBox(doc, name, x, b.y, w, { fill: false, frame: '#cbd5e1', size: size, align: 'center' });
  /* the callout points at each inline connector it is about (AYK feedback, 27 Nov 2026) */
  if (plugs && plugs.length) elecLeaders(doc, n.trim() ? b : t, plugs.map(e => [e.x + (e.x < x ? ELEC_PLUG.w / 2 : -ELEC_PLUG.w / 2), e.endY - ELEC_PLUG.h / 2]));
  return { x: x, y: t.y, w: w, h: top - t.y };
}

/* ---------- sheets ---------- */

/** Sheet 1: the MSM back with AYK's notes pointing at its ports. */
function elecNotesMsm(doc, setup, view) {
  /* the project's MSM: the first bank's model */
  const msm = view(elecMsmDrawing(setup.banks[0]), 'back') || view('msm', 'back');
  if (!msm) return;
  const d = elecDrawPart(doc, msm, [120, 62, 150, 106], { nameSize: 2 });
  elecPartTag(doc, 'MSM Back', d.box);
  const P = n => d.ports[n];
  const note = (id, x, top, w, size) => { const t = elecNote(setup, id); return t.trim() ? elecNoteBox(doc, t, x, top, w, { size: size || 2.2, id: 'note:' + id }) : null; };
  const comm = note('comm', 22, 150, 80);
  if (comm && P('SSC1P')) elecLeader(doc, comm, P('SSC1P').x, P('SSC1P').y);
  const cloud = note('cloud', 30, 205, 70);
  if (cloud && P('Cloud')) elecLeader(doc, cloud, P('Cloud').x, P('Cloud').y);
  const access = note('access', 104, 238, 82);
  if (access) for (const n of ['EMS', 'PCS']) if (P(n)) elecLeader(doc, access, P(n).x, P(n).y);
  const dry = note('dryContact', 196, 222, 70);
  if (dry && P('Dry Contact')) elecLeader(doc, dry, P('Dry Contact').x, P('Dry Contact').y);
  const rem = note('remoteE', 276, 276, 104, 1.9);
  if (rem && P('RemoteE')) elecLeader(doc, rem, P('RemoteE').x, P('RemoteE').y);
  elecItem(doc, 'figure1', 'figure', null, () => elecFigure1(doc, 292, 118));
  const extra = elecNote(setup, 'extra');
  if (extra.trim()) elecNoteBox(doc, extra, 15, 112, 104, { size: 2.2, fill: '#fef9c3', id: 'note:extra' });
}

/** The cable legend (DWG2527): colour per cable, then dashed and dotted. Top-left at x, top. */
function elecLegend(doc, x, top, w) {
  const L = Object.values(ELEC_CABLES), lh = 4.2;
  const rows = L.map(c => [c.label, { color: c.color, w: 0.6 }])
    .concat([['Solid: AYK harness (rack side of an inline connector)', { color: ELEC_INK, w: 0.4 }],
      ['Dashed: the customer\'s own cable (customer side of an inline connector)', { color: ELEC_INK, w: 0.4, dash: ELEC_CUST }]]);
  const h = rows.length * lh + 3;
  doc.rect(x, top - h, w, h, { color: ELEC_INK, w: 0.3 });
  rows.forEach(([label, st], k) => {
    const y = top - 3 - k * lh;
    doc.line(x + 2, y, x + 10, y, st);
    doc.text(label, x + 12, y - 0.7, { size: 1.9 });
  });
  return { x: x, y: top - h, w: w, h: h };
}

/** Figure 1 (DWG2527 sheet 1): the customer's remote E-stop with AYK's resistor network,
    1k in series and 10k across. Lower-left corner at fx, fy; about 92 x 52 mm. */
function elecFigure1(doc, fx, fy) {
  const ink = { color: ELEC_INK, w: 0.35 };
  const top = fy + 40, bot = fy + 14, ex = fx + 12, ey = fy + 27;
  /* the E-stop: yellow housing, red mushroom head */
  doc.rect(ex - 8, ey - 8, 16, 16, { fill: '#facc15', color: '#a16207', w: 0.3 });
  doc.circle(ex, ey, 6, { fill: '#dc2626', color: '#7f1d1d', w: 0.3 });
  doc.circle(ex, ey, 3.6, { color: '#fecaca', w: 0.35 });
  doc.circle(ex, ey, 1.2, { fill: '#7f1d1d', stroke: false });
  /* the resistor network */
  const bx = fx + 44, bw = 44;
  doc.rect(bx, fy + 8, bw, 38, { fill: '#eef5e4', color: '#64748b', w: 0.3 });
  /* wires: E-stop to the network, top through 1k, bottom straight */
  doc.poly([ex, ey + 8, ex, top, bx + 20, top], ink);
  doc.poly([bx + 20, top, bx + 21, top + 1.4, bx + 23, top - 1.4, bx + 25, top + 1.4, bx + 27, top - 1.4, bx + 29, top + 1.4, bx + 30, top, bx + bw, top], ink);
  doc.poly([ex, ey - 8, ex, bot, bx + bw, bot], ink);
  /* 10k across the two */
  const rx = bx + 9, mid = (top + bot) / 2;
  doc.poly([rx, top, rx, mid + 5, rx + 1.4, mid + 4, rx - 1.4, mid + 2, rx + 1.4, mid, rx - 1.4, mid - 2, rx + 1.4, mid - 4, rx, mid - 5, rx, bot], ink);
  doc.circle(rx, top, 0.6, { fill: ELEC_INK, stroke: false });
  doc.circle(rx, bot, 0.6, { fill: ELEC_INK, stroke: false });
  doc.text('1K', bx + 25, top + 2.6, { size: 2.6, align: 'center' });
  doc.text('10K', rx + 3, mid - 1, { size: 2.6 });
  /* names under, with dashed leaders as the technote */
  const lead = { color: '#64748b', w: 0.25, dash: [0.8, 0.8] };
  doc.line(ex, ey - 9, ex - 3, fy + 3, lead);
  doc.text('RemoteE', ex - 3, fy, { size: 2.6, align: 'center' });
  doc.line(bx + bw - 6, fy + 8, bx + bw - 10, fy + 3, lead);
  doc.text('Resistor Network', bx + bw - 10, fy, { size: 2.6, align: 'center' });
  const tw = pdfTextWidth('Figure 1', 2.4, true) + 4;
  elecTag(doc, 'Figure 1', fx + 46 - tw / 2, fy - 9, 2.4);
}

/** Sheet 2: inline connectors, the cable legend and the wiring instructions. */
function elecNotesInline(doc, setup, inline) {
  /* the cable legend, top right (user, 24 Nov 2026: always on sheet 2 with the inline connectors) */
  elecItem(doc, 'legend', 'legend', null, () => elecLegend(doc, 298, 284, 112));
  /* the inline connectors, in the order and groups of AYK's P1562 (Rev.2), each drawn
     from its part drawing (assets/elec/parts.json "inline") when the library has it */
  const groups = [
    { cable: 'ac-in-P', plugs: [['ACDP', 'POWER', 'B', 'ac-in-B'], ['ACDP', 'POWER', 'P', 'ac-in-P']], tag: 'Inline Connector\nEW-M25B, 3 Pin\nPin1(Red): L\nPin2(Blue): N\nPin3(Yellow): G' },
    { cable: 'power-P', plugs: [['SSC', 'POWER', 'B', 'power-B'], ['SSC', 'POWER', 'P', 'power-P']], tag: 'Inline Connector\nEW-M25B, 3 Pin\nPin1(Red): L\nPin2(Blue): N\nPin3(Yellow): G' },
    { cable: 'comm', plugs: [['SSC', 'Com.P', '', 'comm']], tag: 'Inline Connector\nRJ45' },
    { cable: 'valve', plugs: [['Master', 'Valve', '', 'valve']], tag: 'Inline Connector\nEW-P25, 5 Pin' },
    { cable: 'dry-contact', plugs: [['Dry', 'Contact', '', 'dry-contact']], tag: 'Inline Connector\nEW-M25B, 3 Pin\nPin1(Red)\nPin2(Blue)' },
    { cable: 'remote-estop', plugs: [['Remote', 'Estop', '', 'remote-estop']], tag: 'Inline Connector\nEW-P25, 4 Pin' },
    { cable: 'estop', plugs: [['', 'Estop', '', 'estop']], tag: 'Inline Connector\nEW-P25, 4 Pin' },
  ];
  const y0 = 150, h = 34, plugW = 22, gap = 3, x0 = 40;
  let x = x0;
  groups.forEach((g, gi) => elecItem(doc, 'inline:' + g.cable, 'group', null, () => {
    const w = g.plugs.length * plugW + 4;
    doc.rect(x, y0, w, h, { color: ELEC_CABLES[g.cable].color, w: 0.45 });
    g.plugs.forEach((p, k) => {
      const cx = x + 2 + plugW / 2 + k * plugW, col = ELEC_CABLES[p[3]].color;
      if (inline) elecDrawPart(doc, inline, [cx - 6, y0 + 3, 12, h - 6], { portNames: false, lw: 0.1 });
      else {
        doc.rect(cx - 5, y0 + 3, 10, h - 6, { color: '#94a3b8', w: 0.25 });
        doc.line(cx - 5, y0 + h / 2, cx + 5, y0 + h / 2, { color: '#94a3b8', w: 0.2 });
      }
      /* on the drawn connector: two lines between the upper nut and the middle band, the third (B/P) below it */
      [p[0], p[1], p[2]].filter(Boolean).forEach((t, i) => doc.text(t, cx, inline ? y0 + [21.2, 18.7, 13.8][i] : y0 + h - 9 - i * 3.6, { size: inline ? 1.8 : 2, align: 'center', bold: true }));
      doc.line(cx, y0 + h, cx, y0 + h + 30, { color: col, w: 0.4 });
      doc.line(cx, y0, cx, y0 - 30, { color: col, w: 0.4, dash: ELEC_CUST });   /* the customer's cable */
    });
    const tag = elecNoteBox(doc, g.tag, x + w / 2 - 12, gi % 2 ? y0 - 37 : y0 + h + 58, 24, { fill: ELEC_TAG, size: 1.8, align: 'center' });
    /* the tag points at its connector box (AYK feedback, 27 Nov 2026), beside the cable lines */
    elecLeader(doc, tag, g.plugs.length > 1 ? x + w / 2 : x + w - 3, gi % 2 ? y0 : y0 + h, '#64748b');
    x += w + gap;
  }));
  doc.text('Rack side (AYK harness)', x0, y0 + h + 33, { size: 2, color: '#475569' });
  doc.text('Customer side (customer makes this cable)', x0, y0 - 34, { size: 2, color: '#475569' });
  /* the wiring instructions (editable), bottom left */
  const t = elecNote(setup, 'inline');
  if (t.trim()) elecNoteBox(doc, t, 15, 92, 178, { size: 1.75, fill: false, frame: '#22d3ee', id: 'note:inline' });
}

/** Bank: the MSM back (top) and the bank's first ACDP (bottom left), routed as DWG2527. */
function elecMsmSheet(doc, setup, b, sh, ctx) {
  const v = ctx.view(elecMsmDrawing(b), 'back');
  const d = elecDrawPart(doc, v, [150, 166, 126, 82], { nameSize: 1.6 });
  elecPartTag(doc, `${b.msm.name} Back`, d.box);
  /* the leads drawn from here on, so a tag can be put where none runs */
  const drawn = [], poly0 = doc.poly;
  doc.poly = function (p, o) { drawn.push(Array.isArray(p[0]) ? p.flat() : p); return poly0.call(this, p, o); };
  const ends = elecEndsOn(ctx.links, ctx.sheetOf, 'msm', b.msm.name, d.ports);
  const of = c => ends.filter(e => e.cable === c);
  const msmBox = d.box, right = msmBox[0] + msmBox[2], bottom = msmBox[1];
  /* comm: left, to the labels at the left */
  elecNestedLeads(doc, of('comm'), 'left', 24, 8, 158, 1.5);
  /* MSM-SSC E-stops: up over their row, right, down to the labels at the right */
  elecNestedLeads(doc, of('estop'), 'right', 402, 7.5, 158, 1.5);
  /* dry contact and remote E-stop: under their row, right, through the inline connector */
  const cust = [...of('dry-contact'), ...of('remote-estop')].sort((a, b) => a.x - b.x);
  const custCols = [287, 299];
  const boxTop = 162, boxH = ELEC_PLUG.h + 3;
  if (cust.length) doc.rect(custCols[0] - 7, boxTop - boxH, custCols[1] - custCols[0] + 14, boxH, { color: '#7c3aed', w: 0.4 });
  cust.forEach((e, k) => {
    /* the right-hand port takes the upper lane and the outer column, so the two never cross */
    const kk = cust.length - 1 - k;
    const col = custCols[k] || custCols[1];
    /* a port with a valve to its right in its row (the 6-SSC MSM's Dry Contact) leaves over
       its row, since the valve leads drop straight down beside it */
    const over = of('valve').some(v => Math.abs(v.y - e.y) < 1 && v.x > e.x);
    const lane = over ? e.y + e.r + 1.4 + kk * 1.5 : e.y - e.r - 1.4 - kk * 1.5;
    /* AYK's harness from the MSM to the inline connector: solid; the customer's side below it dotted */
    doc.poly([e.x, over ? e.y + e.r : e.y - e.r, e.x, lane, col, lane, col, boxTop - 1.5], { color: e.color, w: 0.35, id: 'lead:' + e.text });
    elecPlug(doc, col, boxTop - 1.5, e.cable === 'dry-contact' ? ['Dry', 'Contact'] : ['Remote', 'Estop']);
    const tagTop = k ? 120 : 134;
    doc.poly([col, boxTop - boxH + 1.5, col, tagTop], { color: e.color, w: 0.35, dash: ELEC_CUST, id: 'customer:' + e.text });
    elecNoteBox(doc, e.cable === 'dry-contact' ? 'Client-side Thermal Runaway Status Signal' : 'Client-side Remote Estop', col - 9, tagTop, 18, { fill: ELEC_TAG, size: 1.9, align: 'center' });
  });
  /* master valves: down through the LP16-7 connectors to the valves */
  for (const e of of('valve')) {
    doc.poly([e.x, e.y - e.r, e.x, 156], { color: e.color, w: 0.35, id: 'lead:' + e.text });
    elecItem(doc, 'lp16:' + e.port, 'box', null, () => {
      doc.rect(e.x - 5.5, 147, 11, 9, { color: '#64748b', w: 0.25, fill: '#ffffff' });
      ['LP16-7 Female', 'to', 'LP16-7 Male'].forEach((t, i) => doc.text(t, e.x, 153.6 - i * 2.4, { size: 1.25, align: 'center' }));
    });
    doc.poly([e.x, 147, e.x, 140], { color: e.color, w: 0.35, dash: ELEC_CUST });
    elecNoteBox(doc, e.text.replace(/^To /, '').replace(/ · .*/, '').replace(/Master Valve\s*/, 'Master Valve '), e.x - 5.5, 140, 11, { fill: ELEC_TAG, size: 1.9, align: 'center' });
  }
  /* Ex.FanFB is not in use (DWG2527) */
  const fan = d.ports['Ex.FanFB'];
  doc.poly = poly0;
  if (fan) {
    /* beside the panel at the port's height, moved up or down until no lead runs under it */
    const x0 = right + 6, x1 = right + 19, h = 4.9;
    const hits = top => drawn.some(p => { for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = Math.min(p[i], p[i + 2]), bx = Math.max(p[i], p[i + 2]), ay = Math.min(p[i + 1], p[i + 3]), by = Math.max(p[i + 1], p[i + 3]);
      if (bx >= x0 - 0.8 && ax <= x1 + 0.8 && by >= top - h - 0.8 && ay <= top + 0.8) return true; } return false; });
    let top = fan.y + h / 2;
    for (let k = 0; k <= 80; k++) { const t = fan.y + h / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5; if (!hits(t)) { top = t; break; } }
    const t = elecNoteBox(doc, 'Not in use', x0, top, x1 - x0, { fill: ELEC_TAG, size: 1.9, align: 'center' });
    elecLeader(doc, t, fan.x, fan.y, '#334155');
  }
  /* the first ACDP, below left; MSM power runs straight to it */
  const name = sh.acdp;
  const av = ctx.view('acdp', 'back');
  let acdpEnds = [];
  if (name && av) {
    const a = elecAcdps(b).find(x => x.name === name) || {};
    const ad = elecDrawPart(doc, av, [28, 72, 118, 44], { nameSize: 1.5 });
    /* clear of the comm labels that hang down at the left (24, 32, … mm) */
    elecPartTag(doc, `${name} Back`, ad.box, false, of('comm').map((e, i) => 24 + i * 8));
    acdpEnds = elecEndsOn(ctx.links, ctx.sheetOf, 'acdp', name, ad.ports);
    /* MSM PowerP/B to ACDP MSMP/MSMB (as DWG2527: P runs on the lower lane) */
    for (const pb of ['B', 'P']) {
      const m = ends.find(e => e.cable === 'power-' + pb && e.port === 'Power' + pb);
      const q = ad.ports['MSM' + pb];
      if (!m || !q) continue;
      const lane = pb === 'B' ? 163 : 156;
      doc.poly([m.x, m.y - m.r, m.x, lane, q.x, lane, q.x, q.y + q.r], { color: m.color, w: 0.35, dash: elecDashOf(m), id: 'lead:' + m.text });
    }
    elecDropLeads(doc, acdpEnds.filter(e => /^power-/.test(e.cable) && !/^MSM/.test(e.port)), 64);
    const ac = elecAcIn(doc, acdpEnds, 64, setup);
    const acNote = elecNote(setup, 'acPower');
    if (ac && acNote.trim()) {
      const nb = elecNoteBox(doc, acNote, 150, 102, 82, { size: 2, id: 'note:acPower' });
      elecLeaders(doc, nb, ac.plugs);   /* straight at each AC inline connector */
    }
    elecPanelNote(doc, setup, a.rack || '', 30, 30, 56, acdpEnds.filter(e => e.endY));
  } else {
    /* no ACDP drawn here: the MSM power leaves the sheet like any other lead */
    elecDropLeads(doc, ends.filter(e => /^power-/.test(e.cable)), 150);
  }
  elecPanelNote(doc, setup, b.msm.rack || '', 330, 116, 66);
}

/** A further ACDP of the bank. */
function elecAcdpSheet(doc, setup, b, name, ctx) {
  const a = elecAcdps(b).find(x => x.name === name) || {};
  const ad = elecDrawPart(doc, ctx.view('acdp', 'back'), [60, 150, 230, 87], { nameSize: 2.2 });
  elecPartTag(doc, `${name} Back`, ad.box);
  const ends = elecEndsOn(ctx.links, ctx.sheetOf, 'acdp', name, ad.ports);
  elecDropLeads(doc, ends.filter(e => /^power-/.test(e.cable)), 140);
  const ac = elecAcIn(doc, ends, 140, setup);
  const acNote = elecNote(setup, 'acPower');
  if (ac && acNote.trim()) {
    const nb = elecNoteBox(doc, acNote, 300, 200, 100, { size: 2.6, id: 'note:acPower' });
    elecLeaders(doc, nb, ac.plugs);   /* straight at each AC inline connector */
  }
  elecPanelNote(doc, setup, a.rack || '', 80, 88, 60, ends.filter(e => e.endY));
}

/** SSC backs (two at most) with their cooling fans. */
function elecSscSheet(doc, setup, sh, ctx) {
  const v = ctx.view('ssc', 'back');
  sh.items.forEach((name, k) => {
    const c = setup.sscs.find(x => x.name === name) || {};
    /* two side by side; one alone sits in the middle of the sheet */
    const x0 = sh.items.length === 1 ? 22 + 195 / 2 : 22 + k * 195;
    const d = elecDrawPart(doc, v, [x0, 118, 140, 122], { nameSize: 1.7 });
    elecPartTag(doc, `${name} Back`, d.box);
    const ends = elecEndsOn(ctx.links, ctx.sheetOf, 'ssc', name, d.ports, 'From');
    elecDropLeads(doc, ends, 112);
    /* cooling fans: down, along the bottom, up to an LP16-3 inline socket per fan */
    const fp = d.ports['Cooling Fan'], fans = Math.max(0, Math.min(6, +c.fans || 0));
    if (fp && fans) {
      const col = ELEC_CABLES.fan.color, bx = x0 + 150, low = 64.5, top = 150;   /* low: under the labels hanging from the connectors */
      doc.poly([fp.x, fp.y - fp.r, fp.x, low, bx, low, bx, top], { color: col, w: 0.35, id: 'fan:' + name });
      for (let f = 0; f < fans; f++) elecItem(doc, `fan:${name} ${f + 1}`, 'box', null, () => {
        const y = top - f * 8;
        doc.line(bx, y, bx + 4, y, { color: col, w: 0.35 });
        doc.rect(bx + 4, y - 3, 7, 6, { color: '#334155', w: 0.25 });
        ['LP16-3', 'Inline', 'Socket'].forEach((t, i) => doc.text(t, bx + 7.5, y + 1.4 - i * 1.6, { size: 1.05, align: 'center' }));
        doc.line(bx + 11, y, bx + 14, y, { color: col, w: 0.35 });
        doc.rect(bx + 14, y - 2.5, 18, 5, { color: ELEC_INK, w: 0.3 });
        doc.text('Cooling Fan ' + (f + 1), bx + 23, y - 0.9, { size: 2, align: 'center' });
      });
    }
    const pn = elecPanelNote(doc, setup, c.rack || '', x0 + 4, 63, 64, ends.filter(e => e.endY), 1.6);
    void pn;
  });
}

/** Junction box and SSC fronts (two at most). */
function elecFrontsSheet(doc, setup, sh, b, ctx) {
  const jbv = ctx.view(setup.jbModel === 2 ? 'jb2' : 'jb4', 'front');
  const v = ctx.view('ssc', 'front');
  const bank = elecBankSscs(setup, b.id).map(c => c.name);
  let jb = null;
  if (jbv) {
    jb = elecDrawPart(doc, jbv, [112, 58, 136, 40], { nameSize: 2 });
    elecPartTag(doc, 'Junction Box Front', jb.box, false, jb.list.map(p => p.x));
    /* the customer's main power cables, both sides */
    const yA = jb.box[1] + jb.box[3] * 0.62, yB = jb.box[1] + jb.box[3] * 0.38;
    for (const [sx, dir] of [[jb.box[0], -1], [jb.box[0] + jb.box[2], 1]]) {
      for (const y of [yA, yB]) {
        doc.poly([sx, y, sx + dir * 7, y, sx + dir * 8.5, y + 1.6, sx + dir * 10, y - 1.6, sx + dir * 11.5, y, sx + dir * 18, y], { color: ELEC_CABLES.bus.color, w: 0.4, dash: ELEC_CUST });
      }
      const t = elecNoteBox(doc, 'To Customer', dir < 0 ? sx - 36 : sx + 19, (yA + yB) / 2 + 3, 17, { size: 2.2, align: 'center' });
      void t;
    }
    const note = elecNote(setup, 'junctionBox');
    /* the note points at the junction box (AYK feedback, 27 Nov 2026) */
    if (note.trim()) {
      const nb = elecNoteBox(doc, note, 22, 48, 88, { size: 1.9, id: 'note:junctionBox' });
      elecLeader(doc, nb, jb.box[0], jb.box[1] + jb.box[3] * 0.25);
    }
  }
  /* SSC B+ / B- to the junction box: odd SSCs of the bank to the first Bus pair, even to the second */
  const pairs = jb ? (() => { const plus = jb.list.filter(p => p.name === 'Bus+'), minus = jb.list.filter(p => p.name === 'Bus-'); return plus.map((p, i) => ({ plus: p, minus: minus[i] })).filter(p => p.minus); })() : [];
  const mv = ctx.view('module', 'front');
  sh.items.forEach((name, k) => {
    const x0 = sh.items.length === 1 ? 30 + 100 : 30 + k * 200;
    const d = elecDrawPart(doc, v, [x0, 150, 120, 90], { nameSize: 2 });
    /* tag under the SSC's left side, where no lead runs (its B+/B- drop to the junction box) */
    elecTag(doc, `${name} Front`, d.box[0], 134);
    const ref = elecNote(setup, 'sscFront');
    if (ref.trim()) elecNoteBox(doc, ref, d.box[0] - 2, 131.5, 42, { size: 1.8, id: 'note:sscFront' });
    if (mv) elecModuleChain(doc, mv, d, x0 + 108, (setup.sscs.find(c => c.name === name) || {}).modules);
    const pair = pairs.length ? pairs[bank.indexOf(name) % pairs.length] : null;
    if (!pair) return;
    const bp = d.ports['B+'], bm = d.ports['B-'];
    const col = ELEC_CABLES.bus.color;
    const goRight = pair.plus.x > bp.x;
    /* nested so the two never cross: the port nearer the box takes the higher lane */
    const hi = 118 - k * 2.5, lo = 112 - k * 2.5;
    const near = goRight ? [bm, pair.minus, hi] : [bp, pair.plus, hi], far = goRight ? [bp, pair.plus, lo] : [bm, pair.minus, lo];
    for (const [p, q, lane] of [near, far]) doc.poly([p.x, p.y - p.r, p.x, lane, q.x, lane, q.x, q.y + q.r], { color: col, w: 0.45, id: `bus:${name} ${p === bp ? 'B+' : 'B-'}` });
  });
}

/**
 * The SSC's string of battery modules beside its front (DWG2527 sheet 7): Module 1, Module 2
 * and the last module, from MODULE.dxf. Wiring as DWG2527: SSC S → M1 N, Mk S → Mk+1 N,
 * last S → SSC N (comm); SSC S− → M1 −, Mk + → Mk+1 −, last + → SSC S+ (power).
 * Routed so nothing crosses: S, N and S+ go round the left of the SSC and over its top, S− runs
 * below the string and in from the right; the module-to-module power alternates sides.
 * count: modules on this SSC (null = not given: the last one is "Module n").
 */
function elecModuleChain(doc, mv, d, mx, count) {
  const W = 56, H = 18.2, slots = [222, 196, 160];
  const n = count >= 1 ? count : null;
  const shown = n && n < 3 ? slots.slice(0, n).map((y, i) => ({ y, label: 'Module ' + (i + 1) }))
    : [{ y: slots[0], label: 'Module 1' }, { y: slots[1], label: 'Module 2' }, { y: slots[2], label: 'Module ' + (n || 'n') }];
  const mods = shown.map(m => {
    const r = elecDrawPart(doc, mv, [mx, m.y, W, H], { portNames: false, lw: 0.1 });
    doc.text(m.label, mx + 34, m.y + 13.5, { size: 2, align: 'center', color: ELEC_INK });
    /* the module's comm jacks read S (top) and N (below it) (AYK feedback, 27 Nov 2026); the
       lines stay where DWG2527 draws them, only the printed letters follow AYK's correction */
    [r.ports.S, r.ports.N].filter(Boolean).sort((a, b) => b.y - a.y)
      .forEach((p, i) => doc.text(i ? 'N' : 'S', p.x - p.r - 0.6, p.y - 0.6, { size: 1.4, align: 'right', color: ELEC_INK }));
    return r.ports;
  });
  if (n === null || n > 3) {
    const gx = mx + 34;
    doc.poly([gx, slots[1] - 1, gx, slots[2] + H + 1], { color: '#6b7280', w: 0.3, dash: [1.2, 1.2] });
    doc.text(n ? `Modules 3 to ${n - 1}` : 'Modules 3 …', gx + 1.5, (slots[1] + slots[2] + H) / 2 - 0.7, { size: 1.6, color: '#6b7280' });
  }
  const green = { color: ELEC_CABLES.comm.color, w: 0.35 }, red = { color: ELEC_CABLES.bus.color, w: 0.45 };
  const first = mods[0], last = mods[mods.length - 1];
  const P = d.ports, out = p => p.y - p.r;
  /* between modules: comm straight down the jacks; power from + round to the next − */
  mods.slice(1).forEach((m, i) => {
    const a = mods[i];
    doc.poly([a.S.x, a.S.y - a.S.r, m.N.x, m.N.y + m.N.r], green);
    const lane = (mods.length - 2 - i) % 2 === 0 ? mx + 58 : mx + 44;
    const side = lane > a['+'].x ? 1 : -1;
    doc.poly([a['+'].x + side * a['+'].r, a['+'].y, lane, a['+'].y, lane, m['-'].y, m['-'].x + side * m['-'].r, m['-'].y], red);
  });
  /* S, N, S+: down, left round the SSC, over its top, down into the string */
  const L = d.box[0];
  const over = [
    { p: P.S, lane: 148.5, col: L - 6, top: 244, down: first.N.x, to: first.N, style: green, end: 'top' },
    { p: P.N, lane: 146.5, col: L - 9, top: 247, down: mx + 20, to: last.S, style: green, end: 'left' },
    { p: P['S+'], lane: 144.5, col: L - 12, top: 250, down: mx + 24, to: last['+'], style: red, end: 'right' },
  ];
  for (const o of over) {
    const pts = [o.p.x, out(o.p), o.p.x, o.lane, o.col, o.lane, o.col, o.top, o.down, o.top];
    if (o.end === 'top') pts.push(o.down, o.to.y + o.to.r);
    else pts.push(o.down, o.to.y, o.to.x + (o.end === 'left' ? o.to.r : -o.to.r), o.to.y);
    doc.poly(pts, o.style);
  }
  /* S−: below the string, up its right side, into Module 1 − */
  const m1 = first['-'], col = mx + 62;
  doc.poly([P['S-'].x, out(P['S-']), P['S-'].x, 142.5, col, 142.5, col, m1.y, m1.x + m1.r, m1.y], red);
}

/** Draws every sheet of a confirmed setup onto doc (a pdfDoc, or the editor's SVG target) with
    the engineer's edits; returns the sheet list. opts.only: draw just that sheet number;
    opts.interactive: mark the editable items for the editor. */
function elecDraw(doc0, setup, lib, info, opts) {
  opts = opts || {};
  const sheets = elecSheets(setup);
  const ctx = {
    links: elecLinks(setup),
    sheetOf: elecSheetOf(sheets),
    view: (part, v) => { const p = lib.parts.find(x => x.id === part); return p && p.views.find(x => x.id === v); },
  };
  const bankOf = id => setup.banks.find(b => b.id === id);
  elecInlineView = ctx.view('inline', 'side') || null;
  let first = true;
  sheets.forEach(sh => {
    if (opts.only && sh.n !== opts.only) return;
    if (!first) doc0.newPage();
    first = false;
    const ed = setup.edits && setup.edits[elecSheetKey(sh)];
    const doc = elecEditTarget(doc0, ed, !!opts.interactive);
    const b = sh.bank ? bankOf(sh.bank) : null;
    sh.bankName = b ? b.name : '';
    elecFrame(doc, sh, info);
    if (sh.kind === 'notes' && sh.n === 1) elecNotesMsm(doc, setup, ctx.view);
    else if (sh.kind === 'notes') elecNotesInline(doc, setup, ctx.view('inline', 'side'));
    else if (sh.kind === 'msm') elecMsmSheet(doc, setup, b, sh, ctx);
    else if (sh.kind === 'acdp') elecAcdpSheet(doc, setup, b, sh.items[0], ctx);
    else if (sh.kind === 'ssc-back') elecSscSheet(doc, setup, sh, ctx);
    else if (sh.kind === 'fronts') elecFrontsSheet(doc, setup, sh, b, ctx);
    elecAdded(doc, ed);
  });
  return sheets;
}

/** The whole diagram as PDF bytes. */
async function elecPdf(setup, lib, info) {
  const doc = pdfDoc({ w: ELEC_A3.w, h: ELEC_A3.h, title: (info.docNumber || 'Electrical Diagram') + ' ' + (info.title || '') });
  elecDraw(doc, setup, lib, info);
  return doc.bytes();
}

if (typeof module !== 'undefined') module.exports = { elecSheetKey, elecEditTarget, elecPathPolys, elecDraw, elecPdf, elecWrap, ELEC_CABLES };
