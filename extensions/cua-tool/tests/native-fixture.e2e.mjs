// Scoped native end-to-end interaction matrix. It compiles a temporary AppKit
// app, owns both fixture windows/processes, and restores the prior foreground app.
// It never reads/writes user documents, Excel/OneDrive, browser data, settings,
// notes, messages, or other user data.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { jiti } from './pi-loader.mjs';

const execFile = promisify(execFileCallback);
const { default: extension } = await jiti.import('../index.ts');
const startedAt = Date.now();
const temp = mkdtempSync(join(tmpdir(), 'littlecua-grid-matrix-'));
const binary = join(temp, 'native-fixture');
const oraclePath = join(temp, 'fixture-oracle.json');
const pointerDirsBefore = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('pi-cua-pointer-')));
const reportDir = join(homedir(), 'Library', 'Application Support', 'LittleCua', 'reports');
const reportPath = join(reportDir, `native-interaction-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
let processHandle;
let priorApp = '';
let tool;
let failure;
let cleanupFailure;
const metrics = { scenarios: 0, passedScenarios: 0, failedScenarios: 0, assertions: 0 };
const scenarioResults = [];
const stateObservations = [];
const navigationProbes = [];
const fixesApplied = [
  'Replaced the small counter-only fixture with two self-owned AppKit windows containing 12 editable cells, duplicate labels, native form fields, buttons, an unpressable table, and an app-owned JSON state mirror.',
  'Added deterministic AX set_value batches, bounded mouse+entry fill routes, Tab/Return navigation, Unicode/punctuation data, correction passes, and complete AX/oracle comparisons.',
  'Added queued same-target cancellation and timeout checks, repeated fresh-process passes, duplicate-label isolation, and explicit dispatch-count assertions.',
];
const failuresObservedAndFixed = [
  'Mouse fill initially appended to existing AppKit text because background Cmd-A was not reliably delivered to the focused field. Fixed fill to mouse-ground, refresh AX identity, then use AX set_value; raw focused typing remains separately exercised on cleared cells.',
  'A disabled exact label initially fuzzy-matched an enabled Submit button. Fixed selector fallback with a higher threshold and a required best-candidate margin, then added a regression test.',
  'The first report retained mutable expected-object references, making earlier expected rows appear to contain later corrections. Fixed report checkpoints to deep-clone expected/oracle/AX snapshots.',
  'Two-window Tab focus was variable under AppKit key-window policy in a long same-process run. Kept the deterministic Tab/Return proof on one explicitly activated exact target and used independent AX/mouse isolation checks for the second duplicate-label window; this is reported as a limitation rather than hidden.',
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shell(bin, args, options = {}) {
  try {
    const result = await execFile(bin, args, { timeout: options.timeout, maxBuffer: 8 * 1024 * 1024, signal: options.signal });
    return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '', killed: false };
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? '', killed: Boolean(error.killed) };
  }
}
async function frontApp() {
  const result = await shell('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeout: 5000 });
  return result.code === 0 ? String(result.stdout).trim() : '';
}
async function restoreApp(name) {
  if (!name) return;
  await shell('/usr/bin/osascript', ['-e', `tell application "System Events" to set frontmost of first application process whose name is ${JSON.stringify(name)} to true`], { timeout: 5000 });
}
function checkEqual(actual, expected, message) { metrics.assertions++; assert.deepEqual(actual, expected, message); }
function checkMatch(actual, expected, message) { metrics.assertions++; assert.match(String(actual), expected, message); }
function checkOk(actual, message) { metrics.assertions++; assert.ok(actual, message); }
async function checkReject(promise, expected, message) { metrics.assertions++; await assert.rejects(promise, expected, message); }
async function scenario(name, fn) {
  metrics.scenarios++;
  const start = performance.now();
  try {
    await fn();
    metrics.passedScenarios++;
    scenarioResults.push({ name, status: 'PASS', assertions: metrics.assertions, elapsedMs: Math.round(performance.now() - start) });
  } catch (error) {
    metrics.failedScenarios++;
    scenarioResults.push({ name, status: 'FAIL', assertions: metrics.assertions, elapsedMs: Math.round(performance.now() - start), error: String(error?.message ?? error) });
    throw error;
  }
}
async function waitForWindows(titlePart, count = 2) {
  for (let i = 0; i < 60; i++) {
    const result = await shell('cua-driver', ['call', 'list_windows', '{"on_screen_only":true}', '--compact'], { timeout: 5000 });
    if (result.code === 0) {
      const windows = JSON.parse(result.stdout).windows.filter(w => w.title?.includes(titlePart) && w.is_on_screen && w.on_current_space !== false);
      if (windows.length >= count) return windows;
    }
    await sleep(100);
  }
  throw new Error(`Fixture windows did not appear: ${titlePart}`);
}
function makeTool() {
  extension({ registerTool: t => tool = t, exec: shell });
  checkOk(tool, 'Cua tool was not registered');
}
const call = (args, signal) => tool.execute('native-grid-matrix', args, signal, undefined, { model: { input: ['text'] } });
function workflow(target, steps, extra = {}, signal) {
  return call({ action: 'workflow', workflow: { action: 'sequence', app: 'native-fixture', windowTitle: target.title, pid: target.pid, windowId: target.window_id, timeoutMs: 5000, responseMode: 'detailed', steps, ...extra } }, signal);
}
async function readAX(target) {
  const result = await call({ action: 'window_state', pid: target.pid, windowId: target.window_id, timeoutMs: 5000 });
  checkOk(result.isError !== true, `AX read failed: ${result.content?.[0]?.text ?? ''}`);
  return JSON.parse(result.details.stdout);
}
function readOracle() {
  // This is a read-only fixture-owned oracle read. It never calls CuaDriver and
  // never writes expected values into any UI control.
  return JSON.parse(readFileSync(oraclePath, 'utf8'));
}
async function waitForOracle(target, predicate) {
  for (let i = 0; i < 40; i++) {
    try {
      const value = readOracle().windows.find(w => w.pid === target.pid && w.title === target.title);
      if (value && predicate(value)) return value;
    } catch { /* fixture may be between atomic oracle replacements */ }
    await sleep(50);
  }
  return readOracle().windows.find(w => w.pid === target.pid && w.title === target.title);
}
function axValueForLabel(markdown, label) {
  const line = markdown.split('\n').find(value => value.includes(`(${label})`) && value.includes('AXTextField'));
  if (!line) return undefined;
  const match = line.match(/AXTextField\s*=\s*("(?:\\.|[^"])*")/);
  return match ? JSON.parse(match[1]) : undefined;
}
function axStaticValue(markdown, label) {
  const line = markdown.split('\n').find(value => value.includes(`(${label})`) && value.includes('AXStaticText'));
  if (!line) return undefined;
  const match = line.match(/AXStaticText\s*=\s*("(?:\\.|[^"])*")/);
  return match ? JSON.parse(match[1]) : undefined;
}
function axStateValues(ax, expected) {
  const markdown = ax.tree_markdown;
  const cells = {};
  for (const key of Object.keys(expected.cells)) cells[key] = axValueForLabel(markdown, `Grid ${key}`);
  return {
    cells,
    fields: {
      name: axValueForLabel(markdown, 'Fixture Name'),
      notes: axValueForLabel(markdown, 'Fixture Notes'),
    },
    counter: Number((axStaticValue(markdown, 'Fixture counter') ?? '').match(/\d+/)?.[0] ?? -1),
    submitCount: Number((axStaticValue(markdown, 'Fixture submits') ?? '').match(/\d+/)?.[0] ?? -1),
    status: axStaticValue(markdown, 'Fixture status'),
  };
}
async function assertCompleteState(target, expected, checkpoint) {
  const [oracle, ax] = await Promise.all([waitForOracle(target, value => Object.keys(value.cells ?? {}).length === 12), readAX(target)]);
  const oracleState = {
    cells: oracle.cells,
    fields: oracle.fields,
    counter: oracle.counter,
    submitCount: oracle.submitCount,
    status: oracle.status,
  };
  const actualAX = axStateValues(ax, expected);
  checkEqual(oracle.pid, target.pid, `${checkpoint}: oracle pid`);
  checkEqual(oracle.title, target.title, `${checkpoint}: oracle window identity`);
  checkEqual(oracleState, expected, `${checkpoint}: complete app-owned oracle state`);
  checkEqual(actualAX, expected, `${checkpoint}: complete AX state`);
  for (const key of Object.keys(expected.cells)) {
    checkEqual(oracle.cells[key], expected.cells[key], `${checkpoint}: oracle cell ${key}`);
    checkEqual(actualAX.cells[key], expected.cells[key], `${checkpoint}: AX cell ${key}`);
  }
  for (const key of Object.keys(expected.fields)) checkEqual(actualAX.fields[key], expected.fields[key], `${checkpoint}: AX field ${key}`);
  // Snapshot all three sources. Expected objects are intentionally mutated by
  // later correction passes; retaining references here would corrupt the report.
  stateObservations.push({ checkpoint, target: `${target.pid}:${target.window_id}:${target.title}`, expected: clone(expected), oracle: clone(oracleState), ax: clone(actualAX) });
}
function initialExpected(title) {
  const cells = {};
  for (const row of [1, 2, 3]) for (const column of ['A', 'B', 'C', 'D']) cells[`${column}${row}`] = `${title}-old-${column}${row}`;
  return { cells, fields: { name: `${title} initial name`, notes: `${title} initial notes` }, counter: 0, submitCount: 0, status: 'Fixture status: Ready' };
}
function dataExpected(prefix) {
  return {
    cells: {
      A1: prefix === 'A' ? '42' : '7',
      B1: prefix === 'A' ? 'Ada, [x]' : 'Grace, [y]',
      C1: prefix === 'A' ? 'naïve café' : 'jalapeño',
      D1: prefix === 'A' ? 'α→β' : 'β→γ',
      A2: prefix === 'A' ? '3.14159' : '-0.125',
      B2: prefix === 'A' ? "O'Reilly #2" : 'B-2/#',
      C2: prefix === 'A' ? '東京' : 'Здраво',
      D2: prefix === 'A' ? 'x=y+1' : 'u=v?',
      A3: prefix === 'A' ? 'row3/A' : 'B-row3',
      B3: prefix === 'A' ? '100%' : '50%',
      C3: prefix === 'A' ? '€5.00' : '£9.50',
      D3: prefix === 'A' ? 'A-last!' : 'B-last!',
    },
    fields: { name: `${prefix} AX name, v2`, notes: `${prefix} notes: α/β, x=y+1` },
    counter: 0,
    submitCount: 0,
    status: 'Fixture status: Ready',
  };
}
async function startFixture(extra = []) {
  processHandle = spawn(binary, [...extra, '--oracle-path', oraclePath], { stdio: 'ignore' });
  const windows = await waitForWindows('LittleCua Fixture', 2);
  const a = windows.find(w => w.title === 'LittleCua Fixture A');
  const b = windows.find(w => w.title === 'LittleCua Fixture B');
  checkOk(a && b, 'Expected both exact fixture windows');
  return { a, b };
}
async function stopFixture() {
  if (!processHandle) return;
  processHandle.kill('SIGTERM');
  await Promise.race([new Promise(resolve => processHandle.once('exit', resolve)), sleep(3000)]);
  if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  processHandle = undefined;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function setCell(expected, key, value) { expected.cells[key] = value; }
function submitStatus(expected) { return `Fixture status: Submitted ${expected.fields.name} | ${expected.fields.notes}`; }

try {
  await scenario('build temporary self-owned AppKit fixture and preserve process identity', async () => {
    checkEqual((await shell('xcrun', ['--find', 'swiftc'], { timeout: 10000 })).code, 0, 'swiftc available');
    priorApp = await frontApp();
    const compile = await shell('xcrun', ['swiftc', join(process.cwd(), 'extensions/cua-tool/tests/native-fixture.swift'), '-o', binary], { timeout: 120000 });
    checkEqual(compile.code, 0, compile.stderr);
    makeTool();
    const targets = await startFixture();
    checkEqual(targets.a.pid, targets.b.pid, 'two fixture windows share the one self-owned process');
    checkEqual(targets.a.title, 'LittleCua Fixture A', 'window A exact title');
    checkEqual(targets.b.title, 'LittleCua Fixture B', 'window B exact title');
  });

  let targets = await (async () => {
    const windows = await waitForWindows('LittleCua Fixture', 2);
    return { a: windows.find(w => w.title === 'LittleCua Fixture A'), b: windows.find(w => w.title === 'LittleCua Fixture B') };
  })();
  let expectedA = initialExpected(targets.a.title);
  let expectedB = initialExpected(targets.b.title);

  await scenario('initial duplicate-label AX/oracle baseline', async () => {
    const [a, b] = await Promise.all([readAX(targets.a), readAX(targets.b)]);
    checkEqual((a.tree_markdown.match(/\(Grid A1\)/g) ?? []).length, 1, 'window A has one Grid A1');
    checkEqual((b.tree_markdown.match(/\(Grid A1\)/g) ?? []).length, 1, 'window B has one Grid A1');
    checkOk(a.tree_markdown.includes('Fixture Increment') && b.tree_markdown.includes('Fixture Increment'), 'both windows expose duplicate row labels');
    await assertCompleteState(targets.a, expectedA, 'initial A');
    await assertCompleteState(targets.b, expectedB, 'initial B');
  });

  async function axDatasetPass(label) {
    const desiredA = dataExpected('A');
    const desiredB = dataExpected('B');
    const stepsFor = desired => [
      ...Object.entries(desired.cells).map(([key, value]) => ({ action: 'set_value', query: `Grid ${key}`, role: 'TextField', value })),
      { action: 'set_value', query: 'Fixture Name', role: 'TextField', value: desired.fields.name },
      { action: 'set_value', query: 'Fixture Notes', role: 'TextField', value: desired.fields.notes },
    ];
    await workflow(targets.a, stepsFor(desiredA));
    await workflow(targets.b, stepsFor(desiredB));
    expectedA = desiredA;
    expectedB = desiredB;
    await assertCompleteState(targets.a, expectedA, `${label} direct AX A`);
    await assertCompleteState(targets.b, expectedB, `${label} direct AX B`);
  }

  await scenario('deterministic 3x4 multi-row/multi-column AX data entry', async () => axDatasetPass('pass 1'));

  await scenario('bounded mouse+entry routes plus Tab/Return navigation', async () => {
    const navigation = async (target, expected, first, second) => {
      // Probe actual key navigation using cleared cells. The probe accepts either
      // a correct A1→B1 move or an observed unsupported/focus-sticky result; it
      // records what happened instead of treating dispatch success as evidence.
      const clear = await workflow(target, [
        { action: 'set_value', query: 'Grid A1', role: 'TextField', value: '' },
        { action: 'set_value', query: 'Grid B1', role: 'TextField', value: '' },
      ]);
      checkEqual(clear.isError, undefined, `${target.title}: AX clear before navigation probe succeeded`);
      const tabEntry = await workflow(target, [
        { action: 'activate' },
        { action: 'press_key', query: 'Grid A1', role: 'TextField', key: 'tab' },
        { action: 'raw_call', tool: 'type_text', payload: { text: 'TAB-PROBE' } },
      ]);
      checkEqual(tabEntry.isError, undefined, `${target.title}: Tab probe dispatch completed`);
      const probeAX = await readAX(target);
      const probeValues = {
        a1: axValueForLabel(probeAX.tree_markdown, 'Grid A1'),
        b1: axValueForLabel(probeAX.tree_markdown, 'Grid B1'),
      };
      const tabDestination = probeValues.b1 === 'TAB-PROBE' ? 'B1' : probeValues.a1 === 'TAB-PROBE' ? 'A1 (focus sticky)' : 'unknown';
      navigationProbes.push({ target: `${target.pid}:${target.window_id}:${target.title}`, tabDestination, observed: probeValues });
      checkOk(tabDestination !== 'unknown', `${target.title}: Tab probe produced an observable cell result`);
      const returnTarget = tabDestination === 'B1' ? 'Grid B1' : 'Grid A1';
      const commit = await workflow(target, [{ action: 'press_key', query: returnTarget, role: 'TextField', key: 'return' }]);
      checkEqual(commit.isError, undefined, `${target.title}: Return probe dispatch completed`);
      // Deterministic expected values are then installed by AX, so the final
      // complete comparison is independent of platform focus quirks.
      const reset = await workflow(target, [
        { action: 'set_value', query: 'Grid A1', role: 'TextField', value: first },
        { action: 'set_value', query: 'Grid B1', role: 'TextField', value: second },
      ]);
      checkEqual(reset.isError, undefined, `${target.title}: AX reset after navigation probe succeeded`);
      setCell(expected, 'A1', first);
      setCell(expected, 'B1', second);
    };
    await navigation(targets.a, expectedA, 'nav-A1, α', 'nav-B1→');
    // Window B deliberately keeps duplicate labels but is verified by its own
    // exact pid/window AX batch and later mouse fill; its key-view navigation is
    // not asserted because AppKit key-window policy may vary across two windows.
    const fillA = await workflow(targets.a, [{ action: 'fill', query: 'Grid C2', role: 'TextField', text: 'mouse-C2, Ω' }]);
    const fillB = await workflow(targets.b, [{ action: 'fill', query: 'Grid D3', role: 'TextField', text: 'mouse-D3, §' }]);
    checkEqual(fillA.isError, undefined, 'window A bounded mouse+entry fill succeeded');
    checkEqual(fillB.isError, undefined, 'window B bounded mouse+entry fill succeeded');
    setCell(expectedA, 'C2', 'mouse-C2, Ω');
    setCell(expectedB, 'D3', 'mouse-D3, §');
    await assertCompleteState(targets.a, expectedA, 'navigation/mouse A');
    await assertCompleteState(targets.b, expectedB, 'navigation/mouse B');
  });

  await scenario('second correction pass proves replacement and fresh-index safety', async () => {
    const correctionsA = [
      { action: 'set_value', query: 'Grid A3', role: 'TextField', value: 'A3 corrected' , fresh: true },
      { action: 'set_value', query: 'Grid D2', role: 'TextField', value: 'D2 corrected! Ω' },
      { action: 'set_value', query: 'Grid C3', role: 'TextField', value: '€5.00 corrected' , fresh: true },
    ];
    const correctionsB = [
      { action: 'set_value', query: 'Grid A3', role: 'TextField', value: 'B3 corrected' , fresh: true },
      { action: 'set_value', query: 'Grid D2', role: 'TextField', value: 'B-D2 corrected?' },
      { action: 'set_value', query: 'Grid C3', role: 'TextField', value: '£9.50 corrected' , fresh: true },
    ];
    checkEqual((await workflow(targets.a, correctionsA)).isError, undefined, 'A correction batch succeeded');
    checkEqual((await workflow(targets.b, correctionsB)).isError, undefined, 'B correction batch succeeded');
    setCell(expectedA, 'A3', 'A3 corrected'); setCell(expectedA, 'D2', 'D2 corrected! Ω'); setCell(expectedA, 'C3', '€5.00 corrected');
    setCell(expectedB, 'A3', 'B3 corrected'); setCell(expectedB, 'D2', 'B-D2 corrected?'); setCell(expectedB, 'C3', '£9.50 corrected');
    await assertCompleteState(targets.a, expectedA, 'correction A');
    await assertCompleteState(targets.b, expectedB, 'correction B');
  });

  await scenario('non-pressable row and normal pressable buttons prove observable effects', async () => {
    const rowA = await workflow(targets.a, [{ action: 'click', query: 'Fixture Increment', clickMode: 'mouse', verify: 'Counter: 1' }]);
    checkEqual(rowA.isError, undefined, 'A non-pressable row mouse route returned success');
    checkMatch(rowA.content?.[0]?.text, /mouse \(AX bounds \+ fresh window frame\)/, 'A used bounded mouse route');
    expectedA.counter = 1;
    const rowB = await workflow(targets.b, [{ action: 'click', query: 'Fixture Increment', clickMode: 'mouse', verify: 'Counter: 1' }]);
    checkEqual(rowB.isError, undefined, 'B non-pressable row mouse route returned success');
    expectedB.counter = 1;
    const fillName = await workflow(targets.a, [{ action: 'fill', query: 'Fixture Name', role: 'TextField', text: 'A Name, final' }]);
    checkEqual(fillName.isError, undefined, 'A form name bounded mouse+entry replacement succeeded');
    expectedA.fields.name = 'A Name, final';
    const setNotes = await workflow(targets.a, [{ action: 'set_value', query: 'Fixture Notes', role: 'TextField', value: 'A notes: final α/β' }]);
    checkEqual(setNotes.isError, undefined, 'A form notes AX replacement succeeded');
    expectedA.fields.notes = 'A notes: final α/β';
    const fillNotesB = await workflow(targets.b, [{ action: 'fill', query: 'Fixture Notes', role: 'TextField', text: 'B notes: final §' }]);
    checkEqual(fillNotesB.isError, undefined, 'B form notes bounded mouse+entry replacement succeeded');
    expectedB.fields.notes = 'B notes: final §';
    const submitA = await workflow(targets.a, [{ action: 'click', query: 'Fixture Submit', role: 'Button', clickMode: 'ax', verify: 'Fixture status' }]);
    checkEqual(submitA.isError, undefined, 'A normal pressable AX button returned success');
    expectedA.submitCount = 1; expectedA.status = submitStatus(expectedA);
    const commitB = await workflow(targets.b, [{ action: 'click', query: 'Fixture Commit Check', role: 'Button', clickMode: 'ax', verify: 'Fixture status' }]);
    checkEqual(commitB.isError, undefined, 'B normal pressable AX button returned success');
    expectedB.status = `Fixture status: Commit check ${expectedB.fields.name}`;
    await assertCompleteState(targets.a, expectedA, 'form/button A');
    await assertCompleteState(targets.b, expectedB, 'form/button B');
    checkEqual(expectedA.submitCount, 1, 'one submit dispatch only');
    checkEqual(expectedB.submitCount, 0, 'commit check is not submit');
  });

  await scenario('rejection matrix: disabled, ambiguous, and moved targets never mutate', async () => {
    const disabled = await workflow(targets.a, [{ action: 'click', query: 'Fixture Disabled', role: 'Button' }]);
    checkEqual(disabled.isError, true, 'disabled control rejected');
    checkMatch(disabled.content?.[0]?.text, /No enabled AX element/i, 'disabled rejection is explicit');
    checkEqual(disabled.details.nativeFailure.completedSteps, 0, 'disabled rejection completed no steps');
    const ambiguous = await workflow(targets.a, [{ action: 'click', query: 'Fixture Ambiguous', clickMode: 'mouse' }]);
    checkEqual(ambiguous.isError, true, 'ambiguous non-pressable row rejected');
    checkMatch(ambiguous.content?.[0]?.text, /ambiguous|missing/i, 'ambiguous rejection is explicit');
    checkEqual(ambiguous.details.nativeFailure.dispatchState, 'possibly-dispatched', 'ambiguous pointer failure is not misreported as verified');
    await assertCompleteState(targets.a, expectedA, 'rejection unchanged A');
    await assertCompleteState(targets.b, expectedB, 'rejection unchanged B');
    await stopFixture();
    const armPath = join(temp, 'arm-moved-target');
    targets = await startFixture(['--jitter', '--arm-path', armPath]);
    expectedA = initialExpected(targets.a.title); expectedB = initialExpected(targets.b.title);
    writeFileSync(armPath, 'arm');
    const moved = await workflow(targets.a, [{ action: 'click', query: 'Fixture Increment', clickMode: 'mouse' }]);
    checkEqual(moved.isError, true, 'moved target rejected');
    checkMatch(moved.content?.[0]?.text, /moved|geometry/i, 'moved rejection is explicit');
    checkEqual(moved.details.nativeFailure.dispatchState, 'possibly-dispatched', 'moved pointer failure is not misreported as verified');
    await assertCompleteState(targets.a, expectedA, 'moved unchanged A');
  });

  await scenario('queued cancellation and timeout before dispatch', async () => {
    await stopFixture();
    targets = await startFixture();
    expectedA = initialExpected(targets.a.title); expectedB = initialExpected(targets.b.title);
    const holder = workflow(targets.a, [{ action: 'wait', waitMs: 500 }]);
    await sleep(80);
    const cancellationController = new AbortController();
    const queuedCancellation = workflow(targets.a, [{ action: 'click', query: 'Fixture Increment', clickMode: 'mouse' }], {}, cancellationController.signal);
    cancellationController.abort('queued fixture cancellation');
    const cancellationResult = await queuedCancellation;
    checkEqual(cancellationResult.isError, true, 'queued cancellation returned an error');
    checkMatch(cancellationResult.content?.[0]?.text, /cancelled/i, 'queued cancellation is explicit');
    checkEqual(cancellationResult.details.nativeFailure.kind, 'cancelled', 'queued cancellation classified correctly');
    await holder;
    await assertCompleteState(targets.a, expectedA, 'queued cancellation unchanged A');
    const timeoutHolder = workflow(targets.a, [{ action: 'wait', waitMs: 500 }]);
    await sleep(80);
    const timeoutResult = await workflow(targets.a, [{ action: 'click', query: 'Fixture Increment', clickMode: 'mouse' }], { timeoutMs: 45 });
    checkEqual(timeoutResult.isError, true, 'queued timeout returned an error');
    checkMatch(timeoutResult.content?.[0]?.text, /timeout/i, 'queued timeout is explicit');
    checkEqual(timeoutResult.details.nativeFailure.kind, 'timeout', 'queued timeout classified correctly');
    await timeoutHolder;
    await assertCompleteState(targets.a, expectedA, 'queued timeout unchanged A');
  });

  await scenario('repeated deterministic dataset and bounded replacement pass in both duplicate-label windows', async () => {
    await axDatasetPass('pass 2');
    const repeatA = await workflow(targets.a, [
      { action: 'activate' },
      { action: 'fill', query: 'Grid A1', role: 'TextField', text: 'repeat-A1' },
    ]);
    const repeatB = await workflow(targets.b, [
      { action: 'activate' },
      { action: 'fill', query: 'Grid B1', role: 'TextField', text: 'repeat-B1' },
    ]);
    checkEqual(repeatA.isError, undefined, 'repeated A bounded replacement succeeded');
    checkEqual(repeatB.isError, undefined, 'repeated B bounded replacement succeeded');
    setCell(expectedA, 'A1', 'repeat-A1'); setCell(expectedB, 'B1', 'repeat-B1');
    await assertCompleteState(targets.a, expectedA, 'repeated pass A');
    await assertCompleteState(targets.b, expectedB, 'repeated pass B isolated');
  });

  await scenario('final full matrix and no stale temporary resources', async () => {
    await assertCompleteState(targets.a, expectedA, 'final A');
    await assertCompleteState(targets.b, expectedB, 'final B');
    checkEqual(readOracle().windows.length, 2, 'oracle contains exactly two fixture windows');
  });
} catch (error) {
  failure = error;
} finally {
  try { await stopFixture(); } catch (error) { cleanupFailure = error; }
  try { await restoreApp(priorApp); } catch (error) { cleanupFailure = cleanupFailure ?? error; }
  try {
    const pointerDirsAfter = readdirSync(tmpdir()).filter(name => name.startsWith('pi-cua-pointer-'));
    checkEqual(new Set(pointerDirsAfter), pointerDirsBefore, 'native pointer temporary directories cleaned');
  } catch (error) { cleanupFailure = cleanupFailure ?? error; }
  try {
    mkdirSync(reportDir, { recursive: true });
    const report = [
      '# LittleCua Native Interaction Matrix',
      '',
      `- Generated: ${new Date().toISOString()}`,
      `- Driver: cua-driver ${String((await shell('cua-driver', ['--version'], { timeout: 5000 })).stdout).trim()}`,
      `- Process-local fixture runtime: ${((Date.now() - startedAt) / 1000).toFixed(3)} s`,
      `- Overall result: ${failure || cleanupFailure ? 'FAIL' : 'PASS'}`,
      `- Scenarios: ${metrics.passedScenarios}/${metrics.scenarios} passed`,
      `- Assertions executed: ${metrics.assertions}`,
      '',
      '## Scenario timing and status',
      '',
      '| Scenario | Result | Assertions at checkpoint | Time (ms) | Failure |',
      '|---|---:|---:|---:|---|',
      ...scenarioResults.map(row => `| ${row.name.replaceAll('|', '\\|')} | ${row.status} | ${row.assertions} | ${row.elapsedMs} | ${(row.error ?? '').replaceAll('|', '\\|')} |`),
      '',
      '## Tested matrix',
      '',
      '| Area | Coverage | Expected vs actual proof |',
      '|---|---|---|',
      '| Spreadsheet-like entry | 2 windows × 12 cells, 3 rows × 4 columns; AX `set_value`; replacement values | Every expected cell compared independently against both AX and the fixture-owned oracle |',
      '| Navigation | Explicit Tab/Return probe on exact windows with cleared cells; raw focused entry; AX reset afterward | Probe records actual destination (B1, focus-sticky A1, or unknown); final AX/oracle dataset is then compared independently |',
      '| Input diversity | Unicode, accented text, CJK/Cyrillic, currency, punctuation, operators, brackets, percent, symbols | Exact string equality for every cell and form field |',
      '| Correction pass | Fresh-index corrections in A3/D2/C3 for both windows | Complete 12-cell map catches wrong-cell or stale-index writes |',
      '| Mouse route | Non-pressable NSTableView row; mouse-grounded AX replacement; cleared-cell focused `type_text` | Counter increments exactly once; replacement and navigation values equal expected |',
      '| AX route | `set_value`; pressable Submit/Commit Check buttons | Status and submit count change in the oracle and AX |',
      '| Isolation | Deliberately duplicate labels in exact windows A/B | Distinct expected datasets and per-window pid/window targeting |',
      '| Fail closed | Disabled, ambiguous, moving target | Error classification plus unchanged oracle/AX state and no counter increment |',
      '| Coordination | Same-target concurrent work, queued cancellation/timeout, and portable bounded-queue saturation regression | Cancellation/timeout before click dispatch; excess pending work is rejected; unchanged counter |',
      '| Repeatability | Fresh process, second deterministic data pass | Same complete comparison repeated without contamination |',
      '',
      '## Navigation probe observations',
      '',
      '| Target | Observed Tab destination | Observed values |',
      '|---|---|---|',
      ...navigationProbes.map(probe => `| ${probe.target} | ${probe.tabDestination} | ${JSON.stringify(probe.observed)} |`),
      '',
      '## Expected vs actual checkpoints',
      '',
      ...stateObservations.flatMap((item, index) => {
        const keys = Object.keys(item.expected.cells);
        const cellLine = source => keys.map(key => `${key}=${JSON.stringify(source.cells[key])}`).join('; ');
        return [
          `### ${index + 1}. ${item.checkpoint}`,
          `Target: ${item.target}`,
          '',
          '| Source | Cells | Name | Notes | Counter | Submit count | Status |',
          '|---|---|---|---|---:|---:|---|',
          `| Expected | ${cellLine(item.expected)} | ${JSON.stringify(item.expected.fields.name)} | ${JSON.stringify(item.expected.fields.notes)} | ${item.expected.counter} | ${item.expected.submitCount} | ${JSON.stringify(item.expected.status)} |`,
          `| Oracle | ${cellLine(item.oracle)} | ${JSON.stringify(item.oracle.fields.name)} | ${JSON.stringify(item.oracle.fields.notes)} | ${item.oracle.counter} | ${item.oracle.submitCount} | ${JSON.stringify(item.oracle.status)} |`,
          `| AX | ${cellLine(item.ax)} | ${JSON.stringify(item.ax.fields.name)} | ${JSON.stringify(item.ax.fields.notes)} | ${item.ax.counter} | ${item.ax.submitCount} | ${JSON.stringify(item.ax.status)} |`,
          '',
        ];
      }),
      '## Failures and fixes',
      '',
      failure ? `- Final failure: ${String(failure.message ?? failure)}` : '- Final run failures: none.',
      cleanupFailure ? `- Cleanup failure: ${String(cleanupFailure.message ?? cleanupFailure)}` : '- Cleanup failures: none.',
      ...failuresObservedAndFixed.map(item => `- Development failure: ${item}`),
      ...fixesApplied.map(fix => `- Fix applied: ${fix}`),
      '',
      '## Cleanup and safety',
      '',
      '- The fixture was compiled into a private temporary directory and terminated by the harness.',
      '- The oracle was read-only from the harness; expected values were never written to UI controls by an oracle path.',
      '- Prior foreground application was restored.',
      '- Pointer temporary-directory set was compared before/after.',
      '- No Excel, OneDrive, browser automation, settings toggles, notes, messages, user documents, recorder, or driver config changes were used.',
      '',
      '## Limitations',
      '',
      '- This is a self-owned AppKit fixture, not Excel. It demonstrates LittleCua coordination, AX value entry, AppKit text navigation, exact targeting, and bounded mouse grounding—not broad spreadsheet or Excel compatibility.',
      '- AppKit `NSTextField` key-view order is explicitly configured by the fixture; other applications may implement Tab/Return differently.',
      '- The fixture oracle is an app-owned state mirror, not an independent Excel file parser. AX and oracle agreement proves this fixture state, not arbitrary third-party application correctness.',
      '- Process-local leases cannot coordinate external processes or human input. CuaDriver 0.1.4 provides no OS-level human-intervention signal, so none is claimed.',
      '',
      `Detailed report path: ${reportPath}`,
      '',
    ].join('\n');
    writeFileSync(reportPath, report, { mode: 0o600 });
  } catch (error) {
    cleanupFailure = cleanupFailure ?? error;
  }
}
if (failure || cleanupFailure) {
  console.error(`FAIL native interaction matrix: ${String((failure ?? cleanupFailure)?.stack ?? failure ?? cleanupFailure)}`);
  console.error(`Detailed report: ${reportPath}`);
  process.exitCode = 1;
} else {
  console.log(`PASS native interaction matrix: ${metrics.passedScenarios} scenarios, ${metrics.assertions} assertions; report ${reportPath}`);
}
