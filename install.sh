#!/usr/bin/env bash
# One-command installer for pi-cua-webcli.
# Checks/installs Node, Pi, the native runtimes (CuaDriver + web CLI), then
# registers this package with Pi. Safe to re-run.
set -euo pipefail

BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"
say() { printf "${BOLD}${GREEN}==>${RESET} %s\n" "$1"; }
warn() { printf "${BOLD}${YELLOW}!! ${RESET} %s\n" "$1"; }
err() { printf "${BOLD}${RED}XX ${RESET} %s\n" "$1" >&2; }

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Node ------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  warn "Node not found. Install Node 18+ first: https://nodejs.org/  (or: brew install node)"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node 18+ required (found $(node -v))."
  exit 1
fi
say "Node OK ($(node -v))"

# --- Pi --------------------------------------------------------------------
if ! command -v pi >/dev/null 2>&1; then
  say "Installing Pi (global npm)…"
  npm install -g @earendil-works/pi-coding-agent
fi
say "Pi OK ($(pi --version))"

# --- CuaDriver (native runtime for cua_driver) -----------------------------
CUA_BIN="${CUA_DRIVER_BIN:-/Applications/CuaDriver.app/Contents/MacOS/cua-driver}"
if [ ! -x "$CUA_BIN" ] && ! command -v cua-driver >/dev/null 2>&1; then
  warn "CuaDriver.app not found at $CUA_BIN."
  warn "  Download from https://github.com/cua-framework/cua/releases and drag CuaDriver.app into /Applications."
  warn "  On first run, grant Accessibility + Screen Recording permissions."
else
  say "CuaDriver OK ($CUA_BIN)"
fi

# --- web CLI (native runtime for web_cli) ---------------------------------
WEB_BIN="${WEB_CLI_PATH:-$HOME/.local/bin/web}"
if [ ! -x "$WEB_BIN" ] && ! command -v web >/dev/null 2>&1; then
  warn "web CLI not found at $WEB_BIN or on PATH."
  warn "  Install with:  npm install -g @earendil-works/agent-browser"
  warn "  (or place a binary at ~/.local/bin/web)"
else
  say "web CLI OK"
fi

# --- Register this package with Pi ----------------------------------------
say "Registering pi-cua-webcli with Pi (local checkout)…"
pi install "$REPO_DIR"

say "Done. Start/reload Pi and ask the agent to use cua_driver or web_cli."
warn "If Pi was already running, run /reload inside it to load the new tools."