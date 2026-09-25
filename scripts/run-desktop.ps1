#Requires -Version 5.1
<#
.SYNOPSIS
  以开发模式启动 Mihomo Gateway 桌面版（不打包）。
#>
[CmdletBinding()]
param(
  [switch]$StartCore
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $root "desktop"

if (-not (Test-Path (Join-Path $desktop "node_modules"))) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  Push-Location $desktop
  try { npm install --no-audit --no-fund } finally { Pop-Location }
}

$npmArgs = @("start")
if ($StartCore) { $npmArgs = @("start", "--", "--start") }

Push-Location $desktop
try { npm @npmArgs } finally { Pop-Location }
