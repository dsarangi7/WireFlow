# Variable rack layout — one chain per SSC

Nothing about a marine battery rack is fixed. Every project's rack layout
diagram changes:

- **how many SSCs** there are,
- **how many modules each SSC controls**,
- **where the modules, ACDP, MSM and junction boxes sit**.

AYK WireFlow therefore plans the wiring **per SSC, from the rack itself**,
and draws every chain on the imported rack picture (the Visio / DXF underlay).

## Where it lives

| Piece | File | Role |
| --- | --- | --- |
| Planner | `js/sscplan.js` | assignment, per-SSC chains, validation, write-back |
| Variable engine | `js/engine.js` | `stringModuleCounts()` — one module count per chain |
| Front view | `js/frontview.js` | `fvWiring` per-chain anchors, rails and colours |
| UI | Numbering tab | card **0 · Variable layout** + **General diagram** |

## The model

```
config.layout = {
  version: 1,
  mode: 'auto' | 'manual',
  sscs: [ { id, label, slot, jb, capacity, order: [slot,...] }, ... ],
  assignment: { '<col>,<row>': 'SSC-1', ... },
}
```

The SSCs come from the **SSC device slots painted on the rack** (or imported
with the rack picture) — one chain per SSC. `capacity` is how many modules
that SSC controls; it is a variable, not a constant.

## Assignment (which modules belong to which SSC)

- **Auto — nearest cable** (`layoutAssign(project,'nearest')`):
  capacity-constrained greedy over the cable distance between each module
  and each SSC. Modules go to the closest SSC that still has room.
- **Split by columns / rows** (`'column'` / `'row'`): contiguous bands —
  the common physical arrangement.
- **By hand**: pick an SSC in the selector, then click its modules on the
  rack or on the rack picture. Chain order = click order (M1 first).

## Chain ordering (shortest cable per SSC)

`layoutGroupOrder(rack, rules, sscSlot, slots)` scores every candidate:

- 8 serpentine/raster traversals (4 corners × 2 patterns × column/row major),
- nearest-neighbour + 2-opt tours seeded from the SSC and from each corner,

all restricted to that SSC's own modules, each scored with
`groupMetrics()` — the same approved-harness arithmetic as the single-string
engine (R07–R10 jumpers, M2S harnesses, catalogue overflow). Best plan:
no unreleased cable → cheapest BOM → fewest long jumpers → shortest span.

## Write-back (chains become strings)

`layoutApply(project, groups)`:

- `rules.strings` = number of SSCs,
- `rules.modulesPerString` = largest chain,
- `numbering.order` = chains end-to-end, `numbering.counts` = modules per chain.

Everything downstream becomes variable-aware through
`stringModuleCounts(project)`: the **netlist** (one closed chain per SSC:
SSC+→M1+, Mx−→Mx+1+, M last −→SSC−, comm daisy chain, one BUS+/BUS− pair per
SSC→JB), the **validations** (V01–V05 per chain at its own length), the
**sheet layout** (each chain draws only its own modules) and the **hop
lookup** (`numberingOffsets`).

## Validation (the variable factors can never pass silently)

`layoutValidate()` adds checks L01–L06 shown in the tab:

| id | check |
| --- | --- |
| L01 | every module in exactly one chain |
| L02 | no SSC holds more modules than its own capacity / the approved string length |
| L03 | every SSC has a junction box for the BUS+/BUS− pair |
| L04 | every chain closes on ≥ 2 modules |
| L05 | every hop buildable from the approved harness catalogue |
| L06 | SSC, ACDP and MSM present on the rack layout |

## General diagram

The Numbering tab's **General diagram** card draws **all** chains over the
real rack picture: red power / green communication per house convention,
each SSC with its own riser rail, module numbers colour-coded per SSC and a
per-SSC length summary (red metres, green metres, longest hop). If the grid
is not calibrated yet it falls back to per-SSC schematic previews.

## Importing the rack

The rack picture now comes from either path, with no AutoCAD round trip:

- **Configuration tab → Import rack drawing** accepts the engineer's
  **.vsdx** directly — WireFlow opens the package, scans every page, lifts
  the largest embedded picture (the AutoCAD rack) and uses it as the
  underlay at its true sheet position.
- **Diagram tab → Open Visio file → Use as wiring base** does the same
  after you have seen the full drawing.

Binary **DWG** still cannot be read in the browser; the error explains both
routes (Save As DXF, or use the Visio file).
