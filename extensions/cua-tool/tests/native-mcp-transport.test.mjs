import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jiti } from './pi-loader.mjs';
const { createNativeMcpTransport, CUA_MCP_SERVER } = await jiti.import('../native-mcp-transport.ts');
const dir=mkdtempSync(join(tmpdir(),'cua-mcp-test-'));
const names=['list_windows','get_window_state','click','screenshot','get_config','set_config','set_recording','get_recording_state','set_agent_cursor_enabled'];
const envelope=(value)=>({isError:false,result:{structuredContent:{content:[],structuredContent:value},content:[]}});
function harness(mode='mcp') {
 const calls=[], cli=[], registrations=[], commands={};
 const pi={registerMcpServer:(...a)=>registrations.push(a),unregisterMcpServer:(...a)=>registrations.push(['stop',...a]),registerCommand:(n,c)=>commands[n]=c,exec:async(...a)=>{cli.push(a);return{code:0,stdout:'legacy',stderr:''}}};
 const t=createNativeMcpTransport(pi,'cua-driver',{mode,settingsPath:join(dir,'absent.json')});
 const ctx={tools:names.map(name=>({name:`mcp__${CUA_MCP_SERVER}__${name}`})),executeTool:async(name,payload,options)=>{calls.push({name,payload,options});return envelope({ok:true})}};
 const execute=async(fn,context=ctx,signal)=>t.wrap({execute:fn}).execute('parent',{},signal,undefined,context);
 return{t,ctx,calls,cli,registrations,commands,execute};
}
try {
 const h=harness();
 assert.equal(h.registrations[0][0],'cua_native');assert.deepEqual(h.registrations[0][1].args,['mcp']);assert.equal(h.registrations[0][1].exposure,'codemode-deferred');
 let r=await h.execute(async()=>({details:{data:await h.t.api.exec('cua-driver',['call','list_windows','{}','--compact'])},content:[]}));
 assert.equal(r.details.data.stdout,'{"ok":true}');assert.equal(r.details.transport.mcpCalls,1);assert.equal(h.cli.length,0);
 await h.execute(async()=>({content:[],details:{data:await h.t.api.exec('cua-driver',['call','click','{"pid":7}'])}}));
 assert.deepEqual(h.calls.slice(-2).map(c=>c.name),['mcp__cua_native__set_agent_cursor_enabled','mcp__cua_native__click'],'fake pointer is disabled before each native click, including after a reconnect');
 assert.deepEqual(h.calls.at(-2).payload,{enabled:false});
 // Parent contexts must never leak between parallel workflows.
 const owners=[];
 const contexts=['a','b'].map(id=>({...h.ctx,executeTool:async()=>{await new Promise(r=>setTimeout(r,id==='a'?15:1));owners.push(id);return envelope({id})}}));
 const outputs=await Promise.all(contexts.map(ctx=>h.execute(async()=>({content:[],details:{data:await h.t.api.exec('cua-driver',['call','click','{"pid":7}'])}}),ctx)));
 assert.equal(JSON.parse(outputs[0].details.data.stdout).id,'a');assert.equal(JSON.parse(outputs[1].details.data.stdout).id,'b');
 // Preserve structured AX data even if model-facing text was truncated by native MCP.
 const big='AX'.repeat(20000);
 const structured={...h.ctx,executeTool:async()=>({result:{content:[{type:'text',text:'truncated'}],structuredContent:{content:[{type:'text',text:big}],structuredContent:{tree_markdown:big}}},isError:false})};
 r=await h.execute(async()=>({content:[],details:{data:await h.t.api.exec('cua-driver',['call','get_window_state','{}','--compact'])}}),structured);
 assert.equal(JSON.parse(r.details.data.stdout).tree_markdown,big);
 // Native images retain byte-for-byte image data for existing fresh-file wrapper.
 const image=Buffer.from('fake image bytes');const imagePath=join(dir,'image.png');
 const imageCtx={...h.ctx,executeTool:async()=>({isError:false,result:{structuredContent:{content:[{type:'image',data:image.toString('base64'),mimeType:'image/png'}]},content:[]}})};
 await h.execute(async()=>({content:[],details:{data:await h.t.api.exec('cua-driver',['call','screenshot','{}','--screenshot-out-file',imagePath])}}),imageCtx);
 assert.deepEqual(readFileSync(imagePath),image);
 // Permission rejection, server error, missing redacted data: NEVER route to CLI.
 for(const executeTool of [async()=>({isError:true,result:{content:[{type:'text',text:'permission denied'}]}}),async()=>({isError:false,result:{content:[],structuredContent:{content:[],isError:true}}})]){
  r=await h.execute(async()=>({content:[],details:{data:await h.t.api.exec('cua-driver',['call','click','{}'])}}),{...h.ctx,executeTool});assert.equal(r.details.data.code,1);
 }
 await assert.rejects(h.execute(()=>h.t.api.exec('cua-driver',['call','click','{}']),{...h.ctx,executeTool:async()=>({isError:false,result:{content:[{type:'text',text:'redacted'}]}})}),/structured result missing/);
 await assert.rejects(h.execute(()=>h.t.api.exec('cua-driver',['call','click','{}']),{...h.ctx,tools:[]}),/not available/);
 await assert.rejects(h.execute(()=>h.t.api.exec('cua-driver',['call','click','{}','--no-daemon'])),/cannot be mixed/);
 assert.equal(h.cli.length,0);
 // Cancellation before dispatch, plus cancellation propagated after dispatch.
 const cancelled=new AbortController();cancelled.abort();let dispatches=0;
 await assert.rejects(h.execute(()=>h.t.api.exec('cua-driver',['call','click','{}'],{signal:cancelled.signal}),{...h.ctx,executeTool:async()=>{dispatches++;return envelope({})}}));assert.equal(dispatches,0);
 const timeoutCtx={...h.ctx,executeTool:async(_n,_p,{signal})=>{dispatches++;await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {isError:true,result:{content:[]}}}};
 await assert.rejects(h.execute(()=>h.t.api.exec('cua-driver',['call','click','{}'],{timeout:10}),timeoutCtx),/timed out/);assert.equal(dispatches,1);assert.equal(h.cli.length,0);
 await assert.rejects(h.execute(()=>h.t.api.exec('cua-driver',['call','click','{}'],{timeout:0}),timeoutCtx),/before dispatch/);assert.equal(dispatches,1);
 // Recording/config use the SAME native MCP process rather than the legacy daemon.
 await h.execute(async()=>{await h.t.api.exec('cua-driver',['recording','start','/tmp/test','--video-experimental']);await h.t.api.exec('cua-driver',['recording','stop']);await h.t.api.exec('cua-driver',['config','set','capture_mode','ax']);return {content:[]}});
 assert.deepEqual(h.calls.at(-3).payload,{enabled:true,output_dir:'/tmp/test',video_experimental:true});assert.deepEqual(h.calls.at(-2).payload,{enabled:false});assert.deepEqual(h.calls.at(-1).payload,{key:'capture_mode',value:'ax'});
 // Metadata remains an occasional CLI call. Explicit CLI rollback stays unchanged.
 await h.execute(async()=>({content:[],details:{data:await h.t.api.exec('cua-driver',['dump-docs'])}}));assert.equal(h.cli.length,1);
 const legacy=harness('cli');await legacy.execute(async()=>({content:[],details:{data:await legacy.t.api.exec('cua-driver',['call','click','{}'])}}));assert.equal(legacy.cli.length,1);assert.equal(legacy.calls.length,0);assert.equal(legacy.registrations.length,0);
 console.log('PASS native MCP routing, isolation, full AX/image results, permissions, no replay/fallback, deadlines, config/recording, and CLI rollback');
} finally {rmSync(dir,{recursive:true,force:true});}
