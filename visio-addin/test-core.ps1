$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1')
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$build = Join-Path $PSScriptRoot 'build'
$exe = Join-Path $build 'test-core.exe'
$dll = Join-Path $build 'Ayk.WireFlow.VisioAddIn.dll'
& $compiler /nologo /target:exe /platform:x64 "/out:$exe" "/reference:$dll" (Join-Path $PSScriptRoot 'test-core.cs')
if ($LASTEXITCODE -ne 0) { throw 'Core test compilation failed.' }
& $exe
if ($LASTEXITCODE -ne 0) { throw 'Core tests failed.' }
