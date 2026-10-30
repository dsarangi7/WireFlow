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
    $visio = [Runtime.InteropServices.Marshal]::GetActiveObject('Visio.Application')
    $visio.COMAddIns.Update()
    $found = $false
    foreach ($addin in $visio.COMAddIns) {
        if ($addin.ProgId -eq 'AYK.WireFlow.VisioAddIn') {
            $found = $true
            Write-Output ('WireFlow listed; connected = ' + $addin.Connect)
        }
    }
    if (!$found) { Write-Output 'WireFlow was not listed after refreshing COM add-ins.' }
}
finally {
    if ($created) { Remove-Item -LiteralPath $key -Recurse -ErrorAction Stop }
}
