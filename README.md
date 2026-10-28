# AYK WireFlow — Wiring Diagram Automation for Marine Battery Systems

AYK WireFlow turns a marine battery rack configuration into complete power & communication
wiring diagrams, cable schedules and BOMs — governed by approved engineering rules and
exported as native **Visio (.vsdx)**, **AutoCAD DXF/.scr**, **SVG** and **CSV**.

Built as a SaaS app: landing page, per-user accounts (email OTP), and a deterministic
rule engine implementing the Wiring Diagram Tool Engineering Rules (R01–R12, V01–V12).

## Features

- **Physical module numbering** — M1…MN is derived from the rack itself: the chain starts
  and ends next to the SSC and skips the ACDP / MSM / junction-box slots. Automatic mode
  scores serpentine, straight-raster and optimised (nearest-neighbour + 2-opt) paths against
  the approved harness catalogue and lists the cheapest options; custom mode lets the
  engineer click the order straight onto the imported rack drawing
- **Rule-driven netlists** — normal string power sequence (SSC+ → M1+ … M24− → SSC−)
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
- **Cloud backend** — WorkBuddy Cloud Service: end-user auth (email OTP), per-user data
  isolation via RLS, file storage for DWG references

## Project structure

```
index.html          SPA entry (landing, auth, dashboard, project workspace)
styles.css          Full application styling
js/config.js        Cloud service public config (endpoint + publishable key)
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
tests/drawing.test.js  326-assertion regression suite (node tests/drawing.test.js)
```

## Running locally

Static site — serve the folder:

```bash
python -m http.server 8080
# open http://localhost:8080
```

The cloud backend enforces an exact Origin match, so sign-in/data work when the app is
served from its registered domain; locally you can still explore the landing page and the
deterministic engine outputs (netlist → validation → exports all run client-side).

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

- No secrets in the repo: the publishable key is a public, origin-locked identifier;
  APS client secrets are entered at runtime per user and stored in that user's private
  database row — never committed.
- All user data is isolated server-side with row-level security (`owner_id = auth.uid()`).
- CAD text outputs are sanitised to ASCII at the writer boundary (DXF R12/.scr are cp1252).

## Engineering rules encoded

| Rule | Encoding |
|------|----------|
| R02 / R03 | Adjacent power Mx− → Mx+1+ · communication Mx S → Mx+1 N |
| R04–R06 | SSC endpoints: String+ → M1+, String− → M24−, S → M1 N, N → M24 S |
| R07 / R08 | Standard jumpers 100 mm AB power · 450 mm communication |
| R09 / R10 | Longer local jumpers 445 mm power · 650 mm communication |
| R11 | Two bus power cables per SSC to the junction box |
| R12 | 130 mm power deduction (configurable per cable family) |
| V01–V12 | Mandatory validation gate — release blocked on any failure |
| Numbering | A hop between two module slots that are not physical neighbours takes R09/R10 (445/650 mm) instead of R07/R08 (100/450 mm); hops are derived from the saved rack numbering |
