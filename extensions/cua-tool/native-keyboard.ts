import { NativeDeadline, nativeOperationCoordinator } from './native-operation-coordinator.ts';

/** One PID-safe foreground keyboard transaction shared by real typing and keys.
 * Keep the PID predicate as a reference: an evaluated System Events process can
 * collapse to its name and silently target another instance with the same name.
 * Return means input dispatched, not that the application accepted/executed it.
 */
/** Extract only the uniquely observed window identity, never a descendant id. */
export function keyboardWindowIdentifier(markdown: string): string {
  const windows = markdown.split("\n").filter(line => /^\s*-\s+(?:\[\d+\]\s+)?AXWindow\b/.test(line));
  if (windows.length !== 1) return "";
  return windows[0].match(/\bid=(.*?)(?:\s+actions=\[|$)/)?.[1]?.trim() ?? "";
}

export function nativeCharacterKeyCode(key: string): number | undefined {
  const codes: Record<string,number> = {a:0,s:1,d:2,f:3,h:4,g:5,z:6,x:7,c:8,v:9,b:11,q:12,w:13,e:14,r:15,y:16,t:17,
    '1':18,'2':19,'3':20,'4':21,'6':22,'5':23,'9':25,'7':26,'8':28,'0':29,o:31,u:32,i:34,p:35,l:37,j:38,k:40,n:45,m:46};
  return codes[key.toLowerCase()];
}

export function focusedKeyboardScript(body: string, identifierArgument = 3) {
  return `on restoreFocus(priorPid, targetPid)
  if priorPid is not 0 and priorPid is not targetPid then
    tell application "System Events"
      try
        if (unix id of first application process whose frontmost is true) is targetPid then
          set frontmost of (first application process whose unix id is priorPid) to true
        end if
      end try
    end tell
  end if
end restoreFocus
on run argv
set targetPid to (item 1 of argv) as integer
set targetTitle to item 2 of argv
set targetIdentifier to ""
if (count of argv) >= ${identifierArgument} then set targetIdentifier to item ${identifierArgument} of argv
set priorPid to 0
tell application "System Events"
  try
    set priorPid to unix id of first application process whose frontmost is true
  end try
end tell
try
  tell application "System Events"
    set targetProcess to a reference to (first application process whose unix id is targetPid)
    if not (exists targetProcess) then error "Exact PID no longer exists; no key dispatched"
    if targetIdentifier is not "" then
      -- Titles can change while a Terminal command runs. A stable AXIdentifier
      -- from the driver's exact window snapshot preserves identity across that.
      set matches to 0
      repeat with w in windows of targetProcess
        try
          if (value of attribute "AXIdentifier" of w as text) is targetIdentifier then
            set matches to matches + 1
            set matchedWindow to w
          end if
        end try
      end repeat
      if matches is not 1 then error "Exact window identifier missing or ambiguous; no key dispatched"
      perform action "AXRaise" of matchedWindow
    else if targetTitle is not "" then
      set matches to count of (windows of targetProcess whose name is targetTitle)
      if matches is not 1 then error "Exact window title missing or ambiguous; no key dispatched"
      perform action "AXRaise" of (first window of targetProcess whose name is targetTitle)
    else if (count of windows of targetProcess) is not 1 then
      error "Multiple windows require an exact title; no key dispatched"
    end if
    set frontmost of targetProcess to true
    repeat 40 times
      if frontmost of targetProcess then exit repeat
      delay 0.025
    end repeat
    if not (frontmost of targetProcess) then error "Exact PID did not become frontmost; no key dispatched"
${body}
  end tell
on error messageText number errorNumber
  my restoreFocus(priorPid, targetPid)
  error messageText number errorNumber
end try
my restoreFocus(priorPid, targetPid)
return "dispatched"
end run`;
}

export function characterScript() {
  return focusedKeyboardScript(`    set payload to item 3 of argv
    set charDelay to (item 4 of argv) as real
    set commitCode to (item 5 of argv) as integer
    -- Never flood the app event queue, then inject Return through another route.
    -- Text and optional commit share one ordered System Events delivery stream.
    repeat with ch in characters of payload
      if not (frontmost of targetProcess) then error "Focus changed during typing; partial text possible; no commit sent"
      keystroke (contents of ch)
      delay charDelay
    end repeat
    delay 0.15
    if not (frontmost of targetProcess) then error "Focus changed before commit; partial text possible; no commit sent"
    if commitCode is not -1 then
      key code commitCode
      delay 0.15
    end if`, 6);
}

export async function typeNativeCharacters(pi: any, target: {pid:number;windowId:number;title:string;identifier?:string},
  text: string, options: {delayMs?:number;key?:string;timeoutMs?:number;signal?:AbortSignal} = {}) {
  const commits: Record<string,number>={return:36,enter:36,tab:48,escape:53,esc:53};
  const key=options.key?.toLowerCase();
  if(key && commits[key]===undefined)throw new Error('type_text_chars key must be return, tab or escape; no input dispatched.');
  const delayMs=options.delayMs ?? 3;
  if(!Number.isFinite(delayMs)||delayMs<1||delayMs>200)throw new Error('Real character pacing must be 1–200ms; zero-delay flooding is not supported.');
  const deadline=new NativeDeadline(options.timeoutMs??120000);
  return nativeOperationCoordinator.runExclusive(['native:*'],deadline,options.signal,'ordered native typing',async()=>{
    const result=await pi.exec('/usr/bin/osascript',['-e',characterScript(),String(target.pid),target.title,text,String(delayMs/1000),String(key?commits[key]:-1),target.identifier ?? ''],{signal:options.signal,timeout:deadline.remaining('ordered native typing')});
    const isError=result.code!==0;
    return {isError,content:[{type:'text',text:isError?`${result.stderr||result.stdout||'Native typing failed'}. Partial input/commit may exist; inspect before retrying.`:`Dispatched ${text.length} character(s) to exact PID ${target.pid}${key?`, followed by ${key} in the same ordered input transaction`:''}; restored prior focus. Application acceptance is not yet verified.`}],details:{code:result.code,pid:target.pid,windowId:target.windowId,characterCount:text.length,delayMs,commitKey:key,dispatchState:isError?'possibly-dispatched':'dispatch-only',mode:'ordered-system-events'}};
  });
}
