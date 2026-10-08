// Local self-owned fixture, real native MCP hooks, and interleaved legacy/MCP benchmarks.
// No model calls and no user documents. Only this fixture is typed/clicked/captured.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeMcpSession} from './native-mcp-session.mjs';
import {jiti} from './pi-loader.mjs';
const run=promisify(execFile),bin='/Applications/CuaDriver.app/Contents/MacOS/cua-driver';
const dir=mkdtempSync(join(tmpdir(),'cua-mcp-live-')),oracle=join(dir,'oracle.json'),binary=join(dir,'fixture');
const shell=async(cmd,args,opts={})=>{try{const r=await run(cmd,args,{...opts,maxBuffer:16*1024*1024});return{code:0,...r}}catch(e){return{code:e.code||1,stdout:e.stdout||'',stderr:e.stderr||e.message,killed:!!e.killed}}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
let h,child,prior='';
const measurements={};
try{
 prior=(await run('/usr/bin/osascript',['-e','tell application "System Events" to get name of first application process whose frontmost is true'])).stdout.trim();
 await run('xcrun',['swiftc',join(dirname(fileURLToPath(import.meta.url)),'native-fixture.swift'),'-o',binary],{timeout:120000});
 child=spawn(binary,['--oracle-path',oracle],{stdio:'ignore'});
 h=await nativeMcpSession();
 let target;
 for(let i=0;i<60;i++){const r=await h.call({action:'list_windows',pid:child.pid,onScreenOnly:true});target=JSON.parse(r.details.stdout).windows.find(w=>w.title==='LittleCua Fixture A');if(target)break;await sleep(100)}
 assert.ok(target,'owned fixture target');
 const {default:extension}=await jiti.import('../index.ts');let legacy;
 extension({registerTool:t=>legacy=t,exec:shell});
 let seq=0;
 const cli=async p=>legacy.execute(`legacy-benchmark-${++seq}`,p,undefined,undefined,{model:{input:['image','text']}});
 const ok=r=>{assert.ok(!r.isError,r.content?.[0]?.text);return r};
 // Verify actual image bytes reach the wrapper through native MCP (not just a path).
 const picture=ok(await h.call({action:'screenshot',pid:target.pid,windowId:target.window_id}));
 assert.ok(picture.content.some(b=>b.type==='image'),JSON.stringify(picture));assert.equal(picture.details.transport.driverCliCalls,0);assert.equal(picture.details.temporaryImageRemoved,true);
 const post=ok(await h.call({action:'workflow',workflow:{action:'sequence',pid:target.pid,windowId:target.window_id,steps:[{action:'inspect',query:'Grid A1'}]},screenshotAfter:true}));
 assert.ok(post.content.some(b=>b.type==='image'));assert.equal(post.details.transport.driverCliCalls,1,'one cold capability discovery only');
 // Exercise Pi's actual permission hook; rejection must not dispatch or fall back.
 const before=JSON.parse(readFileSync(oracle,'utf8')).windows.find(w=>w.title===target.title).submitCount;
 const ax=ok(await h.call({action:'window_state',pid:target.pid,windowId:target.window_id}));
 const line=JSON.parse(ax.details.stdout).tree_markdown.split('\n').find(l=>l.includes('(Fixture Submit)'));
 const index=Number(line.match(/\[(\d+)\]/)?.[1]);assert.ok(Number.isFinite(index),line);
 h.block('mcp__cua_native__click');
 const denied=await h.call({action:'click',pid:target.pid,windowId:target.window_id,elementIndex:index});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/permission gate/i);
 h.block(undefined);
 assert.equal(JSON.parse(readFileSync(oracle,'utf8')).windows.find(w=>w.title===target.title).submitCount,before);
 // Connection loss must NOT silently reuse an old process's AX index.
 await h.transports[0].close();
 const stale=await h.call({action:'tool',tool:'click',jsonArgs:{pid:target.pid,window_id:target.window_id,element_index:index}});
 assert.equal(stale.isError,true,'fresh server has no old AX snapshot');
 assert.equal(JSON.parse(readFileSync(oracle,'utf8')).windows.find(w=>w.title===target.title).submitCount,before);
 ok(await h.call({action:'window_state',pid:target.pid,windowId:target.window_id}));
 assert.equal(h.cli.filter(([,a])=>a[0]==='call').length,0);
 // Warm legacy daemon; compared variants use identical wrapper + fixture targets.
 const cases={
  screen_size:{action:'screen_size'},
  list_windows:{action:'list_windows',pid:target.pid,onScreenOnly:true},
  ax_snapshot:{action:'window_state',pid:target.pid,windowId:target.window_id},
  screenshot:{action:'screenshot',pid:target.pid,windowId:target.window_id,returnImage:false},
  four_field_batch:{action:'workflow',workflow:{action:'sequence',pid:target.pid,windowId:target.window_id,steps:['A1','B1','C1','D1'].map(query=>({action:'set_value',query:`Grid ${query}`,role:'TextField',value:'MCP benchmark'}))}},
 };
 for(const [name,p]of Object.entries(cases)){
  ok(await cli(p));ok(await h.call(p));const mcp=[],cliMs=[];const n=name==='screenshot'?8:16;
  for(let i=0;i<n;i++){
   for(const kind of i%2?['cli','mcp']:['mcp','cli']){
    const t=performance.now();const result=ok(await(kind==='mcp'?h.call(p):cli(p)));(kind==='mcp'?mcp:cliMs).push(performance.now()-t);
    if(kind==='mcp')assert.equal(result.details.transport.driverCliCalls,0);
   }
  }
  measurements[name]={samples:n,nativeMcpMedianMs:median(mcp),legacyCliMedianMs:median(cliMs),reductionPercent:100*(1-median(mcp)/median(cliMs)),mcp,cli:cliMs};
 }
 const data=JSON.parse(readFileSync(oracle,'utf8')).windows.find(w=>w.title===target.title);
 for(const key of ['A1','B1','C1','D1'])assert.equal(data.cells[key],'MCP benchmark');
 const reportDir=join(homedir(),'Library/Application Support/LittleCua/reports');mkdirSync(reportDir,{recursive:true});
 const path=join(reportDir,`native-mcp-latency-${new Date().toISOString().replaceAll(':','-')}.json`);
 writeFileSync(path,JSON.stringify({at:new Date().toISOString(),driverVersion:'0.1.4',scope:'Interleaved warm local wrapper calls. Real Pi native MCP nested pipeline. Legacy daemon warmed. Model/network latency excluded; not a general computer-use speed guarantee.',checks:['native image delivery','post-action capture','real permission hook rejection','stale AX index rejected after reconnect','no per-operation CLI','fixture oracle final state'],measurements},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({reportPath:path,measurements:Object.fromEntries(Object.entries(measurements).map(([k,{mcp,cli,...v}])=>[k,v])),nativeCalls:h.events.length,perOperationCliCalls:h.cli.filter(([,a])=>a[0]==='call').length},null,2));
}finally{
 await h?.close();if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2000)]);if(child.exitCode===null)child.kill('SIGKILL')}
 if(prior)await shell('/usr/bin/osascript',['-e',`tell application "System Events" to set frontmost of first application process whose name is ${JSON.stringify(prior)} to true`]);
 rmSync(dir,{recursive:true,force:true});
}
