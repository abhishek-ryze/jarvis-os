# Registers a per-user logon task "JARVIS" that runs `node server.js` hidden. No admin needed.
# Safe to run again: it replaces the existing task.
$ErrorActionPreference = 'Stop'
$name = 'JARVIS'
$url  = 'http://127.0.0.1:4317'
$dir  = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $dir 'server.js'))) { throw "server.js not found in $dir" }

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'node.exe not found on PATH. Install Node first.' }
$node = $nodeCmd.Source

# Single quotes inside paths are doubled so the -Command string stays valid.
$d = $dir.Replace("'", "''"); $n = $node.Replace("'", "''")
$cmd = "Set-Location -LiteralPath '$d'; & '$n' server.js; exit `$LASTEXITCODE"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$cmd`"" -WorkingDirectory $dir

$user      = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

$busy = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host 'Port 4317 is already in use (server running?). Task registered; it will start at next logon.'
} else {
  Start-ScheduledTask -TaskName $name
}
Write-Host "Task '$name' installed (node: $node)."
Write-Host "Dashboard: $url"
