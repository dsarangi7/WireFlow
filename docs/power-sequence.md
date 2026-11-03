# AYK series power sequence

The user confirmed on 3 November 2026 that every string uses:

- SSC string positive to the highest-numbered module positive.
- Each higher-numbered module negative to the next lower-numbered module positive.
- Module 1 negative to SSC string negative.

The netlist, polarity validation, picture wiring and legacy front-view preview
now use this same electrical connectivity. A picture polyline can be stored in
either drawing direction; its terminal pair is the same connection. Communication
endpoints and harness catalogue lengths are unchanged. Counts may differ by SSC.

The former picture-only reference selector has been removed. Old saved sessions
retain their markings but must generate again before using the new workspace's
export controls. Regeneration clears prior delivery/print flags. Existing route
control points are retained and must be reviewed against the changed endpoints.

V03 checks both SSC power endpoints and every descending module connection.
V02 checks incoming positive and outgoing negative degree. These checks do not
confirm visual port detection or physical clearance. Automatic port candidates
remain unconfirmed, and power crossings or unresolved checks continue to block
the workspace exports.

This does not supply the missing rules for multiple strings on one SSC.
