import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {default:extension}=await jiti.import('../native-workflow-speed.ts');
let tool;const nativeCalls=[],scripts=[];let fail=false;
const pi={registerTool:t=>tool=t,registerCommand(){},on(){},async exec(bin,args){
 if(bin==='/usr/bin/osascript'){
  scripts.push(args);
  return fail?{code:1,stdout:'',stderr:'Focus changed during typing'}:{code:0,stdout:'dispatched',stderr:''};
 }
 if(args[0]==='status')return{code:0,stdout:'ready',stderr:''};
 if(args[0]==='dump-docs')return{code:0,stdout:JSON.stringify({mcp:{version:'no-type-text-chars',tools:[{name:'get_window_state',input_schema:{properties:{pid:{},window_id:{}},additionalProperties:false}}]}}),stderr:''};
 if(args[0]==='call'){
  nativeCalls.push(args[1]);assert.equal(args[1],'get_window_state','virtual typing must not be sent to the installed driver');
  return{code:0,stdout:JSON.stringify({tree_markdown:'- [0] AXWindow title="model.blend - Blender" id=exact-blender-window actions=[AXRaise]',element_count:1}),stderr:''};
 }
 throw new Error('Unexpected invocation '+bin+' '+args);
}};
extension(pi);
const invoke=payload=>tool.execute('console-bootstrap',{action:'sequence',pid:69476,windowId:3569,windowTitle:'model.blend - Blender',steps:[{action:'raw_call',tool:'type_text_chars',payload}]});
let r=await invoke({text:'print("OK")',key:'return',delay_ms:2});assert.ok(!r.isError);assert.equal(scripts.length,1);assert.deepEqual(nativeCalls,['get_window_state']);
const argv=scripts[0];assert.ok(argv[1].includes('repeat with ch in characters of payload'));assert.ok(argv[1].includes('key code commitCode'));assert.ok(argv[1].includes('unix id is targetPid'));assert.deepEqual(argv.slice(2),['69476','model.blend - Blender','print("OK")','0.002','36','exact-blender-window']);
for(const payload of [{text:'x',pid:999},{text:'x',window_id:999},{text:'x',delay_ms:0},{text:'x',key:'unknown'}]){
 const before=scripts.length;await assert.rejects(invoke(payload),error=>{assert.equal(error.failure.dispatchState,'not-dispatched');return true;});assert.equal(scripts.length,before);
}
fail=true;await assert.rejects(invoke({text:'partial',key:'return'}),error=>{assert.equal(error.failure.dispatchState,'possibly-dispatched');return true;});assert.equal(scripts.length,2,'a possibly dispatched operation is not retried');
console.log('PASS workflow virtual ordered typing routes before driver capabilities, preserves exact PID/window and atomic text+commit, validates before dispatch and never replays errors');
