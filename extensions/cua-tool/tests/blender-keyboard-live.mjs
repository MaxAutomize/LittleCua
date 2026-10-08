// Real GUI regression: disposable Blender only. Existing user Blender instances
// remain open and are never addressed. Tests the entire console/typing/attach flow.
import assert from 'node:assert/strict';
import{mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,mkdirSync}from'node:fs';
import{join}from'node:path';import{tmpdir,homedir}from'node:os';import{spawn,execFile}from'node:child_process';import{promisify}from'node:util';
import{nativeMcpSession}from'./native-mcp-session.mjs';import{jiti}from'./pi-loader.mjs';
const{requestLive}=await jiti.import(new URL('../../blender/live-client.ts',import.meta.url).pathname);
const exec=promisify(execFile),dir=mkdtempSync(join(tmpdir(),'pi-blender-keyboard-')),oracle=join(dir,'oracle.json'),done=join(dir,'done.json'),stateDir=join(dir,'state');
let child,h,target,prior;const checks=[],timings=[];
const py=join(dir,'fixture.py');
writeFileSync(py,`import bpy,json,os,time\nbpy.context.preferences.view.show_splash=False\nfrom pathlib import Path\nFILE=${JSON.stringify(oracle)}\ndef watch():\n try:\n  areas=[{'type':a.type,'x':a.x,'y':a.y,'width':a.width,'height':a.height,'line':a.spaces.active.history[-1].body if a.type=='CONSOLE' and len(a.spaces.active.history) else ''} for w in bpy.context.window_manager.windows for a in w.screen.areas]\n  p=Path(FILE+'.tmp');p.write_text(json.dumps({'pid':os.getpid(),'areas':areas,'objects':[(o.name,o.as_pointer()) for o in bpy.data.objects],'frame':bpy.context.scene.frame_current}));p.replace(FILE)\n except Exception: pass\n return .05\nbpy.app.timers.register(watch,first_interval=.1,persistent=True)\n`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=()=>JSON.parse(readFileSync(oracle,'utf8'));
async function until(fn,msg){const end=Date.now()+15000;while(Date.now()<end){try{const v=fn();if(v)return v}catch{}await sleep(50)}throw new Error(msg)}
const ok=r=>{assert.ok(!r.isError,r.content?.map(c=>c.text).join('\n'));return r};
try{
 prior=(await exec('/usr/bin/osascript',['-e','tell application "System Events" to get unix id of first application process whose frontmost is true'])).stdout.trim();
 child=spawn('/Applications/Blender.app/Contents/MacOS/Blender',['--factory-startup','--disable-autoexec','--python',py],{stdio:'ignore'});
 await until(()=>existsSync(oracle),'fixture not started');h=await nativeMcpSession();
 for(let i=0;i<60;i++){const r=ok(await h.call({action:'list_windows',pid:child.pid,onScreenOnly:true}));target=JSON.parse(r.details.stdout).windows.find(w=>w.pid===child.pid);if(target)break;await sleep(100)}assert.ok(target);
 const base=read();
 ok(await h.call({action:'workflow',workflow:{action:'activate',pid:child.pid,windowId:target.window_id}}));
 const area=base.areas.find(a=>a.type==='VIEW_3D');assert.ok(area);
 // Choose a point near the upper-left inside the main editor, avoiding scene objects.
 ok(await h.call({action:'move_cursor',x:Math.round(target.bounds.x+150),y:Math.round(target.bounds.y+150)}));
 const flow=keys=>h.call({action:'workflow',workflow:{action:'act',pid:child.pid,windowId:target.window_id,stepAction:'hotkey',keys}});
 ok(await flow(['shift','f4']));await until(()=>read().areas.some(a=>a.type==='CONSOLE'),'Shift+F4 failed to open fixture console');checks.push('modified Fn shortcut targets exact fixture PID among duplicate Blender names');
 // Long input first: no separate Return is allowed to overtake queued characters.
 const scripts=[`__import__('pathlib').Path(${JSON.stringify(done)}).write_text(${JSON.stringify(JSON.stringify({round:1,payload:'abcXYZ_'.repeat(90)}))})`, `__import__('pathlib').Path(${JSON.stringify(done)}).write_text(${JSON.stringify(JSON.stringify({round:2,payload:'second round with punctuation []{}=+'}))})`];
 for(let i=0;i<scripts.length;i++){
  const start=performance.now();const r=ok(await h.call({action:'type_text_chars',pid:child.pid,windowId:target.window_id,text:scripts[i],key:'return'}));
  await until(()=>existsSync(done)&&JSON.parse(readFileSync(done,'utf8')).round===i+1,'ordered text+commit failed');
  assert.deepEqual(JSON.parse(readFileSync(done,'utf8')),{round:i+1,payload:i===0?'abcXYZ_'.repeat(90):'second round with punctuation []{}=+'});
  assert.equal(r.details.commitKey,'return');assert.equal(r.details.dispatchState,'dispatch-only');timings.push({characters:scripts[i].length,ms:performance.now()-start});
 }
 assert.equal(JSON.parse(readFileSync(done,'utf8')).round,2);checks.push('two long console commands commit once with exact file-oracle results');
 const attach=join(dir,'attach.py'),attached=join(dir,'attached.json');
 writeFileSync(attach,`import os,runpy,json,bpy\nassert os.getpid()==${child.pid}\napi=runpy.run_path(${JSON.stringify(join(homedir(),'.pi/agent/extensions/blender/bridge.py'))},run_name='test_attach')\napi['register'](state_dir=${JSON.stringify(stateDir)},expected_pid=${child.pid},attached=True)\n__import__('pathlib').Path(${JSON.stringify(attached)}).write_text(json.dumps({'pid':os.getpid(),'objects':[(o.name,o.as_pointer()) for o in bpy.data.objects]}))\n`);
 const code=`exec(compile(open(${JSON.stringify(attach)}, encoding='utf8').read(), ${JSON.stringify(attach)}, 'exec'))`;
 ok(await h.call({action:'type_text_chars',pid:child.pid,windowId:target.window_id,text:code,key:'return'}));
 await until(()=>existsSync(attached),'attach failed');assert.deepEqual(JSON.parse(readFileSync(attached)).objects,base.objects);checks.push('full one-time bridge attachment through Cua preserves object identities');
 const state=JSON.parse(readFileSync(join(stateDir,'blender-live-sessions',child.pid+'.json')));
 const ping=await requestLive(state,{action:'ping'},2000);assert.equal(ping.pid,child.pid);
 ok(await flow(['shift','f5']));await until(()=>!read().areas.some(a=>a.type==='CONSOLE'),'view not restored');checks.push('original VIEW_3D restored with real modified shortcut');
 const progress=[];const probe=await requestLive(state,{action:'exec',step_delay_ms:120,steps:[
 {label:'Start heartbeat',code:'ticks=[]\ndef pulse():\n ticks.append(1)\n return .02\nbpy.app.timers.register(pulse, first_interval=.01)'},
 {label:'Observe GUI loop',code:'middle=len(ticks)'},
 {label:'Remove heartbeat',code:"bpy.app.timers.unregister(pulse)\nresult={'middle':middle,'ticks':len(ticks),'objects':[(o.name,o.as_pointer()) for o in bpy.data.objects]}"}
 ]},5000,{onProgress:p=>progress.push(p)});
 assert.equal(probe.ok,true);assert.ok(probe.result.middle>0);assert.ok(probe.result.ticks>probe.result.middle);assert.deepEqual(probe.result.objects,base.objects);assert.equal(progress.filter(p=>p.phase==='completed').length,3);checks.push('three-stage live probe yields to GUI event loop, streams progress, removes timer, preserves objects');
 const shot=ok(await h.call({action:'screenshot',pid:child.pid,windowId:target.window_id,returnImage:false,imageOut:join(dir,'fixture.png')}));assert.equal(shot.details.screenshotFileExists,true);
 const reports=join(homedir(),'Library/Application Support/LittleCua/reports');mkdirSync(reports,{recursive:true});const report=join(reports,'blender-keyboard-'+new Date().toISOString().replaceAll(':','-')+'.json');
 writeFileSync(report,JSON.stringify({checks,timings,fixturePid:child.pid,probe:probe.result,untouchedUserPids:[5600,52620]},null,2));console.log(JSON.stringify({report,checks,timings,heartbeat:probe.result},null,2));
}catch(error){
 if(h&&target){const path=join(homedir(),'Library/Application Support/LittleCua/reports/keyboard-fixture-failure.png');try{await h.call({action:'screenshot',pid:child.pid,windowId:target.window_id,imageOut:path,returnImage:false});console.error('Fixture failure image:',path);console.error('Fixture state:',JSON.stringify(read()));}catch{}}
 throw error;
}finally{
 await h?.close();if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);if(child.exitCode===null)child.kill('SIGKILL')}
 if(prior)await exec('/usr/bin/osascript',['-e',`tell application "System Events" to set frontmost of (first application process whose unix id is ${Number(prior)}) to true`]).catch(()=>{});
 rmSync(dir,{recursive:true,force:true});
}
