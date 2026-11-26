// Run beside server/ with exact gateway.ts from #4 fed1b414, and isolated stubs
// described in docs/evidence/2026-11-24-iteration-10.md. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from './server/gateway.ts';
import {ProviderError} from './server/providers.ts';
function memory(){const m=new Map();return {async getItem(k){return m.get(k)??null},async setItem(k,v){m.set(k,v)}};}
function provider({preflight=false,retryAfterMs=undefined}={}) {
 let eligibility=0, completions=0;
 const failure=()=>Object.assign(new ProviderError('synthetic remote limit',429),{retryAfterMs});
 return {id:'groq',model:'fixture',mode:'free',async eligible(){eligibility++;if(preflight)throw failure();return true},async complete(){completions++;throw failure()},counts:()=>[eligibility,completions]};
}
const rateError=e=>e instanceof ProviderError&&e.status===429;
const invoke=async(g,p,idea)=>assert.rejects(g.plan(idea,p,true),rateError);
test('same gateway: pause after completion 429',async()=>{
 const g=createGateway(memory()),p=provider();await invoke(g,p,'a');await invoke(g,p,'b');assert.deepEqual(p.counts(),[1,1]);
});
test('recreated gateway: persisted cooldown must prevent second call',async()=>{
 const s=memory(),p=provider();await invoke(createGateway(s),p,'a');await invoke(createGateway(s),p,'b');assert.deepEqual(p.counts(),[1,1]);
});
test('preflight 429: same gateway must pause eligibility requests too',async()=>{
 const g=createGateway(memory()),p=provider({preflight:true});await invoke(g,p,'a');await invoke(g,p,'b');assert.deepEqual(p.counts(),[1,0]);
});
test('synthetic retry-after 120 seconds: must remain paused at 61 seconds',async()=>{
 const original=Date.now;let now=original();Date.now=()=>now;
 try{const g=createGateway(memory()),p=provider({retryAfterMs:120000});await invoke(g,p,'a');now+=61000;await invoke(g,p,'b');assert.deepEqual(p.counts(),[1,1]);}finally{Date.now=original;}
});
