#!/usr/bin/env node
// Read-only prerequisite checks: no desktop actions, MCP startup, installs or updates.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function diagnose({ env = process.env, platform = process.platform, nodeVersion = process.versions.node, run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', timeout: 10000, env }), exists = existsSync, read = readFileSync } = {}) {
  const checks = [];
  const check = (name, fn) => {
    try { checks.push({ name, ok: true, detail: String(fn()) }); }
    catch (e) { checks.push({ name, ok: false, detail: String(e.message || e) }); }
  };
  check('macOS', () => { if (platform !== 'darwin') throw Error('Native runtime requires macOS.'); return platform; });
  check('Node', () => {
    const [major, minor] = nodeVersion.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw Error('Install Node >=22.19.0 for current Pi.');
    return nodeVersion;
  });
  check('Pi MCP API', () => {
    const root = env.PI_PACKAGE_DIR || join(run('npm', ['root', '-g']).trim(), '@earendil-works/pi-coding-agent');
    const pkg = JSON.parse(read(join(root, 'package.json'), 'utf8'));
    const types = read(join(root, 'dist/core/extensions/types.d.ts'), 'utf8');
    if (!types.includes('registerMcpServer') || !types.includes('executeTool')) throw Error('Upgrade Pi: registerMcpServer and ctx.executeTool are required.');
    return `Pi ${pkg.version}; ${root} (session must also enable built-in MCP)`;
  });
  const driver = env.CUA_DRIVER_BIN || (exists('/Applications/CuaDriver.app/Contents/MacOS/cua-driver') ? '/Applications/CuaDriver.app/Contents/MacOS/cua-driver' : 'cua-driver');
  check('CuaDriver MCP/schema', () => {
    const version = run(driver, ['--version']).trim();
    const docs = JSON.parse(run(driver, ['dump-docs']));
    const commands = docs.cli?.commands || [];
    const tools = docs.mcp?.tools || [];
    if (!commands.some(c => c.name === 'mcp')) throw Error('Driver must provide the mcp stdio command.');
    for (const name of ['list_windows', 'get_window_state', 'click', 'screenshot', 'page', 'get_config', 'set_agent_cursor_enabled']) {
      if (!tools.some(t => t.name === name)) throw Error(`Missing driver tool ${name}; inspect driver compatibility before upgrading.`);
    }
    return `${driver} ${version}; metadata only, permissions/connection not exercised`;
  });
  check('Google Chrome', () => {
    if (!exists('/Applications/Google Chrome.app')) throw Error('Install Google Chrome in /Applications.');
    return 'Present; sign in yourself and enable View > Developer > Allow JavaScript from Apple Events.';
  });
  check('Python 3', () => run('python3', ['--version']).trim());
  check('Swift / Command Line Tools', () => run('xcrun', ['--find', 'swift']).trim());
  check('AppleScript', () => { if (!exists('/usr/bin/osascript')) throw Error('osascript missing'); return '/usr/bin/osascript'; });
  check('Bundled web DOM integrity', () => {
    const source = fileURLToPath(new URL('./web', import.meta.url));
    const bundle = JSON.parse(read(new URL('../extensions/web-cli/dom-templates.json', import.meta.url), 'utf8'));
    if (createHash('sha256').update(read(source)).digest('hex') !== bundle.sourceSha256) throw Error('Run npm run generate:dom, test and reload.');
    return 'Source SHA-256 matches generated MCP templates.';
  });
  return { ok: checks.every(c => c.ok), checks, note: 'Prerequisite check only. Use /mcp in Pi for cua_native/web_native, then a read-only exact-window workflow to verify access. macOS TCC, app behavior and end-to-end workflow success are not certified here.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = diagnose();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const c of report.checks) console.log(`${c.ok ? 'OK' : 'MISSING'} ${c.name}: ${c.detail}`);
    console.log(report.note);
  }
  process.exitCode = report.ok ? 0 : 1;
}
