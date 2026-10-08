#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, WEB_CLI_PATH: process.env.WEB_CLI_PATH || join(root, 'scripts/web') };
let count = 0;
for (const dir of ['extensions/cua-tool/tests', 'extensions/web-cli/tests', 'scripts/tests']) {
  for (const name of readdirSync(join(root, dir)).filter(n => n.endsWith('.test.mjs')).sort()) {
    const result = spawnSync(process.execPath, [join(root, dir, name)], { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
console.log(`PASS ${count} regression files (no desktop mutations or model calls)`);
