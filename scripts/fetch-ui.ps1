$ErrorActionPreference = "Stop"

$dest = Join-Path (Split-Path $PSScriptRoot -Parent) "config\ui"
$url = if ($env:MIHOMO_UI_URL) { $env:MIHOMO_UI_URL } else {
  "https://gh-proxy.com/https://github.com/MetaCubeX/metacubexd/releases/latest/download/compressed-dist.tgz"
}
$tmp = Join-Path $env:TEMP "metacubexd.tgz"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Output "Downloading metacubexd from $url"
curl.exe -fL --retry 3 -o $tmp $url
tar -xzf $tmp -C $dest
Remove-Item $tmp -Force

$configJs = @'
try {
  if (localStorage.getItem('mihomo_theme_default_v1') !== '1') {
    localStorage.setItem('theme', 'nord')
    localStorage.setItem('autoSwitchTheme', 'false')
    localStorage.setItem('mihomo_theme_default_v1', '1')
  }
} catch (e) {}
window.__METACUBEXD_CONFIG__ = {
  defaultBackendURL: '',
  githubToken: '',
}
'@
Set-Content -LiteralPath (Join-Path $dest "config.js") -Value $configJs -Encoding UTF8

Write-Output "UI installed to $dest"
