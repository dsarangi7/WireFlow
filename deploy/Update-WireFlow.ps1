<#
  Update WireFlow on the production server (run ON the server, PowerShell as Administrator).
    powershell -ExecutionPolicy Bypass -File C:\apps\WireFlow\deploy\Update-WireFlow.ps1
  Pulls the latest code from Gitea. If the server code changed, restarts the AYK_WireFlow task
  (engineers stay signed in). App-only changes are live at once: browsers re-check files on load.
  Projects and accounts live in C:\WireFlowData, outside the git folder, and are never touched.
#>
param([string]$Path = 'C:\apps\WireFlow')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $Path '.git'))) { throw "$Path is not a git clone. First install: git clone http://192.168.3.10:3000/Dibya/WireFlow.git $Path" }

$before = git -C $Path rev-parse HEAD
Write-Host "== Pulling the latest code from Gitea into $Path"
git -C $Path pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "git pull failed (Gitea sign-in, or local edits: git -C $Path status)" }
$after = git -C $Path rev-parse HEAD

if ($before -ne $after) {
  $changed = git -C $Path diff --name-only $before $after
  if ($changed -match '^server/') {
    Write-Host '== Server code changed: restarting AYK_WireFlow'
    Stop-ScheduledTask -TaskName 'AYK_WireFlow'
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName 'AYK_WireFlow'
    Start-Sleep -Seconds 3
  }
}

Write-Host '== Check'
$missing = 'index.html', 'js\app.js', 'js\store.js', 'server\server.js' | Where-Object { -not (Test-Path (Join-Path $Path $_)) }
if ($missing) { throw ('Missing: ' + ($missing -join ', ')) }
$task = Get-ScheduledTask -TaskName 'AYK_WireFlow' -ErrorAction SilentlyContinue
Write-Host ("OK: code at {0}; server task: {1}" -f (git -C $Path log --oneline -1), $(if ($task) { $task.State } else { 'not installed (run server\install-windows.ps1)' }))
exit 0
