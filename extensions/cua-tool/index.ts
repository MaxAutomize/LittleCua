import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, statSync, writeFileSync } from "fs";
import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import nativeWorkflowExtension, { nativeFastSchema } from "./native-workflow.ts";

const CUA_TIMEOUT_MS = Number(process.env.CUA_TOOL_TIMEOUT_MS ?? 120_000);
const CUA_DRIVER_BIN = process.env.CUA_DRIVER_BIN ?? (existsSync("/Applications/CuaDriver.app/Contents/MacOS/cua-driver") ? "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" : "cua-driver");
const stringArray = Type.Optional(Type.Array(Type.String(), { description: "Extra literal CLI arguments appended at the end. Use for new Cua CLI flags not yet modeled." }));

function need(value: unknown, name: string): string {
  if (value === undefined || value === null || value === "") throw new Error(`Missing required parameter: ${name}`);
  return String(value);
}

// Coerce numeric strings to numbers so a model that serializes a number as a string
// (e.g. pid: "24748") still works instead of throwing "Missing required numeric
// parameter: ...". Non-numeric / empty strings still fail.
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
  if (typeof value === "string") { const t = value.trim(); if (t === "") return undefined; const n = Number(t); return Number.isNaN(n) ? undefined : n; }
  return undefined;
}

function needNumber(value: unknown, name: string): number {
  const n = asNumber(value);
  if (n === undefined) throw new Error(`Missing required numeric parameter: ${name}`);
  return n;
}

function needArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Missing required array parameter: ${name}`);
  return value.map(String);
}

function addOpt(args: string[], flag: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") args.push(flag, String(value));
}

function addBool(args: string[], flag: string, value: unknown) {
  if (value === true) args.push(flag);
}

function appendExtra(args: string[], extra?: string[]) {
  if (extra?.length) args.push(...extra);
}

function cleanCuaStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter((line) => !/core\.telemetry|PostHog|Telemetry enabled|Recording event: cli_command|Sent event to PostHog|Set up PostHog user/.test(line))
    .join("\n")
    .trim();
}

function compactToolText(text: string): string {
  const max = Number(process.env.CUA_TOOL_MAX_OUTPUT_CHARS ?? 12000);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.floor(max * 0.65))}\n\n…[truncated ${text.length - max} chars]…\n\n${text.slice(-Math.floor(max * 0.35))}`;
}

function readableFileSize(path: string): string | undefined {
  try {
    const bytes = statSync(path).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return undefined;
  }
}

function writeTempJson(prefix: string, data: unknown): string | undefined {
  try {
    const path = `/tmp/${prefix}-${Date.now()}.json`;
    writeFileSync(path, JSON.stringify(data, null, 2));
    return path;
  } catch {
    return undefined;
  }
}

async function run(pi: ExtensionAPI, command: string, args: string[], signal: AbortSignal | undefined, timeoutMs?: number, onUpdate?: (partial: any) => void) {
  const execCommand = command;
  const execArgs = args;
  onUpdate?.({ content: [{ type: "text", text: `${execCommand} ${execArgs.map((a) => JSON.stringify(a)).join(" ")}` }] });
  const result = await pi.exec(execCommand, execArgs, { signal, timeout: timeoutMs ?? CUA_TIMEOUT_MS });
  const stdout = result.stdout?.trim() ?? "";
  const stderr = cleanCuaStderr(result.stderr?.trim() ?? "");
  const text = compactToolText([stdout, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n\n") || `${command} exited with code ${result.code}`);
  return {
    isError: result.code !== 0,
    content: [{ type: "text" as const, text }],
    details: { command: execCommand, args: execArgs, requestedCommand: command, requestedArgs: args, code: result.code, killed: result.killed, stdout, stderr },
  };
}

async function ensureCuaDriverDaemon(pi: ExtensionAPI, signal: AbortSignal | undefined) {
  const status = await pi.exec(CUA_DRIVER_BIN, ["status"], { signal, timeout: 10_000 });
  if (status.code === 0) return;
  await pi.exec("open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve"], { signal, timeout: 10_000 });
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const probe = await pi.exec(CUA_DRIVER_BIN, ["status"], { signal, timeout: 5_000 });
    if (probe.code === 0) return;
  }
}

const commonTail = {
  timeoutMs: Type.Optional(Type.Number({ description: "Override command timeout in milliseconds." })),
  extraArgs: stringArray,
};

const driverSchema = Type.Object({
  action: StringEnum(["status", "start", "stop", "permissions", "config", "list_apps", "list_windows", "launch_app", "window_state", "get_window_state", "click", "double_click", "right_click", "drag", "type_text", "type_text_chars", "set_value", "press_key", "hotkey", "scroll", "page", "screenshot", "zoom", "screen_size", "cursor_position", "move_cursor", "agent_cursor_state", "agent_cursor_enabled", "agent_cursor_motion", "agent_cursor_style", "recording", "replay_trajectory", "workflow", "tool", "raw"] as const),
  tool: Type.Optional(Type.String({ description: "Advanced/raw cua-driver MCP tool name, e.g. get_window_state, click, type_text, page." })),
  workflow: Type.Optional(nativeFastSchema),
  jsonArgs: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Advanced JSON object passed to a cua-driver tool." })),
  pid: Type.Optional(Type.Number({ description: "Target process id from launch_app/list_apps." })),
  windowId: Type.Optional(Type.Number({ description: "CGWindowID/window_id from launch_app/list_windows." })),
  bundleId: Type.Optional(Type.String({ description: "App bundle id for launch_app or page enable_javascript_apple_events." })),
  appName: Type.Optional(Type.String({ description: "App display name for launch_app when bundle id is unknown." })),
  urls: Type.Optional(Type.Array(Type.String(), { description: "URLs or file paths handed to launch_app without foregrounding." })),
  createsNewApplicationInstance: Type.Optional(Type.Boolean()),
  additionalArguments: Type.Optional(Type.Array(Type.String())),
  electronDebuggingPort: Type.Optional(Type.Number({ description: "Launch Electron with --remote-debugging-port for page DOM access." })),
  webkitInspectorPort: Type.Optional(Type.Number({ description: "Launch Tauri/WKWebView with WEBKIT_INSPECTOR_SERVER for page DOM access." })),
  onScreenOnly: Type.Optional(Type.Boolean()),
  query: Type.Optional(Type.String({ description: "Filter get_window_state tree_markdown to matching lines plus ancestors, or filter list_windows by app/title/pid/window_id." })),
  elementIndex: Type.Optional(Type.Number({ description: "element_index from the immediately preceding get_window_state." })),
  x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), x1: Type.Optional(Type.Number()), y1: Type.Optional(Type.Number()), x2: Type.Optional(Type.Number()), y2: Type.Optional(Type.Number()),
  fromX: Type.Optional(Type.Number()), fromY: Type.Optional(Type.Number()), toX: Type.Optional(Type.Number()), toY: Type.Optional(Type.Number()),
  fromZoom: Type.Optional(Type.Boolean()),
  axAction: Type.Optional(StringEnum(["press", "show_menu", "pick", "confirm", "cancel", "open"] as const)),
  modifiers: Type.Optional(Type.Array(Type.String(), { description: "Modifier keys: cmd/shift/option/ctrl/fn where supported." })),
  count: Type.Optional(Type.Number({ description: "Pixel click count 1-3 for click action." })),
  debugImageOut: Type.Optional(Type.String({ description: "Debug crosshair image path for pixel click." })),
  button: Type.Optional(StringEnum(["left", "right", "middle"] as const)),
  durationMs: Type.Optional(Type.Number()),
  steps: Type.Optional(Type.Number()),
  delayMs: Type.Optional(Type.Number({ description: "Milliseconds between characters in type_text fallback path." })),
  text: Type.Optional(Type.String()),
  value: Type.Optional(Type.Any({ description: "Config value or set_value value." })),
  key: Type.Optional(Type.String({ description: "Config key or key name for press_key, e.g. capture_mode, return, tab." })),
  keys: Type.Optional(Type.Array(Type.String(), { description: "Hotkey array, e.g. ['cmd','c']." })),
  direction: Type.Optional(StringEnum(["up", "down", "left", "right"] as const)),
  amount: Type.Optional(Type.Number()),
  by: Type.Optional(StringEnum(["line", "page"] as const)),
  pageAction: Type.Optional(StringEnum(["get_text", "query_dom", "execute_javascript", "enable_javascript_apple_events"] as const)),
  javascript: Type.Optional(Type.String()),
  screenshotOutFile: Type.Optional(Type.String({ description: "Path for get_window_state screenshot_out_file or CLI --screenshot-out-file." })),
  cssSelector: Type.Optional(Type.String()),
  attributes: Type.Optional(Type.Array(Type.String())),
  userHasConfirmedEnabling: Type.Optional(Type.Boolean()),
  prompt: Type.Optional(Type.Boolean({ description: "For permissions/check_permissions: show macOS prompts. Default false in this wrapper." })),
  format: Type.Optional(StringEnum(["png", "jpeg"] as const)),
  quality: Type.Optional(Type.Number()),
  recordingAction: Type.Optional(StringEnum(["start", "stop", "status", "render"] as const)),
  outputDir: Type.Optional(Type.String()),
  inputDir: Type.Optional(Type.String()),
  output: Type.Optional(Type.String()),
  noZoom: Type.Optional(Type.Boolean()),
  scale: Type.Optional(Type.Number()),
  videoExperimental: Type.Optional(Type.Boolean()),
  enabled: Type.Optional(Type.Boolean()),
  dir: Type.Optional(Type.String()),
  stopOnError: Type.Optional(Type.Boolean()),
  arcFlow: Type.Optional(Type.Number()), arcSize: Type.Optional(Type.Number()), startHandle: Type.Optional(Type.Number()), endHandle: Type.Optional(Type.Number()), spring: Type.Optional(Type.Number()),
  glideDurationMs: Type.Optional(Type.Number()), dwellAfterClickMs: Type.Optional(Type.Number()), idleHideMs: Type.Optional(Type.Number()),
  imagePath: Type.Optional(Type.String()), bloomColor: Type.Optional(Type.String()), gradientColors: Type.Optional(Type.Array(Type.String())),
  imageOut: Type.Optional(Type.String({ description: "Path for --image-out when calling image-returning tools." })),
  compact: Type.Optional(Type.Boolean({ description: "Pass --compact to cua-driver call. Defaults true in this wrapper to reduce local-model context; set false only via raw if pretty JSON is needed." })),
  noDaemon: Type.Optional(Type.Boolean({ description: "Pass --no-daemon to cua-driver." })),
  rawArgs: Type.Optional(Type.Array(Type.String(), { description: "For action=raw, literal args after cua-driver." })),
  ...commonTail,
});
type DriverInput = Static<typeof driverSchema>;
function compactJson(obj: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return JSON.stringify(out);
}
function driverToolArgs(tool: string, obj: Record<string, unknown>, p: DriverInput): string[] {
  const args = ["call", tool, compactJson(obj)];
  addBool(args, "--compact", p.compact !== false); addBool(args, "--no-daemon", p.noDaemon); if (["screenshot", "zoom"].includes(tool)) addOpt(args, "--screenshot-out-file", p.screenshotOutFile ?? p.imageOut);
  appendExtra(args, p.extraArgs); return args;
}
function buildDriverArgs(p: DriverInput): string[] {
  if (p.action === "status") return ["status"];
  if (p.action === "start") return ["__start__"];
  if (p.action === "stop") return ["stop"];
  if (p.action === "raw") { const args = needArray(p.rawArgs, "rawArgs"); appendExtra(args, p.extraArgs); return args; }
  if (p.action === "config") {
    const args = ["config"];
    if (p.key && p.value !== undefined) args.push("set", p.key, typeof p.value === "string" ? p.value : JSON.stringify(p.value));
    else if (p.key) args.push("get", p.key);
    appendExtra(args, p.extraArgs); return args;
  }
  if (p.action === "permissions") return driverToolArgs("check_permissions", { prompt: p.prompt ?? false }, p);
  if (p.action === "list_apps") return driverToolArgs("list_apps", {}, p);
  if (p.action === "list_windows") return driverToolArgs("list_windows", { pid: p.pid, on_screen_only: p.onScreenOnly }, p);
  if (p.action === "launch_app") return driverToolArgs("launch_app", { bundle_id: p.bundleId, name: p.appName, urls: p.urls, creates_new_application_instance: p.createsNewApplicationInstance, additional_arguments: p.additionalArguments, electron_debugging_port: p.electronDebuggingPort, webkit_inspector_port: p.webkitInspectorPort }, p);
  if (p.action === "window_state") return driverToolArgs("get_window_state", { pid: needNumber(p.pid, "pid"), window_id: needNumber(p.windowId, "windowId"), query: p.query, javascript: p.javascript, screenshot_out_file: p.screenshotOutFile }, p);
  if (p.action === "click") return driverToolArgs("click", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, x: p.x, y: p.y, action: p.axAction, from_zoom: p.fromZoom, modifier: p.modifiers, count: p.count, debug_image_out: p.debugImageOut }, p);
  if (p.action === "double_click") return driverToolArgs("double_click", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, x: p.x, y: p.y, modifier: p.modifiers }, p);
  if (p.action === "right_click") return driverToolArgs("right_click", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, x: p.x, y: p.y, modifier: p.modifiers }, p);
  if (p.action === "drag") return driverToolArgs("drag", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, from_x: needNumber(p.fromX, "fromX"), from_y: needNumber(p.fromY, "fromY"), to_x: needNumber(p.toX, "toX"), to_y: needNumber(p.toY, "toY"), from_zoom: p.fromZoom, modifier: p.modifiers, button: p.button, duration_ms: p.durationMs, steps: p.steps }, p);
  if (p.action === "type_text") return driverToolArgs("type_text", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, text: need(p.text, "text"), delay_ms: p.delayMs }, p);
  if (p.action === "type_text_chars") return driverToolArgs("type_text", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, text: need(p.text, "text"), delay_ms: p.delayMs ?? 30 }, p);
  if (p.action === "set_value") return driverToolArgs("set_value", { pid: needNumber(p.pid, "pid"), window_id: needNumber(p.windowId, "windowId"), element_index: needNumber(p.elementIndex, "elementIndex"), value: String(p.value ?? "") }, p);
  if (p.action === "press_key") return driverToolArgs("press_key", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, key: need(p.key, "key"), modifiers: p.modifiers }, p);
  if (p.action === "hotkey") return driverToolArgs("hotkey", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, keys: needArray(p.keys, "keys") }, p);
  if (p.action === "scroll") return driverToolArgs("scroll", { pid: needNumber(p.pid, "pid"), window_id: p.windowId, element_index: p.elementIndex, direction: need(p.direction, "direction"), amount: p.amount, by: p.by }, p);
  if (p.action === "page") return driverToolArgs("page", { pid: p.pageAction === "enable_javascript_apple_events" ? p.pid ?? 0 : needNumber(p.pid, "pid"), window_id: p.pageAction === "enable_javascript_apple_events" ? p.windowId ?? 0 : needNumber(p.windowId, "windowId"), action: need(p.pageAction, "pageAction"), javascript: p.javascript, css_selector: p.cssSelector, attributes: p.attributes, bundle_id: p.bundleId, user_has_confirmed_enabling: p.userHasConfirmedEnabling }, p);
  if (p.action === "screenshot") return driverToolArgs("screenshot", { window_id: needNumber(p.windowId, "windowId"), format: p.format, quality: p.quality }, p);
  if (p.action === "zoom") return driverToolArgs("zoom", { pid: needNumber(p.pid, "pid"), x1: needNumber(p.x1, "x1"), y1: needNumber(p.y1, "y1"), x2: needNumber(p.x2, "x2"), y2: needNumber(p.y2, "y2") }, p);
  if (p.action === "screen_size") return driverToolArgs("get_screen_size", {}, p);
  if (p.action === "cursor_position") return driverToolArgs("get_cursor_position", {}, p);
  if (p.action === "move_cursor") return driverToolArgs("move_cursor", { x: needNumber(p.x, "x"), y: needNumber(p.y, "y") }, p);
  if (p.action === "agent_cursor_state") return driverToolArgs("get_agent_cursor_state", {}, p);
  if (p.action === "agent_cursor_enabled") return driverToolArgs("set_agent_cursor_enabled", { enabled: p.enabled ?? false }, p);
  if (p.action === "agent_cursor_motion") return driverToolArgs("set_agent_cursor_motion", { arc_flow: p.arcFlow, arc_size: p.arcSize, start_handle: p.startHandle, end_handle: p.endHandle, spring: p.spring, glide_duration_ms: p.glideDurationMs, dwell_after_click_ms: p.dwellAfterClickMs, idle_hide_ms: p.idleHideMs }, p);
  if (p.action === "agent_cursor_style") return driverToolArgs("set_agent_cursor_style", { image_path: p.imagePath, bloom_color: p.bloomColor, gradient_colors: p.gradientColors }, p);
  if (p.action === "recording") {
    const sub = p.recordingAction ?? "status";
    const args = ["recording", sub];
    if (sub === "start") args.push(need(p.outputDir, "outputDir"));
    if (sub === "render") { args.push(need(p.inputDir, "inputDir")); addOpt(args, "--output", p.output); addBool(args, "--no-zoom", p.noZoom); addOpt(args, "--scale", p.scale); }
    addBool(args, "--video-experimental", sub === "start" && p.videoExperimental); appendExtra(args, p.extraArgs); return args;
  }
  if (p.action === "replay_trajectory") return driverToolArgs("replay_trajectory", { dir: need(p.dir ?? p.inputDir, "dir"), delay_ms: p.delayMs, stop_on_error: p.stopOnError }, p);
  return driverToolArgs(need(p.tool, "tool"), p.jsonArgs ?? {}, p);
}

type DriverWindowRecord = {
  window_id?: number;
  pid?: number;
  title?: string;
  app_name?: string;
  is_on_screen?: boolean;
  on_current_space?: boolean;
  bounds?: { width?: number; height?: number; x?: number; y?: number };
  z_index?: number;
};

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return undefined; }
}

function chooseDriverWindow(windows: DriverWindowRecord[]): DriverWindowRecord | undefined {
  const usable = windows.filter((w) => typeof w.window_id === "number" && (w.bounds?.width ?? 0) > 1 && (w.bounds?.height ?? 0) > 1);
  const score = (w: DriverWindowRecord) =>
    (w.is_on_screen ? 1_000_000 : 0) +
    (w.on_current_space ? 500_000 : 0) +
    (w.title ? 25_000 : 0) +
    Math.min((w.bounds?.width ?? 0) * (w.bounds?.height ?? 0), 200_000) +
    (w.z_index ?? 0);
  return usable.sort((a, b) => score(b) - score(a))[0];
}

function chooseFrontmostWindow(windows: DriverWindowRecord[]): DriverWindowRecord | undefined {
  // Pick the truly frontmost window: on-screen, on the current Space, highest z_index.
  // Used to auto-resolve a target when the caller omits pid. Unlike chooseDriverWindow
  // (which weights area), this strictly prefers the topmost stacking window so we
  // act on whatever the user is actually looking at.
  const usable = windows.filter((w) => typeof w.window_id === "number" && typeof w.pid === "number" && (w.bounds?.width ?? 0) > 1 && (w.bounds?.height ?? 0) > 1);
  if (usable.length === 0) return undefined;
  const rank = (w: DriverWindowRecord): [number, number, number] => [
    w.is_on_screen ? 1 : 0,
    w.on_current_space === false ? 0 : 1, // omitted (SPI unavailable) counts as eligible
    w.z_index ?? -1e9,
  ];
  return usable.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2];
  })[0];
}

async function resolveDriverWindowId(pi: ExtensionAPI, p: DriverInput, signal: AbortSignal | undefined, onUpdate?: (partial: any) => void): Promise<number> {
  if (p.windowId !== undefined) return p.windowId;
  const pid = needNumber(p.pid, "pid");
  const result = await run(pi, CUA_DRIVER_BIN, driverToolArgs("list_windows", { pid, on_screen_only: p.onScreenOnly }, { compact: true } as DriverInput), signal, Math.min(p.timeoutMs ?? CUA_TIMEOUT_MS, 20_000), onUpdate);
  if (result.isError) throw new Error(`Could not list windows for pid ${pid}: ${result.details?.stderr || result.details?.stdout || "unknown error"}`);
  const data = parseJson(result.details?.stdout ?? "");
  const chosen = chooseDriverWindow(Array.isArray(data?.windows) ? data.windows : []);
  if (!chosen?.window_id) throw new Error(`No usable windows found for pid ${pid}. Call cua_driver list_windows to inspect candidates.`);
  return chosen.window_id;
}

// Actions whose underlying cua-driver MCP tool requires a `pid`. When a caller omits
// pid for one of these, we auto-resolve the frontmost on-screen window's pid (and
// window_id) instead of throwing "Missing required numeric parameter: pid".
// All of these tools accept an optional window_id (verified via `cua-driver describe`),
// so filling both is safe; zoom does not use window_id and buildDriverArgs already
// omits it for zoom.
const PID_REQUIRED_ACTIONS = new Set(["window_state", "click", "double_click", "right_click", "drag", "type_text", "type_text_chars", "set_value", "press_key", "hotkey", "scroll", "zoom", "page"]);

async function listDriverWindows(pi: ExtensionAPI, onScreenOnly: boolean, signal: AbortSignal | undefined, onUpdate?: (partial: any) => void, timeoutMs?: number): Promise<DriverWindowRecord[]> {
  const result = await run(pi, CUA_DRIVER_BIN, driverToolArgs("list_windows", { on_screen_only: onScreenOnly }, { compact: true } as DriverInput), signal, Math.min(timeoutMs ?? CUA_TIMEOUT_MS, 20_000), onUpdate);
  if (result.isError) throw new Error(`list_windows failed: ${result.details?.stderr || result.details?.stdout || "unknown error"}`);
  const data = parseJson(result.details?.stdout ?? "");
  return Array.isArray(data?.windows) ? (data.windows as DriverWindowRecord[]) : [];
}

async function resolveDriverTarget(pi: ExtensionAPI, params: DriverInput, signal: AbortSignal | undefined, onUpdate?: (partial: any) => void): Promise<DriverInput> {
  const appFilter = (w: DriverWindowRecord): boolean => !params.appName || (w.app_name ?? "").toLowerCase().includes(params.appName.toLowerCase());

  // window_id provided without pid -> look up the owning pid for that exact window.
  if (params.windowId !== undefined && params.windowId !== null && params.windowId !== "") {
    let windows = await listDriverWindows(pi, true, signal, onUpdate, params.timeoutMs);
    let match = windows.find((w) => String(w.window_id) === String(params.windowId));
    if (!match) {
      windows = await listDriverWindows(pi, false, signal, onUpdate, params.timeoutMs);
      match = windows.find((w) => String(w.window_id) === String(params.windowId));
    }
    if (match?.pid === undefined) {
      throw new Error(`cua_driver ${params.action}: window_id ${params.windowId} was given without a pid, but no running window has that id. Call cua_driver list_windows to find a valid window_id.`);
    }
    return { ...params, pid: match.pid };
  }

  // No pid and no window_id -> act on the frontmost on-screen window (optionally narrowed by appName).
  let windows = await listDriverWindows(pi, true, signal, onUpdate, params.timeoutMs);
  let pool = windows.filter((w) => typeof w.window_id === "number" && typeof w.pid === "number" && appFilter(w));
  let chosen = chooseFrontmostWindow(pool) ?? chooseDriverWindow(pool);
  if (!chosen) {
    // Nothing on-screen matched (minimized / hidden / off-Space) -- include off-screen windows.
    windows = await listDriverWindows(pi, false, signal, onUpdate, params.timeoutMs);
    pool = windows.filter((w) => typeof w.window_id === "number" && typeof w.pid === "number" && appFilter(w));
    chosen = chooseFrontmostWindow(pool) ?? chooseDriverWindow(pool);
  }
  if (!chosen || chosen.pid === undefined || chosen.window_id === undefined) {
    const hint = params.appName ? ` matching app "${params.appName}"` : "";
    throw new Error(`cua_driver ${params.action}: no pid was provided and no usable window${hint} is available. Provide pid (from launch_app/list_apps/list_windows) and window_id, or run cua_driver list_windows to pick a target.`);
  }
  return { ...params, pid: chosen.pid, windowId: chosen.window_id };
}

async function runDriverWithResolvedWindow(pi: ExtensionAPI, params: DriverInput, signal: AbortSignal | undefined, onUpdate?: (partial: any) => void) {
  const windowId = await resolveDriverWindowId(pi, params, signal, onUpdate);
  return await run(pi, CUA_DRIVER_BIN, buildDriverArgs({ ...params, windowId }), signal, params.timeoutMs, onUpdate);
}

async function runFullScreenScreenshot(pi: ExtensionAPI, params: DriverInput, signal: AbortSignal | undefined, onUpdate?: (partial: any) => void) {
  const ext = params.format === "jpeg" ? "jpg" : "png";
  const out = params.screenshotOutFile ?? params.imageOut ?? `/tmp/cua-driver-screenshot-${Date.now()}.${ext}`;
  const result = await run(pi, "screencapture", ["-x", out], signal, params.timeoutMs, onUpdate);
  if (!result.isError) result.content = [{ type: "text", text: `Saved full-screen screenshot to ${out}${readableFileSize(out) ? ` (${readableFileSize(out)})` : ""}` }];
  result.details = { ...result.details, screenshotOutFile: out };
  return result;
}

function normalizeDriverParams(p: DriverInput): DriverInput {
  if (p.action === "get_window_state") return { ...p, action: "window_state" } as DriverInput;
  return p;
}

function maybePostProcessDriverResult(result: Awaited<ReturnType<typeof run>>, params: DriverInput): Awaited<ReturnType<typeof run>> {
  const stdout = result.details?.stdout ?? "";
  if (params.action === "list_windows") {
    const data = parseJson(stdout);
    if (Array.isArray(data?.windows)) {
      const originalCount = data.windows.length;
      let windows = data.windows as DriverWindowRecord[];
      const query = params.query?.toLowerCase();
      const appName = params.appName?.toLowerCase();
      if (query || appName) {
        windows = windows.filter((w) => {
          const haystack = [w.app_name, w.title, w.pid, w.window_id].filter((v) => v !== undefined && v !== null).join(" ").toLowerCase();
          return (!query || haystack.includes(query)) && (!appName || (w.app_name ?? "").toLowerCase().includes(appName));
        });
      }
      const filtered = { ...data, windows };
      const full = JSON.stringify(filtered);
      result.details = { ...result.details, stdout: full, windowCount: windows.length, originalWindowCount: originalCount };
      const max = Number(process.env.CUA_TOOL_MAX_OUTPUT_CHARS ?? 12000);
      if (full.length > max) {
        const out = writeTempJson("cua-driver-list-windows", filtered);
        const preview = JSON.stringify({ ...filtered, windows: windows.slice(0, 40), preview_count: Math.min(windows.length, 40) }, null, 2);
        result.content = [{ type: "text", text: `Matched ${windows.length}/${originalCount} windows${out ? `; full JSON saved to ${out}` : ""}. Preview:\n${compactToolText(preview)}` }];
      } else {
        result.content = [{ type: "text", text: full }];
      }
    }
  }

  const out = params.screenshotOutFile ?? params.imageOut;
  if (!out) return result;
  if (params.action === "screenshot" && !result.isError) {
    const size = readableFileSize(out);
    result.content = [{ type: "text", text: existsSync(out) ? `Saved window screenshot to ${out}${size ? ` (${size})` : ""}\n${stdout}`.trim() : `Screenshot command succeeded, but ${out} was not created. Raw output:\n${stdout}` }];
    result.details = { ...result.details, screenshotOutFile: out, screenshotFileExists: existsSync(out) };
  }
  if (params.action === "window_state" && !result.isError) {
    const size = readableFileSize(out);
    if (existsSync(out)) {
      result.content = [{ type: "text", text: `Saved window_state screenshot to ${out}${size ? ` (${size})` : ""}\n${stdout}`.trim() }];
      result.details = { ...result.details, screenshotOutFile: out, screenshotFileExists: true };
    } else {
      result.content = [{ type: "text", text: `${result.content?.[0]?.text ?? stdout}\n\nNote: screenshotOutFile was requested, but no file was written. In cua-driver capture_mode=ax this is expected because get_window_state skips screenshots; use action=config key=capture_mode value=som (or action=screenshot for a raw window PNG).` }];
      result.details = { ...result.details, screenshotOutFile: out, screenshotFileExists: false };
    }
  }
  return result;
}

export type { DriverInput };

export default function (pi: ExtensionAPI) {
  // Build the experimental semantic/background workflow inside the main Cua
  // extension without registering a second competing tool. This gives future
  // agents one vertically integrated `cua_driver` surface.
  let integratedWorkflowTool: any;
  nativeWorkflowExtension({
    exec: pi.exec.bind(pi),
    registerTool(definition: any) {
      if (definition?.name === "cua_workflow_internal") integratedWorkflowTool = definition;
    },
    registerCommand() {},
    on() {},
  } as any);
  if (!integratedWorkflowTool) throw new Error("Cua integrated workflow failed to initialize.");

  pi.registerTool({ name: "cua_driver", label: "Cua Driver", description: "Native macOS application control. Never use Cua for ordinary webpage reading or Chrome DOM interaction; use web_cli (or the web CLI through bash) first because it is faster and more reliable. For native apps, action=workflow provides cached background-window targeting, fuzzy semantic AX selectors, up to 30 sequential steps, pixels, drags, AppleScript, and raw calls. Direct actions remain available for screenshots, zoom, browser chrome, non-DOM visual fallbacks, and low-level control.", promptSnippet: "Native Mac app control only; use web_cli first for Chrome pages and reserve Cua for native or genuinely visual fallback work.", promptGuidelines: ["Do not use cua_driver for routine Chrome webpage reading, navigation, links, buttons, forms, or DOM interaction. Use web_cli first; Cua is only for native browser chrome, non-DOM visual content, or a genuine fallback after web_cli cannot perform the task.", "Use cua_driver action=workflow as the default for native Mac control; it combines target resolution, semantic inspection, actions, and verification in one fast call.", "For background control while the user keeps working, pass workflow.app and optionally workflow.windowTitle; avoid relying on the frontmost window.", "Use workflow.action=inspect for discovery, act for one operation, and sequence for up to 30 mixed semantic, keyboard, pixel, drag, AppleScript, or raw Cua steps.", "Use direct cua_driver actions for standalone screenshots, zoom, recording, cursor controls, and uncommon low-level operations. Use its page primitive only for non-Chrome native WebViews/debug targets or a confirmed web_cli failure—not as the normal Chrome path.", "For live Chrome pages, prefer web_cli or `web`; both default to the persistent Pi Automation window in the user's authenticated Chrome profile. Use `tab=active` only when explicitly requested. Sitegeist shares that same bot window and is only for canvas/SVG and difficult visual flows.", "If workflow cannot resolve a native element, use direct get_window_state with a query, then element_index or screenshot/pixel targeting.", "Keep output small: use query filters and screenshotOutFile for images."], parameters: driverSchema, async execute(_id, rawParams, signal, onUpdate, ctx) { try { const params0 = normalizeDriverParams(rawParams); if (params0.action === "workflow") { if (!params0.workflow) throw new Error("cua_driver action=workflow requires workflow parameters."); return await integratedWorkflowTool.execute(_id, params0.workflow, signal, onUpdate, ctx); } if (params0.action === "start") return await run(pi, "open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve"], signal, params0.timeoutMs, onUpdate); if (!["status", "stop"].includes(params0.action) && params0.action !== "raw") await ensureCuaDriverDaemon(pi, signal); let params = params0; const pidMissing = params.pid === undefined || params.pid === null || params.pid === ""; if (pidMissing && PID_REQUIRED_ACTIONS.has(params.action) && !(params.action === "page" && params.pageAction === "enable_javascript_apple_events")) { params = await resolveDriverTarget(pi, params, signal, onUpdate); } const elementWindowActions = ["click", "double_click", "right_click", "type_text", "type_text_chars", "set_value", "press_key", "scroll"]; const canResolveWindow = params.pid !== undefined && (["window_state", "page", "screenshot"].includes(params.action) || (elementWindowActions.includes(params.action) && (params.elementIndex !== undefined || params.action === "set_value"))) && !(params.action === "page" && params.pageAction === "enable_javascript_apple_events"); if (canResolveWindow && params.windowId === undefined) return maybePostProcessDriverResult(await runDriverWithResolvedWindow(pi, params, signal, onUpdate), params); if (params.action === "screenshot" && params.windowId === undefined) return await runFullScreenScreenshot(pi, params, signal, onUpdate); const args = buildDriverArgs(params); const result = await run(pi, CUA_DRIVER_BIN, args, signal, params.timeoutMs, onUpdate); const stale = result.isError && /No window with window_id|window_id .*does not exist|must belong to pid/i.test(`${result.details?.stdout}\n${result.details?.stderr}`); if (stale && canResolveWindow) return maybePostProcessDriverResult(await runDriverWithResolvedWindow(pi, { ...params, windowId: undefined }, signal, onUpdate), params); return maybePostProcessDriverResult(result, params); } catch (e) { return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], details: { params: rawParams } }; } } });


}
