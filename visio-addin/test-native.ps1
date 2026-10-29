param([string]$Sample = 'C:\Users\admin\Downloads\DWG2512-01 S10164 Wiring Diagram.vsdx', [switch]$Blank, [switch]$Reopen)
$ErrorActionPreference = 'Stop'
$dll = Join-Path $PSScriptRoot 'build\Ayk.WireFlow.VisioAddIn.dll'
Add-Type -Path $dll
$plan = New-Object Ayk.WireFlow.VisioAddIn.DraftPlan
$plan.Modules = 2
$names = @('SSC.S','SSC.N','SSC.NEG','SSC.POS','SSC.B-','SSC.B+','JB.NEG','JB.POS','M1.S','M1.N','M1.NEG','M1.POS','M2.S','M2.N','M2.NEG','M2.POS')
for ($i=0; $i -lt $names.Count; $i++) { $plan.Set($names[$i], 2 + $i * 0.1, 2 + ($i % 3) * 0.1) }
$segments = @($plan.Build())
if ($segments.Count -ne 8) { throw 'Unexpected wire count.' }
if ($segments[0].From -ne 'SSC.POS' -or $segments[0].To -ne 'M1.POS' -or $segments[2].From -ne 'M1.NEG' -or $segments[2].To -ne 'M2.POS' -or $segments[7].From -ne 'SSC.B+' -or $segments[7].To -ne 'JB.POS') { throw 'Endpoint order was not preserved.' }
$copy = Join-Path $PSScriptRoot 'build\native-test-copy.vsdx'
if (!$Blank) { Copy-Item -LiteralPath $Sample -Destination $copy -Force }
$app = $null; $doc = $null
try {
    Write-Output 'Starting an invisible Visio instance.'
    $app = New-Object -ComObject Visio.InvisibleApp
    $app.AlertResponse = 7
    if ($Blank) { Write-Output 'Creating a blank test drawing.'; $doc = $app.Documents.Add('') }
    else { Write-Output 'Opening a copy of the supplied drawing.'; $doc = $app.Documents.OpenEx($copy, 64) }
    $page = $doc.Pages.Item(1)
    $before = $page.Shapes.Count
    $incomplete = New-Object Ayk.WireFlow.VisioAddIn.DraftPlan
    $incomplete.Modules = 2
    try { [Ayk.WireFlow.VisioAddIn.DraftRenderer]::Draw($app, $page, $incomplete); throw 'Incomplete plan was accepted.' } catch { if ($_.Exception.Message -eq 'Incomplete plan was accepted.') { throw } }
    if ($page.Shapes.Count -ne $before) { throw 'Invalid plan changed the drawing.' }
    Write-Output 'Drawing and saving test connections.'
    $created = [Ayk.WireFlow.VisioAddIn.DraftRenderer]::Draw($app, $page, $plan)
    if ($created -ne 8 -or $page.Shapes.Count -ne ($before + 8)) { throw 'Native Visio wire count differs.' }
    $first = $page.Shapes.Item($before + 1)
    if ([math]::Abs($first.CellsU('BeginX').ResultIU - $segments[0].A.X) -gt 0.00001 -or [math]::Abs($first.CellsU('EndY').ResultIU - $segments[0].B.Y) -gt 0.00001) { throw 'Wire endpoints moved.' }
    if ($Blank) { [void]$doc.SaveAs($copy) } else { [void]$doc.Save() }
    Write-Output 'PASS: endpoint mapping, incomplete-plan guard, and editable native Visio lines saved to the test copy.'
    if ($Reopen) {
        [void]$doc.Close(); $doc = $null
        $doc = $app.Documents.OpenEx($copy, 64)
        if ($doc.Pages.Item(1).Shapes.Count -ne ($before + 8)) { throw 'Saved wires did not survive reopening.' }
        Write-Output 'PASS: test copy reopened with all wires.'
    }
} finally {
    if ($doc) { $doc.Close() }
    if ($app) { $app.Quit() }
}
