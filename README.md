# pi-cua-webcli

Two [Pi](https://pi.dev) coding-agent extensions, packaged together so a single `pi install` gives your agent both **native macOS automation** and **live Chrome control**:

| Tool | Extension | What it does |
|------|-----------|--------------|
| `cua_driver` | `extensions/cua-tool` | Drive native macOS apps (Xcode, Finder, System Settings, Blender, …) via the CuaDriver daemon — screenshots, clicks, typing, semantic AX selectors, 30-step workflows, AppleScript. **macOS only.** |
| `web_cli`   | `extensions/web-cli` | Fast DOM control of your live authenticated Chrome (macOS) via a bundled AppleScript + cua-driver shim — navigate, read text, find/click/fill buttons & inputs, run JS, manage tabs, chain 30-step sequences. |

Both register as LLM-callable tools inside Pi, so once installed the model can use them directly.

---

## 1. Install Pi (the only hard dependency)

Pi is the host agent these extensions plug into. Install it once:

```bash
# Node 18+ required
brew install node       # or: use mise / nvm / asdf

# Pi
npm install -g @earendil-works/pi-coding-agent
# or
pi installer            # official guided installer
```

Verify:

```bash
pi --version
```

> The Pi framework packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`) are declared as `peerDependencies` in this repo's `package.json` and are provided by Pi itself — you do **not** install them separately.

---

## 2. Install this package (one command)

From anywhere:

```bash
pi install git:github.com/MaxAutomize/pi-cua-webcli
```

That clones the repo into `~/.pi/agent/git/github.com/MaxAutomize/pi-cua-webcli`, runs `npm install` for any runtime deps, and registers the package in `~/.pi/agent/settings.json`. The two tools (`cua_driver`, `web_cli`) are now available to every Pi session.

To try it without permanently installing:

```bash
pi -e git:github.com/MaxAutomize/pi-cua-webcli
```

Reload Pi (or run `/reload`) after installing to pick up the new tools.

---

## 3. Install the native runtimes these tools drive

> **macOS only.** Both tools are thin TypeScript wrappers around macOS-native runtimes. `cua_driver` shells out to **CuaDriver.app**, and `web_cli` shells out to a custom **`web` bash shim** that drives Chrome through **AppleScript** (`osascript`) and CuaDriver's page tools. Neither AppleScript nor CuaDriver exist on Windows/Linux, so this whole package is macOS-only. The extension TypeScript itself is plain cross-platform code; only the runtimes it calls are macOS-bound.

### cua_driver → CuaDriver.app

```bash
# Option A: download the app
#   https://github.com/cua-framework/cua/releases  →  CuaDriver.app
#   Drag into /Applications

# Option B: homebrew (if published)
brew install --cask cuadriver

# Verify
/Applications/CuaDriver.app/Contents/MacOS/cua-driver --help
```

On first use macOS will prompt for Accessibility + Screen Recording permissions — grant them, they are required for native UI control.

The extension auto-detects `/Applications/CuaDriver.app/Contents/MacOS/cua-driver`. Override with:

```bash
export CUA_DRIVER_BIN=/path/to/cua-driver
```

### web_cli → the `web` Chrome shim (bundled in this repo)

`web_cli` does **not** use the cross-platform `agent-browser` npm CLI — it calls a custom bash shim that controls your live Chrome via AppleScript + CuaDriver page tools. That shim is shipped in this repo at `scripts/web`, so you don't have to fetch it separately.

Install it onto your `PATH`:

```bash
# From the repo root
mkdir -p ~/.local/bin
cp scripts/web ~/.local/bin/web
chmod +x ~/.local/bin/web
# Ensure ~/.local/bin is on PATH (add to ~/.zshrc / ~/.bashrc if not)
export PATH="$HOME/.local/bin:$PATH"

# Verify
web --help   # prints the QUICK START usage
```

The extension looks for `~/.local/bin/web` first, then falls back to `web` on `PATH`. Point it elsewhere with:

```bash
export WEB_CLI_PATH=/path/to/web
```

Requirements for the shim: **macOS**, **Google Chrome** installed, and **CuaDriver.app** present (the shim uses `cua-driver call page ...` for JS execution and text extraction). Grant Chrome the same Accessibility permissions you gave CuaDriver.

You also need a Chrome logged into the account you want the agent to use. `web_cli` targets a persistent named "Pi Automation" window in your existing Chrome profile — it does **not** open a separate headless browser and does **not** take over your active tab.

---

## 4. One-shot setup script

```bash
git clone https://github.com/MaxAutomize/pi-cua-webcli.git
cd pi-cua-webcli
./install.sh
```

`install.sh` checks for Node/Pi/the native binaries, installs Pi if missing, installs the bundled `web` shim to `~/.local/bin/web`, then runs `pi install` on the local checkout. It is idempotent — safe to re-run.

---

## 5. Use it

Start Pi and just ask — the model picks the right tool:

- *"Take a screenshot of Xcode and click Run"* → `cua_driver`
- *"Open github.com/my/repo and list the open issues"* → `web_cli`
- *"In System Settings, turn on Developer Mode"* → `cua_driver` workflow sequence
- *"Fill the login form on the site I'm on and submit"* → `web_cli` sequence

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CUA_DRIVER_BIN` | `/Applications/CuaDriver.app/Contents/MacOS/cua-driver` | Path to the CuaDriver binary |
| `CUA_TOOL_TIMEOUT_MS` | `120000` | Per-call timeout for cua_driver |
| `CUA_TOOL_MAX_OUTPUT_CHARS` | `12000` | Truncation limit for cua_driver output |
| `WEB_CLI_PATH` | `~/.local/bin/web` → `web` | Path to the `web` browser CLI |

---

## Repository layout

```
pi-cua-webcli/
├── package.json                 # Pi package manifest (declares extensions)
├── install.sh                   # One-command setup helper
├── README.md
├── scripts/
│   └── web                      # macOS-only Chrome shim (AppleScript + cua-driver)
└── extensions/
    ├── cua-tool/
    │   ├── index.ts              # cua_driver tool
    │   ├── native-workflow.ts     # action: "workflow" implementation
    │   ├── sitegeist-runtime.ts  # shared Sitegeist handoff runtime
    │   └── NATIVE_WORKFLOW.md     # workflow docs
    └── web-cli/
        └── index.ts              # web_cli tool
```

The extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript runs directly — no build step.

---

## Notes & requirements

- **macOS only** — `cua_driver` needs CuaDriver.app, and `web_cli` needs the bundled `web` shim which uses AppleScript + cua-driver. None of those exist on Windows/Linux. (The TypeScript extension code itself is cross-platform; only the runtimes it calls are macOS-bound.)
- Node 18+.
- Google Chrome installed.
- Accessibility + Screen Recording permissions for CuaDriver (and Chrome, for the AppleScript path).
- A Chrome profile logged into the accounts you want `web_cli` to use.
- This package runs with full system access (all Pi extensions do). Review the source in `extensions/` and `scripts/web` before installing — it's short and readable.

## License

MIT