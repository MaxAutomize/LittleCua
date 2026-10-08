import assert from 'node:assert/strict';import {jiti}from'./pi-loader.mjs';
const{default:extension}=await jiti.import('../index.ts');let tool;extension({exec:async()=>{throw new Error('No UI invocation allowed in definition test')},registerTool:t=>tool=t});
assert.equal(tool.name,'cua_driver');assert.ok(tool.description.startsWith('REPAIR-FIRST CONTRACT:'));
for(const text of ['stop unchanged retries','actual target/outcome','reusable Cua implementation','regression','refactor','validate, reload','retest through cua_driver','possibly committed mutation','permission','dispatch separately from verified success','native clicks'])assert.ok(tool.description.includes(text),text);
assert.match(tool.promptSnippet,/repair\/refactor/);
assert.match(tool.parameters.properties.key.description,/SAME ordered transaction/);
console.log('PASS repair-first contract is in primary model-facing description, not buried in implementation/docs');
