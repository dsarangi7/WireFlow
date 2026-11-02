# SVG wiring comparison baseline

Input: `C:\Users\admin\Downloads\IO\111.vsdx`.
Reference: `C:\Users\admin\Downloads\IO\DWG2512-01 S10164 Wiring Diagram.vsdx`.

Both Visio packages contain two page XML files and identical `visio/media/image1.emf` bytes (SHA-256 `b7a44605bb41d8ce240d0125068bc7e922cca3d6204ff4b57c71d176fb6905d6`). This suggests a shared embedded graphic, but does not establish alignment, page identity, or identical rendering. Page 1 has 159 shapes in the input and 485 in the reference; page 2 has 153 and 176, respectively. These counts include nested shapes and do not identify wires by themselves.

The reference should be analyzed using its Visio shape geometry, transforms, line styles and connectivity, not inferred from the counts. Compare generated SVG endpoints and paths to the appropriate reference page and inspect the rendered result. Preserve both originals. Engineer review is required for electrical connections, cable routing, crossing/clearance and harness selection; visual similarity alone does not prove correctness.

Current baseline: `node tests/drawing.test.js` passes 370 assertions at commit e9f7687. This suite does not prove a match against these two files. The existing simplified picture wiring generates straight preview segments, so matching routed reference geometry remains unfinished.

Confirmed user-provided terminal order: module S, N, negative, positive; SSC S, N, S+, B+, B−, S−; junction box positive, negative, positive, negative, with pairs assigned in SSC marking order. These labels alone do not supply their coordinates or fully specify all routing rules.

Reference geometry inspection (2026-11-02): page 1 contains 106 red and 85 green shapes with explicit `LineColor` values; their geometry sections include 176 `LineTo`, 4 `ArcTo`, and 22 `EllipticalArcTo` rows. Page 2 contains 9 red and 5 green shapes with 12 `LineTo` and 2 `EllipticalArcTo` rows. The input page 1 contains no shapes with those explicit colors. Color is only a candidate filter, not proof that a shape is a cable. These counts differ slightly from older notes because the current inspection counts explicit-color nested shapes, including non-cable graphics. Shape transforms and connections must be resolved before treating any row as a physical wire.

The importer now reconstructs `EllipticalArcTo` curves, while `ArcTo` still falls back to straight lines. All 22 page 1 elliptical-arc sections produced SVG arc commands in a data check; visual comparison against Visio remains necessary. The importer is not yet a fully faithful reference renderer.
