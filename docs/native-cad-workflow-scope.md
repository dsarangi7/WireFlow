# Scope: native AutoCAD / Visio workflow (replacing the picture workflow)

Status: Phases 1 and 2 done (18 November 2026); Phases 3–5 not started.

## Phase 2 — what exists now

- `js/cad.js` teaches a *signature* from one boxed copy (`cadTeachSignature`),
  strips geometry that is not shared by the other copies, such as a frame rail
  through the bottom row (`cadRefineSignature`), finds every translated
  copy (`cadFindMatches`, optional left-right mirror) and resolves several
  part kinds together (`cadRecognise`). Features: circles exactly, other
  primitives by point count + bounding-box size, 0.1 mm tolerance.
- Drawing view: **Teach a part** (module, SSC, junction box, ACDP, MSM) →
  drag a box around one copy → all copies outlined → for a module click the
  four terminals once (comm S, comm N, power −, power +; clicks snap to circle
  centres). SSC/JB terminals are optional (T1, T2 …) until their roles are
  defined in Phase 3.
- Taught parts are saved with the drawing and in a device library; a newly
  imported rack is recognised automatically with the saved parts.
  **Download parts (JSON)** exports every component box and terminal in mm.
- Verified on 111, in Node and through the browser UI: 60 modules, 5 SSCs,
  5 junction boxes, 240 module terminals, each on a terminal circle centre.
  **The junction box is the long box at the TOP of each SSC column**
  (two connectors and two round knock-outs; confirmed by AYK 18 Nov 2026).
  The strip with six connectors directly under each SSC is the **SSC's own
  connector strip** (confirmed by AYK): the SSC is taught as panel + strip,
  and its six connectors are its terminals T1–T6, left to right (on 111 at
  y ≈ 1,152 mm: 2 round connectors, then 4 square-flange connectors). What
  each connector carries (power +/−, comm in/out …) is still to be supplied
  by AYK; do not guess it.
- Refinement ignores partial repeats: a candidate copy only votes when it
  shares several kinds of geometry spread over most of the part, so a
  connector that also appears elsewhere cannot take over the signature.
- **ACDP and MSM get no wiring** (they are connected at the back of the
  rack; confirmed by AYK 18 Nov 2026). They have no terminals and are only
  labelled ACDP1, ACDP2 … / MSM1, MSM2 …. **ACDP numbering rule (AYK,
  18 Nov 2026): ACDP1 is always the ACDP closest to the MSM** (shortest
  back-side cable), then the next closest (`cadProposeNumbers`); MSMs are
  numbered left to right. If a confirmed name breaks the ACDP1 rule the card
  shows a warning. The engineer must check and confirm (or rename) every
  label; unconfirmed
  labels show a "?" on the drawing and `labelConfirmed: false` in the JSON.
  On 111 (confirmed by AYK): **2 ACDPs** — ACDP1 is the panel between MSM1
  and SSC-5, ACDP2 the small panel above SSC-2; **1 MSM** — the panel with the arrow and
  the emergency stop at the top of the fifth SSC column. The large plain
  areas above SSC-1, SSC-3 and SSC-4 are **empty space**, not parts.
- Teaching lesson: a box that catches the shelf line under a panel (shared by
  every SSC column) makes the shelf the signature and gives wrong copies. Keep
  the box inside the part and check the outlined copies before saving.
- **SSC numbering and module counts (AYK, 18 Nov 2026):** SSC1 is the SSC
  closest to the MSM, then the next closest; without an MSM, left to right.
  The engineer confirms every SSC name and enters how many battery modules
  each SSC controls. Confirmation is refused unless every count is a whole
  number of 1 or more and the counts add up to the modules found on the
  drawing. The drawing then shows e.g. "SSC1 · 12 modules"; the parts JSON
  carries `modules` per SSC. (The real counts for 111 are not yet entered.)
- A taught part can be **Removed** (this drawing only) or **Forgotten**
  (this drawing and the device library) when it was taught wrongly.
  Teaching on a bottom-row module (with rail geometry inside the box) also
  gives 60. Recognition takes ≈0.2 s.
- Not yet verified on a second rack drawing (S10177 DWG not available here).
  The four 8.9 mm-radius circles were used as module terminals for the test;
  an engineer must confirm they are the real terminal positions.

## Phase 1 — what exists now

- `tools/dwg-to-dxf.ps1`: converts one or many DWG files to ASCII DXF 2018
  through AutoCAD's core console (finds the newest installed AutoCAD).
- `js/cad.js`: DXF reader. LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE/POLYLINE
  with bulges, SPLINE (incl. rational), POINT, TEXT/MTEXT, INSERT (nested,
  arrays) and DIMENSION. Extrusion (OCS) handled, so mirrored SolidWorks
  arcs land correctly. Unsupported types are counted, never guessed.
  Circles stay exact (they carry terminal geometry).
- Import screen accepts DXF; it opens `#/cad/<id>`, a true-mm canvas view
  with zoom, pan, live coordinates and a Measure tool that snaps to circle
  centres. DWG gets a message pointing to the conversion script.
- `tests/cad.test.js`: 26 unit tests; `WIREFLOW_DXF=<file>` adds a check that
  the computed extents equal AutoCAD's `$EXTMIN/$EXTMAX`.
- Verified on 111: 97,770 entities read, none skipped, extents equal to
  AutoCAD's header, parse + flatten ≈0.5 s in Node; in the browser the two
  terminals of a module measure 50.00 mm apart (ΔY 0.00).

## Why

AYK engineers draw rack wiring by hand in AutoCAD, sometimes in Visio. The
current WireFlow workspace works on a *picture* of the rack (SVG/PNG raster):
the engineer calibrates it by clicking, ports are found by image template
matching and must be reviewed, and the result is a draft image. That is slow
and not what engineers deliver. The tool should read the real CAD geometry and
hand back a drawing the engineer opens and finishes in AutoCAD or Visio.

## Wiring rules that drive the design

- **Power to power: never cross or touch.** This stays a hard gate.
- **Power to communication: may cross where required**, e.g. at the bottom of
  the rack. Allowed, but counted so the tidiest option can be preferred.
- Power series sequence as confirmed 3 Nov 2026 (see `power-sequence.md`).
- Module numbering is chosen so the power chain is crossing-free, then shortest
  physical span, then fewest long jumpers (BOM removed 18 Nov 2026).

## What the real drawing contains (measured on sample-111.vsdx)

- The Visio file embeds the **complete AutoCAD drawing** of the rack:
  `visio/embeddings/oleObject1.bin` is an OLE container whose `Contents`
  stream is a DWG (`AC1015`, AutoCAD 2000 format, 7.0 MB).
- It was extracted and converted to DXF on this machine with
  `accoreconsole.exe` from AutoCAD 2024 (no UI, scriptable).
- The DWG is a **flat SolidWorks-style export**: 97,772 entities (72k LINE,
  11k SPLINE, 8k ARC, 5k CIRCLE), all on layer `0`, no blocks, no text.
  So there are no ready-made "module" objects or labels to read.
- But the geometry is **exact and in millimetres**, and repeats perfectly.
  Example: 240 circles of radius 8.9 mm sit on a regular grid (8 rows at
  210 mm pitch) — 4 per module for 60 modules. Rectangle edges of identical
  lengths repeat 60 or 120 times.

Conclusion: recognising modules, SSCs, junction boxes and their terminals
becomes **exact geometric matching** (tolerance ~0.1 mm) instead of image
matching on a raster. No calibration clicks are needed: the drawing is already
in mm.

## Target workflow

1. **Import** a DWG, a DXF, or a Visio file with an embedded rack DWG.
   - DWG cannot be read in a browser. Convert to DXF with either the engineer's
     AutoCAD (`accoreconsole`, as tested here), the free ODA File Converter, or
     by asking engineers to save as DXF. Visio files: extract the embedded DWG
     automatically, then convert.
2. **Teach each part once.** For a new module type (or SSC / JB), the engineer
   boxes one instance on the drawing and clicks its terminals once
   (power −, +, comm S, N). WireFlow stores this as a *signature* in the module
   catalogue and finds every identical copy in the drawing automatically.
   Known module types need no teaching at all.
3. **Confirm the rack**: SSC labels, which modules belong to each SSC, ACDP /
   MSM positions (the questionnaire from the rack-marking skill). The tool
   proposes it; the engineer corrects.
4. **Number and route** with the existing engine, now in true mm:
   power chain crossing-free (hard), power/comm crossings allowed and counted,
   harness reach checked against the catalogue.
5. **Output a CAD drawing, not a picture:**
   - **AutoCAD:** the original drawing plus new layers (`WF-POWER`, `WF-COMM`,
     `WF-LABEL`, `WF-NUMBER`) as DXF, and/or an AutoCAD script (`.scr`) that
     draws the wires as polylines onto the engineer's open drawing. Wires stay
     individually editable.
   - **Visio:** wires written as shapes on the original page, positioned over
     the embedded rack (the OLE frame gives the mm-to-page mapping), via the
     existing `.vsdx` export or the Visio add-in.

## What gets retired

Picture/raster workspace, image template port detection, manual calibration,
and the reviewed-port-candidate step. Their code can stay until the native path
passes acceptance, then be removed.

## Phases

| Phase | Deliverable | Done when |
|---|---|---|
| 0. Samples | 3–5 real racks as DWG/DXF or Visio (111, S10177 Rack1–8, one other vessel) | Files in a fixtures folder |
| 1. CAD reader | DWG → DXF conversion; DXF reader for LINE/ARC/CIRCLE/LWPOLYLINE/SPLINE/ELLIPSE; mm-true rendering in the app | 111 renders 1:1 in mm and matches AutoCAD |
| 2. Recognition | Signature teaching + automatic repeat finding for modules, SSC, JB, terminals | 111: 60 modules / 5 SSC / 5 JB / all terminals found with no clicks after teaching; S10177: 4 SSC × 24 modules |
| 3. Engine hookup | Numbering and routing fed from mm geometry; power-crossing gate; power/comm crossings counted | Every SSC of the samples gets a crossing-free power chain or a clear reason why not |
| 4. CAD output | DXF with WF layers + `.scr` | Opens in AutoCAD 2024; an engineer finishes a rack faster than by hand |
| 5. Clean-up | Remove the picture workflow | Tests green, docs updated |

Phase 1–2 carry the most risk (SPLINE/ARC handling, identical-geometry matching
across drawings exported by different people). Phase 3 mostly reuses existing
engine code.

## Decisions (answered 18 November 2026)

1. **Main deliverable: AutoCAD (DWG/DXF).** Visio write-back moves out of
   Phase 4 and becomes a later, optional phase.
2. **Input: the DWG is always available.** DWG → DXF conversion is the only
   required import path. Extracting the rack from a Visio file is not needed
   for the first version.
3. **All rack drawings are flat exports** like 111 (no blocks, layers or
   text). Signature teaching and geometric repeat finding (Phase 2) are
   therefore essential, not optional; nothing can be read from block names.
4. The La Spezia `.tar.zst` archives are not relevant to this work.

## Still open

1. Output layer names and colours to match house standard. Until AYK
   supplies them, use `WF-POWER` (red), `WF-COMM` (green), `WF-LABEL`,
   `WF-NUMBER`.
2. Rule for multiple strings on one SSC (still missing, do not invent).
