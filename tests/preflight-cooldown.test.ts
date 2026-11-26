import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProvider} from '../server/providers.ts';
import {ProviderError,QuotaDeferral,verifyEligibility} from '../server/quotaDeferral.ts';

test('P1 explicit catalog 429 preserves Retry-After and never dispatches inference',async()=>{
 let calls=0;const before=Date.now();
 const provider=createProvider({id:'openrouter',model:'fixture/model:free',apiKey:'synthetic'},async(url,init)=>{
  calls++;assert.equal(url,'https://openrouter.ai/api/v1/models');
  assert.equal(init?.headers,undefined);
  return new Response('',{status:429,headers:{'Retry-After':'180'}});
 });
 await assert.rejects(provider.eligible(),e=>e instanceof QuotaDeferral&&e.nextEligibleAt>=before+180000);
 assert.equal(calls,1);
});

test('P2 eligibility records typed deadline and propagates the same failure',async()=>{
 const until=Date.now()+180000,error=new QuotaDeferral(until);
 const deadlines:number[]=[];
 await assert.rejects(verifyEligibility(async()=>{throw error;},new AbortController().signal,d=>deadlines.push(d)),e=>e===error);
 assert.deepEqual(deadlines,[until]);
});

test('P3 generic 429 records cooldown without converting to replay-safe failure',async()=>{
 const error=new ProviderError('unclassified',429),before=Date.now();
 const deadlines:number[]=[];
 await assert.rejects(verifyEligibility(async()=>{throw error;},new AbortController().signal,d=>deadlines.push(d)),e=>e===error&&!(e instanceof QuotaDeferral));
 assert.equal(deadlines.length,1);assert.ok(deadlines[0]>=before+60000);
});

test('P5 denied or aborted eligibility does not become a rate-limit retry',async()=>{
 let records=0,checks=0;
 await assert.rejects(verifyEligibility(async()=>false,new AbortController().signal,()=>records++),e=>e instanceof ProviderError&&e.status===403);
 const controller=new AbortController();controller.abort();
 await assert.rejects(verifyEligibility(async()=>{checks++;return true;},controller.signal,()=>records++),{name:'AbortError'});
 assert.equal(records,0);assert.equal(checks,0);
});
