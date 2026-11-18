/* AYK WireFlow — native CAD (DXF) reader.
 *
 * Reads an ASCII DXF exported from AutoCAD and keeps the geometry in its own
 * drawing units (millimetres for AYK rack drawings). Nothing is fitted or
 * rescaled: a point in the result is the same point AutoCAD shows.
 *
 *   cadParseDxf(text)        -> model   (header, layers, blocks, entities)
 *   cadFlatten(model, opts)  -> flat    (polylines + exact circles + texts, WCS)
 *   cadToSvg(flat, opts)     -> string  (SVG whose user unit is 1 drawing unit)
 *
 * Supported: LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE (with bulges), POLYLINE
 * (2D, with bulges), SPLINE (rational/non-rational, control or fit points),
 * POINT, TEXT, MTEXT, INSERT (nested blocks, scale, rotation, arrays) and
 * DIMENSION (through its anonymous block). Other entity types are counted in
 * `model.unsupported` and skipped, never guessed. Paper-space entities are
 * skipped. Binary DXF and DWG are not read here: convert DWG with
 * tools/dwg-to-dxf.ps1 or AutoCAD "Save As DXF".
 */

/** DXF $INSUNITS code -> [name, millimetres per unit]. */
const CAD_UNITS = {
  0: ['unitless', 1], 1: ['in', 25.4], 2: ['ft', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000],
  8: ['microinch', 0.0000254], 9: ['mil', 0.0254], 10: ['yd', 914.4], 14: ['dm', 100],
};

/**
 * Parses ASCII DXF text.
 * @param {string} text Raw DXF.
 * @return {Object} {units, mmPerUnit, header, layers, blocks, entities, counts, unsupported}
 */
function cadParseDxf(text) {
  const src = String(text || '');
  if (src.startsWith('AutoCAD Binary DXF')) throw new Error('Binary DXF is not supported — save the drawing as ASCII DXF.');
  if (/^AC10\d\d/.test(src)) throw new Error('This is a DWG file — convert it to DXF first.');
  const lines = src.split(/\r\n|\r|\n/);
  const model = {
    header: {}, layers: {}, blocks: {}, entities: [], counts: {}, unsupported: {},
    units: 'unitless', mmPerUnit: 1, insunits: 0,
  };

  let section = null, blockName = null, block = null;
  let cur = null;          /* {type, codes:[], vals:[]} */
  let pendingPoly = null;  /* old-style POLYLINE collecting VERTEX entities */
  let headerVar = null;
  let sawEof = false;

  function finishEntity(e) {
    if (!e) return;
    const t = e.type;
    if (section === 'HEADER') return;
    if (section === 'TABLES') { if (t === 'LAYER') cadReadLayer(e, model.layers); return; }
    if (section === 'BLOCKS') {
      if (t === 'BLOCK') {
        blockName = cadStr(e, 2, '');
        block = { name: blockName, baseX: cadNum(e, 10, 0), baseY: cadNum(e, 20, 0), entities: [] };
        model.blocks[blockName] = block;
        return;
      }
      if (t === 'ENDBLK') { blockName = null; block = null; return; }
      if (!block) return;
      collect(e, block.entities, false);
      return;
    }
    if (section === 'ENTITIES') collect(e, model.entities, true);
  }

  function collect(e, list, count) {
    const t = e.type;
    if (pendingPoly) {
      if (t === 'VERTEX') {
        pendingPoly.verts.push({ x: cadNum(e, 10, 0), y: cadNum(e, 20, 0), bulge: cadNum(e, 42, 0), flags: cadInt(e, 70, 0) });
        return;
      }
      if (t === 'SEQEND') { pendingPoly.list.push(pendingPoly.ent); pendingPoly = null; return; }
      pendingPoly.list.push(pendingPoly.ent); pendingPoly = null; /* malformed: no SEQEND */
    }
    if (cadInt(e, 67, 0) === 1) return; /* paper space */
    const ent = cadEntity(e);
    if (count) model.counts[t] = (model.counts[t] || 0) + 1;
    if (!ent) {
      if (count && !CAD_IGNORED[t]) model.unsupported[t] = (model.unsupported[t] || 0) + 1;
      return;
    }
    if (ent.type === 'POLYLINE') {
      if (ent.flags & (16 | 64)) { if (count) model.unsupported['POLYLINE(mesh)'] = (model.unsupported['POLYLINE(mesh)'] || 0) + 1; return; }
      pendingPoly = { ent: ent, verts: ent.verts, list: list };
      return;
    }
    list.push(ent);
  }

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (isNaN(code)) { i -= 1; continue; } /* resync on stray blank line */
    const val = lines[i + 1];
    if (code === 0) {
      const t = val.trim();
      finishEntity(cur);
      cur = null;
      if (t === 'SECTION') { section = '?'; continue; }
      if (t === 'ENDSEC') { section = null; headerVar = null; continue; }
      if (t === 'EOF') { sawEof = true; break; }
      cur = { type: t, codes: [], vals: [] };
      continue;
    }
    if (section === '?' && code === 2) { section = val.trim(); continue; }
    if (section === 'HEADER') {
      if (code === 9) { headerVar = val.trim(); model.header[headerVar] = {}; }
      else if (headerVar) model.header[headerVar][code] = val.trim();
      continue;
    }
    if (cur) { cur.codes.push(code); cur.vals.push(val); }
  }
  finishEntity(cur);
  if (pendingPoly) pendingPoly.list.push(pendingPoly.ent);
  if (!sawEof && !model.entities.length) throw new Error('No DXF entities found — is this an ASCII DXF file?');

  const ins = model.header.$INSUNITS ? parseInt(model.header.$INSUNITS[70], 10) : 0;
  const u = CAD_UNITS[ins] || CAD_UNITS[0];
  model.insunits = isNaN(ins) ? 0 : ins;
  model.units = u[0];
  model.mmPerUnit = u[1];
  const hx = (name) => model.header[name] ? { x: parseFloat(model.header[name][10]), y: parseFloat(model.header[name][20]) } : null;
  model.extMin = hx('$EXTMIN');
  model.extMax = hx('$EXTMAX');
  return model;
}

/** Entity types that carry no drawable geometry for the rack view. */
const CAD_IGNORED = { VIEWPORT: 1, ATTDEF: 1, ATTRIB: 1, SEQEND: 1, VERTEX: 1, XLINE: 0, RAY: 0 };

function cadNum(e, code, dflt) {
  const i = e.codes.indexOf(code);
  if (i < 0) return dflt;
  const v = parseFloat(e.vals[i]);
  return isNaN(v) ? dflt : v;
}
function cadInt(e, code, dflt) {
  const i = e.codes.indexOf(code);
  if (i < 0) return dflt;
  const v = parseInt(e.vals[i], 10);
  return isNaN(v) ? dflt : v;
}
function cadStr(e, code, dflt) {
  const i = e.codes.indexOf(code);
  return i < 0 ? dflt : String(e.vals[i]).trim();
}
function cadAll(e, code) {
  const out = [];
  for (let i = 0; i < e.codes.length; i++) if (e.codes[i] === code) out.push(parseFloat(e.vals[i]));
  return out;
}

function cadReadLayer(e, layers) {
  const name = cadStr(e, 2, '');
  if (!name) return;
  const color = cadInt(e, 62, 7);
  const flags = cadInt(e, 70, 0);
  layers[name] = { name: name, color: Math.abs(color), off: color < 0, frozen: !!(flags & 1) };
}

/** Extrusion (OCS normal) of an entity; null when it is the default +Z. */
function cadNormal(e) {
  const nx = cadNum(e, 210, 0), ny = cadNum(e, 220, 0), nz = cadNum(e, 230, 1);
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9 && Math.abs(nz - 1) < 1e-9) return null;
  return [nx, ny, nz];
}

/** Converts one raw entity record to a typed entity, or null if unsupported. */
function cadEntity(e) {
  const t = e.type;
  const base = { layer: cadStr(e, 8, '0'), color: cadInt(e, 62, 256) };
  switch (t) {
    case 'LINE':
      return Object.assign(base, { type: t, x1: cadNum(e, 10, 0), y1: cadNum(e, 20, 0), x2: cadNum(e, 11, 0), y2: cadNum(e, 21, 0) });
    case 'POINT':
      return Object.assign(base, { type: t, x: cadNum(e, 10, 0), y: cadNum(e, 20, 0) });
    case 'CIRCLE':
      return Object.assign(base, { type: t, cx: cadNum(e, 10, 0), cy: cadNum(e, 20, 0), r: cadNum(e, 40, 0), n: cadNormal(e) });
    case 'ARC':
      return Object.assign(base, { type: t, cx: cadNum(e, 10, 0), cy: cadNum(e, 20, 0), r: cadNum(e, 40, 0),
        a0: cadNum(e, 50, 0), a1: cadNum(e, 51, 360), n: cadNormal(e) });
    case 'ELLIPSE':
      return Object.assign(base, { type: t, cx: cadNum(e, 10, 0), cy: cadNum(e, 20, 0), mx: cadNum(e, 11, 1), my: cadNum(e, 21, 0),
        ratio: cadNum(e, 40, 1), t0: cadNum(e, 41, 0), t1: cadNum(e, 42, Math.PI * 2), n: cadNormal(e) });
    case 'LWPOLYLINE': {
      const verts = [];
      for (let i = 0; i < e.codes.length; i++) {
        const c = e.codes[i];
        if (c === 10) verts.push({ x: parseFloat(e.vals[i]), y: 0, bulge: 0 });
        else if (c === 20 && verts.length) verts[verts.length - 1].y = parseFloat(e.vals[i]);
        else if (c === 42 && verts.length) verts[verts.length - 1].bulge = parseFloat(e.vals[i]) || 0;
      }
      return Object.assign(base, { type: t, verts: verts, closed: !!(cadInt(e, 70, 0) & 1), n: cadNormal(e) });
    }
    case 'POLYLINE':
      return Object.assign(base, { type: t, verts: [], flags: cadInt(e, 70, 0), closed: !!(cadInt(e, 70, 0) & 1), n: cadNormal(e) });
    case 'SPLINE': {
      const cx = cadAll(e, 10), cy = cadAll(e, 20), fx = cadAll(e, 11), fy = cadAll(e, 21);
      return Object.assign(base, { type: t, degree: cadInt(e, 71, 3), flags: cadInt(e, 70, 0), knots: cadAll(e, 40), weights: cadAll(e, 41),
        ctrl: cx.map((x, i) => [x, cy[i]]), fit: fx.map((x, i) => [x, fy[i]]) });
    }
    case 'TEXT':
    case 'MTEXT': {
      let s = '';
      for (let i = 0; i < e.codes.length; i++) if (e.codes[i] === 3) s += e.vals[i];
      s += cadStr(e, 1, '');
      if (t === 'MTEXT') s = s.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/[{}]/g, '');
      return Object.assign(base, { type: 'TEXT', x: cadNum(e, 10, 0), y: cadNum(e, 20, 0), h: cadNum(e, 40, 2.5),
        rot: cadNum(e, 50, 0), text: s.trim() });
    }
    case 'INSERT':
      return Object.assign(base, { type: t, block: cadStr(e, 2, ''), x: cadNum(e, 10, 0), y: cadNum(e, 20, 0),
        sx: cadNum(e, 41, 1), sy: cadNum(e, 42, 1), rot: cadNum(e, 50, 0),
        cols: Math.max(1, cadInt(e, 70, 1)), rows: Math.max(1, cadInt(e, 71, 1)), dx: cadNum(e, 44, 0), dy: cadNum(e, 45, 0), n: cadNormal(e) });
    case 'DIMENSION':
      return Object.assign(base, { type: 'INSERT', block: cadStr(e, 2, ''), x: 0, y: 0, sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, dx: 0, dy: 0, n: null, dim: true });
    default:
      return null;
  }
}

/* ---------------- geometry ---------------- */

/** Arbitrary-axis algorithm: OCS (x,y) -> WCS (x,y) for normal n (null = identity). */
function cadOcs(n) {
  if (!n) return null;
  const nx = n[0], ny = n[1], nz = n[2];
  const len = Math.hypot(nx, ny, nz) || 1;
  const N = [nx / len, ny / len, nz / len];
  let ax;
  if (Math.abs(N[0]) < 1 / 64 && Math.abs(N[1]) < 1 / 64) ax = [N[2], 0, -N[0]];      /* Wy x N */
  else ax = [-N[1], N[0], 0];                                                          /* Wz x N */
  const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  ax = [ax[0] / al, ax[1] / al, ax[2] / al];
  const ay = [N[1] * ax[2] - N[2] * ax[1], N[2] * ax[0] - N[0] * ax[2], N[0] * ax[1] - N[1] * ax[0]];
  return (x, y) => [x * ax[0] + y * ay[0], x * ax[1] + y * ay[1]];
}

/** Number of chord segments for a circular sweep at the given chord tolerance. */
function cadArcSegments(r, sweep, tol) {
  if (!(r > 0)) return 1;
  const t = Math.min(tol, r * 0.5);
  const step = 2 * Math.acos(Math.max(-1, 1 - t / r));
  return Math.max(2, Math.min(720, Math.ceil(Math.abs(sweep) / (step || 0.1))));
}

/** Points of a circular arc (radians, CCW from a0 to a1). */
function cadArcPts(cx, cy, r, a0, a1, tol) {
  const n = cadArcSegments(r, a1 - a0, tol);
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (a1 - a0) * k / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Expands bulged polyline vertices into points. */
function cadBulgePts(verts, closed, tol) {
  const out = [];
  const n = verts.length;
  if (!n) return out;
  const segs = closed ? n : n - 1;
  out.push([verts[0].x, verts[0].y]);
  for (let i = 0; i < segs; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const bulge = a.bulge || 0;
    if (Math.abs(bulge) < 1e-12) { out.push([b.x, b.y]); continue; }
    const theta = 4 * Math.atan(bulge);              /* signed included angle */
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord < 1e-12) continue;
    const r = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ux = -(b.y - a.y) / chord, uy = (b.x - a.x) / chord; /* left normal of A->B */
    const off = chord * (1 - bulge * bulge) / (4 * bulge);      /* signed midpoint->centre */
    const cx = mx + ux * off, cy = my + uy * off;
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const pts = cadArcPts(cx, cy, r, a0, a0 + theta, tol);
    for (let k = 1; k < pts.length; k++) out.push(pts[k]);
    out[out.length - 1] = [b.x, b.y];
  }
  return out;
}

/** Evaluates a (rational) B-spline with de Boor's algorithm. */
function cadSplinePts(sp, tol) {
  const p = sp.degree || 3;
  const P = sp.ctrl;
  const U = sp.knots;
  if (P.length < 2 || U.length !== P.length + p + 1) {
    const pts = (sp.fit.length >= 2 ? sp.fit : P).map(q => [q[0], q[1]]);
    return pts;
  }
  const W = sp.weights.length === P.length ? sp.weights : null;
  const lo = U[p], hi = U[P.length];
  const out = [];
  /* Per knot span, enough samples to keep the chord error small: scale by
     the span's control polygon length. */
  for (let s = p; s < P.length; s++) {
    const u0 = U[s], u1 = U[s + 1];
    if (u1 - u0 <= 1e-14) continue;
    let poly = 0;
    for (let j = s - p; j < s; j++) poly += Math.hypot(P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]);
    const n = Math.max(4, Math.min(64, Math.ceil(Math.sqrt(poly / Math.max(tol, 1e-6)))));
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const u = Math.min(hi, Math.max(lo, u0 + (u1 - u0) * k / n));
      out.push(cadDeBoor(p, U, P, W, s, u));
    }
  }
  if (!out.length) return P.map(q => [q[0], q[1]]);
  return out;
}

function cadDeBoor(p, U, P, W, s, u) {
  const d = [];
  for (let j = 0; j <= p; j++) {
    const q = P[s - p + j], w = W ? W[s - p + j] : 1;
    d.push([q[0] * w, q[1] * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = s - p + j;
      const den = U[i + p + 1 - r] - U[i];
      const a = den === 0 ? 0 : (u - U[i]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
  }
  const w = d[p][2] || 1;
  return [d[p][0] / w, d[p][1] / w];
}

/**
 * Flattens a parsed model into world-coordinate primitives.
 * Circles stay exact (they carry terminal geometry); everything else becomes
 * polylines at the given chord tolerance (drawing units).
 * @param {Object} model From cadParseDxf.
 * @param {{tol?:number, skipHiddenLayers?:boolean}} [opts]
 * @return {{polylines:Array, circles:Array, points:Array, texts:Array, bounds:Object, layers:Object, warnings:Array}}
 */
function cadFlatten(model, opts) {
  const o = Object.assign({ tol: 0.05, skipHiddenLayers: true }, opts || {});
  const out = { polylines: [], circles: [], points: [], texts: [], layers: model.layers, warnings: [],
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
  const B = out.bounds;
  const grow = (x, y) => { if (x < B.minX) B.minX = x; if (y < B.minY) B.minY = y; if (x > B.maxX) B.maxX = x; if (y > B.maxY) B.maxY = y; };
  const hidden = (layer) => {
    if (!o.skipHiddenLayers) return false;
    const L = model.layers[layer];
    return !!(L && (L.off || L.frozen));
  };

  /* xf: affine [a,b,c,d,e,f] mapping (x,y) -> (a*x + c*y + e, b*x + d*y + f) */
  const apply = (xf, x, y) => xf ? [xf[0] * x + xf[2] * y + xf[4], xf[1] * x + xf[3] * y + xf[5]] : [x, y];
  const compose = (A, Bm) => { /* A after Bm */
    if (!A) return Bm; if (!Bm) return A;
    return [A[0] * Bm[0] + A[2] * Bm[1], A[1] * Bm[0] + A[3] * Bm[1], A[0] * Bm[2] + A[2] * Bm[3], A[1] * Bm[2] + A[3] * Bm[3],
      A[0] * Bm[4] + A[2] * Bm[5] + A[4], A[1] * Bm[4] + A[3] * Bm[5] + A[5]];
  };
  const ocsXf = (n) => { const f = cadOcs(n); if (!f) return null; const ex = f(1, 0), ey = f(0, 1); return [ex[0], ex[1], ey[0], ey[1], 0, 0]; };

  function pushPoly(pts, closed, layer, xf) {
    if (pts.length < 2) return;
    const flat = new Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      const q = apply(xf, pts[i][0], pts[i][1]);
      flat[2 * i] = q[0]; flat[2 * i + 1] = q[1];
      grow(q[0], q[1]);
    }
    out.polylines.push({ pts: flat, closed: !!closed, layer: layer });
  }

  function emit(list, xf, depth, inheritLayer) {
    for (const e of list) {
      const layer = (e.layer === '0' && inheritLayer) ? inheritLayer : e.layer;
      if (hidden(layer)) continue;
      const xfE = e.n ? compose(xf, ocsXf(e.n)) : xf;
      switch (e.type) {
        case 'LINE': pushPoly([[e.x1, e.y1], [e.x2, e.y2]], false, layer, xf); break;
        case 'POINT': { const q = apply(xf, e.x, e.y); grow(q[0], q[1]); out.points.push({ x: q[0], y: q[1], layer: layer }); break; }
        case 'CIRCLE': {
          const sx = xfE ? Math.hypot(xfE[0], xfE[1]) : 1, sy = xfE ? Math.hypot(xfE[2], xfE[3]) : 1;
          if (Math.abs(sx - sy) < 1e-9) {
            const c = apply(xfE, e.cx, e.cy), r = e.r * sx;
            grow(c[0] - r, c[1] - r); grow(c[0] + r, c[1] + r);
            out.circles.push({ cx: c[0], cy: c[1], r: r, layer: layer });
          } else pushPoly(cadArcPts(e.cx, e.cy, e.r, 0, Math.PI * 2, o.tol), true, layer, xfE);
          break;
        }
        case 'ARC': {
          const a0 = e.a0 * Math.PI / 180;
          let a1 = e.a1 * Math.PI / 180;
          while (a1 <= a0) a1 += Math.PI * 2;
          pushPoly(cadArcPts(e.cx, e.cy, e.r, a0, a1, o.tol), false, layer, xfE);
          break;
        }
        case 'ELLIPSE': {
          /* WCS entity: minor axis = ratio * (N x major) */
          const n = e.n || [0, 0, 1];
          const nz = n[2] >= 0 ? 1 : -1;
          const mnx = -e.my * nz * e.ratio, mny = e.mx * nz * e.ratio;
          let t0 = e.t0, t1 = e.t1;
          while (t1 <= t0) t1 += Math.PI * 2;
          const R = Math.hypot(e.mx, e.my);
          const segs = cadArcSegments(R, t1 - t0, o.tol);
          const pts = [];
          for (let k = 0; k <= segs; k++) {
            const t = t0 + (t1 - t0) * k / segs;
            pts.push([e.cx + e.mx * Math.cos(t) + mnx * Math.sin(t), e.cy + e.my * Math.cos(t) + mny * Math.sin(t)]);
          }
          pushPoly(pts, false, layer, xf);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE':
          pushPoly(cadBulgePts(e.verts, e.closed, o.tol), e.closed, layer, xfE);
          break;
        case 'SPLINE':
          pushPoly(cadSplinePts(e, o.tol), !!(e.flags & 1), layer, xf);
          break;
        case 'TEXT': {
          if (!e.text) break;
          const q = apply(xf, e.x, e.y);
          grow(q[0], q[1]);
          out.texts.push({ x: q[0], y: q[1], h: e.h * (xf ? Math.hypot(xf[0], xf[1]) : 1), rot: e.rot, text: e.text, layer: layer });
          break;
        }
        case 'INSERT': {
          const blk = model.blocks[e.block];
          if (!blk) { if (!e.dim) out.warnings.push('Missing block ' + e.block); break; }
          if (depth > 16) { out.warnings.push('Block nesting too deep at ' + e.block); break; }
          const rot = e.rot * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot);
          for (let r = 0; r < e.rows; r++) {
            for (let c = 0; c < e.cols; c++) {
              /* array offsets are in the rotated insert frame */
              const ox = c * e.dx, oy = r * e.dy;
              const px = e.x + ox * cs - oy * sn, py = e.y + ox * sn + oy * cs;
              let m = [cs * e.sx, sn * e.sx, -sn * e.sy, cs * e.sy, px, py];
              m = compose(m, [1, 0, 0, 1, -blk.baseX, -blk.baseY]);
              if (e.n) m = compose(ocsXf(e.n), m);
              emit(blk.entities, compose(xf, m), depth + 1, layer);
            }
          }
          break;
        }
        default: break;
      }
    }
  }

  emit(model.entities, null, 0, null);
  if (!isFinite(B.minX)) { B.minX = B.minY = B.maxX = B.maxY = 0; }
  return out;
}

/**
 * Renders flattened geometry as SVG. One SVG user unit = one drawing unit;
 * DXF Y-up is flipped so the drawing reads the same as in AutoCAD.
 * @param {Object} flat From cadFlatten.
 * @param {{stroke?:string, background?:string, margin?:number, precision?:number}} [opts]
 * @return {string} SVG markup.
 */
function cadToSvg(flat, opts) {
  const o = Object.assign({ stroke: '#18212f', background: '#ffffff', margin: 10, precision: 3 }, opts || {});
  const B = flat.bounds, m = o.margin;
  const w = (B.maxX - B.minX) + 2 * m, h = (B.maxY - B.minY) + 2 * m;
  const f = (v) => +v.toFixed(o.precision);
  const X = (x) => f(x - B.minX + m), Y = (y) => f(B.maxY - y + m);
  let d = '';
  for (const p of flat.polylines) {
    const a = p.pts;
    d += 'M' + X(a[0]) + ' ' + Y(a[1]);
    for (let i = 2; i < a.length; i += 2) d += 'L' + X(a[i]) + ' ' + Y(a[i + 1]);
    if (p.closed) d += 'Z';
  }
  for (const c of flat.circles) {
    const r = f(c.r);
    d += 'M' + f(X(c.cx) - r) + ' ' + Y(c.cy) + 'a' + r + ' ' + r + ' 0 1 0 ' + f(2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + f(-2 * r) + ' 0';
  }
  const unit = /^(mm|cm|in)$/.test(o.unit || '') ? o.unit : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f(w) + ' ' + f(h) + '"' +
    (unit ? ' width="' + f(w) + unit + '" height="' + f(h) + unit + '"' : '') + '>' +
    '<rect width="100%" height="100%" fill="' + o.background + '"/>' +
    '<path d="' + d + '" fill="none" stroke="' + o.stroke + '" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
    '</svg>';
}

/* ---------------- Phase 2: teach once, find every copy ----------------
 *
 * Rack drawings are flat exports (no blocks, no text), so a module is just a
 * cluster of lines, arcs and circles. Every copy of a part is the same
 * cluster shifted by a translation. A *signature* records that cluster once
 * (taught from one boxed example) and the matcher finds every translation
 * where the same cluster occurs again.
 *
 * Features are deliberately simple and translation-invariant:
 *   circle   -> key "c|<r>"            at its centre (exact geometry)
 *   polyline -> key "p|<n>|<w>|<h>"    at the centre of its bounding box
 * (n = point count, w/h = bounding-box size, rounded to 0.1 drawing unit).
 */

/** Feature list (key + reference point + bbox) for every primitive. */
function cadFeatures(flat) {
  const out = [];
  for (const c of flat.circles) {
    out.push({ key: 'c|' + c.r.toFixed(2), x: c.cx, y: c.cy, x0: c.cx - c.r, y0: c.cy - c.r, x1: c.cx + c.r, y1: c.cy + c.r });
  }
  for (const p of flat.polylines) {
    const a = p.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < x0) x0 = a[i]; if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1]; if (a[i + 1] > y1) y1 = a[i + 1];
    }
    out.push({ key: 'p|' + (a.length / 2) + '|' + (x1 - x0).toFixed(1) + '|' + (y1 - y0).toFixed(1),
      x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0: x0, y0: y0, x1: x1, y1: y1 });
  }
  return out;
}

/** Spatial index over features: key -> grid cell -> features. */
function cadFeatureIndex(features, cell) {
  const q = cell || 1;
  const byKey = new Map();
  for (const f of features) {
    let g = byKey.get(f.key);
    if (!g) { g = { count: 0, list: [], grid: new Map() }; byKey.set(f.key, g); }
    g.count++; g.list.push(f);
    const k = Math.floor(f.x / q) + ',' + Math.floor(f.y / q);
    const b = g.grid.get(k);
    if (b) b.push(f); else g.grid.set(k, [f]);
  }
  return { cell: q, byKey: byKey, features: features };
}

/** True when a feature with this key sits within tol of (x, y). */
function cadIndexHas(index, key, x, y, tol) {
  const g = index.byKey.get(key);
  if (!g) return false;
  const q = index.cell;
  const cx = Math.floor(x / q), cy = Math.floor(y / q);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const b = g.grid.get((cx + i) + ',' + (cy + j));
      if (!b) continue;
      for (const f of b) if (Math.abs(f.x - x) <= tol && Math.abs(f.y - y) <= tol) return true;
    }
  }
  return false;
}

/**
 * Teaches a signature from one boxed example.
 * @param {Object} index From cadFeatureIndex (whole drawing).
 * @param {{x0:number,y0:number,x1:number,y1:number}} box Drawing-unit box around ONE copy.
 * @param {{kind:string, name?:string, terminals?:Array<{role:string,x:number,y:number}>}} meta
 *        Terminals in drawing coordinates (e.g. snapped circle centres).
 * @return {Object} Signature {kind, name, w, h, features:[{key,dx,dy}], terminals:[{role,dx,dy}]}.
 */
function cadTeachSignature(index, box, meta) {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  const e = 1e-6;
  const feats = [];
  for (const f of index.features) {
    if (f.x0 >= x0 - e && f.x1 <= x1 + e && f.y0 >= y0 - e && f.y1 <= y1 + e) {
      feats.push({ key: f.key, dx: +(f.x - x0).toFixed(4), dy: +(f.y - y0).toFixed(4) });
    }
  }
  if (feats.length < 3) throw new Error('The box holds too little geometry to recognise this part. Draw the box around the whole part.');
  const m = meta || {};
  return {
    version: 1,
    kind: m.kind || 'module',
    name: m.name || '',
    w: +(x1 - x0).toFixed(4),
    h: +(y1 - y0).toFixed(4),
    x0: x0, y0: y0,                 /* where it was taught (drawing-specific) */
    features: feats,
    terminals: (m.terminals || []).map(t => ({ role: t.role, dx: +(t.x - x0).toFixed(4), dy: +(t.y - y0).toFixed(4) })),
  };
}

/**
 * Finds every copy of a signature in the drawing (translation only; optional
 * left-right mirror). Overlapping hits are reduced to the best one.
 * @param {Object} index From cadFeatureIndex.
 * @param {Object} sig From cadTeachSignature.
 * @param {{tol?:number, minScore?:number, mirror?:boolean}} [opts]
 * @return {Array<Object>} Matches {x0,y0,x1,y1, score, mirrored, terminals:[{role,x,y}]} sorted by x then y.
 */
function cadFindMatches(index, sig, opts) {
  const o = Object.assign({ tol: 0.1, minScore: 0.8, mirror: false }, opts || {});
  const feats = sig.features;
  if (!feats.length) return [];
  /* Anchors: several signature features of different keys, spread from rare to
     common. A single rarest feature can belong to the taught copy's
     surroundings only (e.g. a rail present in the bottom row), which would
     hide every other copy; the union of anchors' offsets avoids that. */
  const byCount = [];
  const seenKey = new Set();
  for (const f of feats) {
    if (seenKey.has(f.key)) continue;
    seenKey.add(f.key);
    const g = index.byKey.get(f.key);
    if (g && g.count <= 5000) byCount.push({ f: f, n: g.count });
  }
  if (!byCount.length) return [];
  byCount.sort((a, b) => a.n - b.n || a.f.key.localeCompare(b.f.key));
  const K = Math.min(8, byCount.length);
  const anchors = [];
  for (let i = 0; i < K; i++) anchors.push(byCount[Math.floor(i * (byCount.length - 1) / Math.max(1, K - 1))].f);
  /* Check a spread-out sample first so hopeless offsets fail fast. */
  const step = Math.max(1, Math.floor(feats.length / 40));
  const sample = feats.filter((_, i) => i % step === 0);
  const hits = [];
  const tried = new Set();
  const variants = o.mirror ? [false, true] : [false];
  for (const mirrored of variants) for (const anchor of anchors) {
    const ax = mirrored ? sig.w - anchor.dx : anchor.dx;
    for (const g of index.byKey.get(anchor.key).list) {
      const ox = g.x - ax, oy = g.y - anchor.dy;
      const tk = (mirrored ? 'm' : '') + Math.round(ox * 10) + ',' + Math.round(oy * 10);
      if (tried.has(tk)) continue;
      tried.add(tk);
      const at = (f) => [ox + (mirrored ? sig.w - f.dx : f.dx), oy + f.dy];
      let ok = 0;
      for (const f of sample) { const p = at(f); if (cadIndexHas(index, f.key, p[0], p[1], o.tol)) ok++; }
      if (ok / sample.length < o.minScore - 0.05) continue;
      ok = 0;
      for (const f of feats) { const p = at(f); if (cadIndexHas(index, f.key, p[0], p[1], o.tol)) ok++; }
      const score = ok / feats.length;
      if (score < o.minScore) continue;
      hits.push({
        x0: ox, y0: oy, x1: ox + sig.w, y1: oy + sig.h, score: score, mirrored: mirrored,
        terminals: sig.terminals.map(t => ({ role: t.role, x: ox + (mirrored ? sig.w - t.dx : t.dx), y: oy + t.dy })),
      });
    }
  }
  /* Non-maximum suppression: keep the best of any overlapping hits. */
  hits.sort((a, b) => b.score - a.score || a.x0 - b.x0 || a.y0 - b.y0);
  const kept = [];
  const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  for (const h of hits) {
    const clash = kept.some(k => {
      const ix = Math.min(h.x1, k.x1) - Math.max(h.x0, k.x0), iy = Math.min(h.y1, k.y1) - Math.max(h.y0, k.y0);
      return ix > 0 && iy > 0 && ix * iy > 0.3 * Math.min(area(h), area(k));
    });
    if (!clash) kept.push(h);
  }
  kept.sort((a, b) => a.x0 - b.x0 || b.y0 - a.y0);
  return kept;
}

/** Coarse grid of all features (built once per index) to count what lies inside a box. */
function cadBoxGrid(index) {
  if (index._boxGrid) return index._boxGrid;
  const q = 100, cells = new Map();
  for (const f of index.features) {
    const k = Math.floor(f.x / q) + ',' + Math.floor(f.y / q);
    const b = cells.get(k); if (b) b.push(f); else cells.set(k, [f]);
  }
  return (index._boxGrid = { q: q, cells: cells });
}
/** Number of features lying completely inside a box. */
function cadCountInside(grid, x0, y0, x1, y1) {
  const q = grid.q, e = 1e-6;
  let n = 0;
  for (let i = Math.floor(x0 / q); i <= Math.floor(x1 / q); i++) for (let j = Math.floor(y0 / q); j <= Math.floor(y1 / q); j++) {
    const b = grid.cells.get(i + ',' + j);
    if (b) for (const f of b) if (f.x0 >= x0 - e && f.x1 <= x1 + e && f.y0 >= y0 - e && f.y1 <= y1 + e) n++;
  }
  return n;
}

/**
 * Strips a freshly taught signature down to the geometry its copies share.
 * The taught example may contain extra lines that are not part of the
 * component (a frame rail that runs through the bottom row, a cable, a
 * neighbour's edge). Copies elsewhere lack them, so they would score low.
 * Every candidate offset is scored; each feature's support is the share of
 * the plausible copies that contain it; features most copies share form the
 * core. The terminals are kept as taught.
 * @param {Object} index From cadFeatureIndex.
 * @param {Object} sig From cadTeachSignature.
 * @param {{tol?:number, bar?:number, support?:number}} [opts]
 * @return {Object} New signature with `features` reduced and `taughtFeatures` count; unchanged if no copies exist.
 */
function cadRefineSignature(index, sig, opts) {
  const o = Object.assign({ tol: 0.1, bar: 0.15, keyBar: 0.25, spread: 0.6, support: 0.5, extra: 0.5 }, opts || {});
  const grid = cadBoxGrid(index);
  const feats = sig.features;
  const keyId = new Map();
  for (const f of feats) if (!keyId.has(f.key)) keyId.set(f.key, keyId.size);
  /* extent of the taught geometry, for the spread test below */
  let ex0 = Infinity, ex1 = -Infinity, ey0 = Infinity, ey1 = -Infinity;
  for (const f of feats) { ex0 = Math.min(ex0, f.dx); ex1 = Math.max(ex1, f.dx); ey0 = Math.min(ey0, f.dy); ey1 = Math.max(ey1, f.dy); }
  const ew = ex1 - ex0, eh = ey1 - ey0;
  const keep = (extra) => Object.assign({}, sig, { taughtFeatures: feats.length }, extra || {});
  /* Candidate offsets from up to 16 anchor keys spread from rare to common. */
  const keyFirst = new Map();
  for (const f of feats) if (!keyFirst.has(f.key)) keyFirst.set(f.key, f);
  const keys = [];
  for (const [k, f] of keyFirst) { const g = index.byKey.get(k); if (g && g.count <= 5000) keys.push({ f: f, n: g.count }); }
  if (!keys.length) return keep();
  keys.sort((a, b) => a.n - b.n || a.f.key.localeCompare(b.f.key));
  const K = Math.min(16, keys.length);
  const offsets = new Map();
  for (let i = 0; i < K; i++) {
    const a = keys[Math.floor(i * (keys.length - 1) / Math.max(1, K - 1))].f;
    for (const g of index.byKey.get(a.key).list) {
      const ox = g.x - a.dx, oy = g.y - a.dy;
      if (Math.abs(ox - sig.x0) < o.tol && Math.abs(oy - sig.y0) < o.tol) continue; /* the taught copy */
      offsets.set(Math.round(ox * 10) + ',' + Math.round(oy * 10), [ox, oy]);
    }
  }
  const step = Math.max(1, Math.floor(feats.length / 40));
  const copies = [];
  for (const off of offsets.values()) {
    let ok = 0, n = 0;
    for (let i = 0; i < feats.length; i += step) { n++; if (cadIndexHas(index, feats[i].key, off[0] + feats[i].dx, off[1] + feats[i].dy, o.tol)) ok++; }
    if (ok / n < o.bar * 0.5) continue;                 /* cheap reject */
    const has = new Uint8Array(feats.length);
    const keysHit = new Uint8Array(keyId.size);
    let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
    ok = 0;
    for (let i = 0; i < feats.length; i++) {
      if (cadIndexHas(index, feats[i].key, off[0] + feats[i].dx, off[1] + feats[i].dy, o.tol)) {
        has[i] = 1; ok++; keysHit[keyId.get(feats[i].key)] = 1;
        mx0 = Math.min(mx0, feats[i].dx); mx1 = Math.max(mx1, feats[i].dx); my0 = Math.min(my0, feats[i].dy); my1 = Math.max(my1, feats[i].dy);
      }
    }
    /* A real copy matches geometry across the whole part. A connector or
       bolt pattern that also occurs inside other parts matches one corner. */
    if (ok && ((ew > 1 && (mx1 - mx0) < o.spread * ew) || (eh > 1 && (my1 - my0) < o.spread * eh))) continue;
    /* A real copy shares many KINDS of geometry. A shifted row of identical
       bolts or rail clips shares one kind only and must not vote. */
    let kinds = 0;
    for (let k = 0; k < keysHit.length; k++) kinds += keysHit[k];
    if (ok / feats.length >= o.bar && kinds / keyId.size >= o.keyBar) {
      /* geometry inside this copy's box that the taught part does not have */
      const inside = cadCountInside(grid, off[0], off[1], off[0] + sig.w, off[1] + sig.h);
      copies.push({ has: has, score: ok / feats.length, extra: inside ? Math.max(0, inside - ok) / inside : 0 });
    }
  }
  /* Only real copies vote. A real copy has nothing of its own inside its box
     (it may only lack extras of the taught example, like a rail through the
     bottom row). A look-alike part (an SSC sharing the MSM's enclosure) has
     its own geometry there; if it voted, nine SSCs would outvote the real
     MSM and strip exactly the screen, arrow and emergency stop that tell the
     two apart. */
  const voters = copies.filter(c => c.extra <= o.extra).map(c => c.has);
  if (!voters.length) return keep({ copiesSeen: 0, lookAlikes: copies.length });
  const core = [];
  for (let i = 0; i < feats.length; i++) {
    let n = 0;
    for (const c of voters) n += c[i];
    if (n / voters.length >= o.support) core.push(feats[i]);
  }
  /* Too little left means the example has no real repeats: keep it whole. */
  if (core.length < Math.max(8, 0.15 * feats.length)) return keep({ copiesSeen: voters.length });
  return keep({ features: core, copiesSeen: voters.length, lookAlikes: copies.length - voters.length });
}

/**
 * Runs every signature and resolves overlaps between kinds: a region claimed
 * by a larger part (e.g. an SSC) is not also reported as a smaller one.
 * @param {Object} index From cadFeatureIndex.
 * @param {Array<Object>} sigs Signatures.
 * @param {Object} [opts] Passed to cadFindMatches.
 * @return {Array<Object>} Components {id, kind, name, x0,y0,x1,y1, score, terminals}.
 */
function cadRecognise(index, sigs, opts) {
  const all = [];
  sigs.forEach((sig, si) => {
    for (const m of cadFindMatches(index, sig, opts)) all.push(Object.assign({ kind: sig.kind, name: sig.name, sig: si, size: sig.w * sig.h, detail: sig.features.length }, m));
  });
  all.sort((a, b) => b.size - a.size || b.score - a.score);
  const kept = [];
  for (const c of all) {
    const inside = kept.some(k => k.kind !== c.kind &&
      c.x0 >= k.x0 - 0.5 && c.x1 <= k.x1 + 0.5 && c.y0 >= k.y0 - 0.5 && c.y1 <= k.y1 + 0.5);
    if (!inside) kept.push(c);
  }
  const n = {};
  kept.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.x0 - b.x0 || b.y0 - a.y0);
  return kept.map(c => {
    n[c.kind] = (n[c.kind] || 0) + 1;
    return { id: c.kind + '-' + n[c.kind], kind: c.kind, name: c.name, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, score: c.score, mirrored: c.mirrored, terminals: c.terminals, detail: c.detail };
  }).filter((c, i, list) => !cadOutranked(c, list));
}

/** Share of the smaller box covered by the other one (0..1). */
function cadOverlap(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
}
/**
 * A copy is dropped when it largely overlaps a copy of ANOTHER part type that
 * was taught with more detail (more features). Example: an MSM shares its
 * enclosure with the SSCs, so the MSM pattern also fits inside every SSC; the
 * SSC, taught with far more detail, keeps those places.
 */
function cadOutranked(c, list) {
  return list.some(o => o !== c && o.kind !== c.kind && (o.detail || 0) > (c.detail || 0) && cadOverlap(c, o) >= 0.5);
}

/**
 * Proposes the numbers of labelled parts (SSC, ACDP, MSM).
 * AYK rule (18 Nov 2026): ACDP1 is the ACDP closest to the MSM, so its
 * back-side cable is the shortest; the next closest is ACDP2, and so on.
 * SSCs follow the same rule: SSC1 is the SSC closest to the MSM.
 * MSMs are numbered left to right. Without an MSM, ACDPs fall back to left
 * to right (SSCs too). These are proposals only: the engineer confirms every label.
 * @param {Array<Object>} comps Components {kind, x0,y0,x1,y1}.
 * @return {Map<Object,number>} Component -> proposed number (1-based).
 */
function cadProposeNumbers(comps) {
  const out = new Map();
  const cx = c => (c.x0 + c.x1) / 2, cy = c => (c.y0 + c.y1) / 2;
  const leftToRight = (a, b) => a.x0 - b.x0 || b.y0 - a.y0;
  const msms = comps.filter(c => c.kind === 'msm').sort(leftToRight);
  msms.forEach((c, i) => out.set(c, i + 1));
  const toMsm = c => msms.length ? Math.min(...msms.map(m => Math.hypot(cx(c) - cx(m), cy(c) - cy(m)))) : 0;
  /* Same rule for SSCs (AYK, 18 Nov 2026): SSC1 is the SSC closest to the MSM. */
  for (const kind of ['acdp', 'ssc']) {
    comps.filter(c => c.kind === kind)
      .map(c => ({ c: c, d: toMsm(c) }))
      .sort((a, b) => (a.d - b.d) || leftToRight(a.c, b.c))
      .forEach((e, i) => out.set(e.c, i + 1));
  }
  return out;
}

/** Short human summary of a parsed + flattened drawing. */
function cadSummary(model, flat) {
  const B = flat.bounds;
  const total = Object.keys(model.counts).reduce((a, k) => a + model.counts[k], 0);
  const skipped = Object.keys(model.unsupported).reduce((a, k) => a + model.unsupported[k], 0);
  return {
    units: model.units,
    entities: total,
    counts: model.counts,
    unsupported: model.unsupported,
    skipped: skipped,
    layers: Object.keys(model.layers).length,
    blocks: Object.keys(model.blocks).filter(n => n.charAt(0) !== '*').length,
    width: B.maxX - B.minX,
    height: B.maxY - B.minY,
    bounds: B,
    extMin: model.extMin,
    extMax: model.extMax,
    polylines: flat.polylines.length,
    circles: flat.circles.length,
    texts: flat.texts.length,
  };
}
