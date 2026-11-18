<#
.SYNOPSIS
  Converts AutoCAD DWG rack drawings to ASCII DXF for AYK WireFlow.

.DESCRIPTION
  Uses the AutoCAD core console (accoreconsole.exe, installed with AutoCAD)
  to open each DWG without a window and "Save As" DXF 2018, full precision.
  The DWG is opened read-only in the console and never modified.

  Without AutoCAD, use the free ODA File Converter or open the drawing in
  AutoCAD and use Save As > AutoCAD 2018 DXF.

.EXAMPLE
  .\tools\dwg-to-dxf.ps1 "D:\Racks\S10177 Rack1.dwg"
  .\tools\dwg-to-dxf.ps1 "D:\Racks\*.dwg" -OutDir "D:\Racks\dxf"
#>
param(
  [Parameter(Mandatory = $true, Position = 0)] [string[]] $Path,
  [string] $OutDir,
  [string] $AutoCad
)
$ErrorActionPreference = 'Stop'

function Find-AcCoreConsole {
  if ($AutoCad) {
    if (Test-Path $AutoCad) { return (Resolve-Path $AutoCad).Path }
    throw "accoreconsole.exe not found at $AutoCad"
  }
  $found = Get-ChildItem 'C:\Program Files\Autodesk' -Directory -Filter 'AutoCAD*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'accoreconsole.exe' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $found) { throw 'AutoCAD core console (accoreconsole.exe) not found. Install AutoCAD, pass -AutoCad <path>, or convert with ODA File Converter.' }
  return $found
}

$console = Find-AcCoreConsole
$files = foreach ($p in $Path) { Get-ChildItem -Path $p -File | Where-Object { $_.Extension -ieq '.dwg' } }
if (-not $files) { throw "No .dwg files matched: $($Path -join ', ')" }

$work = Join-Path ([IO.Path]::GetTempPath()) ('wireflow-dwg2dxf-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  foreach ($f in $files) {
    $dest = if ($OutDir) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null; Join-Path (Resolve-Path $OutDir).Path ($f.BaseName + '.dxf') }
            else { Join-Path $f.DirectoryName ($f.BaseName + '.dxf') }
    if (Test-Path $dest) { Remove-Item $dest -Confirm:$false }
    $script = Join-Path $work 'save.scr'
    # Quote the path: on the AutoCAD command line a space acts as Enter.
    $lines = @('_.FILEDIA', '0', '_.SAVEAS', 'DXF', '16', ('"' + $dest + '"'), '_.QUIT', '_Y')
    [IO.File]::WriteAllText($script, ($lines -join "`r`n") + "`r`n")
    Write-Host "Converting $($f.Name) ..."
    Push-Location $work
    try {
      & $console /i $f.FullName /s $script /l en-US /readonly 2>&1 | Out-Null
    } finally { Pop-Location }
    if (-not (Test-Path $dest)) { Write-Error "Conversion failed for $($f.FullName)"; continue }
    $head = Get-Content $dest -TotalCount 2
    if ($head[0].Trim() -ne '0' -or $head[1].Trim() -ne 'SECTION') { Write-Error "Output is not ASCII DXF: $dest"; continue }
    Write-Host ("  -> {0} ({1:N1} MB)" -f $dest, ((Get-Item $dest).Length / 1MB))
  }
} finally {
  Remove-Item $work -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
}
