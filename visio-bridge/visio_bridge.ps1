# ============================================================
# WireFlow -> Visio COM bridge (visio_bridge.ps1)
# ------------------------------------------------------------
# Draws WireFlow spec wires into the house Visio template using
# the Visio COM API. Zero dependencies beyond Windows PowerShell
# 5.1 and a local Visio installation.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File visio_bridge.ps1 `
#     -Spec <path to spec json> -Template <path to .vsdx> -Out <output .vsdx> `
#     [-FitX 1.62] [-FitY 5.36] [-FitW 13.92] [-FitH 5.16] [-Visible] [-DryRun]
#
# Behaviour:
#   * -DryRun prints a summary and exits 0 without touching COM
#     (works on a machine without Visio installed).
#   * Otherwise the template is copied to -Out first so the
#     embedded CAD picture / logo / masters survive, page 1 of the
#     copy is opened, a 'WireFlow' layer is created (if missing)
#     and every spec wire is drawn as a native 1D line, coloured
#     per spec.wire_color_map.
#
# Exit codes: 0 = success (or dry run), 1 = fatal error.
# NOTE: this file is intentionally plain ASCII only.
# ============================================================

param(
    [Parameter(Mandatory = $true)][string]$Spec,
    [Parameter(Mandatory = $true)][string]$Template,
    [Parameter(Mandatory = $true)][string]$Out,
    [double]$FitX = 1.62,
    [double]$FitY = 5.36,
    [double]$FitW = 13.92,
    [double]$FitH = 5.16,
    [switch]$Visible,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$LayerName = 'WireFlow'

# Fallback colour map (only used when the spec carries no wire_color_map).
$DefaultColorMap = @{
    'POWER'   = '#ff0000'
    'SUBPWR'  = '#ff0000'
    'COMM'    = '#00b050'
    'COMMGRY' = '#6b7280'
    'TERM'    = '#00b050'
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message"
    exit 1
}

<#
.SYNOPSIS
    Converts a '#rrggbb' hex colour into a Visio 'RGB(r,g,b)' formula.
#>
function ConvertTo-VisioRgb([string]$Hex) {
    $h = ('' + $Hex).Trim().TrimStart('#')
    if ($h -notmatch '^[0-9a-fA-F]{6}$') {
        return 'RGB(0,0,0)'
    }
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    return "RGB($r,$g,$b)"
}

# ---------------- 1. read + validate the spec ----------------
if (-not (Test-Path -LiteralPath $Spec)) {
    Fail "spec file not found: $Spec"
}
try {
    # NOTE: do not reuse $Spec (the [string]-typed parameter) as the target --
    # PowerShell variables are case-insensitive, so $spec IS $Spec and the
    # assignment would coerce the parsed object back to a string.
    $specDoc = Get-Content -LiteralPath $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Fail "cannot parse spec JSON ($Spec): $($_.Exception.Message)"
}

$wireList = @()
if ($specDoc.wires) { $wireList = @($specDoc.wires) }
if ($wireList.Count -eq 0) {
    Fail "spec has no wires (regenerate the spec with a WireFlow build whose specJson exports wires)"
}

# colour map from the spec, falling back to the house defaults
$colorMap = @{}
foreach ($key in $DefaultColorMap.Keys) { $colorMap[$key] = $DefaultColorMap[$key] }
if ($specDoc.wire_color_map) {
    foreach ($prop in $specDoc.wire_color_map.PSObject.Properties) {
        $colorMap[[string]$prop.Name] = [string]$prop.Value
    }
}

# per-layer counts + content bounding box (in spec paper inches, Y up)
$layerCounts = @{}
$minX = [double]::MaxValue; $maxX = [double]::MinValue
$minY = [double]::MaxValue; $maxY = [double]::MinValue
$badCoord = 0
foreach ($w in $wireList) {
    $lay = [string]$w.layer
    if ($layerCounts.ContainsKey($lay)) { $layerCounts[$lay]++ } else { $layerCounts[$lay] = 1 }
    foreach ($coord in @($w.x1, $w.y1, $w.x2, $w.y2)) {
        $v = 0.0
        if (-not [double]::TryParse([string]$coord, [Globalization.NumberStyles]::Float,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$v)) {
            $badCoord++
            continue
        }
        if ($v -lt $minX) { $minX = $v }
        if ($v -gt $maxX) { $maxX = $v }
        if ($v -lt $minY) { $minY = $v }
        if ($v -gt $maxY) { $maxY = $v }
    }
}
if ($badCoord -gt 0) {
    Fail "spec wires contain $badCoord non-numeric coordinate value(s)"
}
if ($maxX -le $minX) { $maxX = $minX + 1 }   # degenerate bbox guard
if ($maxY -le $minY) { $maxY = $minY + 1 }
$spanX = $maxX - $minX
$spanY = $maxY - $minY

<#
.SYNOPSIS
    Maps a spec paper X (inches) into the fit rectangle on the page.
#>
function Map-X([double]$Value) {
    return $FitX + (($Value - $minX) / $spanX) * $FitW
}

<#
.SYNOPSIS
    Maps a spec paper Y (inches, Y up) into the fit rectangle on the page.
#>
function Map-Y([double]$Value) {
    return $FitY + (($Value - $minY) / $spanY) * $FitH
}

# ---------------- 2. dry run (no COM, no Visio required) ----------------
if ($DryRun) {
    Write-Host 'WireFlow Visio bridge - DRY RUN (nothing will be drawn)'
    Write-Host ("  spec          : " + (Resolve-Path -LiteralPath $Spec).Path)
    Write-Host ("  template      : $Template")
    Write-Host ("  output        : $Out")
    Write-Host ("  wires         : " + $wireList.Count)
    foreach ($key in ($layerCounts.Keys | Sort-Object)) {
        Write-Host ("    layer " + $key.PadRight(8) + " : " + $layerCounts[$key])
    }
    Write-Host ("  wire bbox     : X " + [Math]::Round($minX, 3) + " .. " + [Math]::Round($maxX, 3) + " in, Y " + [Math]::Round($minY, 3) + " .. " + [Math]::Round($maxY, 3) + " in")
    Write-Host ("  fit rectangle : X $FitX + $FitW in, Y $FitY + $FitH in (page inches, Y up)")
    Write-Host ("  layer on page : $LayerName")
    Write-Host 'DRY RUN OK'
    exit 0
}

# ---------------- 3. copy the template so masters/media survive ----------------
if (-not (Test-Path -LiteralPath $Template)) {
    Fail "template file not found: $Template"
}
$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
try {
    Copy-Item -LiteralPath $Template -Destination $Out -Force
} catch {
    Fail "cannot copy template to output ($Out): $($_.Exception.Message)"
}

# ---------------- 4. draw via the Visio COM API ----------------
$visio = $null
$doc = $null
$page = $null
$layers = $null
$wireLayer = $null
$drawn = 0
$errs = 0

try {
    $progId = 'Visio.InvisibleApp'
    if ($Visible) { $progId = 'Visio.Application' }
    try {
        $visio = New-Object -ComObject $progId
    } catch {
        Fail "cannot start Visio COM ($progId). Is Visio installed? $($_.Exception.Message)"
    }

    $doc = $visio.Documents.Open($Out)
    $page = $doc.Pages.Item(1)
    $pageW = $page.PageSheet.CellsU('PageWidth').ResultIU
    $pageH = $page.PageSheet.CellsU('PageHeight').ResultIU

    if ($FitX -lt 0 -or $FitY -lt 0 -or ($FitX + $FitW) -gt $pageW -or ($FitY + $FitH) -gt $pageH) {
        Fail ("fit rectangle (X $FitX + $FitW, Y $FitY + $FitH in) exceeds the page draw area (${pageW} x ${pageH} in)")
    }

    # create (or reuse) the WireFlow layer
    $layers = $page.Layers
    for ($i = 1; $i -le $layers.Count; $i++) {
        $candidate = $layers.Item($i)
        if ($candidate.Name -eq $LayerName) { $wireLayer = $candidate; break }
    }
    if (-not $wireLayer) {
        $wireLayer = $layers.Add($LayerName)
    }

    foreach ($w in $wireList) {
        try {
            $x1 = Map-X ([double]$w.x1)
            $y1 = Map-Y ([double]$w.y1)
            $x2 = Map-X ([double]$w.x2)
            $y2 = Map-Y ([double]$w.y2)

            $shape = $page.DrawLine($x1, $y1, $x2, $y2)

            $lay = [string]$w.layer
            $hex = '#ff0000'
            if ($colorMap.ContainsKey($lay)) { $hex = $colorMap[$lay] }
            $shape.CellsU('LineColor').FormulaU = ConvertTo-VisioRgb $hex
            $shape.CellsU('LineWeight').FormulaU = '0.75 pt'

            # assign the shape to the WireFlow layer. The typed Layer.Add API
            # is used instead of writing the ShapeSheet LayerMember cell so
            # the 0-based/1-based index question cannot bite us.
            $wireLayer.Add($shape)

            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shape)
            $drawn++
        } catch {
            $errs++
            Write-Host ("  wire error: " + $_.Exception.Message)
        }
    }

    $doc.Save()
    $doc.Close()
    $doc = $null
    $visio.Quit()
    $visio = $null

    Write-Host "OK: $Out ($drawn wires drawn, $errs errors)"
    exit 0
} catch {
    Fail $_.Exception.Message
} finally {
    # stop-processing-safe cleanup: never leave an orphan Visio process
    if ($doc) { try { $doc.Close() } catch { } }
    if ($visio) { try { $visio.Quit() } catch { } }
    foreach ($comObj in @($wireLayer, $layers, $page, $doc, $visio)) {
        if ($comObj) {
            try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($comObj) } catch { }
        }
    }
}
