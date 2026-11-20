# AYK rack wiring rules (confirmed by AYK engineering, Nov 2026)

## Parts and terminals (left to right on the rack front)

| Part | Terminals | Notes |
|---|---|---|
| Battery module | S, N, −, + | S/N comm, −/+ power |
| SSC connector strip (6 under each SSC) | S, N, S+, B+, B−, S− | S+/S− string, B+/B− bus |
| Junction box (top of each SSC column) | +, −, +, − | two power pairs P1, P2 |
| ACDP, MSM | — | labelled only, wired at the back, never wired on the front view |

The engineer teaches each part once (box + terminal clicks); roles come from this order
(`CAD_TERMINAL_ROLES` in `js/app.js`). SSC1 is the SSC closest to the MSM, then the next closest;
the engineer confirms every SSC/ACDP/MSM name and each SSC's module count.

## Connections

- One SSC = one string = one junction box + the modules the engineer gives it.
- Power, series: SSC S− → M1 −, Mk + → Mk+1 −, last + → SSC S+.
- Comm: SSC S → M1 N, Mk S → Mk+1 N, last S → SSC N.
- Bus: SSC B+ → JB +, SSC B− → JB − on the pair chosen once (P1/P2), same on every JB.
  An SSC with no JB in its column is mapped by the engineer to a JB and side; two SSCs may share a JB.
- Module labels are S<ssc>-M<k>; S1-M1 is the module wired to S− and N.

## Routing

- Power cables never cross each other anywhere in the rack. Power/comm crossings are allowed.
- Short jumps between neighbouring modules; long cables run in the trays (the channels between
  module columns) and along the rails (gaps between rows, or above/below the rack).
- For B+/B− the engineer picks the tray with the pair: CL = column left, CR = column right
  (rack-wide, with a per-SSC override).
- Never route over a part, never leave the rack outline. Report a crossing instead of detouring.
- No cable may pass within 15 mm (`CADW_PORT_R`, scaled) of a port it does not connect to.
  Unknown AYK clearance: 15 mm is our assumption.
- Long cables take the shortest crossing-free way (e.g. under the rack rather than over the top).
- Scale: AYK module = 400.45 mm wide. `CADW_K = module width / 400.45`; every fixed distance
  goes through `cadwU(mm)`. Rack 111 is 1:1, rack 1111 ~1:44.

## Numbering

- Only the engineer numbers, by clicking modules in order per SSC. The guide may highlight good
  next modules or a crossing-free suggestion in green; it never numbers by itself.
- Clicks are saved as they happen (`wiring.draft`); Esc pauses. A finished numbering
  (`wiring.orders`, stored by module position `cadCompKey`) is kept even if the wiring fails.
- Never drop or overwrite a numbering as a side effect. Only "Delete wiring" / "Start numbering
  over" (both confirmed) remove it. Number again / Delete / Undo exist after wiring.
- Finished numberings go to the library (`js/numlib.js`, by rack grid layout, scale-free);
  racks of the same layout are offered "Use this numbering", same project first.

## The wiring sheet and PDF

- AYK DWG2396 (S10164) A3 landscape: zoned border, legend (comm green Cat6, main power red
  1×95 mm², customer power yellow/blue), Notes 1–2, confidentiality and tolerance blocks,
  AYK POWER LTD. title block. Arial / Arial Bold only.
- Editable: title-block fields only (up to 4 revision rows, document/design number and name,
  bank size/weight, sheet). SCALE always "NTS". Everything else is fixed.
- SSC and MSM names and S1-M1… labels appear on the sheet.
- Customer plug leads (blue = A, yellow = B) leave the RIGHT end of every JB going up past the
  rack top, labelled only "Note 2"; a checkbox hides them. Grounding point (Note 1) at the
  rack's bottom-right.
- Layout is in real mm via `sheetUnit(components)`.
- Crossings: red ring + clickable list entry that zooms there. Cable over a port: orange ring.
- Editing: zoom 0.6×–40× (wheel, + − 0, drag to pan), drag a cable (across a section moves it,
  along a section moves the next bend, near a terminal keeps a short stub), double-click for
  straight/bent/curved and the planner's other routes (length in m, crossings), right-click undo.
- Output is PDF only. No DXF, CSV or Visio export.
