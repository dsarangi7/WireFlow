/* =====================================================================
 * AYK WireFlow — frontview.js
 * Wiring drawn on the REAL rack: the imported Visio/AutoCAD rack picture
 * becomes the base layer, the engineer calibrates the module grid on it
 * with two clicks, and the red/green wiring is drawn straight over the
 * picture (the workflow from the video study: diagonal hops between
 * neighbouring modules, rail risers down to the SSC).
 *
 * Coordinate spaces:
 *   px    — natural pixels of the rack image (y grows DOWNWARD)
 *   sheet — WireFlow sheet units (1680 × 1188, 1 unit = 0.25 mm)
 * Lengths are millimetres, derived from px × mmPerPx.
 * Exports: fvCalib, fvSlotCenter, fvTerminals, fvWiring, fvSvg,
 *          fvPxToSheet, fvSummary
 * ===================================================================== */

'use strict';

function fvNum(v, d) {
  const n = parseFloat(v);
  if (Number.isFinite(n)) return n;
  return d === undefined ? 0 : d;   /* NaN default stays NaN — no silent 0 */
}

/* ---- calibration ---------------------------------------------------- */

/* cal = {
 *   imgW, imgH       natural size of the rack image (px)
 *   x0, y0           centre of slot (0,0) — the FIRST numbered module (px)
 *   pitchX, pitchY   distance between slot centres (px)
 *   cols, rows       slot grid on the picture
 *   mmPerPx          physical scale (mm per image pixel)
 *   moduleWf, moduleHf  module face as a fraction of the pitch (0 < f <= 1)
 *   termInsetFrac    terminal row height above the module bottom edge
 *   devices          { ssc:{x,y}, acdp:{x,y}, msm:{x,y}, jb:{x,y} } in px
 * }
 */
function fvCalib(o) {
  const c = o || {};
  const cal = {
    imgW: Math.max(1, fvNum(c.imgW, 1000)),
    imgH: Math.max(1, fvNum(c.imgH, 700)),
    x0: fvNum(c.x0, NaN), y0: fvNum(c.y0, NaN),
    pitchX: Math.max(1, fvNum(c.pitchX, NaN)),
    pitchY: Math.max(1, fvNum(c.pitchY, NaN)),
    cols: Math.max(1, Math.round(fvNum(c.cols, 3))),
    rows: Math.max(1, Math.round(fvNum(c.rows, 8))),
    mmPerPx: Math.max(1e-6, fvNum(c.mmPerPx, 1)),
    moduleWf: Math.min(1, Math.max(0.3, fvNum(c.moduleWf, 0.92))),
    moduleHf: Math.min(1, Math.max(0.3, fvNum(c.moduleHf, 0.88))),
    termInsetFrac: Math.min(0.6, Math.max(0.02, fvNum(c.termInsetFrac, 0.14))),
    devices: c.devices && typeof c.devices === 'object' ? c.devices : {},
  };
  cal.ok = Number.isFinite(cal.x0) && Number.isFinite(cal.y0) &&
    Number.isFinite(cal.pitchX) && Number.isFinite(cal.pitchY);
  return cal;
}

/* Centre of slot (col c, row r) in px. Row 0 is the TOP module row. */
function fvSlotCenter(cal, c, r) {
  return { x: cal.x0 + c * cal.pitchX, y: cal.y0 + r * cal.pitchY };
}

/* Terminal anchors of a module in px — mirrors the physical convention:
 * comm pair (S south/left, N north/right) at 23% of the face width,
 * power pair (Neg left, Pos right) at 77%, both near the bottom edge. */
function fvTerminals(cal, c, r) {
  const p = fvSlotCenter(cal, c, r);
  const mw = cal.pitchX * cal.moduleWf;
  const mh = cal.pitchY * cal.moduleHf;
  const left = p.x - mw / 2;
  const yT = p.y + mh / 2 - cal.termInsetFrac * mh;
  return {
    commS: { x: left + mw * 0.21, y: yT },
    commN: { x: left + mw * 0.25, y: yT },
    pwrNeg: { x: left + mw * 0.75, y: yT },
    pwrPos: { x: left + mw * 0.79, y: yT },
    face: { left: left, top: p.y - mh / 2, w: mw, h: mh },
  };
}

function fvDist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

/* ---- wiring ----------------------------------------------------------
 * Follows the engine's netlist topology:
 *   power  SSC+ → M1 Pos, Mx Neg → Mx+1 Pos (diagonal hop), MN Neg → SSC−
 *   comm   SSC S → M1 N,  Mx S → Mx+1 N (zig-zag),           MN S → SSC N
 * Riser runs use a vertical rail right of the rack, as the engineer does.
 * Every segment carries its physical length in mm.
 * ---------------------------------------------------------------------- */
function fvWiring(order, cal, opts) {
  const o = opts || {};
  const slot = (id) => { const [c, r] = id.split(',').map(Number); return { c: c, r: r }; };
  const railX = fvNum(o.railX, NaN) ||
    Math.min(cal.imgW - cal.pitchX * 0.15, fvSlotCenter(cal, cal.cols - 1, 0).x + cal.pitchX * 0.62);
  const segs = [];
  const push = (kind, pts, m) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += fvDist(pts[i - 1], pts[i]);
    segs.push({ kind: kind, pts: pts, lenMm: len * cal.mmPerPx, m: m });
  };

  const mods = (order || []).map(slot);
  mods.forEach((s, i) => {
    const t = fvTerminals(cal, s.c, s.r);
    segs.push({ kind: 'label', pts: [{ x: t.face.left + t.face.w / 2, y: t.face.top + t.face.h * 0.3 }], m: i + 1, lenMm: 0 });
  });

  const ssc = cal.devices && cal.devices.ssc;
  const anchor = ssc || { x: fvSlotCenter(cal, Math.floor((cal.cols - 1) / 2), cal.rows).x,
                          y: fvSlotCenter(cal, 0, cal.rows - 1).y + cal.pitchY * 1.35 };

  if (mods.length) {
    const first = fvTerminals(cal, mods[0].c, mods[0].r);
    const last = fvTerminals(cal, mods[mods.length - 1].c, mods[mods.length - 1].r);
    /* power risers via the right rail */
    push('sscp', [anchor, { x: railX, y: anchor.y }, { x: railX, y: first.pwrPos.y }, first.pwrPos]);
    push('sscp', [last.pwrNeg, { x: railX, y: last.pwrNeg.y }, { x: railX, y: anchor.y + cal.pitchY * 0.18 }, { x: anchor.x, y: anchor.y + cal.pitchY * 0.18 }, anchor]);
    /* comm risers, offset slightly so the two rails do not overlap */
    push('sscc', [anchor, { x: railX + cal.pitchX * 0.06, y: anchor.y }, { x: railX + cal.pitchX * 0.06, y: first.commN.y }, first.commN]);
    push('sscc', [last.commS, { x: railX + cal.pitchX * 0.06, y: last.commS.y }, { x: railX + cal.pitchX * 0.06, y: anchor.y - cal.pitchY * 0.18 }, { x: anchor.x, y: anchor.y - cal.pitchY * 0.18 }, anchor]);
  }

  for (let i = 1; i < mods.length; i++) {
    const a = fvTerminals(cal, mods[i - 1].c, mods[i - 1].r);
    const b = fvTerminals(cal, mods[i].c, mods[i].r);
    push('power', [a.pwrNeg, b.pwrPos]);
    push('comm', [a.commS, b.commN]);
  }
  return segs;
}

/* ---- px → sheet mapping (through the underlay fit rectangle) --------- */
function fvPxToSheet(cal, fit, x, y) {
  return {
    x: fit.x + (x / cal.imgW) * fit.w,
    y: fit.y + (y / cal.imgH) * fit.h,
  };
}

/* ---- summary for the UI --------------------------------------------- */
function fvSummary(segs) {
  const power = segs.filter((s) => s.kind === 'power' || s.kind === 'sscp');
  const comm = segs.filter((s) => s.kind === 'comm' || s.kind === 'sscc');
  const sum = (a) => a.reduce((t, s) => t + s.lenMm, 0);
  return {
    powerSegs: power.length, commSegs: comm.length,
    powerMm: sum(power), commMm: sum(comm),
    maxHopMm: segs.filter((s) => s.kind === 'power' || s.kind === 'comm')
      .reduce((m, s) => Math.max(m, s.lenMm), 0),
  };
}

/* ---- SVG ------------------------------------------------------------- */
const FV_KIND = {
  power: { color: '#e02020', width: 2.2 },
  sscp: { color: '#e02020', width: 2.2 },
  comm: { color: '#00a651', width: 1.8 },
  sscc: { color: '#00a651', width: 1.8 },
};

/* img: { src, x, y, w, h } placement of the rack picture inside the SVG
 * viewport (the overlay is drawn in the SAME px space as the image). */
function fvSvg(cal, img, segs, opts) {
  const o = opts || {};
  const w = o.width || cal.imgW, h = o.height || cal.imgH;
  const sx = w / cal.imgW, sy = h / cal.imgH;
  /* text lives in viewBox units: scale with the slot pitch in that space */
  const fs = Math.max(6, Math.min(cal.pitchX, cal.pitchY) * 0.34 * Math.max(sx, sy));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif">`;
  if (img && img.src) {
    s += `<image x="${(img.x || 0) * sx}" y="${(img.y || 0) * sy}" width="${(img.w || cal.imgW) * sx}" ` +
      `height="${(img.h || cal.imgH) * sy}" preserveAspectRatio="xMidYMid meet" href="${img.src}"/>`;
  } else {
    s += `<rect width="${w}" height="${h}" fill="#f8fafc"/>`;
  }
  /* faint slot grid so the engineer sees what he is clicking */
  if (!o.noGrid) {
    s += '<g stroke="#3b82f6" stroke-opacity="0.28" fill="none" stroke-width="1">';
    for (let c = 0; c < cal.cols; c++) {
      for (let r = 0; r < cal.rows; r++) {
        const t = fvTerminals(cal, c, r).face;
        s += `<rect data-slot="${c},${r}" x="${(t.left * sx).toFixed(1)}" y="${(t.top * sy).toFixed(1)}" ` +
          `width="${(t.w * sx).toFixed(1)}" height="${(t.h * sy).toFixed(1)}" rx="2"/>`;
      }
    }
    s += '</g>';
  }
  /* wiring */
  for (const seg of segs) {
    if (seg.kind === 'label') continue;
    const k = FV_KIND[seg.kind] || FV_KIND.power;
    s += `<polyline points="${seg.pts.map((p) => `${(p.x * sx).toFixed(1)},${(p.y * sy).toFixed(1)}`).join(' ')}" ` +
      `fill="none" stroke="${k.color}" stroke-width="${(k.width * Math.min(sx, sy) * 1.4).toFixed(2)}" ` +
      `stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.95" pointer-events="none"/>`;
    for (const p of seg.pts) {
      s += `<circle cx="${(p.x * sx).toFixed(1)}" cy="${(p.y * sy).toFixed(1)}" r="${(k.width * Math.min(sx, sy)).toFixed(2)}" fill="${k.color}" pointer-events="none"/>`;
    }
  }
  /* M labels */
  for (const seg of segs) {
    if (seg.kind !== 'label') continue;
    s += `<text data-slot-label="${seg.m}" x="${(seg.pts[0].x * sx).toFixed(1)}" y="${(seg.pts[0].y * sy).toFixed(1)}" ` +
      `text-anchor="middle" font-weight="700" font-size="${fs.toFixed(1)}" fill="#0f172a" ` +
      `stroke="#ffffff" stroke-width="${(fs * 0.16).toFixed(1)}" paint-order="stroke" pointer-events="none">M${seg.m}</text>`;
  }
  return s + '</svg>';
}
