// Read-only objective grader for the self-owned business fixture. It never
// invokes CuaDriver and never writes fixture/UI state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const oraclePath = process.argv[2];
if (!oraclePath) throw new Error('Usage: node business-grade.mjs <oracle.json>');
const payload = JSON.parse(readFileSync(oraclePath, 'utf8'));
const expected = payload.expected;
const state = payload.state;
const events = payload.events ?? [];
const initialRecords = new Map((payload.initialRecords ?? []).map(record => [record.id, record]));
const target = state.records?.find(record => record.id === payload.targetRecord);
const checks = [];
function check(name, actual, wanted) {
  const pass = isDeepStrictEqual(actual, wanted);
  checks.push({ name, pass, expected: wanted, actual });
  if (!pass) throw new assert.AssertionError({ message: name, actual, expected: wanted });
}
function checkPredicate(name, actual, predicate, expectedText) {
  const pass = predicate(actual);
  checks.push({ name, pass, expected: expectedText, actual });
  if (!pass) throw new assert.AssertionError({ message: name, actual, expected: expectedText });
}

let failure;
try {
  checkPredicate('meaningful interaction event count', events.length, value => value >= 40 && value <= 60, '40–60');
  check('final stage', state.stage, 'saved');
  check('selected target record', state.selectedRecord, payload.targetRecord);
  check('exactly one final draft save', state.saveCount, 1);
  check('no incorrect record selections', state.incorrectRecordSelections, 0);
  check('target shipping', target?.shipping, expected.shipping);
  check('target delivery', target?.delivery, expected.delivery);
  check('target quantities', target?.quantities, expected.quantities);
  check('target billing unchanged', target?.billing, initialRecords.get(payload.targetRecord)?.billing);
  checkPredicate('at least one validation error', state.validationErrors, value => value >= 1, '>= 1');
  checkPredicate('validation retried after first pass', state.validationAttempts, value => value >= 2, '>= 2');
  const firstValidation = events.findIndex(event => event.kind === 'validation_error');
  checkPredicate('post-error correction event', events.slice(firstValidation + 1), after => after.some(event => event.kind === 'field_changed'), 'field_changed after validation_error');
  const saveEvents = events.filter(event => event.kind === 'draft_saved');
  check('draft_saved event count', saveEvents.length, 1);
  for (const record of state.records ?? []) {
    if (record.id === payload.targetRecord) continue;
    check(`unrelated record unchanged: ${record.id}`, {
      id: record.id, delivery: record.delivery, quantities: record.quantities, shipping: record.shipping, billing: record.billing,
    }, initialRecords.get(record.id));
  }
} catch (error) {
  failure = error;
}
const result = {
  passed: !failure,
  variation: payload.variation,
  pid: payload.pid,
  targetRecord: payload.targetRecord,
  eventCount: events.length,
  eventKinds: events.reduce((counts, event) => { counts[event.kind] = (counts[event.kind] ?? 0) + 1; return counts; }, {}),
  checks,
  failure: failure ? String(failure.message ?? failure) : undefined,
};
console.log(JSON.stringify(result, null, 2));
if (failure) process.exitCode = 1;
