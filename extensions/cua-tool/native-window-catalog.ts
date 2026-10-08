import { fileURLToPath } from 'node:url';
import { NativeDeadline } from './native-operation-coordinator.ts';

const SOURCE = fileURLToPath(new URL('./native-window-catalog.swift', import.meta.url));

export function mergeElevatedNativeWindows(base: any[], extra: any[], pid?: number): any[] {
  const merged = [...base];
  const seen = new Set(base.map(w => `${w.pid}:${w.window_id}`));
  for (const w of extra) {
    const b = w?.bounds;
    if (!Number.isInteger(w?.pid) || !Number.isInteger(w?.window_id) || w.pid <= 0 || w.window_id <= 0
        || (pid !== undefined && w.pid !== pid) || !(w.layer > 0) || !w.is_on_screen
        || typeof w.title !== 'string' || !w.title || !b
        || ![b.x,b.y,b.width,b.height].every(Number.isFinite) || b.width <= 1 || b.height <= 1) continue;
    const id = `${w.pid}:${w.window_id}`;
    if (!seen.has(id)) { merged.push(w); seen.add(id); }
  }
  return merged;
}

/** Only invoked on a definite catalog miss or explicit window discovery.
 * This is read-only native metadata, not CLI rollback after an MCP error.
 * The ordinary successful cached/regular-window route remains unchanged.
 */
export async function supplementElevatedNativeWindows(pi: any, base: any[], pid: number | undefined,
  signal: AbortSignal | undefined, deadline: NativeDeadline): Promise<any[]> {
  deadline.assert('native elevated panel discovery', signal);
  const result = await pi.exec('/usr/bin/swift', [SOURCE, ...(pid === undefined ? [] : [String(pid)])],
    {signal, timeout: deadline.remaining('native elevated panel discovery', 6000)});
  if (result.code !== 0) throw new Error(`Native panel metadata unavailable; no input dispatched: ${result.stderr || result.stdout}`);
  const extra = JSON.parse(result.stdout);
  if (!Array.isArray(extra)) throw new Error('Native panel catalog was not an array; no input dispatched');
  return mergeElevatedNativeWindows(base, extra, pid);
}
