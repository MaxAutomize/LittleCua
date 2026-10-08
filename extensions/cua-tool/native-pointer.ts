import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeDeadline, nativeOperationCoordinator, targetOperationKeys } from "./native-operation-coordinator.ts";
import { supplementElevatedNativeWindows } from "./native-window-catalog.ts";

/** Driver 0.1.4 has no bounds-query or force-mouse-by-index API. Read AX geometry
 * through System Events, then use only the driver's documented pixel click.
 * No AXSelected writes, action guessing, or row-specific traversal. */
export const BOUNDS_SCRIPT = `
function run(argv) {
  const q = JSON.parse(argv[0]);
  const se = Application('System Events');
  const processes = se.processes.whose({unixId: q.pid})();
  if (processes.length !== 1) throw new Error('Native process no longer exists');
  function attr(e, key) { try { return e.attributes.byName(key).value(); } catch (_) { return null; } }
  const windows = processes[0].windows();
  const numbered = windows.filter(w => Number(attr(w, 'AXWindowNumber')) === q.windowId);
  // AXWindowNumber is absent in many native apps. Exact title is acceptable
  // only when unique, with independent geometry validation below.
  const matches = numbered.length ? numbered : windows.filter(w => attr(w, 'AXTitle') === q.title);
  if (matches.length !== 1) throw new Error('Cannot uniquely identify the exact AX window');
  const w = matches[0];
  const wp = w.position(), ws = w.size();
  // AX and WindowServer bounds can differ by a small decoration inset.
  if (Math.abs(wp[0]-q.bounds.x)>8 || Math.abs(wp[1]-q.bounds.y)>8 ||
      Math.abs(ws[0]-q.bounds.width)>16 || Math.abs(ws[1]-q.bounds.height)>16)
    throw new Error('AX window geometry does not match the requested WindowServer window');
  let visited = 0;
  const found = [];
  function walk(e, depth) {
    if (++visited > 2000 || depth > 40) throw new Error('AX bounds lookup exceeded its traversal limit');
    if (attr(e, 'AXRole') === q.role) {
      const same = q.identifier ? attr(e, 'AXIdentifier') === q.identifier :
        q.label ? ['AXTitle','AXValue','AXDescription'].some(k => attr(e,k) === q.label) : true;
      if (same) found.push(e);
    }
    let children = []; try { children = e.uiElements(); } catch (_) {}
    for (const child of children) walk(child, depth+1);
  }
  walk(w, 0);
  if (found.length !== 1) throw new Error('Native bounds target is ambiguous or missing ('+found.length+' matches); use a fresh screenshot and pixel_click');
  const e = found[0];
  if (attr(e, 'AXEnabled') === false) throw new Error('Native bounds target is disabled');
  const p = e.position(), s = e.size();
  return JSON.stringify({x:p[0], y:p[1], width:s[0], height:s[1]});
}`;

export function pointerIdentity(element: { role: string; line: string; label: string }) {
  // Identifiers may contain spaces. Stop only at the actions suffix.
  const identifier = element.line.match(/\bid=(.*?)(?:\s+actions=\[|$)/)?.[1]?.trim();
  const quoted = element.line.match(/\bAX\w+\s+(?:=\s*)?"([^"]*)"/);
  const described = element.line.match(/\bAX\w+\s+\((.*?)\)(?:\s|$)/);
  return { role: element.role, identifier, label: quoted?.[1] ?? described?.[1] ?? element.label };
}

export function pixelCenter(rect: any, window: any, image: { width: number; height: number }, anchor: 'center' | 'trailing' = 'center') {
  for (const n of [rect.x, rect.y, rect.width, rect.height, window.x, window.y, window.width, window.height, image.width, image.height]) {
    if (!Number.isFinite(n)) throw new Error('Native pointer geometry is not finite');
  }
  if (rect.width <= 0 || rect.height <= 0 || window.width <= 0 || window.height <= 0 || image.width <= 0 || image.height <= 0)
    throw new Error('Native pointer target has empty bounds');
  if (!['center', 'trailing'].includes(anchor)) throw new Error('Unsupported native click anchor');
  // Composite native controls may expose their label but not their trailing
  // dropdown arrow. An explicit edge anchor stays within freshly verified AX
  // bounds instead of guessing a screenshot coordinate or repeating AXShowMenu.
  const x = rect.x + (anchor === 'trailing' ? rect.width - Math.min(8, rect.width / 4) : rect.width / 2) - window.x;
  const y = rect.y + rect.height / 2 - window.y;
  if (x < 0 || y < 0 || x >= window.width || y >= window.height)
    throw new Error('Native pointer target center is outside the requested window');
  // These are AX screen POINTS, not model-provided PNG pixels. Only this bridge
  // converts points using the actual fresh image dimensions (never assume Retina).
  return { x: x * image.width / window.width, y: y * image.height / window.height };
}

/**
 * The public driver has pixel clicking but no bounds-by-index mouse API. Ground
 * every fallback against one exact visible window and one fresh frame. The
 * coordinator serializes only this process's same-window/pid mouse recipes; it
 * does not claim to coordinate external tools or detect human intervention.
 */
export async function clickNativeBounds(pi: any, bin: string, call: any, target: any, element: any,
  options: { count?: number; modifiers?: string[]; anchor?: 'center' | 'trailing' }, signal?: AbortSignal, deadline: NativeDeadline | number = new NativeDeadline(15000)) {
  const budget = typeof deadline === "number" ? new NativeDeadline(deadline) : deadline;
  return nativeOperationCoordinator.runExclusive(
    targetOperationKeys(target, true), budget, signal, "native mouse grounding",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pi-cua-pointer-'));
      const path = join(dir, 'frame.png');
      try {
        budget.assert("native mouse grounding", signal);
        const listed = await call('list_windows', { pid: target.pid, on_screen_only: true }, signal, budget.remaining("native mouse window lookup"));
        let catalog = listed.data?.windows ?? [];
        if (!catalog.some((w: any) => w.window_id === target.windowId))
          catalog = await supplementElevatedNativeWindows(pi, catalog, target.pid, signal, budget);
        const w = catalog.find((w: any) => w.window_id === target.windowId);
        if (!w || w.on_current_space === false || !w.is_on_screen || !w.bounds)
          throw new Error('Native mouse fallback requires the exact visible window on the current Space');
        const query = { pid: target.pid, windowId: target.windowId, title: w.title, bounds: w.bounds, ...pointerIdentity(element) };
        const located = await pi.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', BOUNDS_SCRIPT, JSON.stringify(query)], {
          signal, timeout: budget.remaining("native bounds lookup", 8_000),
        });
        if (located.code !== 0) throw new Error(`Native bounds lookup failed: ${(located.stderr || located.stdout).slice(0, 1000)}`);
        const rect = JSON.parse(located.stdout);
        // Establish the driver's exact pid/window coordinate context. The caller
        // discards its previous AX observation after this mouse route.
        await call('get_window_state', { pid: target.pid, window_id: target.windowId }, signal, budget.remaining("native mouse AX grounding"));
        budget.assert("native mouse grounding capture", signal);
        const capture = await pi.exec(bin, ['call', 'screenshot', JSON.stringify({window_id:target.windowId, format:'png'}), '--compact', '--screenshot-out-file', path], {
          signal, timeout: budget.remaining("native mouse grounding capture", 20_000),
        });
        if (capture.code !== 0) throw new Error('Native mouse grounding capture failed');
        const size = statSync(path).size;
        if (size < 24 || size > 8*1024*1024) throw new Error('Native mouse grounding image exceeds bounds');
        const bytes = readFileSync(path);
        if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Native mouse grounding image is not PNG');
        const point = pixelCenter(rect, w.bounds, {width:bytes.readUInt32BE(16), height:bytes.readUInt32BE(20)}, options.anchor);
        const latest = await call('list_windows', {pid:target.pid, on_screen_only:true}, signal, budget.remaining("native mouse move check"));
        let currentCatalog = latest.data?.windows ?? [];
        if (!currentCatalog.some((w: any) => w.window_id === target.windowId))
          currentCatalog = await supplementElevatedNativeWindows(pi, currentCatalog, target.pid, signal, budget);
        const current = currentCatalog.find((v: any) => v.window_id === target.windowId);
        // WindowServer can report a 1–2 point decoration correction immediately
        // after a native window is first realized. Larger movement is unsafe because
        // the fresh frame was grounded against the earlier bounds.
        const boundsDrift = ['x','y','width','height'].some(k => Math.abs(Number(current?.bounds?.[k]) - Number(w.bounds[k])) > 3);
        if (!current?.is_on_screen || current.on_current_space === false || boundsDrift)
          throw new Error(`Native window moved during mouse grounding; no click dispatched (before=${JSON.stringify(w.bounds)} after=${JSON.stringify(current?.bounds)})`);
        budget.assert("native mouse dispatch", signal);
        await call('click', {pid:target.pid, window_id:target.windowId, ...point, count:options.count ?? 1, modifier:options.modifiers}, signal, budget.remaining("native mouse dispatch"));
        return 'mouse (AX bounds + fresh window frame)';
      } finally {
        rmSync(dir, {recursive:true, force:true});
      }
    },
  );
}
