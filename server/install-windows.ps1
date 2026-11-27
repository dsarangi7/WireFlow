<#
.SYNOPSIS
  Sets up the WireFlow server on Windows Server (AYK: http://192.168.3.8).

.DESCRIPTION
  Run once, in an elevated PowerShell, from the WireFlow folder (the git clone).
  It registers two scheduled tasks that run as SYSTEM:
    "WireFlow Server"  starts at boot, restarts itself if it stops;
    "WireFlow Backup"  copies the database every night at 02:00 (newest 30 kept);
  and opens the port in Windows Firewall for the company network.
  Running it again replaces both tasks with the new settings.

  Needs Node.js 22.13 or newer (https://nodejs.org, LTS, Windows installer).

.EXAMPLE
  .\server\install-windows.ps1
  .\server\install-windows.ps1 -Port 8080 -DataDir D:\WireFlowData -BackupDir \\nas\backups\wireflow
#>
param(
  [int]    $Port      = 80,
  [string] $DataDir   = 'C:\WireFlowData',
  [string] $BackupDir = 'C:\WireFlowData\backups'
)
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this in PowerShell opened with "Run as administrator".' }

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'server\server.js'))) { throw "server\server.js not found under $root" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed (https://nodejs.org, LTS).' }
$ver = [version]((& $node --version).TrimStart('v'))
if ($ver -lt [version]'22.13.0') { throw "Node.js $ver is too old: WireFlow needs 22.13 or newer." }

New-Item -ItemType Directory -Force $DataDir, $BackupDir | Out-Null

# the tasks set the settings through environment variables, then start node
$envs = "set WIREFLOW_PORT=$Port&& set WIREFLOW_DATA=$DataDir&&"
$serverAction = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $root `
  -Argument "/c $envs `"$node`" server\server.js >> `"$DataDir\server.log`" 2>&1"
$backupAction = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $root `
  -Argument "/c $envs `"$node`" server\server.js backup `"$BackupDir`" >> `"$DataDir\backup.log`" 2>&1"
$system = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$keepRunning = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$once = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -StartWhenAvailable

foreach ($t in 'WireFlow Server', 'WireFlow Backup') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
  }
}
Register-ScheduledTask -TaskName 'WireFlow Server' -Action $serverAction -Principal $system -Settings $keepRunning `
  -Trigger (New-ScheduledTaskTrigger -AtStartup) -Description 'AYK WireFlow web server' | Out-Null
Register-ScheduledTask -TaskName 'WireFlow Backup' -Action $backupAction -Principal $system -Settings $once `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) -Description 'Nightly copy of the WireFlow database' | Out-Null

if (-not (Get-NetFirewallRule -DisplayName 'WireFlow' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'WireFlow' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
}

Start-ScheduledTask -TaskName 'WireFlow Server'
Start-Sleep -Seconds 3
try {
  $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 10
  Write-Host "WireFlow is running on port $Port (HTTP $($r.StatusCode)). Data: $DataDir"
} catch {
  Write-Warning "The server did not answer on port $Port. See $DataDir\server.log (is another web server such as IIS using the port?)."
}
Write-Host ''
Write-Host 'Next, add the admin account (you are asked for the password):'
Write-Host "  `$env:WIREFLOW_DATA = '$DataDir'; node server\server.js adduser dibya `"Dibya Jyoti Sarangi`" --admin"
