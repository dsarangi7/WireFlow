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
