# Cua Integrated Workflow

Experimental full-power native automation built directly into the Pi `cua_driver` tool as `action: "workflow"`.

## Why it is faster

- Keeps CuaDriver's daemon hot.
- Caches app PID + exact window ID for 60 seconds.
- Targets named background windows instead of depending on the frontmost app.
- Resolves accessible elements by text/role inside the tool.
- Executes up to 30 sequential UI operations in one model tool call.
- Uses fresh AX snapshots for semantic steps, allowing the user to keep working in another app.
- Cua CLI calls are typically 15–25 ms; AX snapshots are typically 100–300 ms.

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

- `inspect` — compact AX tree query
- `act` — one semantic, keyboard, pixel, raw, or AppleScript operation
- `sequence` — up to 30 mixed steps in one call
- `launch` — background launch and cache target
- `activate` — explicitly bring a target forward
- `windows` — list/filter windows
- `raw_call` — call any cua-driver MCP tool
- `applescript` — execute unrestricted AppleScript
- `benchmark` — measure local daemon latency
- `clear_cache` — discard cached targets

For concurrent background use, always provide `workflow.app` and optionally `workflow.windowTitle`. Semantic AX actions stay backgrounded. Explicit `activate` and AppleScripts that activate an application are the exceptions.

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

- Native apps: `cua_driver` with `action: "workflow"` by default.
- Native visual inspection, screenshots, and zoom: direct `cua_driver` actions.
- Chrome page content: `web` CLI.
- Hard visual web flows: Sitegeist, which uses the same CuaDriver daemon and adaptive polling.
- Legacy VM/sandbox Cua commands remain separate compatibility surfaces.
