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
    const q = { x: X(p.x), y: Y(p.y), r: p.size / 2 * s, name: p.name, unused: !!p.unused };
    list.push(q);
    if (!ports[p.name]) ports[p.name] = q;      /* a junction box repeats Bus+ / Bus- */
  }
  if (o.portNames !== false) for (const p of list) {
    doc.text(p.name, p.x, p.y + p.r + 1.2, { size: o.nameSize || 1.8, align: 'center', color: p.unused ? '#94a3b8' : ELEC_INK });
  }
  return { ports: ports, list: list, box: [ox, oy, view.w * s, view.h * s], scale: s };
}

/** Yellow name tag (bottom-left at x, y); returns its width. */
function elecTag(doc, text, x, y, size) {
  size = size || 3.2;
  const w = pdfTextWidth(text, size, true) + 4, h = size + 2.4;
  doc.rect(x, y, w, h, { fill: ELEC_TAG, stroke: false });
  doc.text(text, x + 2, y + 1.3, { size: size, bold: true, color: ELEC_INK });
  return w;
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
  const size = o.size || 2.2, lh = size * 1.32, pad = 1.2;
  const lines = elecWrap(text, w - 2 * pad, size, o.bold);
  const h = lines.length * lh + 2 * pad - (lh - size) + 0.6;
  if (o.fill !== false) doc.rect(x, top - h, w, h, { fill: o.fill || ELEC_CYAN, stroke: false });
  lines.forEach((l, i) => doc.text(l, o.align === 'center' ? x + w / 2 : x + pad, top - pad - size - i * lh + 0.3, { size: size, color: ELEC_INK, bold: o.bold, align: o.align }));
  return { x: x, y: top - h, w: w, h: h, top: top };
}

/** Thin leader from a note box to a point (from the box side nearest the point). */
function elecLeader(doc, box, px, py, color) {
  const cx = Math.max(box.x, Math.min(box.x + box.w, px)), cy = Math.max(box.y, Math.min(box.y + box.h, py));
  doc.line(cx, cy, px, py, { color: color || '#22d3ee', w: 0.2 });
  doc.circle(px, py, 0.5, { fill: color || '#22d3ee', stroke: false });
}

/** Inline connector symbol: two halves, centred on x, top at y. */
function elecPlug(doc, x, top, w, h, color) {
  doc.rect(x - w / 2, top - h, w, h, { color: color || '#334155', w: 0.25 });
  doc.line(x - w / 2, top - h / 2, x + w / 2, top - h / 2, { color: color || '#334155', w: 0.25 });
  for (const f of [0.25, 0.75]) doc.line(x - w / 2 + 0.6, top - h * f, x + w / 2 - 0.6, top - h * f, { color: '#94a3b8', w: 0.15 });
}

/** Cable break (customer side): a short zigzag in a vertical lead at x around y. */
function elecBreak(doc, x, y, color, dash) {
  doc.poly([x, y + 3, x, y + 1.2, x - 1.4, y + 0.4, x + 1.4, y - 0.4, x, y - 1.2, x, y - 3], { color: color, w: 0.35 });
}

/** The end of a lead that leaves the sheet: connector, then its label reading upwards. */
function elecEnd(doc, x, y, color, text) {
  const plugH = 7;
  elecPlug(doc, x, y, 2.4, plugH, '#334155');
  const w = pdfTextWidth(text, 2, false);
  doc.text(text, x + 3.2, y - w - 0.5, { size: 2, rot: 90, color: ELEC_INK });
  return y - Math.max(plugH, w + 0.5);
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
  doc.text('Shenzhen Anyikong Power', right + rw / 2, t.y + 37.2, { size: 2, align: 'center' });
  doc.text('Technology Co., Ltd.', right + rw / 2, t.y + 34.4, { size: 2, align: 'center' });
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
const elecDashOf = e => (e.dash ? [1.6, 1.1] : null);

/** Leads straight down from each port to a connector and its label at endY. */
function elecDropLeads(doc, ends, endY) {
  for (const e of ends) {
    doc.poly([e.x, e.y - e.r, e.x, endY], { color: e.color, w: 0.35, dash: elecDashOf(e) });
    elecEnd(doc, e.x, endY, e.color, e.text);
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
      doc.poly([e.x, side === 'left' ? e.y - e.r : e.y + e.r, e.x, lane, col, lane, col, endY], { color: e.color, w: 0.35, dash: elecDashOf(e) });
      elecEnd(doc, col, endY, e.color, e.text);
      i++;
    });
  }
}

/** ACDP AC power in: down through the inline connectors, a break, to the customer tag. */
function elecAcIn(doc, ends, boxTop, setup) {
  const ac = ends.filter(e => /^ac-in/.test(e.cable)).sort((a, b) => a.x - b.x);
  if (!ac.length) return null;
  const x0 = ac[0].x - 6, x1 = ac[ac.length - 1].x + 6, boxH = 16;
  doc.rect(x0, boxTop - boxH, x1 - x0, boxH, { color: '#e11d1d', w: 0.35 });
  for (const e of ac) {
    doc.poly([e.x, e.y - e.r, e.x, boxTop - 1.5], { color: e.color, w: 0.35 });
    elecPlug(doc, e.x, boxTop - 1.5, 7.5, boxH - 3, '#64748b');
    doc.text('ACDP', e.x, boxTop - 5.2, { size: 1.3, align: 'center' });
    doc.text('POWER ' + e.port.slice(-1), e.x, boxTop - 7.6, { size: 1.3, align: 'center' });
    doc.poly([e.x, boxTop - boxH + 1.5, e.x, boxTop - boxH - 6], { color: e.color, w: 0.35, dash: [1.6, 1.1] });
    elecBreak(doc, e.x, boxTop - boxH - 9, e.color);
    doc.line(e.x, boxTop - boxH - 12, e.x, boxTop - boxH - 15, { color: e.color, w: 0.35 });
  }
  const tagTop = boxTop - boxH - 15, mid = (x0 + x1) / 2;
  const tag = elecNoteBox(doc, '230VAC Control Power Inlet For Battery Servicing', mid - 17, tagTop, 34, { fill: ELEC_TAG, size: 2.3, align: 'center' });
  return { box: [x0, boxTop - boxH, x1 - x0, boxH], tag: tag };
}

/** The panel callout: TN0089 note and the rack's signal inter-connection panel. */
function elecPanelNote(doc, setup, rack, x, top, w) {
  const n = elecNote(setup, 'panel');
  const b = n.trim() ? elecNoteBox(doc, n, x, top, w, { size: 1.9, align: 'center' }) : { x: x, y: top, w: w, h: 0 };
  const name = (rack ? rack + ' ' : '') + 'Signal Inter Connection Panel';
  const t = elecNoteBox(doc, name, x, b.y, w, { fill: false, size: 1.9, align: 'center' });
  doc.rect(t.x, t.y, t.w, t.h, { color: '#cbd5e1', w: 0.2 });
  return { x: x, y: t.y, w: w, h: top - t.y };
}

/* ---------- sheets ---------- */

/** Sheet 1: the MSM back with AYK's notes pointing at its ports. */
function elecNotesMsm(doc, setup, view) {
  const msm = view('msm', 'back');
  if (!msm) return;
  elecTag(doc, 'MSM Back', 176, 172, 3.6);
  const d = elecDrawPart(doc, msm, [120, 62, 150, 106], { nameSize: 2 });
  const P = n => d.ports[n];
  const note = (id, x, top, w, size) => { const t = elecNote(setup, id); return t.trim() ? elecNoteBox(doc, t, x, top, w, { size: size || 2.2 }) : null; };
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
  /* Figure 1: the customer's E-stop loop */
  const fx = 384, fy = 276;
  doc.rect(fx, fy - 34, 24, 34, { color: '#22d3ee', w: 0.25 });
  doc.text('RemoteE', fx + 2, fy - 4, { size: 1.6 });
  doc.text('Resistor network', fx + 2, fy - 7, { size: 1.6 });
  doc.line(fx + 4, fy - 12, fx + 4, fy - 28, { color: ELEC_INK, w: 0.25 });
  doc.line(fx + 20, fy - 12, fx + 20, fy - 28, { color: ELEC_INK, w: 0.25 });
  doc.line(fx + 4, fy - 12, fx + 9, fy - 12, { color: ELEC_INK, w: 0.25 });
  doc.poly([fx + 9, fy - 12, fx + 10, fy - 11, fx + 11, fy - 13, fx + 12, fy - 11, fx + 13, fy - 13, fx + 14, fy - 12, fx + 20, fy - 12], { color: ELEC_INK, w: 0.25 });
  doc.text('1k series', fx + 9, fy - 15, { size: 1.4 });
  doc.line(fx + 4, fy - 28, fx + 8, fy - 28, { color: ELEC_INK, w: 0.25 });
  doc.line(fx + 8, fy - 28, fx + 12, fy - 26, { color: ELEC_INK, w: 0.25 });
  doc.line(fx + 13, fy - 28, fx + 20, fy - 28, { color: ELEC_INK, w: 0.25 });
  doc.text('NC E-stop', fx + 7, fy - 31, { size: 1.4 });
  doc.poly([fx + 16, fy - 12, fx + 16, fy - 17, fx + 15, fy - 18, fx + 17, fy - 19, fx + 15, fy - 20, fx + 17, fy - 21, fx + 16, fy - 22, fx + 16, fy - 28], { color: ELEC_INK, w: 0.25 });
  doc.text('10k', fx + 17.5, fy - 20.5, { size: 1.4 });
  elecTag(doc, 'Figure 1', fx + 6, fy - 39, 1.8);
  const extra = elecNote(setup, 'extra');
  if (extra.trim()) elecNoteBox(doc, extra, 22, 100, 90, { size: 2.2, fill: '#fef9c3' });
}

/** Sheet 2: inline connectors, cable legend, wiring instructions. */
function elecNotesInline(doc, setup) {
  /* legend, top right */
  const L = Object.values(ELEC_CABLES);
  const lx = 300, top = 284, lh = 4.2;
  doc.rect(lx - 2, top - L.length * lh - 6, 112, L.length * lh + 6, { color: ELEC_INK, w: 0.3 });
  L.forEach((c, i) => {
    const y = top - 3 - i * lh;
    doc.line(lx, y, lx + 8, y, { color: c.color, w: 0.6 });
    doc.text(c.label, lx + 10, y - 0.8, { size: 1.9 });
  });
  const dy = top - 3 - L.length * lh;
  doc.line(lx, dy, lx + 8, dy, { color: ELEC_INK, w: 0.4, dash: [1.6, 1.1] });
  doc.text('Dashed: between racks, through an inline connector (customer cable)', lx + 10, dy - 0.8, { size: 1.9 });
  /* the inline connector groups (DWG2527 sheet 2) */
  const groups = [
    { frame: '#e11d1d', plugs: [['ACDP', 'POWER', 'P', 'ac-in-P'], ['ACDP', 'POWER', 'B', 'ac-in-B']], tag: 'Inline Connector EW-M25B, 3 pin\nPin1(Red): L\nPin2(Blue): N\nPin3(Yellow): G' },
    { frame: '#7c3aed', plugs: [['Dry', 'Contact', '', 'dry-contact']], tag: 'Inline Connector EW-M25B, 3 Pins\nPin 1(Red)\nPin 2(Blue)' },
    { frame: '#7c3aed', plugs: [['Remote', 'Estop', '', 'remote-estop']], tag: 'Inline Connector EW-P25, 4 Pin' },
    { frame: '#e11d1d', plugs: [['SSC', 'POWER', 'P', 'power-P'], ['SSC', 'POWER', 'B', 'power-B']], tag: 'Inline Connector EW-M25B, 3 pin\nPin1(Red): L\nPin2(Blue): N\nPin3(Yellow): G' },
    { frame: '#16a34a', plugs: [['SSC', 'Comm', '', 'comm']], tag: 'Inline connector RJ45' },
    { frame: '#7c3aed', plugs: [['', 'Estop', '', 'estop']], tag: 'Inline Connector EW-P25, 4 Pin' },
  ];
  const y0 = 150, h = 34, plugW = 22, gap = 4;
  let x = 52;
  groups.forEach((g, gi) => {
    const w = g.plugs.length * plugW + 4;
    doc.rect(x, y0, w, h, { color: g.frame, w: 0.45 });
    g.plugs.forEach((p, k) => {
      const cx = x + 2 + plugW / 2 + k * plugW, col = ELEC_CABLES[p[3]].color;
      doc.rect(cx - 5, y0 + 3, 10, h - 6, { color: '#94a3b8', w: 0.25 });
      doc.line(cx - 5, y0 + h / 2, cx + 5, y0 + h / 2, { color: '#94a3b8', w: 0.2 });
      [p[0], p[1], p[2]].filter(Boolean).forEach((t, i) => doc.text(t, cx, y0 + h - 9 - i * 3.6, { size: 2, align: 'center' }));
      doc.line(cx, y0 + h, cx, y0 + h + 30, { color: col, w: 0.4 });
      doc.line(cx, y0, cx, y0 - 30, { color: col, w: 0.4 });
    });
    const tag = elecNoteBox(doc, g.tag, x + w / 2 - 17, gi % 2 ? y0 - 37 : y0 + h + 58, 34, { fill: ELEC_TAG, size: 1.9, align: 'center' });
    doc.line(x + w / 2, gi % 2 ? tag.top : tag.y, x + w / 2, gi % 2 ? y0 - 31 : y0 + h + 31, { color: '#94a3b8', w: 0.15 });
    x += w + gap;
  });
  doc.text('Rack side (AYK harness)', 52, y0 + h + 33, { size: 2, color: '#475569' });
  doc.text('Customer side (customer makes this cable)', 52, y0 - 34, { size: 2, color: '#475569' });
  /* the wiring instructions (editable), bottom left */
  const t = elecNote(setup, 'inline');
  if (t.trim()) {
    const b = elecNoteBox(doc, t, 15, 92, 178, { size: 1.75, fill: false });
    doc.rect(b.x, b.y, b.w, b.h, { color: '#22d3ee', w: 0.3 });
  }
}

/** Bank: the MSM back (top) and the bank's first ACDP (bottom left), routed as DWG2527. */
function elecMsmSheet(doc, setup, b, sh, ctx) {
  const v = ctx.view('msm', 'back');
  elecTag(doc, `${b.msm.name} Back`, 196, 250, 3.4);
  const d = elecDrawPart(doc, v, [150, 166, 126, 82], { nameSize: 1.6 });
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
  const boxTop = 162, boxH = 20;
  if (cust.length) doc.rect(custCols[0] - 7, boxTop - boxH, custCols[1] - custCols[0] + 14, boxH, { color: '#7c3aed', w: 0.4 });
  cust.forEach((e, k) => {
    /* the right-hand port takes the upper lane and the outer column, so the two never cross */
    const kk = cust.length - 1 - k;
    const lane = e.y - e.r - 1.4 - kk * 1.5, col = custCols[k] || custCols[1];
    doc.poly([e.x, e.y - e.r, e.x, lane, col, lane, col, boxTop - 1.5], { color: e.color, w: 0.35, dash: [1.6, 1.1] });
    elecPlug(doc, col, boxTop - 1.5, 4.4, boxH - 3, '#64748b');
    doc.text(e.cable === 'dry-contact' ? 'Dry' : 'Remote', col, boxTop - 8, { size: 1.5, align: 'center' });
    doc.text(e.cable === 'dry-contact' ? 'Contact' : 'Estop', col, boxTop - 10.5, { size: 1.5, align: 'center' });
    const tagTop = k ? 120 : 134;
    doc.poly([col, boxTop - boxH + 1.5, col, tagTop], { color: e.color, w: 0.35, dash: [1.6, 1.1] });
    elecNoteBox(doc, e.cable === 'dry-contact' ? 'Client-side Thermal Runaway Status Signal' : 'Client-side Remote Estop', col - 9, tagTop, 18, { fill: ELEC_TAG, size: 1.9, align: 'center' });
  });
  /* master valves: down through the LP16-7 connectors to the valves */
  for (const e of of('valve')) {
    doc.poly([e.x, e.y - e.r, e.x, 156], { color: e.color, w: 0.35 });
    doc.rect(e.x - 5.5, 147, 11, 9, { color: '#64748b', w: 0.25, fill: '#ffffff' });
    ['LP16-7 Female', 'to', 'LP16-7 Male'].forEach((t, i) => doc.text(t, e.x, 153.6 - i * 2.4, { size: 1.25, align: 'center' }));
    doc.poly([e.x, 147, e.x, 140], { color: e.color, w: 0.35, dash: [1.6, 1.1] });
    elecNoteBox(doc, e.text.replace(/^To /, '').replace(/ · .*/, '').replace(/Master Valve\s*/, 'Master Valve '), e.x - 5.5, 140, 11, { fill: ELEC_TAG, size: 1.9, align: 'center' });
  }
  /* Ex.FanFB is not in use (DWG2527) */
  const fan = d.ports['Ex.FanFB'];
  if (fan) {
    const t = elecNoteBox(doc, 'Not in use', right + 6, 208, 13, { fill: ELEC_TAG, size: 1.9, align: 'center' });
    elecLeader(doc, t, fan.x, fan.y, '#334155');
  }
  /* the first ACDP, below left; MSM power runs straight to it */
  const name = sh.acdp;
  const av = ctx.view('acdp', 'back');
  let acdpEnds = [];
  if (name && av) {
    const a = elecAcdps(b).find(x => x.name === name) || {};
    elecTag(doc, `${name} Back`, 30, 118, 3);
    const ad = elecDrawPart(doc, av, [28, 72, 118, 44], { nameSize: 1.5 });
    acdpEnds = elecEndsOn(ctx.links, ctx.sheetOf, 'acdp', name, ad.ports);
    /* MSM PowerP/B to ACDP MSMP/MSMB (as DWG2527: P runs on the lower lane) */
    for (const pb of ['B', 'P']) {
      const m = ends.find(e => e.cable === 'power-' + pb && e.port === 'Power' + pb);
      const q = ad.ports['MSM' + pb];
      if (!m || !q) continue;
      const lane = pb === 'B' ? 163 : 156;
      doc.poly([m.x, m.y - m.r, m.x, lane, q.x, lane, q.x, q.y + q.r], { color: m.color, w: 0.35, dash: elecDashOf(m) });
    }
    elecDropLeads(doc, acdpEnds.filter(e => /^power-/.test(e.cable) && !/^MSM/.test(e.port)), 64);
    const ac = elecAcIn(doc, acdpEnds, 64, setup);
    const acNote = elecNote(setup, 'acPower');
    if (ac && acNote.trim()) {
      const nb = elecNoteBox(doc, acNote, 150, 102, 82, { size: 2 });
      elecLeader(doc, nb, ac.box[0] + ac.box[2], ac.box[1] + ac.box[3] / 2);
    }
    elecPanelNote(doc, setup, a.rack || '', 30, 30, 56);
  } else {
    /* no ACDP drawn here: the MSM power leaves the sheet like any other lead */
    elecDropLeads(doc, ends.filter(e => /^power-/.test(e.cable)), 150);
  }
  elecPanelNote(doc, setup, b.msm.rack || '', 330, 116, 66);
}

/** A further ACDP of the bank. */
function elecAcdpSheet(doc, setup, b, name, ctx) {
  const a = elecAcdps(b).find(x => x.name === name) || {};
  elecTag(doc, `${name} Back`, 62, 240, 3.4);
  const ad = elecDrawPart(doc, ctx.view('acdp', 'back'), [60, 150, 230, 87], { nameSize: 2.2 });
  const ends = elecEndsOn(ctx.links, ctx.sheetOf, 'acdp', name, ad.ports);
  elecDropLeads(doc, ends.filter(e => /^power-/.test(e.cable)), 140);
  const ac = elecAcIn(doc, ends, 140, setup);
  const acNote = elecNote(setup, 'acPower');
  if (ac && acNote.trim()) {
    const nb = elecNoteBox(doc, acNote, 300, 200, 100, { size: 2.6 });
    elecLeader(doc, nb, ac.box[0] + ac.box[2], ac.box[1] + ac.box[3] / 2);
  }
  elecPanelNote(doc, setup, a.rack || '', 80, 98, 60);
}

/** SSC backs (two at most) with their cooling fans. */
function elecSscSheet(doc, setup, sh, ctx) {
  const v = ctx.view('ssc', 'back');
  sh.items.forEach((name, k) => {
    const c = setup.sscs.find(x => x.name === name) || {};
    const x0 = 22 + k * 195;
    elecTag(doc, `${name} Back`, x0 + 18, 238, 3.2);
    const d = elecDrawPart(doc, v, [x0, 118, 140, 122], { nameSize: 1.7 });
    const ends = elecEndsOn(ctx.links, ctx.sheetOf, 'ssc', name, d.ports, 'From');
    elecDropLeads(doc, ends, 108);
    /* cooling fans: down, along the bottom, up to an LP16-3 inline socket per fan */
    const fp = d.ports['Cooling Fan'], fans = Math.max(0, Math.min(6, +c.fans || 0));
    if (fp && fans) {
      const col = ELEC_CABLES.fan.color, bx = x0 + 150, low = 70, top = 150;
      doc.poly([fp.x, fp.y - fp.r, fp.x, low, bx, low, bx, top], { color: col, w: 0.35 });
      for (let f = 0; f < fans; f++) {
        const y = top - f * 8;
        doc.line(bx, y, bx + 4, y, { color: col, w: 0.35 });
        doc.rect(bx + 4, y - 3, 7, 6, { color: '#334155', w: 0.25 });
        ['LP16-3', 'Inline', 'Socket'].forEach((t, i) => doc.text(t, bx + 7.5, y + 1.4 - i * 1.6, { size: 1.05, align: 'center' }));
        doc.line(bx + 11, y, bx + 14, y, { color: col, w: 0.35 });
        doc.rect(bx + 14, y - 2.5, 18, 5, { color: ELEC_INK, w: 0.3 });
        doc.text('Cooling Fan ' + (f + 1), bx + 23, y - 0.9, { size: 2, align: 'center' });
      }
    }
    elecPanelNote(doc, setup, c.rack || '', x0 + 4, 66, 64);
  });
}

/** Junction box and SSC fronts (two at most). */
function elecFrontsSheet(doc, setup, sh, b, ctx) {
  const jbv = ctx.view(setup.jbModel === 2 ? 'jb2' : 'jb4', 'front');
  const v = ctx.view('ssc', 'front');
  const bank = elecBankSscs(setup, b.id).map(c => c.name);
  let jb = null;
  if (jbv) {
    elecTag(doc, 'Junction Box Front', 132, 100, 3.6);
    jb = elecDrawPart(doc, jbv, [112, 58, 136, 40], { nameSize: 2 });
    /* the customer's main power cables, both sides */
    const yA = jb.box[1] + jb.box[3] * 0.62, yB = jb.box[1] + jb.box[3] * 0.38;
    for (const [sx, dir] of [[jb.box[0], -1], [jb.box[0] + jb.box[2], 1]]) {
      for (const y of [yA, yB]) {
        doc.poly([sx, y, sx + dir * 7, y, sx + dir * 8.5, y + 1.6, sx + dir * 10, y - 1.6, sx + dir * 11.5, y, sx + dir * 18, y], { color: ELEC_CABLES.bus.color, w: 0.4 });
      }
      const t = elecNoteBox(doc, 'To Customer', dir < 0 ? sx - 36 : sx + 19, (yA + yB) / 2 + 3, 17, { size: 2.2, align: 'center' });
      void t;
    }
    const note = elecNote(setup, 'junctionBox');
    if (note.trim()) elecNoteBox(doc, note, 22, 48, 88, { size: 1.9 });
  }
  /* SSC B+ / B- to the junction box: odd SSCs of the bank to the first Bus pair, even to the second */
  const pairs = jb ? (() => { const plus = jb.list.filter(p => p.name === 'Bus+'), minus = jb.list.filter(p => p.name === 'Bus-'); return plus.map((p, i) => ({ plus: p, minus: minus[i] })).filter(p => p.minus); })() : [];
  const mv = ctx.view('module', 'front');
  sh.items.forEach((name, k) => {
    const x0 = 30 + k * 200;
    const d = elecDrawPart(doc, v, [x0, 150, 120, 90], { nameSize: 2 });
    elecTag(doc, `${name} Front`, x0 + 20, 134, 3.4);
    const ref = elecNote(setup, 'sscFront');
    if (ref.trim()) elecNoteBox(doc, ref, x0 + 18, 131.5, 42, { size: 1.8 });
    if (mv) elecModuleChain(doc, mv, d, x0 + 108, (setup.sscs.find(c => c.name === name) || {}).modules);
    const pair = pairs.length ? pairs[bank.indexOf(name) % pairs.length] : null;
    if (!pair) return;
    const bp = d.ports['B+'], bm = d.ports['B-'];
    const col = ELEC_CABLES.bus.color;
    const goRight = pair.plus.x > bp.x;
    /* nested so the two never cross: the port nearer the box takes the higher lane */
    const hi = 118 - k * 2.5, lo = 112 - k * 2.5;
    const near = goRight ? [bm, pair.minus, hi] : [bp, pair.plus, hi], far = goRight ? [bp, pair.plus, lo] : [bm, pair.minus, lo];
    for (const [p, q, lane] of [near, far]) doc.poly([p.x, p.y - p.r, p.x, lane, q.x, lane, q.x, q.y + q.r], { color: col, w: 0.45 });
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
    for (const t of ['S', 'N']) { const p = r.ports[t]; doc.text(t, p.x - p.r - 0.6, p.y - 0.6, { size: 1.4, align: 'right', color: ELEC_INK }); }
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

/** Draws every sheet of a confirmed setup onto doc (a pdfDoc); returns the sheet list. */
function elecDraw(doc, setup, lib, info) {
  const sheets = elecSheets(setup);
  const ctx = {
    links: elecLinks(setup),
    sheetOf: elecSheetOf(sheets),
    view: (part, v) => { const p = lib.parts.find(x => x.id === part); return p && p.views.find(x => x.id === v); },
  };
  const bankOf = id => setup.banks.find(b => b.id === id);
  sheets.forEach((sh, i) => {
    if (i) doc.newPage();
    const b = sh.bank ? bankOf(sh.bank) : null;
    sh.bankName = b ? b.name : '';
    elecFrame(doc, sh, info);
    if (sh.kind === 'notes' && sh.n === 1) elecNotesMsm(doc, setup, ctx.view);
    else if (sh.kind === 'notes') elecNotesInline(doc, setup);
    else if (sh.kind === 'msm') elecMsmSheet(doc, setup, b, sh, ctx);
    else if (sh.kind === 'acdp') elecAcdpSheet(doc, setup, b, sh.items[0], ctx);
    else if (sh.kind === 'ssc-back') elecSscSheet(doc, setup, sh, ctx);
    else if (sh.kind === 'fronts') elecFrontsSheet(doc, setup, sh, b, ctx);
  });
  return sheets;
}

/** The whole diagram as PDF bytes. */
async function elecPdf(setup, lib, info) {
  const doc = pdfDoc({ w: ELEC_A3.w, h: ELEC_A3.h, title: (info.docNumber || 'Electrical Diagram') + ' ' + (info.title || '') });
  elecDraw(doc, setup, lib, info);
  return doc.bytes();
}

if (typeof module !== 'undefined') module.exports = { elecPathPolys, elecDraw, elecPdf, elecWrap, ELEC_CABLES };
