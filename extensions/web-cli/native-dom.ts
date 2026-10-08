import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const bundle = JSON.parse(readFileSync(new URL("./dom-templates.json", import.meta.url), "utf8"));
const DEFAULT_TAGS = 'a,button,input,select,textarea,[role],label,[onclick]';
export const NATIVE_DOM_ACTIONS = new Set([...Object.keys(bundle.templates).filter(k=>k!=='fill-isolated'),'wait','sleep']);
let checkedSignature = '';
export function assertDomSource(binary: string) {
  const s=statSync(binary), signature=`${binary}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  if(signature===checkedSignature)return;
  const hash=createHash('sha256').update(readFileSync(binary)).digest('hex');
  if(hash!==bundle.sourceSha256)throw new Error('Installed web script changed: regenerate web-cli/dom-templates.json with generate-dom-templates.mjs, validate, and reload. No stale DOM code was dispatched.');
  checkedSignature=signature;
}
export function domScript(action: string, args: string[]) {
  if(action==='run')return args.join(' ');
  if(action==='scroll'){
    if(!/^-?\d+$/.test(args[0]))throw new Error('pixels must be an integer');
    return bundle.templates.scroll.replaceAll('918273645',args[0]);
  }
  const template=bundle.templates[action];
  if(!template)throw new Error(`No native DOM template for ${action}`);
  const values=[args[0]??'',args[1]??(['find-text','click-text'].includes(action)?DEFAULT_TAGS:'')];
  const source=template.replace(/"__WEB_NATIVE_ARG([12])__"/g,(_m:string,n:string)=>JSON.stringify(values[Number(n)-1]));
  return action==='fill'?domScript('run-main',[source]):source;
}
export function unwrapPageText(text: string) {
  const prefix='## Result\n\n```\n',suffix='\n```';
  return text.startsWith(prefix)&&text.endsWith(suffix)?text.slice(prefix.length,-suffix.length):text;
}
export function guardedScript(source: string, key: string, token: string) {
  return `(()=>{if(globalThis[${JSON.stringify(key)}]!==${JSON.stringify(token)})return JSON.stringify({__piWeb:1,targetChanged:true,dispatched:false});try{const value=(0,eval)(${JSON.stringify(source)});return JSON.stringify({__piWeb:1,ok:true,defined:value!==undefined,value:value===undefined?null:value})}catch(e){return JSON.stringify({__piWeb:1,ok:false,error:String(e&&e.message||e),dispatched:true})}})()`;
}
export function decodePageResult(text: string): any {
  let data;try{data=JSON.parse(unwrapPageText(text).trim())}catch{throw new Error(`Unrecognized native page response; outcome may be unknown. No retry. ${text.slice(0,500)}`)}
  if(data?.__piWeb!==1)throw new Error('Missing native page execution envelope; no retry.');
  return data;
}
export function domOutput(data: any) {
  if(!data.ok)throw new Error(data.error||'Native page execution failed');
  if(!data.defined)return '';
  return typeof data.value==='string'?data.value:JSON.stringify(data.value);
}
