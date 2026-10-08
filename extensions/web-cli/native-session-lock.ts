import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** Cross-process lease shared with ~/.local/bin/web. Covers the WHOLE native
 * sequence. Legacy child commands inherit it with an unguessable ownership token.
 * No session/window retargeting can interleave via another cooperating CLI/Pi.
 */
export async function acquireWebLease(sessionFile: string, signal?: AbortSignal, timeoutMs=20000) {
  const path=sessionFile+'.lock', token=randomUUID(), start=Date.now();
  await mkdir(dirname(sessionFile),{recursive:true});
  for(;;){
    signal?.throwIfAborted();
    try {await mkdir(path,{mode:0o700});break;} catch(e:any){if(e.code!=='EEXIST')throw e;}
    let owner='';try{owner=(await readFile(join(path,'pid'),'utf8')).trim()}catch{}
    if(/^\d+$/.test(owner)){
      let dead=false;try{process.kill(Number(owner),0)}catch(e:any){dead=e.code==='ESRCH'}
      // Existing CLI convention: reclaim only a demonstrably dead process lease.
      if(dead && (await readFile(join(path,'pid'),'utf8').catch(()=>'' )).trim()===owner){await rm(path,{recursive:true,force:true});continue;}
    }
    if(Date.now()-start>=timeoutMs)throw new Error('Timed out waiting for Chrome automation lock; no browser action dispatched.');
    await delay(25,undefined,{signal});
  }
  try{
    await writeFile(join(path,'pid'),String(process.pid),{mode:0o600});
    await writeFile(join(path,'token'),token,{mode:0o600});
    signal?.throwIfAborted();
  }catch(e){await rm(path,{recursive:true,force:true});throw e;}
  let released=false;
  return {pid:process.pid,token,async release(){
    if(released)return;released=true;
    if((await readFile(join(path,'token'),'utf8').catch(()=>''))===token)await rm(path,{recursive:true,force:true});
  }};
}
