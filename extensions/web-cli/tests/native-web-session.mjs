// Isolated real Pi SDK/MCP harness. No model calls, account access, or shared tabs.
import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{pathToFileURL,fileURLToPath}from'node:url';
import{jiti,root}from'../../cua-tool/tests/pi-loader.mjs';
const sdk=await import(pathToFileURL(join(root,'dist/index.js')).href);
const{StdioTransport}=await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-mcp/dist/transports/stdio.js')).href);
process.env.WEB_CLI_PATH??=fileURLToPath(new URL('../../../scripts/web',import.meta.url));
const{default:extension}=await jiti.import(new URL('../index.ts',import.meta.url).pathname);
export async function nativeWebSession(options={}){
 const cuaFactory=options.withCua?(await jiti.import(new URL('../../cua-tool/index.ts',import.meta.url).pathname)).default:undefined;
 const dir=mkdtempSync(join(tmpdir(),'web-native-sdk-')),transports=[],events=[],commands=[];let host,session,blocked=false;
 const settingsManager=sdk.SettingsManager.inMemory({defaultTools:[],cacheWarming:'off'});
 const loader=new sdk.DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,noContextFiles:true,extensionFactories:[sdk.createCodemodeExtension(),sdk.createMcpExtension({loadConfig:()=>({servers:[],errors:[],autoEnableCodemode:true}),logPath:join(dir,'mcp.log'),createTransport:entry=>{const t=new StdioTransport({command:entry.config.command,args:entry.config.args});transports.push(t);return t}}),pi=>{
  host=pi;if(cuaFactory)cuaFactory(pi);pi.on('tool_call',e=>{events.push({name:e.toolName,parent:e.parentToolCallId});if(blocked&&e.toolName==='mcp__web_native__page')return{block:true,reason:'Web test permission gate'};});
  extension(new Proxy(pi,{get(target,key){if(key==='exec')return async(...a)=>{commands.push(a);return target.exec(...a)};const v=target[key];return typeof v==='function'?v.bind(target):v;}}));
 }]});
 const close=async()=>{try{host?.unregisterMcpServer('web_native');if(cuaFactory)host?.unregisterMcpServer('cua_native')}finally{await Promise.all(transports.map(t=>t.close()));session?.dispose();rmSync(dir,{recursive:true,force:true})}};
 try{
  await loader.reload();({session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,resourceLoader:loader,settingsManager,sessionManager:sdk.SessionManager.inMemory(),model:{id:'web-fixture',name:'Deterministic fixture (never called)',api:'openai-responses',provider:'test',baseUrl:'http://127.0.0.1/unused',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:10000,maxTokens:100}}));
  await session.bindExtensions({});const deadline=Date.now()+15000;
  while(!session.getCallableToolNames().includes('mcp__web_native__page')){if(Date.now()>deadline)throw new Error('Native web MCP not ready');await new Promise(r=>setTimeout(r,25))}
  let count=0;
  const call=async(args,signal)=>{const id=`web-test-${++count}`;session.agent.state.messages.push({role:'assistant',content:[{type:'toolCall',id,name:'web_cli',arguments:args}],api:'openai-responses',provider:'test',model:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:Date.now()});return session.agent.state.tools.find(t=>t.name==='web_cli').execute(id,args,signal)};
  return{call,close,commands,events,transports,block:v=>{blocked=v},session};
 }catch(e){await close();throw e}
}
