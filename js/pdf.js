/* ============================================================
 * WireFlow — minimal vector PDF writer (no libraries)
 * ------------------------------------------------------------
 * One page, coordinates in MILLIMETRES with the origin at the
 * bottom-left (Y up, like the DXF). Lines, polylines, rectangles,
 * circles, Helvetica / Helvetica-Bold text (WinAnsi), one JPEG image.
 * Content is Flate-compressed when CompressionStream is available.
 * ============================================================ */

/* Helvetica and Helvetica-Bold advance widths, characters 32..126 (1/1000 em) */
const PDF_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const PDF_HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
/* the few non-ASCII characters drawings use, mapped to WinAnsi codes and widths */
const PDF_EXTRA = { '±': [0xB1, 584], '°': [0xB0, 400], '²': [0xB2, 333], '×': [0xD7, 584], '·': [0xB7, 278], '–': [0x96, 556], '—': [0x97, 1000], '©': [0xA9, 737] };
const PDF_SUBST = { '−': '-', '：': ':', '→': '>', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...' };

function pdfNorm(str) {
  let s = String(str == null ? '' : str);
  for (const k in PDF_SUBST) s = s.split(k).join(PDF_SUBST[k]);
  return s;
}
/** Width of a string in mm at font size `size` (mm). */
function pdfTextWidth(str, size, bold) {
  const w = bold ? PDF_HELV_B : PDF_HELV;
  let t = 0;
  for (const ch of pdfNorm(str)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) t += w[c - 32];
    else if (PDF_EXTRA[ch]) t += PDF_EXTRA[ch][1];
    else t += 556;
  }
  return t / 1000 * size;
}
function pdfEsc(str) {
  let o = '';
  for (const ch of pdfNorm(str)) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch;
    else if (c >= 32 && c <= 126) o += ch;
    else if (PDF_EXTRA[ch]) o += '\\' + PDF_EXTRA[ch][0].toString(8).padStart(3, '0');
    else o += '?';
  }
  return o;
}
function pdfNum(v) { const r = Math.round(v * 1000) / 1000; return (Object.is(r, -0) ? 0 : r).toString(); }
function pdfRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
  return v.map(x => pdfNum(x / 255)).join(' ');
}

/**
 * New one-page PDF.
 * @param {{w:number,h:number,title?:string}} page size in mm.
 */
function pdfDoc(page) {
  const out = [];
  let image = null;
  let state = { stroke: null, fill: null, lw: null, dash: null };
  const k = 72 / 25.4;
  out.push(`${pdfNum(k)} 0 0 ${pdfNum(k)} 0 0 cm 1 J 1 j`);
  function style(o, fill) {
    const c = pdfRgb(o.color || '#000000');
    if (fill) { if (state.fill !== c) { out.push(c + ' rg'); state.fill = c; } }
    else if (state.stroke !== c) { out.push(c + ' RG'); state.stroke = c; }
    if (!fill) {
      const lw = pdfNum(o.w == null ? 0.25 : o.w);
      if (state.lw !== lw) { out.push(lw + ' w'); state.lw = lw; }
      const d = o.dash ? '[' + o.dash.map(pdfNum).join(' ') + '] 0 d' : '[] 0 d';
      if (state.dash !== d) { out.push(d); state.dash = d; }
    }
  }
  const api = {
    /** Polyline; pts = [[x,y],...] or flat [x0,y0,x1,y1,...]. */
    poly(pts, o) {
      o = o || {};
      const flat = Array.isArray(pts[0]) ? pts.flat() : pts;
      if (flat.length < 4) return api;
      let s = pdfNum(flat[0]) + ' ' + pdfNum(flat[1]) + ' m';
      for (let i = 2; i < flat.length; i += 2) s += ' ' + pdfNum(flat[i]) + ' ' + pdfNum(flat[i + 1]) + ' l';
      if (o.fill) { style({ color: o.fill }, true); out.push(s + (o.close ? ' h' : '') + (o.stroke === false ? ' f' : '')); if (o.stroke === false) return api; style(o, false); out.push('S'); return api; }
      style(o, false);
      out.push(s + (o.close ? ' s' : ' S'));
      return api;
    },
    line(x1, y1, x2, y2, o) { return api.poly([x1, y1, x2, y2], o); },
    rect(x, y, w, h, o) {
      o = o || {};
      if (o.fill) { style({ color: o.fill }, true); out.push(`${pdfNum(x)} ${pdfNum(y)} ${pdfNum(w)} ${pdfNum(h)} re f`); }
      if (o.stroke !== false) { style(o, false); out.push(`${pdfNum(x)} ${pdfNum(y)} ${pdfNum(w)} ${pdfNum(h)} re S`); }
      return api;
    },
    circle(cx, cy, r, o) {
      o = o || {};
      const c = 0.5523 * r;
      const p = (x, y) => pdfNum(cx + x) + ' ' + pdfNum(cy + y);
      const path = `${p(r, 0)} m ${p(r, c)} ${p(c, r)} ${p(0, r)} c ${p(-c, r)} ${p(-r, c)} ${p(-r, 0)} c ${p(-r, -c)} ${p(-c, -r)} ${p(0, -r)} c ${p(c, -r)} ${p(r, -c)} ${p(r, 0)} c`;
      if (o.fill) { style({ color: o.fill }, true); out.push(path + (o.stroke === false ? ' f' : ' b')); if (o.stroke !== false) style(o, false); return api; }
      style(o, false); out.push(path + ' S');
      return api;
    },
    /** Text: size in mm (cap-to-baseline em), align left|center|right, rot in degrees. */
    text(str, x, y, o) {
      o = o || {};
      const size = o.size || 2.5, bold = !!o.bold;
      const w = pdfTextWidth(str, size, bold);
      let dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
      style({ color: o.color || '#000000' }, true);
      const r = (o.rot || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
      const tx = x + dx * cs, ty = y + dx * sn;
      out.push(`BT /${bold ? 'F2' : 'F1'} ${pdfNum(size)} Tf ${pdfNum(cs)} ${pdfNum(sn)} ${pdfNum(-sn)} ${pdfNum(cs)} ${pdfNum(tx)} ${pdfNum(ty)} Tm (${pdfEsc(str)}) Tj ET`);
      return api;
    },
    /** JPEG image (bytes) placed at x,y with size w,h mm. One image per document. */
    image(jpeg, pxW, pxH, x, y, w, h) {
      image = { bytes: jpeg, w: pxW, h: pxH };
      out.push(`q ${pdfNum(w)} 0 0 ${pdfNum(h)} ${pdfNum(x)} ${pdfNum(y)} cm /Im1 Do Q`);
      return api;
    },
    /** Finished file as bytes. */
    async bytes() {
      const enc = s => new TextEncoder().encode(s);
      let content = enc(out.join('\n'));
      let filter = '';
      if (typeof CompressionStream !== 'undefined') {
        const cs = new Blob([content]).stream().pipeThrough(new CompressionStream('deflate'));
        content = new Uint8Array(await new Response(cs).arrayBuffer());
        filter = '/Filter /FlateDecode ';
      }
      const W = pdfNum(page.w * k), H = pdfNum(page.h * k);
      const objs = [];
      objs[1] = enc('<< /Type /Catalog /Pages 2 0 R >>');
      objs[2] = enc('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
      objs[3] = enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${image ? ' /XObject << /Im1 7 0 R >>' : ''} >> >>`);
      objs[4] = [enc(`<< ${filter}/Length ${content.length} >>\nstream\n`), content, enc('\nendstream')];
      objs[5] = enc('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      objs[6] = enc('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      let n = 7;
      if (image) {
        objs[7] = [enc(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`), image.bytes, enc('\nendstream')];
        n = 8;
      }
      const info = n;
      objs[info] = enc(`<< /Title (${pdfEsc(page.title || 'Wiring Diagram')}) /Producer (WireFlow) /Creator (WireFlow) >>`);
      const parts = [new Uint8Array([...enc('%PDF-1.4\n%'), 0xE2, 0xE3, 0xCF, 0xD3, 10])];
      let pos = parts[0].length;
      const offsets = [];
      for (let i = 1; i <= info; i++) {
        offsets[i] = pos;
        const head = enc(`${i} 0 obj\n`), tail = enc('\nendobj\n');
        const body = Array.isArray(objs[i]) ? objs[i] : [objs[i]];
        for (const b of [head, ...body, tail]) { parts.push(b); pos += b.length; }
      }
      const xref = ['xref', `0 ${info + 1}`, '0000000000 65535 f '];
      for (let i = 1; i <= info; i++) xref.push(String(offsets[i]).padStart(10, '0') + ' 00000 n ');
      const trailer = enc(xref.join('\n') + `\ntrailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`);
      parts.push(trailer);
      const total = parts.reduce((a, b) => a + b.length, 0);
      const file = new Uint8Array(total);
      let at = 0;
      for (const b of parts) { file.set(b, at); at += b.length; }
      return file;
    },
  };
  return api;
}
