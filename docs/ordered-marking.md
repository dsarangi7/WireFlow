# Ordered bank and component marking

The picture workspace asks the engineer to declare each bank's MSMs, SSCs,
modules per SSC, junction boxes and ACDPs. Counts come from the engineer's
reading of the imported drawing; the importer does not detect these devices.

1. Enter the number of banks and update the bank rows. Set each bank's counts.
2. Set and align the regular rack grid, including empty positions. It must have
   enough distinct positions for the modules, SSCs, MSMs and ACDPs.
3. Select **Start ordered marking**. Restarting replaces existing component
   marks and terminal measurements; editing count fields alone does not change
   an active plan.
4. Follow the large command above the picture: Bank 1 MSM1, SSC1, its junction
   box, then SSC1 M1 through the declared last module. Continue with SSC2 and
   its junction box and modules, then the next bank. Multiple MSMs in a bank
   are requested before that bank's SSCs. SSC identities increase across banks.
5. Mark **ACDP1, ACDP2, ...** after all banks' SSC chains. These are labels only;
   the tool adds no ACDP wiring. Extra declared junction boxes are requested
   after their bank's SSC chains and before the final ACDPs.
6. Mark the four ports on one representative module, then mark each SSC's
   communication S/N, power NEG/POS, bus B−/B+ and its junction-box NEG/POS
   terminals. SSC port marking requests the first SSC without saved terminals.
7. Generate the draft. Each SSC's marked M1, M2, ... order becomes a manual
   layout; the automatic nearest-SSC assignment and path optimizer are bypassed.

Module, SSC, MSM and ACDP centres snap to the calibrated grid. Junction-box
centres are free picture positions, so boxes above the grid can be marked.
At each SSC's junction-box step, select its box identity. To share a previously
marked box, explicitly select its identity and click its existing marker.
No new box is inferred when the bank has fewer boxes than SSCs. Every declared
box must be marked; unused or missing box counts prevent generation.

The per-bank summary shows marked/expected counts. Missing steps block generation;
repeated grid positions cannot create extra components. **Undo last component
mark** returns to that exact command, preserving earlier order and clearing SSC
port measurements so changed positions cannot reuse stale terminals. Completed
component clicks, calibration, declared counts and completed terminal sets save
to the project's local IndexedDB record. Reloading resumes the next component.
Saving failures block further picture clicks and generation until **Retry saving**
succeeds. A partly marked terminal set is restarted after leaving the screen.

`config.numbering.marking` stores version, per-bank counts and ordered records.
Each record has the step key and picture point, plus a grid slot or junction-box
identity. `config.layout` is written with `mode: 'manual'`, explicit SSC slots,
junction-box identities, module orders and slot-to-SSC assignments. Device labels
are retained in the preview, SVG, PDF and editable draft Visio output.

Existing projects keep their saved exports and marks until the engineer starts
ordered marking. They must declare counts and restart before regenerating through
this guided workflow. The regular-grid limit remains 12 columns by 24 rows;
modules within each bank currently share the declared count per SSC. This change
does not implement rail routing, bend radii or crossing checks. Lines remain
direct draft previews; physical terminal sets that are not marked are omitted
and reported in the existing generation warning.
