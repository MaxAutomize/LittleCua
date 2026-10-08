import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { withAutomationRepair } from "../_shared/automation-repair.ts";
import { createWebMcpTransport } from "./native-mcp-transport.ts";
import { createUrlTargetAffinity } from "./target-affinity.ts";
import { hasPageCondition, waitForPage } from "./page-readiness.ts";
import { assertChromeFocusSupport, focusChromeTarget } from "./native-focus.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const Action = StringEnum([
  "nav",
  "focus",
  "url",
  "title",
  "wait",
  "sleep",
  "summary",
  "text",
  "find",
  "find-text",
  "find-links",
  "find-buttons",
  "find-inputs",
  "exists",
  "value",
  "click",
  "click-text",
  "trusted-click",
  "trusted-click-text",
  "press",
  "fill",
  "type",
  "select",
  "submit",
  "scroll",
  "session",
  "bind",
  "tabs",
  "switch",
  "newtab",
  "closetab",
  "run",
  "run-main",
  "cart",
  "sequence",
] as const);

const ReadAfter = StringEnum(["none", "summary", "text"] as const, {
  description: "Content after nav (default summary) or a conditional wait (default none).",
  default: "summary",
});

const SequenceStep = Type.Object({
  action: StringEnum([
    "nav", "focus", "url", "title", "wait", "sleep", "summary", "text", "find", "find-text", "find-links",
    "find-buttons", "find-inputs", "exists", "value", "click", "click-text", "trusted-click", "trusted-click-text", "press", "fill", "type", "select",
    "submit", "scroll", "session", "bind", "tabs", "switch", "newtab", "closetab", "run", "run-main", "cart",
  ] as const),
  tab: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  readAfter: Type.Optional(ReadAfter),
  selector: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  waitState: Type.Optional(StringEnum(["visible", "hidden", "attached", "detached", "enabled"] as const)),
  urlIncludes: Type.Optional(Type.String()),
  foreground: Type.Optional(Type.Boolean()),
  value: Type.Optional(Type.String()),
  tags: Type.Optional(Type.String()),
  target: Type.Optional(Type.String()),
  ms: Type.Optional(Type.Number()),
  pixels: Type.Optional(Type.Number()),
  javascript: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  modifiers: Type.Optional(Type.Array(Type.String())),
  timeoutMs: Type.Optional(Type.Number()),
});

const Params = Type.Object({
  action: Action,
  tab: Type.Optional(Type.String({ description: "Explicit target override: active, tab:ID, index, URL, or title. Omit to remain on the persistent Pi Automation session." })),
  url: Type.Optional(Type.String({ description: "URL for nav or newtab" })),
  readAfter: Type.Optional(ReadAfter),
  selector: Type.Optional(Type.String({ description: "CSS selector for DOM actions or a conditional readiness wait." })),
  waitState: Type.Optional(StringEnum(["visible", "hidden", "attached", "detached", "enabled"] as const, { description: "For wait+selector; defaults visible." })),
  urlIncludes: Type.Optional(Type.String({ description: "For wait: require this substring in the exact target tab URL." })),
  foreground: Type.Optional(Type.Boolean({ description: "After success, bring the exact target tab into focus through cua_driver. Default false. Sequence foreground runs once at the endpoint." })),
  text: Type.Optional(Type.String({ description: "Visible text for text actions, or text that must appear for a conditional wait." })),
  value: Type.Optional(Type.String({ description: "Value for fill/type/select, or the exact expected field value for wait+selector." })),
  tags: Type.Optional(Type.String({ description: "Optional tag filter for find-text or click-text" })),
  target: Type.Optional(Type.String({ description: "Target for bind/switch/closetab: active, tab ID, index, URL, or title" })),
  ms: Type.Optional(Type.Number({ description: "Readiness budget for wait, fixed duration for sleep. Conditional waits default 10000ms and return immediately when ready." })),
  pixels: Type.Optional(Type.Number({ description: "Scroll distance; positive is down, negative is up" })),
  javascript: Type.Optional(Type.String({ description: "Synchronous JavaScript for run or run-main. run-main executes with page-owned framework state when inline injection is allowed." })),
  key: Type.Optional(Type.String({ description: "Key for press, or optional commit key after type (return, tab, or escape)" })),
  modifiers: Type.Optional(Type.Array(Type.String({ description: "Modifiers for press: cmd, shift, option, ctrl" }))),
  timeoutMs: Type.Optional(Type.Number({ description: "Command timeout in milliseconds" })),
  steps: Type.Optional(Type.Array(SequenceStep, { minItems: 1, maxItems: 30, description: "For action=sequence: run up to 30 live-Chrome operations in one model tool call" })),
  stopOnError: Type.Optional(Type.Boolean({ description: "For sequence: stop at the first failed step. Default true." })),
});

type Input = Static<typeof Params>;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for this web_cli action.`);
  return value;
}

function webBinary(): string {
  if (process.env.WEB_CLI_PATH) return process.env.WEB_CLI_PATH;
  const userBinary = join(homedir(), ".local", "bin", "web");
  return existsSync(userBinary) ? userBinary : "web";
}

function buildArgs(params: Input): string[] {
  const args: string[] = [];
  if (!["session", "bind", "tabs", "switch", "newtab", "closetab"].includes(params.action)) {
    // Omitted tab stays on the durable Pi Automation tab. "active" is an
    // explicit opt-in to the user's front Chrome tab, never an implicit fallback.
    args.push("--tab", params.tab ?? "session");
  }
  args.push(params.action);

  switch (params.action) {
    case "url":
    case "title":
    case "summary":
    case "text":
    case "find-inputs":
    case "tabs":
    case "cart":
    case "focus":
      break;
    case "nav":
      args.push(required(params.url, "url"));
      break;
    case "wait":
    case "sleep":
      args.push(String(Math.max(0, Math.floor(params.ms ?? 1000))));
      break;
    case "find":
    case "exists":
    case "value":
    case "click":
    case "trusted-click":
    case "submit":
      args.push(required(params.selector, "selector"));
      break;
    case "find-text":
    case "click-text":
    case "trusted-click-text":
      args.push(required(params.text, "text"));
      if (params.tags) args.push(params.tags);
      break;
    case "press":
      args.push(required(params.key, "key"));
      if (params.modifiers?.length) args.push(params.modifiers.join(","));
      break;
    case "find-links":
    case "find-buttons":
      if (params.text) args.push(params.text);
      break;
    case "fill":
    case "select":
      args.push(required(params.selector, "selector"), required(params.value, "value"));
      break;
    case "type":
      args.push(required(params.selector, "selector"), required(params.value, "value"));
      if (params.key) args.push(params.key);
      break;
    case "scroll":
      args.push(String(Math.trunc(params.pixels ?? 700)));
      break;
    case "session":
      break;
    case "bind":
      args.push(params.target ?? "active");
      break;
    case "switch":
    case "closetab":
      args.push(required(params.target, "target"));
      break;
    case "newtab":
      args.push(required(params.url, "url"));
      break;
    case "run":
    case "run-main":
      args.push(required(params.javascript, "javascript"));
      break;
    case "sequence":
      throw new Error("sequence is handled internally by web_cli");
  }
  return args;
}

function compact(text: string): string {
  const max = 50_000;
  if (text.length <= max) return text;
  return `${text.slice(0, 32_000)}\n\n…[${text.length - max} characters omitted]…\n\n${text.slice(-18_000)}`;
}

function looksDisconnected(text: string): boolean {
  return /WEB_PID|WEB_WID|cached target|Chrome.*(?:not found|not running)|no live chrome|connection refused|invalid index|can.?t get window|execution error/i.test(text);
}

const WEB_MINIMUM_CALL_CONTRACT =
  "Use one direct action for one operation, nav with readAfter for open-and-read, or one sequence for the complete deterministic workflow.";

const WEB_BOTTLENECK_RECOVERY =
  `web_cli bottleneck: inspect the exact failed DOM/framework/browser pattern; update the reusable implementation in ${fileURLToPath(import.meta.url)} or ${webBinary()} as appropriate; preserve proven paths; validate the change; call reload_runtime(mode='continue'); then retry the original web_cli operation from the same page. Do not abandon the workflow or replace a fixable tool gap with brittle one-off clicks.`;

function webResultText(text: string, isError: boolean): string {
  const base = compact(text);
  return isError ? `${base}\n\n${WEB_BOTTLENECK_RECOVERY}` : base;
}

export default function (hostPi: ExtensionAPI) {
  const transport = createWebMcpTransport(hostPi, webBinary());
  const pi = transport.api as ExtensionAPI;
  const urlTargets = createUrlTargetAffinity();
  async function resolveExactTab(binary: string, target: string, signal?: AbortSignal): Promise<string> {
    const resolved = await pi.exec(binary, ["resolve", target], { signal, timeout: 8_000 });
    if (resolved.code !== 0) throw new Error(String(resolved.stderr || resolved.stdout || `Could not resolve Chrome target ${target}`));
    const info = JSON.parse(String(resolved.stdout || "").trim());
    if (!/^tab:[1-9]\d*$/.test(info?.target ?? "")) throw new Error("web resolve returned no exact Chrome tab; no action dispatched.");
    return info.target;
  }
  async function finishResult(result: any, params: Input, binary: string, signal: AbortSignal | undefined, ctx: ExtensionContext, target = params.tab ?? "session") {
    if (!params.foreground || result.isError) return result;
    try {
      const foreground = await focusChromeTarget(pi, binary, target, ctx, signal, params.timeoutMs ?? 15_000);
      return { ...result, content: [...result.content, { type: "text", text: `Exact Chrome tab ${foreground.chromeTabId} brought into focus via Cua.` }], details: { ...result.details, foreground } };
    } catch (error) {
      return { ...result, isError: true, content: [...result.content, { type: "text", text: `Page action completed; foreground failed. Do not replay the page action. ${error instanceof Error ? error.message : String(error)}` }], details: { ...result.details, pageActionCompleted: true, foregroundFailed: true, noReplay: true } };
    }
  }
  const webTool: any = {
    name: "web_cli",
    label: "Web CLI",
    description:
      "Fast one-call DOM control of the user's live, authenticated Chrome. By default every turn returns to one persistent, named Pi Automation window/tab in the same Chrome profile, rather than taking the user's current tab. " +
      "Explicit tab overrides can still address active, tab:ID, index, URL, or title in the background. Navigation internally waits for readiness and can return page content immediately. " +
      "Ordinary DOM actions in Pi Automation use persistent Pi-native MCP with no per-action web/Cua CLI launches on the warm path, exact-tab identity guards, and a shared sequence lock. Exact inactive tabs, tab management, and trusted-click/press/type retain their planned compatibility paths; trusted input briefly fronts the exact target and restores focus. " +
      "Sequence runs up to 30 operations without repeated model round-trips, retaining the fast dedicated-session channel while pinning explicit non-session targets to stable tab IDs. " +
      "Conditional wait can target a DOM selector, text, URL, enabled state or value and return the next screen without fixed sleeps. foreground=true or action=focus brings only the exact automation tab forward through Cua in the same call. " +
      `${WEB_MINIMUM_CALL_CONTRACT} Use this before Cua for ordinary Chrome page work.`,
    promptSnippet: "Minimum-call live Chrome control: direct action, nav+read, or one complete DOM sequence",
    promptGuidelines: [
      "Real native mouse clicks, actual cursor movement, focus takeover, and trusted keyboard input remain important; removing the decorative animated agent cursor must never be treated as removing native input capability. The web_cli extension uses Pi's web_native MCP server for the dedicated session's warm DOM path. Continue using web_cli, not raw MCP tools, to preserve exact-tab guards, the shared cross-process sequence lock, navigation handling and no-replay safeguards. Exact inactive-tab and trusted-input operations use preselected compatibility routes, never fallback after native failures. Use /mcp for diagnostics and /web-transport cli only for explicit rollback. If changing DOM generators in ~/.local/bin/web, regenerate web-cli/dom-templates.json with generate-dom-templates.mjs, validate and reload; the native path rejects mismatched source hashes.",
      "Use web_cli as the default for ordinary work in the user's live authenticated Chrome: navigation, page text, DOM discovery, links/buttons, clicks, forms, scrolling, JavaScript, and tab control.",
      "Use web_research for all ordinary public-web research, known-URL reading, documentation indexes, and raw-source reads. Keep web_cli for actual authenticated or interactive Chrome work, not as a parallel research route.",
      "Do not use cua_driver/native Mac accessibility traversal for normal webpage content or DOM interactions. Cua is only a fallback for browser chrome, non-DOM visual content, or a web_cli failure that genuinely requires visual control; use sitegeist for difficult visual web flows.",
      "Omit tab to continue the persistent Pi Automation session across turns. This is a named second window in the user's existing Chrome process/profile, not a separate browser login or headless session.",
      "Use tab='active' only when the user explicitly asks to operate on their currently active Chrome tab. A tab:ID, index, URL, or title can target another tab directly in the background.",
      "Use action=session to inspect the remembered bot target and action=bind only when intentionally moving that persistent target. Never silently rebind to the user's active tab.",
      `MINIMUM-CALL WORKFLOW: ${WEB_MINIMUM_CALL_CONTRACT} Do not split a known workflow into inspect/click/inspect/fill/inspect calls.`,
      "Use action=sequence for multi-step live-Chrome work. The dedicated session retains its cached exact automation-window channel; explicit active/tab/URL/title targets are pinned to a stable Chrome tab ID. Access is serialized so parallel calls cannot race the same automation session.",
      "Use click/click-text and fill for normal fast DOM actions. Known FullCalendar pointer-only time slots are detected before any click and automatically use exact-tab native mouse input, foregrounding the target and restoring prior focus. This is pre-dispatch routing, never fallback/replay after a failure. Use type with a selector, value, and optional commit key when a custom or framework-controlled field displays the synthetic fill but does not update page state. Trusted actions briefly front the exact target and restore focus.",
      "For asynchronous form/SPA transitions, use wait with selector (waitState visible/hidden/attached/detached/enabled), text, urlIncludes, or selector+value. Conditions combine, default to a 10-second budget, and return immediately when satisfied. Optional readAfter returns the next screen in the same call. Bare wait retains document-readiness behavior; sleep is only for an intentionally fixed delay.",
      "Use foreground=true on nav or a sequence when the user wants to see the result, or action=focus for the already-open exact tab. Foreground runs through cua_driver native workflow, uses text-safe Chrome IDs, never adopts the user's active tab, and never replays completed page mutations after a focus failure. Default DOM work remains background-safe.",
      "web_cli fill first updates framework-controlled fields in the page's own JavaScript world while staying background-safe. Use run-main when page-owned JavaScript expandos or component state is essential; use type or Chrome DevTools through cua_driver only if a strict Content Security Policy blocks main-world injection.",
      "Call the needed web_cli action directly—never make a separate setup/auto call. Every action self-heals a stale target and opens Chrome only when necessary.",
      "For navigation, set readAfter='summary' or 'text' so one web_cli call launches/discovers Chrome, navigates, waits for readiness, and returns the page content needed for the task.",
      "Prefer summary or targeted find commands before full text when that yields enough context. If discovery is genuinely required, inspect once, then perform the complete known mutation flow in the next single sequence call.",
      "Do not add routine verification calls after a successful deterministic DOM operation. Put the consequential endpoint read/value/exists check at the end of the same sequence when verification matters.",
      "Choose the narrowest proven strategy for the page: semantic DOM actions first; type for keyboard-capture/framework fields; run-main for page-owned component state; trusted actions only for browser gesture gates; Cua only for browser chrome or truly non-DOM visuals.",
      "If web_cli cannot fully read, target, mutate, commit, verify, or continue a page as expected, treat that as a reusable tool bottleneck. Inspect the exact DOM/framework/browser pattern, improve ~/.pi/agent/extensions/web-cli/index.ts or ~/.local/bin/web as appropriate, preserve working behavior, validate, reload Pi with mode='continue', and retry the original web_cli call from the same state. Do not silently give up or default to brittle ad-hoc automation.",
    ],
    parameters: Params,
    async execute(_id: string, params: Input, signal: AbortSignal | undefined, onUpdate: any, _ctx: ExtensionContext) {
      const binary = webBinary();
      if (params.foreground || params.action === "focus") assertChromeFocusSupport(_ctx);
      const requestedTab = params.tab;
      // Pin explicitly selected URLs once for this runtime. Reuse that same tab
      // across POST/SPA redirects instead of re-searching a vanished old URL.
      if (requestedTab) params = { ...params, tab: await urlTargets.pin(requestedTab, target => resolveExactTab(binary, target, signal)) };

      if (params.action === "focus") {
        const foreground = await focusChromeTarget(pi, binary, params.tab ?? "session", _ctx, signal, params.timeoutMs ?? 15_000);
        return { isError: false, content: [{ type: "text", text: `Exact Chrome tab ${foreground.chromeTabId} brought into focus via Cua.` }], details: { action: "focus", foreground, requestedTab, pinnedTab: `tab:${foreground.chromeTabId}`, code: 0 } };
      }
      if (params.action === "wait" && hasPageCondition(params)) {
        const budgetMs = Math.min(Math.max(0, params.ms ?? 10_000), Math.max(0, params.timeoutMs ?? 30_000));
        const readiness = await waitForPage(async (script, remaining) => {
          const probe = await pi.exec(binary, ["--tab", params.tab ?? "session", "run", script], { signal, timeout: remaining });
          if (probe.code !== 0) throw new Error(String(probe.stderr || probe.stdout || "Readiness probe failed; no action replay."));
          return String(probe.stdout).trim();
        }, params, { budgetMs, signal });
        const content: any[] = [{ type: "text", text: JSON.stringify(readiness) }];
        if (readiness.ready && params.readAfter && params.readAfter !== "none") {
          const read = await pi.exec(binary, ["--tab", params.tab ?? "session", params.readAfter], { signal, timeout: params.timeoutMs ?? 30_000 });
          if (read.code !== 0) throw new Error(String(read.stderr || read.stdout || "Post-readiness read failed; no action replay."));
          content.push({ type: "text", text: String(read.stdout).trim() });
        }
        return await finishResult({ isError: !readiness.ready, content, details: { action: "wait", readiness, code: readiness.ready ? 0 : 1, stdout: JSON.stringify(readiness) } }, params, binary, signal, _ctx);
      }

      if (params.action === "sequence") {
        if (!params.steps?.length) throw new Error("steps are required for web_cli sequence.");
        let pinnedTab = params.tab ?? "session";
        const usesDedicatedSession = ["session", "bot"].includes(pinnedTab);

        // Keep the dedicated session logical so every step uses its cached exact
        // native window through cua-driver. Explicit active/title/URL targets are
        // still resolved once to a stable Chrome tab ID so user tab changes cannot
        // redirect those runs.
        if (!usesDedicatedSession && !pinnedTab.startsWith("tab:")) {
          pinnedTab = await resolveExactTab(binary, pinnedTab, signal);
        }

        const outputs: string[] = [];
        const results: any[] = [];
        let failed = false;
        for (let index = 0; index < params.steps.length; index++) {
          if (signal?.aborted) throw new Error("web_cli sequence cancelled.");
          const step = params.steps[index] as any;
          const stepParams = { ...step, tab: step.tab ?? pinnedTab } as Input;
          onUpdate?.({ content: [{ type: "text", text: `web_cli ${index + 1}/${params.steps.length}: ${step.action}` }], details: { index: index + 1, count: params.steps.length } });
          const result = await webTool.execute(`${_id}:${index + 1}`, stepParams, signal, undefined, _ctx);
          let stepText = result.content?.map((item: any) => item.type === "text" ? item.text : "").filter(Boolean).join("\n") || `${step.action} completed`;
          const repeatedTarget = `[web_cli target: ${pinnedTab}]\n\n`;
          if (pinnedTab.startsWith("tab:") && stepText.startsWith(repeatedTarget)) stepText = stepText.slice(repeatedTarget.length);
          outputs.push(`${index + 1}. ${step.action}\n${stepText}`);
          results.push({ action: step.action, isError: Boolean(result.isError), details: result.details });
          if (result.isError) {
            failed = true;
            if (params.stopOnError !== false) break;
          }
        }
        return await finishResult({
          isError: failed,
          content: [{ type: "text" as const, text: compact((pinnedTab.startsWith("tab:") ? `[web_cli target: ${pinnedTab}]\n\n` : "") + outputs.join("\n\n")) }],
          details: { action: "sequence", requestedTab, pinnedTab, requestedSteps: params.steps.length, completedSteps: results.length, results },
        }, params, binary, signal, _ctx, pinnedTab);
      }

      const args = buildArgs(params);
      const timeout = params.timeoutMs ?? (["wait", "sleep"].includes(params.action) ? Math.max(10_000, (params.ms ?? 1000) + 10_000) : params.action === "run" ? 60_000 : 30_000);
      onUpdate?.({ content: [{ type: "text", text: (pi as any).webNativeMode?.() ? `web_cli ${params.action} (native transport router)…` : `${binary} ${args.map((arg) => JSON.stringify(arg)).join(" ")}` }] });

      const pageScope = ["--tab", params.tab ?? "session"];
      let beforeNavigation = "";
      if (params.action === "nav") {
        const before = await pi.exec(binary, [...pageScope, "url"], { signal, timeout: 5_000 });
        if (before.code === 0) beforeNavigation = String(before.stdout || "").trim();
      }

      let response = await pi.exec(binary, args, { signal, timeout });
      let repairedTarget = false;
      const firstText = `${response.stdout || ""}\n${response.stderr || ""}`;

      // The underlying CLI can print a stale-window warning while still exiting
      // zero, so inspect output as well as the exit code.
      if (looksDisconnected(firstText) && !(pi as any).webNativeMode?.()) {
        repairedTarget = true;
        // Repair only the named bot session. Never recover by adopting whichever
        // user Chrome window happens to be frontmost.
        const session = await pi.exec(binary, ["session"], { signal, timeout: 12_000 });
        if (session.code === 0) response = await pi.exec(binary, args, { signal, timeout });
      }

      let stdout = String(response.stdout || "").trim();
      let stderr = String(response.stderr || "").trim();
      const followups: Array<{ action: string; code: number; stdout: string; stderr: string }> = [];
      let postActionError = false;

      // Navigation is one model-visible operation. First wait adaptively for the
      // URL transition itself (readyState on the old page can still be complete),
      // then wait for the new page and return useful content.
      if (params.action === "nav" && response.code === 0 && !looksDisconnected(`${stdout}\n${stderr}`)) {
        let arrived = false;
        let currentUrl = beforeNavigation;
        let targetHost = "";
        let normalizedTarget = params.url || "";
        try {
          const target = new URL(params.url!);
          targetHost = target.hostname.replace(/^www\./, "");
          normalizedTarget = target.href.replace(/\/$/, "");
        } catch {}

        for (let attempt = 0; attempt < 60; attempt++) {
          const current = await pi.exec(binary, [...pageScope, "url"], { signal, timeout: 5_000 });
          currentUrl = String(current.stdout || "").trim();
          followups.push({ action: "url", code: current.code, stdout: currentUrl, stderr: String(current.stderr || "").trim() });
          let hostMatches = false;
          try {
            const host = new URL(currentUrl).hostname.replace(/^www\./, "");
            hostMatches = Boolean(targetHost) && (host === targetHost || host.endsWith(`.${targetHost}`) || targetHost.endsWith(`.${host}`));
          } catch {}
          const exactMatch = currentUrl.replace(/\/$/, "") === normalizedTarget;
          if ((currentUrl !== beforeNavigation && hostMatches) || exactMatch) {
            arrived = true;
            break;
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        }

        if (!arrived) {
          postActionError = true;
          stdout = "";
          stderr = `Navigation did not leave ${beforeNavigation || "the previous page"}; last URL was ${currentUrl || "unknown"}.`;
        } else {
          const ready = await pi.exec(binary, [...pageScope, "wait", "10000"], { signal, timeout: 20_000 });
          followups.push({ action: "wait", code: ready.code, stdout: String(ready.stdout || "").trim(), stderr: String(ready.stderr || "").trim() });
          const readAfter = params.readAfter ?? "summary";
          if (readAfter !== "none" && ready.code === 0) {
            const read = await pi.exec(binary, [...pageScope, readAfter], { signal, timeout });
            followups.push({ action: readAfter, code: read.code, stdout: String(read.stdout || "").trim(), stderr: String(read.stderr || "").trim() });
            if (read.code === 0) {
              stdout = [String(ready.stdout || "").trim(), String(read.stdout || "").trim()].filter(Boolean).join("\n\n");
              stderr = [String(ready.stderr || "").trim(), String(read.stderr || "").trim()].filter(Boolean).join("\n");
            } else {
              postActionError = true;
            }
          } else if (ready.code === 0) {
            stdout = String(ready.stdout || "").trim() || stdout;
            stderr = String(ready.stderr || "").trim();
          } else {
            postActionError = true;
          }
        }
      }

      const finalDisconnected = looksDisconnected(`${stdout}\n${stderr}`);
      const isError = response.code !== 0 || finalDisconnected || postActionError;
      const text = webResultText([stdout, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n\n") || `web ${params.action} completed`, isError);
      return await finishResult({
        isError,
        content: [{ type: "text" as const, text: (params.tab?.startsWith("tab:") ? `[web_cli target: ${params.tab}]\n\n` : "") + text }],
        details: { action: params.action, requestedTab, pinnedTab: params.tab, args, code: response.code, repairedTarget, stdout, stderr, followups },
      }, params, binary, signal, _ctx);
    },
  };
  const registeredTool = withAutomationRepair(transport.wrap(webTool), `${fileURLToPath(import.meta.url)} or ${webBinary()}`);
  registeredTool.promptGuidelines = registeredTool.promptGuidelines.map((text: string) => text
    .replaceAll("~/.pi/agent/extensions/web-cli", fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, ""))
    .replaceAll("~/.local/bin/web", webBinary()));
  pi.registerTool(registeredTool);
}
