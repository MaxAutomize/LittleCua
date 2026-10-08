import {setTimeout as delay} from 'node:timers/promises';
export type PageCondition = {selector?:string; text?:string; urlIncludes?:string; value?:string; waitState?:'visible'|'hidden'|'attached'|'detached'|'enabled'};
export function hasPageCondition(p:PageCondition) {
  return ['selector','text','urlIncludes','value','waitState'].some(k=>(p as any)[k]!==undefined);
}
export function pageReadinessScript(p:PageCondition) {
  if((p.value!==undefined||p.waitState!==undefined)&&!p.selector)throw new Error('wait value/waitState requires selector.');
  if(!hasPageCondition(p))throw new Error('A page readiness condition is required.');
  for(const k of ['selector','text','urlIncludes'] as const)if(p[k]!==undefined&&!p[k])throw new Error('wait '+k+' cannot be empty.');
  const condition:PageCondition={selector:p.selector,text:p.text,urlIncludes:p.urlIncludes,value:p.value,waitState:p.waitState};
  return `(()=>{const p=${JSON.stringify(condition)},checks=[];try{
    if(p.selector){const e=document.querySelector(p.selector),visible=!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none');const state=p.waitState||'visible';let matched=state==='attached'?!!e:state==='detached'?!e:state==='hidden'?!visible:state==='enabled'?visible&&!e.disabled&&!e.matches(':disabled')&&e.getAttribute('aria-disabled')!=='true':visible;checks.push({kind:'selector',state,matched});if(p.value!==undefined)checks.push({kind:'value',matched:!!e&&String(e.value)===p.value});}
    if(p.text!==undefined)checks.push({kind:'text',matched:(document.body?.innerText||'').includes(p.text)});
    if(p.urlIncludes!==undefined)checks.push({kind:'url',matched:location.href.includes(p.urlIncludes)});
    return JSON.stringify({ready:document.readyState==='complete'&&checks.every(c=>c.matched),state:document.readyState,url:location.href,title:document.title,checks});
  }catch(e){return JSON.stringify({error:'Page readiness predicate failed',message:String(e&&e.message||e)})}})()`;
}
export async function waitForPage(probe:(script:string,timeoutMs:number)=>Promise<string>,condition:PageCondition,opts:{budgetMs:number;signal?:AbortSignal;pollMs?:number}) {
  const script=pageReadinessScript(condition),start=performance.now(),budget=Math.max(0,opts.budgetMs),deadline=start+budget;
  let attempts=0,last:any={ready:false,checks:[]};
  while(performance.now()<deadline){
    opts.signal?.throwIfAborted();
    const raw=await probe(script,Math.max(1,Math.ceil(deadline-performance.now())));opts.signal?.throwIfAborted();attempts++;
    try{last=JSON.parse(raw)}catch{throw new Error('Unrecognized page readiness response; no action replay.');}
    if(last.error)throw new Error(last.error+': '+last.message);
    if(last.ready===true&&performance.now()<=deadline)return {...last,attempts,waitedMs:Math.round(performance.now()-start),timedOut:false};
    const remaining=deadline-performance.now();if(remaining<=0)break;
    await delay(Math.min(opts.pollMs??80,remaining),undefined,{signal:opts.signal});
  }
  opts.signal?.throwIfAborted();
  return {...last,ready:false,attempts,waitedMs:Math.round(performance.now()-start),timedOut:true};
}
