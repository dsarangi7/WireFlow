---
name: wireflow
description: Build, fix, test and deploy AYK WireFlow, the browser tool that turns an AutoCAD DXF of an AYK battery rack into AYK's DWG2396 A3 wiring sheet (PDF). Use for any work in this repository - DXF reading and part teaching, SSC/JB confirmation, engineer module numbering, cable planning in trays, power-crossing and port rules, the wiring sheet editor and PDF, the numbering library, project folders, the product page, tests or deploying to GitHub Pages. Also use when someone asks how the AYK rack wiring rules work.
---

# AYK WireFlow

A static web app (no build, no npm, no framework). The engineer imports a rack DXF,
teaches each part once, confirms the SSCs, numbers the modules by clicking, and gets
AYK's A3 wiring sheet as a PDF. Everything stays on the device (IndexedDB + localStorage).

- Live: https://dsarangi7.github.io/WireFlow/  (GitHub `dsarangi7/WireFlow`, branch `main`)
- Work branch: `native-cad-and-site`; remote name `github`.

## The workflow the app implements

1. **Projects** (`#/app`): one folder per project number, racks inside (`#/folder/<id>`).
   Import DXF asks for the project (pick or create by number) and the rack name
   (Rack 1, Rack 2 … or custom). A new rack copies the taught parts and the JB pair/tray
   from the project's latest rack.
2. **Rack view** (`#/cad/<id>`): the DXF at true scale. Teach a part = box one copy, click
   its terminals left to right; every copy is found. Confirm SSC names/module counts,
   ACDPs, MSM. Pick the JB pair (P1/P2) and tray (CL/CR). Number the modules by clicking,
   SSC by SSC. The planner then draws the cables.
3. **Wiring sheet** (`#/sheet/<id>`): AYK DWG2396 A3 sheet. Engineers zoom, fix crossings,
   pull cables into new bends, pick another planned route, edit the title block, download PDF.

## Rules that must never be broken

Read [references/rules.md](references/rules.md) before changing wiring, numbering or the sheet.
In short:
- Power cables never cross each other. Power and comm may cross.
- No cable runs over, or looks as if it runs over, a port it does not connect to (15 mm clearance).
- Cables stay inside the rack and in the trays/rails; never over a part, never looping outside.
- Numbering is done only by the engineer clicking. No auto-numbering buttons, no module
  ids drawn before numbering. A saved numbering is never deleted unless the engineer asks.
  The library only *offers* a numbering ("Use this numbering").
- Output is the PDF sheet only (no DXF/CSV/Visio export). DXF is the input.
- Every distance scales with the drawing (`cadwU(mm)`, `sheetUnit`); racks come at 1:1 and ~1:44.
- Do not invent AYK rules. When something is unknown (a label, a clearance, a pair), ask
  the engineer and say what was assumed.

## Code map

See [references/code-map.md](references/code-map.md) for every file, function and the saved
data. Script order in `index.html`: `cad.js, cadwire.js, pdf.js, sheet.js, numlib.js, app.js, tutorial.js`.
All modules are classic scripts sharing globals; `cadwire.js`, `sheet.js`, `pdf.js`, `numlib.js`
are pure (no DOM) and are tested in Node.

(`wiring-guide.html` + `js/guide3d.js` + `js/guide-data.js` is a separate 3D wiring guide
page built in another session; it only reuses `cad.js`.)

## Working on it

```bash
node tests/cad.test.js        # DXF reader, teaching, recognition (39)
node tests/cadwire.test.js    # planner, trays, crossings, ports (70)
node tests/numlib.test.js     # numbering library (13)
node tests/sheet.test.js      # sheet layout + PDF, rack 1111 fixture (31)
```
- Run all four after every change; add tests for new behaviour. `node --check js/<file>.js`.
- Run locally: `python -m http.server 8081 --bind 127.0.0.1` in the repo, open `http://127.0.0.1:8081/#/app`.
  `#/example` opens the bundled rack 111. Check the browser console for errors.
  Remove any test racks you create from the browser's IndexedDB afterwards.
- Edit large files with exact-match replacements (a small Python script that asserts each
  old string occurs once works well); files may be CRLF.
- Rack 1111 (`tests/fixtures/rack-1111.js`, ~1:44, 107 modules) is the hard case; planning
  it takes ~20 s, so keep new checks inside the planner cheap (sort + binary search).

## Commit and deploy (only when the user asks)

```bash
git add -A && git commit -m "<imperative subject>"   # end with the Co-Authored-By line
git branch -f main native-cad-and-site && git push github native-cad-and-site:main
```
GitHub Pages publishes `main` (`.github/workflows/pages.yml`). Confirm the live `js/app.js`
contains the change, and tell engineers to refresh once.
