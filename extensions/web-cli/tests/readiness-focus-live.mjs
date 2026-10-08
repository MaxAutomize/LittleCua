// Isolated real Pi/web/Cua integration. Only self-owned localhost pages are
// read/edited; no passport/account forms, submissions, or secrets are touched.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeWebSession} from './native-web-session.mjs';
const run=promisify(execFile),dir=mkdtempSync(join(tmpdir(),'web-ready-focus-')),name='Pi Readiness Focus Test '+process.pid;
const oldEnv={};for(const[k,v]of Object.entries({WEB_SESSION_FILE:join(dir,'session.env'),WEB_CACHE:join(dir,'cache'),WEB_SESSION_NAME:name})){oldEnv[k]=process.env[k];process.env[k]=v;}
let redirects=0;
const server=createServer((req,res)=>{
 res.setHeader('content-type','text/html');
 if(req.url==='/done'){redirects++;res.end('<!doctype html><title>Fixture Confirmation</title><h1>Fixture Confirmed</h1>');return;}
 res.end(`<!doctype html><title>Readiness Focus Fixture</title><h1>Self-owned test page</h1><button id="start" onclick="this.disabled=true;document.querySelector('#spinner').hidden=false;setTimeout(()=>{document.querySelector('#ready').hidden=false;document.querySelector('#later').disabled=false;document.querySelector('#spinner').hidden=true;},650)">Load next step</button><p id="spinner" hidden>Loading fixture</p><section id="ready" hidden>Ready for next step</section><input id="later" disabled value=""><button id="redirect" onclick="location.href='/done'">Confirm fixture</button>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const metadata=async()=>JSON.parse((await run('/usr/bin/osascript',['-l','JavaScript','-e',`JSON.stringify(Application('Google Chrome').windows().filter(w=>{try{return w.givenName()!==${JSON.stringify(name)}}catch{return true}}).map(w=>({id:String(w.id()),active:w.activeTabIndex(),tabs:w.tabs().map(t=>({id:String(t.id()),url:t.url()}))})))`])).stdout);
let h,priorApp='',priorChrome='',restoreFocus=false;const timings={};let checks=0;
const ok=r=>{checks++;assert.equal(r.isError,false,r.content?.map(b=>b.text||'').join('\n'));return r;};
try{
 const baseline=await metadata();
 priorApp=(await run('/usr/bin/osascript',['-e','tell application "System Events" to get name of first application process whose frontmost is true'])).stdout.trim();
 priorChrome=(await run('/usr/bin/osascript',['-l','JavaScript','-e',"String(Application('Google Chrome').windows()[0].id())"])).stdout.trim();
 h=await nativeWebSession({withCua:true});
 let start=performance.now();const opened=ok(await h.call({action:'nav',url:base+'/fixture',readAfter:'summary',foreground:true}));timings.openAndFocusMs=Math.round(performance.now()-start);
 assert.equal(opened.details.foreground.focused,true);const tab=opened.details.foreground.chromeTabId,window=opened.details.foreground.chromeWindowId;
 const actualFront=(await run('/usr/bin/osascript',['-l','JavaScript','-e',"JSON.stringify({window:String(Application('Google Chrome').windows()[0].id()),tab:String(Application('Google Chrome').windows()[0].activeTab().id())})"])).stdout;
 assert.deepEqual(JSON.parse(actualFront),{window,tab});checks++;
 start=performance.now();const batch=ok(await h.call({action:'sequence',steps:[{action:'click',selector:'#start'},{action:'wait',selector:'#ready',text:'Ready for next step',waitState:'visible',ms:5000,readAfter:'text'}]}));timings.clickAndConditionalWaitMs=Math.round(performance.now()-start);
 assert.equal(batch.details.results[1].details.readiness.ready,true);assert.match(batch.content[0].text,/Ready for next step/);checks++;
 const ready=ok(await h.call({action:'wait',selector:'#later',waitState:'enabled',ms:5000}));timings.alreadyReadyWaitMs=ready.details.readiness.waitedMs;assert.equal(ready.details.readiness.attempts,1);checks++;
 ok(await h.call({action:'sequence',steps:[{action:'fill',selector:'#later',value:'Fixture value'},{action:'wait',selector:'#later',value:'Fixture value',ms:5000},{action:'wait',selector:'#spinner',waitState:'hidden',ms:5000}]}));
 const redirected=ok(await h.call({action:'sequence',tab:base+'/fixture',steps:[{action:'click',selector:'#redirect'},{action:'wait',urlIncludes:'/done',text:'Fixture Confirmed',ms:5000}]}));
 assert.equal(redirected.details.pinnedTab,'tab:'+tab);checks++;
 const reread=ok(await h.call({action:'text',tab:base+'/fixture'}));assert.match(reread.details.stdout,/Fixture Confirmed/);assert.equal(redirects,1,'no confirmation replay');checks+=2;
 const focused=ok(await h.call({action:'focus',tab:'tab:'+tab}));assert.equal(focused.details.foreground.chromeTabId,tab);checks++;
 assert.equal(h.events.filter(e=>e.name==='cua_driver'&&e.parent).length,2,'foreground goes through two explicit nested Cua workflows, not raw MCP or per-step focus');checks++;
 assert.deepEqual(await metadata(),baseline,'original Chrome windows/tabs/URLs/active tabs are untouched');checks++;
 const report=join(homedir(),'Library/Application Support/LittleCua/reports',`readiness-focus-${new Date().toISOString().replaceAll(':','-')}.json`);mkdirSync(join(homedir(),'Library/Application Support/LittleCua/reports'),{recursive:true});
 writeFileSync(report,JSON.stringify({checks,timings,redirectSubmissions:redirects,originalTabsPreserved:true,scope:'Self-owned localhost fixture through actual Pi web_native and cua_driver pipeline. No model calls or account/form mutations. Local operation timings, not universal speed claims.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({report,checks,timings,originalTabsPreserved:true},null,2));
}finally{
 try{
  const front=(await run('/usr/bin/osascript',['-l','JavaScript','-e',`var a=Application('Google Chrome');try{a.windows()[0].givenName()===${JSON.stringify(name)}}catch(e){false}`])).stdout.trim();
  restoreFocus=front==='true';
 }catch{}
 await h?.close();
 await run('/usr/bin/osascript',['-l','JavaScript','-e',`var a=Application('Google Chrome');a.windows().filter(w=>{try{return w.givenName()===${JSON.stringify(name)}}catch{return false}}).forEach(w=>w.close());`]).catch(()=>{});
 if(restoreFocus&&priorApp){
  if(priorApp==='Google Chrome'&&priorChrome)await run('/usr/bin/osascript',['-l','JavaScript','-e',`var a=Application('Google Chrome');var w=a.windows().find(w=>String(w.id())===${JSON.stringify(priorChrome)});if(w){w.index=1;a.activate();}`]).catch(()=>{});
  else await run('/usr/bin/osascript',['-e',`tell application "System Events" to set frontmost of first application process whose name is ${JSON.stringify(priorApp)} to true`]).catch(()=>{});
 }
 server.closeAllConnections();await new Promise(r=>server.close(r));
 for(const[k,v]of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 rmSync(dir,{recursive:true,force:true});
}
