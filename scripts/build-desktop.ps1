#Requires -Version 5.1
<#
.SYNOPSIS
  一键构建 Mihomo Gateway 桌面版 exe。
.DESCRIPTION
  自动准备内核与面板文件，安装前端依赖并用 electron-builder 打包。
  产物位于 desktop\dist：
    - MihomoGateway-<版本>-portable.exe  单文件便携版（双击即用）
    - MihomoGateway-<版本>-setup.exe     安装版（含开始菜单/桌面快捷方式）
#>
[CmdletBinding()]
param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $root "bin\mihomo.exe"
$uiIndex = Join-Path $root "config\ui\index.html"
$desktop = Join-Path $root "desktop"

if (-not (Test-Path $bin)) {
  Write-Output "未找到内核，正在下载 mihomo..."
  & (Join-Path $PSScriptRoot "fetch-mihomo.ps1")
}

if (-not (Test-Path $uiIndex)) {
  Write-Output "未找到面板文件，正在下载 metacubexd..."
  & (Join-Path $PSScriptRoot "fetch-ui.ps1")
}

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

Push-Location $desktop
try {
  if (-not $SkipInstall -and -not (Test-Path (Join-Path $desktop "node_modules"))) {
    Write-Output "安装依赖..."
    npm install --no-audit --no-fund
  }
  Write-Output "开始打包..."
  npm run dist
} finally {
  Pop-Location
}

Write-Output ""
Write-Output "构建完成，产物目录: $desktop\dist"
Get-ChildItem (Join-Path $desktop "dist") -Filter "*.exe" |
  ForEach-Object { Write-Output ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
