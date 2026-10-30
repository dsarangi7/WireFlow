# Temporary discovery diagnostic. Does not install the add-in.
$ErrorActionPreference = 'Stop'
$key = 'HKLM:\SOFTWARE\Microsoft\Visio\Addins\AYK.WireFlow.VisioAddIn'
if (Test-Path -LiteralPath $key) { throw 'A machine-level WireFlow entry already exists; this diagnostic will not overwrite it.' }
$created = $false
$classKey = 'HKLM:\SOFTWARE\Classes\CLSID\{E1CE7134-5A5D-4B05-BC55-93BF487456CB}'
$progKey = 'HKLM:\SOFTWARE\Classes\AYK.WireFlow.VisioAddIn'
if ((Test-Path -LiteralPath $classKey) -or (Test-Path -LiteralPath $progKey)) { throw 'An existing machine COM registration prevents this temporary test.' }
$createdClass = $false
$createdProg = $false
$dll = (Resolve-Path (Join-Path $PSScriptRoot 'build\Ayk.WireFlow.VisioAddIn.dll')).Path
$assembly = [Reflection.AssemblyName]::GetAssemblyName($dll).FullName
try {
    New-Item -Path $classKey -ErrorAction Stop | Out-Null
    $createdClass = $true
    Set-Item -LiteralPath $classKey -Value 'Ayk.WireFlow.VisioAddIn.WireFlowAddIn'
    $server = Join-Path $classKey 'InprocServer32'
    New-Item -Path $server | Out-Null
    Set-Item -LiteralPath $server -Value 'mscoree.dll'
    New-ItemProperty -LiteralPath $server -Name ThreadingModel -Value Both | Out-Null
    New-ItemProperty -LiteralPath $server -Name Class -Value 'Ayk.WireFlow.VisioAddIn.WireFlowAddIn' | Out-Null
    New-ItemProperty -LiteralPath $server -Name Assembly -Value $assembly | Out-Null
    New-ItemProperty -LiteralPath $server -Name RuntimeVersion -Value 'v4.0.30319' | Out-Null
    New-ItemProperty -LiteralPath $server -Name CodeBase -Value ([Uri]::new($dll).AbsoluteUri) | Out-Null
    New-Item -Path (Join-Path $classKey 'ProgId') | Out-Null
    Set-Item -LiteralPath (Join-Path $classKey 'ProgId') -Value 'AYK.WireFlow.VisioAddIn'
    New-Item -Path $progKey -ErrorAction Stop | Out-Null
    $createdProg = $true
    Set-Item -LiteralPath $progKey -Value 'Ayk.WireFlow.VisioAddIn.WireFlowAddIn'
    New-Item -Path (Join-Path $progKey 'CLSID') | Out-Null
    Set-Item -LiteralPath (Join-Path $progKey 'CLSID') -Value '{E1CE7134-5A5D-4B05-BC55-93BF487456CB}'
    New-Item -Path $key -ErrorAction Stop | Out-Null
    $created = $true
    New-ItemProperty -LiteralPath $key -Name FriendlyName -Value 'AYK WireFlow Prototype' | Out-Null
    New-ItemProperty -LiteralPath $key -Name Description -Value 'Temporary discovery diagnostic' | Out-Null
    New-ItemProperty -LiteralPath $key -Name LoadBehavior -PropertyType DWord -Value 3 | Out-Null
    New-ItemProperty -LiteralPath $key -Name CommandLineSafe -PropertyType DWord -Value 0 | Out-Null
    Write-Host 'Temporary registration is active. Leave this window open and tell Codex: READY.'
    Write-Host 'After Codex finishes checking Visio, press Enter here to remove the entry.'
    Read-Host 'Press Enter only after the check' | Out-Null
}
finally {
    if ($created) { Remove-Item -LiteralPath $key -Recurse -ErrorAction Stop }
    if ($createdProg) { Remove-Item -LiteralPath $progKey -Recurse -ErrorAction Stop }
    if ($createdClass) { Remove-Item -LiteralPath $classKey -Recurse -ErrorAction Stop }
}
