[CmdletBinding()]
param(
  [switch]$NoFirewall
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root "bin\mihomo.exe"
$configDir = Join-Path $root "config"

$busy = Get-NetTCPConnection -LocalPort 7890 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  throw "Port 7890 is already in use. If the Docker container is running, stop it first: docker compose down"
}

if (-not (Test-Path $exe)) {
  Write-Output "mihomo.exe not found, fetching core..."
  & (Join-Path $PSScriptRoot "fetch-mihomo.ps1")
}

if (-not $NoFirewall) {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    if (-not (Get-NetFirewallRule -DisplayName "mihomo proxy" -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName "mihomo proxy" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 7890,7891,9090 -Profile Private | Out-Null
      Write-Output "Added firewall rule 'mihomo proxy' (Private profile)."
    }
  } else {
    Write-Warning "Not elevated: skipped firewall rule. Run once as Administrator, otherwise LAN devices may not connect."
  }
}

Write-Output "Starting mihomo (native) with config dir: $configDir"
& $exe -d $configDir
