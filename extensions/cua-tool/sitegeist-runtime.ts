import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const BIN = "cua-driver";
const WEB_BIN = "/Users/maxrippley/.local/bin/web";
const execFileAsync = promisify(execFile);
const TARGET_TTL_MS = 60_000;

let daemonReady = false;
let cachedChrome: { pid: number; windowId: number; sessionWindowId: number; at: number } | undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDaemon(): Promise<void> {
  if (daemonReady) return;
  try {
    const { stdout } = await execFileAsync(BIN, ["status"], { timeout: 3_000, encoding: "utf8" });
    if (stdout.includes("daemon is running")) {
      daemonReady = true;
      return;
    }
  } catch {
    // Start below.
  }

  const child = spawn(BIN, ["serve"], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(150);
    try {
      const { stdout } = await execFileAsync(BIN, ["status"], { timeout: 2_000, encoding: "utf8" });
      if (stdout.includes("daemon is running")) {
        daemonReady = true;
        return;
      }
    } catch {
      // Continue probing.
    }
  }
  throw new Error("Could not start the CuaDriver daemon.");
}

async function query(tool: string, payload: Record<string, unknown>, timeout = 20_000): Promise<any> {
  const { stdout } = await execFileAsync(BIN, ["call", tool, JSON.stringify(payload), "--compact"], {
    timeout,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`${tool} returned invalid JSON: ${stdout.slice(0, 1_000)}`);
  }
}

async function act(tool: string, payload: Record<string, unknown>, timeout = 15_000): Promise<void> {
  try {
    await execFileAsync(BIN, ["call", tool, JSON.stringify(payload), "--compact"], {
      timeout,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error: any) {
    const message = `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`;
    if (/No cached AX state|Start the daemon|socket|connection refused/i.test(message)) {
      daemonReady = false;
      await ensureDaemon();
      await execFileAsync(BIN, ["call", tool, JSON.stringify(payload), "--compact"], {
        timeout,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
      });
      return;
    }
    throw error;
  }
}

type ChromeSession = { windowId: number; tabId: number; target: string; bounds: string; title: string; url: string };

async function getChromeSession(): Promise<ChromeSession> {
  const { stdout } = await execFileAsync(WEB_BIN, ["session"], { timeout: 12_000, encoding: "utf8" });
  const session = JSON.parse(stdout.trim());
  if (!session?.windowId || !session?.tabId) throw new Error(`Invalid Pi Automation Chrome session: ${stdout.slice(0, 500)}`);
  return session as ChromeSession;
}

function chooseChromeWindow(windows: any[], session: ChromeSession): any | undefined {
  const candidates = windows.filter((window: any) =>
    (window.app_name === "Google Chrome" || window.app_name === "Chrome") &&
    window.pid && window.window_id &&
    (window.bounds?.width ?? 0) > 200 && (window.bounds?.height ?? 0) > 150);
  const [x, y, width, height] = String(session.bounds || "").split(",").map(Number);

  // Chrome's named-window title is the strongest identity. Bounds provide a
  // stable bridge from AppleScript's window ID to Cua's separate CGWindowID.
  return candidates.find((window: any) => window.title === "Pi Automation") ??
    candidates.find((window: any) =>
      window.bounds?.x === x && window.bounds?.y === y &&
      window.bounds?.width === width && window.bounds?.height === height);
}

async function findChromeWindow(session: ChromeSession): Promise<any | undefined> {
  const data = await query("list_windows", { on_screen_only: false }, 8_000);
  return chooseChromeWindow(Array.isArray(data?.windows) ? data.windows : [], session);
}

async function waitForChromeWindow(session: ChromeSession): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const chrome = await findChromeWindow(session);
    if (chrome) return chrome;
    await sleep(100);
  }
  throw new Error("The named Pi Automation Chrome window exists, but CuaDriver could not resolve it.");
}

async function resolveChrome(force = false): Promise<{ pid: number; windowId: number; launchedChrome: boolean }> {
  const session = await getChromeSession();
  if (!force && cachedChrome && cachedChrome.sessionWindowId === session.windowId && Date.now() - cachedChrome.at < TARGET_TTL_MS) {
    return { pid: cachedChrome.pid, windowId: cachedChrome.windowId, launchedChrome: false };
  }

  const chrome = await findChromeWindow(session) ?? await waitForChromeWindow(session);
  cachedChrome = { pid: chrome.pid, windowId: chrome.window_id, sessionWindowId: session.windowId, at: Date.now() };
  return { pid: chrome.pid, windowId: chrome.window_id, launchedChrome: false };
}

function findElement(markdown: string, ...predicates: Array<(line: string) => boolean>): number | null {
  for (const line of markdown.split("\n")) {
    if (!predicates.every((predicate) => predicate(line))) continue;
    const match = line.match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  }
  return null;
}

function findTextArea(markdown: string): number | null {
  let insideSitegeist = false;
  for (const line of markdown.split("\n")) {
    if (line.includes("pi-ai") && line.includes("WebArea")) {
      insideSitegeist = true;
      continue;
    }
    if (insideSitegeist && line.includes("WebArea") && !line.includes("pi-ai")) break;
    if (insideSitegeist && line.includes("TextArea")) {
      const match = line.match(/\[(\d+)\]/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

async function sendAgainstTarget(command: string, pid: number, windowId: number): Promise<void> {
  const state = async (filter: string) => query("get_window_state", { pid, window_id: windowId, query: filter }, 30_000);
  const poll = async (filter: string, finder: (markdown: string) => number | null, timeoutMs: number): Promise<number | null> => {
    const deadline = Date.now() + timeoutMs;
    do {
      const snapshot = await state(filter);
      const found = finder(snapshot?.tree_markdown ?? "");
      if (found !== null) return found;
      await sleep(120);
    } while (Date.now() < deadline);
    return null;
  };

  let snapshot = await state("TextArea");
  let textArea = findTextArea(snapshot?.tree_markdown ?? "");

  if (textArea === null) {
    snapshot = await state("side panel");
    const sidePanel = findElement(snapshot?.tree_markdown ?? "",
      (line) => /side panel/i.test(line),
      (line) => /PopUpButton|Button/.test(line));
    if (sidePanel !== null) {
      await act("click", { pid, window_id: windowId, element_index: sidePanel });
      textArea = await poll("TextArea", findTextArea, 3_000);
    }
  }

  if (textArea === null) {
    snapshot = await state("Extensions");
    const extensions = findElement(snapshot?.tree_markdown ?? "",
      (line) => /extensions/i.test(line),
      (line) => /PopUpButton|Button/.test(line));
    if (extensions !== null) {
      await act("click", { pid, window_id: windowId, element_index: extensions });
      const sitegeistMenu = await poll("sitegeist", (markdown) => findElement(markdown,
        (line) => /sitegeist/i.test(line),
        (line) => /Button|MenuItem/.test(line),
        (line) => !/unpin|remove/i.test(line)), 1_500);
      if (sitegeistMenu !== null) {
        await act("click", { pid, window_id: windowId, element_index: sitegeistMenu });
        textArea = await poll("TextArea", findTextArea, 3_000);
      }
    }
  }

  if (textArea === null) throw new Error("Could not find the Sitegeist input in Chrome's side panel.");

  await act("click", { pid, window_id: windowId, element_index: textArea });
  await sleep(30);
  await act("hotkey", { pid, keys: ["cmd", "a"] });
  await sleep(20);
  await act("type_text", { pid, window_id: windowId, element_index: textArea, text: command });
  await sleep(40);
  await act("press_key", { pid, key: "return" });
}

export async function sendSitegeistTask(command: string): Promise<{ pid: number; windowId: number; launchedChrome: boolean; elapsedMs: number }> {
  const started = performance.now();
  await ensureDaemon();
  let target = await resolveChrome();
  try {
    await sendAgainstTarget(command, target.pid, target.windowId);
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (!/window|pid|cached|AX state|current Space/i.test(message)) throw error;
    cachedChrome = undefined;
    target = await resolveChrome(true);
    await sendAgainstTarget(command, target.pid, target.windowId);
  }
  return { ...target, elapsedMs: performance.now() - started };
}
