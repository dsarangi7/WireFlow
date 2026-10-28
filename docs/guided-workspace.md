# Guided workspace

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

The home-screen import button runs the same `importRackDrawing()` upload and
save path used by Configuration. VSDX files continue through
`underlayFromVsdxFile()`; that function selects the largest foreign picture and
uses the blob carried by the render record. It does not fetch the foreign href.

After a VSDX import, the UI reports page count, embedded-picture dimensions,
layer count and whether the largest picture became the wiring base. Parse or
picture-selection failures stay on the workspace as a user-facing error card,
while technical details are logged to the browser console. Successful imports
open Numbering automatically so calibration is the next visible task.

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
