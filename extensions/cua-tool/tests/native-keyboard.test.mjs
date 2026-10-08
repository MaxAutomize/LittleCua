import assert from 'node:assert/strict';
import {jiti}from'./pi-loader.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const{typeNativeCharacters,characterScript,focusedKeyboardScript,keyboardWindowIdentifier}=await jiti.import('../native-keyboard.ts');
const calls=[];let active=0,peak=0;
const pi={exec:async(...args)=>{calls.push(args);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;return{code:0,stdout:'dispatched',stderr:''}}};
const target={pid:77,windowId:88,title:'Exact Duplicate Instance'};
const [a,b]=await Promise.all([typeNativeCharacters(pi,target,'command',{key:'return'}),typeNativeCharacters(pi,target,'second')]);
assert.equal(peak,1);assert.equal(calls.length,2);assert.equal(calls[0][1].at(-2),'36');assert.equal(calls[1][1].at(-2),'-1');assert.equal(a.details.dispatchState,'dispatch-only');assert.match(a.content[0].text,/not yet verified/);
const script=characterScript();assert.match(script,/a reference to \(first application process whose unix id is targetPid\)/);assert.ok(script.indexOf('repeat with ch')<script.indexOf('key code commitCode'));assert.match(script,/delay charDelay/);assert.match(script,/Focus changed before commit/);assert.match(script,/on error messageText/);assert.match(script,/matches is not 1/);
await assert.rejects(typeNativeCharacters(pi,target,'text',{key:'delete'}),/no input dispatched/);await assert.rejects(typeNativeCharacters(pi,target,'text',{delayMs:0}),/zero-delay/);assert.equal(calls.length,2);
const ctrl=new AbortController();ctrl.abort();await assert.rejects(typeNativeCharacters(pi,target,'text',{signal:ctrl.signal}));assert.equal(calls.length,2);
const fail=await typeNativeCharacters({exec:async()=>({code:1,stderr:'focus lost'})},target,'text');assert.equal(fail.isError,true);assert.equal(fail.details.dispatchState,'possibly-dispatched');assert.match(fail.content[0].text,/inspect before retrying/);
assert.match(focusedKeyboardScript('key code 118 using {shift down}'),/Exact PID/);
assert.equal(keyboardWindowIdentifier('- AXApplication "Terminal"\n  - [0] AXWindow "old command" id=_NS:136 actions=[AXRaise]\n    - [1] AXButton id=child'), '_NS:136');
assert.equal(keyboardWindowIdentifier('- AXButton id=child'), '');
assert.equal(keyboardWindowIdentifier('- AXWindow id=one\n- AXWindow id=two'), '');
assert.match(script, /Exact window identifier missing or ambiguous; no key dispatched/);
assert.match(script, /else if targetTitle is not "" then/, 'identifier failure never falls back to a possibly changed title');
assert.match(script, /item 6 of argv/, 'typing identifier must not consume text or commit argv');
const stable=await typeNativeCharacters(pi,{...target,identifier:'_NS:136'},'safe',{key:'return'});
assert.equal(calls.at(-1)[1].at(-1),'_NS:136');
assert.equal(stable.details.dispatchState,'dispatch-only');
if(process.platform==='darwin'){
  const dir=mkdtempSync(join(tmpdir(),'pi-keyboard-compile-'));
  try{
    for(const [i,source] of [script,focusedKeyboardScript('key code 43 using {command down}')].entries())
      execFileSync('/usr/bin/osacompile',['-o',join(dir,`${i}.scpt`),'-e',source],{encoding:'utf8'});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
console.log('PASS shared exact-PID keyboard, serialized paced text+commit, no replay, focus error cleanup, dispatch-only claims, real AppleScript compilation');
