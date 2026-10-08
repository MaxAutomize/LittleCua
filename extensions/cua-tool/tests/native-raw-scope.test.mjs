import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {default:extension}=await jiti.import('../native-workflow-speed.ts');
const {nativeScopedPayload}=await jiti.import('../native-capabilities.ts');
const schemas={list_windows:['pid','on_screen_only'],get_config:[],get_window_state:['pid','window_id']};
const caps={supports:(name,key)=>schemas[name]?.includes(key)};
assert.deepEqual(nativeScopedPayload(caps,'list_windows',{pid:77,windowId:88},{on_screen_only:true}),{pid:77,on_screen_only:true});
assert.deepEqual(nativeScopedPayload(caps,'get_config',{pid:77,windowId:88}),{});
assert.deepEqual(nativeScopedPayload(caps,'get_window_state',{pid:77,windowId:88}),{pid:77,window_id:88});
let tool;const calls=[];
const pi={registerTool:t=>tool=t,registerCommand(){},on(){},async exec(_bin,args){
 if(args[0]==='status')return{code:0,stdout:'ready',stderr:''};
 if(args[0]==='dump-docs')return{code:0,stdout:JSON.stringify({mcp:{version:'strict-schema-fixture',tools:Object.entries(schemas).map(([name,keys])=>({name,input_schema:{properties:Object.fromEntries(keys.map(k=>[k,{}])),additionalProperties:false}}))}}),stderr:''};
 if(args[0]==='call'){
  const tool=args[1],p=JSON.parse(args[2]);
  assert.ok(Object.keys(p).every(k=>schemas[tool].includes(k)),'never inject window_id/pid into schemas that reject them');
  calls.push({tool,p});return{code:0,stdout:JSON.stringify({ok:true}),stderr:''};
 }
 throw new Error('Unexpected invocation');
}};
extension(pi);
await tool.execute('scoped-read-batch',{action:'sequence',pid:77,windowId:88,steps:[{action:'raw_call',tool:'list_windows',payload:{on_screen_only:true}},{action:'raw_call',tool:'get_config'},{action:'raw_call',tool:'get_window_state'}]});
assert.deepEqual(calls,[{tool:'list_windows',p:{pid:77,on_screen_only:true}},{tool:'get_config',p:{}},{tool:'get_window_state',p:{pid:77,window_id:88}}]);
console.log('PASS raw workflow scope injection respects native MCP additionalProperties:false and preserves accepted exact targets');
