// Compile the installed, trusted web script's DOM generators, without running
// browser commands. Re-run after changing DOM logic in ~/.local/bin/web.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
// Default to the package's source, never a developer's private installed copy.
const binary=process.env.WEB_CLI_PATH||fileURLToPath(new URL('../../scripts/web',import.meta.url));
const source=readFileSync(binary,'utf8'),boundary=source.indexOf('# --- Main ---');
if(boundary<0)throw new Error('Unrecognized trusted web script: main boundary missing');
const dir=mkdtempSync(join(tmpdir(),'pi-web-dom-compile-'));
try{
 const lib=join(dir,'web-library.sh');writeFileSync(lib,source.slice(0,boundary),{mode:0o600});
 const templates={};
 const actions=['nav','text','summary','url','title','find','find-text','find-links','find-buttons','find-inputs','click','click-text','fill','select','submit','scroll','run','run-main','cart','exists','value'];
 for(const action of [...actions,'fill-isolated']){
  const fn=action==='fill-isolated'?'fill':action.replaceAll('-','_');
  const js=execFileSync('/bin/bash',['-c',`source "$1"\nrun_js(){ printf '%s' "$1"; }\nrun_action_js(){ run_js "$1"; }\nrun_click_js(){ run_js "$1"; }\n${action==='fill-isolated'?'run_main_js(){ return 1; }':action==='fill'?'run_main_js(){ run_js "$1"; }':''}\n${action==='text'?'TAB_TARGET="tab:compile"':''}\ncmd_${fn} ${action==='scroll'?'918273645': ['fill','fill-isolated','select','find-text','click-text'].includes(action)?'\'__WEB_NATIVE_ARG1__\' \'__WEB_NATIVE_ARG2__\'':'\'__WEB_NATIVE_ARG1__\''}`,'web-template',lib],{encoding:'utf8',env:{...process.env,WEB_CACHE:join(dir,'absent-cache'),WEB_SESSION_FILE:join(dir,'absent-session')},maxBuffer:1024*1024}).trim();
  if(!js)throw new Error('Empty template '+action);
  // nav's legacy command appends human-readable lines after JavaScript.
  templates[action]=action==='nav'?js.split('Navigated current tab to:')[0]:js;
 }
 const out=join(dirname(fileURLToPath(import.meta.url)),'dom-templates.json');
 writeFileSync(out,JSON.stringify({sourceSha256:createHash('sha256').update(source).digest('hex'),templates},null,2)+'\n');
 console.log(`Compiled ${Object.keys(templates).length} trusted DOM templates to ${out}`);
}finally{rmSync(dir,{recursive:true,force:true});}
