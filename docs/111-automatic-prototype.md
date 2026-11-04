# 111 automatic wiring prototype

From PowerShell:

```powershell
Set-Location G:\WiringTool\wireflow-simplified
node prototype-server.js
```

Open http://127.0.0.1:8082/ (also linked from the studio home), choose the supplied
`C:\Users\admin\Downloads\IO\111.vsdx`, and click **Generate wiring**.
Download the rack SVG or A3 SVG; the A3 result is previewed on the page.

This integrates the existing reference-candidate generator, including detected
ports, series connections, curved bottom links and rack-side SSC/JB routes.
It requires local Python with Pillow and OpenCV, plus Node. It accepts only the
exact hash-checked sample: other racks must use the general editor. It does not
replace the general editor's routing engine or establish general detection accuracy.

Originals are preserved. Inputs and results are written to separate UUID folders
under `prototype-output/`, excluded from Git. The service listens only on loopback.
Stop it with Ctrl+C. Generated drawings retain their draft labels: visual agreement
is not engineering release, physical bend-radius verification or cable suitability.
