/* ============================================================
 * WireFlow — electrical diagram sheets (AYK DWG2527 format) and PDF
 * ------------------------------------------------------------
 * Draws the sheets elecSheets() lists, from a confirmed setup and the
 * part library (assets/elec/parts.json), onto any target with the pdfDoc
 * API (poly, line, rect, circle, text). A3 landscape, millimetres, Y up.
 *
 * Every connected port gets a lead in its cable's colour (dashed when the
 * cable runs between racks: inline connector, customer cable) ending in a
 * label that says where it goes and on which sheet, as DWG2527 does
 * ("To SSC1 CommP · Sheet 4"). Ports that must stay unconnected are never
 * given a lead. Needs elec.js (and pdf.js for the PDF).
 * ============================================================ */

const ELEC_A3 = { w: 420, h: 297 };
const ELEC_FRAME = 10;                                  /* border margin, mm */
const ELEC_TB = { x: 250, y: 10, w: 160, h: 40 };       /* title block, bottom right */
const ELEC_LABEL_Y = 56;                                /* leads end here; labels run upwards */

/* cable colours and sizes (DWG2527 legend, sheet 2) */
const ELEC_CABLES = {
  comm: { color: '#16a34a', label: 'Comm. line: Cat6A Ethernet or higher, OD 8 mm' },
  estop: { color: '#7c3aed', label: 'MSM_SSC Estop: 0.3/0.5 kV 4 x 0.518 mm², OD 5-9 mm' },
  'power-P': { color: '#e11d1d', label: '220-230 VAC SSC/MSM primary power: 0.3/0.5 kV 3 x 1.5 mm²' },
  'power-B': { color: '#0ea5e9', label: '220-230 VAC SSC/MSM backup power: 0.3/0.5 kV 3 x 1.5 mm²' },
  'ac-in-P': { color: '#e11d1d', label: '220-230 VAC ACDP primary power in: 0.3/0.5 kV 3 x 2.5 mm²' },
  'ac-in-B': { color: '#0ea5e9', label: '220-230 VAC ACDP backup power in: 0.3/0.5 kV 3 x 2.5 mm²' },
  valve: { color: '#f2b600', label: 'Master valve, fire fighting: 0.3/0.5 kV 5 x 0.3 mm², OD 8 mm' },
  'remote-estop': { color: '#7c3aed', label: 'Remote E-stop: 0.3/0.5 kV 4 x 0.518 mm², OD 5-9 mm' },
  'dry-contact': { color: '#7c3aed', label: 'Dry contact: 0.3/0.5 kV 2 x 0.518 mm², OD 5-9 mm' },
  bus: { color: '#e11d1d', label: 'Main power: 0.6/1 kV 1 x 95 mm², OD 18.5 mm max' },
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
    doc.text(p.name, p.x, p.y + p.r + 1.2, { size: o.nameSize || 1.8, align: 'center', color: p.unused ? '#94a3b8' : '#111827' });
  }
  return { ports: ports, list: list, box: [ox, oy, view.w * s, view.h * s], scale: s };
}

function elecTag(doc, text, x, y, size) {
  size = size || 3.2;
  const w = pdfTextWidth(text, size, true) + 4, h = size + 2.4;
  doc.rect(x, y, w, h, { fill: '#fde68a', stroke: false });
  doc.text(text, x + 2, y + 1.3, { size: size, bold: true, color: '#111827' });
  return w;
}

/** The frame, header, "For Review" and the title block of one sheet. */
function elecFrame(doc, sheet, info) {
  const { w, h } = ELEC_A3, m = ELEC_FRAME;
  doc.rect(m, m, w - 2 * m, h - 2 * m, { color: '#111827', w: 0.5 });
  const head = sheet.kind === 'notes' ? 'Electrical Diagram - Notes' : 'Electrical Diagram - ' + (sheet.bankName || '');
  doc.text(head, m + 5, h - m - 9, { size: 5.5, color: '#111827' });
  doc.rect(m + 5, h - m - 21, pdfTextWidth('For Review', 5.5) + 6, 9, { color: '#111827', w: 0.3 });
  doc.text('For Review', m + 8, h - m - 18.6, { size: 5.5, color: '#111827' });
  doc.text(sheet.title, m + 5, h - m - 27, { size: 2.6, color: '#475569' });
  /* title block */
  const t = ELEC_TB;
  doc.rect(t.x, t.y, t.w, t.h, { color: '#111827', w: 0.35 });
  const rows = [t.y + 30, t.y + 20, t.y + 10];
  for (const y of rows) doc.line(t.x, y, t.x + t.w, y, { color: '#111827', w: 0.2 });
  doc.line(t.x + 100, t.y, t.x + 100, t.y + 20, { color: '#111827', w: 0.2 });
  doc.text('AYK POWER LTD.', t.x + 3, t.y + 33, { size: 3.6, bold: true });
  doc.text('Shenzhen Anyikong Power Technology Co., Ltd.', t.x + 60, t.y + 33.4, { size: 2 });
  doc.text('TITLE', t.x + 3, t.y + 26.5, { size: 1.6, color: '#475569' });
  doc.text(info.title, t.x + 3, t.y + 22.2, { size: 2.6, bold: true });
  doc.text('DOC NO', t.x + 3, t.y + 16.5, { size: 1.6, color: '#475569' });
  doc.text(info.docNumber || '-', t.x + 3, t.y + 12.3, { size: 2.6, bold: true });
  doc.text('REV', t.x + 103, t.y + 16.5, { size: 1.6, color: '#475569' });
  doc.text(info.rev || '0', t.x + 103, t.y + 12.3, { size: 2.6, bold: true });
  doc.text('DRAWN', t.x + 3, t.y + 6.5, { size: 1.6, color: '#475569' });
  doc.text((info.drawnBy || '-') + '   ' + (info.date || ''), t.x + 3, t.y + 2.4, { size: 2.4 });
  doc.text('SIZE A3   SCALE NTS', t.x + 103, t.y + 6.5, { size: 1.6, color: '#475569' });
  doc.text(`Sheet ${sheet.n} of ${sheet.of}`, t.x + 103, t.y + 2.4, { size: 2.6, bold: true });
  doc.text('Drawn with WireFlow from the confirmed setup. Check before release.', m + 5, m + 2.5, { size: 1.8, color: '#64748b' });
}

/**
 * Leads from ports to labels. ends: [{ x, y, color, dash, text }]. Leads leave each port
 * downwards; ports in the same column get side-by-side lanes so leads never coincide.
 */
function elecLeads(doc, ends, bottom) {
  /* every lead its own lane, at least 3.2 mm from the last, so no two labels overlap */
  const sorted = ends.slice().sort((a, b) => a.x - b.x || b.y - a.y);
  let last = -Infinity;
  for (const e of sorted) {
    const lx = Math.max(e.x, last + 3.2);
    last = lx;
    const pts = lx === e.x ? [e.x, e.y, e.x, bottom] : [e.x, e.y, e.x, e.y - 1.5, lx, e.y - 2.5, lx, bottom];
    doc.poly(pts, { color: e.color, w: 0.35, dash: e.dash ? [1.6, 1.1] : null });
    doc.poly([lx - 1, bottom + 2, lx, bottom, lx + 1, bottom + 2], { color: e.color, w: 0.35 });
    doc.text(e.text, lx + 0.9, bottom - 1, { size: 2, rot: -90, color: '#111827' });
  }
}

/** Which sheet a part instance is drawn on. */
function elecSheetOf(sheets) {
  const at = new Map();
  for (const s of sheets) for (const it of s.items) if (it && !at.has(s.kind + ':' + it)) at.set(s.kind + ':' + it, s.n);
  return (part, name) => at.get((part === 'msm' ? 'msm' : part === 'ssc' ? 'ssc-back' : part === 'acdp' ? 'acdp' : '?') + ':' + name) || null;
}

/** A lead for each confirmed connection end on this sheet. */
function elecEndsOn(links, sheetOf, part, name, ports) {
  const ends = [];
  for (const l of links) {
    for (const [me, other] of [[l.from, l.to], [l.to, l.from]]) {
      if (me.part !== part || me.name !== name) continue;
      if (elecPortBlocked(me.part, me.port)) continue;
      const p = ports[me.port];
      if (!p) continue;
      const sh = sheetOf(other.part, other.name);
      const cab = ELEC_CABLES[l.cable] || { color: '#111827' };
      /* customer ends and valves: the name says it; the connector is in the legend */
      const far = other.part === 'customer' || other.part === 'valve' ? other.name.replace('Client-side ', 'Client ') : `${other.name} ${other.port}`;
      ends.push({ x: p.x, y: p.y - p.r, color: cab.color, dash: l.link === 'inline',
        text: `To ${far}${sh ? ' · Sheet ' + sh : ''}` });
    }
  }
  return ends;
}

/** Draws every sheet of a confirmed setup onto doc (a pdfDoc); returns the sheet list. */
function elecDraw(doc, setup, lib, info) {
  const sheets = elecSheets(setup);
  const links = elecLinks(setup);
  const sheetOf = elecSheetOf(sheets);
  const view = (part, v) => { const p = lib.parts.find(x => x.id === part); return p && p.views.find(x => x.id === v); };
  const bankOf = id => setup.banks.find(b => b.id === id);
  const area = { x: ELEC_FRAME + 8, w: ELEC_A3.w - 2 * ELEC_FRAME - 16, top: ELEC_A3.h - ELEC_FRAME - 34 };

  sheets.forEach((sh, i) => {
    if (i) doc.newPage();
    const b = sh.bank ? bankOf(sh.bank) : null;
    sh.bankName = b ? b.name : '';
    elecFrame(doc, sh, info);
    if (sh.kind === 'notes' && sh.n === 1) {
      const msm = view('msm', 'back');
      if (msm) { elecTag(doc, 'MSM Back', 40, 232); elecDrawPart(doc, msm, [40, 90, 200, 138], { nameSize: 2 }); }
      let y = 222;
      doc.text('Customer connections at the MSM back', 255, y, { size: 3, bold: true }); y -= 7;
      for (const o of ELEC_OPTIONS) {
        const on = o.always || setup.options[o.id];
        doc.text(`${on ? 'Used' : 'Not used'}: ${o.label}`, 255, y, { size: 2.4, bold: true, color: on ? '#111827' : '#94a3b8' }); y -= 4;
        doc.text(o.note, 259, y, { size: 2.1, color: '#475569' }); y -= 6;
      }
      doc.text(`Master valves: ${setup.valves || 0}`, 255, y, { size: 2.4, bold: true }); y -= 8;
      doc.text('Not wired on new projects:', 255, y, { size: 2.4, bold: true }); y -= 4.5;
      for (const r of ELEC_NOT_WIRED) { doc.text('- ' + (r.port || 'SSCnB') + ': ' + r.why.replace(/\s*\(AYK[^)]*\)/, ''), 259, y, { size: 2 }); y -= 4; }
    } else if (sh.kind === 'notes') {
      let y = 232;
      doc.text('Cables', 40, y, { size: 3.6, bold: true }); y -= 9;
      for (const c of Object.values(ELEC_CABLES)) {
        doc.line(40, y + 1, 58, y + 1, { color: c.color, w: 0.6 });
        doc.text(c.label, 62, y, { size: 2.6 }); y -= 6.5;
      }
      doc.line(40, y + 1, 58, y + 1, { color: '#111827', w: 0.4, dash: [1.6, 1.1] });
      doc.text('Dashed: between racks, through an inline connector; the customer makes this cable', 62, y, { size: 2.6 }); y -= 12;
      doc.text('Connections', 40, y, { size: 3.6, bold: true }); y -= 8;
      for (const r of ELEC_RULES) { doc.text('- ' + r.text, 40, y, { size: 2.4 }); y -= 5.2; }
      y -= 4;
      doc.text('Same rack: AYK supplies the complete harness between ACDP, MSM and SSC.', 40, y, { size: 2.4 }); y -= 5.2;
      doc.text('Different racks: AYK supplies cables with an inline connector at one end; the customer makes the inter-rack cable.', 40, y, { size: 2.4 });
    } else if (sh.kind === 'msm') {
      const v = view('msm', 'back');
      elecTag(doc, `${b.msm.name} Back`, area.x + 70, area.top - 2);
      const d = elecDrawPart(doc, v, [area.x + 70, 120, 230, area.top - 128]);
      elecLeads(doc, elecEndsOn(links, sheetOf, 'msm', b.msm.name, d.ports), ELEC_LABEL_Y + 40);
    } else if (sh.kind === 'ssc-back') {
      const v = view('ssc', 'back');
      const n = sh.items.length, cw = area.w / 3;
      sh.items.forEach((name, k) => {
        const x = area.x + k * cw + (3 - n) * cw / 2;
        elecTag(doc, `${name} Back`, x + 6, area.top - 2);
        const d = elecDrawPart(doc, v, [x + 4, 130, cw - 8, area.top - 138], { nameSize: 1.7 });
        elecLeads(doc, elecEndsOn(links, sheetOf, 'ssc', name, d.ports), ELEC_LABEL_Y + 40);
      });
    } else if (sh.kind === 'acdp') {
      const name = sh.items[0];
      elecTag(doc, `${name} Back`, area.x + 40, area.top - 2);
      /* no ACDP drawing yet: a schematic with the ports in AYK's confirmed order */
      const bx = area.x + 40, by = 160, bw = 300, bh = 45;
      doc.rect(bx, by, bw, bh, { color: '#1f2937', w: 0.35 });
      doc.text('Schematic: no ACDP drawing supplied yet. Ports in AYK\'s order, left to right.', bx + 3, by + bh - 5, { size: 2.2, color: '#64748b' });
      const ports = {};
      ELEC_ACDP_PORTS.forEach((pn, k) => {
        const x = bx + 20 + k * (bw - 40) / (ELEC_ACDP_PORTS.length - 1), y = by + 16;
        doc.circle(x, y, 5, { color: '#1f2937', w: 0.3 });
        doc.circle(x, y, 2.2, { color: '#1f2937', w: 0.2 });
        doc.text(pn, x, y + 7, { size: 2, align: 'center' });
        ports[pn] = { x: x, y: y, r: 5, name: pn };
      });
      elecLeads(doc, elecEndsOn(links, sheetOf, 'acdp', name, ports), ELEC_LABEL_Y + 40);
    } else if (sh.kind === 'fronts') {
      const jb = view(setup.jbModel === 2 ? 'jb2' : 'jb4', 'front');
      if (jb) {
        elecTag(doc, 'Junction Box Front', area.x + 110, area.top - 2);
        const d = elecDrawPart(doc, jb, [area.x + 110, area.top - 56, 150, 50]);
        for (const p of d.list) {
          doc.line(p.x, p.y + p.r, p.x, area.top + 6, { color: ELEC_CABLES.bus.color, w: 0.45 });
        }
        doc.text('To customer: 0.6/1 kV 1 x 95 mm² (TN0088)', area.x + 265, area.top - 20, { size: 2.4 });
      }
      const v = view('ssc', 'front');
      const n = sh.items.length, cw = area.w / 3;
      sh.items.forEach((name, k) => {
        const x = area.x + k * cw + (3 - n) * cw / 2;
        elecTag(doc, `${name} Front`, x + 6, 160);
        elecDrawPart(doc, v, [x + 4, 62, cw - 8, 94], { nameSize: 1.7 });
      });
      doc.text('SSC to battery modules: see the wiring diagram of each rack (WireFlow wiring sheet).', area.x, 54, { size: 2.4, color: '#475569' });
    }
  });
  return sheets;
}

/** The whole diagram as PDF bytes. */
async function elecPdf(setup, lib, info) {
  const doc = pdfDoc({ w: ELEC_A3.w, h: ELEC_A3.h, title: (info.docNumber || 'Electrical Diagram') + ' ' + (info.title || '') });
  elecDraw(doc, setup, lib, info);
  return doc.bytes();
}

if (typeof module !== 'undefined') module.exports = { elecPathPolys, elecDraw, elecPdf, ELEC_CABLES };
