import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {default:extension}=await jiti.import('../native-workflow-speed.ts');
let tool; const calls=[];
const pi={registerTool:t=>tool=t,registerCommand(){},on(){},async exec(bin,args){
  calls.push({bin,args});
  if(args[0]==='dump-docs')return{code:0,stdout:JSON.stringify({mcp:{version:'fixture',tools:['list_windows','hotkey','get_window_state'].map(name=>({name,input_schema:{properties:{pid:{},window_id:{},keys:{}}}}))}}),stderr:''};
  if(args[0]==='status')return{code:0,stdout:'ready',stderr:''};
  if(args[0]==='call'){
    const data=args[1]==='list_windows'?{windows:[{pid:77,window_id:88,app_name:'Terminal',title:'pi running cua-driver',bounds:{x:0,y:0,width:800,height:600},is_on_screen:true}]}:
      {tree_markdown:'- AXApplication "Terminal"\n  - [0] AXWindow "pi running osascript" id=_NS:136 actions=[AXRaise]',element_count:1};
    return{code:0,stdout:JSON.stringify(data),stderr:''};
  }
  if(bin==='/usr/bin/osascript'){
    assert.equal(args.at(-1),'_NS:136','changed Terminal title must use the stable exact-window identity');
    assert.match(args[1],/value of attribute "AXIdentifier"/);
    assert.match(args[1],/key code 43 using \{command down\}/);
    return{code:0,stdout:'dispatched',stderr:''};
  }
  throw new Error('Unexpected invocation');
}};
extension(pi);
await tool.execute('terminal-settings',{action:'act',app:'Terminal',stepAction:'hotkey',keys:['cmd',',']});
assert.equal(calls.filter(c=>c.bin==='/usr/bin/osascript').length,1,'dispatch exactly once');
const snapshot=calls.find(c=>c.args[0]==='call'&&c.args[1]==='get_window_state');
assert.deepEqual(JSON.parse(snapshot.args[2]),{pid:77,window_id:88});
assert.equal(calls.filter(c=>c.args[0]==='call'&&c.args[1]==='hotkey').length,0);
console.log('PASS Terminal changing command title preserves exact stable AX window identity and one key dispatch');
