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

## Electrical diagram (DWG2527 format, second template)

- Same project folders as the wiring diagram. Projects have 3, 6 or 9 SSCs; the engineer
  decides how they split into banks (one MSM per bank). The MSM back shows SSC ports 1–6, so
  more than 6 on one MSM is pointed out, never blocked.
- Parts drawn: MSM back, SSC front/back, junction box front, module front (no backs of the
  module or junction box), from AYK's DXFs
  (`tools/make-elec-parts.js` → `assets/elec/parts.json`). Every bank has an ACDP (no ACDP
  drawing yet); only the junction box is gone.
- MSM models by SSCs served: 3, 6 or 9 (`ELEC_MSM_MODELS`); the engineer picks each bank's model.
  Every model is drawn with the same MSM.dxf (AYK, 23 Nov 2026); a smaller model uses SSC ports
  1 to its count. For reference, the 3-SSC MSM (AYK picture): Cloud, EMS, PCS / SSC1P–3P /
  SSC1B–3B / Spare; round Estop1–2 / Estop3, Ex.FanFB, Dry Contact, RemoteE / PowerP, PowerB,
  Valve 1, Valve 2. The 6-SSC MSM is DWG2527 sheet 1 (P and B alternate along each row).
- The junction box front IS kept on the electrical diagram (AYK, 20 Nov 2026, reversing the
  earlier "no junction box"); two junction boxes: JUNCTION BOX2.dxf (2 Bus connectors) and JUNCTION BOX4.dxf
  (4 Bus connectors), named left to right Bus+, Bus−(, Bus+, Bus−) — confirmed 20 Nov 2026.
  The wiring diagram keeps its junction boxes too.
- Safety (AYK, 20 Nov 2026): the junction box HVIL wire to the SSC (SSC Ext-HVIL) is never wired
  on new projects — the wire is high voltage and the connector is not rated for it. Released
  projects are not changed. Kept in `ELEC_NOT_WIRED` (`js/elec.js`).
- Ports (all confirmed by AYK, 20 Nov 2026), found on the drawings by `tools/make-elec-parts.js`:
  - MSM back (9-SSC MSM): top row Cloud, EMS, PCS, Spare; then SSC1P, SSC1B … SSC9P, SSC9B row by
    row, left to right; Estop1–9 then RemoteE (4-pin) in reading order; Dry Contact (2-pin),
    PowerP/PowerB (3-pin), Ex.FanFB (5-pin), Valve 1/Valve 2 (7-pin); the 19-pin connector is unused.
  - SSC back: PowerP, PowerB, CommP, CommB, Ext-HVIL (never wired), Cooling Fan, Estop.
  - SSC front: S, N, S+, B+, B−, S−. The module carries no ports on this diagram.
- Connection rules (only confirmed ones live in `ELEC_RULES`, `js/elec.js`):
  - MSM SSCnP → SSCn CommP, Cat6 (confirmed 20 Nov 2026). n is the SSC's place in its bank, in
    name order (MSM-2 serves SSC7, SSC8 … from its SSC1P, SSC2P …, as on DWG2527).
  - MSM Estop n → SSCn Estop, 4 × 0.518 mm² (confirmed 20 Nov 2026), same n.
  - MSM Valve n → LP16-7 female to LP16-7 male connector → Master Valve n (5 × 0.3 mm²),
    one per valve in use (confirmed 20 Nov 2026).
  - The SSC Cooling Fan port is one connector, pins 1–6 (AYK, 20 Nov 2026).
  - ACDP back, left to right: SSC3B, SSC3P, SSC2B, SSC2P, SSC1B, SSC1P, MSMB, MSMP,
    ACPowerInB, ACPowerInP. ACDP SSCnP → SSCn PowerP (red), SSCnB → SSCn PowerB (blue);
    ACDP MSMP/MSMB → MSM PowerP/PowerB; customer normal power / backup UPS → ACPowerInP/B
    through an inline connector (confirmed 20 Nov 2026 from AYK's ACDP1 picture).
  - Always drawn, never asked (AYK, 20 Nov 2026): MSM RemoteE → client-side remote E-stop
    (LP16-4 inline, 4 × 0.518 mm²) and MSM Dry Contact → client-side thermal runaway status
    signal (pins 1–2, 2 × 0.518 mm²).
  - Each ACDP feeds three SSCs (confirmed 20 Nov 2026): a bank has one ACDP per three SSCs
    (ACDP 1 → SSC1–3, ACDP 2 → SSC4–6, ACDP 3 → SSC7–9, each from its own SSC1–3 ports).
    The first ACDP also feeds the MSM; every ACDP takes the customer's AC in.
  - The backup comm link (MSM SSCnB → SSCn CommB) is NOT wired (AYK, 20 Nov 2026); those ports
    stay unconnected (`ELEC_NOT_WIRED`).
- Sheets are numbered 1, 2, 3 … n in this order (`elecSheets`, order confirmed by AYK 23 Nov 2026): two notes sheets, then bank by
  bank: MSM back, SSC backs (three per sheet), one sheet per ACDP back, junction box and SSC
  fronts (three SSCs per sheet).
- Same rack = AYK harness (solid); different racks = inline connector + customer cable (dashed).
- Never guess fan counts (1 to 6 per SSC), port maps or bank splits: the engineer answers them
  on the setup page and confirms it.
- Export: the setup page's "Export PDF" (enabled once the setup is confirmed) writes every sheet
  as one A3 PDF (`elecPdf` in `js/elecsheet.js`). Each connected port gets a lead in its cable's
  colour, dashed between racks, labelled "To <part> <port> · Sheet n". Blocked ports never get a
  lead. The ACDP is a labelled schematic until AYK supplies its drawing. Title block fields
  (document no., rev, drawn by) are kept with the setup and do not un-confirm it.
