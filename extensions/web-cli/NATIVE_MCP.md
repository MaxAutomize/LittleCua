# Web CLI native Pi MCP transport

The `web_cli` interface stays intact. See the repository [README](../../README.md) for current dependencies and setup, and [AGENTS.md](../../AGENTS.md) for the repair contract. This package sync was checked against Pi 1.0.1 and CuaDriver 0.1.4; dated benchmarks below describe earlier local runs, not fresh release certification.

## Architecture and scope

`web_cli` remains the editable high-level extension. It registers the signed local CuaDriver binary as Pi's `web_native` stdio MCP server and calls `mcp__web_native__page` through `ctx.executeTool()`. Pi owns startup, connection/reconnection, validation, permission hooks and shutdown. Only `page` is exposed from this server; unrelated Cua tools are hidden. The existing `cua_native` server and its coordinate/AX state remain independent.

The warm dedicated-session path for DOM queries, synthetic clicks, fills, select, submit, run/run-main, scroll, readiness waits and sleep makes **no per-action `web` or Cua CLI process launches**. It retains the authenticated normal Chrome profile and persistent named Pi Automation window. This is not headless Chrome, a second login or a remote browser service.

Some operations deliberately retain their proven compatibility routes, selected BEFORE execution:

- Exact inactive-tab targets, including `tab:ID`, URL/title/index resolution and explicit `active`.
- Tab/session management and initial target bootstrap.
- Trusted OS mouse/keyboard input, browser gesture gates and special typing such as ALEKS `[[RIGHT]]`.
- FullCalendar pointer-only time-slot selections: selector and ranked-text clicks share a DOM preflight that returns `dispatched:false` before clicking. The router then chooses native mouse input on the pinned exact tab, briefly foregrounding that window and restoring prior focus. Ordinary controls, including buttons inside calendars, remain synthetic. No trusted retry follows a failed/uncertain native dispatch.
- A navigation's required exact-tab URL-transition read also renews the new document's identity marker, avoiding a complete window rediscovery after navigation.

This is a measured hybrid integration, not a claim that every browser operation is subprocess-free. No native MCP failure, permission denial, timeout or uncertain result is retried through CLI. CLI rollback is explicit.

## Target identity and concurrency

The bridge parses numeric state files as data, never by evaluating them. A random per-bridge identity is installed through the exact remembered Chrome tab, in the automation JavaScript world. Every native DOM action checks that identity before executing its requested source. If the user switched another tab in the bot window, the guard reports `dispatched:false`; only then may the bridge restore the remembered target and execute once. It never falls back to the front user window.

Explicit URL targets are resolved once to an exact tab ID and kept in a bounded (32-entry), runtime-local affinity cache. That identity survives server/SPA confirmation redirects: a later read using the original URL remains on the previously selected tab. Closed/rejected pinned tabs fail rather than adopting a new or frontmost tab. `active`, title, and index targets are not cached. Tool text now exposes the stable `[web_cli target: tab:ID]` for explicit targets, so continuations can retain that ID even across runtime reloads.

A shared cross-process lock uses the existing `chrome-session.env.lock` location and covers a whole native sequence, not just individual steps. Legacy child commands can inherit this lock only with the matching PID and private lease token; they cannot remove the parent's lease. Cancellation while queued does not dispatch a browser operation. This coordinates cooperating Pi/CLI clients, not human input or arbitrary third-party programs. Already-started browser JavaScript cannot be undone by cancellation.

`details.transport` records mode/server, MCP calls/time, planned compatibility commands and identity repairs. Native operation timeouts cover bootstrap, waits and dispatch. The shared lock has its own bounded acquisition wait.

## Conditional readiness and explicit foreground (2026-10-03)

`wait` can now require a selector, visible text, URL substring, or exact field value. `waitState` supports `visible` (default), `hidden`, `attached`, `detached`, and `enabled`. Conditions combine, use a bounded deadline, and return immediately when satisfied. Add `readAfter:"summary"` or `"text"` to retrieve the next screen in the same call. Bare `wait` keeps its original document-readiness behavior; fixed `sleep` is unchanged.

```json
{"action":"sequence","foreground":true,"steps":[
  {"action":"click","selector":"#next"},
  {"action":"wait","selector":"#nextStep","waitState":"visible","ms":10000,"readAfter":"summary"}
]}
```

Waiting reads DOM state only; it never clicks, submits, or returns the tested field's actual contents. Native errors stop probing, cancellation/deadlines are respected, and readiness timeouts are not classified as failed mutations by the shared repair guard. A satisfied predicate proves only the requested condition, not that every application operation succeeded.

`foreground:true` on a successful action/sequence brings its exact selected tab forward once at the endpoint. `action:"focus"` focuses an already-open target without reading form contents. Both call the registered `cua_driver` workflow—not raw MCP or an alternate input fallback. The shared Cua helper compares Chrome IDs as text, guards the exact tab/origin before dispatch, activates once, and verifies native foreground/window/tab identity. If focus fails after a page mutation, the result explicitly records `pageActionCompleted`, `foregroundFailed`, and `noReplay`.

Default DOM work stays background-safe. Browser Chrome IDs and native CGWindowIDs are different namespaces; callers no longer need to guess or hand-write ID comparisons just to show a form. Batch output reports its stable target once rather than repeating it per step.

Portable validation: `tests/page-readiness-focus.test.mjs`, `tests/target-affinity.test.mjs`, and Cua's `tests/native-chrome-focus.test.mjs`. The opt-in `PI_OFFLINE=1 node tests/readiness-focus-live.mjs` uses actual Pi web/native-Cua pipelines on a separate self-owned localhost window; it checks delayed form readiness, immediate-ready waits, enabled/hidden/value conditions, confirmation redirects, focus identity, one submission, and preservation of pre-existing tabs. It never edits an account/passport form. Reports are written under `~/Library/Application Support/LittleCua/reports/`; local timings are not universal end-to-end speed claims.

## Preserved DOM behavior

`dom-templates.json` is generated from the bundled trusted `scripts/web` DOM functions (or the explicit `WEB_CLI_PATH` override). The installed shim must match this source. It preserves the existing text ranking, framework-aware filling, jQuery combobox handling, main-world injection and isolated-world fill fallback. A SHA-256 guard refuses to run stale templates after the source script changes.

After editing DOM behavior, run from the actual package root:

```sh
npm run generate:dom
# Or, for an intentionally customized installed shim:
WEB_CLI_PATH="$HOME/.local/bin/web" npm run generate:dom
```

Then validate and reload Pi. Generation captures only the trusted local shell's JavaScript-producing functions; it does not run browser operations.

The native envelope returns full post-hook MCP structured data, rather than parsing the truncated model-visible text. An undefined JS return value is recorded as a completed execution, not a reason to run a mutation again. Strict CSP fill fallback is allowed only after the known inline non-execution response, not after a transport error or a JavaScript failure after dispatch.

## Real native input and cursor preference

Real OS clicks, actual mouse movement, focus takeover, and real character/key events remain essential for native apps and browser controls requiring them. This upgrade does **not** replace those actions with synthetic DOM clicks. It removes unnecessary transport work and the decorative animated agent pointer, not native input capability.

The user requested no animated blue/fake pointer. The saved driver preference is `agent_cursor.enabled=false`. Because cursor state can reset per process, merely disabling a one-shot CLI call does not affect the next fresh invocation:

- Cua's native MCP wrapper disables the overlay immediately before pointer actions, using the same persistent connection. A later explicit `agent_cursor_enabled=true` request can permit the overlay for that Cua session.
- Legacy trusted browser input now requires a persistent driver daemon, disables its overlay, and verifies `enabled=false` before dispatch. It refuses to click if this cannot be confirmed. `WEB_SHOW_AGENT_CURSOR=1` explicitly opts out of enforcement.
- Actual native mouse/AX dispatch remains unchanged. The default visual 750 ms glide + 400 ms dwell is not incurred with the overlay disabled.
- The existing browser activation/focus-delivery waits remain where the trusted-input path needs them. No claim of literally zero-time OS input is made.

Other already-open Pi sessions must reload to acquire the new wrapper code; they are not silently taken over or terminated.

## Verification

Portable tests cover native routing, identity rejection, permission failure without fallback, no mutation replay, cancellation/deadlines, shared/inherited locking and safe JS argument quoting. The 2026-10-03 calendar regression covers the USPS FullCalendar selector/text pattern, zero synthetic clicks before native routing, exact-tab focus input, preserved ordinary/nested-button behavior, and no replay after native-pointer failure. Existing Cua regression tests also pass, including the new pre-click overlay-disable guard.

The isolated real-Pi/browser integration test passed **270 assertions** against self-owned localhost pages and a separate named test window. Coverage includes fresh session creation, navigation/readAfter, queries, Unicode fill, ranked clicks, selects, main-world access, strict CSP, exact inactive tabs, user tab-switch guarding, undefined results, >60KB structured results, native permission hooks, MCP reconnect, sequence stop-on-error, queued cancellation, trusted keyboard input, and a local server-side event oracle. All pre-existing Chrome window IDs/tab IDs/URLs/active-tab selections were compared before/after and preserved. Fixture windows and temporary files were removed and prior app focus restored. No model requests or account transactions were made.

Final run: `~/Library/Application Support/LittleCua/reports/native-web-mcp-2026-09-29T20-26-27.299Z.json`.

| Local operation | CLI median | Native median | Reduction |
|---|---:|---:|---:|
| Title | 230 ms | 145 ms | 37% |
| Summary | 250 ms | 151 ms | 40% |
| Field value | 227 ms | 153 ms | 33% |
| Navigate + readiness + summary | 1167 ms | 761 ms | 35% |
| Four-step form/read batch | 935 ms | 602 ms | 36% |

12 samples per path, interleaved on the same fixture, real Pi native nested-tool pipeline. Navigation samples re-prime native identity outside the timer after the intervening legacy control navigation. These are warm local tool measurements; earlier runs varied (roughly 20–40% gains). They do not include model/network latency or prove a universal whole-task improvement. Cold bootstrap/document repair and planned native-input compatibility routes have different costs.

Validation commands:

```sh
bash -n ~/.local/bin/web
node ~/.pi/agent/extensions/web-cli/tests/native-web.test.mjs
node ~/.pi/agent/extensions/web-cli/tests/target-affinity.test.mjs
PI_OFFLINE=1 node ~/.pi/agent/extensions/web-cli/tests/native-web-live.mjs
for f in ~/.pi/agent/extensions/cua-tool/tests/*.test.mjs; do node "$f" || exit 1; done
```

## Rollback and backups

`/web-transport` reports mode. `/web-transport cli` saves explicit CLI mode and reloads; `/web-transport mcp` restores native mode. `WEB_TOOL_TRANSPORT=cli|mcp` overrides the saved mode at process start. Normal MCP diagnosis is through `/mcp` and its `web_native` entry; do not bypass a permission denial with another transport.

Checkpoint your actual installed source and shim before upgrades. Machine-local backups and transport settings are not shipped. This repository now includes both MCP transports, the shared repair guard and their required local helpers.
