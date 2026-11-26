// Run from isolated checkout with original jobs.ts; see iteration-09 report for stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from './server/jobs.ts';
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const body={idea:'Synthetic catalogue',session:alice,provider:'auto',cloudConsent:false};
const makeStore=()=>{const data=new Map();return {async getItem(k){return data.get(k)??null},async setItem(k,v){data.set(k,v)}}};
const end=async(j,id,session=alice)=>{for(let i=0;i<1000;i++){const v=await j.read(id,session);if(v?.status==='done'||v?.status==='failed')return v;await new Promise(r=>setImmediate(r));}throw Error('terminal timeout')};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
test('same payload and key stays idempotent; other session isolated',async()=>{
 const s=makeStore();let calls=0;const j=createJobs(s,async()=>++calls);
 const a=await j.submit(body,'same');await end(j,a.id);
 const reopened=createJobs(s,async()=>++calls);
 assert.deepEqual(await reopened.submit(body,'same'),a);assert.equal(await reopened.read(a.id,bob),null);
 const b=await reopened.submit({...body,session:bob},'same');assert.notEqual(b.id,a.id);await end(reopened,b.id,bob);assert.equal(calls,2);
});
test('changed payload/consent while queued must be rejected, not silently reuse old input',async()=>{
 const s=makeStore(),gate=deferred();let dispatched=[];
 const j=createJobs(s,async(input)=>{dispatched.push(input);if(input.idea==='blocker')await gate.promise;return input.consent});
 const a=await j.submit({...body,idea:'blocker'},'block');
 const b=await j.submit({...body,cloudConsent:true},'changed');
 let rejected=false,reply;try{reply=await j.submit({...body,cloudConsent:false},'changed')}catch{rejected=true}finally{gate.resolve()}
 await end(j,a.id);await end(j,b.id);
 console.log('changed consent:',JSON.stringify({rejected,sameId:reply?.id===b.id,dispatchedConsent:dispatched[1]?.consent}));
 assert.equal(rejected,true,'changed consent reused previous job instead of rejection');
});
test('failed callback with uncertain effect must not auto-dispatch on identical retry',async()=>{
 const s=makeStore();let calls=0;const run=async()=>{calls++;throw Error('synthetic timeout after effect')};
 const j=createJobs(s,run);const a=await j.submit(body,'uncertain');await end(j,a.id);
 const reopened=createJobs(s,run);const b=await reopened.submit(body,'uncertain');await end(reopened,b.id);
 console.log('uncertain retry:',JSON.stringify({sameId:a.id===b.id,calls}));assert.equal(calls,1,'second callback without reconciliation');
});
test('eviction of terminal result must retain key or explicitly reject stale retry within defined window',async()=>{
 const s=makeStore();let calls=0;const run=async()=>++calls;const j=createJobs(s,run);
 const a=await j.submit(body,'old');await end(j,a.id);
 for(let i=0;i<32;i++){const b=await j.submit({...body,idea:'filler '+i},'filler:'+i);await end(j,b.id)}
 const reopened=createJobs(s,run);const oldResult=await reopened.read(a.id,alice);let retry;try{retry=await reopened.submit(body,'old');await end(reopened,retry.id)}catch{}
 console.log('retention:',JSON.stringify({oldResult,oldIdReused:retry?.id===a.id,calls}));assert.equal(calls,33,'old key reused as new dispatch immediately after eviction');
});
