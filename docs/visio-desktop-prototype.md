# Visio desktop integration prototype

This is an early 64-bit Windows COM add-in prototype for Visio 2021. The source
exposes an AYK WireFlow ribbon callback and a nonmodal terminal-recording window.
The source and assembly are not an approved, signed or installed AYK add-in.
There is no add-in login URL. AYK IT must review deployment and access before
installation on employee computers. No registry entries or user settings are
modified by the build and test scripts.

The pilot accepts one SSC chain of 2–48 modules. In the prototype window the
engineer selects a separate top-level Visio marker shape at each SSC, junction-box
and module terminal; its PinX/PinY page coordinates are recorded in the open
session. The engineer must mark SSC S/N, string NEG/POS, bus B−/B+, junction-box
NEG/POS, then each M1…Mn S/N/NEG/POS. It then proposes the normal R02–R06 and
R11 endpoint connections and adds red power and green communication lines to
the active page. Marker shapes are not deleted. Generated lines are ordinary
editable Visio shapes in one undo scope. This pilot intentionally needs separate
marker shapes because an embedded rack picture is not a set of terminal shapes.

These lines are **draft previews only**, not released engineering routes: they
are straight endpoint-to-endpoint lines. The pilot does not establish route
channels, bend radii, crossing avoidance, component counts across banks, route
length, harness part number, cable schedule, BOM, electrical release validation,
file history, access control, or saved/reloaded terminal mappings. It does not
yet integrate the existing browser project's configuration or wiring engine.
The supplied engineering specification identifies unresolved directionality,
allowances, and harness approval decisions; these must not be inferred from a
visual match. The engineer must verify every endpoint and route and approve
the final drawing.

Build locally with `powershell -NoProfile -File visio-addin/build.ps1`. On a
computer with Visio installed, `powershell -NoProfile -File
visio-addin/test-native.ps1` copies the supplied golden file into the ignored
build folder, adds test lines to that copy through an invisible Visio instance,
and checks coordinates and shape count before saving. Pass `-Blank` to test a
new document or `-Reopen` to additionally open the saved copy again. It does not
modify the original. Running this test may require local COM permission.

Before distribution, IT needs to choose an installation method, code-signing
and trusted publisher policy, user-versus-machine registration and access
control. Next development work includes verifying Visio's actual add-in loading
and ribbon callback, a safe installer, direct point picking, persistent mappings,
multiple banks and SSCs, importing the browser engine's output, route rules and
conflict checks, reconnecting edits, and acceptance against the released BOM.
