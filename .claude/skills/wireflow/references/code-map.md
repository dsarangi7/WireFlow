# WireFlow code map

## Files

| File | What it does |
|---|---|
| `index.html` | Static product page (SEO, `#landing`) + `#app` mount + scripts |
| `site.css`, `styles.css` | Product page / app styles |
| `js/cad.js` | DXF reader and part recognition (pure) |
| `js/cadwire.js` | Wiring planner (pure, needs cad.js) |
| `js/pdf.js` | Minimal vector PDF writer, mm, Y up, Arial, one JPEG (pure) |
| `js/sheet.js` | DWG2396 A3 sheet layout, drawn as SVG on screen and as PDF (pure) |
| `js/numlib.js` | Numbering library on the device (pure + localStorage) |
| `js/app.js` | All UI: storage, router, projects, rack view, sheet editor |
| `js/tutorial.js` | Product page scroll tutorial (self-contained SVG) |
| `assets/examples/rack-111.dxf.gz`, `rack-111-parts.json` | `#/example` rack (built by `tools/make-example.js`) |
| `assets/rack-111-animated.svg` | Hero animation (`tools/make-hero-animation.py` from `rack-111-recognised.svg`) |
| `tools/dwg-to-dxf.ps1` | Converts DWG with the engineer's AutoCAD |
| `tests/*.test.js`, `tests/fixtures/rack-1111.js` | Node tests |
| `docs/site-and-seo.md` | Product page and SEO notes |

## cad.js
`cadParseDxf(text)` → model (header, layers, blocks, entities; readable error for DWG/binary).
`cadFlatten(model)` → polylines, exact circles, texts in WCS (arcs, bulges, splines via de Boor).
`cadToSvg`, `cadFeatures`/`cadFeatureIndex`, `cadTeachSignature` (box + terminals → signature),
`cadFindMatches`, `cadRefineSignature`, `cadRecognise` (all copies of all signatures, overlap
ranking), `cadProposeNumbers` (SSC order from the MSM), `cadSummary`.

## cadwire.js
- Scale: `CADW_K`, `cadwU`. Geometry: `cadwLen`, `cadwClean`, `cadwSegCross`, `cadwCrossings`,
  `cadwPowerCrossings`.
- Rack: `cadwColumns` (columns, trays CL/CR, rails, bodies, `ports`), `cadwInside`/`cadwKeepInside`.
- Ports: `cadwPorts`, `cadwPortHits` (x-sorted + binary search), `cadwPortFree`.
- Routes: `cadwTrayRoutes`, `cadwRiserRoute`, `cadwDirectRoute`, `cadwCurve`, `cadwJump`/`cadwJumpRoutes`.
- JBs: `cadJbNames`, `cadAutoJb`.
- Plan: `cadWirePlan(components, sscs, opts)` → strings, cables, crossings, portHits, warnings.
  Inside: `cadwPlanString` (candidates, second look, shortcuts), `cadwWays` (up to 8 alternative
  routes per power cable, shown on the sheet), `cadwOrders`/`cadwSuggestOrders` (internal/test only).
- `cadWireGuide` drives the numbering hints. `cadWireSave(plan)` → what is stored in `cad.wiring`.

## sheet.js
`sheetDefaults`, `sheetSettings(saved)` → `{fields, plugs, edits{cables, labels, kinds, ground, plugLabel}}`,
`sheetUnit(components)` (median module width / 400.45), `sheetPlace` (drawing → sheet mm,
returns `{scale,u,k,X,Y,pt,plugTop}`), `sheetPlugLeads`, `sheetGroundPoint`, `sheetFrame`,
`sheetDraw(model, target)`, `sheetPdf(model)`.

## numlib.js
`numlibLayout(components)` (grid key), `numlibEntry`, `numlibAdd` (dedupe, one per project+layout,
max 60), `numlibMatches` (fewest crossings, newest), `numlibApply` (checks SSC counts),
storage key `wireflow.numberings`.

## app.js (main sections)
- IndexedDB `ayk-wireflow`: stores `projects` (one record per rack), `underlays` (the DXF text),
  `files`. Helpers `localProjects/localProject/localPutProject/localAddProject/localPutUnderlay/localGetUnderlay`.
- Router `route()`: `#/app`, `#/folder/<id|none>`, `#/cad/<id>`, `#/sheet/<id>`, `#/example`.
- Projects: `FOLDERS_KEY = 'wireflow.folders'` `[{id, number, name, created}]`, `rackDialog`,
  `folderDialog`, `renderDashboard(folderId)`, DXF import `openStudioCad`.
- Rack view `renderCadPage(id)`: part library (`wireflow-cad-part-library-v1`), teaching, SSC/ACDP/MSM
  confirmation, wiring card (pair, tray, jbMap, numbering by clicks, library offers), `cadViewer`.
- Sheet `renderSheetPage(id)`: sheet SVG + rack canvas (Path2D, redrawn on zoom), crossings/port
  rings and list, drag/pull editing (`pullSetup`), shape/route popup (`openShape`), PDF download.

## Saved rack record
```
{ id, name, folder, underlay_kind: 'cad', cad_file, created_at, updated_at, example?,
  config: { cad: {
    signatures, labels, components[{kind, x0,y0,x1,y1, terminals[{role,x,y}], label, labelConfirmed}],
    manual, excluded, learnedFrom,
    wiring: { pair, tray, jbMap, draft, orders, plan, strings, cables[{id, kind, pts, ways}],
              crossings, portHits, warnings, outline, key },
    sheet: { fields, plugs, edits } } } }
```
