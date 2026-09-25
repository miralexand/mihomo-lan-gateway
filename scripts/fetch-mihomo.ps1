[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Proxy = "https://gh-proxy.com/",
  [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$binDir = Join-Path $root "bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$headerArgs = @()
if ($Token) { $headerArgs = @("-H", "Authorization: Bearer $Token") }

if (-not $Version) {
  $api = "${Proxy}https://api.github.com/repos/MetaCubeX/mihomo/releases/latest"
  Write-Output "Resolving latest version from $api"
  $tag = (curl.exe -s -L --max-time 60 @headerArgs $api | ConvertFrom-Json).tag_name
  if (-not $tag) { throw "Failed to resolve latest version" }
  $Version = $tag
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "ARM64" { "arm64" }
  "x86"   { "386" }
  default { "amd64" }
}

$asset = "mihomo-windows-$arch-$Version.zip"
$url = "${Proxy}https://github.com/MetaCubeX/mihomo/releases/download/$Version/$asset"
$tmp = Join-Path $env:TEMP $asset

Write-Output "Downloading $asset"
curl.exe -fL --retry 3 --max-time 300 -o $tmp $url
Expand-Archive -LiteralPath $tmp -DestinationPath $binDir -Force
Remove-Item $tmp -Force

$exe = Get-ChildItem -LiteralPath $binDir -Filter "mihomo*.exe" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($exe -and $exe.Name -ne "mihomo.exe") {
  Move-Item -LiteralPath $exe.FullName -Destination (Join-Path $binDir "mihomo.exe") -Force
}

Write-Output "mihomo installed: $(Join-Path $binDir 'mihomo.exe')  ($Version)"
