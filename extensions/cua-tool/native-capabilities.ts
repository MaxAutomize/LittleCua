import { NativeDeadline, NativeOperationError } from "./native-operation-coordinator.ts";

type ToolSchema = {
  name?: string;
  input_schema?: { properties?: Record<string, unknown>; required?: string[] };
};

export type NativeDriverCapabilities = {
  version: string;
  discoveredAt: number;
  toolNames: Set<string>;
  properties: Map<string, Set<string>>;
  required: Map<string, Set<string>>;
  supports(tool: string, property?: string): boolean;
  summary: {
    pixelClick: boolean;
    clickWindowId: boolean;
    clickDebugImage: boolean;
    windowScreenshot: boolean;
    scopedHotkey: boolean;
  };
};

/** A normal click must not invoke a text field's contextual menu. */
export function nativeClickAction(role: string, line: string, supportsAction: boolean): 'press' | 'pick' | 'show_menu' {
  if (/actions=\[[^\]]*\bAXPress\b/.test(line)) return 'press';
  if (supportsAction && ['AXMenuItem','AXMenuBarItem'].includes(role) && /actions=\[[^\]]*\bAXPick\b/.test(line)) return 'pick';
  if (supportsAction && ['AXMenuButton','AXPopUpButton'].includes(role) && /actions=\[[^\]]*\bAXShowMenu\b/.test(line)) return 'show_menu';
  return 'press';
}

/** Inject only scope keys actually accepted by the discovered native schema. */
export function nativeScopedPayload(capabilities: NativeDriverCapabilities, tool: string,
  target: {pid:number;windowId:number}, payload: Record<string, unknown> = {}) {
  return { ...(capabilities.supports(tool, 'pid') ? {pid:target.pid} : {}),
    ...(capabilities.supports(tool, 'window_id') ? {window_id:target.windowId} : {}), ...payload };
}

const CACHE_TTL_MS = 10 * 60_000;
let cached: NativeDriverCapabilities | undefined;
let inFlight: Promise<NativeDriverCapabilities> | undefined;

function buildCapabilities(document: any): NativeDriverCapabilities {
  const version = String(document?.mcp?.version ?? "unknown");
  const tools = Array.isArray(document?.mcp?.tools) ? document.mcp.tools as ToolSchema[] : [];
  if (!tools.length) throw new Error("cua-driver dump-docs returned no MCP tool schemas.");
  const toolNames = new Set<string>();
  const properties = new Map<string, Set<string>>();
  const required = new Map<string, Set<string>>();
  for (const tool of tools) {
    if (!tool.name) continue;
    toolNames.add(tool.name);
    properties.set(tool.name, new Set(Object.keys(tool.input_schema?.properties ?? {})));
    required.set(tool.name, new Set(tool.input_schema?.required ?? []));
  }
  const supports = (tool: string, property?: string) => toolNames.has(tool) && (!property || properties.get(tool)?.has(property) === true);
  const capabilities: NativeDriverCapabilities = {
    version,
    discoveredAt: Date.now(),
    toolNames,
    properties,
    required,
    supports,
    summary: {
      pixelClick: supports("click", "x") && supports("click", "y") && supports("click", "pid"),
      clickWindowId: supports("click", "window_id"),
      clickDebugImage: supports("click", "debug_image_out"),
      windowScreenshot: supports("screenshot", "window_id"),
      scopedHotkey: supports("hotkey", "window_id"),
    },
  };
  return capabilities;
}

/** Discover only the public installed cua-driver CLI/MCP schema. No driver update,
 * persistent config, private IPC, or browser setting is touched. */
export async function discoverNativeDriverCapabilities(pi: any, bin: string, signal: AbortSignal | undefined, deadline: NativeDeadline) {
  if (cached && Date.now() - cached.discoveredAt <= CACHE_TTL_MS) return cached;
  if (!inFlight) {
    inFlight = (async () => {
      deadline.assert("driver capability discovery", signal);
      const result = await pi.exec(bin, ["dump-docs"], {
        signal,
        timeout: deadline.remaining("driver capability discovery", 2_000),
      });
      if (result.code !== 0) {
        throw new NativeOperationError("unsupported", `Could not inspect installed cua-driver schemas: ${String(result.stderr || result.stdout || `exit ${result.code}`).slice(0, 1_000)}`, {
          phase: "driver capability discovery",
          deadlineUnixMilliseconds: deadline.deadlineUnixMilliseconds,
        });
      }
      return buildCapabilities(JSON.parse(String(result.stdout || "")));
    })().finally(() => { inFlight = undefined; });
  }
  cached = await inFlight;
  return cached;
}

export function requireNativeCapability(capabilities: NativeDriverCapabilities, supported: boolean, message: string, phase: string) {
  if (!supported) throw new NativeOperationError("unsupported", `${message} Installed cua-driver version: ${capabilities.version}.`, { phase });
}

export function resetNativeCapabilitiesForTests() {
  cached = undefined;
  inFlight = undefined;
}
