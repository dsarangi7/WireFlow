# AGENTS.md — AYK WireFlow handover (for Codex / any coding agent)

Hello. This file is the complete context transfer for the AYK WireFlow project.
Read it fully before making any change. Everything below was learned the hard
way — respect it and you will not break things.

## 1. What this project is

AYK WireFlow is a SaaS web app that automates battery-rack wiring diagrams for
AYK Energy. The engineer imports the real rack drawing (a Visio `.vsdx` that
embeds an AutoCAD rack picture), calibrates it, numbers the battery modules so
that every cable is the shortest buildable harness, and the app generates:

- the netlist (power + comm chains, closed loops per SSC),
- validations against company rules (R01–R12) and layout checks (L01–L06, V01–V05),
- an A3-style wiring sheet, DXF/SCR export, Visio `.vsdx` export,
- a cable schedule / BOM,
- a front-view mode that draws the actual wiring over the imported rack picture.

Live demo (deployed via the WorkBuddy publisher):
`https://wireflow-saas.app.workbuddy.host/?sharecode=KMT72ILAK5`
GitHub: `https://github.com/dsarangi7/WireFlow` (branch `main`)

## 2. Hard facts you must know before coding

- **Pure front-end app.** No build step, no bundler, no npm. Plain ES5-ish
  JavaScript loaded by `index.html` in a fixed order. To add a module, add the
  `<script>` tag to `index.html` and keep the load order (dependencies below).
- **No framework.** UI is string-template HTML inside `js/app.js` tab
  renderers. Each tab is a function `tabX(el, project, ctx)` that sets
  `el.innerHTML` and wires event handlers with `querySelector(...).onclick`.
- **Global-namespace modules.** Each `js/*.js` file defines plain top-level
  functions/globals (no exports). The Node test harness evaluates several files
  together with `new Function(...)` to emulate the browser script scope.
- **Deterministic engine.** All geometry/arithmetic must stay deterministic —
  the same project config must always produce byte-identical exports. No
  Math.random in engine code paths.
- **Coordinate systems (the #1 source of bugs):**
  - Visio pages are Y-UP; SVG is Y-DOWN. The page render wraps everything in
    `translate(0 h) scale(96 -96)`. Every text and every embedded `<image>`
    must be individually un-flipped (see `vsdxTextOut` and the foreign-image
    pre-flip `translate(0 H) scale(1 -1)` in `vsdx-import.js`).
  - EMF records are Y-DOWN (top-down device space); `emf.js` draws them
    directly to canvas with no flip.
  - Front-view picture pixels are Y-DOWN; `frontview.js` works in that space.
  - GDI COLORREF is 0x00BBGGRR — red is the LOW byte (`emfColor`).
  - EMF record types: 85–92 are the 16-bit poly family (POLYBEZIER16…POLYDRAW16);
    the blit family is 76–81 (BITBLT=76, STRETCHBLT=77, MASKBLT=78,
    STRETCHDIBITS=81). Do not "fix" the enum back to blits at 86/87.

## 3. File map (js/ — ~6,400 lines total)

| File | Role | Depends on |
|---|---|---|
| `config.js` | WorkBuddy cloud SDK init, auth, storage helpers | cloud SDK |
| `zip.js` | Minimal ZIP reader (stored + deflate-raw) and ZipWriter | — |
| `engine.js` | Core: `DEFAULT_RULES` (R01–R12), `generateNetlist`, `runValidations` (V01–V05), `buildSheetLayout` (A3 sheet primitives + layers), `stringModuleCounts`, `numberingOffsets`, harness catalogue | — |
| `rack.js` | Rack slot model: `rackEnsure`, `rackModuleCells`, `rackDeviceCells`, `slotCell`, `rackSpan` | — |
| `numbering.js` | Physical module numbering: plan enumeration (serpentine/raster × corners + TSP + 2-opt), `numberMetrics`, `resolveNumbering`, `numberingHopInfo`, sheet preview SVG | engine, rack |
| `sscplan.js` | VARIABLE layout planner: one shortest-cable chain per SSC. `layoutEnsure` (SSCs from rack device slots), `layoutAssign` (nearest/column/row-band/hand, capacity-constrained), `layoutGroups` (per-SSC optimisation), `layoutValidate` (L01–L06), `layoutApply` (chains → strings + per-chain counts) | engine, rack, numbering |
| `frontview.js` | Front view on the real rack picture: `fvCalib` (2-click grid calibration), `fvTerminals`, `fvWiring` (power hops + comm zig-zag + riser rails per SSC), `fvSvg`, `fvSummary`, `fvPxToSheet` | — |
| `emf.js` | EMF metafile renderer: parses ~293k records, batches into Path2D fills/strokes, renders to canvas → PNG for embedded CAD pictures | — |
| `vsdx-import.js` | OPC/zip reader + Visio 2012 XML: `vsdxOpen` → `doc.renderPage(i, {layersOn})` → `{svg, stats, foreigns, page}`. Handles masters (with instance-cell merge — see bug list), layers, text wrapping/un-flip, foreign images (EMF→PNG, blob carried on record), `vsdxLayerLabel` (Chinese→English layer names) | zip, emf |
| `vsdx.js` | VSDX **export** of the generated sheet (shares engine globals) | engine, zip |
| `aps.js` | Autodesk APS (DWG translate/view) — blocked by account country, DXF/PNG/SVG only | — |
| `app.js` | All UI: login, project pages, tabs (Configuration, Numbering, Netlist, Exceptions, Validation, Schedule & BOM, Diagram, Drawings), Visio viewer, front-view card, variable-layout cards | everything |

`index.html` script order (keep it): config → engine → rack → numbering →
frontview → zip → emf → vsdx-import → aps → app.

## 4. Commands

```bash
node tests/drawing.test.js      # the regression suite — MUST pass before any commit (314 assertions)
node tests-manual/fv-smoke.js   # stub-DOM UI smoke test for the Numbering tab (9 checks)
node --check js/<file>.js       # syntax check any file you touched
git push origin main            # GitHub; corporate proxy occasionally 502s — just retry
```

There is no linter, no bundler, no dev server needed — open `index.html` or
serve the folder statically. Test suite runs on plain Node (built-in stubs for
Path2D/canvas are in the test file).

## 5. Conventions

- Layers on generated sheets: order matters for the SVG/Visio export
  (WIRE, NUMBER, RACK, etc. — see `VSDX_LAYERS` and `buildSheetLayout`).
- Harness catalogue arithmetic lives in `engine.js` (`harnessCatalogue`) and is
  duplicated intentionally in `numbering.js` metrics and `sscplan.js` group
  metrics — if you change cable lengths, change all three or unify.
- Terminal convention (physical, fixed): left panel comm = **S then N**
  left→right; right panel power = **Negative then Positive** left→right
  (`tComm≈0.23`, `tPower≈0.77` of module face width in `frontview.js`).
- R11 is deliberately coarse: SSC:BUS+→JB:BUS+ and SSC:BUS−→JB:BUS−,
  1200 mm, part `PW-BUS-1200`. No port-level mapping exists yet.
- Colors: power = red, comm = green. Currency ¥. UI language: ENGLISH ONLY —
  the engineer's Visio file contains Chinese AutoCAD layer names (图框, 细实线层…);
  they are translated at display time by `vsdxLayerLabel()` — do not remove.
- Every user-facing feature gets a doc page in `docs/` and a row in README.

## 6. Bugs already fixed (do not regress; tests cover most)

1. Page-Y-flip mirroring embedded pictures → foreign `<image>` pre-flipped.
2. Master instances double-transformed (frame off-page) → instance cells are
   merged into the master ROOT shape, wrapper transform dropped.
3. `fvNum(NaN)→0` silently "calibrating" → fallback default preserved.
4. Mirrored text under page flip → `scale(1 -1)` + tspan line stacking.
5. "Failed to fetch" on data:/blob: hrefs → the picture **blob travels on the
   foreign record**; never re-fetch image hrefs.
6. EMF BGR colors; NaN bbox mixing X/Y in the Visio COM bridge.

## 7. Known limitations / next work (pick up here)

- ArcTo/EllipticalArcTo/NURBS draw as straight end-to-end lines (house
  template has none, so acceptable for now).
- Themed Visio colors fall back to black.
- DWG direct import still blocked on Autodesk APS (account country issue);
  DXF/PNG/SVG/VS DX work.
- AC/aux circuits to ACDP/MSM (blue/orange) not yet in rules.
- Logo insert in the exported Visio title block is manual.
- R11 could become a per-port map if AYK supplies SSC terminal layout.
- Deployment is done through the WorkBuddy sites publisher (out-of-band tool).
  If you need CI/deploys from Codex, set up GitHub Pages / Netlify on `main`
  (static hosting, no build) — the site root is this folder.

## 8. Data & cloud

WorkBuddy cloud (PostgREST + RLS + storage): `projects` table stores config
JSON + `underlay_url/kind/x/y/w/h`; `project_files` stores saved .vsdx.
Auth is email-OTP. The SDK key is in `js/config.js`. Treat it as a demo
backend; do not commit secrets beyond what is already there.

## 9. Working rules for the agent

- Run `node tests/drawing.test.js` after EVERY change; keep 100% passing and
  ADD assertions for anything new. Target: >314.
- Never edit generated export files by hand — regenerate via the engine.
- Commit style: one feature per commit, imperative subject, body explains the
  why. Push to `main` after each green suite.
- When touching coordinate/transform code, verify against the real sample
  file: `vsdx-import-study/111.vsdx` (outside this folder in the WorkBuddy
  workspace; a copy is fine — it is the engineer's actual rack drawing, A3,
  with an embedded CAD EMF 13.92×5.16 in at page position 1.6,5.4).
- The app is English-only; keep it that way.
