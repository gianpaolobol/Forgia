import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorized} from '../server/jobAuthorization.ts';
const grant='a'.repeat(64), session='tester';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test('A1: missing, invalid or revoked grant never dispatches',async()=>{
 let calls=0; const run=async()=>++calls;
 for(const value of [undefined,'invalid',grant]) await assert.rejects(runAuthorized(async()=>false,session,value,run),{status:403});
 assert.equal(calls,0);
});
test('A2: revoked in flight aborts even an adapter ignoring cancellation',async()=>{
 let valid=true, signal:AbortSignal|undefined;
 const result=runAuthorized(async()=>valid,session,grant,async s=>{signal=s;valid=false;await delay(80);return 1;},5);
 await assert.rejects(result,{status:403});assert.equal(signal?.aborted,true);
});
test('A3: final authorization detects revocation before the poll',async()=>{
 let valid=true;
 await assert.rejects(runAuthorized(async()=>valid,session,grant,async()=>{valid=false;return 1;},1000),{status:403});
});
test('A4: corrupt snapshot and timeout fail closed',async()=>{
 let calls=0; const run=async()=>++calls;
 await assert.rejects(runAuthorized(async()=>{throw Error('bad snapshot');},session,grant,run),{status:403});
 await assert.rejects(runAuthorized(()=>new Promise(()=>{}),session,grant,run),{status:403});assert.equal(calls,0);
});
test('A5: valid grant succeeds, no lingering polls',async()=>{
 let checks=0;
 assert.equal(await runAuthorized(async(s,g)=>{assert.equal(s,session);assert.equal(g,grant);checks++;return true;},session,grant,async()=>7,5),7);
 const finished=checks;await delay(20);assert.equal(checks,finished);assert.equal(checks,2);
});
