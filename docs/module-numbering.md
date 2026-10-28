# Physical module numbering (M1 … MN)

## Why the numbering has to be decided, not assumed

The M-numbering is a property of the **rack**, not of the schematic. In the recorded
AutoCAD session the screen recording starts after the rack front view is already open —
the labels `S2-M1 … S2-M24` are already there, and everything the engineer draws follows
that order. Three things decide it:

| What | Why it matters |
|---|---|
| **SSC position** | M1 and MN are the two module-to-SSC harness ends (R04/R05/R06). The chain wants to *start* and *end* next to the SSC, otherwise the approved M2S harness does not reach. |
| **ACDP / MSM position** | They are AC devices in the rack, not battery modules. They take a slot, they are skipped by the chain, and they are not numbered. |
| **Which slots are physically neighbours** | A hop between two modules that sit next to each other takes the approved short jumper (R07 100 mm / R08 450 mm). A hop that crosses a column or skips a slot needs the long jumper (R09 445 mm / R10 650 mm). |

So the numbering decides the cable: **every non-neighbour hop costs 545 mm more and a
different part number.** That is the whole point of choosing it.

## The model

A rack is a grid of slots (`cols` × `rows`, default 3 columns + a bottom device row).
Every slot holds one of:

| Kind | Numbered | Notes |
|---|---|---|
| `module` | yes | battery module, takes M1…MN |
| `ssc` | no | anchors the chain — the search starts and ends here |
| `acdp` | no | AC distribution panel (blue AC runs) |
| `msm` | no | main switch module (orange AC runs) |
| `jb` | no | junction box |
| `empty` | no | spare / blanked slot |

Geometry is entered in millimetres (column pitch, row pitch, module size, terminal inset
from the bottom of the module face). Terminals follow the AYK convention: **communication
pair on the left of the module face (S then N), power pair on the right (− then +)**.

Only the *relative* geometry matters for the cable decision — the scheduled lengths still
come from the approved catalogue. The pitch is used to rank options and to warn when a hop
spans further than the longest approved harness.

## Automatic mode — pick the shortest cable

The engine enumerates every reasonable pattern and scores each one with the real BOM:

1. **Serpentine** — down one column, up the next (the pattern in the recorded session).
   Four start corners × column-major / row-major.
2. **Straight raster** — same direction in every column/row. Cheap to describe, but each
   column change is a long hop.
3. **Optimised path** — nearest-neighbour from the SSC (or from any corner) refined with
   2-opt on the closed tour `SSC → M1 … MN → SSC`, which minimises total cable including
   both M2S legs.

Each candidate is scored:

| Metric | Meaning |
|---|---|
| `bomMm` | total manufactured cable — what you actually buy |
| `geomMm` | total physical span — how much copper the layout needs |
| `longHops` | hops that need R09/R10 instead of R07/R08 |
| `maxHopMm` | longest single hop |
| `overflow` | hops (or M2S legs) that no approved harness reaches — these need an engineering release, so they rank above pure length |

Ranking: **fewest unreleasable cables first, then cheapest BOM, then shortest span.** The
engineer sees the top options side by side with a preview of the pattern and picks one.

## Custom mode — the engineer points the order

1. Import the rack drawing (Configuration → Rack drawing).
2. Open **Numbering** → *Custom — I point the order*.
3. Click the module slots on the rack in the order the chain must run. The first click is
   M1 (next to the SSC), the next is M2, and so on. Clicking a numbered slot removes it.
4. Part-way is fine: **Auto-fill rest (nearest)** or **(serpentine)** completes the order
   from the last click, and the partial order can still be edited.
5. Save. The netlist, schedule, JSON spec and drawing all follow the saved order.

## What the numbering changes downstream

- **Netlist** — a hop between two slots that are not physical neighbours is built with the
  long jumper and flagged `derived from rack numbering`; every hop carries its physical
  span (`geometryMm`).
- **Schedule / BOM** — part numbers and quantities follow from that (e.g. 7 × `PW-LOC-445`
  instead of 7 × `PW-JMP-100`).
- **Drawing** — once a rack drawing is imported, `M1 … MN` are drawn as circled numbers on
  the `NUMBER` layer over the rack, together with labels for SSC / ACDP / MSM / JB. The
  fit rectangle in Configuration positions them.
- **JSON spec** — `numbering` block with mode, plan, rack geometry, device slots and the
  `M1 → slot` sequence, plus `geometry_mm` per connection, so downstream tools (Visio
  bridge, AutoCAD script) can reproduce the same numbering.

## Files

| File | Role |
|---|---|
| `js/numbering.js` | rack model, geometry, plan enumeration + scoring, custom order, sheet overlay, preview SVG |
| `js/engine.js` | `numberingHopFor()` (hop class → jumper), `NUMBER` layer, numbering overlay in `buildSheetLayout`, `numberingSpecBlock()` in `specJson` |
| `js/app.js` | Numbering tab: layout, device painting, automatic options, click-to-number |
