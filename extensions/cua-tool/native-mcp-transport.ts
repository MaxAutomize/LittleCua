import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NativeOperationError } from "./native-operation-coordinator.ts";

export const CUA_MCP_SERVER = "cua_native";
const PREFIX = `mcp__${CUA_MCP_SERVER}__`;
const SETTINGS = fileURLToPath(new URL("./transport.json", import.meta.url));
type Mode = "mcp" | "cli";
type Scope = { ctx: any; signal?: AbortSignal; mode: Mode; calls: number; callMs: number; cliCalls: number };
const good = (stdout: string) => ({ code: 0, stdout, stderr: "", killed: false });
const textOf = (content: any[]) => (content ?? []).filter(b => b.type === "text").map(b => b.text).join("\n");
function parseValue(value: string) { try { return JSON.parse(value); } catch { return value; } }

/** Keep the automation layer unchanged. Route its existing driver operations through
 * Pi's native MCP pipeline, not a private MCP client or per-operation child process.
 * AsyncLocalStorage binds concurrent workflows to their OWN parent tool context.
 * No error, timeout, permission denial or missing tool ever falls through to CLI.
 */
export function createNativeMcpTransport(pi: any, bin: string, options: { mode?: Mode; settingsPath?: string } = {}) {
  const settingsPath = options.settingsPath ?? SETTINGS;
  let saved: any = {};
  try { saved = JSON.parse(readFileSync(settingsPath, "utf8")); } catch (error: any) {
    if (error?.code !== "ENOENT") throw new Error(`Invalid Cua transport settings: ${String(error)}`);
  }
  const supported = typeof pi.registerMcpServer === "function";
  const configuredMode = options.mode ?? process.env.CUA_TOOL_TRANSPORT ?? saved.mode ?? (supported ? "mcp" : "cli");
  if (!["mcp", "cli"].includes(configuredMode)) throw new Error("CUA_TOOL_TRANSPORT / transport.json mode must be mcp or cli.");
  const mode: Mode = configuredMode;
  if (mode === "mcp" && !supported) throw new Error("Native Cua MCP requires Pi registerMcpServer and ctx.executeTool support.");
  const scope = new AsyncLocalStorage<Scope>();
  const originalExec = pi.exec.bind(pi);
  let registered = false;
  let stopped = false;
  let explicitAgentCursor = false;
  const pointerTools = new Set(["click", "double_click", "right_click", "drag"]);
  function register() {
    if (registered) return;
    pi.registerMcpServer(CUA_MCP_SERVER, { command: bin, args: ["mcp"], exposure: "codemode-deferred", timeout: 120 });
    registered = true;
  }
  if (mode === "mcp") register(); // Registration only; Pi owns startup and shutdown.
  const state = () => {
    const s = scope.getStore();
    if (!s) throw new Error("Cua transport called outside its parent tool execution context.");
    return s;
  };
  function nativeError(message: string, phase: string, dispatchState: "not-dispatched" | "possibly-dispatched" = "not-dispatched", kind: any = "failed") {
    return new NativeOperationError(message.includes("cancel") ? "cancelled" : kind, message, { phase, dispatchState });
  }
  async function ready(signal?: AbortSignal) {
    const s = state();
    if (s.mode !== "mcp") return false;
    signal?.throwIfAborted();
    if (stopped) throw nativeError("Cua native MCP is stopped. Use cua_driver action=start.", "MCP readiness");
    if (typeof s.ctx?.executeTool !== "function") throw nativeError("Pi did not provide ctx.executeTool; reload Pi. No CLI fallback was attempted.", "MCP readiness");
    // Tool definitions stay callable across temporary disconnects; Pi handles reconnect
    // at the next call. This is registration readiness, NOT a health check.
    if (!s.ctx.tools?.some((t: any) => t.name === `${PREFIX}list_windows`)) {
      throw nativeError("Cua native MCP tools are not available. Check /mcp, then reconnect cua_native. No CLI fallback was attempted.", "MCP readiness");
    }
    return true;
  }
  async function invoke(tool: string, payload: any, opts: any = {}, imagePath?: string, raw = false, compact = true) {
    const s = state();
    const signal = opts.signal ?? s.signal;
    await ready(signal);
    const name = PREFIX + tool;
    if (!s.ctx.tools.some((t: any) => t.name === name)) throw nativeError(`Native MCP does not expose ${name}; no CLI fallback.`, name, "not-dispatched", "unsupported");
    signal?.throwIfAborted();
    // User preference: no animated fake pointer. Driver overlay state is scoped
    // to a process and can reset on reconnect, so enforce it at pointer dispatch,
    // not only in the persistent config. One small MCP command replaces the
    // driver's default 750ms glide + 400ms visual dwell. Explicit enable remains
    // available for a later user-requested demonstration in this session.
    if (pointerTools.has(tool) && !explicitAgentCursor) {
      const began = performance.now();
      const disabled = await invoke("set_agent_cursor_enabled", { enabled: false }, opts);
      if (disabled.code !== 0) return disabled;
      if (opts.timeout !== undefined) opts = { ...opts, timeout: opts.timeout - (performance.now() - began) };
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (opts.timeout !== undefined) {
      if (opts.timeout <= 0) { signal?.removeEventListener("abort", abort); throw nativeError("Cua MCP deadline expired before dispatch", name, "not-dispatched", "timeout"); }
      timer = setTimeout(() => { timedOut = true; controller.abort(new Error("Cua MCP deadline expired")); }, opts.timeout);
    }
    const started = performance.now();
    s.calls++;
    try {
      // executeTool returns AgentToolCallOutcome. Read the post-hook structured result;
      // never fetch a private/raw result that could bypass permission or redaction hooks.
      const outcome = await s.ctx.executeTool(name, payload, { signal: controller.signal });
      if (timedOut) throw nativeError("Cua MCP timed out; inspect before retrying. No operation was replayed.", name, "possibly-dispatched", "timeout");
      if (signal?.aborted) throw nativeError("Cua MCP cancelled; inspect before retrying. No operation was replayed.", name, "possibly-dispatched", "cancelled");
      const result = outcome.result;
      const envelope = result?.structuredContent;
      if (outcome.isError || result?.isError || envelope?.isError) {
        return { code: 1, stdout: textOf(result?.content ?? []), stderr: `Native MCP ${tool} failed; no CLI retry.`, killed: false };
      }
      if (!envelope || !Array.isArray(envelope.content)) {
        // A hook may deliberately remove structuredContent. Never recover unredacted
        // bytes from another source, or quietly parse a truncated AX snapshot.
        throw nativeError("Native MCP structured result missing or removed by a hook; no fallback/replay.", name, "possibly-dispatched");
      }
      if (tool === "set_agent_cursor_enabled") explicitAgentCursor = payload.enabled === true;
      if (imagePath) {
        const image = envelope.content.find((b: any) => b.type === "image");
        if (image) {
          // The existing visual wrapper validates freshness/size/type and deletes
          // temporary files. Preserve its exact file lifecycle and image contracts.
          writeFileSync(imagePath, Buffer.from(image.data, "base64"), { mode: 0o600 });
        }
      }
      if (raw) return good(JSON.stringify(envelope, null, compact ? undefined : 2));
      if (envelope.structuredContent !== undefined) return good(JSON.stringify(envelope.structuredContent, null, compact ? undefined : 2));
      return good(textOf(envelope.content) || (imagePath ? `Fresh MCP image written to ${imagePath}` : "MCP operation completed."));
    } catch (error: any) {
      if (error instanceof NativeOperationError) throw error;
      throw nativeError(`Native MCP ${tool} failed: ${error?.message ?? error}. No CLI retry.`, name, "possibly-dispatched", timedOut ? "timeout" : signal?.aborted ? "cancelled" : "failed");
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      s.callMs += performance.now() - started;
    }
  }
  const isDriver = (command: string) => command === bin || command === "cua-driver" || command.endsWith("/cua-driver");
  async function exec(command: string, args: string[], opts: any = {}) {
    const s = scope.getStore();
    if (!s || s.mode === "cli" || !isDriver(command)) {
      if (s && isDriver(command)) s.cliCalls++;
      return originalExec(command, args, opts);
    }
    if (args[0] === "call") {
      const tool = args[1];
      const payload = args[2] && !args[2].startsWith("--") ? JSON.parse(args[2]) : {};
      let imagePath: string | undefined, raw = false, compact = false;
      for (let i = args[2] && !args[2].startsWith("--") ? 3 : 2; i < args.length; i++) {
        if (args[i] === "--compact") compact = true;
        else if (args[i] === "--raw") raw = true;
        else if (args[i] === "--screenshot-out-file" && args[i + 1]) imagePath = args[++i];
        else throw nativeError(`CLI-only flag ${args[i]} cannot be mixed into native MCP. Select CLI transport for the entire session instead.`, tool, "not-dispatched", "unsupported");
      }
      return invoke(tool, payload, opts, imagePath, raw, compact);
    }
    if (args[0] === "status") {
      const result = await invoke("get_config", {}, opts);
      return result.code === 0 ? good(`Cua native MCP connected (${CUA_MCP_SERVER}); persistent stdio, no CLI per operation.`) : result;
    }
    if (args[0] === "config") {
      if (args.length === 1) return invoke("get_config", {}, opts);
      if (args[1] === "set" && args.length === 4) return invoke("set_config", { key: args[2], value: parseValue(args[3]) }, opts);
      if (args[1] === "get" && args.length === 3) {
        const result = await invoke("get_config", {}, opts);
        if (result.code !== 0) return result;
        const config = JSON.parse(result.stdout);
        const value = args[2].split(".").reduce((v, k) => v?.[k], config);
        if (value === undefined) return { ...good(""), code: 1, stderr: `Unknown config key ${args[2]}` };
        return good(typeof value === "string" ? value : JSON.stringify(value));
      }
    }
    if (args[0] === "recording") {
      if (args[1] === "status" && args.length === 2) return invoke("get_recording_state", {}, opts);
      if (args[1] === "stop" && args.length === 2) return invoke("set_recording", { enabled: false }, opts);
      if (args[1] === "start" && args[2] && args.slice(3).every(v => v === "--video-experimental")) return invoke("set_recording", { enabled: true, output_dir: args[2], video_experimental: args.includes("--video-experimental") }, opts);
    }
    // Metadata discovery and OFFLINE media rendering are not stateful computer actions.
    if (["dump-docs", "describe", "list-tools", "--version"].includes(args[0]) || (args[0] === "recording" && args[1] === "render")) {
      s.cliCalls++;
      return originalExec(command, args, opts);
    }
    throw nativeError(`Unsupported Cua CLI operation '${args[0]}' in native MCP mode; use the explicit CLI rollback, not mixed state.`, "MCP routing", "not-dispatched", "unsupported");
  }
  const api = new Proxy(pi, { get(target, key) {
    if (key === "exec") return exec;
    if (key === "cuaMcpReady") return ready;
    if (key === "cuaTransportMode") return () => scope.getStore()?.mode ?? mode;
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  } });
  function wrap(tool: any) {
    return { ...tool, async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const s: Scope = { ctx, signal, mode, calls: 0, callMs: 0, cliCalls: 0 };
      return scope.run(s, async () => {
        let result;
        if (mode === "mcp" && params.action === "stop") {
          if (registered) pi.unregisterMcpServer(CUA_MCP_SERVER);
          registered = false; stopped = true;
          result = { content: [{ type: "text", text: "Stopped this Pi session's Cua MCP connection. The separate legacy daemon and other apps were not stopped." }], details: {} };
        } else if (mode === "mcp" && params.action === "start") {
          stopped = false; register();
          result = { content: [{ type: "text", text: "Cua native MCP startup requested. Pi manages the connection; check /mcp for readiness." }], details: {} };
        } else result = await tool.execute(id, params, signal, onUpdate, ctx);
        return { ...result, details: { ...result.details, transport: { mode: s.mode, server: s.mode === "mcp" ? CUA_MCP_SERVER : undefined, mcpCalls: s.calls, mcpMs: Math.round(s.callMs * 10) / 10, driverCliCalls: s.cliCalls } } };
      });
    } };
  }
  pi.registerCommand?.("cua-transport", {
    description: "Show Cua transport, or save mcp/cli mode and reload (explicit rollback).",
    handler: async (args: string, ctx: any) => {
      const next = args.trim();
      if (!next) { ctx.ui.notify(`Cua transport: ${mode}. Native MCP preserves workflows; CLI is an explicit rollback.`, "info"); return; }
      if (!["mcp", "cli"].includes(next)) { ctx.ui.notify("Usage: /cua-transport [mcp|cli]", "error"); return; }
      if (process.env.CUA_TOOL_TRANSPORT) { ctx.ui.notify("CUA_TOOL_TRANSPORT overrides the saved setting. Change it and restart Pi.", "error"); return; }
      await ctx.waitForIdle();
      // Synchronous read-modify-write: no await/interleaving during the file mutation.
      let current = {}; try { current = JSON.parse(readFileSync(settingsPath, "utf8")); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
      writeFileSync(settingsPath, JSON.stringify({ ...current, mode: next }, null, 2) + "\n", { mode: 0o600 });
      await ctx.reload();
    },
  });
  return { api, wrap, ready, get mode() { return mode; } };
}
