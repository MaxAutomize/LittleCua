import assert from 'node:assert/strict';
import { jiti } from './pi-loader.mjs';
const { default: nativeWorkflowExtension } = await jiti.import('../native-workflow-speed.ts');

const tools=['list_windows','get_window_state','click','type_text','hotkey','set_value','press_key','scroll','double_click','right_click','drag','screenshot','launch_app'];
const docs={mcp:{version:'test-driver',tools:tools.map(name=>({name,input_schema:{properties:{pid:{},window_id:{},x:{},y:{},element_index:{},text:{},value:{},format:{}}}}))}};
function createHarness({ failClick=false, disabledTree=false, contextTree=false }={}) {
  let tool; let clicks=0; let activeClicks=0; let peakClicks=0; const calls=[];
  const pi={
    registerTool(definition){ tool=definition; }, registerCommand(){}, on(){},
    async exec(_bin,args){
      if(args[0]==='status') return {code:0,stdout:'ok',stderr:''};
      if(args[0]==='dump-docs') return {code:0,stdout:JSON.stringify(docs),stderr:''};
      if(args[0]!=='call') throw new Error(`Unexpected command ${args.join(' ')}`);
      const name=args[1], payload=JSON.parse(args[2]); calls.push({name,payload});
      if(name==='list_windows') return {code:0,stdout:JSON.stringify({windows:[{pid:77,window_id:88,title:'Fixture',app_name:'LittleCua Fixture',is_on_screen:true,on_current_space:true,bounds:{x:10,y:10,width:400,height:300}}]}),stderr:''};
      if(name==='get_window_state') return {code:0,stdout:JSON.stringify({tree_markdown:contextTree ? '- AXGroup "Delivery details"\n  - [1] AXButton "Edit"\n- AXGroup "Billing details"\n  - [2] AXButton "Edit"' : disabledTree ? '[1] AXButton "Fixture Submit"\n[2] AXButton "Fixture Disabled" DISABLED' : '[1] AXButton "Increment" actions=[AXPress]\n[2] AXTextField "Fixture input"',element_count:2}),stderr:''};
      if(name==='click') {
        activeClicks++; peakClicks=Math.max(peakClicks,activeClicks); await new Promise(resolve=>setTimeout(resolve,15)); activeClicks--;
        if(failClick) return {code:1,stdout:'transport timed out after dispatch',stderr:''};
        clicks++; return {code:0,stdout:JSON.stringify({clicked:true}),stderr:''};
      }
      return {code:0,stdout:JSON.stringify({ok:true}),stderr:''};
    },
  };
  nativeWorkflowExtension(pi);
  return {tool,calls,get clicks(){return clicks},get peakClicks(){return peakClicks}};
}

const params={action:'sequence',pid:77,windowId:88,timeoutMs:500,steps:[{action:'click',query:'Increment',role:'Button'}]};
const h=createHarness();
const [one,two]=await Promise.all([h.tool.execute('one',params),h.tool.execute('two',params)]);
assert.equal(h.clicks,2);
assert.equal(h.peakClicks,1,'same target click dispatches must not overlap');
assert.equal(one.details.dispatchState,'dispatch-only');
assert.equal(two.details.dispatchState,'dispatch-only');

const failed=createHarness({failClick:true});
await assert.rejects(failed.tool.execute('failure',params), error => /timeout.*Dispatch state: possibly-dispatched/i.test(error.message));
assert.equal(failed.calls.filter(call=>call.name==='click').length,1,'an ambiguous mutation is never replayed');

const disabled=createHarness({disabledTree:true});
await assert.rejects(disabled.tool.execute('disabled',{action:'sequence',pid:77,windowId:88,timeoutMs:500,steps:[{action:'click',query:'Fixture Disabled',role:'Button'}]}),/No enabled AX element|Native workflow failed/i);
assert.equal(disabled.calls.filter(call=>call.name==='click').length,0,'disabled exact label is not fuzzily redirected');

const contextual=createHarness({contextTree:true});
const contextualResult=await contextual.tool.execute('contextual',{action:'sequence',pid:77,windowId:88,timeoutMs:500,steps:[{action:'click',query:'Edit',role:'Button',within:'Delivery details'}]});
assert.equal(contextualResult.details.steps[0].summary.includes('[1]'),true,'ancestor context selects delivery Edit');
assert.equal(contextual.calls.filter(call=>call.name==='click').at(-1).payload.element_index,1);
await assert.rejects(contextual.tool.execute('missing-context',{action:'sequence',pid:77,windowId:88,timeoutMs:500,steps:[{action:'click',query:'Edit',role:'Button',within:'Shipping details'}]}),/No enabled AX element|Native workflow failed/i);
assert.equal(contextual.calls.filter(call=>call.name==='click').length,1,'unmatched context does not dispatch');
await assert.rejects(contextual.tool.execute('ambiguous',{action:'sequence',pid:77,windowId:88,timeoutMs:500,steps:[{action:'click',query:'Edit',role:'Button'}]}),/Ambiguous AX selector|Native workflow failed/i);
assert.equal(contextual.calls.filter(call=>call.name==='click').length,1,'duplicate mutating selector does not choose first match');

const deadline=createHarness();
await assert.rejects(deadline.tool.execute('deadline',{action:'sequence',pid:77,windowId:88,timeoutMs:20,steps:[{action:'wait',waitMs:100},{action:'click',query:'Increment',role:'Button'}]}), /timeout/i);
assert.equal(deadline.calls.filter(call=>call.name==='click').length,0);
console.log('PASS native workflow serialization, ambiguity no-replay, and end-to-end deadline');
