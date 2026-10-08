import assert from 'node:assert/strict';
import { jiti } from './pi-loader.mjs';
const {
  NativeDeadline,
  NativeOperationCoordinator,
  NativeOperationError,
  nativeDelay,
} = await jiti.import('../native-operation-coordinator.ts');

const coordinator = new NativeOperationCoordinator(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Same key is ordered, but independent native read targets are not globally serialized.
const order=[];
await Promise.all([
  coordinator.runExclusive(['native:target:1:1'], new NativeDeadline(500), undefined, 'first', async()=>{ order.push('first:start'); await sleep(30); order.push('first:end'); }),
  coordinator.runExclusive(['native:target:1:1'], new NativeDeadline(500), undefined, 'second', async()=>{ order.push('second'); }),
]);
assert.deepEqual(order,['first:start','first:end','second']);

let active=0, peak=0;
await Promise.all([
  coordinator.runExclusive(['native:target:2:1'], new NativeDeadline(500), undefined, 'parallel read A', async()=>{ active++; peak=Math.max(peak,active); await sleep(25); active--; }),
  coordinator.runExclusive(['native:target:3:1'], new NativeDeadline(500), undefined, 'parallel read B', async()=>{ active++; peak=Math.max(peak,active); await sleep(25); active--; }),
]);
assert.equal(peak,2);

let dispatched=false;
const held=coordinator.runExclusive(['native:target:4:1'], new NativeDeadline(500), undefined, 'holder', async()=>sleep(70));
await sleep(5);
const controller=new AbortController();
const queued=coordinator.runExclusive(['native:target:4:1'], new NativeDeadline(500), controller.signal, 'cancelled queue', async()=>{ dispatched=true; });
controller.abort('test');
await assert.rejects(queued, error => error instanceof NativeOperationError && error.kind==='cancelled');
await held;
assert.equal(dispatched,false);
assert.deepEqual(coordinator.status().activeKeys,[]);
assert.equal(coordinator.status().pending,0);

const bounded = new NativeOperationCoordinator(1);
const boundedHolder = bounded.runExclusive(['native:target:5:1'], new NativeDeadline(500), undefined, 'bounded holder', async()=>sleep(80));
await sleep(5);
const boundedQueued = bounded.runExclusive(['native:target:5:1'], new NativeDeadline(500), undefined, 'bounded queued', async()=>{});
await assert.rejects(bounded.runExclusive(['native:target:5:1'], new NativeDeadline(500), undefined, 'queue full', async()=>{}), error => error instanceof NativeOperationError && error.kind==='queue_full');
await boundedQueued;
await boundedHolder;
assert.deepEqual(bounded.status().activeKeys,[]);
assert.equal(bounded.status().pending,0);

const deadline=new NativeDeadline(20);
await assert.rejects(nativeDelay(50, undefined, deadline, 'deadline test'), error => error instanceof NativeOperationError && error.kind==='timeout');
assert.deepEqual(coordinator.status().activeKeys,[]);
assert.equal(coordinator.status().pending,0);
console.log('PASS native coordinator ordering, safe parallelism, cancellation, deadline, and cleanup');
