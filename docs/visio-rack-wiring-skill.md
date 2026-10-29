# Skill: Marine Battery Rack Wiring Diagram — Visio Production Workflow

> Learned by diffing a real blank template (`111.vsdx`) against its finished output
> (`DWG2512-01 S10164 Wiring Diagram.vsdx`) for the same project, both authored in
> Visio by the application/field team. Observations below are examples from this
> drawing; they are not a substitute for approved routing and harness rules.

## 1. The workflow in one line

The engineer does **not** draw racks. He starts from a template that already contains
the rack as a picture, and draws **colored connections** over it, plus labels
for devices that are not already in the picture.

```
blank template (.vsdx)  ──>  draw wires over the picture  ──>  save as DWGxxxx-yy <project>.vsdx
     (rack photo/DWG,               (red/green/blue/orange,            (logo & frame already
      logo, frame, title             straight and curved                in the template)
      block, layers, notes           shapes)
      page)
```

## 2. Template anatomy (`111.vsdx`)

Everything below ships **inside the blank file** — the engineer never redraws it:

| Part | Detail |
|---|---|
| Page setup | 2 pages, both 18 × 12.75 in, PaperKind A3 (`PaperKind=8`) |
| Page 1 | the wiring sheet |
| Page 2 (`Note`) | SSC connection detail / notes sheet |
| Rack picture | **embedded AutoCAD object** (`FRONT VIEW by edward .DWG`), 13.92 × 5.16 in, centred; `ObjectType=33280`, on the `CAD Drawing` layer, carries `CADExportScale` ≈ 389.55 |
| Company logo | AYK bitmap (`image2.bmp`, 161×168 px), ~0.30 × 0.37 in, bottom-right (title-block area) |
| Frame + title block | imported CAD group (`DWG-…` named shape, 17.5 × 12.25 in) |
| Layers | `图框` (frame), `细实线层` (thin solid), `0`, `CAD Drawing` — Chinese CAD-style names |
| Masters | 9: `Block1`, `SW_NOTE_0`, `SW_NOTE_0_1`, `Circle`, `Cloud`, `Rounded Rectangle`, `Circle.1013`, `Triangle`, `Ellipse` |
| OLE embeddings | 2 × 20 MB CFB objects with 8.4 MB EMF cached displays (the rack views) |

**Trick:** the module labels, terminals and equipment names live *inside the CAD
picture*. That is why a finished 2-string sheet has only **3 text shapes**
(`ACDP1`, `ACDP2`, `MSM`) — every device that exists in the rack is already labelled
by the picture.

## 3. Wire conventions (the finishing "handwriting")

Some connections are plain 1D line shapes, such as this example:

```xml
<Shape ID="3304" Type="Shape">
  <Cell N="PinX"   F="(BeginX+EndX)/2"/>
  <Cell N="PinY"   F="(BeginY+EndY)/2"/>
  <Cell N="Width"  F="SQRT((EndX-BeginX)^2+(EndY-BeginY)^2)"/>
  <Cell N="Height" V="0"/>
  <Cell N="LocPinX" F="Width*0.5"/><Cell N="LocPinY" V="0" F="Height*0.5"/>
  <Cell N="Angle"  F="ATAN2(EndY-BeginY,EndX-BeginX)"/>
  <Cell N="BeginX" V="…"/><Cell N="BeginY" V="…"/>
  <Cell N="EndX"   V="…"/><Cell N="EndY"   V="…"/>
  <Cell N="LineColor" V="#00b050" F="THEMEGUARD(RGB(0,176,80))"/>
  <Section N="Geometry"><Row T="MoveTo"/><Row T="LineTo"/></Section>
</Shape>
```

Colour table (counts from the reference finished sheet):

| Colour | Hex | Meaning | Wires on sheet 1 | On Note page |
|---|---|---|---|---|
| Red | `#ff0000` | Power (+/− strings, SSC, JB) | 105 | 9 |
| Green | `#00b050` | Communication (S/N daisy chain) | 85 | 5 |
| Blue | `#0070c0` | AC to ACDP1 / ACDP2 (AC distribution panels) | 10 | — |
| Orange | `#ffc000` | AC to MSM (main switch module) | 10 | — |

Style facts measured from the reference:

- Many module-to-module hops are short straight lines. The finished drawing also
  contains curved and multi-segment geometry. Inspection of page 1 found 23 red
  or green shapes containing `ArcTo` or `EllipticalArcTo` rows. Colour alone does
  not establish that every counted shape is a cable or approve its physical route.
- Mostly **diagonal** (point-to-point over the picture), some vertical/horizontal.
- Default line weight (inherits quick style 3); a few heavier 0.75 pt accents.
- Character: Calibri, black; wire shapes carry `TextBkgnd=2`.
- New device labels (`ACDP1`, `ACDP2`, `MSM`) are ~0.63 × 0.18 in text boxes near
  their wire clusters.

## 4. Rules → wires mapping (AYK WireFlow R01–R12)

| Rule | Wire |
|---|---|
| R02 | Mx `P−` → Mx+1 `P+` — red jumper |
| R03 | Mx `S` → Mx+1 `N` — green jumper |
| R04/R05 | SSC `P+/P−` → M1/M24 — red |
| R06 | SSC `S` → M1 `N`, SSC `N` → M24 `S` — green |
| R11 | SSC `BUS±` → JB — red |
| (manual) | AC / grid runs — blue/orange, labelled `ACDP1`, `ACDP2`, `MSM` |

In-rack gaps and column transitions (R09/R10) require the appropriate approved
harness and route; cross-rack runs are declared as exceptions. The reference
provides examples, not a complete approved rule for every rail and crossing.

## 5. What AYK WireFlow now automates (vs. the manual workflow)

| Manual step | AYK WireFlow |
|---|---|
| Open blank template | Export `.vsdx` directly from the project config |
| Count modules, plan chain | Netlist generated from R01–R12 (deterministic) |
| Draw every red/green wire | Emitted as native 1D shapes, house colours `#ff0000` / `#00b050` |
| Remember gauges | `powerGauge` / `commGauge` flow into schedule, CSV, notes page |
| Write notes sheet | **Page 2 "Notes"** auto-built: legend, specs, exception list, release warnings |
| Logo | Embedded AYK PNG in the title block (`visio/media/image1.png`) |
| Validation | 12-check gate before export; approval refs carried through |
| Still manual | AC/aux circuits (blue/orange), swapping the CAD rack picture, final PDF |

## 6. Machine-readable output

`specJson(conns, project)` exports the layout contract for downstream automation:
A3 paper in inches; components (modules `S<n>:M<m>`, SSC blocks, JB devices) with
inch coordinates and terminal positions; connections with `id` (`C-001`…), `from`,
`to`, `network`, `class`, `color` (`#c00000`/`#00b050`), `label` (harness P/N),
`gauge`, `length_mm`.

## 7. Gotchas (learned the hard way)

- Visio layer section is **`<Section N="Layer">`** with cells `Name`, `Color`,
  `Status`, `Visible`, `Print`, `Active`, `Lock`, `Snap`, `Glue`, `NameUniv`,
  `ColorTrans` — *not* `Layers`/`LayerName`.
- 1D lines need `Angle = ATAN2(EndY-BeginY,EndX-BeginX)`; zero-length lines are
  invalid — clamp to a minimum length.
- Embedded bitmaps need: package `media/` part + `Default Extension` content type +
  page-level `_rels` + `<ForeignData ForeignType="Bitmap"><Rel r:id="…"/></ForeignData>`
  inside a `Type="Foreign"` shape with `ImgWidth`/`ImgHeight`.
- Text with non-ASCII (mm², —) must be written UTF-8; CP1252 exports (DXF/SCR) need
  ASCII sanitisation instead.
- The DWG number lives in the **filename** (`DWG2512-01 S10164 Wiring Diagram.vsdx`);
  document `dc:title` stays empty in the house convention.
