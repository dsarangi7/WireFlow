# AYK WireFlow — battery rack wiring from the AutoCAD drawing

WireFlow reads the AutoCAD DXF of an AYK marine battery rack and produces AYK's
DWG2396 A3 wiring sheet as a PDF. The engineer teaches each part once, confirms the
SSCs, numbers the modules by clicking, and the tool routes every cable in the rack's
trays with no power cables crossing and no cable over a port.

Live site: https://dsarangi7.github.io/WireFlow/ · Everything stays on the engineer's device.

## Workflow

1. **Projects** — one folder per project number; import a rack DXF into it and name the
   rack (Rack 1, Rack 2 … or custom). Later racks reuse the parts, JB pair and tray taught
   on the project's earlier racks.
2. **Rack view** — the DXF at true scale. Box one module, SSC and junction box and click
   their terminals; every copy is found. Confirm SSC/ACDP/MSM names and modules per SSC,
   pick the JB pair and tray (CL/CR), then number the modules by clicking, SSC by SSC.
   A numbering used on a rack of the same layout is offered ("Use this numbering").
3. **Wiring sheet** — AYK's A3 sheet. Zoom in, fix any power crossing (red ring) or cable
   over a port (orange ring) by pulling cables or choosing another planned route, fill in
   the title block and download the PDF.

Have a DWG? Convert it with `tools/dwg-to-dxf.ps1` (uses your AutoCAD) or AutoCAD
*Save As → DXF*. Try it without a drawing at `#/example`.

## Project structure

```
index.html          product page + app mount (no build step)
site.css styles.css product page / app styles
js/cad.js           DXF reader, part teaching and recognition
js/cadwire.js       wiring planner: trays, rails, crossings, ports, alternative routes
js/pdf.js           minimal vector PDF writer
js/sheet.js         DWG2396 A3 sheet layout (screen SVG + PDF)
js/numlib.js        numbering library on the device
js/app.js           UI: projects, rack view, wiring sheet editor
js/tutorial.js      product page scroll tutorial
assets/examples/    example rack 111
tools/              dwg-to-dxf.ps1, make-example.js, make-hero-animation.py
tests/              Node tests (+ rack 1111 fixture)
.claude/skills/wireflow/  rules, code map and working notes for Claude
```

## Running locally

```bash
python -m http.server 8081 --bind 127.0.0.1
# open http://127.0.0.1:8081/#/app
```

## Tests

```bash
node tests/cad.test.js
node tests/cadwire.test.js
node tests/numlib.test.js
node tests/sheet.test.js
```

## AYK rules

See [.claude/skills/wireflow/references/rules.md](.claude/skills/wireflow/references/rules.md).
