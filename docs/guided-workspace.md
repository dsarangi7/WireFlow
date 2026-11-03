# Guided workspace

## Picture-first wiring

Import a VSDX, PNG, JPG or SVG rack picture, then enter the number of regularly
spaced grid columns and rows and their measured centre-to-centre spacing in mm.
Click the top-left and bottom-right grid positions to align the grid, then mark
each battery module, SSC, ACDP and MSM on the picture. Declare the module count
separately for each SSC (2–48), and enter each actual SSC number (1–9999),
such as SSC7 through SSC12 for a later rack. SSC numbers must be unique within
the project. The ordered marking prompts use those numbers and require exactly
the declared number of modules for each SSC before moving to the next. Existing saved plans
with a shared per-bank count retain that count for every SSC. Empty positions remain
unmarked. Mark communication S and N and power negative and positive on one
representative module; those four measured offsets are applied to identical
modules. For each SSC, mark its communication S/N, power NEG/POS and bus B−/B+
ports, then mark the corresponding junction-box negative and positive ports.
Generate wiring to apply the existing per-SSC planner and validations.
The active port instruction stays prominent above the picture and advances one
step at a time. Cancel marking restores the previous module-port calibration.

The preview, SVG and draft PDF use the marked port centres. In accordance with
the existing engine, module negative connects to the next module positive and
module S to the next module N; SSC POS and S connect to the first module,
SSC NEG and N to the last module, and SSC B+/B− to matching junction-box
terminals. Links for SSCs without all eight marked terminal positions are omitted.
The preview joins marked endpoints by straight lines; it does not yet reproduce
the routed paths, bends, cable channels, or the original editable Visio master.

Engineers can change grid, component and port markings in WireFlow and generate
again. **Download editable draft (Visio)** embeds the rack as a picture and writes
each generated wire as an individual native Visio line, with the AYK logo in the
title block. The background picture is not an editable CAD drawing. Edits made
in Visio are not synchronized back to WireFlow. The Visio file and the preview
are draft outputs; review terminal positions, assignments and routes.

Under **Adjust a draft SSC route**, choose straight bends or a smooth curve,
then click intermediate points in order from the SSC. Smooth-curve points act
as control points and the displayed/exported line is an approximation. This
manual tool does not automatically follow rack rails, calculate bend radii, or
guarantee physical clearance. Review the generated route before use; the
picture-first export guard checks drawn power centerline crossings separately.

For a bottom module-to-module link, open **Advanced: adjust a draft route**,
choose the SSC, choose module-to-module power or communication, and enter the
first module number (the link goes to its next numbered module). Choose
**Rounded L-style bends** or **C-style curve**, then click the bend or control
points and save. The selected route applies only to that link; clearing points
restores its straight draft. These are visual approximations and remain subject
to engineering review and the power-crossing check.

Alternatively choose a **One-click shape** and apply it to the selected module
link. The last selected shape is remembered in browser storage on this device
and offered next time, including in another local project. This remembers a
shape choice only: it does not copy terminal positions, assignments or a full
rack wiring method, and does not synchronize across devices. Automatic shapes
are visual suggestions; review the route, crossings and physical clearance.
To repeat the shape across the current rack, choose a module-to-module link
and its first module number, then use **Apply to this link number in every
SSC**. Every SSC must have that next module. Routes are recalculated from each
SSC's own marked terminals; no terminal coordinates are copied. The batch is
rejected if a link is missing or if the proposed drawing has power centerlines
crossing or touching. It does not transfer an entire method between racks.
The marking tools appear alongside the rack drawing on wider screens and stack
above it on smaller screens.

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
# Picture-first power crossing check

The Build wiring screen checks distinct power wire centerlines for crossings,
touches and overlaps before enabling its Visio, SVG, A3 SVG and print buttons.
Communication-to-power overlaps are allowed. Correct affected routes before
exporting. This check is limited to that screen's current picture wiring and
its export buttons; it does not cover other tabs or establish physical cable
clearance, valid connectivity or approval.

For the supplied 111 rack only, Build wiring offers an explicit experimental
picture power-connections choice. This uses the user-confirmed module and SSC
endpoints in the picture. Other racks must use their reviewed rules. The shared
netlist, validations, cable schedule and engineering engine remain unchanged and
may disagree with this picture. The Build wiring Visio and combined PDF paths,
and the guided export screen, are unavailable for this experimental choice;
other advanced exports are not covered by this restriction and must not be used
to approve it. The option does not automatically recognize rack components or
provide approved physical routing.
