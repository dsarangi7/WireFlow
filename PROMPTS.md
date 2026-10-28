# Codex prompts — Premium import-to-PDF flow (paste one at a time, in order)

Run each prompt as its own Codex session/turn. Do not start the next one until
the previous one is committed, pushed, and `node tests/drawing.test.js` is
green. Context lives in `AGENTS.md` — Codex reads it automatically.

---

## Prompt 1 — Premium shell + guided flow skeleton

```
Read AGENTS.md first. Do not change any engine behaviour.

Today the app is a row of expert tabs (Configuration, Numbering, …). Engineers
find it intimidating. Rebuild the post-login experience as a premium guided
flow while KEEPING all existing tabs reachable under an "Advanced" section:

1. Add a design-token layer at the top of styles.css (CSS variables):
   --bg, --surface, --surface-2, --border, --text, --muted, --accent
   (refined orange consistent with the existing --accent), --ok, --warn,
   --danger, --radius (12px), --shadow (soft, layered). Use a clean
   light theme, generous whitespace, Inter/system font stack.
2. New "workspace" home screen shown right after creating/opening a project:
   a centered hero card with the project name, a 5-step progress stepper
   (1 Import rack · 2 Calibrate · 3 Number & chains · 4 Wire & validate ·
   5 Export PDF) rendered from a single `FLOW_STEPS` array, and one large
   primary button "Import rack drawing" (accepts .vsdx, .dxf, .png, .jpg,
   .svg) plus a small ghost button "Continue where I left off".
   Steps that are already complete (derived from project state:
   underlay set / cal saved in config.numbering.cal.ok / chains applied /
   wiring shown) show a green check; the current step is highlighted.
3. Clicking a step navigates to the existing tab that serves it
   (Import→Configuration, Calibrate+Number+Wire→Numbering, Export→new
   export screen from Prompt 3). No tab is removed.
4. All new UI strings in English. New markup uses the design tokens.

Acceptance: `node tests/drawing.test.js` still passes; add assertions for
FLOW_STEPS and the step-completion derivation (pure functions, exported
through the app factory like the rest). Commit + push to main.
```

---

## Prompt 2 — Import Rack: one button, full pipeline, honest errors

```
Read AGENTS.md. On the workspace home from the previous step, make the
"Import rack drawing" button run the ENTIRE existing import pipeline
automatically — the engineer must not have to know about tabs:

1. On file pick:
   - .vsdx  → run the existing underlayFromVsdxFile() pipeline
     (js/app.js) which lifts the embedded CAD picture; then ALSO open the
     document with vsdxOpen and show a compact quality report card:
     pages found, embedded picture found (yes/no + size), layer count,
     whether the largest embedded picture was set as the wiring base.
   - .png/.jpg/.svg → current image-underlay upload path.
   - .dxf → current DXF path.
2. If the vsdx has NO embedded picture or nothing renderable, show a
   premium error card (icon + title + explanation + "Pick another file")
   — never a raw console error. Same for zip-parse failures: catch, show,
   log details to console for us.
3. On success: set the underlay (existing saveProject fields:
   underlay_url/kind/x/y/w/h), then AUTO-ADVANCE the stepper to
   step 2 (Calibrate) with a success toast naming what was imported.
4. Keep a small "Advanced import options" disclosure on the same screen
   that links to the Configuration tab for manual fit values.

Constraints: reuse the existing pipeline functions — do not duplicate
vsdx parsing logic. The picture blob travels on the foreign record; never
re-fetch hrefs (regression: 'Failed to fetch').

Acceptance: existing suite green; add tests for the new quality-report
verdict function (pure function: given {pages, foreigns, picture} →
{ok, reason}). Commit + push.
```

---

## Prompt 3 — Finish the journey: wiring summary + Export PDF

```
Read AGENTS.md. Complete steps 4 and 5 of the stepper.

Step 4 (Wire & validate): on the workspace screen show a live summary card
of the current state: modules numbered X/Y, chains per SSC with cable
totals (fvSummary / layoutTotals already compute these), validation
pass/fail chips from runValidations + layoutValidate, and a primary
button "Open wiring view" (goes to the existing front-view wiring card).

Step 5 (Export PDF): add an "Export PDF" screen that renders the finished
deliverable for print:
1. Compose an A3 landscape print document: the generated wiring sheet
   (buildSheetLayout → existing SVG) AND the front-view wiring over the
   real rack picture (fvSvg), each on its own page, plus a compact
   schedule/BOM table page. Add a small header: project name, date,
   "AYK WireFlow".
2. Implementation: a dedicated hidden print container + @media print CSS
   (A3 landscape, exact colors, page-break-after) and window.print() from
   the Export button — the browser's Save-as-PDF produces the file. No
   new dependencies, no CDN scripts.
3. Also keep the existing DXF/SCR/VSDX export buttons reachable here under
   "Other formats".
4. After print, offer "Mark project delivered" which saves a delivered
   flag in the project config and shows a completion screen.

Acceptance: suite green; add a test for the print-document builder
(returns the ordered list of {title, svg} pages). Verify the print CSS
renders both A3 pages by inspecting the DOM in a smoke check. Commit + push.
```

---

## Prompt 4 — Premium polish pass (only after 1–3 are done)

```
Read AGENTS.md. Do a UI polish pass across the new flow only:
- Consistent spacing scale (4/8/12/16/24), one accent color usage rule
  (primary actions only), consistent button hierarchy (primary / ghost /
  danger), focus-visible outlines for accessibility.
- Empty states with one-line guidance for every step (no import yet,
  not calibrated, no chains applied, validations failing).
- Toast style unified (success/warn/error) using the design tokens.
- Stepper animates between steps (respect prefers-reduced-motion).
- Responsive down to 1280px wide; nothing below 320px is required.
Do NOT touch js/engine.js, js/vsdx-import.js, js/frontview.js logic.
Suite must stay green. Commit + push.
```
