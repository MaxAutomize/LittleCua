#!/usr/bin/env bash
# Explicit setup for the local checkout; never upgrades the driver or grants TCC.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" != "Darwin" ]]; then
    echo 'LittleCua requires macOS.' >&2; exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
    echo 'Install Node >=22.19.0 and npm first (brew install node).' >&2; exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<19)) { console.error("Node >=22.19.0 required"); process.exit(1); }'
if ! command -v pi >/dev/null; then
    echo 'Installing Pi…'
    npm install -g @earendil-works/pi-coding-agent
fi
# Fail before changing the browser shim if any prerequisite is missing.
node "$REPO_DIR/scripts/doctor.mjs"
WEB_BIN="${WEB_CLI_PATH:-$HOME/.local/bin/web}"
mkdir -p "$(dirname "$WEB_BIN")"
if [[ "$WEB_BIN" != "$REPO_DIR/scripts/web" ]]; then
    if [[ -e "$WEB_BIN" ]]; then
        BACKUP="$(mktemp "${WEB_BIN}.littlecua-backup.XXXXXX")"
        cp -p "$WEB_BIN" "$BACKUP"
        echo "Previous web shim saved: $BACKUP"
    fi
    cp "$REPO_DIR/scripts/web" "$WEB_BIN"
    chmod +x "$WEB_BIN"
fi
pi install "$REPO_DIR"
printf 'LittleCua registered; web shim: %s\n' "$WEB_BIN"
echo 'Reload Pi with /reload. /mcp should show cua_native and web_native.'
echo 'Grant macOS permissions manually, and enable Chrome Allow JavaScript from Apple Events.'
echo 'Do not load another copy of cua_driver/web_cli alongside this package.'
