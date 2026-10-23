/* ============================================================
 * WireFlow — VSDX (Visio) export
 *
 * Consumes the shared buildSheetLayout() primitives from
 * engine.js and packages a minimal, valid Visio 2013+ drawing
 * (.vsdx = OPC zip) fully client-side:
 *   - A3 landscape page (420 x 297 mm), same sheet as SVG/DXF
 *   - 12 drawing layers (POWER, COMM, FRAME, ...) defined on
 *     the page sheet; every shape assigned via LayerMember
 *   - plain geometry shapes (no masters) so Visio opens the
 *     file without external dependencies
 * ============================================================ */

/* Sheet geometry: engine uses 1680 x 1188 units; 1 unit = 0.25 mm. */
const VSDX_SHEET_W = 1680, VSDX_SHEET_H = 1188;
const VSDX_UNIT_IN = 0.25 / 25.4; /* units -> inches (Visio internal unit) */
const VSDX_LAYERS = [
  { name: 'FRAME',   color: '#1e3a5f' },
  { name: 'TITLE',   color: '#0f172a' },
  { name: 'LEGEND',  color: '#334155' },
  { name: 'POWER',   color: '#dc2626' },
  { name: 'SUBPWR',  color: '#ea580c' },
  { name: 'COMM',    color: '#16a34a' },
  { name: 'COMMGRY', color: '#6b7280' },
  { name: 'TEXT',    color: '#0f172a' },
  { name: 'MOD',     color: '#94a3b8' },
  { name: 'DEVICE',  color: '#64748b' },
  { name: 'SSC',     color: '#6366f1' },
  { name: 'TERM',    color: '#16a34a' },
];

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

/* ---- shape cell helpers ---- */
function vsdxCell(n, v, f) { return `<Cell N="${n}" V="${v}"${f ? ` F="${vsdxEsc(f)}"` : ''}/>`; }
function vsdxLineCells(p) {
  const w = Math.max(0.004, (p.width || 1) * 0.0055); /* inches */
  let s = vsdxCell('LineWeight', w.toFixed(6)) + vsdxCell('LineColor', '#333333');
  if (p.dash) s += vsdxCell('LinePattern', '2') + vsdxCell('LineWeight', w.toFixed(6));
  return s;
}

/** One Visio shape (2D box with geometry rows) per primitive. */
function vsdxShape(id, p) {
  const layerIx = vsdxLayerIndex(p.layer);
  const flipY = y => VSDX_SHEET_H - y;

  if (p.type === 'line') {
    const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2);
    const yT = Math.min(p.y1, p.y2), yB = Math.max(p.y1, p.y2);
    const w = Math.max(x2 - x1, 0.01), h = Math.max(yB - yT, 0.01);
    /* Visio local coords: origin at bottom-left of the bbox, Y up */
    const lx1 = (Math.min(p.x1, p.x2) === p.x1 ? 0 : w) || 0;
    const lx2 = w - lx1;
    const ly1 = (p.y1 === yB ? 0 : h);   /* bottom of bbox -> local 0 */
    const ly2 = h - ly1;
    const cx = x1 + w / 2, cy = flipY(yT + h / 2);
    const color = { POWER: '#dc2626', SUBPWR: '#ea580c', COMM: '#16a34a', COMMGRY: '#6b7280' }[p.layer] || '#333333';
    const weight = Math.max(0.005, (p.width || 1) * 0.0055);
    return `<Shape ID="${id}" Type="Shape">`
      + vsdxCell('PinX', vsdxIn(cx)) + vsdxCell('PinY', vsdxIn(cy))
      + vsdxCell('Width', vsdxIn(w)) + vsdxCell('Height', vsdxIn(h))
      + vsdxCell('LocPinX', vsdxIn(w / 2)) + vsdxCell('LocPinY', vsdxIn(h / 2))
      + vsdxCell('Angle', '0') + vsdxCell('LayerMember', String(layerIx))
      + vsdxCell('LineWeight', weight.toFixed(6)) + vsdxCell('LineColor', color)
      + (p.dash ? vsdxCell('LinePattern', '2') : '')
      + `<Section N="Geometry" IX="0">${vsdxCell('NoFill', '1')}${vsdxCell('NoLine', '0')}${vsdxCell('NoShow', '0')}${vsdxCell('NoSnap', '0')}${vsdxCell('NoQuickDrag', '0')}`
      + `<MoveTo IX="1">${vsdxCell('X', vsdxIn(lx1))}${vsdxCell('Y', vsdxIn(ly1))}</MoveTo>`
      + `<LineTo IX="2">${vsdxCell('X', vsdxIn(lx2))}${vsdxCell('Y', vsdxIn(ly2))}</LineTo>`
      + `</Section></Shape>`;
  }

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

/** Build the full .vsdx package bytes. Returns Uint8Array. */
function vsdxExport(conns, project) {
  const layout = buildSheetLayout(project, conns);
  const prims = layout.primitives || [];

  const layerSection = `<Section N="Layers">` + VSDX_LAYERS.map((l, i) =>
    `<Row IX="${i}">${vsdxCell('LayerName', l.name)}${vsdxCell('LayerVisible', '1')}`
    + `${vsdxCell('LayerPrint', '1')}${vsdxCell('LayerLock', '0')}${vsdxCell('LayerSnap', '1')}`
    + `${vsdxCell('LayerColor', l.color)}${vsdxCell('LayerColorTrans', '0')}</Row>`).join('')
    + `</Section>`;

  const shapes = prims.map((p, i) => vsdxShape(i + 2, p)).join('');

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
    + `</PageSheet><Rel r:id="rId1"/></Page></Pages>`;

  const pageXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`
    + `<Shapes>${shapes}</Shapes></PageContents>`;

  const documentXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`
    + `<DocumentSettings TopPage="0"/>`
    + `</VisioDocument>`;

  const contentTypes = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>`
    + `<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>`
    + `<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>`
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
    + `</Relationships>`;

  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const coreXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${vsdxEsc('Wiring Diagram - ' + ((project && project.name) || 'Rack 1'))}</dc:title>`
    + `<dc:creator>WireFlow Generator</dc:creator>`
    + `<cp:lastModifiedBy>WireFlow Generator</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + `</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`
    + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + `<Application>WireFlow</Application><Company>${vsdxEsc((project && project.vessel) || 'WireFlow')}</Company>`
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
  return zip.build();
}
