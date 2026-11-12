# Removes the "JARVIS" logon task. Does nothing if it is not there.
$name = 'JARVIS'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "Task '$name' removed. A running server stays up until you close it or log off."
} else {
  Write-Host "Task '$name' not found. Nothing to do."
}
