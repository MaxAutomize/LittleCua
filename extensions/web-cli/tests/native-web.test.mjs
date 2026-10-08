import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,mkdirSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';
import{jiti}from'../../cua-tool/tests/pi-loader.mjs';
const {createWebMcpTransport,parseNumericState}=await jiti.import(new URL('../native-mcp-transport.ts',import.meta.url).pathname);
const {domScript,guardedScript,decodePageResult}=await jiti.import(new URL('../native-dom.ts',import.meta.url).pathname);
const {acquireWebLease}=await jiti.import(new URL('../native-session-lock.ts',import.meta.url).pathname);
const dir=mkdtempSync(join(tmpdir(),'native-web-unit-')),session=join(dir,'session.env'),cache=join(dir,'cache'),binary=process.env.WEB_CLI_PATH||new URL('../../../scripts/web',import.meta.url).pathname;
const calls=[],legacy=[],commands={};let deny=false,throwAfter=false,changes=0,hookDelay=0,pageValue='ok',trustedCode=0;
const pi={registerMcpServer:(n,c)=>{assert.equal(n,'web_native');assert.deepEqual(c.args,['mcp'])},registerCommand:(n,c)=>commands[n]=c,exec:async(cmd,args)=>{
 legacy.push({cmd,args});
 const at=args.indexOf(binary),a=args.slice(at+1);
 if(a[0]==='auto'){writeFileSync(session,'CHROME_WINDOW_ID=1\nCHROME_TAB_ID=2\n');writeFileSync(cache,'WEB_PID=3; export WEB_PID; WEB_WID=4; export WEB_WID; WEB_CHROME_WINDOW_ID=1; export WEB_CHROME_WINDOW_ID; WEB_CHROME_TAB_ID=2; export WEB_CHROME_TAB_ID\n');return{code:0,stdout:'cached',stderr:''}}
 if(a[2]==='run')return{code:0,stdout:'{"bound":true}',stderr:''};
 if(a[2]?.startsWith('trusted-click'))return{code:trustedCode,stdout:trustedCode?'':'{"clicked":true,"trusted":true}',stderr:trustedCode?'native input rejected; no replay':''};
 return{code:0,stdout:'compatibility',stderr:''};
}};
const t=createWebMcpTransport(pi,binary,{mode:'mcp',sessionFile:session,cacheFile:cache,settingsPath:join(dir,'settings.json')});
const ctx={tools:[{name:'mcp__web_native__page'}],executeTool:async(name,payload,{signal})=>{
 calls.push({name,payload});if(hookDelay)await new Promise(r=>signal.addEventListener('abort',r,{once:true}));
 if(deny)return{isError:true,result:{content:[{type:'text',text:'permission denied'}]}};
 if(throwAfter)throw new Error('transport failed after possibly dispatched');
 const data=changes-->0?{__piWeb:1,targetChanged:true,dispatched:false}:{__piWeb:1,ok:true,defined:true,value:pageValue};
 return{isError:false,result:{structuredContent:{content:[{type:'text',text:'## Result\n\n```\n'+JSON.stringify(data)+'\n```'}]},content:[]}};
}};
const tool=t.wrap({execute:async(_id,p,s)=>({content:[],details:{r:await t.api.exec(binary,['--tab',p.tab??'session',p.action,...(p.args??[])],{signal:s,timeout:p.timeout??500})}})});
const call=(p={},signal)=>tool.execute('test', {action:'title',...p},signal,null,ctx);
try{
 assert.deepEqual(parseNumericState('CHROME_WINDOW_ID=1\nCHROME_TAB_ID=2\nEVIL=$(touch /tmp/no)\n'),{CHROME_WINDOW_ID:1,CHROME_TAB_ID:2});
 let r=await call();assert.equal(r.details.r.stdout,'ok');assert.equal(r.details.transport.mcpCalls,1);assert.equal(legacy.length,2);
 r=await call();assert.equal(legacy.length,2,'warm actions spawn neither web nor cua CLI');
 changes=1;r=await call({action:'click',args:['#x']});assert.equal(r.details.transport.identityRepairs,1);assert.equal(r.details.transport.mcpCalls,2);
 const count=legacy.length;deny=true;r=await call({action:'click',args:['#x']});assert.equal(r.details.r.code,1);assert.equal(legacy.length,count,'blocked call has no fallback');deny=false;
 throwAfter=true;const before=calls.length;r=await call({action:'click',args:['#x']});assert.equal(calls.length,before+1);assert.equal(r.details.r.code,1);assert.equal(legacy.length,count);throwAfter=false;
 r=await call({action:'title',tab:'tab:99'});assert.equal(r.details.transport.mcpCalls,0);assert.equal(r.details.transport.compatibilityCommands[0],'title');
 r=await call({action:'type',args:['#x','hello']});assert.equal(r.details.transport.mcpCalls,0);assert.equal(r.details.transport.compatibilityCommands[0],'type');
 // USPS FullCalendar slot: route BEFORE clicking, pin the same exact tab,
 // use real pointer/focus input once, and never retry its failed dispatch.
 pageValue=JSON.stringify({requiresTrustedClick:true,dispatched:false,reason:'fullcalendar-slot-pointer'});
 let nativeBefore=calls.length,legacyBefore=legacy.length;
 r=await call({action:'click',args:['tr[data-time="13:45:00"] .availableAppointment']});
 assert.equal(calls.length,nativeBefore+1);assert.equal(legacy.length,legacyBefore+1);
 assert.deepEqual(legacy.at(-1).args.slice(-4),['--tab','tab:2','trusted-click','tr[data-time="13:45:00"] .availableAppointment']);
 assert.deepEqual(r.details.transport.compatibilityCommands,['trusted-click']);assert.equal(r.details.r.code,0);
 r=await call({action:'click-text',args:['Appointment Available','p']});
 assert.deepEqual(legacy.at(-1).args.slice(-5),['--tab','tab:2','trusted-click-text','Appointment Available','p']);
 trustedCode=1;nativeBefore=calls.length;legacyBefore=legacy.length;
 r=await call({action:'click',args:['#slot']});assert.equal(r.details.r.code,1);
 assert.equal(calls.length,nativeBefore+1);assert.equal(legacy.length,legacyBefore+1,'no replay after native pointer rejection');trustedCode=0;
 pageValue=JSON.stringify({requiresTrustedClick:true,dispatched:true,reason:'fullcalendar-slot-pointer'});
 legacyBefore=legacy.length;r=await call({action:'click',args:['#slot']});assert.equal(legacy.length,legacyBefore,'possibly dispatched clicks never route again');
 pageValue='ok';
 const ctrl=new AbortController();ctrl.abort();const n=calls.length;r=await call({},ctrl.signal);assert.equal(r.isError,true);assert.equal(calls.length,n);assert.ok(!existsSync(session+'.lock'));
 hookDelay=1;r=await call({timeout:5});assert.equal(r.details.r.code,1);assert.match(r.details.r.stderr,/timeout/);hookDelay=0;
 // The token-bearing lock spans the whole workflow and rejects queued cancellation.
 const lease=await acquireWebLease(session);const queued=new AbortController();const wait=acquireWebLease(session,queued.signal);queued.abort();await assert.rejects(wait);assert.equal(readFileSync(join(session+'.lock','token'),'utf8'),lease.token);
 // Real legacy child reuses, but cannot delete, the parent's existing lease.
 const result=await promisify(execFile)('/usr/bin/env',[`WEB_SESSION_FILE=${session}`,`WEB_CACHE=${cache}`,`WEB_PARENT_LOCK_PID=${lease.pid}`,`WEB_PARENT_LOCK_TOKEN=${lease.token}`,binary,'unknown-command-for-test']).catch(e=>e);
 assert.match(result.stderr,/Unknown command/);assert.ok(existsSync(session+'.lock'));await lease.release();assert.ok(!existsSync(session+'.lock'));
 // Text/JS escaping never interpolates user data as source. Guard runs before eval.
 const dangerous='";globalThis.bad=1;//\n東京';const script=domScript('click',[dangerous]);new Function(script);assert.ok(script.includes(JSON.stringify(dangerous)));
 globalThis.executed=0;const guarded=guardedScript('globalThis.executed++','test_key','expected');const v=JSON.parse(eval(guarded));assert.equal(v.dispatched,false);assert.equal(globalThis.executed,0);delete globalThis.executed;
 assert.throws(()=>decodePageResult('missing value'),/No retry/);
 for(const action of ['nav','run-main','fill','fill-isolated','summary','find-text','click-text','select','value','find','cart','exists'])new Function(domScript(action,['#x','x"\n\\']));
 // Shared selector/text DOM preflight does not fire a synthetic click for
 // pointer-only time slots. Ordinary controls, including nested buttons, do.
 const oldDocument=globalThis.document;let domClicks=0,slot=true,button=false;
 const element={tagName:'P',innerText:'Appointment Available',offsetWidth:1,offsetHeight:1,parentElement:null,
   getClientRects:()=>[{}],getAttribute:()=>null,scrollIntoView:()=>{},focus:()=>{},click:()=>domClicks++,
   closest:s=>s.includes('tr[data-time]')?(slot?{}:null):s==='.fc-time-grid,.fc-timegrid'?(slot?{}:null):(button?{}:null)};
 globalThis.document={querySelector:()=>element,querySelectorAll:()=>[element]};
 try{
   for(const action of ['click','click-text']){
     const args=action==='click'?['#slot']:['Appointment Available','p'];
     const route=JSON.parse(eval(domScript(action,args)));
     assert.equal(route.requiresTrustedClick,true);assert.equal(route.dispatched,false);assert.equal(domClicks,0);
   }
   slot=false;assert.equal(JSON.parse(eval(domScript('click',['#button']))).synthetic,true);assert.equal(domClicks,1);
   slot=true;button=true;element.tagName='BUTTON';assert.equal(JSON.parse(eval(domScript('click',['#nested-button']))).synthetic,true);assert.equal(domClicks,2);
 }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
 console.log('PASS native web routing, calendar pointer/focus preflight, exact-tab native dispatch, no replay/fallback, permissions, cancellation/deadlines, shared/inherited lock, CLI compatibility, DOM escaping');
}finally{rmSync(dir,{recursive:true,force:true})}
