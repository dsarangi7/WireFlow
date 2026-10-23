# WireFlow — Wiring Diagram Automation for Marine Battery Systems

WireFlow turns a marine battery rack configuration into complete power & communication
wiring diagrams, cable schedules and BOMs — governed by approved engineering rules and
exported as native **Visio (.vsdx)**, **AutoCAD DXF/.scr**, **SVG** and **CSV**.

Built as a SaaS app: landing page, per-user accounts (email OTP), and a deterministic
rule engine implementing the Wiring Diagram Tool Engineering Rules (R01–R12, V01–V12).

## Features

- **Rule-driven netlists** — normal string power sequence (SSC+ → M1+ … M24− → SSC−)
  and communication daisy-chain (S/N) generated from the approved connection templates
- **Golden-sheet drawings** — A3 engineering sheet with frame, zone ticks, title block,
  legend, notes, FOR REVIEW stamp; one shared layout core feeds SVG, DXF, SCR and VSDX
- **Validation gate** — 12 mandatory checks (polarity, chain continuity, harness
  compatibility, quantities, exception approvals) that block release
- **Cable length model** — cross-rack segmented lengths (source + over-top span +
  destination + allowance), power deduction and rounding rules
- **Export**: `.vsdx` (editable Visio, 12 layers), `.dxf` (R12, opens in AutoCAD),
  `.scr` (AutoCAD script), CSV cable schedule/BOM, and a machine-readable
  **JSON layout spec** for downstream automation tools
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
js/vsdx.js          Visio .vsdx generator (OPC package, 12 drawing layers)
js/aps.js           Autodesk APS client (token, OSS upload, translate, viewer)
js/app.js           Router, landing page, auth (email OTP), dashboard, workspace UI
tests/drawing.test.js  188-assertion regression suite (node tests/drawing.test.js)
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
# PASSED: 169  FAILED: 0
```

Covers: netlist/validation regression, release-gate matrix, sheet bounds at extreme
configurations, SVG well-formedness and text clipping, DXF R12 structure (validated with
ezdxf), CAD text ASCII-safety (cp1252 boundary), and VSDX package integrity (CRC32 of
every entry, central-directory geometry).

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
