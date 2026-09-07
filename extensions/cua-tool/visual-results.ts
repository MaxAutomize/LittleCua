import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const AFTER_ACTIONS = new Set(["inspect", "act", "sequence", "launch", "activate"]);

function signature(path: string): string | undefined {
  try { const s = statSync(path); return `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { return undefined; }
}

function readImage(path: string) {
  const size = statSync(path).size;
  if (!size || size > MAX_IMAGE_BYTES) throw new Error(`Image size ${size} bytes is outside the 1–${MAX_IMAGE_BYTES} byte limit.`);
  const bytes = readFileSync(path);
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new Error("Capture did not produce PNG or JPEG image bytes.");
  return {
    block: { type: "image" as const, data: bytes.toString("base64"), mimeType: png ? "image/png" : "image/jpeg" },
    bytes: bytes.length,
    dimensions: png ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : undefined,
  };
}

/** Preserve the existing executor; add opt-in batch observation and native image delivery. */
export function withVisualResults(tool: any, pi: any, bin: string) {
  return {
    ...tool,
    async execute(id: string, raw: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const after = raw.screenshotAfter === true;
      if (after && (raw.action !== "workflow" || !AFTER_ACTIONS.has(raw.workflow?.action))) {
        throw new Error("screenshotAfter requires a single-target workflow: inspect, act, sequence, launch, or activate. For a program, use a program step inside sequence.");
      }
      if (after && !(raw.workflow.app || raw.workflow.bundleId || raw.workflow.pid || raw.workflow.windowId)) {
        throw new Error("screenshotAfter requires an explicit workflow app, bundleId, pid, or windowId; no implicit desktop capture.");
      }
      const direct = raw.action === "screenshot" || raw.action === "zoom";
      const windowState = raw.action === "window_state" || raw.action === "get_window_state";
      if (!after && !direct && !windowState) return tool.execute(id, raw, signal, onUpdate, ctx);

      // File output is a CLI transport, not an always-on recording. Private temporary
      // images are deleted after inline delivery; explicit output paths are retained.
      const explicitPath = raw.screenshotOutFile ?? raw.imageOut;
      if (windowState && !explicitPath) return tool.execute(id, raw, signal, onUpdate, ctx);
      const dir = explicitPath ? undefined : mkdtempSync(join(tmpdir(), "pi-cua-visual-"));
      const path = explicitPath ?? join(dir!, raw.format === "jpeg" ? "frame.jpg" : "frame.png");
      const before = signature(path);
      let cleanup = !!dir;
      const started = performance.now();
      try {
        signal?.throwIfAborted();
        // Resolve an explicitly named screenshot app instead of accidentally taking
        // a full-screen capture. Exact pid/window resolution stays in the executor.
        let params = { ...raw };
        if (direct) params.screenshotOutFile = path;
        if (raw.action === "screenshot" && raw.appName && !raw.pid && !raw.windowId) {
          const found = await tool.execute(id, { action: "list_windows", appName: raw.appName, onScreenOnly: true }, signal, undefined, ctx);
          const windows = JSON.parse(found.details?.stdout ?? "{}").windows ?? [];
          const candidates = windows.filter((w: any) => w.is_on_screen && w.on_current_space !== false && w.bounds?.width > 1 && w.bounds?.height > 1);
          if (candidates.length !== 1) throw new Error(`Screenshot app matched ${candidates.length} windows; provide an exact windowId.`);
          params.windowId = candidates[0].window_id;
          params.pid = candidates[0].pid;
        }
        const result = await tool.execute(id, params, signal, onUpdate, ctx);
        if (result.isError) return result;
        if (after) {
          // Never re-resolve/fall back to a different window, and never replay the
          // action batch if its post-action capture fails.
          const target = result.details?.target;
          try {
            signal?.throwIfAborted();
            if (!Number.isFinite(target?.windowId)) throw new Error("Workflow returned no exact target window.");
            const captureStart = performance.now();
            const capture = await pi.exec(bin, ["call", "screenshot", JSON.stringify({ window_id: target.windowId, format: raw.format ?? "png", ...(raw.quality !== undefined ? { quality: raw.quality } : {}) }), "--compact", "--screenshot-out-file", path], { signal, timeout: raw.timeoutMs ?? raw.workflow.timeoutMs ?? 20_000 });
            if (capture.code !== 0) throw new Error((capture.stderr || capture.stdout || "Window capture failed").slice(0, 1000));
            result.details = { ...result.details, captureMs: performance.now() - captureStart };
          } catch (error) {
            signal?.throwIfAborted();
            return { ...result, content: [...result.content, { type: "text", text: `Actions completed, but post-action screenshot failed: ${String(error)}. Do not replay the batch; inspect the target if needed.` }], details: { ...result.details, visualCaptureFailed: true } };
          }
        }
        const fresh = signature(path);
        if (!fresh || fresh === before) {
          return { ...result, content: [...result.content, { type: "text", text: "No fresh image produced; no old image attached. AX-only window_state intentionally skips capture. Use action=screenshot for pixels." }], details: { ...result.details, imageAttached: false } };
        }
        const supportsImages = !ctx?.model || ctx.model.input?.includes("image");
        if (raw.returnImage === false || !supportsImages) {
          cleanup = false;
          return { ...result, content: [...result.content, { type: "text", text: `Fresh image saved: ${path}. Inline delivery disabled${!supportsImages ? " (model does not advertise vision)" : ""}.` }], details: { ...result.details, screenshotOutFile: path, imageAttached: false } };
        }
        let image;
        try { image = readImage(path); } catch (error) {
          return { ...result, content: [...result.content, { type: "text", text: `Image attachment unavailable: ${String(error)}. Do not repeat completed actions.` }], details: { ...result.details, imageAttached: false } };
        }
        const dims = image.dimensions;
        const note = `${after ? "Post-action window image" : "Fresh capture"}${dims ? `: ${dims.width}×${dims.height} pixels` : ""}. ${raw.action === "zoom" ? "Zoom coordinates require fromZoom=true." : "For window captures, use image pixels exactly; do not Retina-scale or add window origin."}${dir ? " Temporary capture file removed after attachment; image remains in the Pi conversation." : ` File retained: ${path}`}`;
        return { ...result, content: [...result.content, { type: "text", text: note }, image.block], details: { ...result.details, imageAttached: true, imageBytes: image.bytes, imageDimensions: dims, temporaryImageRemoved: !!dir, visualTotalMs: performance.now() - started } };
      } finally {
        if (cleanup && dir) rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
