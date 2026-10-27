# Video workflow study — engineer drawing a rack wiring diagram (2026-10-27)

Source: 29-minute silent screen recording (2560x1400, AutoCAD 2017, no narration).
Frames + analysis in `../video-study/` (keyframes.json, sheets/, hi/, zoom_*).

## What the video shows, step by step

| Time | What happens |
|---|---|
| 0:00–2:00 | AutoCAD opens `P0007_Rack_36_Rack_S_25010607.dwg` — the customer's **rack front view** (3 columns x 8 rows, 24 modules already labelled S2-M1..S2-M24, SSC-1 and ACDP-3 boxes at bottom right). Recent-files list shows the whole drawing family (DWG2440-00 S10189, DWG2455/DWG2463-00 S10164, DWG2466-00, DWG2413-00 S10174...). |
| 2:00–4:00 | Zooms/inspects; starts on **Layer1/Layer2** (no formal layer standard visible). |
| ~4:10–10:00 | Draws **red power wiring**: (1) two vertical red cables along the right rack rail running full height, (2) diagonal red jumpers module-to-module — from the left terminal of Mk to the right terminal of M(k+1) — following the module order, ending at the SSC-1 terminal block. |
| ~10:00–20:00 | Draws **green communication wiring**: diagonal zigzag chain on each module's LEFT panel terminal pair (S/N alternating), again following module order, ending at the SSC. |
| ~24:30 | Plots/exports to PDF; opens `P0007_Rack_36_Rack_S_20260205.pdf` in Foxit Reader to check it. |
| ~29:00 | Back in AutoCAD; done. |

## The critical discoveries

1. **Module numbering is serpentine across columns** — this is how terminal sequences run physically:
   - Left column: M1 (top) → M9 (bottom)
   - Middle column: M10 (bottom) → M18 (top)
   - Right column: M19 (top) → M24 (bottom)
   The wiring chains follow this order, so wires zigzag naturally without long cross-rack jumps.

2. **The deliverable is wiring drawn ON the rack front view** — not a separate schematic. The rack DWG already carries every module label; the engineer adds *only* colored polylines. No dimensions, no labels, no legend are added by hand.

3. **Wire routing style = straight diagonal hops** between adjacent terminal pairs (left terminal of one module → right terminal of the next), NOT orthogonal elbows. Two M2S power cables run as verticals along the right rail into SSC-1.

4. **Terminal pairs sit at the bottom-left of each module face** (two round sockets); comm uses the same style of pair. Red = power, green = communication (matches the VSDX template colors #ff0000/#00b050).

5. **Final product = PDF plot of the annotated rack DWG.**

## Mapping to AYK WireFlow

| Video step | AYK WireFlow today | Gap / action |
|---|---|---|
| Open customer rack DWG | **Rack underlay import** (DXF/PNG/SVG upload, fit rect, RACK layer) — built | DXF import covers this; DWG needs APS |
| Read module labels from rack | Labels are in the imported drawing | none |
| Serpentine wiring order R02/R03 | Engine generates the same series chains | add **serpentine column order** option so chains follow M1→M9→M10(up)→M18→M19→M24 |
| Draw diagonal hops on the rack | Schematic-style orthogonal layout | new **front-view wiring mode**: straight diagonal segments landing on actual terminal positions |
| Terminals at known rack positions | Fit-rect maps the whole sheet, not per-terminal | **terminal anchor calibration**: mark M1's terminal pair + column pitch on the underlay; engine derives every other terminal |
| Right-rail vertical M2S cables | M2S cables drawn as elbow polylines | in front-view mode route them along the rack's right rail |
| Plot to PDF | VSDX/DXF/PDF-ready exports | front-view mode exports through the same pipeline |

## Decision: what to build next

A **"Rack front view" wiring mode** for the engine:
1. Calibration UI on the underlay: click M1's power pair, M2's power pair (gives column pitch + row pitch), and the SSC entry point.
2. Engine renders power/comm chains as diagonal hops between calibrated terminal positions, serpentine order, rail verticals for M2S.
3. Output over the imported rack drawing via the existing VSDX/SVG/DXF exporters — the exact artifact the video ends with, produced in minutes instead of 29.
