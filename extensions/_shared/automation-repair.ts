import { createHash } from 'node:crypto';

/** Session-local execution guard. Reload creates a fresh guard after a repair.
 * Never automatically replay a mutation: a failed response may have committed it.
 */
export function withAutomationRepair(tool: any, implementation: string): any {
  const failedMutations = new Set<string>();
  let singles = 0;
  const reads = new Set(['wait','sleep','status','session','tabs','summary','text','title','url','find','find-text','find-links','find-buttons','find-inputs','exists','value','inspect','windows','list_apps','list_windows','window_state','get_window_state','screenshot','zoom','permissions']);
  const contract = `REPAIR CONTRACT: A tool limitation or excessive round trips is unfinished work. Inspect the specific failure, implement a reusable correction in ${implementation}, add a focused regression test, validate, then reload_runtime(mode='continue') and retry through this tool. Preserve proven behavior and the user's current state. Do not repeat an unchanged failed mutation or substitute a one-off workaround. Before retrying a possibly committed action, inspect its outcome; never duplicate sends, purchases, submissions or destructive operations. Authentication, permission, user cancellation and external outages are legitimate blockers: report them rather than bypassing safeguards or endlessly editing code.`;
  return {
    ...tool,
    promptGuidelines: [...(tool.promptGuidelines || []), contract],
    async execute(...args: any[]) {
      const params = args[1] || {};
      const action = params.action === 'workflow' ? params.workflow?.action : params.action;
      const readOnly = reads.has(action);
      const batched = ['sequence','parallel','program','applescript'].includes(action) || (action === 'nav' && params.readAfter !== 'none');
      const fingerprint = createHash('sha256').update(JSON.stringify(params)).digest('hex');
      if (!readOnly && failedMutations.has(fingerprint)) {
        return {isError:true, content:[{type:'text',text:`UNCHANGED FAILED ACTION BLOCKED. This exact mutation already failed. Read-only diagnosis is still available. Inspect whether it committed, repair the reusable implementation and reload before retrying.\n${contract}`}], details:{repairRequired:true, unchangedRetryBlocked:true}};
      }
      let result: any;
      try { result = await tool.execute(...args); }
      catch (error) {
        result = {isError:true,content:[{type:'text',text:error instanceof Error ? error.message : String(error)}],details:{}};
      }
      // Cancellation must not become a mandate to continue or repair.
      if (args[2]?.aborted) return result;
      singles = batched ? 0 : singles + 1;
      const fragmented = singles >= 4;
      if (result?.isError && !readOnly) failedMutations.add(fingerprint);
      if (result?.isError || fragmented) {
        const note = result.isError ? contract : `EFFICIENCY CHECK: Four unbatched calls have accumulated. If these serve one action, stop fragmenting it: use a complete sequence/workflow; if the tool cannot express that safely, implement the missing reusable operation, validate, reload and resume. Necessary independent reads are not failures. ${contract}`;
        result = {...result,content:[...(result.content || []),{type:'text',text:note}],details:{...result.details,repairReviewRequired:!!result.isError,efficiencyReviewRequired:fragmented}};
        if (fragmented) singles = 0;
      }
      return result;
    },
  };
}
