// Read-only, explicitly scoped live smoke/latency test. Never types or clicks.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { jiti } from './pi-loader.mjs';
const { default: extension } = await jiti.import('../index.ts');
const exec = promisify(execFile);
let tool;
extension({
  registerTool: t => tool = t,
  exec: async (bin, args, options = {}) => {
    try { return { ...await exec(bin, args, { timeout: options.timeout, signal: options.signal, maxBuffer: 8 * 1024 * 1024 }), code: 0 }; }
    catch (e) { return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message }; }
  },
});
const ctx = { model: { input: ['text', 'image'] } };
const call = args => tool.execute('live-test', args, undefined, undefined, ctx);
const listed = await call({ action: 'list_windows', appName: 'Calculator', onScreenOnly: true });
const windows = JSON.parse(listed.details.stdout).windows;
const target = windows.find(w => w.title === 'Calculator' && w.is_on_screen);
assert.ok(target, 'Open Calculator before running this scoped test');
const timings = [];
for (let i = 0; i < 3; i++) {
  let start = performance.now();
  const screenshot = await call({ action: 'screenshot', windowId: target.window_id });
  assert.equal(screenshot.content.at(-1).type, 'image');
  const directMs = performance.now() - start;
  start = performance.now();
  const batch = await call({ action: 'workflow', screenshotAfter: true, workflow: {
    action: 'sequence', pid: target.pid, windowId: target.window_id,
    steps: [{ action: 'inspect', query: 'Calculator' }],
  }});
  assert.equal(batch.content.at(-1).type, 'image');
  assert.equal(batch.details.target.windowId, target.window_id);
  timings.push({ directMs: Math.round(directMs), batchAndImageMs: Math.round(performance.now() - start), captureMs: Math.round(batch.details.captureMs), imageBytes: batch.details.imageBytes });
}
console.log(JSON.stringify({ passed: true, target: 'Calculator', readOnly: true, samples: timings }, null, 2));
