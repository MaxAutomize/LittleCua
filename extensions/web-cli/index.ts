import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const Action = StringEnum([
  "nav",
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
  description: "For nav: content to return after internally waiting for the page. Default summary.",
  default: "summary",
});

const SequenceStep = Type.Object({
  action: StringEnum([
    "nav", "url", "title", "wait", "sleep", "summary", "text", "find", "find-text", "find-links",
    "find-buttons", "find-inputs", "exists", "value", "click", "click-text", "trusted-click", "trusted-click-text", "press", "fill", "type", "select",
    "submit", "scroll", "session", "bind", "tabs", "switch", "newtab", "closetab", "run", "run-main", "cart",
  ] as const),
  tab: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  readAfter: Type.Optional(ReadAfter),
  selector: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
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
  selector: Type.Optional(Type.String({ description: "CSS selector for find/click/fill/type/select/submit/exists/value" })),
  text: Type.Optional(Type.String({ description: "Visible text for find-text/click-text, or optional filter for find-links/find-buttons" })),
  value: Type.Optional(Type.String({ description: "Value for fill, type, or select" })),
  tags: Type.Optional(Type.String({ description: "Optional tag filter for find-text or click-text" })),
  target: Type.Optional(Type.String({ description: "Target for bind/switch/closetab: active, tab ID, index, URL, or title" })),
  ms: Type.Optional(Type.Number({ description: "Milliseconds: readiness budget for wait, fixed duration for sleep" })),
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

export default function (pi: ExtensionAPI) {
  const webTool: any = {
    name: "web_cli",
    label: "Web CLI",
    description:
      "Fast one-call DOM control of the user's live, authenticated Chrome. By default every turn returns to one persistent, named Pi Automation window/tab in the same Chrome profile, rather than taking the user's current tab. " +
      "Explicit tab overrides can still address active, tab:ID, index, URL, or title in the background. Navigation internally waits for readiness and can return page content immediately. " +
      "Synthetic clicks and fills stay fast and background-safe; the dedicated Pi Automation session uses a cached cua-driver page channel instead of rescanning Chrome through AppleScript on every command. Trusted-click/press/type temporarily front the exact target for browser-gated controls and fields that require real character events, then restore the user's focus. " +
      "Sequence runs up to 30 operations without repeated model round-trips, retaining the fast dedicated-session channel while pinning explicit non-session targets to stable tab IDs. " +
      "Use this before Cua for ordinary Chrome page work.",
    promptSnippet: "Fast DOM control in the persistent Pi Automation window of the user's authenticated Chrome; use before Cua",
    promptGuidelines: [
      "Use web_cli as the default for ordinary work in the user's live authenticated Chrome: navigation, page text, DOM discovery, links/buttons, clicks, forms, scrolling, JavaScript, and tab control.",
      "Use look_up instead when only the readable content of a known public URL is needed; it is lighter and does not launch or manipulate Chrome. Use browse for an isolated headless-browser workflow rather than the user's live Chrome.",
      "Do not use cua_driver/native Mac accessibility traversal for normal webpage content or DOM interactions. Cua is only a fallback for browser chrome, non-DOM visual content, or a web_cli failure that genuinely requires visual control; use sitegeist for difficult visual web flows.",
      "Omit tab to continue the persistent Pi Automation session across turns. This is a named second window in the user's existing Chrome process/profile, not a separate browser login or headless session.",
      "Use tab='active' only when the user explicitly asks to operate on their currently active Chrome tab. A tab:ID, index, URL, or title can target another tab directly in the background.",
      "Use action=session to inspect the remembered bot target and action=bind only when intentionally moving that persistent target. Never silently rebind to the user's active tab.",
      "Use action=sequence for multi-step live-Chrome work. The dedicated session retains its cached exact automation-window channel; explicit active/tab/URL/title targets are pinned to a stable Chrome tab ID. Access is serialized so parallel calls cannot race the same automation session.",
      "Use click/click-text and fill for normal fast DOM actions. Use type with a selector, value, and optional commit key when a custom or framework-controlled field displays the synthetic fill but does not update page state. Trusted actions briefly front the exact target and restore focus.",
      "Use wait as a readiness budget—it returns immediately when readyState is complete. Use sleep when a fixed delay is required for SPA transitions, animation, or delayed validation.",
      "web_cli fill first updates framework-controlled fields in the page's own JavaScript world while staying background-safe. Use run-main when page-owned JavaScript expandos or component state is essential; use type or Chrome DevTools through cua_driver only if a strict Content Security Policy blocks main-world injection.",
      "Call the needed web_cli action directly—never make a separate setup/auto call. Every action self-heals a stale target and opens Chrome only when necessary.",
      "For navigation, set readAfter='summary' or 'text' so one web_cli call launches/discovers Chrome, navigates, waits for readiness, and returns the page content needed for the task.",
      "Prefer summary or targeted find commands before full text when that yields enough context, and use one direct DOM action instead of sequences of pixel clicks.",
    ],
    parameters: Params,
    async execute(_id: string, params: Input, signal: AbortSignal | undefined, onUpdate: any, _ctx: ExtensionContext) {
      const binary = webBinary();

      if (params.action === "sequence") {
        if (!params.steps?.length) throw new Error("steps are required for web_cli sequence.");
        let pinnedTab = params.tab ?? "session";
        const usesDedicatedSession = ["session", "bot"].includes(pinnedTab);

        // Keep the dedicated session logical so every step uses its cached exact
        // native window through cua-driver. Explicit active/title/URL targets are
        // still resolved once to a stable Chrome tab ID so user tab changes cannot
        // redirect those runs.
        if (!usesDedicatedSession && !pinnedTab.startsWith("tab:")) {
          const resolved = await pi.exec(binary, ["resolve", pinnedTab], { signal, timeout: 8_000 });
          if (resolved.code !== 0) throw new Error(String(resolved.stderr || resolved.stdout || `Could not resolve Chrome target ${pinnedTab}`));
          try {
            const info = JSON.parse(String(resolved.stdout || "").trim());
            if (info?.target) pinnedTab = String(info.target);
          } catch {
            throw new Error(`web resolve returned invalid session data: ${String(resolved.stdout || "").slice(0, 500)}`);
          }
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
          const stepText = result.content?.map((item: any) => item.type === "text" ? item.text : "").filter(Boolean).join("\n") || `${step.action} completed`;
          outputs.push(`${index + 1}. ${step.action}\n${stepText}`);
          results.push({ action: step.action, isError: Boolean(result.isError), details: result.details });
          if (result.isError) {
            failed = true;
            if (params.stopOnError !== false) break;
          }
        }
        return {
          isError: failed,
          content: [{ type: "text" as const, text: compact(outputs.join("\n\n")) }],
          details: { action: "sequence", pinnedTab, requestedSteps: params.steps.length, completedSteps: results.length, results },
        };
      }

      const args = buildArgs(params);
      const timeout = params.timeoutMs ?? (["wait", "sleep"].includes(params.action) ? Math.max(10_000, (params.ms ?? 1000) + 10_000) : params.action === "run" ? 60_000 : 30_000);
      onUpdate?.({ content: [{ type: "text", text: `${binary} ${args.map((arg) => JSON.stringify(arg)).join(" ")}` }] });

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
      if (looksDisconnected(firstText)) {
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
      const text = compact([stdout, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n\n") || `web ${params.action} completed`);
      return {
        isError: response.code !== 0 || finalDisconnected || postActionError,
        content: [{ type: "text" as const, text }],
        details: { action: params.action, args, code: response.code, repairedTarget, stdout, stderr, followups },
      };
    },
  };
  pi.registerTool(webTool);
}
