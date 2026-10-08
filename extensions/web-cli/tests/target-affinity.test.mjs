import assert from 'node:assert/strict';
import {jiti} from '../../cua-tool/tests/pi-loader.mjs';
const {createUrlTargetAffinity}=await jiti.import(new URL('../target-affinity.ts',import.meta.url).pathname);
const {default:extension}=await jiti.import(new URL('../index.ts',import.meta.url).pathname);
const url='https://tools.usps.com/rcas.htm';
let resolutions=0,redirected=false;
const affinity=createUrlTargetAffinity(2);
const resolve=async()=>{resolutions++;if(redirected)throw new Error('Old URL no longer matches');return 'tab:42';};
assert.equal(await affinity.pin(url,resolve),'tab:42');redirected=true;
assert.equal(await affinity.pin(url,resolve),'tab:42');assert.equal(resolutions,1);
for(const target of ['active','session','bot','tab:7','Some Title','1.1'])assert.equal(await affinity.pin(target,resolve),target);
await assert.rejects(affinity.pin('https://bad.example/',async()=> 'active'),/exact Chrome tab/);
await affinity.pin('https://second.example/',async()=> 'tab:43');
await affinity.pin('https://third.example/',async()=> 'tab:44');
await assert.rejects(affinity.pin(url,resolve),/Old URL/,'bounded cache does not silently adopt another tab');
// Exercise the actual registered wrapper, not just the cache: a successful
// submission redirects the URL, and a later read with the original URL must
// reuse the exact resolved tab and visibly report that identity.
let tool,posted=false;const commands=[];
const oldMode=process.env.WEB_TOOL_TRANSPORT;process.env.WEB_TOOL_TRANSPORT='cli';
try{
 extension({registerTool:t=>{tool=t;},registerCommand:()=>{},exec:async(binary,args)=>{
   commands.push(args);
   if(args[0]==='resolve'){
     assert.equal(args[1],url);assert.equal(posted,false,'no old-URL lookup after redirect');
     return {code:0,stdout:JSON.stringify({target:'tab:42'}),stderr:''};
   }
   assert.deepEqual(args.slice(0,2),['--tab','tab:42']);
   if(args[2]==='click')posted=true;
   return {code:0,stdout:args[2]==='text'?'Appointment Status: Confirmed':'{"clicked":true}',stderr:''};
 }});
 const r=await tool.execute('first',{action:'sequence',tab:url,steps:[{action:'click',selector:'#scheduleAppointment'}]},undefined,undefined,{});
 assert.equal(r.isError,false);assert.equal(r.details.pinnedTab,'tab:42');
 assert.match(r.content[0].text,/\[web_cli target: tab:42\]/);
 assert.equal(r.content[0].text.match(/\[web_cli target:/g).length,1,'batch repeats do not duplicate target context');
 const next=await tool.execute('next',{action:'text',tab:url},undefined,undefined,{});
 assert.equal(next.isError,false);assert.match(next.content[0].text,/Appointment Status: Confirmed/);
 assert.equal(commands.filter(a=>a[0]==='resolve').length,1);
 assert.equal(commands.filter(a=>a[2]==='click').length,1,'no submission replay');
}finally{if(oldMode===undefined)delete process.env.WEB_TOOL_TRANSPORT;else process.env.WEB_TOOL_TRANSPORT=oldMode;}
console.log('PASS URL target affinity across confirmation redirects, visible pinned identity, bounded cache, no active-tab adoption or mutation replay');
