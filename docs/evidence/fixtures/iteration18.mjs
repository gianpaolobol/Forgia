// Copy to root of isolated checkout #4; use documented stubs, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJobs} from './server/jobs.ts';
const session='11111111-1111-4111-8111-111111111111';
const body={idea:'Synthetic catalogue',session,provider:'auto',cloudConsent:false};
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const end=async(j,id)=>{for(let i=0;i<100;i++){const x=await j.read(id,session);if(['done','failed'].includes(x?.status))return x;await tick()}throw Error('terminal timeout')};
function store(fail=false){let raw=null, failures=0;return {async getItem(){return raw},async setItem(k,v){if(fail&&!failures&&JSON.parse(v).some(j=>j.status==='done')){failures++;throw Error('synthetic transient storage write failure')}raw=v},snapshot(){return JSON.parse(raw??'[]')},failures:()=>failures}}
async function scenario(fail){const s=store(fail),gate=deferred(),entered=deferred();let calls=[];const run=async(input)=>{calls.push(input.idea);if(input.idea==='first'){entered.resolve();await gate.promise}return input.idea};const j=createJobs(s,run);const a=await j.submit({...body,idea:'first'},'first');await entered.promise;const b=await j.submit({...body,idea:'second'},'second');gate.resolve();const first=await end(j,a.id);for(let i=0;i<30;i++)await tick();return {s,j,a,b,first,calls,run}}
test('normal commit persists both results',async()=>{const x=await scenario(false);assert.equal(x.first.status,'done');assert.equal((await end(x.j,x.b.id)).status,'done');assert.equal(x.s.snapshot().filter(j=>j.status==='done').length,2);assert.deepEqual(x.calls,['first','second'])});
test('transient terminal write failure must expose durable consistent status',async()=>{const x=await scenario(true);const saved=x.s.snapshot().find(j=>j.id===x.a.id);console.log('terminal write fault',JSON.stringify({reported:x.first.status,persisted:saved.status,failures:x.s.failures()}));assert.equal(x.s.failures(),1);assert.equal(saved.status,x.first.status)});
test('pending independent task must resume after transient storage recovers without new submit',async()=>{const x=await scenario(true);const pending=await x.j.read(x.b.id,session);console.log('pending after recovery',JSON.stringify({status:pending.status,calls:x.calls}));assert.equal(pending.status,'done')});
test('restart recovers pending independent job without replaying first callback',async()=>{const x=await scenario(true);const reopened=createJobs(x.s,x.run);const result=await end(reopened,x.b.id);assert.equal(result.status,'done');assert.deepEqual(x.calls,['first','second']);assert.equal((await reopened.read(x.a.id,session)).status,'failed')});
