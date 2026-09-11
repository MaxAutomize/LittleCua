import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jiti } from './pi-loader.mjs';
const {pixelCenter, clickNativeBounds}=await jiti.import('../native-pointer.ts');
assert.deepEqual(pixelCenter({x:200,y:200,width:40,height:20},{x:100,y:100,width:400,height:200},{width:200,height:100}),{x:60,y:55});
assert.throws(()=>pixelCenter({x:0,y:0,width:0,height:1},{x:0,y:0,width:1,height:1},{width:1,height:1}),/empty/);
const dir=mkdtempSync(join(tmpdir(),'cua-pointer-test-')), path=join(dir,'frame.png');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAQAAACoWZgAAAAADUlEQVR42mNk+M/wHwAF/gL+K3c2AAAAAElFTkSuQmCC','base64');
const calls=[]; const w={pid:7,window_id:8,is_on_screen:true,on_current_space:true,bounds:{x:100,y:100,width:400,height:200},title:'Test'};
const call=async(tool,payload)=>{calls.push({tool,payload}); if(tool==='list_windows')return {data:{windows:[w]}}; if(tool==='get_window_state')return {data:{}}; return {data:{}};};
const pi={exec:async(bin,args)=>{calls.push({bin,args}); if(args[0]==='-l'){return {code:0,stdout:JSON.stringify({x:200,y:200,width:40,height:20}),stderr:''};} if(args.includes('--screenshot-out-file')) writeFileSync(args.at(-1),png); return {code:0,stdout:'',stderr:''};}};
try {
  const mode=await clickNativeBounds(pi,'cua-driver',call,{pid:7,windowId:8}, {role:'AXRow',line:'- AXRow (Sample) id=sample',label:'Sample'}, {}, undefined, 5000);
  assert.equal(mode,'mouse (AX bounds + fresh window frame)');
  assert.equal(calls.at(-1).tool,'click'); assert.equal(calls.at(-1).payload.x,3); assert.equal(calls.at(-1).payload.y,5.5);
} finally { rmSync(dir,{recursive:true,force:true}); }
console.log('PASS native pointer bounds and fresh-frame routing');
