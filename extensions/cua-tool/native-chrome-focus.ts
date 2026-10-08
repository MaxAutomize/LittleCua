// Chrome exposes AppleScript window/tab IDs as text, even though they look
// numeric. Comparing them to numeric literals can silently return false.
function chromeId(value:string|number,name:string){
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error(name+' must be an exact Chrome ID.');
  const id=String(value);if(!/^[1-9]\d*$/.test(id))throw new Error(name+' must be a positive Chrome ID.');
  return id;
}
export function chromeTabFocusScript(input:{windowId:string|number;tabId:string|number;urlPrefix?:string}){
  const windowId=chromeId(input.windowId,'windowId'),tabId=chromeId(input.tabId,'tabId');
  const prefix=input.urlPrefix??'';
  if(prefix&&(!/^https?:\/\//.test(prefix)||/[\r\n]/.test(prefix)))throw new Error('Chrome focus URL prefix must be an HTTP(S) URL.');
  const response=JSON.stringify({focused:true,chromeWindowId:windowId,chromeTabId:tabId});
  return `tell application "Google Chrome"
  set wantedWindowId to ${JSON.stringify(windowId)}
  set wantedTabId to ${JSON.stringify(tabId)}
  set expectedPrefix to ${JSON.stringify(prefix)}
  set chosenWindow to missing value
  set chosenTabIndex to 0
  repeat with w in windows
    if (id of w as text) is wantedWindowId then
      set tabIndex to 0
      repeat with t in tabs of w
        set tabIndex to tabIndex + 1
        if (id of t as text) is wantedTabId then
          if expectedPrefix is not "" and not ((URL of t as text) starts with expectedPrefix) then error "Exact Chrome tab changed page before focus; no focus change dispatched."
          set chosenWindow to w
          set chosenTabIndex to tabIndex
          exit repeat
        end if
      end repeat
      exit repeat
    end if
  end repeat
  if chosenWindow is missing value then error "Exact Chrome window/tab is unavailable; no focus change dispatched."
  set active tab index of chosenWindow to chosenTabIndex
  set index of chosenWindow to 1
  activate
  set focusVerified to false
  repeat with attempt from 1 to 30
    try
      if frontmost and ((id of first window as text) is wantedWindowId) and ((id of active tab of first window as text) is wantedTabId) then
        set focusVerified to true
        exit repeat
      end if
    end try
    delay 0.02
  end repeat
  if not focusVerified then error "Native focus dispatched but exact window/tab did not become frontmost; no retry."
end tell
return ${JSON.stringify(response)}`;
}
