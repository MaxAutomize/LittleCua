import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {mergeElevatedNativeWindows}=await jiti.import('../native-window-catalog.ts');
const {default:extension}=await jiti.import('../native-workflow-speed.ts');
const panel={pid:77,window_id:88,title:'Open',app_name:'Panel Fixture',layer:8,is_on_screen:true,bounds:{x:100,y:100,width:880,height:448}};
const main={...panel,window_id:89,title:'Main',layer:0};
assert.deepEqual(mergeElevatedNativeWindows([main],[panel,panel,{...panel,pid:99},{...panel,window_id:90,title:''}],77),[main,panel]);
assert.deepEqual(mergeElevatedNativeWindows([panel],[{...panel,title:'changed'}],77),[panel],'existing native records remain authoritative');
let tool;const calls=[];
const pi={registerTool:t=>tool=t,registerCommand(){},on(){},async exec(bin,args){
 calls.push({bin,args});
 if(args[0]==='dump-docs')return{code:0,stdout:JSON.stringify({mcp:{version:'fixture',tools:['list_windows','get_window_state','hotkey'].map(name=>({name,input_schema:{properties:{pid:{},window_id:{},keys:{}}}}))}}),stderr:''};
 if(args[0]==='status')return{code:0,stdout:'ready',stderr:''};
 if(bin==='/usr/bin/swift')return{code:0,stdout:JSON.stringify([panel]),stderr:''};
 if(args[0]==='call')return{code:0,stdout:JSON.stringify(args[1]==='list_windows'?{windows:[main]}:{tree_markdown:'- AXApplication "Panel Fixture"\n  - [0] AXWindow "Open" id=open-panel actions=[AXRaise]',element_count:1}),stderr:''};
 if(bin==='/usr/bin/osascript'){
   assert.equal(args.at(-1),'open-panel');
   assert.match(args[1],/key code 5 using \{command down, shift down\}/);
   return{code:0,stdout:'dispatched',stderr:''};
 }
 throw new Error('Unexpected invocation');
}};
extension(pi);
const r=await tool.execute('file-panel',{action:'act',app:'Panel Fixture',windowTitle:'Open',launchIfNeeded:false,stepAction:'hotkey',keys:['cmd','shift','g']});
assert.equal(r.details.target.windowId,88);
assert.equal(calls.filter(c=>c.bin==='/usr/bin/swift').length,1,'supplement a definite title miss once, not every regular window call');
assert.equal(calls.filter(c=>c.bin==='/usr/bin/osascript').length,1);
assert.equal(calls.filter(c=>c.args[0]==='call'&&c.args[1]==='hotkey').length,0,'file panels must not receive the ignored postToPid route');
calls.length=0;
await tool.execute('ordinary',{action:'act',pid:77,windowId:89,app:'Panel Fixture',stepAction:'hotkey',keys:['ctrl','f4']});
assert.equal(calls.filter(c=>c.args[0]==='call'&&c.args[1]==='hotkey').length,1,'ordinary shortcuts preserve the native route');
assert.equal(calls.some(c=>c.bin==='/usr/bin/swift'),false);
console.log('PASS elevated layer-8 panel discovery, dedupe/filtering, exact real file-panel shortcut, and unchanged ordinary native routing');
