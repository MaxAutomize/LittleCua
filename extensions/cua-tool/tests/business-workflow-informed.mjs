// UI-only semantic workflow trial. This intentionally does not read fixture
// source or oracle data while choosing controls/values: all decisions come from
// current AX observations. It is developer-informed, not blind model-agent data.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { jiti } from './pi-loader.mjs';

const execFile = promisify(execFileCallback);
const { default: extension } = await jiti.import('../index.ts');
const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'littlecua-business-informed-'));
const binary = join(temp, 'business-fixture');
const reportDir = join(homedir(), 'Library', 'Application Support', 'LittleCua', 'reports');
const reportPath = join(reportDir, `business-informed-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let processHandle;
let tool;
let calls = 0;
const runStats = [];
const shell = async (bin, args, options = {}) => {
  try { const result = await execFile(bin, args, { timeout: options.timeout ?? 30000, maxBuffer: 12 * 1024 * 1024, signal: options.signal }); return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }; }
  catch (error) { return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? '' }; }
};
extension({ registerTool: definition => { tool = definition; }, exec: shell });
const call = (args, signal) => { calls++; return tool.execute(`business-informed-${calls}`, args, signal, undefined, { model: { input: ['text'] } }); };
async function targetWindow() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await shell('cua-driver', ['call', 'list_windows', '{"on_screen_only":true}', '--compact']);
    if (result.code === 0) {
      const found = JSON.parse(result.stdout).windows.filter(w => w.title?.startsWith('Task Review ·') && w.is_on_screen && w.on_current_space !== false);
      if (found.length) return found[0];
    }
    await sleep(100);
  }
  throw new Error('Business workflow fixture window did not appear');
}
async function readAX(target) {
  const result = await call({ action: 'window_state', pid: target.pid, windowId: target.window_id, timeoutMs: 10000 });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.details.stdout);
}
function wf(target, steps, extra = {}) {
  return call({ action: 'workflow', workflow: { action: 'sequence', app: 'business-fixture', windowTitle: target.title, pid: target.pid, windowId: target.window_id, timeoutMs: 15000, responseMode: 'detailed', steps, ...extra } });
}
function groupBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)- AXGroup \((.*)\)$/);
    if (!match) continue;
    const indent = match[1].length;
    const block = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const childIndent = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (lines[j].trim() && childIndent <= indent) break;
      block.push(lines[j]);
    }
    blocks.push({ heading: match[2], text: block.join('\n') });
  }
  return blocks;
}
function findTask(markdown) {
  const lines = markdown.split('\n');
  const line = lines.filter(value => value.includes('CURRENT TASK:') || value.includes('Project:') || value.includes('Requester:')).join(' ');
  const project = markdown.match(/Project: "([^"]+)"/)?.[1];
  const requester = markdown.match(/Requester: "([^"]+)"/)?.[1];
  assert.ok(project && requester, `Could not derive project/requester from visible task: ${line}`);
  return { line, project, requester };
}
function findTargetRecord(markdown, task) {
  const candidates = groupBlocks(markdown).filter(block =>
    /Approved/.test(block.heading) && /Equipment request/.test(block.heading) &&
    block.text.includes(`Project: ${task.project}"`) && block.text.includes(`Requester: ${task.requester}"`) &&
    block.text.includes('Direction: Inbound') && !/Previous cycle/.test(block.heading)
  );
  assert.equal(candidates.length, 1, `Visible record context was not unique: ${candidates.map(c => c.heading).join(' | ')}`);
  return candidates[0].heading.split(' · ')[0];
}
function parseDelivery(markdown) {
  const lines = markdown.split('\n');
  const first = lines.find(line => line.includes('Requested recipient=')) ?? '';
  const second = lines.find(line => line.includes('Requested region=')) ?? '';
  const third = lines.find(line => line.includes('Requested instructions=')) ?? '';
  const firstMatch = first.match(/recipient=(.*?) · street=(.*?) · city=(.*)$/);
  const secondMatch = second.match(/region=(.*?) · postal=(.*?) · contact=(.*)$/);
  const thirdMatch = third.match(/instructions=(.*?) · dock code=(.*)$/);
  const clean = value => value?.trim().replace(/^"|"$/g, '');
  const values = {
    recipient: clean(firstMatch?.[1]), street: clean(firstMatch?.[2]), city: clean(firstMatch?.[3]),
    region: clean(secondMatch?.[1]), postal: clean(secondMatch?.[2]), contact: clean(secondMatch?.[3]),
    instructions: clean(thirdMatch?.[1]), dockCode: clean(thirdMatch?.[2]),
  };
  for (const [key, value] of Object.entries(values)) assert.ok(value, `Visible delivery reference omitted ${key}: ${first} ${second} ${third}`);
  return values;
}
function parseShipping(markdown) {
  const options = markdown.split('\n').filter(line => line.includes('AXRadioButton')).map(line => {
    const label = line.match(/AXRadioButton "([^"]+)"/)?.[1] ?? '';
    const price = Number(label.match(/\$(\d+)/)?.[1] ?? Infinity);
    return { label, price, eligible: /eligible/i.test(label) && !/not eligible|restricted|misses|exceeds/i.test(label) };
  }).filter(option => option.label);
  assert.ok(options.length >= 3, 'Expected visible shipping options');
  const eligible = options.filter(option => option.eligible).sort((a, b) => a.price - b.price);
  assert.ok(eligible.length, `No eligible shipping option parsed from AX: ${JSON.stringify(options)}`);
  return { options, chosen: eligible[0].label.split(' · ')[0] };
}
function parseQuantities(markdown) {
  const quantities = {};
  for (const line of markdown.split('\n')) {
    const match = line.match(/Reference note: (.+) requires (\d+) unit/);
    if (match) quantities[match[1].trim()] = match[2];
  }
  assert.equal(Object.keys(quantities).length, 8, 'Expected eight visible reference quantities');
  return quantities;
}
async function stopFixture() {
  if (!processHandle) return;
  processHandle.kill('SIGTERM');
  await Promise.race([new Promise(resolve => processHandle.once('exit', resolve)), sleep(3000)]);
  if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  processHandle = undefined;
}
async function runVariation(variation) {
  const oraclePath = join(temp, `oracle-${variation}.json`);
  processHandle = spawn(binary, ['--variation', String(variation), '--oracle-path', oraclePath], { stdio: 'ignore' });
  const target = await targetWindow();
  const stats = { variation, target: target.title, startedAt: Date.now(), workflowCallsBefore: calls, ambiguousRejected: false, derived: {} };
  try {
    let ax = await readAX(target);
    const task = findTask(ax.tree_markdown);
    const targetID = findTargetRecord(ax.tree_markdown, task);
    stats.derived = { project: task.project, requester: task.requester, targetID };
    // Genuine ambiguity probe: no context is supplied and no Review dispatch is allowed.
    const ambiguous = await wf(target, [{ action: 'click', query: 'Review', role: 'Button' }]);
    assert.equal(ambiguous.isError, true, `ambiguous Review unexpectedly succeeded: ${ambiguous.content?.[0]?.text}`);
    assert.match(ambiguous.content?.[0]?.text ?? '', /Ambiguous AX selector|Native workflow failed/i);
    stats.ambiguousRejected = true;
    await wf(target, [{ action: 'scroll', role: 'ScrollArea', direction: 'down', amount: 2, by: 'page' }, { action: 'scroll', role: 'ScrollArea', direction: 'up', amount: 1, by: 'page' }]);
    await wf(target, [{ action: 'click', query: 'Review', role: 'Button', within: targetID }]);
    await wf(target, [{ action: 'click', query: 'Continue', role: 'Button', within: 'Review confirmation modal' }]);
    await wf(target, [{ action: 'click', query: 'Edit', role: 'Button', within: 'Delivery details' }]);
    ax = await readAX(target);
    const delivery = parseDelivery(ax.tree_markdown);
    stats.derived.delivery = delivery;
    const labels = { recipient: 'Recipient', street: 'Street', city: 'City', region: 'Region', postal: 'Postal code', contact: 'Contact', instructions: 'Instructions' };
    for (const [key, value] of Object.entries(delivery)) {
      if (key === 'dockCode') continue;
      await wf(target, [{ action: 'set_value', query: `Delivery ${labels[key]}`, role: 'TextField', value }]);
    }
    ax = await readAX(target);
    const constraintText = ax.tree_markdown;
    if (/Dock appointment required/.test(constraintText)) {
      await wf(target, [{ action: 'click', query: 'Dock appointment required', role: 'CheckBox' }]);
      await wf(target, [{ action: 'set_value', query: 'Dock appointment code', role: 'TextField', value: delivery.dockCode }]);
    }
    const shipping = parseShipping(constraintText);
    stats.derived.shipping = shipping;
    await wf(target, [{ action: 'click', query: shipping.chosen, role: 'RadioButton', within: 'Shipping option selection' }]);
    await wf(target, [{ action: 'click', query: 'Review', role: 'Button', within: 'Shipping option selection' }]);
    await wf(target, [{ action: 'click', query: 'Delivery details reviewed', role: 'CheckBox' }]);
    await wf(target, [{ action: 'click', query: 'Continue', role: 'Button', within: 'Delivery actions' }]);
    ax = await readAX(target);
    const quantities = parseQuantities(ax.tree_markdown);
    stats.derived.quantities = quantities;
    for (const [item, quantity] of Object.entries(quantities)) await wf(target, [{ action: 'set_value', query: `Quantity ${item}`, role: 'TextField', value: quantity }]);
    await wf(target, [{ action: 'click', query: 'Review', role: 'Button', within: 'Quantity verification actions' }]);
    ax = await readAX(target);
    if (!/Validation error/i.test(ax.tree_markdown)) console.error('AX AFTER FIRST REVIEW\\n' + ax.tree_markdown);
    assert.match(ax.tree_markdown, /Validation error/i, 'first quantity review must expose visible validation error');
    // The fixture changes one visible row after the error; re-enter all displayed references.
    const corrected = parseQuantities(ax.tree_markdown);
    for (const [item, quantity] of Object.entries(corrected)) await wf(target, [{ action: 'set_value', query: `Quantity ${item}`, role: 'TextField', value: quantity }]);
    await wf(target, [{ action: 'click', query: 'Review', role: 'Button', within: 'Quantity verification actions' }]);
    await wf(target, [{ action: 'click', query: 'Continue', role: 'Button', within: 'Quantity verification actions' }]);
    await wf(target, [{ action: 'click', query: 'Review', role: 'Button', within: 'Local draft save' }]);
    await wf(target, [{ action: 'click', query: 'Save', role: 'Button', within: 'Local draft save' }]);
    ax = await readAX(target);
    assert.match(ax.tree_markdown, /Draft saved locally/i);
    stats.elapsedMs = Date.now() - stats.startedAt;
    await sleep(80);
    const grade = await shell(process.execPath, [join(root, 'extensions/cua-tool/tests/business-grade.mjs'), oraclePath], { timeout: 30000 });
    assert.equal(grade.code, 0, grade.stdout + grade.stderr);
    stats.grade = JSON.parse(grade.stdout);
    stats.eventCount = stats.grade.eventCount;
    return stats;
  } finally {
    await stopFixture();
  }
}
let failure;
try {
  const compile = await shell('xcrun', ['swiftc', join(root, 'extensions/cua-tool/tests/business-fixture.swift'), '-o', binary], { timeout: 120000 });
  assert.equal(compile.code, 0, compile.stderr);
  for (const variation of [1, 2, 3]) runStats.push(await runVariation(variation));
} catch (error) {
  failure = error;
} finally {
  await stopFixture();
  try {
    mkdirSync(reportDir, { recursive: true });
    const totalEvents = runStats.reduce((sum, run) => sum + (run.eventCount ?? 0), 0);
    const report = [
      '# LittleCua Developer-Informed Business Workflow Trials', '',
      `- Generated: ${new Date().toISOString()}`,
      '- Mode: developer-informed UI-only solver; not a blind model-agent evaluation.',
      '- Solver inputs: natural-language task recovered from the rendered task brief plus live AX snapshots only.',
      '- Forbidden to solver: fixture source, oracle files, hidden expected state, hardcoded element indices, answer-bearing IDs, JXA/AppleScript, program/raw bypasses, browser tools, and other filesystem tools.',
      `- Variations: ${runStats.length}/3 completed; event total ${totalEvents}.`,
      `- Overall: ${failure ? 'FAIL' : 'PASS'}`,
      '', '## Predeclared success criteria', '',
      '- Exactly one target record selected by visible project/requester/current Approved Equipment/Inbound context.',
      '- No unrelated record mutated; billing unchanged.',
      '- Delivery values, eligible lowest-cost shipping, and all eight quantities match the hidden read-only oracle.',
      '- Validation error is visibly observed and at least one post-error correction occurs.',
      '- Final review is acknowledged and exactly one simulated local draft save occurs.',
      '- Ambiguous duplicate Review is rejected before dispatch; contextual Review succeeds.',
      '', '## Per-run objective results', '',
      '| Variation | Target derived from AX | Ambiguous safe rejection | Events | Validation errors | Corrections | Saves | Wrong records | Time (ms) | Result |',
      '|---:|---|---:|---:|---:|---:|---:|---:|---:|---|',
      ...runStats.map(run => `| ${run.variation} | ${run.derived?.targetID ?? ''} (${run.derived?.project ?? ''} / ${run.derived?.requester ?? ''}) | ${run.ambiguousRejected} | ${run.eventCount ?? ''} | ${run.grade?.eventKinds?.validation_error ?? 0} | ${run.grade?.checks?.find(check => check.name === 'post-error correction event')?.pass ? 'yes' : 'no'} | ${run.grade?.eventKinds?.draft_saved ?? ''} | ${run.grade?.eventKinds?.wrong_record_selected ?? 0} | ${run.elapsedMs ?? ''} | ${run.grade?.passed ? 'PASS' : 'FAIL'} |`),
      '', '## Objective grading details', '',
      ...runStats.map(run => [`### Variation ${run.variation}`, '```json', JSON.stringify(run.grade, null, 2), '```', ''].join('\n')),
      '## Development failures and fixes', '',
      '- Initial fixture AX output hid long multiline clues; switched to short native static labels and explicit panel ancestry.',
      '- Initial UI-only solver assumed project and requester were on one AX line; fixed it to aggregate the rendered task brief.',
      '- Initial UI-only solver accepted near-name requester substrings; fixed exact quoted-field matching so only the intended record qualifies.',
      '- Initial validation feedback was not AX-visible; shortened the message and re-rendered the failed line-item panel to expose a fresh error state.',
      '- Initial business target conditional data had a duplicate record ID and an incorrect optional dock expectation; corrected seeded variations.',
      '- Initial business grader compared object key insertion order; changed grading to deep structural equality.',
      '- Initial variation-three event count was 61; removed the non-action terminal rendering event to keep meaningful workflow events within 40–60.',
      '- Duplicate Review selectors initially chose the first match; generic contextual `within` selection and safe ambiguity rejection now prevent that dispatch.',
      '- Solver trial setup through `pi_terminal` was unavailable because the current Pi Terminal window could not be resolved; no blind model-agent result is claimed.',
      '', '## Limitations', '',
      '- This solver was authored with knowledge of the fixture’s UI vocabulary and is not independent. It tests rendered-AX interpretation and generic routing, not unbiased model performance.',
      '- The fixture is not Excel and does not establish broad Excel/OneDrive compatibility.',
      '- Tab/Return behavior is not central to this business trial; current fixture’s visible native transitions use contextual controls and AX entry.',
      '- The oracle is app-owned and read only by the parent grader after each run. It is unavailable to the solver during decisions.',
      '', `Detailed report path: ${reportPath}`, '',
    ].join('\n');
    writeFileSync(reportPath, report, { mode: 0o600 });
  } catch (error) {
    failure = failure ?? error;
  }
  rmSync(temp, { recursive: true, force: true });
}
if (failure) {
  console.error(`FAIL developer-informed business trial: ${String(failure.stack ?? failure)}`);
  console.error(`Detailed report: ${reportPath}`);
  process.exitCode = 1;
} else {
  console.log(`PASS developer-informed business trials: ${runStats.length} variations; report ${reportPath}`);
}
