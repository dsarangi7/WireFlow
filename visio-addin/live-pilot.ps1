param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$dll = Join-Path $PSScriptRoot 'build\Ayk.WireFlow.VisioAddIn.dll'
if (!(Test-Path -LiteralPath $dll)) { throw 'Build the prototype first with visio-addin\build.ps1.' }
Add-Type -Path $dll
try { $visio = [Runtime.InteropServices.Marshal]::GetActiveObject('Visio.Application') }
catch { throw 'Open Visio and a blank or test drawing before starting the pilot.' }
$addin = New-Object Ayk.WireFlow.VisioAddIn.WireFlowAddIn
$custom = @()
$addin.OnConnection($visio, 0, $null, [ref]$custom)
$addin.OpenWorkspace($null)
$field = [Ayk.WireFlow.VisioAddIn.WireFlowAddIn].GetField('form', [Reflection.BindingFlags]'Instance,NonPublic')
$form = $field.GetValue($addin)
if ($null -eq $form) { throw 'The WireFlow workspace did not open.' }
try { [System.Windows.Forms.Application]::Run($form) }
finally { $addin.OnDisconnection(0, [ref]$custom) }
