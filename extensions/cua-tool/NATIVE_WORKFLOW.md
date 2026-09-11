# Cua Integrated Workflow

Primary fast native automation built directly into the Pi `cua_driver` tool as `action: "workflow"`.

## Why it is faster

- Executes up to 30 sequential UI operations in one model tool call instead of alternating screenshots, reasoning, and clicks.
- Defaults to `observationPolicy: "fast"`: one AX observation is reused across the batch and refreshed only by a readiness wait, explicit `fresh`, selector miss, or requested verification.
- Runs 2–12 independent app/window tasks concurrently with `action: "parallel"` while rejecting duplicate target windows.
- Returns one compact success/performance line by default instead of feeding every intermediate observation back to the model.
- Targets named background windows instead of depending on whichever app the user currently has focused.
- Resolves labeled elements by text/role and unlabeled elements by role/occurrence inside the tool.
- For native clicks, AX identifies the target first. `clickMode: "auto"` uses supported AXPress where available and uses a bounded, visible-window mouse fallback for non-pressable rows/labels; `clickMode: "mouse"` forces that path and `clickMode: "ax"` refuses fallback. Ambiguous or moving bounds fail closed.
- Caches app PID + exact window ID for five minutes and self-heals a stale target once.
- Starts the CuaDriver service on demand; an always-running login daemon is not required.
- Cua CLI calls are typically 15–25 ms; AX snapshots are typically 100–300 ms, so avoiding snapshots is the main latency win.

This follows the direction of modern CUA harnesses: Playwright MCP's structured accessibility snapshots, OpenAI Computer Use's ordered `actions[]` batches, and code-execution harnesses that move deterministic work into one program.

## Concurrency and batching

- When the flow is reliably codeable, prefer one `program` in JavaScript (JXA) or AppleScript so macOS executes the entire operation in one `osascript` process.
- If selectors must be discovered, inspect once, then run the program; do not alternate code generation with every click.
- For flows better expressed semantically, put the complete deterministic work in one `sequence`—typically several clicks, fills, keys, and only the readiness checks needed at real transitions.
- Do not spend a model/tool round trip on each small UI change, and do not make a second inspect call after a successful batch.
- Use one `parallel` call for independent app/windows; the tool resolves targets concurrently and rejects duplicate windows so same-window mutations cannot race.
- Prefer `wait` with `query` or `role` over a fixed sleep. It refreshes the shared observation and continues immediately when the native control appears.
- Use `verify` only for consequential endpoints, genuine ambiguity, or explicit user requests. Successful action calls are the normal completion signal.

## Main interface

```json
{
  "action": "workflow",
  "workflow": {
    "action": "inspect",
    "app": "Xcode",
    "windowTitle": "Apple Accounts",
    "query": "Accounts"
  }
}
```

Workflow actions:

- `program` — execute one JavaScript or AppleScript native automation program; top-level programs name their targets, while program steps receive target PID, app name, and window title as arguments
- `inspect` — compact AX tree query; space-separated terms become a local multi-term search when no full phrase matches
- `wait` — fixed delay, or a readiness wait when `query`/`role` is supplied (use this after opening sheets)
- `act` — one semantic, keyboard, pixel, raw, or AppleScript operation
- `sequence` — up to 30 mixed steps in one call; shared observation and compact output by default
- `parallel` — 2–12 independent window tasks executed concurrently in one call
- `launch` — background launch and cache target
- `activate` — explicitly bring a target forward
- `windows` — list/filter windows
- `raw_call` — call any cua-driver MCP tool
- `applescript` — execute unrestricted AppleScript
- `benchmark` — measure local daemon latency
- `clear_cache` — discard cached targets

Sequence controls:

- `observationPolicy: "fast"` (default) — reuse one observation; refresh on waits/misses/explicit freshness
- `observationPolicy: "adaptive"` — refresh after likely state-changing actions
- `observationPolicy: "strict"` — refresh before every semantic action; debugging only
- `responseMode: "compact"` (default) — one performance/result line
- `responseMode: "detailed"` — include every step summary
- step `fresh: true` — force one new observation before that step

For concurrent background use, always provide `workflow.app` and optionally `workflow.windowTitle`. Semantic AX actions stay backgrounded. Explicit `activate` and AppleScripts that activate an application are the exceptions.

Pixel coordinates are **window-local PNG pixels** from the full Cua window screenshot. Use them exactly as shown—do not divide for Retina, convert to screen points, or add the window origin. Set `fromZoom: true` only when coordinates came from a Cua zoom image. For uncertain clicks, set `debugImageOut` to save a fresh crosshair verification PNG.

Example sequence:

```json
{
  "action": "workflow",
  "workflow": {
    "action": "sequence",
    "app": "System Settings",
    "steps": [
      {"action": "click", "query": "Privacy & Security", "role": "Row"},
      {"action": "click", "query": "Developer Mode", "role": "CheckBox"}
    ],
    "verify": "Developer Mode"
  }
}
```

Raw full-power call:

```json
{
  "action": "workflow",
  "workflow": {
    "action": "raw_call",
    "tool": "get_screen_size",
    "payload": {}
  }
}
```

## Unified routing

- Native apps: `cua_driver` with `action: "workflow"` as the primary path; keep multi-step work in one sequence.
- Native visual inspection, screenshots, and zoom: direct `cua_driver` actions return actual image blocks to vision models (not merely file paths).
- Chrome page content: `web_cli`. `web_cli` click/click-text/type already target DOM controls by selector/text without ad-hoc JavaScript. DOM clicks remain valid; trusted click/type is for custom inputs or gesture gates.
- Hard visual web flows: Sitegeist, which uses the same CuaDriver daemon and adaptive polling.
- Legacy VM/sandbox Cua commands remain separate compatibility surfaces.

## On-demand visual feedback (Astra and other vision models)

`Screen Recording` is the macOS permission for screenshots as well as video. OpenAI's documented Astra computer-use integration uses screenshots and tool results, recommends code execution/batching, and allows existing custom UI tools. A continuous recording is not required.

The wrapper now attaches actual PNG/JPEG bytes for `screenshot` and `zoom`. Previously, the CLI could save a file or print a capture summary without delivering an image to Pi, requiring another `read` tool call. `window_state` can also attach a newly written explicitly requested output file, but AX mode still intentionally skips screen capture.

Use top-level `screenshotAfter: true` on a **single-target** `workflow` to return one image of the exact resolved window after the batch:

```json
{
  "action": "workflow",
  "screenshotAfter": true,
  "workflow": {
    "action": "sequence",
    "app": "Calculator",
    "steps": [{"action": "inspect", "query": "Calculator"}]
  }
}
```

Supported workflow actions: `inspect`, `act`, `sequence`, `launch`, `activate`. For a program plus screenshot, put a `program` step inside `sequence`; standalone programs do not return an exact resolved target. Parallel post-capture is deliberately unsupported. An explicit app/bundleId/pid/windowId is required; there is no fallback to capturing another window. Screenshot failure does not replay completed actions.

- Keep `screenshotAfter` off for routine semantic/DOM tasks. It adds capture and model image-processing cost; use it when visual outcome matters.
- No recorder, frame polling, persistent video stream, global capture-mode changes, new permissions, or model change is introduced.
- PNG/JPEG dimensions are not rescaled by the wrapper. Window pixel coordinates remain those supplied by CuaDriver; zoom still requires `fromZoom=true`.
- Automatically created images use private temporary directories, deleted after the request whether or not inline delivery is enabled. Explicit `screenshotOutFile`/`imageOut` files are retained. Images attached to Pi still follow normal session retention.
- Explicit `screenshotOutFile`/`imageOut` files are retained. `returnImage:false` or a text-only model keeps the image as a file instead. Missing/unchanged stale files are never attached. Inline images are capped at 8 MiB.
- Direct screenshot requests with only `appName` require one unambiguous visible window, rather than silently capturing the whole desktop.

Validation: `node ~/.pi/agent/extensions/cua-tool/tests/native-pointer.test.mjs` (bounded AX-geometry/mouse-routing mock) and `node ~/.pi/agent/extensions/cua-tool/tests/visual-results.test.mjs` (capture regression cases), plus `node ~/.pi/agent/extensions/cua-tool/tests/visual-live.mjs` (read-only Calculator test; Calculator must be open). The live test captures only Calculator and never clicks or types.

Local test on 2026-09-06: three direct image calls took 152/161/131 ms; read-only AX batch plus image took 672/271/241 ms (first call cold). These are local tool timings, not end-to-end model benchmarks. The structural saving is one model/tool round trip for screenshot → read, or up to two for workflow → screenshot → read. This is bounded on-demand capture, not continuous model sight: no recorder or frame polling starts by default.

Sources:
- https://learn.chatgpt.com/docs/computer-use
- https://developers.openai.com/api/docs/guides/tools-computer-use
