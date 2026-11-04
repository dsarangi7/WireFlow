# AYK WireFlow — Wiring Diagram Automation for Marine Battery Systems

AYK WireFlow turns a marine battery rack configuration into complete power & communication
wiring diagrams, cable schedules and BOMs — governed by approved engineering rules and
exported as native **Visio (.vsdx)**, **AutoCAD DXF/.scr**, **SVG** and **CSV**.

Built as an internal AYK Energy browser tool with device-local project storage and a
deterministic rule engine implementing the Wiring Diagram Tool Engineering Rules
(R01–R12, V01–V12). No account, login or payment flow is required.

Live site: https://dsarangi7.github.io/WireFlow/

- **AYK module catalogue:** Choose one of the sixteen supplied module types in
  rack configuration to load and save its fixed millimetre dimensions. See
  [module catalogue](docs/module-catalogue.md).

- **General automatic rail routing:** SSC and junction-box connections use
  measured terminals and inferred module boundaries to choose rounded rack-side
  routes. See [routing behavior and limits](docs/automatic-rail-routing.md).

- **SVG-first entry (early version):** Import an SVG without entering project
  metadata, then continue in the existing wiring workspace. See
  [SVG-first import](docs/svg-first-import.md) for supported content and limits.

The picture-first workspace lets engineers align a regular rack grid, mark
battery modules and SSC/ACDP/MSM positions on the imported picture, declare a
separate number and module count for each SSC, and
mark the actual module, SSC and junction-box ports to generate a wiring preview
using the existing endpoint rules. It reports rule failures and exports a draft
SVG, print/PDF, or Visio file with individually editable wire shapes and an AYK
logo in the title block. Draft SVG exports include a rack-only drawing and an
A3 sheet with a title block. Cable routes are draft previews; manually supplied
route points do not constitute approved physical routing. See
[the guided workspace documentation](docs/guided-workspace.md) for the workflow
and the limits of the grid and draft cable routing.
SSC draft routes can use engineer-selected straight bends or approximate smooth
curves; neither mode automatically establishes a safe physical cable route.
The advanced route editor also offers rounded L and C styles for individual
module-to-module links, plus one-click shape suggestions and a device-local
last-used shape. A shape may also be applied to the same numbered link in every
SSC of a rack, subject to terminal and power-crossing checks. These suggestions
can be remembered on the device as repeated module-link shapes for another
rack; they do not reuse terminals or complete rack wiring plans.

In the picture-first screen, its draft export buttons are blocked when power
wire centerlines cross or touch; communication/power overlaps are allowed.
Exports also require complete SSC terminal positions, passing supported checks,
and agreement between the picture convention and the netlist. The user-confirmed
series sequence now applies to both; regenerate older sessions and review routes.
This is a 2D check, not a physical clearance or engineering approval check.
See [the confirmed power sequence](docs/power-sequence.md) for endpoint rules
and saved-session migration limits.

SVG rack drawings remain vector images in the marking canvas. Use the mouse
wheel or zoom buttons to zoom, the middle mouse button to pan, and left-click
to mark component and port positions. See [ordered marking](docs/ordered-marking.md).

## Features

- **Visio desktop prototype** — early 64-bit COM add-in source for marking
  selected terminal shapes, saving marks for the same drawing/page and drawing
  editable draft wires with a connection preview, optional manually marked route waypoints and a 2D
  warning for proposed crossings. It is
  not installed or approved for release; see
  [prototype status](docs/visio-desktop-prototype.md).
- **Ordered bank marking** — declare MSM/SSC/module/junction-box/ACDP counts per
  bank, follow one large click command at a time, and preserve SSC ownership and
  M1…MN click order. Progress is saved locally; missing counts block generation.
  ACDPs are marked last as labels only. See [ordered marking](docs/ordered-marking.md).
- **Physical module numbering** — M1…MN is derived from the rack itself: the chain starts
  and ends next to the SSC and skips the ACDP / MSM / junction-box slots. Automatic mode
  scores serpentine, straight-raster and optimised (nearest-neighbour + 2-opt) paths against
  the approved harness catalogue and lists the cheapest options; custom mode lets the
  engineer click the order straight onto the imported rack drawing
- **Rule-driven netlists** — confirmed series power sequence (SSC+ → highest module+ … M1− → SSC−)
  and communication daisy-chain (S/N) generated from the approved connection templates
- **Golden-sheet drawings** — A3 engineering sheet with frame, zone ticks, title block,
  legend, notes, FOR REVIEW stamp; one shared layout core feeds SVG, DXF, SCR and VSDX
- **Validation gate** — 12 mandatory checks (polarity, chain continuity, harness
  compatibility, quantities, exception approvals) that block release
- **Cable length model** — cross-rack segmented lengths (source + over-top span +
  destination + allowance), power deduction and rounding rules
- **Export**: `.vsdx` (editable Visio: native 1D wires, AYK logo in the title block,
  12 layers, auto-built Notes page), `.dxf` (R12, opens in AutoCAD),
  `.scr` (AutoCAD script), CSV cable schedule/BOM, and a machine-readable
  **JSON layout spec** for downstream automation tools
- **Front-view wiring on the real rack** — the embedded AutoCAD rack from the
  Visio file becomes the wiring base: two clicks calibrate the module grid on
  the picture, the engineer numbers modules and drops SSC/ACDP/MSM anchors
  directly on it, and the red power hops + green comm zig-zag (with rail
  risers to the SSC) are drawn over the rack with live length totals
- **Visio import (read the real drawing back)** — open any `.vsdx` in the Diagram tab and
  the actual Visio page is rebuilt in the browser: frame, layers, masters, text blocks and
  the embedded AutoCAD rack (rendered from its vector EMF preview by a built-in EMF
  renderer). Page tabs, layer toggles and zoom; optional save to the project
- **Cable specification** — every harness carries a cable spec/gauge (e.g.
  `63A/125V, 150 mm²` power, `Cat5, 25 AWG` communication), configurable per
  project and flowing through the netlist, schedule, CSV, VSDX and JSON spec
- **Autodesk Platform Services (optional)** — upload DWG references, translate via
  Model Derivative, inspect in the embedded APS Viewer (bring your own APS app credentials)
- **Local project storage** — projects, rack pictures and saved Visio files are kept in
  the browser's IndexedDB on the engineer's device

## Project structure

```
index.html          SPA entry (landing, auth, dashboard, project workspace)
styles.css          Full application styling
js/config.js        Legacy WorkBuddy public config (not loaded by the internal edition)
js/engine.js        Deterministic wiring engine + sheet layout + SVG/DXF/SCR renderers
js/zip.js           Minimal store-method ZIP writer (for .vsdx packaging)
js/vsdx.js          Visio .vsdx generator (OPC package, 14 layers, 1D wires, logo, underlay, Notes page)
js/rack.js          Rack underlay import: DXF parser + sheet fitting
js/emf.js           Minimal EMF (Enhanced Metafile) vector renderer for embedded CAD pictures
js/vsdx-import.js   .vsdx reader: zip + XML/shape parser, page-to-SVG rebuild (import, not export)
js/frontview.js     Wiring on the real rack picture: calibration, terminal anchors, hop geometry
js/numbering.js     Physical module numbering: rack slot model, plan scoring, custom order
js/sscplan.js       VARIABLE LAYOUT planner: one shortest-cable chain per SSC, per-chain validation
visio-bridge/visio_bridge.ps1  Visio COM bridge: draws spec wires into the house template (Windows + Visio)
visio-bridge/RUN-BRIDGE.cmd    One-click demo runner for the Visio bridge
docs/visio-rack-wiring-skill.md  Visio production workflow learned from the AYK template
docs/module-numbering.md  How the physical numbering is chosen (auto + custom) and what it costs
docs/vsdx-import.md  How the Visio import works (zip read, masters, EMF rack picture)
docs/front-view-wiring.md  Wiring on the real rack: calibration model, geometry, limits
docs/variable-ssc-layout.md  Variable rack layout: per-SSC chains, assignment, general diagram
docs/guided-workspace.md  Guided post-login workspace, progress derivation and Advanced access
js/aps.js           Autodesk APS client (token, OSS upload, translate, viewer)
js/app.js           Router, landing page, auth (email OTP), dashboard, workspace UI
tests/drawing.test.js  350-assertion regression suite (node tests/drawing.test.js)
```

## Running locally

Static site — serve the folder:

```bash
python -m http.server 8080
# open http://localhost:8080
```

The internal edition opens the Projects workspace immediately. Project data belongs to
the browser profile and host origin in which it was created; clearing site data removes
those local projects, so completed drawing packages should also be exported to files.

## Tests

```bash
node tests/drawing.test.js
# PASSED: 285  FAILED: 0
```

Covers: netlist/validation regression, release-gate matrix, sheet bounds at extreme
configurations, SVG well-formedness and text clipping, DXF R12 structure (validated with
ezdxf), CAD text ASCII-safety (cp1252 boundary), VSDX package integrity (CRC32 of every
entry, central-directory geometry), the physical numbering (rack slot model, plan
scoring, custom click order, numbering → netlist → JSON spec → drawn numbers), and the
Visio import (synthetic .vsdx package round-trip, EMF record parsing, layer filtering),
and the front-view wiring (calibration, terminal anchors, hop geometry, px→sheet mapping).

## Security notes

- The internal edition makes no authentication or project-storage requests; data stays
  in IndexedDB in the current browser profile.
- CAD text outputs are sanitised to ASCII at the writer boundary (DXF R12/.scr are cp1252).

## Engineering rules encoded

| Rule | Encoding |
|------|----------|
| R02 / R03 | Adjacent power Mx− → Mx+1+ · communication Mx S → Mx+1 N |
| R04–R06 | SSC power: String+ → highest module+, M1− → String−. Communication: S → M1 N, N → highest module S |
| R07 / R08 | Standard jumpers 100 mm AB power · 450 mm communication |
| R09 / R10 | Longer local jumpers 445 mm power · 650 mm communication |
| R11 | Two bus power cables per SSC to the junction box |
| R12 | 130 mm power deduction (configurable per cable family) |
| V01–V12 | Mandatory validation gate — release blocked on any failure |
| Numbering | A hop between two module slots that are not physical neighbours takes R09/R10 (445/650 mm) instead of R07/R08 (100/450 mm); hops are derived from the saved rack numbering |
