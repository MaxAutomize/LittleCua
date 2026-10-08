import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {default:extension}=await jiti.import('../native-workflow-speed.ts');
let tool; const calls=[];
const pi={registerTool:t=>tool=t,registerCommand(){},on(){},async exec(bin,args){
 if(args[0]==='dump-docs')return{code:0,stdout:JSON.stringify({mcp:{version:'fixture',tools:['list_windows','get_window_state'].map(name=>({name,input_schema:{properties:{pid:{},window_id:{}}}}))}}),stderr:''};
 if(args[0]==='status')return{code:0,stdout:'ready',stderr:''};
 if(args[0]==='call'){
  const name=args[1],payload=JSON.parse(args[2]);calls.push({name,payload});
  const data=name==='list_windows'?{windows:[{pid:77,window_id:99,app_name:'Terminal',title:'Profiles',is_on_screen:true}]}:
   {tree_markdown:payload.window_id===99?'[1] AXButton "Profiles"':'[0] AXWindow "pi running cua-driver"',element_count:1};
  return{code:0,stdout:JSON.stringify(data),stderr:''};
 }
 throw Error('Unexpected invocation '+bin);
}};
extension(pi);
await assert.rejects(tool.execute('handoff',{action:'sequence',pid:77,windowId:88,timeoutMs:1000,steps:[{action:'wait',query:'Profiles',waitMs:0}]}),error=>/different window.*Profiles.*windowId=99.*do not repeat.*pinned to windowId=88/s.test(error.message));
assert(calls.some(c=>c.name==='get_window_state'&&c.payload.window_id===99));
assert(!calls.some(c=>['click','hotkey'].includes(c.name)),'read-only discovery must not replay the shortcut or mutate another window');
console.log('PASS Terminal Preferences window handoff diagnostic, pinned targeting and no replay');
