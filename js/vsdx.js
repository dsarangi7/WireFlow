/* ============================================================
 * AYK WireFlow — VSDX (Visio) export
 *
 * Consumes the shared buildSheetLayout() primitives from
 * engine.js and packages a valid Visio 2013+ drawing
 * (.vsdx = OPC zip) fully client-side.
 *
 * Format conventions learned from the AYK finishing workflow
 * (blank template 111.vsdx -> finished DWG2512-01):
 *   - wires are NATIVE 1D line shapes (BeginX/BeginY/EndX/EndY
 *     with Angle = ATAN2(...)), so each end can be dragged and
 *     re-routed in Visio exactly like hand-drawn wires
 *   - house wire colours: power #ff0000, communication #00b050
 *   - layer section uses the canonical <Section N="Layer"> with
 *     Name/Color/Visible/Print/... row cells
 *   - AYK logo bitmap embedded in the title block (media part)
 *   - second page "Notes" carries the wiring notes, legend and
 *     exception list
 * ============================================================ */

/* Sheet geometry: engine uses 1680 x 1188 units; 1 unit = 0.25 mm. */
const VSDX_SHEET_W = 1680, VSDX_SHEET_H = 1188;
const VSDX_UNIT_IN = 0.25 / 25.4; /* units -> inches (Visio internal unit) */
const VSDX_LAYERS = [
  { name: 'FRAME',   color: '#1e3a5f' },
  { name: 'TITLE',   color: '#0f172a' },
  { name: 'LEGEND',  color: '#334155' },
  { name: 'POWER',   color: '#ff0000' },
  { name: 'SUBPWR',  color: '#ff0000' },
  { name: 'COMM',    color: '#00b050' },
  { name: 'COMMGRY', color: '#6b7280' },
  { name: 'TEXT',    color: '#0f172a' },
  { name: 'MOD',     color: '#94a3b8' },
  { name: 'DEVICE',  color: '#64748b' },
  { name: 'SSC',     color: '#6366f1' },
  { name: 'TERM',    color: '#00b050' },
  { name: 'RACK',    color: '#8a94a6' },
  { name: 'NUMBER',  color: '#b45309' },
];
const VSDX_WIRE_COLORS = {
  POWER: '#ff0000', SUBPWR: '#ff0000',
  COMM: '#00b050', TERM: '#00b050',
  COMMGRY: '#6b7280',
};

/* AYK company logo, 123x128 PNG (from the Visio template, media/image2.bmp). */
const VSDX_LOGO_B64 = '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';

function vsdxIn(units) { return (units * VSDX_UNIT_IN).toFixed(6); }
function vsdxEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\r|\n/g, ' ');
}
function vsdxLayerIndex(layer) {
  const i = VSDX_LAYERS.findIndex(l => l.name === layer);
  return i < 0 ? VSDX_LAYERS.findIndex(l => l.name === 'TEXT') : i;
}
function vsdxB64ToBytes(b64) {
  const bin = (typeof atob === 'function') ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---- shape cell helpers ---- */
function vsdxCell(n, v, f) { return `<Cell N="${n}" V="${v}"${f ? ` F="${vsdxEsc(f)}"` : ''}/>`; }
function vsdxLineCells(p) {
  const w = Math.max(0.004, (p.width || 1) * 0.0055); /* inches */
  let s = vsdxCell('LineWeight', w.toFixed(6)) + vsdxCell('LineColor', '#333333');
  if (p.dash) s += vsdxCell('LinePattern', '2') + vsdxCell('LineWeight', w.toFixed(6));
  return s;
}

/**
 * Native 1D wire shape — same anatomy as the hand-drawn wires in
 * the AYK finishing template: Begin/End absolute anchors, pin at
 * the midpoint, Angle = ATAN2(EndY-BeginY,EndX-BeginX), and a
 * single MoveTo(0,0)->LineTo(Width,0) local geometry.
 */
function vsdxWireShape(id, p) {
  const flipY = y => VSDX_SHEET_H - y;
  let bx = p.x1, by = flipY(p.y1), ex = p.x2, ey = flipY(p.y2);
  /* guard degenerate zero-length lines (ATAN2/Width would be 0) */
  let len = Math.hypot(ex - bx, ey - by);
  if (len < 0.05) { ex = bx + 0.05; ey = by; len = 0.05; }
  const wIn = len * VSDX_UNIT_IN;
  const pinX = ((bx + ex) / 2) * VSDX_UNIT_IN;
  const pinY = ((by + ey) / 2) * VSDX_UNIT_IN;
  const angle = Math.atan2(ey - by, ex - bx);
  const layerIx = vsdxLayerIndex(p.layer);
  const color = VSDX_WIRE_COLORS[p.layer] || '#333333';
  const weight = Math.max(0.005, (p.width || 1) * 0.0055).toFixed(6);
  return `<Shape ID="${id}" Type="Shape">`
    + vsdxCell('PinX', pinX.toFixed(6), '(BeginX+EndX)/2')
    + vsdxCell('PinY', pinY.toFixed(6), '(BeginY+EndY)/2')
    + vsdxCell('Width', wIn.toFixed(6), 'SQRT((EndX-BeginX)^2+(EndY-BeginY)^2)')
    + vsdxCell('Height', '0')
    + vsdxCell('LocPinX', (wIn / 2).toFixed(6), 'Width*0.5')
    + vsdxCell('LocPinY', '0', 'Height*0.5')
    + vsdxCell('Angle', angle.toFixed(6), 'ATAN2(EndY-BeginY,EndX-BeginX)')
    + vsdxCell('FlipX', '0') + vsdxCell('FlipY', '0')
    + vsdxCell('BeginX', (bx * VSDX_UNIT_IN).toFixed(6))
    + vsdxCell('BeginY', (by * VSDX_UNIT_IN).toFixed(6))
    + vsdxCell('EndX', (ex * VSDX_UNIT_IN).toFixed(6))
    + vsdxCell('EndY', (ey * VSDX_UNIT_IN).toFixed(6))
    + vsdxCell('LayerMember', String(layerIx))
    + vsdxCell('LineWeight', weight)
    + vsdxCell('LineColor', color)
    + (p.dash ? vsdxCell('LinePattern', '2') : '')
    + `<Section N="Geometry" IX="0">${vsdxCell('NoFill', '1')}${vsdxCell('NoLine', '0')}${vsdxCell('NoShow', '0')}${vsdxCell('NoSnap', '0')}${vsdxCell('NoQuickDrag', '0')}`
    + `<MoveTo IX="1">${vsdxCell('X', '0')}${vsdxCell('Y', '0')}</MoveTo>`
    + `<LineTo IX="2">${vsdxCell('X', wIn.toFixed(6), 'Width*1')}${vsdxCell('Y', '0')}</LineTo>`
    + `</Section></Shape>`;
}

/** Generic embedded-bitmap Foreign shape from a sheet-unit rect (Y down). */
function vsdxImageShape(id, rectU, layerName, relId) {
  const pinX = (rectU.x + rectU.w / 2) * VSDX_UNIT_IN;
  const pinY = (VSDX_SHEET_H - rectU.y - rectU.h / 2) * VSDX_UNIT_IN;
  const wIn = rectU.w * VSDX_UNIT_IN, hIn = rectU.h * VSDX_UNIT_IN;
  const rid = relId || 'rId1';
  return `<Shape ID="${id}" Type="Foreign">`
    + vsdxCell('PinX', pinX.toFixed(6)) + vsdxCell('PinY', pinY.toFixed(6))
    + vsdxCell('Width', wIn.toFixed(6)) + vsdxCell('Height', hIn.toFixed(6))
    + vsdxCell('LocPinX', (wIn / 2).toFixed(6), 'Width*0.5')
    + vsdxCell('LocPinY', (hIn / 2).toFixed(6), 'Height*0.5')
    + vsdxCell('Angle', '0') + vsdxCell('LockAspect', '1')
    + vsdxCell('ImgOffsetX', '0', 'ImgWidth*0') + vsdxCell('ImgOffsetY', '0', 'ImgHeight*0')
    + vsdxCell('ImgWidth', wIn.toFixed(6), 'Width*1')
    + vsdxCell('ImgHeight', hIn.toFixed(6), 'Height*1')
    + vsdxCell('LayerMember', String(vsdxLayerIndex(layerName || 'TITLE')))
    + `<Section N="Geometry" IX="0">${vsdxCell('NoFill', '0')}${vsdxCell('NoLine', '0')}${vsdxCell('NoShow', '0')}${vsdxCell('NoSnap', '0')}${vsdxCell('NoQuickDrag', '0')}`
    + `<MoveTo IX="1">${vsdxCell('X', '0')}${vsdxCell('Y', '0')}</MoveTo>`
    + `<LineTo IX="2">${vsdxCell('X', wIn.toFixed(6))}${vsdxCell('Y', '0')}</LineTo>`
    + `<LineTo IX="3">${vsdxCell('X', wIn.toFixed(6))}${vsdxCell('Y', hIn.toFixed(6))}</LineTo>`
    + `<LineTo IX="4">${vsdxCell('X', '0')}${vsdxCell('Y', hIn.toFixed(6))}</LineTo>`
    + `<LineTo IX="5">${vsdxCell('X', '0')}${vsdxCell('Y', '0')}</LineTo>`
    + `</Section>`
    + `<ForeignData ForeignType="Bitmap"><Rel r:id="${rid}"/></ForeignData></Shape>`;
}

/** AYK logo as a Foreign bitmap shape anchored in the title block (rId1). */
function vsdxLogoShape(id) {
  /* engine title block: {x:1078, y:990, w:560, h:156} in sheet units */
  return vsdxImageShape(id, { x: 1078 + 560 - 26 - 34, y: 990 + 156 / 2 - 21, w: 34, h: 42 }, 'TITLE', 'rId1');
}

/** One Visio shape (2D box with geometry rows) per primitive. */
function vsdxShape(id, p) {
  const layerIx = vsdxLayerIndex(p.layer);
  const flipY = y => VSDX_SHEET_H - y;

  if (p.type === 'line') return vsdxWireShape(id, p);

  if (p.type === 'rect') {
    const cx = p.x + p.w / 2, cy = flipY(p.y + p.h / 2);
    const filled = p.fill && p.fill !== 'none';
    return `<Shape ID="${id}" Type="Shape">`
      + vsdxCell('PinX', vsdxIn(cx)) + vsdxCell('PinY', vsdxIn(cy))
      + vsdxCell('Width', vsdxIn(p.w)) + vsdxCell('Height', vsdxIn(p.h))
      + vsdxCell('LocPinX', vsdxIn(p.w / 2)) + vsdxCell('LocPinY', vsdxIn(p.h / 2))
      + vsdxCell('Angle', '0') + vsdxCell('LayerMember', String(layerIx))
      + vsdxLineCells(p)
      + vsdxCell('FillForegnd', filled ? p.fill : '#ffffff')
      + vsdxCell('FillPattern', filled ? '1' : '0')
      + `<Section N="Geometry" IX="0">${vsdxCell('NoFill', '0')}${vsdxCell('NoLine', '0')}${vsdxCell('NoShow', '0')}${vsdxCell('NoSnap', '0')}${vsdxCell('NoQuickDrag', '0')}`
      + `<MoveTo IX="1">${vsdxCell('X', '0')}${vsdxCell('Y', '0')}</MoveTo>`
      + `<LineTo IX="2">${vsdxCell('X', vsdxIn(p.w))}${vsdxCell('Y', '0')}</LineTo>`
      + `<LineTo IX="3">${vsdxCell('X', vsdxIn(p.w))}${vsdxCell('Y', vsdxIn(p.h))}</LineTo>`
      + `<LineTo IX="4">${vsdxCell('X', '0')}${vsdxCell('Y', vsdxIn(p.h))}</LineTo>`
      + `<LineTo IX="5">${vsdxCell('X', '0')}${vsdxCell('Y', '0')}</LineTo>`
      + `</Section></Shape>`;
  }

  if (p.type === 'circle') {
    const cy = flipY(p.cy);
    const r = Math.max(p.r, 0.4);
    const d = r * 2;
    return `<Shape ID="${id}" Type="Shape">`
      + vsdxCell('PinX', vsdxIn(p.cx)) + vsdxCell('PinY', vsdxIn(cy))
      + vsdxCell('Width', vsdxIn(d)) + vsdxCell('Height', vsdxIn(d))
      + vsdxCell('LocPinX', vsdxIn(r)) + vsdxCell('LocPinY', vsdxIn(r))
      + vsdxCell('Angle', '0') + vsdxCell('LayerMember', String(layerIx))
      + vsdxLineCells(p)
      + vsdxCell('FillForegnd', (p.fill && p.fill !== 'none') ? p.fill : '#ffffff')
      + vsdxCell('FillPattern', (p.fill && p.fill !== 'none') ? '1' : '0')
      + `<Section N="Geometry" IX="0">${vsdxCell('NoFill', '0')}${vsdxCell('NoLine', '0')}${vsdxCell('NoShow', '0')}${vsdxCell('NoSnap', '0')}${vsdxCell('NoQuickDrag', '0')}`
      + `<Ellipse IX="1">${vsdxCell('X', vsdxIn(r))}${vsdxCell('Y', vsdxIn(r))}`
      + `${vsdxCell('A', vsdxIn(d))}${vsdxCell('B', vsdxIn(r))}`
      + `${vsdxCell('C', vsdxIn(r))}${vsdxCell('D', vsdxIn(d))}</Ellipse>`
      + `</Section></Shape>`;
  }

  /* text: invisible box carrying a Text element */
  const tw = Math.max(sheetTextWidth(p.text, p.size), 8);
  const th = p.size * 1.45;
  let tx = p.x;
  if (p.anchor === 'middle') tx = p.x - tw / 2;
  if (p.anchor === 'end') tx = p.x - tw;
  const ty = p.y - p.size * 1.1; /* baseline -> box top approximation */
  const styleBits = p.bold ? 1 : 0;
  const sizeIn = (p.size * VSDX_UNIT_IN).toFixed(6);
  return `<Shape ID="${id}" Type="Shape">`
    + vsdxCell('PinX', vsdxIn(tx + tw / 2)) + vsdxCell('PinY', vsdxIn(VSDX_SHEET_H - ty - th / 2))
    + vsdxCell('Width', vsdxIn(tw)) + vsdxCell('Height', vsdxIn(th))
    + vsdxCell('LocPinX', vsdxIn(tw / 2)) + vsdxCell('LocPinY', vsdxIn(th / 2))
    + vsdxCell('Angle', '0') + vsdxCell('LayerMember', String(layerIx))
    + vsdxCell('LinePattern', '0') + vsdxCell('FillPattern', '0')
    + `<Section N="Character"><Row IX="0">${vsdxCell('Size', sizeIn)}${vsdxCell('Style', String(styleBits))}</Row></Section>`
    + `<Section N="Geometry" IX="0">${vsdxCell('NoFill', '1')}${vsdxCell('NoLine', '1')}${vsdxCell('NoShow', '0')}${vsdxCell('NoSnap', '1')}${vsdxCell('NoQuickDrag', '1')}`
    + `<MoveTo IX="1">${vsdxCell('X', '0')}${vsdxCell('Y', '0')}</MoveTo>`
    + `<LineTo IX="2">${vsdxCell('X', vsdxIn(tw))}${vsdxCell('Y', vsdxIn(th))}</LineTo>`
    + `</Section>`
    + `<Text>${vsdxEsc(p.text)}</Text></Shape>`;
}

/* ---------- Notes page (page 2) ---------- */

/**
 * Builds the note-page primitives: header, legend with colour
 * swatches, cable specs and the exception list from the netlist.
 * Returns { prims, nextId } — IDs continue after page 1.
 */
function vsdxNotePrims(conns, project, startId) {
  const prims = [];
  let id = startId;
  let y = 110;
  const add = prim => { prim.id = id++; prims.push(prim); };
  const text = (t, size, bold) => add({ type: 'text', layer: 'TEXT', x: 90, y, size, text: t, bold: !!bold });
  const swatch = layer => add({ type: 'line', layer, x1: 470, y1: y - 3, x2: 530, y2: y - 3, width: 2 });

  add({ type: 'text', layer: 'TITLE', x: 90, y, size: 30, text: 'NOTES', bold: true });
  add({ type: 'line', layer: 'TITLE', x1: 90, y1: y + 12, x2: 760, y2: y + 12, width: 1.4 });
  y += 62;

  const meta = (project && project.name) ? project : {};
  text(`Project: ${meta.name || '—'}    Vessel: ${meta.vessel || '—'}    Drawing No: ${meta.drawing_no || 'DWG-0000'}    Rev: ${meta.revision || 'A'}`, 15, true);
  y += 40;

  text('WIRING LEGEND', 16, true); y += 34;
  text('Power circuit (+ / − strings, SSC, JB)', 14); swatch('POWER'); y += 30;
  text('Communication circuit (S / N daisy chain)', 14); swatch('COMM'); y += 30;
  text('Auxiliary / AC circuits (ACDP, MSM) — reserved', 14); swatch('COMMGRY'); y += 46;

  const rules = (project && project.config && project.config.rules) || {};
  text('CABLE SPECIFICATION', 16, true); y += 34;
  text(`Power: ${rules.powerGauge || '—'}`, 14); y += 28;
  text(`Communication: ${rules.commGauge || '—'}`, 14); y += 28;
  text(`Cross-rack installation allowance: ${rules.crossRackAllowance || 0} mm    Power length deduction: ${rules.powerDeduction || 0} mm`, 14); y += 46;

  text('EXCEPTIONS', 16, true); y += 34;
  const exMap = new Map();
  for (const c of (conns || [])) {
    if (!c.exception) continue;
    const k = c.exception;
    if (!exMap.has(k)) exMap.set(k, { n: 0, approved: 0 });
    const e = exMap.get(k); e.n++;
    if (c.approvalRef) e.approved++;
  }
  if (!exMap.size) {
    text('None — standard in-rack wiring only.', 14);
    y += 28;
  } else {
    for (const [k, e] of exMap) {
      text(`${k} — ${e.n} cable(s)` + (e.approved ? `, approved (${e.approved} ref)` : ', APPROVAL REQUIRED'), 14);
      y += 28;
    }
  }
  const unreleased = (conns || []).filter(c => !c.harness).length;
  if (unreleased) {
    y += 16;
    text(`WARNING: ${unreleased} connection(s) have no approved harness — engineering release required.`, 15, true);
    y += 28;
  }
  text('Generated by AYK WireFlow — cable schedule and BOM in the accompanying CSV export.', 12);
  return { prims, nextId: id };
}

/** Build the full .vsdx package bytes. Returns Uint8Array. */
function vsdxExport(conns, project) {
  const layout = buildSheetLayout(project, conns);
  const prims = layout.primitives || [];

  /* canonical Visio layer section: Section N="Layer" with Name/... cells */
  const layerSection = `<Section N="Layer">` + VSDX_LAYERS.map((l, i) =>
    `<Row IX="${i}">${vsdxCell('Name', l.name)}${vsdxCell('Color', l.color)}`
    + `${vsdxCell('Status', '0')}${vsdxCell('Visible', '1')}${vsdxCell('Print', '1')}`
    + `${vsdxCell('Active', '0')}${vsdxCell('Lock', '0')}${vsdxCell('Snap', '1')}`
    + `${vsdxCell('Glue', '1')}${vsdxCell('NameUniv', l.name)}${vsdxCell('ColorTrans', '0')}</Row>`).join('')
    + `</Section>`;

  /* page 1: underlay image (bottom z-order) + layout primitives + logo */
  const u = project && project.underlay;
  let underlayB64 = null, underlayExt = 'png';
  if (u && u.kind === 'image' && typeof u.src === 'string' && u.src.startsWith('data:image/')) {
    const m = u.src.match(/^data:image\/([a-z0-9.+-]+);base64,(.*)$/s);
    if (m) {
      underlayExt = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      underlayB64 = m[2];
    }
  }
  const underlayId = prims.length + 3;
  const page1Shapes =
    (underlayB64 && u.w > 0 && u.h > 0
      ? vsdxImageShape(underlayId, { x: u.x, y: u.y, w: u.w, h: u.h }, 'RACK', 'rId2')
      : '')
    + prims.map((p, i) => vsdxShape(i + 2, p)).join('')
    + vsdxLogoShape(prims.length + 2);

  /* page 2: notes */
  const note = vsdxNotePrims(conns, project, underlayId + 1);
  const noteShapes = note.prims.map(p => vsdxShape(p.id, p)).join('');

  const pageName = 'Rack Wiring - ' + ((project && project.name) || 'Sheet 1');
  const pagesXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`
    + `<Page ID="0" NameU="Page-1" Name="${vsdxEsc(pageName)}" ViewScale="0.35" ViewCenterX="8.26771653543307" ViewCenterY="5.84645669291339">`
    + `<PageSheet>`
    + vsdxCell('PageWidth', '16.53543307086614') + vsdxCell('PageHeight', '11.69291338582677')
    + vsdxCell('ShdwOffsetX', '0.125') + vsdxCell('ShdwOffsetY', '-0.125')
    + vsdxCell('PageScale', '1', 'IN_F') + vsdxCell('DrawingScale', '1', 'IN_F')
    + vsdxCell('DrawingSizeType', '3') + vsdxCell('DrawingScaleType', '0')
    + vsdxCell('InhibitSnap', '0') + vsdxCell('UIVisibility', '0')
    + layerSection
    + `</PageSheet><Rel r:id="rId1"/></Page>`
    + `<Page ID="1" NameU="Note1" Name="Notes" ViewScale="0.35" ViewCenterX="8.26771653543307" ViewCenterY="5.84645669291339">`
    + `<PageSheet>`
    + vsdxCell('PageWidth', '16.53543307086614') + vsdxCell('PageHeight', '11.69291338582677')
    + vsdxCell('ShdwOffsetX', '0.125') + vsdxCell('ShdwOffsetY', '-0.125')
    + vsdxCell('PageScale', '1', 'IN_F') + vsdxCell('DrawingScale', '1', 'IN_F')
    + vsdxCell('DrawingSizeType', '3') + vsdxCell('DrawingScaleType', '0')
    + vsdxCell('InhibitSnap', '0') + vsdxCell('UIVisibility', '0')
    + layerSection
    + `</PageSheet><Rel r:id="rId2"/></Page>`
    + `</Pages>`;

  const pageXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`
    + `<Shapes>${page1Shapes}</Shapes></PageContents>`;

  const page2Xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`
    + `<Shapes>${noteShapes}</Shapes></PageContents>`;

  const documentXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`
    + `<DocumentSettings TopPage="0"/>`
    + `</VisioDocument>`;

  const contentTypes = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="png" ContentType="image/png"/>`
    + `<Default Extension="jpg" ContentType="image/jpeg"/>`
    + `<Default Extension="svg" ContentType="image/svg+xml"/>`
    + `<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>`
    + `<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>`
    + `<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>`
    + `<Override PartName="/visio/pages/page2.xml" ContentType="application/vnd.ms-visio.page+xml"/>`
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
    + `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
    + `</Types>`;

  const rootRels = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/extended-properties-visio" Target="docProps/app.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
    + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="visio/document.xml"/>`
    + `</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>`
    + `</Relationships>`;

  const pagesRels = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page2.xml"/>`
    + `</Relationships>`;

  /* page 1 carries the logo bitmap (rId1) and optional rack underlay (rId2) */
  const page1Rels = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`
    + (underlayB64 ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.${underlayExt}"/>` : '')
    + `</Relationships>`;

  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const coreXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${vsdxEsc('Wiring Diagram - ' + ((project && project.name) || 'Rack 1'))}</dc:title>`
    + `<dc:creator>AYK WireFlow</dc:creator>`
    + `<cp:lastModifiedBy>AYK WireFlow</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + `</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + `<Application>AYK WireFlow</Application><Company>${vsdxEsc((project && project.vessel) || 'AYK')}</Company>`
    + `<AppVersion>1.0</AppVersion></Properties>`;

  const zip = new ZipWriter();
  zip.add('[Content_Types].xml', contentTypes);
  zip.add('_rels/.rels', rootRels);
  zip.add('docProps/core.xml', coreXml);
  zip.add('docProps/app.xml', appXml);
  zip.add('visio/document.xml', documentXml);
  zip.add('visio/_rels/document.xml.rels', docRels);
  zip.add('visio/pages/pages.xml', pagesXml);
  zip.add('visio/pages/_rels/pages.xml.rels', pagesRels);
  zip.add('visio/pages/page1.xml', pageXml);
  zip.add('visio/pages/_rels/page1.xml.rels', page1Rels);
  zip.add('visio/pages/page2.xml', page2Xml);
  zip.add('visio/media/image1.png', vsdxB64ToBytes(VSDX_LOGO_B64));
  if (underlayB64) {
    const bytes = (underlayExt === 'svg')
      ? new TextEncoder().encode(atob(underlayB64))
      : vsdxB64ToBytes(underlayB64);
    zip.add(`visio/media/image2.${underlayExt}`, bytes);
  }
  return zip.build();
}
