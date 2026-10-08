import assert from 'node:assert/strict';
import {jiti} from './pi-loader.mjs';
const {chromeTabFocusScript}=await jiti.import(new URL('../native-chrome-focus.ts',import.meta.url).pathname);
const script=chromeTabFocusScript({windowId:2060249259,tabId:'2060249260',urlPrefix:'https://pptform.state.gov/'});
assert.match(script,/set wantedWindowId to "2060249259"/);
assert.match(script,/set wantedTabId to "2060249260"/);
assert.match(script,/\(id of w as text\) is wantedWindowId/);
assert.match(script,/\(id of t as text\) is wantedTabId/);
assert.ok(!/is 2060249/.test(script),'never compare Chrome text IDs to numeric literals');
assert.ok(script.indexOf('if chosenWindow is missing value then error')<script.indexOf('set active tab index'),'preflight before focus mutation');
assert.ok(script.indexOf('Exact Chrome tab changed page')<script.indexOf('set active tab index'));
assert.match(script,/if frontmost and/);assert.match(script,/if not focusVerified then error/);
assert.equal(script.match(/\n  activate\n/g).length,1,'focus dispatch occurs once; bounded verification reads never replay it');
for(const id of ['active','-1','0','x" & do shell script "bad',Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>chromeTabFocusScript({windowId:id,tabId:1}),/Chrome ID/);
assert.throws(()=>chromeTabFocusScript({windowId:1,tabId:2,urlPrefix:'javascript:bad'}),/HTTP/);
assert.match(chromeTabFocusScript({windowId:'9223372036854775807',tabId:'3'}),/9223372036854775807/,'exact text IDs do not lose precision');
console.log('PASS Chrome focus text-ID coercion, exact-tab preflight, URL guard, validation and script escaping');
