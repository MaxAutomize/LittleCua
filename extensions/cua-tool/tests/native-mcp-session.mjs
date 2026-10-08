// Deterministic local SDK harness: Pi's REAL native MCP + nested-tool pipeline.
// No model prompt, network research, credential use, or extra agent is involved.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { jiti, root } from './pi-loader.mjs';
const sdk=await import(pathToFileURL(join(root,'dist/index.js')).href);
const { StdioTransport }=await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-mcp/dist/transports/stdio.js')).href);
const { default: extension }=await jiti.import('../index.ts');
export async function nativeMcpSession() {
 const dir=mkdtempSync(join(tmpdir(),'cua-native-sdk-'));
 const transports=[], events=[], cli=[];
 let host, session;
 let blockedTool;
 const settingsManager=sdk.SettingsManager.inMemory({defaultTools:[],cacheWarming:'off'});
 const resourceLoader=new sdk.DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,noContextFiles:true,extensionFactories:[
  sdk.createCodemodeExtension(),
  sdk.createMcpExtension({loadConfig:()=>({servers:[],errors:[],autoEnableCodemode:true}),logPath:join(dir,'mcp.log'),createTransport:(entry)=>{
   const t=new StdioTransport({command:entry.config.command,args:entry.config.args});transports.push(t);return t;
  }}),
  pi=>{
   host=pi;
   pi.on('tool_call',event=>{events.push({name:event.toolName,parent:event.parentToolCallId});if(event.toolName===blockedTool)return{block:true,reason:'Test permission gate'};});
   extension(new Proxy(pi,{get(target,key){if(key==='exec')return async(...args)=>{cli.push(args);return target.exec(...args)};const v=target[key];return typeof v==='function'?v.bind(target):v;}}));
  },
 ]});
 const close=async()=>{try{host?.unregisterMcpServer('cua_native');}finally{await Promise.all(transports.map(t=>t.close()));session?.dispose();rmSync(dir,{recursive:true,force:true});}};
 try {
  await resourceLoader.reload();
  ({session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,resourceLoader,settingsManager,sessionManager:sdk.SessionManager.inMemory(),model:{id:'fixture-vision',name:'Deterministic fixture (never called)',api:'openai-responses',provider:'test',baseUrl:'http://127.0.0.1/unused',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:10000,maxTokens:100}}));
  await session.bindExtensions({});
  const end=Date.now()+15000;
  while(!session.getCallableToolNames().includes('mcp__cua_native__list_windows')){
   if(Date.now()>end)throw new Error('Native MCP failed startup: '+JSON.stringify(resourceLoader.getExtensions().errors));
   await new Promise(r=>setTimeout(r,25));
  }
  let counter=0;
  const call=async(args,signal)=>{
   const tool=session.agent.state.tools.find(t=>t.name==='cua_driver');
   if(!tool)throw new Error('Missing Cua tool');
   const id=`native-mcp-test-${++counter}`;
   // Supply a synthetic in-memory assistant fixture, never an actual model request.
   // The real nested pipeline requires a parent assistant call for hook ownership.
   session.agent.state.messages.push({role:'assistant',content:[{type:'toolCall',id,name:'cua_driver',arguments:args}],api:'openai-responses',provider:'test',model:'deterministic-fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:Date.now()});
   return tool.execute(id,args,signal);
  };
  return{call,close,session,events,cli,transports,block:name=>{blockedTool=name}};
 } catch(e){await close();throw e;}
}
