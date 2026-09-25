#!/usr/bin/env sh
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="$SCRIPT_DIR/../config/ui"
URL="${MIHOMO_UI_URL:-https://gh-proxy.com/https://github.com/MetaCubeX/metacubexd/releases/latest/download/compressed-dist.tgz}"

mkdir -p "$DEST"
TMP="$(mktemp)"
echo "Downloading metacubexd from $URL"
curl -fL --retry 3 -o "$TMP" "$URL"
tar -xzf "$TMP" -C "$DEST"
rm -f "$TMP"

cat > "$DEST/config.js" <<'EOF'
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
EOF

echo "UI installed to $DEST"
