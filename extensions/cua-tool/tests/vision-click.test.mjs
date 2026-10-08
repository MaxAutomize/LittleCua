import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { jiti } from './pi-loader.mjs';
const { default: nativeWorkflowExtension } = await jiti.import('../native-workflow-speed.ts');
const { selectNativeVisionText } = await jiti.import('../native-vision-click.ts');

const snapshot={width:1444,height:1548,rows:[
  {text:'Save changes before closing?',confidence:.97,x:420,y:735,width:440,height:30},
  {text:"Don't Save",confidence:.96,x:415,y:840,width:210,height:45},
  {text:'Save',confidence:.99,x:930,y:840,width:206,height:45},
]};
assert.deepEqual(selectNativeVisionText(snapshot,'Dont Save','Save changes before closing?'),{x:520,y:863,confidence:.96});
assert.throws(()=>selectNativeVisionText(snapshot,'Save','Wrong confirmation'),/context/);
assert.throws(()=>selectNativeVisionText({...snapshot,rows:[...snapshot.rows,snapshot.rows[1]]},"Don't Save",'Save changes before closing?'),/Ambiguous/);
assert.throws(()=>selectNativeVisionText(snapshot,'Close','Save changes before closing?'),/not found/);

const names=['list_windows','get_window_state','click','screenshot'];
const docs={mcp:{version:'fixture',tools:names.map(name=>({name,input_schema:{properties:{pid:{},window_id:{},x:{},y:{}}}}))}};
async function harness({missingContext=false,ambiguous=false,windowCloses=true}={}) {
 let tool,clicks=0,ocrCalls=0,axCalls=0;
 const calls=[];
 const pi={registerTool(def){tool=def},registerCommand(){},on(){},async exec(_bin,args){
  if(args[0]==='status')return {code:0,stdout:'ok',stderr:''};
  if(args[0]==='dump-docs')return {code:0,stdout:JSON.stringify(docs),stderr:''};
  if(_bin==='/usr/bin/swift'){
   ocrCalls++;const rows=missingContext?snapshot.rows.slice(1):ambiguous?[...snapshot.rows,snapshot.rows[1]]:snapshot.rows;
   return {code:0,stdout:JSON.stringify({...snapshot,rows}),stderr:''};
  }
  if(args[0]!=='call')throw new Error('unexpected invocation '+args.join(' '));
  const name=args[1],payload=JSON.parse(args[2]);calls.push({name,payload});
  if(name==='list_windows')return {code:0,stdout:JSON.stringify({windows:clicks&&windowCloses?[]:[{pid:77,window_id:88,title:'* Sample.blend',app_name:'Blender',is_on_screen:true,on_current_space:true,bounds:{x:0,y:30,width:722,height:774}}]}),stderr:''};
  if(name==='get_window_state'){axCalls++;return {code:0,stdout:JSON.stringify({tree_markdown:'- [0] AXWindow "Sample"',element_count:1}),stderr:''}}
  if(name==='screenshot'){
   const path=args[args.indexOf('--screenshot-out-file')+1];
   const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
   await fs.writeFile(path,png);return {code:0,stdout:'{}',stderr:''};
  }
  if(name==='click'){clicks++;return {code:0,stdout:'{"clicked":true}',stderr:''};}
  return {code:0,stdout:'{}',stderr:''};
 }};
 nativeWorkflowExtension(pi);
 return {tool,calls,get clicks(){return clicks},get ocrCalls(){return ocrCalls},get axCalls(){return axCalls}};
}
const params={action:'sequence',pid:77,windowId:88,timeoutMs:8000,steps:[{action:'vision_click',query:"Don't Save",within:'Save changes before closing?',expectWindowClosed:true}]};
const good=await harness();const result=await good.tool.execute('vision-test',params);
assert.equal(result.details.dispatchState,'verified');
assert.equal(good.clicks,1,'exactly one click; no replay');
assert.equal(good.ocrCalls,1,'capture and OCR are internal to one workflow call');
assert.equal(good.axCalls,0,'unexposed custom Blender modal needs no AX retry loop');
assert.deepEqual(good.calls.find(c=>c.name==='click').payload,{pid:77,window_id:88,x:520,y:863,count:1});
assert.match(result.content[0].text,/1 step/);
for(const options of [{missingContext:true},{ambiguous:true}]) {
 const bad=await harness(options);
 await assert.rejects(bad.tool.execute('vision-rejected',params),/No click dispatched|Ambiguous|context/);
 assert.equal(bad.clicks,0,'missing or ambiguous visual evidence fails before mutation');
}
const stillOpen=await harness({windowCloses:false});
await assert.rejects(stillOpen.tool.execute('vision-not-closed',{...params,steps:[{...params.steps[0],waitMs:150}]}),/did not close/);
assert.equal(stillOpen.clicks,1,'a possibly dispatched click is never retried automatically');
console.log('PASS explicit one-call native OCR click, unique context, fail-closed predispatch, one-dispatch endpoint verification');
