import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jiti } from './pi-loader.mjs';
const { withVisualResults } = await jiti.import('../visual-results.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const vision = { model: { input: ['text', 'image'] } };
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS', name); }
function setup({ produce = true, captureCode = 0 } = {}) {
  const calls = []; let lastPath;
  const base = { async execute(id, args) {
    calls.push(args);
    if (args.screenshotOutFile) { lastPath = args.screenshotOutFile; if (produce) writeFileSync(lastPath, png); }
    return { content: [{ type: 'text', text: 'OK' }], details: { target: { pid: 123, windowId: 456 } } };
  }};
  const pi = { async exec(bin, args) {
    calls.push(args); lastPath = args.at(-1);
    if (produce && captureCode === 0) writeFileSync(lastPath, png);
    return { code: captureCode, stdout: '', stderr: captureCode ? 'capture failed' : '' };
  }};
  const tool = withVisualResults(base, pi, 'cua-driver');
  return { tool, calls, path: () => lastPath };
}
const execute = (s, args, ctx = vision, signal) => s.tool.execute('test', args, signal, undefined, ctx);
const workflow = { action: 'sequence', app: 'Calculator', steps: [{ action: 'press_key', key: 'escape' }] };
await test('screenshot inline bytes and private file cleanup', async () => {
  const s = setup(); const r = await execute(s, { action: 'screenshot', windowId: 456 });
  assert.equal(r.content.at(-1).type, 'image'); assert.equal(r.content.at(-1).mimeType, 'image/png');
  assert.deepEqual(Buffer.from(r.content.at(-1).data, 'base64'), png);
  assert.equal(existsSync(s.path()), false); assert.equal(r.details.imageAttached, true);
});
await test('ordinary AX workflow has no capture overhead', async () => {
  const s = setup(); const r = await execute(s, { action: 'workflow', workflow });
  assert.equal(s.calls.length, 1); assert.equal(r.content.length, 1);
});
await test('batch plus image targets exact resolved window once', async () => {
  const s = setup(); const r = await execute(s, { action: 'workflow', workflow, screenshotAfter: true });
  assert.equal(s.calls.length, 2); assert.equal(JSON.parse(s.calls[1][2]).window_id, 456);
  assert.equal(r.content.at(-1).type, 'image'); assert.equal(existsSync(s.path()), false);
});
await test('capture failure does not replay successful actions', async () => {
  const s = setup({ captureCode: 1 }); const r = await execute(s, { action: 'workflow', workflow, screenshotAfter: true });
  assert.equal(s.calls.length, 2); assert.equal(r.details.visualCaptureFailed, true);
  assert.match(r.content.at(-1).text, /Do not replay/);
});
await test('reject unscoped capture and parallel before any side effects', async () => {
  const s = setup();
  await assert.rejects(execute(s, { action: 'workflow', workflow: { action: 'inspect' }, screenshotAfter: true }), /explicit/);
  await assert.rejects(execute(s, { action: 'workflow', workflow: { action: 'parallel' }, screenshotAfter: true }), /single-target/);
  assert.equal(s.calls.length, 0);
});
await test('explicit output retained; stale existing image never attached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cua-test-')); const path = join(dir, 'image.png');
  try {
    const s = setup(); await execute(s, { action: 'screenshot', windowId: 456, imageOut: path });
    assert.equal(existsSync(path), true);
    const stale = setup({ produce: false }); const r = await execute(stale, { action: 'screenshot', windowId: 456, imageOut: path });
    assert.equal(r.details.imageAttached, false); assert.equal(r.content.some(x => x.type === 'image'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await test('text-only model and returnImage=false discard implicit files', async () => {
  for (const [args, ctx] of [[{ returnImage: false }, vision], [{}, { model: { input: ['text'] } }]]) {
    const s = setup(); const r = await execute(s, { action: 'screenshot', windowId: 456, ...args }, ctx);
    assert.equal(r.details.imageAttached, false);
    assert.equal(existsSync(s.path()), false);
    assert.equal(r.details.temporaryImageRemoved, true);
  }
});
await test('cancellation before execution', async () => {
  const s = setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(execute(s, { action: 'screenshot', windowId: 456 }, vision, controller.signal));
  assert.equal(s.calls.length, 0);
});
await test('zoom returns native image', async () => {
  const s = setup(); const r = await execute(s, { action: 'zoom', pid: 123, x1: 0, y1: 0, x2: 50, y2: 50 });
  assert.equal(r.content.at(-1).type, 'image'); assert.match(r.content.at(-2).text, /fromZoom=true/);
});
await test('explicit no-inline capture retained', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cua-test-'));
  try {
    const path = join(dir, 'frame.png'); const s = setup();
    const r = await execute(s, {action:'screenshot', windowId:456, returnImage:false, imageOut:path});
    assert.equal(existsSync(path), true); assert.equal(r.details.imageAttached, false);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
await test('repeated captures do not retain a sequence of files', async () => {
  const s = setup();
  for (let i=0; i<20; i++) {
    const r = await execute(s, {action:'screenshot', windowId:456});
    assert.equal(existsSync(s.path()), false);
    assert.equal(r.content.filter(c=>c.type==='image').length, 1);
    assert.ok(r.details.captureRequestedAt); assert.ok(r.details.captureCompletedAt);
  }
});
console.log(`${count} tests passed`);
