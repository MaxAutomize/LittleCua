# Changelog

## 1.3.0 — MCP-native workflow sync

- Package the current Pi-owned `cua_native` and `web_native` stdio transports, including their shared helpers and regressions.
- Preserve exact native targets, full post-hook structured results, permission hooks, cancellation/deadlines and no CLI fallback after uncertain MCP failure.
- Include repair-first model guidance and the shared unchanged-failed-mutation guard; resolve repair guidance to the actual installed package source.
- Include ordered real keyboard delivery, stable AX window identifiers, elevated AppKit panel discovery, menu actions and explicit local OCR targeting.
- Include Chrome identity/lease guards, redirect target affinity, conditional readiness, exact-tab foregrounding and pre-dispatch calendar native-input routing.
- Add prerequisite checks, dependency/setup documentation and a complete regression runner. Default generation/tests to the bundled shim; honor custom driver paths without requiring a PATH symlink.
- Keep machine-local transport settings and backups out of git. Preserve existing shims during explicit setup.

### Validation scope

Checked locally with Pi 1.0.1 and CuaDriver 0.1.4:

- 20 regression files passed; read-only prerequisite checks passed.
- Real native MCP fixture passed: image delivery, permission-hook rejection, stale AX rejection after reconnect, final fixture field values and zero per-operation Cua CLI launches.
- The browser live fixture reached its final pre-existing-tab preservation assertion and failed because a pre-existing tab was absent from the final snapshot. Cause was not established; **that run is not a full pass**. No universal browser/app compatibility certification is claimed.
- Historical dated benchmark tables in implementation documents describe earlier local runs, not these release checks.

This is a GitHub source/package update; it does not install a new native driver or publish an npm package.
