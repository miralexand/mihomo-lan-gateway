#Requires -RunLevel Highest
[CmdletBinding()]
param(
  [string]$TaskName = "mihomo-native"
)

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed scheduled task '$TaskName'."
} else {
  Write-Output "Scheduled task '$TaskName' not found."
}
