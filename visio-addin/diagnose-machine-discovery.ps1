# Temporary discovery diagnostic. Does not install the add-in.
$ErrorActionPreference = 'Stop'
$key = 'HKLM:\SOFTWARE\Microsoft\Visio\Addins\AYK.WireFlow.VisioAddIn'
if (Test-Path -LiteralPath $key) { throw 'A machine-level WireFlow entry already exists; this diagnostic will not overwrite it.' }
$created = $false
try {
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
}
