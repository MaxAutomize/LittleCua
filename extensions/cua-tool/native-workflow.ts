import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const BIN = process.env.CUA_DRIVER_BIN ?? "cua-driver";
const DEFAULT_TIMEOUT_MS = Number(process.env.NATIVE_FAST_TIMEOUT_MS ?? 15_000);
const CACHE_TTL_MS = Number(process.env.NATIVE_FAST_CACHE_TTL_MS ?? 60_000);
const MAX_TREE_CHARS = Number(process.env.NATIVE_FAST_MAX_TREE_CHARS ?? 12_000);

const stepSchema = Type.Object({
  action: StringEnum([
    "inspect", "click", "double_click", "right_click", "type", "fill", "set_value",
    "press_key", "hotkey", "scroll", "wait", "activate", "pixel_click", "drag", "raw_call", "applescript",
  ] as const),
  query: Type.Optional(Type.String({ description: "Case-insensitive text used to find an AX element." })),
  role: Type.Optional(Type.String({ description: "Optional AX role filter, e.g. AXButton, Button, TextField, Row." })),
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
  waitMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30_000 })),
  fuzzy: Type.Optional(Type.Boolean({ description: "Permit bold best-effort fuzzy matching. Defaults true." })),
  tool: Type.Optional(Type.String({ description: "Any cua-driver MCP tool name for raw_call." })),
  payload: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Raw cua-driver payload; target pid/window_id are injected when absent." })),
  script: Type.Optional(Type.String({ description: "Unrestricted AppleScript source for applescript." })),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  toX: Type.Optional(Type.Number()),
  toY: Type.Optional(Type.Number()),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  verify: Type.Optional(Type.String({ description: "After this step, return AX state filtered to this text." })),
});
type NativeStep = Static<typeof stepSchema>;

export const nativeFastSchema = Type.Object({
  action: StringEnum(["inspect", "act", "sequence", "launch", "activate", "windows", "benchmark", "clear_cache", "raw_call", "applescript"] as const),
  app: Type.Optional(Type.String({ description: "Native app display-name substring, e.g. Xcode, Finder, System Settings. Omit for frontmost app." })),
  bundleId: Type.Optional(Type.String({ description: "Bundle identifier for unambiguous launch/targeting." })),
  pid: Type.Optional(Type.Integer()),
  windowId: Type.Optional(Type.Integer()),
  windowTitle: Type.Optional(Type.String({ description: "Target a specific background window/tabbed document by title substring." })),
  windowOccurrence: Type.Optional(Type.Integer({ minimum: 1, description: "1-based window match when titles repeat." })),
  launchIfNeeded: Type.Optional(Type.Boolean({ description: "Launch app in background when no window exists. Defaults true when app/bundleId is supplied." })),
  query: Type.Optional(Type.String({ description: "Inspect filter, or semantic element selector for action=act." })),
  role: Type.Optional(Type.String()),
  occurrence: Type.Optional(Type.Integer({ minimum: 1 })),
  exact: Type.Optional(Type.Boolean()),
  allowDisabled: Type.Optional(Type.Boolean()),
  stepAction: Type.Optional(StringEnum([
    "inspect", "click", "double_click", "right_click", "type", "fill", "set_value",
    "press_key", "hotkey", "scroll", "wait", "activate", "pixel_click", "drag", "raw_call", "applescript",
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
  script: Type.Optional(Type.String({ description: "Unrestricted AppleScript source for action=applescript." })),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  toX: Type.Optional(Type.Number()),
  toY: Type.Optional(Type.Number()),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  verify: Type.Optional(Type.String({ description: "Final AX query used to verify the resulting UI." })),
  steps: Type.Optional(Type.Array(stepSchema, { minItems: 1, maxItems: 30 })),
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
    .replace(/\s+DISABLED\s*$/, "")
    .replace(/^[=(]\s*/, "")
    .replace(/[)]\s*$/, "")
    .replace(/^"|"$/g, "")
    .trim();
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
  if (!step.query) throw new Error(`${step.action} requires query to select an element.`);
  const query = step.query.trim().toLowerCase();
  const role = normalizeRole(step.role);
  const eligible = parseElements(markdown).filter((element) => {
    if (!step.allowDisabled && /\bDISABLED\b/i.test(element.line)) return false;
    return !role || element.role.toLowerCase() === role;
  });
  let matches = eligible.filter((element) => {
    if (step.exact) {
      const label = element.label.toLowerCase();
      return label === query || label.replace(/[.…]+$/g, "") === query.replace(/[.…]+$/g, "");
    }
    return element.line.toLowerCase().includes(query);
  });

  if (!step.exact) {
    const exactMatches = matches.filter((element) => element.label.toLowerCase() === query);
    if (exactMatches.length) matches = exactMatches;
  }

  let fuzzy = false;
  if (!matches.length && step.fuzzy !== false) {
    const ranked = eligible
      .map((element) => ({ element, score: Math.max(similarity(step.query ?? "", element.label), similarity(step.query ?? "", element.line)) }))
      .filter((entry) => entry.score >= 0.3)
      .sort((a, b) => b.score - a.score);
    if (ranked.length) {
      matches = ranked.map((entry) => entry.element);
      fuzzy = true;
    }
  }

  if (!matches.length) {
    const roleHint = step.role ? ` with role ${step.role}` : "";
    throw new Error(`No enabled AX element matched “${step.query}”${roleHint}, including fuzzy matching.`);
  }

  const occurrence = step.occurrence ?? 1;
  const chosen = matches[occurrence - 1];
  if (!chosen) throw new Error(`Only ${matches.length} element(s) matched “${step.query}”; occurrence ${occurrence} does not exist.`);
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
      const listed = await listWindows(signal, params.timeoutMs, pid);
      window = chooseWindow(listed.windows, params.app, params.windowTitle, params.windowOccurrence ?? 1);
    }
    if (!Number.isFinite(pid) || !window?.window_id) throw new Error(`Launched ${params.app ?? params.bundleId ?? "app"}, but no usable window appeared.`);
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
      query,
    }, signal, timeoutMs);
    return {
      markdown: String(result.data?.tree_markdown ?? ""),
      elementCount: Number(result.data?.element_count ?? 0),
      elapsedMs: result.elapsedMs,
    };
  };

  const runStep = async (target: Target, step: NativeStep, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ summary: string; verification?: string; elapsedMs: number }> => {
    const started = performance.now();
    let summary = "";

    if (step.action === "wait") {
      const ms = step.waitMs ?? 250;
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { summary: `waited ${ms}ms`, elapsedMs: performance.now() - started };
    }

    if (step.action === "activate") {
      const result = await pi.exec("open", ["-a", target.appName], { signal, timeout: timeoutMs });
      if (result.code !== 0) throw new Error(`activate failed: ${result.stderr || result.stdout}`);
      return { summary: `activated ${target.appName}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "applescript") {
      if (!step.script) throw new Error("applescript requires script.");
      const result = await pi.exec("/usr/bin/osascript", ["-e", step.script], { signal, timeout: timeoutMs });
      if (result.code !== 0) throw new Error(`AppleScript failed: ${result.stderr || result.stdout}`);
      return { summary: `AppleScript executed${result.stdout?.trim() ? `: ${compact(result.stdout.trim(), 1_000)}` : ""}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "raw_call") {
      if (!step.tool) throw new Error("raw_call requires tool.");
      const payload = { pid: target.pid, window_id: target.windowId, ...(step.payload ?? {}) };
      const result = await call(step.tool, payload, signal, timeoutMs);
      return { summary: `raw ${step.tool}: ${compact(result.raw || "ok", 2_000)}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "pixel_click") {
      if (step.x === undefined || step.y === undefined) throw new Error("pixel_click requires x and y.");
      await call("click", { pid: target.pid, window_id: target.windowId, x: step.x, y: step.y, count: step.count ?? 1, modifier: step.modifiers }, signal, timeoutMs);
      return { summary: `pixel-clicked (${step.x}, ${step.y}) ×${step.count ?? 1}`, elapsedMs: performance.now() - started };
    }

    if (step.action === "drag") {
      if (step.x === undefined || step.y === undefined || step.toX === undefined || step.toY === undefined) throw new Error("drag requires x, y, toX, and toY.");
      await call("drag", { pid: target.pid, window_id: target.windowId, from_x: step.x, from_y: step.y, to_x: step.toX, to_y: step.toY, duration_ms: step.durationMs, modifier: step.modifiers }, signal, timeoutMs);
      return { summary: `dragged (${step.x}, ${step.y}) → (${step.toX}, ${step.toY})`, elapsedMs: performance.now() - started };
    }

    if (step.action === "inspect") {
      const state = await snapshot(target, step.query, signal, timeoutMs);
      summary = state.markdown || `(no AX matches for “${step.query ?? ""}”; ${state.elementCount} total elements)`;
      return { summary: compact(summary), elapsedMs: performance.now() - started };
    }

    if (["press_key", "hotkey", "scroll"].includes(step.action) && !step.query) {
      if (step.action === "press_key") {
        await call("press_key", { pid: target.pid, window_id: target.windowId, key: step.key, modifiers: step.modifiers }, signal, timeoutMs);
        summary = `pressed ${step.key}`;
      } else if (step.action === "hotkey") {
        await call("hotkey", { pid: target.pid, window_id: target.windowId, keys: step.keys }, signal, timeoutMs);
        summary = `pressed ${(step.keys ?? []).join("+")}`;
      } else {
        await call("scroll", { pid: target.pid, window_id: target.windowId, direction: step.direction ?? "down", amount: step.amount, by: step.by }, signal, timeoutMs);
        summary = `scrolled ${step.direction ?? "down"}`;
      }
    } else {
      const state = await snapshot(target, step.query, signal, timeoutMs);
      const selected = selectElement(state.markdown, step);
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
          await call("hotkey", { pid: target.pid, keys: step.keys }, signal, timeoutMs);
          summary = `pressed ${(step.keys ?? []).join("+")} on [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        case "scroll":
          await call("scroll", { ...base, direction: step.direction ?? "down", amount: step.amount, by: step.by }, signal, timeoutMs);
          summary = `scrolled ${step.direction ?? "down"} in [${element.index}] ${element.role} ${element.label}${matchNote}`;
          break;
        default:
          throw new Error(`Unsupported native step: ${step.action}`);
      }
    }

    let verification: string | undefined;
    if (step.verify) {
      const state = await snapshot(target, step.verify, signal, timeoutMs);
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
      "Experimental full-power native macOS control using the local cua-driver daemon. It targets background apps/windows without stealing focus, caches exact pid/window identities, fuzzily finds AX elements, performs semantic actions, pixel clicks, drags, unrestricted AppleScript, arbitrary raw cua-driver calls, and up to 30 mixed UI steps in one model tool call. It executes requested workflows without its own confirmation dialogs. Use cua_driver mainly for standalone visual screenshot/zoom inspection. Output is capped at 12KB.",
    promptSnippet: "Full-power background native Mac control: cached windows, fuzzy AX selectors, pixels, drags, AppleScript, raw calls, and one-call sequences.",
    promptGuidelines: [
      "Use the integrated Cua workflow for native Mac automation with cached targets, fuzzy selectors, raw calls, AppleScript, pixels, drags, and one-call sequences.",
      "The Cua workflow controls explicitly named app/window targets in the background, so the user can keep working elsewhere; supply app and optionally windowTitle.",
      "Use action=inspect for discovery, act for one operation, and sequence for several deterministic operations without repeated model round-trips.",
      "Use query plus role when labels are ambiguous; occurrence and windowOccurrence are 1-based, while fuzzy matching is enabled by default.",
      "Use direct cua_driver actions mainly for standalone screenshots and zoom inspection.",
      "For Chrome page content use web CLI first and Sitegeist only for visual web tasks.",
    ],
    parameters: nativeFastSchema,

    async execute(_toolCallId, params, signal, onUpdate) {
      const started = performance.now();
      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      onUpdate?.({ content: [{ type: "text", text: "Cua workflow…" }], details: { phase: "starting" } });

      try {
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

        if (params.action === "applescript") {
          if (!params.script) throw new Error("applescript requires script.");
          const result = await pi.exec("/usr/bin/osascript", ["-e", params.script], { signal, timeout: timeoutMs });
          if (result.code !== 0) throw new Error(`AppleScript failed: ${result.stderr || result.stdout}`);
          return { content: [{ type: "text", text: compact(result.stdout?.trim() || "AppleScript executed.") }], details: { elapsedMs: performance.now() - started } };
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

        let target = await resolveTarget(params, signal);

        if (params.action === "activate") {
          const args = params.bundleId ? ["-b", params.bundleId] : ["-a", target.appName];
          const result = await pi.exec("open", args, { signal, timeout: timeoutMs });
          if (result.code !== 0) throw new Error(`activate failed: ${result.stderr || result.stdout}`);
          return { content: [{ type: "text", text: `Activated ${describeTarget(target)} in ${(performance.now() - started).toFixed(0)}ms` }], details: { target, elapsedMs: performance.now() - started } };
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
            x: params.x,
            y: params.y,
            toX: params.toX,
            toY: params.toY,
            count: params.count,
            durationMs: params.durationMs,
            verify: params.action === "act" ? params.verify : undefined,
          };
          const steps = params.action === "sequence" ? (params.steps ?? []) : [topStep];
          if (!steps.length) throw new Error("sequence requires at least one step.");

          const results: Array<{ summary: string; verification?: string; elapsedMs: number }> = [];
          for (let index = 0; index < steps.length; index++) {
            if (signal?.aborted) throw new Error("Cua workflow cancelled.");
            onUpdate?.({ content: [{ type: "text", text: `Cua workflow ${index + 1}/${steps.length}: ${steps[index].action}` }], details: { phase: "steps", index: index + 1, count: steps.length } });
            results.push(await runStep(target, steps[index], signal, timeoutMs));
          }

          let finalVerification: string | undefined;
          if (params.action === "sequence" && params.verify) {
            const state = await snapshot(target, params.verify, signal, timeoutMs);
            finalVerification = state.markdown || `(final verification query “${params.verify}” had no AX matches)`;
          }

          let text = `${describeTarget(target)}\n` + results.map((result, index) =>
            `${index + 1}. ${result.summary} · ${result.elapsedMs.toFixed(0)}ms${result.verification ? `\n   verify:\n${result.verification}` : ""}`
          ).join("\n");
          if (finalVerification) text += `\nFinal verification:\n${compact(finalVerification, 4_000)}`;
          text += `\nTotal: ${(performance.now() - started).toFixed(0)}ms`;
          return { text: compact(text), steps: results };
        };

        try {
          const output = await executeAgainstTarget();
          return { content: [{ type: "text", text: output.text }], details: { target, steps: output.steps, elapsedMs: performance.now() - started } };
        } catch (error) {
          // Window ids change after app relaunches. Re-resolve once, then surface the real error.
          const message = error instanceof Error ? error.message : String(error);
          if (!/window|pid|AX state|cached/i.test(message)) throw error;
          targetCache.delete(cacheKey(params));
          target = await resolveTarget(params, signal, true);
          const output = await executeAgainstTarget();
          return { content: [{ type: "text", text: output.text }], details: { target, steps: output.steps, retriedTarget: true, elapsedMs: performance.now() - started } };
        }
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
