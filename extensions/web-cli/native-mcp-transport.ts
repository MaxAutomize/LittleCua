import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireWebLease } from './native-session-lock.ts';
import { assertDomSource, NATIVE_DOM_ACTIONS, domScript, guardedScript, decodePageResult, domOutput } from './native-dom.ts';

const SERVER='web_native', TOOL=`mcp__${SERVER}__page`;
const SETTINGS=new URL('./transport.json',import.meta.url);
const good=(stdout:string)=>({stdout,stderr:'',code:0,killed:false});
const textOf=(blocks:any[]) => (blocks??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
type Lease=Awaited<ReturnType<typeof acquireWebLease>>;
type Scope={ctx:any;signal?:AbortSignal;lease?:Lease;calls:number;nativeMs:number;compatibility:string[];identityRepairs:number};

export function parseNumericState(text:string) {
  const entries:Record<string,number>={};
  for(const m of text.matchAll(/(?:^|[;\n])\s*(CHROME_WINDOW_ID|CHROME_TAB_ID|WEB_PID|WEB_WID|WEB_CHROME_WINDOW_ID|WEB_CHROME_TAB_ID)=(\d+)(?=;|\s|$)/g))entries[m[1]]=Number(m[2]);
  return entries;
}
function parseArgs(args:string[]){
  let target='session',i=0;
  if(args[0]==='--tab'){target=args[1];i=2;}
  return {target,action:args[i],values:args.slice(i+1)};
}
export function createWebMcpTransport(pi:any,binary:string,options:any={}) {
  let saved:any={};try{saved=JSON.parse(readFileSync(options.settingsPath??SETTINGS,'utf8'))}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const mode=options.mode??process.env.WEB_TOOL_TRANSPORT??saved.mode??(typeof pi.registerMcpServer==='function'?'mcp':'cli');
  if(!['mcp','cli'].includes(mode))throw new Error('WEB_TOOL_TRANSPORT must be mcp or cli');
  const sessionFile=options.sessionFile??process.env.WEB_SESSION_FILE??join(homedir(),'.pi/agent/state/chrome-session.env');
  const sessionName=options.sessionName??process.env.WEB_SESSION_NAME??'Pi Automation';
  const cacheFile=options.cacheFile??process.env.WEB_CACHE??'/tmp/web-chrome-target';
  const sourceBinary=options.sourceBinary??binary;
  const originalExec=pi.exec.bind(pi),scope=new AsyncLocalStorage<Scope>();
  const key='__pi_web_native_'+randomUUID().replaceAll('-','');
  let identity:{signature:string;token:string;pid:number;wid:number;tab:number}|undefined;
  let pendingNavigation:typeof identity;
  if(mode==='mcp'){
    if(typeof pi.registerMcpServer!=='function')throw new Error('Native web transport requires Pi MCP support');
    const driver=process.env.CUA_DRIVER_BIN??(existsSync('/Applications/CuaDriver.app/Contents/MacOS/cua-driver')?'/Applications/CuaDriver.app/Contents/MacOS/cua-driver':'cua-driver');
    if(options.registerSupport!==false)pi.registerMcpServer(SERVER,{command:driver,args:['mcp'],exposure:'codemode-deferred',toolExposure:{page:'codemode-deferred','*':'hidden'},timeout:120});
  }
  function state(){const s=scope.getStore();if(!s)throw new Error('Native web operation requires its parent context');return s;}
  function targetState(){
    let session,cache;try{session=parseNumericState(readFileSync(sessionFile,'utf8'));cache=parseNumericState(readFileSync(cacheFile,'utf8'));}catch{return undefined;}
    const tab=session.CHROME_TAB_ID,window=session.CHROME_WINDOW_ID,pid=cache.WEB_PID,wid=cache.WEB_WID;
    if(![tab,window,pid,wid].every(v=>Number.isSafeInteger(v)&&v>0)||cache.WEB_CHROME_WINDOW_ID!==window||cache.WEB_CHROME_TAB_ID!==tab)return undefined;
    return{tab,window,pid,wid,signature:`${window}:${tab}:${pid}:${wid}`};
  }
  async function compatibility(args:string[],opts:any={}) {
    const s=state(),{action}=parseArgs(args);s.compatibility.push(action);
    const lease=s.lease;
    const env=[`WEB_SESSION_FILE=${sessionFile}`,`WEB_SESSION_NAME=${sessionName}`,`WEB_CACHE=${cacheFile}`,'WEB_RUN_RETRIES=1'];
    if(lease)env.push(`WEB_PARENT_LOCK_PID=${lease.pid}`,`WEB_PARENT_LOCK_TOKEN=${lease.token}`);
    return originalExec('/usr/bin/env',[...env,binary,...args],opts);
  }
  async function bindIdentity(opts:any) {
    // This is planned setup BEFORE any requested DOM action; not error fallback.
    // The legacy path resolves only the remembered named bot window/tab and retains
    // its authenticated profile. An inherited lease avoids child-lock deadlock.
    const auto=await compatibility(['auto'],opts);
    if(auto.code!==0)throw new Error(`Native web target bootstrap failed: ${auto.stderr||auto.stdout}`);
    const t=targetState();if(!t)throw new Error('Could not resolve exact Pi Automation cached target');
    const token=randomUUID();
    const marker=`(()=>{globalThis[${JSON.stringify(key)}]=${JSON.stringify(token)};return JSON.stringify({bound:true})})()`;
    const exact=await compatibility(['--tab',`tab:${t.tab}`,'run',marker],opts);
    if(exact.code!==0||!exact.stdout.includes('"bound":true'))throw new Error('Could not establish exact-tab identity; no DOM action dispatched.');
    identity={...t,token};
  }
  async function page(source:string,opts:any) {
    const s=state();
    if(typeof s.ctx?.executeTool!=='function'||!s.ctx.tools?.some((t:any)=>t.name===TOOL))throw new Error('Native web MCP is unavailable. Check /mcp for web_native. No CLI retry.');
    const parent=opts.signal??s.signal;parent?.throwIfAborted();
    const ctrl=new AbortController(),abort=()=>ctrl.abort(parent?.reason);
    parent?.addEventListener('abort',abort,{once:true});
    const timeout=opts.timeout??30000;let timedOut=false;
    if(timeout<=0){parent?.removeEventListener('abort',abort);throw new Error('Native web deadline expired before dispatch');}
    const timer=setTimeout(()=>{timedOut=true;ctrl.abort(new Error('Native web deadline expired'))},timeout);
    const started=performance.now();s.calls++;
    try{
      const result=await s.ctx.executeTool(TOOL,{pid:identity!.pid,window_id:identity!.wid,action:'execute_javascript',javascript:guardedScript(source,key,identity!.token)},{signal:ctrl.signal});
      if(timedOut||parent?.aborted)throw new Error(`Native web ${timedOut?'timeout':'cancelled'}; outcome may be unknown. No replay.`);
      const envelope=result.result?.structuredContent;
      if(result.isError||result.result?.isError||envelope?.isError)throw new Error(`Native web MCP rejected/failed: ${textOf(result.result?.content)}. No CLI retry.`);
      if(!Array.isArray(envelope?.content))throw new Error('Native web structured result missing/removed by a hook. No fallback.');
      return decodePageResult(textOf(envelope.content));
    }finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);s.nativeMs+=performance.now()-started;}
  }
  async function executeScript(source:string,opts:any) {
    const t=targetState();if(!identity||t?.signature!==identity.signature)await bindIdentity(opts);
    let result=await page(source,opts);
    if(result.targetChanged===true&&result.dispatched===false){
      state().identityRepairs++;
      await bindIdentity(opts);
      result=await page(source,opts);
      if(result.targetChanged)throw new Error('Exact Chrome tab changed during native target binding; no DOM action dispatched.');
    }
    return domOutput(result);
  }
  async function exec(command:string,args:string[],opts:any={}) {
    if(command!==binary||mode==='cli')return originalExec(command,args,opts);
    const {target,action,values}=parseArgs(args);
    const s=state();
    if(!['session','bot'].includes(target)||!NATIVE_DOM_ACTIONS.has(action)){
      // Established exact-inactive-tab/trusted-input/tab-management routes are selected
      // BEFORE dispatch. They are NOT attempted after native failures.
      const result=await compatibility(args,opts);
      if(['bind','session','switch','newtab','closetab'].includes(action)){identity=undefined;pendingNavigation=undefined;}
      return result;
    }
    const parent=opts.signal??s.signal,controller=new AbortController();
    const abort=()=>controller.abort(parent?.reason);
    parent?.addEventListener('abort',abort,{once:true});
    if(parent?.aborted)abort();
    let timedOut=false;
    const operationTimeout=opts.timeout??30000;
    const timer=setTimeout(()=>{timedOut=true;controller.abort(new Error('Native web deadline expired'))},Math.max(0,operationTimeout));
    opts={...opts,signal:controller.signal};
    try{
      controller.signal.throwIfAborted();
      if(operationTimeout<=0)throw new Error('Native web deadline expired before dispatch');
      assertDomSource(sourceBinary);
      if(typeof s.ctx?.executeTool!=='function'||!s.ctx.tools?.some((t:any)=>t.name===TOOL))throw new Error('Native web MCP unavailable; inspect /mcp (web_native). No fallback.');
      const deadline=Date.now()+(opts.timeout??30000);
      const js=(source:string)=>executeScript(source,{...opts,timeout:deadline-Date.now()});
      // A navigation creates a new JS document. Piggyback nonce renewal on the
      // wrapper's required URL-transition read using the already-known exact tab.
      // This avoids a full native-window rediscovery after every navigation, and
      // never installs a nonce on whichever tab happens to be active.
      if(action==='url'&&pendingNavigation&&targetState()?.signature===pendingNavigation.signature){
        const t=pendingNavigation,token=randomUUID();
        const source=`(()=>{globalThis[${JSON.stringify(key)}]=${JSON.stringify(token)};return location.href})()`;
        const read=await compatibility(['--tab',`tab:${t.tab}`,'run',source],opts);
        if(read.code===0)identity={...t,token};
        return read;
      }
      if(action!=='url'&&action!=='nav')pendingNavigation=undefined;
      if(action==='wait'||action==='sleep'){
        const ms=Number(values[0]);if(!Number.isFinite(ms)||ms<0)throw new Error('Invalid wait duration');
        if(action==='sleep')await delay(ms,undefined,{signal:opts.signal??s.signal});
        const start=Date.now();let text='';
        do{
          text=await js(`JSON.stringify({ready:document.readyState==='complete',state:document.readyState,url:location.href,title:document.title,${action==='sleep'?'slept':'ms'}:${action==='sleep'?ms:Date.now()-start}})`);
          if(action==='sleep'||JSON.parse(text).ready||Date.now()-start>=ms)break;
          await delay(Math.min(100,ms-(Date.now()-start)),undefined,{signal:opts.signal??s.signal});
        }while(true);
        return good(text);
      }
      let output=await js(domScript(action,values));
      if(action==='click'||action==='click-text'){
        let route;try{route=JSON.parse(output)}catch{}
        if(route?.requiresTrustedClick===true&&route?.dispatched===false&&route?.reason==='fullcalendar-slot-pointer'){
          // DOM preflight did NOT click. Select the established native input path
          // now, before dispatch; never fall back after an MCP/native failure.
          const target=identity;
          if(!target||targetState()?.signature!==target.signature)throw new Error('Calendar native-input target changed before dispatch; no click sent.');
          const remaining=deadline-Date.now();
          if(remaining<=0)throw new Error('Calendar native-input deadline expired before dispatch; no click sent.');
          return await compatibility(['--tab',`tab:${target.tab}`,action==='click'?'trusted-click':'trusted-click-text',...values],{...opts,timeout:remaining});
        }
      }
      if(action==='nav')pendingNavigation=identity;
      // Only an explicit CSP non-execution result permits fill's existing isolated
      // setter. JS errors after dispatch, permission blocks, timeouts do NOT retry.
      if(action==='fill'){
        let data;try{data=JSON.parse(output)}catch{}
        if(data?.error==='Main-world script did not execute; the page Content Security Policy may block inline injection.')output=await js(domScript('fill-isolated',values));
      }
      if(['click','click-text','fill','select','submit','run-main','value'].includes(action)){
        let data;try{data=JSON.parse(output)}catch{}
        if(data?.error)return{...good(output),code:1};
      }
      return good(output);
    }catch(e:any){return{code:1,stdout:'',stderr:timedOut?'Native web timeout; any dispatched outcome may be unknown. No replay.':String(e?.message??e),killed:false};}
    finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
  }
  const api=new Proxy(pi,{get(target,key){if(key==='exec')return exec;if(key==='webNativeMode')return()=>mode==='mcp';const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  function wrap(tool:any){return{...tool,async execute(id:string,params:any,signal:AbortSignal|undefined,onUpdate:any,ctx:any){
    if(mode==='cli')return tool.execute(id,params,signal,onUpdate,ctx);
    const s:Scope={ctx,signal,calls:0,nativeMs:0,compatibility:[],identityRepairs:0};
    return scope.run(s,async()=>{
      try{
        s.lease=await acquireWebLease(sessionFile,signal);
        const result=await tool.execute(id,params,signal,onUpdate,ctx);
        return{...result,details:{...result.details,transport:{mode:'mcp',server:SERVER,mcpCalls:s.calls,mcpMs:Math.round(s.nativeMs*10)/10,compatibilityCommands:s.compatibility,identityRepairs:s.identityRepairs}}};
      }catch(e:any){return{isError:true,content:[{type:'text',text:String(e?.message??e)}],details:{transport:{mode:'mcp',mcpCalls:s.calls,compatibilityCommands:s.compatibility}}};}
      finally{await s.lease?.release();}
    });
  }}}
  if(options.registerSupport!==false)pi.registerCommand?.('web-transport',{description:'Show web transport or save mcp/cli and reload (explicit rollback).',handler:async(args:string,ctx:any)=>{
    const next=args.trim();if(!next){ctx.ui.notify(`Web transport: ${mode}; native MCP DOM with planned exact-tab/trusted-input compatibility paths.`,'info');return;}
    if(!['mcp','cli'].includes(next)){ctx.ui.notify('Usage: /web-transport [mcp|cli]','error');return;}
    if(process.env.WEB_TOOL_TRANSPORT){ctx.ui.notify('WEB_TOOL_TRANSPORT overrides this setting; change it and restart Pi.','error');return;}
    await ctx.waitForIdle();writeFileSync(options.settingsPath??SETTINGS,JSON.stringify({mode:next},null,2)+'\n',{mode:0o600});await ctx.reload();
  }});
  return{api,wrap,mode};
}
