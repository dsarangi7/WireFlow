# Automatic rack rail routing

Use the general SVG studio for every rack. Declare component counts and each
SSC's identity/module count, then mark the components in order. Run detection
and review the detected terminal positions before generating wiring.

Unedited SSC-to-module and SSC-to-junction-box connections now use a general
coordinate-based router. It infers module face bounds from terminal positions
and grid pitch, infers SSC body bounds from its terminal strip, searches neighboring rail corridors with rounded bends and
selects the shortest valid sampled candidate. It avoids inferred intervening
module faces and already routed power wires. Nearby aligned endpoints may use
a direct connection. Bus links reserve their escape corridors first. Explicit
engineer route edits retain precedence.

This uses no sample filename, fixed rack module count or 111-specific positions.
Existing automatic bottom-transition curve suggestions remain in generation.
Press Generate wiring again in an older project to refresh automatic routes.

An unavailable power route is left empty so the existing invalid-route gate
blocks export rather than silently drawing a diagonal. The greedy candidate
search can fail even if a different joint routing exists. It is not a global
shortest-path optimizer. Later groups can still conflict with earlier groups;
the final power crossing gate remains required.

The bounds are inferred, not detected physical rail/obstacle geometry. Routing
does not certify bend radii, harness lengths or clearance. Automatic component
recognition is not implemented: engineers still identify components; terminal
matching is constrained by those marks and requires review. Multiple strings
per SSC remain unsupported pending approved topology rules.

## Verification on 4 November 2026

The general production router was run on the supplied rack's measured candidate
ports, with all fixture-specific device waypoints removed. It produced 140/140
connection paths, no empty paths and no detected power-wire crossings/touches.
The rendered output was visually inspected. This demonstrates the router on
that geometry; it does not validate terminal detection on every other rack.

Reproduce with new output paths:

```powershell
node tests-manual/evaluate-general-routing.js G:\WiringTool\rack-input-baseline.png G:\WiringTool\rack-module-port-candidates.json G:\WiringTool\rack-device-port-candidates.json G:\WiringTool\new-routing.svg G:\WiringTool\new-routing-report.json
```

The evaluator reuses the known fixture's grouping only as test input. Production
routing itself has no fixture checks or fixed SSC/module count.
