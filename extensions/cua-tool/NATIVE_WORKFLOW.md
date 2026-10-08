# Cua Integrated Workflow

Primary fast native automation built directly into the Pi `cua_driver` tool as `action: "workflow"`.

See the repository [README](../../README.md) for current dependency/setup requirements and [AGENTS.md](../../AGENTS.md) for the mandatory repair workflow. Dated local benchmarks below are historical evidence, not fresh release-validation guarantees. Package-installed repair guidance resolves to the actual loaded source location.

## Repair-first contract (primary tool description)

The actual model-facing `cua_driver.description` now begins with the repair contract, not just a reference buried in implementation notes: stop unchanged retries, inspect the actual outcome, fix reusable implementation, consolidate/refactor shared paths, add an exact regression, validate, reload, and retest through Cua. A dispatched event is not verified app success. Never replay an uncertain mutation. Permissions, authentication, user cancellation and external outages are blockers, not bypass opportunities. `tests/repair-contract.test.mjs` checks the registered tool definition itself.

### Ordered native keyboard delivery

`native-keyboard.ts` consolidates the exact-PID foreground/focus-restoration code used by real typing and native keyboard shortcuts. It retains the System Events PID predicate as a **reference**, preventing two processes with the same app name from aliasing to one another. Real keyboard routes read the exact PID/window snapshot and prefer its stable AXIdentifier, so Terminal command-title changes cannot redirect or block input. Missing/ambiguous identifiers fail without title fallback; apps without a window identifier retain the unique-title guard. `tests/terminal-dynamic-title.test.mjs` covers the stale-title Settings shortcut. Focus is checked before delivery, during paced typing and before commit; restoration does not override a user who already moved focus elsewhere.

For keyboard-only consoles, use **one** `type_text_chars` request with `key:"return"` (or tab/escape). Characters are paced and the commit is sent through the SAME ordered System Events stream. Do not follow bulk queued typing with a separate `press_key` Return: that mixed route previously overtook text in Blender and split a command. Default pacing is 3ms, with OS event-delivery overhead in addition; this is a reliable bootstrap/input fallback, not the fast path for repeated Blender edits. Once connected, use Blender's direct Python bridge.

Success reports `dispatch-only`; verify the application's result. On a lost focus/error, partial text may remain, so inspect rather than replay. User documents are not cleared or rewritten automatically.

The real disposable-Blender regression (`tests/blender-keyboard-live.mjs`) covers modified function keys with other Blender instances open, long command+Return delivery, full one-time bridge attachment, VIEW_3D restoration and a streamed three-stage event-loop heartbeat with unchanged object identities. No production CAD/simulation window is targeted by that test. Portable tests cover serialization, exact-PID scripts, unsupported keys, cancellation, failure handling and the visible repair contract.

## Shared exact Chrome focus

`native-chrome-focus.ts` is the native foreground helper used by `web_cli action:"focus"` and `foreground:true`. It runs through the normal registered Cua workflow/program path. Chrome's AppleScript window/tab IDs can look numeric but compare as strings: the helper consistently uses `id ... as text`, validates exact IDs, and preflights the target tab and origin before changing focus. It does not rewrite arbitrary caller programs.

Native activation is sent once. A bounded read-only check confirms Chrome is frontmost with the exact requested window and active tab; failed verification does not replay activation or any completed page action. Simple native-app foregrounding should still use `workflow.action:"activate"` with exact PID/CGWindowID rather than hand-written browser scripts.

The portable `tests/native-chrome-focus.test.mjs` covers the large-ID string-coercion failure, validation, guards before dispatch, and single-dispatch verification. The web `tests/readiness-focus-live.mjs` exercises the same helper through the real Pi/Cua pipeline in an owned test window, with no user-form edits or screenshots.

## Native Pi MCP transport (2026-09-29)

The existing `cua_driver` tool and workflow API are unchanged. On current Pi versions, the extension registers `cua_native` with `pi.registerMcpServer()` and uses `ctx.executeTool()` to call the installed signed CuaDriver through **one persistent stdio MCP connection owned by Pi**. It appears in `/mcp` as an extension-provided server. No global `mcp.json`, remote service, new package, driver upgrade, or additional macOS permission is required.

- `native-mcp-transport.ts` translates the existing internal operation specifications into native MCP calls. It does **not** spawn `cua-driver call` for normal operations, AX snapshots, targeting, clicks, typing, or screenshots.
- Pi performs input validation, permission/tool hooks, nested-call attribution, connection management, and shutdown. Raw MCP tools use `codemode-deferred` exposure so 29 low-level schemas do not clutter the primary model tool declarations. Continue using `cua_driver` workflows rather than bypassing the automation layer.
- `AsyncLocalStorage` binds each operation to its own parent execution context. All existing batching, exact-window leases, cached observations, deadlines, screenshot freshness/cleanup, no-replay guard, and native typing/OCR fallbacks remain in place.
- Full structured MCP results are read **after Pi's hooks**. Truncated model-facing AX text is not mistaken for a complete snapshot. If a hook removes structured content, execution fails closed instead of recovering unredacted data elsewhere.
- Timeouts/cancellation propagate to MCP. Errors, blocked permission checks, missing tools, and uncertain mutation outcomes never silently retry through CLI. Pi reconnects a dropped connection on a later call; CuaDriver rejects cached AX indices from the old process. Re-inspect before issuing another mutation.
- Native MCP has its own AX/zoom/recording state, separate from the legacy CLI daemon used by other integrations. Config and recording commands route to the SAME MCP session. Do not mix an AX index or zoom coordinate context from CLI/web tools into an MCP mutation. Session-scoped recording does not survive a reconnect.
- `status` checks the native connection with `get_config`. `stop` disconnects this Pi session's registered Cua MCP server, not other sessions or the legacy daemon. `start` requests registration again; `/mcp` shows readiness.
- A cold/expired capability check still runs `dump-docs` once (10-minute metadata cache). AppleScript/JXA, local OCR, full-desktop `screencapture`, and offline recording rendering retain their existing native processes. This Cua connection is separate from `web_cli`'s `web_native` transport; Sitegeist and other integrations retain their own compatibility runtimes.
- CLI-only raw flags such as `--socket` and `--no-daemon` fail explicitly in native mode instead of mixing stateful connections.

### Rollback / transport selection

`/cua-transport` reports the mode. `/cua-transport cli` saves CLI mode in the extension's `transport.json` and reloads Pi. `/cua-transport mcp` restores native MCP and reloads. `CUA_TOOL_TRANSPORT=cli` or `mcp` can override the saved mode at process start. Native MCP is the default when Pi exposes the required API; older harnesses without registration support retain the legacy path. Every Cua result includes `details.transport` with the selected mode, native call count, elapsed native-call time, and driver CLI-call count.

Save a checkpoint of the installed source and shim before transport upgrades. Machine-local backup paths/settings are not distributed with this package.

### Verified local results

Final quiet-machine, interleaved warm comparisons on 2026-09-29 (same wrapper/fixture targets; Pi's real MCP nested-call pipeline versus a warmed legacy daemon):

| Operation | Legacy median | Native MCP median | Reduction |
|---|---:|---:|---:|
| Screen-size query | 28.9 ms | 11.0 ms | 62% |
| Window listing | 34.2 ms | 10.8 ms | 69% |
| Fixture AX snapshot | 63.4 ms | 20.7 ms | 67% |
| Fixture screenshot | 157.4 ms | 125.7 ms | 20% |
| Four-field AX batch | 159.9 ms | 111.2 ms | 30% |

16 samples per path except screenshots (8). These are local tool timings, NOT model/network latency or a guarantee of whole-task speed. Image capture, macOS/app response, and model reasoning still take time. Raw measurements: `~/Library/Application Support/LittleCua/reports/native-mcp-latency-2026-09-29T19-42-33.861Z.json`.

Validation: all portable regressions passed, plus **10 native fixture scenarios / 706 assertions**, real Pi permission-hook rejection, post-action image delivery, stale AX rejection after a real MCP reconnect, and zero per-action Cua CLI invocations. Fixture report: `~/Library/Application Support/LittleCua/reports/native-interaction-2026-09-29T19-41-45-896Z.md`.

From the repository/package root:

```sh
for f in extensions/cua-tool/tests/*.test.mjs; do node "$f" || exit 1; done
CUA_TEST_NATIVE_MCP=1 PI_OFFLINE=1 node extensions/cua-tool/tests/native-fixture.e2e.mjs
PI_OFFLINE=1 node extensions/cua-tool/tests/native-mcp-live.mjs
```

The integration harness uses deterministic in-memory fixture tool calls through the actual Pi SDK and built-in MCP extension; it makes no model requests. It compiles/owns temporary AppKit windows, never edits user documents, tears down its MCP children, and restores the prior foreground app.

## Why it is faster

- Executes up to 30 sequential UI operations in one model tool call instead of alternating screenshots, reasoning, and clicks.
- Defaults to `observationPolicy: "fast"`: one AX observation is reused across the batch and refreshed only by a readiness wait, explicit `fresh`, selector miss, or requested verification.
- Runs 2–12 independent app/window tasks concurrently with `action: "parallel"` while rejecting duplicate target windows.
- Returns one compact success/performance line by default instead of feeding every intermediate observation back to the model.
- Targets named background windows instead of depending on whichever app the user currently has focused.
- Resolves labeled elements by text/role and unlabeled elements by role/occurrence inside the tool. Use `within` to require an ancestor heading/panel context when labels such as Edit, Continue, Review, or Save repeat.
- For native clicks, AX identifies the target first. `clickMode: "auto"` uses supported AXPress where available and uses a bounded, visible-window mouse fallback for non-pressable rows/labels; `clickMode: "mouse"` forces that path and `clickMode: "ax"` refuses fallback. Ambiguous or moving bounds fail closed.
- Composite native controls can expose the label but not their dropdown arrow (Terminal's Image path control is one example). If AXShowMenu dispatch is not accepted, inspect the outcome rather than repeating it. Use a semantic click with explicit `clickMode:"mouse", clickAnchor:"trailing"` to target the arrow within fresh, unique AX bounds. This preserves actual native mouse input and move/cancel guards without storing screen coordinates. Menu items advertising AXPick use native `action:"pick"`, avoiding an unsafe mouse-center calculation when menus extend outside their owner window.
- When a **native button is absent from AX** (for example Blender's owner-drawn Save/Don't Save prompt), use the explicit `vision_click` step instead of repeatedly trying `click` or using remembered pixels. It captures the exact target window, reads text once with local Apple Vision, requires both the unique **exact** button `query` and visible dialog `within` context, clicks only the newly matched screenshot point once, and can verify `expectWindowClosed: true` in the same workflow. Missing/ambiguous text fails before dispatch. It does not automatically switch to OCR after an AX failure or replay a click whose result is uncertain.
- Caches app PID + exact window ID for five minutes and self-heals a stale target once.
- AppKit Open/Save panels can have WindowServer layer 8 and are omitted by the installed driver's layer-zero window catalog even though exact-ID AX inspection works. Explicit discovery and definite named-window misses supplement successful MCP metadata with a read-only native CG catalog of elevated regular-app windows; ordinary successful cached-window routes remain unchanged. No native failure/permission denial is retried through CLI. Exact IDs and bounds are independently used by normal native AX/screenshot operations.
- Modified character shortcuts in AppKit file panels use the shared exact-PID/window-identifier real keyboard transaction, because postToPid can report dispatch without invoking panel key equivalents. Other apps retain their existing native hotkey paths. Portable tests and the disposable `native-file-panel-fixture.swift` cover this boundary. Live verification passed through `cua_driver`: an actual layer-8 Open panel was discovered, and Cmd-Shift-G produced the observed `GoToWindow` sheet / `PathTextField`. Launch the fixture as a normal .app, not a bare CLI process (a bare process can appear in AX but cannot reliably become frontmost; the guard correctly rejects it). Opt-in runner: `node tests/native-file-panel-fixture.mjs start`, then use its PID with Cua and clean up with `node tests/native-file-panel-fixture.mjs stop <directory>`. It never opens/modifies a user document.
- Pi owns the persistent MCP process for the session; CLI rollback starts the legacy service on demand. Neither needs a login daemon.
- Native MCP removes per-operation CLI spawning. Avoiding unnecessary snapshots and model round trips remains important; app-specific AX response times vary.

This follows the direction of modern CUA harnesses: Playwright MCP's structured accessibility snapshots, OpenAI Computer Use's ordered `actions[]` batches, and code-execution harnesses that move deterministic work into one program.

## Concurrency and batching

- When the flow is reliably codeable, prefer one `program` in JavaScript (JXA) or AppleScript so macOS executes the entire operation in one `osascript` process.
- If selectors must be discovered, inspect once, then run the program; do not alternate code generation with every click.
- For flows better expressed semantically, put the complete deterministic work in one `sequence`—typically several clicks, fills, keys, and only the readiness checks needed at real transitions.
- Do not spend a model/tool round trip on each small UI change, and do not make a second inspect call after a successful batch.
- Use one `parallel` call for independent app/windows; the tool resolves targets concurrently and rejects duplicate windows so same-window mutations cannot race.
- Prefer `wait` with `query` or `role` over a fixed sleep. It refreshes the shared observation and continues immediately when the native control appears.
- Use `verify` only for consequential endpoints, genuine ambiguity, or explicit user requests. Successful action calls report dispatch, not proof of application success; verify consequential or uncertain endpoints.

## Reliability boundaries

- Every workflow has one monotonic deadline. It covers daemon readiness, target resolution, queue time, AX reads, waits, JXA/AppleScript, mouse grounding, dispatch, verification, and an opt-in `screenshotAfter` capture. Each subcall receives only the remaining budget and honors Pi's abort signal when the underlying process supports it.
- LittleCua coordinates **only its own process-local native operations**. Exact same-window workflows serialize; pid-scoped mouse-grounding recipes also serialize because they establish a driver coordinate context. Independent exact-window AX reads can still run in parallel. The coordinator has a bounded pending queue and rejects cancellation before dispatch. It does not claim to coordinate other processes, `web_cli`, direct shell calls, or a user's own mouse/keyboard activity.
- `screenshotAfter` holds the resolved exact-window lease through the one post-action capture, so another LittleCua same-window workflow cannot interleave between that batch and its capture. This is still not an OS-level transaction: other software or the user can change a window at any time.
- No mutation is replayed after timeout, transport failure, or other ambiguous dispatch result. Failures identify `timeout`, `cancelled`, `unsupported`, queue saturation, or general failure, plus the completed-step count and whether the last operation was `not-dispatched`, `dispatch-only`, or `possibly-dispatched`. Inspect before retrying a mutation.
- On first workflow use, LittleCua performs a lightweight, in-memory read of the installed public `cua-driver dump-docs` schema/version. It only gates features actually exposed by the installed driver (such as pixel click and window screenshots); it never upgrades the driver or changes its persistent configuration.
- The mouse fallback rechecks the exact visible window after its fresh frame. It tolerates up to three points of one-time WindowServer decoration correction, but rejects larger movement before dispatch. Ambiguous or disabled AX targets fail closed. Mutating selectors with multiple enabled matches must provide `within` or an explicit `occurrence`; the workflow never silently chooses the first duplicate. For `fill`, LittleCua mouse-grounds the field, refreshes its AX identity, then uses `set_value`; this avoids unreliable background Cmd-A routing while preserving exact replacement semantics. Focused `type_text` remains available for cleared fields and navigation flows.
- There is no implemented OS-level user-intervention signal in CuaDriver 0.1.4, so LittleCua does not invent or claim one.

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
- `vision_click` — explicit one-call local OCR fallback for a native owner-drawn control missing from AX; requires `query` and `within`, optionally `expectWindowClosed`. Do not use for ordinary AX or webpage DOM controls.
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

Example for an already visible Blender quit confirmation (only when the user has explicitly chosen to discard that document's unsaved changes):

```json
{
  "action": "workflow",
  "workflow": {
    "action": "sequence",
    "app": "Blender",
    "pid": 12345,
    "windowTitle": "Example.blend",
    "steps": [{"action":"vision_click","query":"Don't Save","within":"Save changes before closing?","expectWindowClosed":true}]
  }
}
```

This does not infer permission to discard unsaved data. The OCR match does not identify arbitrary unlabeled icons; exact visible text and dialog context are mandatory. If the window does not close, inspect its actual state before retrying and never repeat the click blindly.

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
- Explicit `screenshotOutFile`/`imageOut` files are retained. With `returnImage:false` or a text-only model, only an explicit output path retains the image; an implicit temporary capture is discarded. Missing/unchanged stale files are never attached. Inline images are capped at 8 MiB.
- Direct screenshot requests with only `appName` require one unambiguous visible window, rather than silently capturing the whole desktop.

Validation from the repository root: `npm test` (portable Pi loader; deadline, coordination, no-replay, pointer, selector, and visual regressions), `npm run test:fixture` (temporary self-owned AppKit spreadsheet/form fixture with an app-owned JSON oracle), and `npm run test:live` (read-only Calculator capture; Calculator must be open). The fixture validates actual 3×4 cell and form results through both AX and oracle reads, exact two-window targeting, disabled/ambiguous/moved-target rejection, concurrent requests, queued cancellation, deadline expiry, repeated deterministic data entry, and temporary-resource cleanup. It compiles under a temporary directory, owns only its own fixture process/windows, restores the prior foreground app, and never opens user documents or settings. The Calculator test captures only Calculator and never clicks or types. The generated detailed matrix report is written under `~/Library/Application Support/LittleCua/reports/`.

Local test on 2026-09-06: three direct image calls took 152/161/131 ms; read-only AX batch plus image took 672/271/241 ms (first call cold). These are local tool timings, not end-to-end model benchmarks. The structural saving is one model/tool round trip for screenshot → read, or up to two for workflow → screenshot → read. This is bounded on-demand capture, not continuous model sight: no recorder or frame polling starts by default.

Sources:
- https://learn.chatgpt.com/docs/computer-use
- https://developers.openai.com/api/docs/guides/tools-computer-use
