# Visio desktop integration prototype

This is an early 64-bit Windows COM add-in prototype for Visio 2021. The source
exposes an AYK WireFlow ribbon callback and a nonmodal terminal-recording window.
The source and assembly are not an approved, signed or installed AYK add-in.
There is no add-in login URL. AYK IT must review deployment and access before
installation on employee computers. No registry entries or user settings are
modified by the build and test scripts.
The assembly defaults to COM-invisible, exposing only its add-in and event-sink
classes intentionally. `test-registration.ps1` generates a local registry preview
and checks that internal model and helper classes are not exported; it does not
modify the registry or demonstrate that Visio can load the add-in. The preview
assembly is unsigned and is not a distribution package.

The pilot accepts one SSC chain of 2–48 modules at a time. The engineer enters
its bank and SSC numbers before marking. Before drawing, a top-level tagged draft
with the same bank and SSC identity blocks duplicate generation; remove or undo
the earlier draft before making a replacement. Untagged or grouped shapes cannot
be identified by this guard, and completeness across the drawing is not checked.
In the prototype window the
engineer selects a separate top-level Visio marker shape at each SSC, junction-box
and module terminal; its PinX/PinY page coordinates are recorded in the open
session. Markers inside groups or on another page are rejected because their
coordinates are not directly comparable to the page. The engineer must mark SSC S/N, string NEG/POS, bus B−/B+, junction-box
NEG/POS, then each M1…Mn S/N/NEG/POS. It then proposes the normal R02–R06 and
R11 endpoint connections and adds red power and green communication lines to
the active page. Marker shapes are not deleted. Generated lines are ordinary
editable Visio shapes in one undo scope. This pilot intentionally needs separate
marker shapes because an embedded rack picture is not a set of terminal shapes.
Each generated shape includes user-defined ShapeSheet cells recording its draft
network, bank, SSC, from-terminal, to-terminal and `DRAFT` status. Those cells are editable
annotations: if an engineer moves or edits a wire, they can become stale and do
not prove that the actual wire, connectors or route have been validated. The
prototype currently handles one SSC at a time; terminal labels in these cells are
local to that explicitly numbered chain.
During marking, **Undo last terminal mark** returns to the previous terminal and
blocks drawing until that terminal has been recorded again. After drawing, use
Visio's Undo for the entire generated draft before creating a replacement.
Starting a new chain while marks exist asks before clearing the current session.
As an optional marking shortcut, after recording all four M1 ports the engineer
can select a top-level marker at the M1 centre, then select a marker at each
subsequent module centre in electrical order. The prototype translates M1's four
measured offsets to the next centre in page coordinates. Use it only for modules
with identical orientation and scale; it does not detect mirrored or rotated
modules. Every estimated port must be checked against the actual drawing. The
reference centre is held only in the current session, so it must be selected
again after loading saved marks. It does not change the configured chain order.
The translation is covered by unit checks and a blank Visio document; the
supplied rack's embedded picture has not been validated as a port-coordinate
ground truth by the prototype, and interactive verification remains necessary.
After terminal marking, the engineer may select a proposed connection and use
top-level marker shapes to add or remove ordered route waypoints. A connection
with waypoints is drawn as one editable Visio polyline through those points;
without waypoints it remains straight. These routes are manual draft geometry:
the tool does not infer rails, produce curves or verify bend radii. Changing a
terminal using Undo clears the current chain's routes so stale waypoints cannot
be silently reused. The engineer reviews and approves every resulting route.
The prototype window highlights the next terminal in larger text and offers a
read-only connection preview showing the bank, SSC, each network and terminal
pair, and the ordered route coordinates in Visio's internal inches. This preview
is not a schedule or harness approval and must be checked before drawing.

The engineer may explicitly save partially or fully marked terminals and any
completed manual routes to a local JSON file and reload them on the same saved
drawing path and page ID. Version 3 records routes as well as bank and SSC identity;
version 2 sessions remain readable with no routes. Earlier prototype version 1
files lack that identity and are rejected; the terminals must be marked again. The file
contains the drawing path and terminal coordinates and should be handled under
AYK's drawing-data policy. Reload checks the path, page, count, order and duplicate
coordinates; it does not detect changes made to the drawing at the same path, so
the engineer must check all terminal locations after any drawing edit. Loading a
mapping onto a different copy or a drawing moved to a new path is not supported.

An experimental direct-click event sink has been added to the source, but it is
disabled in the standard build. An out-of-process Visio test hung when trying to
subscribe to mouse events. The callback behavior is tested with simulated events,
but actual Visio callback delivery, coordinate alignment at different zoom/pan
settings, cleanup, and in-process add-in loading must be validated before enabling
it. The marker-selection workflow remains the standard prototype input method.
Developers may build the gated experiment with `build.ps1 -ExperimentalMousePicking`;
it is not approved for engineer use. The optional `test-native.ps1 -Blank
-MouseEvents` check can hang and must only be run in a controlled test session.

These lines are **draft previews only**, not released engineering routes: they
are straight endpoint-to-endpoint lines unless the engineer supplies waypoints.
The pilot does not establish route
channels, bend radii, crossing avoidance, component counts across banks, route
length, harness part number, cable schedule, BOM, electrical release validation,
file history or access control. It does not
yet integrate the existing browser project's configuration or wiring engine.
The supplied engineering specification identifies unresolved directionality,
allowances, and harness approval decisions; these must not be inferred from a
visual match. The engineer must verify every endpoint and route and approve
the final drawing.

Before drawing, the prototype checks the proposed line segments and manually
defined polyline pieces in the current chain, including self-crossings, against
one another and against top-level shapes carrying readable WireFlow draft
metadata on the same page for 2D intersections and overlaps. It uses the current
begin/end points of the tagged shapes; these are straight approximations even if
the engineer has edited the geometry. Shared endpoints are not
counted as crossings; endpoint-to-interior contacts and overlapping collinear
segments are counted. If any are found, the engineer sees a count and up to
three pairs of terminal names and can cancel or generate the draft for review.
It warns when a shape with a readable `DRAFT` status has unreadable metadata or
endpoints, or is tagged as a manual polyline whose full geometry is not inspected.
Its bank/SSC identity still prevents a duplicate chain. The check does not inspect untagged shapes, grouped shapes, exact
curve geometry, actual clearances, channel separation or cable routing, and zero
reported crossings is not evidence of a safe or approved installation.

Build locally with `powershell -NoProfile -File visio-addin/build.ps1`. On a
computer with Visio installed, `powershell -NoProfile -File
visio-addin/test-native.ps1` copies the supplied golden file into the ignored
build folder, adds test lines to that copy through an invisible Visio instance,
and checks coordinates and shape count before saving. Pass `-Blank` to test a
new document or `-Reopen` to additionally open the saved copy again. It does not
modify the original. Running this test may require local COM permission.

The supplied drawing also did not open in the invisible COM test, even after
disabling document macros and automatic refresh. The original remains unchanged;
the hang needs investigation in an interactive Visio test environment.

Before distribution, IT needs to choose an installation method, code-signing
and trusted publisher policy, user-versus-machine registration and access
control. Next development work includes verifying Visio's actual add-in loading
and ribbon callback, a safe installer, direct point picking, mapping verification,
multiple banks and SSCs, importing the browser engine's output, route rules and
conflict checks, reconnecting edits, and acceptance against the released BOM.
