# Front-view wiring — drawing the cables on the REAL rack

This is the workflow the engineer actually does (verified against the
screen-recording study, `docs/video-workflow-study.md`): open the rack
drawing, number the modules, and draw the red/green wiring straight over
the rack front view. AYK WireFlow now does the same in the browser.

## The flow

1. **Get the rack picture into the project**
   - *Diagram* tab → open the engineer's `.vsdx` → **Use as wiring base**.
     The largest embedded picture (the AutoCAD rack, a vector EMF) is
     rendered to a PNG and saved as the project underlay **at its exact
     page position** (the A3 sheet carries 101.6 units per inch, y
     flipped, so the picture lands where Visio puts it).
   - or *Configuration* tab → import a DXF/PNG/JPG as before.

2. **Calibrate the module grid on the picture** (*Numbering* tab →
   "Wiring on the real rack" → *Calibrate grid*)
   - click 1: centre of the **first** numbered module (M1);
   - click 2: centre of the **last** one.
   - From those two points the tool derives the slot grid, the module
     faces and the scale (`mmPerPx`), using the real column/row pitch
     from section 1 of the tab. The calibration is saved with the
     numbering (`config.numbering.cal`).

3. **Number and place devices on the picture**
   - custom mode: click modules on the picture in chain order;
   - device brushes (SSC / ACDP / MSM / JB): a click drops the device
     anchor where it really sits — the wiring rails target that point.

4. **The wiring is drawn live** over the picture:
   - **red** power: `SSC+ → M1 Pos`, `Mx Neg → Mx+1 Pos` (diagonal hop),
     `MN Neg → SSC−` — rail risers on the right, as the engineer draws
     them in AutoCAD;
   - **green** communication: the S/N zig-zag, offset from the red rail;
   - `M1…MN` labels on the modules;
   - a length summary (red metres, green metres, longest hop) computed
     from the picture scale.

## Coordinate model (`js/frontview.js`)

```
cal = { imgW, imgH,          natural picture size (px)
        x0, y0,              centre of slot (0,0) (px)
        pitchX, pitchY,      slot-centre distances (px)
        cols, rows,          slot grid on the picture
        mmPerPx,             physical scale
        moduleWf, moduleHf,  face size as fraction of pitch (0.92 / 0.88)
        termInsetFrac,       terminal row above the bottom edge (0.14)
        devices }            SSC / ACDP / MSM / JB anchors (px)
```

- Terminals mirror the physical convention: comm pair (S left, N right)
  at 21 %/25 % of the face width, power pair (Neg, Pos) at 75 %/79 %,
  both near the bottom edge.
- `fvWiring(order, cal)` follows the engine netlist topology; every
  segment carries `lenMm = px × mmPerPx`.
- `fvPxToSheet(cal, fit, x, y)` maps picture pixels onto sheet units
  through the underlay fit rectangle, so the same overlay can be baked
  into the DXF/VSDX exports later.

## Known approximations

- The riser rail is a fixed offset right of the last column
  (`railX`), not picked per rack — configurable via `fvWiring` opts.
- Lengths come from the picture scale; the **scheduled** lengths still
  come from the approved harness catalogue (R07–R10), so a hop longer
  than its harness still flags for engineering release in the schedule.
- The picture is the EMF preview of the AutoCAD drawing (crisp vector
  render), not the DWG itself.
