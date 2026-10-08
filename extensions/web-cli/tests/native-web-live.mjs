import assert from 'node:assert/strict';import{createServer}from'node:http';import{mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync}from'node:fs';import{tmpdir,homedir}from'node:os';import{join}from'node:path';import{promisify}from'node:util';import{execFile}from'node:child_process';
import{nativeWebSession}from'./native-web-session.mjs';import{jiti}from'../../cua-tool/tests/pi-loader.mjs';
const run=promisify(execFile),dir=mkdtempSync(join(tmpdir(),'pi-web-mcp-live-')),name='Pi Web MCP Test '+process.pid;
const oldEnv={};for(const[k,v]of Object.entries({WEB_SESSION_FILE:join(dir,'session.env'),WEB_CACHE:join(dir,'cache'),WEB_SESSION_NAME:name})){oldEnv[k]=process.env[k];process.env[k]=v}
const oracle=[];
const server=createServer((req,res)=>{
 if(req.url==='/oracle'){let body='';req.on('data',x=>body+=x);req.on('end',()=>{oracle.push(JSON.parse(body));res.end('ok')});return}
 if(req.url==='/fixture.js'){res.setHeader('content-type','application/javascript');res.end(`window.state={clicks:0,inputs:0,submits:0}; const report=()=>{document.documentElement.dataset.clicks=String(state.clicks);return fetch('/oracle',{method:'POST',body:JSON.stringify({path:location.pathname,...state,value:document.querySelector('#field').value})})};document.querySelector('#increment').onclick=()=>{state.clicks++;report()};document.querySelector('#field').oninput=()=>{state.inputs++;report()};document.querySelector('form').onsubmit=e=>{e.preventDefault();state.submits++;report()};`);return}
 if(req.url==='/cart.js'){res.setHeader('content-type','application/json');res.end(JSON.stringify({item_count:1,total_price:500,items:[{title:'Fixture',quantity:1,price:500}]}));return}
 res.setHeader('content-type','text/html');if(req.url==='/csp')res.setHeader('Content-Security-Policy',"script-src 'self'");
 res.end(`<!doctype html><html><head><title>Pi MCP Fixture ${req.url}</title></head><body><h1>Native Web Fixture</h1><a href='/second' id='link'>Second page</a><form><label>Name<input id='field' name='name'></label><select id='choice'><option value='a'>Alpha</option><option value='b'>Beta</option></select><button id='increment' type='button'>Increment</button><button id='submit' type='submit'>Send fixture</button><button id='disabled' type='button' disabled>Disabled</button></form><p id='text'>Fixture content only.</p><script src='/fixture.js'></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let h,prior='',windowId,legacy;let assertions=0;const checks=[],benchmarks={};
const equal=(a,b,m)=>{assertions++;assert.deepEqual(a,b,m??`Actual ${JSON.stringify(a)}; expected ${JSON.stringify(b)}`)};const ok=r=>{assertions++;assert.ok(!r.isError,r.content?.map(x=>x.text).join('\n'));return r};
const val=r=>r.details.stdout;const js=async code=>val(ok(await h.call({action:'run',javascript:code==='state.clicks'?"document.documentElement.dataset.clicks||'0'":code})));
const snapshot=async()=>JSON.parse((await run('/usr/bin/osascript',['-l','JavaScript','-e',`JSON.stringify(Application('Google Chrome').windows().filter(w=>{try{return w.givenName()!==${JSON.stringify(name)}}catch{return true}}).map(w=>({id:w.id(),active:w.activeTabIndex(),tabs:w.tabs().map(t=>({id:t.id(),url:t.url()}))})))`])).stdout);
let baseline;
try{
 baseline=await snapshot();prior=(await run('/usr/bin/osascript',['-e','tell application "System Events" to get name of first application process whose frontmost is true'])).stdout.trim();
 h=await nativeWebSession();
 ok(await h.call({action:'nav',url:base+'/first',readAfter:'summary'}));
 checks.push('fresh named session creation and initial navigation');
 const session=ok(await h.call({action:'session'}));const info=JSON.parse(val(session));windowId=info.windowId;
 console.log('Fixture setup',windowId,info.tabId);
 const warm=ok(await h.call({action:'title'}));assert.match(val(warm),/Pi MCP Fixture/);equal(warm.details.transport.mcpCalls,1);checks.push('cold target identity bound on exact fixture tab');
 const title=ok(await h.call({action:'title'}));equal(title.details.transport.compatibilityCommands,[],'warm title does not launch web or cua CLI');checks.push('warm DOM has no CLI calls');
 for(const p of [{action:'summary'},{action:'text'},{action:'find',selector:'input'},{action:'find-text',text:'Increment'},{action:'find-links'},{action:'find-buttons'},{action:'find-inputs'},{action:'exists',selector:'#field'},{action:'cart'}])ok(await h.call(p));checks.push('all discovery helpers and cart');
 const batch=ok(await h.call({action:'sequence',steps:[{action:'fill',selector:'#field',value:'naïve 東京 "test" \\ line'},{action:'select',selector:'#choice',value:'Beta'},{action:'click-text',text:'Increment'},{action:'value',selector:'#field'}]}));equal(batch.details.transport.compatibilityCommands,[]);equal(batch.details.completedSteps,4);
 equal(await js('document.querySelector("#field").value'),'naïve 東京 "test" \\ line');equal(await js('document.querySelector("#choice").value'),'b');equal(await js('state.clicks'), '1');checks.push('Unicode fill, ranked click, select and batched readback');
 const main=ok(await h.call({action:'run-main',javascript:'JSON.stringify({mainWorld:!!window.state,clicks:state.clicks})'}));equal(JSON.parse(val(main)),{mainWorld:true,clicks:1});checks.push('page-owned main-world JavaScript');
 const denied=await h.call({action:'click',selector:'#disabled'});equal(denied.isError,true);equal(await js('state.clicks'),'1');
 await js('globalThis.once=0');ok(await h.call({action:'run',javascript:'void (globalThis.once++)'}));equal(await js('globalThis.once'),'1');checks.push('undefined JS result executes exactly once');
 const long=ok(await h.call({action:'run',javascript:'"x".repeat(60000)'}));equal(long.details.stdout.length,60000);checks.push('full post-hook structured MCP result preserved beyond text truncation');
 h.block(true);const before=h.commands.length;const blocked=await h.call({action:'click',selector:'#increment'});equal(blocked.isError,true);equal(h.commands.length,before,'blocked mutation never falls back to shell');h.block(false);equal(await js('state.clicks'),'1');checks.push('real native Pi permission hook blocks without CLI fallback');
 // Simulate a human switching another tab within the dedicated TEST window.
 const remembered=JSON.parse(val(ok(await h.call({action:'session'})))).tabId;
 const other=(await run('/usr/bin/osascript',['-l','JavaScript','-e',`var a=Application('Google Chrome'),w=a.windows.byId(${windowId});var t=a.Tab({url:${JSON.stringify(base+'/other')}});w.tabs.push(t);w.activeTabIndex=w.tabs().length;String(w.tabs()[w.tabs().length-1].id());`])).stdout.trim();
 ok(await h.call({action:'title'})); // binding activates remembered tab, establishes identity
 await run('/usr/bin/osascript',['-l','JavaScript','-e',`var w=Application('Google Chrome').windows.byId(${windowId});w.activeTabIndex=w.tabs().findIndex(t=>String(t.id())===${JSON.stringify(other)})+1;`]);
 const repair=ok(await h.call({action:'click-text',text:'Increment',tags:'button'}));equal(repair.details.transport.identityRepairs,1);equal(await js('state.clicks'),'2');
 const inactive=ok(await h.call({action:'run',tab:`tab:${other}`,javascript:"document.documentElement.dataset.clicks||'0'"}));equal(val(inactive),'0');equal(inactive.details.transport.mcpCalls,0);checks.push('wrong active tab rejected before action; remembered target repaired; inactive tab unchanged');
 const nav=ok(await h.call({action:'nav',url:base+'/second',readAfter:'summary'}));assert.match(val(nav),/second/);checks.push('navigation/readiness/readAfter and document identity renewal');
 const missing=await h.call({action:'sequence',steps:[{action:'click',selector:'#missing'},{action:'click',selector:'#increment'}]});equal(missing.isError,true);equal(missing.details.completedSteps,1);equal(await js('state.clicks'),'0');checks.push('sequence stops at first error');
 await h.transports[0].close();ok(await h.call({action:'title'}));checks.push('native MCP reconnect read');
 // Shared lock/cancellation prevents an unrelated operation from entering a batch.
 const wait=h.call({action:'sequence',steps:[{action:'sleep',ms:350},{action:'title'}]});await new Promise(r=>setTimeout(r,30));const ctrl=new AbortController();const queued=h.call({action:'click',selector:'#increment'},ctrl.signal);ctrl.abort();equal((await queued).isError,true);ok(await wait);equal(await js('state.clicks'),'0');checks.push('same-session lease covers sequence and queued cancellation');
 ok(await h.call({action:'nav',url:base+'/csp',readAfter:'none'}));ok(await h.call({action:'fill',selector:'#field',value:'CSP fallback'}));equal(await js('document.querySelector("#field").value'),'CSP fallback');checks.push('strict CSP fill only falls back after confirmed inline non-execution');
 ok(await h.call({action:'nav',url:base+'/first',readAfter:'none'}));
 // Preserve special trusted input route. Only our fixture field is typed into.
 ok(await h.call({action:'type',selector:'#field',value:'Trusted fixture typing',key:'tab'}));equal(await js('document.querySelector("#field").value'),'Trusted fixture typing');checks.push('trusted keyboard compatibility');
 const timed=await h.call({action:'sleep',ms:1000,timeoutMs:20});equal(timed.isError,true);assert.match(timed.content[0].text,/timeout/);checks.push('fixed sleep honors native operation deadline');
 // Warm, interleaved, same wrapper/page; CLI remains a deliberate control.
 const{default:extension}=await jiti.import(new URL('../index.ts',import.meta.url).pathname);
 const shell=async(cmd,args,opts)=>{try{return{code:0,...await run(cmd,args,{...opts,maxBuffer:8*1024*1024})}}catch(e){return{code:e.code||1,stdout:e.stdout||'',stderr:e.stderr||e.message}}};
 extension({exec:shell,registerTool:t=>legacy=t});const cli=async p=>legacy.execute('legacy',p,undefined,undefined,{});
 const cases={title:{action:'title'},summary:{action:'summary'},field_value:{action:'value',selector:'#field'},navigation:{action:'nav',url:base+'/navigation',readAfter:'summary'},four_step_batch:{action:'sequence',steps:[{action:'fill',selector:'#field',value:'benchmark'},{action:'select',selector:'#choice',value:'Beta'},{action:'value',selector:'#field'},{action:'title'}]}};
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 for(const[k,p]of Object.entries(cases)){ok(await cli(p));ok(await h.call(p));const native=[],old=[];for(let i=0;i<12;i++)for(const kind of i%2?['old','native']:['native','old']){const request=k==='navigation'?{...p,url:base+'/navigation?turn='+i+'&path='+kind}:p;if(k==='navigation'&&kind==='native')ok(await h.call({action:'title'}));const start=performance.now();const r=ok(await(kind==='native'?h.call(request):cli(request)));(kind==='native'?native:old).push(performance.now()-start);if(kind==='native')equal(r.details.transport.compatibilityCommands,k==='navigation'?['run']:[])}benchmarks[k]={samples:12,nativeMedianMs:median(native),cliMedianMs:median(old),reductionPercent:100*(1-median(native)/median(old)),native,cli:old}}
 equal(await snapshot(),baseline,'pre-existing user Chrome windows/tabs/URLs/active tabs preserved');checks.push('all pre-existing user Chrome tabs preserved');
 assert.ok(oracle.some(e=>e.clicks===2&&e.path==='/first'));checks.push('independent local server event oracle');
 const report=join(homedir(),'Library/Application Support/LittleCua/reports',`native-web-mcp-${new Date().toISOString().replaceAll(':','-')}.json`);mkdirSync(join(homedir(),'Library/Application Support/LittleCua/reports'),{recursive:true});writeFileSync(report,JSON.stringify({at:new Date().toISOString(),checks,assertions,benchmarks,scope:'Warm interleaved same-fixture local wrapper timings, real Pi nested MCP pipeline; no model/network latency. Exact inactive tabs/trusted input/tab management remain preselected compatibility routes.'},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({report,assertions,checks,benchmarks:Object.fromEntries(Object.entries(benchmarks).map(([k,{native,cli,...v}])=>[k,v]))},null,2));
}finally{
 await h?.close();
 // Close ONLY the named self-owned test window (never whichever window is frontmost).
 await run('/usr/bin/osascript',['-l','JavaScript','-e',`var a=Application('Google Chrome');a.windows().filter(w=>{try{return w.givenName()===${JSON.stringify(name)}}catch{return false}}).forEach(w=>w.close());`]).catch(()=>{});
 if(prior)await run('/usr/bin/osascript',['-e',`tell application "System Events" to set frontmost of first application process whose name is ${JSON.stringify(prior)} to true`]).catch(()=>{});
 server.closeAllConnections();await new Promise(r=>server.close(r));
 for(const[k,v]of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 rmSync(dir,{recursive:true,force:true});
}
