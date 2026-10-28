# Visio import — how AYK WireFlow reads a real .vsdx

The Diagram tab can open the engineer's own Visio file and draw the actual
pages in the browser — the frame, the title block, the Note page and the
AutoCAD rack that Visio stores inside the file. Nothing is uploaded: the
whole import runs client-side.

## What is inside a .vsdx

A `.vsdx` is an OPC package (a zip):

| part | role |
|---|---|
| `visio/pages/pages.xml` | page list (ID, name, page size, **layer table**) |
| `visio/pages/pageN.xml` | the shapes of one page (geometry, text, cells) |
| `visio/masters/masterN.xml` | master shapes; page shapes reference them by `Master='ID'` |
| `visio/media/*` | embedded pictures (BMP logo, **EMF** presentation of OLE objects) |
| `visio/embeddings/oleObjectN.bin` | the original embedded document (the AutoCAD DWG) |

## The pipeline (js/vsdx-import.js + js/emf.js)

1. **Zip read** — EOCD scan → central directory → entries. Stored entries are
   sliced; deflated entries go through `DecompressionStream('deflate-raw')`
   (Chrome/Edge 90+). No dependency, no server.
2. **XML** — a small dependency-free tree parser (`vsdxXml`) reads cells
   (`N`/`V`), sections (Geometry/Character/TextXForm/Layer) and relationships.
3. **Shapes → SVG**
   - transform: `translate(PinX,PinY) rotate(Angle) scale(FlipX,FlipY) translate(-LocPinX,-LocPinY)`
     with LocPin defaulting to half the size;
   - geometry rows: MoveTo/LineTo/RelMoveTo/RelLineTo/PolylineTo (including
     `POLYLINE(x,y,…)` formulas scaled by Width/Height), Ellipse, arcs
     approximated by their end point;
   - **masters**: children are stored in master design units, so they are
     wrapped in `scale(instanceWidth/masterWidth, instanceHeight/masterHeight)`
     inside the instance transform (verified: an inherited LocPin equals the
     master LocPin times exactly this ratio);
   - **text**: wrapped to the text block width, un-mirrored with a local
     `scale(1 -1)` (the page group flips y because Visio is y-up);
   - **layers**: `LayerMember` + the page's Layer table; the UI can toggle them.
4. **Foreign data**
   - `ForeignType='Bitmap'` → data URL straight into the SVG;
   - OLE object (the CAD rack) → its presentation image is a **vector EMF**
     (in our template: 8.4 MB, 293 340 records). `js/emf.js` parses the metafile
     records (poly-polygons, lines, pens, brushes, world/window/viewport
     transforms, DC save/restore, text), batches them per style and draws them
     into a canvas, which is placed into the SVG as a PNG. Aspect check: EMF
     bounds 1155×428 = 2.699 vs the frame's 13.925×5.159 in = 2.699.

## Verified against 111.vsdx (the AYK template)

- 2 pages (Page-1 18×12.75 in, Note), 4 layers (图框 / 细实线层 / 0 / CAD Drawing);
- page 1: 161 shapes, 79 text labels, 2 embedded pictures (CAD rack EMF + logo);
- full page renders in ~130 ms in Node; the tolerance block, revision table and
  notes wrap correctly.

## Known approximations

- ArcTo/EllipticalArcTo/NURBS segments are drawn to their end point (no true
  arc fitting) — the house template has none on the rack pages;
- theme-referenced colours fall back to black; OLE objects without a
  renderable preview show a placeholder box;
- the CAD picture renders at up to ~2400 px wide (configurable via `emfPx`).

## Orientation (fixed 2026-10-28)

The page group flips Y (Visio is Y-up, SVG is Y-down). Native shapes and text
are un-flipped individually; an embedded bitmap `<image>` would come out
vertically mirrored (the rack picture appeared upside down while the page
text looked fine). The renderer now pre-flips every foreign image inside its
shape (`translate(0 H) scale(1 -1)`), skipped when the shape itself carries
FlipY. The picture used as the wiring base is the raw EMF canvas render —
same orientation as the fixed page view. If a source picture ever arrives
upside down anyway, the Numbering tab's wiring card has a
"Rotate base picture 180%" button that stores the turned picture as the base.
