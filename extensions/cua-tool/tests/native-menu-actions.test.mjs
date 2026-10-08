import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {default:extension}=await jiti.import('../native-workflow-speed.ts');
const {nativeClickAction}=await jiti.import('../native-capabilities.ts');
assert.equal(nativeClickAction('AXTextField','- AXTextField Basic actions=[AXShowMenu, AXConfirm]',true),'press','plain text-field clicks must not open Look Up/context menus');
assert.equal(nativeClickAction('AXStaticText','- AXStaticText Photo actions=[AXShowMenu]',true),'press','path labels need grounded mouse clicks, not contextual AXShowMenu');
assert.equal(nativeClickAction('AXMenuButton','- AXMenuButton Image actions=[AXShowMenu]',true),'show_menu');
assert.equal(nativeClickAction('AXMenuItem','- AXMenuItem Choose actions=[AXPick]',true),'pick');
let tool;const calls=[];
const tree='- [1] AXMenuItem "Choose…" actions=[AXCancel, AXPick]\n- [2] AXMenuButton "Image" actions=[AXShowMenu]';
const pi={registerTool:t=>tool=t,registerCommand(){},on(){},async exec(bin,args){
 if(args[0]==='dump-docs')return{code:0,stdout:JSON.stringify({mcp:{version:'fixture',tools:['click','get_window_state'].map(name=>({name,input_schema:{properties:{pid:{},window_id:{},element_index:{},action:{}}}}))}}),stderr:''};
 if(args[0]==='status')return{code:0,stdout:'ready',stderr:''};
 if(args[0]==='call'){calls.push({name:args[1],payload:JSON.parse(args[2])});return{code:0,stdout:JSON.stringify(args[1]==='get_window_state'?{tree_markdown:tree,element_count:2}:{ok:true}),stderr:''};}
 throw new Error('Unexpected mouse/native-script fallback '+bin);
}};
extension(pi);
await tool.execute('wide-menu',{action:'act',pid:77,windowId:88,stepAction:'click',query:'Choose…',exact:true});
await tool.execute('image-popup',{action:'act',pid:77,windowId:88,stepAction:'click',query:'Image',exact:true});
assert.deepEqual(calls.filter(c=>c.name==='click').map(c=>c.payload),[
 {pid:77,window_id:88,element_index:1,action:'pick'},
 {pid:77,window_id:88,element_index:2,action:'show_menu'}
]);
console.log('PASS native AXPick/AXShowMenu semantic actions avoid out-of-window menu-center mouse fallback; one dispatch each');
