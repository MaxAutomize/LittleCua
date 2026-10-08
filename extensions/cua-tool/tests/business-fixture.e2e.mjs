// Developer-informed deterministic business-fixture regression. It uses the
// fixture oracle only for expected values and is NOT a blind workflow-understanding trial.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jiti } from './pi-loader.mjs';

const execFile = promisify(execFileCallback);
const { default: extension } = await jiti.import('../index.ts');
const temp = mkdtempSync(join(tmpdir(), 'littlecua-business-regression-'));
const binary = join(temp, 'business-fixture');
let processHandle;
let tool;
const calls = [];
const shell = async (bin, args, options = {}) => {
  try { const result = await execFile(bin, args, { timeout: options.timeout ?? 30000, maxBuffer: 8 * 1024 * 1024, signal: options.signal }); return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }; }
  catch (error) { return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? '' }; }
};
extension({ registerTool: definition => { tool = definition; }, exec: async (bin, args, options) => { const result = await shell(bin, args, options); calls.push({ bin, args, result }); return result; } });
const call = (args, signal) => tool.execute('business-regression', args, signal, undefined, { model: { input: ['text'] } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function windows() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await shell('cua-driver', ['call', 'list_windows', '{"on_screen_only":true}', '--compact']);
    if (result.code === 0) {
      const found = JSON.parse(result.stdout).windows.filter(w => w.title?.startsWith('Task Review ·') && w.is_on_screen && w.on_current_space !== false);
      if (found.length) return found[0];
    }
    await sleep(100);
  }
  throw new Error('Business fixture window did not appear');
}
async function state(path) { return JSON.parse(readFileSync(path, 'utf8')); }
async function workflow(target, steps) {
  const result = await call({ action: 'workflow', workflow: { action: 'sequence', app: 'business-fixture', windowTitle: target.title, pid: target.pid, windowId: target.window_id, timeoutMs: 10000, responseMode: 'detailed', steps } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return result;
}
async function stop() {
  if (!processHandle) return;
  processHandle.kill('SIGTERM');
  await Promise.race([new Promise(resolve => processHandle.once('exit', resolve)), sleep(3000)]);
  if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  processHandle = undefined;
}
async function runVariation(number) {
  const oraclePath = join(temp, `variation-${number}.json`);
  processHandle = (await import('node:child_process')).spawn(binary, ['--variation', String(number), '--oracle-path', oraclePath], { stdio: 'ignore' });
  const target = await windows();
  const before = await state(oraclePath);
  const expected = before.expected;
  const click = async (query, within, role = 'Button') => workflow(target, [{ action: 'click', query, within, role, clickMode: 'ax' }]);
  await workflow(target, [{ action: 'raw_call', tool: 'scroll', payload: { direction: 'down', amount: 2, by: 'page' } }, { action: 'raw_call', tool: 'scroll', payload: { direction: 'up', amount: 1, by: 'page' } }]);
  await click('Review', before.targetRecord, 'Button');
  await click('Continue', 'Review confirmation modal', 'Button');
  await click('Edit', 'Delivery details', 'Button');
  for (const [key, value] of Object.entries(expected.delivery)) {
    if (key === 'dockCode') continue;
    const label = key === 'recipient' ? 'Recipient' : key === 'street' ? 'Street' : key === 'city' ? 'City' : key === 'region' ? 'Region' : key === 'postal' ? 'Postal code' : key === 'contact' ? 'Contact' : 'Instructions';
    await workflow(target, [{ action: 'set_value', query: `Delivery ${label}`, role: 'TextField', value }]);
  }
  if (number !== 2) {
    await click('Dock appointment required', undefined, 'CheckBox');
    await workflow(target, [{ action: 'set_value', query: 'Dock appointment code', role: 'TextField', value: expected.delivery.dockCode }]);
  }
  await click(expected.shipping, 'Shipping option selection', 'RadioButton');
  await click('Review', 'Shipping option selection', 'Button');
  await click('Delivery details reviewed', undefined, 'CheckBox');
  await click('Continue', 'Delivery actions', 'Button');
  for (const [item, quantity] of Object.entries(expected.quantities)) await workflow(target, [{ action: 'set_value', query: `Quantity ${item}`, role: 'TextField', value: String(quantity) }]);
  await click('Review', 'Quantity verification actions', 'Button');
  await workflow(target, [{ action: 'set_value', query: `Quantity ${Object.keys(expected.quantities).sort()[0]}`, role: 'TextField', value: '0' }]);
  await workflow(target, [{ action: 'set_value', query: `Quantity ${Object.keys(expected.quantities).sort()[0]}`, role: 'TextField', value: String(expected.quantities[Object.keys(expected.quantities).sort()[0]]) }]);
  await click('Review', 'Quantity verification actions', 'Button');
  await click('Continue', 'Quantity verification actions', 'Button');
  await click('Review', 'Local draft save', 'Button');
  await click('Save', 'Local draft save', 'Button');
  await sleep(100);
  const finalOracle = await state(oraclePath);
  const grade = await shell(process.execPath, [join(process.cwd(), 'extensions/cua-tool/tests/business-grade.mjs'), oraclePath], { timeout: 30000 });
  assert.equal(grade.code, 0, grade.stdout + grade.stderr);
  await stop();
  return { number, title: target.title, eventCount: finalOracle.events.length, grade: JSON.parse(grade.stdout) };
}
try {
  const compile = await shell('xcrun', ['swiftc', join(process.cwd(), 'extensions/cua-tool/tests/business-fixture.swift'), '-o', binary], { timeout: 120000 });
  assert.equal(compile.code, 0, compile.stderr);
  const results = [];
  for (const variation of [1, 2, 3]) results.push(await runVariation(variation));
  console.log(JSON.stringify({ mode: 'developer-informed', passed: true, variations: results }, null, 2));
} finally {
  await stop();
  rmSync(temp, { recursive: true, force: true });
}
