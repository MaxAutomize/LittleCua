import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { jiti } from '../../extensions/cua-tool/tests/pi-loader.mjs';
import { diagnose } from '../doctor.mjs';
const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const tools = [], servers = [];
const pi = { registerTool: t => tools.push(t), registerCommand() {}, registerMcpServer: (...args) => servers.push(args), exec: async () => { throw Error('Package loading must not execute native work'); } };
for (const entry of manifest.pi.extensions) {
  const { default: extension } = await jiti.import(new URL(entry, root).pathname);
  extension(pi);
}
assert.deepEqual(tools.map(t => t.name), ['cua_driver', 'web_cli']);
assert.deepEqual(servers.map(s => s[0]), ['cua_native', 'web_native']);
assert.deepEqual(servers.map(s => s[1].args), [['mcp'], ['mcp']]);
for (const tool of tools) {
  assert.ok(tool.promptGuidelines.some(s => s.includes('REPAIR CONTRACT:')));
  assert.ok(tool.promptGuidelines.some(s => s.includes(root.pathname)), 'repair guidance uses actual package source');
  assert.ok(tool.promptGuidelines.every(s => !s.includes('~/.pi/agent/extensions/')), 'no developer-only repair location');
}

// The shared guard blocks exact unchanged failed writes, not read-only diagnosis.
const { withAutomationRepair } = await jiti.import(new URL('extensions/_shared/automation-repair.ts', root).pathname);
let calls = 0;
const guarded = withAutomationRepair({ execute: async () => { calls++; return { isError: true, content: [], details: { dispatchState: 'possibly-dispatched' } }; } }, 'installed implementation');
const first = await guarded.execute('1', { action: 'click', pid: 10 });
assert.equal(first.details.repairReviewRequired, true);
const retry = await guarded.execute('2', { action: 'click', pid: 10 });
assert.equal(retry.details.unchangedRetryBlocked, true); assert.equal(calls, 1);
await guarded.execute('3', { action: 'window_state', pid: 10 }); assert.equal(calls, 2);
await guarded.execute('4', { action: 'window_state', pid: 10 }); assert.equal(calls, 3);

// Read-only doctor failures are actionable and never install/start/update anything.
const invoked = [];
const fakeRead = (path, encoding) => {
  if (String(path).endsWith('package.json')) return '{"version":"1.0.1"}';
  if (String(path).endsWith('types.d.ts')) return 'registerMcpServer executeTool';
  return readFileSync(path, encoding);
};
const run = (bin, args) => {
  invoked.push([bin, ...args]);
  if (args[0] === 'root') return '/fake/global';
  if (args[0] === 'dump-docs') return JSON.stringify({ cli: { commands: [{ name: 'mcp' }] }, mcp: { tools: ['list_windows','get_window_state','click','screenshot','page','get_config','set_agent_cursor_enabled'].map(name => ({ name })) } });
  return 'test-version';
};
const report = diagnose({ platform: 'darwin', nodeVersion: '22.19.0', env: {}, exists: () => true, read: fakeRead, run });
assert.equal(report.ok, true);
assert.equal(diagnose({ platform: 'linux', nodeVersion: '18.0.0', env: {}, exists: () => false, read: fakeRead, run }).ok, false);
assert.equal(diagnose({ platform: 'darwin', nodeVersion: '22.19.0', env: {}, exists: () => true, read: p => String(p).endsWith('types.d.ts') ? 'old API' : fakeRead(p), run }).checks.find(c => c.name === 'Pi MCP API').ok, false);
assert.ok(invoked.every(([, ...args]) => !args.includes('serve') && !args.includes('mcp') && !args.includes('update')));

// Bundled compatibility shim honors an explicit driver path without a PATH symlink.
const dir = mkdtempSync(join(tmpdir(), 'littlecua-package-'));
try {
  const script = readFileSync(new URL('scripts/web', root), 'utf8');
  const library = join(dir, 'web-library.sh'), driver = join(dir, 'custom-driver');
  writeFileSync(library, script.slice(0, script.indexOf('# --- Main ---')));
  writeFileSync(driver, '#!/bin/sh\nprintf "custom:%s" "$1"\n', { mode: 0o700 });
  assert.equal(execFileSync('/bin/bash', ['-c', 'source "$1"; cua-driver --version', 'test', library], { env: { ...process.env, CUA_DRIVER_BIN: driver }, encoding: 'utf8' }), 'custom:--version');
  assert.ok(!existsSync(join(dir, 'web-library.sh.lock')));
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('PASS package closure, both MCP registrations, repair/no-replay guard, read-only prerequisite checks and custom driver resolution');
