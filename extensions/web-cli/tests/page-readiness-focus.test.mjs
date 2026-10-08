import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {jiti} from '../../cua-tool/tests/pi-loader.mjs';
const {pageReadinessScript,waitForPage}=await jiti.import(new URL('../page-readiness.ts',import.meta.url).pathname);
const {focusChromeTarget}=await jiti.import(new URL('../native-focus.ts',import.meta.url).pathname);
const {default:extension}=await jiti.import(new URL('../index.ts',import.meta.url).pathname);
let element,hidden=false,disabled=false;
const saved={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
globalThis.document={readyState:'complete',title:'Fixture',body:{innerText:'Review confirmed'},querySelector:s=>{if(s==='[')throw new Error('bad selector');return element;}};
globalThis.location={href:'https://fixture.invalid/done'};
globalThis.getComputedStyle=()=>({visibility:hidden?'hidden':'visible',display:'block'});
const check=p=>JSON.parse(eval(pageReadinessScript(p)));
try{
 assert.equal(check({selector:'#next'}).ready,false);
 element={value:'SECRET_FIXTURE_VALUE',disabled:false,getClientRects:()=>[{}],getAttribute:()=>null,matches:()=>disabled};
 assert.equal(check({selector:'#next',text:'confirmed',urlIncludes:'/done',value:'SECRET_FIXTURE_VALUE'}).ready,true);
 assert.ok(!JSON.stringify(check({selector:'#next',value:'SECRET_FIXTURE_VALUE'})).includes('SECRET_FIXTURE_VALUE'),'wait returns match booleans, not field contents');
 hidden=true;assert.equal(check({selector:'#next'}).ready,false);assert.equal(check({selector:'#next',waitState:'hidden'}).ready,true);hidden=false;
 disabled=true;assert.equal(check({selector:'#next',waitState:'enabled'}).ready,false);disabled=false;assert.equal(check({selector:'#next',waitState:'enabled'}).ready,true);
 assert.equal(check({selector:'#next',waitState:'attached'}).ready,true);
 element=null;assert.equal(check({selector:'#next',waitState:'detached'}).ready,true);
 assert.match(check({selector:'['}).error,/predicate/);
 assert.throws(()=>pageReadinessScript({value:'x'}),/requires selector/);
 assert.throws(()=>pageReadinessScript({text:''}),/cannot be empty/);
 let probes=0;const r=await waitForPage(async()=>JSON.stringify({ready:++probes>=2}),{selector:'#next'},{budgetMs:100,pollMs:1});
 assert.equal(r.ready,true);assert.equal(probes,2);assert.ok(r.waitedMs<100);
 const timeout=await waitForPage(async()=>JSON.stringify({ready:false}),{selector:'#missing'},{budgetMs:8,pollMs:1});assert.equal(timeout.timedOut,true);
 const late=await waitForPage(async()=>{await delay(15);return '{"ready":true}';},{text:'ready'},{budgetMs:3});assert.equal(late.ready,false,'late readiness cannot claim in-budget success');
 const ctrl=new AbortController();ctrl.abort();probes=0;
 await assert.rejects(waitForPage(async()=>{probes++;return '{"ready":true}';},{text:'ready'},{budgetMs:100,signal:ctrl.signal}));assert.equal(probes,0);
 const mid=new AbortController();await assert.rejects(waitForPage(async()=>{mid.abort();return '{"ready":true}';},{text:'ready'},{budgetMs:100,signal:mid.signal}));
 await assert.rejects(waitForPage(async()=>'{bad',{text:'ready'},{budgetMs:100}),/Unrecognized/);
}finally{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
let tool,clicks=0,cuaCalls=0,rejectFocus=false,probeReady=true;const commands=[];
const ctx={tools:[{name:'cua_driver'}],executeTool:async(name,payload)=>{
 assert.equal(name,'cua_driver');assert.equal(payload.workflow.action,'program');assert.match(payload.workflow.script,/id of t as text/);cuaCalls++;
 return {isError:rejectFocus,result:{isError:rejectFocus,content:[{type:'text',text:rejectFocus?'permission denied':JSON.stringify({focused:true,chromeWindowId:'101',chromeTabId:'202'})}]}};
}};
const oldMode=process.env.WEB_TOOL_TRANSPORT;process.env.WEB_TOOL_TRANSPORT='cli';
try{
 extension({registerTool:t=>{tool=t;},registerCommand:()=>{},exec:async(binary,args)=>{
   commands.push(args);
   if(args[0]==='resolve')return{code:0,stdout:JSON.stringify({windowId:101,tabId:202,target:'tab:202',url:'https://fixture.invalid/form'}),stderr:''};
   if(args[2]==='click')clicks++;
   if(args[2]==='run')return{code:0,stdout:JSON.stringify({ready:probeReady,checks:[]}),stderr:''};
   return{code:0,stdout:'{"completed":true}',stderr:''};
 }});
 let r=await tool.execute('batch',{action:'sequence',foreground:true,steps:[{action:'click',selector:'#next'},{action:'value',selector:'#field'}]},undefined,undefined,ctx);
 assert.equal(r.isError,false);assert.equal(clicks,1);assert.equal(cuaCalls,1,'one endpoint focus, not one per step');
 rejectFocus=true;r=await tool.execute('focus-failure',{action:'click',selector:'#next',foreground:true},undefined,undefined,ctx);
 assert.equal(r.isError,true);assert.equal(r.details.pageActionCompleted,true);assert.equal(r.details.noReplay,true);assert.equal(clicks,2,'no mutation replay after focus failure');rejectFocus=false;
 const before=commands.length;r=await tool.execute('focus-only',{action:'focus'},undefined,undefined,ctx);
 assert.equal(r.isError,false);assert.equal(commands.length,before+1);assert.equal(commands.at(-1)[0],'resolve','focus-only never reads page content');
 r=await tool.execute('wait',{action:'wait',selector:'#next',readAfter:'summary',ms:100},undefined,undefined,ctx);
 assert.equal(r.isError,false);assert.equal(r.details.readiness.ready,true);assert.equal(commands.at(-1).at(-1),'summary');
 probeReady=false;const waiting={action:'wait',selector:'#late',ms:20};r=await tool.execute('not-ready',waiting,undefined,undefined,ctx);assert.equal(r.isError,true);
 probeReady=true;r=await tool.execute('now-ready',waiting,undefined,undefined,ctx);assert.equal(r.isError,false,'read-only waits never become blocked failed mutations');
 r=await tool.execute('missing-cua',{action:'click',selector:'#guard-check',foreground:true},undefined,undefined,{});assert.equal(r.isError,true);assert.match(r.content.map(b=>b.text||'').join('\n'),/registered cua_driver/);assert.equal(clicks,2);
}finally{if(oldMode===undefined)delete process.env.WEB_TOOL_TRANSPORT;else process.env.WEB_TOOL_TRANSPORT=oldMode;}
console.log('PASS conditional DOM waits, readiness deadlines/cancellation/privacy, one-call foreground through Cua, focus preflight, and no mutation replay');
