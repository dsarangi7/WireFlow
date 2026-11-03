# SVG-first import (early version)

Open WireFlow and select **Import SVG**, or drop one SVG onto the import card. A device-local drawing record is
created automatically, and the existing marking workspace opens. Existing
projects are available under **Existing projects**. No name or vessel details
are required for this entry path.

The import screen and workspace toolbar display the AYK logo supplied for the
internal tool; the original icon file is not modified.

For SVG-based drawings, **Save session** downloads a versioned JSON file with
the saved configuration, markings and SVG. Use **Open saved session** on the
home screen to create a separate local copy. Apply or save any pending form
edits first; unapplied edits are not included. A reopened session starts as a
draft and its engineering checks must be reviewed again.

The import preserves the drawing as a vector image. It removes the standard
SVG document type declaration and Visio's proprietary foreign objects, keeping
the SVG fallback. It rejects malformed XML, entity declarations, scripts,
event handlers, animations, external references and unsafe CSS. Local
fragment references and ordinary Visio styles are supported. Some SVGs may
still require conversion before import. Existing image-based SVG rendering
does not provide individual SVG element selection.

This is the first stage of the Wiring Studio refactor. The existing grid,
marking, routing, validation and draft export remain in use. Their controls
appear in a collapsible panel next to the drawing. Drawing output
requires engineering review; this feature does not approve electrical rules.
Exports are blocked while SSC terminals are missing, supported checks fail,
power routes cross or touch, or the picture convention differs from the netlist.
The experimental 111-rack picture convention currently cannot be exported.
The draft PDF command opens the browser print dialog from the workspace.
After generating a draft, **Mark components and ports → Advanced: adjust a
draft route** offers rounded-L and C-shaped suggestions for module links and
manual curve control points for SSC routes. These are editable visual drafts;
they do not establish physical clearance or automatically detect rack rails.
**Suggest bottom curves** proposes separate power and communication curves
for consecutive marked modules spanning columns in the bottom row of a chain.
It refuses to apply them if the resulting power drawing crosses or touches.
Press Space or F to fit and center the drawing, Ctrl+Z to undo a component mark, Ctrl+Shift+Z to
redo an undone component mark, or Escape to cancel an active terminal or
route-marking action. Redo is limited to the current editing session and a new
mark clears the redo history. Undoing a component requires terminal review;
redo does not restore cleared terminal positions or routes.
