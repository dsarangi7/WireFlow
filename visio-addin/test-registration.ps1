# Generate a registry preview only; do not register the add-in or write registry keys.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1')
$regasm = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe'
$build = Join-Path $PSScriptRoot 'build'
$dll = Join-Path $build 'Ayk.WireFlow.VisioAddIn.dll'
$reg = Join-Path $build 'preview-registration.reg'
& $regasm /nologo /codebase "/regfile:$reg" $dll
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the registry preview.' }
$contents = Get-Content -LiteralPath $reg -Raw
if ($contents -notmatch 'AYK\.WireFlow\.VisioAddIn' -or $contents -notmatch 'Ayk\.WireFlow\.VisioAddIn\.PageMouseSink') { throw 'Expected add-in and event-sink classes were not exported.' }
if ($contents -match 'Ayk\.WireFlow\.VisioAddIn\.(DraftPlan|DraftRenderer|DraftReview|MarkerCoordinates|MarkPersistence|Segment|Crossing|ExistingDrafts|MarkFile|MarkEntry|RouteEntry|RoutePoint)') { throw 'An internal model or helper class was exposed for COM activation.' }
Write-Output 'PASS: registry preview exposes the add-in and event sink without registering internal model classes.'
