import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const BIN = process.env.CUA_DRIVER_BIN ?? "cua-driver";
const DEFAULT_TIMEOUT_MS = Number(process.env.NATIVE_FAST_TIMEOUT_MS ?? 15_000);
const CACHE_TTL_MS = Number(process.env.NATIVE_FAST_CACHE_TTL_MS ?? 300_000);
const MAX_TREE_CHARS = Number(process.env.NATIVE_FAST_MAX_TREE_CHARS ?? 8_000);

const stepSchema = Type.Object({
  action: StringEnum([
    "inspect", "click", "double_click", "right_click", "type", "fill", "set_value",
    "press_key", "hotkey", "scroll", "wait", "activate", "pixel_click", "drag", "raw_call", "applescript", "program",
  ] as const),
  query: Type.Optional(Type.String({ description: "Case-insensitive text used to find an AX element. Omit for unlabeled controls when role is supplied." })),
  role: Type.Optional(Type.String({ description: "Optional AX role filter, e.g. AXButton, Button, TextField, Row. May be used without query for unlabeled controls." })),
  occurrence: Type.Optional(Type.Integer({ minimum: 1, description: "1-based match when query finds multiple elements. Defaults to 1." })),
  exact: Type.Optional(Type.Boolean({ description: "Prefer an exact accessible label/value match rather than substring matching." })),
  allowDisabled: Type.Optional(Type.Boolean()),
  text: Type.Optional(Type.String({ description: "Text for type/fill." })),
  value: Type.Optional(Type.String({ description: "Value for set_value." })),
  key: Type.Optional(Type.String({ description: "Key for press_key, e.g. return, tab, escape." })),
  keys: Type.Optional(Type.Array(Type.String(), { description: "Keys for hotkey, e.g. ['cmd','s']." })),
  modifiers: Type.Optional(Type.Array(Type.String())),
  direction: Type.Optional(StringEnum(["up", "down", "left", "right"] as const)),
  amount: Type.Optional(Type.Number()),
  by: Type.Optional(StringEnum(["line", "page"] as const)),
  delayMs: Type.Optional(Type.Number({ minimum: 0, maximum: 200 })),
  waitMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30_000, description: "Fixed delay, or maximum readiness wait when query/role is supplied." })),
  fuzzy: Type.Optional(Type.Boolean({ description: "Permit bold best-effort fuzzy matching. Defaults true." })),
  tool: Type.Optional(Type.String({ description: "Any cua-driver MCP tool name for raw_call." })),
  payload: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Raw cua-driver payload; target pid/window_id are injected when absent." })),
  script: Type.Optional(Type.String({ description: "Native automation source for applescript/program. A program runs as one osascript process instead of one tool call per UI action." })),
  language: Type.Optional(StringEnum(["javascript", "applescript"] as const, { description: "Language for program. Defaults to javascript; applescript action always uses AppleScript." })),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  toX: Type.Optional(Type.Number()),
  toY: Type.Optional(Type.Number()),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  fromZoom: Type.Optional(Type.Boolean({ description: "True only when pixel coordinates came from the last zoom image." })),
  debugImageOut: Type.Optional(Type.String({ description: "Optional debug PNG showing the received pixel-click crosshair." })),
  fresh: Type.Optional(Type.Boolean({ description: "Force a fresh AX observation before this step. Normally unnecessary; waits and errors refresh automatically." })),
  verify: Type.Optional(Type.String({ description: "After this step, return AX state filtered to this text." })),
});
type NativeStep = Static<typeof stepSchema>;

const parallelTaskSchema = Type.Object({
  app: Type.Optional(Type.String()),
  bundleId: Type.Optional(Type.String()),
  pid: Type.Optional(Type.Integer()),
  windowId: Type.Optional(Type.Integer()),
  windowTitle: Type.Optional(Type.String()),
  windowOccurrence: Type.Optional(Type.Integer({ minimum: 1 })),
  launchIfNeeded: Type.Optional(Type.Boolean()),
  steps: Type.Array(stepSchema, { minItems: 1, maxItems: 30 }),
  verify: Type.Optional(Type.String()),
  observationPolicy: Type.Optional(StringEnum(["fast", "adaptive", "strict"] as const)),
  responseMode: Type.Optional(StringEnum(["compact", "detailed"] as const)),
});
type NativeParallelTask = Static<typeof parallelTaskSchema>;

export const nativeFastSchema = Type.Object({
  action: StringEnum(["inspect", "act", "sequence", "parallel", "launch", "activate", "windows", "benchmark", "clear_cache", "raw_call", "applescript", "program"] as const),
  app: Type.Optional(Type.String({ description: "Native app display-name substring, e.g. Xcode, Finder, System Settings. Omit for frontmost app." })),
  bundleId: Type.Optional(Type.String({ description: "Bundle identifier for unambiguous launch/targeting." })),
  pid: Type.Optional(Type.Integer()),
  windowId: Type.Optional(Type.Integer()),
  windowTitle: Type.Optional(Type.String({ description: "Target a specific background window/tabbed document by title substring." })),
  windowOccurrence: Type.Optional(Type.Integer({ minimum: 1, description: "1-based window match when titles repeat." })),
  launchIfNeeded: Type.Optional(Type.Boolean({ description: "Launch app in background when no window exists. Defaults true when app/bundleId is supplied." })),
  query: Type.Optional(Type.String({ description: "Inspect filter, or semantic element selector for action=act. Omit for unlabeled controls when role is supplied." })),
  role: Type.Optional(Type.String({ description: "AX role filter; may select unlabeled controls without query." })),
  occurrence: Type.Optional(Type.Integer({ minimum: 1 })),
  exact: Type.Optional(Type.Boolean()),
  allowDisabled: Type.Optional(Type.Boolean()),
  stepAction: Type.Optional(StringEnum([
    "inspect", "click", "double_click", "right_click", "type", "fill", "set_value",
    "press_key", "hotkey", "scroll", "wait", "activate", "pixel_click", "drag", "raw_call", "applescript", "program",
  ] as const, { description: "Operation for action=act." })),
  text: Type.Optional(Type.String()),
  value: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  keys: Type.Optional(Type.Array(Type.String())),
  modifiers: Type.Optional(Type.Array(Type.String())),
  direction: Type.Optional(StringEnum(["up", "down", "left", "right"] as const)),
  amount: Type.Optional(Type.Number()),
  by: Type.Optional(StringEnum(["line", "page"] as const)),
  delayMs: Type.Optional(Type.Number({ minimum: 0, maximum: 200 })),
  waitMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30_000 })),
  fuzzy: Type.Optional(Type.Boolean({ description: "Permit bold best-effort fuzzy AX matching. Defaults true." })),
  tool: Type.Optional(Type.String({ description: "Any cua-driver MCP tool name for raw_call." })),
  payload: Type.Optional(Type.Record(Type.String(), Type.Any())),
  script: Type.Optional(Type.String({ description: "Native automation source for action=applescript/program." })),
  language: Type.Optional(StringEnum(["javascript", "applescript"] as const, { description: "Language for program. Defaults to javascript." })),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  toX: Type.Optional(Type.Number()),
  toY: Type.Optional(Type.Number()),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  fromZoom: Type.Optional(Type.Boolean({ description: "True only when x/y came from the last zoom image; full screenshot coordinates need no scaling." })),
  debugImageOut: Type.Optional(Type.String({ description: "Optional debug PNG showing the received pixel-click crosshair." })),
  verify: Type.Optional(Type.String({ description: "Optional final AX query. Skip routine verification; use only when the endpoint is consequential or uncertain." })),
  observationPolicy: Type.Optional(StringEnum(["fast", "adaptive", "strict"] as const, { description: "fast (default) reuses one AX observation across a batch and refreshes on waits/misses; adaptive refreshes after likely state changes; strict refreshes every semantic action." })),
  responseMode: Type.Optional(StringEnum(["compact", "detailed"] as const, { description: "compact (default) returns one summary; detailed includes every step." })),
  steps: Type.Optional(Type.Array(stepSchema, { minItems: 1, maxItems: 30, description: "Ordered operations for one target window. Batch the full deterministic flow instead of sending one tool call per click." })),
  tasks: Type.Optional(Type.Array(parallelTaskSchema, { minItems: 2, maxItems: 12, description: "Independent native-window tasks executed concurrently in one call. Duplicate target windows are rejected." })),
  timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: 120_000 })),
});
export type NativeFastInput = Static<typeof nativeFastSchema>;

interface WindowRecord {
  window_id?: number;
  pid?: number;
  title?: string;
  app_name?: string;
  bundle_id?: string;
  is_on_screen?: boolean;
  on_current_space?: boolean;
  z_index?: number;
  bounds?: { x?: number; y?: number; width?: number; height?: number };
}

interface Target {
  pid: number;
  windowId: number;
  appName: string;
  title: string;
}

interface ElementMatch {
  index: number;
  role: string;
  line: string;
  label: string;
}

interface CallResult {
  raw: string;
  data?: any;
  elapsedMs: number;
}

type ObservationPolicy = "fast" | "adaptive" | "strict";
interface ObservationSession {
  policy: ObservationPolicy;
  fullMarkdown?: string;
  elementCount?: number;
  dirty: boolean;
  refreshes: number;
  reuses: number;
}

function compact(text: string, max = MAX_TREE_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n…[${text.length - max} characters omitted]…\n\n${text.slice(-tail)}`;
}

function parseJSON(text: string): any | undefined {
  try { return JSON.parse(text); } catch { return undefined; }
}

function normalizeRole(role?: string): string | undefined {
  if (!role) return undefined;
  const clean = role.trim().toLowerCase();
  return clean.startsWith("ax") ? clean : `ax${clean}`;
}

function lineLabel(line: string): string {
  const afterRole = line.replace(/^.*?\]\s+AX\w+\s*/, "").trim();
  return afterRole
    .replace(/\s+actions=\[[^\]]*\]\s*$/, "")
    .replace(/(?:^|\s+)id=[^\s]+/g, "")
    .replace(/\s+DISABLED\s*$/, "")
    .replace(/^[=(]\s*/, "")
    .replace(/[)]\s*$/, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function filterMarkdown(markdown: string, query?: string): string {
  const needle = query?.trim().toLowerCase();
  if (!needle) return markdown;

  const lines = markdown.split("\n");
  let matches = lines.map((line, index) => line.toLowerCase().includes(needle) ? index : -1).filter((index) => index >= 0);
  if (!matches.length) {
    const terms = needle.split(/\s+/).filter((term) => term.length >= 2);
    matches = lines.map((line, index) => terms.some((term) => line.toLowerCase().includes(term)) ? index : -1).filter((index) => index >= 0);
  }
  if (!matches.length) return "";

  const keep = new Set<number>();
  const ancestors: Array<{ indent: number; index: number }> = [];
  const matched = new Set(matches);
  for (let index = 0; index < lines.length; index++) {
    const indent = lines[index].match(/^\s*/)?.[0].length ?? 0;
    while (ancestors.length && ancestors[ancestors.length - 1].indent >= indent) ancestors.pop();
    if (matched.has(index)) {
      keep.add(index);
      for (const ancestor of ancestors) keep.add(ancestor.index);
    }
    ancestors.push({ indent, index });
  }
  return lines.filter((_line, index) => keep.has(index)).join("\n");
}

function parseElements(markdown: string): ElementMatch[] {
  const elements: ElementMatch[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/\[(\d+)\]\s+(AX[A-Za-z0-9]+)/);
    if (!match) continue;
    elements.push({
      index: Number(match[1]),
      role: match[2],
      line: line.trim(),
      label: lineLabel(line),
    });
  }
  return elements;
}

function similarity(left: string, right: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.95;
  const aTokens = a.split(/\s+/);
  const bTokens = new Set(b.split(/\s+/));
  const overlap = aTokens.filter((token) => bTokens.has(token)).length;
  const tokenScore = (2 * overlap) / Math.max(1, aTokens.length + bTokens.size);
  const bigrams = (value: string) => {
    const output = new Set<string>();
    for (let index = 0; index < value.length - 1; index++) output.add(value.slice(index, index + 2));
    return output;
  };
  const aGrams = bigrams(a), bGrams = bigrams(b);
  let shared = 0;
  for (const gram of aGrams) if (bGrams.has(gram)) shared++;
  return Math.max(tokenScore, (2 * shared) / Math.max(1, aGrams.size + bGrams.size));
}

function selectElement(markdown: string, step: NativeStep): { chosen: ElementMatch; matches: ElementMatch[]; fuzzy: boolean } {
  const query = step.query?.trim().toLowerCase();
  const role = normalizeRole(step.role);
  if (!query && !role) throw new Error(`${step.action} requires query, role, or both to select an element.`);

  const eligible = parseElements(markdown).filter((element) => {
    if (!step.allowDisabled && /\bDISABLED\b/i.test(element.line)) return false;
    return !role || element.role.toLowerCase() === role;
  });
  let matches = query ? eligible.filter((element) => {
    if (step.exact) {
      const label = element.label.toLowerCase();
      return label === query || label.replace(/[.…]+$/g, "") === query.replace(/[.…]+$/g, "");
    }
    return element.line.toLowerCase().includes(query);
  }) : eligible;

  if (query && !step.exact) {
    const exactMatches = matches.filter((element) => element.label.toLowerCase() === query);
    if (exactMatches.length) matches = exactMatches;
  }

  let fuzzy = false;
  if (query && !matches.length && step.fuzzy !== false) {
    const ranked = eligible
      .map((element) => ({ element, score: Math.max(similarity(step.query ?? "", element.label), similarity(step.query ?? "", element.line)) }))
      .filter((entry) => entry.score >= 0.3)
      .sort((a, b) => b.score - a.score);
    if (ranked.length) {
      matches = ranked.map((entry) => entry.element);
      fuzzy = true;
    }
  }

  const selector = query ? `“${step.query}”${step.role ? ` with role ${step.role}` : ""}` : `role ${step.role}`;
  if (!matches.length) throw new Error(`No enabled AX element matched ${selector}.`);

  const occurrence = step.occurrence ?? 1;
  const chosen = matches[occurrence - 1];
  if (!chosen) throw new Error(`Only ${matches.length} element(s) matched ${selector}; occurrence ${occurrence} does not exist.`);
  return { chosen, matches, fuzzy };
}

function chooseWindow(windows: WindowRecord[], app?: string, windowTitle?: string, occurrence = 1): WindowRecord | undefined {
  const appNeedle = app?.toLowerCase();
  const titleNeedle = windowTitle?.toLowerCase();
  const filtered = windows.filter((window) => {
    if (typeof window.pid !== "number" || typeof window.window_id !== "number") return false;
    if ((window.bounds?.width ?? 0) < 2 || (window.bounds?.height ?? 0) < 2) return false;
    if (appNeedle && !`${window.app_name ?? ""} ${window.title ?? ""}`.toLowerCase().includes(appNeedle)) return false;
    if (titleNeedle && !(window.title ?? "").toLowerCase().includes(titleNeedle)) return false;
    return true;
  });
  const ranked = filtered.sort((a, b) => {
    const score = (window: WindowRecord) =>
      (window.is_on_screen ? 1_000_000 : 0) +
      (window.on_current_space === false ? 0 : 500_000) +
      (window.z_index ?? -10_000) * 100 +
      Math.min((window.bounds?.width ?? 0) * (window.bounds?.height ?? 0), 100_000);
    return score(b) - score(a);
  });
  return ranked[occurrence - 1];
}

function describeTarget(target: Target): string {
  return `${target.appName || "app"} pid=${target.pid} window=${target.windowId}${target.title ? ` “${target.title}”` : ""}`;
}

export default function nativeFastExtension(pi: ExtensionAPI) {
  const targetCache = new Map<string, { target: Target; at: number }>();
  let daemonReady = false;

  const call = async (tool: string, payload: Record<string, unknown>, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CallResult> => {
    const started = performance.now();
    const result = await pi.exec(BIN, ["call", tool, JSON.stringify(payload), "--compact"], { signal, timeout: timeoutMs });
    const elapsedMs = performance.now() - started;
    const stdout = result.stdout?.trim() ?? "";
    const stderr = result.stderr?.trim() ?? "";
    if (result.code !== 0) {
      throw new Error(`${tool} failed: ${compact(stderr || stdout || `exit ${result.code}`, 4_000)}`);
    }
    const data = parseJSON(stdout);
    if (data?.isError === true || data?.error === true) {
      throw new Error(`${tool} failed: ${compact(String(data?.message ?? data?.content ?? stdout), 4_000)}`);
    }
    return { raw: stdout, data, elapsedMs };
  };

  const ensureDaemon = async (signal?: AbortSignal) => {
    if (daemonReady) return;
    const status = await pi.exec(BIN, ["status"], { signal, timeout: 3_000 });
    if (status.code !== 0) {
      await pi.exec("open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve"], { signal, timeout: 3_000 });
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const probe = await pi.exec(BIN, ["status"], { signal, timeout: 2_000 });
        if (probe.code === 0) { daemonReady = true; return; }
      }
      throw new Error("Could not start the cua-driver daemon.");
    }
    daemonReady = true;
  };

  const listWindows = async (signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS, pid?: number): Promise<{ windows: WindowRecord[]; elapsedMs: number }> => {
    const result = await call("list_windows", { pid, on_screen_only: false }, signal, timeoutMs);
    return { windows: Array.isArray(result.data?.windows) ? result.data.windows : [], elapsedMs: result.elapsedMs };
  };

  const launch = async (params: NativeFastInput, signal?: AbortSignal): Promise<Target> => {
    const result = await call("launch_app", {
      bundle_id: params.bundleId,
      name: params.bundleId ? undefined : params.app,
    }, signal, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const windows = Array.isArray(result.data?.windows) ? result.data.windows as WindowRecord[] : [];
    const chosen = chooseWindow(windows, params.app, params.windowTitle, params.windowOccurrence ?? 1);
    const pid = Number(result.data?.pid ?? chosen?.pid);
    let window = chosen;
    if (!window && Number.isFinite(pid)) {
      const deadline = Date.now() + Math.min(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5_000);
      do {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const listed = await listWindows(signal, params.timeoutMs, pid);
        window = chooseWindow(listed.windows, params.app, params.windowTitle, params.windowOccurrence ?? 1);
      } while (!window && Date.now() < deadline);
    }
    if (!Number.isFinite(pid) || !window?.window_id) throw new Error(`Launched ${params.app ?? params.bundleId ?? "app"}, but no usable window became ready.`);
    return {
      pid,
      windowId: window.window_id,
      appName: String(window.app_name ?? result.data?.name ?? params.app ?? params.bundleId ?? ""),
      title: String(window.title ?? ""),
    };
  };

  const cacheKey = (params: NativeFastInput) => {
    const appKey = params.bundleId ? `bundle:${params.bundleId}` : params.app ? `app:${params.app.toLowerCase()}` : "frontmost";
    return `${appKey}|window:${params.windowTitle?.toLowerCase() ?? "main"}|${params.windowOccurrence ?? 1}`;
  };

  const resolveTarget = async (params: NativeFastInput, signal?: AbortSignal, force = false): Promise<Target> => {
    if (params.pid !== undefined && params.windowId !== undefined) {
      return { pid: params.pid, windowId: params.windowId, appName: params.app ?? "", title: "" };
    }

    const key = cacheKey(params);
    const cached = targetCache.get(key);
    if (!force && cached && Date.now() - cached.at <= CACHE_TTL_MS) return cached.target;

    const listed = await listWindows(signal, params.timeoutMs);
    let candidates = listed.windows;
    if (params.pid !== undefined) candidates = candidates.filter((window) => window.pid === params.pid);
    if (params.windowId !== undefined) candidates = candidates.filter((window) => window.window_id === params.windowId);
    let chosen = chooseWindow(candidates, params.app, params.windowTitle, params.windowOccurrence ?? 1);

    if (!chosen && (params.launchIfNeeded ?? Boolean(params.app || params.bundleId))) {
      const target = await launch(params, signal);
      targetCache.set(key, { target, at: Date.now() });
      return target;
    }
    if (!chosen?.pid || !chosen.window_id) {
      throw new Error(`No usable native window${params.app ? ` matching “${params.app}”` : ""}. Supply app/bundleId or launch the app first.`);
    }

    const target: Target = {
      pid: chosen.pid,
      windowId: chosen.window_id,
      appName: String(chosen.app_name ?? params.app ?? ""),
      title: String(chosen.title ?? ""),
    };
    targetCache.set(key, { target, at: Date.now() });
    return target;
  };

  const snapshot = async (target: Target, query: string | undefined, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const result = await call("get_window_state", {
      pid: target.pid,
      window_id: target.windowId,
    }, signal, timeoutMs);
    const fullMarkdown = String(result.data?.tree_markdown ?? "");
    return {
      markdown: filterMarkdown(fullMarkdown, query),
      fullMarkdown,
      elementCount: Number(result.data?.element_count ?? 0),
      elapsedMs: result.elapsedMs,
    };
  };

  const observe = async (
    target: Target,
    session: ObservationSession,
    query: string | undefined,
    signal?: AbortSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    force = false,
  ) => {
    const reusable = Boolean(session.fullMarkdown) && !force && session.policy !== "strict" && !(session.policy === "adaptive" && session.dirty);
    if (reusable) {
      session.reuses++;
      return {
        markdown: filterMarkdown(session.fullMarkdown ?? "", query),
        fullMarkdown: session.fullMarkdown ?? "",
        elementCount: session.elementCount ?? 0,
        elapsedMs: 0,
        reused: true,
      };
    }
    const state = await snapshot(target, query, signal, timeoutMs);
    session.fullMarkdown = state.fullMarkdown;
    session.elementCount = state.elementCount;
    session.dirty = false;
    session.refreshes++;
    return { ...state, reused: false };
  };

  const markObservationDirty = (session: ObservationSession) => {
    if (session.policy === "adaptive") session.dirty = true;
  };

  const activateTarget = async (target: Target, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const script = `on run argv
set targetPid to (item 1 of argv) as integer
set appName to item 2 of argv
set targetTitle to item 3 of argv
if appName contains "Chrome" then
  tell application "Google Chrome"
    repeat with w in windows
      set windowName to ""
      set activeTitle to ""
      try
        set windowName to given name of w as text
      end try
      try
        set activeTitle to title of active tab of w as text
      end try
      if windowName is targetTitle or activeTitle is targetTitle then
        set index of w to 1
        exit repeat
      end if
    end repeat
    activate
  end tell
else
  tell application "System Events"
    set targetProcess to first application process whose unix id is targetPid
    try
      repeat with w in windows of targetProcess
        if targetTitle is not "" and (name of w as text) contains targetTitle then
          try
            perform action "AXRaise" of w
          end try
          exit repeat
        end if
      end repeat
    end try
  end tell
end if
tell application "System Events"
  set targetProcess to first application process whose unix id is targetPid
  set frontmost of targetProcess to true
end tell
end run`;
    const result = await pi.exec("/usr/bin/osascript", ["-e", script, String(target.pid), target.appName, target.title], { signal, timeout: timeoutMs });
    if (result.code !== 0) throw new Error(`activate failed: ${result.stderr || result.stdout}`);
  };

  const punctuationKeyCodes: Record<string, number> = {
    ",": 43, comma: 43,
    ".": 47, period: 47,
    "/": 44, slash: 44,
    ";": 41, semicolon: 41,
    "'": 39, quote: 39,
    "\\": 42, backslash: 42,
    "-": 27, minus: 27,
    "=": 24, equal: 24,
    "`": 50, grave: 50,
    "[": 33, leftbracket: 33,
    "]": 30, rightbracket: 30,
  };

  const sendHotkey = async (target: Target, keys: string[] | undefined, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    if (!keys?.length) throw new Error("hotkey requires keys.");
    const normalized = keys.map((key) => key.toLowerCase());
    const keyCode = punctuationKeyCodes[normalized[normalized.length - 1]];
    if (keyCode === undefined) {
      await call("hotkey", { pid: target.pid, window_id: target.windowId, keys }, signal, timeoutMs);
      return;
    }

    const modifierMap: Record<string, string> = {
      cmd: "command down", command: "command down",
      shift: "shift down", option: "option down", alt: "option down",
      ctrl: "control down", control: "control down",
    };
    const modifiers = normalized.slice(0, -1).map((modifier) => modifierMap[modifier]);
    if (modifiers.some((modifier) => !modifier)) throw new Error(`Unsupported punctuation-hotkey modifier in ${keys.join("+")}.`);
    const usingClause = modifiers.length ? ` using {${modifiers.join(", ")}}` : "";
    const script = `on run argv
set targetPid to (item 1 of argv) as integer
set targetTitle to item 2 of argv
set priorPid to 0
tell application "System Events"
  try
    set priorPid to unix id of first application process whose frontmost is true
  end try
  set targetProcess to first application process whose unix id is targetPid
  try
    repeat with w in windows of targetProcess
      if targetTitle is not "" and (name of w as text) contains targetTitle then
        try
          perform action "AXRaise" of w
        end try
        exit repeat
      end if
    end repeat
  end try
  set frontmost of targetProcess to true
  key code ${keyCode}${usingClause}
  delay 0.05
  if priorPid is not 0 and priorPid is not targetPid then
    try
      set frontmost of first application process whose unix id is priorPid to true
    end try
  end if
end tell
end run`;
    const result = await pi.exec("/usr/bin/osascript", ["-e", script, String(target.pid), target.title], { signal, timeout: timeoutMs });
    if (result.code !== 0) throw new Error(`hotkey failed: ${result.stderr || result.stdout}`);
  };

  const runProgram = async (script: string, language: "javascript" | "applescript", args: string[], signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const osaLanguage = language === "javascript" ? "JavaScript" : "AppleScript";
    const result = await pi.exec("/usr/bin/osascript", ["-l", osaLanguage, "-e", script, ...args], { signal, timeout: timeoutMs });
    if (result.code !== 0) throw new Error(`${osaLanguage} program failed: ${result.stderr || result.stdout}`);
    return result.stdout?.trim() ?? "";
  };

  const runStep = async (target: Target, step: NativeStep, observation: ObservationSession, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ summary: string; verification?: string; elapsedMs: number }> => {
    const started = performance.now();
    let summary = "";

    if (step.action === "wait") {
      const ms = step.waitMs ?? (step.query || step.role ? 2_000 : 250);
      if (step.query || step.role) {
        const deadline = Date.now() + ms;
        let lastError = "selector not ready";
        do {
          const state = await observe(target, observation, step.query, signal, timeoutMs, true);
          try {
            const selected = selectElement(state.fullMarkdown, step);
            return { summary: `waited for [${selected.chosen.index}] ${selected.chosen.role} ${selected.chosen.label || `(unlabeled #${step.occurrence ?? 1})`}`, elapsedMs: performance.now() - started };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        throw new Error(`Timed out after ${ms}ms waiting for native control: ${lastError}`);
      }
      await new Promise((resolve) => setTimeout(resolve, ms));
      observation.dirty = true;
      return { summary: `waited ${ms}ms`, elapsedMs: performance.now() - started };
    }

    if (step.action === "activate") {
      await activateTarget(target, signal, timeoutMs);
      observation.dirty = true;
      return { summary: `activated exact window ${target.appName} “${target.title}”`, elapsedMs: performance.now() - started };
    }

    if (step.action === "applescript" || step.action === "program") {
      if (!step.script) throw new Error(`${step.action} requires script.`);
      const language = step.action === "applescript" ? "applescript" : (step.language ?? "javascript");
      const args = step.action === "program" ? [String(target.pid), target.appName, target.title] : [];
      const output = await runProgram(step.script, language, args, signal, timeoutMs);
      observation.dirty = true;
      return { summary: `${language === "javascript" ? "JavaScript" : "AppleScript"} program executed${output ? `: ${compact(output, 1_000)}` : ""}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "raw_call") {
      if (!step.tool) throw new Error("raw_call requires tool.");
      const payload = { pid: target.pid, window_id: target.windowId, ...(step.payload ?? {}) };
      const result = await call(step.tool, payload, signal, timeoutMs);
      observation.dirty = true;
      return { summary: `raw ${step.tool}: ${compact(result.raw || "ok", 2_000)}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "pixel_click") {
      if (step.x === undefined || step.y === undefined) throw new Error("pixel_click requires x and y.");
      await call("click", { pid: target.pid, window_id: target.windowId, x: step.x, y: step.y, count: step.count ?? 1, modifier: step.modifiers, from_zoom: step.fromZoom, debug_image_out: step.debugImageOut }, signal, timeoutMs);
      markObservationDirty(observation);
      return { summary: `pixel-clicked screenshot pixel (${step.x}, ${step.y}) ×${step.count ?? 1}${step.fromZoom ? " [from zoom]" : ""}${step.debugImageOut ? ` [debug: ${step.debugImageOut}]` : ""}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "drag") {
      if (step.x === undefined || step.y === undefined || step.toX === undefined || step.toY === undefined) throw new Error("drag requires x, y, toX, and toY.");
      await call("drag", { pid: target.pid, window_id: target.windowId, from_x: step.x, from_y: step.y, to_x: step.toX, to_y: step.toY, duration_ms: step.durationMs, modifier: step.modifiers, from_zoom: step.fromZoom }, signal, timeoutMs);
      markObservationDirty(observation);
      return { summary: `dragged (${step.x}, ${step.y}) → (${step.toX}, ${step.toY})`, elapsedMs: performance.now() - started };
    }

    if (step.action === "inspect") {
      const state = await observe(target, observation, step.query, signal, timeoutMs, true);
      summary = state.markdown || `(no AX matches for “${step.query ?? ""}”; ${state.elementCount} total elements)`;
      return { summary: compact(summary), elapsedMs: performance.now() - started };
    }

    if (["press_key", "hotkey", "scroll"].includes(step.action) && !step.query && !step.role) {
      if (step.action === "press_key") {
        await call("press_key", { pid: target.pid, window_id: target.windowId, key: step.key, modifiers: step.modifiers }, signal, timeoutMs);
        summary = `pressed ${step.key}`;
      } else if (step.action === "hotkey") {
        await sendHotkey(target, step.keys, signal, timeoutMs);
        summary = `pressed ${(step.keys ?? []).join("+")}`;
      } else {
        await call("scroll", { pid: target.pid, window_id: target.windowId, direction: step.direction ?? "down", amount: step.amount, by: step.by }, signal, timeoutMs);
        summary = `scrolled ${step.direction ?? "down"}`;
      }
      markObservationDirty(observation);
    } else {
      let state = await observe(target, observation, step.query, signal, timeoutMs, step.fresh === true);
      let selected;
      try {
        selected = selectElement(state.fullMarkdown, step);
      } catch (error) {
        if (!state.reused) throw error;
        state = await observe(target, observation, step.query, signal, timeoutMs, true);
        selected = selectElement(state.fullMarkdown, step);
      }
      const element = selected.chosen;
      const base = { pid: target.pid, window_id: target.windowId, element_index: element.index };
      const ambiguity = selected.matches.length > 1 ? ` (${selected.matches.length} matches; used #${step.occurrence ?? 1})` : "";
      const matchNote = `${ambiguity}${selected.fuzzy ? " [fuzzy]" : ""}`;

      switch (step.action) {
        case "click":
          await call("click", base, signal, timeoutMs);
          summary = `clicked [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "double_click":
          await call("double_click", base, signal, timeoutMs);
          summary = `double-clicked [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "right_click":
          await call("right_click", base, signal, timeoutMs);
          summary = `right-clicked [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "type":
          await call("type_text", { ...base, text: step.text ?? "", delay_ms: step.delayMs ?? 0 }, signal, timeoutMs);
          summary = `typed into [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "fill":
          await call("click", base, signal, timeoutMs);
          await call("hotkey", { pid: target.pid, keys: ["cmd", "a"] }, signal, timeoutMs);
          await call("type_text", { ...base, text: step.text ?? "", delay_ms: step.delayMs ?? 0 }, signal, timeoutMs);
          summary = `replaced text in [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "set_value":
          await call("set_value", { ...base, value: step.value ?? step.text ?? "" }, signal, timeoutMs);
          summary = `set [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "press_key":
          await call("press_key", { ...base, key: step.key, modifiers: step.modifiers }, signal, timeoutMs);
          summary = `pressed ${step.key} on [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "hotkey":
          await call("click", base, signal, timeoutMs);
          await sendHotkey(target, step.keys, signal, timeoutMs);
          summary = `pressed ${(step.keys ?? []).join("+")} on [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "scroll":
          await call("scroll", { ...base, direction: step.direction ?? "down", amount: step.amount, by: step.by }, signal, timeoutMs);
          summary = `scrolled ${step.direction ?? "down"} in [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        default:
          throw new Error(`Unsupported native step: ${step.action}`);
      }
      if (["click", "double_click", "right_click", "press_key", "hotkey", "scroll"].includes(step.action)) markObservationDirty(observation);
    }

    let verification: string | undefined;
    if (step.verify) {
      const state = await observe(target, observation, step.verify, signal, timeoutMs, true);
      verification = state.markdown || `(verification query “${step.verify}” had no AX matches)`;
    }
    return { summary, verification: verification ? compact(verification, 4_000) : undefined, elapsedMs: performance.now() - started };
  };

  pi.on("session_shutdown", () => {
    targetCache.clear();
    daemonReady = false;
  });

  pi.registerCommand("cua-workflow-clear", {
    description: "Clear Cua workflow's cached Mac window targets",
    handler: async (_args, ctx) => {
      targetCache.clear();
      ctx.ui.notify("Cua workflow window cache cleared", "info");
    },
  });

  pi.registerTool({
    name: "cua_workflow_internal",
    label: "Cua Workflow Internal",
    description:
      "Speed-first native macOS control inspired by modern batched CUA harnesses. Execute a whole same-window flow with one shared AX observation, readiness refreshes only at transitions, and no routine final verification. Use parallel to run 2–12 independent window tasks concurrently in one call. Deterministic flows can run as one JXA/AppleScript program. Targets background windows, handles labeled/unlabeled controls, caches targets for five minutes, and returns compact performance telemetry by default.",
    promptSnippet: "Speed-first native Mac control: one-call action batches, shared AX observations, concurrent independent windows, compact results.",
    promptGuidelines: [
      "Use the integrated Cua workflow as the primary path for native Mac automation; send the largest safe same-window action batch in one sequence.",
      "Prefer action=program for a fully codeable flow; otherwise use one sequence with observationPolicy=fast so controls are resolved from one shared AX observation and refreshed only on waits or selector misses.",
      "Use action=parallel with tasks when two or more target windows are independent; keep all mutations for the same window in one ordered task.",
      "Do not issue a separate inspect after a successful Cua sequence. Trust successful action results and request final verify only for consequential endpoints, ambiguity, or an explicit user request.",
      "Put a readiness wait only at a real UI transition such as opening a sheet; do not wait or re-observe between stable form fields and controls.",
      "Use observationPolicy=adaptive when a batch has several unpredictable UI transitions, and strict only for debugging unstable interfaces.",
      "The Cua workflow controls explicitly named app/window targets in the background, so the user can keep working elsewhere; supply app and optionally windowTitle.",
      "Use query plus role when labels are ambiguous. For unlabeled controls, omit query and select with role plus 1-based occurrence instead of changing tools.",
      "For Cua workflow pixel_click, x/y are full-window screenshot PNG pixels. Use them exactly without Retina scaling or window-origin offsets; set fromZoom only for a zoom image and use debugImageOut only when uncertainty justifies it.",
      "Use direct cua_driver actions mainly for standalone screenshots and zoom inspection. For Chrome page content use web_cli first and Sitegeist only for visual web tasks.",
    ],
    parameters: nativeFastSchema,

    async execute(_toolCallId, params, signal, onUpdate) {
      const started = performance.now();
      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      onUpdate?.({ content: [{ type: "text", text: "Cua workflow…" }], details: { phase: "starting" } });

      try {
        if (params.action === "applescript" || params.action === "program") {
          if (!params.script) throw new Error(`${params.action} requires script.`);
          const language = params.action === "applescript" ? "applescript" : (params.language ?? "javascript");
          const output = await runProgram(params.script, language, [], signal, timeoutMs);
          const label = language === "javascript" ? "JavaScript" : "AppleScript";
          return { content: [{ type: "text", text: compact(output || `${label} program executed.`) }], details: { language, elapsedMs: performance.now() - started } };
        }

        await ensureDaemon(signal);

        if (params.action === "clear_cache") {
          targetCache.clear();
          return { content: [{ type: "text", text: "Cua workflow target cache cleared." }], details: { elapsedMs: performance.now() - started } };
        }

        if (params.action === "benchmark") {
          const timings: Record<string, number[]> = { status: [], list_windows: [] };
          for (let index = 0; index < 5; index++) {
            let tick = performance.now();
            await pi.exec(BIN, ["status"], { signal, timeout: 3_000 });
            timings.status.push(performance.now() - tick);
            tick = performance.now();
            await call("list_windows", { on_screen_only: true }, signal, timeoutMs);
            timings.list_windows.push(performance.now() - tick);
          }
          const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
          const text = `cua-driver daemon: ready\nstatus median: ${median(timings.status).toFixed(1)}ms\nlist_windows median: ${median(timings.list_windows).toFixed(1)}ms\nCua workflow cache entries: ${targetCache.size}`;
          return { content: [{ type: "text", text }], details: { timings, elapsedMs: performance.now() - started } };
        }

        if (params.action === "raw_call") {
          if (!params.tool) throw new Error("raw_call requires tool.");
          const result = await call(params.tool, params.payload ?? {}, signal, timeoutMs);
          return { content: [{ type: "text", text: compact(result.raw || "ok") }], details: { tool: params.tool, payload: params.payload, elapsedMs: performance.now() - started } };
        }

        if (params.action === "windows") {
          const listed = await listWindows(signal, timeoutMs, params.pid);
          const needle = params.app?.toLowerCase();
          const titleNeedle = params.windowTitle?.toLowerCase();
          const windows = listed.windows.filter((window) =>
            (!needle || `${window.app_name ?? ""} ${window.title ?? ""}`.toLowerCase().includes(needle)) &&
            (!titleNeedle || (window.title ?? "").toLowerCase().includes(titleNeedle))
          );
          const text = windows.slice(0, 50).map((window) =>
            `${window.is_on_screen ? "●" : "○"} ${window.app_name ?? "?"} pid=${window.pid} window=${window.window_id} “${window.title ?? ""}”`
          ).join("\n") || "No matching windows.";
          return { content: [{ type: "text", text: compact(text) }], details: { windows, elapsedMs: performance.now() - started } };
        }

        if (params.action === "launch") {
          const target = await launch(params, signal);
          targetCache.set(cacheKey(params), { target, at: Date.now() });
          return { content: [{ type: "text", text: `Ready: ${describeTarget(target)} (${(performance.now() - started).toFixed(0)}ms)` }], details: { target, elapsedMs: performance.now() - started } };
        }

        if (params.action === "parallel") {
          const tasks = params.tasks ?? [];
          if (tasks.length < 2) throw new Error("parallel requires at least two independent tasks.");
          const taskParams = tasks.map((task) => ({ ...task, action: "sequence", timeoutMs } as NativeFastInput));
          const targets = await Promise.all(taskParams.map((task) => resolveTarget(task, signal)));
          const targetIds = targets.map((target) => `${target.pid}:${target.windowId}`);
          const duplicate = targetIds.find((id, index) => targetIds.indexOf(id) !== index);
          if (duplicate) throw new Error(`parallel tasks resolved to the same native window (${duplicate}); combine those steps into one ordered sequence.`);

          const outputs = await Promise.all(tasks.map(async (task: NativeParallelTask, taskIndex: number) => {
            const taskStarted = performance.now();
            const target = targets[taskIndex];
            const observation: ObservationSession = {
              policy: task.observationPolicy ?? "fast",
              dirty: false,
              refreshes: 0,
              reuses: 0,
            };
            const results: Array<{ summary: string; verification?: string; elapsedMs: number }> = [];
            for (let stepIndex = 0; stepIndex < task.steps.length; stepIndex++) {
              if (signal?.aborted) throw new Error("Cua parallel workflow cancelled.");
              onUpdate?.({ content: [{ type: "text", text: `Cua parallel ${taskIndex + 1}/${tasks.length} · step ${stepIndex + 1}/${task.steps.length}` }], details: { phase: "parallel", task: taskIndex + 1, step: stepIndex + 1 } });
              results.push(await runStep(target, task.steps[stepIndex], observation, signal, timeoutMs));
            }
            let finalVerification: string | undefined;
            if (task.verify) {
              const state = await observe(target, observation, task.verify, signal, timeoutMs, true);
              finalVerification = state.markdown || `(final verification query “${task.verify}” had no AX matches)`;
            }
            const elapsedMs = performance.now() - taskStarted;
            const compactSummary = `✓ ${describeTarget(target)} · ${results.length} steps · ${observation.refreshes} AX refresh${observation.refreshes === 1 ? "" : "es"}, ${observation.reuses} reuse${observation.reuses === 1 ? "" : "s"} · ${elapsedMs.toFixed(0)}ms`;
            const text = task.responseMode === "detailed"
              ? `${compactSummary}\n${results.map((result, index) => `${index + 1}. ${result.summary}${result.verification ? `\n   verify:\n${result.verification}` : ""}`).join("\n")}${finalVerification ? `\nFinal verification:\n${compact(finalVerification, 2_000)}` : ""}`
              : `${compactSummary}${finalVerification ? `\n${compact(finalVerification, 1_000)}` : ""}`;
            return { target, results, observation, finalVerification, elapsedMs, text };
          }));

          const elapsedMs = performance.now() - started;
          const text = `Parallel native workflow: ${outputs.length} independent windows · ${elapsedMs.toFixed(0)}ms\n${outputs.map((output) => output.text).join("\n")}`;
          return { content: [{ type: "text", text: compact(text) }], details: { parallel: true, tasks: outputs, elapsedMs } };
        }

        let target = await resolveTarget(params, signal);

        if (params.action === "activate") {
          await activateTarget(target, signal, timeoutMs);
          return { content: [{ type: "text", text: `Activated exact ${describeTarget(target)} in ${(performance.now() - started).toFixed(0)}ms` }], details: { target, elapsedMs: performance.now() - started } };
        }

        const executeAgainstTarget = async () => {
          if (params.action === "inspect") {
            const state = await snapshot(target, params.query, signal, timeoutMs);
            const header = `${describeTarget(target)} · ${state.elementCount} AX elements · ${state.elapsedMs.toFixed(0)}ms`;
            return { text: `${header}\n${compact(state.markdown || `(no matches for “${params.query ?? ""}”)`)}`, steps: [] as any[] };
          }

          const topStep: NativeStep = {
            action: params.stepAction ?? "click",
            query: params.query,
            role: params.role,
            occurrence: params.occurrence,
            exact: params.exact,
            allowDisabled: params.allowDisabled,
            text: params.text,
            value: params.value,
            key: params.key,
            keys: params.keys,
            modifiers: params.modifiers,
            direction: params.direction,
            amount: params.amount,
            by: params.by,
            delayMs: params.delayMs,
            waitMs: params.waitMs,
            fuzzy: params.fuzzy,
            tool: params.tool,
            payload: params.payload,
            script: params.script,
            language: params.language,
            x: params.x,
            y: params.y,
            toX: params.toX,
            toY: params.toY,
            count: params.count,
            durationMs: params.durationMs,
            fromZoom: params.fromZoom,
            debugImageOut: params.debugImageOut,
            verify: params.action === "act" ? params.verify : undefined,
          };
          const steps = params.action === "sequence" ? (params.steps ?? []) : [topStep];
          if (!steps.length) throw new Error("sequence requires at least one step.");

          const observation: ObservationSession = {
            policy: params.observationPolicy ?? "fast",
            dirty: false,
            refreshes: 0,
            reuses: 0,
          };
          const results: Array<{ summary: string; verification?: string; elapsedMs: number }> = [];
          for (let index = 0; index < steps.length; index++) {
            if (signal?.aborted) throw new Error("Cua workflow cancelled.");
            onUpdate?.({ content: [{ type: "text", text: `Cua workflow ${index + 1}/${steps.length}: ${steps[index].action}` }], details: { phase: "steps", index: index + 1, count: steps.length } });
            results.push(await runStep(target, steps[index], observation, signal, timeoutMs));
          }

          let finalVerification: string | undefined;
          if (params.action === "sequence" && params.verify) {
            const state = await observe(target, observation, params.verify, signal, timeoutMs, true);
            finalVerification = state.markdown || `(final verification query “${params.verify}” had no AX matches)`;
          }

          const elapsedMs = performance.now() - started;
          const compactSummary = `✓ ${describeTarget(target)} · ${results.length} step${results.length === 1 ? "" : "s"} · ${observation.refreshes} AX refresh${observation.refreshes === 1 ? "" : "es"}, ${observation.reuses} reuse${observation.reuses === 1 ? "" : "s"} · ${elapsedMs.toFixed(0)}ms`;
          let text = compactSummary;
          if (params.responseMode === "detailed") {
            text += `\n` + results.map((result, index) => `${index + 1}. ${result.summary} · ${result.elapsedMs.toFixed(0)}ms${result.verification ? `\n   verify:\n${result.verification}` : ""}`).join("\n");
          }
          if (finalVerification) text += `\n${params.responseMode === "detailed" ? "Final verification:\n" : ""}${compact(finalVerification, params.responseMode === "detailed" ? 4_000 : 1_000)}`;
          return { text: compact(text), steps: results, observation };
        };

        try {
          const output = await executeAgainstTarget();
          return { content: [{ type: "text", text: output.text }], details: { target, steps: output.steps, observation: output.observation, elapsedMs: performance.now() - started } };
        } catch (error) {
          // Window ids change after app relaunches. Re-resolve once, then surface the real error.
          const message = error instanceof Error ? error.message : String(error);
          if (!/window|pid|AX state|cached/i.test(message)) throw error;
          targetCache.delete(cacheKey(params));
          target = await resolveTarget(params, signal, true);
          const output = await executeAgainstTarget();
          return { content: [{ type: "text", text: output.text }], details: { target, steps: output.steps, observation: output.observation, retriedTarget: true, elapsedMs: performance.now() - started } };
        }
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
