/* AYK WireFlow — rack underlay import.
 * Parses simple DXF (R12+) entity sections client-side and fits the parsed
 * geometry into a rectangle of the A3 sheet, so generated wiring can be
 * drawn OVER the customer's own rack drawing. Binary DWG is not parsed here
 * (needs the Autodesk APS translation path); export a DXF from AutoCAD. */

/**
 * Parses DXF group-code/value pairs into an entity list.
 * Only the ENTITIES section is used.
 * @param {string} text Raw DXF text.
 * @return {{prims: Array<Object>, minX: number, minY: number, maxX: number, maxY: number}}
 */
function rackParseDxf(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) { i -= 1; continue; } /* resync on stray lines */
    pairs.push([code, lines[i + 1] !== undefined ? lines[i + 1].trim() : '']);
  }
  const prims = [];
  let inEntities = false;
  let e = null; /* current entity accumulator {type, codes:[[code,val]]} */
  const num = (e2, code, dflt) => {
    for (const c of e2.codes) if (c[0] === code) { const v = parseFloat(c[1]); return isNaN(v) ? dflt : v; }
    return dflt;
  };
  const allNum = (e2, code) => e2.codes.filter(c => c[0] === code).map(c => parseFloat(c[1])).filter(v => !isNaN(v));
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x, y) => {
    if (x < bbox.minX) bbox.minX = x;
    if (y < bbox.minY) bbox.minY = y;
    if (x > bbox.maxX) bbox.maxX = x;
    if (y > bbox.maxY) bbox.maxY = y;
  };

  for (let i = 0; i < pairs.length; i++) {
    const code = pairs[i][0], val = pairs[i][1];
    if (code === 2 && pairs[i - 1] && pairs[i - 1][0] === 0) {
      if (val === 'ENTITIES') inEntities = true;
      else if (val === 'ENDSEC') inEntities = false;
      continue;
    }
    if (!inEntities) continue;
    if (code === 0) {
      /* flush previous entity */
      if (e) {
        const pr = rackDxfEntity(e, num, allNum, grow);
        if (pr) prims.push(pr);
      }
      e = { type: val, codes: [] };
    } else if (e) {
      e.codes.push([code, val]);
    }
  }
  if (e) { const pr = rackDxfEntity(e, num, allNum, grow); if (pr) prims.push(pr); }
  if (!isFinite(bbox.minX)) { bbox.minX = 0; bbox.minY = 0; bbox.maxX = 0; bbox.maxY = 0; }
  return { prims: prims, minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY };
}

/** Converts one accumulated DXF entity into a sheet primitive (DXF coords). */
function rackDxfEntity(e, num, allNum, grow) {
  if (e.type === 'LINE') {
    const x1 = num(e, 10, 0), y1 = num(e, 20, 0), x2 = num(e, 11, 0), y2 = num(e, 21, 0);
    grow(x1, y1); grow(x2, y2);
    return { type: 'line', x1: x1, y1: y1, x2: x2, y2: y2, color: num(e, 62, null) };
  }
  if (e.type === 'CIRCLE') {
    const cx = num(e, 10, 0), cy = num(e, 20, 0), r = num(e, 40, 0);
    grow(cx - r, cy - r); grow(cx + r, cy + r);
    return { type: 'circle', cx: cx, cy: cy, r: r, color: num(e, 62, null) };
  }
  if (e.type === 'ARC') {
    /* flatten to a 24-segment polyline (DXF angles CCW degrees) */
    const cx = num(e, 10, 0), cy = num(e, 20, 0), r = num(e, 40, 0);
    let a0 = num(e, 50, 0) * Math.PI / 180, a1 = num(e, 51, 360) * Math.PI / 180;
    if (a1 <= a0) a1 += 2 * Math.PI;
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const a = a0 + (a1 - a0) * k / 24;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      grow(x, y); pts.push([x, y]);
    }
    return { type: 'poly', pts: pts, color: num(e, 62, null) };
  }
  if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    const xs = allNum(e, 10), ys = allNum(e, 20);
    if (xs.length < 2 || xs.length !== ys.length) return null;
    const pts = xs.map((x, i) => { grow(x, ys[i]); return [x, ys[i]]; });
    const closed = num(e, 70, 0) & 1;
    if (closed) pts.push([xs[0], ys[0]]);
    return { type: 'poly', pts: pts, color: num(e, 62, null) };
  }
  if (e.type === 'TEXT' || e.type === 'MTEXT') {
    const x = num(e, 10, 0), y = num(e, 20, 0);
    const h = num(e, 40, 2.5) || 2.5;
    let str = e.codes.filter(c => c[0] === 1).map(c => c[1]).join('');
    str = str.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, '').replace(/\\[A-Za-z][^;]*;/g, '').trim();
    if (!str) return null;
    grow(x, y);
    return { type: 'text', x: x, y: y, size: h, text: str, color: num(e, 62, null) };
  }
  return null;
}

/**
 * Fits parsed DXF primitives into a sheet rectangle (sheet units, Y down),
 * uniform scale, centred. DXF Y-up is flipped to sheet Y-down.
 * @param {Object} parsed Result of rackParseDxf.
 * @param {{x:number,y:number,w:number,h:number}} rect Target rect on the sheet.
 * @return {Array<Object>} Sheet-coordinate primitives tagged layer RACK.
 */
function rackFitDxf(parsed, rect) {
  const bw = parsed.maxX - parsed.minX, bh = parsed.maxY - parsed.minY;
  if (bw <= 0 || bh <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = Math.min(rect.w / bw, rect.h / bh);
  const offX = rect.x + (rect.w - bw * scale) / 2;
  const offY = rect.y + (rect.h - bh * scale) / 2;
  const mapX = x => +(offX + (x - parsed.minX) * scale).toFixed(2);
  const mapY = y => +(offY + (parsed.maxY - y) * scale).toFixed(2); /* Y flip */
  const out = [];
  for (const pr of parsed.prims) {
    if (pr.type === 'line') {
      out.push({ type: 'line', x1: mapX(pr.x1), y1: mapY(pr.y1), x2: mapX(pr.x2), y2: mapY(pr.y2) });
    } else if (pr.type === 'circle') {
      out.push({ type: 'circle', cx: mapX(pr.cx), cy: mapY(pr.cy), r: +(pr.r * scale).toFixed(2) });
    } else if (pr.type === 'poly') {
      for (let i = 0; i < pr.pts.length - 1; i++) {
        out.push({ type: 'line', x1: mapX(pr.pts[i][0]), y1: mapY(pr.pts[i][1]),
          x2: mapX(pr.pts[i + 1][0]), y2: mapY(pr.pts[i + 1][1]) });
      }
    } else if (pr.type === 'text') {
      out.push({ type: 'text', x: mapX(pr.x), y: mapY(pr.y), size: +(pr.size * scale).toFixed(2),
        text: pr.text, anchor: 'start' });
    }
  }
  return out;
}

/**
 * Default underlay rect: the module grid area (all module blocks) plus the
 * SSC row, in sheet units.
 * @param {Object} layout Result of buildSheetLayout.
 * @return {{x:number,y:number,w:number,h:number}}
 */
function rackDefaultFit(layout) {
  const mods = (layout && layout.modules) || [];
  const ssc = (layout && layout.ssc) || [];
  if (!mods.length) return { x: 120, y: 280, w: 1000, h: 640 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of mods.concat(ssc)) {
    minX = Math.min(minX, m.x); minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + m.w); maxY = Math.max(maxY, m.y + m.h);
  }
  return { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
}
