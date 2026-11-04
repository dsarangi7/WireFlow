# AYK module dimensions

In **Configure the rack**, select **Module type**. The sixteen AYK-supplied
families have fixed millimetre values for width, depth, height, Pattern, rack
depth excluding cable trunk, total rack depth, minimum service area and
recommended service area measured from the front pillar. Supplied notes are
retained verbatim; no meaning is inferred for the 122mm and 110mm notes.

The selection and a dimension snapshot are saved in the project configuration
as `moduleType` and `moduleDimensions`, and travel with its saved session.
Old projects remain unselected until an engineer chooses their module family.
One selection currently applies to the rack; mixed module families in one rack
are not modelled by this selector.

Pattern is the horizontal centre-to-centre rack column spacing, confirmed by
AYK. Selecting a type fills and locks Column spacing to its Pattern value.
Changing an existing rack's spacing invalidates its calibration, layout and
delivery status; align the drawing again and regenerate. Module height is not
assumed to be vertical grid pitch: mounting gaps remain separate. Measured
terminal detection remains authoritative for port coordinates. This catalogue
does not supply terminal offsets, SSC/MSM dimensions or cable bend-radius rules.
