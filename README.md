# LittleCua

**Native macOS + authenticated Chrome automation for [Pi](https://pi.dev), using Pi-owned persistent MCP connections.**

| Agent tool | Transport | Use it for |
|---|---|---|
| `cua_driver` | `cua_native` → `cua-driver mcp` | Native apps, AX targeting, real mouse/keyboard input, screenshots and batched workflows |
| `web_cli` | `web_native` → `cua-driver mcp` (`page` only) | Chrome DOM work in the persistent **Pi Automation** window, using your normal signed-in profile |

Keep using these high-level tools, not raw MCP calls. They preserve target identity, batching, deadlines, permission hooks, screenshots and no-replay safeguards. LittleCua remains **macOS-only**, even if newer upstream drivers support other platforms.

## Required dependencies

| Dependency | Requirement / purpose |
|---|---|
| Node + npm | **Node >=22.19.0**, matching current Pi's host requirement |
| Pi | A current version with built-in MCP enabled, `pi.registerMcpServer()` and `ctx.executeTool()`; this sync was checked with **Pi 1.0.1** |
| CuaDriver | Installed native app/binary providing `mcp` and `dump-docs`; this integration was checked against **0.1.4**. See [upstream native-driver documentation](https://github.com/trycua/cua/tree/main/libs/cua-driver) for installation |
| Google Chrome | `/Applications/Google Chrome.app`; sign in yourself to the accounts you want to automate |
| Python 3 | Browser compatibility-route JSON/geometry handling (`brew install python` if missing) |
| Xcode Command Line Tools | Swift helpers for elevated native windows, local OCR and disposable fixtures; install with `xcode-select --install` |
| macOS permissions | Accessibility, Screen Recording for captures, and Automation/System Events/Chrome approval when macOS requests it |
| Chrome setting | **View → Developer → Allow JavaScript from Apple Events** for the browser bootstrap/compatibility path |

Pi supplies `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` and `typebox`; they are peer dependencies, not bundled copies. No separate npm MCP adapter, Python Cua SDK, Docker/VM, cloud account, or private MCP client is required. AppleScript, AppKit, CoreGraphics and Vision are supplied by macOS; Swift requires the developer tools above.

Don't blindly upgrade a working driver: inspect its schema first. A newer upstream release is **not automatically certified compatible** with this wrapper. Fix the reusable integration and test it before changing transport or resuming an uncertain action.

## Install

```bash
brew install node python
npm install -g @earendil-works/pi-coding-agent
xcode-select --install   # if the Command Line Tools are missing
# Install CuaDriver and Chrome, then grant permissions yourself.

git clone https://github.com/MaxAutomize/LittleCua.git
cd LittleCua
npm run doctor
./install.sh
```

The setup script checks prerequisites, saves a backup of an existing browser shim, installs the matching bundled `scripts/web` at `~/.local/bin/web` (or `WEB_CLI_PATH`), and registers the local checkout with Pi. It does **not** download/update the driver, change TCC permissions, or configure a login daemon. No driver PATH symlink is needed for the default app-bundle installation.

Alternatively, register the git package:

```bash
pi install git:github.com/MaxAutomize/LittleCua
```

That installs the extensions, **not the native prerequisites or browser shim**. From that package's checkout, run `./install.sh`, or copy its matching `scripts/web` to `~/.local/bin/web` and make it executable. Keep the shim and `dom-templates.json` from the **same revision**.

Reload Pi with `/reload`. In `/mcp`, confirm **cua_native** and **web_native** are connected. These are registered by the extensions; do not add duplicate entries to `mcp.json`. A file-configured server with the same name overrides the extension registration. `pi mcp list` does not load extensions, so use the **in-session `/mcp`** to diagnose these servers. Remove any conflicting third-party `/mcp` adapter or duplicate LittleCua extension copies.

## Current transport behavior

- Pi owns stdio startup/shutdown, connection handling, argument validation, permission hooks and nested-call attribution.
- Native actions use the persistent `cua_native` connection. AX indices, zoom and recording state belong to that connection, not the separate legacy daemon. Re-inspect after reconnect before using cached targeting data.
- Chrome's warm dedicated-session DOM path uses `web_native`, without per-action CLI launches. Tab management/bootstrap, exact inactive tabs and trusted real input retain **preselected compatibility routes**. This is intentionally hybrid, not a claim that every action is subprocess-free.
- An MCP error, timeout, missing tool, permission denial or uncertain result **never triggers a CLI retry**.
- Real mouse movement, clicks, focus takeover and keyboard input remain available. The decorative animated pointer is disabled by default; native input itself is not removed.
- `npm run doctor` is read-only: it checks local prerequisites and generated-source integrity, not actual TCC access, MCP connection health or workflow success.

`/cua-transport` and `/web-transport` report mode. `... mcp` restores native mode; `... cli` selects an **explicit whole-session rollback** and reloads. Older Pi hosts without registration support choose legacy mode at load time; upgrade Pi for the documented MCP setup. Never switch transports to bypass permissions or replay an action whose outcome is unknown.

## Minimum-call workflows

Native apps: inspect once if selectors must be discovered, then use a complete safe `sequence`, `parallel` for independent windows, or `program` for one JXA/AppleScript operation. Use `within` for repeated labels and exact PID/window IDs when appropriate. Refresh observations at real transitions, not after every stable field.

```json
{
  "action": "workflow",
  "workflow": {
    "action": "sequence",
    "app": "Calculator",
    "observationPolicy": "fast",
    "steps": [{"action": "inspect", "query": "Calculator"}]
  },
  "screenshotAfter": true
}
```

`screenshotAfter` optionally returns one fresh image in the same call. It is not continuous sight or recording. Keep it off for ordinary AX work. Screenshot failure never replays completed actions. Pixel coordinates are window-local screenshot pixels; don't divide for Retina or add a screen origin.

Chrome: use `web_cli`, not native AX traversal of webpage content. Use `nav` + `readAfter` for open-and-read, or a complete DOM `sequence`:

```json
{
  "action": "sequence",
  "steps": [
    {"action": "click", "selector": "#next"},
    {"action": "wait", "selector": "#nextStep", "waitState": "visible", "readAfter": "summary"}
  ]
}
```

`wait` supports selector, text, URL, enabled/hidden state and exact value. `foreground:true` shows the exact automation tab once at the endpoint through the Cua workflow. Normal DOM work stays background-safe. Trusted input may briefly take focus and restore it.

## Repair is part of completing the workflow

If a tool can't observe, target, type, dispatch, verify or continue reliably—or needs repeated unproductive calls—the task is **not finished**.

1. Stop unchanged retries. Inspect the actual target, outcome and failure telemetry first.
2. Distinguish missing dependencies/schema support from genuine permission, authentication, user-cancellation or external-outage blockers. Report blockers; don't bypass them.
3. Repair/upgrade the **reusable** extension, shared workflow/native layer or browser shim. Consolidate common paths instead of accumulating app-specific hacks. Use the actual installed package path; don't assume the developer's `~/.pi/agent/extensions` layout.
4. Add a focused regression for that exact failure; preserve working native input, exact targets, permission hooks and proven web/ALEKS paths.
5. Regenerate DOM templates if the shim changed, validate, reload, then retest **through `cua_driver`/`web_cli`** from the preserved state.
6. Report **dispatch separately from verified application success**. Never duplicate a send, purchase, submission, deletion or other possibly committed mutation.

Both tools include this contract in their model-facing guidance. The shared repair guard blocks exact unchanged failed mutations within the loaded runtime; read-only diagnosis remains available. This is a safety guard plus agent instruction—not an unattended updater or a promise that every app can be repaired automatically. See [AGENTS.md](AGENTS.md).

## Validation and upgrades

```bash
npm test                 # all portable/mocked regressions + package/dependency checks
npm run doctor           # read-only prerequisites; -- --json for structured output
npm run generate:dom     # after editing bundled scripts/web; no browser actions
bash -n install.sh scripts/web
```

Tests use Pi's existing loader; set `PI_PACKAGE_DIR` for a non-global Pi installation. They don't need model credentials. On macOS, AppleScript compilation checks run without desktop mutation. Tests default to the **bundled** shim, not a developer's private installed version.

Opt-in integration tests need an unlocked desktop and granted permissions:

```bash
PI_OFFLINE=1 npm run test:mcp-live       # self-owned AppKit fixture, real Pi MCP
PI_OFFLINE=1 npm run test:web-live       # self-owned localhost Chrome fixture
PI_OFFLINE=1 npm run test:readiness-live # delayed forms, redirect/focus identity
npm run test:fixture                    # legacy fixture; CUA_TEST_NATIVE_MCP=1 for MCP
npm run test:live                       # read-only capture; Calculator must be open
```

These fixtures are not universal Excel/Blender compatibility tests. Optional `blender-keyboard-live.mjs` additionally requires Blender and the separate Pi Blender extension/bridge; it is not included in `npm test`. Reports from opt-in fixtures go under `~/Library/Application Support/LittleCua/reports/`. Historic local timings in the implementation docs are not fresh release-test results or universal performance promises.

For updates, save a checkpoint, update the Pi package checkout (`pi update --extensions` for managed installs, or `git pull --ff-only` for a clean local checkout), install the matching shim again, test and reload. Preserve any custom changes before replacing a shim. Never copy machine-local transport settings, credentials, caches or recordings into the repository.

## Configuration

| Variable | Purpose |
|---|---|
| `CUA_DRIVER_BIN` | Driver override; otherwise app-bundle binary, then `cua-driver` on PATH |
| `CUA_TOOL_TRANSPORT` / `WEB_TOOL_TRANSPORT` | `mcp` or explicit `cli`; overrides saved transport settings |
| `CUA_TOOL_TIMEOUT_MS` | Cua default timeout (120000 ms) |
| `CUA_TOOL_MAX_OUTPUT_CHARS` | Cua output cap (12000 characters) |
| `WEB_CLI_PATH` | Matching browser shim override; normally `~/.local/bin/web`, then PATH |
| `WEB_SESSION_FILE` / `WEB_SESSION_NAME` / `WEB_CACHE` | Shared browser target/lease locations and named automation window |
| `WEB_SHOW_AGENT_CURSOR=1` | Explicit overlay opt-in for trusted browser compatibility input |
| `PI_PACKAGE_DIR` | Pi installation directory for tests/doctor |

## Source layout

- `extensions/cua-tool/`: workflow engine, MCP transport, exact native keyboard/window helpers, local OCR, inline images, tests and [workflow docs](extensions/cua-tool/NATIVE_WORKFLOW.md).
- `extensions/web-cli/`: DOM MCP transport, target identity, shared lease, readiness/focus, generated templates, tests and [transport docs](extensions/web-cli/NATIVE_MCP.md).
- `extensions/_shared/automation-repair.ts`: repair guidance and unchanged-failed-mutation guard.
- `scripts/web`: matching macOS browser compatibility shim.
- `scripts/doctor.mjs`, `scripts/test.mjs`, `install.sh`: dependency checks, regressions and explicit setup.

Extensions run with your Pi process's system access. Review the source before loading it. **MIT licensed.**
