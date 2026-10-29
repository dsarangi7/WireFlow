# Guided workspace

## Picture-first wiring

Import a VSDX, PNG, JPG or SVG rack picture, then enter the number of regularly
spaced grid columns and rows and their measured centre-to-centre spacing in mm.
Click the top-left and bottom-right grid positions to align the grid, then mark
each battery module, SSC, ACDP and MSM on the picture. Empty positions remain
unmarked. Mark communication S and N and power negative and positive on one
representative module; those four measured offsets are applied to identical
modules. For each SSC, mark its communication S/N, power NEG/POS and bus B−/B+
ports, then mark the corresponding junction-box negative and positive ports.
Generate wiring to apply the existing per-SSC planner and validations.

The preview, SVG and draft PDF use the marked port centres. In accordance with
the existing engine, module negative connects to the next module positive and
module S to the next module N; SSC POS and S connect to the first module,
SSC NEG and N to the last module, and SSC B+/B− to matching junction-box
terminals. Links for SSCs without all eight marked terminal positions are omitted.
The preview joins marked endpoints by straight lines; it does not yet reproduce
the routed paths, bends, cable channels, or an editable Visio master drawing.

The grid assumes straight, evenly spaced rows and columns (maximum 12 by 24).
The automatic assignment uses the nearest SSC subject to the existing configured
string capacity; it cannot determine the intended electrical assignment from an
image. The engineer must check component positions, assignments, harness lengths,
and validation results. SVG and PDF outputs are labelled as draft because the
physical routes and any unmarked terminals still require engineering review. Imported DXF
drawings remain available to the expert tools, but the picture-marking workflow
requires a raster or SVG image or an embedded Visio picture.

The print/PDF page places the AYK logo and project identification in a compact
title block at the lower right. This is not yet the full AYK house Visio template.

The project workspace opens on a five-step path instead of dropping an engineer
directly into the expert tabs:

1. Import rack
2. Calibrate
3. Number & chains
4. Wire & validate
5. Export PDF

`FLOW_STEPS` in `js/app.js` is the single source for labels and destinations.
The first four steps route to the existing Configuration and Numbering tools;
the final step opens the export screen. Every original tab remains available in
the **Advanced** section.

## Progress state

`flowStepCompletion(project)` is a pure derivation from saved project data:

- Import is complete when a rack underlay exists.
- Calibrate is complete when the saved numbering calibration is valid.
- Number & chains is complete after a variable SSC layout has been applied and
  its chain counts match the saved SSC records.
- Wire & validate is complete when those applied chains have a saved numbering
  order that can be rendered over the calibrated rack.
- Export is complete after the PDF action records `config.flow.exportedAt`.

The flow does not modify the deterministic engine. The PDF action uses the
browser print dialog on the existing SVG drawing; Visio, DXF, AutoCAD script and
cable schedule downloads continue to use their established exporters.

## Guided rack import

The home-screen import button runs the same `importRackDrawing()` local-save
path used by Configuration. VSDX files continue through
`underlayFromVsdxFile()`; that function selects the largest foreign picture and
uses the blob carried by the render record. It does not fetch the foreign href.

After a VSDX import, the UI reports page count, embedded-picture dimensions,
layer count and whether the largest picture became the wiring base. Parse or
picture-selection failures stay on the workspace as a user-facing error card,
while technical details are logged to the browser console. Successful imports
open Numbering automatically so calibration is the next visible task.

The same in-memory picture blob is written directly to IndexedDB; the app never
fetches the foreign picture href. Projects and rack pictures therefore work on
localhost and GitHub Pages without an account or cloud-storage origin allowlist.

## Wire, validate and deliver

Step 4 summarizes the saved module count, per-SSC chain cable totals and both
validation families: the engine release checks and variable-layout L01–L06
checks. **Open wiring view** returns to the established front-view card in
Numbering; the guided summary does not implement a second wiring editor.

Step 5 builds three ordered print pages: generated wiring sheet, calibrated
rack front view and compact cable schedule/BOM. The pages live in a hidden
container until `window.print()` and use A3 landscape print CSS with exact
colors and page breaks. Browser Save as PDF is therefore the PDF generator;
there are no extra libraries. DXF, SCR, VSDX and CSV remain under **Other
formats**. Printing reveals **Mark project delivered**, which saves
`config.flow.deliveredAt` and completes the final step.

## Guided-flow presentation

The guided screens use the shared 4/8/12/16/24 spacing tokens, neutral
navigation states and semantic success/warning/danger colors. Orange is
reserved for primary action buttons. Keyboard users receive consistent
`focus-visible` outlines, and each incomplete stage has a one-line next-action
message covering missing import, calibration, chains, failed validations and
delivery. Step transitions are disabled when `prefers-reduced-motion` is set,
and the summary layout tightens at 1280px before switching to the mobile stack.
