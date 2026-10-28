/* ============================================================
 * AYK WireFlow — minimal EMF (Enhanced Metafile) renderer
 * ------------------------------------------------------------
 * Visio stores an imported AutoCAD rack as an OLE object whose
 * presentation image is a vector EMF (ours: 8.4 MB, 293 340
 * records). No browser can display an EMF, so without this the
 * imported .vsdx would show an empty box where the rack is.
 *
 * Scope: the drawing records a CAD plot actually emits — 16-bit
 * and 32-bit polylines/polygons, moveto/lineto, pens, brushes,
 * world/window/viewport transforms, DC save/restore and text.
 * Raster records (bitblt), clipping, palettes and BITMAPINFO
 * pens are ignored: they do not occur in CAD plot metafiles.
 *
 * Coordinate chain:  logical --world--> page --window/viewport-->
 * device --fit--> canvas.  Device coords are y-down, so the
 * canvas needs no flip.
 * ============================================================ */

const EMF_REC = {
  HEADER: 1, POLYBEZIER: 2, POLYGON: 3, POLYLINE: 4, POLYBEZIERTO: 5, POLYLINETO: 6,
  POLYPOLYLINE: 7, POLYPOLYGON: 8,
  SETWINDOWEXTEX: 9, SETWINDOWORGEX: 10, SETVIEWPORTEXTEX: 11, SETVIEWPORTORGEX: 12,
  EOF: 14, SETMAPMODE: 17, SETBKMODE: 18, SETPOLYFILLMODE: 19, SETROP2: 20,
  SETTEXTALIGN: 22, SETTEXTCOLOR: 24, SETBKCOLOR: 25,
  MOVETOEX: 27, SAVEDC: 33, RESTOREDC: 34, SETWORLDTRANSFORM: 35, MODIFYWORLDTRANSFORM: 36,
  SELECTOBJECT: 37, CREATEPEN: 38, CREATEBRUSHINDIRECT: 39, DELETEOBJECT: 40,
  ANGLEARC: 41, ELLIPSE: 42, RECTANGLE: 43, ROUNDRECT: 44, ARC: 45, CHORD: 46, PIE: 47,
  LINETO: 54, ARCTO: 55, POLYDRAW: 56,
  POLYBEZIER16: 85, POLYGON16: 86, POLYLINE16: 87, POLYBEZIERTO16: 88, POLYLINETO16: 89,
  POLYPOLYLINE16: 90, POLYPOLYGON16: 91, POLYDRAW16: 92,
  EXTCREATEFONTINDIRECTW: 82, EXTTEXTOUTA: 83, EXTTEXTOUTW: 84,
  EXTCREATEPEN: 95,
};

/* GDI stock objects: index < 16 is a stock handle, no creation record. */
const EMF_STOCK = {
  0: { kind: 'brush', color: '#ffffff' }, 1: { kind: 'brush', color: '#c0c0c0' },
  2: { kind: 'brush', color: '#808080' }, 3: { kind: 'brush', color: '#404040' },
  4: { kind: 'brush', color: '#000000' }, 5: { kind: 'brush', color: null },
  6: { kind: 'pen', color: '#ffffff', width: 1 }, 7: { kind: 'pen', color: '#000000', width: 1 },
  8: { kind: 'pen', color: null, width: 1 },
};

function emfColor(v) {
  /* GDI COLORREF is 0x00BBGGRR — the red channel is the LOW byte. */
  const c = (v >>> 0) & 0xffffff;
  const r = c & 0xff, g = (c >> 8) & 0xff, b = (c >> 16) & 0xff;
  const h = (n) => ('0' + n.toString(16)).slice(-2);
  return '#' + h(r) + h(g) + h(b);
}

/* ---- header --------------------------------------------------------- */
function emfBounds(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (dv.byteLength < 100 || dv.getUint32(0, true) !== EMF_REC.HEADER) {
    throw new Error('not an EMF: missing header record');
  }
  /* rclBounds (device px) at 8, rclFrame (.01 mm) at 24 */
  const L = dv.getInt32(8, true), T = dv.getInt32(12, true), R = dv.getInt32(16, true), B = dv.getInt32(20, true);
  return { left: L, top: T, right: R, bottom: B, width: Math.max(1, R - L), height: Math.max(1, B - T) };
}

/* ---- renderer ------------------------------------------------------- */

/**
 * Draw an EMF into a 2D canvas context, fitted into rect {x,y,w,h}.
 * Returns a small statistic object (records seen, ops drawn).
 */
function emfDraw(ctx, buf, rect) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const bounds = emfBounds(buf);
  const px = (rect && rect.w) || bounds.width;
  const py = (rect && rect.h) || bounds.height;
  const sx = px / bounds.width, sy = py / bounds.height;
  const ox = (rect && rect.x) || 0, oy = (rect && rect.y) || 0;
  const devScale = Math.max(sx, sy);

  const dc = {
    pos: { x: 0, y: 0 },
    winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1],
    world: null, textColor: '#000000', textAlign: 0, fontSize: 12,
    pen: { color: '#000000', width: 1 }, brush: { color: null },
  };
  const stack = [];
  const objects = new Map();

  /* drawing ops are batched per style so 300 k records become a
     handful of Path2D fills/strokes instead of 300 k draw calls */
  const groups = new Map();
  let cur = null;
  const texts = [];
  let records = 0, drawn = 0;

  const styleKey = () => dc.pen.color + '|' + dc.pen.width.toFixed(3) + '|' + (dc.brush.color || '-');
  function group() {
    const k = styleKey();
    let g = groups.get(k);
    if (!g) { g = { k: k, stroke: [], fill: [] }; groups.set(k, g); }
    cur = g;
    return g;
  }
  function dev(x, y) {
    let p = dc.world ? [dc.world[0] * x + dc.world[2] * y + dc.world[4],
                        dc.world[1] * x + dc.world[3] * y + dc.world[5]] : [x, y];
    const fx = dc.winExt[0] ? dc.vpExt[0] / dc.winExt[0] : 1;
    const fy = dc.winExt[1] ? dc.vpExt[1] / dc.winExt[1] : 1;
    const dx = (p[0] - dc.winOrg[0]) * fx + dc.vpOrg[0];
    const dy = (p[1] - dc.winOrg[1]) * fy + dc.vpOrg[1];
    return [ox + (dx - bounds.left) * sx, oy + (dy - bounds.top) * sy];
  }
  function pushPoint(g, x, y, toFill) {
    const p = dev(x, y);
    (toFill ? g.fill : g.stroke).push(p[0], p[1]);
  }
  function addPath(points, close, fill) {
    if (!points.length) return;
    const g = group();
    /* A closed run with no brush still has to show its outline, so it
       goes into the stroke batch as well. */
    const targets = fill && dc.brush.color ? [g.fill] : (fill ? [g.fill, g.stroke] : [g.stroke]);
    for (const arr of targets) {
      /* a run of numbers is one subpath; NaN marks a break */
      if (arr.length) arr.push(NaN, NaN);
      for (let i = 0; i < points.length; i += 2) {
        const p = dev(points[i], points[i + 1]);
        arr.push(p[0], p[1]);
      }
      if (close) { const p0 = dev(points[0], points[1]); arr.push(p0[0], p0[1]); }
    }
    drawn++;
  }
  function strokeSeg(x1, y1, x2, y2) {
    const g = group();
    const a = dev(x1, y1), b = dev(x2, y2);
    if (g.stroke.length) g.stroke.push(NaN, NaN);
    g.stroke.push(a[0], a[1], b[0], b[1]);
    drawn++;
  }

  /* 16-point read helpers ------------------------------------------- */
  function readPoly16(off, count) {
    const out = new Float64Array(count * 2);
    for (let i = 0; i < count; i++) out[i * 2] = dv.getInt16(off + i * 4, true), out[i * 2 + 1] = dv.getInt16(off + i * 4 + 2, true);
    return out;
  }
  function poly16Lists(rec, base) {
    /* EMR_POLYPOLYLINE16/POLYGON16: rclBounds(16) nPolys(4) cpts(4) counts[] pts[] */
    const nPolys = dv.getUint32(rec + 24, true);
    const cpts = dv.getUint32(rec + 28, true);
    const countsOff = rec + 32;
    const ptsOff = countsOff + nPolys * 4;
    const polys = [];
    let acc = 0;
    for (let i = 0; i < nPolys; i++) {
      const n = dv.getUint32(countsOff + i * 4, true);
      polys.push({ off: ptsOff + acc * 4, n: n });
      acc += n;
    }
    return polys;
  }

  /* ---- record loop ---- */
  let off = 0;
  const end = dv.byteLength;
  while (off + 8 <= end) {
    const type = dv.getUint32(off, true);
    let size = dv.getUint32(off + 4, true);
    if (size < 8) break;
    if (off + size > end) size = end - off;
    records++;
    switch (type) {
      case EMF_REC.EOF: off = end; break;
      case EMF_REC.SETWINDOWEXTEX: dc.winExt = [dv.getInt32(off + 8, true), dv.getInt32(off + 12, true)]; break;
      case EMF_REC.SETWINDOWORGEX: dc.winOrg = [dv.getInt32(off + 8, true), dv.getInt32(off + 12, true)]; break;
      case EMF_REC.SETVIEWPORTEXTEX: dc.vpExt = [dv.getInt32(off + 8, true), dv.getInt32(off + 12, true)]; break;
      case EMF_REC.SETVIEWPORTORGEX: dc.vpOrg = [dv.getInt32(off + 8, true), dv.getInt32(off + 12, true)]; break;
      case EMF_REC.SAVEDC: stack.push(JSON.parse(JSON.stringify(dc))); break;
      case EMF_REC.RESTOREDC: {
        const n = dv.getInt32(off + 8, true);
        const back = n < 0 ? stack.splice(stack.length + n, -n)[0] : stack.pop();
        if (back) Object.assign(dc, back);
        break;
      }
      case EMF_REC.SETWORLDTRANSFORM:
        dc.world = [dv.getFloat32(off + 8, true), dv.getFloat32(off + 20, true),
                    dv.getFloat32(off + 12, true), dv.getFloat32(off + 24, true),
                    dv.getFloat32(off + 16, true), dv.getFloat32(off + 28, true)];
        break;
      case EMF_REC.MODIFYWORLDTRANSFORM: {
        const mode = dv.getUint32(off + 32, true);
        const m = [dv.getFloat32(off + 8, true), dv.getFloat32(off + 20, true),
                    dv.getFloat32(off + 12, true), dv.getFloat32(off + 24, true),
                    dv.getFloat32(off + 16, true), dv.getFloat32(off + 28, true)];
        if (mode === 4 || !dc.world) dc.world = m;                 /* MWT_SET */
        else if (mode === 3) dc.world = emfMul(dc.world, m);      /* right-multiply */
        else dc.world = emfMul(m, dc.world);                      /* left-multiply */
        break;
      }
      case EMF_REC.SETTEXTCOLOR: dc.textColor = emfColor(dv.getUint32(off + 8, true)); break;
      case EMF_REC.SETBKCOLOR: break;
      case EMF_REC.SELECTOBJECT: {
        const h = dv.getUint32(off + 8, true);
        const o = objects.get(h) || (h < 16 ? EMF_STOCK[h] : null);
        if (o) { if (o.kind === 'pen') dc.pen = { color: o.color, width: o.width }; else dc.brush = { color: o.color }; }
        break;
      }
      case EMF_REC.CREATEPEN: {
        const h = dv.getUint32(off + 8, true);
        objects.set(h, { kind: 'pen', color: emfColor(dv.getUint32(off + 20, true)), width: Math.max(0.05, dv.getInt32(off + 16, true)) });
        break;
      }
      case EMF_REC.EXTCREATEPEN: {
        const h = dv.getUint32(off + 8, true);
        objects.set(h, { kind: 'pen', color: emfColor(dv.getUint32(off + 32, true)), width: Math.max(0.05, dv.getUint32(off + 24, true)) });
        break;
      }
      case EMF_REC.CREATEBRUSHINDIRECT: {
        const h = dv.getUint32(off + 8, true);
        const style = dv.getUint32(off + 16, true);
        objects.set(h, { kind: 'brush', color: style === 1 ? null : emfColor(dv.getUint32(off + 20, true)) });
        break;
      }
      case EMF_REC.DELETEOBJECT: objects.delete(dv.getUint32(off + 8, true)); break;
      case EMF_REC.MOVETOEX: dc.pos = { x: dv.getInt32(off + 8, true), y: dv.getInt32(off + 12, true) }; break;
      case EMF_REC.LINETO: {
        const x = dv.getInt32(off + 8, true), y = dv.getInt32(off + 12, true);
        strokeSeg(dc.pos.x, dc.pos.y, x, y); dc.pos = { x, y };
        break;
      }
      case EMF_REC.POLYLINE16: case EMF_REC.POLYBEZIER16: case EMF_REC.POLYBEZIERTO16:
      case EMF_REC.POLYGON16: case EMF_REC.POLYLINETO16: {
        /* Type(4) Size(4) rclBounds(16) cpts(4) apts(4*n) */
        const cnt = dv.getUint32(off + 24, true);
        if (cnt > 1 && off + 28 + cnt * 4 <= end) {
          const pts = readPoly16(off + 28, cnt);
          addPath(pts, type === EMF_REC.POLYGON16, type === EMF_REC.POLYGON16);
        }
        break;
      }
      case EMF_REC.POLYPOLYLINE16: case EMF_REC.POLYPOLYGON16: {
        const fill = type === EMF_REC.POLYPOLYGON16;
        for (const poly of poly16Lists(off)) {
          if (poly.n > 1 && poly.off + poly.n * 4 <= end) addPath(readPoly16(poly.off, poly.n), fill, fill);
        }
        break;
      }
      case EMF_REC.POLYLINE: case EMF_REC.POLYGON: case EMF_REC.POLYBEZIER: {
        const cnt = dv.getUint32(off + 24, true);
        const p = new Float64Array(cnt * 2);
        for (let i = 0; i < cnt; i++) { p[i * 2] = dv.getInt32(off + 28 + i * 8, true); p[i * 2 + 1] = dv.getInt32(off + 32 + i * 8, true); }
        const fill = type === EMF_REC.POLYGON;
        addPath(p, fill, fill);
        break;
      }
      case EMF_REC.POLYPOLYLINE: case EMF_REC.POLYPOLYGON: {
        const fill = type === EMF_REC.POLYPOLYGON;
        const nPolys = dv.getUint32(off + 24, true);
        let acc = 0, countsOff = off + 32, ptsOff = countsOff + nPolys * 4;
        for (let i = 0; i < nPolys; i++) {
          const n = dv.getUint32(countsOff + i * 4, true);
          const p = new Float64Array(n * 2);
          for (let j = 0; j < n && ptsOff + acc * 8 + j * 8 + 8 <= end; j++) {
            p[j * 2] = dv.getInt32(ptsOff + acc * 8 + j * 8, true);
            p[j * 2 + 1] = dv.getInt32(ptsOff + acc * 8 + j * 8 + 4, true);
          }
          addPath(p, fill, fill);
          acc += n;
        }
        break;
      }
      case EMF_REC.RECTANGLE: {
        const x1 = dv.getInt32(off + 8, true), y1 = dv.getInt32(off + 12, true);
        const x2 = dv.getInt32(off + 16, true), y2 = dv.getInt32(off + 20, true);
        addPath(new Float64Array([x1, y1, x2, y1, x2, y2, x1, y2]), true, true);
        break;
      }
      case EMF_REC.ELLIPSE: case EMF_REC.ARC: case EMF_REC.CHORD: case EMF_REC.PIE: {
        const x1 = dv.getInt32(off + 8, true), y1 = dv.getInt32(off + 12, true);
        const x2 = dv.getInt32(off + 16, true), y2 = dv.getInt32(off + 20, true);
        emfAddEllipse(addPath, (x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, type === EMF_REC.ELLIPSE);
        break;
      }
      case EMF_REC.EXTTEXTOUTA: case EMF_REC.EXTTEXTOUTW: {
        const wide = type === EMF_REC.EXTTEXTOUTW;
        /* Type Size bounds(16) iGraphicsMode(4) exScale(4) eyScale(4) EmrText(Reference 8, nChars 4, offString 4) */
        const nChars = dv.getUint32(off + 44, true);
        const offStr = dv.getUint32(off + 48, true);
        const exScale = dv.getFloat32(off + 28, true);
        const refX = dv.getInt32(off + 36, true), refY = dv.getInt32(off + 40, true);
        if (nChars > 0 && nChars < 5000 && off + offStr + nChars * (wide ? 2 : 1) <= end) {
          let s = '';
          for (let i = 0; i < nChars; i++) {
            const c = wide ? dv.getUint16(off + offStr + i * 2, true) : dv.getUint8(off + offStr + i);
            if (c === 0) break;
            s += String.fromCharCode(c);
          }
          if (s.trim()) {
            const p = dev(refX, refY);
            texts.push({ x: p[0], y: p[1], text: s, color: dc.textColor, size: Math.max(6, Math.abs(exScale) * 12 * devScale) || 11 });
          }
        }
        break;
      }
      default: break;
    }
    off += size;
  }

  /* ---- flush batched paths ---- */
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const g of groups.values()) {
    if (g.fill.length) {
      const path = new Path2D();
      emfPath(path, g.fill, true);
      const c = g.k.split('|')[2];
      if (c && c !== '-') { ctx.fillStyle = c; ctx.fill(path); }
    }
    if (g.stroke.length) {
      const path = new Path2D();
      emfPath(path, g.stroke, false);
      const [col, w] = g.k.split('|');
      if (col && col !== '-') {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(0.35, parseFloat(w) * devScale);
        ctx.stroke(path);
      }
    }
  }
  for (const t of texts) {
    ctx.fillStyle = t.color || '#000000';
    ctx.font = t.size.toFixed(1) + 'px Arial';
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();

  return { records: records, ops: drawn, texts: texts.length, bounds: bounds };
}

function emfPath(path, arr, close) {
  let started = false;
  for (let i = 0; i < arr.length; i += 2) {
    const x = arr[i], y = arr[i + 1];
    if (Number.isNaN(x)) { if (close && started) path.closePath(); started = false; continue; }
    if (!started) { path.moveTo(x, y); started = true; } else path.lineTo(x, y);
  }
  if (close && started) path.closePath();
}

function emfAddEllipse(addPath, cx, cy, rx, ry, fill) {
  const pts = new Float64Array(64);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts[i * 2] = cx + Math.cos(a) * rx; pts[i * 2 + 1] = cy + Math.sin(a) * ry;
  }
  addPath(pts, true, fill);
}

function emfMul(a, b) {
  /* 2x3 affine [m11,m12,m21,m22,dx,dy] */
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Render an EMF to a data URL / canvas helper used by the VSDX viewer. */
function emfToCanvas(buf, maxPx) {
  const b = emfBounds(buf);
  const cap = Math.max(600, Math.min(maxPx || 2400, 4000));
  const scale = Math.min(cap / b.width, 1);
  const w = Math.max(1, Math.round(b.width * scale)), h = Math.max(1, Math.round(b.height * scale));
  const cv = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const stat = emfDraw(ctx, buf, { x: 0, y: 0, w: w, h: h });
  return { canvas: cv, width: w, height: h, stats: stat };
}
