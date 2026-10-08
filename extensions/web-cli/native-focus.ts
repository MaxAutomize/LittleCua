import {chromeTabFocusScript} from '../cua-tool/native-chrome-focus.ts';
export function assertChromeFocusSupport(ctx:any) {
  if(typeof ctx?.executeTool!=='function'||(Array.isArray(ctx.tools)&&!ctx.tools.some((t:any)=>t.name==='cua_driver')))
    throw new Error('Foreground requires the registered cua_driver workflow; no alternate input transport or replay.');
}
export async function focusChromeTarget(pi:any,binary:string,target:string,ctx:any,signal?:AbortSignal,timeoutMs=15000) {
  assertChromeFocusSupport(ctx);
  const resolved=await pi.exec(binary,['resolve',target],{signal,timeout:Math.min(timeoutMs,8000)});
  if(resolved.code!==0)throw new Error(String(resolved.stderr||resolved.stdout||'Exact Chrome focus target unavailable.'));
  let record;try{record=JSON.parse(String(resolved.stdout).trim())}catch{throw new Error('Invalid Chrome target metadata; no focus dispatched.');}
  let urlPrefix='';try{const u=new URL(record.url);if(['http:','https:'].includes(u.protocol))urlPrefix=u.origin+'/';}catch{}
  const script=chromeTabFocusScript({windowId:record.windowId,tabId:record.tabId,urlPrefix});
  const nested=await ctx.executeTool('cua_driver',{action:'workflow',workflow:{action:'program',app:'Google Chrome',language:'applescript',script,timeoutMs}},{signal});
  const result=nested?.result??nested;
  const text=(result?.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
  if(nested?.isError||result?.isError)throw new Error('Native foreground failed; completed page actions were not replayed. '+text);
  let focused;try{focused=JSON.parse(text.trim())}catch{throw new Error('Native foreground outcome is unknown; no replay. '+text.slice(0,300));}
  if(focused.focused!==true||focused.chromeTabId!==String(record.tabId)||focused.chromeWindowId!==String(record.windowId))
    throw new Error('Native foreground identity was not confirmed; no replay.');
  return focused;
}
