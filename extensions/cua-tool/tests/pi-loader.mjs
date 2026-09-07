// Reuse the host Pi installation; no test dependencies are installed at runtime.
// Set PI_PACKAGE_DIR when Pi was not installed with global npm.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const root = process.env.PI_PACKAGE_DIR || join(
  execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(),
  '@earendil-works/pi-coding-agent',
);
if (!existsSync(join(root, 'package.json'))) {
  throw new Error('Pi installation not found. Install Pi globally or set PI_PACKAGE_DIR to its package directory.');
}
const require = createRequire(join(root, 'package.json'));
const { createJiti } = require('jiti');
export const jiti = createJiti(import.meta.url, { alias: {
  typebox: require.resolve('typebox'),
  '@earendil-works/pi-ai': join(root, 'node_modules/@earendil-works/pi-ai/dist/index.js'),
} });
