<#
.SYNOPSIS
  Sets up the WireFlow server on Windows Server (AYK: 192.168.3.8, behind nginx at /wireflow/).

.DESCRIPTION
  Run once, in an elevated PowerShell, from the WireFlow folder (the git clone, C:\apps\WireFlow).
  It registers two scheduled tasks that run as SYSTEM:
    "AYK_WireFlow"         starts at boot, restarts itself if it stops;
    "AYK_WireFlow_Backup"  copies the database every night at 02:00 (newest 30 kept).
  WireFlow listens on 127.0.0.1 only: nginx (public port 3002) forwards /wireflow/ to it
  (deploy\nginx-wireflow.conf), so no firewall or router change is needed.
  Running it again replaces both tasks with the new settings.

  Needs Node.js 22.13 or newer (https://nodejs.org, LTS, Windows installer). No npm packages.

.EXAMPLE
  .\server\install-windows.ps1
  .\server\install-windows.ps1 -Port 3006 -DataDir D:\WireFlowData -BackupDir \\nas\backups\wireflow
#>
param(
  [int]    $Port      = 3005,
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

foreach ($t in 'AYK_WireFlow', 'AYK_WireFlow_Backup') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
  }
}
Start-Sleep -Seconds 1
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use by another program. Choose a free one: .\server\install-windows.ps1 -Port <free port>"
}

# the tasks set the settings through environment variables, then start node
$envs = "set WIREFLOW_PORT=$Port&& set WIREFLOW_HOST=127.0.0.1&& set WIREFLOW_DATA=$DataDir&&"
$serverAction = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $root `
  -Argument "/c $envs `"$node`" server\server.js >> `"$DataDir\server.log`" 2>&1"
$backupAction = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $root `
  -Argument "/c $envs `"$node`" server\server.js backup `"$BackupDir`" >> `"$DataDir\backup.log`" 2>&1"
$system = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$keepRunning = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$once = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -StartWhenAvailable

Register-ScheduledTask -TaskName 'AYK_WireFlow' -Action $serverAction -Principal $system -Settings $keepRunning `
  -Trigger (New-ScheduledTaskTrigger -AtStartup) -Description 'AYK WireFlow server (nginx /wireflow/)' | Out-Null
Register-ScheduledTask -TaskName 'AYK_WireFlow_Backup' -Action $backupAction -Principal $system -Settings $once `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) -Description 'Nightly copy of the WireFlow database' | Out-Null

Start-ScheduledTask -TaskName 'AYK_WireFlow'
Start-Sleep -Seconds 3
try {
  $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 10
  Write-Host "WireFlow is running on 127.0.0.1:$Port (HTTP $($r.StatusCode)). Data: $DataDir"
} catch {
  Write-Warning "The server did not answer on port $Port. See $DataDir\server.log."
}
