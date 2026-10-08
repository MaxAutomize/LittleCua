# LittleCua contributor / automation contract

## Preserve the architecture

- `cua_driver` is the native-app interface. Use a complete safe workflow sequence, independent-window parallel batch, or one JXA/AppleScript program.
- `web_cli` is the Chrome DOM interface. Use direct actions, navigation with `readAfter`, or complete sequences; don't traverse native AX for ordinary webpage content.
- Pi owns the persistent `cua_native` and `web_native` MCP connections. Call them through the existing wrappers and Pi's `ctx.executeTool()` pipeline; preserve permission/redaction hooks and exact targets.
- Never silently retry an MCP error through CLI. Preselected compatibility routes are not error fallbacks. Explicit whole-session rollback must not bypass permissions or replay uncertain actions.
- Retain real native mouse movement, clicks, focus takeover and keyboard input. Disabling decorative cursor animation is not disabling native input.

## A failing workflow requires reusable repair

Stop unchanged retries immediately when targeting, observation, typing, dispatch, verification or continuation is unreliable. Excessive unproductive round trips are also a tool bottleneck, not a completed task.

1. Inspect the actual app/page outcome and failure telemetry. Determine whether any mutation already committed. Preserve the user's current state.
2. Report authentication, permission, cancellation and external-outage blockers. Do not bypass them, auto-approve prompts or treat cancellation as a mandate to continue.
3. Locate the actual installed source. It may be this checkout or a Pi-managed git package, not `~/.pi/agent/extensions`. Fix the reusable extension/shared native layer/shim and consolidate common logic instead of piling on one-off app patches.
4. Add a focused regression for the exact failure. Preserve proven target guards, hook behavior, native input, web/ALEKS interactions, deadlines and cancellation.
5. Validate, regenerate matching DOM templates if the shim changed, reload the installed Pi runtime, and retest through `cua_driver` or `web_cli` from the same preserved state. After reconnect, refresh AX observations; indices/zoom/recording state belong to that connection.
6. Report dispatch separately from verified application success. Never replay potentially committed sends, purchases, submissions, deletions or other consequential actions. A repair guard reset on reload is not permission to replay.

An upstream dependency upgrade is warranted only for a diagnosed missing capability/incompatibility. Inspect versions/schema first, preserve a restore point, respect user authorization, then test the complete integration. Do not blindly install the latest driver or weaken safeguards to make a test pass.

## Checks

From the package root:

```sh
npm run doctor
npm test
bash -n install.sh scripts/web
npm run generate:dom  # only if the matching scripts/web source changed
```

`doctor` performs metadata/prerequisite checks, not desktop/TCC certification. `npm test` runs mocked/portable regressions and does not mutate the desktop or make model calls. Optional live fixtures require an unlocked desktop and permissions; never substitute the user's documents/forms as test fixtures. Don't rerun an interrupted mutation without checking its outcome. Dispose only of self-owned fixture resources.

If only the repository changed, don't reload or replace the user's live installed extensions just to publish it. Reload is required when repairing the active runtime.

Keep dependencies self-contained: ship imported shared helpers, Swift sources and matching generated DOM templates. Host Pi packages remain peers. Do not commit credentials, personal MCP configuration, transport settings, session files, caches, recordings or machine-local reports.

GitHub publication is separate from local experimentation; publish only on explicit user intent. Claims about a release must match the checks actually performed. A local fixture benchmark is not a universal performance or app-compatibility guarantee.
