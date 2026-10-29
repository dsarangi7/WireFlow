param([switch]$ExperimentalMousePicking)
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The 64-bit .NET Framework C# compiler was not found.' }
$buildDir = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
$out = Join-Path $buildDir 'Ayk.WireFlow.VisioAddIn.dll'
$source = Join-Path $PSScriptRoot 'WireFlowAddIn.cs'
$define = if ($ExperimentalMousePicking) { '/define:EXPERIMENTAL_MOUSE_PICKING' } else { '/define:STANDARD_BUILD' }
& $compiler /nologo /target:library /platform:x64 $define "/out:$out" /reference:System.Windows.Forms.dll /reference:Microsoft.CSharp.dll $source
if ($LASTEXITCODE -ne 0) { throw "Compilation failed with exit code $LASTEXITCODE." }
Write-Output "Built prototype: $out"
