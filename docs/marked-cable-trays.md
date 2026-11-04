# Mark cable trays once per rack

In the studio's **Align the drawing** section, align the rack first, then:

1. Click **Mark a tray path**.
2. Click along an allowed cable-tray boundary, including each corner.
3. Click **Save tray path**. Repeat for other boundaries or branches.
4. Continue component marking/detection and **Generate wiring**.

Cyan dashed overlays show the saved paths. Intersections and shared endpoints
join automatically. Undo removes the current point; Cancel discards an unfinished
path. Remove last tray path removes the most recently saved path. Paths are
saved in the project's calibration and included in saved sessions. Re-aligning
the same image preserves the paths; a replacement drawing requires review.

Generation and studio export now require a saved tray network. Long automatic
routes use shortest paths in the marked network. Straight terminal branches
are limited to 65% of the diagonal grid pitch. Small rounded visual corners are
checked again against inferred component faces, known ports and power routes.
Nearby aligned direct connections remain allowed. Explicit route edits are
also checked for leaving the trays; off-tray drafts block export.

Mark parallel allowed boundaries/lanes where separate power wires need separate
paths. The router cannot put two power cables onto the same zero-width marked
line without a crossing/touch failure. It does not infer tray width or synthesize
physical cable lanes. Disconnected or blocked networks can leave routes
unavailable; there is no fallback diagonal. Routing is sequential and may need
engineering adjustment even when another joint solution exists.

The network is limited to 100 paths and 500 total segments. Snap nearby junctions
by clicking their actual intersection; the app joins geometric intersections,
not visually close but disconnected endpoints. Current automated checks cover
network joins, disconnected networks, blocked edges, adherence, and export gating.
Live engineer validation of tray marking and a complete new rack remains needed.
