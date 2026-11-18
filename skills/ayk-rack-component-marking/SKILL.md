---
name: ayk-rack-component-marking
description: Guide or implement AYK battery-rack configuration and ordered click-to-record component identification on a drawing. Use when collecting rack counts, recording MSMs, SSCs, junction boxes, assigned modules and ACDPs; this skill does not authorize guessing terminals or electrical topology.
---

# AYK rack questionnaire and ordered component recording

## Purpose

An engineer imports a rack drawing, answers a short configuration questionnaire,
then identifies components by clicking them in a prescribed order. Every click
must have an explicit identity and purpose before it is recorded. Minimize port
clicking: component identification and terminal identification are separate tasks.
This is the agreed workflow, not a claim that every UI behavior is implemented.

## 1. Ask before marking

Collect and retain the following for each rack/page:

1. Rack/page identity, sufficient to distinguish it from other racks in the same
   project. Do not require vessel or project metadata merely to import an SVG.
2. Module type from the fixed AYK catalogue. Load its dimensions in mm. Pattern
   means horizontal rack-column centre spacing; module height is not row pitch.
3. Number of banks represented on this drawing.
4. For each bank: number of MSMs, number of SSCs, exact SSC numbers/labels,
   number of modules assigned to EACH SSC, junction-box count and SSC-to-JB
   assignments, and ACDP count.
5. If using the current grid-based tool: columns/rows including empty positions,
   actual horizontal/vertical spacing, and the two drawing calibration clicks.

Present a compact editable summary before recording components. SSC numbers
must be explicitly entered: one rack might use SSC1–6 and the next SSC7–12.
Do not reset identities or force every SSC to have the same module count.
Do not infer electrical order from nearest-neighbour geometry.

Validate required entries, unique SSC identities in their intended project
scope, positive integral counts and consistency of assignments. ACDP count
may be zero. Do not impose the prototype's implementation limits as universal
engineering limits. Multiple strings per SSC need the actual approved mapping;
the user has said rules exist, but that mapping has not been supplied.

## 2. Generate one ordered recording queue

For each bank, in order:

1. MSM1, MSM2, etc. for that bank (using retained project identities).
2. The first configured SSC, using its actual number, not its queue index.
3. That SSC's assigned junction box.
4. Its assigned modules in ELECTRICAL order: M1, M2, ... MN.
5. The next SSC, its JB, and its own M1 ... MN. Repeat for every SSC.
6. Identify any additional declared junction boxes not already recorded; do
   not invent connections for an unused device.

After bank/SSC/module recording, mark ACDP1, ACDP2, etc. as the final component
stage. ACDPs are labels/identification only; no ACDP wiring was requested.

Example: one bank, one MSM, SSC7 with 12 modules and SSC8 with 10 modules:

```text
MSM1
SSC7 → assigned JB → S7-M1 → S7-M2 → ... → S7-M12
SSC8 → assigned JB → S8-M1 → S8-M2 → ... → S8-M10
Any remaining declared JB
ACDP1 → ACDP2 (if declared)
```

A two-pair JB has +, −, +, − ports and can serve two SSCs. Allocate pairs in
SSC marking order; with one SSC leave the unused pair empty. When the queue
asks for a previously recorded shared JB, select its existing identity/marker
instead of creating a second box at a different position.

## 3. Show a big command before every click

Display the current bank, component identity, progress and one instruction:

```text
BANK 1 · SSC7 · MODULE 3 OF 12
Click the centre of module S7-M3 on the drawing.
```

For SSC/JB/MSM stages use the corresponding name. Highlight the next target
type and keep previous recorded markers visible. The queue selects the type;
the engineer should not have to switch among expert tabs or device tools.
Do not display the full list of future port-click commands as the main task.

## 4. Validate and record each click

- Convert screen coordinates through the current SVG view/zoom/pan transform
  into source drawing coordinates. Never store raw screen pixels.
- Store rack/page, bank, component kind, unique identity, source position,
  queue key/index and any SSC/module/JB assignment. Keep optional grid slot
  separate from the exact click position.
- A module record includes its SSC identity and electrical index M1..MN.
- Reject clicks outside the permitted drawing/grid or on an occupied component
  position, except explicit reuse of a shared JB. Give a clear corrective message.
- Do not silently accept a click as a different component from the displayed command.
- Save a valid record, update its visible label, then advance exactly one step.
  On save failure preserve the work, show retry and do not imply it is saved.
- Fit/zoom/pan must not record a component. Keyboard shortcuts must not fire
  while editing form fields.

## 5. Corrections, persistence and completion

- Provide Undo last component mark. Restore the previous queue command.
- Redo is allowed only if the restored identity and assignment still match.
- Retain declarations and progress across save/reopen; resume at the first
  unrecorded queue item, not an inferred component count.
- Warn before restarting with changed counts: identities, assignments, dependent
  port maps/routes and generated output may become stale. Never silently erase
  existing work or preserve an incompatible generated drawing as current.
- Detect duplicate/missing components, modules assigned twice, wrong SSC module
  totals, unmarked JBs, missing MSMs/ACDPs and inconsistent saved queue keys.
- At completion show per-bank/per-SSC recorded versus declared totals. Do not
  generate a complete-looking diagram while declared components are missing.

## 6. Ports and trays are separate follow-up stages

Once component locations are recorded, detect terminal positions within those
components using reviewed templates and transforms. Ask for exception review,
not routine manual clicks on every terminal.

Confirmed front-view left-to-right sequences:

- Module: S, N, −, +.
- SSC: S, N, String +, Bus +, Bus −, String −.
- Two-pair JB: +, −, +, −.
- MSM terminal map is not supplied; do not fabricate it.

Missing or ambiguous detections must stay visibly unresolved. Do not promote
candidate positions to confirmed endpoints without review.

Engineer marks allowed tray paths once per rack, including bends and junctions.
This may occur immediately after calibration or after component marking. Save
and reuse the paths. Tray clicks must never become component marks and vice versa.

## 7. Verification when implementing this workflow

Read the project's AGENTS.md. Test variable SSC IDs/counts, different module
counts within one rack, multiple banks, a shared JB, zero ACDPs, duplicate marks,
undo/resume/save failure, changed configuration and coordinate conversion after
zoom/pan/fit. Use a separate test project and preserve source drawings.
Run the actual regression suite and live click tests where available. Report
what was tested, and do not claim a successful real rack recording from mocked
DOM tests alone.

Keep this skill local unless the user separately authorizes publication.
